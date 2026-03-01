/**
 * WebSocket 重连状态同步处理器
 * 实现断线重连后的消息恢复机制
 *
 * @module interagent/reconnection-handler
 * @version 1.0.0
 */

import { EventEmitter } from "events";
import type { MessagePersistenceService } from "./message-persistence.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("reconnection-handler");

// ============================================================================
// 类型定义
// ============================================================================

/** 重连请求 */
export interface ReconnectRequest {
  /** 消息类型 */
  type: "reconnect.request";
  /** 连接 ID */
  connectionId: string;
  /** 最后收到的消息序列号 */
  lastSeq: number;
  /** 时间戳 */
  timestamp: string;
}

/** 状态同步响应 */
export interface StateSyncResponse {
  /** 消息类型 */
  type: "state.sync.response";
  /** 连接 ID */
  connectionId: string;
  /** 同步的消息列表 */
  messages: SyncMessage[];
  /** 当前序列号 */
  currentSeq: number;
  /** 同步时间 */
  syncedAt: string;
}

/** 同步消息 */
export interface SyncMessage {
  /** 消息 ID */
  id: string;
  /** 序列号 */
  sequence: number;
  /** 消息类型 */
  type: string;
  /** 消息负载 */
  payload: unknown;
  /** 创建时间 */
  createdAt: string;
}

/** 同步完成确认 */
export interface SyncCompleteAck {
  /** 消息类型 */
  type: "sync.complete.ack";
  /** 连接 ID */
  connectionId: string;
  /** 同步完成时间 */
  completedAt: string;
  /** 处理的消息数 */
  processedCount: number;
}

/** 重连处理器配置 */
export interface ReconnectionHandlerConfig {
  /** 消息同步超时 (毫秒) */
  syncTimeout?: number;
  /** 最大同步消息数 */
  maxSyncMessages?: number;
}

/** 重连会话 */
interface ReconnectionSession {
  /** 连接 ID */
  connectionId: string;
  /** 会话开始时间 */
  startedAt: Date;
  /** 最后活动时间 */
  lastActivity: Date;
  /** 同步状态 */
  syncState: "pending" | "syncing" | "completed" | "failed";
  /** 期望的消息数 */
  expectedCount: number;
  /** 已处理的消息数 */
  processedCount: number;
}

// ============================================================================
// 重连处理器
// ============================================================================

/**
 * WebSocket 重连状态同步处理器
 *
 * 功能：
 * - 处理客户端重连请求
 * - 从消息持久化服务获取错过的消息
 * - 发送状态同步响应
 * - 确认同步完成
 */
export class ReconnectionHandler extends EventEmitter {
  private persistenceService: MessagePersistenceService;
  private config: Required<ReconnectionHandlerConfig>;
  private sessions: Map<string, ReconnectionSession> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  /** 默认配置 */
  private static readonly DEFAULT_CONFIG: Required<ReconnectionHandlerConfig> = {
    syncTimeout: 30000, // 30 秒
    maxSyncMessages: 1000,
  };

  constructor(
    persistenceService: MessagePersistenceService,
    config: Partial<ReconnectionHandlerConfig> = {}
  ) {
    super();
    this.persistenceService = persistenceService;
    this.config = { ...ReconnectionHandler.DEFAULT_CONFIG, ...config };
    this.startCleanupTimer();
  }

  /**
   * 处理重连请求
   */
  handleReconnectRequest(request: ReconnectRequest): StateSyncResponse {
    const { connectionId, lastSeq } = request;

    logger.info("Handling reconnect request", { connectionId, lastSeq });

    // 创建或更新会话
    const session: ReconnectionSession = {
      connectionId,
      startedAt: new Date(),
      lastActivity: new Date(),
      syncState: "syncing",
      expectedCount: 0,
      processedCount: 0,
    };
    this.sessions.set(connectionId, session);

    // 从持久化服务获取错过的消息
    const missedMessages = this.persistenceService.getMissedMessages(connectionId, lastSeq);

    // 限制同步消息数量
    const messages = missedMessages.slice(0, this.config.maxSyncMessages);

    session.expectedCount = messages.length;

    // 转换为同步消息格式
    const syncMessages: SyncMessage[] = messages.map((msg) => ({
      id: msg.id,
      sequence: msg.sequence,
      type: msg.type,
      payload: msg.payload,
      createdAt: msg.createdAt.toISOString(),
    }));

    // 获取当前序列号
    const currentSeq =
      messages.length > 0 ? messages[messages.length - 1].sequence : lastSeq;

    const response: StateSyncResponse = {
      type: "state.sync.response",
      connectionId,
      messages: syncMessages,
      currentSeq,
      syncedAt: new Date().toISOString(),
    };

    this.emit("sync:started", { connectionId, messageCount: messages.length });

    logger.debug("Sending sync response", {
      connectionId,
      messageCount: messages.length,
      currentSeq,
    });

    return response;
  }

  /**
   * 处理同步完成确认
   */
  handleSyncCompleteAck(ack: SyncCompleteAck): void {
    const { connectionId, processedCount } = ack;

    logger.info("Received sync complete ack", { connectionId, processedCount });

    const session = this.sessions.get(connectionId);
    if (session) {
      session.syncState = "completed";
      session.processedCount = processedCount;
      session.lastActivity = new Date();

      // 标记消息为已处理
      this.persistenceService.markProcessed(
        // 从 ack 中获取处理的消息 ID (如果有的话)
        []
      );

      this.emit("sync:completed", {
        connectionId,
        processedCount,
        duration: Date.now() - session.startedAt.getTime(),
      });

      // 清理会话
      this.sessions.delete(connectionId);
    }
  }

  /**
   * 处理同步超时
   */
  private handleSyncTimeout(connectionId: string): void {
    const session = this.sessions.get(connectionId);
    if (session && session.syncState === "syncing") {
      session.syncState = "failed";

      logger.warn("Sync timeout", { connectionId });

      this.emit("sync:timeout", {
        connectionId,
        expectedCount: session.expectedCount,
        processedCount: session.processedCount,
      });

      this.sessions.delete(connectionId);
    }
  }

  /**
   * 获取会话状态
   */
  getSession(connectionId: string): ReconnectionSession | undefined {
    return this.sessions.get(connectionId);
  }

  /**
   * 获取所有活跃会话
   */
  getActiveSessions(): ReconnectionSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.syncState === "pending" || s.syncState === "syncing"
    );
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    // 每 10 秒检查一次超时会话
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();

      for (const [connectionId, session] of this.sessions) {
        const inactiveTime = now - session.lastActivity.getTime();

        if (inactiveTime > this.config.syncTimeout) {
          this.handleSyncTimeout(connectionId);
        }
      }
    }, 10000);
  }

  /**
   * 停止清理定时器
   */
  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 创建重连请求 (客户端使用)
   */
  static createReconnectRequest(connectionId: string, lastSeq: number): ReconnectRequest {
    return {
      type: "reconnect.request",
      connectionId,
      lastSeq,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 创建同步完成确认 (客户端使用)
   */
  static createSyncCompleteAck(connectionId: string, processedCount: number): SyncCompleteAck {
    return {
      type: "sync.complete.ack",
      connectionId,
      completedAt: new Date().toISOString(),
      processedCount,
    };
  }
}

// ============================================================================
// 导出
// ============================================================================

export type { ReconnectRequest as ReconnectRequestType, StateSyncResponse as StateSyncResponseType, SyncCompleteAck as SyncCompleteAckType };
