"""
进度追踪模块
用于追踪任务执行进度

@module nanobot.interagent.progress
@version 1.0.0
"""

import time
from typing import Optional, List, Dict, Any, Callable
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime


# ============================================================================
# 类型定义
# ============================================================================

class MilestoneStatus(str, Enum):
    """里程碑状态"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    SKIPPED = "skipped"
    FAILED = "failed"


@dataclass
class Milestone:
    """里程碑"""
    id: str
    name: str
    weight: float = 1.0  # 权重 (用于计算总进度)
    status: MilestoneStatus = MilestoneStatus.PENDING
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "id": self.id,
            "name": self.name,
            "weight": self.weight,
            "status": self.status.value,
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
            "error": self.error,
            "metadata": self.metadata,
        }


@dataclass
class ProgressSnapshot:
    """进度快照"""
    percentage: float
    current_step: str
    completed_milestones: int
    total_milestones: int
    elapsed_seconds: float
    estimated_remaining_seconds: Optional[float]
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "percentage": self.percentage,
            "currentStep": self.current_step,
            "completedMilestones": self.completed_milestones,
            "totalMilestones": self.total_milestones,
            "elapsedSeconds": self.elapsed_seconds,
            "estimatedRemainingSeconds": self.estimated_remaining_seconds,
            "timestamp": self.timestamp.isoformat(),
        }


# ============================================================================
# 进度追踪器
# ============================================================================

class ProgressTracker:
    """
    进度追踪器
    追踪任务执行的进度
    """

    def __init__(
        self,
        task_id: str,
        total_steps: int = 100,
        on_update: Optional[Callable[[ProgressSnapshot], None]] = None,
    ):
        """
        初始化进度追踪器

        Args:
            task_id: 任务 ID
            total_steps: 总步数
            on_update: 进度更新回调
        """
        self.task_id = task_id
        self.total_steps = total_steps
        self.on_update = on_update

        self.current_step = 0
        self.current_message = ""
        self.milestones: Dict[str, Milestone] = {}
        self.milestone_order: List[str] = []

        self.started_at: Optional[datetime] = None
        self.completed_at: Optional[datetime] = None

        self._step_history: List[Dict[str, Any]] = []

    # =========================================================================
    # 生命周期
    # =========================================================================

    def start(self, message: str = "Task started") -> None:
        """开始追踪"""
        self.started_at = datetime.now()
        self.current_message = message
        self._record_step("start", message)

    def complete(self, message: str = "Task completed") -> None:
        """完成追踪"""
        self.current_step = self.total_steps
        self.completed_at = datetime.now()
        self.current_message = message
        self._record_step("complete", message)
        self._notify_update()

    def fail(self, error: str) -> None:
        """失败"""
        self.completed_at = datetime.now()
        self.current_message = f"Failed: {error}"
        self._record_step("fail", error)

    # =========================================================================
    # 进度操作
    # =========================================================================

    def set_progress(self, step: int, message: Optional[str] = None) -> None:
        """
        设置进度

        Args:
            step: 当前步数
            message: 消息
        """
        self.current_step = min(max(step, 0), self.total_steps)
        if message:
            self.current_message = message
        self._record_step("progress", message or f"Step {step}")
        self._notify_update()

    def advance(self, steps: int = 1, message: Optional[str] = None) -> None:
        """
        前进

        Args:
            steps: 步数
            message: 消息
        """
        self.set_progress(self.current_step + steps, message)

    def set_percentage(self, percentage: float, message: Optional[str] = None) -> None:
        """
        设置百分比

        Args:
            percentage: 百分比 (0-100)
            message: 消息
        """
        step = int(percentage / 100 * self.total_steps)
        self.set_progress(step, message)

    # =========================================================================
    # 里程碑操作
    # =========================================================================

    def add_milestone(
        self,
        milestone_id: str,
        name: str,
        weight: float = 1.0,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Milestone:
        """
        添加里程碑

        Args:
            milestone_id: 里程碑 ID
            name: 名称
            weight: 权重
            metadata: 元数据

        Returns:
            里程碑
        """
        milestone = Milestone(
            id=milestone_id,
            name=name,
            weight=weight,
            metadata=metadata or {},
        )
        self.milestones[milestone_id] = milestone
        self.milestone_order.append(milestone_id)
        return milestone

    def start_milestone(self, milestone_id: str) -> Optional[Milestone]:
        """
        开始里程碑

        Args:
            milestone_id: 里程碑 ID

        Returns:
            里程碑或 None
        """
        milestone = self.milestones.get(milestone_id)
        if not milestone:
            return None

        milestone.status = MilestoneStatus.IN_PROGRESS
        milestone.started_at = datetime.now()

        self.current_message = f"Starting: {milestone.name}"
        self._update_progress_from_milestones()
        self._notify_update()

        return milestone

    def complete_milestone(
        self,
        milestone_id: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[Milestone]:
        """
        完成里程碑

        Args:
            milestone_id: 里程碑 ID
            metadata: 元数据

        Returns:
            里程碑或 None
        """
        milestone = self.milestones.get(milestone_id)
        if not milestone:
            return None

        milestone.status = MilestoneStatus.COMPLETED
        milestone.completed_at = datetime.now()

        if metadata:
            milestone.metadata.update(metadata)

        self.current_message = f"Completed: {milestone.name}"
        self._update_progress_from_milestones()
        self._notify_update()

        return milestone

    def skip_milestone(self, milestone_id: str, reason: str = "") -> Optional[Milestone]:
        """
        跳过里程碑

        Args:
            milestone_id: 里程碑 ID
            reason: 原因

        Returns:
            里程碑或 None
        """
        milestone = self.milestones.get(milestone_id)
        if not milestone:
            return None

        milestone.status = MilestoneStatus.SKIPPED
        milestone.completed_at = datetime.now()
        milestone.error = reason

        self._update_progress_from_milestones()
        self._notify_update()

        return milestone

    def fail_milestone(self, milestone_id: str, error: str) -> Optional[Milestone]:
        """
        失败里程碑

        Args:
            milestone_id: 里程碑 ID
            error: 错误

        Returns:
            里程碑或 None
        """
        milestone = self.milestones.get(milestone_id)
        if not milestone:
            return None

        milestone.status = MilestoneStatus.FAILED
        milestone.completed_at = datetime.now()
        milestone.error = error

        self._update_progress_from_milestones()
        self._notify_update()

        return milestone

    # =========================================================================
    # 查询方法
    # =========================================================================

    def get_percentage(self) -> float:
        """获取当前百分比"""
        return (self.current_step / self.total_steps) * 100

    def get_elapsed_seconds(self) -> float:
        """获取已用时间（秒）"""
        if not self.started_at:
            return 0
        end = self.completed_at or datetime.now()
        return (end - self.started_at).total_seconds()

    def get_estimated_remaining_seconds(self) -> Optional[float]:
        """
        获取预计剩余时间（秒）

        Returns:
            预计剩余时间，如果无法估算则返回 None
        """
        if self.current_step <= 0:
            return None

        elapsed = self.get_elapsed_seconds()
        if elapsed <= 0:
            return None

        # 基于当前进度估算
        remaining_steps = self.total_steps - self.current_step
        if remaining_steps <= 0:
            return 0

        rate = self.current_step / elapsed  # steps per second
        if rate <= 0:
            return None

        return remaining_steps / rate

    def get_snapshot(self) -> ProgressSnapshot:
        """获取进度快照"""
        completed = sum(
            1 for m in self.milestones.values()
            if m.status == MilestoneStatus.COMPLETED
        )

        return ProgressSnapshot(
            percentage=self.get_percentage(),
            current_step=self.current_message,
            completed_milestones=completed,
            total_milestones=len(self.milestones),
            elapsed_seconds=self.get_elapsed_seconds(),
            estimated_remaining_seconds=self.get_estimated_remaining_seconds(),
        )

    def get_milestone_progress(self) -> Dict[str, Any]:
        """获取里程碑进度"""
        total_weight = sum(m.weight for m in self.milestones.values())
        if total_weight == 0:
            return {"completed": 0, "total": len(self.milestones), "percentage": 0}

        completed_weight = sum(
            m.weight for m in self.milestones.values()
            if m.status == MilestoneStatus.COMPLETED
        )

        return {
            "completed": sum(1 for m in self.milestones.values() if m.status == MilestoneStatus.COMPLETED),
            "total": len(self.milestones),
            "percentage": (completed_weight / total_weight) * 100,
        }

    def get_step_history(self) -> List[Dict[str, Any]]:
        """获取步骤历史"""
        return self._step_history.copy()

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "taskId": self.task_id,
            "totalSteps": self.total_steps,
            "currentStep": self.current_step,
            "currentMessage": self.current_message,
            "percentage": self.get_percentage(),
            "elapsedSeconds": self.get_elapsed_seconds(),
            "estimatedRemainingSeconds": self.get_estimated_remaining_seconds(),
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
            "milestones": {k: v.to_dict() for k, v in self.milestones.items()},
        }

    # =========================================================================
    # 内部方法
    # =========================================================================

    def _update_progress_from_milestones(self) -> None:
        """基于里程碑更新进度"""
        if not self.milestones:
            return

        total_weight = sum(m.weight for m in self.milestones.values())
        if total_weight == 0:
            return

        completed_weight = sum(
            m.weight for m in self.milestones.values()
            if m.status == MilestoneStatus.COMPLETED
        )

        # 基于里程碑完成情况更新步数
        percentage = (completed_weight / total_weight) * 100
        self.current_step = int(percentage / 100 * self.total_steps)

    def _record_step(self, action: str, message: str) -> None:
        """记录步骤"""
        self._step_history.append({
            "timestamp": datetime.now().isoformat(),
            "action": action,
            "step": self.current_step,
            "percentage": self.get_percentage(),
            "message": message,
        })

    def _notify_update(self) -> None:
        """通知更新"""
        if self.on_update:
            snapshot = self.get_snapshot()
            self.on_update(snapshot)


# ============================================================================
# 工具函数
# ============================================================================

def format_progress(percentage: float) -> str:
    """
    格式化进度

    Args:
        percentage: 百分比

    Returns:
        格式化字符串
    """
    return f"{percentage:.1f}%"


def create_progress_bar(percentage: float, width: int = 20) -> str:
    """
    创建进度条

    Args:
        percentage: 百分比
        width: 宽度

    Returns:
        进度条字符串
    """
    filled = int(percentage / 100 * width)
    empty = width - filled
    return "[" + "=" * filled + " " * empty + "]"


def estimate_completion_time(
    elapsed_seconds: float,
    percentage: float,
) -> Optional[float]:
    """
    估算完成时间

    Args:
        elapsed_seconds: 已用时间
        percentage: 当前进度百分比

    Returns:
        预计剩余秒数，如果无法估算则返回 None
    """
    if percentage <= 0 or elapsed_seconds <= 0:
        return None

    if percentage >= 100:
        return 0

    # 基于当前进度估算
    remaining_percentage = 100 - percentage
    rate = percentage / elapsed_seconds  # percentage per second

    if rate <= 0:
        return None

    return remaining_percentage / rate
