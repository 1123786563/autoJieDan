/**
 * 批量处理器
 * 用于 CPU 优化，减少序列化开销
 *
 * @module interagent.performance.batch
 * @version 1.0.0
 */

// ============================================================================
// Types
// ============================================================================

export interface BatchProcessorOptions<T, R> {
  /** 批量处理函数 */
  processor: (items: T[]) => Promise<R[]>;
  /** 最大批次大小 */
  maxBatchSize?: number;
  /** 最大等待时间 (毫秒) */
  maxWaitMs?: number;
  /** 错误处理 */
  onError?: (error: Error, items: T[]) => void;
}

export interface BatchResult<R> {
  /** 处理结果 */
  results: R[];
  /** 处理的项目数 */
  processedCount: number;
  /** 处理耗时 (毫秒) */
  durationMs: number;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

export interface PendingItem<T, R> {
  item: T;
  resolve: (result: R) => void;
  reject: (error: Error) => void;
}

export interface BatchStats {
  /** 总批次数 */
  totalBatches: number;
  /** 总处理项目数 */
  totalItems: number;
  /** 平均批次大小 */
  avgBatchSize: number;
  /** 平均等待时间 */
  avgWaitMs: number;
  /** 平均处理时间 */
  avgProcessMs: number;
  /** 错误数 */
  errors: number;
}

// ============================================================================
// BatchProcessor
// ============================================================================

/**
 * 批量处理器
 * 自动收集请求并批量处理
 *
 * Example:
 * ```typescript
 * const processor = new BatchProcessor({
 *   processor: async (items) => {
 *     // 批量处理逻辑
 *     return items.map(item => process(item));
 *   },
 *   maxBatchSize: 100,
 *   maxWaitMs: 50
 * });
 *
 * // 添加项目到批次
 * const result = await processor.add(item);
 * ```
 */
export class BatchProcessor<T, R> {
  private pending: PendingItem<T, R>[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;

  private readonly processor: (items: T[]) => Promise<R[]>;
  private readonly maxBatchSize: number;
  private readonly maxWaitMs: number;
  private readonly onError?: (error: Error, items: T[]) => void;

  // 统计
  private totalBatches = 0;
  private totalItems = 0;
  private totalWaitMs = 0;
  private totalProcessMs = 0;
  private errors = 0;

  constructor(options: BatchProcessorOptions<T, R>) {
    this.processor = options.processor;
    this.maxBatchSize = options.maxBatchSize ?? 100;
    this.maxWaitMs = options.maxWaitMs ?? 50;
    this.onError = options.onError;
  }

  /**
   * 添加项目到批次
   */
  async add(item: T): Promise<R> {
    return new Promise((resolve, reject) => {
      this.pending.push({ item, resolve, reject });

      // 如果达到最大批次大小，立即处理
      if (this.pending.length >= this.maxBatchSize) {
        this.flush();
        return;
      }

      // 启动定时器
      this.scheduleFlush();
    });
  }

  /**
   * 添加多个项目
   */
  async addBatch(items: T[]): Promise<R[]> {
    return Promise.all(items.map((item) => this.add(item)));
  }

  /**
   * 调度刷新
   */
  private scheduleFlush(): void {
    if (this.timer) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.maxWaitMs);
  }

  /**
   * 刷新待处理队列
   */
  async flush(): Promise<void> {
    if (this.processing || this.pending.length === 0) {
      return;
    }

    // 取消定时器
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.processing = true;
    const batch = this.pending.splice(0, this.maxBatchSize);
    const items = batch.map((p) => p.item);
    const startTime = Date.now();

    try {
      const results = await this.processor(items);
      const durationMs = Date.now() - startTime;

      // 更新统计
      this.totalBatches++;
      this.totalItems += items.length;
      this.totalProcessMs += durationMs;

      // 返回结果
      batch.forEach((pending, index) => {
        if (index < results.length) {
          pending.resolve(results[index]);
        } else {
          pending.reject(new Error("Missing result"));
        }
      });
    } catch (error) {
      this.errors++;
      const err = error instanceof Error ? error : new Error(String(error));

      if (this.onError) {
        this.onError(err, items);
      }

      batch.forEach((pending) => {
        pending.reject(err);
      });
    } finally {
      this.processing = false;

      // 如果还有待处理项目，继续处理
      if (this.pending.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  /**
   * 等待所有待处理项目完成
   */
  async drain(): Promise<void> {
    while (this.pending.length > 0 || this.processing) {
      await this.flush();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): BatchStats {
    return {
      totalBatches: this.totalBatches,
      totalItems: this.totalItems,
      avgBatchSize: this.totalBatches > 0 ? this.totalItems / this.totalBatches : 0,
      avgWaitMs: this.totalBatches > 0 ? this.totalWaitMs / this.totalBatches : 0,
      avgProcessMs: this.totalBatches > 0 ? this.totalProcessMs / this.totalBatches : 0,
      errors: this.errors,
    };
  }

  /**
   * 获取待处理数量
   */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * 是否正在处理
   */
  get isProcessing(): boolean {
    return this.processing;
  }
}

// ============================================================================
// ThrottledBatchProcessor
// ============================================================================

/**
 * 带限流的批量处理器
 */
export class ThrottledBatchProcessor<T, R> extends BatchProcessor<T, R> {
  private lastProcessTime = 0;
  private readonly minIntervalMs: number;

  constructor(
    options: BatchProcessorOptions<T, R>,
    minIntervalMs: number = 100
  ) {
    super(options);
    this.minIntervalMs = minIntervalMs;
  }

  override async flush(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastProcessTime;

    if (elapsed < this.minIntervalMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.minIntervalMs - elapsed)
      );
    }

    this.lastProcessTime = Date.now();
    await super.flush();
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 创建批量处理器
 */
export function createBatchProcessor<T, R>(
  options: BatchProcessorOptions<T, R>
): BatchProcessor<T, R> {
  return new BatchProcessor<T, R>(options);
}
