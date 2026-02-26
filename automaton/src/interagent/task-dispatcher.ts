/**
 * Automaton 任务分发逻辑
 * 管理项目上下文、预算计算和任务分发决策
 *
 * @module interagent/task-dispatcher
 * @version 1.0.0
 */

import { EventEmitter } from "events";
import type {
  GenesisPrompt,
  GenesisPriority,
  GenesisTaskType,
  GenesisPromptResponse,
  TechnicalConstraints,
  BusinessTerms,
} from "./genesis-prompt.js";
import {
  createGenesisPrompt,
  getPriorityValue,
  estimateComplexity,
} from "./genesis-prompt.js";

// ============================================================================
// 类型定义
// ============================================================================

/** Nanobot 能力 */
export interface NanobotCapabilities {
  /** DID */
  did: string;
  /** 支持的任务类型 */
  supportedTaskTypes: GenesisTaskType[];
  /** 支持的编程语言 */
  supportedLanguages: string[];
  /** 最大并发任务数 */
  maxConcurrentTasks: number;
  /** 当前负载 */
  currentLoad: number;
  /** 性能分数 (0-100) */
  performanceScore: number;
  /** 可用内存 (MB) */
  availableMemoryMb: number;
  /** 标签 */
  tags: string[];
  /** 最后心跳时间 */
  lastHeartbeat: Date;
  /** 是否在线 */
  isOnline: boolean;
}

/** 预算分配 */
export interface BudgetAllocation {
  /** 总预算 */
  total: number;
  /** 已分配 */
  allocated: number;
  /** 可用 */
  available: number;
  /** 预留 */
  reserved: number;
  /** 货币 */
  currency: string;
}

/** 任务成本估算 */
export interface TaskCostEstimate {
  /** 预计 Token 数量 */
  estimatedTokens: number;
  /** 预计时间 (毫秒) */
  estimatedDurationMs: number;
  /** 预计成本 (美元) */
  estimatedCost: number;
  /** 复杂度 */
  complexity: "simple" | "medium" | "complex" | "very_complex";
  /** 风险等级 */
  riskLevel: "low" | "medium" | "high";
  /** 置信度 (0-1) */
  confidence: number;
}

/** 项目上下文 */
export interface ProjectContext {
  /** 项目 ID */
  projectId: string;
  /** 项目名称 */
  projectName: string;
  /** 项目根路径 */
  projectRoot: string;
  /** 主要编程语言 */
  primaryLanguage: string;
  /** 框架 */
  frameworks: string[];
  /** 依赖项 */
  dependencies: Record<string, string>;
  /** Git 信息 */
  git: {
    branch: string;
    commit: string;
    remote: string;
    isClean: boolean;
  };
  /** 环境变量 */
  environment: Record<string, string>;
  /** 自定义配置 */
  customConfig: Record<string, unknown>;
}

/** 分发决策 */
export interface DispatchDecision {
  /** 是否可以分发 */
  canDispatch: boolean;
  /** 目标 Nanobot */
  targetNanobot?: NanobotCapabilities;
  /** 备选 Nanobot 列表 */
  alternatives: NanobotCapabilities[];
  /** 分配的预算 */
  allocatedBudget?: number;
  /** 决策原因 */
  reason: string;
  /** 拒绝原因（如果不能分发） */
  rejectionReason?: string;
  /** 预计完成时间 */
  estimatedCompletionTime?: Date;
}

/** 分发配置 */
export interface DispatcherConfig {
  /** 默认预算 */
  defaultBudget: number;
  /** 最大单任务预算 */
  maxTaskBudget: number;
  /** 超时时间 (毫秒) */
  defaultTimeoutMs: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 负载均衡策略 */
  loadBalanceStrategy: "round_robin" | "least_loaded" | "performance" | "random";
  /** 是否启用预算检查 */
  enableBudgetCheck: boolean;
  /** 心跳超时 (毫秒) */
  heartbeatTimeoutMs: number;
}

/** 分发事件 */
export interface DispatchEvent {
  type: "dispatched" | "rejected" | "deferred" | "completed" | "failed";
  promptId: string;
  nanobotDid?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_DISPATCHER_CONFIG: DispatcherConfig = {
  defaultBudget: 1.0,
  maxTaskBudget: 10.0,
  defaultTimeoutMs: 30 * 60 * 1000, // 30 分钟
  maxRetries: 3,
  loadBalanceStrategy: "least_loaded",
  enableBudgetCheck: true,
  heartbeatTimeoutMs: 60 * 1000, // 1 分钟
};

// ============================================================================
// 成本估算器
// ============================================================================

/**
 * 任务成本估算器
 */
export class CostEstimator {
  /** 每千 Token 成本 (美元) */
  private costPerThousandTokens: number = 0.002;

  /** 平均 Token 处理时间 (毫秒) */
  private avgProcessingTimeMs: number = 100;

  /**
   * 估算任务成本
   */
  estimate(prompt: GenesisPrompt): TaskCostEstimate {
    const complexity = estimateComplexity(prompt);
    const riskLevel = this.assessRisk(prompt);
    const baseTokens = this.estimateTokens(prompt, complexity);
    const duration = this.estimateDuration(prompt, complexity);

    // 根据复杂度调整
    const complexityMultiplier = {
      simple: 1.0,
      medium: 1.5,
      complex: 2.5,
      very_complex: 4.0,
    };

    const tokens = Math.round(baseTokens * complexityMultiplier[complexity]);
    const cost = (tokens / 1000) * this.costPerThousandTokens;

    // 置信度基于约束的明确程度
    let confidence = 0.8;
    if (!prompt.technical) confidence -= 0.2;
    if (!prompt.business) confidence -= 0.1;
    if (!prompt.outputExpectation) confidence -= 0.1;

    return {
      estimatedTokens: tokens,
      estimatedDurationMs: duration,
      estimatedCost: cost,
      complexity,
      riskLevel,
      confidence: Math.max(0.3, confidence),
    };
  }

  /**
   * 估算 Token 数量
   */
  private estimateTokens(prompt: GenesisPrompt, complexity: string): number {
    // 基础 Token 数
    let baseTokens = 500;

    // 描述长度影响
    baseTokens += prompt.input.description.length / 4;

    // 规格说明影响
    if (prompt.input.specification) {
      baseTokens += prompt.input.specification.length / 4;
    }

    // 复杂度影响
    const complexityTokens: Record<string, number> = {
      simple: 1000,
      medium: 3000,
      complex: 8000,
      very_complex: 20000,
    };

    return baseTokens + complexityTokens[complexity];
  }

  /**
   * 估算执行时间
   */
  private estimateDuration(prompt: GenesisPrompt, complexity: string): number {
    const baseDuration: Record<string, number> = {
      simple: 30 * 1000,       // 30 秒
      medium: 2 * 60 * 1000,   // 2 分钟
      complex: 10 * 60 * 1000, // 10 分钟
      very_complex: 30 * 60 * 1000, // 30 分钟
    };

    let duration = baseDuration[complexity];

    // 约束增加时间
    if (prompt.technical?.testCoverage?.enforce) {
      duration *= 1.3;
    }
    if (prompt.business?.quality?.requireCodeReview) {
      duration *= 1.2;
    }

    return duration;
  }

  /**
   * 评估风险
   */
  private assessRisk(prompt: GenesisPrompt): "low" | "medium" | "high" {
    let riskScore = 0;

    // 新功能开发风险较高
    if (prompt.taskType === "genesis") riskScore += 2;
    if (prompt.taskType === "exploration") riskScore += 3;

    // 约束越严，风险越高
    if (prompt.technical?.forbiddenLibraries?.length) riskScore += 1;
    if (prompt.technical?.security?.noNetworkAccess) riskScore += 1;

    // 时间约束
    if (prompt.business?.timeline?.deadline) {
      const deadline = new Date(prompt.business.timeline.deadline);
      const timeUntilDeadline = deadline.getTime() - Date.now();
      if (timeUntilDeadline < 60 * 60 * 1000) riskScore += 2; // 1小时内
      else if (timeUntilDeadline < 24 * 60 * 60 * 1000) riskScore += 1; // 1天内
    }

    if (riskScore >= 4) return "high";
    if (riskScore >= 2) return "medium";
    return "low";
  }
}

// ============================================================================
// 任务分发器
// ============================================================================

/**
 * Automaton 任务分发器
 * 负责任务的预算计算、Nanobot 选择和分发决策
 */
export class TaskDispatcher extends EventEmitter {
  private config: DispatcherConfig;
  private nanobots: Map<string, NanobotCapabilities> = new Map();
  private budget: BudgetAllocation;
  private costEstimator: CostEstimator;
  private activeTasks: Map<string, GenesisPrompt> = new Map();

  constructor(
    config: Partial<DispatcherConfig> = {},
    initialBudget: number = DEFAULT_DISPATCHER_CONFIG.defaultBudget
  ) {
    super();
    this.config = { ...DEFAULT_DISPATCHER_CONFIG, ...config };
    this.budget = {
      total: initialBudget,
      allocated: 0,
      available: initialBudget,
      reserved: 0,
      currency: "USD",
    };
    this.costEstimator = new CostEstimator();
  }

  // ===========================================================================
  // Nanobot 管理
  // ===========================================================================

  /**
   * 注册 Nanobot
   */
  registerNanobot(capabilities: NanobotCapabilities): void {
    this.nanobots.set(capabilities.did, capabilities);
    this.emit("nanobot_registered", { did: capabilities.did, capabilities });
  }

  /**
   * 注销 Nanobot
   */
  unregisterNanobot(did: string): boolean {
    const result = this.nanobots.delete(did);
    if (result) {
      this.emit("nanobot_unregistered", { did });
    }
    return result;
  }

  /**
   * 更新 Nanobot 状态
   */
  updateNanobotStatus(
    did: string,
    updates: Partial<NanobotCapabilities>
  ): NanobotCapabilities | null {
    const existing = this.nanobots.get(did);
    if (!existing) return null;

    const updated = { ...existing, ...updates, lastHeartbeat: new Date() };
    this.nanobots.set(did, updated);
    return updated;
  }

  /**
   * 获取所有在线 Nanobot
   */
  getOnlineNanobots(): NanobotCapabilities[] {
    const now = Date.now();
    return Array.from(this.nanobots.values()).filter((n) => {
      if (!n.isOnline) return false;
      const heartbeatAge = now - n.lastHeartbeat.getTime();
      return heartbeatAge < this.config.heartbeatTimeoutMs;
    });
  }

  /**
   * 获取可用 Nanobot
   */
  getAvailableNanobots(): NanobotCapabilities[] {
    return this.getOnlineNanobots().filter((n) => n.currentLoad < n.maxConcurrentTasks);
  }

  // ===========================================================================
  // 预算管理
  // ===========================================================================

  /**
   * 获取当前预算状态
   */
  getBudgetStatus(): BudgetAllocation {
    return { ...this.budget };
  }

  /**
   * 充值预算
   */
  addBudget(amount: number): void {
    this.budget.total += amount;
    this.budget.available += amount;
  }

  /**
   * 预留预算
   */
  reserveBudget(amount: number): boolean {
    if (amount > this.budget.available) return false;
    this.budget.available -= amount;
    this.budget.reserved += amount;
    return true;
  }

  /**
   * 提交预留预算
   */
  commitReservedBudget(amount: number): void {
    const commitAmount = Math.min(amount, this.budget.reserved);
    this.budget.reserved -= commitAmount;
    this.budget.allocated += commitAmount;
  }

  /**
   * 释放预留预算
   */
  releaseReservedBudget(amount: number): void {
    const releaseAmount = Math.min(amount, this.budget.reserved);
    this.budget.reserved -= releaseAmount;
    this.budget.available += releaseAmount;
  }

  // ===========================================================================
  // 分发决策
  // ===========================================================================

  /**
   * 做出分发决策
   */
  makeDispatchDecision(prompt: GenesisPrompt): DispatchDecision {
    // 1. 检查预算
    if (this.config.enableBudgetCheck) {
      const estimate = this.costEstimator.estimate(prompt);
      if (estimate.estimatedCost > this.budget.available) {
        return {
          canDispatch: false,
          alternatives: [],
          reason: "Insufficient budget",
          rejectionReason: `需要 $${estimate.estimatedCost.toFixed(4)}，可用 $${this.budget.available.toFixed(4)}`,
        };
      }
    }

    // 2. 检查超时限制
    if (prompt.timeoutMs && prompt.timeoutMs < 1000) {
      return {
        canDispatch: false,
        alternatives: [],
        reason: "Invalid timeout",
        rejectionReason: "Timeout must be at least 1 second",
      };
    }

    // 3. 选择合适的 Nanobot
    const candidates = this.selectCandidates(prompt);

    if (candidates.length === 0) {
      return {
        canDispatch: false,
        alternatives: [],
        reason: "No suitable nanobot available",
        rejectionReason: "没有可用的 Nanobot 处理此任务",
      };
    }

    // 4. 根据负载均衡策略选择最佳 Nanobot
    const selected = this.selectByStrategy(candidates);
    const alternatives = candidates.filter((n) => n.did !== selected.did);

    // 5. 计算分配预算
    const estimate = this.costEstimator.estimate(prompt);
    const allocatedBudget = Math.min(
      estimate.estimatedCost * 1.5, // 增加 50% 缓冲
      this.config.maxTaskBudget
    );

    // 6. 计算预计完成时间
    const estimatedCompletionTime = new Date(
      Date.now() + estimate.estimatedDurationMs
    );

    return {
      canDispatch: true,
      targetNanobot: selected,
      alternatives,
      allocatedBudget,
      reason: `Selected ${selected.did} with ${selected.currentLoad} current load`,
      estimatedCompletionTime,
    };
  }

  /**
   * 选择候选 Nanobot
   */
  private selectCandidates(prompt: GenesisPrompt): NanobotCapabilities[] {
    const available = this.getAvailableNanobots();

    return available.filter((nanobot) => {
      // 检查任务类型支持
      if (!nanobot.supportedTaskTypes.includes(prompt.taskType)) {
        return false;
      }

      // 检查语言支持
      if (prompt.technical?.allowedLanguages) {
        const hasLanguage = prompt.technical.allowedLanguages.some((lang) =>
          nanobot.supportedLanguages.includes(lang)
        );
        if (!hasLanguage) return false;
      }

      // 检查标签匹配（如果有）
      if (prompt.tags && prompt.tags.length > 0) {
        // 标签匹配是可选加分项，不是必须
      }

      return true;
    });
  }

  /**
   * 根据策略选择 Nanobot
   */
  private selectByStrategy(candidates: NanobotCapabilities[]): NanobotCapabilities {
    switch (this.config.loadBalanceStrategy) {
      case "round_robin":
        // 简单轮询（基于 DID 排序）
        return candidates.sort((a, b) => a.did.localeCompare(b.did))[0];

      case "least_loaded":
        // 选择负载最低的
        return candidates.sort((a, b) => a.currentLoad - b.currentLoad)[0];

      case "performance":
        // 选择性能最好的
        return candidates.sort((a, b) => b.performanceScore - a.performanceScore)[0];

      case "random":
        // 随机选择
        return candidates[Math.floor(Math.random() * candidates.length)];

      default:
        return candidates[0];
    }
  }

  // ===========================================================================
  // 任务分发
  // ===========================================================================

  /**
   * 分发任务
   */
  async dispatch(
    prompt: GenesisPrompt
  ): Promise<{ success: boolean; decision: DispatchDecision; response?: GenesisPromptResponse }> {
    const decision = this.makeDispatchDecision(prompt);

    if (!decision.canDispatch) {
      this.emit("dispatch_failed", {
        promptId: prompt.id,
        reason: decision.rejectionReason,
      });

      return { success: false, decision };
    }

    // 预留预算
    if (decision.allocatedBudget) {
      this.reserveBudget(decision.allocatedBudget);
    }

    // 记录活动任务
    this.activeTasks.set(prompt.id, prompt);

    // 更新 Nanobot 负载
    if (decision.targetNanobot) {
      this.updateNanobotStatus(decision.targetNanobot.did, {
        currentLoad: decision.targetNanobot.currentLoad + 1,
      });
    }

    this.emit("dispatched", {
      type: "dispatched",
      promptId: prompt.id,
      nanobotDid: decision.targetNanobot?.did,
      timestamp: new Date(),
      metadata: { allocatedBudget: decision.allocatedBudget },
    });

    return { success: true, decision };
  }

  /**
   * 完成任务
   */
  completeTask(promptId: string, success: boolean, actualCost?: number): void {
    const prompt = this.activeTasks.get(promptId);
    if (!prompt) return;

    // 从活动任务中移除
    this.activeTasks.delete(promptId);

    // 提交预算
    if (actualCost) {
      this.commitReservedBudget(actualCost);
    }

    this.emit("completed", {
      type: success ? "completed" : "failed",
      promptId,
      timestamp: new Date(),
      metadata: { actualCost },
    });
  }

  /**
   * 获取活动任务数
   */
  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }

  /**
   * 获取项目上下文
   */
  getProjectContext(projectRoot: string): ProjectContext {
    return {
      projectId: `project-${Date.now()}`,
      projectName: "Current Project",
      projectRoot,
      primaryLanguage: "typescript",
      frameworks: [],
      dependencies: {},
      git: {
        branch: "main",
        commit: "latest",
        remote: "origin",
        isClean: true,
      },
      environment: {},
      customConfig: {},
    };
  }

  // ===========================================================================
  // 便捷方法
  // ===========================================================================

  /**
   * 创建并分发任务
   */
  async createAndDispatch(options: {
    id: string;
    taskType: GenesisTaskType;
    priority?: GenesisPriority;
    targetDid?: string;
    description: string;
    specification?: string;
    technical?: TechnicalConstraints;
    business?: BusinessTerms;
  }): Promise<{ success: boolean; prompt: GenesisPrompt; decision: DispatchDecision }> {
    const sourceDid = "did:anp:automaton:main";
    const targetDid = options.targetDid || "did:anp:nanobot:auto";

    const prompt = createGenesisPrompt({
      id: options.id,
      taskType: options.taskType,
      priority: options.priority,
      sourceDid,
      targetDid,
      description: options.description,
      specification: options.specification,
      technical: options.technical,
      business: options.business,
    });

    const result = await this.dispatch(prompt);
    return { success: result.success, prompt, decision: result.decision };
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建任务分发器
 */
export function createTaskDispatcher(
  config: Partial<DispatcherConfig> = {},
  initialBudget?: number
): TaskDispatcher {
  return new TaskDispatcher(config, initialBudget);
}

/**
 * 创建默认 Nanobot 能力
 */
export function createDefaultNanobotCapabilities(did: string): NanobotCapabilities {
  return {
    did,
    supportedTaskTypes: ["genesis", "analysis", "execution", "report", "maintenance", "custom"],
    supportedLanguages: ["typescript", "python", "javascript", "go"],
    maxConcurrentTasks: 3,
    currentLoad: 0,
    performanceScore: 80,
    availableMemoryMb: 1024,
    tags: [],
    lastHeartbeat: new Date(),
    isOnline: true,
  };
}
