"""
水平扩展支持测试
"""

import pytest
import asyncio
from datetime import datetime, timedelta

from nanobot.interagent.scaling.cluster import (
    InstanceRegistry,
    LoadBalancer,
    InstanceStatus,
    LoadBalanceStrategy,
    InstanceInfo,
    ClusterStats,
)


class TestInstanceRegistry:
    """InstanceRegistry 测试"""

    def test_register_instance(self):
        """应该注册实例"""
        registry = InstanceRegistry()
        instance = InstanceInfo(
            id="instance-1",
            url="http://localhost:3001",
            status=InstanceStatus.HEALTHY,
            load=0.5,
        )

        registry.register(instance)

        assert registry.size == 1
        assert registry.get_instance("instance-1") is not None

    def test_register_emits_event(self):
        """注册实例应该触发事件"""
        registry = InstanceRegistry()
        registered = []

        registry.on("registered", lambda i: registered.append(i))

        instance = InstanceInfo(
            id="instance-1",
            url="http://localhost:3001",
            status=InstanceStatus.HEALTHY,
            load=0.5,
        )
        registry.register(instance)

        assert len(registered) == 1

    def test_update_instance(self):
        """应该更新已存在的实例"""
        registry = InstanceRegistry()

        registry.register(
            InstanceInfo(
                id="instance-1",
                url="http://localhost:3001",
                status=InstanceStatus.HEALTHY,
                load=0.5,
            )
        )

        registry.register(
            InstanceInfo(
                id="instance-1",
                url="http://localhost:3002",
                status=InstanceStatus.HEALTHY,
                load=0.3,
            )
        )

        instance = registry.get_instance("instance-1")
        assert instance.url == "http://localhost:3002"
        assert registry.size == 1

    def test_deregister_instance(self):
        """应该注销实例"""
        registry = InstanceRegistry()
        registry.register(
            InstanceInfo(
                id="instance-1",
                url="http://localhost:3001",
                status=InstanceStatus.HEALTHY,
                load=0.5,
            )
        )

        result = registry.deregister("instance-1")
        assert result is True
        assert registry.size == 0

    def test_deregister_non_existent(self):
        """注销不存在的实例应该返回 False"""
        registry = InstanceRegistry()
        result = registry.deregister("non-existent")
        assert result is False

    def test_heartbeat(self):
        """应该更新心跳"""
        registry = InstanceRegistry()
        registry.register(
            InstanceInfo(
                id="instance-1",
                url="http://localhost:3001",
                status=InstanceStatus.HEALTHY,
                load=0.5,
            )
        )

        result = registry.heartbeat("instance-1", 0.8)
        assert result is True
        assert registry.get_instance("instance-1").load == 0.8

    def test_heartbeat_updates_status(self):
        """心跳应该能更新状态"""
        registry = InstanceRegistry()
        registry.register(
            InstanceInfo(
                id="instance-1",
                url="http://localhost:3001",
                status=InstanceStatus.HEALTHY,
                load=0.5,
            )
        )

        registry.heartbeat("instance-1", 0.5, InstanceStatus.DEGRADED)
        assert registry.get_instance("instance-1").status == InstanceStatus.DEGRADED

    def test_get_healthy_instances(self):
        """应该只返回健康实例"""
        registry = InstanceRegistry()

        registry.register(
            InstanceInfo(
                id="instance-1",
                url="http://localhost:3001",
                status=InstanceStatus.HEALTHY,
                load=0.5,
            )
        )
        registry.register(
            InstanceInfo(
                id="instance-2",
                url="http://localhost:3002",
                status=InstanceStatus.UNHEALTHY,
                load=0.5,
            )
        )
        registry.register(
            InstanceInfo(
                id="instance-3",
                url="http://localhost:3003",
                status=InstanceStatus.DEGRADED,
                load=0.5,
            )
        )

        healthy = registry.get_healthy_instances()
        assert len(healthy) == 2

    def test_select_instance_least_load(self):
        """应该选择负载最低的实例"""
        registry = InstanceRegistry()

        registry.register(
            InstanceInfo(
                id="instance-1",
                url="http://localhost:3001",
                status=InstanceStatus.HEALTHY,
                load=0.8,
            )
        )
        registry.register(
            InstanceInfo(
                id="instance-2",
                url="http://localhost:3002",
                status=InstanceStatus.HEALTHY,
                load=0.3,
            )
        )

        selected = registry.select_instance(LoadBalanceStrategy.LEAST_LOAD)
        assert selected.id == "instance-2"

    def test_select_instance_round_robin(self):
        """应该轮询选择实例"""
        registry = InstanceRegistry()

        registry.register(
            InstanceInfo(
                id="instance-1",
                url="http://localhost:3001",
                status=InstanceStatus.HEALTHY,
                load=0.5,
            )
        )
        registry.register(
            InstanceInfo(
                id="instance-2",
                url="http://localhost:3002",
                status=InstanceStatus.HEALTHY,
                load=0.5,
            )
        )

        first = registry.select_instance(LoadBalanceStrategy.ROUND_ROBIN)
        second = registry.select_instance(LoadBalanceStrategy.ROUND_ROBIN)

        # 应该轮流选择
        ids = [first.id, second.id]
        assert "instance-1" in ids
        assert "instance-2" in ids

    def test_select_instance_empty(self):
        """没有实例时应该返回 None"""
        registry = InstanceRegistry()
        selected = registry.select_instance(LoadBalanceStrategy.LEAST_LOAD)
        assert selected is None

    def test_get_stats(self):
        """应该返回正确的统计信息"""
        registry = InstanceRegistry()

        registry.register(
            InstanceInfo(
                id="instance-1",
                url="http://localhost:3001",
                status=InstanceStatus.HEALTHY,
                load=0.5,
            )
        )
        registry.register(
            InstanceInfo(
                id="instance-2",
                url="http://localhost:3002",
                status=InstanceStatus.UNHEALTHY,
                load=0.3,
            )
        )

        stats = registry.get_stats()
        assert stats.total_instances == 2
        assert stats.healthy_instances == 1
        assert stats.unhealthy_instances == 1
        assert stats.average_load == 0.4


class TestLoadBalancer:
    """LoadBalancer 测试"""

    @pytest.fixture
    def setup(self):
        """设置测试环境"""
        registry = InstanceRegistry()
        registry.register(
            InstanceInfo(
                id="instance-1",
                url="http://localhost:3001",
                status=InstanceStatus.HEALTHY,
                load=0.5,
            )
        )
        registry.register(
            InstanceInfo(
                id="instance-2",
                url="http://localhost:3002",
                status=InstanceStatus.HEALTHY,
                load=0.3,
            )
        )
        load_balancer = LoadBalancer(registry, LoadBalanceStrategy.LEAST_LOAD)
        return registry, load_balancer

    def test_select_instance(self, setup):
        """应该根据策略选择实例"""
        registry, lb = setup
        selected = lb.select_instance()
        assert selected is not None
        assert selected.id == "instance-2"  # least load

    def test_session_affinity(self, setup):
        """应该使用会话亲和性"""
        registry, lb = setup

        first = lb.select_instance("session-1")
        second = lb.select_instance("session-1")

        assert first.id == second.id

    def test_clear_session_affinity(self, setup):
        """应该清除会话亲和性"""
        registry, lb = setup

        lb.select_instance("session-1")
        lb.clear_session_affinity("session-1")

        # 清除后可能得到不同的实例
        selected = lb.select_instance("session-1")
        assert selected is not None

    def test_set_strategy(self, setup):
        """应该能设置策略"""
        registry, lb = setup
        lb.set_strategy(LoadBalanceStrategy.ROUND_ROBIN)

        # 只验证不抛异常
        selected = lb.select_instance()
        assert selected is not None

    @pytest.mark.asyncio
    async def test_route_request(self, setup):
        """应该路由请求到选中的实例"""

        async def executor(instance, request):
            return {"status": "ok", "instanceId": instance.id}

        registry, lb = setup
        result = await lb.route_request({"data": "test"}, executor)

        assert result["response"]["status"] == "ok"
        assert result["instance"].id == "instance-2"

    @pytest.mark.asyncio
    async def test_route_request_no_instances(self, setup):
        """没有健康实例时应该抛出异常"""

        async def executor(instance, request):
            return {"status": "ok"}

        registry, lb = setup
        registry.deregister("instance-1")
        registry.deregister("instance-2")

        with pytest.raises(RuntimeError, match="No healthy instances"):
            await lb.route_request({"data": "test"}, executor)


class TestInstanceStatus:
    """InstanceStatus 测试"""

    def test_status_values(self):
        """应该有正确的状态值"""
        assert InstanceStatus.HEALTHY.value == "healthy"
        assert InstanceStatus.DEGRADED.value == "degraded"
        assert InstanceStatus.UNHEALTHY.value == "unhealthy"


class TestLoadBalanceStrategy:
    """LoadBalanceStrategy 测试"""

    def test_strategy_values(self):
        """应该有正确的策略值"""
        assert LoadBalanceStrategy.ROUND_ROBIN.value == "round-robin"
        assert LoadBalanceStrategy.LEAST_LOAD.value == "least-load"
        assert LoadBalanceStrategy.RANDOM.value == "random"
