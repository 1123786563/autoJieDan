"""
ANP (Agent Network Protocol) 模块

用于 Automaton + Nanobot 双系统通信

基于 JSON-LD 语义网标准实现去中心化 AI 智能体通信协议

@version 1.0.0
"""

from .types import (
    # JSON-LD 上下文
    ANP_CONTEXT,
    DEFAULT_CONTEXT,

    # DID 类型
    DidDocument,
    DidVerificationMethod,
    DidService,
    AgentCapabilityDescription,

    # ANP 消息类型
    ANPMessage,
    ANPSignature,
    ANPPayload,
    ANPMessageType,
    ProofPurpose,

    # 具体负载类型
    GenesisPromptPayload,
    TechnicalConstraints,
    Milestone,
    ContractTerms,
    ResourceLimits,
    ProgressReportPayload,
    ErrorReportPayload,
    ProtocolNegotiatePayload,
    ProtocolAcceptPayload,
    ProtocolRejectPayload,
    CapabilityQueryPayload,
    CapabilityResponsePayload,
    Capability,
    StatusRequestPayload,
    StatusResponsePayload,
    HeartbeatPayload,

    # 加密消息
    ANPEncryptedMessage,
    EncryptedPayload,

    # 配置
    ANPAdapterConfig,
    NegotiatedProtocol,

    # 常量
    AUTOMATON_DID,
    NANOBOT_DID,
    GENESIS_PROMPT_PROTOCOL,

    # 错误
    ANPError,
    ANP_ERROR_CODES,
)

__all__ = [
    # 上下文
    "ANP_CONTEXT",
    "DEFAULT_CONTEXT",

    # DID
    "DidDocument",
    "DidVerificationMethod",
    "DidService",
    "AgentCapabilityDescription",

    # 消息
    "ANPMessage",
    "ANPSignature",
    "ANPPayload",
    "ANPMessageType",
    "ProofPurpose",

    # 负载
    "GenesisPromptPayload",
    "TechnicalConstraints",
    "Milestone",
    "ContractTerms",
    "ResourceLimits",
    "ProgressReportPayload",
    "ErrorReportPayload",
    "ProtocolNegotiatePayload",
    "ProtocolAcceptPayload",
    "ProtocolRejectPayload",
    "CapabilityQueryPayload",
    "CapabilityResponsePayload",
    "Capability",
    "StatusRequestPayload",
    "StatusResponsePayload",
    "HeartbeatPayload",

    # 加密
    "ANPEncryptedMessage",
    "EncryptedPayload",

    # 配置
    "ANPAdapterConfig",
    "NegotiatedProtocol",

    # 常量
    "AUTOMATON_DID",
    "NANOBOT_DID",
    "GENESIS_PROMPT_PROTOCOL",

    # 错误
    "ANPError",
    "ANP_ERROR_CODES",
]
