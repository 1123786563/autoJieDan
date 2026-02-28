"""
进度报告 ANP 适配器实现
实现 ProgressReportSender 和 ProgressReportReceiver 类

@module nanobot.interagent.progress.adapter
@version 1.0.0
"""

import asyncio
import time
from datetime import datetime
from typing import Optional, Dict, Any, List, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import deque
import logging

from nanobot.anp.types import (
    ANPMessage,
    ANPMessageType,
    ProgressReportPayload,
    AUTOMATON_DID,
    NANOBOT_DID,
)
from nanobot.anp.signature import (
    create_anp_message,
    CreateMessageOptions,
    sign_payload,
)
from nanobot.anp.did import generate_key_pair, import_private_key
from nanobot.interagent.progress_reporter import (
    ProgressTracker,
    ProgressUpdate,
    ProgressEvent,
    ProgressEventType,
    ProgressReport,
    ProgressStatus,
)


logger = logging.getLogger(__name__)


# ============================================================================
# 类型定义
# ============================================================================


class ProgressSyncState(str, Enum):
    """进度同步状态"""
    IDLE = "idle"
    SYNCING = "syncing"
    ERROR = "error"


@dataclass
class ProgressSyncConfig:
    """进度同步配置"""
    sync_interval_ms: float = 1000  # 同步间隔（毫秒）
    max_batch_size: int = 10  # 最大批量大小
    enable_compression: bool = False  # 启用压缩
    sync_threshold: float = 1.0  # 进度变化阈值（百分比）
    max_retries: int = 3  # 最大重试次数
    retry_delay_ms: float = 500  # 重试延迟（毫秒）
    enable_incremental: bool = True  # 启用增量更新


@dataclass
class ProgressSyncStats:
    """进度同步统计"""
    total_syncs: int = 0
    successful_syncs: int = 0
    failed_syncs: int = 0
    total_bytes_sent: int = 0
    total_bytes_received: int = 0
    average_latency_ms: float = 0
    last_sync_time: Optional[datetime] = None
    last_error: Optional[str] = None


@dataclass
class PendingProgressUpdate:
    """待发送的进度更新"""
    task_id: str
    timestamp: datetime
    percentage: float
    message: Optional[str] = None
    current_step: Optional[str] = None
    completed_steps: Optional[List[str]] = None
    next_steps: Optional[List[str]] = None
    eta_seconds: Optional[int] = None
    blockers: Optional[List[str]] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


# ============================================================================
# ProgressReportSender - 发送进度报告到 Automaton
# ============================================================================


class ProgressReportSender:
    """
    进度报告发送器
    将本地进度报告转换为 ANP 消息并发送到 Automaton
    """

    def __init__(
        self,
        config: ProgressSyncConfig,
        private_key_pem: Optional[str] = None,
        did: str = NANOBOT_DID,
        target_did: str = AUTOMATON_DID,
    ):
        """
        初始化进度报告发送器

        Args:
            config: 同步配置
            private_key_pem: 私钥 PEM 格式
            did: 本地 DID
            target_did: 目标 DID
        """
        self.config = config
        self.did = did
        self.target_did = target_did

        # 加载密钥
        if private_key_pem:
            self._private_key = import_private_key(private_key_pem)
        else:
            private_pem, _ = generate_key_pair()
            self._private_key = import_private_key(private_pem)

        # 状态管理
        self._state = ProgressSyncState.IDLE
        self._stats = ProgressSyncStats()
        self._pending_updates: deque[PendingProgressUpdate] = deque()
        self._last_sent_percentage: Dict[str, float] = {}

        # 事件处理
        self._message_handler: Optional[Callable[[ANPMessage], None]] = None
        self._error_handler: Optional[Callable[[Exception], None]] = None

        # 异步任务
        self._sync_task: Optional[asyncio.Task] = None
        self._running = False

        # 锁
        self._lock = asyncio.Lock()

    # ========================================================================
    # 生命周期管理
    # ========================================================================

    async def start(self) -> None:
        """启动发送器"""
        if self._running:
            return

        self._running = True
        self._state = ProgressSyncState.IDLE

        # 启动同步任务
        self._sync_task = asyncio.create_task(self._sync_loop())

        logger.info(f"ProgressReportSender started: {self.did} -> {self.target_did}")

    async def stop(self) -> None:
        """停止发送器"""
        if not self._running:
            return

        self._running = False

        # 取消同步任务
        if self._sync_task:
            self._sync_task.cancel()
            try:
                await self._sync_task
            except asyncio.CancelledError:
                pass

        # 发送所有待发送的更新
        await self._flush_pending_updates()

        logger.info("ProgressReportSender stopped")

    # ========================================================================
    # 进度报告接口
    # ========================================================================

    async def report_progress(
        self,
        task_id: str,
        percentage: float,
        message: Optional[str] = None,
        current_step: Optional[str] = None,
        completed_steps: Optional[List[str]] = None,
        next_steps: Optional[List[str]] = None,
        eta_seconds: Optional[int] = None,
        blockers: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """
        报告进度

        Args:
            task_id: 任务 ID
            percentage: 进度百分比 (0-100)
            message: 进度消息
            current_step: 当前步骤
            completed_steps: 已完成步骤列表
            next_steps: 下一步骤列表
            eta_seconds: 预计剩余时间（秒）
            blockers: 阻塞问题列表
            metadata: 元数据

        Returns:
            是否成功加入发送队列
        """
        if not self._running:
            logger.warning("ProgressReportSender not running")
            return False

        # 检查增量更新阈值
        if self.config.enable_incremental:
            last_percentage = self._last_sent_percentage.get(task_id, 0)
            if abs(percentage - last_percentage) < self.config.sync_threshold:
                # 进度变化太小，跳过
                return False

        # 创建待发送更新
        update = PendingProgressUpdate(
            task_id=task_id,
            timestamp=datetime.now(),
            percentage=percentage,
            message=message,
            current_step=current_step,
            completed_steps=completed_steps or [],
            next_steps=next_steps or [],
            eta_seconds=eta_seconds,
            blockers=blockers or [],
            metadata=metadata or {},
        )

        async with self._lock:
            self._pending_updates.append(update)
            self._last_sent_percentage[task_id] = percentage

        logger.debug(f"Progress update queued: {task_id} - {percentage}%")
        return True

    async def report_from_tracker(self, tracker: ProgressTracker) -> bool:
        """
        从 ProgressTracker 报告进度

        Args:
            tracker: 进度追踪器

        Returns:
            是否成功
        """
        report = tracker.get_report()

        # 转换步骤和 ETA
        completed_steps = None
        next_steps = None
        eta_seconds = None

        if report.step_progress:
            completed_steps = [f"Step {i + 1}" for i in range(report.step_progress.get("current", 0))]
            next_steps = [
                f"Step {i + 1}"
                for i in range(
                    report.step_progress.get("current", 0),
                    report.step_progress.get("total", 0),
                )
            ]

        if report.eta_ms:
            eta_seconds = int(report.eta_ms / 1000)

        return await self.report_progress(
            task_id=report.task_id,
            percentage=report.percentage,
            message=report.message,
            current_step=report.current_step,
            completed_steps=completed_steps,
            next_steps=next_steps,
            eta_seconds=eta_seconds,
            metadata=report.metadata,
        )

    # ========================================================================
    # 消息处理
    # ========================================================================

    def on_message(self, handler: Callable[[ANPMessage], None]) -> None:
        """注册消息处理器（用于发送消息到传输层）"""
        self._message_handler = handler

    def on_error(self, handler: Callable[[Exception], None]) -> None:
        """注册错误处理器"""
        self._error_handler = handler

    # ========================================================================
    # 内部方法
    # ========================================================================

    async def _sync_loop(self) -> None:
        """同步循环"""
        while self._running:
            try:
                await self._process_pending_updates()
                await asyncio.sleep(self.config.sync_interval_ms / 1000)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in sync loop: {e}")
                if self._error_handler:
                    self._error_handler(e)
                self._stats.last_error = str(e)
                await asyncio.sleep(self.config.retry_delay_ms / 1000)

    async def _process_pending_updates(self) -> None:
        """处理待发送的更新"""
        if not self._pending_updates:
            return

        async with self._lock:
            # 批量获取更新
            batch_size = min(len(self._pending_updates), self.config.max_batch_size)
            batch = [self._pending_updates.popleft() for _ in range(batch_size)]

        # 发送批量更新
        for update in batch:
            await self._send_progress_update(update)

    async def _send_progress_update(self, update: PendingProgressUpdate) -> None:
        """
        发送进度更新

        Args:
            update: 进度更新
        """
        start_time = time.time()

        try:
            # 创建 ANP 进度报告负载
            # 使用 message 作为 current_phase（如果没有 current_step）
            phase = update.current_step or update.message or "in_progress"

            payload = ProgressReportPayload(
                task_id=update.task_id,
                progress=int(update.percentage),
                current_phase=phase,
                completed_steps=update.completed_steps or [],
                next_steps=update.next_steps or [],
                eta_seconds=update.eta_seconds,
                blockers=update.blockers or [],
            )

            # 创建 ANP 消息
            options = CreateMessageOptions(
                type=ANPMessageType.PROGRESS_EVENT,
                target_did=self.target_did,
                correlation_id=f"progress-{update.task_id}-{int(time.time() * 1000)}",
                ttl=3600,  # 1 hour
            )

            message = create_anp_message(payload, self._private_key, options)

            # 通过消息处理器发送
            if self._message_handler:
                if asyncio.iscoroutinefunction(self._message_handler):
                    await self._message_handler(message)
                else:
                    self._message_handler(message)

            # 更新统计
            latency = (time.time() - start_time) * 1000
            self._stats.total_syncs += 1
            self._stats.successful_syncs += 1
            self._stats.average_latency_ms = (
                (self._stats.average_latency_ms * (self._stats.total_syncs - 1) + latency)
                / self._stats.total_syncs
            )
            self._stats.last_sync_time = datetime.now()

            logger.debug(f"Progress sent: {update.task_id} - {update.percentage}%")

        except Exception as e:
            self._stats.total_syncs += 1
            self._stats.failed_syncs += 1
            self._stats.last_error = str(e)
            logger.error(f"Failed to send progress: {e}")

            if self._error_handler:
                self._error_handler(e)

    async def _flush_pending_updates(self) -> None:
        """刷新所有待发送的更新"""
        while self._pending_updates:
            await self._process_pending_updates()

    # ========================================================================
    # 查询方法
    # ========================================================================

    def get_stats(self) -> ProgressSyncStats:
        """获取同步统计"""
        return self._stats

    def get_pending_count(self) -> int:
        """获取待发送更新数量"""
        return len(self._pending_updates)

    def get_state(self) -> ProgressSyncState:
        """获取当前状态"""
        return self._state


# ============================================================================
# ProgressReportReceiver - 接收来自 Automaton 的进度报告
# ============================================================================


class ProgressReportReceiver:
    """
    进度报告接收器
    接收来自 Automaton 的 ANP 进度报告消息并转换为本地格式
    """

    def __init__(
        self,
        aggregator: Optional[Any] = None,  # ProgressAggregator from progress_reporter
    ):
        """
        初始化进度报告接收器

        Args:
            aggregator: 进度聚合器（可选）
        """
        self._aggregator = aggregator
        self._trackers: Dict[str, ProgressTracker] = {}
        self._stats = ProgressSyncStats()
        self._running = False

    # ========================================================================
    # 生命周期管理
    # ========================================================================

    async def start(self) -> None:
        """启动接收器"""
        self._running = True
        logger.info("ProgressReportReceiver started")

    async def stop(self) -> None:
        """停止接收器"""
        self._running = False
        logger.info("ProgressReportReceiver stopped")

    # ========================================================================
    # 消息处理
    # ========================================================================

    async def handle_anp_message(self, message: ANPMessage) -> bool:
        """
        处理 ANP 进度报告消息

        Args:
            message: ANP 消息

        Returns:
            是否成功处理
        """
        if message.type != ANPMessageType.PROGRESS_EVENT:
            return False

        try:
            payload = message.object

            if not isinstance(payload, ProgressReportPayload):
                logger.warning(f"Invalid payload type: {type(payload)}")
                return False

            # 获取或创建追踪器
            tracker = self._get_or_create_tracker(payload.task_id)

            # 确保追踪器已启动
            if tracker.get_status() == ProgressStatus.NOT_STARTED:
                tracker.start()

            # 创建进度更新
            update = ProgressUpdate(
                percentage=float(payload.progress),
                current_step=payload.current_phase,
                message=f"Phase: {payload.current_phase}",
                elapsed_ms=None,  # 从消息中无法获取
                eta_ms=payload.eta_seconds * 1000 if payload.eta_seconds else None,
                metadata={
                    "completedSteps": payload.completed_steps,
                    "nextSteps": payload.next_steps,
                    "blockers": payload.blockers,
                },
            )

            # 更新追踪器
            tracker.update(update)

            # 更新统计
            self._stats.total_syncs += 1
            self._stats.successful_syncs += 1
            self._stats.last_sync_time = datetime.now()

            logger.debug(f"Progress received: {payload.task_id} - {payload.progress}%")
            return True

        except Exception as e:
            self._stats.total_syncs += 1
            self._stats.failed_syncs += 1
            self._stats.last_error = str(e)
            logger.error(f"Failed to handle progress message: {e}")
            return False

    # ========================================================================
    # 追踪器管理
    # ========================================================================

    def _get_or_create_tracker(self, task_id: str) -> ProgressTracker:
        """获取或创建追踪器"""
        if task_id not in self._trackers:
            tracker = ProgressTracker(task_id)
            # 自动启动追踪器
            tracker.start()
            self._trackers[task_id] = tracker

            # 如果有聚合器，添加到聚合器
            if self._aggregator:
                self._aggregator.create_tracker(task_id)

        return self._trackers[task_id]

    def get_tracker(self, task_id: str) -> Optional[ProgressTracker]:
        """获取追踪器"""
        return self._trackers.get(task_id)

    def remove_tracker(self, task_id: str) -> bool:
        """移除追踪器"""
        if task_id in self._trackers:
            del self._trackers[task_id]
            return True
        return False

    def get_all_trackers(self) -> Dict[str, ProgressTracker]:
        """获取所有追踪器"""
        return dict(self._trackers)

    # ========================================================================
    # 查询方法
    # ========================================================================

    def get_stats(self) -> ProgressSyncStats:
        """获取统计"""
        return self._stats


# ============================================================================
# 工厂函数
# ============================================================================


def create_progress_adapter(
    mode: str = "sender",
    config: Optional[ProgressSyncConfig] = None,
    private_key_pem: Optional[str] = None,
    did: str = NANOBOT_DID,
    target_did: str = AUTOMATON_DID,
    aggregator: Optional[Any] = None,
) -> Any:
    """
    创建进度适配器

    Args:
        mode: 模式 ("sender" 或 "receiver" 或 "both")
        config: 同步配置
        private_key_pem: 私钥 PEM 格式
        did: 本地 DID
        target_did: 目标 DID
        aggregator: 进度聚合器（用于 receiver）

    Returns:
        适配器实例
    """
    config = config or ProgressSyncConfig()

    if mode == "sender":
        return ProgressReportSender(config, private_key_pem, did, target_did)
    elif mode == "receiver":
        return ProgressReportReceiver(aggregator)
    elif mode == "both":
        return {
            "sender": ProgressReportSender(config, private_key_pem, did, target_did),
            "receiver": ProgressReportReceiver(aggregator),
        }
    else:
        raise ValueError(f"Invalid mode: {mode}")
