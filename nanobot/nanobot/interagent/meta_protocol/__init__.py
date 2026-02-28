"""
元协议层
实现自然语言能力协商和协议集成的元协议层

@module nanobot.interagent.meta_protocol
@version 1.0.0
"""

from .negotiator import (
    MetaProtocolNegotiator,
    NegotiationResult,
    NegotiationRound,
    NegotiationOutcome,
    NegotiationRole,
    NegotiationConfig,
)
from .processor import MetaProtocolProcessor, ProcessingConfig
from .llm_negotiator import (
    LLMProtocolNegotiator,
    NegotiationContext,
    NegotiationIntent,
    LLMNegotiationResult,
)

__all__ = [
    "MetaProtocolNegotiator",
    "NegotiationResult",
    "NegotiationRound",
    "NegotiationOutcome",
    "NegotiationRole",
    "NegotiationConfig",
    "MetaProtocolProcessor",
    "ProcessingConfig",
    "LLMProtocolNegotiator",
    "NegotiationContext",
    "NegotiationIntent",
    "LLMNegotiationResult",
]
