"""
Nanobot HTTP 健康检查服务器
提供 /health, /status, /ready, /live 端点用于监控

@module nanobot.interagent.health_server
@version 1.0.0
"""

import asyncio
import time
from typing import Optional, Callable, Any
from dataclasses import dataclass, field
from enum import Enum
import json

try:
    from aiohttp import web
    HAS_AIOHTTP = True
except ImportError:
    HAS_AIOHTTP = False
    web = None


# ============================================================================
# 类型定义
# ============================================================================

class HealthStatus(str, Enum):
    """健康状态"""
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"


@dataclass
class HealthResponse:
    """基本健康响应"""
    status: HealthStatus
    timestamp: str
    uptime: float
    version: str

    def to_dict(self) -> dict:
        return {
            "status": self.status.value,
            "timestamp": self.timestamp,
            "uptime": self.uptime,
            "version": self.version,
        }


@dataclass
class SystemInfo:
    """系统信息"""
    platform: str
    python_version: str
    memory_usage: dict = field(default_factory=dict)
    cpu_usage: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "platform": self.platform,
            "pythonVersion": self.python_version,
            "memoryUsage": self.memory_usage,
            "cpuUsage": self.cpu_usage,
        }


@dataclass
class NanobotStatus:
    """Nanobot 状态"""
    did: str
    state: str
    active_tasks: int = 0
    queued_tasks: int = 0
    current_task_id: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "did": self.did,
            "state": self.state,
            "activeTasks": self.active_tasks,
            "queuedTasks": self.queued_tasks,
            "currentTaskId": self.current_task_id,
        }


@dataclass
class StatusResponse:
    """详细状态响应"""
    health: HealthResponse
    system: SystemInfo
    nanobot: NanobotStatus
    websocket: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "status": self.health.status.value,
            "timestamp": self.health.timestamp,
            "uptime": self.health.uptime,
            "version": self.health.version,
            "system": self.system.to_dict(),
            "nanobot": self.nanobot.to_dict(),
            "websocket": self.websocket,
        }


# ============================================================================
# 健康检查器类型
# ============================================================================

HealthChecker = Callable[[], HealthStatus]
AsyncHealthChecker = Callable[[], Any]  # Returns HealthStatus or Awaitable[HealthStatus]
StatusProvider = Callable[[], NanobotStatus]
AsyncStatusProvider = Callable[[], Any]  # Returns NanobotStatus or Awaitable[NanobotStatus]


# ============================================================================
# 健康检查 HTTP 服务器
# ============================================================================

class HealthCheckServer:
    """
    HTTP 健康检查服务器

    提供以下端点：
    - /health, /healthz - 基本健康状态
    - /status, /statusz - 详细状态
    - /ready, /readyz - 就绪探针
    - /live, /livez - 存活探针
    """

    DEFAULT_CONFIG = {
        "port": 18793,
        "host": "0.0.0.0",
        "nanobot_did": "did:anp:nanobot:main",
        "version": "1.0.0",
    }

    def __init__(
        self,
        port: int = 18793,
        host: str = "0.0.0.0",
        nanobot_did: str = "did:anp:nanobot:main",
        version: str = "1.0.0",
    ):
        if not HAS_AIOHTTP:
            raise ImportError("aiohttp is required for HealthCheckServer. Install with: pip install aiohttp")

        self.config = {
            "port": port,
            "host": host,
            "nanobot_did": nanobot_did,
            "version": version,
        }
        self._start_time = time.time()
        self._runner: Optional[web.AppRunner] = None
        self._site: Optional[web.TCPSite] = None

        # 可选的回调函数
        self._health_checker: Optional[AsyncHealthChecker] = None
        self._status_provider: Optional[AsyncStatusProvider] = None
        self._websocket_client: Optional[Any] = None

    def set_health_checker(self, checker: AsyncHealthChecker) -> None:
        """设置自定义健康检查器"""
        self._health_checker = checker

    def set_status_provider(self, provider: AsyncStatusProvider) -> None:
        """设置自定义状态提供器"""
        self._status_provider = provider

    def set_websocket_client(self, client: Any) -> None:
        """设置 WebSocket 客户端引用"""
        self._websocket_client = client

    async def start(self) -> None:
        """启动 HTTP 服务器"""
        app = web.Application()
        app.router.add_get("/health", self._handle_health)
        app.router.add_get("/healthz", self._handle_health)
        app.router.add_get("/status", self._handle_status)
        app.router.add_get("/statusz", self._handle_status)
        app.router.add_get("/ready", self._handle_ready)
        app.router.add_get("/readyz", self._handle_ready)
        app.router.add_get("/live", self._handle_live)
        app.router.add_get("/livez", self._handle_live)

        self._runner = web.AppRunner(app)
        await self._runner.setup()

        self._site = web.TCPSite(
            self._runner,
            self.config["host"],
            self.config["port"],
        )
        await self._site.start()

    async def stop(self) -> None:
        """停止 HTTP 服务器"""
        if self._runner:
            await self._runner.cleanup()
            self._runner = None
            self._site = None

    def get_server_status(self) -> dict:
        """获取服务器状态"""
        return {
            "running": self._runner is not None,
            "port": self.config["port"],
            "host": self.config["host"],
        }

    def _get_uptime(self) -> float:
        """获取运行时间（秒）"""
        return time.time() - self._start_time

    def _get_system_info(self) -> SystemInfo:
        """获取系统信息"""
        import platform
        import sys

        memory_usage = {}
        cpu_usage = {}

        try:
            import psutil
            process = psutil.Process()
            memory_info = process.memory_info()
            memory_usage = {
                "rss": memory_info.rss,
                "vms": memory_info.vms,
            }
            cpu_percent = process.cpu_percent()
            cpu_usage = {
                "percent": cpu_percent,
            }
        except ImportError:
            pass

        return SystemInfo(
            platform=platform.system(),
            python_version=sys.version,
            memory_usage=memory_usage,
            cpu_usage=cpu_usage,
        )

    async def _get_health_status(self) -> HealthStatus:
        """获取健康状态"""
        if self._health_checker:
            try:
                result = self._health_checker()
                if asyncio.iscoroutine(result):
                    result = await result
                return result if isinstance(result, HealthStatus) else HealthStatus(result)
            except Exception:
                return HealthStatus.UNHEALTHY

        # 默认健康状态
        status = HealthStatus.HEALTHY

        # 检查 WebSocket 连接状态
        if self._websocket_client:
            if not self._websocket_client.is_connected():
                status = HealthStatus.DEGRADED

        return status

    async def _get_nanobot_status(self) -> NanobotStatus:
        """获取 Nanobot 状态"""
        if self._status_provider:
            try:
                result = self._status_provider()
                if asyncio.iscoroutine(result):
                    result = await result
                return result if isinstance(result, NanobotStatus) else NanobotStatus(**result)
            except Exception:
                pass

        return NanobotStatus(
            did=self.config["nanobot_did"],
            state="unknown",
        )

    def _get_websocket_status(self) -> dict:
        """获取 WebSocket 状态"""
        if self._websocket_client:
            state = self._websocket_client.state
            return {
                "connected": state.connected,
                "lastConnected": state.last_connected,
                "reconnectAttempts": state.reconnect_attempts,
                "error": state.error,
            }
        return {
            "connected": False,
        }

    async def _handle_health(self, request: web.Request) -> web.Response:
        """处理 /health 请求"""
        status = await self._get_health_status()

        response = HealthResponse(
            status=status,
            timestamp=time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            uptime=self._get_uptime(),
            version=self.config["version"],
        )

        status_code = 503 if status == HealthStatus.UNHEALTHY else 200
        return web.json_response(response.to_dict(), status=status_code)

    async def _handle_status(self, request: web.Request) -> web.Response:
        """处理 /status 请求"""
        health_status = await self._get_health_status()
        nanobot_status = await self._get_nanobot_status()
        system_info = self._get_system_info()
        ws_status = self._get_websocket_status()

        health_response = HealthResponse(
            status=health_status,
            timestamp=time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            uptime=self._get_uptime(),
            version=self.config["version"],
        )

        response = StatusResponse(
            health=health_response,
            system=system_info,
            nanobot=nanobot_status,
            websocket=ws_status,
        )

        status_code = 503 if health_status == HealthStatus.UNHEALTHY else 200
        return web.json_response(response.to_dict(), status=status_code)

    async def _handle_ready(self, request: web.Request) -> web.Response:
        """处理 /ready 请求 - 就绪探针"""
        is_ready = self._runner is not None

        # 如果有 WebSocket 客户端，检查是否需要连接
        if self._websocket_client and not self._websocket_client.is_connected():
            is_ready = False

        response = {
            "ready": is_ready,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        }

        return web.json_response(response, status=200 if is_ready else 503)

    async def _handle_live(self, request: web.Request) -> web.Response:
        """处理 /live 请求 - 存活探针"""
        response = {
            "alive": True,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "uptime": self._get_uptime(),
        }

        return web.json_response(response, status=200)


# ============================================================================
# 工具函数
# ============================================================================

def create_default_health_checker(
    ws_client: Optional[Any] = None
) -> Callable[[], HealthStatus]:
    """创建默认的健康检查器"""
    def checker() -> HealthStatus:
        if not ws_client:
            return HealthStatus.HEALTHY
        return HealthStatus.HEALTHY if ws_client.is_connected() else HealthStatus.DEGRADED
    return checker


def create_simple_status_provider(
    nanobot_did: str,
    get_state: Callable[[], str],
    get_active_tasks: Callable[[], int] = lambda: 0,
    get_queued_tasks: Callable[[], int] = lambda: 0,
    get_current_task_id: Callable[[], Optional[str]] = lambda: None,
) -> Callable[[], NanobotStatus]:
    """创建简单的状态提供器"""
    def provider() -> NanobotStatus:
        return NanobotStatus(
            did=nanobot_did,
            state=get_state(),
            active_tasks=get_active_tasks(),
            queued_tasks=get_queued_tasks(),
            current_task_id=get_current_task_id(),
        )
    return provider
