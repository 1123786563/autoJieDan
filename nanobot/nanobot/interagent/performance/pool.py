"""
对象池与Buffer池
用于内存优化，减少GC压力

@module interagent.performance.pool
@version 1.0.0
"""

from dataclasses import dataclass, field
from typing import Any, Callable, Generic, List, Optional, TypeVar

T = TypeVar("T")


# ============================================================================
# Types
# ============================================================================


@dataclass
class PoolStats:
    """池统计信息"""

    available: int
    """池中可用对象数"""

    in_use: int
    """正在使用的对象数"""

    total_created: int
    """总创建数"""

    total_acquired: int
    """总获取数"""

    total_released: int
    """总释放数"""

    hit_rate: float
    """命中率"""


# ============================================================================
# ObjectPool
# ============================================================================


class ObjectPool(Generic[T]):
    """
    通用对象池

    Example:
        pool = ObjectPool(
            factory=lambda: {"data": "", "count": 0},
            reset=lambda obj: obj.update({"data": "", "count": 0}),
            max_size=100
        )

        obj = pool.acquire()
        # 使用对象...
        pool.release(obj)
    """

    def __init__(
        self,
        factory: Callable[[], T],
        reset: Optional[Callable[[T], None]] = None,
        initial_size: int = 10,
        max_size: int = 100,
    ):
        """
        初始化对象池

        Args:
            factory: 工厂函数 - 创建新对象
            reset: 重置函数 - 重置对象状态
            initial_size: 初始池大小
            max_size: 最大池大小
        """
        self._factory = factory
        self._reset = reset
        self._max_size = max_size

        self._pool: List[T] = []
        self._in_use_count = 0
        self._total_created = 0
        self._total_acquired = 0
        self._total_released = 0
        self._hits = 0
        self._misses = 0

        # 预创建对象
        for _ in range(initial_size):
            self._pool.append(self._factory())
            self._total_created += 1

    def acquire(self) -> T:
        """获取对象"""
        self._total_acquired += 1

        if self._pool:
            self._hits += 1
            obj = self._pool.pop()
            self._in_use_count += 1
            return obj

        self._misses += 1
        self._total_created += 1
        self._in_use_count += 1
        return self._factory()

    def release(self, obj: T) -> None:
        """释放对象回池"""
        if self._in_use_count <= 0:
            return

        self._total_released += 1
        self._in_use_count -= 1

        if len(self._pool) < self._max_size:
            if self._reset:
                self._reset(obj)
            self._pool.append(obj)
        # 超过最大容量则丢弃

    def acquire_batch(self, count: int) -> List[T]:
        """批量获取对象"""
        return [self.acquire() for _ in range(count)]

    def release_batch(self, objects: List[T]) -> None:
        """批量释放对象"""
        for obj in objects:
            self.release(obj)

    def clear(self) -> None:
        """清空池"""
        self._pool = []
        self._in_use_count = 0

    def get_stats(self) -> PoolStats:
        """获取统计信息"""
        total_requests = self._hits + self._misses
        return PoolStats(
            available=len(self._pool),
            in_use=self._in_use_count,
            total_created=self._total_created,
            total_acquired=self._total_acquired,
            total_released=self._total_released,
            hit_rate=self._hits / total_requests if total_requests > 0 else 0,
        )

    @property
    def available(self) -> int:
        """获取可用对象数"""
        return len(self._pool)

    @property
    def in_use(self) -> int:
        """获取使用中对象数"""
        return self._in_use_count


# ============================================================================
# BufferPool
# ============================================================================


class BufferPool:
    """
    Buffer 池
    专门用于 bytes 复用

    Example:
        buffer_pool = BufferPool(buffer_size=4096, max_size=50)

        buffer = buffer_pool.acquire()
        # 使用 buffer...
        buffer_pool.release(buffer)
    """

    def __init__(
        self,
        buffer_size: int = 4096,
        initial_size: int = 10,
        max_size: int = 50,
    ):
        """
        初始化 Buffer 池

        Args:
            buffer_size: Buffer 大小
            initial_size: 初始池大小
            max_size: 最大池大小
        """
        self._buffer_size = buffer_size
        self._max_size = max_size

        self._pool: List[bytearray] = []
        self._in_use_count = 0
        self._total_created = 0
        self._total_acquired = 0
        self._total_released = 0
        self._hits = 0
        self._misses = 0

        # 预创建 buffers
        for _ in range(initial_size):
            self._pool.append(bytearray(buffer_size))
            self._total_created += 1

    def acquire(self) -> bytearray:
        """获取 Buffer"""
        self._total_acquired += 1

        if self._pool:
            self._hits += 1
            buffer = self._pool.pop()
            self._in_use_count += 1
            # 清空 buffer
            for i in range(len(buffer)):
                buffer[i] = 0
            return buffer

        self._misses += 1
        self._total_created += 1
        self._in_use_count += 1
        return bytearray(self._buffer_size)

    def release(self, buffer: bytearray) -> None:
        """释放 Buffer 回池"""
        if self._in_use_count <= 0:
            return

        self._total_released += 1
        self._in_use_count -= 1

        if len(buffer) == self._buffer_size and len(self._pool) < self._max_size:
            self._pool.append(buffer)

    def clear(self) -> None:
        """清空池"""
        self._pool = []
        self._in_use_count = 0

    def get_stats(self) -> PoolStats:
        """获取统计信息"""
        total_requests = self._hits + self._misses
        return PoolStats(
            available=len(self._pool),
            in_use=self._in_use_count,
            total_created=self._total_created,
            total_acquired=self._total_acquired,
            total_released=self._total_released,
            hit_rate=self._hits / total_requests if total_requests > 0 else 0,
        )

    @property
    def buffer_size(self) -> int:
        """获取 Buffer 大小"""
        return self._buffer_size

    @property
    def available(self) -> int:
        """获取可用 Buffer 数"""
        return len(self._pool)

    @property
    def in_use(self) -> int:
        """获取使用中 Buffer 数"""
        return self._in_use_count


# ============================================================================
# Helper Functions
# ============================================================================


def create_object_pool(
    factory: Callable[[], T],
    reset: Optional[Callable[[T], None]] = None,
    initial_size: int = 10,
    max_size: int = 100,
) -> ObjectPool[T]:
    """创建对象池"""
    return ObjectPool(
        factory=factory,
        reset=reset,
        initial_size=initial_size,
        max_size=max_size,
    )


def create_buffer_pool(
    buffer_size: int = 4096,
    initial_size: int = 10,
    max_size: int = 50,
) -> BufferPool:
    """创建 Buffer 池"""
    return BufferPool(
        buffer_size=buffer_size,
        initial_size=initial_size,
        max_size=max_size,
    )
