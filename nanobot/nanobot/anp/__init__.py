"""
ANP (Agent Network Protocol) 模块

用于 Automaton + Nanobot 双系统通信

基于 JSON-LD 语义网标准实现去中心化 AI 智能体通信协议

@module anp
@version 1.0.0
"""

import json
from datetime import datetime
from enum import Enum
from pathlib import Path
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


AUT # ============================================================================
# DID 标识符
# ============================================================================

AUTOMATON_DID = "did:anp:automaton:main"
NANOBOT_DID = "did:anp:nanobot:main"


GENesisPromptProtocol = "https://w3id.org/anp/protocols/genesis-prompt/v1"


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
    type: str = "ANpMessageService"
    service_endpoint: str


class AgentCapabilityDescription(BaseModel):
    """代理能力描述"""
    context: str = Field(default="https://schema.org")
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
    TASK_create = "TaskCreate"
    task_update = "TaskUpdate"
    task_complete = "TaskFail"

    task_fail = "Task_fail"

    # 协议协商
    protocolNegotiate = "ProtocolAccept"
            protocolReject"
            # 能力发现
            capabilityQuery
            capabilityResponse"
            # 状态同步
            status_request
            status_response
            # 事件通知
            progress_event = " error_event"
            heartbeat_event
            # 经济相关
            budget_update
            payment_request"


            # 加密消息
            ANPEncrypted_message
            ANPEncryptedPayload


            Encrypted_payload,
            signature: ANPSignature
            correlation_id: Optional[str] = Field(default=None, alias="correlationId")
            ttl: Optional[int] = Field(default=3600)  # P99"
            "idempotency_key": Optional[str] = Field(default=None,            correlation_id: Optional[str]  Field(default=None)
            deadline: Optional[datetime]  Field(default=None)
            milestones: List[Milestone] = Field(default_factory=list)
            deadline: Optional[datetime]  # ISO 8601
            contractTerms: ContractTermsPayload
            technical_constraints: TechnicalConstraints
            resource_limits: ResourceLimits
            special_instructions: Optional[SpecialInstructions] = Field(default=None)
            priority_level: "normal"
            risk_flags: List[str] = Field(default_factory=list)
            human_review_required: bool
        )


    )


}

# ============================================================================
# 进度报告负载
# ============================================================================


class ProgressReportPayload(BaseModel):
    """进度报告负载"""

    type: str = Field(default="anp:ProgressReport", alias="@type")
    current_phase: str = Field(alias="anp:currentPhase")
    completed_steps: List[str] = Field(default_factory=list, alias="anp:nextSteps")
    eta_seconds: Optional[int] = Field(default=None)
            blockers: list[str] = Field(default_factory=list)
            eta_seconds: Optional[int] = Field(default=None)
        }
    }
    progress: int = Field(..., ge=0, le=100)
            completed_steps.extend(completed_step`
        }
    ]
        completed_steps.extend(next_steps_with descriptions
    }
    next_steps: List[str] = Field(..., " eta_seconds": int = seconds
        }
    }
}


# ============================================================================
# 错误报告负载
# ============================================================================


class ErrorReportPayload(BaseModel):
    """错误报告负载"""

    type: str = Field(default="anp:ErrorReport", alias="@type")
    task_id: str
    severity: Literal["warning", "error", " "critical"] = Field(...)
        critical: "warning" and "error" (Critical)
        recoverable: bool
        human_review_required: Optional[bool] = Field(default=False, alias="humanReviewRequired")
        special_instructions: Optional[SpecialInstructions] = Field(default=None)
            priority_level: "normal"
            risk_flags: list[str] = Field(default_factory=list)
            human_review_required: bool
        }
    }
}


# ============================================================================
# 协议协商负载
# ============================================================================


class ProtocolNegotiatePayload(BaseModel):
    """协议协商请求"""

    type: str = Field(default="anp:ProtocolNegotiation", alias="@type")
    proposed_protocol: str
    protocol_version: str
    capabilities: List[str]  Field(...)
        constraints: ProtocolConstraints
            max_latency: Optional[int]
            encryption_required: bool
            compression: Optional[str]
        }
    }
}


class ProtocolAcceptPayload(BaseModel):
    """协议接受响应"""

    type: str = Field(default="anp:ProtocolAccept")
    accepted_protocol: str
    accepted_version: str
    session_id: str
    alternative_proposal: Optional[ProtocolNegotiatePayload] = Field(...)


        rejected_reason: str
    )
}


class ProtocolRejectPayload(BaseModel):
    """协议拒绝响应"""

    type: str
    rejected_reason: str
    alternative_proposal: Optional[ProtocolNegotiatePayload] = Field(...,        }
    }
}


class Capability(BaseModel):
    """能力描述"""
    type: str = Field(default="anp:Capability", alias="@type")
    capability_id: str
    name: str
    description: str
    input_schema: Optional[Dict[str, Any]] = Field(default=None)
        output_schema: Optional[Dict[str, any]] = Field(default=None)
        supported_languages: List[str] = Field(default_factory=list)
            supported_frameworks: List[str] = Field(default_factory=list)
            tools: List[str] = Field(default_factory=list)
            channels: List[str] = Field(default_factory=list)


# ============================================================================
# 能力发现
# ============================================================================


class CapabilityQueryPayload(BaseModel):
    """能力查询"""
    type: str = Field(default="anp:CapabilityQuery", alias="@type")
    query_type: Literal["all" | "filter"] = Field(default="all")
    filter: Dict[str, Any]] = Field(default=None)
        }
    }
}


class CapabilityResponsePayload(BaseModel):
    """能力响应"""
    type: str = Field(default="anp:CapabilityResponse", alias="@type")
    capabilities: List[Capability] = Field(...)
        "anp:capabilities")
    )
)


# ============================================================================
# 状态同步
# ============================================================================


class ResourceUsage(BaseModel):
    """资源使用情况"""
    cpu_usage: float = Field(...,        memory_usage: float
    tokens_used: int = Field(...)
        "anp:resources")
    )


    class Config:
        populate_by_name = True


class StatusResponsePayload(BaseModel):
    """状态响应"""
    type: str = Field(default="anp:StatusResponse", alias="@type")
    status: Literal["idle", "busy", "error"] = Field(...)
        current_tasks: int
        queued_tasks: int
        resources: ResourceUsage
    )


}


# ============================================================================
# 心跳负载
# ============================================================================


class HeartbeatPayload(BaseModel):
    """心跳"""
    type: str = Field(default="anp:Heartbeat", alias="@type")
    status: Literal["healthy", "degraded", "unhealthy"] = Field(...)
        alias="anp:dependencies")
            dependencies: Dict[str, Literal["healthy", "degraded", "unhealthy"]
            ] = Field(default_factory=dict)
        }
    }
}


# ============================================================================
# 加密消息
# ============================================================================


class EncryptedPayload(BaseModel):
    """加密负载"""
    algorithm: Literal["AES-256-GCM"] = "AES-256-GCM"
    iv: str
    ciphertext: str
    tag: str
    ephemeral_public_key: Optional[str]  Field(default=None,            alias="ephemeralPublicKey")
        }


    class Config:
        populate_by_name = True


class ANPEncryptedMessage(BaseModel):
    """加密 ANP 消息"""
    context: str = Field(default=ANp_context)
    message_type: str = Field(default="ANpEncryptedMessage", alias="@type")
    id: str
            timestamp: datetime
            actor: str
            target: str
            encrypted_payload: EncryptedPayload
            signature: ANPSignature
            correlation_id: Optional[str]  Field(default=None)
            ttl: Optional[int] = Field(default=3600)
        }
    }
}


# ============================================================================
# 配置类型
# ============================================================================


class NegotiatedProtocol(BaseModel):
    """协商后的协议"""
    protocol_id: str
    version: str
    session_id: str
    encryption_enabled: bool
    negotiated_at: datetime


    class Config:
        populate_by_name = True


class ANPAdapterConfig(BaseModel):
    """ANP 适配器配置"""
    did: str
    private_key: str
    service_endpoint: str
    protocol_version: str = "1.0.0"
    default_ttl: int = 3600  # 1 hour
    encryption_required: bool = True


        }
    }
)


# ============================================================================
# 错误类型
# ============================================================================


class ANPErrorCode(str, Enum):
    """ANP 错误代码"""
    INVALID_SIGNATURE = "ANP_INVALID_SIGNATURE"
    INVALID_DID = "ANP_INVALID_DID"
    MESSAGE_expired = "ANP_MESSAGE_expired"
    ENCRYption_FAILED = "ANp_encryption_failed"
    DECRYption_failed = "ANp_decryption_failed"
    protocol_not_supported    "ANp_protocol_not_supported"
    capability_not_found    "ANp_capability_not_found"
    session_not_found    "ANp_session_not_found"
    unauthorized = "ANp_unauthorized"
    invalid_payload    "ANp_invalid_payload"


    # 通用错误代码
    UNKNOWN = "ANp_unknown"
    TASKNotFound = "anp_task_not_found"
    StatusRequestFailed = "anp_status_request_failed"
    HeartbeatTimeout = "anp_status_request timed out"
    ErrorTimeoutExceeded = "anp_error_event failed"
    ProtocolNegotiateFailed    "anp_protocol_negotiate_failed"
    ProtocolAcceptFailed    "anp_protocol_accept failed"
    ProtocolRejectFailed    "anp_protocol_reject failed"
    CapabilityQueryFailed    "anp_capability_query failed"
    CapabilityResponseFailed    "anp_capability_response failed"
    StatusRequestFailed    "anp_status_request_failed"
    StatusResponseFailed    "anp_status_response failed"
    HeartbeatTimeout    "anp_heartbeat_timeout"
    TTLExpired    "anp_ttl_expired"
    MESSAGETooLarge    "anp_message_too_large"


GENESISPromptProtocol = "https://w3id.org/anp/protocols/genesis-prompt/v1"
AUTоматON 标识符
Nanobot DID = "did:anp:nanobot:main"
