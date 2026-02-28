"""
ANP 协议适配器
处理 ANP 消息的发送、接收和协议协商

@module anp.adapter
@version 1.0.0
"""

import asyncio
import hashlib
import secrets
import time
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

from cryptography.hazmat.primitives.asymmetric import ec

from .did import generate_key_pair, import_private_key, import_public_key
from .signature import (
    CreateMessageOptions,
    create_anp_message,
    verify_signature,
)
from .types import (
    ANPAdapterConfig,
    ANPMessage,
    ANPMessageType,
    CapabilityQueryPayload,
    CapabilityResponsePayload,
    NegotiatedProtocol,
    ProtocolAcceptPayload,
    ProtocolConstraints,
    ProtocolNegotiatePayload,
    ProtocolRejectPayload,
)

# ============================================================================
# 类型定义
# ============================================================================

class ProtocolNegotiationState(str, Enum):
    """协议协商状态"""
    IDLE = "idle"            # 空闲，未开始协商
    NEGOTIATING = "negotiating"  # 协商中
    ACCEPTED = "accepted"    # 已接受
    REJECTED = "rejected"    # 已拒绝
    FAILED = "failed"        # 协商失败


@dataclass
class NegotiationSession:
    """协商会话信息"""
    session_id: str
    peer_did: str
    state: ProtocolNegotiationState
    proposed_protocol: str
    protocol_version: str
    capabilities: List[str]
    constraints: Dict[str, Any]
    created_at: datetime
    last_activity: datetime


# ============================================================================
# ANP 协议适配器
# ============================================================================

class ANPAdapter:
    """
    ANP 协议适配器

    负责消息的发送、接收和协议协商
    """

    def __init__(
        self,
        config: ANPAdapterConfig,
        private_key: Optional[ec.EllipticCurvePrivateKey] = None,
    ):
        self.config = config
        self._loop = asyncio.get_event_loop()

        # 事件处理器
        self._event_handlers: Dict[str, List[Callable]] = {
            "started": [],
            "stopped": [],
            "outbound": [],
            "protocol-negotiated": [],
            "protocol-rejected": [],
            "protocol-established": [],
            "protocol-failed": [],
            "capability-response": [],
            "unknown-message": [],
            "error": [],
        }

        # 会话管理
        self._negotiation_sessions: Dict[str, NegotiationSession] = {}
        self._active_protocols: Dict[str, NegotiatedProtocol] = {}
        self._message_handlers: Dict[str, Callable[[ANPMessage], Any]] = {}

        # 加载密钥
        if private_key:
            self._private_key = private_key
            self._public_key = private_key.public_key()
        else:
            # 生成新的密钥对
            private_pem, public_pem = generate_key_pair()
            self._private_key = import_private_key(private_pem)
            self._public_key = import_public_key(public_pem)

    # ========================================================================
    # 生命周期管理
    # ========================================================================

    async def start(self) -> None:
        """启动适配器"""
        await self._emit("started")

    async def stop(self) -> None:
        """停止适配器"""
        # 清理所有协商会话
        self._negotiation_sessions.clear()
        self._active_protocols.clear()
        self._message_handlers.clear()

        await self._emit("stopped")

    # ========================================================================
    # 协议协商
    # ========================================================================

    async def negotiate_protocol(
        self,
        target_did: str,
        proposed_protocol: Optional[str] = None,
    ) -> str:
        """
        发起协议协商

        Args:
            target_did: 目标 DID
            proposed_protocol: 提议的协议版本

        Returns:
            协商会话 ID
        """
        if proposed_protocol is None:
            proposed_protocol = self.config.protocol_version or "1.0.0"

        session_id = self._generate_session_id()

        # 创建协商会话
        session = NegotiationSession(
            session_id=session_id,
            peer_did=target_did,
            state=ProtocolNegotiationState.NEGOTIATING,
            proposed_protocol=proposed_protocol,
            protocol_version=proposed_protocol,
            capabilities=[],
            constraints={
                "maxLatency": 5000,
                "encryptionRequired": self.config.encryption_required or True,
            },
            created_at=datetime.utcnow(),
            last_activity=datetime.utcnow(),
        )

        self._negotiation_sessions[session_id] = session

        # 创建协议协商消息
        payload = ProtocolNegotiatePayload(
            proposed_protocol=proposed_protocol,
            protocol_version=proposed_protocol,
            capabilities=[],
            constraints=ProtocolConstraints(
                max_latency=5000,
                encryption_required=self.config.encryption_required or True,
            ),
        )
        options = CreateMessageOptions(
            type=ANPMessageType.PROTOCOL_NEGOTIATE,
            target_did=target_did,
            correlation_id=session_id,
            ttl=self.config.default_ttl,
        )

        message = create_anp_message(payload, self._private_key, options)

        # 发送协商消息（这里需要实际的传输层实现）
        await self._emit("outbound", message)

        return session_id

    async def handle_protocol_negotiate(self, message: ANPMessage) -> None:
        """
        处理协议协商请求

        Args:
            message: 协商消息
        """
        payload = message.object
        session_id = message.correlation_id or self._generate_session_id()

        # 检查协议版本是否支持
        is_supported = self._is_protocol_supported(payload.protocol_version)

        if is_supported:
            # 创建接受响应
            accept_payload = ProtocolAcceptPayload(
                accepted_protocol=payload.proposed_protocol,
                accepted_version=payload.protocol_version,
                session_id=session_id,
            )

            options = CreateMessageOptions(
                type=ANPMessageType.PROTOCOL_ACCEPT,
                target_did=message.actor,
                correlation_id=session_id,
                ttl=self.config.default_ttl,
            )

            response_message = create_anp_message(
                accept_payload,
                self._private_key,
                options,
            )

            # 保存协商结果
            negotiated = NegotiatedProtocol(
                protocol_id=payload.proposed_protocol,
                version=payload.protocol_version,
                session_id=session_id,
                encryption_enabled=payload.constraints.encryption_required,
                negotiated_at=datetime.utcnow().isoformat(),
            )

            self._active_protocols[message.actor] = negotiated

            await self._emit("outbound", response_message)
            await self._emit("protocol-negotiated", message.actor, negotiated)
        else:
            # 创建拒绝响应
            reject_payload = ProtocolRejectPayload(
                rejected_reason=f"Protocol version {payload.protocol_version} not supported"
            )

            options = CreateMessageOptions(
                type=ANPMessageType.PROTOCOL_REJECT,
                target_did=message.actor,
                correlation_id=session_id,
                ttl=self.config.default_ttl,
            )

            response_message = create_anp_message(
                reject_payload,
                self._private_key,
                options,
            )

            await self._emit("outbound", response_message)
            await self._emit("protocol-rejected", message.actor, reject_payload.rejected_reason)

    async def handle_protocol_accept(self, message: ANPMessage) -> None:
        """
        处理协议接受响应

        Args:
            message: 接受消息
        """
        payload = message.object
        session_id = payload.session_id

        # 更新协商会话
        session = self._negotiation_sessions.get(session_id)
        if session:
            session.state = ProtocolNegotiationState.ACCEPTED
            session.last_activity = datetime.utcnow()

            # 保存协商结果
            negotiated = NegotiatedProtocol(
                protocol_id=payload.accepted_protocol,
                version=payload.accepted_version,
                session_id=session_id,
                encryption_enabled=session.constraints.get("encryptionRequired", False),
                negotiated_at=datetime.utcnow().isoformat(),
            )

            self._active_protocols[session.peer_did] = negotiated
            await self._emit("protocol-established", session.peer_did, negotiated)

    async def handle_protocol_reject(self, message: ANPMessage) -> None:
        """
        处理协议拒绝响应

        Args:
            message: 拒绝消息
        """
        payload = message.object

        # 查找并更新相关会话
        for session in self._negotiation_sessions.values():
            if session.peer_did == message.actor and session.state == ProtocolNegotiationState.NEGOTIATING:
                session.state = ProtocolNegotiationState.REJECTED
                session.last_activity = datetime.utcnow()
                await self._emit("protocol-failed", message.actor, payload.rejected_reason)
                break

    # ========================================================================
    # 能力发现
    # ========================================================================

    async def query_capabilities(self, target_did: str) -> None:
        """
        查询对方能力

        Args:
            target_did: 目标 DID
        """
        session_id = self._generate_session_id()

        payload = CapabilityQueryPayload(
            query_type="all",
        )

        options = CreateMessageOptions(
            type=ANPMessageType.CAPABILITY_QUERY,
            target_did=target_did,
            correlation_id=session_id,
            ttl=self.config.default_ttl,
        )

        message = create_anp_message(payload, self._private_key, options)

        await self._emit("outbound", message)

    async def handle_capability_query(self, message: ANPMessage) -> None:
        """
        处理能力查询

        Args:
            message: 查询消息
        """
        # 生成能力响应
        capabilities = self._get_local_capabilities()

        response_payload = CapabilityResponsePayload(
            capabilities=capabilities,
        )

        options = CreateMessageOptions(
            type=ANPMessageType.CAPABILITY_RESPONSE,
            target_did=message.actor,
            correlation_id=message.correlation_id,
            ttl=self.config.default_ttl,
        )

        response_message = create_anp_message(
            response_payload,
            self._private_key,
            options,
        )

        await self._emit("outbound", response_message)

    async def broadcast_capabilities(self) -> None:
        """广播自身能力"""
        capabilities = self._get_local_capabilities()

        # 这里应该发送到所有已连接的对等点
        # 实际实现需要传输层支持
        await self._emit("broadcast-capabilities", capabilities)

    # ========================================================================
    # 消息处理
    # ========================================================================

    def on_message(
        self,
        message_type: ANPMessageType,
        handler: Callable[[ANPMessage], Any],
    ) -> None:
        """
        注册消息处理器

        Args:
            message_type: 消息类型
            handler: 处理器函数
        """
        self._message_handlers[message_type.value] = handler

    async def handle_message(self, message: ANPMessage) -> None:
        """
        处理接收到的消息

        Args:
            message: ANP 消息
        """
        # 验证消息
        # 验证消息
        valid = verify_signature(message, self._public_key)
        if not valid:
            await self._emit("error", {"message": message, "error": "Invalid signature"})
            return

        # 根据消息类型路由到对应的处理器
        if message.type == ANPMessageType.PROTOCOL_NEGOTIATE:
            await self.handle_protocol_negotiate(message)
        elif message.type == ANPMessageType.PROTOCOL_ACCEPT:
            await self.handle_protocol_accept(message)
        elif message.type == ANPMessageType.PROTOCOL_REJECT:
            await self.handle_protocol_reject(message)
        elif message.type == ANPMessageType.CAPABILITY_QUERY:
            await self.handle_capability_query(message)
        elif message.type == ANPMessageType.CAPABILITY_RESPONSE:
            await self._emit("capability-response", message)
        else:
            # 调用注册的处理器
            handler = self._message_handlers.get(message.type.value)
            if handler:
                await handler(message)
            else:
                await self._emit("unknown-message", message)

    # ========================================================================
    # 事件处理
    # ========================================================================

    def on(self, event: str, handler: Callable) -> None:
        """注册事件处理器"""
        if event not in self._event_handlers:
            self._event_handlers[event] = []
        self._event_handlers[event].append(handler)

    async def _emit(self, event: str, *args: Any) -> None:
        """触发事件"""
        handlers = self._event_handlers.get(event, [])
        for handler in handlers:
            if asyncio.iscoroutinefunction(handler):
                await handler(*args)
            else:
                handler(*args)

    # ========================================================================
    # 工具方法
    # ========================================================================

    def _is_protocol_supported(self, version: str) -> bool:
        """
        检查协议版本是否支持

        Args:
            version: 协议版本

        Returns:
            是否支持
        """
        supported_versions = ["1.0.0", "1.1.0"]
        return version in supported_versions

    def _get_local_capabilities(self) -> List[Dict[str, Any]]:
        """
        获取本地能力列表

        Returns:
            能力列表
        """
        return [
            {
                "@type": "anp:Capability",
                "anp:capabilityId": "anp.protocol.negotiation",
                "anp:name": "Protocol Negotiation",
                "anp:description": "Supports ANP protocol version negotiation",
                "anp:supportedLanguages": ["python", "typescript"],
                "anp:supportedFrameworks": ["asyncio", "trio"],
            },
            {
                "@type": "anp:Capability",
                "anp:capabilityId": "anp.encryption.aes-gcm",
                "anp:name": "AES-GCM Encryption",
                "anp:description": "Supports AES-256-GCM encryption",
            },
            {
                "@type": "anp:Capability",
                "anp:capabilityId": "anp.signature.ecdsa-p256",
                "anp:name": "ECDSA-P256 Signature",
                "anp:description": "Supports ECDSA P-256 signatures",
            },
        ]

    def _generate_session_id(self) -> str:
        """生成会话 ID - 使用 cryptographically secure random"""
        timestamp = int(time.time() * 1000)
        # SECURITY: Use secrets module for cryptographically secure random
        random_bytes = secrets.token_hex(16)
        return f"session-{timestamp}-{random_bytes}"

    def get_active_protocol(self, peer_did: str) -> Optional[NegotiatedProtocol]:
        """
        获取活跃协议

        Args:
            peer_did: 对等点 DID

        Returns:
            协议信息
        """
        return self._active_protocols.get(peer_did)

    def get_all_active_protocols(self) -> Dict[str, NegotiatedProtocol]:
        """
        获取所有活跃协议

        Returns:
            协议映射
        """
        return dict(self._active_protocols)


# ============================================================================
# 工厂函数
# ============================================================================

def create_anp_adapter(
    config: ANPAdapterConfig,
    private_key: Optional[ec.EllipticCurvePrivateKey] = None,
) -> ANPAdapter:
    """
    创建 ANP 适配器

    Args:
        config: 配置
        private_key: 私钥（可选）

    Returns:
        适配器实例
    """
    return ANPAdapter(config, private_key)
