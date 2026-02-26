"""
HTTP 连接池测试
"""

import pytest
import asyncio
import socket
from aiohttp import web

from nanobot.interagent.http.pool import (
    ConnectionPool,
    ConnectionPoolConfig,
    PoolStats,
    get_global_pool,
    set_global_pool,
)


# 创建简单的测试服务器
async def create_test_app():
    app = web.Application()

    async def handler(request):
        return web.json_response({"status": "ok", "path": request.path})

    async def error_handler(request):
        raise web.HTTPInternalServerError(text="Internal Error")

    app.router.add_get("/test", handler)
    app.router.add_get("/api", handler)
    app.router.add_get("/error", error_handler)
    app.router.add_post("/post", handler)

    return app


def find_free_port():
    """找一个可用的端口"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        s.listen(1)
        port = s.getsockname()[1]
    return port


@pytest.fixture
def pool():
    # 重置单例以确保每个测试获得新实例
    ConnectionPool._reset_instance()
    config = ConnectionPoolConfig(
        pool_size=10,
        pool_size_per_host=5,
        keepalive_timeout=5.0,
    )
    return ConnectionPool(config)


class TestConnectionPoolConfig:
    """ConnectionPoolConfig 测试"""

    def test_default_config(self):
        """应该有默认配置"""
        config = ConnectionPoolConfig()

        assert config.pool_size == 50
        assert config.pool_size_per_host == 10
        assert config.keepalive_timeout == 30.0
        assert config.connect_timeout == 10.0
        assert config.total_timeout == 30.0

    def test_custom_config(self):
        """应该支持自定义配置"""
        config = ConnectionPoolConfig(
            pool_size=100,
            pool_size_per_host=20,
            keepalive_timeout=60.0,
        )

        assert config.pool_size == 100
        assert config.pool_size_per_host == 20
        assert config.keepalive_timeout == 60.0


class TestConnectionPool:
    """ConnectionPool 测试"""

    @pytest.mark.asyncio
    async def test_get_request(self, pool):
        """应该发送 GET 请求"""
        # 创建测试服务器
        app = await create_test_app()
        runner = web.AppRunner(app)
        await runner.setup()
        port = find_free_port()
        site = web.TCPSite(runner, "127.0.0.1", port)
        await site.start()

        try:
            async with pool:
                url = f"http://127.0.0.1:{port}/test"
                response = await pool.get(url)

                assert response.status == 200
                import json
                body = json.loads(response.body)
                assert body["status"] == "ok"
        finally:
            await runner.cleanup()

    @pytest.mark.asyncio
    async def test_post_request(self, pool):
        """应该发送 POST 请求"""
        app = await create_test_app()
        runner = web.AppRunner(app)
        await runner.setup()
        port = find_free_port()
        site = web.TCPSite(runner, "127.0.0.1", port)
        await site.start()

        try:
            async with pool:
                url = f"http://127.0.0.1:{port}/post"
                response = await pool.post(url, body={"data": "test"})

                assert response.status == 200
        finally:
            await runner.cleanup()

    @pytest.mark.asyncio
    async def test_error_response(self, pool):
        """应该处理错误响应"""
        app = await create_test_app()
        runner = web.AppRunner(app)
        await runner.setup()
        port = find_free_port()
        site = web.TCPSite(runner, "127.0.0.1", port)
        await site.start()

        try:
            async with pool:
                url = f"http://127.0.0.1:{port}/error"
                response = await pool.get(url)

                assert response.status == 500
        finally:
            await runner.cleanup()

    @pytest.mark.asyncio
    async def test_statistics(self, pool):
        """应该跟踪统计"""
        app = await create_test_app()
        runner = web.AppRunner(app)
        await runner.setup()
        port = find_free_port()
        site = web.TCPSite(runner, "127.0.0.1", port)
        await site.start()

        try:
            async with pool:
                url = f"http://127.0.0.1:{port}/test"

                await pool.get(url)
                await pool.get(url)

                stats = pool.get_stats()
                assert stats.total_requests == 2
        finally:
            await runner.cleanup()

    @pytest.mark.asyncio
    async def test_json_method(self, pool):
        """应该解析 JSON 响应"""
        app = await create_test_app()
        runner = web.AppRunner(app)
        await runner.setup()
        port = find_free_port()
        site = web.TCPSite(runner, "127.0.0.1", port)
        await site.start()

        try:
            async with pool:
                url = f"http://127.0.0.1:{port}/api"
                data = await pool.json("GET", url)

                assert data["status"] == "ok"
        finally:
            await runner.cleanup()

    @pytest.mark.asyncio
    async def test_json_error(self, pool):
        """应该抛出错误状态"""
        app = await create_test_app()
        runner = web.AppRunner(app)
        await runner.setup()
        port = find_free_port()
        site = web.TCPSite(runner, "127.0.0.1", port)
        await site.start()

        try:
            async with pool:
                url = f"http://127.0.0.1:{port}/error"

                with pytest.raises(RuntimeError) as exc_info:
                    await pool.json("GET", url)

                assert "HTTP 500" in str(exc_info.value)
        finally:
            await runner.cleanup()

    @pytest.mark.asyncio
    async def test_close_pool(self, pool):
        """应该关闭连接池"""
        async with pool:
            assert pool.is_closed() is False

        assert pool.is_closed() is True

    @pytest.mark.asyncio
    async def test_request_after_close(self, pool):
        """关闭后应该拒绝请求"""
        app = await create_test_app()
        runner = web.AppRunner(app)
        await runner.setup()
        port = find_free_port()
        site = web.TCPSite(runner, "127.0.0.1", port)
        await site.start()

        try:
            async with pool:
                pass  # 自动关闭

            url = f"http://127.0.0.1:{port}/test"

            with pytest.raises(RuntimeError) as exc_info:
                await pool.get(url)

            assert "closed" in str(exc_info.value)
        finally:
            await runner.cleanup()

    @pytest.mark.asyncio
    async def test_singleton(self, pool):
        """应该是单例"""
        pool2 = ConnectionPool()
        assert pool is pool2

    @pytest.mark.asyncio
    async def test_reset_stats(self, pool):
        """应该重置统计"""
        app = await create_test_app()
        runner = web.AppRunner(app)
        await runner.setup()
        port = find_free_port()
        site = web.TCPSite(runner, "127.0.0.1", port)
        await site.start()

        try:
            async with pool:
                url = f"http://127.0.0.1:{port}/test"
                await pool.get(url)

                pool.reset_stats()
                stats = pool.get_stats()
                assert stats.total_requests == 0
        finally:
            await runner.cleanup()


class TestGlobalPool:
    """全局连接池测试"""

    def test_get_global_pool(self):
        """应该获取全局连接池实例"""
        pool = get_global_pool()
        assert pool is not None
        assert pool is get_global_pool()  # 相同实例

    def test_set_global_pool(self):
        """应该设置全局连接池实例"""
        new_pool = ConnectionPool(ConnectionPoolConfig(pool_size=100))
        set_global_pool(new_pool)

        assert get_global_pool() is new_pool
