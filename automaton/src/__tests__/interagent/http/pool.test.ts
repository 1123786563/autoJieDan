/**
 * HTTP 连接池测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConnectionPool, ConnectionPoolConfig, getGlobalPool, setGlobalPool } from "../../../interagent/http/index.js";
import http from "http";
import https from "https";

// 创建简单的测试服务器
function createTestServer(port: number): http.Server {
  return http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", path: req.url }));
  });
}

describe("ConnectionPool", () => {
  let pool: ConnectionPool;
  let server: http.Server;
  const testPort = 18999;

  beforeEach(async () => {
    pool = new ConnectionPool({
      maxSockets: 10,
      maxFreeSockets: 5,
      timeout: 5000,
      keepAliveTimeout: 5000,
    });

    // 启动测试服务器
    server = createTestServer(testPort);
    await new Promise<void>((resolve) => {
      server.listen(testPort, () => resolve());
    });
  });

  afterEach(async () => {
    pool.destroy();

    // 关闭测试服务器
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe("constructor", () => {
    it("should create pool with default config", () => {
      const defaultPool = new ConnectionPool();
      expect(defaultPool).toBeDefined();
      expect(defaultPool.isClosed()).toBe(false);
      defaultPool.destroy();
    });

    it("should create pool with custom config", () => {
      const config: ConnectionPoolConfig = {
        maxSockets: 100,
        maxFreeSockets: 20,
        timeout: 10000,
      };
      const customPool = new ConnectionPool(config);
      expect(customPool).toBeDefined();
      customPool.destroy();
    });
  });

  describe("request", () => {
    it("should send GET request", async () => {
      const response = await pool.get(`http://localhost:${testPort}/test`);

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("ok");
      expect(body.path).toBe("/test");
    });

    it("should send POST request with JSON body", async () => {
      const response = await pool.post(
        `http://localhost:${testPort}/api`,
        { data: "test" },
        { "X-Custom-Header": "value" }
      );

      expect(response.status).toBe(200);
    });

    it("should handle 404 response", async () => {
      // 创建返回 404 的服务器
      const notFoundServer = http.createServer((req, res) => {
        res.writeHead(404);
        res.end("Not Found");
      });

      await new Promise<void>((resolve) => {
        notFoundServer.listen(19000, () => resolve());
      });

      const response = await pool.get(`http://localhost:19000/notfound`);
      expect(response.status).toBe(404);

      await new Promise<void>((resolve) => {
        notFoundServer.close(() => resolve());
      });
    });

    it("should track statistics", async () => {
      // 发送多个请求
      await pool.get(`http://localhost:${testPort}/1`);
      await pool.get(`http://localhost:${testPort}/2`);

      const stats = pool.getStats();
      expect(stats.totalRequests).toBe(2);
    });
  });

  describe("json", () => {
    it("should parse JSON response", async () => {
      const data = await pool.json(`http://localhost:${testPort}/api`);
      expect(data.status).toBe("ok");
    });

    it("should throw on error status", async () => {
      const errorServer = http.createServer((req, res) => {
        res.writeHead(500);
        res.end("Internal Error");
      });

      await new Promise<void>((resolve) => {
        errorServer.listen(19001, () => resolve());
      });

      await expect(pool.json(`http://localhost:19001/error`)).rejects.toThrow("HTTP 500");

      await new Promise<void>((resolve) => {
        errorServer.close(() => resolve());
      });
    });
  });

  describe("destroy", () => {
    it("should close all connections", () => {
      const testPool = new ConnectionPool();
      testPool.destroy();
      expect(testPool.isClosed()).toBe(true);
    });

    it("should reject requests after destroy", async () => {
      const testPool = new ConnectionPool();
      testPool.destroy();

      await expect(testPool.get(`http://localhost:${testPort}/test`)).rejects.toThrow("closed");
    });
  });

  describe("getStats", () => {
    it("should return stats with initial values", () => {
      const newPool = new ConnectionPool();
      const stats = newPool.getStats();

      expect(stats.totalRequests).toBe(0);
      expect(stats.reusedConnections).toBe(0);
      newPool.destroy();
    });
  });
});

describe("Global Pool", () => {
  it("should get global pool instance", () => {
    const pool = getGlobalPool();
    expect(pool).toBeDefined();
    expect(pool).toBe(getGlobalPool()); // Same instance
  });

  it("should set global pool instance", () => {
    const newPool = new ConnectionPool({ maxSockets: 100 });
    setGlobalPool(newPool);

    expect(getGlobalPool()).toBe(newPool);
    newPool.destroy();
  });
});
