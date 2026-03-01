"""
ANP 协议适配器测试
"""

import pytest
import asyncio
from datetime import datetime
from nanobot.anp.adapter import (
    ANPAdapter,
    create_anp_adapter,
    ProtocolNegotiationState,
)
from nanobot.anp.types import (
ANPAdapterConfig,
    ANPMessageType,
    ProtocolNegotiatePayload,
    ProtocolConstraints,
AUTOMATON_DID,
)


@pytest.fixture
def adapter_config():
    """创建适配器配置"""
    return ANPAdapterConfig(
        did="did:anp:nanobot:main",
        private_key="test-private-key",
        service_endpoint="https://nanobot.example.com/anp",
protocol_version="1.0.0",
default_ttl=3600,
encryption_required=True,
)


@pytest.fixture
async def adapter(adapter_config):
    """创建适配器实例"""
    adapter = create_anp_adapter(adapter_config)
    await adapter.start()
    yield adapter
    await adapter.stop()


class TestANPAdapterInitialization:
    """测试适配器初始化"""

    def test_create_adapter_with_config(self, adapter_config):
        """测试使用配置创建适配器"""
        adapter = create_anp_adapter(adapter_config)
        assert adapter is not None
        assert isinstance(adapter, ANPAdapter)

    def test_no_active_protocols_initially(self, adapter):
        """测试初始时没有活跃协议"""
        protocols = adapter.get_all_active_protocols()
        assert len(protocols) == 0

    def test_generate_session_id(self, adapter):
        """测试会话ID生成"""
        session_id1 = adapter._generate_session_id()
        session_id2 = adapter._generate_session_id()

        assert session_id1 is not None
        assert session_id2 is not None
        assert session_id1 != session_id2
        assert session_id1.startswith("session-")


class TestProtocolNegotiation:
    """测试协议协商"""

    @pytest.mark.asyncio
    async def test_initiate_protocol_negotiation(self, adapter):
        """测试发起协议协商"""
        outbound_messages = []

        async def capture_outbound(message):
            outbound_messages.append(message)

        adapter.on("outbound", capture_outbound)

        target_did = "did:anp:nanobot:main"
        session_id = await adapter.negotiate_protocol(target_did)

        assert session_id is not None
        assert len(outbound_messages) == 1

        message = outbound_messages[0]
        assert message.type == ANPMessageType.PROTOCOL_NEGOTIATE
        assert message.target == target_did
        assert message.object.protocol_version == "1.0.0"

    @pytest.mark.asyncio
    async def test_accept_supported_protocol_version(self, adapter):
        """测试接受支持的协议版本"""
        accept_messages = []
        established_events = []

        async def capture_accept(message):
            accept_messages.append(message)

        async def capture_established(peer_did, protocol):
            established_events.append((peer_did, protocol))

        adapter.on("outbound", capture_accept)
        adapter.on("protocol-negotiated", capture_established)

        # 模拟接收协议协商消息
        from nanobot.anp.types import ANPMessage
        from nanobot.anp.did import generate_key_pair, import_private_key

        key_pair = generate_key_pair()
        private_pem, public_pem = key_pair
        private_key = import_private_key(private_pem)

        from nanobot.anp.signature import create_anp_message, CreateMessageOptions

        payload = ProtocolNegotiatePayload(
            proposed_protocol="1.0.0",
            protocol_version="1.0.0",
            capabilities=[],
            constraints=ProtocolConstraints(
                max_latency=5000,
                encryption_required=True,
            ),
        )

        negotiate_message = create_anp_message(
            payload,
            private_key,
            CreateMessageOptions(
                type=ANPMessageType.PROTOCOL_NEGOTIATE,
                target_did=AUTOMATON_DID,
                correlation_id="session-001",
                ttl=3600,
            ),
        )

        await adapter.handle_protocol_negotiate(negotiate_message)

        assert len(accept_messages) == 1
        assert accept_messages[0].type == ANPMessageType.PROTOCOL_ACCEPT
        assert len(established_events) == 1
        assert established_events[0][0] == negotiate_message.actor
        assert established_events[0][1].protocol_id == "1.0.0"

    @pytest.mark.asyncio
    async def test_reject_unsupported_protocol_version(self, adapter):
        """测试拒绝不支持的协议版本"""
        reject_messages = []
        rejected_events = []

        async def capture_reject(message):
            reject_messages.append(message)

        async def capture_rejected(peer_did, reason):
            rejected_events.append((peer_did, reason))

        adapter.on("outbound", capture_reject)
        adapter.on("protocol-rejected", capture_rejected)

        # 模拟接收协议协商消息（不支持的版本）
        from nanobot.anp.did import generate_key_pair, import_private_key
        from nanobot.anp.signature import create_anp_message, CreateMessageOptions

        key_pair = generate_key_pair()
        private_pem, public_pem = key_pair
        private_key = import_private_key(private_pem)

        payload = ProtocolNegotiatePayload(
            proposed_protocol="2.0.0",
            protocol_version="2.0.0",  # 不支持的版本
            capabilities=[],
            constraints=ProtocolConstraints(
                max_latency=5000,
                encryption_required=True,
            ),
        )

        negotiate_message = create_anp_message(
            payload,
            private_key,
            CreateMessageOptions(
                type=ANPMessageType.PROTOCOL_NEGOTIATE,
                target_did=AUTOMATON_DID,
                correlation_id="session-002",
                ttl=3600,
            ),
        )

        await adapter.handle_protocol_negotiate(negotiate_message)

        assert len(reject_messages) == 1
        assert reject_messages[0].type == ANPMessageType.PROTOCOL_REJECT
        assert len(rejected_events) == 1
        assert "not supported" in rejected_events[0][1]

    @pytest.mark.asyncio
    async def test_handle_protocol_accept_response(self, adapter):
        """测试处理协议接受响应"""
        established_events = []

        async def capture_established(peer_did, protocol):
            established_events.append((peer_did, protocol))

        adapter.on("protocol-established", capture_established)

        # 首先发起协商，获取实际的 session_id
        # 使用 AUTOMATON_DID 作为目标，因为 create_anp_message 总是使用它作为 actor
        session_id = await adapter.negotiate_protocol(AUTOMATON_DID)

        # 模拟接收接受响应
        from nanobot.anp.did import generate_key_pair, import_private_key
        from nanobot.anp.signature import create_anp_message, CreateMessageOptions

        key_pair = generate_key_pair()
        private_pem, public_pem = key_pair
        private_key = import_private_key(private_pem)

        payload = {
            "accepted_protocol": "1.0.0",
            "accepted_version": "1.0.0",
            "session_id": session_id,
        }

        accept_message = create_anp_message(
            payload,
            private_key,
            CreateMessageOptions(
                type=ANPMessageType.PROTOCOL_ACCEPT,
                target_did=AUTOMATON_DID,
                correlation_id=session_id,
                ttl=3600,
            ),
        )

        await adapter.handle_protocol_accept(accept_message)

        assert len(established_events) == 1
        # session.peer_did 是 negotiate_protocol 的目标 DID (AUTOMATON_DID)
        assert established_events[0][0] == AUTOMATON_DID
        assert established_events[0][1].protocol_id == "1.0.0"

        # 验证协议已保存
        active_protocol = adapter.get_active_protocol(AUTOMATON_DID)
        assert active_protocol is not None
        assert active_protocol.protocol_id == "1.0.0"

    @pytest.mark.asyncio
    async def test_handle_protocol_reject_response(self, adapter):
        """测试处理协议拒绝响应"""
        failed_events = []

        async def capture_failed(peer_did, reason):
            failed_events.append((peer_did, reason))

        adapter.on("protocol-failed", capture_failed)

        # 首先发起协商 - 使用 AUTOMATON_DID 因为 create_anp_message 总是使用它作为 actor
        await adapter.negotiate_protocol(AUTOMATON_DID)

        # 模拟接收拒绝响应
        from nanobot.anp.did import generate_key_pair, import_private_key
        from nanobot.anp.signature import create_anp_message, CreateMessageOptions

        key_pair = generate_key_pair()
        private_pem, public_pem = key_pair
        private_key = import_private_key(private_pem)

        payload = {
            "rejected_reason": "Incompatible capabilities",
        }

        reject_message = create_anp_message(
            payload,
            private_key,
            CreateMessageOptions(
                type=ANPMessageType.PROTOCOL_REJECT,
                target_did=AUTOMATON_DID,
                correlation_id="test-session-002",
                ttl=3600,
            ),
        )

        await adapter.handle_protocol_reject(reject_message)

        assert len(failed_events) == 1
        assert failed_events[0][0] == reject_message.actor
        assert failed_events[0][1] == "Incompatible capabilities"


class TestCapabilityDiscovery:
    """测试能力发现"""

    @pytest.mark.asyncio
    async def test_query_capabilities_from_peer(self, adapter):
        """测试查询对方能力"""
        outbound_messages = []

        async def capture_outbound(message):
            outbound_messages.append(message)

        adapter.on("outbound", capture_outbound)

        await adapter.query_capabilities("did:anp:nanobot:main")

        assert len(outbound_messages) == 1
        assert outbound_messages[0].type == ANPMessageType.CAPABILITY_QUERY
        assert outbound_messages[0].target == "did:anp:nanobot:main"

    @pytest.mark.asyncio
    async def test_respond_to_capability_queries(self, adapter):
        """测试响应能力查询"""
        response_messages = []

        async def capture_response(message):
            response_messages.append(message)

        adapter.on("outbound", capture_response)

        # 模拟接收能力查询消息
        from nanobot.anp.did import generate_key_pair, import_private_key
        from nanobot.anp.signature import create_anp_message, CreateMessageOptions

        key_pair = generate_key_pair()
        private_pem, public_pem = key_pair
        private_key = import_private_key(private_pem)

        payload = {
            "query_type": "all",
        }

        query_message = create_anp_message(
            payload,
            private_key,
            CreateMessageOptions(
                type=ANPMessageType.CAPABILITY_QUERY,
                target_did=AUTOMATON_DID,
                correlation_id="session-query-001",
                ttl=3600,
            ),
        )

        await adapter.handle_capability_query(query_message)

        assert len(response_messages) == 1
        assert response_messages[0].type == ANPMessageType.CAPABILITY_RESPONSE
        assert response_messages[0].object.capabilities is not None
        assert isinstance(response_messages[0].object.capabilities, list)

    @pytest.mark.asyncio
    async def test_include_expected_capabilities(self, adapter):
        """测试包含预期的能力"""
        capabilities = []

        async def capture_capabilities(caps):
            capabilities.extend(caps)

        adapter.on("broadcast-capabilities", capture_capabilities)

        await adapter.broadcast_capabilities()

        assert len(capabilities) > 0

        # 验证包含核心能力
        capability_ids = [c["anp:capabilityId"] for c in capabilities]
        assert "anp.protocol.negotiation" in capability_ids
        assert "anp.signature.ecdsa-p256" in capability_ids


class TestMessageHandling:
    """测试消息处理"""

    @pytest.mark.asyncio
    async def test_route_messages_to_correct_handlers(self, adapter):
        """测试将消息路由到正确的处理器"""
        handled_messages = []

        async def handle_progress(message):
            handled_messages.append(message)

        adapter.on_message(ANPMessageType.PROGRESS_EVENT, handle_progress)

        # 使用正确的 ProgressReportPayload 格式
        from nanobot.anp.signature import create_anp_message, CreateMessageOptions
        from nanobot.anp.types import ProgressReportPayload

        payload = ProgressReportPayload(
            **{
                "anp:taskId": "test-task",
                "anp:progress": 50,
                "anp:currentPhase": "testing",
            }
        )

        message = create_anp_message(
            payload,
            adapter._private_key,  # 使用 adapter 的私钥
            CreateMessageOptions(
                type=ANPMessageType.PROGRESS_EVENT,
                target_did=AUTOMATON_DID,
                correlation_id="session-progress-001",
                ttl=3600,
            ),
        )

        await adapter.handle_message(message)

        # 验证处理器被调用
        assert len(handled_messages) == 1


class TestLifecycle:
    """测试生命周期"""

    @pytest.mark.asyncio
    async def test_start_and_stop_adapter(self, adapter_config):
        """测试启动和停止适配器"""
        started_event = False
        stopped_event = False

        async def on_started():
            nonlocal started_event
            started_event = True

        async def on_stopped():
            nonlocal stopped_event
            stopped_event = True

        adapter = create_anp_adapter(adapter_config)
        adapter.on("started", on_started)
        adapter.on("stopped", on_stopped)

        await adapter.start()
        assert started_event is True

        await adapter.stop()
        assert stopped_event is True

        # 验证清理完成
        protocols = adapter.get_all_active_protocols()
        assert len(protocols) == 0
