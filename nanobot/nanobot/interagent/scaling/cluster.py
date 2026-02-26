"""
水平扩展支持模块
实现多实例水平扩展能力

@module interagent.scaling.cluster
@version 1.0.0
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Callable, TypeVar, Generic
from collections.abc import Awaitable
import asyncio
import random


# ============================================================================
# Types
# ============================================================================


class InstanceStatus(str, Enum):
    """实例状态"""

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"


class LoadBalanceStrategy(str, Enum):
    """负载均衡策略"""

    ROUND_ROBIN = "round-robin"
    LEAST_LOAD = "least-load"
    RANDOM = "random"


@dataclass
class InstanceInfo:
    """实例信息"""

    id: str
    """实例 ID"""

    url: str
    """实例 URL"""

    status: InstanceStatus = InstanceStatus.HEALTHY
    """实例状态"""

    load: float = 0.0
    """当前负载 (0-1)"""

    last_heartbeat: datetime = field(default_factory=datetime.now)
    """最后心跳时间"""

    metadata: Dict[str, Any] = field(default_factory=dict)
    """元数据"""


@dataclass
class ClusterStats:
    """集群统计"""

    total_instances: int = 0
    """总实例数"""

    healthy_instances: int = 0
    """健康实例数"""

    degraded_instances: int = 0
    """降级实例数"""

    unhealthy_instances: int = 0
    """不健康实例数"""

    total_load: float = 0.0
    """总负载"""

    average_load: float = 0.0
    """平均负载"""


T = TypeVar("T")


# ============================================================================
# InstanceRegistry Class
# ============================================================================


class InstanceRegistry:
    """
    实例注册表

    管理集群中的所有实例，提供注册、发现和健康检查功能

    Example:
        registry = InstanceRegistry()

        # 注册实例
        registry.register(InstanceInfo(
            id='instance-1',
            url='http://localhost:3001',
            status=InstanceStatus.HEALTHY,
            load=0.5,
        ))

        # 获取健康实例
        healthy = registry.get_healthy_instances()

        # 选择实例
        selected = registry.select_instance(LoadBalanceStrategy.LEAST_LOAD)
    """

    def __init__(self, heartbeat_timeout: float = 60.0):
        """
        初始化实例注册表

        Args:
            heartbeat_timeout: 心跳超时时间 (秒)
        """
        self._instances: Dict[str, InstanceInfo] = {}
        self._heartbeat_timeout = heartbeat_timeout
        self._round_robin_index = 0
        self._listeners: Dict[str, List[Callable]] = {
            "registered": [],
            "deregistered": [],
            "updated": [],
            "heartbeat": [],
        }

    def on(self, event: str, callback: Callable) -> None:
        """注册事件监听器"""
        if event in self._listeners:
            self._listeners[event].append(callback)

    def off(self, event: str, callback: Callable) -> None:
        """移除事件监听器"""
        if event in self._listeners and callback in self._listeners[event]:
            self._listeners[event].remove(callback)

    def _emit(self, event: str, data: Any) -> None:
        """触发事件"""
        for callback in self._listeners.get(event, []):
            try:
                callback(data)
            except Exception:
                pass

    def register(
        self,
        instance: InstanceInfo,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        注册实例

        Args:
            instance: 实例信息
            metadata: 可选的元数据
        """
        instance.last_heartbeat = datetime.now()
        if metadata:
            instance.metadata = {**instance.metadata, **metadata}

        is_new = instance.id not in self._instances
        self._instances[instance.id] = instance

        if is_new:
            self._emit("registered", instance)
        else:
            self._emit("updated", instance)

    def deregister(self, instance_id: str) -> bool:
        """
        注销实例

        Args:
            instance_id: 实例 ID

        Returns:
            是否成功注销
        """
        instance = self._instances.get(instance_id)
        if instance:
            del self._instances[instance_id]
            self._emit("deregistered", instance)
            return True
        return False

    def heartbeat(
        self,
        instance_id: str,
        load: float,
        status: Optional[InstanceStatus] = None,
    ) -> bool:
        """
        更新心跳

        Args:
            instance_id: 实例 ID
            load: 当前负载
            status: 可选的状态更新

        Returns:
            是否成功更新
        """
        instance = self._instances.get(instance_id)
        if instance:
            instance.last_heartbeat = datetime.now()
            instance.load = max(0.0, min(1.0, load))
            if status:
                instance.status = status
            self._emit("heartbeat", instance)
            return True
        return False

    def get_instance(self, instance_id: str) -> Optional[InstanceInfo]:
        """获取实例"""
        return self._instances.get(instance_id)

    def get_all_instances(self) -> List[InstanceInfo]:
        """获取所有实例"""
        return list(self._instances.values())

    def get_healthy_instances(self) -> List[InstanceInfo]:
        """获取健康实例"""
        now = datetime.now()
        timeout_seconds = self._heartbeat_timeout

        return [
            i
            for i in self._instances.values()
            if i.status in (InstanceStatus.HEALTHY, InstanceStatus.DEGRADED)
            and (now - i.last_heartbeat).total_seconds() < timeout_seconds
        ]

    def get_instances_by_status(self, status: InstanceStatus) -> List[InstanceInfo]:
        """按状态获取实例"""
        return [i for i in self._instances.values() if i.status == status]

    def select_instance(
        self, strategy: LoadBalanceStrategy = LoadBalanceStrategy.LEAST_LOAD
    ) -> Optional[InstanceInfo]:
        """
        选择实例

        Args:
            strategy: 负载均衡策略

        Returns:
            选中的实例或 None
        """
        healthy = self.get_healthy_instances()
        if not healthy:
            return None

        if strategy == LoadBalanceStrategy.LEAST_LOAD:
            return min(healthy, key=lambda i: i.load)

        if strategy == LoadBalanceStrategy.ROUND_ROBIN:
            self._round_robin_index = (self._round_robin_index + 1) % len(healthy)
            return healthy[self._round_robin_index]

        # RANDOM
        return random.choice(healthy)

    def check_health(self) -> Dict[str, List[str]]:
        """
        检查实例健康状态

        Returns:
            包含 healthy 和 unhealthy 列表的字典
        """
        now = datetime.now()
        timeout_seconds = self._heartbeat_timeout

        healthy = []
        unhealthy = []

        for instance_id, instance in self._instances.items():
            if (
                instance.status == InstanceStatus.HEALTHY
                and (now - instance.last_heartbeat).total_seconds() < timeout_seconds
            ):
                healthy.append(instance_id)
            else:
                unhealthy.append(instance_id)

        return {"healthy": healthy, "unhealthy": unhealthy}

    def get_stats(self) -> ClusterStats:
        """获取统计信息"""
        instances = list(self._instances.values())
        total = len(instances)

        if total == 0:
            return ClusterStats()

        healthy = sum(1 for i in instances if i.status == InstanceStatus.HEALTHY)
        degraded = sum(1 for i in instances if i.status == InstanceStatus.DEGRADED)
        unhealthy = sum(1 for i in instances if i.status == InstanceStatus.UNHEALTHY)
        total_load = sum(i.load for i in instances)

        return ClusterStats(
            total_instances=total,
            healthy_instances=healthy,
            degraded_instances=degraded,
            unhealthy_instances=unhealthy,
            total_load=total_load,
            average_load=total_load / total,
        )

    def clear(self) -> None:
        """清空所有实例"""
        self._instances.clear()
        self._round_robin_index = 0

    @property
    def size(self) -> int:
        """获取实例数量"""
        return len(self._instances)


# ============================================================================
# LoadBalancer Class
# ============================================================================


class LoadBalancer:
    """
    负载均衡器

    根据策略将请求路由到合适的实例

    Example:
        registry = InstanceRegistry()
        load_balancer = LoadBalancer(registry)

        # 选择实例
        result = load_balancer.select_instance()
        if result:
            print(f"Routing to {result.url}")
    """

    def __init__(
        self,
        registry: InstanceRegistry,
        strategy: LoadBalanceStrategy = LoadBalanceStrategy.LEAST_LOAD,
    ):
        """
        初始化负载均衡器

        Args:
            registry: 实例注册表
            strategy: 负载均衡策略
        """
        self._registry = registry
        self._strategy = strategy
        self._session_affinity: Dict[str, str] = {}

    def set_strategy(self, strategy: LoadBalanceStrategy) -> None:
        """设置负载均衡策略"""
        self._strategy = strategy

    def select_instance(self, session_id: Optional[str] = None) -> Optional[InstanceInfo]:
        """
        选择实例

        Args:
            session_id: 可选的会话 ID，用于会话亲和性

        Returns:
            选中的实例或 None
        """
        # 会话亲和性检查
        if session_id:
            affinity_instance_id = self._session_affinity.get(session_id)
            if affinity_instance_id:
                instance = self._registry.get_instance(affinity_instance_id)
                if instance and instance.status != InstanceStatus.UNHEALTHY:
                    return instance
                # 实例不健康，移除亲和性
                del self._session_affinity[session_id]

        instance = self._registry.select_instance(self._strategy)
        if not instance:
            return None

        # 设置会话亲和性
        if session_id:
            self._session_affinity[session_id] = instance.id

        return instance

    async def route_request(
        self,
        request: T,
        executor: Callable[[InstanceInfo, T], Awaitable[Any]],
        session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        路由请求

        Args:
            request: 请求对象
            executor: 执行函数
            session_id: 可选的会话 ID

        Returns:
            包含 response 和 instance 的字典

        Raises:
            RuntimeError: 没有可用的健康实例
        """
        instance = self.select_instance(session_id)
        if not instance:
            raise RuntimeError("No healthy instances available")

        try:
            response = await executor(instance, request)
            return {"response": response, "instance": instance}
        except Exception:
            # 故障转移：尝试其他实例
            retry_instance = self._registry.select_instance(LoadBalanceStrategy.RANDOM)
            if retry_instance and retry_instance.id != instance.id:
                response = await executor(retry_instance, request)
                return {"response": response, "instance": retry_instance}
            raise

    def clear_session_affinity(self, session_id: Optional[str] = None) -> None:
        """清除会话亲和性"""
        if session_id:
            self._session_affinity.pop(session_id, None)
        else:
            self._session_affinity.clear()

    @property
    def registry(self) -> InstanceRegistry:
        """获取注册表"""
        return self._registry
