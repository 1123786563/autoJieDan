"""
ANP DID 解析器
实现远程 DID 文档解析，支持从外部解析器获取 DID 文档

@module anp.resolver
@version 1.0.0
"""

import asyncio
import re
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

import aiohttp
from pydantic import ValidationError

from .types import DidDocument


class ResolutionSource(str, Enum):
    """解析来源"""
    CACHE = "cache"
    NETWORK = "network"
    LOCAL = "local"


@dataclass
class ResolutionMetadata:
    """解析元数据"""
    source: ResolutionSource
    duration_ms: float
    cached: bool


@dataclass
class ResolutionResult:
    """解析结果"""
    success: bool
    document: Optional[DidDocument] = None
    error: Optional[str] = None
    metadata: Optional[ResolutionMetadata] = None


@dataclass
class ResolverConfig:
    """解析器配置"""
    cache_ttl: int = 3600  # 秒
    timeout: int = 5  # 秒
    max_retries: int = 2
    endpoints: Dict[str, str] = field(default_factory=dict)


class DIDResolver(ABC):
    """DID 解析器基类"""

    @abstractmethod
    async def resolve(self, did: str) -> ResolutionResult:
        """
        解析 DID 文档

        Args:
            did: 要解析的 DID

        Returns:
            ResolutionResult: 解析结果
        """
        pass


class HTTPDIDResolver(DIDResolver):
    """
    HTTP/HTTPS DID 解析器

    支持通过 HTTP 解析远程 DID 文档

    Example:
        resolver = HTTPDIDResolver(ResolverConfig(cache_ttl=3600))
        result = await resolver.resolve("did:anp:example.com:agent123")
        if result.success:
            print(result.document)
    """

    def __init__(self, config: Optional[ResolverConfig] = None):
        self._config = config or ResolverConfig()
        self._cache: Dict[str, tuple[DidDocument, float]] = {}

    async def resolve(self, did: str) -> ResolutionResult:
        """解析 DID 文档"""
        start_time = time.time()

        # 1. 验证 DID 格式
        if not self._is_valid_did(did):
            return ResolutionResult(
                success=False,
                error=f"Invalid DID format: {did}",
                metadata=ResolutionMetadata(
                    source=ResolutionSource.LOCAL,
                    duration_ms=0,
                    cached=False
                )
            )

        # 2. 检查缓存
        cached_doc = self._get_from_cache(did)
        if cached_doc:
            return ResolutionResult(
                success=True,
                document=cached_doc,
                metadata=ResolutionMetadata(
                    source=ResolutionSource.CACHE,
                    duration_ms=(time.time() - start_time) * 1000,
                    cached=True
                )
            )

        # 3. 从网络解析
        last_error: Optional[str] = None
        for attempt in range(self._config.max_retries + 1):
            try:
                document = await self._fetch_from_network(did)

                # 存入缓存
                self._add_to_cache(did, document)

                return ResolutionResult(
                    success=True,
                    document=document,
                    metadata=ResolutionMetadata(
                        source=ResolutionSource.NETWORK,
                        duration_ms=(time.time() - start_time) * 1000,
                        cached=False
                    )
                )
            except Exception as e:
                last_error = str(e)

                # 如果是最后一次尝试，不再等待
                if attempt < self._config.max_retries:
                    await asyncio.sleep(0.1 * (attempt + 1))

        return ResolutionResult(
            success=False,
            error=last_error or "Resolution failed",
            metadata=ResolutionMetadata(
                source=ResolutionSource.NETWORK,
                duration_ms=(time.time() - start_time) * 1000,
                cached=False
            )
        )

    def clear_cache(self) -> None:
        """清除缓存"""
        self._cache.clear()

    def prune_cache(self) -> int:
        """清除过期的缓存条目"""
        now = time.time()
        pruned = 0

        for did in list(self._cache.keys()):
            _, expiry = self._cache[did]
            if expiry <= now:
                del self._cache[did]
                pruned += 1

        return pruned

    def get_cache_stats(self) -> Dict[str, Any]:
        """获取缓存统计"""
        oldest: Optional[float] = None

        for _, expiry in self._cache.values():
            if oldest is None or expiry < oldest:
                oldest = expiry

        return {
            "size": len(self._cache),
            "oldest_expiry": oldest
        }

    def _is_valid_did(self, did: str) -> bool:
        """验证 DID 格式"""
        # 支持的 DID 方法: anp, web, key
        pattern = r'^did:(anp|web|key):.+$'
        return bool(re.match(pattern, did))

    def _get_from_cache(self, did: str) -> Optional[DidDocument]:
        """从缓存获取 DID 文档"""
        if did not in self._cache:
            return None

        document, expiry = self._cache[did]

        # 检查是否过期
        if expiry <= time.time():
            del self._cache[did]
            return None

        return document

    def _add_to_cache(self, did: str, document: DidDocument) -> None:
        """添加到缓存"""
        expiry = time.time() + self._config.cache_ttl
        self._cache[did] = (document, expiry)

    async def _fetch_from_network(self, did: str) -> DidDocument:
        """从网络获取 DID 文档"""
        url = self._construct_resolution_url(did)

        timeout = aiohttp.ClientTimeout(total=self._config.timeout)

        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(
                url,
                headers={"Accept": "application/json"}
            ) as response:
                if not response.ok:
                    raise Exception(f"HTTP {response.status}: {response.reason}")

                data = await response.json()

        # 验证并解析文档
        document = self._parse_document(data)

        if not self._validate_document(document, did):
            raise Exception("Invalid DID document")

        return document

    def _parse_document(self, data: Dict[str, Any]) -> DidDocument:
        """解析 DID 文档"""
        try:
            return DidDocument.model_validate(data)
        except ValidationError as e:
            raise Exception(f"Document validation failed: {e}")

    def _construct_resolution_url(self, did: str) -> str:
        """
        构造解析 URL

        did:anp:example.com:agent123 -> https://example.com/.well-known/did/anp/agent123
        did:web:example.com -> https://example.com/.well-known/did.json
        """
        # 检查自定义端点
        if did in self._config.endpoints:
            return self._config.endpoints[did]

        # ANP DID
        anp_match = re.match(r'^did:anp:([^:]+):(.+)$', did)
        if anp_match:
            return f"https://{anp_match.group(1)}/.well-known/did/anp/{anp_match.group(2)}"

        # Web DID
        web_match = re.match(r'^did:web:(.+)$', did)
        if web_match:
            domain = web_match.group(1).replace(":", "/")
            return f"https://{domain}/.well-known/did.json"

        # Key DID - 无法远程解析
        raise Exception(f"Cannot resolve did:key remotely: {did}")

    def _validate_document(self, document: DidDocument, expected_did: str) -> bool:
        """验证 DID 文档"""
        # 检查 DID 匹配
        if document.id != expected_did:
            return False

        # 检查验证方法
        if not document.verification_method:
            return False

        return True


class CompositeResolver(DIDResolver):
    """
    复合 DID 解析器

    支持从多个来源解析 DID 文档，按优先级尝试
    """

    def __init__(self, resolvers: List[DIDResolver]):
        self._resolvers = resolvers

    async def resolve(self, did: str) -> ResolutionResult:
        """解析 DID 文档"""
        start_time = time.time()
        errors: List[str] = []

        for resolver in self._resolvers:
            result = await resolver.resolve(did)

            if result.success:
                return result

            if result.error:
                errors.append(result.error)

        return ResolutionResult(
            success=False,
            error=f"All resolvers failed: {'; '.join(errors)}",
            metadata=ResolutionMetadata(
                source=ResolutionSource.NETWORK,
                duration_ms=(time.time() - start_time) * 1000,
                cached=False
            )
        )


class LocalResolver(DIDResolver):
    """
    本地 DID 解析器

    用于解析本地预配置的 DID 文档
    """

    def __init__(self, documents: Optional[Dict[str, DidDocument]] = None):
        self._documents: Dict[str, DidDocument] = documents or {}

    async def resolve(self, did: str) -> ResolutionResult:
        """解析 DID 文档"""
        start_time = time.time()
        document = self._documents.get(did)

        if document:
            return ResolutionResult(
                success=True,
                document=document,
                metadata=ResolutionMetadata(
                    source=ResolutionSource.LOCAL,
                    duration_ms=(time.time() - start_time) * 1000,
                    cached=False
                )
            )

        return ResolutionResult(
            success=False,
            error=f"DID not found in local store: {did}",
            metadata=ResolutionMetadata(
                source=ResolutionSource.LOCAL,
                duration_ms=(time.time() - start_time) * 1000,
                cached=False
            )
        )

    def add_document(self, did: str, document: DidDocument) -> None:
        """添加本地 DID 文档"""
        self._documents[did] = document

    def remove_document(self, did: str) -> bool:
        """移除本地 DID 文档"""
        if did in self._documents:
            del self._documents[did]
            return True
        return False


# ============================================================================
# 全局解析器实例
# ============================================================================

_global_resolver: Optional[DIDResolver] = None


def get_global_resolver() -> DIDResolver:
    """获取全局 DID 解析器"""
    global _global_resolver
    if _global_resolver is None:
        _global_resolver = HTTPDIDResolver()
    return _global_resolver


def set_global_resolver(resolver: DIDResolver) -> None:
    """设置全局 DID 解析器"""
    global _global_resolver
    _global_resolver = resolver


async def resolve_did(did: str) -> ResolutionResult:
    """解析 DID 文档 (使用全局解析器)"""
    return await get_global_resolver().resolve(did)
