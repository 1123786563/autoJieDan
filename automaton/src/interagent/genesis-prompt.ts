/**
 * Genesis Prompt 类型定义
 * 定义 Automaton 与 Nanobot 之间的任务通信协议
 *
 * @module interagent/genesis-prompt
 * @version 1.0.0
 */

// ============================================================================
// 类型定义
// ============================================================================

/** Genesis Prompt 版本 */
export type GenesisPromptVersion = "1.0.0";

/** 任务优先级 */
export type GenesisPriority = "critical" | "high" | "normal" | "low" | "background";

/** 任务类型 */
export type GenesisTaskType =
  | "genesis"      // 创世任务 - 生成新功能
  | "analysis"     // 分析任务 - 代码/数据分析
  | "execution"    // 执行任务 - 运行操作
  | "report"       // 报告任务 - 生成报告
  | "maintenance"  // 维护任务 - 系统维护
  | "exploration"  // 探索任务 - 研究新技术
  | "custom";      // 自定义任务

/** 技术约束 */
export interface TechnicalConstraints {
  /** 允许的编程语言 */
  allowedLanguages?: string[];
  /** 禁止使用的库 */
  forbiddenLibraries?: string[];
  /** 必须使用的库 */
  requiredLibraries?: string[];
  /** 代码风格要求 */
  codeStyle?: {
    /** 缩进风格 */
    indentStyle?: "spaces" | "tabs";
    /** 缩进大小 */
    indentSize?: number;
    /** 行宽限制 */
    lineLength?: number;
    /** 其他规则 */
    rules?: Record<string, unknown>;
  };
  /** 测试覆盖率要求 */
  testCoverage?: {
    /** 最低覆盖率 */
    minimum?: number;
    /** 是否强制 */
    enforce?: boolean;
  };
  /** 性能约束 */
  performance?: {
    /** 最大执行时间（毫秒） */
    maxExecutionTimeMs?: number;
    /** 最大内存使用（MB） */
    maxMemoryMb?: number;
  };
  /** 安全约束 */
  security?: {
    /** 是否禁止网络访问 */
    noNetworkAccess?: boolean;
    /** 是否禁止文件系统访问 */
    noFileSystemAccess?: boolean;
    /** 允许的域名 */
    allowedDomains?: string[];
  };
  /** 自定义约束 */
  custom?: Record<string, unknown>;
}

/** 商务条款 */
export interface BusinessTerms {
  /** 任务预算 */
  budget?: {
    /** 总预算（美元） */
    total?: number;
    /** 单次操作预算 */
    perOperation?: number;
    /** 货币单位 */
    currency?: string;
  };
  /** 时间约束 */
  timeline?: {
    /** 截止时间 */
    deadline?: Date;
    /** 预期完成时间（毫秒） */
    estimatedDurationMs?: number;
    /** 是否允许延期 */
    allowExtension?: boolean;
  };
  /** 质量要求 */
  quality?: {
    /** 质量等级 */
    level?: "basic" | "standard" | "premium" | "enterprise";
    /** 需要代码审查 */
    requireCodeReview?: boolean;
    /** 需要安全审查 */
    requireSecurityReview?: boolean;
  };
  /** 交付要求 */
  delivery?: {
    /** 交付格式 */
    format?: "source" | "compiled" | "docker" | "package";
    /** 文档要求 */
    documentation?: "none" | "basic" | "full" | "comprehensive";
    /** 是否需要示例 */
    includeExamples?: boolean;
  };
  /** 优先级调整 */
  priorityBoost?: number;
  /** 自定义条款 */
  custom?: Record<string, unknown>;
}

/** 任务输入参数 */
export interface GenesisInput {
  /** 任务描述 */
  description: string;
  /** 详细规格 */
  specification?: string;
  /** 输入数据 */
  data?: Record<string, unknown>;
  /** 文件路径列表 */
  files?: string[];
  /** 环境变量 */
  environment?: Record<string, string>;
  /** 依赖项 */
  dependencies?: string[];
  /** 参考链接 */
  references?: Array<{
    type: "documentation" | "example" | "issue" | "pr";
    url: string;
    description?: string;
  }>;
}

/** 任务输出预期 */
export interface GenesisOutputExpectation {
  /** 预期输出类型 */
  type: "code" | "data" | "report" | "artifact" | "mixed";
  /** 输出格式 */
  format?: string;
  /** 文件输出预期 */
  files?: Array<{
    path: string;
    type: string;
    required: boolean;
  }>;
  /** 验证规则 */
  validation?: Array<{
    field: string;
    rule: string;
    message?: string;
  }>;
}

/** 回调配置 */
export interface GenesisCallback {
  /** 回调 URL */
  url: string;
  /** 回调方法 */
  method?: "POST" | "PUT" | "GET";
  /** 回调头 */
  headers?: Record<string, string>;
  /** 重试次数 */
  retries?: number;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
}

/** 执行上下文 */
export interface GenesisContext {
  /** 项目 ID */
  projectId?: string;
  /** 项目名称 */
  projectName?: string;
  /** 项目根路径 */
  projectRoot?: string;
  /** Git 仓库信息 */
  git?: {
    branch?: string;
    commit?: string;
    remote?: string;
  };
  /** 运行环境 */
  environment?: "development" | "staging" | "production";
  /** 父任务 ID */
  parentTaskId?: string;
  /** 关联任务 ID 列表 */
  relatedTasks?: string[];
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/** Genesis Prompt 完整结构 */
export interface GenesisPrompt {
  // ===== 必填字段 =====
  /** Prompt 版本 */
  version: GenesisPromptVersion;
  /** Prompt 唯一标识 */
  id: string;
  /** 任务类型 */
  taskType: GenesisTaskType;
  /** 优先级 */
  priority: GenesisPriority;
  /** 发送方 DID */
  sourceDid: string;
  /** 接收方 DID */
  targetDid: string;
  /** 创建时间 */
  createdAt: Date;
  /** 输入参数 */
  input: GenesisInput;

  // ===== 可选字段 =====
  /** 技术约束 */
  technical?: TechnicalConstraints;
  /** 商务条款 */
  business?: BusinessTerms;
  /** 输出预期 */
  outputExpectation?: GenesisOutputExpectation;
  /** 执行上下文 */
  context?: GenesisContext;
  /** 回调配置 */
  callback?: GenesisCallback;
  /** 是否需要确认 */
  requireConfirmation?: boolean;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  /** 重试配置 */
  retryConfig?: {
    maxRetries: number;
    backoffStrategy: "exponential" | "linear" | "fixed";
    initialDelayMs: number;
  };
  /** 标签 */
  tags?: string[];
  /** 备注 */
  notes?: string;
  /** 自定义扩展 */
  extensions?: Record<string, unknown>;
}

/** Genesis Prompt 响应 */
export interface GenesisPromptResponse {
  /** 响应 ID */
  id: string;
  /** 原始 Prompt ID */
  promptId: string;
  /** 响应状态 */
  status: "accepted" | "rejected" | "deferred" | "error";
  /** 响应时间 */
  respondedAt: Date;
  /** 接受详情（如果接受） */
  acceptance?: {
    /** 预计开始时间 */
    estimatedStartTime?: Date;
    /** 预计完成时间 */
    estimatedCompletionTime?: Date;
    /** 分配的资源 */
    allocatedResources?: string[];
  };
  /** 拒绝原因（如果拒绝） */
  rejection?: {
    reason: string;
    code?: string;
    suggestions?: string[];
  };
  /** 延期信息（如果延期） */
  deferral?: {
    reason: string;
    suggestedTime?: Date;
  };
  /** 错误信息（如果错误） */
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
}

/** Genesis Prompt 执行结果 */
export interface GenesisResult {
  /** 结果 ID */
  id: string;
  /** 原始 Prompt ID */
  promptId: string;
  /** 执行状态 */
  status: "success" | "partial" | "failed" | "cancelled";
  /** 完成时间 */
  completedAt: Date;
  /** 执行时长（毫秒） */
  durationMs: number;
  /** 输出结果 */
  output?: {
    /** 输出数据 */
    data?: Record<string, unknown>;
    /** 生成的文件 */
    files?: Array<{
      path: string;
      content?: string;
      size?: number;
      hash?: string;
    }>;
    /** 摘要 */
    summary?: string;
  };
  /** 错误信息（如果失败） */
  error?: {
    message: string;
    code?: string;
    phase?: "initialization" | "execution" | "validation" | "cleanup";
    recoverable: boolean;
  };
  /** 执行指标 */
  metrics?: {
    /** Token 使用量 */
    tokensUsed?: number;
    /** API 调用次数 */
    apiCalls?: number;
    /** 文件操作次数 */
    fileOperations?: number;
    /** 测试运行次数 */
    testRuns?: number;
    /** 测试通过率 */
    testPassRate?: number;
  };
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 Genesis Prompt
 */
export function createGenesisPrompt(options: {
  id: string;
  taskType: GenesisTaskType;
  priority?: GenesisPriority;
  sourceDid: string;
  targetDid: string;
  description: string;
  specification?: string;
  technical?: TechnicalConstraints;
  business?: BusinessTerms;
  context?: GenesisContext;
}): GenesisPrompt {
  return {
    version: "1.0.0",
    id: options.id,
    taskType: options.taskType,
    priority: options.priority || "normal",
    sourceDid: options.sourceDid,
    targetDid: options.targetDid,
    createdAt: new Date(),
    input: {
      description: options.description,
      specification: options.specification,
    },
    technical: options.technical,
    business: options.business,
    context: options.context,
  };
}

/**
 * 创建接受响应
 */
export function createAcceptanceResponse(
  promptId: string,
  options: {
    estimatedStartTime?: Date;
    estimatedCompletionTime?: Date;
    allocatedResources?: string[];
  } = {}
): GenesisPromptResponse {
  return {
    id: `resp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    promptId,
    status: "accepted",
    respondedAt: new Date(),
    acceptance: {
      estimatedStartTime: options.estimatedStartTime,
      estimatedCompletionTime: options.estimatedCompletionTime,
      allocatedResources: options.allocatedResources,
    },
  };
}

/**
 * 创建拒绝响应
 */
export function createRejectionResponse(
  promptId: string,
  reason: string,
  options: {
    code?: string;
    suggestions?: string[];
  } = {}
): GenesisPromptResponse {
  return {
    id: `resp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    promptId,
    status: "rejected",
    respondedAt: new Date(),
    rejection: {
      reason,
      code: options.code,
      suggestions: options.suggestions,
    },
  };
}

/**
 * 创建延期响应
 */
export function createDeferralResponse(
  promptId: string,
  reason: string,
  suggestedTime?: Date
): GenesisPromptResponse {
  return {
    id: `resp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    promptId,
    status: "deferred",
    respondedAt: new Date(),
    deferral: {
      reason,
      suggestedTime,
    },
  };
}

/**
 * 创建成功结果
 */
export function createSuccessResult(
  promptId: string,
  output: GenesisResult["output"],
  metrics?: GenesisResult["metrics"]
): GenesisResult {
  const now = new Date();
  return {
    id: `result-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    promptId,
    status: "success",
    completedAt: now,
    durationMs: 0, // 调用方需要设置
    output,
    metrics,
  };
}

/**
 * 创建失败结果
 */
export function createFailureResult(
  promptId: string,
  error: {
    message: string;
    code?: string;
    phase?: "initialization" | "execution" | "validation" | "cleanup";
    recoverable?: boolean;
  },
  durationMs: number = 0
): GenesisResult {
  return {
    id: `result-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    promptId,
    status: "failed",
    completedAt: new Date(),
    durationMs,
    error: {
      message: error.message,
      code: error.code,
      phase: error.phase,
      recoverable: error.recoverable ?? false,
    },
  };
}

// ============================================================================
// 验证函数
// ============================================================================

/** 验证错误 */
export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

/**
 * 验证 Genesis Prompt
 */
export function validateGenesisPrompt(prompt: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!prompt || typeof prompt !== "object") {
    errors.push({ field: "root", message: "Prompt must be an object" });
    return errors;
  }

  const p = prompt as Partial<GenesisPrompt>;

  // 必填字段验证
  if (!p.version) {
    errors.push({ field: "version", message: "Version is required" });
  }
  if (!p.id) {
    errors.push({ field: "id", message: "ID is required" });
  }
  if (!p.taskType) {
    errors.push({ field: "taskType", message: "Task type is required" });
  }
  if (!p.priority) {
    errors.push({ field: "priority", message: "Priority is required" });
  }
  if (!p.sourceDid) {
    errors.push({ field: "sourceDid", message: "Source DID is required" });
  }
  if (!p.targetDid) {
    errors.push({ field: "targetDid", message: "Target DID is required" });
  }
  if (!p.createdAt) {
    errors.push({ field: "createdAt", message: "Created at is required" });
  }
  if (!p.input) {
    errors.push({ field: "input", message: "Input is required" });
  }

  // 输入验证
  if (p.input && !p.input.description) {
    errors.push({ field: "input.description", message: "Input description is required" });
  }

  // 类型验证
  const validTaskTypes: GenesisTaskType[] = [
    "genesis", "analysis", "execution", "report", "maintenance", "exploration", "custom"
  ];
  if (p.taskType && !validTaskTypes.includes(p.taskType)) {
    errors.push({ field: "taskType", message: `Invalid task type: ${p.taskType}` });
  }

  const validPriorities: GenesisPriority[] = ["critical", "high", "normal", "low", "background"];
  if (p.priority && !validPriorities.includes(p.priority)) {
    errors.push({ field: "priority", message: `Invalid priority: ${p.priority}` });
  }

  // DID 格式验证
  if (p.sourceDid && !p.sourceDid.startsWith("did:")) {
    errors.push({ field: "sourceDid", message: "Invalid DID format" });
  }
  if (p.targetDid && !p.targetDid.startsWith("did:")) {
    errors.push({ field: "targetDid", message: "Invalid DID format" });
  }

  // 预算验证
  if (p.business?.budget?.total !== undefined && p.business.budget.total < 0) {
    errors.push({ field: "business.budget.total", message: "Budget cannot be negative" });
  }

  // 超时验证
  if (p.timeoutMs !== undefined && p.timeoutMs <= 0) {
    errors.push({ field: "timeoutMs", message: "Timeout must be positive" });
  }

  // 测试覆盖率验证
  const coverage = p.technical?.testCoverage?.minimum;
  if (coverage !== undefined && (coverage < 0 || coverage > 100)) {
    errors.push({ field: "technical.testCoverage.minimum", message: "Coverage must be between 0 and 100" });
  }

  return errors;
}

/**
 * 检查 Prompt 是否有效
 */
export function isValidGenesisPrompt(prompt: unknown): boolean {
  return validateGenesisPrompt(prompt).length === 0;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 序列化 Genesis Prompt
 */
export function serializeGenesisPrompt(prompt: GenesisPrompt): string {
  return JSON.stringify(prompt, (key, value) => {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  }, 2);
}

/**
 * 反序列化 Genesis Prompt
 */
export function deserializeGenesisPrompt(json: string): GenesisPrompt {
  const parsed = JSON.parse(json);
  return {
    ...parsed,
    createdAt: new Date(parsed.createdAt),
  };
}

/**
 * 格式化优先级
 */
export function formatPriority(priority: GenesisPriority): string {
  const priorityMap: Record<GenesisPriority, string> = {
    critical: "紧急",
    high: "高",
    normal: "普通",
    low: "低",
    background: "后台",
  };
  return priorityMap[priority] || priority;
}

/**
 * 格式化任务类型
 */
export function formatTaskType(taskType: GenesisTaskType): string {
  const typeMap: Record<GenesisTaskType, string> = {
    genesis: "创世",
    analysis: "分析",
    execution: "执行",
    report: "报告",
    maintenance: "维护",
    exploration: "探索",
    custom: "自定义",
  };
  return typeMap[taskType] || taskType;
}

/**
 * 估算任务复杂度
 */
export function estimateComplexity(prompt: GenesisPrompt): "simple" | "medium" | "complex" | "very_complex" {
  let score = 0;

  // 基于任务类型
  const typeScores: Record<GenesisTaskType, number> = {
    genesis: 3,
    analysis: 2,
    execution: 2,
    report: 1,
    maintenance: 2,
    exploration: 3,
    custom: 2,
  };
  score += typeScores[prompt.taskType] || 2;

  // 基于约束
  if (prompt.technical) {
    if (prompt.technical.forbiddenLibraries?.length) score += 1;
    if (prompt.technical.requiredLibraries?.length) score += 1;
    if (prompt.technical.security?.noNetworkAccess) score += 1;
    if (prompt.technical.testCoverage?.enforce) score += 1;
  }

  // 基于商务条款
  if (prompt.business) {
    if (prompt.business.quality?.requireCodeReview) score += 1;
    if (prompt.business.quality?.requireSecurityReview) score += 1;
    if (prompt.business.delivery?.documentation === "comprehensive") score += 1;
  }

  // 基于输出预期
  if (prompt.outputExpectation?.files?.length) {
    score += Math.min(prompt.outputExpectation.files.length, 3);
  }

  if (score <= 3) return "simple";
  if (score <= 6) return "medium";
  if (score <= 9) return "complex";
  return "very_complex";
}

/**
 * 获取优先级数值（用于排序）
 */
export function getPriorityValue(priority: GenesisPriority): number {
  const values: Record<GenesisPriority, number> = {
    critical: 5,
    high: 4,
    normal: 3,
    low: 2,
    background: 1,
  };
  return values[priority] || 3;
}
