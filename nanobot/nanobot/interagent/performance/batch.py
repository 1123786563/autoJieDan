"""
批量处理器
用于 CPU 优化，减少序列化开销

@module interagent.performance.batch
@version 1.0.0
"""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Generic, List, Optional, TypeVar

T = TypeVar("T")
R = TypeVar("R")


# ============================================================================
# Types
# ============================================================================


@dataclass
class BatchResult(Generic[R]):
    """批量处理结果"""

    results: List[R]
    """处理结果"""

    processed_count: int
    """处理的项目数"""

    duration_ms: float
    """处理耗时 (毫秒)"""

    success: bool
    """是否成功"""

    error: Optional[str] = None
    """错误信息"""


@dataclass
class BatchStats:
    """批量处理统计"""

    total_batches: int
    """总批次数"""

    total_items: int
    """总处理项目数"""

    avg_batch_size: float
    """平均批次大小"""

    avg_wait_ms: float
    """平均等待时间"""

    avg_process_ms: float
    """平均处理时间"""

    errors: int
    """错误数"""


@dataclass
class _PendingItem(Generic[T, R]):
    """待处理项目"""

    item: T
    future: asyncio.Future


# ============================================================================
# BatchProcessor
# ============================================================================


class BatchProcessor(Generic[T, R]):
    """
    批量处理器
    自动收集请求并批量处理

    Example:
        async def process_batch(items):
            return [process(item) for item in items]

        processor = BatchProcessor(
            processor=process_batch,
            max_batch_size=100,
            max_wait_ms=50
        )

        # 添加项目到批次
        result = await processor.add(item)
    """

    def __init__(
        self,
        processor: Callable[[List[T]], List[R] | asyncio.Future[List[R]]],
        max_batch_size: int = 100,
        max_wait_ms: float = 50,
        on_error: Optional[Callable[[Exception, List[T]], None]] = None,
    ):
        """
        初始化批量处理器

        Args:
            processor: 批量处理函数
            max_batch_size: 最大批次大小
            max_wait_ms: 最大等待时间 (毫秒)
            on_error: 错误处理回调
        """
        self._processor = processor
        self._max_batch_size = max_batch_size
        self._max_wait_ms = max_wait_ms
        self._on_error = on_error

        self._pending: List[_PendingItem[T, R]] = []
        self._timer: Optional[asyncio.TimerHandle] = None
        self._processing = False

        # 统计
        self._total_batches = 0
        self._total_items = 0
        self._total_wait_ms = 0.0
        self._total_process_ms = 0.0
        self._errors = 0

    async def add(self, item: T) -> R:
        """添加项目到批次"""
        loop = asyncio.get_event_loop()
        future = loop.create_future()

        self._pending.append(_PendingItem(item=item, future=future))

        # 如果达到最大批次大小，立即处理
        if len(self._pending) >= self._max_batch_size:
            self._schedule_flush()
            return await future

        # 启动定时器
        self._schedule_timer()

        return await future

    async def add_batch(self, items: List[T]) -> List[R]:
        """添加多个项目"""
        return await asyncio.gather(*[self.add(item) for item in items])

    def _schedule_timer(self) -> None:
        """调度定时器"""
        if self._timer is not None:
            return

        loop = asyncio.get_event_loop()
        self._timer = loop.call_later(
            self._max_wait_ms / 1000,
            self._schedule_flush,
        )

    def _schedule_flush(self) -> None:
        """调度刷新"""
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

        loop = asyncio.get_event_loop()
        loop.create_task(self._flush())

    async def _flush(self) -> None:
        """刷新待处理队列"""
        if self._processing or not self._pending:
            return

        self._processing = True
        batch = self._pending[: self._max_batch_size]
        self._pending = self._pending[self._max_batch_size :]

        items = [p.item for p in batch]
        start_time = time.time()

        try:
            results = self._processor(items)
            if asyncio.iscoroutine(results):
                results = await results

            duration_ms = (time.time() - start_time) * 1000

            # 更新统计
            self._total_batches += 1
            self._total_items += len(items)
            self._total_process_ms += duration_ms

            # 返回结果
            for i, pending in enumerate(batch):
                if i < len(results):
                    pending.future.set_result(results[i])
                else:
                    pending.future.set_exception(Exception("Missing result"))

        except Exception as e:
            self._errors += 1

            if self._on_error:
                self._on_error(e, items)

            for pending in batch:
                pending.future.set_exception(e)

        finally:
            self._processing = False

            # 如果还有待处理项目，继续处理
            if self._pending:
                self._schedule_timer()

    async def drain(self) -> None:
        """等待所有待处理项目完成"""
        while self._pending or self._processing:
            await self._flush()
            await asyncio.sleep(0.01)

    def get_stats(self) -> BatchStats:
        """获取统计信息"""
        return BatchStats(
            total_batches=self._total_batches,
            total_items=self._total_items,
            avg_batch_size=(
                self._total_items / self._total_batches if self._total_batches > 0 else 0
            ),
            avg_wait_ms=(
                self._total_wait_ms / self._total_batches if self._total_batches > 0 else 0
            ),
            avg_process_ms=(
                self._total_process_ms / self._total_batches if self._total_batches > 0 else 0
            ),
            errors=self._errors,
        )

    @property
    def pending_count(self) -> int:
        """获取待处理数量"""
        return len(self._pending)

    @property
    def is_processing(self) -> bool:
        """是否正在处理"""
        return self._processing


# ============================================================================
# ThrottledBatchProcessor
# ============================================================================


class ThrottledBatchProcessor(BatchProcessor[T, R]):
    """带限流的批量处理器"""

    def __init__(
        self,
        processor: Callable[[List[T]], List[R] | asyncio.Future[List[R]]],
        max_batch_size: int = 100,
        max_wait_ms: float = 50,
        min_interval_ms: float = 100,
        on_error: Optional[Callable[[Exception, List[T]], None]] = None,
    ):
        super().__init__(
            processor=processor,
            max_batch_size=max_batch_size,
            max_wait_ms=max_wait_ms,
            on_error=on_error,
        )
        self._min_interval_ms = min_interval_ms
        self._last_process_time = 0.0

    async def _flush(self) -> None:
        """刷新带限流"""
        now = time.time() * 1000
        elapsed = now - self._last_process_time

        if elapsed < self._min_interval_ms:
            await asyncio.sleep((self._min_interval_ms - elapsed) / 1000)

        self._last_process_time = time.time() * 1000
        await super()._flush()


# ============================================================================
# Helper Functions
# ============================================================================


def create_batch_processor(
    processor: Callable[[List[T]], List[R] | asyncio.Future[List[R]]],
    max_batch_size: int = 100,
    max_wait_ms: float = 50,
    on_error: Optional[Callable[[Exception, List[T]], None]] = None,
) -> BatchProcessor[T, R]:
    """创建批量处理器"""
    return BatchProcessor(
        processor=processor,
        max_batch_size=max_batch_size,
        max_wait_ms=max_wait_ms,
        on_error=on_error,
    )
