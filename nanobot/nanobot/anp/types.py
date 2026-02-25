"""
ANP (Agent Network Protocol) 类型定义

用于 Automaton + Nanobot 双系统通信的 Pydantic 模型

@module anp.types
@version 1.0.0
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field


# ============================================================================
# JSON-LD 上下文常量
# ============================================================================

ANP_CONTEXT = "https://w3id.org/anp/v1"
SCHEMA_ORG = "https://schema.org"
GENESIS_NS = "https://w3id.org/anp/genesis#"


DEFAULT_CONTEXT = [
    "https://www.w3.org/ns/activitystreams/v1",
    ANP_CONTEXT,
    "https://w3id.org/security/v1",
]


# ============================================================================
# DID 标识符
# ============================================================================

AUTOMATON_DID = "did:anp:automaton:main"
NANOBOT_DID = "did:anp:nanobot:main"
GENESIS_PROMPT_PROTOCOL = "https://w3id.org/anp/protocols/genesis-prompt/v1"


# ============================================================================
# DID 类型
# ============================================================================


class DidVerificationMethod(BaseModel):
    """DID 验证方法"""
    id: str
    type: str = "JsonWebKey2020"
    controller: str
    public_key_jwk: Dict[str, str]


class DidService(BaseModel):
    """DID 服务端点"""
    id: str
    type: Literal["ANPMessageService"] = "ANPMessageService"
    service_endpoint: str


class DidDocument(BaseModel):
    """DID 文档 (W3C DID 标准)"""
    context: List[str] = Field(default=DEFAULT_CONTEXT, alias="@context")
    id: str
    controller: str
    verification_method: List[DidVerificationMethod] = Field(default_factory=list, alias="verificationMethod")
    authentication: List[str] = Field(default_factory=list)
    key_agreement: List[str] = Field(default_factory=list, alias="keyAgreement")
    service: List[DidService] = Field(default_factory=list)
    capability_description: Optional["AgentCapabilityDescription"] = Field(default=None, alias="capabilityDescription")


    class Config:
        populate_by_name = True


class AgentCapabilityDescription(BaseModel):
    """代理能力描述"""
    context: str = SCHEMA_ORG
    type: str = "SoftwareAgent"
    name: str
    description: str
    capabilities: List[str] = Field(default_factory=list)


# ============================================================================
# ANP 消息类型
# ============================================================================


class ANPMessageType(str, Enum):
    """ANP 消息类型枚举"""
    # 任务管理
    TASK_CREATE = "TaskCreate"
    TASK_UPDATE = "TaskUpdate"
    TASK_COMPLETE = "TaskComplete"
    TASK_FAIL = "TaskFail"
    # 协议协商
    PROTOCOL_NEGOTIATE = "ProtocolNegotiate"
    PROTOCOL_ACCEPT = "ProtocolAccept"
    PROTOCOL_REJECT = "ProtocolReject"
    # 能力发现
    CAPABILITY_QUERY = "CapabilityQuery"
    CAPABILITY_RESPONSE = "CapabilityResponse"
    # 状态同步
    STATUS_REQUEST = "StatusRequest"
    STATUS_RESPONSE = "StatusResponse"
    # 事件通知
    PROGRESS_EVENT = "ProgressEvent"
    ERROR_EVENT = "ErrorEvent"
    HEARTBEAT_EVENT = "HeartbeatEvent"
    # 经济相关
    BUDGET_UPDATE = "BudgetUpdate"
    PAYMENT_REQUEST = "PaymentRequest"


class ProofPurpose(str, Enum):
    """签名证明目的"""
    AUTHENTICATION = "authentication"
    KEY_AGREEMENT = "keyAgreement"


# ============================================================================
# ANP 签名
# ============================================================================


class ANPSignature(BaseModel):
    """ANP 数字签名"""
    type: str = "EcdsaSecp256r1Signature2019"
    created: datetime
    verification_method: str = Field(alias="verificationMethod")
    proof_purpose: ProofPurpose = Field(alias="proofPurpose")
    proof_value: str = Field(alias="proofValue")

    class Config:
        populate_by_name = True
        json_encoders = {datetime: lambda v: v.isoformat()}


# ============================================================================
# Genesis Prompt 负载
# ============================================================================


class TechnicalConstraints(BaseModel):
    """技术约束"""
    type: str = Field(default="genesis:TechnicalConstraints", alias="@type")
    required_stack: List[str] = Field(default_factory=list, alias="genesis:requiredStack")
    prohibited_stack: List[str] = Field(default_factory=list, alias="genesis:prohibitedStack")
    target_platform: Optional[str] = Field(default=None, alias="genesis:targetPlatform")

    class Config:
        populate_by_name = True


class Milestone(BaseModel):
    """付款里程碑"""
    type: str = Field(default="genesis:Milestone", alias="@type")
    name: str = Field(alias="genesis:name")
    percentage: int = Field(alias="genesis:percentage")
    due_date: datetime = Field(alias="genesis:dueDate")
    class Config:
        populate_by_name = True
        json_encoders = {datetime: lambda v: v.isoformat()}


class MonetaryAmount(BaseModel):
    """货币金额"""
    type: str = Field(default="schema:MonetaryAmount", alias="@type")
    value: int = Field(alias="schema:value")
    currency: str = Field(default="USD", alias="schema:currency")
    class Config:
        populate_by_name = True


class ContractTerms(BaseModel):
    """合同条款"""
    type: str = Field(default="genesis:ContractTerms", alias="@type")
    total_budget: MonetaryAmount = Field(alias="genesis:totalBudget")
    deadline: datetime = Field(alias="genesis:deadline")
    milestones: List[Milestone] = Field(default_factory=list, alias="genesis:milestones")
    class Config:
        populate_by_name = True
        json_encoders = {datetime: lambda v: v.isoformat()}


class ResourceLimits(BaseModel):
    """资源限制"""
    type: str = Field(default="genesis:ResourceLimits", alias="@type")
    max_tokens_per_task: int = Field(alias="genesis:maxTokensPerTask")
    max_cost_cents: int = Field(alias="genesis:maxCostCents")
    max_duration_ms: int = Field(alias="genesis:maxDurationMs")
    class Config:
        populate_by_name = True


class SpecialInstructions(BaseModel):
    """特殊指示"""
    type: str = Field(default="genesis:SpecialInstructions", alias="@type")
    priority_level: Literal["low", "normal", "high"] = Field(alias="genesis:priorityLevel")
    risk_flags: List[str] = Field(default_factory=list, alias="genesis:riskFlags")
    human_review_required: bool = Field(alias="genesis:humanReviewRequired")
    class Config:
        populate_by_name = True


class GenesisPromptPayload(BaseModel):
    """Genesis Prompt 负载 - 任务分发核心消息"""
    type: str = Field(default="genesis:GenesisPrompt", alias="@type")
    project_id: str = Field(alias="genesis:projectId")
    platform: str = Field(alias="genesis:platform")
    requirement_summary: str = Field(alias="genesis:requirementSummary")
    technical_constraints: TechnicalConstraints = Field(alias="genesis:technicalConstraints")
    contract_terms: ContractTerms = Field(alias="genesis:contractTerms")
    resource_limits: ResourceLimits = Field(alias="genesis:resourceLimits")
    special_instructions: Optional[SpecialInstructions] = Field(
        default=None, alias="genesis:specialInstructions"
    )
    class Config:
        populate_by_name = True


# ============================================================================
# 进度报告
# ============================================================================


class ProgressReportPayload(BaseModel):
    """进度报告"""
    type: str = Field(default="anp:ProgressReport", alias="@type")
    task_id: str = Field(alias="anp:taskId")
    progress: int = Field(ge=0, le=100, alias="anp:progress")
    current_phase: str = Field(alias="anp:currentPhase")
    completed_steps: List[str] = Field(default_factory=list, alias="anp:completedSteps")
    next_steps: List[str] = Field(default_factory=list, alias="anp:nextSteps")
    eta_seconds: Optional[int] = Field(default=None, alias="anp:etaSeconds")
    blockers: List[str] = Field(default_factory=list, alias="anp:blockers")
    class Config:
        populate_by_name = True


# ============================================================================
# 错误报告
# ============================================================================


class ErrorReportPayload(BaseModel):
    """错误报告"""
    type: str = Field(default="anp:ErrorReport", alias="@type")
    task_id: str = Field(alias="anp:taskId")
    severity: Literal["warning", "error", "critical"] = Field(alias="anp:severity")
    error_code: str = Field(alias="anp:errorCode")
    message: str = Field(alias="anp:message")
    context: Dict[str, Any] = Field(default_factory=dict, alias="anp:context")
    recoverable: bool = Field(alias="anp:recoverable")
    suggested_action: Optional[str] = Field(default=None, alias="anp:suggestedAction")
    class Config:
        populate_by_name = True


# ============================================================================
# 协议协商
# ============================================================================


class ProtocolConstraints(BaseModel):
    """协议约束"""
    max_latency: Optional[int] = Field(default=None, alias="anp:maxLatency")
    encryption_required: bool = Field(alias="anp:encryptionRequired")
    compression: Optional[str] = Field(default=None, alias="anp:compression")


    class Config:
        populate_by_name = True


class ProtocolNegotiatePayload(BaseModel):
    """协议协商请求"""
    type: str = Field(default="anp:ProtocolNegotiation", alias="@type")
    proposed_protocol: str = Field(alias="anp:proposedProtocol")
    protocol_version: str = Field(alias="anp:protocolVersion")
    capabilities: List[str] = Field(default_factory=list, alias="anp:capabilities")
    constraints: ProtocolConstraints = Field(alias="anp:constraints")
    class Config:
        populate_by_name = True


class ProtocolAcceptPayload(BaseModel):
    """协议接受响应"""
    type: str = Field(default="anp:ProtocolAccept", alias="@type")
    accepted_protocol: str = Field(alias="anp:acceptedProtocol")
    accepted_version: str = Field(alias="anp:acceptedVersion")
    session_id: str = Field(alias="anp:sessionId")
    class Config:
        populate_by_name = True


class ProtocolRejectPayload(BaseModel):
    """协议拒绝响应"""
    type: str = Field(default="anp:ProtocolReject", alias="@type")
    rejected_reason: str = Field(alias="anp:rejectedReason")
    alternative_proposal: Optional[ProtocolNegotiatePayload] = Field(
        default=None, alias="anp:alternativeProposal"
    )
    class Config:
        populate_by_name = True


# ============================================================================
# 能力发现
# ============================================================================


class Capability(BaseModel):
    """能力描述"""
    type: str = Field(default="anp:Capability", alias="@type")
    capability_id: str = Field(alias="anp:capabilityId")
    name: str = Field(alias="anp:name")
    description: str = Field(alias="anp:description")
    input_schema: Optional[Dict[str, Any]] = Field(default=None, alias="anp:inputSchema")
    output_schema: Optional[Dict[str, Any]] = Field(default=None, alias="anp:outputSchema")
    supported_languages: List[str] = Field(default_factory=list, alias="anp:supportedLanguages")
    supported_frameworks: List[str] = Field(default_factory=list, alias="anp:supportedFrameworks")
    tools: List[str] = Field(default_factory=list, alias="anp:tools")
    channels: List[str] = Field(default_factory=list, alias="anp:channels")
    class Config:
        populate_by_name = True


class CapabilityQueryPayload(BaseModel):
    """能力查询"""
    type: str = Field(default="anp:CapabilityQuery", alias="@type")
    query_type: Literal["all", "filter"] = Field(alias="anp:queryType")
    filter: Optional[Dict[str, Any]] = Field(default=None, alias="anp:filter")
    class Config:
        populate_by_name = True


class CapabilityResponsePayload(BaseModel):
    """能力响应"""
    type: str = Field(default="anp:CapabilityResponse", alias="@type")
    capabilities: List[Capability] = Field(default_factory=list, alias="anp:capabilities")
    class Config:
        populate_by_name = True


# ============================================================================
# 状态同步
# ============================================================================


class StatusRequestPayload(BaseModel):
    """状态请求"""
    type: str = Field(default="anp:StatusRequest", alias="@type")
    detail_level: Literal["basic", "full"] = Field(alias="anp:detailLevel")


    class Config:
        populate_by_name = True


class ResourceUsage(BaseModel):
    """资源使用情况"""
    cpu_usage: float = Field(alias="anp:cpuUsage")
    memory_usage: float = Field(alias="anp:memoryUsage")
    tokens_used: int = Field(alias="anp:tokensUsed")
    class Config:
        populate_by_name = True


class StatusResponsePayload(BaseModel):
    """状态响应"""
    type: str = Field(default="anp:StatusResponse", alias="@type")
    status: Literal["idle", "busy", "error"] = Field(alias="anp:status")
    current_tasks: int = Field(alias="anp:currentTasks")
    queued_tasks: int = Field(alias="anp:queuedTasks")
    resources: ResourceUsage = Field(alias="anp:resources")
    class Config:
        populate_by_name = True


# ============================================================================
# 心跳
# ============================================================================


class HeartbeatPayload(BaseModel):
    """心跳"""
    type: str = Field(default="anp:Heartbeat", alias="@type")
    status: Literal["healthy", "degraded", "unhealthy"] = Field(alias="anp:status")
    uptime: int = Field(alias="anp:uptime")
    dependencies: Dict[str, Literal["healthy", "degraded", "unhealthy"]] = Field(
        default_factory=dict, alias="anp:dependencies"
    )
    class Config:
        populate_by_name = True


# ============================================================================
# ANP 消息信封
# ============================================================================

ANPPayload = Union[
    GenesisPromptPayload,
    ProgressReportPayload,
    ErrorReportPayload,
    ProtocolNegotiatePayload,
    ProtocolAcceptPayload,
    ProtocolRejectPayload,
    CapabilityQueryPayload,
    CapabilityResponsePayload,
    StatusRequestPayload,
    StatusResponsePayload,
    HeartbeatPayload,
]


class ANPMessage(BaseModel):
    """ANP 消息信封"""
    context: List[str] = Field(default=DEFAULT_CONTEXT, alias="@context")
    message_type: str = Field(default="ANPMessage", alias="@type")
    id: str
    timestamp: datetime
    actor: str
    target: str
    type: ANPMessageType
    object: ANPPayload
    signature: ANPSignature
    correlation_id: Optional[str] = Field(default=None, alias="correlationId")
    ttl: Optional[int] = Field(default=None)
    class Config:
        populate_by_name = True
        json_encoders = {datetime: lambda v: v.isoformat()}


# ============================================================================
# 加密消息
# ============================================================================


class EncryptedPayload(BaseModel):
    """加密负载"""
    algorithm: Literal["AES-256-GCM"] = "AES-256-GCM"
    iv: str
    ciphertext: str
    tag: str
    ephemeral_public_key: Optional[str] = Field(default=None, alias="ephemeralPublicKey")
    class Config:
        populate_by_name = True


class ANPEncryptedMessage(BaseModel):
    """加密 ANP 消息"""
    context: str = Field(default=ANP_CONTEXT, alias="@context")
    message_type: str = Field(default="ANPEncryptedMessage", alias="@type")
    id: str
    timestamp: datetime
    actor: str
    target: str
    encrypted_payload: EncryptedPayload = Field(alias="encryptedPayload")
    signature: ANPSignature
    class Config:
        populate_by_name = True
        json_encoders = {datetime: lambda v: v.isoformat()}


# ============================================================================
# 配置
# ============================================================================


class NegotiatedProtocol(BaseModel):
    """协商后的协议"""
    protocol_id: str
    version: str
    session_id: str
    encryption_enabled: bool
    negotiated_at: datetime = Field(default_factory=datetime.utcnow)
    class Config:
        json_encoders = {datetime: lambda v: v.isoformat()}


class ANPAdapterConfig(BaseModel):
    """ANP 适配器配置"""
    did: str
    private_key: str
    service_endpoint: str
    protocol_version: str = "1.0.0"
    default_ttl: int = 3600  # 1 hour


    encryption_required: bool = True

    class Config:
        populate_by_name = True


# ============================================================================
# 错误
# ============================================================================


class ANPErrorCode(str, Enum):
    """ANP 错误代码"""
    INVALID_SIGNATURE = "ANP_INVALID_SIGNATURE"
    INVALID_DID = "ANP_INVALID_DID"
    MESSAGE_EXPIRED = "ANP_MESSAGE_EXPIRED"
    ENCRYPTION_FAILED = "ANP_ENCRYPTION_FAILED"
    DECRYPTION_FAILED = "ANP_DECRYPTION_FAILED"
    PROTOCOL_NOT_SUPPORTED = "ANP_PROTOCOL_NOT_SUPPORTED"
    CAPABILITY_NOT_FOUND = "ANP_CAPABILITY_NOT_FOUND"
    SESSION_NOT_FOUND = "ANP_SESSION_NOT_FOUND"
    UNAUTHORIZED = "ANP_UNAUTHORIZED"


    INVALID_PAYLOAD = "ANP_INVALID_PAYLOAD"


ANP_ERROR_CODES = {code.value for code in ANPErrorCode}


class ANPError(Exception):
    """ANP 错误"""
    def __init__(self, code: ANPErrorCode, message: str, details: Optional[Dict[str, Any]] = None):
        self.code = code
        self.details = details or {}
        super().__init__(code.value, message)
        self.name = "ANPError"
