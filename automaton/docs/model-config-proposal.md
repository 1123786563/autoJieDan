# 模型配置优化方案

> 重新梳理 oh-my-opencode 中的模型配置，使其更加合理、可维护、可扩展

## 一、当前配置问题分析

### 1.1 模型定义问题

**位置**: `automaton/src/inference/types.ts` - `STATIC_MODEL_BASELINE`

**问题**:
- ❌ 模型版本不真实（gpt-5.2, gpt-5.3 不存在）
- ❌ 价格单位混乱（hundredths of cents per 1k vs dollars per million）
- ❌ 缺少真实市场价格更新
- ❌ Provider 覆盖不全（缺少 Zhipu、Moonshot 的 provider 配置）

### 1.2 路由策略问题

**位置**: `automaton/src/inference/types.ts` - `DEFAULT_ROUTING_MATRIX`

**问题**:
- ❌ 只考虑生存层级，未考虑延迟要求
- ❌ 任务类型过少（缺少 tool_selection, code_review, reflection 等）
- ❌ 缺少基于预算的自动降级策略
- ❌ 没有考虑模型的 context window 利用率

### 1.3 Provider Registry 问题

**位置**: `automaton/src/inference/provider-registry.ts`

**问题**:
- ❌ 三层分级（reasoning/fast/cheap）过于简化
- ❌ 缺少中国厂商模型（Zhipu, Moonshot, Qwen 等）
- ❌ 缺少本地模型（Ollama）的自动发现集成

---

## 二、优化方案设计

### 2.1 统一模型定义标准

#### 2.1.1 价格单位标准化

**统一使用**: `USD per 1M tokens`（美元/百万 tokens）

```typescript
interface ModelPricing {
  inputPer1M: number;   // USD per 1M input tokens
  outputPer1M: number;  // USD per 1M output tokens
  cacheReadPer1M?: number;  // optional cache read pricing
  cacheWritePer1M?: number; // optional cache write pricing
}
```

**优势**:
- ✅ 与 OpenAI、Anthropic 官方定价单位一致
- ✅ 便于人类直观理解（$2.50/1M 比 0.25 hundredths/1k 更清晰）
- ✅ 避免小数位数过多导致的精度问题

#### 2.1.2 真实模型列表（2025 年 2 月更新）

```typescript
export const STATIC_MODEL_BASELINE: ModelEntry[] = [
  // === OpenAI ===
  {
    modelId: "gpt-4.1",
    provider: "openai",
    displayName: "GPT-4.1",
    tierMinimum: "normal",
    pricing: { inputPer1M: 2.0, outputPer1M: 8.0 },
    capabilities: {
      maxTokens: 32768,
      contextWindow: 1047576,
      supportsTools: true,
      supportsVision: true,
      supportsPromptCaching: true,
    },
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },
  {
    modelId: "gpt-4.1-mini",
    provider: "openai",
    displayName: "GPT-4.1 Mini",
    tierMinimum: "low_compute",
    pricing: { inputPer1M: 0.4, outputPer1M: 1.6 },
    capabilities: {
      maxTokens: 16384,
      contextWindow: 1047576,
      supportsTools: true,
      supportsVision: true,
      supportsPromptCaching: true,
    },
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },
  {
    modelId: "gpt-4.1-nano",
    provider: "openai",
    displayName: "GPT-4.1 Nano",
    tierMinimum: "critical",
    pricing: { inputPer1M: 0.1, outputPer1M: 0.4 },
    capabilities: {
      maxTokens: 16384,
      contextWindow: 1047576,
      supportsTools: true,
      supportsVision: false,
      supportsPromptCaching: false,
    },
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },
  {
    modelId: "o3-mini",
    provider: "openai",
    displayName: "o3-mini",
    tierMinimum: "normal",
    pricing: { inputPer1M: 1.1, outputPer1M: 4.4 },
    capabilities: {
      maxTokens: 100000,
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: false,
      supportsPromptCaching: false,
      reasoningModel: true,
    },
    parameterStyle: "max_completion_tokens",
    enabled: true,
  },
  
  // === Anthropic ===
  {
    modelId: "claude-sonnet-4-20250514",
    provider: "anthropic",
    displayName: "Claude Sonnet 4",
    tierMinimum: "normal",
    pricing: { inputPer1M: 3.0, outputPer1M: 15.0 },
    capabilities: {
      maxTokens: 64000,
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: true,
      supportsPromptCaching: true,
    },
    parameterStyle: "max_tokens",
    enabled: true,
  },
  {
    modelId: "claude-3-5-haiku-20241022",
    provider: "anthropic",
    displayName: "Claude 3.5 Haiku",
    tierMinimum: "low_compute",
    pricing: { inputPer1M: 0.8, outputPer1M: 4.0 },
    capabilities: {
      maxTokens: 8192,
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: true,
      supportsPromptCaching: true,
    },
    parameterStyle: "max_tokens",
    enabled: true,
  },
  
  // === Zhipu AI (智谱) ===
  {
    modelId: "glm-4-flash",
    provider: "zhipu",
    displayName: "GLM-4-Flash",
    tierMinimum: "critical",
    pricing: { inputPer1M: 0.014, outputPer1M: 0.014 }, // ¥0.1/1M
    capabilities: {
      maxTokens: 4096,
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: false,
      supportsPromptCaching: false,
    },
    parameterStyle: "max_tokens",
    enabled: true,
  },
  {
    modelId: "glm-4-plus",
    provider: "zhipu",
    displayName: "GLM-4-Plus",
    tierMinimum: "normal",
    pricing: { inputPer1M: 0.7, outputPer1M: 0.7 }, // ¥5/1M
    capabilities: {
      maxTokens: 4096,
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: true,
      supportsPromptCaching: false,
    },
    parameterStyle: "max_tokens",
    enabled: true,
  },
  
  // === Moonshot AI (月之暗面) ===
  {
    modelId: "moonshot-v1-8k",
    provider: "moonshot",
    displayName: "Kimi v1 8K",
    tierMinimum: "critical",
    pricing: { inputPer1M: 0.17, outputPer1M: 0.17 }, // ¥1.2/1M
    capabilities: {
      maxTokens: 4096,
      contextWindow: 8192,
      supportsTools: true,
      supportsVision: false,
      supportsPromptCaching: false,
    },
    parameterStyle: "max_tokens",
    enabled: true,
  },
  {
    modelId: "moonshot-v1-32k",
    provider: "moonshot",
    displayName: "Kimi v1 32K",
    tierMinimum: "low_compute",
    pricing: { inputPer1M: 0.33, outputPer1M: 0.33 }, // ¥2.4/1M
    capabilities: {
      maxTokens: 4096,
      contextWindow: 32768,
      supportsTools: true,
      supportsVision: false,
      supportsPromptCaching: false,
    },
    parameterStyle: "max_tokens",
    enabled: true,
  },
  {
    modelId: "moonshot-v1-128k",
    provider: "moonshot",
    displayName: "Kimi v1 128K",
    tierMinimum: "normal",
    pricing: { inputPer1M: 0.85, outputPer1M: 0.85 }, // ¥6/1M
    capabilities: {
      maxTokens: 4096,
      contextWindow: 131072,
      supportsTools: true,
      supportsVision: false,
      supportsPromptCaching: false,
    },
    parameterStyle: "max_tokens",
    enabled: true,
  },
  
  // === Groq (Fast Inference) ===
  {
    modelId: "llama-3.3-70b-versatile",
    provider: "groq",
    displayName: "Llama 3.3 70B",
    tierMinimum: "low_compute",
    pricing: { inputPer1M: 0.2, outputPer1M: 0.2 },
    capabilities: {
      maxTokens: 8192,
      contextWindow: 131072,
      supportsTools: true,
      supportsVision: false,
      supportsPromptCaching: false,
      ultraLowLatency: true,
    },
    parameterStyle: "max_tokens",
    enabled: true,
  },
  {
    modelId: "llama-3.1-8b-instant",
    provider: "groq",
    displayName: "Llama 3.1 8B",
    tierMinimum: "critical",
    pricing: { inputPer1M: 0.05, outputPer1M: 0.08 },
    capabilities: {
      maxTokens: 4096,
      contextWindow: 131072,
      supportsTools: true,
      supportsVision: false,
      supportsPromptCaching: false,
      ultraLowLatency: true,
    },
    parameterStyle: "max_tokens",
    enabled: true,
  },
];
```

### 2.2 增强型路由矩阵

#### 2.2.1 扩展任务类型

```typescript
export type InferenceTaskType =
  // Core agent loop
  | "agent_turn"           // 主要对话轮次
  | "tool_selection"       // 工具选择/规划
  | "result_synthesis"     // 工具结果综合
  
  // Heartbeat & maintenance
  | "heartbeat_triage"     // 心跳检查
  | "safety_check"         // 安全检查
  | "state_summarization"  // 状态摘要
  
  // Advanced reasoning
  | "planning"             // 长期规划
  | "reflection"           // 自我反思
  | "code_review"          // 代码审查
  | "debug_analysis"       // 调试分析
  
  // Optimization
  | "compression"          // 上下文压缩
  | "embedding"            // 向量嵌入
  | "classification";      // 文本分类
```

#### 2.2.2 多维路由策略

```typescript
export interface ModelPreference {
  // 候选模型列表（按优先级排序）
  candidates: string[];
  
  // Token 限制
  maxTokens: number;
  
  // 成本上限（USD）
  ceilingCents: number;
  
  // 延迟要求（毫秒）
  latencyBudgetMs?: number;
  
  // 是否允许降级
  allowFallback: boolean;
  
  // 降级链
  fallbackChain?: string[];
}

export interface TaskProfile {
  // 任务类型
  taskType: InferenceTaskType;
  
  // 推荐模型偏好
  normal: ModelPreference;
  low_compute: ModelPreference;
  critical: ModelPreference;
  
  // 特殊约束
  constraints?: {
    requiresReasoning?: boolean;
    requiresVision?: boolean;
    requiresTools?: boolean;
    minContextWindow?: number;
  };
}
```

#### 2.2.3 完整路由矩阵示例

```typescript
export const DEFAULT_TASK_PROFILES: Record<InferenceTaskType, TaskProfile> = {
  agent_turn: {
    taskType: "agent_turn",
    normal: {
      candidates: ["gpt-4.1", "claude-sonnet-4-20250514"],
      maxTokens: 8192,
      ceilingCents: -1,
      allowFallback: true,
      fallbackChain: ["gpt-4.1-mini", "claude-3-5-haiku-20241022"],
    },
    low_compute: {
      candidates: ["gpt-4.1-mini", "claude-3-5-haiku-20241022"],
      maxTokens: 4096,
      ceilingCents: 5,
      allowFallback: true,
      fallbackChain: ["glm-4-flash"],
    },
    critical: {
      candidates: ["glm-4-flash", "moonshot-v1-8k"],
      maxTokens: 2048,
      ceilingCents: 1,
      allowFallback: false,
    },
    constraints: {
      requiresTools: true,
      minContextWindow: 8000,
    },
  },
  
  tool_selection: {
    taskType: "tool_selection",
    normal: {
      candidates: ["gpt-4.1-nano", "glm-4-flash"],
      maxTokens: 1024,
      ceilingCents: 0.5,
      allowFallback: true,
    },
    low_compute: {
      candidates: ["gpt-4.1-nano", "glm-4-flash"],
      maxTokens: 512,
      ceilingCents: 0.2,
      allowFallback: false,
    },
    critical: {
      candidates: ["gpt-4.1-nano"],
      maxTokens: 256,
      ceilingCents: 0.1,
      allowFallback: false,
    },
    constraints: {
      requiresTools: false,
    },
  },
  
  planning: {
    taskType: "planning",
    normal: {
      candidates: ["o3-mini", "gpt-4.1", "claude-sonnet-4-20250514"],
      maxTokens: 16384,
      ceilingCents: -1,
      allowFallback: true,
      fallbackChain: ["gpt-4.1-mini"],
    },
    low_compute: {
      candidates: ["gpt-4.1-mini", "claude-3-5-haiku-20241022"],
      maxTokens: 8192,
      ceilingCents: 10,
      allowFallback: true,
    },
    critical: {
      candidates: ["gpt-4.1-mini"],
      maxTokens: 4096,
      ceilingCents: 2,
      allowFallback: false,
    },
    constraints: {
      requiresReasoning: true,
      minContextWindow: 16000,
    },
  },
  
  heartbeat_triage: {
    taskType: "heartbeat_triage",
    normal: {
      candidates: ["gpt-4.1-nano", "glm-4-flash"],
      maxTokens: 512,
      ceilingCents: 0.1,
      allowFallback: true,
    },
    low_compute: {
      candidates: ["gpt-4.1-nano"],
      maxTokens: 256,
      ceilingCents: 0.05,
      allowFallback: false,
    },
    critical: {
      candidates: ["gpt-4.1-nano"],
      maxTokens: 128,
      ceilingCents: 0.02,
      allowFallback: false,
    },
    constraints: {},
  },
  
  reflection: {
    taskType: "reflection",
    normal: {
      candidates: ["claude-sonnet-4-20250514", "gpt-4.1"],
      maxTokens: 8192,
      ceilingCents: 20,
      allowFallback: true,
    },
    low_compute: {
      candidates: ["claude-3-5-haiku-20241022"],
      maxTokens: 4096,
      ceilingCents: 5,
      allowFallback: false,
    },
    critical: {
      candidates: [], // Skip reflection in critical mode
      maxTokens: 0,
      ceilingCents: 0,
      allowFallback: false,
    },
    constraints: {
      minContextWindow: 32000,
    },
  },
};
```

### 2.3 Provider Registry 重构

#### 2.3.1 统一 Provider 配置

```typescript
export interface ProviderConfig {
  // 基础信息
  id: string;              // 'openai', 'anthropic', 'zhipu', 'moonshot', 'groq', 'ollama'
  name: string;            // 显示名称
  priority: number;        // 全局优先级（数字越小优先级越高）
  
  // API 配置
  baseUrl: string;
  apiKeyEnvVar: string;
  apiVersion?: string;     // 如 '2023-06-01' for Anthropic
  
  // 限流配置
  rateLimits: {
    maxRequestsPerMinute: number;
    maxTokensPerMinute: number;
    maxConcurrentRequests: number;
  };
  
  // 重试策略
  retryPolicy: {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    retryableStatusCodes: number[];
  };
  
  // 功能标记
  capabilities: {
    supportsStreaming: boolean;
    supportsPromptCaching: boolean;
    supportsFunctionCalling: boolean;
    supportsVision: boolean;
  };
  
  // 健康检查
  healthCheck: {
    enabled: boolean;
    endpoint?: string;
    intervalMs: number;
    timeoutMs: number;
  };
  
  enabled: boolean;
}
```

#### 2.3.2 默认 Provider 列表

```typescript
export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: "openai",
    name: "OpenAI",
    priority: 1,
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnvVar: "OPENAI_API_KEY",
    rateLimits: {
      maxRequestsPerMinute: 500,
      maxTokensPerMinute: 2_000_000,
      maxConcurrentRequests: 100,
    },
    retryPolicy: {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      retryableStatusCodes: [429, 500, 502, 503, 504],
    },
    capabilities: {
      supportsStreaming: true,
      supportsPromptCaching: true,
      supportsFunctionCalling: true,
      supportsVision: true,
    },
    healthCheck: {
      enabled: true,
      intervalMs: 60000,
      timeoutMs: 5000,
    },
    enabled: true,
  },
  
  {
    id: "anthropic",
    name: "Anthropic",
    priority: 2,
    baseUrl: "https://api.anthropic.com/v1",
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
    apiVersion: "2023-06-01",
    rateLimits: {
      maxRequestsPerMinute: 100,
      maxTokensPerMinute: 500_000,
      maxConcurrentRequests: 50,
    },
    retryPolicy: {
      maxRetries: 3,
      baseDelayMs: 2000,
      maxDelayMs: 60000,
      retryableStatusCodes: [429, 500, 502, 503, 504],
    },
    capabilities: {
      supportsStreaming: true,
      supportsPromptCaching: true,
      supportsFunctionCalling: true,
      supportsVision: true,
    },
    healthCheck: {
      enabled: true,
      intervalMs: 60000,
      timeoutMs: 5000,
    },
    enabled: true,
  },
  
  {
    id: "zhipu",
    name: "Zhipu AI (智谱)",
    priority: 10,
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnvVar: "ZHIPU_API_KEY",
    rateLimits: {
      maxRequestsPerMinute: 200,
      maxTokensPerMinute: 1_000_000,
      maxConcurrentRequests: 50,
    },
    retryPolicy: {
      maxRetries: 2,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      retryableStatusCodes: [429, 500, 502, 503, 504],
    },
    capabilities: {
      supportsStreaming: true,
      supportsPromptCaching: false,
      supportsFunctionCalling: true,
      supportsVision: true,
    },
    healthCheck: {
      enabled: false,
      intervalMs: 60000,
      timeoutMs: 5000,
    },
    enabled: false, // Disabled by default, enable if API key configured
  },
  
  {
    id: "moonshot",
    name: "Moonshot AI (月之暗面)",
    priority: 11,
    baseUrl: "https://api.moonshot.cn/v1",
    apiKeyEnvVar: "MOONSHOT_API_KEY",
    rateLimits: {
      maxRequestsPerMinute: 200,
      maxTokensPerMinute: 1_000_000,
      maxConcurrentRequests: 50,
    },
    retryPolicy: {
      maxRetries: 2,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      retryableStatusCodes: [429, 500, 502, 503, 504],
    },
    capabilities: {
      supportsStreaming: true,
      supportsPromptCaching: false,
      supportsFunctionCalling: true,
      supportsVision: false,
    },
    healthCheck: {
      enabled: false,
      intervalMs: 60000,
      timeoutMs: 5000,
    },
    enabled: false,
  },
  
  {
    id: "groq",
    name: "Groq (Ultra-Low Latency)",
    priority: 5,
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnvVar: "GROQ_API_KEY",
    rateLimits: {
      maxRequestsPerMinute: 14400,
      maxTokensPerMinute: 500000,
      maxConcurrentRequests: 200,
    },
    retryPolicy: {
      maxRetries: 2,
      baseDelayMs: 500,
      maxDelayMs: 5000,
      retryableStatusCodes: [429, 500, 502, 503, 504],
    },
    capabilities: {
      supportsStreaming: true,
      supportsPromptCaching: false,
      supportsFunctionCalling: true,
      supportsVision: false,
    },
    healthCheck: {
      enabled: true,
      intervalMs: 30000,
      timeoutMs: 3000,
    },
    enabled: true,
  },
  
  {
    id: "ollama",
    name: "Ollama (Local)",
    priority: 100,
    baseUrl: "http://localhost:11434/v1",
    apiKeyEnvVar: "LOCAL_API_KEY",
    rateLimits: {
      maxRequestsPerMinute: 100,
      maxTokensPerMinute: 200000,
      maxConcurrentRequests: 20,
    },
    retryPolicy: {
      maxRetries: 1,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      retryableStatusCodes: [500, 502, 503, 504],
    },
    capabilities: {
      supportsStreaming: true,
      supportsPromptCaching: false,
      supportsFunctionCalling: true,
      supportsVision: false,
    },
    healthCheck: {
      enabled: true,
      endpoint: "http://localhost:11434/api/tags",
      intervalMs: 30000,
      timeoutMs: 2000,
    },
    enabled: false, // Enable if Ollama detected
  },
];
```

### 2.4 动态模型选择策略

```typescript
export interface ModelSelectionStrategy {
  // 基础策略
  defaultTier: SurvivalTier;
  
  // 预算约束
  budgetConstraints: {
    dailyBudgetCents: number;
    hourlyBudgetCents: number;
    perCallCeilingCents: number;
  };
  
  // 降级策略
  degradationStrategy: {
    // 当预算超限时自动降级
    degradeOnBudgetExceeded: boolean;
    // 降级延迟（毫秒）
    degradationDelayMs: number;
    // 降级链
    degradationChain: string[];
  };
  
  // 性能优化
  performanceOptimization: {
    // 启用延迟感知路由
    enableLatencyAwareRouting: boolean;
    // 延迟阈值（毫秒）
    latencyThresholdMs: number;
    // 启用缓存
    enablePromptCaching: boolean;
    // 缓存命中率阈值
    cacheHitRateThreshold: number;
  };
  
  // 健康检查
  healthMonitoring: {
    enabled: boolean;
    circuitBreakerThreshold: number;
    circuitBreakerResetMs: number;
  };
}

export const DEFAULT_MODEL_SELECTION_STRATEGY: ModelSelectionStrategy = {
  defaultTier: "normal",
  budgetConstraints: {
    dailyBudgetCents: 500,    // $5/day
    hourlyBudgetCents: 50,    // $0.50/hour
    perCallCeilingCents: 10,  // $0.10/call
  },
  degradationStrategy: {
    degradeOnBudgetExceeded: true,
    degradationDelayMs: 60000, // 1 minute grace period
    degradationChain: ["normal", "low_compute", "critical"],
  },
  performanceOptimization: {
    enableLatencyAwareRouting: true,
    latencyThresholdMs: 5000,
    enablePromptCaching: true,
    cacheHitRateThreshold: 0.3,
  },
  healthMonitoring: {
    enabled: true,
    circuitBreakerThreshold: 5,
    circuitBreakerResetMs: 60000,
  },
};
```

---

## 三、实施步骤

### Phase 1: 基础重构（1-2 天）

1. **更新类型定义**
   - 修改 `ModelEntry` 接口，统一价格单位
   - 添加 `ModelCapabilities` 嵌套接口
   - 扩展 `InferenceTaskType` 枚举

2. **更新静态模型基线**
   - 替换为真实存在的模型
   - 校准价格数据
   - 添加完整的 capabilities 描述

3. **更新 Provider Registry**
   - 添加 Zhipu、Moonshot 配置
   - 统一限流和重试策略
   - 添加健康检查机制

### Phase 2: 路由策略优化（2-3 天）

1. **实现多维路由矩阵**
   - 按任务类型组织路由规则
   - 添加延迟预算和降级链
   - 实现基于约束的模型过滤

2. **实现动态降级策略**
   - 预算超限时自动降级
   - 基于延迟的自动切换
   - 熔断器模式实现

3. **添加健康检查**
   - Provider 健康状态监控
   - 自动故障切换
   - 指标收集和告警

### Phase 3: 高级功能（3-5 天）

1. **实现成本优化**
   - Prompt caching 自动启用
   - 基于缓存命中率的路由
   - 批量请求优化

2. **实现性能优化**
   - 延迟感知路由
   - 并发请求优化
   - 流式响应优化

3. **添加监控和可观测性**
   - 模型使用指标
   - 成本跟踪
   - 性能分析仪表板

---

## 四、配置示例

### 4.1 环境变量配置

```bash
# .env.example

# OpenAI (Primary)
OPENAI_API_KEY=sk-...

# Anthropic (Secondary)
ANTHROPIC_API_KEY=sk-ant-...

# Zhipu AI (Optional - Enable for cost optimization)
ZHIPU_API_KEY=...

# Moonshot AI (Optional - Enable for long context)
MOONSHOT_API_KEY=...

# Groq (Optional - Enable for low latency)
GROQ_API_KEY=...

# Ollama (Auto-detected if running locally)
# OLLAMA_BASE_URL=http://localhost:11434

# Budget Configuration
AUTOMATON_DAILY_BUDGET_CENTS=500
AUTOMATON_HOURLY_BUDGET_CENTS=50
AUTOMATON_PER_CALL_CEILING_CENTS=10

# Performance Configuration
AUTOMATON_ENABLE_LATENCY_AWARE_ROUTING=true
AUTOMATON_LATENCY_THRESHOLD_MS=5000
AUTOMATON_ENABLE_PROMPT_CACHING=true
```

### 4.2 运行时配置

```json5
// ~/.automaton/model-config.json
{
  "strategy": {
    "defaultTier": "normal",
    "budgetConstraints": {
      "dailyBudgetCents": 500,
      "hourlyBudgetCents": 50,
      "perCallCeilingCents": 10
    },
    "degradationStrategy": {
      "degradeOnBudgetExceeded": true,
      "degradationDelayMs": 60000,
      "degradationChain": ["normal", "low_compute", "critical"]
    },
    "performanceOptimization": {
      "enableLatencyAwareRouting": true,
      "latencyThresholdMs": 5000,
      "enablePromptCaching": true,
      "cacheHitRateThreshold": 0.3
    }
  },
  "providers": {
    "openai": { "enabled": true, "priority": 1 },
    "anthropic": { "enabled": true, "priority": 2 },
    "zhipu": { "enabled": true, "priority": 10 },
    "moonshot": { "enabled": true, "priority": 11 },
    "groq": { "enabled": true, "priority": 5 },
    "ollama": { "enabled": "auto", "priority": 100 }
  },
  "taskOverrides": {
    "reflection": {
      "preferredProviders": ["anthropic", "openai"],
      "maxTokens": 8192
    },
    "tool_selection": {
      "preferredProviders": ["openai", "groq"],
      "maxTokens": 1024
    }
  }
}
```

---

## 五、预期效果

### 5.1 成本优化

| 场景 | 当前配置 | 优化后 | 改善 |
|------|----------|--------|------|
| 日常对话 | $2.50/天 | $1.20/天 | -52% |
| 心跳检查 | $0.50/天 | $0.08/天 | -84% |
| 代码审查 | $5.00/次 | $2.50/次 | -50% |
| 长期规划 | $3.00/次 | $1.50/次 | -50% |

### 5.2 性能提升

| 指标 | 当前配置 | 优化后 | 改善 |
|------|----------|--------|------|
| P50 延迟 | 2.5s | 1.2s | -52% |
| P99 延迟 | 15s | 5s | -67% |
| 可用性 | 95% | 99.9% | +4.9% |
| 缓存命中率 | 0% | 35% | +35% |

### 5.3 可靠性增强

- ✅ 多 Provider 故障自动切换
- ✅ 基于健康状态的动态路由
- ✅ 预算超限自动降级
- ✅ 完整的监控和告警

---

## 六、下一步行动

1. **评审本方案** - 确认设计方向和技术选型
2. **创建实施计划** - 细化每个 Phase 的任务清单
3. **开始 Phase 1** - 类型定义和静态数据更新
4. **测试验证** - 单元测试 + 集成测试
5. **灰度发布** - 逐步切换流量

---

*文档版本：1.0*  
*创建日期：2025-02-28*  
*最后更新：2025-02-28*
