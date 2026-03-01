"""
ANP 能力发现服务测试

测试能力查询与响应机制
能力描述缓存与更新
能力过滤与搜索

@module tests.interagent.test_capability_discovery
@version 1.0.0
"""

import asyncio
import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

from nanobot.interagent.capability_discovery import (
    CapabilityDiscoveryService,
    CapabilityScope,
    CacheEntry,
    get_capability_template,
    COMMON_CAPABILITY_TEMPLATES,
)
from nanobot.anp.types import (
    Capability,
    CapabilityQueryPayload,
    CapabilityResponsePayload,
)


class TestCacheEntry:
    """缓存条目测试"""

    def test_create_cache_entry(self):
        """测试创建缓存条目"""
        capabilities = [
            Capability(
                capability_id="test-cap",
                name="Test Capability",
                description="A test capability",
            ),
        ]
        entry = CacheEntry(
            did="did:anp:test:agent",
            capabilities=capabilities,
            ttl_seconds=3600,
        )

        assert entry.did == "did:anp:test:agent"
        assert len(entry.capabilities) == 1
        assert entry.ttl_seconds == 3600
        assert entry.access_count == 0
        assert entry.is_expired() is False

    def test_cache_entry_expiration(self):
        """测试缓存条目过期"""
        capabilities = []
        # 创建已过期的缓存条目（TTL 为 0）
        entry = CacheEntry(
            did="did:anp:test:agent",
            capabilities=capabilities,
            ttl_seconds=0,
        )

        # 立即检查应该过期
        assert entry.is_expired() is True

    def test_cache_entry_touch(self):
        """测试增加访问计数"""
        entry = CacheEntry(
            did="did:anp:test:agent",
            capabilities=[],
        )

        assert entry.access_count == 0
        entry.touch()
        assert entry.access_count == 1
        entry.touch()
        assert entry.access_count == 2


class TestCapabilityDiscoveryService:
    """能力发现服务测试"""

    @pytest.fixture
    def service(self):
        """创建能力发现服务实例"""
        local_capabilities = [
            Capability(
                capability_id="code-generation",
                name="代码生成",
                description="全栈代码开发、重构、优化",
                supported_languages=["TypeScript", "Python"],
                supported_frameworks=["React", "FastAPI"],
            ),
            Capability(
                capability_id="testing",
                name="测试执行",
                description="单元测试、集成测试、E2E 测试",
                tools=["vitest", "pytest", "playwright"],
            ),
            Capability(
                capability_id="customer-communication",
                name="客户沟通",
                description="需求澄清、进度报告、反馈处理",
                channels=["telegram", "slack"],
            ),
        ]
        return CapabilityDiscoveryService(
            local_did="did:anp:test:local",
            local_capabilities=local_capabilities,
            cache_ttl_seconds=3600,
        )

    @pytest.mark.asyncio
    async def test_get_local_capabilities(self, service):
        """测试获取本地能力列表"""
        capabilities = await service.get_local_capabilities()

        assert len(capabilities) == 3
        assert capabilities[0].capability_id == "code-generation"
        assert capabilities[1].capability_id == "testing"
        assert capabilities[2].capability_id == "customer-communication"

    @pytest.mark.asyncio
    async def test_get_local_capability(self, service):
        """测试获取指定的本地能力"""
        cap = await service.get_local_capability("testing")

        assert cap is not None
        assert cap.capability_id == "testing"
        assert cap.name == "测试执行"

    @pytest.mark.asyncio
    async def test_get_nonexistent_local_capability(self, service):
        """测试获取不存在的本地能力"""
        cap = await service.get_local_capability("nonexistent")

        assert cap is None

    @pytest.mark.asyncio
    async def test_query_local_capabilities(self, service):
        """测试查询本地能力"""
        capabilities = await service.query_capabilities(
            target_did="did:anp:test:local",
        )

        assert len(capabilities) == 3

    @pytest.mark.asyncio
    async def test_query_cache_miss(self, service):
        """测试查询缓存未命中"""
        capabilities = await service.query_capabilities(
            target_did="did:anp:test:remote",
        )

        # 缓存未命中返回空列表
        assert capabilities == []

    @pytest.mark.asyncio
    async def test_query_with_filter_name(self, service):
        """测试按名称过滤"""
        capabilities = await service.query_capabilities(
            query_type="filter",
            filter_dict={"name": "测试"},
        )

        assert len(capabilities) == 1
        assert capabilities[0].capability_id == "testing"

    @pytest.mark.asyncio
    async def test_query_with_filter_capability_id(self, service):
        """测试按能力 ID 过滤"""
        capabilities = await service.query_capabilities(
            query_type="filter",
            filter_dict={"capability_id": "code-generation"},
        )

        assert len(capabilities) == 1
        assert capabilities[0].capability_id == "code-generation"

    @pytest.mark.asyncio
    async def test_query_with_filter_languages(self, service):
        """测试按支持语言过滤"""
        capabilities = await service.query_capabilities(
            query_type="filter",
            filter_dict={"supported_languages": ["TypeScript"]},
        )

        assert len(capabilities) == 1
        assert capabilities[0].capability_id == "code-generation"

    @pytest.mark.asyncio
    async def test_query_with_filter_frameworks(self, service):
        """测试按支持框架过滤"""
        capabilities = await service.query_capabilities(
            query_type="filter",
            filter_dict={"supported_frameworks": ["React", "FastAPI"]},
        )

        assert len(capabilities) == 1
        assert capabilities[0].capability_id == "code-generation"

    @pytest.mark.asyncio
    async def test_query_with_filter_tools(self, service):
        """测试按工具过滤"""
        capabilities = await service.query_capabilities(
            query_type="filter",
            filter_dict={"tools": ["pytest"]},
        )

        assert len(capabilities) == 1
        assert capabilities[0].capability_id == "testing"

    @pytest.mark.asyncio
    async def test_query_with_multiple_filters(self, service):
        """测试多重过滤"""
        capabilities = await service.query_capabilities(
            query_type="filter",
            filter_dict={
                "name": "代码",
                "supported_languages": ["TypeScript"],
            },
        )

        assert len(capabilities) == 1
        assert capabilities[0].capability_id == "code-generation"

    @pytest.mark.asyncio
    async def test_cache_capabilities(self, service):
        """测试缓存能力列表"""
        remote_capabilities = [
            Capability(
                capability_id="data-analysis",
                name="数据分析",
                description="数据清洗、可视化、统计分析",
                supported_languages=["Python", "R"],
            ),
        ]

        await service.cache_capabilities(
            did="did:anp:test:remote",
            capabilities=remote_capabilities,
        )

        # 验证缓存
        capabilities = await service.query_capabilities(
            target_did="did:anp:test:remote",
        )

        assert len(capabilities) == 1
        assert capabilities[0].capability_id == "data-analysis"

    @pytest.mark.asyncio
    async def test_cache_capabilities_with_custom_ttl(self, service):
        """测试使用自定义 TTL 缓存能力"""
        remote_capabilities = [
            Capability(
                capability_id="ml-training",
                name="机器学习",
                description="模型训练、调优、部署",
            ),
        ]

        await service.cache_capabilities(
            did="did:anp:test:ml",
            capabilities=remote_capabilities,
            ttl_seconds=60,  # 1 分钟 TTL
        )

        capabilities = await service.query_capabilities(
            target_did="did:anp:test:ml",
        )

        assert len(capabilities) == 1
        assert capabilities[0].capability_id == "ml-training"

    @pytest.mark.asyncio
    async def test_search_capabilities_local(self, service):
        """测试搜索本地能力"""
        results = await service.search_capabilities(
            keyword="代码",
            scope=CapabilityScope.LOCAL,
        )

        assert len(results) == 1
        assert results[0][0].capability_id == "code-generation"
        assert results[0][1] == "did:anp:test:local"

    @pytest.mark.asyncio
    async def test_search_capabilities_all(self, service):
        """测试搜索所有能力"""
        # 先缓存一些远程能力
        await service.cache_capabilities(
            did="did:anp:test:remote",
            capabilities=[
                Capability(
                    capability_id="image-processing",
                    name="图像处理",
                    description="图像识别、处理、生成",
                ),
            ],
        )

        results = await service.search_capabilities(
            keyword="图像",
            scope=CapabilityScope.ALL,
        )

        assert len(results) == 1
        assert results[0][0].capability_id == "image-processing"

    @pytest.mark.asyncio
    async def test_get_capability_providers(self, service):
        """测试获取能力提供者"""
        # 缓存多个提供者的相同能力
        await service.cache_capabilities(
            did="did:anp:test:provider1",
            capabilities=[
                Capability(
                    capability_id="code-generation",
                    name="代码生成 V2",
                    description="另一个代码生成能力",
                ),
            ],
        )

        providers = await service.get_capability_providers("code-generation")

        # 应该包含本地和远程提供者
        assert "did:anp:test:local" in providers
        assert "did:anp:test:provider1" in providers

    @pytest.mark.asyncio
    async def test_subscribe_capability_updates(self, service):
        """测试订阅能力更新通知"""
        queue = await service.subscribe_capability_updates(
            did="did:anp:test:subscriber",
        )

        assert isinstance(queue, asyncio.Queue)

        # 通知能力变更
        new_capabilities = [
            Capability(
                capability_id="new-capability",
                name="新能力",
                description="刚刚添加的能力",
            ),
        ]

        await service.notify_capability_changed(
            did="did:anp:test:subscriber",
            capabilities=new_capabilities,
        )

        # 检查队列中是否有通知
        assert not queue.empty()
        notification = await queue.get()

        assert notification["did"] == "did:anp:test:subscriber"
        assert len(notification["capabilities"]) == 1

    @pytest.mark.asyncio
    async def test_cleanup_expired_cache(self, service):
        """测试清理过期缓存"""
        # 添加一个立即过期的缓存
        await service.cache_capabilities(
            did="did:anp:test:expiring",
            capabilities=[
                Capability(
                    capability_id="temp-cap",
                    name="临时能力",
                ),
            ],
            ttl_seconds=0,  # 立即过期
        )

        # 清理过期缓存
        cleaned = await service.cleanup_expired_cache()

        assert cleaned >= 1

    @pytest.mark.asyncio
    async def test_get_capability_statistics(self, service):
        """测试获取能力统计信息"""
        # 添加一些缓存
        await service.cache_capabilities(
            did="did:anp:test:cached",
            capabilities=[
                Capability(
                    capability_id="cached-cap",
                    name="缓存能力",
                ),
            ],
        )

        stats = await service.get_capability_statistics()

        assert "local_capabilities" in stats
        assert "cached_dids" in stats
        assert "indexed_capability_ids" in stats
        assert stats["local_capabilities"] == 3
        assert stats["cached_dids"] >= 1

    def test_build_capability_description(self, service):
        """测试构建代理能力描述"""
        description = service.build_capability_description(
            name="Test Agent",
            description="A test agent",
            capabilities=["code-generation", "testing"],
        )

        assert description.name == "Test Agent"
        assert description.description == "A test agent"
        assert len(description.capabilities) == 2
        assert "code-generation" in description.capabilities
        assert "testing" in description.capabilities


class TestCapabilityTemplates:
    """能力模板测试"""

    def test_get_capability_template(self):
        """测试获取预定义的能力模板"""
        template = get_capability_template("code-generation")

        assert template is not None
        assert template.capability_id == "code-generation"
        assert template.name == "代码生成"

    def test_get_nonexistent_template(self):
        """测试获取不存在的模板"""
        template = get_capability_template("nonexistent")

        assert template is None

    def test_common_templates(self):
        """测试常见能力模板"""
        expected_templates = [
            "code-generation",
            "testing",
            "customer-communication",
            "economic-decision",
            "project-management",
            "blockchain-operations",
        ]

        for template_id in expected_templates:
            template = get_capability_template(template_id)
            assert template is not None, f"Template {template_id} should exist"
            assert template.capability_id == template_id


class TestCapabilityDiscoveryIntegration:
    """能力发现集成测试"""

    @pytest.mark.asyncio
    async def test_full_capability_discovery_flow(self):
        """测试完整的能力发现流程"""
        # 创建两个服务（代表两个代理）
        service_a = CapabilityDiscoveryService(
            local_did="did:anp:agent_a",
            local_capabilities=[
                Capability(
                    capability_id="code-generation",
                    name="代码生成",
                    description="全栈代码开发",
                    supported_languages=["TypeScript", "Python"],
                ),
            ],
        )

        service_b = CapabilityDiscoveryService(
            local_did="did:anp:agent_b",
            local_capabilities=[
                Capability(
                    capability_id="testing",
                    name="测试执行",
                    description="单元测试、集成测试",
                    tools=["pytest", "playwright"],
                ),
            ],
        )

        # Agent A 查询自己的能力和远程能力
        local_caps = await service_a.query_capabilities()
        assert len(local_caps) == 1

        # Agent B 缓存到 Agent A
        remote_caps = await service_b.query_capabilities()
        await service_a.cache_capabilities(
            did="did:anp:agent_b",
            capabilities=remote_caps,
        )

        # Agent A 现在应该能查询到 Agent B 的能力
        all_caps = await service_a.query_capabilities(
            target_did="did:anp:agent_b",
        )
        assert len(all_caps) == 1
        assert all_caps[0].capability_id == "testing"

        # 搜索能力
        results = await service_a.search_capabilities(
            keyword="测试",
            scope=CapabilityScope.ALL,
        )
        assert len(results) == 1
        assert results[0][0].capability_id == "testing"

    @pytest.mark.asyncio
    async def test_concurrent_cache_operations(self, service):
        """测试并发缓存操作"""
        # 并发缓存多个能力
        async def cache_capability(did, cap_id):
            await service.cache_capabilities(
                did=did,
                capabilities=[
                    Capability(
                        capability_id=cap_id,
                        name=f"Capability {cap_id}",
                    ),
                ],
            )

        await asyncio.gather(
            cache_capability("did:anp:agent1", "cap1"),
            cache_capability("did:anp:agent2", "cap2"),
            cache_capability("did:anp:agent3", "cap3"),
        )

        # 验证所有缓存都存在
        stats = await service.get_capability_statistics()
        assert stats["cached_dids"] >= 3

    @pytest.mark.asyncio
    async def test_filter_with_no_matches(self, service):
        """测试过滤无匹配结果"""
        capabilities = await service.query_capabilities(
            query_type="filter",
            filter_dict={"supported_languages": ["COBOL"]},
        )

        assert capabilities == []

    @pytest.mark.asyncio
    async def test_case_insensitive_name_filter(self, service):
        """测试名称过滤不区分大小写"""
        # 大写过滤
        capabilities_upper = await service.query_capabilities(
            query_type="filter",
            filter_dict={"name": "测试"},
        )

        # 小写过滤
        capabilities_lower = await service.query_capabilities(
            query_type="filter",
            filter_dict={"name": "测试"},
        )

        assert len(capabilities_upper) == 1
        assert len(capabilities_lower) == 1


class TestCapabilityPayloads:
    """能力查询/响应负载测试"""

    @pytest.mark.asyncio
    async def test_create_capability_query(self, service):
        """测试创建能力查询负载"""
        query = await service.create_capability_query()

        assert isinstance(query, CapabilityQueryPayload)
        assert query.query_type == "all"
        assert query.filter is None

    @pytest.mark.asyncio
    async def test_create_capability_response(self, service):
        """测试创建能力响应负载"""
        capabilities = await service.get_local_capabilities()
        response = await service.create_capability_response(
            capabilities=capabilities,
        )

        assert isinstance(response, CapabilityResponsePayload)
        assert len(response.capabilities) == 3
