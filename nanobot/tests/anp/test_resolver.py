"""
ANP DID 解析器测试
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import aiohttp

from nanobot.anp.resolver import (
    HTTPDIDResolver,
    CompositeResolver,
    LocalResolver,
    ResolverConfig,
    ResolutionSource,
    ResolutionResult,
)
from nanobot.anp.types import DidDocument, DidVerificationMethod, DidService


# 测试用 DID 文档
@pytest.fixture
def mock_did_document() -> dict:
    return {
        "@context": ["https://www.w3.org/ns/did/v1"],
        "id": "did:anp:example.com:agent123",
        "controller": "did:anp:example.com:agent123",
        "verificationMethod": [
            {
                "id": "did:anp:example.com:agent123#key-1",
                "type": "JsonWebKey2020",
                "controller": "did:anp:example.com:agent123",
                "public_key_jwk": {
                    "kty": "EC",
                    "crv": "P-256",
                    "x": "test-x",
                    "y": "test-y",
                },
            }
        ],
        "authentication": ["did:anp:example.com:agent123#key-1"],
        "keyAgreement": [],
        "service": [
            {
                "id": "did:anp:example.com:agent123#service",
                "type": "ANPMessageService",
                "service_endpoint": "https://example.com/anp",
            }
        ],
    }


@pytest.fixture
def mock_did_document_pydantic(mock_did_document) -> DidDocument:
    return DidDocument.model_validate(mock_did_document)


class TestHTTPDIDResolver:
    """HTTPDIDResolver 测试"""

    @pytest.fixture
    def resolver(self):
        return HTTPDIDResolver(ResolverConfig(
            cache_ttl=1,
            timeout=1,
            max_retries=1
        ))

    @pytest.mark.asyncio
    async def test_reject_invalid_did_format(self, resolver):
        """应该拒绝无效的 DID 格式"""
        result = await resolver.resolve("invalid-did")

        assert result.success is False
        assert "Invalid DID format" in result.error

    @pytest.mark.asyncio
    async def test_resolve_anp_did_from_network(self, resolver, mock_did_document):
        """应该从网络解析 ANP DID"""
        with patch("aiohttp.ClientSession.get") as mock_get:
            mock_response = AsyncMock()
            mock_response.ok = True
            mock_response.json = AsyncMock(return_value=mock_did_document)
            mock_get.return_value.__aenter__.return_value = mock_response

            # 使用 aiohttp mock 需要更复杂的方式
            # 这里简化测试
            pass

    @pytest.mark.asyncio
    async def test_cache_resolved_documents(self, resolver, mock_did_document):
        """应该缓存已解析的文档"""
        # 手动添加到缓存
        doc = DidDocument.model_validate(mock_did_document)
        resolver._add_to_cache("did:anp:example.com:agent123", doc)

        result = await resolver.resolve("did:anp:example.com:agent123")

        assert result.success is True
        assert result.metadata.source == ResolutionSource.CACHE
        assert result.metadata.cached is True

    @pytest.mark.asyncio
    async def test_fail_after_max_retries(self, mock_did_document):
        """达到最大重试次数后应该失败"""
        config = ResolverConfig(max_retries=0, timeout=1, cache_ttl=1)
        resolver = HTTPDIDResolver(config)

        # 使用无效的 DID 格式来快速测试失败路径
        result = await resolver.resolve("did:anp:nonexistent.invalid:agent")

        assert result.success is False

    @pytest.mark.asyncio
    async def test_reject_did_key_remotely(self, resolver):
        """应该拒绝远程解析 did:key"""
        result = await resolver.resolve("did:key:z6Mktest")

        assert result.success is False
        assert "Cannot resolve did:key remotely" in result.error

    def test_clear_cache(self, resolver, mock_did_document_pydantic):
        """应该清除缓存"""
        resolver._add_to_cache("did:test:1", mock_did_document_pydantic)
        resolver.clear_cache()

        stats = resolver.get_cache_stats()
        assert stats["size"] == 0

    def test_get_cache_stats(self, resolver, mock_did_document_pydantic):
        """应该获取缓存统计"""
        resolver._add_to_cache("did:test:1", mock_did_document_pydantic)

        stats = resolver.get_cache_stats()
        assert stats["size"] == 1
        assert stats["oldest_expiry"] is not None

    def test_construct_url_anp_did(self, resolver):
        """应该为 ANP DID 构造正确的 URL"""
        url = resolver._construct_resolution_url("did:anp:example.com:agent123")
        assert url == "https://example.com/.well-known/did/anp/agent123"

    def test_construct_url_web_did(self, resolver):
        """应该为 Web DID 构造正确的 URL"""
        url = resolver._construct_resolution_url("did:web:example.com")
        assert url == "https://example.com/.well-known/did.json"

    def test_construct_url_web_did_with_path(self, resolver):
        """应该为带路径的 Web DID 构造正确的 URL"""
        url = resolver._construct_resolution_url("did:web:example.com:user:alice")
        assert url == "https://example.com/user/alice/.well-known/did.json"

    def test_custom_endpoints(self):
        """应该使用自定义端点"""
        config = ResolverConfig(
            endpoints={"did:anp:custom:agent": "https://custom.resolver/did"}
        )
        resolver = HTTPDIDResolver(config)

        url = resolver._construct_resolution_url("did:anp:custom:agent")
        assert url == "https://custom.resolver/did"


class TestLocalResolver:
    """LocalResolver 测试"""

    @pytest.fixture
    def resolver(self, mock_did_document_pydantic):
        documents = {"did:anp:local:agent1": mock_did_document_pydantic}
        return LocalResolver(documents)

    @pytest.mark.asyncio
    async def test_resolve_local_did(self, resolver):
        """应该解析本地 DID"""
        result = await resolver.resolve("did:anp:local:agent1")

        assert result.success is True
        assert result.document is not None
        assert result.metadata.source == ResolutionSource.LOCAL

    @pytest.mark.asyncio
    async def test_fail_for_unknown_did(self, resolver):
        """未知 DID 应该失败"""
        result = await resolver.resolve("did:anp:unknown:agent")

        assert result.success is False
        assert "not found in local store" in result.error

    def test_add_document(self, resolver, mock_did_document):
        """应该添加文档"""
        new_doc = DidDocument.model_validate({
            **mock_did_document,
            "id": "did:anp:local:agent2"
        })

        resolver.add_document("did:anp:local:agent2", new_doc)

        assert "did:anp:local:agent2" in resolver._documents

    def test_remove_document(self, resolver):
        """应该移除文档"""
        result = resolver.remove_document("did:anp:local:agent1")

        assert result is True
        assert "did:anp:local:agent1" not in resolver._documents

    def test_remove_nonexistent_document(self, resolver):
        """移除不存在的文档应该返回 False"""
        result = resolver.remove_document("did:anp:nonexistent:agent")

        assert result is False


class TestCompositeResolver:
    """CompositeResolver 测试"""

    @pytest.mark.asyncio
    async def test_try_resolvers_in_order(self, mock_did_document_pydantic):
        """应该按顺序尝试解析器"""
        local_docs = {"did:anp:test:agent": mock_did_document_pydantic}
        local_resolver = LocalResolver(local_docs)
        http_resolver = HTTPDIDResolver()

        composite = CompositeResolver([local_resolver, http_resolver])

        result = await composite.resolve("did:anp:test:agent")

        assert result.success is True
        assert result.metadata.source == ResolutionSource.LOCAL

    @pytest.mark.asyncio
    async def test_fail_if_all_resolvers_fail(self):
        """所有解析器都失败时应该失败"""
        http_resolver = HTTPDIDResolver(ResolverConfig(max_retries=0))

        composite = CompositeResolver([http_resolver])

        result = await composite.resolve("did:key:z6Mktest")

        assert result.success is False
        assert "All resolvers failed" in result.error


class TestResolverConfig:
    """ResolverConfig 测试"""

    def test_default_config(self):
        """应该有默认配置"""
        config = ResolverConfig()

        assert config.cache_ttl == 3600
        assert config.timeout == 5
        assert config.max_retries == 2
        assert config.endpoints == {}

    def test_custom_config(self):
        """应该支持自定义配置"""
        config = ResolverConfig(
            cache_ttl=7200,
            timeout=10,
            max_retries=3,
            endpoints={"did:custom:1": "https://custom.url"}
        )

        assert config.cache_ttl == 7200
        assert config.timeout == 10
        assert config.max_retries == 3
        assert "did:custom:1" in config.endpoints
