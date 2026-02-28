"""
LLM 协商器
使用大语言模型进行自然语言协议协商

@module nanobot.interagent.meta_protocol.llm_negotiator
@version 1.0.0
"""

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from nanobot.anp.types import (
    ANPMessage,
    ANPMessageType,
    Capability,
    ProtocolConstraints,
    ProtocolNegotiatePayload,
)


logger = logging.getLogger(__name__)


# ============================================================================
# 类型定义
# ============================================================================


class NegotiationIntent(str, Enum):
    """协商意图"""
    ACCEPT = "accept"  # 接受协议
    REJECT = "reject"  # 拒绝协议
    COUNTER_PROPOSE = "counter_propose"  # 提出反建议
    CLARIFY = "clarify"  # 请求澄清


@dataclass
class NegotiationContext:
    """协商上下文"""
    peer_did: str
    proposed_protocol: str
    proposed_version: str
    peer_capabilities: List[str]
    constraints: ProtocolConstraints
    local_capabilities: List[Capability]
    conversation_history: List[Dict[str, Any]] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class LLMNegotiationResult:
    """LLM 协商结果"""
    intent: NegotiationIntent
    reasoning: str
    counter_proposal: Optional[ProtocolNegotiatePayload] = None
    confidence: float = 0.0
    clarification_questions: List[str] = field(default_factory=list)


# ============================================================================
# LLM 协商器
# ============================================================================


class LLMProtocolNegotiator:
    """
    LLM 协商器

    使用大语言模型进行自然语言协议协商
    """

    def __init__(
        self,
        local_did: str,
        local_capabilities: List[Capability],
        llm_provider: Optional[Any] = None,
    ):
        """
        初始化 LLM 协商器

        Args:
            local_did: 本地 DID
            local_capabilities: 本地能力列表
            llm_provider: LLM 提供者（可选）
        """
        self.local_did = local_did
        self.local_capabilities = local_capabilities
        self._llm_provider = llm_provider

        # 协商历史
        self._negotiation_history: Dict[str, List[Dict]] = {}

    # ========================================================================
    # 协商接口
    # ========================================================================

    async def negotiate(
        self,
        context: NegotiationContext,
    ) -> LLMNegotiationResult:
        """
        进行协商

        Args:
            context: 协商上下文

        Returns:
            协商结果
        """
        # 构建协商提示
        prompt = self._build_negotiation_prompt(context)

        # 调用 LLM（如果有提供）
        if self._llm_provider:
            result = await self._call_llm(prompt)
        else:
            # 使用规则引擎
            result = self._rule_based_negotiation(context)

        # 记录历史
        self._record_history(context, result)

        return result

    async def analyze_proposal(
        self,
        proposal: ProtocolNegotiatePayload,
        peer_did: str,
    ) -> Dict[str, Any]:
        """
        分析协议提议

        Args:
            proposal: 协议提议
            peer_did: 对等点 DID

        Returns:
            分析结果
        """
        analysis = {
            "protocol": proposal.proposed_protocol,
            "version": proposal.protocol_version,
            "capabilities": proposal.capabilities,
            "constraints": {
                "max_latency": proposal.constraints.max_latency,
                "encryption_required": proposal.constraints.encryption_required,
                "compression": proposal.constraints.compression,
            },
            "compatible": self._check_compatibility(proposal),
            "recommendation": self._get_recommendation(proposal),
        }

        return analysis

    # ========================================================================
    # 提示构建
    # ========================================================================

    def _build_negotiation_prompt(self, context: NegotiationContext) -> str:
        """构建协商提示"""
        prompt = f"""You are a protocol negotiation agent for {self.local_did}.

Peer: {context.peer_did}
Proposed Protocol: {context.proposed_protocol} v{context.proposed_version}
Peer Capabilities: {', '.join(context.peer_capabilities)}
Constraints:
- Max Latency: {context.constraints.max_latency}ms
- Encryption Required: {context.constraints.encryption_required}
- Compression: {context.constraints.compression}

Your Capabilities:
{self._format_capabilities(context.local_capabilities)}

Conversation History:
{self._format_history(context.conversation_history)}

Task: Decide whether to ACCEPT, REJECT, or COUNTER_PROPOSE the protocol proposal.
Respond in JSON format:
{{
    "intent": "accept|reject|counter_propose",
    "reasoning": "explanation",
    "confidence": 0.0-1.0,
    "counter_proposal": {{...}} // if counter_proposing
}}
"""
        return prompt

    def _format_capabilities(self, capabilities: List[Capability]) -> str:
        """格式化能力列表"""
        lines = []
        for cap in capabilities:
            lines.append(f"- {cap.name}: {cap.description}")
            if cap.capability_id:
                lines.append(f"  ID: {cap.capability_id}")
            if cap.supported_languages:
                lines.append(f"  Languages: {', '.join(cap.supported_languages)}")
        return "\n".join(lines)

    def _format_history(self, history: List[Dict[str, Any]]) -> str:
        """格式化对话历史"""
        if not history:
            return "No previous messages"

        lines = []
        for i, msg in enumerate(history, 1):
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            lines.append(f"{i}. {role}: {content}")
        return "\n".join(lines)

    # ========================================================================
    # LLM 调用
    # ========================================================================

    async def _call_llm(self, prompt: str) -> LLMNegotiationResult:
        """调用 LLM"""
        # 这里应该调用实际的 LLM
        # 简化实现，使用规则引擎
        logger.warning("LLM provider not configured, using rule-based negotiation")
        return LLMNegotiationResult(
            intent=NegotiationIntent.ACCEPT,
            reasoning="LLM not configured, accepting by default",
            confidence=0.5,
        )

    # ========================================================================
    # 规则引擎
    # ========================================================================

    def _rule_based_negotiation(
        self,
        context: NegotiationContext,
    ) -> LLMNegotiationResult:
        """基于规则的协商"""
        # 检查协议兼容性
        compatible = self._check_protocol_compatibility(
            context.proposed_protocol,
            context.proposed_version,
        )

        if not compatible:
            return LLMNegotiationResult(
                intent=NegotiationIntent.REJECT,
                reasoning=f"Protocol {context.proposed_protocol} v{context.proposed_version} is not supported",
                confidence=0.9,
            )

        # 检查约束
        if context.constraints.encryption_required:
            # 检查是否支持加密
            has_encryption = any(
                "encryption" in cap.capability_id.lower() or "crypto" in cap.capability_id.lower()
                for cap in context.local_capabilities
            )
            if not has_encryption:
                return LLMNegotiationResult(
                    intent=NegotiationIntent.REJECT,
                    reasoning="Encryption required but not supported",
                    confidence=0.95,
                )

        # 检查延迟要求
        if context.constraints.max_latency and context.constraints.max_latency < 100:
            # 非常严格的延迟要求
            return LLMNegotiationResult(
                intent=NegotiationIntent.COUNTER_PROPOSE,
                reasoning="Latency requirement too strict, requesting higher limit",
                confidence=0.7,
            )

        # 接受协议
        return LLMNegotiationResult(
            intent=NegotiationIntent.ACCEPT,
            reasoning=f"Protocol {context.proposed_protocol} is compatible and constraints are acceptable",
            confidence=0.85,
        )

    def _check_compatibility(self, proposal: ProtocolNegotiatePayload) -> bool:
        """检查协议兼容性"""
        # 简化实现，总是返回 True
        return True

    def _check_protocol_compatibility(self, protocol: str, version: str) -> bool:
        """检查协议版本兼容性"""
        # 支持的协议列表
        supported_protocols = [
            "https://w3id.org/anp/protocols/genesis-prompt/v1",
            "https://w3id.org/anp/protocols/status/v1",
            "https://w3id.org/anp/protocols/heartbeat/v1",
        ]

        return protocol in supported_protocols

    def _get_recommendation(self, proposal: ProtocolNegotiatePayload) -> str:
        """获取推荐"""
        if self._check_protocol_compatibility(
            proposal.proposed_protocol,
            proposal.protocol_version,
        ):
            return "ACCEPT - Protocol is supported"
        else:
            return "REJECT - Protocol not supported"

    # ========================================================================
    # 历史记录
    # ========================================================================

    def _record_history(
        self,
        context: NegotiationContext,
        result: LLMNegotiationResult,
    ) -> None:
        """记录协商历史"""
        key = f"{context.peer_did}:{context.proposed_protocol}"

        if key not in self._negotiation_history:
            self._negotiation_history[key] = []

        self._negotiation_history[key].append({
            "timestamp": datetime.now().isoformat(),
            "intent": result.intent.value,
            "reasoning": result.reasoning,
            "confidence": result.confidence,
        })

    def get_history(self, peer_did: str, protocol: str) -> List[Dict]:
        """获取协商历史"""
        key = f"{peer_did}:{protocol}"
        return self._negotiation_history.get(key, [])
