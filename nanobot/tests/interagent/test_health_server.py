"""
Nanobot 健康检查服务器测试

@module tests.interagent.test_health_server
"""

import pytest
import asyncio
import time

# 检查 aiohttp 是否可用
pytest.importorskip("aiohttp")

from aiohttp import test_utils, web

from nanobot.interagent.health_server import (
    HealthCheckServer,
    HealthStatus,
    HealthResponse,
    StatusResponse,
    SystemInfo,
    NanobotStatus,
    create_default_health_checker,
    create_simple_status_provider,
)


class TestHealthStatus:
    """健康状态枚举测试"""

    def test_health_status_values(self):
        """测试健康状态值"""
        assert HealthStatus.HEALTHY.value == "healthy"
        assert HealthStatus.DEGRADED.value == "degraded"
        assert HealthStatus.UNHEALTHY.value == "unhealthy"


class TestDataclasses:
    """数据类测试"""

    def test_health_response_to_dict(self):
        """测试健康响应序列化"""
        response = HealthResponse(
            status=HealthStatus.HEALTHY,
            timestamp="2026-02-26T00:00:00.000Z",
            uptime=100.5,
            version="1.0.0",
        )
        data = response.to_dict()

        assert data["status"] == "healthy"
        assert data["timestamp"] == "2026-02-26T00:00:00.000Z"
        assert data["uptime"] == 100.5
        assert data["version"] == "1.0.0"

    def test_system_info_to_dict(self):
        """测试系统信息序列化"""
        info = SystemInfo(
            platform="Darwin",
            python_version="3.11.0",
            memory_usage={"rss": 1000000},
            cpu_usage={"percent": 5.0},
        )
        data = info.to_dict()

        assert data["platform"] == "Darwin"
        assert data["pythonVersion"] == "3.11.0"
        assert data["memoryUsage"]["rss"] == 1000000

    def test_nanobot_status_to_dict(self):
        """测试 Nanobot 状态序列化"""
        status = NanobotStatus(
            did="did:anp:nanobot:test",
            state="running",
            active_tasks=2,
            queued_tasks=5,
            current_task_id="task-123",
        )
        data = status.to_dict()

        assert data["did"] == "did:anp:nanobot:test"
        assert data["state"] == "running"
        assert data["activeTasks"] == 2
        assert data["queuedTasks"] == 5
        assert data["currentTaskId"] == "task-123"


class TestHealthCheckServerLifecycle:
    """健康检查服务器生命周期测试"""

    @pytest.mark.asyncio
    async def test_start_and_stop(self):
        """测试服务器启动和停止"""
        server = HealthCheckServer(port=18795, host="127.0.0.1")

        status = server.get_server_status()
        assert status["running"] is False

        await server.start()

        status = server.get_server_status()
        assert status["running"] is True
        assert status["port"] == 18795

        await server.stop()

        status = server.get_server_status()
        assert status["running"] is False

    @pytest.mark.asyncio
    async def test_multiple_start_stop(self):
        """测试多次启动和停止"""
        server = HealthCheckServer(port=18796, host="127.0.0.1")

        for _ in range(3):
            await server.start()
            assert server.get_server_status()["running"] is True
            await server.stop()
            assert server.get_server_status()["running"] is False


class TestHealthCheckServerEndpoints:
    """健康检查服务器端点测试"""

    @pytest.fixture
    async def server_and_client(self):
        """创建测试服务器和客户端"""
        server = HealthCheckServer(port=18797, host="127.0.0.1")
        await server.start()

        # 使用 aiohttp TestClient
        async with test_utils.TestClient(test_utils.TestServer(server._runner.app)) as client:
            yield server, client

        await server.stop()

    @pytest.mark.asyncio
    async def test_health_endpoint(self, server_and_client):
        """测试 /health 端点"""
        server, client = server_and_client
        resp = await client.get("/health")
        data = await resp.json()

        assert resp.status == 200
        assert data["status"] == "healthy"
        assert "uptime" in data
        assert "version" in data

    @pytest.mark.asyncio
    async def test_healthz_endpoint(self, server_and_client):
        """测试 /healthz 端点"""
        server, client = server_and_client
        resp = await client.get("/healthz")
        data = await resp.json()

        assert resp.status == 200
        assert data["status"] == "healthy"

    @pytest.mark.asyncio
    async def test_status_endpoint(self, server_and_client):
        """测试 /status 端点"""
        server, client = server_and_client
        resp = await client.get("/status")
        data = await resp.json()

        assert resp.status == 200
        assert "system" in data
        assert "nanobot" in data
        assert "websocket" in data

    @pytest.mark.asyncio
    async def test_ready_endpoint(self, server_and_client):
        """测试 /ready 端点"""
        server, client = server_and_client
        resp = await client.get("/ready")
        data = await resp.json()

        assert resp.status == 200
        assert data["ready"] is True

    @pytest.mark.asyncio
    async def test_readyz_endpoint(self, server_and_client):
        """测试 /readyz 端点"""
        server, client = server_and_client
        resp = await client.get("/readyz")
        data = await resp.json()

        assert resp.status == 200
        assert data["ready"] is True

    @pytest.mark.asyncio
    async def test_live_endpoint(self, server_and_client):
        """测试 /live 端点"""
        server, client = server_and_client
        resp = await client.get("/live")
        data = await resp.json()

        assert resp.status == 200
        assert data["alive"] is True
        assert "uptime" in data

    @pytest.mark.asyncio
    async def test_livez_endpoint(self, server_and_client):
        """测试 /livez 端点"""
        server, client = server_and_client
        resp = await client.get("/livez")
        data = await resp.json()

        assert resp.status == 200
        assert data["alive"] is True


class TestHealthCheckServerCustom:
    """自定义健康检查器和状态提供器测试"""

    @pytest.mark.asyncio
    async def test_custom_health_checker_degraded(self):
        """测试自定义健康检查器 - DEGRADED 状态"""
        server = HealthCheckServer(port=18798, host="127.0.0.1")
        server.set_health_checker(lambda: HealthStatus.DEGRADED)
        await server.start()

        try:
            async with test_utils.TestClient(test_utils.TestServer(server._runner.app)) as client:
                resp = await client.get("/health")
                data = await resp.json()

                assert data["status"] == "degraded"
        finally:
            await server.stop()

    @pytest.mark.asyncio
    async def test_custom_health_checker_unhealthy(self):
        """测试自定义健康检查器 - UNHEALTHY 状态"""
        server = HealthCheckServer(port=18799, host="127.0.0.1")
        server.set_health_checker(lambda: HealthStatus.UNHEALTHY)
        await server.start()

        try:
            async with test_utils.TestClient(test_utils.TestServer(server._runner.app)) as client:
                resp = await client.get("/health")
                data = await resp.json()

                # UNHEALTHY 应返回 503
                assert resp.status == 503
                assert data["status"] == "unhealthy"
        finally:
            await server.stop()

    @pytest.mark.asyncio
    async def test_custom_status_provider(self):
        """测试自定义状态提供器"""
        server = HealthCheckServer(port=18800, host="127.0.0.1")
        server.set_status_provider(
            create_simple_status_provider(
                nanobot_did="did:anp:nanobot:custom",
                get_state=lambda: "busy",
                get_active_tasks=lambda: 3,
            )
        )
        await server.start()

        try:
            async with test_utils.TestClient(test_utils.TestServer(server._runner.app)) as client:
                resp = await client.get("/status")
                data = await resp.json()

                assert data["nanobot"]["did"] == "did:anp:nanobot:custom"
                assert data["nanobot"]["state"] == "busy"
                assert data["nanobot"]["activeTasks"] == 3
        finally:
            await server.stop()


class TestHelperFunctions:
    """辅助函数测试"""

    def test_create_default_health_checker_no_client(self):
        """测试无客户端的默认健康检查器"""
        checker = create_default_health_checker(None)
        status = checker()
        assert status == HealthStatus.HEALTHY

    def test_create_simple_status_provider(self):
        """测试简单状态提供器"""
        provider = create_simple_status_provider(
            nanobot_did="did:anp:nanobot:test",
            get_state=lambda: "running",
            get_active_tasks=lambda: 1,
            get_queued_tasks=lambda: 2,
            get_current_task_id=lambda: "task-456",
        )

        status = provider()

        assert status.did == "did:anp:nanobot:test"
        assert status.state == "running"
        assert status.active_tasks == 1
        assert status.queued_tasks == 2
        assert status.current_task_id == "task-456"
