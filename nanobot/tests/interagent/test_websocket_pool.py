"""
测试 WebSocket 连接池
"""

import pytest
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch, Mock
from datetime import datetime

from nanobot.interagent.websocket import (
    WebSocketConnectionPool,
    PoolConfig,
    PoolStats,
    WebSocketConfig,
    ConnectionStatus,
    PooledConnection,
    ConnectionState,
    PoolConnectionContext,
    get_global_pool,
    set_global_pool,
    close_global_pool,
)


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture
def ws_config():
    """创建 WebSocket 配置"""
    return WebSocketConfig(
        url="ws://localhost:8080",
        reconnect_interval=1.0,
        ping_interval=30.0,
        connection_timeout=5.0,
        max_reconnect_attempts=3,
    )


@pytest.fixture
def pool_config():
    """创建连接池配置"""
    return PoolConfig(
        min_size=2,
        max_size=5,
        idle_timeout=30.0,
        max_lifetime=300.0,
        acquire_timeout=2.0,
        health_check_interval=5.0,
    )


def create_mock_websocket():
    """创建模拟 WebSocket 连接"""
    ws = AsyncMock()
    ws.send = AsyncMock()
    ws.recv = AsyncMock()
    ws.close = AsyncMock()
    # 让 recv 返回 JSON 字符串而不是 AsyncMock
    ws.recv.return_value = json.dumps({"type": "heartbeat"})
    return ws


async def mock_websocket_connect(*args, **kwargs):
    """模拟 websockets.connect 协程"""
    return create_mock_websocket()


# ============================================================================
# PoolConfig Tests
# ============================================================================

class TestPoolConfig:
    """测试 PoolConfig"""

    def test_default_values(self):
        """测试默认值"""
        config = PoolConfig()

        assert config.min_size == 2
        assert config.max_size == 10
        assert config.idle_timeout == 60.0
        assert config.max_lifetime == 3600.0
        assert config.acquire_timeout == 5.0
        assert config.health_check_interval == 30.0

    def test_custom_values(self):
        """测试自定义值"""
        config = PoolConfig(
            min_size=1,
            max_size=20,
            idle_timeout=120.0,
            acquire_timeout=10.0,
        )

        assert config.min_size == 1
        assert config.max_size == 20
        assert config.idle_timeout == 120.0
        assert config.acquire_timeout == 10.0


# ============================================================================
# PoolStats Tests
# ============================================================================

class TestPoolStats:
    """测试 PoolStats"""

    def test_initial_values(self):
        """测试初始值"""
        stats = PoolStats()

        assert stats.total_connections == 0
        assert stats.active_connections == 0
        assert stats.idle_connections == 0
        assert stats.total_acquisitions == 0
        assert stats.reused_connections == 0
        assert stats.failed_acquisitions == 0
        assert stats.connection_reuse_rate == 0.0

    def test_calculate_reuse_rate(self):
        """测试复用率计算"""
        stats = PoolStats(
            total_acquisitions=100,
            reused_connections=80,
        )

        stats.calculate_reuse_rate()

        assert stats.connection_reuse_rate == 80.0

    def test_calculate_reuse_rate_zero_acquisitions(self):
        """测试零获取次数的复用率"""
        stats = PoolStats()

        stats.calculate_reuse_rate()

        assert stats.connection_reuse_rate == 0.0


# ============================================================================
# WebSocketConnectionPool Tests
# ============================================================================

class TestWebSocketConnectionPool:
    """测试 WebSocketConnectionPool"""

    @pytest.mark.asyncio
    async def test_initial_state(self, ws_config, pool_config):
        """测试初始状态"""
        pool = WebSocketConnectionPool(ws_config, pool_config)

        assert pool.is_running() is False
        assert len(pool._connections) == 0
        assert pool._stats.total_acquisitions == 0

    @pytest.mark.asyncio
    async def test_start_stop(self, ws_config, pool_config):
        """测试启动和停止"""
        with patch("nanobot.interagent.websocket.websockets.connect", side_effect=mock_websocket_connect):
            pool = WebSocketConnectionPool(ws_config, pool_config)
            await pool.start()

            assert pool.is_running() is True
            assert len(pool._connections) >= pool_config.min_size

            await pool.stop()

            assert pool.is_running() is False
            assert len(pool._connections) == 0

    @pytest.mark.asyncio
    async def test_context_manager(self, ws_config, pool_config):
        """测试上下文管理器"""
        with patch("nanobot.interagent.websocket.websockets.connect", side_effect=mock_websocket_connect):
            async with WebSocketConnectionPool(ws_config, pool_config) as pool:
                assert pool.is_running() is True
                assert len(pool._connections) >= pool_config.min_size

            assert pool.is_running() is False

    @pytest.mark.asyncio
    async def test_acquire_release_connection(self, ws_config, pool_config):
        """测试获取和释放连接"""
        with patch("nanobot.interagent.websocket.websockets.connect", side_effect=mock_websocket_connect):
            pool = WebSocketConnectionPool(ws_config, pool_config)
            await pool.start()

            # 获取连接
            context = await pool.acquire()

            assert isinstance(context, PoolConnectionContext)
            assert pool._stats.total_acquisitions == 1

            # 释放连接
            await pool.release(context.id)

            stats = pool.get_stats()
            assert stats.active_connections == 0
            assert stats.idle_connections >= 1

            await pool.stop()

    @pytest.mark.asyncio
    async def test_acquire_timeout(self, ws_config, pool_config):
        """测试获取连接超时"""
        pool = WebSocketConnectionPool(ws_config, pool_config)
        await pool.start()

        # 停止连接池使获取超时
        await pool.stop()

        with pytest.raises((asyncio.TimeoutError, RuntimeError)):
            await pool.acquire(timeout=0.1)

    @pytest.mark.asyncio
    async def test_connection_reuse(self, ws_config, pool_config):
        """测试连接复用"""
        with patch("nanobot.interagent.websocket.websockets.connect", side_effect=mock_websocket_connect):
            pool = WebSocketConnectionPool(ws_config, pool_config)
            await pool.start()

            initial_count = len(pool._connections)

            # 多次获取和释放连接
            for _ in range(5):
                context = await pool.acquire()
                await pool.release(context.id)

            # 验证连接被复用（没有创建新连接）
            assert len(pool._connections) == initial_count
            assert pool._stats.reused_connections > 0

            await pool.stop()

    @pytest.mark.asyncio
    async def test_max_size_limit(self, ws_config, pool_config):
        """测试最大连接数限制"""
        small_pool_config = PoolConfig(min_size=1, max_size=2)

        with patch("nanobot.interagent.websocket.websockets.connect", side_effect=mock_websocket_connect):
            pool = WebSocketConnectionPool(ws_config, small_pool_config)
            await pool.start()

            # 获取所有连接
            contexts = []
            for _ in range(small_pool_config.max_size):
                ctx = await pool.acquire()
                contexts.append(ctx)

            # 验证连接数不超过最大值
            assert len(pool._connections) <= small_pool_config.max_size

            # 释放所有连接
            for ctx in contexts:
                await pool.release(ctx.id)

            await pool.stop()

    @pytest.mark.asyncio
    async def test_send_receive_message(self, ws_config, pool_config):
        """测试发送和接收消息"""
        test_message = {"type": "test", "data": "hello"}
        test_response = {"type": "response", "data": "world"}

        mock_ws = create_mock_websocket()
        mock_ws.recv.return_value = json.dumps(test_response)

        async def mock_connect(*args, **kwargs):
            return mock_ws

        with patch("nanobot.interagent.websocket.websockets.connect", side_effect=mock_connect):
            pool = WebSocketConnectionPool(ws_config, pool_config)
            await pool.start()

            async with await pool.acquire() as conn:
                # 发送消息
                result = await conn.send(test_message)
                assert result is True
                mock_ws.send.assert_called()

                # 接收消息
                response = await conn.receive()
                assert response["type"] == "response"
                assert response["data"] == "world"

            await pool.stop()

    @pytest.mark.asyncio
    async def test_get_stats(self, ws_config, pool_config):
        """测试获取统计信息"""
        with patch("nanobot.interagent.websocket.websockets.connect", side_effect=mock_websocket_connect):
            pool = WebSocketConnectionPool(ws_config, pool_config)
            await pool.start()

            stats = pool.get_stats()

            assert isinstance(stats, PoolStats)
            assert stats.total_connections >= pool_config.min_size
            assert stats.active_connections == 0
            assert stats.idle_connections >= pool_config.min_size

            # 获取连接后检查统计
            context = await pool.acquire()
            stats = pool.get_stats()
            assert stats.active_connections == 1
            assert stats.total_acquisitions == 1

            await pool.release(context.id)
            await pool.stop()

    @pytest.mark.asyncio
    async def test_connection_reuse_rate_calculation(self, ws_config, pool_config):
        """测试连接复用率计算"""
        with patch("nanobot.interagent.websocket.websockets.connect", side_effect=mock_websocket_connect):
            pool = WebSocketConnectionPool(ws_config, pool_config)
            await pool.start()

            # 首次获取连接
            context1 = await pool.acquire()
            await pool.release(context1.id)

            # 再次获取连接（应该复用）
            context2 = await pool.acquire()
            await pool.release(context2.id)

            stats = pool.get_stats()

            # 验证复用率 > 80%（验收标准）
            assert stats.connection_reuse_rate >= 80.0

            await pool.stop()


# ============================================================================
# PoolConnectionContext Tests
# ============================================================================

class TestPoolConnectionContext:
    """测试 PoolConnectionContext"""

    @pytest.mark.asyncio
    async def test_context_manager(self, ws_config, pool_config):
        """测试上下文管理器"""
        with patch("nanobot.interagent.websocket.websockets.connect", side_effect=mock_websocket_connect):
            pool = WebSocketConnectionPool(ws_config, pool_config)
            await pool.start()

            async with await pool.acquire() as conn:
                assert conn.is_connected() is True
                assert isinstance(conn.id, str)

            # 验证连接被释放
            stats = pool.get_stats()
            assert stats.active_connections == 0

            await pool.stop()

    @pytest.mark.asyncio
    async def test_send_via_context(self, ws_config, pool_config):
        """测试通过上下文发送消息"""
        test_message = {"type": "test", "data": "hello"}

        mock_ws = create_mock_websocket()

        async def mock_connect(*args, **kwargs):
            return mock_ws

        with patch("nanobot.interagent.websocket.websockets.connect", side_effect=mock_connect):
            pool = WebSocketConnectionPool(ws_config, pool_config)
            await pool.start()

            async with await pool.acquire() as conn:
                result = await conn.send(test_message)

                assert result is True
                mock_ws.send.assert_called()

            await pool.stop()


# ============================================================================
# Global Pool Tests
# ============================================================================

class TestGlobalPool:
    """测试全局连接池"""

    @pytest.mark.asyncio
    async def test_get_global_pool(self, ws_config, pool_config):
        """测试获取全局连接池"""
        # 重置全局连接池
        import nanobot.interagent.websocket as ws_module
        ws_module._global_pool = None

        pool = get_global_pool(ws_config, pool_config)

        assert isinstance(pool, WebSocketConnectionPool)

    @pytest.mark.asyncio
    async def test_set_global_pool(self, ws_config, pool_config):
        """测试设置全局连接池"""
        # 重置全局连接池
        import nanobot.interagent.websocket as ws_module
        ws_module._global_pool = None

        pool = WebSocketConnectionPool(ws_config, pool_config)
        set_global_pool(pool)

        assert get_global_pool() is pool

    @pytest.mark.asyncio
    async def test_close_global_pool(self, ws_config, pool_config):
        """测试关闭全局连接池"""
        # 重置全局连接池
        import nanobot.interagent.websocket as ws_module
        ws_module._global_pool = None

        with patch("nanobot.interagent.websocket.websockets.connect", side_effect=mock_websocket_connect):
            pool = get_global_pool(ws_config, pool_config)
            await pool.start()

            await close_global_pool()

            assert get_global_pool() is None


# ============================================================================
# Integration Tests
# ============================================================================

class TestWebSocketPoolIntegration:
    """集成测试"""

    @pytest.mark.asyncio
    async def test_concurrent_connections(self, ws_config, pool_config):
        """测试并发连接"""
        with patch("nanobot.interagent.websocket.websockets.connect", side_effect=mock_websocket_connect):
            pool = WebSocketConnectionPool(ws_config, pool_config)
            await pool.start()

            # 并发获取连接
            tasks = [pool.acquire() for _ in range(5)]
            contexts = await asyncio.gather(*tasks)

            # 验证所有连接都有效
            for ctx in contexts:
                assert ctx.is_connected() is True
                await pool.release(ctx.id)

            stats = pool.get_stats()
            assert stats.active_connections == 0

            await pool.stop()

    @pytest.mark.asyncio
    async def test_message_handler_callback(self, ws_config, pool_config):
        """测试消息回调"""
        received_messages = []

        def message_handler(msg):
            received_messages.append(msg)

        test_message = {"type": "test", "data": "callback test"}

        mock_ws = create_mock_websocket()
        mock_ws.recv.return_value = json.dumps(test_message)

        async def mock_connect(*args, **kwargs):
            return mock_ws

        with patch("nanobot.interagent.websocket.websockets.connect", side_effect=mock_connect):
            pool = WebSocketConnectionPool(ws_config, pool_config)
            await pool.start()

            # 获取连接并设置回调
            async with await pool.acquire(on_message=message_handler) as conn:
                # 等待消息接收循环处理消息
                await asyncio.sleep(0.1)

            await pool.stop()
