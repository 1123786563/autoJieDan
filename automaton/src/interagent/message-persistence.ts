/**
 * 消息持久化服务
 * 用于 WebSocket 重连状态同步
 *
 * @module interagent/message-persistence
 * @version 1.0.0
 */

import { EventEmitter } from "events";
import { ulid } from "ulid";
import type { Database } from "better-sqlite3";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("message-persistence");

// ============================================================================
// 类型定义
// ============================================================================

/** 持久化消息 */
export interface PersistedMessage {
  /** 消息 ID */
  id: string;
  /** 连接 ID */
  connectionId: string;
  /** 序列号 */
  sequence: number;
  /** 消息类型 */
  type: string;
  /** 消息负载 (JSON) */
  payload: string;
  /** 创建时间 */
  createdAt: Date;
  /** 过期时间 */
  expiresAt: Date;
}

/** 消息持久化配置 */
export interface MessagePersistenceConfig {
  /** 是否持久化 */
  persist: boolean;
  /** TTL (小时) */
  ttl: number;
}

/** 重连请求 */
export interface ReconnectRequest {
  /** 最后收到的消息序列号 */
  lastSeq: number;
}

/** 状态同步响应 */
export interface StateSyncResponse {
  /** 同步的消息列表 */
  messages: PersistedMessage[];
  /** 当前序列号 */
  currentSeq: number;
  /** 同步时间 */
  syncedAt: Date;
}

/** 同步完成确认 */
export interface SyncCompleteAck {
  /** 同步完成时间 */
  completedAt: Date;
  /** 处理的消息数 */
  processedCount: number;
}

/** 消息持久化配置映射 */
export const MESSAGE_PERSISTENCE_CONFIG: Record<string, MessagePersistenceConfig> = {
  "GenesisPrompt": { persist: true, ttl: 24 },
  "ProgressReport": { persist: true, ttl: 1 },
  "ErrorReport": { persist: true, ttl: 24 },
  "HeartbeatEvent": { persist: false, ttl: 0 },
  "status.heartbeat": { persist: false, ttl: 0 },
  "status.request": { persist: true, ttl: 1 },
  "status.response": { persist: true, ttl: 1 },
  "task.progress": { persist: true, ttl: 1 },
  "task.error": { persist: true, ttl: 24 },
  "task.complete": { persist: true, ttl: 24 },
  "task.fail": { persist: true, ttl: 24 },
  "reconnect.request": { persist: false, ttl: 0 },
  "state.sync.response": { persist: false, ttl: 0 },
  "sync.complete.ack": { persist: false, ttl: 0 },
};

// ============================================================================
// 消息持久化服务
// ============================================================================

/**
 * 消息持久化服务
 * 用于 WebSocket 重连时恢复错过的消息
 */
export class MessagePersistenceService extends EventEmitter {
  private db: Database;
  private defaultTtlMs: number = 24 * 60 * 60 * 1000; // 24 hours
  private cleanupInterval: NodeJS.Timeout | null = null;
  private persistenceConfig: Record<string, MessagePersistenceConfig>;

  constructor(
    db: Database,
    defaultTtlMs?: number,
    persistenceConfig?: Record<string, MessagePersistenceConfig>
  ) {
    super();
    this.db = db;
    this.defaultTtlMs = defaultTtlMs ?? this.defaultTtlMs;
    this.persistenceConfig = persistenceConfig ?? MESSAGE_PERSISTENCE_CONFIG;
    this.startCleanupTimer();
  }

  /**
   * 获取消息类型的持久化配置
   */
  private getConfigForType(messageType: string): MessagePersistenceConfig {
    return this.persistenceConfig[messageType] ?? { persist: true, ttl: this.defaultTtlMs / (60 * 60 * 1000) };
  }

  /**
   * 持久化消息
   */
  persistMessage(
    connectionId: string,
    sequence: number,
    type: string,
    payload: unknown
  ): string | null {
    const config = this.getConfigForType(type);

    // 如果该消息类型不需要持久化，直接返回
    if (!config.persist) {
      logger.debug("Message not persisted (disabled for type)", { type });
      return null;
    }

    const id = ulid();
    const now = new Date();
    const ttlMs = config.ttl * 60 * 60 * 1000;
    const expiresAt = new Date(now.getTime() + ttlMs);

    const stmt = this.db.prepare(`
      INSERT INTO message_buffer (id, connection_id, sequence, type, payload, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, connectionId, sequence, type, JSON.stringify(payload), now.toISOString(), expiresAt.toISOString());

    logger.debug("Message persisted", { id, connectionId, sequence, type, ttlHours: config.ttl });

    this.emit("message:persisted", { id, connectionId, sequence, type });

    return id;
  }

  /**
   * 获取错过的消息
   */
  getMissedMessages(connectionId: string, lastSeq: number, limit?: number): PersistedMessage[] {
    const now = new Date();

    let sql = `
      SELECT id, connection_id, sequence, type, payload, created_at, expires_at
      FROM message_buffer
      WHERE connection_id = ? AND sequence > ? AND expires_at > ?
      ORDER BY sequence ASC
    `;

    if (limit !== undefined) {
      sql += ` LIMIT ${limit}`;
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(connectionId, lastSeq, now.toISOString()) as any[];

    return rows.map((row: any) => ({
      id: row.id,
      connectionId: row.connection_id,
      sequence: row.sequence,
      type: row.type,
      payload: JSON.parse(row.payload),
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
    }));
  }

  /**
   * 获取错过的消息（别名方法，与任务要求兼容）
   */
  getMissedEvents(connectionId: string, lastSequence: number, limit?: number): PersistedMessage[] {
    return this.getMissedMessages(connectionId, lastSequence, limit);
  }

  /**
   * 获取状态同步响应
   */
  getStateSyncResponse(connectionId: string, lastSeq: number): StateSyncResponse {
    const messages = this.getMissedMessages(connectionId, lastSeq);
    const currentSeq = messages.length > 0 ? messages[messages.length - 1].sequence : lastSeq;

    return {
      messages,
      currentSeq,
      syncedAt: new Date(),
    };
  }

  /**
   * 标记消息为已处理
   */
  markProcessed(messageIds: string[]): void {
    // 消息会在过期时自动清理，    logger.debug("Messages marked as processed", { count: messageIds.length });
  }

  /**
   * 清理过期消息
   */
  cleanupExpired(): number {
    const now = new Date();

    const stmt = this.db.prepare(`
      DELETE FROM message_buffer
      WHERE expires_at <= ?
    `);

    const result = stmt.run(now.toISOString());
    const deletedCount = result.changes;

    if (deletedCount > 0) {
      logger.debug("Expired messages cleaned up", { count: deletedCount });
    }

    return deletedCount;
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    // 每小时清理一次过期消息
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, 60 * 60 * 1000);
  }

  /**
   * 停止清理定时器
   */
  stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
