"""
Nanobot Interagent 模块
用于与 Automaton 进行通信和协作

@module nanobot.interagent
@version 1.0.0
"""

from .websocket import (
    InteragentWebSocketClient,
    WebSocketConfig,
    ConnectionState,
    create_event_base,
    create_progress_event,
    create_error_event,
    create_heartbeat_event,
)

from .health_server import (
    HealthCheckServer,
    HealthStatus,
    HealthResponse,
    StatusResponse,
    SystemInfo,
    NanobotStatus,
    create_default_health_checker,
    create_simple_status_provider,
)

from .filters import (
    TaskStatus,
    TaskPriority,
    TaskType,
    TaskFilter,
    Task,
    TaskMatcher,
    matches_filter,
    filter_tasks,
    sort_by_priority,
    create_pending_filter,
    create_high_priority_filter,
    create_for_nanobot_filter,
)

from .poller import (
    TaskPoller,
    PollerConfig,
    PollerState,
    PollerStats,
    create_nanobot_poller,
)

from .lease import (
    Lease,
    LeaseStatus,
    LeaseConfig,
    LeaseClient,
    LeaseContext,
    format_remaining_time,
    is_expiring_soon,
)

from .progress import (
    Milestone,
    MilestoneStatus,
    ProgressTracker,
    ProgressSnapshot,
    format_progress,
    create_progress_bar,
    estimate_completion_time,
)

from .reporter import (
    ProgressReporter,
    ProgressReport,
    ProgressListener,
    ReporterConfig,
    ReporterStats,
    create_summary_report,
    format_report_message,
)

__all__ = [
    # WebSocket
    "InteragentWebSocketClient",
    "WebSocketConfig",
    "ConnectionState",
    "create_event_base",
    "create_progress_event",
    "create_error_event",
    "create_heartbeat_event",
    # Health Server
    "HealthCheckServer",
    "HealthStatus",
    "HealthResponse",
    "StatusResponse",
    "SystemInfo",
    "NanobotStatus",
    "create_default_health_checker",
    "create_simple_status_provider",
    # Filters
    "TaskStatus",
    "TaskPriority",
    "TaskType",
    "TaskFilter",
    "Task",
    "TaskMatcher",
    "matches_filter",
    "filter_tasks",
    "sort_by_priority",
    "create_pending_filter",
    "create_high_priority_filter",
    "create_for_nanobot_filter",
    # Poller
    "TaskPoller",
    "PollerConfig",
    "PollerState",
    "PollerStats",
    "create_nanobot_poller",
    # Lease
    "Lease",
    "LeaseStatus",
    "LeaseConfig",
    "LeaseClient",
    "LeaseContext",
    "format_remaining_time",
    "is_expiring_soon",
    # Progress
    "Milestone",
    "MilestoneStatus",
    "ProgressTracker",
    "ProgressSnapshot",
    "format_progress",
    "create_progress_bar",
    "estimate_completion_time",
    # Reporter
    "ProgressReporter",
    "ProgressReport",
    "ProgressListener",
    "ReporterConfig",
    "ReporterStats",
    "create_summary_report",
    "format_report_message",
]
