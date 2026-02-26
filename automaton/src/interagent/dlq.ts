/**
 * 死信队列 (Dead Letter Queue)
 * 存储和处理失败的任务
 *
 * @module interagent/dlq
 * @version 1.0.0
 */

import { EventEmitter } from "events";

// ============================================================================
// 类型定义
// ============================================================================

/** DLQ 条目状态 */
export type DLQEntryStatus =
  | "pending"     // 待处理
  | "reviewed"    // 已审查
  | "retried"     // 已重试
  | "discarded"   // 已丢弃
  | "archived";   // 已归档

/** DLQ 条目来源 */
export type DLQEntrySource = "task_queue" | "timeout" | "validation" | "system" | "unknown";

/** DLQ 条目 */
export interface DLQEntry {
  /** 条目 ID */
  id: string;
  /** 原始任务 ID */
  originalTaskId: string;
  /** 原始任务数据 */
  originalTask: Record<string, unknown>;
  /** 错误信息 */
  error: string;
  /** 错误码 */
  errorCode?: string;
  /** 错误堆栈 */
  stack?: string;
  /** 失败来源 */
  source: DLQEntrySource;
  /** 重试次数 */
  retryCount: number;
  /** 入队时间 */
  enqueuedAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
  /** 状态 */
  status: DLQEntryStatus;
  /** 审查备注 */
  reviewNotes?: string;
  /** 审查人 */
  reviewedBy?: string;
  /** 审查时间 */
  reviewedAt?: Date;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/** DLQ 配置 */
export interface DLQConfig {
  /** 最大容量 */
  maxSize: number;
  /** 保留时间（毫秒） */
  retentionMs: number;
  /** 是否启用自动清理 */
  autoCleanup: boolean;
  /** 清理间隔（毫秒） */
  cleanupIntervalMs: number;
  /** 是否启用自动重试 */
  autoRetry: boolean;
  /** 自动重试延迟（毫秒） */
  autoRetryDelayMs: number;
}

/** DLQ 统计 */
export interface DLQStats {
  /** 总条目数 */
  total: number;
  /** 各状态计数 */
  byStatus: Record<DLQEntryStatus, number>;
  /** 各来源计数 */
  bySource: Record<DLQEntrySource, number>;
  /** 今日新增 */
  addedToday: number;
  /** 今日重试成功 */
  retriedToday: number;
  /** 今日丢弃 */
  discardedToday: number;
  /** 平均重试次数 */
  avgRetryCount: number;
}

/** DLQ 事件 */
export interface DLQEvent {
  type: "enqueued" | "dequeued" | "retried" | "discarded" | "archived" | "cleaned";
  entry: DLQEntry;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/** DLQ 过滤器 */
export interface DLQFilter {
  /** 状态过滤 */
  status?: DLQEntryStatus | DLQEntryStatus[];
  /** 来源过滤 */
  source?: DLQEntrySource | DLQEntrySource[];
  /** 最小重试次数 */
  minRetryCount?: number;
  /** 最大重试次数 */
  maxRetryCount?: number;
  /** 开始时间 */
  from?: Date;
  /** 结束时间 */
  to?: Date;
  /** 错误关键词 */
  errorContains?: string;
  /** 限制数量 */
  limit?: number;
  /** 偏移量 */
  offset?: number;
}

// ============================================================================
// 默认配置
// ============================================================================

/** 默认 DLQ 配置 */
export const DEFAULT_DLQ_CONFIG: DLQConfig = {
  maxSize: 10000,
  retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 天
  autoCleanup: true,
  cleanupIntervalMs: 24 * 60 * 60 * 1000, // 1 天
  autoRetry: false,
  autoRetryDelayMs: 60000, // 1 分钟
};

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `dlq-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// 死信队列管理器
// ============================================================================

/**
 * 死信队列管理器
 * 管理失败任务的存储、审查和重试
 */
export class DeadLetterQueue extends EventEmitter {
  private config: DLQConfig;
  private entries: Map<string, DLQEntry> = new Map();
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private stats: {
    addedToday: number;
    retriedToday: number;
    discardedToday: number;
    lastReset: Date;
  };

  constructor(config: Partial<DLQConfig> = {}) {
    super();
    this.config = { ...DEFAULT_DLQ_CONFIG, ...config };
    this.stats = {
      addedToday: 0,
      retriedToday: 0,
      discardedToday: 0,
      lastReset: new Date(),
    };

    if (this.config.autoCleanup) {
      this.startAutoCleanup();
    }
  }

  // ===========================================================================
  // 入队操作
  // ===========================================================================

  /**
   * 将失败任务添加到死信队列
   */
  enqueue(options: {
    originalTaskId: string;
    originalTask: Record<string, unknown>;
    error: string;
    errorCode?: string;
    stack?: string;
    source?: DLQEntrySource;
    retryCount?: number;
    metadata?: Record<string, unknown>;
  }): DLQEntry {
    // 检查容量
    if (this.entries.size >= this.config.maxSize) {
      // 移除最旧的条目
      this.evictOldest();
    }

    const now = new Date();
    const entry: DLQEntry = {
      id: generateId(),
      originalTaskId: options.originalTaskId,
      originalTask: options.originalTask,
      error: options.error,
      errorCode: options.errorCode,
      stack: options.stack,
      source: options.source || "unknown",
      retryCount: options.retryCount || 0,
      enqueuedAt: now,
      updatedAt: now,
      status: "pending",
      metadata: options.metadata || {},
    };

    this.entries.set(entry.id, entry);
    this.stats.addedToday++;
    this.resetStatsIfNeeded();

    this.emit("enqueued", { type: "enqueued", entry, timestamp: now });

    return entry;
  }

  /**
   * 批量入队
   */
  enqueueBatch(items: Array<{
    originalTaskId: string;
    originalTask: Record<string, unknown>;
    error: string;
    errorCode?: string;
    stack?: string;
    source?: DLQEntrySource;
    retryCount?: number;
    metadata?: Record<string, unknown>;
  }>): DLQEntry[] {
    return items.map((item) => this.enqueue(item));
  }

  // ===========================================================================
  // 出队和查询操作
  // ===========================================================================

  /**
   * 获取条目
   */
  get(id: string): DLQEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * 获取所有条目
   */
  getAll(): DLQEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * 查询条目
   */
  query(filter: DLQFilter = {}): DLQEntry[] {
    let results = Array.from(this.entries.values());

    // 状态过滤
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      results = results.filter((e) => statuses.includes(e.status));
    }

    // 来源过滤
    if (filter.source) {
      const sources = Array.isArray(filter.source) ? filter.source : [filter.source];
      results = results.filter((e) => sources.includes(e.source));
    }

    // 重试次数过滤
    if (filter.minRetryCount !== undefined) {
      results = results.filter((e) => e.retryCount >= filter.minRetryCount!);
    }
    if (filter.maxRetryCount !== undefined) {
      results = results.filter((e) => e.retryCount <= filter.maxRetryCount!);
    }

    // 时间范围过滤
    if (filter.from) {
      results = results.filter((e) => e.enqueuedAt >= filter.from!);
    }
    if (filter.to) {
      results = results.filter((e) => e.enqueuedAt <= filter.to!);
    }

    // 错误内容过滤
    if (filter.errorContains) {
      const keyword = filter.errorContains.toLowerCase();
      results = results.filter(
        (e) =>
          e.error.toLowerCase().includes(keyword) ||
          e.errorCode?.toLowerCase().includes(keyword)
      );
    }

    // 排序（按入队时间倒序）
    results.sort((a, b) => b.enqueuedAt.getTime() - a.enqueuedAt.getTime());

    // 分页
    const offset = filter.offset || 0;
    const limit = filter.limit || results.length;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /**
   * 获取待处理条目
   */
  getPending(limit?: number): DLQEntry[] {
    return this.query({ status: "pending", limit });
  }

  /**
   * 统计
   */
  getStats(): DLQStats {
    const entries = Array.from(this.entries.values());

    const byStatus: Record<DLQEntryStatus, number> = {
      pending: 0,
      reviewed: 0,
      retried: 0,
      discarded: 0,
      archived: 0,
    };

    const bySource: Record<DLQEntrySource, number> = {
      task_queue: 0,
      timeout: 0,
      validation: 0,
      system: 0,
      unknown: 0,
    };

    let totalRetryCount = 0;

    for (const entry of entries) {
      byStatus[entry.status]++;
      bySource[entry.source]++;
      totalRetryCount += entry.retryCount;
    }

    this.resetStatsIfNeeded();

    return {
      total: entries.length,
      byStatus,
      bySource,
      addedToday: this.stats.addedToday,
      retriedToday: this.stats.retriedToday,
      discardedToday: this.stats.discardedToday,
      avgRetryCount: entries.length > 0 ? totalRetryCount / entries.length : 0,
    };
  }

  // ===========================================================================
  // 状态更新操作
  // ===========================================================================

  /**
   * 审查条目
   */
  review(
    id: string,
    options: {
      notes?: string;
      reviewedBy?: string;
      status?: DLQEntryStatus;
    } = {}
  ): DLQEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;

    entry.reviewNotes = options.notes;
    entry.reviewedBy = options.reviewedBy;
    entry.reviewedAt = new Date();
    entry.updatedAt = new Date();
    if (options.status) {
      entry.status = options.status;
    } else {
      entry.status = "reviewed";
    }

    this.emit("reviewed", {
      type: "dequeued",
      entry,
      timestamp: new Date(),
    });

    return entry;
  }

  /**
   * 标记为重试
   */
  markRetried(id: string, success: boolean): DLQEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;

    entry.status = "retried";
    entry.updatedAt = new Date();

    if (success) {
      this.stats.retriedToday++;
    }

    this.emit("retried", {
      type: "retried",
      entry,
      timestamp: new Date(),
      metadata: { success },
    });

    return entry;
  }

  /**
   * 丢弃条目
   */
  discard(id: string, reason?: string): DLQEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;

    entry.status = "discarded";
    entry.updatedAt = new Date();
    if (reason) {
      entry.reviewNotes = reason;
    }

    this.stats.discardedToday++;

    this.emit("discarded", {
      type: "discarded",
      entry,
      timestamp: new Date(),
      metadata: { reason },
    });

    return entry;
  }

  /**
   * 归档条目
   */
  archive(id: string): DLQEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;

    entry.status = "archived";
    entry.updatedAt = new Date();

    this.emit("archived", {
      type: "archived",
      entry,
      timestamp: new Date(),
    });

    return entry;
  }

  // ===========================================================================
  // 重试操作
  // ===========================================================================

  /**
   * 准备重试
   * 返回原始任务数据，供调用方重新提交到任务队列
   */
  prepareRetry(id: string): Record<string, unknown> | null {
    const entry = this.entries.get(id);
    if (!entry || entry.status === "discarded") return null;

    entry.retryCount++;
    entry.updatedAt = new Date();

    return entry.originalTask;
  }

  /**
   * 批量准备重试
   */
  prepareBatchRetry(ids: string[]): Array<{ id: string; task: Record<string, unknown> | null }> {
    return ids.map((id) => ({
      id,
      task: this.prepareRetry(id),
    }));
  }

  // ===========================================================================
  // 清理操作
  // ===========================================================================

  /**
   * 清理过期条目
   */
  cleanup(): number {
    const now = new Date();
    const cutoff = new Date(now.getTime() - this.config.retentionMs);
    let cleaned = 0;

    for (const [id, entry] of this.entries) {
      if (entry.enqueuedAt < cutoff) {
        this.entries.delete(id);
        cleaned++;
        this.emit("cleaned", {
          type: "cleaned",
          entry,
          timestamp: now,
        });
      }
    }

    return cleaned;
  }

  /**
   * 清空队列
   */
  clear(): number {
    const count = this.entries.size;
    this.entries.clear();
    return count;
  }

  /**
   * 删除条目
   */
  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  // ===========================================================================
  // 内部方法
  // ===========================================================================

  /**
   * 启动自动清理
   */
  private startAutoCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);
  }

  /**
   * 停止自动清理
   */
  stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * 移除最旧的条目
   */
  private evictOldest(): void {
    let oldest: DLQEntry | null = null;

    for (const entry of this.entries.values()) {
      if (!oldest || entry.enqueuedAt < oldest.enqueuedAt) {
        oldest = entry;
      }
    }

    if (oldest) {
      this.entries.delete(oldest.id);
      this.emit("evicted", {
        type: "cleaned",
        entry: oldest,
        timestamp: new Date(),
        metadata: { reason: "capacity_exceeded" },
      });
    }
  }

  /**
   * 重置统计（如果需要）
   */
  private resetStatsIfNeeded(): void {
    const now = new Date();
    const lastReset = this.stats.lastReset;

    // 检查是否是新的一天
    if (
      now.getFullYear() !== lastReset.getFullYear() ||
      now.getMonth() !== lastReset.getMonth() ||
      now.getDate() !== lastReset.getDate()
    ) {
      this.stats.addedToday = 0;
      this.stats.retriedToday = 0;
      this.stats.discardedToday = 0;
      this.stats.lastReset = now;
    }
  }

  // ===========================================================================
  // 生命周期
  // ===========================================================================

  /**
   * 销毁
   */
  destroy(): void {
    this.stopAutoCleanup();
    this.entries.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 创建死信队列
 */
export function createDeadLetterQueue(config: Partial<DLQConfig> = {}): DeadLetterQueue {
  return new DeadLetterQueue(config);
}

/**
 * 从错误创建 DLQ 条目
 */
export function createDLQEntryFromError(
  taskId: string,
  task: Record<string, unknown>,
  error: Error,
  retryCount: number = 0
): Omit<DLQEntry, "id" | "enqueuedAt" | "updatedAt" | "status"> {
  return {
    originalTaskId: taskId,
    originalTask: task,
    error: error.message,
    errorCode: error.name,
    stack: error.stack,
    source: "unknown",
    retryCount,
    metadata: {},
  };
}

/**
 * 格式化 DLQ 条目
 */
export function formatDLQEntry(entry: DLQEntry): string {
  const lines = [
    `DLQ Entry: ${entry.id}`,
    `  Task ID: ${entry.originalTaskId}`,
    `  Status: ${entry.status}`,
    `  Source: ${entry.source}`,
    `  Error: ${entry.error}`,
    `  Retries: ${entry.retryCount}`,
    `  Enqueued: ${entry.enqueuedAt.toISOString()}`,
  ];

  if (entry.errorCode) {
    lines.push(`  Error Code: ${entry.errorCode}`);
  }

  if (entry.reviewNotes) {
    lines.push(`  Notes: ${entry.reviewNotes}`);
  }

  return lines.join("\n");
}
