"""
进度报告生成模块
用于生成和发送进度报告

@module nanobot.interagent.reporter
@version 1.0.0
"""

import asyncio
import time
from typing import Optional, List, Dict, Any, Callable
from dataclasses import dataclass, field
from datetime import datetime
import aiohttp

from .progress import ProgressTracker, ProgressSnapshot


# ============================================================================
# 类型定义
# ============================================================================

@dataclass
class ReporterConfig:
    """报告器配置"""
    automaton_url: str
    report_interval: float = 10.0  # 报告间隔 (秒)
    min_change_threshold: float = 1.0  # 最小变化阈值 (百分比)
    timeout: float = 10.0  # HTTP 超时 (秒)
    max_retries: int = 3  # 最大重试次数


@dataclass
class ProgressReport:
    """进度报告"""
    task_id: str
    percentage: float
    current_step: str
    elapsed_seconds: float
    estimated_remaining_seconds: Optional[float]
    completed_milestones: int
    total_milestones: int
    timestamp: datetime = field(default_factory=datetime.now)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "taskId": self.task_id,
            "percentage": self.percentage,
            "currentStep": self.current_step,
            "elapsedSeconds": self.elapsed_seconds,
            "estimatedRemainingSeconds": self.estimated_remaining_seconds,
            "completedMilestones": self.completed_milestones,
            "totalMilestones": self.total_milestones,
            "timestamp": self.timestamp.isoformat(),
            "metadata": self.metadata,
        }

    @classmethod
    def from_snapshot(cls, snapshot: ProgressSnapshot, task_id: str) -> "ProgressReport":
        """从快照创建报告"""
        return cls(
            task_id=task_id,
            percentage=snapshot.percentage,
            current_step=snapshot.current_step,
            elapsed_seconds=snapshot.elapsed_seconds,
            estimated_remaining_seconds=snapshot.estimated_remaining_seconds,
            completed_milestones=snapshot.completed_milestones,
            total_milestones=snapshot.total_milestones,
            timestamp=snapshot.timestamp,
        )


@dataclass
class ReporterStats:
    """报告器统计"""
    total_reports: int = 0
    successful_reports: int = 0
    failed_reports: int = 0
    last_report_time: Optional[float] = None
    last_error: Optional[str] = None


# ============================================================================
# 进度报告器
# ============================================================================

class ProgressReporter:
    """
    进度报告器
    定期向 Automaton 发送进度更新
    """

    def __init__(
        self,
        config: ReporterConfig,
        tracker: ProgressTracker,
    ):
        """
        初始化报告器

        Args:
            config: 配置
            tracker: 进度追踪器
        """
        self.config = config
        self.tracker = tracker

        self._running = False
        self._report_task: Optional[asyncio.Task] = None
        self._session: Optional[aiohttp.ClientSession] = None
        self._last_reported_percentage: float = 0
        self._report_history: List[ProgressReport] = []
        self.stats = ReporterStats()

    async def start(self) -> None:
        """启动报告器"""
        if self._running:
            return

        self._running = True
        self._session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=self.config.timeout)
        )
        self._report_task = asyncio.create_task(self._report_loop())

    async def stop(self) -> None:
        """停止报告器"""
        self._running = False

        if self._report_task:
            self._report_task.cancel()
            try:
                await self._report_task
            except asyncio.CancelledError:
                pass
            self._report_task = None

        # 发送最终报告
        await self.send_report(force=True)

        if self._session:
            await self._session.close()
            self._session = None

    # =========================================================================
    # 报告方法
    # =========================================================================

    async def send_report(self, force: bool = False) -> Optional[ProgressReport]:
        """
        发送进度报告

        Args:
            force: 是否强制发送（忽略变化阈值）

        Returns:
            发送的报告或 None
        """
        if not self._session:
            return None

        snapshot = self.tracker.get_snapshot()

        # 检查变化阈值
        if not force:
            change = abs(snapshot.percentage - self._last_reported_percentage)
            if change < self.config.min_change_threshold:
                return None

        report = ProgressReport.from_snapshot(snapshot, self.tracker.task_id)
        url = f"{self.config.automaton_url}/api/tasks/{self.tracker.task_id}/progress"

        self.stats.total_reports += 1

        for attempt in range(self.config.max_retries):
            try:
                async with self._session.post(url, json=report.to_dict()) as response:
                    if response.status == 200:
                        self.stats.successful_reports += 1
                        self.stats.last_report_time = time.time()
                        self._last_reported_percentage = snapshot.percentage
                        self._report_history.append(report)
                        return report
                    else:
                        raise Exception(f"HTTP {response.status}")

            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.stats.last_error = str(e)
                if attempt == self.config.max_retries - 1:
                    self.stats.failed_reports += 1
                    return None
                await asyncio.sleep(1)

        return None

    async def send_milestone_report(
        self,
        milestone_id: str,
        status: str,
        message: Optional[str] = None,
    ) -> bool:
        """
        发送里程碑报告

        Args:
            milestone_id: 里程碑 ID
            status: 状态
            message: 消息

        Returns:
            是否成功
        """
        if not self._session:
            return False

        url = f"{self.config.automaton_url}/api/tasks/{self.tracker.task_id}/milestones"

        try:
            async with self._session.post(url, json={
                "milestoneId": milestone_id,
                "status": status,
                "message": message,
            }) as response:
                return response.status == 200
        except Exception:
            return False

    # =========================================================================
    # 查询方法
    # =========================================================================

    def get_report_history(self, limit: Optional[int] = None) -> List[ProgressReport]:
        """
        获取报告历史

        Args:
            limit: 限制数量

        Returns:
            报告列表
        """
        if limit:
            return self._report_history[-limit:]
        return self._report_history.copy()

    def get_last_report(self) -> Optional[ProgressReport]:
        """获取最后的报告"""
        return self._report_history[-1] if self._report_history else None

    def get_stats(self) -> ReporterStats:
        """获取统计信息"""
        return self.stats

    # =========================================================================
    # 内部方法
    # =========================================================================

    async def _report_loop(self) -> None:
        """报告循环"""
        while self._running:
            try:
                await self.send_report()
                await asyncio.sleep(self.config.report_interval)
            except asyncio.CancelledError:
                break
            except Exception:
                await asyncio.sleep(1)


# ============================================================================
# 进度监听器
# ============================================================================

class ProgressListener:
    """
    进度监听器
    监听进度变化并触发回调
    """

    def __init__(
        self,
        tracker: ProgressTracker,
        on_change: Optional[Callable[[ProgressSnapshot], None]] = None,
        on_milestone: Optional[Callable[[str, str], None]] = None,
        threshold: float = 5.0,
    ):
        """
        初始化监听器

        Args:
            tracker: 进度追踪器
            on_change: 进度变化回调
            on_milestone: 里程碑变化回调
            threshold: 变化阈值
        """
        self.tracker = tracker
        self.on_change = on_change
        self.on_milestone = on_milestone
        self.threshold = threshold

        self._last_percentage: float = 0
        self._last_milestone_count: int = 0

    def check(self) -> Optional[ProgressSnapshot]:
        """
        检查进度变化

        Returns:
            如果有变化返回快照，否则返回 None
        """
        snapshot = self.tracker.get_snapshot()

        # 检查进度变化
        if abs(snapshot.percentage - self._last_percentage) >= self.threshold:
            self._last_percentage = snapshot.percentage
            if self.on_change:
                self.on_change(snapshot)
            return snapshot

        # 检查里程碑变化
        if snapshot.completed_milestones != self._last_milestone_count:
            self._last_milestone_count = snapshot.completed_milestones
            if self.on_milestone:
                milestone_status = "completed"
                self.on_milestone(str(snapshot.completed_milestones), milestone_status)

        return None


# ============================================================================
# 工具函数
# ============================================================================

def create_summary_report(tracker: ProgressTracker) -> Dict[str, Any]:
    """
    创建摘要报告

    Args:
        tracker: 进度追踪器

    Returns:
        摘要字典
    """
    snapshot = tracker.get_snapshot()
    milestone_progress = tracker.get_milestone_progress()

    return {
        "taskId": tracker.task_id,
        "status": "completed" if tracker.completed_at else "in_progress",
        "progress": {
            "percentage": snapshot.percentage,
            "currentStep": snapshot.current_step,
            "elapsedSeconds": snapshot.elapsed_seconds,
            "estimatedRemainingSeconds": snapshot.estimated_remaining_seconds,
        },
        "milestones": {
            "completed": milestone_progress["completed"],
            "total": milestone_progress["total"],
            "percentage": milestone_progress["percentage"],
        },
        "timing": {
            "startedAt": tracker.started_at.isoformat() if tracker.started_at else None,
            "completedAt": tracker.completed_at.isoformat() if tracker.completed_at else None,
        },
    }


def format_report_message(report: ProgressReport) -> str:
    """
    格式化报告消息

    Args:
        report: 进度报告

    Returns:
        格式化消息
    """
    lines = [
        f"Task: {report.task_id}",
        f"Progress: {report.percentage:.1f}%",
        f"Current: {report.current_step}",
        f"Elapsed: {report.elapsed_seconds:.1f}s",
    ]

    if report.estimated_remaining_seconds is not None:
        lines.append(f"Remaining: ~{report.estimated_remaining_seconds:.0f}s")

    if report.total_milestones > 0:
        lines.append(f"Milestones: {report.completed_milestones}/{report.total_milestones}")

    return "\n".join(lines)
