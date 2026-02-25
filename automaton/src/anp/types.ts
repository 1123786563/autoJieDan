/**
 * ANP (Agent Network Protocol) 类型定义
 * 用于 Automaton + Nanobot 双系统通信
 *
 * @module anp/types
 * @version 1.0.0
 */

// ============================================================================
// JSON-LD 上下文常量
// ============================================================================

/** ANP 标准 JSON-LD 上下文 */
export const ANP_CONTEXT = {
  ACTIVITY_STREAMS: "https://www.w3.org/ns/activitystreams/v1",
  ANP_V1: "https://w3id.org/anp/v1",
  SECURITY_V1: "https://w3id.org/security/v1",
  SCHEMA_ORG: "https://schema.org",
  GENESIS: "https://w3id.org/anp/genesis#",
} as const;

/** 默认 JSON-LD 上下文列表 */
export const DEFAULT_CONTEXT = [
  ANP_CONTEXT.ACTIVITY_STREAMS,
  ANP_CONTEXT.ANP_V1,
  ANP_CONTEXT.SECURITY_V1,
];

// ============================================================================
// DID (去中心化标识符) 类型
// ============================================================================

/** DID 验证方法 */
export interface DidVerificationMethod {
  id: string;
  type: "JsonWebKey2020";
  controller: string;
  publicKeyJwk: {
    kty: "EC";
    crv: "P-256";
    x: string;
    y: string;
  };
}

/** DID 服务端点 */
export interface DidService {
  id: string;
  type: "ANPMessageService";
  serviceEndpoint: string;
}

/** DID 文档 */
export interface DidDocument {
  "@context": string[];
  id: string;
  controller: string;
  verificationMethod: DidVerificationMethod[];
  authentication: string[];
  keyAgreement: string[];
  service: DidService[];
  capabilityDescription?: AgentCapabilityDescription;
}

/** 代理能力描述 */
export interface AgentCapabilityDescription {
  "@context": string;
  "@type": "SoftwareAgent";
  name: string;
  description: string;
  capabilities: string[];
}

// ============================================================================
// ANP 消息类型
// ============================================================================

/** ANP 消息类型枚举 */
export type ANPMessageType =
  // 任务管理
  | "TaskCreate"
  | "TaskUpdate"
  | "TaskComplete"
  | "TaskFail"
  // 协议协商
  | "ProtocolNegotiate"
  | "ProtocolAccept"
  | "ProtocolReject"
  // 能力发现
  | "CapabilityQuery"
  | "CapabilityResponse"
  // 状态同步
  | "StatusRequest"
  | "StatusResponse"
  // 事件通知
  | "ProgressEvent"
  | "ErrorEvent"
  | "HeartbeatEvent"
  // 经济相关
  | "BudgetUpdate"
  | "PaymentRequest";

/** 签名证明目的 */
export type ProofPurpose = "authentication" | "keyAgreement";

/** ANP 数字签名 */
export interface ANPSignature {
  type: "EcdsaSecp256r1Signature2019";
  created: string;
  verificationMethod: string;
  proofPurpose: ProofPurpose;
  proofValue: string;
}

/** ANP 消息信封 */
export interface ANPMessage {
  "@context": string[];
  "@type": "ANPMessage";
  id: string;
  timestamp: string;
  actor: string;
  target: string;
  type: ANPMessageType;
  object: ANPPayload;
  signature: ANPSignature;
  correlationId?: string;
  ttl?: number;
}

/** ANP 消息负载 (联合类型) */
export type ANPPayload =
  | GenesisPromptPayload
  | ProgressReportPayload
  | ErrorReportPayload
  | ProtocolNegotiatePayload
  | ProtocolAcceptPayload
  | ProtocolRejectPayload
  | CapabilityQueryPayload
  | CapabilityResponsePayload
  | StatusRequestPayload
  | StatusResponsePayload
  | HeartbeatPayload;

// ============================================================================
// Genesis Prompt 负载
// ============================================================================

/** 技术约束 */
export interface TechnicalConstraints {
  "@type": "genesis:TechnicalConstraints";
  "genesis:requiredStack"?: string[];
  "genesis:prohibitedStack"?: string[];
  "genesis:targetPlatform"?: string;
}

/** 里程碑 */
export interface Milestone {
  "@type": "genesis:Milestone";
  "genesis:name": string;
  "genesis:percentage": number;
  "genesis:dueDate": string;
}

/** 合同条款 */
export interface ContractTerms {
  "@type": "genesis:ContractTerms";
  "genesis:totalBudget": {
    "@type": "schema:MonetaryAmount";
    "schema:value": number;
    "schema:currency": string;
  };
  "genesis:deadline": string;
  "genesis:milestones"?: Milestone[];
}

/** 资源限制 */
export interface ResourceLimits {
  "@type": "genesis:ResourceLimits";
  "genesis:maxTokensPerTask": number;
  "genesis:maxCostCents": number;
  "genesis:maxDurationMs": number;
}

/** Genesis Prompt 负载 */
export interface GenesisPromptPayload {
  "@type": "genesis:GenesisPrompt";
  "genesis:projectId": string;
  "genesis:platform": string;
  "genesis:requirementSummary": string;
  "genesis:technicalConstraints": TechnicalConstraints;
  "genesis:contractTerms": ContractTerms;
  "genesis:resourceLimits": ResourceLimits;
  "genesis:specialInstructions"?: {
    "genesis:priorityLevel": "low" | "normal" | "high";
    "genesis:riskFlags": string[];
    "genesis:humanReviewRequired": boolean;
  };
}

// ============================================================================
// 进度报告负载
// ============================================================================

/** 进度报告负载 */
export interface ProgressReportPayload {
  "@type": "anp:ProgressReport";
  "anp:taskId": string;
  "anp:progress": number;
  "anp:currentPhase": string;
  "anp:completedSteps": string[];
  "anp:nextSteps": string[];
  "anp:etaSeconds"?: number;
  "anp:blockers"?: string[];
}

// ============================================================================
// 错误报告负载
// ============================================================================

/** 错误报告负载 */
export interface ErrorReportPayload {
  "@type": "anp:ErrorReport";
  "anp:taskId": string;
  "anp:severity": "warning" | "error" | "critical";
  "anp:errorCode": string;
  "anp:message": string;
  "anp:context": Record<string, unknown>;
  "anp:recoverable": boolean;
  "anp:suggestedAction"?: string;
}

// ============================================================================
// 协议协商负载
// ============================================================================

/** 协议协商请求 */
export interface ProtocolNegotiatePayload {
  "@type": "anp:ProtocolNegotiation";
  "anp:proposedProtocol": string;
  "anp:protocolVersion": string;
  "anp:capabilities": string[];
  "anp:constraints": {
    "anp:maxLatency"?: number;
    "anp:encryptionRequired": boolean;
    "anp:compression"?: string;
  };
}

/** 协议接受响应 */
export interface ProtocolAcceptPayload {
  "@type": "anp:ProtocolAccept";
  "anp:acceptedProtocol": string;
  "anp:acceptedVersion": string;
  "anp:sessionId": string;
}

/** 协议拒绝响应 */
export interface ProtocolRejectPayload {
  "@type": "anp:ProtocolReject";
  "anp:rejectedReason": string;
  "anp:alternativeProposal"?: ProtocolNegotiatePayload;
}

// ============================================================================
// 能力发现负载
// ============================================================================

/** 能力描述 */
export interface Capability {
  "@type": "anp:Capability";
  "anp:capabilityId": string;
  "anp:name": string;
  "anp:description": string;
  "anp:inputSchema"?: Record<string, unknown>;
  "anp:outputSchema"?: Record<string, unknown>;
  "anp:supportedLanguages"?: string[];
  "anp:supportedFrameworks"?: string[];
  "anp:tools"?: string[];
  "anp:channels"?: string[];
}

/** 能力查询 */
export interface CapabilityQueryPayload {
  "@type": "anp:CapabilityQuery";
  "anp:queryType": "all" | "filter";
  "anp:filter"?: {
    "anp:capabilityId"?: string;
    "anp:supportedLanguages"?: string;
  };
}

/** 能力响应 */
export interface CapabilityResponsePayload {
  "@type": "anp:CapabilityResponse";
  "anp:capabilities": Capability[];
}

// ============================================================================
// 状态同步负载
// ============================================================================

/** 状态请求 */
export interface StatusRequestPayload {
  "@type": "anp:StatusRequest";
  "anp:detailLevel": "basic" | "full";
}

/** 状态响应 */
export interface StatusResponsePayload {
  "@type": "anp:StatusResponse";
  "anp:status": "idle" | "busy" | "error";
  "anp:currentTasks": number;
  "anp:queuedTasks": number;
  "anp:resources": {
    "anp:cpuUsage": number;
    "anp:memoryUsage": number;
    "anp:tokensUsed": number;
  };
}

// ============================================================================
// 心跳负载
// ============================================================================

/** 心跳负载 */
export interface HeartbeatPayload {
  "@type": "anp:Heartbeat";
  "anp:status": "healthy" | "degraded" | "unhealthy";
  "anp:uptime": number;
  "anp:dependencies"?: Record<string, "healthy" | "degraded" | "unhealthy">;
}

// ============================================================================
// 加密消息
// ============================================================================

/** 加密负载 */
export interface EncryptedPayload {
  algorithm: "AES-256-GCM";
  iv: string;
  ciphertext: string;
  tag: string;
  ephemeralPublicKey?: string;
}

/** 加密 ANP 消息 */
export interface ANPEncryptedMessage {
  "@context": string;
  "@type": "ANPEncryptedMessage";
  id: string;
  timestamp: string;
  actor: string;
  target: string;
  encryptedPayload: EncryptedPayload;
  signature: ANPSignature;
}

// ============================================================================
// 配置类型
// ============================================================================

/** ANP 适配器配置 */
export interface ANPAdapterConfig {
  /** 本地 DID */
  did: string;
  /** 私钥 (PEM 格式) */
  privateKey: string;
  /** 服务端点 */
  serviceEndpoint: string;
  /** 协议版本 */
  protocolVersion?: string;
  /** 默认 TTL (秒) */
  defaultTtl?: number;
  /** 加密是否必需 */
  encryptionRequired?: boolean;
}

/** 协议协商结果 */
export interface NegotiatedProtocol {
  protocolId: string;
  version: string;
  sessionId: string;
  encryptionEnabled: boolean;
  negotiatedAt: string;
}

// ============================================================================
// 错误类型
// ============================================================================

/** ANP 错误代码 */
export const ANP_ERROR_CODES = {
  INVALID_SIGNATURE: "ANP_INVALID_SIGNATURE",
  INVALID_DID: "ANP_INVALID_DID",
  MESSAGE_EXPIRED: "ANP_MESSAGE_EXPIRED",
  ENCRYPTION_FAILED: "ANP_ENCRYPTION_FAILED",
  DECRYPTION_FAILED: "ANP_DECRYPTION_FAILED",
  PROTOCOL_NOT_SUPPORTED: "ANP_PROTOCOL_NOT_SUPPORTED",
  CAPABILITY_NOT_FOUND: "ANP_CAPABILITY_NOT_FOUND",
  SESSION_NOT_FOUND: "ANP_SESSION_NOT_FOUND",
  UNAUTHORIZED: "ANP_UNAUTHORIZED",
} as const;

/** ANP 错误 */
export class ANPError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ANPError";
  }
}

// ============================================================================
// 默认 DID 标识符
// ============================================================================

/** Automaton 默认 DID */
export const AUTOMATON_DID = "did:anp:automaton:main";

/** Nanobot 默认 DID */
export const NANOBOT_DID = "did:anp:nanobot:main";

/** Genesis Prompt 协议 ID */
export const GENESIS_PROMPT_PROTOCOL = "https://w3id.org/anp/protocols/genesis-prompt/v1";
