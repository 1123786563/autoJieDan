# 需求分析文档：融合 Automaton 与 Nanobot 的接单 AI 代理系统

> 文档版本: 1.0.0 | 创建日期: 2026-02-25

---

## 1. 概述

### 1.1 项目背景

本项目旨在融合两个开源 AI 代理系统：

| 系统 | 语言 | 定位 | 核心能力 |
|------|------|------|----------|
| **Automaton** | TypeScript | 自主生存型 AI 经济主体 | 经济决策、项目管理、区块链操作、生存管理 |
| **Nanobot** | Python | 超轻量级 AI 代理框架 | 技术执行、代码生成、多渠道通信、测试交付 |

### 1.2 融合目标

构建端到端自动化的接单 AI 代理系统，实现"商务-技术-运营"三位一体：

```
┌─────────────────────────────────────────────────────────────┐
│                      融合 AI 代理系统                        │
├─────────────────┬─────────────────┬─────────────────────────┤
│   前端商务层    │   中端技术层    │      后端运营层          │
│  (Automaton)    │   (Nanobot)     │   (双系统协同)           │
├─────────────────┼─────────────────┼─────────────────────────┤
│ • 平台接单      │ • 代码生成      │ • 反馈处理               │
│ • 需求分析      │ • 测试          │ • 需求确认               │
│ • 合同评估      │ • 部署          │ • 迭代修改               │
│ • 客户沟通      │ • 监控          │ • 持续交付               │
└─────────────────┴─────────────────┴─────────────────────────┘
```

---

## 2. 功能需求清单

### 2.1 Automaton 治理层功能

| 模块 | 功能 | 输入 | 输出 | 依赖 | 优先级 |
|------|------|------|------|------|--------|
| **平台对接** | 多平台订单监控 | 平台 API 配置 | 新订单列表 | 外包平台 API | P0 |
| **项目筛选** | 多因子评分算法 | 项目描述、预算、技术栈 | 评分结果、投标建议 | 平台对接 | P0 |
| **合同评估** | 风险与收益评估 | 合同条款、客户历史 | 评估报告、决策建议 | 项目筛选 | P0 |
| **资源管理** | 预算与算力分配 | 项目需求、当前资源 | 资源分配方案 | 合同评估 | P1 |
| **生存监控** | 心跳与信用管理 | 运营数据、收支记录 | 生存状态、告警 | 资源管理 | P0 |
| **自我改进** | 递归优化与繁殖 | 性能数据、成功案例 | 配置变更、子代实例 | 生存监控 | P2 |

### 2.2 Nanobot 执行层功能

| 模块 | 功能 | 输入 | 输出 | 依赖 | 优先级 |
|------|------|------|------|------|--------|
| **需求分析** | 多轮对话澄清 | 客户需求、项目上下文 | 需求文档、技术方案 | 沟通渠道 | P0 |
| **代码生成** | 全栈代码开发 | 技术方案、模板库 | 源代码、配置文件 | 需求分析 | P0 |
| **测试执行** | 自动化测试 | 代码库、测试策略 | 测试报告、覆盖率 | 代码生成 | P0 |
| **部署运维** | CI/CD 与监控 | 代码库、部署配置 | 部署状态、监控指标 | 测试执行 | P1 |
| **客户沟通** | 多渠道消息处理 | 客户消息、项目状态 | 回复内容、进度报告 | 所有模块 | P0 |
| **知识管理** | 经验学习与复用 | 项目历史、代码库 | 知识库更新 | 所有模块 | P2 |

### 2.3 跨系统协作功能

| 功能 | 发起方 | 接收方 | 触发条件 | 数据交换 | 优先级 |
|------|--------|--------|----------|----------|--------|
| **任务分发** | Automaton | Nanobot | 项目中标 | 创世提示(Genesis Prompt) | P0 |
| **进度报告** | Nanobot | Automaton | 开发进行中 | 进度百分比、里程碑 | P0 |
| **资源请求** | Nanobot | Automaton | 需要额外预算 | 预算变更请求 | P1 |
| **异常告警** | Nanobot | Automaton | 错误/超时 | 异常详情、上下文 | P0 |
| **交付确认** | Nanobot | Automaton | 开发完成 | 交付物清单、测试报告 | P0 |
| **收入核算** | Automaton | Nanobot | 项目收款 | 收入分配、绩效数据 | P1 |

---

## 3. 通信协作需求（重点）

### 3.1 通信协议选型

**推荐方案：HTTP REST + WebSocket + 共享 SQLite**

| 协议 | 用途 | 场景 |
|------|------|------|
| HTTP REST | 同步请求-响应 | 状态查询、预算检查、健康检查 |
| WebSocket | 实时事件推送 | 进度更新、异常告警、心跳 |
| 共享 SQLite | 异步任务队列 | 长时间开发任务、持久化保证 |

### 3.2 消息格式定义

```typescript
// 统一消息信封格式
interface InterAgentMessage {
  id: string;                    // ULID 唯一标识
  version: string;               // Schema 版本 "1.0.0"
  timestamp: string;             // ISO 8601 时间戳
  source: "automaton" | "nanobot";
  target: "automaton" | "nanobot" | "both";
  type: MessageType;             // 消息类型枚举
  payload: unknown;              // 消息体
  metadata: {
    priority: "low" | "normal" | "high" | "critical";
    retryCount: number;
    idempotencyKey?: string;     // 幂等性键
    traceId?: string;            // 分布式追踪
  };
  correlationId?: string;        // 请求-响应关联
  ttl?: number;                  // 消息有效期(秒)
}
```

### 3.3 "创世提示"(Genesis Prompt) 接口

Automaton 向 Nanobot 分发任务的核心接口：

```typescript
interface GenesisPrompt {
  // 项目标识
  projectId: string;             // 平台来源 + 项目ID
  platform: string;              // upwork | freelancer | github 等

  // 需求摘要
  requirementSummary: string;    // 功能描述
  technicalConstraints: {        // 技术约束
    requiredStack?: string[];    // 必须使用的技术栈
    prohibitedStack?: string[];  // 禁止使用的技术栈
    platform?: string;           // 部署平台
  };

  // 商务条款
  contractTerms: {
    totalBudget: number;         // 合同总金额(美分)
    currency: string;            // 货币类型
    milestones: Milestone[];     // 付款里程碑
    deadline: string;            // 最终交付期限
  };

  // 资源约束
  resourceLimits: {
    maxTokensPerTask: number;    // 单任务最大 Token
    maxCostCents: number;        // 最大成本(美分)
    maxDurationMs: number;       // 最大执行时间
  };

  // 特殊指示
  specialInstructions?: {
    priorityLevel: "low" | "normal" | "high";
    riskFlags: string[];         // 风险标记
    humanReviewRequired: boolean; // 是否需要人工审核
  };
}
```

### 3.4 反馈报告接口

#### 3.4.1 进度报告
```typescript
interface ProgressReport {
  taskId: string;
  projectId: string;
  progress: number;              // 0-100
  currentPhase: string;          // 当前阶段描述
  completedSteps: string[];      // 已完成步骤
  nextSteps: string[];           // 下一步骤
  etaSeconds?: number;           // 预计剩余时间
  blockers?: string[];           // 阻塞问题
}
```

#### 3.4.2 资源消耗报告
```typescript
interface ResourceConsumptionReport {
  taskId: string;
  period: { start: string; end: string; };
  metrics: {
    tokensUsed: number;
    llmCalls: number;
    costCents: number;
    cpuMs: number;
    memoryPeakMb: number;
  };
  projectedTotal: {
    estimatedTokens: number;
    estimatedCostCents: number;
  };
}
```

#### 3.4.3 异常事件报告
```typescript
interface ExceptionReport {
  taskId: string;
  severity: "warning" | "error" | "critical";
  errorCode: string;
  message: string;
  context: Record<string, unknown>;
  recoverable: boolean;
  suggestedAction?: string;
}
```

### 3.5 同步/异步通信模式

| 模式 | 使用场景 | 超时设置 | 重试策略 |
|------|----------|----------|----------|
| **同步调用** | 状态查询、预算检查 | 5秒 | 3次，指数退避 |
| **异步任务** | 代码开发、测试执行 | 30分钟+ | 记录失败，人工介入 |
| **事件驱动** | 进度更新、异常告警 | N/A | 持久化+重发 |

---

## 4. 非功能需求

### 4.1 性能要求

| 指标 | 目标值 | 测量方法 |
|------|--------|----------|
| API 响应延迟 | P99 < 500ms | APM 监控 |
| 任务吞吐量 | >100 任务/小时 | 队列监控 |
| 并发连接 | >50 WebSocket | 负载测试 |
| 消息丢失率 | <0.01% | 审计日志 |

### 4.2 可靠性要求

| 指标 | 目标值 | 实现方式 |
|------|--------|----------|
| 系统可用性 | 99.9% | 健康检查+自动恢复 |
| 数据持久性 | 100% | SQLite WAL 模式 |
| 故障恢复时间 | <5分钟 | 状态快照+快速重启 |

### 4.3 安全性要求

| 要求 | 实现方式 |
|------|----------|
| 服务间认证 | HMAC-SHA256 签名 |
| 传输加密 | TLS 1.3 (生产环境) |
| 敏感数据保护 | 环境变量 + 加密存储 |
| 访问控制 | 角色权限矩阵 |

### 4.4 可扩展性要求

| 方向 | 扩展策略 |
|------|----------|
| 水平扩展 | 多 Nanobot 实例 + 任务分片 |
| 垂直扩展 | 动态资源分配 |
| 功能扩展 | 插件化技能系统 |

---

## 5. 边界条件与约束

### 5.1 系统边界

**适用场景**：
- ✅ 标准化 Web 应用开发
- ✅ 自动化脚本与工具
- ✅ 智能合约与 Web3 应用

**不适用场景**：
- ❌ 大规模分布式系统
- ❌ 安全关键系统（医疗/金融核心）
- ❌ 高度定制化创意设计

### 5.2 资源约束

| 约束 | 默认值 | 调整范围 |
|------|--------|----------|
| 最大并发项目 | 5 | 1-20 |
| 最小项目价值 | $50 | $20-$100 |
| 最大项目周期 | 30天 | 7-90天 |
| 单项目 LLM 成本上限 | 合同金额30% | 20%-50% |
| 消息队列深度 | 1000 | 100-10000 |

### 5.3 风险缓解

| 风险 | 缓解策略 |
|------|----------|
| 客户失联 | 7天无响应自动标记完成或发起争议 |
| LLM 服务中断 | 多提供商故障转移 |
| API 限流 | 指数退避 + 请求队列 |
| 成本超支 | 实时预算监控 + 自动暂停 |

---

## 6. 验收标准

### 6.1 功能验收

| 指标 | 目标值 | 验收方式 |
|------|--------|----------|
| 订单获取成功率 | >10% | 投标/中标比例 |
| 项目完成率 | >80% | 启动/交付比例 |
| 平均利润率 | >40% | (收入-成本)/收入 |
| 客户满意度 | >4.0/5.0 | 平台评分 |
| 首次交付时间 | <24小时 | 合同到首次交付 |

### 6.2 质量验收

| 指标 | 目标值 | 验收方式 |
|------|--------|----------|
| 测试覆盖率 | >80% | 代码覆盖率工具 |
| 代码规范通过率 | 100% | Linter 检查 |
| 安全扫描 | 0 高危 | SAST/DAST |
| 响应延迟 P99 | <500ms | 性能测试 |

---

## 7. 开放问题

以下问题需要在设计阶段进一步澄清：

| # | 问题 | 影响范围 | 建议解决方式 |
|---|------|----------|--------------|
| 1 | 部署模式选择（统一服务 vs 独立进程） | 架构设计 | 建议：独立进程 + HTTP 通信 |
| 2 | MVP 目标平台选择 | 平台对接 | 建议：Upwork 优先（API 开放度高） |
| 3 | 合同评估具体标准 | 项目筛选 | 需要定义评分阈值和权重 |
| 4 | 收入/成本分配模型 | 经济系统 | 建议：Automaton 30% / Nanobot 70% |
| 5 | 人工介入触发条件 | 自主程度 | 建议合同金额 >$500 或风险标记 |
| 6 | 代码质量标准 | 交付验收 | 建议：80% 覆盖率 + 0 lint 错误 |
| 7 | 信用耗尽时的项目处理 | 生存约束 | 建议：48小时缓冲期 |

---

## 8. 术语表

| 术语 | 定义 |
|------|------|
| Genesis Prompt | 创世提示，Automaton 向 Nanobot 分发任务的初始化消息 |
| Heartbeat | 心跳，定期的健康状态检查信号 |
| Circuit Breaker | 熔断器，防止级联故障的保护机制 |
| DLQ | Dead Letter Queue，死信队列，存储处理失败的消息 |
| WAL | Write-Ahead Logging，预写日志，SQLite 的持久化模式 |
| ULID | Universally Unique Lexicographically Sortable Identifier |

---

*文档版本: 1.0.0*
*最后更新: 2026-02-25*
*作者: Claude Analyst Agent*
