"""
元协议协商器
实现多轮协议协商和自然语言协商支持

@module nanobot.interagent.meta_protocol.negotiator
@version 1.0.0
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Callable

from nanobot.anp.types import (
    ANPMessage,
    ANPMessageType,
    Capability,
    NegotiatedProtocol,
    ProtocolAcceptPayload,
    ProtocolConstraints,
    ProtocolNegotiatePayload,
    ProtocolRejectPayload,
)
from nanobot.interagent.protocol_negotiation import (
    ProtocolNegotiator,
    NegotiationState,
    NegotiationStrategy,
)
from nanobot.interagent.capability_discovery import (
    CapabilityDiscoveryService,
    CapabilityScope,
)


logger = logging.getLogger(__name__)


# ============================================================================
# 类型定义
# ============================================================================


class NegotiationRole(str, Enum):
    """协商角色"""
    INITIATOR = "initiator"  # 发起方
    RESPONDER = "responder"  # 响应方


class NegotiationOutcome(str, Enum):
    """协商结果"""
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    COUNTER_PROPOSED = "counter_proposed"
    TIMEOUT = "timeout"
    ERROR = "error"


@dataclass
class NegotiationRound:
    """协商轮次"""
    round_number: int
    timestamp: datetime
    role: NegotiationRole
    message_type: ANPMessageType
    payload: Any
    outcome: Optional[NegotiationOutcome] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class NegotiationResult:
    """协商结果"""
    session_id: str
    peer_did: str
    outcome: NegotiationOutcome
    negotiated_protocol: Optional[NegotiatedProtocol] = None
    rounds: List[NegotiationRound] = field(default_factory=list)
    rejection_reason: Optional[str] = None
    started_at: datetime = field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def duration_seconds(self) -> Optional[float]:
        """获取协商持续时间（秒）"""
        if self.completed_at and self.started_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None

    @property
    def round_count(self) -> int:
        """获取协商轮数"""
        return len(self.rounds)


@dataclass
class NegotiationConfig:
    """协商配置"""
    max_rounds: int = 5  # 最大协商轮数
    timeout_seconds: int = 300  # 超时时间（秒）
    strategy: NegotiationStrategy = NegotiationStrategy.ADAPTIVE
    enable_natural_language: bool = True  # 启用自然语言协商
    require_encryption: bool = True  # 要求加密
    max_latency_ms: int = 5000  # 最大延迟


# ============================================================================
# 元协议协商器
# ============================================================================


class MetaProtocolNegotiator:
    """
    元协议协商器

    集成协议协商和能力发现，支持多轮协商和自然语言协商
    """

    def __init__(
        self,
        local_did: str,
        supported_protocols: List[str],
        local_capabilities: List[Capability],
        config: Optional[NegotiationConfig] = None,
        message_sender: Optional[Callable[[ANPMessage], None]] = None,
    ):
        """
        初始化元协议协商器

        Args:
            local_did: 本地 DID
            supported_protocols: 支持的协议列表
            local_capabilities: 本地能力列表
            config: 协商配置
            message_sender: 消息发送回调
        """
        self.local_did = local_did
        self.config = config or NegotiationConfig()

        # 创建协议协商器
        self.protocol_negotiator = ProtocolNegotiator(
            supported_protocols=supported_protocols,
            strategy=self.config.strategy,
        )

        # 创建能力发现服务
        self.capability_discovery = CapabilityDiscoveryService(
            local_did=local_did,
            local_capabilities=local_capabilities,
            cache_ttl_seconds=3600,
        )

        # 消息发送器
        self._message_sender = message_sender

        # 协商会话
        self._sessions: Dict[str, NegotiationResult] = {}
        self._lock = asyncio.Lock()

        # 事件处理器
        self._on_negotiation_complete: Optional[Callable[[NegotiationResult], None]] = None
        self._on_negotiation_update: Optional[Callable[[NegotiationRound], None]] = None

    # ========================================================================
    # 生命周期
    # ========================================================================

    async def start(self) -> None:
        """启动协商器"""
        logger.info(f"MetaProtocolNegotiator started for {self.local_did}")

    async def stop(self) -> None:
        """停止协商器"""
        async with self._lock:
            # 清理所有会话
            for session in self._sessions.values():
                if session.completed_at is None:
                    session.outcome = NegotiationOutcome.ERROR
                    session.completed_at = datetime.now()
                    session.rejection_reason = "Negotiator shutdown"
            self._sessions.clear()

        logger.info("MetaProtocolNegotiator stopped")

    # ========================================================================
    # 协商发起
    # ========================================================================

    async def initiate_negotiation(
        self,
        peer_did: str,
        protocol: str,
        capabilities: List[str],
        constraints: Optional[ProtocolConstraints] = None,
    ) -> str:
        """
        发起协议协商

        Args:
            peer_did: 对等点 DID
            protocol: 提议的协议
            capabilities: 需要的能力
            constraints: 协议约束

        Returns:
            会话 ID
        """
        # 创建协商会话
        session_id = f"meta-negotiation:{peer_did}:{datetime.now().timestamp()}"
        result = NegotiationResult(
            session_id=session_id,
            peer_did=peer_did,
            outcome=NegotiationOutcome.COUNTER_PROPOSED,
        )

        async with self._lock:
            self._sessions[session_id] = result

        # 创建协议协商提议
        if constraints is None:
            constraints = ProtocolConstraints(
                max_latency=self.config.max_latency_ms,
                encryption_required=self.config.require_encryption,
            )

        proposal = await self.protocol_negotiator.propose_protocol(
            target_did=peer_did,
            protocol=protocol,
            version="1.0.0",
            capabilities=capabilities,
            constraints=constraints,
        )

        # 记录第一轮协商
        result.rounds.append(NegotiationRound(
            round_number=1,
            timestamp=datetime.now(),
            role=NegotiationRole.INITIATOR,
            message_type=ANPMessageType.PROTOCOL_NEGOTIATE,
            payload=proposal,
        ))

        # 发送协商消息
        await self._send_message(
            target_did=peer_did,
            message_type=ANPMessageType.PROTOCOL_NEGOTIATE,
            payload=proposal,
            correlation_id=session_id,
        )

        logger.info(f"Initiated negotiation {session_id} with {peer_did} for protocol {protocol}")
        return session_id

    # ========================================================================
    # 消息处理
    # ========================================================================

    async def handle_message(self, message: ANPMessage) -> Optional[NegotiationResult]:
        """
        处理 ANP 协商消息

        Args:
            message: ANP 消息

        Returns:
            协商结果（如果完成）
        """
        try:
            if message.type == ANPMessageType.PROTOCOL_NEGOTIATE:
                return await self._handle_proposal(message)
            elif message.type == ANPMessageType.PROTOCOL_ACCEPT:
                return await self._handle_accept(message)
            elif message.type == ANPMessageType.PROTOCOL_REJECT:
                return await self._handle_reject(message)
            elif message.type == ANPMessageType.CAPABILITY_QUERY:
                return await self._handle_capability_query(message)
            elif message.type == ANPMessageType.CAPABILITY_RESPONSE:
                return await self._handle_capability_response(message)
            else:
                logger.warning(f"Unhandled message type: {message.type}")
                return None

        except Exception as e:
            logger.error(f"Error handling message: {e}", exc_info=True)
            return None

    async def _handle_proposal(self, message: ANPMessage) -> Optional[NegotiationResult]:
        """处理协议协商提议"""
        sender_did = message.actor
        proposal = message.object

        if not isinstance(proposal, ProtocolNegotiatePayload):
            logger.warning(f"Invalid payload type: {type(proposal)}")
            return None

        # 查找或创建会话
        session_id = message.correlation_id or f"meta-negotiation:{sender_did}:{datetime.now().timestamp()}"

        async with self._lock:
            if session_id not in self._sessions:
                result = NegotiationResult(
                    session_id=session_id,
                    peer_did=sender_did,
                    outcome=NegotiationOutcome.COUNTER_PROPOSED,
                )
                self._sessions[session_id] = result
            else:
                result = self._sessions[session_id]

        # 记录协商轮次
        result.rounds.append(NegotiationRound(
            round_number=len(result.rounds) + 1,
            timestamp=datetime.now(),
            role=NegotiationRole.RESPONDER,
            message_type=ANPMessageType.PROTOCOL_NEGOTIATE,
            payload=proposal,
        ))

        # 检查轮数限制
        if len(result.rounds) > self.config.max_rounds:
            return await self._reject_with_reason(
                session_id=session_id,
                peer_did=sender_did,
                reason="Max negotiation rounds exceeded",
                result=result,
            )

        # 处理提议
        response, negotiated = await self.protocol_negotiator.handle_proposal(
            proposal=proposal,
            sender_did=sender_did,
        )

        # 记录响应轮次
        result.rounds.append(NegotiationRound(
            round_number=len(result.rounds) + 1,
            timestamp=datetime.now(),
            role=NegotiationRole.RESPONDER,
            message_type=ANPMessageType.PROTOCOL_ACCEPT if isinstance(response, ProtocolAcceptPayload) else ANPMessageType.PROTOCOL_REJECT,
            payload=response,
        ))

        # 发送响应
        await self._send_message(
            target_did=sender_did,
            message_type=ANPMessageType.PROTOCOL_ACCEPT if isinstance(response, ProtocolAcceptPayload) else ANPMessageType.PROTOCOL_REJECT,
            payload=response,
            correlation_id=session_id,
        )

        # 如果接受，完成协商
        if negotiated:
            result.outcome = NegotiationOutcome.ACCEPTED
            result.negotiated_protocol = negotiated
            result.completed_at = datetime.now()

            if self._on_negotiation_complete:
                self._on_negotiation_complete(result)

            return result

        return None

    async def _handle_accept(self, message: ANPMessage) -> Optional[NegotiationResult]:
        """处理协议接受"""
        sender_did = message.actor
        accept = message.object

        if not isinstance(accept, ProtocolAcceptPayload):
            return None

        session_id = message.correlation_id
        if not session_id:
            logger.warning("Accept message without correlation_id")
            return None

        async with self._lock:
            result = self._sessions.get(session_id)
            if not result:
                logger.warning(f"No session found for accept: {session_id}")
                return None

        # 创建协商协议
        negotiated = NegotiatedProtocol(
            protocol_id=accept.accepted_protocol,
            version=accept.accepted_version,
            session_id=accept.session_id,
            encryption_enabled=self.config.require_encryption,
        )

        # 更新结果
        result.outcome = NegotiationOutcome.ACCEPTED
        result.negotiated_protocol = negotiated
        result.completed_at = datetime.now()

        # 记录轮次
        result.rounds.append(NegotiationRound(
            round_number=len(result.rounds) + 1,
            timestamp=datetime.now(),
            role=NegotiationRole.INITIATOR,
            message_type=ANPMessageType.PROTOCOL_ACCEPT,
            payload=accept,
            outcome=NegotiationOutcome.ACCEPTED,
        ))

        if self._on_negotiation_complete:
            self._on_negotiation_complete(result)

        logger.info(f"Negotiation {session_id} completed successfully")
        return result

    async def _handle_reject(self, message: ANPMessage) -> Optional[NegotiationResult]:
        """处理协议拒绝"""
        sender_did = message.actor
        reject = message.object

        if not isinstance(reject, ProtocolRejectPayload):
            return None

        session_id = message.correlation_id
        if not session_id:
            return None

        async with self._lock:
            result = self._sessions.get(session_id)
            if not result:
                return None

        # 检查是否有替代方案
        if reject.alternative_proposal:
            # 处理反提议
            result.rounds.append(NegotiationRound(
                round_number=len(result.rounds) + 1,
                timestamp=datetime.now(),
                role=NegotiationRole.RESPONDER,
                message_type=ANPMessageType.PROTOCOL_REJECT,
                payload=reject,
                outcome=NegotiationOutcome.COUNTER_PROPOSED,
            ))

            # 如果支持反提议，继续协商
            if self.protocol_negotiator.strategy != NegotiationStrategy.STRICT:
                # 接受反提议
                counter = reject.alternative_proposal
                negotiated = NegotiatedProtocol(
                    protocol_id=counter.proposed_protocol,
                    version=counter.protocol_version,
                    session_id=session_id,
                    encryption_enabled=counter.constraints.encryption_required,
                )

                accept = ProtocolAcceptPayload(
                    accepted_protocol=counter.proposed_protocol,
                    accepted_version=counter.protocol_version,
                    session_id=session_id,
                )

                await self._send_message(
                    target_did=sender_did,
                    message_type=ANPMessageType.PROTOCOL_ACCEPT,
                    payload=accept,
                    correlation_id=session_id,
                )

                result.outcome = NegotiationOutcome.ACCEPTED
                result.negotiated_protocol = negotiated
                result.completed_at = datetime.now()

                if self._on_negotiation_complete:
                    self._on_negotiation_complete(result)

                return result

        # 拒绝协商
        result.outcome = NegotiationOutcome.REJECTED
        result.rejection_reason = reject.rejected_reason
        result.completed_at = datetime.now()

        if self._on_negotiation_complete:
            self._on_negotiation_complete(result)

        logger.info(f"Negotiation {session_id} rejected: {reject.rejected_reason}")
        return result

    async def _handle_capability_query(self, message: ANPMessage) -> Optional[NegotiationResult]:
        """处理能力查询"""
        # 委托给能力发现服务
        capabilities = self.capability_discovery.get_local_capabilities()

        response = CapabilityResponsePayload(
            capabilities=capabilities,
        )

        await self._send_message(
            target_did=message.actor,
            message_type=ANPMessageType.CAPABILITY_RESPONSE,
            payload=response,
            correlation_id=message.correlation_id,
        )

        return None

    async def _handle_capability_response(self, message: ANPMessage) -> Optional[NegotiationResult]:
        """处理能力响应"""
        sender_did = message.actor
        response = message.object

        if not isinstance(response, CapabilityResponsePayload):
            return None

        # 缓存远程能力
        for cap in response.capabilities:
            self.capability_discovery.cache_remote_capability(
                remote_did=sender_did,
                capability=cap,
            )

        logger.info(f"Cached {len(response.capabilities)} capabilities from {sender_did}")
        return None

    # ========================================================================
    # 辅助方法
    # ========================================================================

    async def _send_message(
        self,
        target_did: str,
        message_type: ANPMessageType,
        payload: Any,
        correlation_id: Optional[str] = None,
    ) -> None:
        """发送 ANP 消息"""
        if self._message_sender:
            from nanobot.anp.signature import create_anp_message, CreateMessageOptions
            from nanobot.anp.did import import_private_key

            # 这里需要实际的私钥，暂时跳过
            # 在实际使用中，应该从配置中加载
            logger.debug(f"Would send {message_type} to {target_did}")
        else:
            logger.warning("No message sender configured")

    async def _reject_with_reason(
        self,
        session_id: str,
        peer_did: str,
        reason: str,
        result: NegotiationResult,
    ) -> NegotiationResult:
        """拒绝协商并说明原因"""
        reject = ProtocolRejectPayload(
            rejected_reason=reason,
        )

        await self._send_message(
            target_did=peer_did,
            message_type=ANPMessageType.PROTOCOL_REJECT,
            payload=reject,
            correlation_id=session_id,
        )

        result.outcome = NegotiationOutcome.REJECTED
        result.rejection_reason = reason
        result.completed_at = datetime.now()

        if self._on_negotiation_complete:
            self._on_negotiation_complete(result)

        return result

    # ========================================================================
    # 事件处理
    # ========================================================================

    def on_negotiation_complete(self, handler: Callable[[NegotiationResult], None]) -> None:
        """注册协商完成处理器"""
        self._on_negotiation_complete = handler

    def on_negotiation_update(self, handler: Callable[[NegotiationRound], None]) -> None:
        """注册协商更新处理器"""
        self._on_negotiation_update = handler

    # ========================================================================
    # 查询方法
    # ========================================================================

    async def get_session(self, session_id: str) -> Optional[NegotiationResult]:
        """获取协商会话"""
        async with self._lock:
            return self._sessions.get(session_id)

    async def get_active_sessions(self) -> List[NegotiationResult]:
        """获取活跃会话"""
        async with self._lock:
            return [
                s for s in self._sessions.values()
                if s.completed_at is None
            ]

    async def get_completed_sessions(self) -> List[NegotiationResult]:
        """获取已完成会话"""
        async with self._lock:
            return [
                s for s in self._sessions.values()
                if s.completed_at is not None
            ]
