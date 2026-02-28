"""
心跳机制类型定义
"""

from enum import Enum
from dataclasses import dataclass, field
from typing import Optional, Dict, Any
from datetime import datetime
import time


class HeartbeatStatus(str, Enum):
    """心跳状态"""

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


class HeartbeatEventType(str, Enum):
    """心跳事件类型"""

    HEARTBEAT_SENT = "heartbeat:sent"
    HEARTBEAT_RECEIVED = "heartbeat:received"
    HEARTBEAT_TIMEOUT = "heartbeat:timeout"
    HEARTBEAT_RECOVERED = "heartbeat:recovered"
    HEARTBEAT_FAILED = "heartbeat:failed"


@dataclass
class HeartbeatConfig:
    """心跳配置"""

    interval: float = 30.0  # 心跳间隔 (秒)，默认 30秒
    timeout: float = 90.0  # 心跳超时 (秒)，默认 90秒 (3次间隔)
    failure_threshold: int = 3  # 失败阈值，达到此次数触发重连
    enabled: bool = True  # 是否启用心跳
    max_retries: int = 5  # 最大重试次数
    reconnect_delay_base: float = 1.0  # 重连延迟基数 (秒)
    reconnect_delay_max: float = 30.0  # 重连延迟最大值 (秒)


@dataclass
class HeartbeatPayload:
    """心跳负载"""

    status: HeartbeatStatus
    uptime: float  # 运行时间 (秒)
    active_tasks: int  # 活跃任务数
    queued_tasks: int  # 队列任务数
    timestamp: str  # 时间戳
    sequence: int  # 序列号
    version: str = "1.0.0"  # 版本


@dataclass
class HeartbeatEvent:
    """心跳事件"""

    id: str
    type: HeartbeatEventType
    target_did: str
    payload: HeartbeatPayload
    timestamp: str


@dataclass
class ConnectionState:
    """连接状态"""

    connection_id: str
    target_did: str
    connected: bool = True
    last_heartbeat: Optional[datetime] = None
    last_sent: Optional[datetime] = None
    last_received: Optional[datetime] = None
    consecutive_failures: int = 0
    total_sent: int = 0
    total_received: int = 0
    total_failures: int = 0
    status: HeartbeatStatus = HeartbeatStatus.UNKNOWN
    reconnect_count: int = 0


@dataclass
class HeartbeatRecord:
    """心跳记录"""

    sequence: int
    sent_at: datetime
    received_at: Optional[datetime] = None
    rtt: Optional[float] = None  # 往返时间 (毫秒)


@dataclass
class HeartbeatStats:
    """心跳统计"""

    total_connections: int = 0
    healthy_connections: int = 0
    degraded_connections: int = 0
    unhealthy_connections: int = 0
    total_sent: int = 0
    total_received: int = 0
    total_failures: int = 0
    average_latency: float = 0.0  # 平均延迟 (毫秒)
    loss_rate: float = 0.0  # 心跳丢失率 (%)


@dataclass
class ReconnectRequest:
    """重连请求"""

    connection_id: str
    target_did: str
    reason: str
    retry_count: int
