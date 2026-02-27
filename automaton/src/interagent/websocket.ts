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
  /** 连接时间 */
  connectedAt: Date;
  /** 最后活动时间 */
  lastActivity: Date;
  /** 心跳计数 */
  heartbeatCount: number;
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

  /** 默认配置 */
  private static readonly DEFAULT_CONFIG: Required<WebSocketServerConfig> = {
    port: 10791,
    heartbeatInterval: 30000, // 30 秒
    connectionTimeout: 60000, // 60 秒
    maxConnections: 10,
    host: "0.0.0.0",
  };

  constructor(config: Partial<WebSocketServerConfig> = {}) {
    super();
    this.config = { ...InteragentWebSocketServer.DEFAULT_CONFIG, ...config };
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

    // 从 URL 参数获取客户端 DID
    const url = (request as { url?: string })?.url || "";
    const urlParams = new URLSearchParams(url.split("?")[1] || "");
    const clientDid = urlParams.get("did") || `did:anp:unknown:${ulid()}`;

    const clientInfo: ClientInfo = {
      did: clientDid,
      connectedAt: new Date(),
      lastActivity: new Date(),
      heartbeatCount: 0,
    };

    this.clients.set(ws, clientInfo);
    this.emit("client:connected", { ws, clientInfo });

    // 设置消息处理
    ws.on("message", (data: RawData) => {
      this.handleMessage(ws, data);
    });

    ws.on("close", (code: number, reason: Buffer) => {
      this.clients.delete(ws);
      this.emit("client:disconnected", { did: clientInfo.did, code, reason: reason.toString() });
    });

    ws.on("error", (error: Error) => {
      this.emit("client:error", { did: clientInfo.did, error });
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
      const message = JSON.parse(data.toString()) as InteragentEvent;
      this.emit("message", { did: clientInfo.did, message });
    } catch (error) {
      this.emit("message:error", { did: clientInfo.did, error, raw: data.toString() });
    }
  }

  /**
   * 发送消息到客户端
   */
  private sendToClient(ws: WebSocket, message: InteragentEvent): boolean {
    if (ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.emit("send:error", { error, message });
      return false;
    }
  }

  /**
   * 发送事件给指定客户端
   */
  sendToDid(targetDid: string, event: InteragentEvent): boolean {
    for (const [ws, info] of this.clients) {
      if (info.did === targetDid) {
        return this.sendToClient(ws, event);
      }
    }
    return false;
  }

  /**
   * 广播事件给所有客户端
   */
  broadcast(event: InteragentEvent): number {
    let sent = 0;
    for (const [ws] of this.clients) {
      if (this.sendToClient(ws, event)) {
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
}

// ============================================================================
// 工具函数
// ============================================================================

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
