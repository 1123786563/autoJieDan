/**
 * ANP 死信队列 (Dead Letter Queue) - DLQ
 *
 * 用于存储和处理失败的消息，确保消息可追溯和可重试
 *
 * @module anp.dlq
 * @version 1.0.0
 */

import * as fs from "fs";
import * as path from "path";
import { open } from "fs/promises";
import { ulid } from "ulid";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 死信消息状态
 */
export enum DeadMessageStatus {
  PENDING = "pending",
  RETRYING = "retrying",
  FAILED = "failed",
  RESOLVED = "resolved",
}

/**
 * 死信消息
 */
export interface DeadMessage {
  id: string;
  originalMessageId: string;
  originalMessage: unknown;
  errorType: string;
  errorMessage: string;
  failedAt: Date;
  retryCount: number;
  maxRetries: number;
  status: DeadMessageStatus;
  lastRetryAt?: Date;
  resolvedAt?: Date;
  metadata?: Record<string, unknown>;
  stackTrace?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * DLQ 查询条件
 */
export interface DLQQuery {
  status?: DeadMessageStatus;
  errorType?: string;
  limit?: number;
  offset?: number;
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * 重试结果
 */
export interface RetryResult {
  success: boolean;
  message: string;
  retriedAt: Date;
  newMessageId?: string;
}

/**
 * DLQ 统计信息
 */
export interface DLQStatistics {
  total: number;
  pending: number;
  retrying: number;
  failed: number;
  resolved: number;
  avgRetries: number;
  errorTypes: Record<string, number>;
}

// ============================================================================
// DLQ 存储实现
// ============================================================================

/**
 * 死信队列存储
 *
 * 使用 SQLite 存储失败的消息，支持查询和重试
 */
export class DLQStorage {
  private dbPath: string;
  private db: any; // sqlite3 Database

  constructor(dbPath?: string) {
    if (dbPath) {
      this.dbPath = dbPath;
    } else {
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "";
      const dbDir = path.join(homeDir, ".automaton");
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      this.dbPath = path.join(dbDir, "dlq.db");
    }

    this._initDB();
  }

  /**
   * 初始化数据库表
   */
  private _initDB(): void {
    const sqlite3 = require("sqlite3");
    this.db = new sqlite3.Database(this.dbPath);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dead_messages (
        id TEXT PRIMARY KEY,
        original_message_id TEXT NOT NULL,
        original_message TEXT NOT NULL,
        error_type TEXT NOT NULL,
        error_message TEXT NOT NULL,
        failed_at TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        status TEXT DEFAULT 'pending',
        last_retry_at TEXT,
        resolved_at TEXT,
        metadata TEXT DEFAULT '{}',
        stack_trace TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建索引
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_status ON dead_messages(status)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_error_type ON dead_messages(error_type)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_failed_at ON dead_messages(failed_at)`);
  }

  /**
   * 添加失败消息到 DLQ
   */
  addMessage(
    originalMessageId: string,
    originalMessage: unknown,
    errorType: string,
    errorMessage: string,
    maxRetries = 3,
    metadata?: Record<string, unknown>,
    stackTrace?: string
  ): string {
    const msgId = `dlq-${ulid()}`;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO dead_messages (
        id, original_message_id, original_message,
        error_type, error_message, failed_at,
        retry_count, max_retries, status,
        metadata, stack_trace
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'pending', ?, ?)
    `);

    stmt.run(
      msgId,
      originalMessageId,
      JSON.stringify(originalMessage),
      errorType,
      errorMessage,
      now,
      maxRetries,
      JSON.stringify(metadata || {}),
      stackTrace || null
    );

    return msgId;
  }

  /**
   * 获取单个死信消息
   */
  getMessage(msgId: string): DeadMessage | undefined {
    const row = this.db
      .prepare("SELECT * FROM dead_messages WHERE id = ?")
      .get(msgId) as DeadMessageRow | undefined;

    if (!row) {
      return undefined;
    }

    return this._rowToMessage(row);
  }

  /**
   * 查询死信消息
   */
  queryMessages(query: DLQQuery): DeadMessage[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (query.status) {
      conditions.push("status = ?");
      params.push(query.status);
    }

    if (query.errorType) {
      conditions.push("error_type = ?");
      params.push(query.errorType);
    }

    if (query.dateFrom) {
      conditions.push("failed_at >= ?");
      params.push(query.dateFrom.toISOString());
    }

    if (query.dateTo) {
      conditions.push("failed_at <= ?");
      params.push(query.dateTo.toISOString());
    }

    const whereClause = conditions.length > 0
      ? "WHERE " + conditions.join(" AND ")
      : "";

    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    const sql = `
      SELECT * FROM dead_messages
      ${whereClause}
      ORDER BY failed_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = this.db
      .prepare(sql)
      .all(...params, limit, offset) as DeadMessageRow[];

    return rows.map((row) => this._rowToMessage(row));
  }

  /**
   * 更新消息状态
   */
  updateStatus(
    msgId: string,
    status: DeadMessageStatus,
    resolvedAt?: Date
  ): boolean {
    const now = new Date().toISOString();
    const resolvedAtStr = resolvedAt ? resolvedAt.toISOString() : null;

    const stmt = this.db.prepare(`
      UPDATE dead_messages
      SET status = ?, resolved_at = ?, updated_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(status, resolvedAtStr, now, msgId);
    return result.changes > 0;
  }

  /**
   * 增加重试计数
   */
  incrementRetry(msgId: string): boolean {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE dead_messages
      SET retry_count = retry_count + 1,
          last_retry_at = ?,
          updated_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(now, now, msgId);
    return result.changes > 0;
  }

  /**
   * 删除消息
   */
  deleteMessage(msgId: string): boolean {
    const stmt = this.db.prepare("DELETE FROM dead_messages WHERE id = ?");
    const result = stmt.run(msgId);
    return result.changes > 0;
  }

  /**
   * 获取 DLQ 统计信息
   */
  getStatistics(): DLQStatistics {
    const statsRow = this.db
      .prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'retrying' THEN 1 ELSE 0 END) as retrying,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
          AVG(retry_count) as avg_retries
        FROM dead_messages
      `).get() as DLQStatisticsRow;

    const errorTypesRows = this.db
      .prepare(`
        SELECT error_type, COUNT(*) as count
        FROM dead_messages
        WHERE status != 'resolved'
        GROUP BY error_type
        ORDER BY count DESC
      `).all() as Array<{ error_type: string; count: number }>;

    const errorTypes: Record<string, number> = {};
    for (const row of errorTypesRows) {
      errorTypes[row.error_type] = row.count;
    }

    return {
      total: statsRow.total || 0,
      pending: statsRow.pending || 0,
      retrying: statsRow.retrying || 0,
      failed: statsRow.failed || 0,
      resolved: statsRow.resolved || 0,
      avgRetries: Math.round((statsRow.avg_retries || 0) * 100) / 100,
      errorTypes,
    };
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
    }
  }

  /**
   * 将数据库行转换为 DeadMessage 对象
   */
  private _rowToMessage(row: DeadMessageRow): DeadMessage {
    return {
      id: row.id,
      originalMessageId: row.original_message_id,
      originalMessage: JSON.parse(row.original_message),
      errorType: row.error_type,
      errorMessage: row.error_message,
      failedAt: new Date(row.failed_at),
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      status: row.status as DeadMessageStatus,
      lastRetryAt: row.last_retry_at ? new Date(row.last_retry_at) : undefined,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
      metadata: JSON.parse(row.metadata || "{}"),
      stackTrace: row.stack_trace ?? undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

// ============================================================================
// 数据库行类型
// ============================================================================

interface DeadMessageRow {
  id: string;
  original_message_id: string;
  original_message: string;
  error_type: string;
  error_message: string;
  failed_at: string;
  retry_count: number;
  max_retries: number;
  status: string;
  last_retry_at: string | null;
  resolved_at: string | null;
  metadata: string;
  stack_trace: string | null;
  created_at: string;
  updated_at: string;
}

interface DLQStatisticsRow {
  total: number;
  pending: number;
  retrying: number;
  failed: number;
  resolved: number;
  avg_retries: number;
}

// ============================================================================
// 全局 DLQ 实例
// ============================================================================

let globalDLQ: DLQStorage | undefined;

export function getGlobalDLQ(): DLQStorage {
  if (!globalDLQ) {
    globalDLQ = new DLQStorage();
  }
  return globalDLQ;
}

export function setGlobalDLQ(dlq: DLQStorage): void {
  globalDLQ = dlq;
}

export function closeGlobalDLQ(): void {
  if (globalDLQ) {
    globalDLQ.close();
    globalDLQ = undefined;
  }
}

// ============================================================================
// DLQ 管理器
// ============================================================================

/**
 * 死信队列管理器
 *
 * 提供高级 DLQ 操作功能
 */
export class DLQManager {
  private storage: DLQStorage;

  constructor(storage?: DLQStorage) {
    this.storage = storage ?? getGlobalDLQ();
  }

  /**
   * 将失败的消息加入 DLQ
   */
  enqueueFailedMessage(
    messageId: string,
    message: unknown,
    error: Error,
    maxRetries = 3
  ): string {
    const errorType = error.constructor.name;
    const errorMessage = error.message;
    const stackTrace = error.stack;

    return this.storage.addMessage(
      messageId,
      message,
      errorType,
      errorMessage,
      maxRetries,
      {},
      stackTrace
    );
  }

  /**
   * 重试失败的消息
   */
  async retryMessage(
    dlqMessageId: string,
    retryFunc: (message: unknown) => Promise<{ messageId?: string }>
  ): Promise<RetryResult> {
    const deadMessage = this.storage.getMessage(dlqMessageId);

    if (!deadMessage) {
      return {
        success: false,
        message: `Message ${dlqMessageId} not found`,
        retriedAt: new Date(),
      };
    }

    // 检查重试次数
    if (deadMessage.retryCount >= deadMessage.maxRetries) {
      this.storage.updateStatus(dlqMessageId, DeadMessageStatus.FAILED);

      return {
        success: false,
        message: `Max retries (${deadMessage.maxRetries}) exceeded`,
        retriedAt: new Date(),
      };
    }

    // 更新状态为重试中
    this.storage.updateStatus(dlqMessageId, DeadMessageStatus.RETRYING);
    this.storage.incrementRetry(dlqMessageId);

    // 执行重试
    try {
      const result = await retryFunc(deadMessage.originalMessage);

      // 重试成功
      this.storage.updateStatus(
        dlqMessageId,
        DeadMessageStatus.RESOLVED
      );

      return {
        success: true,
        message: "Message retry successful",
        retriedAt: new Date(),
        newMessageId: result.messageId,
      };

    } catch (error) {
      // 重试失败，恢复状态
      this.storage.updateStatus(dlqMessageId, DeadMessageStatus.PENDING);

      return {
        success: false,
        message: `Retry failed: ${error instanceof Error ? error.message : String(error)}`,
        retriedAt: new Date(),
      };
    }
  }

  /**
   * 查询待处理的消息
   */
  queryPendingMessages(
    limit = 100,
    errorType?: string
  ): DeadMessage[] {
    const query: DLQQuery = {
      status: DeadMessageStatus.PENDING,
      limit,
      errorType,
    };

    return this.storage.queryMessages(query);
  }

  /**
   * 获取失败消息摘要
   */
  getFailedMessagesSummary(days = 7): {
    periodDays: number;
    totalFailed: number;
    statistics: DLQStatistics;
    byErrorType: Record<string, number>;
    recentFailures: Array<{
      id: string;
      originalMessageId: string;
      errorType: string;
      errorMessage: string;
      failedAt: string;
      retryCount: number;
    }>;
  } {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);

    const query: DLQQuery = {
      dateFrom,
      limit: 1000,
    };

    const messages = this.storage.queryMessages(query);
    const stats = this.storage.getStatistics();

    // 按错误类型分组
    const byError: Record<string, number> = {};
    for (const msg of messages) {
      byError[msg.errorType] = (byError[msg.errorType] || 0) + 1;
    }

    return {
      periodDays: days,
      totalFailed: messages.length,
      statistics: stats,
      byErrorType: byError,
      recentFailures: messages.slice(0, 10).map((msg) => ({
        id: msg.id,
        originalMessageId: msg.originalMessageId,
        errorType: msg.errorType,
        errorMessage: msg.errorMessage,
        failedAt: msg.failedAt.toISOString(),
        retryCount: msg.retryCount,
      })),
    };
  }
}
