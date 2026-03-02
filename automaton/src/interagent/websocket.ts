/**
 * Interagent WebSocket 服务器
 * 用于 Automaton 与 Nanobot 之间的实时双向通信
 *
 * @module interagent/websocket
 * @version 1.0.0
 */

import WebSocket, { WebSocketServer as WsServer, RawData } from "ws";
import { EventEmitter } from "events";
import { ulid } from "ulid";
import type { Database } from "better-sqlite3";
import { MessagePersistenceService } from "./message-persistence.js";
import { ReconnectionHandler, type ReconnectRequest, type StateSyncResponse, type SyncCompleteAck } from "./reconnection-handler.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("websocket-server");

// ============================================================================
// 类型定义
// ============================================================================

/** WebSocket 连接状态 */
export type ConnectionState = "connecting" | "connected" | "disconnecting" | "disconnected";

/** 事件类型 */
export type InteragentEventType =
  | "task.progress"
  | "task.error"
  | "task.complete"
  | "task.fail"
  | "status.heartbeat"
  | "status.request"
  | "status.response";

/** 基础事件负载 */
export interface InteragentEventBase {
  /** 事件 ID */
  id: string;
  /** 事件类型 */
  type: InteragentEventType;
  /** 时间戳 */
  timestamp: string;
  /** 来源 DID */
  source: string;
  /** 目标 DID */
  target: string;
  /** 关联 ID (可选) */
  correlationId?: string;
}

/** 进度事件 */
export interface TaskProgressEvent extends InteragentEventBase {
  type: "task.progress";
  payload: {
    taskId: string;
    progress: number;
    currentPhase: string;
    completedSteps: string[];
    nextSteps: string[];
    etaSeconds?: number;
  };
}

/** 错误事件 */
export interface TaskErrorEvent extends InteragentEventBase {
  type: "task.error";
  payload: {
    taskId: string;
    severity: "warning" | "error" | "critical";
    errorCode: string;
    message: string;
    context?: Record<string, unknown>;
    recoverable: boolean;
  };
}

/** 任务完成事件 */
export interface TaskCompleteEvent extends InteragentEventBase {
  type: "task.complete";
  payload: {
    taskId: string;
    result: Record<string, unknown>;
    duration: number;
  };
}

/** 任务失败事件 */
export interface TaskFailEvent extends InteragentEventBase {
  type: "task.fail";
  payload: {
    taskId: string;
    error: string;
    retryable: boolean;
  };
}

/** 心跳事件 */
export interface StatusHeartbeatEvent extends InteragentEventBase {
  type: "status.heartbeat";
  payload: {
    status: "healthy" | "degraded" | "unhealthy";
    uptime: number;
    activeTasks: number;
    queuedTasks: number;
  };
}

/** 状态请求事件 */
export interface StatusRequestEvent extends InteragentEventBase {
  type: "status.request";
  payload: {
    detailLevel: "basic" | "full";
  };
}

/** 状态响应事件 */
export interface StatusResponseEvent extends InteragentEventBase {
  type: "status.response";
  payload: {
    status: "idle" | "busy" | "error";
    currentTasks: number;
    queuedTasks: number;
    resources: {
      cpuUsage: number;
      memoryUsage: number;
      tokensUsed: number;
    };
  };
}

/** 联合事件类型 */
export type InteragentEvent =
  | TaskProgressEvent
  | TaskErrorEvent
  | TaskCompleteEvent
  | TaskFailEvent
  | StatusHeartbeatEvent
  | StatusRequestEvent
  | StatusResponseEvent;

/** 客户端信息 */
export interface ClientInfo {
  /** 客户端 DID */
  did: string;
  /** 连接 ID (用于重连状态同步) */
  connectionId: string;
  /** 连接时间 */
  connectedAt: Date;
  /** 最后活动时间 */
  lastActivity: Date;
  /** 心跳计数 */
  heartbeatCount: number;
  /** 当前消息序列号 */
  currentSequence: number;
  /** 最后同步的序列号 */
  lastSyncedSequence: number;
}

/** WebSocket 服务器配置 */
export interface WebSocketServerConfig {
  /** 监听端口 */
  port: number;
  /** 心跳间隔 (毫秒) */
  heartbeatInterval?: number;
  /** 连接超时 (毫秒) */
  connectionTimeout?: number;
  /** 最大连接数 */
  maxConnections?: number;
  /** 主机绑定 */
  host?: string;
  /** 数据库实例 (用于消息持久化) */
  db?: Database;
  /** 消息缓冲区大小 */
  messageBufferSize?: number;
  /** 消息过期时间 (小时) */
  messageTTLHours?: number;
  /** 启用重连状态同步 */
  enableReconnectionSync?: boolean;
}

// ============================================================================
// WebSocket 服务器
// ============================================================================

/**
 * Interagent WebSocket 服务器
 */
export class InteragentWebSocketServer extends EventEmitter {
  private wss: WsServer | null = null;
  private clients: Map<WebSocket, ClientInfo> = new Map();
  private config: Required<WebSocketServerConfig>;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private messagePersistence: MessagePersistenceService | null = null;
  private reconnectionHandler: ReconnectionHandler | null = null;
  private globalSequence: number = 0;

  /** 默认配置 */
  private static readonly DEFAULT_CONFIG: Required<Omit<WebSocketServerConfig, 'db'>> & { db?: Database } = {
    port: 10791,
    heartbeatInterval: 30000, // 30 秒
    connectionTimeout: 60000, // 60 秒
    maxConnections: 10,
    host: "0.0.0.0",
    db: undefined,
    messageBufferSize: 10000,
    messageTTLHours: 24,
    enableReconnectionSync: true,
  };

  constructor(config: Partial<WebSocketServerConfig> = {}) {
    super();
    this.config = { ...InteragentWebSocketServer.DEFAULT_CONFIG, ...config } as Required<WebSocketServerConfig>;

    // 初始化消息持久化和重连处理器
    if (this.config.db && this.config.enableReconnectionSync) {
      this.messagePersistence = new MessagePersistenceService(
        this.config.db,
        this.config.messageTTLHours * 60 * 60 * 1000
      );
      this.reconnectionHandler = new ReconnectionHandler(this.messagePersistence);
    }
  }

  /**
   * 启动 WebSocket 服务器
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WsServer({
        port: this.config.port,
        host: this.config.host,
        maxPayload: 10 * 1024 * 1024, // 10 MB
      });

      this.wss.on("error", (error) => {
        this.emit("error", error);
        reject(error);
      });

      this.wss.on("listening", () => {
        this.startHeartbeat();
        this.emit("started", { port: this.config.port });
        resolve();
      });

      this.wss.on("connection", (ws, request) => {
        this.handleConnection(ws, request);
      });

      this.wss.on("close", () => {
        this.emit("stopped");
      });
    });
  }

  /**
   * 停止 WebSocket 服务器
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.stopHeartbeat();

    if (!this.wss) return;

    return new Promise((resolve) => {
      // 关闭所有客户端连接
      for (const [ws] of this.clients) {
        ws.close(1001, "Server shutting down");
      }
      this.clients.clear();

      this.wss!.close(() => {
        this.wss = null;
        this.isShuttingDown = false;
        resolve();
      });
    });
  }

  /**
   * 处理新连接
   */
  private handleConnection(ws: WebSocket, request: unknown): void {
    // 检查最大连接数
    if (this.clients.size >= this.config.maxConnections) {
      ws.close(1013, "Maximum connections reached");
      return;
    }

    // 从 URL 参数获取客户端 DID 和连接 ID
    const url = (request as { url?: string })?.url || "";
    const urlParams = new URLSearchParams(url.split("?")[1] || "");
    const clientDid = urlParams.get("did") || `did:anp:unknown:${ulid()}`;
    const connectionId = urlParams.get("connectionId") || ulid();
    const lastSequence = parseInt(urlParams.get("lastSeq") || "0", 10);

    const clientInfo: ClientInfo = {
      did: clientDid,
      connectionId,
      connectedAt: new Date(),
      lastActivity: new Date(),
      heartbeatCount: 0,
      currentSequence: 0,
      lastSyncedSequence: lastSequence,
    };

    this.clients.set(ws, clientInfo);
    this.emit("client:connected", { ws, clientInfo });

    // 设置消息处理
    ws.on("message", (data: RawData) => {
      this.handleMessage(ws, data);
    });

    ws.on("close", (code: number, reason: Buffer) => {
      this.clients.delete(ws);
      this.emit("client:disconnected", { did: clientInfo.did, connectionId, code, reason: reason.toString() });
    });

    ws.on("error", (error: Error) => {
      this.emit("client:error", { did: clientInfo.did, connectionId, error });
    });

    ws.on("pong", () => {
      const info = this.clients.get(ws);
      if (info) {
        info.lastActivity = new Date();
        info.heartbeatCount++;
      }
    });

    // 发送欢迎消息
    this.sendToClient(ws, {
      id: ulid(),
      type: "status.heartbeat",
      timestamp: new Date().toISOString(),
      source: "did:anp:automaton:main",
      target: clientDid,
      payload: {
        status: "healthy" as const,
        uptime: process.uptime(),
        activeTasks: 0,
        queuedTasks: 0,
      },
    });
  }

  /**
   * 处理接收的消息
   */
  private handleMessage(ws: WebSocket, data: RawData): void {
    const clientInfo = this.clients.get(ws);
    if (!clientInfo) return;

    clientInfo.lastActivity = new Date();

    try {
      const message = JSON.parse(data.toString()) as InteragentEvent | ReconnectRequest | SyncCompleteAck;

      // 处理重连请求
      if (message.type === "reconnect.request" && this.reconnectionHandler) {
        this.handleReconnectRequest(ws, clientInfo, message as ReconnectRequest);
        return;
      }

      // 处理同步完成确认
      if (message.type === "sync.complete.ack" && this.reconnectionHandler) {
        this.reconnectionHandler.handleSyncCompleteAck(message as SyncCompleteAck);
        return;
      }

      // 处理 freelance 消息类型
      const messageType = message.type;
      if (this.isFreelanceMessage(messageType)) {
        this.handleFreelanceMessage(ws, clientInfo, message as any);
        return;
      }

      // 处理普通消息
      this.emit("message", { did: clientInfo.did, connectionId: clientInfo.connectionId, message });
    } catch (error) {
      this.emit("message:error", { did: clientInfo.did, connectionId: clientInfo.connectionId, error, raw: data.toString() });
    }
  }

  /**
   * 处理重连请求
   */
  private handleReconnectRequest(ws: WebSocket, clientInfo: ClientInfo, request: ReconnectRequest): void {
    if (!this.reconnectionHandler) return;

    logger.info("Handling reconnect request", {
      connectionId: request.connectionId,
      lastSeq: request.lastSeq,
    });

    // 更新客户端信息
    clientInfo.lastSyncedSequence = request.lastSeq;

    // 获取状态同步响应
    const syncResponse = this.reconnectionHandler.handleReconnectRequest(request);

    // 发送同步响应
    this.sendToClient(ws, syncResponse as unknown as InteragentEvent);

    this.emit("reconnect:sync", {
      connectionId: request.connectionId,
      messageCount: syncResponse.messages.length,
    });
  }

  /**
   * 发送消息到客户端
   */
  private sendToClient(ws: WebSocket, message: InteragentEvent, persist: boolean = false): boolean {
    if (ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    const clientInfo = this.clients.get(ws);
    if (!clientInfo) return false;

    try {
      // 增加序列号
      this.globalSequence++;
      clientInfo.currentSequence = this.globalSequence;

      // 添加序列号到消息
      const messageWithSeq = {
        ...message,
        sequence: this.globalSequence,
      };

      // 持久化消息（如果启用）
      if (persist && this.messagePersistence) {
        this.messagePersistence.persistMessage(
          clientInfo.connectionId,
          this.globalSequence,
          message.type,
          message
        );
      }

      ws.send(JSON.stringify(messageWithSeq));
      return true;
    } catch (error) {
      this.emit("send:error", { error, message });
      return false;
    }
  }

  /**
   * 发送事件给指定客户端
   */
  sendToDid(targetDid: string, event: InteragentEvent, persist: boolean = false): boolean {
    for (const [ws, info] of this.clients) {
      if (info.did === targetDid) {
        return this.sendToClient(ws, event, persist);
      }
    }
    return false;
  }

  /**
   * 广播事件给所有客户端
   */
  broadcast(event: InteragentEvent, persist: boolean = false): number {
    let sent = 0;
    for (const [ws] of this.clients) {
      if (this.sendToClient(ws, event, persist)) {
        sent++;
      }
    }
    return sent;
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();

      for (const [ws, info] of this.clients) {
        // 检查连接超时
        const inactiveTime = now - info.lastActivity.getTime();
        if (inactiveTime > this.config.connectionTimeout) {
          ws.close(1001, "Connection timeout");
          this.clients.delete(ws);
          continue;
        }

        // 发送 ping
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 获取连接的客户端列表
   */
  getConnectedClients(): ClientInfo[] {
    return Array.from(this.clients.values());
  }

  /**
   * 获取客户端数量
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * 获取服务器状态
   */
  getServerStatus(): {
    running: boolean;
    port: number;
    clientCount: number;
    clients: ClientInfo[];
  } {
    return {
      running: this.wss !== null,
      port: this.config.port,
      clientCount: this.clients.size,
      clients: this.getConnectedClients(),
    };
  }

  /**
   * 获取错过的消息（用于重连状态同步）
   */
  async getMissedEvents(connectionId: string, lastSequence: number): Promise<any[]> {
    if (!this.messagePersistence) {
      return [];
    }

    const messages = this.messagePersistence.getMissedMessages(connectionId, lastSequence);
    return messages.map((msg) => ({
      id: msg.id,
      sequence: msg.sequence,
      type: msg.type,
      payload: msg.payload,
      createdAt: msg.createdAt.toISOString(),
    }));
  }

  /**
   * 获取消息持久化服务
   */
  getMessagePersistence(): MessagePersistenceService | null {
    return this.messagePersistence;
  }

  /**
   * 获取重连处理器
   */
  getReconnectionHandler(): ReconnectionHandler | null {
    return this.reconnectionHandler;
  }

  /**
   * 清理过期消息
   */
  cleanupExpiredMessages(): number {
    if (!this.messagePersistence) {
      return 0;
    }
    return this.messagePersistence.cleanupExpired();
  }

  /**
   * 检查消息是否为 freelance 消息类型
   */
  private isFreelanceMessage(messageType: string): boolean {
    const freelanceMessageTypes = [
      "GenesisPrompt",
      "GenesisPromptAck",
      "TaskAccept",
      "TaskReject",
      "ProgressReport",
      "ProgressReportAck",
      "ErrorReport",
      "ErrorReportAck",
      "ReconnectRequest",
      "StateSyncResponse",
      "SyncCompleteAck",
      "HumanInterventionRequest",
      "HumanInterventionResponse",
      "TaskPause",
      "TaskResume",
      "TaskCancel",
    ];
    return freelanceMessageTypes.includes(messageType);
  }

  /**
   * 处理 freelance 消息
   */
  private handleFreelanceMessage(
    ws: WebSocket,
    clientInfo: ClientInfo,
    message: any
  ): void {
    logger.debug("Handling freelance message", {
      type: message.type,
      from: clientInfo.did,
    });

    // 根据 @type 字段确定具体的消息类型
    const messageType = message["@type"] || message.type;

    switch (messageType) {
      case "freelance:ProgressReport":
        this.emit("freelance:progress", {
          did: clientInfo.did,
          connectionId: clientInfo.connectionId,
          message,
        });
        break;

      case "freelance:ErrorReport":
        this.emit("freelance:error", {
          did: clientInfo.did,
          connectionId: clientInfo.connectionId,
          message,
        });
        break;

      case "freelance:GenesisPromptAck":
        this.emit("freelance:genesis_ack", {
          did: clientInfo.did,
          connectionId: clientInfo.connectionId,
          message,
        });
        break;

      case "freelance:TaskAccept":
        this.emit("freelance:task_accept", {
          did: clientInfo.did,
          connectionId: clientInfo.connectionId,
          message,
        });
        break;

      case "freelance:TaskReject":
        this.emit("freelance:task_reject", {
          did: clientInfo.did,
          connectionId: clientInfo.connectionId,
          message,
        });
        break;

      case "freelance:HumanInterventionResponse":
        this.emit("freelance:intervention_response", {
          did: clientInfo.did,
          connectionId: clientInfo.connectionId,
          message,
        });
        break;

      case "freelance:ReconnectRequest":
        // 重连请求由 handleReconnectRequest 处理
        if (this.reconnectionHandler) {
          this.handleReconnectRequest(ws, clientInfo, message);
        }
        break;

      default:
        // 未知的 freelance 消息类型，记录日志
        logger.warn("Unknown freelance message type", { messageType });
        this.emit("freelance:unknown", {
          did: clientInfo.did,
          connectionId: clientInfo.connectionId,
          message,
        });
        break;
    }
  }

  /**
   * 发送 Genesis Prompt 到 Nanobot
   */
  sendGenesisPrompt(
    targetDid: string,
    payload: {
      taskId: string;
      projectId: string;
      goalId: string;
      genesisPrompt: string;
      context: Record<string, unknown>;
    }
  ): boolean {
    const event = {
      id: ulid(),
      type: "GenesisPrompt",
      "@type": "freelance:GenesisPrompt",
      timestamp: new Date().toISOString(),
      source: "did:anp:automaton:main",
      target: targetDid,
      payload: {
        "freelance:taskId": payload.taskId,
        "freelance:projectId": payload.projectId,
        "freelance:goalId": payload.goalId,
        "anp:prompt": payload.genesisPrompt,
        "anp:context": payload.context,
      },
    };

    return this.sendToDid(targetDid, event as unknown as InteragentEvent, true);
  }

  /**
   * 发送进度报告确认到 Nanobot
   */
  sendProgressReportAck(
    targetDid: string,
    payload: {
      taskId: string;
      reportId: string;
      actionRequired?: string;
    }
  ): boolean {
    const event = {
      id: ulid(),
      type: "ProgressReportAck",
      "@type": "freelance:ProgressReportAck",
      timestamp: new Date().toISOString(),
      source: "did:anp:automaton:main",
      target: targetDid,
      payload: {
        "freelance:taskId": payload.taskId,
        "freelance:reportId": payload.reportId,
        "freelance:acknowledgedAt": new Date().toISOString(),
        "freelance:actionRequired": payload.actionRequired,
      },
    };

    return this.sendToDid(targetDid, event as unknown as InteragentEvent, true);
  }

  /**
   * 发送错误报告确认到 Nanobot
   */
  sendErrorReportAck(
    targetDid: string,
    payload: {
      taskId: string;
      reportId: string;
      interventionCreated?: boolean;
      interventionId?: string;
      actionRequired?: string;
    }
  ): boolean {
    const event = {
      id: ulid(),
      type: "ErrorReportAck",
      "@type": "freelance:ErrorReportAck",
      timestamp: new Date().toISOString(),
      source: "did:anp:automaton:main",
      target: targetDid,
      payload: {
        "freelance:taskId": payload.taskId,
        "freelance:reportId": payload.reportId,
        "freelance:acknowledgedAt": new Date().toISOString(),
        "freelance:interventionCreated": payload.interventionCreated,
        "freelance:interventionId": payload.interventionId,
        "freelance:actionRequired": payload.actionRequired,
      },
    };

    return this.sendToDid(targetDid, event as unknown as InteragentEvent, true);
  }

  /**
   * 发送人工介入请求到 Nanobot
   */
  sendHumanInterventionRequest(
    targetDid: string,
    payload: {
      interventionId: string;
      interventionType: string;
      projectId?: string;
      goalId?: string;
      taskId?: string;
      reason: string;
      context: Record<string, unknown>;
      priority: "low" | "normal" | "high" | "urgent";
      slaDeadline: string;
    }
  ): boolean {
    const event = {
      id: ulid(),
      type: "HumanInterventionRequest",
      "@type": "freelance:HumanInterventionRequest",
      timestamp: new Date().toISOString(),
      source: "did:anp:automaton:main",
      target: targetDid,
      payload: {
        "freelance:interventionId": payload.interventionId,
        "freelance:interventionType": payload.interventionType,
        "freelance:projectId": payload.projectId,
        "freelance:goalId": payload.goalId,
        "freelance:taskId": payload.taskId,
        "freelance:reason": payload.reason,
        "freelance:context": payload.context,
        "freelance:priority": payload.priority,
        "freelance:slaDeadline": payload.slaDeadline,
        "freelance:requestedAt": new Date().toISOString(),
      },
    };

    return this.sendToDid(targetDid, event as unknown as InteragentEvent, true);
  }

  /**
   * 发送任务暂停命令到 Nanobot
   */
  sendTaskPause(
    targetDid: string,
    payload: {
      taskId: string;
      projectId?: string;
      reason: string;
      resumeAt?: string;
    }
  ): boolean {
    const event = {
      id: ulid(),
      type: "TaskPause",
      "@type": "freelance:TaskPause",
      timestamp: new Date().toISOString(),
      source: "did:anp:automaton:main",
      target: targetDid,
      payload: {
        "freelance:taskId": payload.taskId,
        "freelance:projectId": payload.projectId,
        "freelance:pausedAt": new Date().toISOString(),
        "freelance:reason": payload.reason,
        "freelance:resumeAt": payload.resumeAt,
      },
    };

    return this.sendToDid(targetDid, event as unknown as InteragentEvent, true);
  }

  /**
   * 发送任务恢复命令到 Nanobot
   */
  sendTaskResume(
    targetDid: string,
    payload: {
      taskId: string;
      projectId?: string;
    }
  ): boolean {
    const event = {
      id: ulid(),
      type: "TaskResume",
      "@type": "freelance:TaskResume",
      timestamp: new Date().toISOString(),
      source: "did:anp:automaton:main",
      target: targetDid,
      payload: {
        "freelance:taskId": payload.taskId,
        "freelance:projectId": payload.projectId,
        "freelance:resumedAt": new Date().toISOString(),
      },
    };

    return this.sendToDid(targetDid, event as unknown as InteragentEvent, true);
  }

  /**
   * 发送任务取消命令到 Nanobot
   */
  sendTaskCancel(
    targetDid: string,
    payload: {
      taskId: string;
      projectId?: string;
      reason: string;
      cleanupRequired?: boolean;
    }
  ): boolean {
    const event = {
      id: ulid(),
      type: "TaskCancel",
      "@type": "freelance:TaskCancel",
      timestamp: new Date().toISOString(),
      source: "did:anp:automaton:main",
      target: targetDid,
      payload: {
        "freelance:taskId": payload.taskId,
        "freelance:projectId": payload.projectId,
        "freelance:cancelledAt": new Date().toISOString(),
        "freelance:reason": payload.reason,
        "freelance:cleanupRequired": payload.cleanupRequired ?? false,
      },
    };

    return this.sendToDid(targetDid, event as unknown as InteragentEvent, true);
  }
}

// ============================================================================
// WebSocket 连接池
// ============================================================================

/** 连接池中的连接信息 */
interface PooledConnection {
  /** WebSocket 连接 */
  ws: WebSocket;
  /** 目标 URL */
  url: string;
  /** 连接状态 */
  state: ConnectionState;
  /** 连接时间 */
  connectedAt: Date;
  /** 最后使用时间 */
  lastUsedAt: Date;
  /** 使用次数 */
  useCount: number;
  /** 是否正在重连 */
  reconnecting: boolean;
  /** 重试次数 */
  retryCount: number;
}

/** 连接池配置 */
export interface ConnectionPoolConfig {
  /** 最大连接数 */
  maxConnections?: number;
  /** 连接最大空闲时间 (毫秒) */
  maxIdleTime?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重连延迟基数 (毫秒) */
  reconnectDelayBase?: number;
  /** 重连延迟最大值 (毫秒) */
  reconnectDelayMax?: number;
  /** 心跳间隔 (毫秒) */
  heartbeatInterval?: number;
}

/** 连接池统计 */
export interface PoolStats {
  /** 总连接数 */
  totalConnections: number;
  /** 活跃连接数 */
  activeConnections: number;
  /** 空闲连接数 */
  idleConnections: number;
  /** 总使用次数 */
  totalUses: number;
  /** 连接复用率 (0-100) */
  reuseRate: number;
  /** 平均重试次数 */
  avgRetries: number;
}

/**
 * WebSocket 连接池
 *
 * 功能：
 * - 连接复用：相同 URL 的连接可以被复用
 * - 自动重连：连接断开时自动重连，使用指数退避
 * - 心跳检测：定期检测连接健康状态
 * - 空闲清理：自动清理长时间空闲的连接
 */
export class WebSocketConnectionPool extends EventEmitter {
  private connections: Map<string, PooledConnection> = new Map();
  private config: Required<ConnectionPoolConfig>;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private isShutdown = false;

  /** 默认配置 */
  private static readonly DEFAULT_CONFIG: Required<ConnectionPoolConfig> = {
    maxConnections: 10,
    maxIdleTime: 300000, // 5 分钟
    maxRetries: 3,
    reconnectDelayBase: 1000, // 1 秒
    reconnectDelayMax: 30000, // 30 秒
    heartbeatInterval: 30000, // 30 秒
  };

  constructor(config: Partial<ConnectionPoolConfig> = {}) {
    super();
    this.config = { ...WebSocketConnectionPool.DEFAULT_CONFIG, ...config };
  }

  /**
   * 获取或创建连接
   */
  async acquire(url: string): Promise<WebSocket> {
    if (this.isShutdown) {
      throw new Error("Connection pool is shut down");
    }

    // SECURITY: Enforce TLS for non-localhost connections
    // This prevents man-in-the-middle attacks on interagent communication
    if (!isLocalhostUrl(url) && !url.startsWith("wss://")) {
      throw new Error(
        `Insecure WebSocket connection blocked. Use wss:// for remote connections. ` +
        `Received: ${url.slice(0, 50)}...`
      );
    }

    // 检查是否已有可用连接
    const existing = this.connections.get(url);
    if (existing && existing.state === "connected" && existing.ws.readyState === WebSocket.OPEN) {
      existing.lastUsedAt = new Date();
      existing.useCount++;
      this.emit("connection:reused", { url, useCount: existing.useCount });
      return existing.ws;
    }

    // 创建新连接
    return this.createConnection(url);
  }

  /**
   * 创建新连接
   */
  private createConnection(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      // 检查连接数限制
      if (this.connections.size >= this.config.maxConnections) {
        this.cleanupIdleConnections();
        if (this.connections.size >= this.config.maxConnections) {
          reject(new Error("Maximum connections reached"));
          return;
        }
      }

      const ws = new WebSocket(url);
      const now = new Date();

      const pooledConnection: PooledConnection = {
        ws,
        url,
        state: "connecting",
        connectedAt: now,
        lastUsedAt: now,
        useCount: 0,
        reconnecting: false,
        retryCount: 0,
      };

      this.connections.set(url, pooledConnection);

      ws.on("open", () => {
        pooledConnection.state = "connected";
        pooledConnection.lastUsedAt = new Date();
        this.emit("connection:created", { url });
        this.startHeartbeat();
        resolve(ws);
      });

      ws.on("error", (error) => {
        this.emit("connection:error", { url, error });
        if (pooledConnection.state === "connecting") {
          this.connections.delete(url);
          reject(error);
        }
      });

      ws.on("close", () => {
        pooledConnection.state = "disconnected";
        this.handleDisconnect(url, pooledConnection);
      });
    });
  }

  /**
   * 处理连接断开
   */
  private handleDisconnect(url: string, conn: PooledConnection): void {
    if (this.isShutdown) {
      this.connections.delete(url);
      return;
    }

    // 检查是否需要重连
    if (conn.retryCount < this.config.maxRetries && !conn.reconnecting) {
      conn.reconnecting = true;
      conn.retryCount++;
      conn.state = "connecting";

      const delay = this.calculateReconnectDelay(conn.retryCount);

      this.emit("connection:reconnecting", {
        url,
        retryCount: conn.retryCount,
        delay,
      });

      setTimeout(() => {
        this.reconnect(url, conn);
      }, delay);
    } else {
      this.emit("connection:failed", { url, retryCount: conn.retryCount });
      this.connections.delete(url);
    }
  }

  /**
   * 重新连接
   */
  private reconnect(url: string, oldConn: PooledConnection): void {
    if (this.isShutdown) {
      return;
    }

    this.connections.delete(url);

    const ws = new WebSocket(url);
    const now = new Date();

    const pooledConnection: PooledConnection = {
      ws,
      url,
      state: "connecting",
      connectedAt: now,
      lastUsedAt: now,
      useCount: oldConn.useCount,
      reconnecting: false,
      retryCount: oldConn.retryCount,
    };

    this.connections.set(url, pooledConnection);

    ws.on("open", () => {
      pooledConnection.state = "connected";
      pooledConnection.reconnecting = false;
      this.emit("connection:reconnected", { url, retryCount: pooledConnection.retryCount });
    });

    ws.on("error", (error) => {
      this.emit("connection:error", { url, error });
      this.handleDisconnect(url, pooledConnection);
    });

    ws.on("close", () => {
      pooledConnection.state = "disconnected";
      this.handleDisconnect(url, pooledConnection);
    });
  }

  /**
   * 计算重连延迟 (指数退避)
   */
  private calculateReconnectDelay(retryCount: number): number {
    const delay = this.config.reconnectDelayBase * Math.pow(2, retryCount - 1);
    return Math.min(delay, this.config.reconnectDelayMax);
  }

  /**
   * 释放连接 (不关闭，只是标记为可复用)
   */
  release(url: string): void {
    const conn = this.connections.get(url);
    if (conn) {
      conn.lastUsedAt = new Date();
      this.emit("connection:released", { url });
    }
  }

  /**
   * 关闭并移除连接
   */
  async close(url: string): Promise<void> {
    const conn = this.connections.get(url);
    if (!conn) {
      return;
    }

    return new Promise<void>((resolve) => {
      if (conn.ws.readyState === WebSocket.OPEN || conn.ws.readyState === WebSocket.CONNECTING) {
        conn.ws.on("close", () => {
          this.connections.delete(url);
          resolve();
        });
        conn.ws.close(1000, "Connection closed by pool");
      } else {
        this.connections.delete(url);
        resolve();
      }
    });
  }

  /**
   * 清理空闲连接
   */
  private cleanupIdleConnections(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [url, conn] of this.connections) {
      const idleTime = now - conn.lastUsedAt.getTime();
      if (conn.state === "connected" && idleTime > this.config.maxIdleTime) {
        toDelete.push(url);
      }
    }

    for (const url of toDelete) {
      this.close(url).catch(() => {
        // 忽略关闭错误
      });
      this.emit("connection:cleaned", { url, reason: "idle" });
    }
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();

      for (const [url, conn] of this.connections) {
        if (conn.state !== "connected" || conn.ws.readyState !== WebSocket.OPEN) {
          continue;
        }

        const idleTime = now - conn.lastUsedAt.getTime();
        if (idleTime > this.config.maxIdleTime) {
          // 连接空闲太久，关闭
          this.close(url).catch(() => {});
          continue;
        }

        // 发送 ping
        try {
          conn.ws.ping();
        } catch {
          // ping 失败，连接可能已断开
        }
      }
    }, this.config.heartbeatInterval);

    // 启动定期清理
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleConnections();
    }, this.config.heartbeatInterval * 2);
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 获取连接池统计
   */
  getStats(): PoolStats {
    const connections = Array.from(this.connections.values());
    const activeConnections = connections.filter((c) => c.state === "connected").length;
    const totalUses = connections.reduce((sum, c) => sum + c.useCount, 0);
    const totalRetries = connections.reduce((sum, c) => sum + c.retryCount, 0);
    const reusedConnections = connections.filter((c) => c.useCount > 1).length;

    return {
      totalConnections: connections.length,
      activeConnections,
      idleConnections: connections.length - activeConnections,
      totalUses,
      reuseRate: totalUses > 0 ? (totalUses - connections.length) / totalUses * 100 : 0,
      avgRetries: connections.length > 0 ? totalRetries / connections.length : 0,
    };
  }

  /**
   * 关闭所有连接
   */
  async shutdown(): Promise<void> {
    this.isShutdown = true;
    this.stopHeartbeat();

    const closePromises = Array.from(this.connections.keys()).map((url) => this.close(url));
    await Promise.all(closePromises);

    this.emit("shutdown");
  }

  /**
   * 检查连接是否存在且可用
   */
  hasConnection(url: string): boolean {
    const conn = this.connections.get(url);
    return conn !== undefined && conn.state === "connected" && conn.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 获取连接信息
   */
  getConnectionInfo(url: string): PooledConnection | undefined {
    return this.connections.get(url);
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * Check if a URL is a localhost address (allowed to use non-TLS)
 */
function isLocalhostUrl(url: string): boolean {
  try {
    // Handle WebSocket URLs
    const httpUrl = url.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
    const urlObj = new URL(httpUrl);
    const hostname = urlObj.hostname.toLowerCase();

    // Allow localhost, 127.x.x.x, and ::1
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.startsWith("127.") ||
      hostname === "[::1]"
    );
  } catch {
    // If URL parsing fails, do a simple string check
    const lower = url.toLowerCase();
    return lower.includes("localhost") || lower.includes("127.0.0.1");
  }
}

/**
 * 创建事件基础结构
 */
export function createEventBase<T extends InteragentEventType>(
  type: T,
  source: string,
  target: string,
  correlationId?: string
): InteragentEventBase & { type: T } {
  return {
    id: ulid(),
    type,
    timestamp: new Date().toISOString(),
    source,
    target,
    correlationId,
  };
}

/**
 * 创建进度事件
 */
export function createProgressEvent(
  source: string,
  target: string,
  payload: TaskProgressEvent["payload"],
  correlationId?: string
): TaskProgressEvent {
  return {
    ...createEventBase("task.progress", source, target, correlationId),
    payload,
  };
}

/**
 * 创建错误事件
 */
export function createErrorEvent(
  source: string,
  target: string,
  payload: TaskErrorEvent["payload"],
  correlationId?: string
): TaskErrorEvent {
  return {
    ...createEventBase("task.error", source, target, correlationId),
    payload,
  };
}

/**
 * 创建心跳事件
 */
export function createHeartbeatEvent(
  source: string,
  target: string,
  payload: StatusHeartbeatEvent["payload"]
): StatusHeartbeatEvent {
  return {
    ...createEventBase("status.heartbeat", source, target),
    payload,
  };
}
