# 融合Automaton与Nanobot的接单AI代理系统 - 实施计划

> **文档版本**: 1.1.0
> **创建日期**: 2026-02-27
> **更新日期**: 2026-02-27
> **基于需求分析版本**: 1.0.1
> **总工期**: 6周 (含1周缓冲 + 8h类型互操作性缓冲)

---

## 目录

1. [RALPLAN-DR 摘要](#1-ralplan-dr-摘要)
2. [模块详细设计](#2-模块详细设计)
3. [并行化任务分解](#3-并行化任务分解)
4. [验收标准](#4-验收标准)
5. [风险缓解与降级策略](#5-风险缓解与降级策略)

---

## 1. RALPLAN-DR 摘要

### 1.1 原则 (Principles)

| # | 原则 | 说明 |
|---|------|------|
| P1 | **最小可行集成** | 优先实现核心通信路径，非关键功能可延后 |
| P2 | **双系统职责分离** | Automaton管商务决策与经济生存，Nanobot管技术执行与平台集成，通过ANP协议通信 |
| P3 | **测试驱动开发** | 每个模块先写测试，覆盖率>80% |
| P4 | **增量交付验证** | 每周交付可运行增量，通过检查点验证 |
| P5 | **优雅降级优先** | 关键路径设计降级方案，检查点失败可回退 |

### 1.2 决策驱动因素 (Decision Drivers)

| # | 驱动因素 | 权重 | 影响决策 |
|---|----------|------|----------|
| D1 | **复用已有实现** | 高 | ANP/Interagent模块已实现，优先集成而非重写 |
| D2 | **并行开发效率** | 高 | 任务分解为<=4小时单元，最大化并行度 |
| D3 | **风险可控性** | 高 | 设置Go/No-Go检查点，失败可降级 |

### 1.3 可行方案分析

#### 方案A: ANP协议 + 双系统架构 (推荐)

**优点**:
- 已有ANP/Interagent基础实现
- 去中心化身份，符合自主Agent理念
- 端到端加密，安全性高
- 可扩展至多Agent网络

**缺点**:
- 双系统调试复杂度较高
- 需要维护两套测试框架

**选择理由**: 已有60%基础实现，复用成本低

#### 方案B: HTTP REST回退方案

**触发条件**: CP1检查点失败 (ANP签名验证<90%)

**优点**:
- 实现简单，调试方便
- 开发周期可缩短至2周

**缺点**:
- 需要重新实现身份管理
- 扩展性受限

---

## 2. 模块详细设计

### 2.1 模块一：BIZ - 平台接单与商务 (双系统协作)

> **职责说明**: 平台集成（RSS监控、API交互）由 Nanobot 的 `channels/upwork/` 已实现；
> 商务决策（项目筛选、定价策略、合同评估）由 Automaton 的 `biz/` 模块负责。

#### 2.1.1 类/模块结构

```
# Nanobot - 平台集成 (已实现)
nanobot/nanobot/channels/upwork/
├── channel.py               # ✅ 已实现: Upwork通道主逻辑
├── rss_monitor.py           # ✅ 已实现: RSS监控
├── api_client.py            # ✅ 已实现: Upwork API客户端
├── models.py                # ✅ 已实现: 数据模型
└── skills/
    ├── bid_generator.py     # ✅ 已实现: 投标生成
    ├── pricing.py           # ✅ 已实现: 定价计算
    └── skill_matcher.py     # ✅ 已实现: 技能匹配

# Automaton - 商务决策 (待实现)
automaton/src/biz/
├── index.ts                 # 模块入口
├── types.ts                 # 类型定义
├── project-filter.ts        # 项目筛选算法
├── contract-evaluator.ts    # 合同评估
├── pricing-strategy.ts      # 定价策略
└── competitor-analyzer.ts   # 竞争对手分析
```

#### 2.1.2 关键接口定义

```typescript
// types.ts
interface ProjectCandidate {
  id: string;
  platform: "upwork" | "freelancer" | "fiverr";
  title: string;
  description: string;
  budget: MonetaryAmount;
  deadline: Date;
  skills: string[];
  clientRating: number;
  postedAt: Date;
}

interface ProjectScore {
  projectId: string;
  overallScore: number;      // 0-100
  factors: {
    skillMatch: number;      // 技能匹配度
    budgetFit: number;       // 预算合适度
    deadlineRisk: number;    // 截止日期风险
    clientQuality: number;   // 客户质量
    competition: number;     // 竞争程度
  };
  recommendation: "accept" | "consider" | "reject";
}

interface BidProposal {
  projectId: string;
  coverLetter: string;
  proposedBudget: MonetaryAmount;
  estimatedDuration: string;
  milestones: Milestone[];
}

// project-filter.ts
interface IProjectFilter {
  score(project: ProjectCandidate): Promise<ProjectScore>;
  batchScore(projects: ProjectCandidate[]): Promise<ProjectScore[]>;
  setWeights(weights: ScoringWeights): void;
}

// bid-generator.ts
interface IBidGenerator {
  generate(project: ProjectCandidate, score: ProjectScore): Promise<BidProposal>;
  personalize(proposal: BidProposal, clientHistory?: ClientHistory): BidProposal;
}
```

#### 2.1.3 数据模型

```typescript
// 存储在 SQLite
interface BizState {
  // 项目追踪
  activeProjects: ActiveProject[];
  bidHistory: BidRecord[];

  // 统计数据
  successRate: number;
  avgProfitMargin: number;

  // 配置
  scoringWeights: ScoringWeights;
  pricingConfig: PricingConfig;
}

interface ActiveProject {
  id: string;
  platform: string;
  status: "bidding" | "negotiating" | "active" | "completed" | "cancelled";
  createdAt: Date;
  genesisPromptId?: string;
  nanobotTaskId?: string;
}
```

#### 2.1.4 状态机设计

```
[新项目发现] ──评分──> [筛选通过] ──生成投标──> [已投标]
                         │                      │
                         │ <──投标失败──         │
                         │                      │
                         v                      v
                     [拒绝]                [客户响应]
                                              │
                                              v
                                        [合同谈判]
                                              │
                                    ┌─────────┴─────────┐
                                    v                   v
                               [签约成功]          [谈判失败]
                                    │
                                    v
                            [发送Genesis Prompt]
                                    │
                                    v
                            [开发中 (等待Nanobot)]
```

#### 2.1.5 错误处理策略

| 错误类型 | 处理方式 |
|----------|----------|
| API限流 | 指数退避重试，最大3次 |
| 项目解析失败 | 记录日志，跳过该项目 |
| 投标生成失败 | 降级为模板投标 |
| 网络超时 | 切换代理或等待重试 |

---

### 2.2 模块二：ANP - 通信协作 (双系统)

#### 2.2.1 类/模块结构

```
# Automaton (TypeScript)
automaton/src/anp/
├── index.ts
├── types.ts              # ✅ 已实现
├── did.ts                # ✅ 已实现
├── signature.ts          # ✅ 已实现
├── encryption.ts         # ✅ 已实现
├── resolver.ts           # ✅ 已实现
└── adapter.ts            # 新增: ANP适配器

automaton/src/interagent/
├── genesis-prompt.ts     # ✅ 已实现
├── task-manager.ts       # ✅ 已实现
├── progress-reporter.ts  # ✅ 已实现
├── websocket.ts          # ✅ 已实现
└── anp-bridge.ts         # 新增: ANP消息桥接

# Nanobot (Python)
nanobot/nanobot/anp/
├── __init__.py
├── types.py              # ✅ 已实现
├── did.py                # ✅ 已实现
├── signature.py          # ✅ 已实现
├── encryption.py         # ✅ 已实现
├── resolver.py           # ✅ 已实现
└── adapter.py            # 新增: ANP适配器

nanobot/nanobot/interagent/
├── genesis_prompt.py     # ✅ 已实现
├── task_lifecycle.py     # ✅ 已实现
├── progress_reporter.py  # ✅ 已实现
├── websocket.py          # ✅ 已实现
└── anp_bridge.py         # 新增: ANP消息桥接
```

#### 2.2.2 关键接口定义

```typescript
// Automaton ANP Adapter
interface IANPAdapter {
  // 消息发送
  sendEncrypted(target: string, message: ANPMessage): Promise<void>;
  sendSigned(target: string, message: ANPMessage): Promise<void>;

  // 消息接收
  onMessage(handler: (message: ANPMessage) => Promise<void>): void;
  onEncrypted(handler: (message: ANPEncryptedMessage) => Promise<void>): void;

  // 协议协商
  negotiateProtocol(target: string): Promise<NegotiatedProtocol>;

  // 能力发现
  queryCapabilities(target: string): Promise<Capability[]>;
  broadcastCapabilities(): Promise<void>;

  // 生命周期
  start(): Promise<void>;
  stop(): Promise<void>;
}

// ANP Bridge - 连接ANP层与业务层
interface IANPBridge {
  // 发送Genesis Prompt
  sendGenesisPrompt(prompt: GenesisPrompt): Promise<GenesisPromptResponse>;

  // 接收进度报告
  onProgressReport(handler: (report: ProgressReportPayload) => void): void;

  // 接收任务完成
  onTaskComplete(handler: (result: GenesisResult) => void): void;

  // 接收错误
  onError(handler: (error: ErrorReportPayload) => void): void;
}
```

```python
# Nanobot ANP Adapter (Python)
class ANPAdapter(Protocol):
    async def send_encrypted(self, target: str, message: ANPMessage) -> None: ...
    async def send_signed(self, target: str, message: ANPMessage) -> None: ...
    async def on_message(self, handler: Callable[[ANPMessage], Awaitable[None]]) -> None: ...
    async def negotiate_protocol(self, target: str) -> NegotiatedProtocol: ...
    async def query_capabilities(self, target: str) -> List[Capability]: ...
    async def start(self) -> None: ...
    async def stop(self) -> None: ...

# ANP Bridge
class ANPBridge(Protocol):
    async def receive_genesis_prompt(self) -> GenesisPrompt: ...
    async def send_progress_report(self, report: ProgressReportPayload) -> None: ...
    async def send_task_complete(self, result: GenesisResult) -> None: ...
    async def send_error(self, error: ErrorReportPayload) -> None: ...
```

#### 2.2.3 数据流设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ANP 通信数据流                                │
└─────────────────────────────────────────────────────────────────────┘

[Automaton]                              [Nanobot]
    │                                        │
    │  1. ProtocolNegotiate                  │
    │───────────────────────────────────────>│
    │                                        │
    │  2. ProtocolAccept                     │
    │<───────────────────────────────────────│
    │                                        │
    │  3. CapabilityQuery                    │
    │───────────────────────────────────────>│
    │                                        │
    │  4. CapabilityResponse                 │
    │<───────────────────────────────────────│
    │                                        │
    │  5. TaskCreate (GenesisPrompt)         │
    │  [Encrypted + Signed]                  │
    │───────────────────────────────────────>│
    │                                        │
    │  6. ProgressEvent (周期性)              │
    │<───────────────────────────────────────│
    │                                        │
    │  7. ProgressEvent                      │
    │<───────────────────────────────────────│
    │                                        │
    │  8. TaskComplete                       │
    │<───────────────────────────────────────│
    │                                        │
    │  9. TaskCreate (下一个任务)             │
    │───────────────────────────────────────>│
    │                                        │
```

#### 2.2.4 类型互操作性规范

> **CRITICAL**: Genesis Prompt 字段命名不一致问题

**问题描述**:
- TypeScript (Automaton): `sourceDid`, `targetDid`, `createdAt` (camelCase)
- Python (Nanobot): `source_did`, `target_did`, `created_at` (snake_case)

**解决方案**: JSON 序列化统一使用 **camelCase**

```typescript
// Automaton (TypeScript) - 直接使用 camelCase
interface GenesisPrompt {
  sourceDid: string;    // JSON 输出: "sourceDid"
  targetDid: string;    // JSON 输出: "targetDid"
  createdAt: Date;      // JSON 输出: "createdAt"
}
```

```python
# Nanobot (Python) - 使用别名映射
@dataclass
class GenesisPrompt:
    source_did: str = field(metadata={"alias": "sourceDid"})
    target_did: str = field(metadata={"alias": "targetDid"})
    created_at: datetime = field(metadata={"alias": "createdAt"})

    def to_dict(self) -> Dict[str, Any]:
        # 输出 camelCase 格式
        return {
            "sourceDid": self.source_did,
            "targetDid": self.target_did,
            "createdAt": self.created_at.isoformat(),
        }
```

---

### 2.3 模块三：DEV - 需求分析与开发 (Nanobot主导)

#### 2.3.1 类/模块结构

```
nanobot/nanobot/dev/
├── __init__.py
├── types.py                 # 类型定义
├── requirement_parser.py    # 需求解析引擎
├── tech_stack_selector.py   # 技术栈选择
├── code_generator.py        # 代码生成引擎
├── memory_system.py         # 双层记忆系统
├── code_reviewer.py         # 代码审查自动化
└── doc_generator.py         # 文档自动生成
```

#### 2.3.2 关键接口定义

```python
# requirement_parser.py
class RequirementParser:
    """需求解析引擎"""

    async def parse(self, raw_requirement: str) -> ParsedRequirement:
        """解析自然语言需求"""
        ...

    async def extract_technical_specs(self, requirement: str) -> TechnicalSpecs:
        """提取技术规格"""
        ...

    async def identify_constraints(self, requirement: str) -> List[Constraint]:
        """识别约束条件"""
        ...

@dataclass
class ParsedRequirement:
    summary: str
    user_stories: List[UserStory]
    technical_specs: TechnicalSpecs
    constraints: List[Constraint]
    ambiguities: List[str]  # 需要澄清的点

# tech_stack_selector.py
class TechStackSelector:
    """技术栈选择器"""

    async def recommend(self, requirement: ParsedRequirement) -> TechStackRecommendation:
        """推荐技术栈"""
        ...

    async def validate_feasibility(self, stack: TechStack) -> FeasibilityReport:
        """验证可行性"""
        ...

@dataclass
class TechStackRecommendation:
    primary_language: str
    frameworks: List[str]
    libraries: List[str]
    deployment_target: str
    confidence: float  # 0-1

# code_generator.py
class CodeGenerator:
    """代码生成引擎"""

    async def generate_from_spec(self, spec: TechnicalSpecs) -> GeneratedCode:
        """从规格生成代码"""
        ...

    async def generate_tests(self, code: GeneratedCode) -> GeneratedTests:
        """生成测试"""
        ...

    async def refactor(self, code: str, guidelines: List[str]) -> str:
        """重构代码"""
        ...

@dataclass
class GeneratedCode:
    files: List[CodeFile]
    dependencies: List[Dependency]
    coverage_estimate: float

# memory_system.py
class DualMemorySystem:
    """双层记忆系统"""

    # 短期记忆 (会话级)
    async def store_session_context(self, session_id: str, context: dict) -> None: ...
    async def get_session_context(self, session_id: str) -> dict: ...

    # 长期记忆 (知识库)
    async def store_knowledge(self, key: str, value: Any, metadata: dict) -> None: ...
    async def retrieve_knowledge(self, query: str) -> List[KnowledgeEntry]: ...
    async def update_knowledge(self, key: str, updates: dict) -> None: ...
```

#### 2.3.3 数据模型

```python
# 存储在 SQLite/向量数据库
class DevSession(BaseModel):
    session_id: str
    genesis_prompt_id: str
    status: Literal["parsing", "planning", "coding", "testing", "completed", "failed"]
    requirement: ParsedRequirement
    tech_stack: TechStackRecommendation
    generated_files: List[str]
    test_coverage: float
    started_at: datetime
    updated_at: datetime

class KnowledgeEntry(BaseModel):
    key: str
    value: Any
    embedding: Optional[List[float]]  # 向量嵌入
    metadata: dict
    created_at: datetime
    last_accessed: datetime
    access_count: int
```

---

### 2.4 模块四：QA - 测试与质量保证 (Nanobot主导)

#### 2.4.1 类/模块结构

```
nanobot/nanobot/qa/
├── __init__.py
├── types.py                 # 类型定义
├── unit_test_generator.py   # 单元测试生成
├── integration_tester.py    # 集成测试框架
├── e2e_tester.py            # E2E测试 (Playwright)
├── performance_tester.py    # 性能基准测试
└── security_scanner.py      # 安全扫描集成
```

#### 2.4.2 关键接口定义

```python
# unit_test_generator.py
class UnitTestGenerator:
    """单元测试生成器"""

    async def generate_tests(self, code: str, language: str) -> TestSuite:
        """为代码生成单元测试"""
        ...

    async def estimate_coverage(self, tests: TestSuite, code: str) -> CoverageReport:
        """估算覆盖率"""
        ...

    async def mutate_and_test(self, code: str, tests: TestSuite) -> MutationReport:
        """变异测试"""
        ...

@dataclass
class TestSuite:
    test_files: List[TestFile]
    framework: str  # pytest, vitest, jest
    estimated_coverage: float

@dataclass
class CoverageReport:
    line_coverage: float
    branch_coverage: float
    function_coverage: float
    uncovered_lines: List[int]

# integration_tester.py
class IntegrationTester:
    """集成测试框架"""

    async def generate_api_tests(self, api_spec: dict) -> TestSuite:
        """从API规格生成集成测试"""
        ...

    async def run_tests(self, tests: TestSuite, env: TestEnvironment) -> TestResults:
        """运行测试"""
        ...

# e2e_tester.py
class E2ETester:
    """E2E测试 (Playwright)"""

    async def generate_e2e_tests(self, user_flows: List[UserFlow]) -> TestSuite:
        """生成E2E测试"""
        ...

    async def run_e2e(self, tests: TestSuite, browser: str) -> E2EResults:
        """运行E2E测试"""
        ...

# security_scanner.py
class SecurityScanner:
    """安全扫描器"""

    async def scan_dependencies(self, requirements_file: str) -> VulnerabilityReport:
        """扫描依赖漏洞"""
        ...

    async def run_owasp_checks(self, codebase_path: str) -> OWASPReport:
        """OWASP检查"""
        ...

    async def scan_secrets(self, codebase_path: str) -> SecretReport:
        """扫描敏感信息"""
        ...
```

---

### 2.5 模块五：SUR - 经济生存管理 (Automaton主导)

#### 2.5.1 类/模块结构

```
automaton/src/survival/
├── index.ts
├── types.ts                 # 类型定义
├── monitor.ts               # ✅ 已实现: 资源监控
├── funding.ts               # ✅ 已实现: 资金筹集
├── low-compute.ts           # ✅ 已实现: 低计算模式
├── tier-manager.ts          # 新增: 层级管理器
├── budget-tracker.ts        # 新增: 预算追踪
├── income-predictor.ts      # 新增: 收入预测
└── emergency-fundraiser.ts  # 新增: 紧急资金筹集
```

#### 2.5.2 关键接口定义

```typescript
// tier-manager.ts
interface ITierManager {
  getCurrentTier(): SurvivalTier;
  checkTransition(): Promise<TierTransition | null>;
  executeTransition(transition: TierTransition): Promise<void>;
  onTierChange(handler: (event: TierChangeEvent) => void): void;
}

interface TierTransition {
  from: SurvivalTier;
  to: SurvivalTier;
  reason: string;
  timestamp: Date;
  actions: TierAction[];
}

// budget-tracker.ts
interface IBudgetTracker {
  // 记录
  recordIncome(amount: number, source: string): void;
  recordExpense(amount: number, category: string): void;

  // 查询
  getBalance(): number;
  getDailyBurnRate(): number;
  getRunway(): number;  // 天数

  // 预测
  predictBalance(days: number): number;
}

// income-predictor.ts
interface IIncomePredictor {
  predict30Days(): Promise<IncomePrediction>;
  getConfidence(): number;
  updateModel(actualIncome: number): void;
}

interface IncomePrediction {
  expectedTotal: number;
  confidence: number;  // 0-1
  range: {
    low: number;
    high: number;
  };
  sources: Map<string, number>;
}
```

#### 2.5.3 生存状态状态机

```
                    ┌──────────────────────────────────────┐
                    │                                      │
                    v                                      │
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐ │
│  normal │───>│low_compute│───>│ critical│───>│  dead   │─┘
└─────────┘    └─────────┘    └─────────┘    └─────────┘
     │              │              │              │
     │              │              │              │
     v              v              v              v
 [全功能]      [模型降级]      [紧急模式]     [停止运行]
 [前沿模型]    [慢心跳]        [快速创收]     [等待充值]
 [正常心跳]    [核心任务]      [最小任务]
```

---

### 2.6 模块六：COM - 客户沟通与反馈 (双系统)

#### 2.6.1 类/模块结构

```
# Automaton (商务沟通)
automaton/src/com/
├── index.ts
├── types.ts
├── message-router.ts       # 消息路由
├── reply-generator.ts      # 智能回复生成
└── satisfaction-tracker.ts # 满意度追踪

# Nanobot (技术沟通)
nanobot/nanobot/com/
├── __init__.py
├── types.py
├── clarification.py        # 需求澄清对话
├── change_handler.py       # 变更请求处理
└── notification.py         # 通知发送
```

#### 2.6.2 关键接口定义

```typescript
// Automaton - 商务沟通
interface IMessageRouter {
  route(message: IncomingMessage): Promise<RoutingDecision>;
  getChannel(platform: string): IChannel;
}

interface IReplyGenerator {
  generateReply(message: IncomingMessage, context: ConversationContext): Promise<GeneratedReply>;
  escalateToHuman(message: IncomingMessage, reason: string): void;
}

interface GeneratedReply {
  content: string;
  confidence: number;
  requiresHumanReview: boolean;
  suggestedActions: string[];
}

// Nanobot - 技术沟通
class ClarificationDialog:
    """需求澄清对话"""

    async def start_clarification(self, ambiguity: str) -> ClarificationQuestion: ...
    async def process_response(self, response: str) -> ClarificationResult: ...
    async def is_complete(self) -> bool: ...

class ChangeRequestHandler:
    """变更请求处理"""

    async def analyze_impact(self, change_request: str) -> ImpactAnalysis: ...
    async def estimate_effort(self, impact: ImpactAnalysis) -> EffortEstimate: ...
    async def generate_response(self, estimate: EffortEstimate) -> ChangeResponse: ...
```

---

## 3. 并行化任务分解

### 3.1 任务依赖图

```
Week 1-2: ANP基础设施
======================

    [T001] DID验证增强 ─────────────────┐
    [T002] 加密通信测试 ─────────────────┼──> [T010] ANP集成测试
    [T003] 消息序列化优化 ───────────────┤
    [T004] 协议协商实现 ─────────────────┘

    [T005] WebSocket连接池 (Automaton) ──┐
    [T006] WebSocket连接池 (Nanobot) ────┴──> [T011] 双向通信测试

    [T007] 密钥轮换机制 ────────────────────> [T012] 安全审计

Week 3: 协议层实现
=================

    [T013] Genesis Prompt ANP适配 ────────┐
    [T014] 进度报告ANP适配 ────────────────┼──> [T020] 端到端消息流测试
    [T015] 错误报告ANP适配 ────────────────┤
    [T016] 心跳机制 ───────────────────────┘

    [T017] 能力发现服务 ────────────────────> [T021] 能力协商测试

Week 4: 业务集成
===============

    [T022] 项目筛选算法 ────────────────────┐
    [T023] 投标生成器 ──────────────────────┼──> [T030] 接单流程测试
    [T024] 合同评估 ────────────────────────┘

    [T025] 需求解析引擎 ────────────────────┐
    [T026] 代码生成集成 ────────────────────┼──> [T031] 开发流程测试
    [T027] 测试生成集成 ────────────────────┘

    [T028] 预算追踪集成 ────────────────────> [T032] 生存管理测试

Week 5: 端到端测试
=================

    [T033] E2E加密测试 ─────────────────────┐
    [T034] 协议协商测试 ────────────────────┼──> [T040] 集成测试报告
    [T035] 性能基准测试 ────────────────────┤
    [T036] 压力测试 ────────────────────────┘

Week 6: 缓冲与上线
=================

    [T041] 缺陷修复 ────────────────────────> [T045] 上线检查
    [T042] 文档完善 ────────────────────────> [T046] 文档审核
    [T043] 生产部署 ────────────────────────> [T047] 部署验证
    [T044] 试运行 ──────────────────────────> [T048] M5验收
```

### 3.2 详细任务列表

#### Phase 1: ANP基础设施 (Week 1-2)

| 任务ID | 任务名称 | 工时 | 负责人 | 依赖 | 验收标准 |
|--------|----------|------|--------|------|----------|
| T001 | DID验证增强 | 4h | 双系统 | - | 签名验证100%通过 |
| T001b | 统一Genesis Prompt字段命名规范 | 2h | 双系统 | T001 | JSON序列化camelCase一致性100% |
| T002 | 加密通信测试 | 4h | 双系统 | T001 | E2E加密测试>90%通过 |
| T003 | 消息序列化优化 | 2h | 双系统 | - | JSON-LD格式验证通过 |
| T004 | 协议协商实现 | 4h | 双系统 | T001 | 动态版本协商成功 |
| T005 | WebSocket连接池(A) | 3h | Automaton | - | 连接复用率>80% |
| T006 | WebSocket连接池(N) | 3h | Nanobot | - | 连接复用率>80% |
| T007 | 密钥轮换机制 | 4h | 双系统 | T001 | 30天自动轮换 |
| T008 | 消息重试机制 | 3h | 双系统 | T005,T006 | 重试成功率>99% |
| T009 | DLQ死信队列 | 2h | 双系统 | T008 | 失败消息可追溯 |
| T010 | ANP集成测试 | 4h | 双系统 | T001-T004 | 集成测试100%通过 |
| T010b | TypeScript/Python类型互操作性测试 | 2h | 双系统 | T001b,T010 | 双向序列化/反序列化100%通过 |
| T011 | 双向通信测试 | 4h | 双系统 | T005,T006 | 双向消息延迟<5s |
| T012 | 安全审计 | 4h | 双系统 | T007 | 无高危漏洞 |

**并行组1**: T001, T003, T005, T006 (可同时进行)
**并行组2**: T001b, T002, T004, T007 (依赖T001)
**并行组3**: T008, T009 (依赖T005,T006)
**并行组4**: T010, T010b, T011, T012 (集成测试)

---

#### Phase 2: 协议层实现 (Week 3)

| 任务ID | 任务名称 | 工时 | 负责人 | 依赖 | 验收标准 |
|--------|----------|------|--------|------|----------|
| T013 | Genesis Prompt ANP适配 | 4h | 双系统 | T010 | 任务创建成功率>95% |
| T014 | 进度报告ANP适配 | 3h | Nanobot | T010 | 进度同步延迟<5s |
| T015 | 错误报告ANP适配 | 2h | 双系统 | T010 | 错误传递正确 |
| T016 | 心跳机制 | 2h | 双系统 | T011 | 心跳间隔30s |
| T017 | 能力发现服务 | 3h | 双系统 | T010 | JSON-LD能力描述 |
| T018 | 元协议层集成 | 4h | 双系统 | T017 | 自然语言协商成功 |
| T019 | 消息压缩 | 2h | 双系统 | T010 | Gzip压缩>50% |
| T020 | 端到端消息流测试 | 4h | 双系统 | T013-T016 | 消息流测试100%通过 |
| T021 | 能力协商测试 | 2h | 双系统 | T017,T018 | 能力发现测试通过 |

**并行组5**: T013, T014, T015, T016, T017 (可同时进行)
**并行组6**: T018, T019 (依赖T010,T017)
**并行组7**: T020, T021 (集成测试)

---

#### Phase 3: 业务集成 (Week 4)

| 任务ID | 任务名称 | 工时 | 负责人 | 依赖 | 验收标准 |
|--------|----------|------|--------|------|----------|
| T022 | 项目筛选算法 | 4h | Automaton | T020 | 准确率>85% |
| T023 | 投标生成器 | 4h | Automaton | T022 | 成功率>10% |
| T024 | 合同评估 | 3h | Automaton | T022 | 风险识别>90% |
| T025 | 需求解析引擎 | 4h | Nanobot | T020 | 需求解析成功 |
| T026 | 代码生成集成 | 4h | Nanobot | T025 | 代码编译成功>90% |
| T027 | 测试生成集成 | 4h | Nanobot | T026 | 覆盖率>80% |
| T028 | 预算追踪集成 | 2h | Automaton | T020 | 精度$0.01 |
| T029 | 客户沟通集成 | 3h | 双系统 | T020 | 多平台消息收发 |
| T030 | 接单流程测试 | 4h | Automaton | T022-T024 | 接单流程通过 |
| T031 | 开发流程测试 | 4h | Nanobot | T025-T027 | 开发流程通过 |
| T032 | 生存管理测试 | 2h | Automaton | T028 | 层级切换正确 |

**并行组8**: T022, T025, T028 (独立模块)
**并行组9**: T023, T024 (依赖T022)
**并行组10**: T026, T027 (依赖T025)
**并行组11**: T029 (依赖T020)
**并行组12**: T030, T031, T032 (集成测试)

---

#### Phase 4: 端到端测试 (Week 5)

| 任务ID | 任务名称 | 工时 | 负责人 | 依赖 | 验收标准 |
|--------|----------|------|--------|------|----------|
| T033 | E2E加密测试 | 3h | 双系统 | T030-T032 | 安全通信验证 |
| T034 | 协议协商测试 | 2h | 双系统 | T030-T032 | 协商流程正确 |
| T035 | 性能基准测试 | 3h | 双系统 | T030-T032 | P99延迟<5s |
| T036 | 压力测试 | 3h | 双系统 | T030-T032 | 10并发稳定 |
| T037 | 故障恢复测试 | 2h | 双系统 | T030-T032 | 恢复<5min |
| T038 | 安全渗透测试 | 4h | 双系统 | T030-T032 | 无高危漏洞 |
| T039 | 回归测试 | 3h | 双系统 | T030-T032 | 所有测试通过 |
| T040 | 集成测试报告 | 2h | 双系统 | T033-T039 | 报告完成 |

**并行组13**: T033-T038 (可同时进行)
**并行组14**: T039, T040 (汇总)

---

#### Phase 5: 缓冲与上线 (Week 6)

| 任务ID | 任务名称 | 工时 | 负责人 | 依赖 | 验收标准 |
|--------|----------|------|--------|------|----------|
| T041 | 缺陷修复 | 8h | 双系统 | T040 | 无P0/P1缺陷 |
| T042 | 文档完善 | 4h | 双系统 | T040 | 文档100%覆盖 |
| T043 | 生产环境部署 | 4h | 双系统 | T041 | 部署成功 |
| T044 | 首个真实项目试运行 | 12h | 双系统 | T043 | M5验收通过 |
| T045 | 上线检查 | 2h | 双系统 | T041 | 检查清单通过 |
| T046 | 文档审核 | 2h | 双系统 | T042 | 文档审核通过 |
| T047 | 部署验证 | 2h | 双系统 | T043 | 健康检查通过 |
| T048 | M5验收 | 4h | 双系统 | T044 | 完整项目交付 |

---

### 3.3 关键路径分析

```
关键路径 (Critical Path): 27天 (含类型互操作性缓冲)

T001(4h) -> T001b(2h) -> T010(4h) -> T010b(2h) -> T013(4h) -> T020(4h) -> T025(4h) -> T026(4h) -> T027(4h) -> T031(4h) -> T039(3h) -> T041(8h) -> T043(4h) -> T044(12h)

关键路径总工时: 59小时 (含4h类型互操作性任务)
并行任务总工时: ~130小时
类型互操作性缓冲: 8h (预留于Week 6)
预计团队规模: 2-3人
实际工期: 5周 + 1周缓冲 (含8h类型互操作性缓冲)
```

> **注意**: 关键路径增加 4h (T001b + T010b)，Week 6 缓冲期明确预留 8h 用于类型互操作性问题处理。

### 3.4 里程碑与检查点

| 里程碑 | 时间 | 交付物 | 通过条件 |
|--------|------|--------|----------|
| M1 | Week 2 | ANP通信层 | CP1通过 |
| M2 | Week 3 | 协议层实现 | CP2通过 |
| M3 | Week 4 | 业务集成 | CP3通过 |
| M4 | Week 5 | E2E测试 | 测试报告通过 |
| M5 | Week 6 | 上线运行 | 完成真实项目 |

| 检查点 | 时间 | 检查内容 | 失败动作 |
|--------|------|----------|----------|
| CP1 | Week 2结束 | ANP签名验证100%，加密通信>90% | 评估HTTP REST回退 |
| CP2 | Week 3结束 | 协议协商测试通过，Genesis Prompt可发送 | 简化元协议层 |
| CP3 | Week 4结束 | 业务集成测试>80%通过 | 延期1周或削减功能 |

---

## 4. 验收标准

### 4.1 功能验收标准

| 模块 | 验收项 | 通过条件 | 验证方法 |
|------|--------|----------|----------|
| BIZ | 项目筛选 | 准确率>85% | 50个标注案例验证 |
| BIZ | 投标生成 | 成功率>10% | 历史数据回测 |
| ANP | 消息加密 | 100%签名验证 | 自动化测试 |
| ANP | 消息延迟 | P99<5s | 性能测试 |
| DEV | 代码生成 | 编译成功>90% | 自动化测试 |
| DEV | 测试覆盖 | >80% | 覆盖率工具 |
| QA | 单元测试 | 自动生成并执行 | CI/CD |
| SUR | 层级切换 | 自动正确切换 | 状态机测试 |
| COM | 多平台消息 | 收发正常 | 集成测试 |

### 4.2 M5端到端验收标准

**必须满足以下全部条件**:

1. **项目代码部署成功**
   - 代码通过所有自动化测试
   - 代码通过安全扫描
   - 部署到生产环境成功

2. **客户验收通过**
   - 客户确认需求满足
   - 客户签署验收文档
   - 无未解决的P0/P1缺陷

3. **首笔付款到账**
   - 客户支付首笔款项
   - 支付金额符合合同
   - 支付记录可追溯

4. **无P0/P1缺陷**
   - 系统无崩溃
   - 数据无丢失
   - 安全无漏洞

### 4.3 代码质量验收

| 指标 | 目标 | 工具 |
|------|------|------|
| TypeScript类型安全 | 100% | tsc --noEmit |
| Python类型检查 | 100% | mypy --strict |
| 代码覆盖率 | >80% | vitest --coverage / pytest --cov |
| Lint检查 | 0错误 | eslint / ruff check |
| 安全扫描 | 0高危 | npm audit / pip-audit |

---

## 5. 风险缓解与降级策略

### 5.1 技术风险缓解

| 风险 | 缓解措施 | 降级方案 |
|------|----------|----------|
| AI模型API限流 | 多供应商备份 | 本地小模型降级 |
| 代码生成质量不稳定 | 多轮审查+测试 | 模板代码回退 |
| 平台API变更 | 抽象层隔离 | 人工介入 |
| 系统资源耗尽 | 资源监控 | 低资源模式 |

### 5.2 检查点降级策略

#### CP1失败 (ANP签名验证<90%)

**触发条件**: Week 2结束时ANP签名验证通过率低于90%

**降级方案**:
1. 回退到HTTP REST通信
2. 使用JWT替代DID签名
3. 保留TLS传输层加密
4. 延期3天实现降级方案

**影响**:
- 开发周期不变
- 扩展性受限
- 需要后续重构

#### CP2失败 (协议协商失败)

**触发条件**: Week 3结束时协议协商测试不通过

**降级方案**:
1. 简化元协议层
2. 使用固定协议版本
3. 禁用动态能力协商
4. 延期2天

**影响**:
- 协议灵活性降低
- 版本升级需手动

#### CP3失败 (业务集成<80%)

**触发条件**: Week 4结束时业务集成测试通过率低于80%

**降级方案**:
1. 延期1周继续开发
2. 削减P2功能
3. 聚焦核心流程

**影响**:
- 工期延长1周
- 功能范围缩小

### 5.3 应急预案

| 场景 | 应急措施 | 负责人 |
|------|----------|--------|
| 关键人员不可用 | 交叉培训，文档完善 | 项目负责人 |
| 第三方服务中断 | 多供应商备份 | 架构师 |
| 安全事件 | 立即隔离，密钥轮换 | 安全负责人 |
| 预算超支 | 功能优先级调整 | 项目负责人 |

---

## 附录

### A. 开发环境要求

#### Automaton
- Node.js >= 20.x
- pnpm >= 10.x
- TypeScript >= 5.9

#### Nanobot
- Python >= 3.11
- hatch 或 pip
- pytest >= 7.x

### B. 参考文档

- [需求分析文档](./requirements-analysis.md)
- [ANP协议规范](https://w3id.org/anp)
- [W3C DID标准](https://www.w3.org/TR/did-core/)
- [automaton/CLAUDE.md](../automaton/CLAUDE.md)
- [nanobot/CLAUDE.md](../nanobot/CLAUDE.md)

### C. 变更历史

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| 1.1.0 | 2026-02-27 | 根据Architect/Critic反馈修订: (1) P2原则更新-明确平台集成属于Nanobot职责 (2) BIZ模块改为双系统协作说明 (3) 添加2.2.4类型互操作性规范 (4) Phase 1增加T001b统一字段命名(2h)和T010b类型互操作测试(2h) (5) 关键路径增加8h类型互操作性缓冲 (6) 总工时调整为59h+8h缓冲 | Planner Agent |
| 1.0.0 | 2026-02-27 | 初始版本 | Planner Agent |

---

*文档结束*
