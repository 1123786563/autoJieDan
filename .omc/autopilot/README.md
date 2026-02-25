# 融合 Automaton 与 Nanobot 的接单 AI 代理系统

> 需求分析与详细设计文档集

---

## 文档索引

| 文档 | 路径 | 描述 |
|------|------|------|
| **需求分析** | [requirements-analysis.md](./requirements-analysis.md) | 功能需求、非功能需求、通信协作需求 |
| **技术设计** | [technical-design.md](./technical-design.md) | HTTP REST + WebSocket 通信架构 |
| **ANP 通信设计** | [anp-communication-design.md](./anp-communication-design.md) | 🆕 基于 ANP 协议的去中心化通信方案 |
| **实施计划** | [implementation-plan.md](./implementation-plan.md) | 开发阶段、任务分解、文件结构、API规范 |

---

## 核心设计决策

### 1. 通信协议

#### 方案 A: HTTP REST + WebSocket + 共享 SQLite（传统方案）

| 协议 | 用途 |
|------|------|
| HTTP REST | 同步请求-响应（状态查询、预算检查） |
| WebSocket | 实时事件推送（进度更新、异常告警） |
| 共享 SQLite | 异步任务队列（持久化保证） |

#### 方案 B: ANP 协议（推荐 🆕）

**ANP (Agent Network Protocol)** 是专为大规模分布式 AI 智能体网络设计的通信协议：

| 层级 | 功能 |
|------|------|
| **身份与加密层** | W3C DID 去中心化身份 + 端到端 ECC 加密 |
| **元协议层** | 动态协议协商，支持自然语言交互 |
| **应用层** | JSON-LD 语义描述，跨系统互操作 |

**ANP 核心优势**：
- 去中心化身份（无需中心化注册）
- 语义互操作性（JSON-LD 标准格式）
- 原生端到端加密
- 动态协议协商能力
- 支持未来接入更多 Agent 网络

### 2. 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        外包平台                                  │
│              (Upwork / Freelancer / GitHub Issues)              │
└───────────────────────────┬─────────────────────────────────────┘
                            │ API / Webhook
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Automaton (TypeScript)                       │
│                        Port: 18790                               │
│  ┌─────────────┬─────────────┬─────────────┬─────────────────┐  │
│  │  平台对接   │  项目筛选   │  合同评估   │   经济生存管理  │  │
│  └─────────────┴─────────────┴─────────────┴─────────────────┘  │
│                              │                                   │
│              HTTP REST / WebSocket / Shared SQLite              │
│                              │                                   │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Nanobot (Python)                            │
│                        Port: 18791                               │
│  ┌─────────────┬─────────────┬─────────────┬─────────────────┐  │
│  │  需求分析   │  代码生成   │  测试执行   │   客户沟通      │  │
│  └─────────────┴─────────────┴─────────────┴─────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 3. 核心接口

#### Genesis Prompt (创世提示)

```typescript
interface GenesisPrompt {
  projectId: string;              // 项目标识
  requirementSummary: string;     // 需求摘要
  technicalConstraints: {...};    // 技术约束
  contractTerms: {...};           // 商务条款
  resourceLimits: {...};          // 资源限制
  specialInstructions?: {...};    // 特殊指示
}
```

#### 消息格式

```typescript
interface InterAgentMessage {
  id: string;                     // ULID
  version: string;                // "1.0.0"
  timestamp: string;              // ISO 8601
  source: "automaton" | "nanobot";
  target: "automaton" | "nanobot";
  type: MessageType;              // 消息类型
  payload: unknown;               // 消息体
  metadata: MessageMetadata;      // 元数据
}
```

### 4. 关键特性

| 特性 | 实现 |
|------|------|
| **可靠性** | SQLite WAL 模式 + 租约机制 + 死信队列 |
| **安全性** | HMAC-SHA256 认证 + TLS 1.3 |
| **可观测性** | 结构化日志 + Prometheus 指标 |
| **可扩展性** | 多 Nanobot 实例 + 任务分片 |

---

## 实施时间线

```
Week 1-2: 核心基础设施
├── 通信层基础 (HTTP/WebSocket)
├── SQLite 任务队列
└── 健康检查端点

Week 3: Genesis Prompt 实现
├── 任务分发逻辑
├── 预算约束集成
└── 项目上下文传递

Week 4: 报告机制
├── 进度报告
├── 资源消耗追踪
└── 异常检测与告警

Week 5: 安全与认证
├── HMAC 签名
├── 密钥管理
└── 访问控制

Week 6: 集成测试
├── 端到端测试
├── 性能基准
└── 安全测试
```

---

## 新增文件结构

### Automaton 端

```
automaton/src/interagent/
├── index.ts              # 模块导出
├── types.ts              # 类型定义
├── client.ts             # HTTP 客户端
├── server.ts             # API 服务器
├── websocket.ts          # WebSocket
├── queue.ts              # 任务队列
├── dlq.ts                # 死信队列
└── auth.ts               # 认证
```

### Nanobot 端

```
nanobot/nanobot/interagent/
├── __init__.py
├── types.py              # Pydantic 模型
├── client.py             # HTTP 客户端
├── server.py             # FastAPI 服务器
├── websocket.py          # WebSocket
├── queue.py              # 任务轮询
└── auth.py               # 认证
```

---

## 下一步行动

1. **确认开放问题** - 需要用户决策的 7 个关键问题
2. **环境准备** - 安装依赖，配置开发环境
3. **开始 Sprint 1** - 从共享类型定义开始

---

*文档集版本: 1.0.0*
*创建日期: 2026-02-25*
