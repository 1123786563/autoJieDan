"""
进度报告系统
实现实时进度追踪、报告聚合和历史记录

@module nanobot.interagent.progress_reporter
@version 1.0.0
"""

import time
from typing import Optional, List, Dict, Any, Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from threading import RLock
from collections import deque


# ============================================================================
# 类型定义
# ============================================================================

class ProgressStatus(str, Enum):
    """进度状态"""
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class MilestoneStatus(str, Enum):
    """里程碑状态"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    SKIPPED = "skipped"


class ProgressEventType(str, Enum):
    """进度事件类型"""
    STARTED = "started"
    PROGRESS_UPDATE = "progress_update"
    MILESTONE_REACHED = "milestone_reached"
    MILESTONE_COMPLETED = "milestone_completed"
    PAUSED = "paused"
    RESUMED = "resumed"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    ETA_UPDATED = "eta_updated"


@dataclass
class ResourceUsage:
    """资源使用"""
    cpu_percent: Optional[float] = None
    memory_mb: Optional[float] = None
    network_bytes: Optional[int] = None
    tokens_used: Optional[int] = None
    api_calls: Optional[int] = None
    custom: Dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        result = {}
        if self.cpu_percent is not None:
            result["cpuPercent"] = self.cpu_percent
        if self.memory_mb is not None:
            result["memoryMb"] = self.memory_mb
        if self.network_bytes is not None:
            result["networkBytes"] = self.network_bytes
        if self.tokens_used is not None:
            result["tokensUsed"] = self.tokens_used
        if self.api_calls is not None:
            result["apiCalls"] = self.api_calls
        if self.custom:
            result["custom"] = self.custom
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ResourceUsage":
        return cls(
            cpu_percent=data.get("cpuPercent"),
            memory_mb=data.get("memoryMb"),
            network_bytes=data.get("networkBytes"),
            tokens_used=data.get("tokensUsed"),
            api_calls=data.get("apiCalls"),
            custom=data.get("custom", {}),
        )


@dataclass
class ProgressMilestone:
    """进度里程碑"""
    id: str
    name: str
    target_percentage: float
    status: MilestoneStatus = MilestoneStatus.PENDING
    description: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "targetPercentage": self.target_percentage,
            "status": self.status.value,
            "description": self.description,
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
            "metadata": self.metadata,
        }


@dataclass
class ProgressUpdate:
    """进度更新"""
    percentage: float
    message: Optional[str] = None
    current_step: Optional[str] = None
    total_steps: Optional[int] = None
    completed_steps: Optional[int] = None
    items_processed: Optional[int] = None
    total_items: Optional[int] = None
    elapsed_ms: Optional[float] = None
    eta_ms: Optional[float] = None
    resources: Optional[ResourceUsage] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ProgressEvent:
    """进度事件"""
    type: ProgressEventType
    task_id: str
    timestamp: datetime
    update: Optional[ProgressUpdate] = None
    milestone: Optional[ProgressMilestone] = None
    status: Optional[ProgressStatus] = None
    message: Optional[str] = None


@dataclass
class ProgressHistoryEntry:
    """进度历史记录"""
    task_id: str
    timestamp: datetime
    percentage: float
    status: ProgressStatus
    message: Optional[str] = None
    resources: Optional[ResourceUsage] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ProgressReport:
    """进度报告"""
    task_id: str
    status: ProgressStatus
    percentage: float
    message: Optional[str] = None
    current_step: Optional[str] = None
    step_progress: Optional[Dict[str, int]] = None
    item_progress: Optional[Dict[str, int]] = None
    started_at: Optional[datetime] = None
    updated_at: datetime = field(default_factory=datetime.now)
    elapsed_ms: float = 0
    eta_ms: Optional[float] = None
    estimated_total_ms: Optional[float] = None
    milestones: List[ProgressMilestone] = field(default_factory=list)
    resources: ResourceUsage = field(default_factory=ResourceUsage)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "taskId": self.task_id,
            "status": self.status.value,
            "percentage": self.percentage,
            "message": self.message,
            "currentStep": self.current_step,
            "stepProgress": self.step_progress,
            "itemProgress": self.item_progress,
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
            "elapsedMs": self.elapsed_ms,
            "etaMs": self.eta_ms,
            "estimatedTotalMs": self.estimated_total_ms,
            "milestones": [m.to_dict() for m in self.milestones],
            "resources": self.resources.to_dict(),
            "metadata": self.metadata,
        }


@dataclass
class ProgressTrackerConfig:
    """进度追踪器配置"""
    update_interval_ms: float = 1000
    max_history_entries: int = 1000
    auto_calculate_eta: bool = True
    eta_window_size: int = 10
    track_resources: bool = True


# ============================================================================
# 进度追踪器
# ============================================================================

class ProgressTracker:
    """
    进度追踪器
    追踪单个任务的实时进度
    """

    def __init__(
        self,
        task_id: str,
        config: Optional[ProgressTrackerConfig] = None
    ):
        self.task_id = task_id
        self.config = config or ProgressTrackerConfig()
        self._lock = RLock()

        self._status = ProgressStatus.NOT_STARTED
        self._percentage: float = 0
        self._message: Optional[str] = None
        self._current_step: Optional[str] = None
        self._step_progress: Optional[Dict[str, int]] = None
        self._item_progress: Optional[Dict[str, int]] = None
        self._started_at: Optional[datetime] = None
        self._updated_at = datetime.now()
        self._milestones: Dict[str, ProgressMilestone] = {}
        self._history: List[ProgressHistoryEntry] = []
        self._resources = ResourceUsage()
        self._metadata: Dict[str, Any] = {}
        self._eta_history: List[Dict[str, Any]] = []

        self._listeners: List[Callable[[ProgressEvent], None]] = []

    # ===========================================================================
    # 进度控制
    # ===========================================================================

    def start(self, initial_message: Optional[str] = None) -> None:
        """开始任务"""
        with self._lock:
            self._status = ProgressStatus.IN_PROGRESS
            self._started_at = datetime.now()
            self._updated_at = datetime.now()
            self._message = initial_message or "Task started"

            self._emit_event(ProgressEventType.STARTED, message=self._message)
            self._record_history()

    def update(self, update: ProgressUpdate) -> None:
        """更新进度"""
        with self._lock:
            if self._status != ProgressStatus.IN_PROGRESS:
                return

            now = datetime.now()
            self._updated_at = now

            # 更新百分比
            if update.percentage is not None:
                self._percentage = max(0, min(100, update.percentage))

            # 更新消息
            if update.message is not None:
                self._message = update.message

            # 更新步骤
            if update.current_step is not None:
                self._current_step = update.current_step

            if update.total_steps is not None and update.completed_steps is not None:
                self._step_progress = {
                    "current": update.completed_steps,
                    "total": update.total_steps,
                }

            # 更新项目进度
            if update.items_processed is not None and update.total_items is not None:
                self._item_progress = {
                    "processed": update.items_processed,
                    "total": update.total_items,
                }

            # 更新资源使用
            if update.resources:
                if self._resources is None:
                    self._resources = update.resources
                else:
                    # 合并资源
                    for key, value in update.resources.__dict__.items():
                        if value is not None:
                            setattr(self._resources, key, value)

            # 更新元数据
            if update.metadata:
                self._metadata.update(update.metadata)

            # 计算 ETA
            eta_ms = None
            if self.config.auto_calculate_eta:
                eta_ms = self._calculate_eta()

            self._emit_event(
                ProgressEventType.PROGRESS_UPDATE,
                update=ProgressUpdate(
                    percentage=self._percentage,
                    message=self._message,
                    current_step=self._current_step,
                    elapsed_ms=self._get_elapsed_ms(),
                    eta_ms=eta_ms,
                    metadata=self._metadata,
                )
            )

            # 检查里程碑
            self._check_milestones()
            self._record_history()

    def set_milestones(
        self,
        milestones: List[Dict[str, Any]]
    ) -> None:
        """设置里程碑"""
        with self._lock:
            for i, m in enumerate(milestones):
                milestone = ProgressMilestone(
                    id=m.get("id", f"milestone-{i + 1}"),
                    name=m["name"],
                    target_percentage=m["targetPercentage"],
                    description=m.get("description"),
                    status=MilestoneStatus.PENDING,
                    metadata=m.get("metadata", {}),
                )
                self._milestones[milestone.id] = milestone

    def complete_milestone(self, milestone_id: str) -> bool:
        """完成里程碑"""
        with self._lock:
            milestone = self._milestones.get(milestone_id)
            if not milestone:
                return False

            milestone.status = MilestoneStatus.COMPLETED
            milestone.completed_at = datetime.now()

            self._emit_event(
                ProgressEventType.MILESTONE_COMPLETED,
                milestone=milestone
            )
            return True

    def _check_milestones(self) -> None:
        """检查并触发里程碑"""
        for milestone in self._milestones.values():
            if (
                milestone.status == MilestoneStatus.PENDING
                and self._percentage >= milestone.target_percentage
            ):
                milestone.status = MilestoneStatus.IN_PROGRESS
                milestone.started_at = datetime.now()
                milestone.status = MilestoneStatus.COMPLETED
                milestone.completed_at = datetime.now()

                self._emit_event(
                    ProgressEventType.MILESTONE_REACHED,
                    milestone=milestone
                )
                self._emit_event(
                    ProgressEventType.MILESTONE_COMPLETED,
                    milestone=milestone
                )

    def pause(self, reason: Optional[str] = None) -> None:
        """暂停任务"""
        with self._lock:
            if self._status != ProgressStatus.IN_PROGRESS:
                return

            self._status = ProgressStatus.PAUSED
            self._message = reason or "Task paused"

            self._emit_event(ProgressEventType.PAUSED, message=self._message)
            self._record_history()

    def resume(self) -> None:
        """恢复任务"""
        with self._lock:
            if self._status != ProgressStatus.PAUSED:
                return

            self._status = ProgressStatus.IN_PROGRESS
            self._message = "Task resumed"

            self._emit_event(ProgressEventType.RESUMED, message=self._message)

    def complete(self, final_message: Optional[str] = None) -> None:
        """完成任务"""
        with self._lock:
            self._status = ProgressStatus.COMPLETED
            self._percentage = 100
            self._message = final_message or "Task completed successfully"
            self._updated_at = datetime.now()

            self._emit_event(ProgressEventType.COMPLETED, message=self._message)
            self._record_history()

    def fail(self, error: str) -> None:
        """失败任务"""
        with self._lock:
            self._status = ProgressStatus.FAILED
            self._message = error
            self._updated_at = datetime.now()

            self._emit_event(ProgressEventType.FAILED, message=error)
            self._record_history()

    def cancel(self, reason: Optional[str] = None) -> None:
        """取消任务"""
        with self._lock:
            self._status = ProgressStatus.CANCELLED
            self._message = reason or "Task cancelled"
            self._updated_at = datetime.now()

            self._emit_event(ProgressEventType.CANCELLED, message=self._message)
            self._record_history()

    # ===========================================================================
    # 事件监听
    # ===========================================================================

    def on(self, listener: Callable[[ProgressEvent], None]) -> None:
        """添加事件监听器"""
        self._listeners.append(listener)

    def off(self, listener: Callable[[ProgressEvent], None]) -> None:
        """移除事件监听器"""
        if listener in self._listeners:
            self._listeners.remove(listener)

    def _emit_event(
        self,
        event_type: ProgressEventType,
        update: Optional[ProgressUpdate] = None,
        milestone: Optional[ProgressMilestone] = None,
        status: Optional[ProgressStatus] = None,
        message: Optional[str] = None,
    ) -> None:
        """发射事件"""
        event = ProgressEvent(
            type=event_type,
            task_id=self.task_id,
            timestamp=datetime.now(),
            update=update,
            milestone=milestone,
            status=status or self._status,
            message=message,
        )

        for listener in self._listeners:
            try:
                listener(event)
            except Exception:
                pass

    # ===========================================================================
    # 查询方法
    # ===========================================================================

    def get_report(self) -> ProgressReport:
        """获取当前报告"""
        with self._lock:
            return ProgressReport(
                task_id=self.task_id,
                status=self._status,
                percentage=self._percentage,
                message=self._message,
                current_step=self._current_step,
                step_progress=self._step_progress,
                item_progress=self._item_progress,
                started_at=self._started_at,
                updated_at=self._updated_at,
                elapsed_ms=self._get_elapsed_ms(),
                eta_ms=self._calculate_eta(),
                estimated_total_ms=self._calculate_estimated_total(),
                milestones=list(self._milestones.values()),
                resources=self._resources,
                metadata=self._metadata,
            )

    def get_history(self, limit: Optional[int] = None) -> List[ProgressHistoryEntry]:
        """获取历史记录"""
        with self._lock:
            entries = list(self._history)
            if limit:
                return entries[-limit:]
            return entries

    def get_status(self) -> ProgressStatus:
        """获取状态"""
        return self._status

    def get_percentage(self) -> float:
        """获取百分比"""
        return self._percentage

    def is_completed(self) -> bool:
        """是否已完成"""
        return self._status == ProgressStatus.COMPLETED

    def is_failed(self) -> bool:
        """是否失败"""
        return self._status == ProgressStatus.FAILED

    def is_terminal(self) -> bool:
        """是否终止状态"""
        return self._status in [
            ProgressStatus.COMPLETED,
            ProgressStatus.FAILED,
            ProgressStatus.CANCELLED,
        ]

    # ===========================================================================
    # 内部方法
    # ===========================================================================

    def _get_elapsed_ms(self) -> float:
        """获取已用时间（毫秒）"""
        if not self._started_at:
            return 0
        return (datetime.now() - self._started_at).total_seconds() * 1000

    def _calculate_eta(self) -> Optional[float]:
        """计算预计剩余时间"""
        if self._percentage <= 0 or self._percentage >= 100:
            return None

        # 记录历史点用于 ETA 计算
        self._eta_history.append({
            "percentage": self._percentage,
            "timestamp": datetime.now(),
        })

        # 限制历史窗口大小
        if len(self._eta_history) > self.config.eta_window_size:
            self._eta_history = self._eta_history[-self.config.eta_window_size:]

        if len(self._eta_history) < 2:
            return None

        # 计算进度速率
        first = self._eta_history[0]
        last = self._eta_history[-1]

        percentage_delta = last["percentage"] - first["percentage"]
        time_delta_ms = (
            last["timestamp"] - first["timestamp"]
        ).total_seconds() * 1000

        if percentage_delta <= 0 or time_delta_ms <= 0:
            return None

        # 计算剩余百分比需要的预估时间
        remaining_percentage = 100 - self._percentage
        rate = percentage_delta / time_delta_ms
        eta_ms = remaining_percentage / rate

        return round(eta_ms)

    def _calculate_estimated_total(self) -> Optional[float]:
        """计算预计总时间"""
        eta_ms = self._calculate_eta()
        if eta_ms is None:
            return None
        return self._get_elapsed_ms() + eta_ms

    def _record_history(self) -> None:
        """记录历史"""
        entry = ProgressHistoryEntry(
            task_id=self.task_id,
            timestamp=datetime.now(),
            percentage=self._percentage,
            status=self._status,
            message=self._message,
            resources=ResourceUsage(**self._resources.__dict__) if self.config.track_resources and self._resources else None,
            metadata=dict(self._metadata),
        )

        self._history.append(entry)

        # 限制历史记录大小
        if len(self._history) > self.config.max_history_entries:
            self._history = self._history[-self.config.max_history_entries:]


# ============================================================================
# 进度报告聚合器
# ============================================================================

class ProgressAggregator:
    """
    进度报告聚合器
    聚合多个任务的进度报告
    """

    def __init__(self, config: Optional[ProgressTrackerConfig] = None):
        self.config = config or ProgressTrackerConfig()
        self._trackers: Dict[str, ProgressTracker] = {}
        self._global_history: deque = deque(maxlen=10000)
        self._listeners: List[Callable[[ProgressEvent], None]] = []

    def create_tracker(self, task_id: str) -> ProgressTracker:
        """创建追踪器"""
        if task_id in self._trackers:
            return self._trackers[task_id]

        tracker = ProgressTracker(task_id, self.config)

        # 转发事件
        def forward_event(event: ProgressEvent) -> None:
            for listener in self._listeners:
                try:
                    listener(event)
                except Exception:
                    pass

        tracker.on(forward_event)

        self._trackers[task_id] = tracker
        return tracker

    def get_tracker(self, task_id: str) -> Optional[ProgressTracker]:
        """获取追踪器"""
        return self._trackers.get(task_id)

    def remove_tracker(self, task_id: str) -> bool:
        """移除追踪器"""
        if task_id in self._trackers:
            del self._trackers[task_id]
            return True
        return False

    def get_all_trackers(self) -> List[ProgressTracker]:
        """获取所有追踪器"""
        return list(self._trackers.values())

    def get_task_report(self, task_id: str) -> Optional[ProgressReport]:
        """获取单个任务报告"""
        tracker = self._trackers.get(task_id)
        if tracker:
            return tracker.get_report()
        return None

    def get_all_reports(self) -> List[ProgressReport]:
        """获取所有任务报告"""
        return [t.get_report() for t in self._trackers.values()]

    def get_aggregated_report(
        self,
        filter_status: Optional[List[ProgressStatus]] = None
    ) -> Dict[str, Any]:
        """获取聚合报告"""
        reports = self.get_all_reports()

        # 状态过滤
        if filter_status:
            reports = [r for r in reports if r.status in filter_status]

        # 计算统计数据
        by_status: Dict[str, int] = {s.value: 0 for s in ProgressStatus}
        total_completion = 0
        total_duration = 0
        duration_count = 0

        total_resources = {
            "cpuPercent": 0,
            "memoryMb": 0,
            "networkBytes": 0,
            "tokensUsed": 0,
            "apiCalls": 0,
        }

        for report in reports:
            by_status[report.status.value] += 1
            total_completion += report.percentage

            if report.elapsed_ms > 0:
                total_duration += report.elapsed_ms
                duration_count += 1

            # 聚合资源使用
            if report.resources:
                if report.resources.cpu_percent:
                    total_resources["cpuPercent"] += report.resources.cpu_percent
                if report.resources.memory_mb:
                    total_resources["memoryMb"] += report.resources.memory_mb
                if report.resources.network_bytes:
                    total_resources["networkBytes"] += report.resources.network_bytes
                if report.resources.tokens_used:
                    total_resources["tokensUsed"] += report.resources.tokens_used
                if report.resources.api_calls:
                    total_resources["apiCalls"] += report.resources.api_calls

        now = datetime.now()
        return {
            "generatedAt": now.isoformat(),
            "timeRange": {
                "from": (datetime.now().replace(hour=0, minute=0, second=0)).isoformat(),
                "to": now.isoformat(),
            },
            "totalTasks": len(reports),
            "byStatus": by_status,
            "averageCompletion": total_completion / len(reports) if reports else 0,
            "averageDurationMs": total_duration / duration_count if duration_count else 0,
            "totalResources": total_resources,
            "tasks": [r.to_dict() for r in reports],
        }

    def get_in_progress_tasks(self) -> List[ProgressReport]:
        """获取进行中的任务"""
        return [
            r for r in self.get_all_reports()
            if r.status == ProgressStatus.IN_PROGRESS
        ]

    def get_recently_completed(self, limit: int = 10) -> List[ProgressReport]:
        """获取最近完成的任务"""
        completed = [
            r for r in self.get_all_reports()
            if r.status == ProgressStatus.COMPLETED
        ]
        return sorted(
            completed,
            key=lambda r: r.updated_at,
            reverse=True
        )[:limit]

    def get_failed_tasks(self) -> List[ProgressReport]:
        """获取失败的任务"""
        return [
            r for r in self.get_all_reports()
            if r.status == ProgressStatus.FAILED
        ]

    def on(self, listener: Callable[[ProgressEvent], None]) -> None:
        """添加事件监听器"""
        self._listeners.append(listener)

    def cleanup_completed(self) -> int:
        """清理已完成的追踪器"""
        cleaned = 0
        to_remove = []

        for task_id, tracker in self._trackers.items():
            if tracker.is_terminal():
                # 保存到全局历史
                report = tracker.get_report()
                self._global_history.append({
                    "taskId": task_id,
                    "timestamp": datetime.now().isoformat(),
                    "percentage": report.percentage,
                    "status": report.status.value,
                    "message": report.message,
                })
                to_remove.append(task_id)

        for task_id in to_remove:
            self.remove_tracker(task_id)
            cleaned += 1

        return cleaned

    def clear(self) -> None:
        """清空所有追踪器"""
        self._trackers.clear()


# ============================================================================
# 工厂函数
# ============================================================================

def create_progress_tracker(
    task_id: str,
    config: Optional[ProgressTrackerConfig] = None
) -> ProgressTracker:
    """创建进度追踪器"""
    return ProgressTracker(task_id, config)


def create_progress_aggregator(
    config: Optional[ProgressTrackerConfig] = None
) -> ProgressAggregator:
    """创建进度聚合器"""
    return ProgressAggregator(config)


# ============================================================================
# 格式化函数
# ============================================================================

def format_progress_status(status: ProgressStatus) -> str:
    """格式化进度状态"""
    status_map = {
        ProgressStatus.NOT_STARTED: "未开始",
        ProgressStatus.IN_PROGRESS: "进行中",
        ProgressStatus.PAUSED: "已暂停",
        ProgressStatus.COMPLETED: "已完成",
        ProgressStatus.FAILED: "已失败",
        ProgressStatus.CANCELLED: "已取消",
    }
    return status_map.get(status, status.value)


def format_duration(ms: float) -> str:
    """格式化持续时间"""
    if ms < 1000:
        return f"{ms:.0f}ms"
    if ms < 60000:
        return f"{ms / 1000:.1f}s"
    if ms < 3600000:
        minutes = int(ms / 60000)
        seconds = round((ms % 60000) / 1000)
        return f"{minutes}m {seconds}s"
    hours = int(ms / 3600000)
    minutes = round((ms % 3600000) / 60000)
    return f"{hours}h {minutes}m"


def format_progress_bar(
    percentage: float,
    width: int = 20,
    filled: str = "█",
    empty: str = "░"
) -> str:
    """格式化进度条"""
    filled_count = round((percentage / 100) * width)
    empty_count = width - filled_count
    return filled * filled_count + empty * empty_count


def format_progress_report(report: ProgressReport) -> str:
    """格式化完整进度报告"""
    lines = [
        f"Task: {report.task_id}",
        f"Status: {format_progress_status(report.status)}",
        f"Progress: {report.percentage:.1f}% {format_progress_bar(report.percentage)}",
    ]

    if report.message:
        lines.append(f"Message: {report.message}")

    if report.current_step:
        lines.append(f"Current Step: {report.current_step}")

    if report.step_progress:
        lines.append(f"Steps: {report.step_progress['current']}/{report.step_progress['total']}")

    if report.item_progress:
        lines.append(f"Items: {report.item_progress['processed']}/{report.item_progress['total']}")

    lines.append(f"Elapsed: {format_duration(report.elapsed_ms)}")

    if report.eta_ms:
        lines.append(f"ETA: {format_duration(report.eta_ms)}")

    if report.resources and report.resources.tokens_used:
        lines.append(f"Tokens: {report.resources.tokens_used:,}")

    if report.resources and report.resources.api_calls:
        lines.append(f"API Calls: {report.resources.api_calls}")

    return "\n".join(lines)
