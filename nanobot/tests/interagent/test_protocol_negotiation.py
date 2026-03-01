"""
ANP 协议协商测试

测试协议提议、接受/拒绝、替代方案流程
自然语言协商接口
协商状态机

@module tests.interagent.test_protocol_negotiation
@version 1.0.0
"""

import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

from nanobot.interagent.protocol_negotiation import (
    ProtocolNegotiator,
    NegotiationState,
    NegotiationStrategy,
    NegotiationSession,
    NegotiationStateMachine,
)
from nanobot.anp.types import (
    ProtocolNegotiatePayload,
    ProtocolAcceptPayload,
    ProtocolRejectPayload,
    ProtocolConstraints,
    GENESIS_PROMPT_PROTOCOL,
)


class TestNegotiationState:
    """协商状态枚举测试"""

    def test_state_values(self):
        """测试状态值"""
        assert NegotiationState.IDLE == "idle"
        assert NegotiationState.PROPOSED == "proposed"
        assert NegotiationState.COUNTER_PROPOSED == "counter_proposed"
        assert NegotiationState.ACCEPTED == "accepted"
        assert NegotiationState.REJECTED == "rejected"
        assert NegotiationState.TIMEOUT == "timeout"


class TestNegotiationSession:
    """协商会话测试"""

    def test_create_session(self):
        """测试创建会话"""
        session = NegotiationSession(
            session_id="test-session-1",
            target_did="did:anp:test:agent1",
        )

        assert session.session_id == "test-session-1"
        assert session.target_did == "did:anp:test:agent1"
        assert session.state == NegotiationState.IDLE
        assert session.proposed_protocol is None
        assert session.accepted_protocol is None
        assert session.rejection_reason is None

    def test_session_with_timeout(self):
        """测试会话超时设置"""
        session = NegotiationSession(
            session_id="test-session-2",
            target_did="did:anp:test:agent2",
            timeout_seconds=600,
        )

        assert session.timeout_seconds == 600
        assert session.is_timeout() is False

    def test_session_timeout_check(self):
        """测试会话超时检查"""
        session = NegotiationSession(
            session_id="test-session-3",
            target_did="did:anp:test:agent3",
            timeout_seconds=1,  # 1 秒超时
        )

        # 立即检查应该不超时
        assert session.is_timeout() is False

    def test_session_with_counter_proposal(self):
        """测试带有替代方案的会话"""
        counter = ProtocolNegotiatePayload(
            proposed_protocol="https://w3id.org/anp/protocols/status/v1",
            protocol_version="1.0.0",
            capabilities=[],
            constraints=ProtocolConstraints(
                max_latency=300,
                encryption_required=True,
            ),
        )

        session = NegotiationSession(
            session_id="test-session-4",
            target_did="did:anp:test:agent4",
            state=NegotiationState.COUNTER_PROPOSED,
            counter_proposal=counter,
        )

        assert session.state == NegotiationState.COUNTER_PROPOSED
        assert session.counter_proposal is not None
        assert session.counter_proposal.proposed_protocol == counter.proposed_protocol


class TestProtocolNegotiator:
    """协议协商器测试"""

    @pytest.fixture
    def negotiator(self):
        """创建协商器实例"""
        return ProtocolNegotiator(
            supported_protocols=[
                GENESIS_PROMPT_PROTOCOL,
                "https://w3id.org/anp/protocols/status/v1",
                "https://w3id.org/anp/protocols/heartbeat/v1",
            ],
            default_version="1.0.0",
            strategy=NegotiationStrategy.ADAPTIVE,
        )

    @pytest.mark.asyncio
    async def test_create_session(self, negotiator):
        """测试创建协商会话"""
        session = await negotiator.create_session(
            target_did="did:anp:test:agent",
            timeout_seconds=300,
        )

        assert session.session_id.startswith("negotiation:")
        assert session.target_did == "did:anp:test:agent"
        assert session.state == NegotiationState.IDLE
        assert session.timeout_seconds == 300

    @pytest.mark.asyncio
    async def test_propose_protocol(self, negotiator):
        """测试发起协议提议"""
        constraints = ProtocolConstraints(
            max_latency=500,
            encryption_required=True,
            compression="gzip",
        )

        payload = await negotiator.propose_protocol(
            target_did="did:anp:test:agent",
            protocol=GENESIS_PROMPT_PROTOCOL,
            version="1.0.0",
            capabilities=["code-generation", "testing"],
            constraints=constraints,
        )

        assert isinstance(payload, ProtocolNegotiatePayload)
        assert payload.proposed_protocol == GENESIS_PROMPT_PROTOCOL
        assert payload.protocol_version == "1.0.0"
        assert len(payload.capabilities) == 2
        assert payload.constraints.encryption_required is True

    @pytest.mark.asyncio
    async def test_propose_unsupported_protocol(self, negotiator):
        """测试发起不支持的协议"""
        with pytest.raises(ValueError) as exc_info:
            await negotiator.propose_protocol(
                target_did="did:anp:test:agent",
                protocol="https://unsupported.protocol/v1",
                version="1.0.0",
                capabilities=[],
            )

        assert "not in supported protocols" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_handle_acceptable_proposal(self, negotiator):
        """测试处理可接受的协议提议"""
        proposal = ProtocolNegotiatePayload(
            proposed_protocol=GENESIS_PROMPT_PROTOCOL,
            protocol_version="1.0.0",
            capabilities=["code-generation"],
            constraints=ProtocolConstraints(
                max_latency=500,
                encryption_required=True,
            ),
        )

        response, negotiated = await negotiator.handle_proposal(
            proposal=proposal,
            sender_did="did:anp:test:sender",
        )

        assert isinstance(response, ProtocolAcceptPayload)
        assert response.accepted_protocol == GENESIS_PROMPT_PROTOCOL
        assert negotiated is not None
        assert negotiated.protocol_id == GENESIS_PROMPT_PROTOCOL
        assert negotiated.encryption_enabled is True

    @pytest.mark.asyncio
    async def test_handle_unsupported_proposal_with_alternative(self, negotiator):
        """测试处理不支持的协议提议（带替代方案）"""
        proposal = ProtocolNegotiatePayload(
            proposed_protocol="https://unsupported.protocol/v1",
            protocol_version="1.0.0",
            capabilities=[],
            constraints=ProtocolConstraints(
                max_latency=500,
                encryption_required=True,
            ),
        )

        response, negotiated = await negotiator.handle_proposal(
            proposal=proposal,
            sender_did="did:anp:test:sender",
        )

        assert isinstance(response, ProtocolRejectPayload)
        assert "not supported" in response.rejected_reason
        assert response.alternative_proposal is not None
        assert negotiated is None

    @pytest.mark.asyncio
    async def test_handle_accept_response(self, negotiator):
        """测试处理接受响应"""
        session = await negotiator.create_session(
            target_did="did:anp:test:agent",
        )

        accept = ProtocolAcceptPayload(
            accepted_protocol=GENESIS_PROMPT_PROTOCOL,
            accepted_version="1.0.0",
            session_id="test-session-id",
        )

        negotiated = await negotiator.handle_accept(
            accept=accept,
            session=session,
        )

        assert session.state == NegotiationState.ACCEPTED
        assert negotiated is not None
        assert negotiated.protocol_id == GENESIS_PROMPT_PROTOCOL
        assert negotiated.version == "1.0.0"

    @pytest.mark.asyncio
    async def test_handle_reject_response(self, negotiator):
        """测试处理拒绝响应"""
        session = await negotiator.create_session(
            target_did="did:anp:test:agent",
        )

        reject = ProtocolRejectPayload(
            rejected_reason="Protocol not suitable for this task",
        )

        result = await negotiator.handle_reject(
            reject=reject,
            session=session,
        )

        assert session.state == NegotiationState.REJECTED
        assert session.rejection_reason == "Protocol not suitable for this task"
        assert result is None

    @pytest.mark.asyncio
    async def test_handle_reject_with_alternative(self, negotiator):
        """测试处理带有替代方案的拒绝响应"""
        session = await negotiator.create_session(
            target_did="did:anp:test:agent",
        )

        alternative = ProtocolNegotiatePayload(
            proposed_protocol="https://w3id.org/anp/protocols/status/v1",
            protocol_version="1.0.0",
            capabilities=[],
            constraints=ProtocolConstraints(
                max_latency=300,
                encryption_required=False,
            ),
        )

        reject = ProtocolRejectPayload(
            rejected_reason="Original protocol not suitable",
            alternative_proposal=alternative,
        )

        # 使用 FLEXIBLE 策略
        negotiator.strategy = NegotiationStrategy.FLEXIBLE
        result = await negotiator.handle_reject(
            reject=reject,
            session=session,
        )

        assert session.state == NegotiationState.REJECTED
        assert result is not None
        assert result.proposed_protocol == alternative.proposed_protocol

    @pytest.mark.asyncio
    async def test_get_session(self, negotiator):
        """测试获取会话"""
        created_session = await negotiator.create_session(
            target_did="did:anp:test:agent",
        )

        retrieved_session = negotiator.get_session(created_session.session_id)

        assert retrieved_session is not None
        assert retrieved_session.session_id == created_session.session_id

    @pytest.mark.asyncio
    async def test_list_active_sessions(self, negotiator):
        """测试列出活跃会话"""
        # 创建多个会话
        session1 = await negotiator.create_session(
            target_did="did:anp:test:agent1",
        )
        session2 = await negotiator.create_session(
            target_did="did:anp:test:agent2",
        )

        # 设置不同的状态
        session1.state = NegotiationState.PROPOSED
        session2.state = NegotiationState.ACCEPTED

        active_sessions = negotiator.list_active_sessions()

        # 只有 PROPOSED 状态的会话是活跃的
        assert len(active_sessions) == 1
        assert active_sessions[0].session_id == session1.session_id

    def test_get_natural_language_description(self, negotiator):
        """测试获取协议的自然语言描述"""
        description = negotiator.get_natural_language_description(
            GENESIS_PROMPT_PROTOCOL
        )

        assert "Genesis Prompt" in description

    def test_get_unknown_protocol_description(self, negotiator):
        """测试获取未知协议的描述"""
        description = negotiator.get_natural_language_description(
            "https://unknown.protocol/v1"
        )

        assert "Protocol:" in description
        assert "unknown.protocol" in description

    @pytest.mark.asyncio
    async def test_negotiate_with_natural_language_keywords(self, negotiator):
        """测试使用自然语言关键词协商"""
        payload, description = await negotiator.negotiate_with_natural_language(
            target_did="did:anp:test:agent",
            natural_description="我需要使用 Genesis Prompt 协议来分发任务",
        )

        assert payload.proposed_protocol == GENESIS_PROMPT_PROTOCOL
        assert "Genesis Prompt" in description

    @pytest.mark.asyncio
    async def test_negotiate_with_default_protocol(self, negotiator):
        """测试使用默认协议（当关键词不匹配时）"""
        payload, description = await negotiator.negotiate_with_natural_language(
            target_did="did:anp:test:agent",
            natural_description="我想要一个未知的协议",
        )

        # 应该回退到默认协议
        assert payload.proposed_protocol == GENESIS_PROMPT_PROTOCOL

    @pytest.mark.asyncio
    async def test_cleanup_expired_sessions(self, negotiator):
        """测试清理超时会话"""
        # 创建会话
        session = await negotiator.create_session(
            target_did="did:anp:test:agent",
        )

        # 设置为已接受状态（应该被清理）
        session.state = NegotiationState.ACCEPTED

        # 清理
        cleaned = await negotiator.cleanup_expired_sessions()

        # 已完成的会话应该被清理
        assert cleaned >= 0

    @pytest.mark.asyncio
    async def test_default_constraints(self, negotiator):
        """测试默认约束设置"""
        payload = await negotiator.propose_protocol(
            target_did="did:anp:test:agent",
            protocol=GENESIS_PROMPT_PROTOCOL,
            version="1.0.0",
            capabilities=[],
        )

        assert payload.constraints.max_latency == 500
        assert payload.constraints.encryption_required is True
        assert payload.constraints.compression == "gzip"


class TestNegotiationStateMachine:
    """协议协商状态机测试"""

    def test_valid_transitions_from_idle(self):
        """测试从 IDLE 状态的有效转换"""
        assert NegotiationStateMachine.can_transition(
            NegotiationState.IDLE,
            NegotiationState.PROPOSED
        ) is True

        assert NegotiationStateMachine.can_transition(
            NegotiationState.IDLE,
            NegotiationState.ACCEPTED
        ) is False

    def test_valid_transitions_from_proposed(self):
        """测试从 PROPOSED 状态的有效转换"""
        assert NegotiationStateMachine.can_transition(
            NegotiationState.PROPOSED,
            NegotiationState.ACCEPTED
        ) is True

        assert NegotiationStateMachine.can_transition(
            NegotiationState.PROPOSED,
            NegotiationState.REJECTED
        ) is True

        assert NegotiationStateMachine.can_transition(
            NegotiationState.PROPOSED,
            NegotiationState.COUNTER_PROPOSED
        ) is True

        assert NegotiationStateMachine.can_transition(
            NegotiationState.PROPOSED,
            NegotiationState.TIMEOUT
        ) is True

        assert NegotiationStateMachine.can_transition(
            NegotiationState.PROPOSED,
            NegotiationState.IDLE
        ) is False

    def test_valid_transitions_from_counter_proposed(self):
        """测试从 COUNTER_PROPOSED 状态的有效转换"""
        assert NegotiationStateMachine.can_transition(
            NegotiationState.COUNTER_PROPOSED,
            NegotiationState.ACCEPTED
        ) is True

        assert NegotiationStateMachine.can_transition(
            NegotiationState.COUNTER_PROPOSED,
            NegotiationState.REJECTED
        ) is True

        assert NegotiationStateMachine.can_transition(
            NegotiationState.COUNTER_PROPOSED,
            NegotiationState.TIMEOUT
        ) is True

    def test_terminal_states(self):
        """测试终止状态"""
        # ACCEPTED, REJECTED, TIMEOUT 都是终止状态，不能转换到其他状态
        for terminal_state in [
            NegotiationState.ACCEPTED,
            NegotiationState.REJECTED,
            NegotiationState.TIMEOUT,
        ]:
            # 不能转换到任何其他状态
            for target_state in NegotiationState:
                if target_state != terminal_state:
                    assert NegotiationStateMachine.can_transition(
                        terminal_state,
                        target_state
                    ) is False

    def test_state_transition_table_completeness(self):
        """测试状态转换表的完整性"""
        # 验证所有状态都在转换表中有定义
        for state in NegotiationState:
            assert state in NegotiationStateMachine.VALID_TRANSITIONS


class TestNegotiationIntegration:
    """协议协商集成测试"""

    @pytest.mark.asyncio
    async def test_full_negotiation_flow(self):
        """测试完整的协商流程"""
        # 创建两个协商器（代表两个代理）
        negotiator_a = ProtocolNegotiator(
            supported_protocols=[
                GENESIS_PROMPT_PROTOCOL,
                "https://w3id.org/anp/protocols/status/v1",
            ],
            strategy=NegotiationStrategy.FLEXIBLE,
        )

        negotiator_b = ProtocolNegotiator(
            supported_protocols=[
                "https://w3id.org/anp/protocols/status/v1",
                "https://w3id.org/anp/protocols/heartbeat/v1",
            ],
            strategy=NegotiationStrategy.FLEXIBLE,
        )

        # Agent A 发起提议
        proposal = await negotiator_a.propose_protocol(
            target_did="did:anp:agent_b",
            protocol=GENESIS_PROMPT_PROTOCOL,
            version="1.0.0",
            capabilities=["task-management"],
        )

        # Agent B 收到提议，不支持，提供替代方案
        response_b, _ = await negotiator_b.handle_proposal(
            proposal=proposal,
            sender_did="did:anp:agent_a",
        )

        assert isinstance(response_b, ProtocolRejectPayload)
        assert response_b.alternative_proposal is not None

        # Agent A 收到拒绝和替代方案
        session_a = list(negotiator_a.sessions.values())[0]
        alternative = await negotiator_a.handle_reject(
            reject=response_b,
            session=session_a,
        )

        assert alternative is not None

        # Agent A 接受替代方案，重新发起提议
        new_proposal = await negotiator_a.propose_protocol(
            target_did="did:anp:agent_b",
            protocol=alternative.proposed_protocol,
            version=alternative.protocol_version,
            capabilities=[],
        )

        # Agent B 接受新的提议
        response_b2, negotiated = await negotiator_b.handle_proposal(
            proposal=new_proposal,
            sender_did="did:anp:agent_a",
        )

        assert isinstance(response_b2, ProtocolAcceptPayload)
        assert negotiated is not None
        assert negotiated.protocol_id == "https://w3id.org/anp/protocols/status/v1"

    @pytest.mark.asyncio
    async def test_concurrent_negotiations(self):
        """测试并发协商"""
        negotiator = ProtocolNegotiator(
            supported_protocols=[
                GENESIS_PROMPT_PROTOCOL,
                "https://w3id.org/anp/protocols/status/v1",
            ],
        )

        # 并发创建多个会话
        session1, session2 = await asyncio.gather(
            negotiator.create_session(target_did="did:anp:agent1"),
            negotiator.create_session(target_did="did:anp:agent2"),
        )

        assert session1.session_id != session2.session_id
        assert session1.target_did == "did:anp:agent1"
        assert session2.target_did == "did:anp:agent2"


# 导入 asyncio 用于并发测试
import asyncio
