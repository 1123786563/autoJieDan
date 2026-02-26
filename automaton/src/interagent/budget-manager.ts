/**
 * 预算约束集成
 * 实现 Token 预算追踪、成本预估和超支检测
 *
 * @module interagent/budget-manager
 * @version 1.0.0
 */

import { EventEmitter } from "events";

// ============================================================================
// 类型定义
// ============================================================================

/** 预算类型 */
export type BudgetType = "token" | "usd" | "credit";

/** 预算状态 */
export type BudgetStatus = "healthy" | "warning" | "critical" | "exhausted";

/** 预算层级 */
export type BudgetTier = "system" | "project" | "task" | "step";

/** 预算配置 */
export interface BudgetConfig {
  /** 预算类型 */
  type: BudgetType;
  /** 总预算 */
  total: number;
  /** 警告阈值 (百分比) */
  warningThreshold: number;
  /** 临界阈值 (百分比) */
  criticalThreshold: number;
  /** 是否允许超支 */
  allowOverage: boolean;
  /** 超支限制 (百分比) */
  overageLimit: number;
  /** 预留比例 */
  reserveRatio: number;
}

/** 预算分配 */
export interface BudgetAllocation {
  /** 分配 ID */
  id: string;
  /** 父预算 ID */
  parentId?: string;
  /** 层级 */
  tier: BudgetTier;
  /** 类型 */
  type: BudgetType;
  /** 总量 */
  total: number;
  /** 已使用 */
  used: number;
  /** 已预留 */
  reserved: number;
  /** 可用 */
  available: number;
  /** 状态 */
  status: BudgetStatus;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/** Token 使用记录 */
export interface TokenUsageRecord {
  /** 记录 ID */
  id: string;
  /** 任务 ID */
  taskId: string;
  /** 步骤 ID */
  stepId?: string;
  /** 模型名称 */
  model: string;
  /** 输入 Token 数 */
  inputTokens: number;
  /** 输出 Token 数 */
  outputTokens: number;
  /** 总 Token 数 */
  totalTokens: number;
  /** 成本 (美元) */
  costUsd: number;
  /** 时间戳 */
  timestamp: Date;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/** 成本预估 */
export interface CostEstimate {
  /** 预估输入 Token */
  estimatedInputTokens: number;
  /** 预估输出 Token */
  estimatedOutputTokens: number;
  /** 预估总 Token */
  estimatedTotalTokens: number;
  /** 预估成本 (美元) */
  estimatedCostUsd: number;
  /** 置信度 (0-1) */
  confidence: number;
  /** 预估方法 */
  method: "historical" | "heuristic" | "user_provided";
}

/** 模型定价 */
export interface ModelPricing {
  /** 模型名称 */
  model: string;
  /** 输入价格 (每千 Token) */
  inputPricePerThousand: number;
  /** 输出价格 (每千 Token) */
  outputPricePerThousand: number;
  /** 上下文窗口 */
  contextWindow: number;
}

/** 超支事件 */
export interface OverrunEvent {
  type: "warning" | "critical" | "exhausted";
  allocationId: string;
  used: number;
  total: number;
  percentage: number;
  timestamp: Date;
  taskId?: string;
  message: string;
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  type: "token",
  total: 1000000,
  warningThreshold: 70,
  criticalThreshold: 90,
  allowOverage: false,
  overageLimit: 10,
  reserveRatio: 0.1,
};

const DEFAULT_MODEL_PRICING: ModelPricing[] = [
  { model: "gpt-4o", inputPricePerThousand: 0.0025, outputPricePerThousand: 0.01, contextWindow: 128000 },
  { model: "gpt-4o-mini", inputPricePerThousand: 0.00015, outputPricePerThousand: 0.0006, contextWindow: 128000 },
  { model: "claude-opus-4-20250514", inputPricePerThousand: 0.015, outputPricePerThousand: 0.075, contextWindow: 200000 },
  { model: "claude-sonnet-4-20250514", inputPricePerThousand: 0.003, outputPricePerThousand: 0.015, contextWindow: 200000 },
  { model: "claude-haiku-3-5-20241022", inputPricePerThousand: 0.001, outputPricePerThousand: 0.005, contextWindow: 200000 },
];

// ============================================================================
// 成本计算器
// ============================================================================

/**
 * 成本计算器
 * 根据模型和 Token 数量计算成本
 */
export class CostCalculator {
  private pricing: Map<string, ModelPricing>;

  constructor(customPricing: ModelPricing[] = []) {
    this.pricing = new Map();
    this.loadPricing(DEFAULT_MODEL_PRICING);
    this.loadPricing(customPricing);
  }

  private loadPricing(pricing: ModelPricing[]): void {
    for (const p of pricing) {
      this.pricing.set(p.model, p);
    }
  }

  /**
   * 计算成本
   */
  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = this.pricing.get(model);
    if (!pricing) {
      // 使用默认定价
      return (inputTokens + outputTokens) * 0.001;
    }

    const inputCost = (inputTokens / 1000) * pricing.inputPricePerThousand;
    const outputCost = (outputTokens / 1000) * pricing.outputPricePerThousand;

    return inputCost + outputCost;
  }

  /**
   * 获取模型定价
   */
  getModelPricing(model: string): ModelPricing | undefined {
    return this.pricing.get(model);
  }

  /**
   * 添加模型定价
   */
  addModelPricing(pricing: ModelPricing): void {
    this.pricing.set(pricing.model, pricing);
  }
}

// ============================================================================
// 成本预估器
// ============================================================================

/**
 * 成本预估器
 * 预估任务或步骤的 Token 消耗
 */
export class CostEstimator {
  private calculator: CostCalculator;
  private history: TokenUsageRecord[] = [];
  private maxHistorySize: number = 1000;

  constructor(calculator?: CostCalculator) {
    this.calculator = calculator || new CostCalculator();
  }

  /**
   * 预估任务成本
   */
  estimateTaskCost(
    taskType: string,
    description: string,
    model: string = "claude-sonnet-4-20250514"
  ): CostEstimate {
    // 基于历史数据预估
    const historical = this.estimateFromHistory(taskType);
    if (historical) {
      return historical;
    }

    // 基于启发式预估
    return this.estimateFromHeuristics(taskType, description, model);
  }

  /**
   * 从历史数据预估
   */
  private estimateFromHistory(taskType: string): CostEstimate | null {
    const relevantRecords = this.history.filter((r) =>
      r.metadata.taskType === taskType
    );

    if (relevantRecords.length < 3) {
      return null;
    }

    const avgInput =
      relevantRecords.reduce((sum, r) => sum + r.inputTokens, 0) / relevantRecords.length;
    const avgOutput =
      relevantRecords.reduce((sum, r) => sum + r.outputTokens, 0) / relevantRecords.length;

    // 计算标准差来评估置信度
    const variance = relevantRecords.reduce((sum, r) => {
      return sum + Math.pow(r.totalTokens - (avgInput + avgOutput), 2);
    }, 0) / relevantRecords.length;
    const stdDev = Math.sqrt(variance);
    const meanTotal = avgInput + avgOutput;
    const confidence = Math.max(0.3, 1 - (stdDev / meanTotal) * 0.5);

    return {
      estimatedInputTokens: Math.round(avgInput),
      estimatedOutputTokens: Math.round(avgOutput),
      estimatedTotalTokens: Math.round(avgInput + avgOutput),
      estimatedCostUsd: this.calculator.calculateCost(
        relevantRecords[0].model,
        avgInput,
        avgOutput
      ),
      confidence,
      method: "historical",
    };
  }

  /**
   * 基于启发式预估
   */
  private estimateFromHeuristics(
    taskType: string,
    description: string,
    model: string
  ): CostEstimate {
    // 基础 Token 估算
    const descriptionTokens = Math.ceil(description.length / 4);

    // 根据任务类型调整
    const taskMultipliers: Record<string, { input: number; output: number }> = {
      genesis: { input: 3, output: 10 },
      analysis: { input: 2, output: 3 },
      execution: { input: 2, output: 5 },
      report: { input: 2, output: 4 },
      maintenance: { input: 2, output: 3 },
      exploration: { input: 3, output: 6 },
      custom: { input: 2, output: 5 },
    };

    const multiplier = taskMultipliers[taskType] || taskMultipliers.custom;

    const estimatedInputTokens = Math.round(descriptionTokens * multiplier.input + 500);
    const estimatedOutputTokens = Math.round(descriptionTokens * multiplier.output + 300);
    const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;

    return {
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedTotalTokens,
      estimatedCostUsd: this.calculator.calculateCost(
        model,
        estimatedInputTokens,
        estimatedOutputTokens
      ),
      confidence: 0.5, // 启发式方法置信度较低
      method: "heuristic",
    };
  }

  /**
   * 记录使用
   */
  recordUsage(record: Omit<TokenUsageRecord, "id" | "timestamp">): TokenUsageRecord {
    const fullRecord: TokenUsageRecord = {
      id: `usage-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      ...record,
      timestamp: new Date(),
    };

    this.history.push(fullRecord);

    // 限制历史记录大小
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }

    return fullRecord;
  }

  /**
   * 获取历史记录
   */
  getHistory(taskId?: string): TokenUsageRecord[] {
    if (taskId) {
      return this.history.filter((r) => r.taskId === taskId);
    }
    return [...this.history];
  }
}

// ============================================================================
// 预算管理器
// ============================================================================

/**
 * 预算管理器
 * 管理多层级的预算分配和追踪
 */
export class BudgetManager extends EventEmitter {
  private config: BudgetConfig;
  private allocations: Map<string, BudgetAllocation> = new Map();
  private calculator: CostCalculator;
  private estimator: CostEstimator;
  private rootAllocationId: string;

  constructor(config: Partial<BudgetConfig> = {}) {
    super();
    this.config = { ...DEFAULT_BUDGET_CONFIG, ...config };
    this.calculator = new CostCalculator();
    this.estimator = new CostEstimator(this.calculator);

    // 创建根预算分配
    this.rootAllocationId = this.createAllocation({
      tier: "system",
      type: this.config.type,
      total: this.config.total,
    });
  }

  // ===========================================================================
  // 预算分配
  // ===========================================================================

  /**
   * 创建预算分配
   */
  createAllocation(options: {
    parentId?: string;
    tier: BudgetTier;
    type: BudgetType;
    total: number;
    metadata?: Record<string, unknown>;
  }): string {
    const id = `budget-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date();

    // 计算预留
    const reserveAmount = options.total * this.config.reserveRatio;

    const allocation: BudgetAllocation = {
      id,
      parentId: options.parentId,
      tier: options.tier,
      type: options.type,
      total: options.total,
      used: 0,
      reserved: reserveAmount,
      available: options.total - reserveAmount,
      status: "healthy",
      createdAt: now,
      updatedAt: now,
      metadata: options.metadata || {},
    };

    this.allocations.set(id, allocation);

    // 如果有父预算，从父预算中预留
    if (options.parentId) {
      this.reserveFromParent(options.parentId, options.total);
    }

    this.emit("allocation_created", { allocationId: id, allocation });

    return id;
  }

  /**
   * 从父预算预留
   */
  private reserveFromParent(parentId: string, amount: number): boolean {
    const parent = this.allocations.get(parentId);
    if (!parent || parent.available < amount) {
      return false;
    }

    parent.available -= amount;
    parent.reserved += amount;
    parent.updatedAt = new Date();
    this.updateAllocationStatus(parentId);

    return true;
  }

  /**
   * 获取预算分配
   */
  getAllocation(id: string): BudgetAllocation | undefined {
    return this.allocations.get(id);
  }

  /**
   * 获取根预算
   */
  getRootAllocation(): BudgetAllocation | undefined {
    return this.allocations.get(this.rootAllocationId);
  }

  // ===========================================================================
  // 预算使用
  // ===========================================================================

  /**
   * 预留预算
   */
  reserve(allocationId: string, amount: number): boolean {
    const allocation = this.allocations.get(allocationId);
    if (!allocation || allocation.available < amount) {
      return false;
    }

    allocation.available -= amount;
    allocation.reserved += amount;
    allocation.updatedAt = new Date();

    this.updateAllocationStatus(allocationId);
    return true;
  }

  /**
   * 提交使用
   */
  commit(allocationId: string, amount: number, record: Omit<TokenUsageRecord, "id" | "timestamp">): TokenUsageRecord {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      throw new Error(`Allocation not found: ${allocationId}`);
    }

    // 从预留中转移
    const commitAmount = Math.min(amount, allocation.reserved);
    allocation.reserved -= commitAmount;
    allocation.used += amount;

    // 如果实际使用超过预留，从可用中扣除
    if (amount > commitAmount) {
      allocation.available -= amount - commitAmount;
    }

    allocation.updatedAt = new Date();
    this.updateAllocationStatus(allocationId);

    // 记录使用
    const usageRecord = this.estimator.recordUsage(record);
    this.emit("usage_committed", { allocationId, amount, record: usageRecord });

    return usageRecord;
  }

  /**
   * 释放预留
   */
  release(allocationId: string, amount: number): void {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) return;

    const releaseAmount = Math.min(amount, allocation.reserved);
    allocation.reserved -= releaseAmount;
    allocation.available += releaseAmount;
    allocation.updatedAt = new Date();

    this.updateAllocationStatus(allocationId);
    this.emit("reservation_released", { allocationId, amount: releaseAmount });
  }

  // ===========================================================================
  // 状态更新
  // ===========================================================================

  /**
   * 更新分配状态
   */
  private updateAllocationStatus(allocationId: string): void {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) return;

    const usedPercentage = (allocation.used / allocation.total) * 100;
    const totalUsedPercentage = ((allocation.used + allocation.reserved) / allocation.total) * 100;

    let previousStatus = allocation.status;
    let newStatus: BudgetStatus;

    if (totalUsedPercentage >= 100) {
      newStatus = "exhausted";
    } else if (totalUsedPercentage >= this.config.criticalThreshold) {
      newStatus = "critical";
    } else if (totalUsedPercentage >= this.config.warningThreshold) {
      newStatus = "warning";
    } else {
      newStatus = "healthy";
    }

    allocation.status = newStatus;

    // 触发超支事件
    if (newStatus !== previousStatus) {
      this.emitOverrunEvent(allocation, newStatus);
    }
  }

  /**
   * 触发超支事件
   */
  private emitOverrunEvent(allocation: BudgetAllocation, status: BudgetStatus): void {
    const event: OverrunEvent = {
      type: status === "exhausted" ? "exhausted" : status === "critical" ? "critical" : "warning",
      allocationId: allocation.id,
      used: allocation.used,
      total: allocation.total,
      percentage: (allocation.used / allocation.total) * 100,
      timestamp: new Date(),
      message: `Budget ${allocation.id} is at ${((allocation.used / allocation.total) * 100).toFixed(1)}% usage`,
    };

    this.emit("overrun", event);
  }

  // ===========================================================================
  // 检查方法
  // ===========================================================================

  /**
   * 检查是否有足够预算
   */
  canAfford(allocationId: string, amount: number): boolean {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) return false;

    if (allocation.available >= amount) {
      return true;
    }

    // 检查是否允许超支
    if (this.config.allowOverage) {
      const maxAllowed = allocation.total * (1 + this.config.overageLimit / 100);
      return allocation.used + amount <= maxAllowed;
    }

    return false;
  }

  /**
   * 获取预算状态
   */
  getStatus(allocationId: string): BudgetStatus | null {
    const allocation = this.allocations.get(allocationId);
    return allocation?.status || null;
  }

  /**
   * 获取使用百分比
   */
  getUsagePercentage(allocationId: string): number {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) return 0;
    return (allocation.used / allocation.total) * 100;
  }

  // ===========================================================================
  // 成本预估
  // ===========================================================================

  /**
   * 预估任务成本
   */
  estimateCost(taskType: string, description: string, model?: string): CostEstimate {
    return this.estimator.estimateTaskCost(taskType, description, model);
  }

  /**
   * 计算实际成本
   */
  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    return this.calculator.calculateCost(model, inputTokens, outputTokens);
  }

  // ===========================================================================
  // 报告
  // ===========================================================================

  /**
   * 获取预算摘要
   */
  getSummary(): {
    root: BudgetAllocation;
    children: BudgetAllocation[];
    totalUsed: number;
    totalReserved: number;
    totalAvailable: number;
  } {
    const root = this.allocations.get(this.rootAllocationId)!;
    const children = Array.from(this.allocations.values()).filter(
      (a) => a.id !== this.rootAllocationId
    );

    return {
      root,
      children,
      totalUsed: root.used,
      totalReserved: root.reserved,
      totalAvailable: root.available,
    };
  }

  /**
   * 获取使用历史
   */
  getUsageHistory(taskId?: string): TokenUsageRecord[] {
    return this.estimator.getHistory(taskId);
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建预算管理器
 */
export function createBudgetManager(config: Partial<BudgetConfig> = {}): BudgetManager {
  return new BudgetManager(config);
}

/**
 * 创建成本计算器
 */
export function createCostCalculator(customPricing: ModelPricing[] = []): CostCalculator {
  return new CostCalculator(customPricing);
}

/**
 * 创建成本预估器
 */
export function createCostEstimator(calculator?: CostCalculator): CostEstimator {
  return new CostEstimator(calculator);
}

/**
 * 格式化预算状态
 */
export function formatBudgetStatus(status: BudgetStatus): string {
  const statusMap: Record<BudgetStatus, string> = {
    healthy: "健康",
    warning: "警告",
    critical: "临界",
    exhausted: "耗尽",
  };
  return statusMap[status] || status;
}

/**
 * 格式化成本
 */
export function formatCost(costUsd: number): string {
  if (costUsd < 0.01) {
    return `$${(costUsd * 100).toFixed(4)}¢`;
  }
  return `$${costUsd.toFixed(4)}`;
}

/**
 * 格式化 Token 数量
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(2)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}
