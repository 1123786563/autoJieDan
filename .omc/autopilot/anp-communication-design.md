# 基于 ANP 协议的通信协作设计

> Automaton + Nanobot 双系统 ANP 集成方案

---

## 1. ANP 协议概述

### 1.1 什么是 ANP (Agent Network Protocol)

**ANP** 是专为大规模分布式 AI 智能体网络设计的通信协议框架，核心目标是实现不同智能体之间的**去中心化协作**。

| 属性 | 说明 |
|------|------|
| **核心目标** | 实现不同智能体之间的去中心化协作 |
| **设计理念** | Web3 + AI 结合，去中心化、开放、可扩展 |
| **定位** | 打造没有主节点的 AI 互联网 |

### 1.2 ANP 三层架构

```
┌─────────────────────────────────────────────────────────────┐
│                     应用层 (Application)                     │
│          JSON-LD / RDF / schema.org 语义描述                │
│              描述代理能力，实现语义互操作性                    │
├─────────────────────────────────────────────────────────────┤
│                    元协议层 (Meta-Protocol)                  │
│          动态协议协商，自然语言交互建立通信协议                │
│              支持灵活自适应的协调机制                         │
├─────────────────────────────────────────────────────────────┤
│              身份与加密通信层 (Identity & Crypto)            │
│          基于 W3C DID 标准 + 端到端 ECC 加密                 │
│              跨平台认证与机密通信                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 与其他协议对比

| 协议 | 核心定位 | 适用场景 |
|------|----------|----------|
| **MCP** | 模型与工具对接 | Agent 接入外部工具 |
| **A2A** | 跨平台 Agent 通信 | Agent 彼此对话 |
| **ACP** | 本地智能体协作 | 单机多 Agent |
| **ANP** | 去中心化 AI 网络 | 大规模分布式协作 |

---

## 2. 基于 ANP 的双系统架构

### 2.1 架构设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ANP 网络层                                  │
│                    (去中心化身份 + P2P 发现)                         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
        ┌───────────────────────┴───────────────────────┐
        │                                               │
        ▼                                               ▼
┌───────────────────────────┐           ┌───────────────────────────┐
│       Automaton           │           │        Nanobot            │
│      (TypeScript)         │           │        (Python)           │
│                           │           │                           │
│  ┌─────────────────────┐  │   ANP     │  ┌─────────────────────┐  │
│  │  DID: did:anp:aut   │◄─┼───────────┼─►│  DID: did:anp:nan   │  │
│  └─────────────────────┘  │   P2P     │  └─────────────────────┘  │
│                           │           │                           │
│  ┌─────────────────────┐  │           │  ┌─────────────────────┐  │
│  │  能力描述 (JSON-LD)  │  │           │  │  能力描述 (JSON-LD)  │  │
│  │  - 经济决策          │  │           │  │  - 代码生成          │  │
│  │  - 项目管理          │  │           │  │  - 测试执行          │  │
│  │  - 区块链操作        │  │           │  │  - 客户沟通          │  │
│  └─────────────────────┘  │           │  └─────────────────────┘  │
│                           │           │                           │
│  ┌─────────────────────┐  │           │  ┌─────────────────────┐  │
│  │  ANP 适配器         │  │           │  │  ANP 适配器          │  │
│  │  - DID 解析         │  │           │  │  - DID 解析          │  │
│  │  - 消息加密         │  │           │  │  - 消息解密          │  │
│  │  - 协议协商         │  │           │  │  - 协议协商          │  │
│  └─────────────────────┘  │           │  └─────────────────────┘  │
└───────────────────────────┘           └───────────────────────────┘
```

### 2.2 DID 身份标识

**Automaton DID 文档**:
```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/anp/v1"
  ],
  "id": "did:anp:automaton:main",
  "controller": "did:anp:automaton:main",
  "verificationMethod": [{
    "id": "did:anp:automaton:main#key-1",
    "type": "JsonWebKey2020",
    "controller": "did:anp:automaton:main",
    "publicKeyJwk": {
      "kty": "EC",
      "crv": "P-256",
      "x": "...",
      "y": "..."
    }
  }],
  "authentication": ["did:anp:automaton:main#key-1"],
  "keyAgreement": ["did:anp:automaton:main#key-1"],
  "service": [{
    "id": "did:anp:automaton:main#anp-service",
    "type": "ANPMessageService",
    "serviceEndpoint": "https://automaton.local/anp"
  }],
  "capabilityDescription": {
    "@context": "https://schema.org",
    "@type": "SoftwareAgent",
    "name": "Automaton",
    "description": "自主生存型 AI 经济主体",
    "capabilities": [
      "economic-decision",
      "project-management",
      "blockchain-operations",
      "survival-management"
    ]
  }
}
```

**Nanobot DID 文档**:
```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/anp/v1"
  ],
  "id": "did:anp:nanobot:main",
  "controller": "did:anp:nanobot:main",
  "verificationMethod": [{
    "id": "did:anp:nanobot:main#key-1",
    "type": "JsonWebKey2020",
    "controller": "did:anp:nanobot:main",
    "publicKeyJwk": {
      "kty": "EC",
      "crv": "P-256",
      "x": "...",
      "y": "..."
    }
  }],
  "authentication": ["did:anp:nanobot:main#key-1"],
  "keyAgreement": ["did:anp:nanobot:main#key-1"],
  "service": [{
    "id": "did:anp:nanobot:main#anp-service",
    "type": "ANPMessageService",
    "serviceEndpoint": "https://nanobot.local/anp"
  }],
  "capabilityDescription": {
    "@context": "https://schema.org",
    "@type": "SoftwareAgent",
    "name": "Nanobot",
    "description": "超轻量级 AI 代理框架",
    "capabilities": [
      "code-generation",
      "testing",
      "customer-communication",
      "multi-platform-messaging"
    ]
  }
}
```

---

## 3. ANP 消息格式

### 3.1 标准消息信封

```typescript
/**
 * ANP 标准消息格式
 * 基于 JSON-LD 语义网标准
 */
interface ANPMessage {
  // JSON-LD 上下文
  "@context": [
    "https://www.w3.org/ns/activitystreams/v1",
    "https://w3id.org/anp/v1",
    "https://w3id.org/security/v1"
  ];

  // 消息类型
  "@type": "ANPMessage";

  // 消息标识
  id: string;                    // ULID
  timestamp: string;             // ISO 8601

  // 发送方与接收方 (DID)
  actor: string;                 // 发送方 DID
  target: string;                // 接收方 DID

  // 消息内容
  type: ANPMessageType;          // 消息类型
  object: ANPPayload;            // 消息负载 (JSON-LD)

  // 安全与追踪
  signature: ANPSignature;       // 数字签名
  correlationId?: string;        // 关联 ID (请求-响应)
  ttl?: number;                  // 有效期(秒)
}

/**
 * ANP 消息类型枚举
 */
type ANPMessageType =
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

/**
 * ANP 数字签名
 */
interface ANPSignature {
  type: "EcdsaSecp256r1Signature2019";
  created: string;               // ISO 8601
  verificationMethod: string;    // DID + key ID
  proofPurpose: "authentication" | "keyAgreement";
  proofValue: string;            // Base64 签名
}
```

### 3.2 任务创建消息示例 (Genesis Prompt)

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams/v1",
    "https://w3id.org/anp/v1",
    "https://w3id.org/security/v1",
    {
      "genesis": "https://w3id.org/anp/genesis#"
    }
  ],
  "@type": "ANPMessage",
  "id": "01HXYZ123456789",
  "timestamp": "2026-02-25T10:30:00.000Z",
  "actor": "did:anp:automaton:main",
  "target": "did:anp:nanobot:main",
  "type": "TaskCreate",
  "object": {
    "@type": "genesis:GenesisPrompt",
    "genesis:projectId": "upwork-123456",
    "genesis:platform": "upwork",
    "genesis:requirementSummary": "开发一个 React 电商前端",
    "genesis:technicalConstraints": {
      "@type": "genesis:TechnicalConstraints",
      "genesis:requiredStack": ["React", "TypeScript", "TailwindCSS"],
      "genesis:prohibitedStack": ["jQuery"],
      "genesis:targetPlatform": "Vercel"
    },
    "genesis:contractTerms": {
      "@type": "genesis:ContractTerms",
      "genesis:totalBudget": {
        "@type": "schema:MonetaryAmount",
        "schema:value": 50000,
        "schema:currency": "USD"
      },
      "genesis:deadline": "2026-03-15T00:00:00.000Z",
      "genesis:milestones": [
        {
          "@type": "genesis:Milestone",
          "genesis:name": "MVP",
          "genesis:percentage": 30,
          "genesis:dueDate": "2026-03-01T00:00:00.000Z"
        }
      ]
    },
    "genesis:resourceLimits": {
      "@type": "genesis:ResourceLimits",
      "genesis:maxTokensPerTask": 1000000,
      "genesis:maxCostCents": 15000,
      "genesis:maxDurationMs": 86400000
    }
  },
  "signature": {
    "type": "EcdsaSecp256r1Signature2019",
    "created": "2026-02-25T10:30:00.000Z",
    "verificationMethod": "did:anp:automaton:main#key-1",
    "proofPurpose": "authentication",
    "proofValue": "Base64EncodedSignature..."
  },
  "correlationId": "corr-01HABC",
  "ttl": 3600
}
```

### 3.3 进度报告消息示例

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams/v1",
    "https://w3id.org/anp/v1",
    "https://w3id.org/security/v1"
  ],
  "@type": "ANPMessage",
  "id": "01HXYZ987654321",
  "timestamp": "2026-02-25T14:30:00.000Z",
  "actor": "did:anp:nanobot:main",
  "target": "did:anp:automaton:main",
  "type": "ProgressEvent",
  "object": {
    "@type": "anp:ProgressReport",
    "anp:taskId": "01HXYZ123456789",
    "anp:progress": 45,
    "anp:currentPhase": "组件开发",
    "anp:completedSteps": [
      "项目初始化",
      "基础组件搭建",
      "首页布局"
    ],
    "anp:nextSteps": [
      "商品列表页",
      "购物车功能"
    ],
    "anp:etaSeconds": 14400,
    "anp:blockers": []
  },
  "signature": {
    "type": "EcdsaSecp256r1Signature2019",
    "created": "2026-02-25T14:30:00.000Z",
    "verificationMethod": "did:anp:nanobot:main#key-1",
    "proofPurpose": "authentication",
    "proofValue": "Base64EncodedSignature..."
  },
  "correlationId": "corr-01HABC"
}
```

---

## 4. 元协议层设计

### 4.1 动态协议协商

ANP 的元协议层允许代理通过自然语言交互**动态建立通信协议**。

```typescript
/**
 * 协议协商流程
 */
interface ProtocolNegotiation {
  // 协商请求
  request: {
    proposedProtocol: string;     // 提议的协议 ID
    protocolVersion: string;      // 版本号
    capabilities: string[];       // 所需能力
    constraints: {                // 约束条件
      maxLatency?: number;
      encryptionRequired: boolean;
      compression?: string;
    };
  };

  // 协商响应
  response: {
    accepted: boolean;
    acceptedProtocol?: string;
    acceptedVersion?: string;
    rejectedReason?: string;
    alternativeProposal?: ProtocolNegotiation['request'];
  };
}
```

### 4.2 协议协商消息示例

```json
{
  "@context": ["https://w3id.org/anp/v1"],
  "@type": "ANPMessage",
  "id": "negotiate-001",
  "timestamp": "2026-02-25T10:00:00.000Z",
  "actor": "did:anp:automaton:main",
  "target": "did:anp:nanobot:main",
  "type": "ProtocolNegotiate",
  "object": {
    "@type": "anp:ProtocolNegotiation",
    "anp:proposedProtocol": "https://w3id.org/anp/protocols/genesis-prompt/v1",
    "anp:protocolVersion": "1.0.0",
    "anp:capabilities": [
      "code-generation",
      "progress-reporting",
      "resource-tracking"
    ],
    "anp:constraints": {
      "anp:maxLatency": 5000,
      "anp:encryptionRequired": true,
      "anp:compression": "gzip"
    }
  }
}
```

### 4.3 自然语言协议协商

ANP 支持通过自然语言进行协议协商（元协议特性）：

```json
{
  "@type": "ANPMessage",
  "type": "ProtocolNegotiate",
  "object": {
    "@type": "anp:NaturalLanguageNegotiation",
    "anp:intent": "我需要建立一个代码开发任务的协作协议",
    "anp:expectations": [
      "支持增量交付",
      "每4小时报告进度",
      "预算超支时需要确认"
    ],
    "anp:constraints": {
      "自然语言描述": "任务需要在2周内完成，使用React技术栈"
    }
  }
}
```

---

## 5. 端到端加密通信

### 5.1 密钥交换流程

```
Automaton                                    Nanobot
    │                                           │
    │  1. DID 文档交换 (包含公钥)                │
    │◄─────────────────────────────────────────►│
    │                                           │
    │  2. ECDH 密钥协商                         │
    │  shared_key = ECDH(priv_aut, pub_nan)    │
    │  shared_key = ECDH(priv_nan, pub_aut)    │
    │◄─────────────────────────────────────────►│
    │                                           │
    │  3. 派生会话密钥                          │
    │  session_key = HKDF(shared_key, salt)    │
    │◄─────────────────────────────────────────►│
    │                                           │
    │  4. 加密通信                              │
    │  encrypted = AES-256-GCM(plaintext, key) │
    │◄─────────────────────────────────────────►│
    │                                           │
```

### 5.2 加密消息结构

```typescript
interface ANPEncryptedMessage {
  "@context": "https://w3id.org/anp/v1";
  "@type": "ANPEncryptedMessage";

  // 元数据 (明文)
  id: string;
  timestamp: string;
  actor: string;                 // 发送方 DID
  target: string;                // 接收方 DID

  // 加密内容
  encryptedPayload: {
    algorithm: "AES-256-GCM";
    iv: string;                  // Base64 初始化向量
    ciphertext: string;          // Base64 密文
    tag: string;                 // Base64 认证标签
    ephemeralPublicKey?: string; // 临时公钥 (可选)
  };

  // 签名 (对整个消息)
  signature: ANPSignature;
}
```

---

## 6. 能力发现与语义描述

### 6.1 能力描述 (JSON-LD)

**Automaton 能力描述**:
```json
{
  "@context": [
    "https://schema.org",
    "https://w3id.org/anp/capabilities/v1"
  ],
  "@id": "did:anp:automaton:main",
  "@type": "SoftwareAgent",
  "name": "Automaton",
  "description": "自主生存型 AI 经济主体",

  "capability": [
    {
      "@type": "anp:Capability",
      "anp:capabilityId": "economic-decision",
      "anp:name": "经济决策",
      "anp:description": "项目筛选、合同评估、资源分配",
      "anp:inputSchema": {
        "@type": "schema:Thing",
        "schema:description": "项目信息"
      },
      "anp:outputSchema": {
        "@type": "schema:Thing",
        "schema:description": "决策结果"
      }
    },
    {
      "@type": "anp:Capability",
      "anp:capabilityId": "project-management",
      "anp:name": "项目管理",
      "anp:description": "任务分发、进度跟踪、验收确认",
      "anp:dependencies": []
    },
    {
      "@type": "anp:Capability",
      "anp:capabilityId": "blockchain-operations",
      "anp:name": "区块链操作",
      "anp:description": "钱包管理、交易签名、智能合约交互",
      "anp:requires": ["ethereum-private-key"]
    }
  ],

  "anp:protocols": [
    {
      "@type": "anp:SupportedProtocol",
      "anp:protocolId": "https://w3id.org/anp/protocols/genesis-prompt/v1",
      "anp:role": "initiator"
    }
  ]
}
```

**Nanobot 能力描述**:
```json
{
  "@context": [
    "https://schema.org",
    "https://w3id.org/anp/capabilities/v1"
  ],
  "@id": "did:anp:nanobot:main",
  "@type": "SoftwareAgent",
  "name": "Nanobot",
  "description": "超轻量级 AI 代理框架",

  "capability": [
    {
      "@type": "anp:Capability",
      "anp:capabilityId": "code-generation",
      "anp:name": "代码生成",
      "anp:description": "全栈代码开发、重构、优化",
      "anp:supportedLanguages": ["TypeScript", "Python", "Rust", "Go"],
      "anp:supportedFrameworks": ["React", "Next.js", "FastAPI", "Django"]
    },
    {
      "@type": "anp:Capability",
      "anp:capabilityId": "testing",
      "anp:name": "测试执行",
      "anp:description": "单元测试、集成测试、E2E测试",
      "anp:tools": ["vitest", "pytest", "playwright"]
    },
    {
      "@type": "anp:Capability",
      "anp:capabilityId": "customer-communication",
      "anp:name": "客户沟通",
      "anp:description": "需求澄清、进度报告、反馈处理",
      "anp:channels": ["telegram", "slack", "email", "discord"]
    }
  ],

  "anp:protocols": [
    {
      "@type": "anp:SupportedProtocol",
      "anp:protocolId": "https://w3id.org/anp/protocols/genesis-prompt/v1",
      "anp:role": "executor"
    }
  ]
}
```

### 6.2 能力查询消息

```json
{
  "@context": ["https://w3id.org/anp/v1"],
  "@type": "ANPMessage",
  "id": "query-001",
  "timestamp": "2026-02-25T09:00:00.000Z",
  "actor": "did:anp:automaton:main",
  "target": "did:anp:nanobot:main",
  "type": "CapabilityQuery",
  "object": {
    "@type": "anp:CapabilityQuery",
    "anp:queryType": "filter",
    "anp:filter": {
      "anp:capabilityId": "code-generation",
      "anp:supportedLanguages": "TypeScript"
    }
  }
}
```

---

## 7. 实现架构

### 7.1 TypeScript (Automaton) ANP 适配器

```typescript
// automaton/src/anp/index.ts

import { createDidDocument, resolveDid, signMessage, verifyMessage } from './did';
import { encryptMessage, decryptMessage, establishSession } from './crypto';
import { negotiateProtocol } from './protocol';
import { discoverCapabilities } from './capability';

export interface ANPAdapterConfig {
  did: string;
  privateKey: string;
  serviceEndpoint: string;
}

export class ANPAdapter {
  private did: string;
  private privateKey: string;
  private sessionKeys: Map<string, CryptoKey> = new Map();

  constructor(config: ANPAdapterConfig) {
    this.did = config.did;
    this.privateKey = config.privateKey;
  }

  /**
   * 发送 ANP 消息
   */
  async sendMessage(
    targetDid: string,
    type: ANPMessageType,
    payload: ANPPayload
  ): Promise<string> {
    // 1. 解析目标 DID，获取公钥和服务端点
    const targetDoc = await resolveDid(targetDid);
    const endpoint = targetDoc.service[0].serviceEndpoint;
    const targetPublicKey = targetDoc.verificationMethod[0].publicKeyJwk;

    // 2. 建立或获取会话密钥
    let sessionKey = this.sessionKeys.get(targetDid);
    if (!sessionKey) {
      sessionKey = await establishSession(this.privateKey, targetPublicKey);
      this.sessionKeys.set(targetDid, sessionKey);
    }

    // 3. 构建消息
    const message: ANPMessage = {
      "@context": ["https://w3id.org/anp/v1"],
      "@type": "ANPMessage",
      id: ulid(),
      timestamp: new Date().toISOString(),
      actor: this.did,
      target: targetDid,
      type,
      object: payload,
      signature: await signMessage(/* ... */),
    };

    // 4. 加密消息
    const encrypted = await encryptMessage(message, sessionKey);

    // 5. 发送到目标端点
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encrypted),
    });

    return response.json();
  }

  /**
   * 接收并处理 ANP 消息
   */
  async receiveMessage(encrypted: ANPEncryptedMessage): Promise<ANPMessage> {
    // 1. 验证发送方 DID
    const senderDoc = await resolveDid(encrypted.actor);

    // 2. 获取会话密钥并解密
    const sessionKey = this.sessionKeys.get(encrypted.actor);
    if (!sessionKey) {
      throw new Error('No session key for sender');
    }

    const decrypted = await decryptMessage(encrypted, sessionKey);

    // 3. 验证签名
    const isValid = await verifyMessage(decrypted, senderDoc);
    if (!isValid) {
      throw new Error('Invalid message signature');
    }

    // 4. 返回解密后的消息
    return decrypted;
  }

  /**
   * 发起协议协商
   */
  async negotiateProtocol(
    targetDid: string,
    protocol: string,
    capabilities: string[]
  ): Promise<boolean> {
    const response = await this.sendMessage(targetDid, 'ProtocolNegotiate', {
      proposedProtocol: protocol,
      capabilities,
      constraints: { encryptionRequired: true },
    });

    return response.accepted;
  }
}
```

### 7.2 Python (Nanobot) ANP 适配器

```python
# nanobot/nanobot/anp/__init__.py

from dataclasses import dataclass
from typing import Optional, Dict, Any
from pydantic import BaseModel
import aiohttp
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization

class ANPMessage(BaseModel):
    context: list[str] = ["https://w3id.org/anp/v1"]
    type: str = "ANPMessage"
    id: str
    timestamp: str
    actor: str
    target: str
    message_type: str
    object: Dict[str, Any]
    signature: Dict[str, Any]
    correlation_id: Optional[str] = None
    ttl: Optional[int] = None

    class Config:
        fields = {
            'context': '@context',
            'message_type': 'type',
            'correlation_id': 'correlationId'
        }

@dataclass
class ANPAdapterConfig:
    did: str
    private_key: ec.EllipticCurvePrivateKey
    service_endpoint: str

class ANPAdapter:
    """ANP 协议适配器 - Python 实现"""

    def __init__(self, config: ANPAdapterConfig):
        self.did = config.did
        self.private_key = config.private_key
        self.service_endpoint = config.service_endpoint
        self._session_keys: Dict[str, bytes] = {}

    async def resolve_did(self, did: str) -> dict:
        """解析 DID 文档"""
        # 实际实现需要连接 DID 解析器
        pass

    async def send_message(
        self,
        target_did: str,
        message_type: str,
        payload: dict
    ) -> dict:
        """发送 ANP 消息"""
        # 1. 解析目标 DID
        target_doc = await self.resolve_did(target_did)
        endpoint = target_doc["service"][0]["serviceEndpoint"]

        # 2. 构建消息
        message = ANPMessage(
            id=generate_ulid(),
            timestamp=datetime.utcnow().isoformat(),
            actor=self.did,
            target=target_did,
            message_type=message_type,
            object=payload,
            signature=await self._sign_message(...)
        )

        # 3. 加密并发送
        encrypted = await self._encrypt_message(message, target_did)

        async with aiohttp.ClientSession() as session:
            async with session.post(
                endpoint,
                json=encrypted.dict(),
                headers={"Content-Type": "application/json"}
            ) as response:
                return await response.json()

    async def receive_message(self, encrypted: dict) -> ANPMessage:
        """接收并解密 ANP 消息"""
        # 1. 解密消息
        decrypted = await self._decrypt_message(encrypted)

        # 2. 验证签名
        sender_doc = await self.resolve_did(encrypted["actor"])
        if not await self._verify_signature(decrypted, sender_doc):
            raise ValueError("Invalid signature")

        return ANPMessage(**decrypted)

    async def handle_task_create(self, message: ANPMessage) -> None:
        """处理任务创建消息 (Genesis Prompt)"""
        genesis_prompt = message.object

        # 解析任务参数
        project_id = genesis_prompt["genesis:projectId"]
        requirements = genesis_prompt["genesis:requirementSummary"]

        # 开始执行任务
        # ...

        # 发送进度报告
        await self.send_message(
            message.actor,
            "ProgressEvent",
            {
                "@type": "anp:ProgressReport",
                "anp:taskId": message.id,
                "anp:progress": 0,
                "anp:currentPhase": "任务初始化"
            }
        )
```

---

## 8. 与原有架构的集成

### 8.1 双协议支持策略

为了平滑过渡，建议采用**双协议支持**策略：

```
┌─────────────────────────────────────────────────────────────┐
│                     应用层                                   │
│              (业务逻辑保持不变)                               │
├─────────────────────────────────────────────────────────────┤
│                    协议适配层                                │
│         ┌─────────────┬──────────────────────┐              │
│         │  ANP 协议   │   HTTP REST + WS     │              │
│         │  (新方案)   │   (兼容方案)          │              │
│         └─────────────┴──────────────────────┘              │
├─────────────────────────────────────────────────────────────┤
│                    传输层                                    │
│              HTTP / WebSocket / P2P                         │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 配置切换

```yaml
# ~/.automaton/interagent.yml
interagent:
  # 协议选择
  protocol:
    # 主要协议: anp | http
    primary: anp

    # 回退协议
    fallback: http

  # ANP 配置
  anp:
    enabled: true
    did:
      method: anp
      identifier: automaton:main
    crypto:
      algorithm: ECDSA-P256
      key_rotation_days: 30
    discovery:
      enabled: true
      cache_ttl_seconds: 3600

  # HTTP 配置 (兼容模式)
  http:
    enabled: true
    automaton_port: 18790
    nanobot_port: 18791
```

---

## 9. 实施路线图

### Phase 1: ANP 基础设施 (Week 1-2)

| 任务 | 优先级 | 工时 |
|------|--------|------|
| DID 文档生成与管理 | P0 | 8h |
| ECDSA 签名/验证 | P0 | 4h |
| ECDH 密钥交换 | P0 | 8h |
| ANP 消息序列化/反序列化 | P0 | 4h |

### Phase 2: 协议层实现 (Week 3)

| 任务 | 优先级 | 工时 |
|------|--------|------|
| 协议协商机制 | P0 | 8h |
| 能力发现服务 | P1 | 4h |
| 元协议层 (自然语言协商) | P2 | 8h |

### Phase 3: 业务集成 (Week 4)

| 任务 | 优先级 | 工时 |
|------|--------|------|
| Genesis Prompt ANP 适配 | P0 | 8h |
| 进度报告 ANP 适配 | P0 | 4h |
| 异常处理 ANP 适配 | P1 | 4h |

### Phase 4: 测试与优化 (Week 5)

| 任务 | 优先级 | 工时 |
|------|--------|------|
| 端到端加密测试 | P0 | 4h |
| 协议协商测试 | P0 | 4h |
| 性能基准测试 | P1 | 4h |

---

## 10. 优势与权衡

### 10.1 ANP 协议优势

| 优势 | 说明 |
|------|------|
| **去中心化身份** | 无需中心化注册，自主身份管理 |
| **语义互操作** | JSON-LD 语义描述，跨系统理解 |
| **动态协议协商** | 灵活适应不同协作场景 |
| **端到端加密** | 原生安全通信保障 |
| **可扩展性** | 支持未来接入更多 Agent |

### 10.2 实施权衡

| 方面 | ANP 方案 | HTTP 方案 |
|------|----------|-----------|
| **复杂度** | 较高 | 较低 |
| **安全性** | 原生加密 | 需额外实现 |
| **互操作性** | 高（语义标准） | 中（自定义格式） |
| **开发周期** | 5周 | 2周 |
| **未来扩展** | 支持多 Agent 网络 | 需重构 |

---

## 参考资料

- [ANP 协议规范](https://w3id.org/anp)
- [W3C DID 标准](https://www.w3.org/TR/did-core/)
- [JSON-LD 规范](https://www.w3.org/TR/json-ld11/)
- [AI Agent 协议全景分析 - 掘金](https://juejin.cn/post/7609562445217071147)
- [AI Agent Protocols: MCP vs A2A vs ANP vs ACP - DEV Community](https://dev.to/dr_hernani_costa/ai-agent-protocols-mcp-vs-a2a-vs-anp-vs-acp-4k98)

---

*文档版本: 1.0.0*
*最后更新: 2026-02-25*
*作者: Claude Architect Agent*
