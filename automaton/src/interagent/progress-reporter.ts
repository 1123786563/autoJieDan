/**
 * 进度报告系统
 * 实现实时进度追踪、报告聚合和历史记录
 *
 * @module interagent/progress-reporter
 * @version 1.0.0
 */

import { EventEmitter } from "events";

// ============================================================================
// 类型定义
// ============================================================================

/** 进度状态 */
export type ProgressStatus =
  | "not_started"
  | "in_progress"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/** 进度里程碑状态 */
export type MilestoneStatus = "pending" | "in_progress" | "completed" | "skipped";

/** 进度事件类型 */
export type ProgressEventType =
  | "started"
  | "progress_update"
  | "milestone_reached"
  | "milestone_completed"
  | "paused"
  | "resumed"
  | "completed"
  | "failed"
  | "cancelled"
  | "eta_updated";

/** 进度里程碑 */
export interface ProgressMilestone {
  /** 里程碑 ID */
  id: string;
  /** 名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 目标百分比 (0-100) */
  targetPercentage: number;
  /** 当前状态 */
  status: MilestoneStatus;
  /** 开始时间 */
  startedAt?: Date;
  /** 完成时间 */
  completedAt?: Date;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/** 进度更新 */
export interface ProgressUpdate {
  /** 百分比 (0-100) */
  percentage: number;
  /** 消息 */
  message?: string;
  /** 当前步骤 */
  currentStep?: string;
  /** 总步骤数 */
  totalSteps?: number;
  /** 已完成步骤 */
  completedSteps?: number;
  /** 处理的项目数 */
  itemsProcessed?: number;
  /** 总项目数 */
  totalItems?: number;
  /** 已用时间（毫秒） */
  elapsedMs?: number;
  /** 预计剩余时间（毫秒） */
  etaMs?: number;
  /** 资源使用 */
  resources?: ResourceUsage;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/** 资源使用 */
export interface ResourceUsage {
  /** CPU 使用率 (%) */
  cpuPercent?: number;
  /** 内存使用 (MB) */
  memoryMb?: number;
  /** 网络流量 (bytes) */
  networkBytes?: number;
  /** Token 使用量 */
  tokensUsed?: number;
  /** API 调用次数 */
  apiCalls?: number;
  /** 自定义指标 */
  custom?: Record<string, number>;
}

/** 进度报告 */
export interface ProgressReport {
  /** 任务 ID */
  taskId: string;
  /** 状态 */
  status: ProgressStatus;
  /** 百分比 */
  percentage: number;
  /** 消息 */
  message?: string;
  /** 当前步骤 */
  currentStep?: string;
  /** 步骤进度 */
  stepProgress?: {
    current: number;
    total: number;
  };
  /** 项目进度 */
  itemProgress?: {
    processed: number;
    total: number;
  };
  /** 时间信息 */
  timing: {
    startedAt?: Date;
    updatedAt: Date;
    elapsedMs: number;
    etaMs?: number;
    estimatedTotalMs?: number;
  };
  /** 里程碑 */
  milestones: ProgressMilestone[];
  /** 资源使用 */
  resources: ResourceUsage;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/** 进度事件 */
export interface ProgressEvent {
  /** 事件类型 */
  type: ProgressEventType;
  /** 任务 ID */
  taskId: string;
  /** 时间戳 */
  timestamp: Date;
  /** 进度更新数据 */
  update?: ProgressUpdate;
  /** 里程碑 */
  milestone?: ProgressMilestone;
  /** 状态 */
  status?: ProgressStatus;
  /** 消息 */
  message?: string;
}

/** 进度历史记录 */
export interface ProgressHistoryEntry {
  /** 任务 ID */
  taskId: string;
  /** 时间戳 */
  timestamp: Date;
  /** 百分比 */
  percentage: number;
  /** 消息 */
  message?: string;
  /** 状态 */
  status: ProgressStatus;
  /** 资源使用 */
  resources?: ResourceUsage;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/** 进度追踪器配置 */
export interface ProgressTrackerConfig {
  /** 更新间隔（毫秒） */
  updateIntervalMs: number;
  /** 历史记录保留数量 */
  maxHistoryEntries: number;
  /** 是否自动计算 ETA */
  autoCalculateEta: boolean;
  /** ETA 计算窗口大小 */
  etaWindowSize: number;
  /** 是否记录资源使用 */
  trackResources: boolean;
}

/** 聚合报告 */
export interface AggregatedReport {
  /** 生成时间 */
  generatedAt: Date;
  /** 时间范围 */
  timeRange: {
    from: Date;
    to: Date;
  };
  /** 总任务数 */
  totalTasks: number;
  /** 各状态任务数 */
  byStatus: Record<ProgressStatus, number>;
  /** 平均完成率 */
  averageCompletion: number;
  /** 平均完成时间（毫秒） */
  averageDurationMs: number;
  /** 总资源使用 */
  totalResources: ResourceUsage;
  /** 任务报告列表 */
  tasks: ProgressReport[];
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_TRACKER_CONFIG: ProgressTrackerConfig = {
  updateIntervalMs: 1000,
  maxHistoryEntries: 1000,
  autoCalculateEta: true,
  etaWindowSize: 10,
  trackResources: true,
};

// ============================================================================
// 进度追踪器
// ============================================================================

/**
 * 进度追踪器
 * 追踪单个任务的实时进度
 */
export class ProgressTracker extends EventEmitter {
  private taskId: string;
  private config: ProgressTrackerConfig;
  private status: ProgressStatus = "not_started";
  private percentage: number = 0;
  private message?: string;
  private currentStep?: string;
  private stepProgress?: { current: number; total: number };
  private itemProgress?: { processed: number; total: number };
  private startedAt?: Date;
  private updatedAt: Date;
  private milestones: Map<string, ProgressMilestone> = new Map();
  private history: ProgressHistoryEntry[] = [];
  private resources: ResourceUsage = {};
  private metadata: Record<string, unknown> = {};
  private etaHistory: Array<{ percentage: number; timestamp: Date }> = [];

  constructor(taskId: string, config: Partial<ProgressTrackerConfig> = {}) {
    super();
    this.taskId = taskId;
    this.config = { ...DEFAULT_TRACKER_CONFIG, ...config };
    this.updatedAt = new Date();
  }

  // ===========================================================================
  // 进度控制
  // ===========================================================================

  /**
   * 开始任务
   */
  start(initialMessage?: string): void {
    this.status = "in_progress";
    this.startedAt = new Date();
    this.updatedAt = new Date();
    this.message = initialMessage || "Task started";

    this.emitEvent("started", { message: this.message });
    this.recordHistory();
  }

  /**
   * 更新进度
   */
  update(update: Partial<ProgressUpdate>): void {
    if (this.status !== "in_progress") {
      return;
    }

    const now = new Date();
    this.updatedAt = now;

    // 更新百分比
    if (update.percentage !== undefined) {
      this.percentage = Math.max(0, Math.min(100, update.percentage));
    }

    // 更新消息
    if (update.message !== undefined) {
      this.message = update.message;
    }

    // 更新步骤
    if (update.currentStep !== undefined) {
      this.currentStep = update.currentStep;
    }
    if (update.totalSteps !== undefined && update.completedSteps !== undefined) {
      this.stepProgress = {
        current: update.completedSteps,
        total: update.totalSteps,
      };
    }

    // 更新项目进度
    if (update.itemsProcessed !== undefined && update.totalItems !== undefined) {
      this.itemProgress = {
        processed: update.itemsProcessed,
        total: update.totalItems,
      };
    }

    // 更新资源使用
    if (update.resources) {
      this.resources = { ...this.resources, ...update.resources };
    }

    // 更新元数据
    if (update.metadata) {
      this.metadata = { ...this.metadata, ...update.metadata };
    }

    // 计算和更新 ETA
    let etaMs: number | undefined;
    if (this.config.autoCalculateEta) {
      etaMs = this.calculateEta();
    }

    this.emitEvent("progress_update", {
      update: {
        percentage: this.percentage,
        message: this.message,
        currentStep: this.currentStep,
        elapsedMs: this.getElapsedMs(),
        etaMs,
        metadata: this.metadata,
      },
    });

    this.recordHistory();
  }

  /**
   * 设置里程碑
   */
  setMilestones(milestones: Array<Omit<ProgressMilestone, "id" | "status" | "metadata">>): void {
    milestones.forEach((m, index) => {
      const milestone: ProgressMilestone = {
        id: `milestone-${index + 1}`,
        name: m.name,
        description: m.description,
        targetPercentage: m.targetPercentage,
        status: "pending",
        metadata: {},
      };
      this.milestones.set(milestone.id, milestone);
    });
  }

  /**
   * 完成里程碑
   */
  completeMilestone(milestoneId: string): boolean {
    const milestone = this.milestones.get(milestoneId);
    if (!milestone) return false;

    milestone.status = "completed";
    milestone.completedAt = new Date();

    this.emitEvent("milestone_completed", { milestone });

    return true;
  }

  /**
   * 检查并触发里程碑
   */
  private checkMilestones(): void {
    for (const milestone of this.milestones.values()) {
      if (
        milestone.status === "pending" &&
        this.percentage >= milestone.targetPercentage
      ) {
        milestone.status = "in_progress";
        milestone.startedAt = new Date();
        milestone.status = "completed";
        milestone.completedAt = new Date();

        this.emitEvent("milestone_reached", { milestone });
        this.emitEvent("milestone_completed", { milestone });
      }
    }
  }

  /**
   * 暂停任务
   */
  pause(reason?: string): void {
    if (this.status !== "in_progress") return;

    this.status = "paused";
    this.message = reason || "Task paused";

    this.emitEvent("paused", { message: this.message });
    this.recordHistory();
  }

  /**
   * 恢复任务
   */
  resume(): void {
    if (this.status !== "paused") return;

    this.status = "in_progress";
    this.message = "Task resumed";

    this.emitEvent("resumed", { message: this.message });
  }

  /**
   * 完成任务
   */
  complete(finalMessage?: string): void {
    this.status = "completed";
    this.percentage = 100;
    this.message = finalMessage || "Task completed successfully";
    this.updatedAt = new Date();

    this.emitEvent("completed", { message: this.message });
    this.recordHistory();
  }

  /**
   * 失败任务
   */
  fail(error: string): void {
    this.status = "failed";
    this.message = error;
    this.updatedAt = new Date();

    this.emitEvent("failed", { message: error });
    this.recordHistory();
  }

  /**
   * 取消任务
   */
  cancel(reason?: string): void {
    this.status = "cancelled";
    this.message = reason || "Task cancelled";
    this.updatedAt = new Date();

    this.emitEvent("cancelled", { message: this.message });
    this.recordHistory();
  }

  // ===========================================================================
  // 查询方法
  // ===========================================================================

  /**
   * 获取当前报告
   */
  getReport(): ProgressReport {
    return {
      taskId: this.taskId,
      status: this.status,
      percentage: this.percentage,
      message: this.message,
      currentStep: this.currentStep,
      stepProgress: this.stepProgress,
      itemProgress: this.itemProgress,
      timing: {
        startedAt: this.startedAt,
        updatedAt: this.updatedAt,
        elapsedMs: this.getElapsedMs(),
        etaMs: this.calculateEta(),
        estimatedTotalMs: this.calculateEstimatedTotal(),
      },
      milestones: Array.from(this.milestones.values()),
      resources: this.resources,
      metadata: this.metadata,
    };
  }

  /**
   * 获取历史记录
   */
  getHistory(limit?: number): ProgressHistoryEntry[] {
    const entries = [...this.history];
    if (limit) {
      return entries.slice(-limit);
    }
    return entries;
  }

  /**
   * 获取状态
   */
  getStatus(): ProgressStatus {
    return this.status;
  }

  /**
   * 获取百分比
   */
  getPercentage(): number {
    return this.percentage;
  }

  /**
   * 是否已完成
   */
  isCompleted(): boolean {
    return this.status === "completed";
  }

  /**
   * 是否失败
   */
  isFailed(): boolean {
    return this.status === "failed";
  }

  /**
   * 是否终止状态
   */
  isTerminal(): boolean {
    return ["completed", "failed", "cancelled"].includes(this.status);
  }

  // ===========================================================================
  // 内部方法
  // ===========================================================================

  private getElapsedMs(): number {
    if (!this.startedAt) return 0;
    return Date.now() - this.startedAt.getTime();
  }

  private calculateEta(): number | undefined {
    if (this.percentage <= 0 || this.percentage >= 100) {
      return undefined;
    }

    // 记录历史点用于 ETA 计算
    this.etaHistory.push({
      percentage: this.percentage,
      timestamp: new Date(),
    });

    // 限制历史窗口大小
    if (this.etaHistory.length > this.config.etaWindowSize) {
      this.etaHistory.shift();
    }

    if (this.etaHistory.length < 2) {
      return undefined;
    }

    // 计算进度速率
    const first = this.etaHistory[0];
    const last = this.etaHistory[this.etaHistory.length - 1];

    const percentageDelta = last.percentage - first.percentage;
    const timeDeltaMs = last.timestamp.getTime() - first.timestamp.getTime();

    if (percentageDelta <= 0 || timeDeltaMs <= 0) {
      return undefined;
    }

    // 计算剩余百分比需要的预估时间
    const remainingPercentage = 100 - this.percentage;
    const rate = percentageDelta / timeDeltaMs; // 百分比/毫秒
    const etaMs = remainingPercentage / rate;

    return Math.round(etaMs);
  }

  private calculateEstimatedTotal(): number | undefined {
    const etaMs = this.calculateEta();
    if (etaMs === undefined) return undefined;

    return this.getElapsedMs() + etaMs;
  }

  private emitEvent(type: ProgressEventType, data: Partial<ProgressEvent> = {}): void {
    const event: ProgressEvent = {
      type,
      taskId: this.taskId,
      timestamp: new Date(),
      ...data,
    };

    this.emit(type, event);
    this.emit("progress", event);
  }

  private recordHistory(): void {
    const entry: ProgressHistoryEntry = {
      taskId: this.taskId,
      timestamp: new Date(),
      percentage: this.percentage,
      message: this.message,
      status: this.status,
      resources: this.config.trackResources ? { ...this.resources } : undefined,
      metadata: { ...this.metadata },
    };

    this.history.push(entry);

    // 限制历史记录大小
    if (this.history.length > this.config.maxHistoryEntries) {
      this.history = this.history.slice(-this.config.maxHistoryEntries);
    }
  }
}

// ============================================================================
// 进度报告聚合器
// ============================================================================

/**
 * 进度报告聚合器
 * 聚合多个任务的进度报告
 */
export class ProgressAggregator extends EventEmitter {
  private trackers: Map<string, ProgressTracker> = new Map();
  private config: ProgressTrackerConfig;
  private globalHistory: ProgressHistoryEntry[] = [];

  constructor(config: Partial<ProgressTrackerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_TRACKER_CONFIG, ...config };
  }

  // ===========================================================================
  // 追踪器管理
  // ===========================================================================

  /**
   * 创建追踪器
   */
  createTracker(taskId: string): ProgressTracker {
    if (this.trackers.has(taskId)) {
      return this.trackers.get(taskId)!;
    }

    const tracker = new ProgressTracker(taskId, this.config);

    // 转发事件
    tracker.on("progress", (event: ProgressEvent) => {
      this.emit("task_progress", event);
    });

    this.trackers.set(taskId, tracker);
    this.emit("tracker_created", { taskId });

    return tracker;
  }

  /**
   * 获取追踪器
   */
  getTracker(taskId: string): ProgressTracker | undefined {
    return this.trackers.get(taskId);
  }

  /**
   * 移除追踪器
   */
  removeTracker(taskId: string): boolean {
    const tracker = this.trackers.get(taskId);
    if (tracker) {
      tracker.removeAllListeners();
      this.trackers.delete(taskId);
      this.emit("tracker_removed", { taskId });
      return true;
    }
    return false;
  }

  /**
   * 获取所有追踪器
   */
  getAllTrackers(): ProgressTracker[] {
    return Array.from(this.trackers.values());
  }

  // ===========================================================================
  // 报告生成
  // ===========================================================================

  /**
   * 获取单个任务报告
   */
  getTaskReport(taskId: string): ProgressReport | undefined {
    return this.trackers.get(taskId)?.getReport();
  }

  /**
   * 获取所有任务报告
   */
  getAllReports(): ProgressReport[] {
    return Array.from(this.trackers.values()).map((t) => t.getReport());
  }

  /**
   * 获取聚合报告
   */
  getAggregatedReport(
    timeRange?: { from: Date; to: Date },
    filter?: { status?: ProgressStatus | ProgressStatus[] }
  ): AggregatedReport {
    let reports = this.getAllReports();

    // 状态过滤
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      reports = reports.filter((r) => statuses.includes(r.status));
    }

    // 计算统计数据
    const byStatus: Record<ProgressStatus, number> = {
      not_started: 0,
      in_progress: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    let totalCompletion = 0;
    let totalDuration = 0;
    let durationCount = 0;

    const totalResources: ResourceUsage = {
      cpuPercent: 0,
      memoryMb: 0,
      networkBytes: 0,
      tokensUsed: 0,
      apiCalls: 0,
    };

    for (const report of reports) {
      byStatus[report.status]++;
      totalCompletion += report.percentage;

      if (report.timing.elapsedMs > 0) {
        totalDuration += report.timing.elapsedMs;
        durationCount++;
      }

      // 聚合资源使用
      if (report.resources.cpuPercent) {
        totalResources.cpuPercent! += report.resources.cpuPercent;
      }
      if (report.resources.memoryMb) {
        totalResources.memoryMb! += report.resources.memoryMb;
      }
      if (report.resources.networkBytes) {
        totalResources.networkBytes! += report.resources.networkBytes;
      }
      if (report.resources.tokensUsed) {
        totalResources.tokensUsed! += report.resources.tokensUsed;
      }
      if (report.resources.apiCalls) {
        totalResources.apiCalls! += report.resources.apiCalls;
      }
    }

    const now = new Date();
    return {
      generatedAt: now,
      timeRange: timeRange || {
        from: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        to: now,
      },
      totalTasks: reports.length,
      byStatus,
      averageCompletion: reports.length > 0 ? totalCompletion / reports.length : 0,
      averageDurationMs: durationCount > 0 ? totalDuration / durationCount : 0,
      totalResources,
      tasks: reports,
    };
  }

  /**
   * 获取进行中的任务
   */
  getInProgressTasks(): ProgressReport[] {
    return this.getAllReports().filter((r) => r.status === "in_progress");
  }

  /**
   * 获取最近完成的任务
   */
  getRecentlyCompleted(limit: number = 10): ProgressReport[] {
    return this.getAllReports()
      .filter((r) => r.status === "completed")
      .sort((a, b) => b.timing.updatedAt.getTime() - a.timing.updatedAt.getTime())
      .slice(0, limit);
  }

  /**
   * 获取失败的任务
   */
  getFailedTasks(): ProgressReport[] {
    return this.getAllReports().filter((r) => r.status === "failed");
  }

  // ===========================================================================
  // 历史记录
  // ===========================================================================

  /**
   * 记录全局历史
   */
  recordGlobalHistory(entry: ProgressHistoryEntry): void {
    this.globalHistory.push(entry);

    if (this.globalHistory.length > this.config.maxHistoryEntries * 10) {
      this.globalHistory = this.globalHistory.slice(-this.config.maxHistoryEntries * 10);
    }
  }

  /**
   * 获取全局历史
   */
  getGlobalHistory(
    filter?: {
      taskId?: string;
      status?: ProgressStatus;
      from?: Date;
      to?: Date;
    },
    limit?: number
  ): ProgressHistoryEntry[] {
    let entries = [...this.globalHistory];

    if (filter?.taskId) {
      entries = entries.filter((e) => e.taskId === filter.taskId);
    }
    if (filter?.status) {
      entries = entries.filter((e) => e.status === filter.status);
    }
    if (filter?.from) {
      entries = entries.filter((e) => e.timestamp >= filter.from!);
    }
    if (filter?.to) {
      entries = entries.filter((e) => e.timestamp <= filter.to!);
    }

    if (limit) {
      return entries.slice(-limit);
    }

    return entries;
  }

  // ===========================================================================
  // 清理
  // ===========================================================================

  /**
   * 清理已完成的追踪器
   */
  cleanupCompleted(): number {
    let cleaned = 0;
    for (const [taskId, tracker] of this.trackers) {
      if (tracker.isTerminal()) {
        // 保存到全局历史
        const report = tracker.getReport();
        this.recordGlobalHistory({
          taskId,
          timestamp: new Date(),
          percentage: report.percentage,
          message: report.message,
          status: report.status,
          resources: report.resources,
          metadata: report.metadata,
        });

        this.removeTracker(taskId);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * 清空所有追踪器
   */
  clear(): void {
    for (const tracker of this.trackers.values()) {
      tracker.removeAllListeners();
    }
    this.trackers.clear();
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建进度追踪器
 */
export function createProgressTracker(
  taskId: string,
  config: Partial<ProgressTrackerConfig> = {}
): ProgressTracker {
  return new ProgressTracker(taskId, config);
}

/**
 * 创建进度聚合器
 */
export function createProgressAggregator(
  config: Partial<ProgressTrackerConfig> = {}
): ProgressAggregator {
  return new ProgressAggregator(config);
}

// ============================================================================
// 格式化函数
// ============================================================================

/**
 * 格式化进度状态
 */
export function formatProgressStatus(status: ProgressStatus): string {
  const statusMap: Record<ProgressStatus, string> = {
    not_started: "未开始",
    in_progress: "进行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "已失败",
    cancelled: "已取消",
  };
  return statusMap[status] || status;
}

/**
 * 格式化持续时间
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  if (ms < 3600000) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.round((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

/**
 * 格式化进度条
 */
export function formatProgressBar(
  percentage: number,
  width: number = 20,
  filled: string = "█",
  empty: string = "░"
): string {
  const filledCount = Math.round((percentage / 100) * width);
  const emptyCount = width - filledCount;
  return filled.repeat(filledCount) + empty.repeat(emptyCount);
}

/**
 * 格式化完整进度报告
 */
export function formatProgressReport(report: ProgressReport): string {
  const lines = [
    `Task: ${report.taskId}`,
    `Status: ${formatProgressStatus(report.status)}`,
    `Progress: ${report.percentage.toFixed(1)}% ${formatProgressBar(report.percentage)}`,
  ];

  if (report.message) {
    lines.push(`Message: ${report.message}`);
  }

  if (report.currentStep) {
    lines.push(`Current Step: ${report.currentStep}`);
  }

  if (report.stepProgress) {
    lines.push(`Steps: ${report.stepProgress.current}/${report.stepProgress.total}`);
  }

  if (report.itemProgress) {
    lines.push(`Items: ${report.itemProgress.processed}/${report.itemProgress.total}`);
  }

  lines.push(`Elapsed: ${formatDuration(report.timing.elapsedMs)}`);

  if (report.timing.etaMs) {
    lines.push(`ETA: ${formatDuration(report.timing.etaMs)}`);
  }

  if (report.resources.tokensUsed) {
    lines.push(`Tokens: ${report.resources.tokensUsed.toLocaleString()}`);
  }

  if (report.resources.apiCalls) {
    lines.push(`API Calls: ${report.resources.apiCalls}`);
  }

  return lines.join("\n");
}
