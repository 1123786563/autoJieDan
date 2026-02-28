"""
Interagent 心跳机制
用于 Nanobot 与 Automaton 之间的双向心跳检测

@module nanobot.interagent.heartbeat
@version 1.0.0
"""

from .heartbeat_responder import HeartbeatResponder
from .types import (
    HeartbeatConfig,
    HeartbeatStatus,
    HeartbeatPayload,
    HeartbeatEvent,
    ConnectionState,
    HeartbeatStats,
    ReconnectRequest,
)

__all__ = [
    "HeartbeatResponder",
    "HeartbeatConfig",
    "HeartbeatStatus",
    "HeartbeatPayload",
    "HeartbeatEvent",
    "ConnectionState",
    "HeartbeatStats",
    "ReconnectRequest",
]
