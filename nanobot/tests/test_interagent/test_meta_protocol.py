"""
元协议层测试
测试 MetaProtocolNegotiator 和 MetaProtocolProcessor 的功能

@test_module nanobot.tests.test_interagent.test_meta_protocol
@version 1.0.0
"""

import asyncio
from unittest.mock import Mock

import pytest

from nanobot.anp.types import (
    AUTOMATON_DID,
    NANOBOT_DID,
    ANPMessage,
    ANPMessageType,
    Capability,
    CapabilityQueryPayload,
    ProtocolAcceptPayload,
    ProtocolConstraints,
    ProtocolNegotiatePayload,
)
from nanobot.interagent.meta_protocol import (
    LLMProtocolNegotiator,
    MetaProtocolNegotiator,
    MetaProtocolProcessor,
    NegotiationConfig,
    NegotiationContext,
    NegotiationIntent,
    NegotiationOutcome,
    NegotiationResult,
)

# ============================================================================
# 测试配置
# ============================================================================

@pytest.fixture
def local_capabilities():
    """创建本地能力"""
    return [
        Capability(
            capability_id="anp.protocol.negotiation",
            name="Protocol Negotiation",
            description="Supports ANP protocol negotiation",
            supported_languages=["python", "typescript"],
        ),
        Capability(
            capability_id="anp.encryption.aes-gcm",
            name="AES-GCM Encryption",
            description="Supports AES-256-GCM encryption",
        ),
    ]


@pytest.fixture
def negotiation_config():
    """创建协商配置"""
    return NegotiationConfig(
        max_rounds=3,
        timeout_seconds=60,
        enable_natural_language=True,
    )


@pytest.fixture
def negotiator(local_capabilities, negotiation_config):
    """创建协商器"""
    return MetaProtocolNegotiator(
        local_did=NANOBOT_DID,
        supported_protocols=[
            "https://w3id.org/anp/protocols/genesis-prompt/v1",
            "https://w3id.org/anp/protocols/status/v1",
        ],
        local_capabilities=local_capabilities,
        config=negotiation_config,
    )


@pytest.fixture
def processor(local_capabilities):
    """创建处理器"""
    return MetaProtocolProcessor(
        local_did=NANOBOT_DID,
        supported_protocols=[
            "https://w3id.org/anp/protocols/genesis-prompt/v1",
        ],
        local_capabilities=local_capabilities,
    )


# ============================================================================
# MetaProtocolNegotiator 测试
# ============================================================================


class TestMetaProtocolNegotiator:
    """测试 MetaProtocolNegotiator"""

    @pytest.mark.asyncio
    async def test_start_stop(self, negotiator):
        """测试启动和停止"""
        await negotiator.start()
        assert negotiator is not None

        await negotiator.stop()

    @pytest.mark.asyncio
    async def test_initiate_negotiation(self, negotiator):
        """测试发起协商"""
        await negotiator.start()

        session_id = await negotiator.initiate_negotiation(
            peer_did=AUTOMATON_DID,
            protocol="https://w3id.org/anp/protocols/genesis-prompt/v1",
            capabilities=["anp.protocol.negotiation"],
        )

        assert session_id is not None
        assert "meta-negotiation:" in session_id

        # 验证会话已创建
        session = await negotiator.get_session(session_id)
        assert session is not None
        assert session.peer_did == AUTOMATON_DID
        assert len(session.rounds) == 1

        await negotiator.stop()

    @pytest.mark.asyncio
    async def test_handle_proposal_accept(self, negotiator):
        """测试处理接受协商"""
        await negotiator.start()

        # 创建协商提议
        proposal = ProtocolNegotiatePayload(
            proposed_protocol="https://w3id.org/anp/protocols/genesis-prompt/v1",
            protocol_version="1.0.0",
            capabilities=["task.execution"],
            constraints=ProtocolConstraints(
                max_latency=1000,
                encryption_required=True,
            ),
        )

        # 创建模拟消息
        message = Mock(spec=ANPMessage)
        message.type = ANPMessageType.PROTOCOL_NEGOTIATE
        message.actor = AUTOMATON_DID
        message.object = proposal
        message.correlation_id = "test-session-1"

        # 处理提议
        result = await negotiator.handle_message(message)

        assert result is not None
        assert result.outcome == NegotiationOutcome.ACCEPTED
        assert result.negotiated_protocol is not None

        await negotiator.stop()

    @pytest.mark.asyncio
    async def test_handle_proposal_reject(self, negotiator):
        """测试处理拒绝协商"""
        await negotiator.start()

        # 创建不支持的协议提议
        proposal = ProtocolNegotiatePayload(
            proposed_protocol="https://w3id.org/anp/protocols/unsupported/v1",
            protocol_version="1.0.0",
            capabilities=[],
            constraints=ProtocolConstraints(
                max_latency=1000,
                encryption_required=False,
            ),
        )

        # 创建模拟消息
        message = Mock(spec=ANPMessage)
        message.type = ANPMessageType.PROTOCOL_NEGOTIATE
        message.actor = AUTOMATON_DID
        message.object = proposal
        message.correlation_id = "test-session-2"

        # 处理提议
        result = await negotiator.handle_message(message)

        assert result is not None
        assert result.outcome == NegotiationOutcome.REJECTED
        assert result.rejection_reason is not None

        await negotiator.stop()

    @pytest.mark.asyncio
    async def test_handle_capability_query(self, negotiator):
        """测试处理能力查询"""
        await negotiator.start()

        # 创建能力查询
        query = CapabilityQueryPayload(
            query_type="all",
        )

        # 创建模拟消息
        message = Mock(spec=ANPMessage)
        message.type = ANPMessageType.CAPABILITY_QUERY
        message.actor = AUTOMATON_DID
        message.object = query
        message.correlation_id = "test-session-3"

        # 处理查询
        result = await negotiator.handle_message(message)

        # 能力查询不会返回协商结果
        assert result is None

        await negotiator.stop()

    @pytest.mark.asyncio
    async def test_max_rounds_exceeded(self, negotiator):
        """测试超过最大轮数"""
        await negotiator.start()

        # 创建一个已有多个轮次的会话
        session_id = "test-session-max-rounds"
        result = NegotiationResult(
            session_id=session_id,
            peer_did=AUTOMATON_DID,
            outcome=NegotiationOutcome.COUNTER_PROPOSED,
        )

        # 添加最大轮数
        for i in range(5):  # 超过 max_rounds=3
            result.rounds.append(Mock())

        async with negotiator._lock:
            negotiator._sessions[session_id] = result

        # 尝试处理新提议
        proposal = ProtocolNegotiatePayload(
            proposed_protocol="https://w3id.org/anp/protocols/genesis-prompt/v1",
            protocol_version="1.0.0",
            capabilities=[],
            constraints=ProtocolConstraints(
                max_latency=1000,
                encryption_required=True,
            ),
        )

        message = Mock(spec=ANPMessage)
        message.type = ANPMessageType.PROTOCOL_NEGOTIATE
        message.actor = AUTOMATON_DID
        message.object = proposal
        message.correlation_id = session_id

        # 应该被拒绝
        result = await negotiator.handle_message(message)
        assert result is not None
        assert result.outcome == NegotiationOutcome.REJECTED

        await negotiator.stop()

    @pytest.mark.asyncio
    async def test_get_active_sessions(self, negotiator):
        """测试获取活跃会话"""
        await negotiator.start()

        # 发起协商
        session_id = await negotiator.initiate_negotiation(
            peer_did=AUTOMATON_DID,
            protocol="https://w3id.org/anp/protocols/genesis-prompt/v1",
            capabilities=[],
        )

        # 获取活跃会话
        active_sessions = await negotiator.get_active_sessions()
        assert len(active_sessions) > 0

        # 验证会话在列表中
        session_ids = [s.session_id for s in active_sessions]
        assert session_id in session_ids

        await negotiator.stop()


# ============================================================================
# MetaProtocolProcessor 测试
# ============================================================================


class TestMetaProtocolProcessor:
    """测试 MetaProtocolProcessor"""

    @pytest.mark.asyncio
    async def test_start_stop(self, processor):
        """测试启动和停止"""
        await processor.start()
        assert processor.get_state().value == "idle"

        await processor.stop()

    @pytest.mark.asyncio
    async def test_process_negotiation_message(self, processor):
        """测试处理协商消息"""
        await processor.start()

        proposal = ProtocolNegotiatePayload(
            proposed_protocol="https://w3id.org/anp/protocols/genesis-prompt/v1",
            protocol_version="1.0.0",
            capabilities=[],
            constraints=ProtocolConstraints(
                max_latency=1000,
                encryption_required=True,
            ),
        )

        message = Mock(spec=ANPMessage)
        message.type = ANPMessageType.PROTOCOL_NEGOTIATE
        message.actor = AUTOMATON_DID
        message.object = proposal
        message.correlation_id = "test-session"

        # 处理消息
        result = await processor.process_message(message)

        assert result is not None
        assert result.outcome == NegotiationOutcome.ACCEPTED

        await processor.stop()

    @pytest.mark.asyncio
    async def test_negotiate_protocol(self, processor):
        """测试发起协议协商"""
        await processor.start()

        session_id = await processor.negotiate_protocol(
            peer_did=AUTOMATON_DID,
            protocol="https://w3id.org/anp/protocols/genesis-prompt/v1",
        )

        assert session_id is not None

        stats = processor.get_stats()
        assert stats.total_negotiations_initiated > 0

        await processor.stop()

    @pytest.mark.asyncio
    async def test_register_protocol_handler(self, processor):
        """测试注册协议处理器"""
        await processor.start()

        handler_called = False

        async def test_handler(msg):
            nonlocal handler_called
            handler_called = True

        processor.register_protocol_handler(
            "custom-protocol",
            test_handler,
        )

        # 创建自定义协议消息
        message = Mock(spec=ANPMessage)
        message.type = Mock(value="custom-protocol")
        message.actor = AUTOMATON_DID

        await processor.process_message(message)

        assert handler_called

        await processor.stop()

    @pytest.mark.asyncio
    async def test_get_local_capabilities(self, processor):
        """测试获取本地能力"""
        capabilities = processor.get_local_capabilities()
        assert len(capabilities) > 0
        assert any(c.capability_id == "anp.protocol.negotiation" for c in capabilities)

    @pytest.mark.asyncio
    async def test_on_message_handler(self, processor):
        """测试消息处理器"""
        await processor.start()

        handler_called = False

        async def test_handler(msg):
            nonlocal handler_called
            handler_called = True

        processor.on_message(
            ANPMessageType.CAPABILITY_QUERY,
            test_handler,
        )

        # 创建能力查询消息
        query = CapabilityQueryPayload(query_type="all")
        message = Mock(spec=ANPMessage)
        message.type = ANPMessageType.CAPABILITY_QUERY
        message.actor = AUTOMATON_DID
        message.object = query

        await processor.process_message(message)

        assert handler_called

        await processor.stop()


# ============================================================================
# LLMProtocolNegotiator 测试
# ============================================================================


class TestLLMProtocolNegotiator:
    """测试 LLMProtocolNegotiator"""

    @pytest.fixture
    def llm_negotiator(self, local_capabilities):
        """创建 LLM 协商器"""
        return LLMProtocolNegotiator(
            local_did=NANOBOT_DID,
            local_capabilities=local_capabilities,
        )

    def test_rule_based_negotiation_accept(self, llm_negotiator):
        """测试基于规则的协商（接受）"""
        context = NegotiationContext(
            peer_did=AUTOMATON_DID,
            proposed_protocol="https://w3id.org/anp/protocols/genesis-prompt/v1",
            proposed_version="1.0.0",
            peer_capabilities=["task.execution"],
            constraints=ProtocolConstraints(
                max_latency=1000,
                encryption_required=True,
            ),
            local_capabilities=llm_negotiator.local_capabilities,
        )

        result = asyncio.run(llm_negotiator._rule_based_negotiation(context))

        assert result.intent == NegotiationIntent.ACCEPT
        assert result.confidence > 0

    def test_rule_based_negotiation_reject(self, llm_negotiator):
        """测试基于规则的协商（拒绝）"""
        context = NegotiationContext(
            peer_did=AUTOMATON_DID,
            proposed_protocol="https://w3id.org/anp/protocols/unsupported/v1",
            proposed_version="1.0.0",
            peer_capabilities=[],
            constraints=ProtocolConstraints(
                max_latency=1000,
                encryption_required=False,
            ),
            local_capabilities=llm_negotiator.local_capabilities,
        )

        result = asyncio.run(llm_negotiator._rule_based_negotiation(context))

        assert result.intent == NegotiationIntent.REJECT
        assert "not supported" in result.reasoning.lower()

    def test_analyze_proposal(self, llm_negotiator):
        """测试分析提议"""
        proposal = ProtocolNegotiatePayload(
            proposed_protocol="https://w3id.org/anp/protocols/genesis-prompt/v1",
            protocol_version="1.0.0",
            capabilities=["task.execution"],
            constraints=ProtocolConstraints(
                max_latency=500,
                encryption_required=True,
            ),
        )

        analysis = asyncio.run(
            llm_negotiator.analyze_proposal(proposal, AUTOMATON_DID)
        )

        assert analysis["protocol"] == "https://w3id.org/anp/protocols/genesis-prompt/v1"
        assert analysis["version"] == "1.0.0"
        assert "compatible" in analysis
        assert "recommendation" in analysis


# ============================================================================
# 集成测试
# ============================================================================


class TestMetaProtocolIntegration:
    """测试元协议集成"""

    @pytest.mark.asyncio
    async def test_multi_round_negotiation(self, processor):
        """测试多轮协商"""
        await processor.start()

        # 模拟多轮协商
        # 第一轮：发起协商
        session_id = await processor.negotiate_protocol(
            peer_did=AUTOMATON_DID,
            protocol="https://w3id.org/anp/protocols/genesis-prompt/v1",
        )

        # 第二轮：处理接受（模拟）
        accept = ProtocolAcceptPayload(
            accepted_protocol="https://w3id.org/anp/protocols/genesis-prompt/v1",
            accepted_version="1.0.0",
            session_id=session_id,
        )

        message = Mock(spec=ANPMessage)
        message.type = ANPMessageType.PROTOCOL_ACCEPT
        message.actor = AUTOMATON_DID
        message.object = accept
        message.correlation_id = session_id

        result = await processor.process_message(message)

        assert result is not None
        assert result.outcome == NegotiationOutcome.ACCEPTED

        await processor.stop()

    @pytest.mark.asyncio
    async def test_natural_language_negotiation(self, local_capabilities):
        """测试自然语言协商"""
        negotiator = MetaProtocolNegotiator(
            local_did=NANOBOT_DID,
            supported_protocols=[
                "https://w3id.org/anp/protocols/genesis-prompt/v1",
            ],
            local_capabilities=local_capabilities,
            config=NegotiationConfig(
                enable_natural_language=True,
            ),
        )

        await negotiator.start()

        # 验证自然语言协商已启用
        assert negotiator.config.enable_natural_language is True

        await negotiator.stop()
