/**
 * 幂等性处理模块
 * 用于确保任务创建和处理的幂等性
 *
 * @module interagent/idempotency
 * @version 1.0.0
 */

import { EventEmitter } from "events";
import { createHash } from "crypto";

// ============================================================================
// 类型定义
// ============================================================================

/** 幂等性记录 */
export interface IdempotencyRecord {
  /** 键 */
  key: string;
  /** 关联的任务 ID */
  taskId: string;
  /** 创建时间 */
  createdAt: Date;
  /** 过期时间 */
  expiresAt: Date;
  /** 状态 */
  status: "pending" | "processing" | "completed" | "failed";
  /** 响应数据 (缓存) */
  response?: unknown;
}

/** 幂等性存储配置 */
export interface IdempotencyStoreConfig {
  /** 默认过期时间 (秒) */
  defaultTTL?: number;
  /** 最大存储记录数 */
  maxRecords?: number;
  /** 清理间隔 (秒) */
  cleanupInterval?: number;
}

/** 幂等性键生成选项 */
export interface GenerateKeyOptions {
  /** 来源 DID */
  sourceDid: string;
  /** 目标 DID */
  targetDid: string;
  /** 任务类型 */
  taskType: string;
  /** 输入数据 */
  input: Record<string, unknown>;
  /** 自定义盐值 */
  salt?: string;
}

// ============================================================================
// 幂等性存储
// ============================================================================

/**
 * 内存幂等性存储
 */
export class IdempotencyStore extends EventEmitter {
  private records: Map<string, IdempotencyRecord> = new Map();
  private config: Required<IdempotencyStoreConfig>;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  /** 默认配置 */
  private static readonly DEFAULT_CONFIG: Required<IdempotencyStoreConfig> = {
    defaultTTL: 86400, // 24 小时
    maxRecords: 10000,
    cleanupInterval: 3600, // 每小时清理
  };

  constructor(config: Partial<IdempotencyStoreConfig> = {}) {
    super();
    this.config = { ...IdempotencyStore.DEFAULT_CONFIG, ...config };
  }

  /**
   * 启动存储
   */
  start(): void {
    this.startCleanupTimer();
    this.emit("started");
  }

  /**
   * 停止存储
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.emit("stopped");
  }

  /**
   * 检查键是否存在
   */
  has(key: string): boolean {
    const record = this.records.get(key);
    if (!record) return false;

    // 检查是否过期
    if (new Date() > record.expiresAt) {
      this.records.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 获取记录
   */
  get(key: string): IdempotencyRecord | undefined {
    const record = this.records.get(key);
    if (!record) return undefined;

    // 检查是否过期
    if (new Date() > record.expiresAt) {
      this.records.delete(key);
      return undefined;
    }

    return record;
  }

  /**
   * 设置记录
   */
  set(key: string, taskId: string, ttl?: number): IdempotencyRecord {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (ttl ?? this.config.defaultTTL) * 1000);

    const record: IdempotencyRecord = {
      key,
      taskId,
      createdAt: now,
      expiresAt,
      status: "pending",
    };

    // 检查是否超过最大记录数
    if (this.records.size >= this.config.maxRecords) {
      this.cleanupExpiredRecords();
    }

    this.records.set(key, record);
    this.emit("record:created", { key, taskId });

    return record;
  }

  /**
   * 更新记录状态
   */
  updateStatus(key: string, status: IdempotencyRecord["status"], response?: unknown): IdempotencyRecord | undefined {
    const record = this.records.get(key);
    if (!record) return undefined;

    record.status = status;
    if (response !== undefined) {
      record.response = response;
    }

    this.records.set(key, record);
    this.emit("record:updated", { key, status });

    return record;
  }

  /**
   * 获取或创建记录
   * 如果键存在且未过期，返回现有记录
   * 否则创建新记录
   */
  getOrCreate(key: string, taskId: string, ttl?: number): {
    record: IdempotencyRecord;
    created: boolean;
  } {
    const existing = this.get(key);
    if (existing) {
      return { record: existing, created: false };
    }

    const record = this.set(key, taskId, ttl);
    return { record, created: true };
  }

  /**
   * 删除记录
   */
  delete(key: string): boolean {
    const deleted = this.records.delete(key);
    if (deleted) {
      this.emit("record:deleted", { key });
    }
    return deleted;
  }

  /**
   * 清理过期记录
   */
  private cleanupExpiredRecords(): void {
    const now = new Date();
    let cleaned = 0;

    for (const [key, record] of this.records) {
      if (now > record.expiresAt) {
        this.records.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.emit("cleanup", { count: cleaned });
    }
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredRecords();
    }, this.config.cleanupInterval * 1000);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  } {
    let pending = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;

    for (const record of this.records.values()) {
      switch (record.status) {
        case "pending":
          pending++;
          break;
        case "processing":
          processing++;
          break;
        case "completed":
          completed++;
          break;
        case "failed":
          failed++;
          break;
      }
    }

    return {
      total: this.records.size,
      pending,
      processing,
      completed,
      failed,
    };
  }
}

// ============================================================================
// 幂等性键生成器
// ============================================================================

/**
 * 生成幂等性键
 * 基于任务参数生成唯一键
 */
export function generateIdempotencyKey(options: GenerateKeyOptions): string {
  // 按固定顺序构建数据对象，确保一致性
  const sortedData: Record<string, unknown> = {
    input: options.input,
    salt: options.salt ?? "",
    source: options.sourceDid,
    target: options.targetDid,
    type: options.taskType,
  };

  // 使用确定性的 JSON 序列化
  const jsonStr = JSON.stringify(sortedData);
  const hash = createHash("sha256").update(jsonStr).digest("hex");

  return `idemp:${hash.substring(0, 32)}`;
}

/**
 * 验证幂等性键格式
 */
export function isValidIdempotencyKey(key: string): boolean {
  return /^idemp:[a-f0-9]{32}$/.test(key);
}

/**
 * 生成基于时间的幂等性键
 * 用于需要时间窗口去重的场景
 */
export function generateTimeWindowKey(
  baseKey: string,
  windowSeconds: number = 60
): string {
  const windowStart = Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds;
  return `${baseKey}:${windowStart}`;
}

// ============================================================================
// 幂等性处理器
// ============================================================================

/**
 * 幂等性处理器
 * 提供高级幂等性操作
 */
export class IdempotencyHandler {
  private store: IdempotencyStore;

  constructor(store: IdempotencyStore) {
    this.store = store;
  }

  /**
   * 执行幂等操作
   * 如果已存在结果，直接返回
   * 否则执行操作并缓存结果
   */
  async execute<T>(
    key: string,
    taskId: string,
    operation: () => Promise<T>,
    options: {
      ttl?: number;
      onDuplicate?: (record: IdempotencyRecord) => void;
    } = {}
  ): Promise<{
    result: T;
    cached: boolean;
    record: IdempotencyRecord;
  }> {
    const { record, created } = this.store.getOrCreate(key, taskId, options.ttl);

    // 如果记录已存在且已完成，返回缓存结果
    if (!created && record.status === "completed") {
      options.onDuplicate?.(record);
      return {
        result: record.response as T,
        cached: true,
        record,
      };
    }

    // 如果正在处理中，抛出错误
    if (record.status === "processing") {
      throw new Error(`Operation ${key} is already being processed`);
    }

    // 标记为处理中
    this.store.updateStatus(key, "processing");

    try {
      const result = await operation();

      // 标记为完成并缓存结果
      this.store.updateStatus(key, "completed", result);

      return {
        result,
        cached: false,
        record: this.store.get(key)!,
      };
    } catch (error) {
      // 标记为失败
      this.store.updateStatus(key, "failed");
      throw error;
    }
  }

  /**
   * 检查并锁定
   * 原子操作：检查键是否存在，不存在则锁定
   */
  checkAndLock(key: string, taskId: string, ttl?: number): {
    locked: boolean;
    existing?: IdempotencyRecord;
  } {
    const existing = this.store.get(key);

    if (existing) {
      return { locked: false, existing };
    }

    this.store.set(key, taskId, ttl);
    this.store.updateStatus(key, "processing");

    return { locked: true };
  }

  /**
   * 解锁并设置结果
   */
  unlock(key: string, result?: unknown): boolean {
    return this.store.updateStatus(key, "completed", result) !== undefined;
  }
}
