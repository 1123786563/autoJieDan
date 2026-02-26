/**
 * HTTP 连接池管理器
 * 实现 Keep-Alive 连接复用，提升网络请求性能
 *
 * @module interagent/http/pool
 * @version 1.0.0
 */

import http from "http";
import https from "https";
import { URL } from "url";

// ============================================================================
// 类型定义
// ============================================================================

/** 连接池配置 */
export interface ConnectionPoolConfig {
  /** 最大连接数 */
  maxSockets?: number;
  /** 每个主机的最大空闲连接数 */
  maxFreeSockets?: number;
  /** 连接超时 (毫秒) */
  timeout?: number;
  /** Keep-Alive 超时 (毫秒) */
  keepAliveTimeout?: number;
}

/** 连接池统计 */
export interface PoolStats {
  /** HTTP 连接数 */
  httpSockets: number;
  /** HTTPS 连接数 */
  httpsSockets: number;
  /** HTTP 空闲连接数 */
  httpFreeSockets: number;
  /** HTTPS 空闲连接数 */
  httpsFreeSockets: number;
  /** 总请求数 */
  totalRequests: number;
  /** 复用连接数 */
  reusedConnections: number;
}

/** 请求选项 */
export interface PoolRequestOptions {
  /** 请求方法 */
  method?: string;
  /** 请求头 */
  headers?: Record<string, string>;
  /** 请求体 */
  body?: string | Buffer;
  /** 超时 (毫秒) */
  timeout?: number;
}

/** 响应结果 */
export interface PoolResponse {
  /** 状态码 */
  status: number;
  /** 状态文本 */
  statusText: string;
  /** 响应头 */
  headers: Record<string, string>;
  /** 响应体 */
  body: string;
  /** 是否从连接池复用 */
  reused: boolean;
}

// ============================================================================
// HTTP 连接池
// ============================================================================

/**
 * HTTP 连接池管理器
 *
 * 使用 Node.js Agent 实现 Keep-Alive 连接复用
 *
 * @example
 * ```typescript
 * const pool = new ConnectionPool({
 *   maxSockets: 50,
 *   keepAliveTimeout: 30000,
 * });
 *
 * const response = await pool.request('https://example.com/api', {
 *   method: 'GET',
 *   headers: { 'Accept': 'application/json' },
 * });
 *
 * console.log(response.status, response.body);
 *
 * // 获取统计信息
 * const stats = pool.getStats();
 * console.log(`Reused connections: ${stats.reusedConnections}`);
 * ```
 */
export class ConnectionPool {
  private httpAgent: http.Agent;
  private httpsAgent: https.Agent;
  private config: Required<ConnectionPoolConfig>;
  private stats: PoolStats;
  private closed: boolean = false;

  private static readonly DEFAULT_CONFIG: Required<ConnectionPoolConfig> = {
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 30000,
    keepAliveTimeout: 30000,
  };

  constructor(config?: ConnectionPoolConfig) {
    this.config = { ...ConnectionPool.DEFAULT_CONFIG, ...config };

    const agentOptions = {
      keepAlive: true,
      keepAliveMsecs: this.config.keepAliveTimeout,
      maxSockets: this.config.maxSockets,
      maxFreeSockets: this.config.maxFreeSockets,
      timeout: this.config.timeout,
    };

    this.httpAgent = new http.Agent(agentOptions);
    this.httpsAgent = new https.Agent(agentOptions);

    this.stats = {
      httpSockets: 0,
      httpsSockets: 0,
      httpFreeSockets: 0,
      httpsFreeSockets: 0,
      totalRequests: 0,
      reusedConnections: 0,
    };
  }

  /**
   * 发送 HTTP 请求
   */
  async request(url: string, options: PoolRequestOptions = {}): Promise<PoolResponse> {
    if (this.closed) {
      throw new Error("Connection pool is closed");
    }

    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const agent = isHttps ? this.httpsAgent : this.httpAgent;

    // 更新统计
    this.stats.totalRequests++;

    return new Promise((resolve, reject) => {
      const requestOptions: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || "GET",
        headers: options.headers || {},
        agent,
        timeout: options.timeout || this.config.timeout,
      };

      const req = isHttps
        ? https.request(requestOptions, (res) => {
            this.handleResponse(res, resolve, reject);
          })
        : http.request(requestOptions, (res) => {
            this.handleResponse(res, resolve, reject);
          });

      // 处理超时
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });

      // 处理错误
      req.on("error", (error) => {
        reject(error);
      });

      // 发送请求体
      if (options.body) {
        if (Buffer.isBuffer(options.body)) {
          req.write(options.body);
        } else {
          req.write(options.body, "utf-8");
        }
      }

      req.end();
    });
  }

  /**
   * 发送 GET 请求
   */
  async get(url: string, headers?: Record<string, string>): Promise<PoolResponse> {
    return this.request(url, { method: "GET", headers });
  }

  /**
   * 发送 POST 请求
   */
  async post(
    url: string,
    body: string | Buffer | object,
    headers?: Record<string, string>
  ): Promise<PoolResponse> {
    const bodyStr = typeof body === "object" && !Buffer.isBuffer(body) ? JSON.stringify(body) : body;
    return this.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: bodyStr,
    });
  }

  /**
   * 发送 JSON 请求
   */
  async json<T = unknown>(
    url: string,
    options: PoolRequestOptions = {}
  ): Promise<T> {
    const response = await this.request(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...options.headers,
      },
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return JSON.parse(response.body) as T;
  }

  /**
   * 获取连接池统计
   */
  getStats(): PoolStats {
    // 从 Agent 获取实际连接数
    const httpStatus = this.getAgentStatus(this.httpAgent);
    const httpsStatus = this.getAgentStatus(this.httpsAgent);

    return {
      ...this.stats,
      httpSockets: httpStatus.sockets,
      httpsSockets: httpsStatus.sockets,
      httpFreeSockets: httpStatus.freeSockets,
      httpsFreeSockets: httpsStatus.freeSockets,
    };
  }

  /**
   * 销毁所有连接
   */
  destroy(): void {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
    this.closed = true;
  }

  /**
   * 检查连接池是否已关闭
   */
  isClosed(): boolean {
    return this.closed;
  }

  // ------------------------------------------------------------------------
  // 私有方法
  // ------------------------------------------------------------------------

  /**
   * 处理响应
   */
  private handleResponse(
    res: http.IncomingMessage,
    resolve: (value: PoolResponse) => void,
    reject: (error: Error) => void
  ): void {
    const chunks: Buffer[] = [];

    res.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    res.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");

      // 检查是否复用了连接
      const reused = res.headers["connection"] === "keep-alive";

      if (reused) {
        this.stats.reusedConnections++;
      }

      resolve({
        status: res.statusCode || 0,
        statusText: res.statusMessage || "",
        headers: res.headers as Record<string, string>,
        body,
        reused,
      });
    });

    res.on("error", (error) => {
      reject(error);
    });
  }

  /**
   * 获取 Agent 状态
   */
  private getAgentStatus(agent: http.Agent): { sockets: number; freeSockets: number } {
    // Node.js Agent 内部状态
    const sockets = Object.keys(agent.sockets || {}).reduce(
      (sum, key) => sum + (agent.sockets?.[key]?.length || 0),
      0
    );
    const freeSockets = Object.keys(agent.freeSockets || {}).reduce(
      (sum, key) => sum + (agent.freeSockets?.[key]?.length || 0),
      0
    );

    return { sockets, freeSockets };
  }
}

// ============================================================================
// 全局连接池实例
// ============================================================================

let globalPool: ConnectionPool | null = null;

/**
 * 获取全局连接池
 */
export function getGlobalPool(): ConnectionPool {
  if (!globalPool) {
    globalPool = new ConnectionPool();
  }
  return globalPool;
}

/**
 * 设置全局连接池
 */
export function setGlobalPool(pool: ConnectionPool): void {
  globalPool = pool;
}

/**
 * 使用全局连接池发送请求
 */
export async function poolRequest(
  url: string,
  options?: PoolRequestOptions
): Promise<PoolResponse> {
  return getGlobalPool().request(url, options);
}

/**
 * 使用全局连接池发送 GET 请求
 */
export async function poolGet(
  url: string,
  headers?: Record<string, string>
): Promise<PoolResponse> {
  return getGlobalPool().get(url, headers);
}

/**
 * 使用全局连接池发送 POST 请求
 */
export async function poolPost(
  url: string,
  body: string | Buffer | object,
  headers?: Record<string, string>
): Promise<PoolResponse> {
  return getGlobalPool().post(url, body, headers);
}
