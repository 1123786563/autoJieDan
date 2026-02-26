/**
 * 资源消耗追踪系统
 * 实现 Token 使用统计、成本计算和资源预测
 *
 * @module interagent/resource-tracker
 * @version 1.0.0
 */

import { EventEmitter } from "events";

// ============================================================================
// 类型定义
// ============================================================================

/** LLM 提供商定价配置 */
export interface LLMProviderPricing {
  /** 提供商标识 */
  provider: string;
  /** 模型名称 */
  model: string;
  /** 输入 Token 价格 (USD per 1M tokens) */
  inputPricePerMillion: number;
  /** 输出 Token 价格 (USD per 1M tokens) */
  outputPricePerMillion: number;
  /** 是否支持缓存 */
  supportsCaching: boolean;
  /** 缓存读取价格 (USD per 1M tokens) */
  cacheReadPricePerMillion?: number;
  /** 缓存写入价格 (USD per 1M tokens) */
  cacheWritePricePerMillion?: number;
}

/** Token 使用记录 */
export interface TokenUsageRecord {
  /** 记录 ID */
  id: string;
  /** 任务 ID */
  taskId: string;
  /** 提供商 */
  provider: string;
  /** 模型名称 */
  model: string;
  /** 输入 Token 数 */
  inputTokens: number;
  /** 输出 Token 数 */
  outputTokens: number;
  /** 缓存读取 Token 数 */
  cachedInputTokens?: number;
  /** 缓存写入 Token 数 */
  cachedWriteTokens?: number;
  /** 时间戳 */
  timestamp: Date;
  /** 请求 ID */
  requestId?: string;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/** API 调用记录 */
export interface ApiCallRecord {
  /** 记录 ID */
  id: string;
  /** 任务 ID */
  taskId: string;
  /** API 端点 */
  endpoint: string;
  /** 请求方法 */
  method: string;
  /** 响应状态码 */
  statusCode: number;
  /** 请求耗时 (ms) */
  durationMs: number;
  /** 时间戳 */
  timestamp: Date;
  /** 错误信息 */
  error?: string;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/** 资源消耗快照 */
export interface ResourceSnapshot {
  /** 快照时间 */
  timestamp: Date;
  /** 总 Token 使用 */
  totalTokens: number;
  /** 总输入 Token */
  totalInputTokens: number;
  /** 总输出 Token */
  totalOutputTokens: number;
  /** 总缓存读取 Token */
  totalCachedTokens: number;
  /** 总 API 调用次数 */
  totalApiCalls: number;
  /** 总成本 (USD) */
  totalCost: number;
  /** 平均 Token/请求 */
  avgTokensPerRequest: number;
  /** 平均成本/请求 */
  avgCostPerRequest: number;
  /** 内存使用 (MB) */
  memoryUsageMb: number;
  /** CPU 使用率 (%) */
  cpuPercent: number;
}

/** 资源预算 */
export interface ResourceBudget {
  /** 预算 ID */
  id: string;
  /** 任务 ID (可选，全局预算时为空) */
  taskId?: string;
  /** Token 预算 */
  tokenBudget: number;
  /** 成本预算 (USD) */
  costBudget: number;
  /** API 调用预算 */
  apiCallBudget: number;
  /** 开始时间 */
  startTime: Date;
  /** 结束时间 (可选) */
  endTime?: Date;
  /** 是否硬限制 */
  hardLimit: boolean;
  /** 警告阈值 (%) */
  warningThreshold: number;
  /** 临界阈值 (%) */
  criticalThreshold: number;
}

/** 预算状态 */
export interface BudgetStatus {
  /** 预算 ID */
  budgetId: string;
  /** 已使用 Token */
  tokensUsed: number;
  /** 已使用成本 */
  costUsed: number;
  /** 已使用 API 调用 */
  apiCallsUsed: number;
  /** Token 使用率 (%) */
  tokenUsagePercent: number;
  /** 成本使用率 (%) */
  costUsagePercent: number;
  /** API 调用使用率 (%) */
  apiCallUsagePercent: number;
  /** 状态: normal | warning | critical | exceeded */
  status: "normal" | "warning" | "critical" | "exceeded";
  /** 剩余 Token */
  remainingTokens: number;
  /** 剩余成本 */
  remainingCost: number;
  /** 预计耗尽时间 (ms) */
  estimatedExhaustionMs?: number;
}

/** 资源预测结果 */
export interface ResourcePrediction {
  /** 任务 ID */
  taskId: string;
  /** 预测时间 */
  predictionTime: Date;
  /** 预计总 Token */
  predictedTotalTokens: number;
  /** 预计总成本 */
  predictedTotalCost: number;
  /** 预计总 API 调用 */
  predictedTotalApiCalls: number;
  /** 预计剩余时间 (ms) */
  predictedRemainingMs: number;
  /** 预测置信度 (0-1) */
  confidence: number;
  /** 基于的历史数据点数 */
  dataPointsUsed: number;
  /** 预测方法 */
  method: "linear" | "exponential" | "average";
}

/** 资源追踪器配置 */
export interface ResourceTrackerConfig {
  /** 最大历史记录数 */
  maxHistoryEntries: number;
  /** 快照间隔 (ms) */
  snapshotIntervalMs: number;
  /** 预测窗口大小 (历史数据点数) */
  predictionWindowSize: number;
  /** 是否自动记录系统资源 */
  trackSystemResources: boolean;
  /** 默认定价配置 */
  defaultPricing: LLMProviderPricing[];
}

/** 资源事件 */
export interface ResourceEvent {
  /** 事件类型 */
  type: "token_used" | "api_called" | "budget_warning" | "budget_exceeded" | "snapshot" | "prediction";
  /** 时间戳 */
  timestamp: Date;
  /** 任务 ID */
  taskId?: string;
  /** 数据 */
  data: unknown;
}

// ============================================================================
// 默认定价配置
// ============================================================================

const DEFAULT_PRICING: LLMProviderPricing[] = [
  {
    provider: "openai",
    model: "gpt-4o",
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
    supportsCaching: true,
    cacheReadPricePerMillion: 1.25,
    cacheWritePricePerMillion: 3.125,
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    supportsCaching: true,
    cacheReadPricePerMillion: 0.075,
    cacheWritePricePerMillion: 0.1875,
  },
  {
    provider: "anthropic",
    model: "claude-3-5-sonnet",
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    supportsCaching: true,
    cacheReadPricePerMillion: 0.3,
    cacheWritePricePerMillion: 3.75,
  },
  {
    provider: "anthropic",
    model: "claude-3-haiku",
    inputPricePerMillion: 0.25,
    outputPricePerMillion: 1.25,
    supportsCaching: true,
    cacheReadPricePerMillion: 0.03,
    cacheWritePricePerMillion: 0.3,
  },
  {
    provider: "openai",
    model: "o1",
    inputPricePerMillion: 15.0,
    outputPricePerMillion: 60.0,
    supportsCaching: false,
  },
  {
    provider: "openai",
    model: "o1-mini",
    inputPricePerMillion: 1.5,
    outputPricePerMillion: 6.0,
    supportsCaching: false,
  },
];

const DEFAULT_CONFIG: ResourceTrackerConfig = {
  maxHistoryEntries: 1000,
  snapshotIntervalMs: 60000, // 1 minute
  predictionWindowSize: 10,
  trackSystemResources: true,
  defaultPricing: DEFAULT_PRICING,
};

// ============================================================================
// ResourceTracker 类
// ============================================================================

/**
 * 资源消耗追踪器
 * 追踪 Token 使用、API 调用、成本和系统资源
 */
export class ResourceTracker extends EventEmitter {
  private config: ResourceTrackerConfig;
  private pricingMap: Map<string, LLMProviderPricing>;
  private tokenRecords: TokenUsageRecord[] = [];
  private apiCallRecords: ApiCallRecord[] = [];
  private snapshots: ResourceSnapshot[] = [];
  private budgets: Map<string, ResourceBudget> = new Map();
  private taskUsage: Map<string, { tokens: number; cost: number; apiCalls: number }> = new Map();
  private snapshotTimer?: ReturnType<typeof setInterval>;

  constructor(config: Partial<ResourceTrackerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pricingMap = new Map();

    // 初始化定价映射
    for (const pricing of this.config.defaultPricing) {
      this.pricingMap.set(`${pricing.provider}:${pricing.model}`, pricing);
    }
  }

  // ============================================================================
  // Token 记录
  // ============================================================================

  /**
   * 记录 Token 使用
   */
  recordTokenUsage(record: Omit<TokenUsageRecord, "id" | "timestamp">): TokenUsageRecord {
    const fullRecord: TokenUsageRecord = {
      ...record,
      id: this.generateId(),
      timestamp: new Date(),
      metadata: record.metadata || {},
    };

    this.tokenRecords.push(fullRecord);

    // 限制历史记录数
    if (this.tokenRecords.length > this.config.maxHistoryEntries) {
      this.tokenRecords.shift();
    }

    // 更新任务累计使用
    this.updateTaskUsage(record.taskId, fullRecord);

    // 检查预算
    this.checkBudgets(record.taskId);

    // 发送事件
    this.emitEvent("token_used", record.taskId, fullRecord);

    return fullRecord;
  }

  /**
   * 批量记录 Token 使用
   */
  recordTokenUsageBatch(records: Array<Omit<TokenUsageRecord, "id" | "timestamp">>): TokenUsageRecord[] {
    return records.map((r) => this.recordTokenUsage(r));
  }

  // ============================================================================
  // API 调用记录
  // ============================================================================

  /**
   * 记录 API 调用
   */
  recordApiCall(record: Omit<ApiCallRecord, "id" | "timestamp">): ApiCallRecord {
    const fullRecord: ApiCallRecord = {
      ...record,
      id: this.generateId(),
      timestamp: new Date(),
      metadata: record.metadata || {},
    };

    this.apiCallRecords.push(fullRecord);

    // 限制历史记录数
    if (this.apiCallRecords.length > this.config.maxHistoryEntries) {
      this.apiCallRecords.shift();
    }

    // 更新任务 API 调用计数
    const usage = this.taskUsage.get(record.taskId) || { tokens: 0, cost: 0, apiCalls: 0 };
    usage.apiCalls += 1;
    this.taskUsage.set(record.taskId, usage);

    // 发送事件
    this.emitEvent("api_called", record.taskId, fullRecord);

    return fullRecord;
  }

  // ============================================================================
  // 成本计算
  // ============================================================================

  /**
   * 计算 Token 成本
   */
  calculateCost(record: TokenUsageRecord): number {
    const key = `${record.provider}:${record.model}`;
    const pricing = this.pricingMap.get(key);

    if (!pricing) {
      // 使用默认价格 (GPT-4o-mini 作为基准)
      const defaultPricing = DEFAULT_PRICING.find((p) => p.model === "gpt-4o-mini")!;
      return this.calculateCostWithPricing(record, defaultPricing);
    }

    return this.calculateCostWithPricing(record, pricing);
  }

  /**
   * 使用定价配置计算成本
   */
  private calculateCostWithPricing(record: TokenUsageRecord, pricing: LLMProviderPricing): number {
    let cost = 0;

    // 输入 Token 成本
    const effectiveInputTokens = record.inputTokens - (record.cachedInputTokens || 0);
    cost += (effectiveInputTokens / 1_000_000) * pricing.inputPricePerMillion;

    // 缓存读取成本
    if (record.cachedInputTokens && pricing.cacheReadPricePerMillion) {
      cost += (record.cachedInputTokens / 1_000_000) * pricing.cacheReadPricePerMillion;
    }

    // 缓存写入成本
    if (record.cachedWriteTokens && pricing.cacheWritePricePerMillion) {
      cost += (record.cachedWriteTokens / 1_000_000) * pricing.cacheWritePricePerMillion;
    }

    // 输出 Token 成本
    cost += (record.outputTokens / 1_000_000) * pricing.outputPricePerMillion;

    return cost;
  }

  /**
   * 获取总成本
   */
  getTotalCost(taskId?: string): number {
    const records = taskId
      ? this.tokenRecords.filter((r) => r.taskId === taskId)
      : this.tokenRecords;

    return records.reduce((sum, r) => sum + this.calculateCost(r), 0);
  }

  /**
   * 获取成本明细
   */
  getCostBreakdown(taskId?: string): {
    input: number;
    output: number;
    cached: number;
    total: number;
    byProvider: Record<string, number>;
  } {
    const records = taskId
      ? this.tokenRecords.filter((r) => r.taskId === taskId)
      : this.tokenRecords;

    let input = 0;
    let output = 0;
    let cached = 0;
    const byProvider: Record<string, number> = {};

    for (const record of records) {
      const pricing = this.pricingMap.get(`${record.provider}:${record.model}`);
      if (!pricing) continue;

      const effectiveInput = record.inputTokens - (record.cachedInputTokens || 0);
      input += (effectiveInput / 1_000_000) * pricing.inputPricePerMillion;
      output += (record.outputTokens / 1_000_000) * pricing.outputPricePerMillion;

      if (record.cachedInputTokens && pricing.cacheReadPricePerMillion) {
        cached += (record.cachedInputTokens / 1_000_000) * pricing.cacheReadPricePerMillion;
      }

      const providerKey = `${record.provider}/${record.model}`;
      byProvider[providerKey] = (byProvider[providerKey] || 0) + this.calculateCost(record);
    }

    return {
      input,
      output,
      cached,
      total: input + output + cached,
      byProvider,
    };
  }

  // ============================================================================
  // 资源统计
  // ============================================================================

  /**
   * 获取 Token 统计
   */
  getTokenStats(taskId?: string): {
    totalInput: number;
    totalOutput: number;
    totalCached: number;
    total: number;
    avgInputPerRequest: number;
    avgOutputPerRequest: number;
  } {
    const records = taskId
      ? this.tokenRecords.filter((r) => r.taskId === taskId)
      : this.tokenRecords;

    const totalInput = records.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOutput = records.reduce((sum, r) => sum + r.outputTokens, 0);
    const totalCached = records.reduce((sum, r) => sum + (r.cachedInputTokens || 0), 0);
    const count = records.length;

    return {
      totalInput,
      totalOutput,
      totalCached,
      total: totalInput + totalOutput,
      avgInputPerRequest: count > 0 ? totalInput / count : 0,
      avgOutputPerRequest: count > 0 ? totalOutput / count : 0,
    };
  }

  /**
   * 获取 API 调用统计
   */
  getApiCallStats(taskId?: string): {
    total: number;
    successful: number;
    failed: number;
    avgDurationMs: number;
    byEndpoint: Record<string, number>;
  } {
    const records = taskId
      ? this.apiCallRecords.filter((r) => r.taskId === taskId)
      : this.apiCallRecords;

    const successful = records.filter((r) => r.statusCode >= 200 && r.statusCode < 300).length;
    const failed = records.length - successful;
    const totalDuration = records.reduce((sum, r) => sum + r.durationMs, 0);
    const byEndpoint: Record<string, number> = {};

    for (const record of records) {
      byEndpoint[record.endpoint] = (byEndpoint[record.endpoint] || 0) + 1;
    }

    return {
      total: records.length,
      successful,
      failed,
      avgDurationMs: records.length > 0 ? totalDuration / records.length : 0,
      byEndpoint,
    };
  }

  /**
   * 获取任务资源使用
   */
  getTaskUsage(taskId: string): { tokens: number; cost: number; apiCalls: number } | undefined {
    return this.taskUsage.get(taskId);
  }

  /**
   * 获取所有任务资源使用
   */
  getAllTaskUsage(): Map<string, { tokens: number; cost: number; apiCalls: number }> {
    return new Map(this.taskUsage);
  }

  // ============================================================================
  // 预算管理
  // ============================================================================

  /**
   * 设置预算
   */
  setBudget(budget: Omit<ResourceBudget, "id">): ResourceBudget {
    const fullBudget: ResourceBudget = {
      ...budget,
      id: this.generateId(),
    };

    this.budgets.set(fullBudget.id, fullBudget);
    return fullBudget;
  }

  /**
   * 设置任务预算
   */
  setTaskBudget(
    taskId: string,
    options: {
      tokenBudget?: number;
      costBudget?: number;
      apiCallBudget?: number;
      hardLimit?: boolean;
    }
  ): ResourceBudget {
    return this.setBudget({
      taskId,
      tokenBudget: options.tokenBudget ?? Infinity,
      costBudget: options.costBudget ?? Infinity,
      apiCallBudget: options.apiCallBudget ?? Infinity,
      startTime: new Date(),
      hardLimit: options.hardLimit ?? false,
      warningThreshold: 80,
      criticalThreshold: 95,
    });
  }

  /**
   * 获取预算状态
   */
  getBudgetStatus(budgetId: string): BudgetStatus | undefined {
    const budget = this.budgets.get(budgetId);
    if (!budget) return undefined;

    const usage = budget.taskId ? this.taskUsage.get(budget.taskId) : undefined;
    const tokensUsed = usage?.tokens ?? this.getTokenStats().total;
    const costUsed = usage?.cost ?? this.getTotalCost();
    const apiCallsUsed = usage?.apiCalls ?? this.getApiCallStats().total;

    const tokenUsagePercent = (tokensUsed / budget.tokenBudget) * 100;
    const costUsagePercent = (costUsed / budget.costBudget) * 100;
    const apiCallUsagePercent = (apiCallsUsed / budget.apiCallBudget) * 100;

    const maxUsagePercent = Math.max(tokenUsagePercent, costUsagePercent, apiCallUsagePercent);

    let status: "normal" | "warning" | "critical" | "exceeded";
    if (maxUsagePercent >= 100) {
      status = "exceeded";
    } else if (maxUsagePercent >= budget.criticalThreshold) {
      status = "critical";
    } else if (maxUsagePercent >= budget.warningThreshold) {
      status = "warning";
    } else {
      status = "normal";
    }

    return {
      budgetId,
      tokensUsed,
      costUsed,
      apiCallsUsed,
      tokenUsagePercent,
      costUsagePercent,
      apiCallUsagePercent,
      status,
      remainingTokens: Math.max(0, budget.tokenBudget - tokensUsed),
      remainingCost: Math.max(0, budget.costBudget - costUsed),
    };
  }

  /**
   * 检查预算并发送事件
   */
  private checkBudgets(taskId: string): void {
    for (const [budgetId, budget] of this.budgets) {
      if (budget.taskId && budget.taskId !== taskId) continue;

      const status = this.getBudgetStatus(budgetId);
      if (!status) continue;

      if (status.status === "exceeded") {
        this.emitEvent("budget_exceeded", taskId, { budgetId, status });
      } else if (status.status === "warning" || status.status === "critical") {
        this.emitEvent("budget_warning", taskId, { budgetId, status });
      }
    }
  }

  /**
   * 移除预算
   */
  removeBudget(budgetId: string): boolean {
    return this.budgets.delete(budgetId);
  }

  // ============================================================================
  // 资源预测
  // ============================================================================

  /**
   * 预测资源消耗
   */
  predictResources(
    taskId: string,
    options: {
      method?: "linear" | "exponential" | "average";
      windowSize?: number;
    } = {}
  ): ResourcePrediction {
    const method = options.method ?? "linear";
    const windowSize = options.windowSize ?? this.config.predictionWindowSize;

    const taskRecords = this.tokenRecords
      .filter((r) => r.taskId === taskId)
      .slice(-windowSize);

    if (taskRecords.length < 2) {
      return {
        taskId,
        predictionTime: new Date(),
        predictedTotalTokens: 0,
        predictedTotalCost: 0,
        predictedTotalApiCalls: 0,
        predictedRemainingMs: 0,
        confidence: 0,
        dataPointsUsed: taskRecords.length,
        method,
      };
    }

    // 计算累计使用
    const cumulativeTokens: number[] = [];
    const cumulativeCost: number[] = [];
    const timestamps: number[] = [];

    let tokenSum = 0;
    let costSum = 0;

    for (const record of taskRecords) {
      tokenSum += record.inputTokens + record.outputTokens;
      costSum += this.calculateCost(record);
      cumulativeTokens.push(tokenSum);
      cumulativeCost.push(costSum);
      timestamps.push(record.timestamp.getTime());
    }

    // 根据方法预测
    let predictedTotalTokens: number;
    let predictedTotalCost: number;
    let confidence: number;

    if (method === "linear") {
      const tokenRate = this.linearRegression(timestamps, cumulativeTokens);
      const costRate = this.linearRegression(timestamps, cumulativeCost);

      // 假设任务完成时达到当前使用量的 2 倍
      predictedTotalTokens = tokenSum * 2;
      predictedTotalCost = costSum * 2;
      confidence = 0.7;
    } else if (method === "exponential") {
      // 指数增长假设
      const growthFactor = Math.pow(
        cumulativeTokens[cumulativeTokens.length - 1] / cumulativeTokens[0],
        1 / (cumulativeTokens.length - 1)
      );
      predictedTotalTokens = cumulativeTokens[cumulativeTokens.length - 1] * growthFactor * 2;
      predictedTotalCost = cumulativeCost[cumulativeCost.length - 1] * growthFactor * 2;
      confidence = 0.5;
    } else {
      // 平均值预测
      const avgTokensPerRequest =
        cumulativeTokens.reduce((a, b) => a + b, 0) / cumulativeTokens.length;
      const avgCostPerRequest =
        cumulativeCost.reduce((a, b) => a + b, 0) / cumulativeCost.length;

      // 假设还有相同数量的请求
      predictedTotalTokens = tokenSum + avgTokensPerRequest * taskRecords.length;
      predictedTotalCost = costSum + avgCostPerRequest * taskRecords.length;
      confidence = 0.6;
    }

    // 计算 API 调用预测
    const apiRecords = this.apiCallRecords.filter((r) => r.taskId === taskId);
    const predictedTotalApiCalls = apiRecords.length * 2;

    // 计算预计剩余时间
    const durationMs = timestamps[timestamps.length - 1] - timestamps[0];
    const predictedRemainingMs = durationMs;

    const prediction: ResourcePrediction = {
      taskId,
      predictionTime: new Date(),
      predictedTotalTokens,
      predictedTotalCost,
      predictedTotalApiCalls,
      predictedRemainingMs,
      confidence,
      dataPointsUsed: taskRecords.length,
      method,
    };

    this.emitEvent("prediction", taskId, prediction);

    return prediction;
  }

  /**
   * 线性回归
   */
  private linearRegression(x: number[], y: number[]): { slope: number; intercept: number } {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
  }

  // ============================================================================
  // 快照
  // ============================================================================

  /**
   * 创建快照
   */
  createSnapshot(): ResourceSnapshot {
    const tokenStats = this.getTokenStats();
    const apiStats = this.getApiCallStats();
    const totalCost = this.getTotalCost();

    const snapshot: ResourceSnapshot = {
      timestamp: new Date(),
      totalTokens: tokenStats.total,
      totalInputTokens: tokenStats.totalInput,
      totalOutputTokens: tokenStats.totalOutput,
      totalCachedTokens: tokenStats.totalCached,
      totalApiCalls: apiStats.total,
      totalCost,
      avgTokensPerRequest:
        this.tokenRecords.length > 0 ? tokenStats.total / this.tokenRecords.length : 0,
      avgCostPerRequest:
        this.tokenRecords.length > 0 ? totalCost / this.tokenRecords.length : 0,
      memoryUsageMb: this.getMemoryUsage(),
      cpuPercent: this.getCpuUsage(),
    };

    this.snapshots.push(snapshot);

    // 限制快照数量
    if (this.snapshots.length > 100) {
      this.snapshots.shift();
    }

    this.emitEvent("snapshot", undefined, snapshot);

    return snapshot;
  }

  /**
   * 获取快照历史
   */
  getSnapshots(): ResourceSnapshot[] {
    return [...this.snapshots];
  }

  /**
   * 启动自动快照
   */
  startAutoSnapshot(): void {
    if (this.snapshotTimer) return;

    this.snapshotTimer = setInterval(() => {
      this.createSnapshot();
    }, this.config.snapshotIntervalMs);
  }

  /**
   * 停止自动快照
   */
  stopAutoSnapshot(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }
  }

  // ============================================================================
  // 系统资源
  // ============================================================================

  /**
   * 获取内存使用 (MB)
   */
  private getMemoryUsage(): number {
    if (typeof process !== "undefined" && process.memoryUsage) {
      return process.memoryUsage().heapUsed / 1024 / 1024;
    }
    return 0;
  }

  /**
   * 获取 CPU 使用率 (模拟)
   */
  private getCpuUsage(): number {
    // 简化实现，实际应使用 os.cpus() 等
    return 0;
  }

  // ============================================================================
  // 辅助方法
  // ============================================================================

  /**
   * 更新任务使用统计
   */
  private updateTaskUsage(taskId: string, record: TokenUsageRecord): void {
    const usage = this.taskUsage.get(taskId) || { tokens: 0, cost: 0, apiCalls: 0 };
    usage.tokens += record.inputTokens + record.outputTokens;
    usage.cost += this.calculateCost(record);
    this.taskUsage.set(taskId, usage);
  }

  /**
   * 生成 ID
   */
  private generateId(): string {
    return `res_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 发送事件
   */
  private emitEvent(type: ResourceEvent["type"], taskId: string | undefined, data: unknown): void {
    const event: ResourceEvent = {
      type,
      timestamp: new Date(),
      taskId,
      data,
    };

    this.emit("resource", event);
    this.emit(type, event);
  }

  /**
   * 获取所有记录
   */
  getRecords(): {
    tokens: TokenUsageRecord[];
    apiCalls: ApiCallRecord[];
  } {
    return {
      tokens: [...this.tokenRecords],
      apiCalls: [...this.apiCallRecords],
    };
  }

  /**
   * 清除历史记录
   */
  clearHistory(): void {
    this.tokenRecords = [];
    this.apiCallRecords = [];
    this.snapshots = [];
  }

  /**
   * 清除任务数据
   */
  clearTaskData(taskId: string): void {
    this.tokenRecords = this.tokenRecords.filter((r) => r.taskId !== taskId);
    this.apiCallRecords = this.apiCallRecords.filter((r) => r.taskId !== taskId);
    this.taskUsage.delete(taskId);
  }

  /**
   * 添加定价配置
   */
  addPricing(pricing: LLMProviderPricing): void {
    this.pricingMap.set(`${pricing.provider}:${pricing.model}`, pricing);
  }

  /**
   * 获取定价配置
   */
  getPricing(provider: string, model: string): LLMProviderPricing | undefined {
    return this.pricingMap.get(`${provider}:${model}`);
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建资源追踪器
 */
export function createResourceTracker(config: Partial<ResourceTrackerConfig> = {}): ResourceTracker {
  return new ResourceTracker(config);
}

// ============================================================================
// 格式化函数
// ============================================================================

/**
 * 格式化成本
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${(cost * 1000).toFixed(4)}m`; // mills
  } else if (cost < 1) {
    return `$${cost.toFixed(4)}`;
  } else if (cost < 100) {
    return `$${cost.toFixed(2)}`;
  } else {
    return `$${cost.toFixed(0)}`;
  }
}

/**
 * 格式化 Token 数量
 */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) {
    return tokens.toString();
  } else if (tokens < 1_000_000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  } else {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
}

/**
 * 格式化资源报告
 */
export function formatResourceReport(snapshot: ResourceSnapshot): string {
  const lines = [
    `=== 资源使用报告 ===`,
    `时间: ${snapshot.timestamp.toISOString()}`,
    ``,
    `Token 使用:`,
    `  总计: ${formatTokens(snapshot.totalTokens)}`,
    `  输入: ${formatTokens(snapshot.totalInputTokens)}`,
    `  输出: ${formatTokens(snapshot.totalOutputTokens)}`,
    `  缓存: ${formatTokens(snapshot.totalCachedTokens)}`,
    ``,
    `API 调用: ${snapshot.totalApiCalls}`,
    `成本: ${formatCost(snapshot.totalCost)}`,
    ``,
    `平均 Token/请求: ${formatTokens(snapshot.avgTokensPerRequest)}`,
    `平均成本/请求: ${formatCost(snapshot.avgCostPerRequest)}`,
    ``,
    `系统资源:`,
    `  内存: ${snapshot.memoryUsageMb.toFixed(1)} MB`,
    `  CPU: ${snapshot.cpuPercent.toFixed(1)}%`,
  ];

  return lines.join("\n");
}

/**
 * 格式化预算状态
 */
export function formatBudgetStatus(status: BudgetStatus): string {
  const statusEmoji = {
    normal: "✅",
    warning: "⚠️",
    critical: "🔴",
    exceeded: "❌",
  };

  const lines = [
    `=== 预算状态 ${statusEmoji[status.status]} ===`,
    `状态: ${status.status}`,
    ``,
    `Token: ${formatTokens(status.tokensUsed)} / ${formatTokens(status.remainingTokens + status.tokensUsed)} (${status.tokenUsagePercent.toFixed(1)}%)`,
    `成本: ${formatCost(status.costUsed)} / ${formatCost(status.remainingCost + status.costUsed)} (${status.costUsagePercent.toFixed(1)}%)`,
    `API 调用: ${status.apiCallsUsed} (${status.apiCallUsagePercent.toFixed(1)}%)`,
  ];

  return lines.join("\n");
}
