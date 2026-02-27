"""
ANP 协议协商机制

实现协议提议、接受/拒绝、替代方案流程
支持自然语言协商接口

@module interagent.protocol_negotiation
@version 1.0.0
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from nanobot.anp.types import (
    ANPMessage,
    ANPEncryptedMessage,
    ANPMessageType,
    NegotiatedProtocol,
    ProtocolAcceptPayload,
    ProtocolConstraints,
    ProtocolNegotiatePayload,
    ProtocolRejectPayload,
    ProtocolRejectPayload,
    GENESIS_PROMPT_PROTOCOL,
)

logger = logging.getLogger(__name__)


class NegotiationState(str, Enum):
    """协商状态"""
    IDLE = "idle"
    PROPOSED = "proposed"
    COUNTER_PROPOSED = "counter_proposed"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    TIMEOUT = "timeout"


class NegotiationStrategy(str, Enum):
    """协商策略"""
    STRICT = "strict"  # 只接受或拒绝，不提出替代方案
    FLEXIBLE = "flexible"  # 可以提出替代方案
    ADAPTIVE = "adaptive"  # 根据对方策略动态调整


@dataclass
class NegotiationSession:
    """协商会话"""
    session_id: str
    target_did: str
    state: NegotiationState = NegotiationState.IDLE
    proposed_protocol: Optional[str] = None
    proposed_version: Optional[str] = None
    counter_proposal: Optional[ProtocolNegotiatePayload] = None
    accepted_protocol: Optional[NegotiatedProtocol] = None
    rejection_reason: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    timeout_seconds: int = 300  # 5 分钟超时

    def is_timeout(self) -> bool:
        """检查是否超时"""
        elapsed = (datetime.utcnow() - self.created_at).total_seconds()
        return elapsed > self.timeout_seconds


class ProtocolNegotiator:
    """
    ANP 协议协商器

    功能:
    - 发起协议协商提议
    - 处理协商请求（接受/拒绝/替代方案）
    - 自然语言协商接口
    - 协商状态管理
    """

    def __init__(
        self,
        supported_protocols: List[str],
        default_version: str = "1.0.0",
        strategy: NegotiationStrategy = NegotiationStrategy.ADAPTIVE,
    ):
        """
        初始化协议协商器

        Args:
            supported_protocols: 支持的协议列表
            default_version: 默认版本号
            strategy: 协商策略
        """
        self.supported_protocols = set(supported_protocols)
        self.default_version = default_version
        self.strategy = strategy
        self.sessions: Dict[str, NegotiationSession] = {}
        self._lock = asyncio.Lock()

        # 协议描述（用于自然语言协商）
        self.protocol_descriptions: Dict[str, str] = {
            GENESIS_PROMPT_PROTOCOL: "Genesis Prompt 协议 - 用于任务分发和项目管理",
            "https://w3id.org/anp/protocols/status/v1": "状态同步协议 - 用于实时状态查询",
            "https://w3id.org/anp/protocols/heartbeat/v1": "心跳协议 - 用于健康检查",
        }

    async def create_session(self, target_did: str, timeout_seconds: int = 300) -> NegotiationSession:
        """创建新的协商会话"""
        async with self._lock:
            session_id = f"negotiation:{target_did}:{datetime.utcnow().timestamp()}"
            session = NegotiationSession(
                session_id=session_id,
                target_did=target_did,
                timeout_seconds=timeout_seconds,
            )
            self.sessions[session_id] = session
            logger.info(f"Created negotiation session {session_id} for {target_did}")
            return session

    async def propose_protocol(
        self,
        target_did: str,
        protocol: str,
        version: str,
        capabilities: List[str],
        constraints: Optional[ProtocolConstraints] = None,
    ) -> ProtocolNegotiatePayload:
        """
        发起协议协商提议

        Args:
            target_did: 目标 DID
            protocol: 提议的协议
            version: 协议版本
            capabilities: 所需能力列表
            constraints: 协议约束

        Returns:
            ProtocolNegotiatePayload: 协议协商请求负载

        Raises:
            ValueError: 协议不被支持
        """
        if protocol not in self.supported_protocols:
            raise ValueError(f"Protocol {protocol} not in supported protocols")

        session = await self.create_session(target_did)
        session.state = NegotiationState.PROPOSED
        session.proposed_protocol = protocol
        session.proposed_version = version

        if constraints is None:
            constraints = ProtocolConstraints(
                max_latency=500,
                encryption_required=True,
                compression="gzip",
            )

        payload = ProtocolNegotiatePayload(
            proposed_protocol=protocol,
            protocol_version=version,
            capabilities=capabilities,
            constraints=constraints,
        )

        logger.info(f"Proposed protocol {protocol}@{version} to {target_did}")
        return payload

    async def handle_proposal(
        self,
        proposal: ProtocolNegotiatePayload,
        sender_did: str,
    ) -> tuple[ProtocolAcceptPayload | ProtocolRejectPayload, Optional[NegotiatedProtocol]]:
        """
        处理收到的协议协商提议

        Args:
            proposal: 协议协商请求
            sender_did: 发送方 DID

        Returns:
            tuple: (响应负载，协商后的协议（如果接受）)
        """
        protocol = proposal.proposed_protocol
        version = proposal.protocol_version

        # 检查协议是否支持
        if protocol not in self.supported_protocols:
            logger.info(f"Rejecting unsupported protocol {protocol} from {sender_did}")

            # 根据策略决定是否提供替代方案
            if self.strategy != NegotiationStrategy.STRICT and self.supported_protocols:
                # 提供第一个支持的协议作为替代
                alternative = ProtocolNegotiatePayload(
                    proposed_protocol=next(iter(self.supported_protocols)),
                    protocol_version=self.default_version,
                    capabilities=[],
                    constraints=proposal.constraints,
                )
                reject_payload = ProtocolRejectPayload(
                    rejected_reason=f"Protocol {protocol} not supported",
                    alternative_proposal=alternative,
                )
            else:
                reject_payload = ProtocolRejectPayload(
                    rejected_reason=f"Protocol {protocol} not supported",
                )

            return reject_payload, None

        # 接受协议
        session_id = f"negotiation:{sender_did}:{datetime.utcnow().timestamp()}"
        negotiated = NegotiatedProtocol(
            protocol_id=protocol,
            version=version,
            session_id=session_id,
            encryption_enabled=proposal.constraints.encryption_required,
        )

        accept_payload = ProtocolAcceptPayload(
            accepted_protocol=protocol,
            accepted_version=version,
            session_id=session_id,
        )

        logger.info(f"Accepted protocol {protocol}@{version} from {sender_did}")
        return accept_payload, negotiated

    async def handle_accept(
        self,
        accept: ProtocolAcceptPayload,
        session: NegotiationSession,
    ) -> NegotiatedProtocol:
        """
        处理协议接受响应

        Args:
            accept: 协议接受负载
            session: 协商会话

        Returns:
            NegotiatedProtocol: 协商后的协议
        """
        session.state = NegotiationState.ACCEPTED
        session.accepted_protocol = NegotiatedProtocol(
            protocol_id=accept.accepted_protocol,
            version=accept.accepted_version,
            session_id=accept.session_id,
            encryption_enabled=True,
        )
        session.updated_at = datetime.utcnow()

        logger.info(f"Protocol negotiation completed: {accept.accepted_protocol}@{accept.accepted_version}")
        return session.accepted_protocol

    async def handle_reject(
        self,
        reject: ProtocolRejectPayload,
        session: NegotiationSession,
    ) -> Optional[ProtocolNegotiatePayload]:
        """
        处理协议拒绝响应

        Args:
            reject: 协议拒绝负载
            session: 协商会话

        Returns:
            Optional[ProtocolNegotiatePayload]: 替代方案（如果有）
        """
        session.state = NegotiationState.REJECTED
        session.rejection_reason = reject.rejected_reason
        session.updated_at = datetime.utcnow()

        logger.warning(f"Protocol negotiation rejected: {reject.rejected_reason}")

        # 如果有替代方案，根据策略决定是否接受
        if reject.alternative_proposal and self.strategy == NegotiationStrategy.FLEXIBLE:
            logger.info("Received alternative proposal, considering...")
            return reject.alternative_proposal

        return None

    def get_natural_language_description(self, protocol: str) -> str:
        """
        获取协议的自然语言描述

        Args:
            protocol: 协议名称或 URL

        Returns:
            str: 自然语言描述
        """
        return self.protocol_descriptions.get(
            protocol,
            f"Protocol: {protocol} (version {self.default_version})",
        )

    async def negotiate_with_natural_language(
        self,
        target_did: str,
        natural_description: str,
    ) -> tuple[ProtocolNegotiatePayload, str]:
        """
        使用自然语言进行协议协商

        Args:
            target_did: 目标 DID
            natural_description: 自然语言描述（如"我需要 Genesis Prompt 协议来分发任务"）

        Returns:
            tuple: (协议协商负载，协议描述)
        """
        # 简单的关键词匹配（实际应用中可使用 LLM）
        protocol = None
        description = None

        for proto_url, desc in self.protocol_descriptions.items():
            proto_name = proto_url.split("/")[-1].lower()
            if proto_name in natural_description.lower():
                protocol = proto_url
                description = desc
                break

        if protocol is None:
            # 默认使用 Genesis Prompt 协议
            protocol = GENESIS_PROMPT_PROTOCOL
            description = self.protocol_descriptions.get(protocol, "Unknown protocol")

        payload = await self.propose_protocol(
            target_did=target_did,
            protocol=protocol,
            version=self.default_version,
            capabilities=[],
            constraints=ProtocolConstraints(
                max_latency=500,
                encryption_required=True,
                compression="gzip",
            ),
        )

        return payload, description

    async def cleanup_expired_sessions(self) -> int:
        """清理超时会话"""
        async with self._lock:
            expired = []
            for session_id, session in self.sessions.items():
                if session.is_timeout() or session.state in (
                    NegotiationState.ACCEPTED,
                    NegotiationState.REJECTED,
                ):
                    expired.append(session_id)

            for session_id in expired:
                session = self.sessions.pop(session_id)
                if session.is_timeout():
                    session.state = NegotiationState.TIMEOUT
                    logger.warning(f"Cleaned up timeout session {session_id}")

            return len(expired)

    def get_session(self, session_id: str) -> Optional[NegotiationSession]:
        """获取协商会话"""
        return self.sessions.get(session_id)

    def list_active_sessions(self) -> List[NegotiationSession]:
        """列出所有活跃的协商会话"""
        return [
            s for s in self.sessions.values()
            if s.state in (NegotiationState.PROPOSED, NegotiationState.COUNTER_PROPOSED)
            and not s.is_timeout()
        ]


# 协议协商状态机
class NegotiationStateMachine:
    """
    协议协商状态机

    状态转换:
    IDLE -> PROPOSED (发起提议)
    PROPOSED -> ACCEPTED (对方接受)
    PROPOSED -> REJECTED (对方拒绝)
    PROPOSED -> COUNTER_PROPOSED (对方提出替代方案)
    COUNTER_PROPOSED -> ACCEPTED (接受替代方案)
    COUNTER_PROPOSED -> REJECTED (拒绝替代方案)
    """

    VALID_TRANSITIONS = {
        NegotiationState.IDLE: [NegotiationState.PROPOSED],
        NegotiationState.PROPOSED: [
            NegotiationState.ACCEPTED,
            NegotiationState.REJECTED,
            NegotiationState.COUNTER_PROPOSED,
            NegotiationState.TIMEOUT,
        ],
        NegotiationState.COUNTER_PROPOSED: [
            NegotiationState.ACCEPTED,
            NegotiationState.REJECTED,
            NegotiationState.TIMEOUT,
        ],
        NegotiationState.ACCEPTED: [],  # 终止状态
        NegotiationState.REJECTED: [],  # 终止状态
        NegotiationState.TIMEOUT: [],  # 终止状态
    }

    @classmethod
    def can_transition(cls, from_state: NegotiationState, to_state: NegotiationState) -> bool:
        """检查状态转换是否有效"""
        return to_state in cls.VALID_TRANSITIONS.get(from_state, [])
