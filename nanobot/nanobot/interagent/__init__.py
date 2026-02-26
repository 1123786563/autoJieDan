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
]
