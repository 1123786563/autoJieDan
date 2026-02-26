"""
水平扩展模块
"""

from nanobot.interagent.scaling.cluster import (
    InstanceRegistry,
    LoadBalancer,
    InstanceStatus,
    LoadBalanceStrategy,
    InstanceInfo,
    ClusterStats,
)

__all__ = [
    "InstanceRegistry",
    "LoadBalancer",
    "InstanceStatus",
    "LoadBalanceStrategy",
    "InstanceInfo",
    "ClusterStats",
]
