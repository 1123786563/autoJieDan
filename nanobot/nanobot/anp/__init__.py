"""
ANP (Agent Network Protocol) 模块

用于 Automaton + Nanobot 双系统通信

基于 JSON-LD 语义网标准实现去中心化 AI 智能体通信协议

@module anp
@version 1.0.0
"""

# 导入类型定义
from nanobot.anp.types import (
    # 常量
    ANP_CONTEXT,
    SCHEMA_ORG,
    GENESIS_NS,
    DEFAULT_CONTEXT,
    AUTOMATON_DID,
    NANOBOT_DID,
    GENESIS_PROMPT_PROTOCOL,
    ANP_ERROR_CODES,

    # 枚举
    ANPMessageType,
    ProofPurpose,
    ANPErrorCode,

    # DID 类型
    DidVerificationMethod,
    DidService,
    DidDocument,
    AgentCapabilityDescription,

    # 签名
    ANPSignature,

    # Genesis Prompt
    TechnicalConstraints,
    Milestone,
    MonetaryAmount,
    ContractTerms,
    ResourceLimits,
    SpecialInstructions,
    GenesisPromptPayload,

    # 进度报告
    ProgressReportPayload,

    # 错误报告
    ErrorReportPayload,

    # 协议协商
    ProtocolConstraints,
    ProtocolNegotiatePayload,
    ProtocolAcceptPayload,
    ProtocolRejectPayload,

    # 能力发现
    Capability,
    CapabilityQueryPayload,
    CapabilityResponsePayload,

    # 状态同步
    StatusRequestPayload,
    ResourceUsage,
    StatusResponsePayload,

    # 心跳
    HeartbeatPayload,

    # 消息
    ANPPayload,
    ANPMessage,

    # 加密
    EncryptedPayload,
    ANPEncryptedMessage,

    # 配置
    NegotiatedProtocol,
    ANPAdapterConfig,

    # 错误
    ANPError,
)

# 导入 DID 模块
from nanobot.anp.did import (
    generate_key_pair,
    import_private_key,
    import_public_key,
    public_key_to_jwk,
    jwk_to_public_key,
    DidDocumentOptions,
    generate_did_document,
    register_did_document,
    resolve_did,
    get_local_did,
    get_key_store_path,
    ensure_key_store_path,
    get_private_key_path,
    save_private_key,
    load_private_key,
    initialize_agent_identity,
)

# 导入签名模块
from nanobot.anp.signature import (
    hash_message,
    hash_payload,
    sign_payload,
    verify_signature,
    get_signature,
    get_signature_timestamp,
    CreateMessageOptions,
    create_anp_message,
    verify_message,
)

# 导入加密模块
from nanobot.anp.encryption import (
    generate_ecdh_key_pair,
    compute_shared_secret,
    derive_aes_key,
    EncryptOptions,
    EncryptResult,
    encrypt_aes,
    decrypt_aes,
    EncryptMessageOptions,
    encrypt_message,
    decrypt_message,
)

# 导入 DID 解析器模块
from nanobot.anp.resolver import (
    ResolutionSource,
    ResolutionMetadata,
    ResolutionResult,
    ResolverConfig,
    DIDResolver,
    HTTPDIDResolver,
    CompositeResolver,
    LocalResolver,
    get_global_resolver,
    set_global_resolver,
    resolve_did as resolver_resolve_did,
)

__all__ = [
    # 常量
    "ANP_CONTEXT",
    "SCHEMA_ORG",
    "GENESIS_NS",
    "DEFAULT_CONTEXT",
    "AUTOMATON_DID",
    "NANOBOT_DID",
    "GENESIS_PROMPT_PROTOCOL",
    "ANP_ERROR_CODES",

    # 枚举
    "ANPMessageType",
    "ProofPurpose",
    "ANPErrorCode",

    # DID 类型
    "DidVerificationMethod",
    "DidService",
    "DidDocument",
    "AgentCapabilityDescription",

    # 签名
    "ANPSignature",

    # Genesis Prompt
    "TechnicalConstraints",
    "Milestone",
    "MonetaryAmount",
    "ContractTerms",
    "ResourceLimits",
    "SpecialInstructions",
    "GenesisPromptPayload",

    # 进度报告
    "ProgressReportPayload",

    # 错误报告
    "ErrorReportPayload",

    # 协议协商
    "ProtocolConstraints",
    "ProtocolNegotiatePayload",
    "ProtocolAcceptPayload",
    "ProtocolRejectPayload",

    # 能力发现
    "Capability",
    "CapabilityQueryPayload",
    "CapabilityResponsePayload",

    # 状态同步
    "StatusRequestPayload",
    "ResourceUsage",
    "StatusResponsePayload",

    # 心跳
    "HeartbeatPayload",

    # 消息
    "ANPPayload",
    "ANPMessage",

    # 加密
    "EncryptedPayload",
    "ANPEncryptedMessage",

    # 配置
    "NegotiatedProtocol",
    "ANPAdapterConfig",

    # 错误
    "ANPError",

    # DID 函数和类
    "generate_key_pair",
    "import_private_key",
    "import_public_key",
    "public_key_to_jwk",
    "jwk_to_public_key",
    "DidDocumentOptions",
    "generate_did_document",
    "register_did_document",
    "resolve_did",
    "get_local_did",
    "get_key_store_path",
    "ensure_key_store_path",
    "get_private_key_path",
    "save_private_key",
    "load_private_key",
    "initialize_agent_identity",

    # 签名函数和类
    "hash_message",
    "hash_payload",
    "sign_payload",
    "verify_signature",
    "get_signature",
    "get_signature_timestamp",
    "CreateMessageOptions",
    "create_anp_message",
    "verify_message",

    # 加密函数和类
    "generate_ecdh_key_pair",
    "compute_shared_secret",
    "derive_aes_key",
    "EncryptOptions",
    "EncryptResult",
    "encrypt_aes",
    "decrypt_aes",
    "EncryptMessageOptions",
    "encrypt_message",
    "decrypt_message",

    # DID 解析器
    "ResolutionSource",
    "ResolutionMetadata",
    "ResolutionResult",
    "ResolverConfig",
    "DIDResolver",
    "HTTPDIDResolver",
    "CompositeResolver",
    "LocalResolver",
    "get_global_resolver",
    "set_global_resolver",
    "resolver_resolve_did",

    # 消息处理器
    "ANPMessageHandler",
    "create_anp_message_handler",
]
