/**
 * 任务生命周期管理
 * 处理任务的状态转换、完成和失败
 *
 * @module interagent/task-lifecycle
 * @version 1.0.0
 */

import { EventEmitter } from "events";

// ============================================================================
// 类型定义
// ============================================================================

/** 任务状态 */
export type TaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** 任务优先级 */
export type TaskPriority = "critical" | "high" | "normal" | "low" | "background";

/** 任务类型 */
export type TaskType =
  | "genesis"
  | "analysis"
  | "execution"
  | "report"
  | "maintenance"
  | "custom";

/** 状态转换结果 */
export interface TransitionResult {
  success: boolean;
  from: TaskStatus;
  to: TaskStatus;
  timestamp: Date;
  error?: string;
}

/** 任务完成数据 */
export interface CompletionData {
  result?: Record<string, unknown>;
  output?: string;
  artifacts?: TaskArtifact[];
  metrics?: TaskMetrics;
}

/** 任务失败数据 */
export interface FailureData {
  error: string;
  errorCode?: string;
  stack?: string;
  recoverable: boolean;
  retryable: boolean;
  context?: Record<string, unknown>;
}

/** 任务产物 */
export interface TaskArtifact {
  name: string;
  type: string;
  path?: string;
  content?: string;
  size?: number;
  mimeType?: string;
}

/** 任务指标 */
export interface TaskMetrics {
  tokensUsed?: number;
  apiCalls?: number;
  processingTimeMs?: number;
  memoryUsedMb?: number;
  custom?: Record<string, number>;
}

/** 任务结果 */
export interface TaskResult {
  success: boolean;
  status: TaskStatus;
  completedAt: Date;
  durationMs: number;
  result?: Record<string, unknown>;
  error?: string;
  artifacts?: TaskArtifact[];
  metrics?: TaskMetrics;
}

/** 生命周期钩子 */
export interface LifecycleHooks {
  onStarting?: (task: TaskContext) => void | Promise<void>;
  onStarted?: (task: TaskContext) => void | Promise<void>;
  onCompleting?: (task: TaskContext, data: CompletionData) => void | Promise<void>;
  onCompleted?: (task: TaskContext, result: TaskResult) => void | Promise<void>;
  onFailing?: (task: TaskContext, data: FailureData) => void | Promise<void>;
  onFailed?: (task: TaskContext, result: TaskResult) => void | Promise<void>;
  onCancelling?: (task: TaskContext, reason: string) => void | Promise<void>;
  onCancelled?: (task: TaskContext, result: TaskResult) => void | Promise<void>;
}

/** 任务上下文 */
export interface TaskContext {
  id: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  sourceDid: string;
  targetDid: string;
  input: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
  maxRetries: number;
  error?: string;
  errorCode?: string;
  result?: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

// ============================================================================
// 状态转换
// ============================================================================

/** 有效状态转换 */
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["queued", "running", "cancelled"],
  queued: ["running", "pending", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["pending", "queued"],
  cancelled: [],
};

/**
 * 检查状态转换是否有效
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 获取有效目标状态
 */
export function getValidTransitions(from: TaskStatus): TaskStatus[] {
  return VALID_TRANSITIONS[from] ?? [];
}

/**
 * 是否为终态
 */
export function isTerminalState(status: TaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

// ============================================================================
// 任务生命周期管理器
// ============================================================================

/**
 * 任务生命周期管理器
 * 管理任务的状态转换和生命周期事件
 */
export class TaskLifecycleManager extends EventEmitter {
  private hooks: LifecycleHooks;
  private context: TaskContext;
  private _transitionHistory: Array<{ from: TaskStatus; to: TaskStatus; timestamp: Date }> = [];

  constructor(task: TaskContext, hooks: LifecycleHooks = {}) {
    super();
    this.context = { ...task };
    this.hooks = hooks;
  }

  // ===========================================================================
  // 状态转换
  // ===========================================================================

  /**
   * 启动任务
   */
  async start(): Promise<TransitionResult> {
    const transition = this.transition("running");

    if (transition.success) {
      this.context.startedAt = new Date();

      // 执行钩子
      await this.hooks.onStarting?.(this.context);
      await this.hooks.onStarted?.(this.context);

      this.emit("started", { task: this.context, timestamp: new Date() });
    }

    return transition;
  }

  /**
   * 完成任务
   */
  async complete(data: CompletionData = {}): Promise<TaskResult> {
    const transition = this.transition("completed");

    if (!transition.success) {
      return this.createFailedResult(transition.error || "Invalid transition");
    }

    this.context.completedAt = new Date();
    this.context.result = data.result;

    // 执行钩子
    await this.hooks.onCompleting?.(this.context, data);

    const result = this.createResult(true, data);

    await this.hooks.onCompleted?.(this.context, result);

    this.emit("completed", { task: this.context, result, timestamp: new Date() });

    return result;
  }

  /**
   * 失败任务
   */
  async fail(data: FailureData): Promise<TaskResult> {
    const transition = this.transition("failed");

    if (!transition.success) {
      // 即使转换失败，也返回结果
      return this.createFailedResult(transition.error || "Invalid transition");
    }

    this.context.completedAt = new Date();
    this.context.error = data.error;
    this.context.errorCode = data.errorCode;

    // 执行钩子
    await this.hooks.onFailing?.(this.context, data);

    const result: TaskResult = {
      success: false,
      status: "failed",
      completedAt: this.context.completedAt,
      durationMs: this.getDurationMs(),
      error: data.error,
    };

    await this.hooks.onFailed?.(this.context, result);

    this.emit("failed", { task: this.context, result, data, timestamp: new Date() });

    return result;
  }

  /**
   * 取消任务
   */
  async cancel(reason: string): Promise<TaskResult> {
    const transition = this.transition("cancelled");

    if (!transition.success) {
      return this.createFailedResult(transition.error || "Invalid transition");
    }

    this.context.completedAt = new Date();
    this.context.error = reason;

    // 执行钩子
    await this.hooks.onCancelling?.(this.context, reason);

    const result: TaskResult = {
      success: false,
      status: "cancelled",
      completedAt: this.context.completedAt,
      durationMs: this.getDurationMs(),
      error: reason,
    };

    await this.hooks.onCancelled?.(this.context, result);

    this.emit("cancelled", { task: this.context, result, reason, timestamp: new Date() });

    return result;
  }

  /**
   * 重试任务
   */
  async retry(): Promise<TransitionResult> {
    if (this.context.retryCount >= this.context.maxRetries) {
      return {
        success: false,
        from: this.context.status,
        to: "pending",
        timestamp: new Date(),
        error: "Max retries exceeded",
      };
    }

    const transition = this.transition("pending");

    if (transition.success) {
      this.context.retryCount++;
      this.context.error = undefined;
      this.context.errorCode = undefined;
      this.context.completedAt = undefined;

      this.emit("retrying", {
        task: this.context,
        retryCount: this.context.retryCount,
        timestamp: new Date(),
      });
    }

    return transition;
  }

  // ===========================================================================
  // 查询方法
  // ===========================================================================

  getContext(): TaskContext {
    return { ...this.context };
  }

  getStatus(): TaskStatus {
    return this.context.status;
  }

  isRunning(): boolean {
    return this.context.status === "running";
  }

  isCompleted(): boolean {
    return this.context.status === "completed";
  }

  isFailed(): boolean {
    return this.context.status === "failed";
  }

  isCancelled(): boolean {
    return this.context.status === "cancelled";
  }

  isTerminal(): boolean {
    return isTerminalState(this.context.status);
  }

  canRetry(): boolean {
    return this.context.retryCount < this.context.maxRetries && this.context.status === "failed";
  }

  /**
   * 获取转换历史
   */
  getTransitionHistory(): Array<{ from: TaskStatus; to: TaskStatus; timestamp: Date }> {
    return [...this._transitionHistory];
  }

  // ===========================================================================
  // 内部方法
  // ===========================================================================

  private transition(to: TaskStatus): TransitionResult {
    const from = this.context.status;
    const now = new Date();

    if (!canTransition(from, to)) {
      return {
        success: false,
        from,
        to,
        timestamp: now,
        error: `Invalid transition from ${from} to ${to}`,
      };
    }

    this.context.status = to;
    this.context.updatedAt = now;

    // 记录转换历史
    this._transitionHistory.push({ from, to, timestamp: now });

    this.emit("transition", { from, to, timestamp: now });

    return { success: true, from, to, timestamp: now };
  }

  private getDurationMs(): number {
    if (!this.context.startedAt) return 0;
    const end = this.context.completedAt || new Date();
    return end.getTime() - this.context.startedAt.getTime();
  }

  private createResult(success: boolean, data: CompletionData = {}): TaskResult {
    return {
      success,
      status: this.context.status,
      completedAt: this.context.completedAt!,
      durationMs: this.getDurationMs(),
      result: data.result,
      artifacts: data.artifacts,
      metrics: data.metrics,
    };
  }

  private createFailedResult(error: string): TaskResult {
    return {
      success: false,
      status: this.context.status,
      completedAt: new Date(),
      durationMs: this.getDurationMs(),
      error,
    };
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 格式化任务状态
 */
export function formatStatus(status: TaskStatus): string {
  const statusMap: Record<TaskStatus, string> = {
    pending: "待处理",
    queued: "已入队",
    running: "执行中",
    completed: "已完成",
    failed: "已失败",
    cancelled: "已取消",
  };
  return statusMap[status] || status;
}

/**
 * 获取状态颜色
 */
export function getStatusColor(status: TaskStatus): string {
  const colorMap: Record<TaskStatus, string> = {
    pending: "yellow",
    queued: "blue",
    running: "cyan",
    completed: "green",
    failed: "red",
    cancelled: "gray",
  };
  return colorMap[status] || "white";
}

/**
 * 创建错误码
 */
export function createErrorCode(
  category: string,
  code: number,
  message: string
): string {
  return `${category.toUpperCase()}_${String(code).padStart(3, "0")}: ${message}`;
}

/**
 * 解析错误码
 */
export function parseErrorCode(errorCode: string): {
  category: string;
  code: number;
  message: string;
} | null {
  const match = errorCode.match(/^([A-Z]+)_(\d{3}):\s*(.+)$/);
  if (!match) return null;

  return {
    category: match[1],
    code: parseInt(match[2], 10),
    message: match[3],
  };
}

// 预定义错误码
export const ErrorCodes = {
  // 验证错误 (1xx)
  INVALID_INPUT: createErrorCode("VALIDATION", 101, "Invalid input"),
  MISSING_FIELD: createErrorCode("VALIDATION", 102, "Missing required field"),
  INVALID_FORMAT: createErrorCode("VALIDATION", 103, "Invalid format"),

  // 执行错误 (2xx)
  EXECUTION_FAILED: createErrorCode("EXECUTION", 201, "Execution failed"),
  TIMEOUT: createErrorCode("EXECUTION", 202, "Operation timed out"),
  RESOURCE_UNAVAILABLE: createErrorCode("EXECUTION", 203, "Resource unavailable"),

  // 系统错误 (3xx)
  INTERNAL_ERROR: createErrorCode("SYSTEM", 301, "Internal error"),
  OUT_OF_MEMORY: createErrorCode("SYSTEM", 302, "Out of memory"),
  NETWORK_ERROR: createErrorCode("SYSTEM", 303, "Network error"),
} as const;
