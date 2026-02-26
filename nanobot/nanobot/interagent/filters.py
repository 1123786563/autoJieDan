"""
任务过滤逻辑
用于筛选和匹配任务

@module nanobot.interagent.filters
@version 1.0.0
"""

from typing import Optional, List, Dict, Any, Callable
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime


# ============================================================================
# 类型定义
# ============================================================================

class TaskStatus(str, Enum):
    """任务状态"""
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskPriority(str, Enum):
    """任务优先级"""
    CRITICAL = "critical"
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"
    BACKGROUND = "background"


class TaskType(str, Enum):
    """任务类型"""
    GENESIS = "genesis"
    ANALYSIS = "analysis"
    EXECUTION = "execution"
    REPORT = "report"
    MAINTENANCE = "maintenance"
    CUSTOM = "custom"


@dataclass
class TaskFilter:
    """任务过滤器"""
    status: Optional[List[TaskStatus]] = None
    priority: Optional[List[TaskPriority]] = None
    task_type: Optional[List[TaskType]] = None
    target_did: Optional[str] = None
    source_did: Optional[str] = None
    tags: Optional[List[str]] = None
    limit: Optional[int] = None
    offset: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        result = {}
        if self.status:
            result["status"] = [s.value for s in self.status]
        if self.priority:
            result["priority"] = [p.value for p in self.priority]
        if self.task_type:
            result["type"] = [t.value for t in self.task_type]
        if self.target_did:
            result["targetDid"] = self.target_did
        if self.source_did:
            result["sourceDid"] = self.source_did
        if self.tags:
            result["tags"] = self.tags
        if self.limit is not None:
            result["limit"] = self.limit
        if self.offset is not None:
            result["offset"] = self.offset
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TaskFilter":
        """从字典创建过滤器"""
        status_list = data.get("status")
        if status_list:
            status_list = [TaskStatus(s) for s in status_list]

        priority_list = data.get("priority")
        if priority_list:
            priority_list = [TaskPriority(p) for p in priority_list]

        type_list = data.get("type") or data.get("task_type")
        if type_list:
            type_list = [TaskType(t) for t in type_list]

        return cls(
            status=status_list,
            priority=priority_list,
            task_type=type_list,
            target_did=data.get("targetDid") or data.get("target_did"),
            source_did=data.get("sourceDid") or data.get("source_did"),
            tags=data.get("tags"),
            limit=data.get("limit"),
            offset=data.get("offset"),
        )


@dataclass
class Task:
    """任务数据结构"""
    id: str
    type: TaskType
    status: TaskStatus
    priority: TaskPriority
    source_did: str
    target_did: str
    input: Dict[str, Any]
    created_at: datetime
    updated_at: datetime
    retry_count: int = 0
    max_retries: int = 3
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    lease_expires_at: Optional[datetime] = None
    error: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Task":
        """从字典创建任务"""
        return cls(
            id=data["id"],
            type=TaskType(data["type"]),
            status=TaskStatus(data["status"]),
            priority=TaskPriority(data["priority"]),
            source_did=data["sourceDid"],
            target_did=data["targetDid"],
            input=data["input"],
            created_at=datetime.fromisoformat(data["createdAt"].replace("Z", "+00:00"))
                if isinstance(data["createdAt"], str) else data["createdAt"],
            updated_at=datetime.fromisoformat(data["updatedAt"].replace("Z", "+00:00"))
                if isinstance(data["updatedAt"], str) else data["updatedAt"],
            retry_count=data.get("retryCount", 0),
            max_retries=data.get("maxRetries", 3),
            started_at=datetime.fromisoformat(data["startedAt"].replace("Z", "+00:00"))
                if data.get("startedAt") else None,
            completed_at=datetime.fromisoformat(data["completedAt"].replace("Z", "+00:00"))
                if data.get("completedAt") else None,
            lease_expires_at=datetime.fromisoformat(data["leaseExpiresAt"].replace("Z", "+00:00"))
                if data.get("leaseExpiresAt") else None,
            error=data.get("error"),
            result=data.get("result"),
            metadata=data.get("metadata", {}),
        )


# ============================================================================
# 过滤函数
# ============================================================================

def matches_filter(task: Task, task_filter: TaskFilter) -> bool:
    """
    检查任务是否匹配过滤器

    Args:
        task: 任务对象
        task_filter: 过滤器

    Returns:
        是否匹配
    """
    # 状态过滤
    if task_filter.status and task.status not in task_filter.status:
        return False

    # 优先级过滤
    if task_filter.priority and task.priority not in task_filter.priority:
        return False

    # 类型过滤
    if task_filter.task_type and task.type not in task_filter.task_type:
        return False

    # 目标 DID 过滤
    if task_filter.target_did and task.target_did != task_filter.target_did:
        return False

    # 来源 DID 过滤
    if task_filter.source_did and task.source_did != task_filter.source_did:
        return False

    # 标签过滤
    if task_filter.tags:
        task_tags = task.metadata.get("tags", [])
        if not any(tag in task_tags for tag in task_filter.tags):
            return False

    return True


def filter_tasks(tasks: List[Task], task_filter: TaskFilter) -> List[Task]:
    """
    过滤任务列表

    Args:
        tasks: 任务列表
        task_filter: 过滤器

    Returns:
        过滤后的任务列表
    """
    result = [task for task in tasks if matches_filter(task, task_filter)]

    # 应用偏移
    if task_filter.offset is not None:
        result = result[task_filter.offset:]

    # 应用限制
    if task_filter.limit is not None:
        result = result[:task_filter.limit]

    return result


# ============================================================================
# 优先级排序
# ============================================================================

PRIORITY_ORDER = {
    TaskPriority.CRITICAL: 0,
    TaskPriority.HIGH: 1,
    TaskPriority.NORMAL: 2,
    TaskPriority.LOW: 3,
    TaskPriority.BACKGROUND: 4,
}


def sort_by_priority(tasks: List[Task]) -> List[Task]:
    """
    按优先级排序任务

    Args:
        tasks: 任务列表

    Returns:
        排序后的任务列表
    """
    return sorted(
        tasks,
        key=lambda t: (PRIORITY_ORDER.get(t.priority, 999), t.created_at)
    )


# ============================================================================
# 任务匹配器
# ============================================================================

class TaskMatcher:
    """
    任务匹配器
    用于创建复杂的任务匹配规则
    """

    def __init__(self):
        self._rules: List[Callable[[Task], bool]] = []

    def with_status(self, *statuses: TaskStatus) -> "TaskMatcher":
        """添加状态匹配规则"""
        status_set = set(statuses)
        self._rules.append(lambda t: t.status in status_set)
        return self

    def with_priority(self, *priorities: TaskPriority) -> "TaskMatcher":
        """添加优先级匹配规则"""
        priority_set = set(priorities)
        self._rules.append(lambda t: t.priority in priority_set)
        return self

    def with_type(self, *types: TaskType) -> "TaskMatcher":
        """添加类型匹配规则"""
        type_set = set(types)
        self._rules.append(lambda t: t.type in type_set)
        return self

    def with_target(self, target_did: str) -> "TaskMatcher":
        """添加目标匹配规则"""
        self._rules.append(lambda t: t.target_did == target_did)
        return self

    def with_source(self, source_did: str) -> "TaskMatcher":
        """添加来源匹配规则"""
        self._rules.append(lambda t: t.source_did == source_did)
        return self

    def with_tag(self, *tags: str) -> "TaskMatcher":
        """添加标签匹配规则"""
        tag_set = set(tags)
        self._rules.append(lambda t: any(tag in t.metadata.get("tags", []) for tag in tag_set))
        return self

    def with_custom(self, predicate: Callable[[Task], bool]) -> "TaskMatcher":
        """添加自定义匹配规则"""
        self._rules.append(predicate)
        return self

    def matches(self, task: Task) -> bool:
        """检查任务是否匹配所有规则"""
        return all(rule(task) for rule in self._rules)

    def filter(self, tasks: List[Task]) -> List[Task]:
        """过滤任务列表"""
        return [task for task in tasks if self.matches(task)]

    def to_filter(self) -> TaskFilter:
        """转换为 TaskFilter（部分信息会丢失）"""
        # 这个方法只能提取部分信息
        return TaskFilter()  # 返回空过滤器，因为无法完全重建


# ============================================================================
# 预定义过滤器
# ============================================================================

def create_pending_filter() -> TaskFilter:
    """创建待处理任务过滤器"""
    return TaskFilter(
        status=[TaskStatus.PENDING, TaskStatus.QUEUED]
    )


def create_high_priority_filter() -> TaskFilter:
    """创建高优先级任务过滤器"""
    return TaskFilter(
        status=[TaskStatus.PENDING, TaskStatus.QUEUED],
        priority=[TaskPriority.CRITICAL, TaskPriority.HIGH]
    )


def create_for_nanobot_filter(nanobot_did: str) -> TaskFilter:
    """创建指定 Nanobot 的任务过滤器"""
    return TaskFilter(
        status=[TaskStatus.PENDING, TaskStatus.QUEUED],
        target_did=nanobot_did
    )
