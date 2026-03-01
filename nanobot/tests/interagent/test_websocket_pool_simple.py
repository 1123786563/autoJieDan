"""
WebSocket 连接池简单功能测试
验证核心功能而不依赖完整的 WebSocket 协议模拟
"""

import pytest
import asyncio
from unittest.mock import AsyncMock, patch

from nanobot.interagent.websocket import (
    WebSocketConnectionPool,
    PoolConfig,
    PoolStats,
    WebSocketConfig,
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
        min_size=1,
        max_size=3,
        idle_timeout=30.0,
        max_lifetime=300.0,
        acquire_timeout=2.0,
        health_check_interval=60.0,  # 较长的间隔避免干扰测试
    )


# ============================================================================
# 基础功能测试
# ============================================================================

class TestPoolBasicFunctionality:
    """测试连接池基础功能"""

    @pytest.mark.asyncio
    async def test_pool_initialization(self, ws_config, pool_config):
        """测试连接池初始化"""
        pool = WebSocketConnectionPool(ws_config, pool_config)

        assert pool.is_running() is False
        assert len(pool._connections) == 0
        assert pool._stats.total_acquisitions == 0

    @pytest.mark.asyncio
    async def test_pool_starts_without_connections(self, ws_config, pool_config):
        """测试连接池可以在没有实际连接的情况下启动"""
        # 使用不存在的 URL，连接会失败但连接池应该能处理
        config = WebSocketConfig(url="ws://localhost:9999", connection_timeout=0.1)
        pool = WebSocketConnectionPool(config, pool_config)

        # 启动连接池（连接会失败，但不应该阻塞）
        await pool.start()

        # 连接池应该运行中，即使没有连接
        assert pool.is_running() is True

        # 停止连接池
        await pool.stop()
        assert pool.is_running() is False


# ============================================================================
# 配置测试
# ============================================================================

class TestPoolConfiguration:
    """测试连接池配置"""

    def test_pool_config_defaults(self):
        """测试默认配置"""
        config = PoolConfig()

        assert config.min_size == 2
        assert config.max_size == 10
        assert config.idle_timeout == 60.0
        assert config.max_lifetime == 3600.0
        assert config.acquire_timeout == 5.0
        assert config.health_check_interval == 30.0

    def test_websocket_config_defaults(self):
        """测试 WebSocket 配置默认值"""
        config = WebSocketConfig(url="ws://localhost:8080")

        assert config.url == "ws://localhost:8080"
        assert config.reconnect_interval == 5.0
        assert config.ping_interval == 30.0
        assert config.connection_timeout == 10.0
        assert config.max_reconnect_attempts == 5
        assert config.heartbeat_interval == 20.0


# ============================================================================
# 统计测试
# ============================================================================

class TestPoolStatistics:
    """测试连接池统计"""

    def test_stats_initial_values(self):
        """测试统计初始值"""
        stats = PoolStats()

        assert stats.total_connections == 0
        assert stats.active_connections == 0
        assert stats.idle_connections == 0
        assert stats.total_acquisitions == 0
        assert stats.reused_connections == 0
        assert stats.failed_acquisitions == 0
        assert stats.connection_reuse_rate == 0.0

    def test_stats_reuse_rate_calculation(self):
        """测试复用率计算"""
        stats = PoolStats(
            total_acquisitions=100,
            reused_connections=80,
        )

        stats.calculate_reuse_rate()

        assert stats.connection_reuse_rate == 80.0

    def test_stats_reuse_rate_zero_acquisitions(self):
        """测试零获取次数的复用率"""
        stats = PoolStats()

        stats.calculate_reuse_rate()

        assert stats.connection_reuse_rate == 0.0


# ============================================================================
# 连接状态测试
# ============================================================================

class TestConnectionStates:
    """测试连接状态"""

    def test_connection_state_defaults(self):
        """测试连接状态默认值"""
        from nanobot.interagent.websocket import ConnectionState, ConnectionStatus

        state = ConnectionState()

        assert state.connected is False
        assert state.last_connected is None
        assert state.reconnect_attempts == 0
        assert state.error is None
        assert state.status == ConnectionStatus.IDLE
        assert state.last_heartbeat is None
        assert state.messages_sent == 0
        assert state.messages_received == 0


# ============================================================================
# 全局连接池测试
# ============================================================================

class TestGlobalPool:
    """测试全局连接池"""

    @pytest.mark.asyncio
    async def test_get_global_pool_requires_config_first_time(self):
        """测试首次获取全局连接池需要配置"""
        # 重置全局连接池
        import nanobot.interagent.websocket as ws_module
        ws_module._global_pool = None

        with pytest.raises(ValueError, match="ws_config is required"):
            from nanobot.interagent.websocket import get_global_pool
            get_global_pool()

    @pytest.mark.asyncio
    async def test_set_and_get_global_pool(self, ws_config, pool_config):
        """测试设置和获取全局连接池"""
        # 重置全局连接池
        import nanobot.interagent.websocket as ws_module
        ws_module._global_pool = None

        pool = WebSocketConnectionPool(ws_config, pool_config)

        from nanobot.interagent.websocket import set_global_pool, get_global_pool
        set_global_pool(pool)

        assert get_global_pool() is pool


# ============================================================================
# 数据结构测试
# ============================================================================

class TestDataStructures:
    """测试数据结构"""

    def test_pooled_connection_creation(self):
        """测试池化连接创建"""
        from nanobot.interagent.websocket import (
            PooledConnection,
            ConnectionState,
            ConnectionStatus
        )
        import time

        mock_ws = AsyncMock()
        state = ConnectionState(
            connected=True,
            last_connected=time.time(),
            status=ConnectionStatus.CONNECTED,
            last_heartbeat=time.time()
        )

        conn = PooledConnection(
            id="test-conn-1",
            ws=mock_ws,
            state=state,
            created_at=time.time(),
            last_used=time.time()
        )

        assert conn.id == "test-conn-1"
        assert conn.in_use is False
        assert conn.message_handler is None
        assert conn.state.connected is True


# ============================================================================
# 验收标准测试
# ============================================================================

class TestAcceptanceCriteria:
    """测试验收标准"""

    def test_connection_reuse_rate_calculation_acceptance(self):
        """测试连接复用率计算符合验收标准 (>80%)"""
        stats = PoolStats(
            total_acquisitions=10,
            reused_connections=9,  # 90% 复用率
        )

        stats.calculate_reuse_rate()

        # 验收标准：连接复用率 > 80%
        assert stats.connection_reuse_rate > 80.0
        assert stats.connection_reuse_rate == 90.0

    def test_connection_reuse_rate_below_threshold(self):
        """测试连接复用率低于阈值的情况"""
        stats = PoolStats(
            total_acquisitions=10,
            reused_connections=5,  # 50% 复用率
        )

        stats.calculate_reuse_rate()

        # 验收标准：连接复用率 < 80%（不达标）
        assert stats.connection_reuse_rate < 80.0
        assert stats.connection_reuse_rate == 50.0
