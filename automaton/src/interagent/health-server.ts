/**
 * HTTP 健康检查服务器
 * 提供 /health 和 /status 端点用于监控
 *
 * @module interagent/health-server
 * @version 1.0.0
 */

import * as http from "http";
import { EventEmitter } from "events";
import type { InteragentWebSocketServer } from "./websocket.js";

// ============================================================================
// 类型定义
// ============================================================================

/** 健康状态 */
export type HealthStatus = "healthy" | "degraded" | "unhealthy";

/** 基础健康响应 */
export interface HealthResponse {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  version: string;
}

/** 详细状态响应 */
export interface StatusResponse extends HealthResponse {
  websocket: {
    running: boolean;
    port: number;
    clientCount: number;
    clients: Array<{
      did: string;
      connectedAt: string;
      lastActivity: string;
      heartbeatCount: number;
    }>;
  };
  system: {
    platform: string;
    nodeVersion: string;
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
  };
  automaton: {
    did: string;
    state: string;
    creditBalance: number | null;
    currentTaskId: string | null;
  };
}

/** 健康检查服务器配置 */
export interface HealthServerConfig {
  /** 监听端口 */
  port: number;
  /** 主机绑定 */
  host?: string;
  /** Automaton DID */
  automatonDid?: string;
  /** 版本号 */
  version?: string;
}

/** 健康检查器函数类型 */
export type HealthChecker = () => Promise<HealthStatus> | HealthStatus;

/** 状态提供器函数类型 */
export type StatusProvider = () => Promise<{
  state: string;
  creditBalance: number | null;
  currentTaskId: string | null;
}> | {
  state: string;
  creditBalance: number | null;
  currentTaskId: string | null;
};

// ============================================================================
// 健康检查 HTTP 服务器
// ============================================================================

/**
 * HTTP 健康检查服务器
 */
export class HealthCheckServer extends EventEmitter {
  private server: http.Server | null = null;
  private config: Required<HealthServerConfig>;
  private wsServer: InteragentWebSocketServer | null = null;
  private healthChecker: HealthChecker | null = null;
  private statusProvider: StatusProvider | null = null;
  private startTime: number;
  private cpuUsageStart: NodeJS.CpuUsage;

  /** 默认配置 */
  private static readonly DEFAULT_CONFIG: Required<HealthServerConfig> = {
    port: 18792,
    host: "0.0.0.0",
    automatonDid: "did:anp:automaton:main",
    version: "1.0.0",
  };

  constructor(config: Partial<HealthServerConfig> = {}) {
    super();
    this.config = { ...HealthCheckServer.DEFAULT_CONFIG, ...config };
    this.startTime = Date.now();
    this.cpuUsageStart = process.cpuUsage();
  }

  /**
   * 设置 WebSocket 服务器引用
   */
  setWebSocketServer(wsServer: InteragentWebSocketServer): void {
    this.wsServer = wsServer;
  }

  /**
   * 设置健康检查器
   */
  setHealthChecker(checker: HealthChecker): void {
    this.healthChecker = checker;
  }

  /**
   * 设置状态提供器
   */
  setStatusProvider(provider: StatusProvider): void {
    this.statusProvider = provider;
  }

  /**
   * 启动 HTTP 服务器
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on("error", (error) => {
        this.emit("error", error);
        reject(error);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.emit("started", { port: this.config.port });
        resolve();
      });
    });
  }

  /**
   * 停止 HTTP 服务器
   */
  async stop(): Promise<void> {
    if (!this.server) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        this.emit("stopped");
        resolve();
      });
    });
  }

  /**
   * 获取服务器状态
   */
  getServerStatus(): {
    running: boolean;
    port: number;
    host: string;
  } {
    return {
      running: this.server !== null,
      port: this.config.port,
      host: this.config.host,
    };
  }

  /**
   * 处理 HTTP 请求
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = req.url || "/";
    const method = req.method || "GET";

    // 设置 CORS 头
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // 处理 OPTIONS 预检请求
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // 只允许 GET 请求
    if (method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method Not Allowed" }));
      return;
    }

    try {
      // 路由处理
      if (url === "/health" || url === "/healthz") {
        await this.handleHealth(req, res);
      } else if (url === "/status" || url === "/statusz") {
        await this.handleStatus(req, res);
      } else if (url === "/ready" || url === "/readyz") {
        await this.handleReady(req, res);
      } else if (url === "/live" || url === "/livez") {
        await this.handleLive(req, res);
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not Found" }));
      }
    } catch (error) {
      this.emit("request:error", { url, error });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Internal Server Error",
          message: error instanceof Error ? error.message : "Unknown error",
        })
      );
    }
  }

  /**
   * 处理 /health 请求 - 基本健康状态
   */
  private async handleHealth(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    let status: HealthStatus = "healthy";

    // 如果有自定义健康检查器，使用它
    if (this.healthChecker) {
      try {
        status = await this.healthChecker();
      } catch {
        status = "unhealthy";
      }
    }

    // 如果 WebSocket 服务器未运行，标记为 degraded
    if (this.wsServer && !this.wsServer.getServerStatus().running) {
      status = status === "healthy" ? "degraded" : status;
    }

    const response: HealthResponse = {
      status,
      timestamp: new Date().toISOString(),
      uptime: this.getUptime(),
      version: this.config.version,
    };

    const statusCode = status === "unhealthy" ? 503 : 200;
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  /**
   * 处理 /status 请求 - 详细状态
   */
  private async handleStatus(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    let healthStatus: HealthStatus = "healthy";

    if (this.healthChecker) {
      try {
        healthStatus = await this.healthChecker();
      } catch {
        healthStatus = "unhealthy";
      }
    }

    // 获取 WebSocket 服务器状态
    const wsStatus = this.wsServer
      ? this.wsServer.getServerStatus()
      : { running: false, port: 0, clientCount: 0, clients: [] };

    if (this.wsServer && !wsStatus.running) {
      healthStatus = healthStatus === "healthy" ? "degraded" : healthStatus;
    }

    // 获取 Automaton 状态
    let automatonStatus = {
      state: "unknown",
      creditBalance: null as number | null,
      currentTaskId: null as string | null,
    };

    if (this.statusProvider) {
      try {
        automatonStatus = await this.statusProvider();
      } catch {
        // 保持默认值
      }
    }

    const response: StatusResponse = {
      status: healthStatus,
      timestamp: new Date().toISOString(),
      uptime: this.getUptime(),
      version: this.config.version,
      websocket: {
        running: wsStatus.running,
        port: wsStatus.port,
        clientCount: wsStatus.clientCount,
        clients: wsStatus.clients.map((c) => ({
          did: c.did,
          connectedAt: c.connectedAt.toISOString(),
          lastActivity: c.lastActivity.toISOString(),
          heartbeatCount: c.heartbeatCount,
        })),
      },
      system: {
        platform: process.platform,
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(this.cpuUsageStart),
      },
      automaton: {
        did: this.config.automatonDid,
        ...automatonStatus,
      },
    };

    const statusCode = healthStatus === "unhealthy" ? 503 : 200;
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  /**
   * 处理 /ready 请求 - 就绪探针 (Kubernetes 风格)
   */
  private async handleReady(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // 就绪探针检查服务是否准备好接收流量
    const isReady =
      this.server !== null &&
      (this.wsServer === null || this.wsServer.getServerStatus().running);

    const response = {
      ready: isReady,
      timestamp: new Date().toISOString(),
    };

    res.writeHead(isReady ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  /**
   * 处理 /live 请求 - 存活探针 (Kubernetes 风格)
   */
  private async handleLive(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // 存活探针检查进程是否存活
    const response = {
      alive: true,
      timestamp: new Date().toISOString(),
      uptime: this.getUptime(),
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  /**
   * 获取运行时间（秒）
   */
  private getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 创建默认的健康检查器
 */
export function createDefaultHealthChecker(
  wsServer: InteragentWebSocketServer | null
): HealthChecker {
  return () => {
    if (!wsServer) return "healthy";
    return wsServer.getServerStatus().running ? "healthy" : "degraded";
  };
}

/**
 * 创建简单的状态提供器
 */
export function createSimpleStatusProvider(
  getState: () => string,
  getCreditBalance: () => number | null,
  getCurrentTaskId: () => string | null
): StatusProvider {
  return () => ({
    state: getState(),
    creditBalance: getCreditBalance(),
    currentTaskId: getCurrentTaskId(),
  });
}
