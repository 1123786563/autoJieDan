"""
Nanobot WebSocket 客户端
用于连接 Automaton WebSocket 服务器

@module nanobot.interagent.websocket
@version 1.0.0
"""

import asyncio
import json
import time
import logging
import uuid
from typing import Optional, Callable, Any, Dict, List
from dataclasses import dataclass, field
from enum import Enum
import websockets
from websockets.client import WebSocketClientProtocol

logger = logging.getLogger(__name__)

# ============================================================================
# 类型定义
# ============================================================================

class ConnectionStatus(Enum):
    """连接状态枚举"""
    IDLE = "idle"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    DISCONNECTING = "disconnecting"
    CLOSED = "closed"
    ERROR = "error"


@dataclass
class WebSocketConfig:
    """WebSocket 客户端配置"""
    url: str
    reconnect_interval: float = 5.0  # 重连间隔 (秒)
    ping_interval: float = 30.0  # ping 间隔 (秒)
    connection_timeout: float = 10.0  # 连接超时 (秒)
    max_reconnect_attempts: int = 5  # 最大重连次数
    heartbeat_interval: float = 20.0  # 心跳间隔 (秒)
    heartbeat_timeout: float = 10.0  # 心跳超时 (秒)


@dataclass
class ConnectionState:
    """连接状态"""
    connected: bool = False
    last_connected: Optional[float] = None
    reconnect_attempts: int = 0
    error: Optional[str] = None
    status: ConnectionStatus = ConnectionStatus.IDLE
    last_heartbeat: Optional[float] = None
    messages_sent: int = 0
    messages_received: int = 0


@dataclass
class PoolConfig:
    """连接池配置"""
    min_size: int = 2
    """最小连接数"""

    max_size: int = 10
    """最大连接数"""

    idle_timeout: float = 60.0
    """空闲连接超时 (秒)"""

    max_lifetime: float = 3600.0
    """连接最大生命周期 (秒)"""

    acquire_timeout: float = 5.0
    """获取连接超时 (秒)"""

    health_check_interval: float = 30.0
    """健康检查间隔 (秒)"""


@dataclass
class PoolStats:
    """连接池统计"""
    total_connections: int = 0
    """总连接数"""

    active_connections: int = 0
    """活跃连接数"""

    idle_connections: int = 0
    """空闲连接数"""

    total_acquisitions: int = 0
    """总获取次数"""

    reused_connections: int = 0
    """复用连接数"""

    failed_acquisitions: int = 0
    """失败获取次数"""

    total_messages_sent: int = 0
    """总发送消息数"""

    total_messages_received: int = 0
    """总接收消息数"""

    connection_reuse_rate: float = 0.0
    """连接复用率 (%)"""

    def calculate_reuse_rate(self) -> None:
        """计算连接复用率"""
        if self.total_acquisitions > 0:
            self.connection_reuse_rate = (
                self.reused_connections / self.total_acquisitions * 100
            )


@dataclass
class PooledConnection:
    """池化连接"""
    id: str
    ws: WebSocketClientProtocol
    state: ConnectionState
    created_at: float
    last_used: float
    in_use: bool = False
    message_handler: Optional[Callable[[dict], None]] = None


# ============================================================================
# WebSocket 客户端
# ============================================================================

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


# ============================================================================
# WebSocket 连接池
# ============================================================================

class WebSocketConnectionPool:
    """
    WebSocket 连接池

    实现连接复用、自动重连、心跳保活

    Example:
        config = WebSocketConfig(url="ws://localhost:8080")
        pool_config = PoolConfig(min_size=2, max_size=10)
        pool = WebSocketConnectionPool(config, pool_config)

        async with pool:
            async with pool.acquire() as conn:
                await conn.send({"type": "ping"})

        stats = pool.get_stats()
        print(f"Reuse rate: {stats.connection_reuse_rate:.1f}%")
    """

    def __init__(
        self,
        ws_config: WebSocketConfig,
        pool_config: Optional[PoolConfig] = None
    ):
        self._ws_config = ws_config
        self._pool_config = pool_config or PoolConfig()
        self._connections: Dict[str, PooledConnection] = {}
        self._idle_queue: asyncio.Queue[str] = asyncio.Queue()
        self._lock = asyncio.Lock()
        self._stats = PoolStats()
        self._running = False
        self._health_check_task: Optional[asyncio.Task] = None
        self._heartbeat_task: Optional[asyncio.Task] = None

    async def __aenter__(self) -> "WebSocketConnectionPool":
        """异步上下文管理器入口"""
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """异步上下文管理器出口"""
        await self.stop()

    async def start(self) -> None:
        """启动连接池"""
        if self._running:
            return

        self._running = True

        # 创建最小连接数
        for _ in range(self._pool_config.min_size):
            try:
                conn_id = await self._create_connection()
                if conn_id:
                    await self._idle_queue.put(conn_id)
            except Exception as e:
                logger.warning(f"Failed to create initial connection: {e}")

        # 启动健康检查任务
        self._health_check_task = asyncio.create_task(self._health_check_loop())

        # 启动心跳任务
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        logger.info(
            f"WebSocket connection pool started: "
            f"{len(self._connections)} connections"
        )

    async def stop(self) -> None:
        """停止连接池"""
        self._running = False

        # 取消后台任务
        if self._health_check_task:
            self._health_check_task.cancel()
            self._health_check_task = None

        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            self._heartbeat_task = None

        # 关闭所有连接
        for conn in list(self._connections.values()):
            await self._close_connection(conn.id)

        self._connections.clear()

        # 清空空闲队列
        while not self._idle_queue.empty():
            try:
                self._idle_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        logger.info("WebSocket connection pool stopped")

    async def acquire(
        self,
        timeout: Optional[float] = None,
        on_message: Optional[Callable[[dict], None]] = None
    ) -> "PoolConnectionContext":
        """
        获取连接

        Args:
            timeout: 获取超时时间（秒），默认使用 pool_config.acquire_timeout
            on_message: 消息回调函数

        Returns:
            PoolConnectionContext: 连接上下文管理器

        Raises:
            asyncio.TimeoutError: 获取连接超时
            RuntimeError: 连接池已关闭
        """
        if not self._running:
            raise RuntimeError("Connection pool is not running")

        timeout = timeout or self._pool_config.acquire_timeout
        self._stats.total_acquisitions += 1

        try:
            # 尝试从空闲队列获取连接
            conn_id = await asyncio.wait_for(
                self._idle_queue.get(),
                timeout=timeout
            )

            async with self._lock:
                if conn_id not in self._connections:
                    # 连接已失效，创建新连接
                    conn_id = await self._create_connection()
                    if not conn_id:
                        raise RuntimeError("Failed to create connection")

                conn = self._connections[conn_id]

                # 检查连接是否健康
                if not self._is_connection_healthy(conn):
                    await self._close_connection(conn_id)
                    conn_id = await self._create_connection()
                    if not conn_id:
                        raise RuntimeError("Failed to create healthy connection")
                    conn = self._connections[conn_id]
                else:
                    self._stats.reused_connections += 1

                conn.in_use = True
                conn.last_used = time.time()

                # 设置消息处理器
                if on_message:
                    conn.message_handler = on_message

            self._stats.active_connections += 1
            self._stats.idle_connections = max(0, self._stats.idle_connections - 1)

            return PoolConnectionContext(self, conn_id)

        except asyncio.TimeoutError:
            self._stats.failed_acquisitions += 1
            raise

    async def release(self, conn_id: str) -> None:
        """
        释放连接

        Args:
            conn_id: 连接 ID
        """
        async with self._lock:
            if conn_id not in self._connections:
                return

            conn = self._connections[conn_id]
            conn.in_use = False
            conn.last_used = time.time()

            self._stats.active_connections -= 1
            self._stats.idle_connections += 1

            # 将连接放回空闲队列
            await self._idle_queue.put(conn_id)

    async def _create_connection(self) -> Optional[str]:
        """
        创建新连接

        Returns:
            连接 ID，失败返回 None
        """
        if len(self._connections) >= self._pool_config.max_size:
            logger.warning("Connection pool max size reached")
            return None

        try:
            ws = await asyncio.wait_for(
                websockets.connect(
                    self._ws_config.url,
                    ping_interval=self._ws_config.ping_interval,
                    ping_timeout=10
                ),
                timeout=self._ws_config.connection_timeout
            )

            conn_id = str(uuid.uuid4())
            now = time.time()

            state = ConnectionState(
                connected=True,
                last_connected=now,
                status=ConnectionStatus.CONNECTED,
                last_heartbeat=now
            )

            conn = PooledConnection(
                id=conn_id,
                ws=ws,
                state=state,
                created_at=now,
                last_used=now
            )

            self._connections[conn_id] = conn
            self._stats.total_connections += 1

            # 启动消息接收循环
            asyncio.create_task(self._connection_receive_loop(conn_id))

            logger.debug(f"Created new connection: {conn_id}")
            return conn_id

        except Exception as e:
            logger.error(f"Failed to create connection: {e}")
            return None

    async def _close_connection(self, conn_id: str) -> None:
        """
        关闭连接

        Args:
            conn_id: 连接 ID
        """
        async with self._lock:
            if conn_id not in self._connections:
                return

            conn = self._connections[conn_id]

            try:
                await conn.ws.close()
            except Exception:
                pass

            # 安全删除，使用 pop 避免 KeyError
            self._connections.pop(conn_id, None)
            logger.debug(f"Closed connection: {conn_id}")

    def _is_connection_healthy(self, conn: PooledConnection) -> bool:
        """
        检查连接是否健康

        Args:
            conn: 池化连接

        Returns:
            是否健康
        """
        if not conn.state.connected:
            return False

        now = time.time()

        # 检查连接是否超时
        if now - conn.state.last_heartbeat > self._ws_config.heartbeat_timeout:
            return False

        # 检查连接生命周期
        if now - conn.created_at > self._pool_config.max_lifetime:
            return False

        return True

    async def _connection_receive_loop(self, conn_id: str) -> None:
        """
        连接消息接收循环

        Args:
            conn_id: 连接 ID
        """
        try:
            while self._running:
                async with self._lock:
                    if conn_id not in self._connections:
                        break

                    conn = self._connections[conn_id]

                try:
                    message = await conn.ws.recv()
                    data = json.loads(message)

                    # 更新心跳时间
                    conn.state.last_heartbeat = time.time()
                    conn.state.messages_received += 1
                    self._stats.total_messages_received += 1

                    # 调用消息处理器
                    if conn.message_handler:
                        conn.message_handler(data)

                except websockets.exceptions.ConnectionClosed:
                    conn.state.connected = False
                    conn.state.status = ConnectionStatus.CLOSED
                    break
                except json.JSONDecodeError:
                    continue
                except Exception as e:
                    logger.error(f"Connection {conn_id} receive error: {e}")
                    conn.state.status = ConnectionStatus.ERROR
                    break
        except asyncio.CancelledError:
            # 任务被取消，正常退出
            pass
        finally:
            # 从池中移除失效连接
            async with self._lock:
                if conn_id in self._connections:
                    await self._close_connection(conn_id)

    async def _health_check_loop(self) -> None:
        """健康检查循环"""
        try:
            while self._running:
                await asyncio.sleep(self._pool_config.health_check_interval)

                async with self._lock:
                    now = time.time()
                    to_remove = []

                    for conn_id, conn in self._connections.items():
                        # 检查空闲连接超时
                        if not conn.in_use:
                            if now - conn.last_used > self._pool_config.idle_timeout:
                                to_remove.append(conn_id)
                                continue

                        # 检查连接健康状态
                        if not self._is_connection_healthy(conn):
                            to_remove.append(conn_id)

                    # 移除不健康的连接
                    for conn_id in to_remove:
                        await self._close_connection(conn_id)

                    # 确保最小连接数
                    while (
                        len(self._connections) < self._pool_config.min_size
                        and len(self._connections) < self._pool_config.max_size
                    ):
                        conn_id = await self._create_connection()
                        if conn_id:
                            await self._idle_queue.put(conn_id)
                        else:
                            break
        except asyncio.CancelledError:
            # 任务被取消，正常退出
            pass

    async def _heartbeat_loop(self) -> None:
        """心跳循环"""
        try:
            while self._running:
                await asyncio.sleep(self._ws_config.heartbeat_interval)

                async with self._lock:
                    for conn in self._connections.values():
                        if conn.state.connected:
                            try:
                                heartbeat = create_heartbeat_event(
                                    source="nanobot",
                                    target="automaton",
                                    status="healthy",
                                    uptime=time.time() - conn.created_at,
                                    active_tasks=0,
                                    queued_tasks=0
                                )

                                await conn.ws.send(json.dumps(heartbeat))
                                conn.state.messages_sent += 1
                                self._stats.total_messages_sent += 1

                            except Exception as e:
                                logger.error(f"Heartbeat send error: {e}")
        except asyncio.CancelledError:
            # 任务被取消，正常退出
            pass

    def get_stats(self) -> PoolStats:
        """
        获取连接池统计

        Returns:
            PoolStats: 统计信息
        """
        # 更新统计信息
        self._stats.total_connections = len(self._connections)
        self._stats.active_connections = sum(
            1 for c in self._connections.values() if c.in_use
        )
        self._stats.idle_connections = (
            self._stats.total_connections - self._stats.active_connections
        )
        self._stats.calculate_reuse_rate()

        return PoolStats(
            total_connections=self._stats.total_connections,
            active_connections=self._stats.active_connections,
            idle_connections=self._stats.idle_connections,
            total_acquisitions=self._stats.total_acquisitions,
            reused_connections=self._stats.reused_connections,
            failed_acquisitions=self._stats.failed_acquisitions,
            total_messages_sent=self._stats.total_messages_sent,
            total_messages_received=self._stats.total_messages_received,
            connection_reuse_rate=self._stats.connection_reuse_rate
        )

    def is_running(self) -> bool:
        """检查连接池是否运行中"""
        return self._running


class PoolConnectionContext:
    """
    连接上下文管理器

    Example:
        async with await pool.acquire() as conn:
            await conn.send({"type": "message"})
    """

    def __init__(self, pool: WebSocketConnectionPool, conn_id: str):
        self._pool = pool
        self._conn_id = conn_id
        self._conn: Optional[PooledConnection] = None

    async def __aenter__(self) -> "PoolConnectionContext":
        """进入上下文"""
        async with self._pool._lock:
            self._conn = self._pool._connections.get(self._conn_id)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """退出上下文"""
        await self._pool.release(self._conn_id)

    async def send(self, message: dict) -> bool:
        """
        发送消息

        Args:
            message: 消息内容

        Returns:
            是否发送成功
        """
        if not self._conn or not self._conn.state.connected:
            return False

        try:
            await self._conn.ws.send(json.dumps(message))
            self._conn.state.messages_sent += 1
            self._pool._stats.total_messages_sent += 1
            return True
        except Exception as e:
            logger.error(f"Send error: {e}")
            return False

    async def receive(self) -> Optional[dict]:
        """
        接收消息

        Returns:
            消息内容，连接关闭返回 None
        """
        if not self._conn or not self._conn.state.connected:
            return None

        try:
            message = await self._conn.ws.recv()
            data = json.loads(message)
            self._conn.state.messages_received += 1
            self._pool._stats.total_messages_received += 1
            return data
        except websockets.exceptions.ConnectionClosed:
            self._conn.state.connected = False
            return None
        except json.JSONDecodeError:
            return None
        except Exception as e:
            logger.error(f"Receive error: {e}")
            return None

    def is_connected(self) -> bool:
        """检查连接是否有效"""
        return self._conn is not None and self._conn.state.connected

    @property
    def id(self) -> str:
        """获取连接 ID"""
        return self._conn_id


# ============================================================================
# 全局连接池
# ============================================================================

_global_pool: Optional[WebSocketConnectionPool] = None


def get_global_pool(
    ws_config: Optional[WebSocketConfig] = None,
    pool_config: Optional[PoolConfig] = None
) -> WebSocketConnectionPool:
    """
    获取全局连接池

    Args:
        ws_config: WebSocket 配置
        pool_config: 连接池配置

    Returns:
        WebSocketConnectionPool: 全局连接池实例
    """
    global _global_pool

    if _global_pool is None:
        if ws_config is None:
            raise ValueError("ws_config is required for first call")

        _global_pool = WebSocketConnectionPool(ws_config, pool_config)

    return _global_pool


def set_global_pool(pool: WebSocketConnectionPool) -> None:
    """
    设置全局连接池

    Args:
        pool: 连接池实例
    """
    global _global_pool
    _global_pool = pool


async def close_global_pool() -> None:
    """关闭全局连接池"""
    global _global_pool

    if _global_pool:
        await _global_pool.stop()
        _global_pool = None
