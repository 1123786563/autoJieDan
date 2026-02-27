"""
ANP 能力发现服务

实现能力查询与响应机制
能力描述缓存与更新

@module interagent.capability_discovery
@version 1.0.0
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from nanobot.anp.types import (
    AgentCapabilityDescription,
    ANPMessage,
    ANPMessageType,
    Capability,
    CapabilityQueryPayload,
    CapabilityResponsePayload,
    DidDocument,
)

logger = logging.getLogger(__name__)


class CapabilityScope(str, Enum):
    """能力范围"""
    LOCAL = "local"  # 本地能力
    REMOTE = "remote"  # 远程能力
    ALL = "all"  # 所有能力


class CacheEntry(BaseModel):
    """缓存条目"""
    did: str
    capabilities: List[Capability]
    cached_at: datetime = Field(default_factory=datetime.utcnow)
    ttl_seconds: int = 3600  # 默认 1 小时 TTL
    access_count: int = 0

    def is_expired(self) -> bool:
        """检查是否过期"""
        elapsed = (datetime.utcnow() - self.cached_at).total_seconds()
        return elapsed > self.ttl_seconds

    def touch(self) -> None:
        """增加访问计数"""
        self.access_count += 1


class CapabilityDiscoveryService:
    """
    ANP 能力发现服务

    功能:
    - 查询本地/远程代理能力
    - 能力描述缓存
    - 能力更新通知
    - 能力过滤与搜索
    """

    def __init__(
        self,
        local_did: str,
        local_capabilities: List[Capability],
        cache_ttl_seconds: int = 3600,
    ):
        """
        初始化能力发现服务

        Args:
            local_did: 本地 DID
            local_capabilities: 本地能力列表
            cache_ttl_seconds: 缓存 TTL（秒）
        """
        self.local_did = local_did
        self.local_capabilities = local_capabilities
        self.cache_ttl_seconds = cache_ttl_seconds

        # 能力缓存：DID -> 能力列表
        self._cache: Dict[str, CacheEntry] = {}
        self._lock = asyncio.Lock()

        # 能力更新订阅者
        self._subscribers: Dict[str, asyncio.Queue] = {}

        # 能力索引（用于快速搜索）
        self._capability_index: Dict[str, List[str]] = {}  # capability_id -> [DIDs]
        self._rebuild_index()

    def _rebuild_index(self) -> None:
        """重建能力索引"""
        self._capability_index.clear()
        for cap in self.local_capabilities:
            if cap.capability_id not in self._capability_index:
                self._capability_index[cap.capability_id] = []
            self._capability_index[cap.capability_id].append(self.local_did)

    async def get_local_capabilities(self) -> List[Capability]:
        """获取本地能力列表"""
        return self.local_capabilities

    async def get_local_capability(self, capability_id: str) -> Optional[Capability]:
        """获取指定的本地能力"""
        for cap in self.local_capabilities:
            if cap.capability_id == capability_id:
                return cap
        return None

    async def query_capabilities(
        self,
        target_did: Optional[str] = None,
        query_type: Literal["all", "filter"] = "all",
        filter_dict: Optional[Dict[str, Any]] = None,
    ) -> List[Capability]:
        """
        查询能力

        Args:
            target_did: 目标 DID（None 表示查询所有）
            query_type: 查询类型（all/filter）
            filter_dict: 过滤条件

        Returns:
            List[Capability]: 能力列表
        """
        if target_did is None or target_did == self.local_did:
            # 查询本地能力
            capabilities = self.local_capabilities.copy()
        else:
            # 查询缓存的远程能力
            capabilities = await self._get_cached_capabilities(target_did)

        # 应用过滤
        if query_type == "filter" and filter_dict:
            capabilities = self._apply_filter(capabilities, filter_dict)

        return capabilities

    def _apply_filter(
        self,
        capabilities: List[Capability],
        filter_dict: Dict[str, Any],
    ) -> List[Capability]:
        """
        应用过滤条件

        支持的过滤字段:
        - name: 能力名称（模糊匹配）
        - capability_id: 能力 ID（精确匹配）
        - supported_languages: 支持的编程语言
        - supported_frameworks: 支持的框架
        - tools: 工具列表
        """
        result = []

        for cap in capabilities:
            match = True

            # 名称过滤
            if "name" in filter_dict:
                if filter_dict["name"].lower() not in cap.name.lower():
                    match = False

            # 能力 ID 过滤
            if "capability_id" in filter_dict:
                if cap.capability_id != filter_dict["capability_id"]:
                    match = False

            # 语言过滤
            if "supported_languages" in filter_dict:
                required_languages = set(filter_dict["supported_languages"])
                available_languages = set(cap.supported_languages)
                if not required_languages.issubset(available_languages):
                    match = False

            # 框架过滤
            if "supported_frameworks" in filter_dict:
                required_frameworks = set(filter_dict["supported_frameworks"])
                available_frameworks = set(cap.supported_frameworks)
                if not required_frameworks.issubset(available_frameworks):
                    match = False

            # 工具过滤
            if "tools" in filter_dict:
                required_tools = set(filter_dict["tools"])
                available_tools = set(cap.tools)
                if not required_tools.issubset(available_tools):
                    match = False

            if match:
                result.append(cap)

        return result

    async def _get_cached_capabilities(self, did: str) -> List[Capability]:
        """从缓存获取能力列表"""
        async with self._lock:
            entry = self._cache.get(did)
            if entry is None or entry.is_expired():
                # 缓存未命中或已过期，返回空列表
                # 实际应用中应该从远程获取
                logger.warning(f"Cache miss for DID {did}")
                return []

            entry.touch()
            return entry.capabilities.copy()

    async def cache_capabilities(
        self,
        did: str,
        capabilities: List[Capability],
        ttl_seconds: Optional[int] = None,
    ) -> None:
        """
        缓存能力列表

        Args:
            did: 代理 DID
            capabilities: 能力列表
            ttl_seconds: 缓存 TTL（秒）
        """
        async with self._lock:
            entry = CacheEntry(
                did=did,
                capabilities=capabilities,
                ttl_seconds=ttl_seconds or self.cache_ttl_seconds,
            )
            self._cache[did] = entry

            # 更新索引
            for cap in capabilities:
                if cap.capability_id not in self._capability_index:
                    self._capability_index[cap.capability_id] = []
                if did not in self._capability_index[cap.capability_id]:
                    self._capability_index[cap.capability_id].append(did)

            logger.info(f"Cached {len(capabilities)} capabilities for DID {did}")

    async def search_capabilities(
        self,
        keyword: str,
        scope: CapabilityScope = CapabilityScope.ALL,
    ) -> List[tuple[Capability, str]]:
        """
        搜索能力

        Args:
            keyword: 搜索关键词
            scope: 搜索范围

        Returns:
            List[tuple[Capability, str]]: [(能力，所属 DID), ...]
        """
        results = []
        keyword_lower = keyword.lower()

        # 搜索本地能力
        if scope in (CapabilityScope.LOCAL, CapabilityScope.ALL):
            for cap in self.local_capabilities:
                if (
                    keyword_lower in cap.name.lower()
                    or keyword_lower in cap.description.lower()
                    or keyword_lower in cap.capability_id.lower()
                ):
                    results.append((cap, self.local_did))

        # 搜索缓存的远程能力
        if scope in (CapabilityScope.REMOTE, CapabilityScope.ALL):
            async with self._lock:
                for did, entry in self._cache.items():
                    if entry.is_expired():
                        continue
                    for cap in entry.capabilities:
                        if (
                            keyword_lower in cap.name.lower()
                            or keyword_lower in cap.description.lower()
                            or keyword_lower in cap.capability_id.lower()
                        ):
                            results.append((cap, did))

        return results

    async def get_capability_providers(self, capability_id: str) -> List[str]:
        """
        获取提供指定能力的代理 DID 列表

        Args:
            capability_id: 能力 ID

        Returns:
            List[str]: 提供者 DID 列表
        """
        async with self._lock:
            return self._capability_index.get(capability_id, []).copy()

    async def subscribe_capability_updates(self, did: str) -> asyncio.Queue:
        """
        订阅能力更新通知

        Args:
            did: 代理 DID

        Returns:
            asyncio.Queue: 更新通知队列
        """
        async with self._lock:
            if did not in self._subscribers:
                self._subscribers[did] = asyncio.Queue()
            return self._subscribers[did]

    async def notify_capability_changed(self, did: str, capabilities: List[Capability]) -> None:
        """
        通知能力已变更

        Args:
            did: 代理 DID
            capabilities: 新的能力列表
        """
        async with self._lock:
            # 更新缓存
            await self.cache_capabilities(did, capabilities)

            # 通知订阅者
            if did in self._subscribers:
                try:
                    await self._subscribers[did].put({
                        "did": did,
                        "capabilities": capabilities,
                        "timestamp": datetime.utcnow().isoformat(),
                    })
                except asyncio.QueueFull:
                    logger.warning(f"Subscriber queue full for DID {did}")

    async def create_capability_query(self) -> CapabilityQueryPayload:
        """创建能力查询负载"""
        return CapabilityQueryPayload(
            queryType="all",
            filter=None,
        )

    async def create_capability_response(
        self,
        capabilities: List[Capability],
    ) -> CapabilityResponsePayload:
        """创建能力响应负载"""
        return CapabilityResponsePayload(
            capabilities=capabilities,
        )

    async def get_capability_statistics(self) -> Dict[str, Any]:
        """获取能力统计信息"""
        async with self._lock:
            total_capabilities = len(self.local_capabilities)
            cached_dids = len([e for e in self._cache.values() if not e.is_expired()])
            total_indexed = len(self._capability_index)

            # 按类型统计
            local_by_type: Dict[str, int] = {}
            for cap in self.local_capabilities:
                cap_type = "unknown"
                if cap.supported_languages:
                    cap_type = "development"
                elif cap.channels:
                    cap_type = "communication"
                local_by_type[cap_type] = local_by_type.get(cap_type, 0) + 1

            return {
                "local_capabilities": total_capabilities,
                "cached_dids": cached_dids,
                "indexed_capability_ids": total_indexed,
                "local_capabilities_by_type": local_by_type,
                "cache_entries": len(self._cache),
                "subscribers": len(self._subscribers),
            }

    async def cleanup_expired_cache(self) -> int:
        """清理过期的缓存条目"""
        async with self._lock:
            expired = []
            for did, entry in list(self._cache.items()):
                if entry.is_expired():
                    expired.append(did)

            for did in expired:
                del self._cache[did]
                logger.info(f"Cleaned up expired cache for DID {did}")

            return len(expired)

    def build_capability_description(
        self,
        name: str,
        description: str,
        capabilities: List[str],
    ) -> AgentCapabilityDescription:
        """
        构建代理能力描述

        Args:
            name: 代理名称
            description: 代理描述
            capabilities: 能力 ID 列表

        Returns:
            AgentCapabilityDescription: 能力描述对象
        """
        return AgentCapabilityDescription(
            name=name,
            description=description,
            capabilities=capabilities,
        )


# 预定义的常见能力模板
COMMON_CAPABILITY_TEMPLATES = {
    "code-generation": Capability(
        capability_id="code-generation",
        name="代码生成",
        description="全栈代码开发、重构、优化",
        supported_languages=["TypeScript", "Python", "Rust", "Go"],
        supported_frameworks=["React", "Next.js", "FastAPI", "Django"],
    ),
    "testing": Capability(
        capability_id="testing",
        name="测试执行",
        description="单元测试、集成测试、E2E 测试",
        tools=["vitest", "pytest", "playwright"],
    ),
    "customer-communication": Capability(
        capability_id="customer-communication",
        name="客户沟通",
        description="需求澄清、进度报告、反馈处理",
        channels=["telegram", "slack", "email", "discord"],
    ),
    "economic-decision": Capability(
        capability_id="economic-decision",
        name="经济决策",
        description="项目筛选、合同评估、资源分配",
    ),
    "project-management": Capability(
        capability_id="project-management",
        name="项目管理",
        description="任务分发、进度跟踪、验收确认",
    ),
    "blockchain-operations": Capability(
        capability_id="blockchain-operations",
        name="区块链操作",
        description="钱包管理、交易签名、智能合约交互",
    ),
}


def get_capability_template(capability_id: str) -> Optional[Capability]:
    """获取预定义的能力模板"""
    return COMMON_CAPABILITY_TEMPLATES.get(capability_id)
