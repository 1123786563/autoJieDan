"""
Nanobot WebSocket 客户端
用于连接 Automaton WebSocket 服务器

@module nanobot.interagent.websocket
@version 1.0.0
"""

import asyncio
import json
import time
from typing import Optional, Callable, Any
from dataclasses import dataclass
import websockets
from websockets.client import WebSocketClientProtocol

# ============================================================================
# 类型定义
# ============================================================================

@dataclass
class WebSocketConfig:
    """WebSocket 客户端配置"""
    url: str
    reconnect_interval: float = 5.0  # 重连间隔 (秒)
    ping_interval: float = 30.0  # ping 间隔 (秒)
    connection_timeout: float = 10.0  # 连接超时 (秒)
    max_reconnect_attempts: int = 5  # 最大重连次数

@dataclass
class ConnectionState:
    """连接状态"""
    connected: bool = False
    last_connected: Optional[float] = None
    reconnect_attempts: int = 0
    error: Optional[str] = None

# ============================================================================
# WebSocket 客户端
# ============================================================================

class InteragentWebSocketClient:
    """
    Nanobot WebSocket 客户端
    用于与 Automaton 进行实时通信
    """

    def __init__(
        self,
        config: WebSocketConfig,
        on_message: Optional[Callable[[dict], None]] = None
    ):
        self.config = config
        self.on_message = on_message
        self.ws: Optional[WebSocketClientProtocol] = None
        self.state = ConnectionState()
        self._running = False
        self._reconnect_task: Optional[asyncio.Task] = None
        self._ping_task: Optional[asyncio.Task] = None

    async def connect(self) -> bool:
        """
        建立 WebSocket 连接
        """
        try:
            self.ws = await asyncio.wait_for(
                websockets.connect(
                    self.config.url,
                    ping_interval=self.config.ping_interval,
                    ping_timeout=10
                ),
                timeout=self.config.connection_timeout
            )

            self.state.connected = True
            self.state.last_connected = time.time()
            self.state.reconnect_attempts = 0
            self.state.error = None
            self._running = True

            # 启动消息接收循环
            asyncio.create_task(self._receive_loop())

            return True
        except asyncio.TimeoutError:
            self.state.error = "Connection timeout"
            return False
        except Exception as e:
            self.state.error = str(e)
            return False

    async def disconnect(self) -> None:
        """
        断开连接
        """
        self._running = False

        if self._ping_task:
            self._ping_task.cancel()
            self._ping_task = None

        if self.ws:
            await self.ws.close()
            self.ws = None

        self.state.connected = False

    async def send(self, message: dict) -> bool:
        """
        发送消息
        """
        if not self.ws or not self.state.connected:
            return False

        try:
            await self.ws.send(json.dumps(message))
            return True
        except Exception as e:
            self.state.error = str(e)
            return False

    async def _receive_loop(self) -> None:
        """
        消息接收循环
        """
        while self._running and self.ws:
            try:
                message = await self.ws.recv()
                data = json.loads(message)

                # 调用消息处理器
                if self.on_message:
                    self.on_message(data)

            except websockets.exceptions.ConnectionClosed:
                self.state.connected = False
                self.state.error = "Connection closed"
                break
            except json.JSONDecodeError:
                continue  # 忽略无效 JSON
            except Exception as e:
                self.state.error = str(e)
                break

        # 尝试重连
        if self._running:
            asyncio.create_task(self._reconnect())

    async def _reconnect(self) -> None:
        """
        自动重连
        """
        while (
            self._running
            and self.state.reconnect_attempts < self.config.max_reconnect_attempts
        ):
            self.state.reconnect_attempts += 1
            await asyncio.sleep(self.config.reconnect_interval)

            if await self.connect():
                return

        # 重连失败
        self.state.error = "Max reconnect attempts reached"

    def is_connected(self) -> bool:
        """检查是否已连接"""
        return self.state.connected and self.ws is not None

# ============================================================================
# 事件构建器
# ============================================================================

def create_event_base(
    event_type: str,
    source: str,
    target: str,
    correlation_id: Optional[str] = None
) -> dict:
    """创建事件基础结构"""
    return {
        "id": _generate_id(),
        "type": event_type,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.%fZ", time.gmtime()),
        "source": source,
        "target": target,
        "correlationId": correlation_id
    }

def _generate_id() -> str:
    """生成唯一 ID"""
    import uuid
    return str(uuid.uuid4())

def create_progress_event(
    source: str,
    target: str,
    task_id: str,
    progress: float,
    current_phase: str,
    completed_steps: list,
    next_steps: list,
    eta_seconds: Optional[float] = None
) -> dict:
    """创建进度事件"""
    return {
        **create_event_base("task.progress", source, target),
        "payload": {
            "taskId": task_id,
            "progress": progress,
            "currentPhase": current_phase,
            "completedSteps": completed_steps,
            "nextSteps": next_steps,
            "etaSeconds": eta_seconds
        }
    }

def create_error_event(
    source: str,
    target: str,
    task_id: str,
    severity: str,
    error_code: str,
    message: str,
    recoverable: bool,
    context: Optional[dict] = None
) -> dict:
    """创建错误事件"""
    return {
        **create_event_base("task.error", source, target),
        "payload": {
            "taskId": task_id,
            "severity": severity,
            "errorCode": error_code,
            "message": message,
            "recoverable": recoverable,
            "context": context
        }
    }

def create_heartbeat_event(
    source: str,
    target: str,
    status: str,
    uptime: float,
    active_tasks: int,
    queued_tasks: int
) -> dict:
    """创建心跳事件"""
    return {
        **create_event_base("status.heartbeat", source, target),
        "payload": {
            "status": status,
            "uptime": uptime,
            "activeTasks": active_tasks,
            "queuedTasks": queued_tasks
        }
    }
