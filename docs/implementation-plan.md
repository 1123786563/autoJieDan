# 实施计划文档：融合Automaton与Nanobot的接单AI代理系统

> **版本**: 1.0.0
> **创建日期**: 2026-03-01
> **基于**: 详细设计文档 v1.1.0
> **目标**: Phase 1 MVP交付 (6周)

---

## 目录

1. [RALPLAN-DR决策摘要](#1-ralplan-dr决策摘要)
2. [项目概述](#2-项目概述)
3. [实施阶段划分](#3-实施阶段划分)
4. [Phase 1A详细任务](#4-phase-1a-基础设施-week-1)
5. [Phase 1B详细任务](#5-phase-1b-通信层-week-2)
6. [Phase 1C详细任务](#6-phase-1c-automaton业务层-week-3)
7. [Phase 1D详细任务](#7-phase-1d-nanobot业务层-week-4)
8. [Phase 1E详细任务](#8-phase-1e-集成与测试-week-5)
9. [Phase 1F详细任务](#9-phase-1f-部署与验证-week-6)
10. [风险与缓解](#10-风险与缓解)
11. [验收标准](#11-验收标准)

---

## 1. RALPLAN-DR决策摘要

### 1.1 核心原则 (Principles)

1. **简化优先**: Phase 1仅实现核心流程，推迟非关键功能至Phase 2
2. **数据库独占**: Automaton独占SQLite访问，Nanobot通过ANP消息委托操作
3. **人工介入安全**: 关键决策必须有人工确认，超时有明确降级策略
4. **可观测性优先**: 所有核心操作必须有埋点记录
5. **渐进增强**: 架构支持从单体平滑演进到微服务

### 1.2 决策驱动因素 (Decision Drivers)

| 优先级 | 驱动因素 | 说明 |
|--------|----------|------|
| 1 | **交付速度** | 6周内交付可验证的MVP |
| 2 | **数据安全** | 避免SQLite并发写入冲突 |
| 3 | **成本控制** | 严格的LLM调用和预算监控 |

### 1.3 可行选项 (Viable Options)

#### 选项A: 单体应用 (选中) ✅
- **描述**: Automaton和Nanobot在同一容器内运行，共享SQLite
- **优势**: 部署简单、数据访问无延迟、开发调试方便
- **劣势**: 资源耦合、需协调两种语言的依赖
- **适用场景**: Phase 1 MVP

#### 选项B: 微服务架构 (备选)
- **描述**: Automaton和Nanobot独立部署，通过API通信
- **优势**: 独立扩展、技术栈隔离
- **劣势**: 网络延迟、部署复杂度高、数据同步挑战
- **适用场景**: Phase 3+

### 1.4 ADR (Architecture Decision Record)

| 字段 | 内容 |
|------|------|
| **Decision** | Phase 1采用单体应用架构，Automaton独占数据库，Nanobot通过ANP委托访问 |
| **Drivers** | 交付速度、数据安全、成本控制 |
| **Alternatives** | 微服务架构、独立数据库 |
| **Why Chosen** | 单体架构最快交付；数据库独占避免SQLite并发问题 |
| **Consequences** | 需要实现ANP消息代理层；需要规划Phase 2迁移路径 |
| **Follow-ups** | Phase 2评估PostgreSQL迁移；Phase 3考虑微服务拆分 |

---

## 2. 项目概述

### 2.1 目标

构建一个能够自动发现、评估、投标和执行Upwork项目的AI代理系统。

### 2.2 MVP范围 (Phase 1)

| 模块 | 功能 | 优先级 |
|------|------|--------|
| 项目发现 | RSS监控、项目评分、自动过滤 | P0 |
| 投标管理 | 投标生成、投标提交 | P0 |
| 合同管理 | 合同签署确认 (人工) | P0 |
| 任务执行 | Genesis Prompt、需求分析、代码生成、测试执行、进度报告 | P0 |
| 人工介入 | 合同确认、大额支出、纠纷处理 | P0 |
| 监控告警 | 健康检查、成本告警 | P0 |

### 2.3 MVP不包含 (Phase 2+)

- 多平台支持 (Fiverr等)
- A/B测试框架
- 知识库向量搜索
- 多租户支持

### 2.4 技术栈

**Automaton (TypeScript)**:
- Node.js 20+, TypeScript 5.9+, pnpm 10.x
- better-sqlite3, ws, undici, vitest

**Nanobot (Python)**:
- Python 3.11+, Pydantic v2, LiteLLM
- websocket-client, httpx, pytest, ruff

---

## 3. 实施阶段划分

```
Week 1         Week 2         Week 3         Week 4         Week 5         Week 6
│──────────────│──────────────│──────────────│──────────────│──────────────│──────────────│
Phase 1A       Phase 1B       Phase 1C       Phase 1D       Phase 1E       Phase 1F
基础设施       通信层         Automaton业务  Nanobot业务    集成测试       部署验证
```

### 3.1 Phase 1A: 基础设施 (Week 1)

**目标**: 搭建开发环境和数据层

| 任务ID | 任务名称 | 依赖 | 工时 | 文件 |
|--------|----------|------|------|------|
| 1A-01 | 数据库Schema迁移 | 无 | 2h | `automaton/src/state/schema-v11.ts` |
| 1A-02 | 类型定义生成 | 1A-01 | 3h | `automaton/src/freelance/types.ts` |
| 1A-03 | 数据访问层实现 | 1A-02 | 4h | `automaton/src/freelance/repository.ts` |
| 1A-04 | 埋点事件采集 | 1A-03 | 3h | `automaton/src/freelance/analytics.ts` |
| 1A-05 | 基础测试配置 | 无 | 2h | `automaton/vitest.config.freelance.ts` |
| 1A-06 | Docker配置更新 | 无 | 2h | `docker-compose.yml` |

### 3.2 Phase 1B: 通信层 (Week 2)

**目标**: 实现ANP消息和WebSocket通信

| 任务ID | 任务名称 | 依赖 | 工时 | 文件 |
|--------|----------|------|------|------|
| 1B-01 | ANP消息类型定义 | 无 | 2h | `automaton/src/anp/freelance-message-types.ts` |
| 1B-02 | Genesis Prompt接口 | 1B-01 | 3h | `automaton/src/freelance/genesis-sender.ts` |
| 1B-03 | Progress Report接口 | 1B-01 | 2h | `automaton/src/freelance/progress-handler.ts` |
| 1B-04 | Error Report接口 | 1B-01 | 2h | `automaton/src/freelance/error-handler.ts` |
| 1B-05 | WebSocket服务器增强 | 1B-02 | 4h | `automaton/src/interagent/websocket.ts` (修改) |
| 1B-06 | WebSocket客户端增强 | 1B-02 | 4h | `nanobot/nanobot/interagent/websocket.py` (修改) |
| 1B-07 | 重连状态同步协议 | 1B-05, 1B-06 | 4h | `automaton/src/interagent/reconnection.ts` (新增) |
| 1B-08 | 消息持久化 | 1B-05 | 3h | `automaton/src/interagent/message-buffer.ts` (新增) |

### 3.3 Phase 1C: Automaton业务层 (Week 3)

**目标**: 实现项目发现和投标管理

| 任务ID | 任务名称 | 依赖 | 工时 | 文件 |
|--------|----------|------|------|------|
| 1C-01 | Upwork API客户端 | 无 | 4h | `automaton/src/upwork/client.ts` (新增) |
| 1C-02 | 限流器实现 | 无 | 2h | `automaton/src/upwork/rate-limiter.ts` (新增) |
| 1C-03 | 项目评分服务 | 1C-01 | 4h | `automaton/src/upwork/scorer.ts` (新增) |
| 1C-04 | 投标生成服务 | 1C-01 | 4h | `automaton/src/upwork/bid-generator.ts` (新增) |
| 1C-05 | 人工介入服务 | 1A-03 | 3h | `automaton/src/freelance/intervention.ts` (新增) |
| 1C-06 | 人工介入超时处理 | 1C-05 | 3h | `automaton/src/freelance/intervention-timeout.ts` (新增) |
| 1C-07 | 项目发现调度器 | 1C-03 | 3h | `automaton/src/upwork/discovery-scheduler.ts` (新增) |
| 1C-08 | 成本追踪服务 | 1A-03 | 3h | `automaton/src/freelance/cost-tracker.ts` (新增) |

### 3.4 Phase 1D: Nanobot业务层 (Week 4)

**目标**: 实现任务执行和进度报告

| 任务ID | 任务名称 | 依赖 | 工时 | 文件 |
|--------|----------|------|------|------|
| 1D-01 | ANP消息处理器 | 1B-06 | 3h | `nanobot/nanobot/anp/handlers.py` (修改) |
| 1D-02 | Genesis Prompt处理器 | 1D-01 | 3h | `nanobot/nanobot/anp/genesis_handler.py` (新增) |
| 1D-03 | 需求分析技能 | 1D-02 | 4h | `nanobot/nanobot/skills/requirement.py` (新增) |
| 1D-04 | 代码生成技能 | 1D-02 | 4h | `nanobot/nanobot/skills/codegen.py` (新增) |
| 1D-05 | 测试执行技能 | 1D-04 | 3h | `nanobot/nanobot/skills/testing.py` (新增) |
| 1D-06 | 进度报告服务 | 1D-01 | 2h | `nanobot/nanobot/interagent/progress_reporter.py` (修改) |
| 1D-07 | 错误报告服务 | 1D-01 | 2h | `nanobot/nanobot/interagent/error_reporter.py` (新增) |

### 3.5 Phase 1E: 集成与测试 (Week 5)

**目标**: 端到端集成和测试

| 任务ID | 任务名称 | 依赖 | 工时 | 文件 |
|--------|----------|------|------|------|
| 1E-01 | 端到端流程集成 | 1C-07, 1D-06 | 4h | 多文件集成 |
| 1E-02 | 集成测试套件 | 1E-01 | 4h | `automaton/__tests__/integration/e2e.test.ts` |
| 1E-03 | 负载测试脚本 | 1E-01 | 3h | `tests/load/k6-scenario.js` |
| 1E-04 | 错误场景测试 | 1E-02 | 3h | `automaton/__tests__/integration/error-scenarios.test.ts` |
| 1E-05 | 安全测试 | 1E-02 | 2h | `tests/security/injection.test.ts` |

### 3.6 Phase 1F: 部署与验证 (Week 6)

**目标**: 生产部署和验证

| 任务ID | 任务名称 | 依赖 | 工时 | 文件 |
|--------|----------|------|------|------|
| 1F-01 | 监控配置 | 1E-03 | 2h | `config/prometheus/alerts.yml` |
| 1F-02 | 告警配置 | 1F-01 | 2h | `config/prometheus/rules.yml` |
| 1F-03 | 生产部署 | 1F-02 | 2h | `docker-compose.prod.yml` |
| 1F-04 | 冒烟测试 | 1F-03 | 2h | `tests/smoke/smoke.test.ts` |
| 1F-05 | 文档更新 | 1F-04 | 3h | `docs/deployment-guide.md` |

---

## 4. Phase 1A详细任务 (基础设施 Week 1)

### 任务 1A-01: 数据库Schema迁移

**文件**: `automaton/src/state/schema-v11.ts`

**函数签名**:
```typescript
export const SCHEMA_V11_MIGRATION: string;
export function applySchemaV11(db: Database.Database): void;
```

**创建的表**:
- `projects` - 项目详情
- `clients` - 客户信息
- `analytics_events` - 埋点事件
- `disputes` - 纠纷记录
- `project_milestones` - 项目里程碑
- `bid_history` - 投标历史
- `resource_allocations` - 资源分配
- `manual_interventions` - 人工介入记录
- `knowledge_entries` - 知识库条目
- `communication_templates` - 沟通模板

**DDL参考**: 见详细设计文档 2.2.1节

**测试要求**:
- 验证所有表创建成功
- 验证schema_version更新为11
- 验证所有索引创建成功

---

### 任务 1A-02: 类型定义生成

**文件**: `automaton/src/freelance/types.ts`

**导出类型**:
```typescript
// 项目状态
export type ProjectStatus =
  | "discovered" | "scored" | "filtered" | "bidding"
  | "deferred" | "rejected" | "negotiating" | "contracted"
  | "pending_start" | "active" | "paused" | "completed"
  | "disputed" | "resolved" | "escalated" | "cancelled" | "closed";

// 埋点事件类型
export type AnalyticsEventType =
  | "project_viewed" | "project_scored" | "bid_created"
  | "bid_submitted" | "contract_signed" | "project_started"
  | "llm_call" | "error_occurred" | "manual_intervention";

// 实体接口
export interface Project { /* ... */ }
export interface Client { /* ... */ }
export interface BidHistory { /* ... */ }
export interface ManualIntervention { /* ... */ }
export interface AnalyticsEvent { /* ... */ }
export interface ResourceAllocation { /* ... */ }
export interface Milestone { /* ... */ }
```

**测试要求**:
- 验证所有类型定义正确
- 验证枚举值完整性
- 验证接口属性类型

---

### 任务 1A-03: 数据访问层实现

**文件**: `automaton/src/freelance/repository.ts`

**类签名**:
```typescript
export class FreelanceRepository {
  constructor(db: Database.Database)

  // Project Operations
  createProject(params: CreateProjectParams): Project
  getProject(id: string): Project | undefined
  getProjectByPlatformId(platform: string, id: string): Project | undefined
  updateProjectStatus(id: string, status: ProjectStatus): void
  updateProjectScore(id: string, score: number, factors: ScoreFactors): void
  getProjectsToScore(limit?: number): Project[]

  // Client Operations
  getOrCreateClient(params: GetOrCreateClientParams): Client
  getClient(id: string): Client | undefined
  getClientByPlatformId(platform: string, id: string): Client | undefined

  // Bid Operations
  createBid(params: CreateBidParams): BidHistory
  updateBidStatus(id: string, status: BidStatus, submittedAt?: string): void
  getProjectBids(projectId: string): BidHistory[]

  // Intervention Operations
  createIntervention(params: CreateInterventionParams): ManualIntervention
  getPendingInterventions(): ManualIntervention[]
  updateInterventionResponse(id: string, decision: 'approve'|'reject', responder: string, notes?: string): void

  // Analytics
  recordEvent(params: RecordEventParams): AnalyticsEvent
  recordEvents(events: RecordEventParams[]): void

  // Resources
  allocateResource(params: AllocateResourceParams): ResourceAllocation
  getActiveAllocations(): ResourceAllocation[]

  // Milestones
  createMilestone(params: CreateMilestoneParams): Milestone
  updateMilestoneStatus(id: string, status: MilestoneStatus): void

  // Templates
  getTemplate(type: TemplateType, language?: string, tier?: string): CommunicationTemplate | undefined
}
```

**测试要求**:
- 每个CRUD操作有独立测试用例
- 测试事务回滚
- 测试并发安全性

---

### 任务 1A-04: 埋点事件采集

**文件**: `automaton/src/freelance/analytics.ts`

**类签名**:
```typescript
export class AnalyticsCollector {
  constructor(repository: FreelanceRepository)

  track(params: TrackParams): void
  flush(): void
  stop(): void

  // 便捷方法
  trackProjectViewed(params: { project_id: string; client_id?: string }): void
  trackProjectScored(params: { project_id: string; score: number; score_range: string }): void
  trackBidCreated(params: { project_id: string; template_id?: string }): void
  trackBidSubmitted(params: { project_id: string; bid_id: string; bid_amount_cents: number }): void
  trackLLMCall(params: { model: string; tokens_used: number; cost_cents: number; duration_ms: number }): void
  trackError(params: { error_code: string; error_message: string; severity: string }): void
  trackManualIntervention(params: { intervention_type: string; project_id?: string; reason: string }): void
}
```

**配置**:
```typescript
{
  batchSize: 100,
  maxWaitMs: 5000,
}
```

**测试要求**:
- 测试批处理逻辑
- 测试自动刷新
- 测试便捷方法正确性

---

## 5. Phase 1B详细任务 (通信层 Week 2)

### 任务 1B-01: ANP消息类型定义

**文件**: `automaton/src/anp/freelance-message-types.ts` 和 `nanobot/nanobot/anp/types.py`

**TypeScript定义**:
```typescript
export interface GenesisPromptPayload {
  "@type": "genesis:GenesisPrompt";
  "genesis:projectId": string;
  "genesis:platform": string;
  "genesis:requirementSummary": string;
  "genesis:technicalConstraints": TechnicalConstraints;
  "genesis:contractTerms": ContractTerms;
  "genesis:resourceLimits": ResourceLimits;
  "genesis:specialInstructions"?: SpecialInstructions;
}

export interface ProgressReportPayload {
  "@type": "anp:ProgressReport";
  "anp:taskId": string;
  "anp:progress": number;
  "anp:currentPhase": string;
  "anp:completedSteps": string[];
  "anp:nextSteps": string[];
  "anp:etaSeconds"?: number;
  "anp:blockers": string[];
}

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
```

**Python定义**:
```python
# nanobot/nanobot/anp/types.py
from pydantic import BaseModel
from typing import List, Optional, Dict, Any

class GenesisPromptPayload(BaseModel):
    @type: str = "genesis:GenesisPrompt"
    genesis_projectId: str
    genesis_platform: str
    genesis_requirementSummary: str
    genesis_technicalConstraints: Dict[str, Any]
    genesis_contractTerms: Dict[str, Any]
    genesis_resourceLimits: Dict[str, Any]
    genesis_specialInstructions: Optional[Dict[str, Any]] = None

class ProgressReportPayload(BaseModel):
    @type: str = "anp:ProgressReport"
    anp_taskId: str
    anp_progress: int  # 0-100
    anp_currentPhase: str
    anp_completedSteps: List[str]
    anp_nextSteps: List[str]
    anp_etaSeconds: Optional[int] = None
    anp_blockers: List[str] = []

class ErrorReportPayload(BaseModel):
    @type: str = "anp:ErrorReport"
    anp_taskId: str
    anp_severity: str  # warning, error, critical
    anp_errorCode: str
    anp_message: str
    anp_context: Dict[str, Any]
    anp_recoverable: bool
    anp_suggestedAction: Optional[str] = None
```

---

### 任务 1B-02: Genesis Prompt发送器

**文件**: `automaton/src/freelance/genesis-sender.ts`

**类签名**:
```typescript
export class GenesisPromptSender {
  constructor(ws: InteragentWebSocketServer, repository: FreelanceRepository)

  async sendGenesisPrompt(params: {
    project: Project;
    goal: Goal;
    requirements: string;
    techStack: string[];
    prohibitedStack?: string[];
    maxCostCents: number;
    maxDurationMs: number;
  }): Promise<string>  // 返回 genesisPromptId
}
```

**验收标准**:
- 成功构建Genesis Prompt消息
- 通过WebSocket发送给Nanobot
- 记录analytics事件
- 返回有效的消息ID

---

### 任务 1B-03: Progress Report处理器

**文件**: `automaton/src/freelance/progress-handler.ts`

**类签名**:
```typescript
export class ProgressReportHandler {
  constructor(repository: FreelanceRepository)

  async handleProgressReport(report: ProgressReportPayload): Promise<void>

  private updateGoalProgress(goalId: string, progress: number): void
  private recordProgressEvent(report: ProgressReportPayload): void
}
```

**验收标准**:
- 解析ProgressReport消息
- 更新goal进度
- 记录analytics事件
- 处理blockers（创建人工介入如需要）

---

### 任务 1B-04: Error Report处理器

**文件**: `automaton/src/freelance/error-handler.ts`

**类签名**:
```typescript
export class ErrorReportHandler {
  constructor(repository: FreelanceRepository)

  async handleErrorReport(report: ErrorReportPayload): Promise<void>

  private shouldCreateIntervention(report: ErrorReportPayload): boolean
  private classifyErrorSeverity(severity: string): InterventionPriority
}
```

**验收标准**:
- 解析ErrorReport消息
- 根据严重程度决定是否需要人工介入
- 记录错误到analytics
- 返回确认给Nanobot

---

### 任务 1B-05/1B-06: WebSocket增强

**修改文件**:
- `automaton/src/interagent/websocket.ts`
- `nanobot/nanobot/interagent/websocket.py`

**增强功能**:
1. **消息持久化缓冲区**
2. **重连状态同步协议**
3. **消息序列号**
4. **心跳机制增强**

**关键接口**:
```typescript
// WebSocket服务器
interface WebSocketServerConfig {
  messageBufferSize: number;       // 消息缓冲区大小
  messageTTLHours: number;         // 消息过期时间
  enableReconnectionSync: boolean; // 启用重连同步
}

interface MessageBufferEntry {
  id: string;
  connectionId: string;
  sequence: number;
  type: string;
  payload: unknown;
  expiresAt: string;
}

// 新增方法
async getMissedEvents(connectionId: string, lastSequence: number): Promise<MessageBufferEntry[]>
```

---

### 任务 1B-07: 重连状态同步协议

**文件**: `automaton/src/interagent/reconnection.ts`

**类签名**:
```typescript
export class ReconnectionHandler {
  constructor(ws: WebSocketServer, repository: FreelanceRepository)

  async handleReconnectRequest(request: ReconnectRequest): Promise<StateSyncResponse>
  async handleSyncCompleteAck(ack: SyncCompleteAck): Promise<void>

  private getMissedEvents(connectionId: string, lastSeq: number): Promise<MissedEvent[]>
  private cleanupExpiredMessages(): void
}

// 消息类型
interface ReconnectRequest {
  "@type": "anp:ReconnectRequest";
  "anp:connectionId": string;
  "anp:lastSequenceNumber": number;
  "anp:reconnectReason": "network_error" | "timeout" | "server_close";
}

interface StateSyncResponse {
  "@type": "anp:StateSyncResponse";
  "anp:connectionId": string;
  "anp:syncRequired": boolean;
  "anp:missedEvents": MissedEvent[];
  "anp:currentState": CurrentState;
}

interface SyncCompleteAck {
  "@type": "anp:SyncCompleteAck";
  "anp:connectionId": string;
  "anp:lastSyncedSequence": number;
  "anp:syncDuration": number;
}
```

**测试要求**:
- 测试重连请求处理
- 测试状态同步响应
- 测试消息恢复
- 测试过期消息清理

---

### 任务 1B-08: 消息持久化

**文件**: `automaton/src/interagent/message-buffer.ts`

**类签名**:
```typescript
export class MessageBuffer {
  constructor(db: Database.Database)

  persist(message: ANPMessage): void
  getMissedEvents(connectionId: string, lastSequence: number, limit?: number): MissedEvent[]
  cleanup(): void  // 清理过期消息
}

// 持久化配置
interface MessagePersistenceConfig {
  persist: boolean;
  ttl: number;  // 小时
}

const MESSAGE_PERSISTENCE_CONFIG: Record<string, MessagePersistenceConfig> = {
  "GenesisPrompt": { persist: true, ttl: 24 },
  "ProgressReport": { persist: true, ttl: 1 },
  "ErrorReport": { persist: true, ttl: 24 },
  "HeartbeatEvent": { persist: false, ttl: 0 },
};
```

---

## 6. Phase 1C详细任务 (Automaton业务层 Week 3)

### 任务 1C-01: Upwork API客户端

**文件**: `automaton/src/upwork/client.ts`

**类签名**:
```typescript
export class UpworkAPIClient {
  constructor(config: {
    accessToken: string;
    refreshToken: string;
    apiUrl: string;
  })

  // 项目相关
  async searchJobs(params: SearchJobsParams): Promise<UpworkAPIResponse<JobsResult>>
  async getJobDetails(jobId: string): Promise<UpworkAPIResponse<JobDetails>>

  // 投标相关
  async submitProposal(params: ProposalParams): Promise<UpworkAPIResponse<ProposalResult>>
  async getProposals(filters?: ProposalFilters): Promise<UpworkAPIResponse<Proposal[]>>

  // 消息相关
  async sendMessage(params: MessageParams): Promise<UpworkAPIResponse<MessageResult>>

  // 客户相关
  async getClientInfo(clientId: string): Promise<UpworkAPIResponse<ClientInfo>>

  // Token管理
  async refreshAccessToken(): Promise<void>
}

// 类型定义
interface SearchJobsParams {
  query?: string;
  category?: string;
  subcategory?: string;
  jobType?: "fixed" | "hourly";
  duration?: string;
  workload?: string;
  status?: "open" | "closed";
  sort?: "recency" | "relevance";
  limit?: number;
  offset?: number;
}

interface UpworkAPIResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  rateLimit?: {
    remaining: number;
    resetAt: string;
  };
  requestDuration: number;
}
```

**验收标准**:
- 成功调用Upwork API
- 正确处理限流
- 自动刷新token
- 记录调用metrics

---

### 任务 1C-02: 限流器实现

**文件**: `automaton/src/upwork/rate-limiter.ts`

**类签名**:
```typescript
export class TokenBucketRateLimiter {
  constructor(bucketSize: number, refillRate: number)

  tryConsume(tokens?: number): { allowed: boolean; waitMs: number }

  private refill(): void
}

// 预配置限流器
export const searchLimiter = new TokenBucketRateLimiter(40, 40 / 60000);   // 40次/分钟
export const bidLimiter = new TokenBucketRateLimiter(20, 20 / 3600000);     // 20次/小时
export const messageLimiter = new TokenBucketRateLimiter(100, 100 / 3600000); // 100次/小时
```

**测试要求**:
- 测试令牌补充逻辑
- 测试消费限制
- 测试等待时间计算

---

### 任务 1C-03: 项目评分服务

**文件**: `automaton/src/upwork/scorer.ts`

**类签名**:
```typescript
export class ProjectScorer {
  constructor(upworkClient: UpworkAPIClient, llmClient: LLMClient)

  async calculateProjectScore(project: ProjectInput): Promise<ProjectScoreResult>
  async calculateICPScore(client: ClientInput): Promise<ICPScoreResult>

  private assessTechnicalMatch(project: ProjectInput): Promise<number>
  private assessBudgetReasonableness(project: ProjectInput): Promise<number>
  private assessDeliveryFeasibility(project: ProjectInput): Promise<number>
}

interface ProjectScoreResult {
  score: number;  // 0-100
  factors: {
    technicalMatch: number;
    budgetReasonable: number;
    deliveryFeasible: number;
    clientQuality: number;
    strategicValue: number;
  };
  reason: string;
  recommendation: "auto_bid" | "manual_review" | "filter";
}

interface ICPFactors {
  companySize: number;
  rating: number;
  totalSpent: number;
  paymentVerified: boolean;
  responseTime: number;
  hasRepeatProjects: boolean;
}

interface ICPScoreResult {
  score: number;  // 0-100
  tier: "gold" | "silver" | "bronze" | "new";
  factors: Record<string, number>;
}
```

**评分逻辑**:
| 分数范围 | 动作 |
|----------|------|
| >= 80 | 自动投标 |
| 60-79 | 人工复核 |
| < 60 | 自动过滤 |

**验收标准**:
- 评分算法符合设计文档
- LLM调用成功
- 评分因子可解释

---

### 任务 1C-04: 投标生成服务

**文件**: `automaton/src/upwork/bid-generator.ts`

**类签名**:
```typescript
export class BidGenerator {
  constructor(
    repository: FreelanceRepository,
    llmClient: LLMClient
  )

  async generateBid(params: {
    project: Project;
    client: Client;
    template?: string;
    language: "en" | "zh";
  }): Promise<BidResult>

  async getCustomBidAmount(project: Project, client: Client): Promise<number>
  private selectTemplate(clientTier: ClientTier, language: string): string
}

interface BidResult {
  coverLetter: string;
  bidAmountCents: number;
  durationDays: number;
  milestoneDescription?: string;
  suggestedQuestions: string[];
}
```

**验收标准**:
- 生成符合规范的求职信
- 根据客户等级定制内容
- 建议合理的报价和工期
- 包含澄清问题

---

### 任务 1C-05: 人工介入服务

**文件**: `automaton/src/freelance/intervention.ts`

**类签名**:
```typescript
export class ManualInterventionService {
  constructor(
    repository: FreelanceRepository,
    notificationService: NotificationService
  )

  async createRequest(params: {
    type: InterventionType;
    project_id?: string;
    goal_id?: string;
    reason: string;
    context?: Record<string, unknown>;
    sla_hours?: number;
  }): Promise<string>  // 返回介入ID

  async awaitResponse(requestId: string): Promise<InterventionResponse>
  async checkTimeouts(): Promise<void>  // 定时检查超时

  private sendNotification(intervention: ManualIntervention): void
}

interface InterventionResponse {
  decision: "approve" | "reject" | "timeout";
  responder?: string;
  notes?: string;
  respondedAt: string;
}
```

**介入类型SLA**:
| 类型 | SLA | 超时操作 |
|------|-----|----------|
| contract_sign | 24h | 取消项目 |
| project_start | 24h | 取消项目 |
| large_spend | 4h | 拒绝支出 |
| refund | 48h | 执行退款 |
| dispute_l2 | 48h | 升级L3 |

---

### 任务 1C-06: 人工介入超时处理

**文件**: `automaton/src/freelance/intervention-timeout.ts`

**类签名**:
```typescript
export const INTERVENTION_TIMEOUT_CONFIGS: Record<InterventionType, TimeoutConfig>;

export interface TimeoutConfig {
  slaHours: number;
  defaultAction: 'cancel' | 'approve' | 'reject' | 'escalate' | 'refund';
  notifyClient: boolean;
  icpImpact: 'none' | 'minor' | 'moderate' | 'severe';
  clientMessage?: string;
}

export class InterventionTimeoutHandler {
  constructor(repository: FreelanceRepository)

  async checkAndHandleTimeouts(): Promise<void>
  async executeTimeoutAction(intervention: ManualIntervention): Promise<void>

  private updateInterventionStatus(interventionId: string, decision: string): void
  private sendClientNotification(clientId: string, message: string): void
}
```

**验收标准**:
- 正确识别超时介入
- 执行预定义的默认操作
- 发送客户通知（如需要）
- 记录ICP影响

---

### 任务 1C-07: 项目发现调度器

**文件**: `automaton/src/upwork/discovery-scheduler.ts`

**类签名**:
```typescript
export class DiscoveryScheduler {
  constructor(
    upworkClient: UpworkAPIClient,
    scorer: ProjectScorer,
    bidGenerator: BidGenerator,
    repository: FreelanceRepository,
    analytics: AnalyticsCollector
  )

  async runDiscoveryCycle(): Promise<DiscoveryResult>
  async startScheduledDiscovery(intervalMs: number): Promise<void>
  stop(): void

  private async processNewProject(job: JobFromAPI): Promise<void>
  private async shouldAutoBid(score: number): Promise<boolean>
}

interface DiscoveryResult {
  projectsDiscovered: number;
  projectsScored: number;
  bidsSubmitted: number;
  filtered: number;
  deferred: number;
  durationMs: number;
}
```

**调度逻辑**:
```
每小时触发一次:
1. 调用Upwork API搜索新项目
2. 对每个新项目:
   a. 获取客户信息
   b. 计算ICP评分
   c. 计算项目评分
   d. 根据评分决定动作
3. 高分(>=80): 自动生成并提交投标
4. 中分(60-79): 创建人工介入请求
5. 低分(<60): 标记为filtered
```

---

### 任务 1C-08: 成本追踪服务

**文件**: `automaton/src/freelance/cost-tracker.ts`

**类签名**:
```typescript
export class CostTracker {
  constructor(repository: FreelanceRepository)

  async trackLLMCost(params: {
    project_id?: string;
    model: string;
    tokens: number;
    cost_cents: number;
  }): Promise<void>

  async getProjectCost(projectId: string): Promise<ProjectCost>
  async checkBudgetAlert(projectId: string): Promise<Alert[]>

  private async updateGoalCost(goalId: string, costCents: number): Promise<void>
}

interface ProjectCost {
  project_id: string;
  budget_cents: number;
  actual_cents: number;
  remaining_cents: number;
  percentage: number;
  alerts: Alert[];
}

interface Alert {
  level: "warning" | "critical";
  threshold: number;
  current: number;
  message: string;
}
```

**告警阈值**:
- Warning: 50% 预算使用
- Critical: 80% 预算使用
- Exceeded: 超过预算

---

## 7. Phase 1D详细任务 (Nanobot业务层 Week 4)

### 任务 1D-01: ANP消息处理器

**文件**: `nanobot/nanobot/anp/handlers.py`

**类签名**:
```python
class ANPMessageHandler:
    def __init__(self, ws_client: WebSocketClient, event_bus: EventBus):
        self.ws = ws_client
        self.event_bus = event_bus

    async def handle_message(self, message: ANPMessage) -> None:
        """路由消息到对应处理器"""
        handler = self._get_handler(message.type)
        await handler(message)

    def _get_handler(self, message_type: str) -> Callable:
        handlers = {
            "GenesisPrompt": self.handle_genesis_prompt,
            "TaskUpdate": self.handle_task_update,
            "StatusRequest": self.handle_status_request,
        }
        return handlers.get(message_type, self.handle_unknown)
```

---

### 任务 1D-02: Genesis Prompt处理器

**文件**: `nanobot/nanobot/anp/genesis_handler.py`

**类签名**:
```python
class GenesisPromptHandler:
    def __init__(
        self,
        agent_loop: "AgentLoop",
        requirement_analyzer: RequirementAnalyzer,
        analytics: AnalyticsCollector
    ):
        self.agent_loop = agent_loop
        self.requirement_analyzer = requirement_analyzer
        self.analytics = analytics

    async def handle(self, message: ANPMessage) -> None:
        """处理Genesis Prompt消息"""
        payload = GenesisPromptPayload(**message.object)

        # 验证消息
        if not self._validate_payload(payload):
            await self._send_rejection(message.id, "Invalid payload")
            return

        # 创建新任务上下文
        task_context = self._create_task_context(payload)

        # 启动任务
        await self.agent_loop.start_task(task_context)

        # 发送接受确认
        await self._send_acceptance(message.id, task_context.id)

    def _validate_payload(self, payload: GenesisPromptPayload) -> bool:
        """验证Genesis Prompt"""
        # 检查必需字段
        # 验证资源限制
        # 验证预算格式
        return True

    def _create_task_context(self, payload: GenesisPromptPayload) -> TaskContext:
        """创建任务上下文"""
        return TaskContext(
            id=ulid(),
            project_id=payload.genesis_projectId,
            requirements=payload.genesis_requirementSummary,
            tech_stack=payload.genesis_technicalConstraints["genesis_requiredStack"],
            budget_cents=payload.genesis_contractTerms["genesis_totalBudget"]["schema:value"],
            deadline=payload.genesis_contractTerms["genesis_deadline"],
            max_tokens=payload.genesis_resourceLimits["genesis_maxTokensPerTask"],
            max_cost_cents=payload.genesis_resourceLimits["genesis_maxCostCents"],
        )
```

---

### 任务 1D-03: 需求分析技能

**文件**: `nanobot/nanobot/skills/requirement.py`

**类签名**:
```python
class RequirementAnalyzer:
    def __init__(self, llm_client: LiteLLM):
        self.llm = llm_client

    async def analyze(self, project_description: str) -> RequirementAnalysis:
        """分析项目需求"""
        prompt = self._build_analysis_prompt(project_description)
        response = await self.llm.complete(prompt)

        return RequirementAnalysis(**self._parse_response(response))

    async def clarify(self, questions: List[str]) -> Dict[str, Any]:
        """通过多轮对话澄清需求"""
        # 与客户多轮交互
        pass

    def _build_analysis_prompt(self, description: str) -> str:
        return f"""Analyze the following project requirements:

{description}

Provide:
1. Scope assessment
2. Required features
3. Technical constraints
4. Assumptions
5. Questions for client
6. Success criteria
7. Potential edge cases

Format as JSON."""

class RequirementAnalysis(BaseModel):
    scope: str
    features: List[str]
    constraints: Dict[str, Any]
    assumptions: List[str]
    questions: List[str]
    success_criteria: List[str]
    edge_cases: List[str]
```

---

### 任务 1D-04: 代码生成技能

**文件**: `nanobot/nanobot/skills/codegen.py`

**类签名**:
```python
class CodeGenerator:
    def __init__(self, llm_client: LiteLLM):
        self.llm = llm_client

    async def generate_component(self, spec: ComponentSpec) -> str:
        """生成组件代码"""
        prompt = self._build_generation_prompt(spec)
        response = await self.llm.complete(prompt)
        return self._extract_code(response)

    async def generate_tests(self, code: str, coverage_target: float = 0.9) -> str:
        """生成测试代码"""
        prompt = self._build_test_prompt(code, coverage_target)
        return await self.llm.complete(prompt)

    async def fix_error(self, code: str, error: str) -> str:
        """修复代码错误"""
        prompt = f"""Fix the following error in this code:

Error:
{error}

Code:
{code}

Provide corrected code only."""
        return await self.llm.complete(prompt)

class ComponentSpec(BaseModel):
    name: str
    type: str  # "component", "function", "class"
    language: str
    framework: str
    description: str
    props: Dict[str, Any]
    dependencies: List[str]
```

---

### 任务 1D-05: 测试执行技能

**文件**: `nanobot/nanobot/skills/testing.py`

**类签名**:
```python
class TestRunner:
    async def run_unit_tests(self, path: str) -> TestResult:
        """运行单元测试"""
        # 使用pytest运行
        pass

    async def run_integration_tests(self, path: str) -> TestResult:
        """运行集成测试"""
        pass

    async def run_e2e_tests(self, path: str) -> TestResult:
        """运行E2E测试"""
        pass

    async def get_coverage(self, path: str) -> float:
        """获取测试覆盖率"""
        pass

class TestResult(BaseModel):
    passed: int
    failed: int
    skipped: int
    duration_ms: int
    coverage: float
    errors: List[str]
```

---

### 任务 1D-06: 进度报告服务

**文件**: `nanobot/nanobot/interagent/progress_reporter.py`

**类签名**:
```python
class ProgressReporter:
    def __init__(self, ws_client: WebSocketClient):
        self.ws = ws_client

    async def report_progress(self, task_id: str, progress: ProgressReport) -> None:
        """发送进度报告给Automaton"""
        message = ANPMessage(
            @context=["https://w3id.org/anp/v1"],
            @type="ANPMessage",
            id=ulid(),
            timestamp=datetime.now().isoformat(),
            actor=self.ws.get_local_did(),
            target=self.ws.get_automaton_did(),
            type="ProgressReport",
            object={
                "@type": "anp:ProgressReport",
                "anp:taskId": task_id,
                "anp:progress": progress.progress,
                "anp:currentPhase": progress.current_phase,
                "anp:completedSteps": progress.completed_steps,
                "anp:nextSteps": progress.next_steps,
                "anp:etaSeconds": progress.eta_seconds,
                "anp:blockers": progress.blockers,
            },
        )
        await self.ws.send_message(message)

class ProgressReport(BaseModel):
    task_id: str
    progress: int  # 0-100
    current_phase: str
    completed_steps: List[str]
    next_steps: List[str]
    eta_seconds: Optional[int] = None
    blockers: List[str] = []
```

---

### 任务 1D-07: 错误报告服务

**文件**: `nanobot/nanobot/interagent/error_reporter.py`

**类签名**:
```python
class ErrorReporter:
    def __init__(self, ws_client: WebSocketClient):
        self.ws = ws_client

    async def report_error(self, task_id: str, error: ErrorReport) -> None:
        """发送错误报告给Automaton"""
        message = ANPMessage(
            @context=["https://w3id.org/anp/v1"],
            @type="ANPMessage",
            id=ulid(),
            timestamp=datetime.now().isoformat(),
            actor=self.ws.get_local_did(),
            target=self.ws.get_automaton_did(),
            type="ErrorReport",
            object={
                "@type": "anp:ErrorReport",
                "anp:taskId": task_id,
                "anp:severity": error.severity,
                "anp:errorCode": error.error_code,
                "anp:message": error.message,
                "anp:context": error.context,
                "anp:recoverable": error.recoverable,
                "anp:suggestedAction": error.suggested_action,
            },
        )
        await self.ws.send_message(message)

class ErrorReport(BaseModel):
    task_id: str
    severity: str  # warning, error, critical
    error_code: str
    message: str
    context: Dict[str, Any]
    recoverable: bool
    suggested_action: Optional[str] = None
```

---

## 8. Phase 1E详细任务 (集成与测试 Week 5)

### 任务 1E-01: 端到端流程集成

**目标**: 将所有组件集成到主流程中

**集成点**:
1. **Automaton主循环**: 在HeartbeatDaemon中调度项目发现
2. **WebSocket消息路由**: 连接Automaton和Nanobot
3. **进度报告回调**: 处理Nanobot的进度更新
4. **错误处理回调**: 处理Nanobot的错误报告

**文件修改**:
- `automaton/src/heartbeat/daemon.ts` - 添加discovery调度
- `automaton/src/interagent/websocket.ts` - 添加freelance消息路由
- `nanobot/nanobot/agent/loop.py` - 添加进度报告逻辑

---

### 任务 1E-02: 集成测试套件

**文件**: `automaton/__tests__/integration/e2e.test.ts`

**测试场景**:
```typescript
describe('End-to-End Freelance Flow', () => {
  it('should complete project discovery and bid submission', async () => {
    // 1. 模拟Upwork API返回新项目
    // 2. 验证项目评分
    // 3. 验证投标生成
    // 4. 验证投标提交
    // 5. 验证analytics事件记录
  });

  it('should handle Genesis Prompt and task execution', async () => {
    // 1. 创建项目记录
    // 2. 发送Genesis Prompt
    // 3. 验证Nanobot接收
    // 4. 验证进度报告
    // 5. 验证任务完成
  });

  it('should trigger manual intervention for budget exceed', async () => {
    // 1. 创建接近预算的项目
    // 2. 触发成本超限
    // 3. 验证介入请求创建
    // 4. 验证通知发送
  });

  it('should handle WebSocket reconnection', async () => {
    // 1. 建立WebSocket连接
    // 2. 发送消息并记录序列号
    // 3. 断开连接
    // 4. 重连并请求状态同步
    // 5. 验证错过消息恢复
  });
});
```

---

### 任务 1E-03: 负载测试脚本

**文件**: `tests/load/k6-scenario.js`

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    constant_load: {
      executor: 'constant-vus',
      vus: 10,
      duration: '5m',
    },
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },
        { duration: '2m', target: 50 },
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // 测试项目评分API
  const scoreRes = http.post('http://localhost:8080/api/v1/projects/score', {
    title: 'Test Project',
    description: 'React component development',
  });

  check(scoreRes, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}
```

---

## 9. Phase 1F详细任务 (部署与验证 Week 6)

### 任务 1F-01: 监控配置

**文件**: `config/prometheus/alerts.yml`

```yaml
groups:
  - name: freelance_alerts
    interval: 30s
    rules:
      # 成本告警
      - alert: ProjectCostWarning
        expr: (project_cost_cents / project_budget_cents) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Project cost exceeds 50% of budget"

      - alert: ProjectCostCritical
        expr: (project_cost_cents / project_budget_cents) > 0.8
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Project cost exceeds 80% of budget"

      # 业务告警
      - alert: NoProjectsDiscovered
        expr: rate(projects_discovered[1h]) == 0
        for: 2h
        labels:
          severity: warning
        annotations:
          summary: "No new projects discovered in 2 hours"

      - alert: LowBidAcceptanceRate
        expr: rate(bids_accepted[24h]) / rate(bids_submitted[24h]) < 0.1
        for: 6h
        labels:
          severity: warning
        annotations:
          summary: "Bid acceptance rate below 10%"
```

---

### 任务 1F-02: 告警配置

**文件**: `config/prometheus/rules.yml`

```yaml
# 告警接收器配置
receivers:
  - name: 'telegram'
    telegram_configs:
      - bot_token: '${TELEGRAM_BOT_TOKEN}'
        chat_id: '${TELEGRAM_CHAT_ID}'
        parse_mode: 'HTML'

  - name: 'email'
    email_configs:
      - to: 'admin@example.com'
        from: 'alerts@example.com'
        smarthost: 'smtp.example.com:587'

# 路由配置
route:
  receiver: 'telegram'
  group_by: ['alertname', 'severity']
  group_wait: 10s
  group_interval: 5m
  repeat_interval: 12h
  routes:
    - match:
        severity: critical
      receiver: 'telegram'
      continue: true

    - match:
        severity: critical
      receiver: 'email'
```

---

### 任务 1F-03: 生产部署

**文件**: `docker-compose.prod.yml`

```yaml
services:
  automaton-nanobot:
    image: autojiedan:${VERSION:-latest}
    container_name: automaton-nanobot-prod
    restart: always

    env_file:
      - .env.production

    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info

    volumes:
      - automaton-data:/data
      - ./logs:/app/logs

    ports:
      - "3000:3000"
      - "8080:8080"

    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '0.5'
          memory: 1G

  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    restart: always
    ports:
      - "9090:9090"
    volumes:
      - ./config/prometheus:/etc/prometheus
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'

  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    restart: always
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
    volumes:
      - grafana-data:/var/lib/grafana

volumes:
  automaton-data:
  prometheus-data:
  grafana-data:
```

---

### 任务 1F-04: 冒烟测试

**文件**: `tests/smoke/smoke.test.ts`

```typescript
import { describe, it, expect } from 'vitest';

describe('Smoke Tests', () => {
  it('should respond to health check', async () => {
    const res = await fetch('http://localhost:8080/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('healthy');
  });

  it('should have database connection', async () => {
    const res = await fetch('http://localhost:8080/api/v1/health/db');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.connected).toBe(true);
  });

  it('should have WebSocket connection', async () => {
    const ws = new WebSocket('ws://localhost:3000/anp');
    await new Promise((resolve) => {
      ws.onopen = resolve;
    });
    ws.close();
    expect(true).toBe(true);
  });

  it('should access Upwork API', async () => {
    // 检查Upwork API token有效性
    const res = await fetch('http://localhost:8080/api/v1/upwork/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.authenticated).toBe(true);
  });
});
```

---

## 10. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| **Upwork API变更** | 中 | 高 | 版化API客户端、订阅变更通知 |
| **LLM API不稳定** | 中 | 高 | 多提供商备份、降级策略 |
| **SQLite并发限制** | 低 | 中 | WAL模式、连接池 |
| **WebSocket断连** | 中 | 中 | 心跳机制、自动重连 |
| **成本超支** | 中 | 高 | 严格预算监控、告警 |

---

## 11. 验收标准

### 11.1 功能验收

| 功能 | 验收标准 |
|------|----------|
| 项目发现 | 每小时成功发现新项目，评分准确率 > 80% |
| 投标提交 | 投标生成时间 < 30秒，成功率 > 95% |
| 任务执行 | Genesis Prompt正确发送，进度报告实时更新 |
| 人工介入 | 介入请求 < 5分钟通知，SLA跟踪准确 |
| 成本监控 | 成本追踪准确，告警触发正确 |

### 11.2 性能验收

| 指标 | 目标值 |
|------|--------|
| API响应时间 (P99) | < 500ms |
| WebSocket消息延迟 | < 100ms |
| 代码生成速度 | < 30s/模块 |
| 系统可用性 | > 99% |

### 11.3 质量验收

| 指标 | 目标值 |
|------|--------|
| 测试覆盖率 | > 80% |
| 关键路径测试 | 100% |
| 代码审查 | 100% |
| 安全扫描 | 0 高危漏洞 |

---

*文档结束*
