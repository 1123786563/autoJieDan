"""
任务生命周期管理
处理任务的状态转换、完成和失败

@module nanobot.interagent.task_lifecycle
@version 1.0.0
"""

import asyncio
from typing import Optional, List, Dict, Any, Callable, Awaitable
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime
from collections import defaultdict


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
class TransitionResult:
    """状态转换结果"""
    success: bool
    from_status: TaskStatus
    to_status: TaskStatus
    timestamp: datetime
    error: Optional[str] = None


@dataclass
class TaskArtifact:
    """任务产物"""
    name: str
    type: str
    path: Optional[str] = None
    content: Optional[str] = None
    size: Optional[int] = None
    mime_type: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "type": self.type,
            "path": self.path,
            "content": self.content,
            "size": self.size,
            "mimeType": self.mime_type,
        }


@dataclass
class TaskMetrics:
    """任务指标"""
    tokens_used: Optional[int] = None
    api_calls: Optional[int] = None
    processing_time_ms: Optional[int] = None
    memory_used_mb: Optional[float] = None
    custom: Dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "tokensUsed": self.tokens_used,
            "apiCalls": self.api_calls,
            "processingTimeMs": self.processing_time_ms,
            "memoryUsedMb": self.memory_used_mb,
            "custom": self.custom,
        }


@dataclass
class CompletionData:
    """任务完成数据"""
    result: Optional[Dict[str, Any]] = None
    output: Optional[str] = None
    artifacts: List[TaskArtifact] = field(default_factory=list)
    metrics: Optional[TaskMetrics] = None


@dataclass
class FailureData:
    """任务失败数据"""
    error: str
    error_code: Optional[str] = None
    stack: Optional[str] = None
    recoverable: bool = True
    retryable: bool = True
    context: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TaskResult:
    """任务结果"""
    success: bool
    status: TaskStatus
    completed_at: datetime
    duration_ms: int
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    artifacts: List[TaskArtifact] = field(default_factory=list)
    metrics: Optional[TaskMetrics] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "status": self.status.value,
            "completedAt": self.completed_at.isoformat(),
            "durationMs": self.duration_ms,
            "result": self.result,
            "error": self.error,
            "artifacts": [a.to_dict() for a in self.artifacts],
            "metrics": self.metrics.to_dict() if self.metrics else None,
        }


@dataclass
class TaskContext:
    """任务上下文"""
    id: str
    type: TaskType
    status: TaskStatus
    priority: TaskPriority
    source_did: str
    target_did: str
    input: Dict[str, Any]
    created_at: datetime
    updated_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    retry_count: int = 0
    max_retries: int = 3
    error: Optional[str] = None
    error_code: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type.value,
            "status": self.status.value,
            "priority": self.priority.value,
            "sourceDid": self.source_did,
            "targetDid": self.target_did,
            "input": self.input,
            "createdAt": self.created_at.isoformat(),
            "updatedAt": self.updated_at.isoformat(),
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "completedAt": self.completed_at.isoformat() if self.completed_at else None,
            "retryCount": self.retry_count,
            "maxRetries": self.max_retries,
            "error": self.error,
            "errorCode": self.error_code,
            "result": self.result,
            "metadata": self.metadata,
        }


# ============================================================================
# 状态转换
# ============================================================================

# 有效状态转换
VALID_TRANSITIONS: Dict[TaskStatus, List[TaskStatus]] = {
    TaskStatus.PENDING: [TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.CANCELLED],
    TaskStatus.QUEUED: [TaskStatus.RUNNING, TaskStatus.PENDING, TaskStatus.CANCELLED],
    TaskStatus.RUNNING: [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED],
    TaskStatus.COMPLETED: [],
    TaskStatus.FAILED: [TaskStatus.PENDING, TaskStatus.QUEUED],
    TaskStatus.CANCELLED: [],
}


def can_transition(from_status: TaskStatus, to_status: TaskStatus) -> bool:
    """检查状态转换是否有效"""
    return to_status in VALID_TRANSITIONS.get(from_status, [])


def get_valid_transitions(from_status: TaskStatus) -> List[TaskStatus]:
    """获取有效目标状态"""
    return VALID_TRANSITIONS.get(from_status, []).copy()


def is_terminal_state(status: TaskStatus) -> bool:
    """是否为终态"""
    return status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]


# ============================================================================
# 任务生命周期管理器
# ============================================================================

class TaskLifecycleManager:
    """
    任务生命周期管理器
    管理任务的状态转换和生命周期事件
    """

    def __init__(
        self,
        context: TaskContext,
        hooks: Optional[Dict[str, Callable]] = None,
        retry_config: Optional["RetryConfig"] = None,
    ):
        """
        初始化管理器

        Args:
            context: 任务上下文
            hooks: 生命周期钩子
            retry_config: 重试配置
        """
        self.context = context
        self.hooks = hooks or {}

        self._listeners: Dict[str, List[Callable]] = defaultdict(list)
        self._transition_history: List[TransitionResult] = []

        # 初始化重试调度器
        self._retry_scheduler = RetryScheduler(retry_config)

    # =========================================================================
    # 生命周期管理
    # =========================================================================

    async def start_lifecycle(self) -> None:
        """启动生命周期管理器"""
        self._retry_scheduler.start()

    async def stop_lifecycle(self) -> None:
        """停止生命周期管理器"""
        self._retry_scheduler.stop()

    # =========================================================================
    # 状态转换
    # =========================================================================

    async def start(self) -> TransitionResult:
        """启动任务"""
        transition = self._transition(TaskStatus.RUNNING)

        if transition.success:
            self.context.started_at = datetime.now()

            # 执行钩子
            await self._run_hook("on_starting")
            await self._run_hook("on_started")

            self._emit("started", {"task": self.context})

        return transition

    async def complete(self, data: Optional[CompletionData] = None) -> TaskResult:
        """完成任务"""
        data = data or CompletionData()
        transition = self._transition(TaskStatus.COMPLETED)

        if not transition.success:
            return self._create_failed_result(transition.error or "Invalid transition")

        self.context.completed_at = datetime.now()
        self.context.result = data.result

        # 执行钩子
        await self._run_hook("on_completing", data)
        result = self._create_result(True, data)
        await self._run_hook("on_completed", result)

        self._emit("completed", {"task": self.context, "result": result})

        return result

    async def fail(self, data: FailureData) -> TaskResult:
        """失败任务"""
        transition = self._transition(TaskStatus.FAILED)

        if not transition.success:
            return self._create_failed_result(transition.error or "Invalid transition")

        self.context.completed_at = datetime.now()
        self.context.error = data.error
        self.context.error_code = data.error_code

        # 执行钩子
        await self._run_hook("on_failing", data)
        result = TaskResult(
            success=False,
            status=TaskStatus.FAILED,
            completed_at=self.context.completed_at,
            duration_ms=self._get_duration_ms(),
            error=data.error,
        )
        await self._run_hook("on_failed", result)

        self._emit("failed", {"task": self.context, "result": result, "data": data})

        return result

    async def cancel(self, reason: str) -> TaskResult:
        """取消任务"""
        transition = self._transition(TaskStatus.CANCELLED)

        if not transition.success:
            return self._create_failed_result(transition.error or "Invalid transition")

        self.context.completed_at = datetime.now()
        self.context.error = reason

        # 执行钩子
        await self._run_hook("on_cancelling", reason)
        result = TaskResult(
            success=False,
            status=TaskStatus.CANCELLED,
            completed_at=self.context.completed_at,
            duration_ms=self._get_duration_ms(),
            error=reason,
        )
        await self._run_hook("on_cancelled", result)

        self._emit("cancelled", {"task": self.context, "result": result, "reason": reason})

        return result

    async def retry(self) -> TransitionResult:
        """立即重试任务 (不使用调度器)"""
        if self.context.retry_count >= self.context.max_retries:
            return TransitionResult(
                success=False,
                from_status=self.context.status,
                to_status=TaskStatus.PENDING,
                timestamp=datetime.now(),
                error="Max retries exceeded",
            )

        transition = self._transition(TaskStatus.PENDING)

        if transition.success:
            self.context.retry_count += 1
            self.context.error = None
            self.context.error_code = None
            self.context.completed_at = None

            self._emit("retrying", {
                "task": self.context,
                "retry_count": self.context.retry_count,
            })

        return transition

    async def schedule_retry(self) -> TransitionResult:
        """调度延迟重试 (使用调度器)"""
        if self.context.retry_count >= self.context.max_retries:
            return TransitionResult(
                success=False,
                from_status=self.context.status,
                to_status=TaskStatus.PENDING,
                timestamp=datetime.now(),
                error="Max retries exceeded",
            )

        async def retry_callback():
            # 实际执行重试
            self.context.retry_count += 1
            self.context.error = None
            self.context.error_code = None
            self.context.completed_at = None
            transition = self._transition(TaskStatus.PENDING)

            if transition.success:
                self._emit("retrying", {
                    "task": self.context,
                    "retry_count": self.context.retry_count,
                })

            return transition

        # 调度重试
        next_retry_count = self.context.retry_count + 1
        delay_ms = await self._retry_scheduler.schedule_retry(
            self.context.id,
            next_retry_count,
            retry_callback
        )

        self._emit("retry:scheduled", {
            "task": self.context,
            "retryCount": next_retry_count,
            "delayMs": delay_ms,
        })

        return TransitionResult(
            success=True,
            from_status=self.context.status,
            to_status=TaskStatus.PENDING,
            timestamp=datetime.now(),
        )

    # =========================================================================
    # 查询方法
    # =========================================================================

    def get_context(self) -> TaskContext:
        """获取上下文副本"""
        return TaskContext(
            id=self.context.id,
            type=self.context.type,
            status=self.context.status,
            priority=self.context.priority,
            source_did=self.context.source_did,
            target_did=self.context.target_did,
            input=self.context.input.copy(),
            created_at=self.context.created_at,
            updated_at=self.context.updated_at,
            started_at=self.context.started_at,
            completed_at=self.context.completed_at,
            retry_count=self.context.retry_count,
            max_retries=self.context.max_retries,
            error=self.context.error,
            error_code=self.context.error_code,
            result=self.context.result.copy() if self.context.result else None,
            metadata=self.context.metadata.copy(),
        )

    def get_status(self) -> TaskStatus:
        """获取当前状态"""
        return self.context.status

    def is_running(self) -> bool:
        return self.context.status == TaskStatus.RUNNING

    def is_completed(self) -> bool:
        return self.context.status == TaskStatus.COMPLETED

    def is_failed(self) -> bool:
        return self.context.status == TaskStatus.FAILED

    def is_cancelled(self) -> bool:
        return self.context.status == TaskStatus.CANCELLED

    def is_terminal(self) -> bool:
        return is_terminal_state(self.context.status)

    def can_retry(self) -> bool:
        return (
            self.context.retry_count < self.context.max_retries
            and self.context.status == TaskStatus.FAILED
        )

    def get_retry_scheduler(self) -> "RetryScheduler":
        """获取重试调度器"""
        return self._retry_scheduler

    def get_retry_stats(self) -> Dict[str, Any]:
        """获取重试统计"""
        scheduler_stats = self._retry_scheduler.get_stats()
        return {
            "schedulerStats": scheduler_stats,
            "currentRetryCount": self.context.retry_count,
            "maxRetries": self.context.max_retries,
            "canRetry": self.can_retry(),
        }

    def get_transition_history(self) -> List[TransitionResult]:
        """获取转换历史"""
        return self._transition_history.copy()

    # =========================================================================
    # 事件监听
    # =========================================================================

    def on(self, event: str, listener: Callable) -> None:
        """添加事件监听器"""
        self._listeners[event].append(listener)

    def off(self, event: str, listener: Callable) -> None:
        """移除事件监听器"""
        if listener in self._listeners[event]:
            self._listeners[event].remove(listener)

    # =========================================================================
    # 内部方法
    # =========================================================================

    def _transition(self, to_status: TaskStatus) -> TransitionResult:
        """执行状态转换"""
        from_status = self.context.status
        now = datetime.now()

        if not can_transition(from_status, to_status):
            result = TransitionResult(
                success=False,
                from_status=from_status,
                to_status=to_status,
                timestamp=now,
                error=f"Invalid transition from {from_status.value} to {to_status.value}",
            )
            self._transition_history.append(result)
            return result

        self.context.status = to_status
        self.context.updated_at = now

        result = TransitionResult(
            success=True,
            from_status=from_status,
            to_status=to_status,
            timestamp=now,
        )
        self._transition_history.append(result)

        self._emit("transition", {"from": from_status.value, "to": to_status.value})

        return result

    def _get_duration_ms(self) -> int:
        """获取持续时间（毫秒）"""
        if not self.context.started_at:
            return 0
        end = self.context.completed_at or datetime.now()
        return int((end - self.context.started_at).total_seconds() * 1000)

    def _create_result(
        self,
        success: bool,
        data: Optional[CompletionData] = None,
    ) -> TaskResult:
        """创建结果"""
        data = data or CompletionData()
        return TaskResult(
            success=success,
            status=self.context.status,
            completed_at=self.context.completed_at or datetime.now(),
            duration_ms=self._get_duration_ms(),
            result=data.result,
            artifacts=data.artifacts,
            metrics=data.metrics,
        )

    def _create_failed_result(self, error: str) -> TaskResult:
        """创建失败结果"""
        return TaskResult(
            success=False,
            status=self.context.status,
            completed_at=datetime.now(),
            duration_ms=self._get_duration_ms(),
            error=error,
        )

    async def _run_hook(self, name: str, *args) -> None:
        """执行钩子"""
        hook = self.hooks.get(name)
        if hook:
            result = hook(*args)
            if asyncio.iscoroutine(result):
                await result

    def _emit(self, event: str, data: Dict[str, Any]) -> None:
        """发射事件"""
        for listener in self._listeners[event]:
            try:
                listener(data)
            except Exception:
                pass  # 忽略监听器错误


# ============================================================================
# 工具函数
# ============================================================================

def format_status(status: TaskStatus) -> str:
    """格式化任务状态"""
    status_map = {
        TaskStatus.PENDING: "待处理",
        TaskStatus.QUEUED: "已入队",
        TaskStatus.RUNNING: "执行中",
        TaskStatus.COMPLETED: "已完成",
        TaskStatus.FAILED: "已失败",
        TaskStatus.CANCELLED: "已取消",
    }
    return status_map.get(status, status.value)


def get_status_color(status: TaskStatus) -> str:
    """获取状态颜色"""
    color_map = {
        TaskStatus.PENDING: "yellow",
        TaskStatus.QUEUED: "blue",
        TaskStatus.RUNNING: "cyan",
        TaskStatus.COMPLETED: "green",
        TaskStatus.FAILED: "red",
        TaskStatus.CANCELLED: "gray",
    }
    return color_map.get(status, "white")


def create_error_code(category: str, code: int, message: str) -> str:
    """创建错误码"""
    return f"{category.upper()}_{str(code).zfill(3)}: {message}"


def parse_error_code(error_code: str) -> Optional[Dict[str, Any]]:
    """解析错误码"""
    import re
    match = re.match(r"^([A-Z]+)_(\d{3}):\s*(.+)$", error_code)
    if not match:
        return None

    return {
        "category": match.group(1),
        "code": int(match.group(2)),
        "message": match.group(3),
    }


# 预定义错误码
class ErrorCodes:
    """预定义错误码"""

    # 验证错误 (1xx)
    INVALID_INPUT = create_error_code("VALIDATION", 101, "Invalid input")
    MISSING_FIELD = create_error_code("VALIDATION", 102, "Missing required field")
    INVALID_FORMAT = create_error_code("VALIDATION", 103, "Invalid format")

    # 执行错误 (2xx)
    EXECUTION_FAILED = create_error_code("EXECUTION", 201, "Execution failed")
    TIMEOUT = create_error_code("EXECUTION", 202, "Operation timed out")
    RESOURCE_UNAVAILABLE = create_error_code("EXECUTION", 203, "Resource unavailable")

    # 系统错误 (3xx)
    INTERNAL_ERROR = create_error_code("SYSTEM", 301, "Internal error")
    OUT_OF_MEMORY = create_error_code("SYSTEM", 302, "Out of memory")
    NETWORK_ERROR = create_error_code("SYSTEM", 303, "Network error")


# ============================================================================
# 重试配置
# ============================================================================

@dataclass
class RetryConfig:
    """重试配置"""
    enable_exponential_backoff: bool = True
    delay_base_ms: int = 1000  # 基础延迟 (毫秒)
    delay_max_ms: int = 60000   # 最大延迟 (毫秒)
    jitter: float = 0.1          # 抖动系数 (0-1)
    max_retries: int = 3         # 最大重试次数

    def calculate_delay(self, retry_count: int) -> float:
        """计算重试延迟 (毫秒)"""
        if self.enable_exponential_backoff:
            delay = self.delay_base_ms * (2 ** retry_count)
        else:
            delay = self.delay_base_ms

        delay = min(delay, self.delay_max_ms)

        # 添加抖动
        if self.jitter > 0:
            import random
            jitter_range = delay * self.jitter
            delay = delay - (jitter_range / 2) + random.random() * jitter_range

        return max(0, delay)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "enableExponentialBackoff": self.enable_exponential_backoff,
            "delayBaseMs": self.delay_base_ms,
            "delayMaxMs": self.delay_max_ms,
            "jitter": self.jitter,
            "maxRetries": self.max_retries,
        }


# ============================================================================
# 重试调度器
# ============================================================================

class RetryScheduler:
    """
    重试调度器 - 管理任务重试调度

    功能:
    - 指数退避重试延迟
    - 重试状态跟踪
    - 自动调度可重试任务
    """

    def __init__(self, config: Optional[RetryConfig] = None):
        """
        初始化调度器

        Args:
            config: 重试配置
        """
        self.config = config or RetryConfig()
        self._scheduled_retries: Dict[str, asyncio.Task] = {}
        self._retry_history: Dict[str, List[datetime]] = defaultdict(list)
        self._is_running = False

    def start(self) -> None:
        """启动调度器"""
        self._is_running = True

    def stop(self) -> None:
        """停止调度器"""
        self._is_running = False

        # 取消所有预定的重试
        for task_id, task in self._scheduled_retries.items():
            task.cancel()

        self._scheduled_retries.clear()

    async def schedule_retry(
        self,
        task_id: str,
        retry_count: int,
        retry_callback: Callable[[], Awaitable[None]]
    ) -> float:
        """
        调度任务重试

        Args:
            task_id: 任务 ID
            retry_count: 当前重试次数
            retry_callback: 重试回调函数

        Returns:
            调度的延迟时间 (毫秒)
        """
        if not self._is_running:
            raise RuntimeError("Retry scheduler is not running")

        # 取消已存在的重试调度
        self.cancel_retry(task_id)

        delay_ms = self.config.calculate_delay(retry_count)
        delay_seconds = delay_ms / 1000
        retry_at = datetime.now() + timedelta(seconds=delay_seconds)

        # 记录重试历史
        self._retry_history[task_id].append(retry_at)

        # 创建异步任务
        async def retry_task():
            try:
                await asyncio.sleep(delay_seconds)
                if task_id in self._scheduled_retries:
                    await retry_callback()
            except asyncio.CancelledError:
                pass
            except Exception as e:
                # 错误会被调用方处理
                pass

        task = asyncio.create_task(retry_task())
        self._scheduled_retries[task_id] = task

        return delay_ms

    def cancel_retry(self, task_id: str) -> bool:
        """
        取消任务重试

        Args:
            task_id: 任务 ID

        Returns:
            是否成功取消
        """
        task = self._scheduled_retries.get(task_id)
        if task:
            task.cancel()
            del self._scheduled_retries[task_id]
            return True
        return False

    def get_retry_history(self, task_id: str) -> List[datetime]:
        """获取任务的重试历史"""
        return self._retry_history.get(task_id, []).copy()

    def get_scheduled_count(self) -> int:
        """获取预定重试数量"""
        return len(self._scheduled_retries)

    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        total_attempts = sum(len(attempts) for attempts in self._retry_history.values())

        return {
            "scheduledRetries": len(self._scheduled_retries),
            "totalRetryAttempts": total_attempts,
            "tasksWithHistory": len(self._retry_history),
        }

    def clear_history(self, task_id: str) -> None:
        """清理任务历史"""
        self.cancel_retry(task_id)
        self._retry_history.pop(task_id, None)

    def clear_all_history(self) -> None:
        """清理所有历史"""
        self.stop()
        self._retry_history.clear()
