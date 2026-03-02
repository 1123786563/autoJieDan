/**
 * Error Scenarios Integration Tests
 *
 * 测试各种错误场景的处理和恢复机制
 *
 * @module __tests__/integration/error-scenarios
 * @version 1.0.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ulid } from "ulid";
import { InteragentWebSocketServer } from "../../src/interagent/websocket.js";
import { FreelanceRepository } from "../../src/freelance/repository.js";
import { AnalyticsCollector } from "../../src/freelance/analytics.js";
import { DiscoveryScheduler } from "../../src/upwork/discovery-scheduler.js";
import { applySchemaV11 } from "../../src/state/schema-v11.js";
import { createProgressReportHandler } from "../../src/freelance/progress-handler.js";

// ============================================================================
// 测试工具函数
// ============================================================================

/**
 * 创建内存数据库用于测试
 */
function createTestDatabase(): Database.Database {
  const db = new Database(":memory:");
  applySchemaV11(db);
  return db;
}

/**
 * 创建模拟的 Upwork Client（可配置错误）
 */
function createMockUpworkClient(errorConfig?: {
  rateLimit?: boolean;
  timeout?: boolean;
  networkError?: boolean;
}) {
  return {
    searchJobs: vi.fn().mockImplementation(async () => {
      if (errorConfig?.rateLimit) {
        const error = new Error("API rate limit exceeded");
        (error as any).statusCode = 429;
        throw error;
      }
      if (errorConfig?.timeout) {
        const error = new Error("Request timeout");
        (error as any).code = "ETIMEDOUT";
        throw error;
      }
      if (errorConfig?.networkError) {
        throw new Error("Network connection failed");
      }
      return [
        {
          id: "test-job-1",
          title: "Test Job",
          description: "Test Description",
          jobType: "fixed" as const,
          budget: { min: 100, max: 200, currency: "USD" },
          client: {
            id: "test-client-1",
            name: "Test Client",
            reputation: 80,
            totalSpent: 1000,
          },
          publishedAt: new Date().toISOString(),
        },
      ];
    }),
    submitBid: vi.fn().mockResolvedValue({
      success: true,
      bidId: "test-bid-1",
    }),
  };
}

/**
 * 创建模拟的 LLM Provider（可配置错误）
 */
function createMockLLMProvider(errorConfig?: {
  rateLimit?: boolean;
  timeout?: boolean;
  apiError?: boolean;
}) {
  return {
    chat: vi.fn().mockImplementation(async () => {
      if (errorConfig?.rateLimit) {
        const error = new Error("LLM API rate limit exceeded");
        (error as any).statusCode = 429;
        throw error;
      }
      if (errorConfig?.timeout) {
        throw new Error("LLM request timeout");
      }
      if (errorConfig?.apiError) {
        throw new Error("LLM API internal error");
      }
      return {
        content: "Test response",
        hasToolCalls: false,
        toolCalls: [],
      };
    }),
  };
}

// ============================================================================
// 测试套件
// ============================================================================

describe("Error Scenarios Integration Tests", () => {
  let db: Database.Database;
  let repository: FreelanceRepository;
  let analytics: AnalyticsCollector;
  let wsServer: InteragentWebSocketServer;
  let progressHandler: any;

  beforeEach(() => {
    // 创建测试数据库
    db = createTestDatabase();

    // 创建 repository 和 analytics
    repository = new FreelanceRepository(db);
    analytics = new AnalyticsCollector(db);

    // 创建进度报告处理器
    progressHandler = createProgressReportHandler(repository, analytics);

    // 创建 WebSocket 服务器
    wsServer = new InteragentWebSocketServer({
      port: 0, // 随机端口
      host: "127.0.0.1",
      db,
      enableReconnectionSync: true,
    });
  });

  afterEach(async () => {
    // 清理资源
    if (wsServer) {
      await wsServer.stop();
    }
    if (db) {
      db.close();
    }
  });

  // ==========================================================================
  // 测试场景 1: API 限流处理
  // ==========================================================================

  describe("API Rate Limiting", () => {
    it("should handle Upwork API rate limit gracefully", async () => {
      const mockClient = createMockUpworkClient({ rateLimit: true });
      const scheduler = new DiscoveryScheduler(
        mockClient as any,
        repository,
        analytics,
        {
          checkIntervalMs: 1000,
          maxJobsPerCheck: 10,
          minScoreThreshold: 60,
          autoBidEnabled: false,
        }
      );

      // 运行发现（应该处理限流错误）
      const result = await scheduler.runDiscovery();

      // 验证错误被优雅处理
      expect(result.discovered).toBe(0);
      expect(result.qualified).toBe(0);

      // 验证 Upwork client 被调用
      expect(mockClient.searchJobs).toHaveBeenCalled();
    });

    it("should implement exponential backoff for rate limits", async () => {
      let callCount = 0;
      const mockClient = {
        searchJobs: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount <= 2) {
            const error = new Error("Rate limited");
            (error as any).statusCode = 429;
            throw error;
          }
          return [];
        }),
      };

      const scheduler = new DiscoveryScheduler(
        mockClient as any,
        repository,
        analytics,
        {
          checkIntervalMs: 100,
          maxJobsPerCheck: 10,
          minScoreThreshold: 60,
          autoBidEnabled: false,
        }
      );

      // 运行发现
      await scheduler.runDiscovery();

      // 验证重试逻辑（应该调用多次）
      expect(callCount).toBeGreaterThan(1);
      expect(mockClient.searchJobs).toHaveBeenCalledTimes(3);
    });

    it("should record rate limit events in analytics", async () => {
      const mockClient = createMockUpworkClient({ rateLimit: true });
      const scheduler = new DiscoveryScheduler(
        mockClient as any,
        repository,
        analytics,
        {
          checkIntervalMs: 1000,
          maxJobsPerCheck: 10,
          minScoreThreshold: 60,
          autoBidEnabled: false,
        }
      );

      await scheduler.runDiscovery();

      // 验证错误事件被记录
      const errorEvents = db
        .prepare("SELECT * FROM analytics_events WHERE event_type = ?")
        .all("error_occurred");
      expect(errorEvents.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 测试场景 2: 网络超时处理
  // ==========================================================================

  describe("Network Timeout Handling", () => {
    it("should handle network timeout gracefully", async () => {
      const mockClient = createMockUpworkClient({ timeout: true });
      const scheduler = new DiscoveryScheduler(
        mockClient as any,
        repository,
        analytics,
        {
          checkIntervalMs: 1000,
          maxJobsPerCheck: 10,
          minScoreThreshold: 60,
          autoBidEnabled: false,
        }
      );

      const result = await scheduler.runDiscovery();

      // 验证超时被处理
      expect(result.discovered).toBe(0);
    });

    it("should retry on timeout with backoff", async () => {
      let callCount = 0;
      const mockClient = {
        searchJobs: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            const error = new Error("Timeout");
            (error as any).code = "ETIMEDOUT";
            throw error;
          }
          return [];
        }),
      };

      const scheduler = new DiscoveryScheduler(
        mockClient as any,
        repository,
        analytics,
        {
          checkIntervalMs: 100,
          maxJobsPerCheck: 10,
          minScoreThreshold: 60,
          autoBidEnabled: false,
        }
      );

      await scheduler.runDiscovery();

      // 验证重试
      expect(callCount).toBe(2);
    });

    it("should handle WebSocket connection timeout", async () => {
      await wsServer.start();

      // 尝试连接到不存在的端口
      const badServer = new InteragentWebSocketServer({
        port: 1, // 无效端口
        host: "127.0.0.1",
        connectionTimeout: 100,
      });

      const errorPromise = new Promise((resolve) => {
        badServer.on("error", (error) => {
          resolve(error);
        });
      });

      try {
        await badServer.start();
      } catch (error) {
        // 预期的错误
      }

      const error = await Promise.race([
        errorPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 500)),
      ]);

      // 验证错误被处理
      expect(error).not.toBeNull();
    });
  });

  // ==========================================================================
  // 测试场景 3: 无效消息格式处理
  // ==========================================================================

  describe("Invalid Message Format Handling", () => {
    it("should reject messages with invalid JSON", async () => {
      await wsServer.start();

      // 监听消息错误事件
      const errorPromise = new Promise((resolve) => {
        wsServer.once("message:error", (data) => {
          resolve(data);
        });
      });

      // 获取服务器地址
      const serverAddress = wsServer.getServerStatus();

      // 创建 WebSocket 连接
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://127.0.0.1:${serverAddress.port}/?did=test-did`);

      await new Promise((resolve) => {
        ws.on("open", resolve);
      });

      // 发送无效 JSON
      ws.send("{invalid json}");

      const errorData = await Promise.race([
        errorPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);

      ws.close();

      // 验证错误被捕获
      expect(errorData).not.toBeNull();
    });

    it("should reject messages with missing required fields", async () => {
      await wsServer.start();

      // 发送缺少必需字段的消息
      const invalidMessage = {
        type: "ProgressReport",
        // 缺少 payload 等必需字段
      };

      const errorPromise = new Promise((resolve) => {
        wsServer.once("message:error", resolve);
      });

      const serverAddress = wsServer.getServerStatus();
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://127.0.0.1:${serverAddress.port}/?did=test-did`);

      await new Promise((resolve) => {
        ws.on("open", resolve);
      });

      ws.send(JSON.stringify(invalidMessage));

      const errorData = await Promise.race([
        errorPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);

      ws.close();

      // 验证错误被处理
      expect(errorData).not.toBeNull();
    });

    it("should reject messages with unknown message types", async () => {
      await wsServer.start();

      const unknownMessage = {
        id: ulid(),
        type: "UnknownMessageType",
        timestamp: new Date().toISOString(),
        source: "did:anp:nanobot:test",
        target: "did:anp:automaton:main",
        payload: {},
      };

      const errorPromise = new Promise((resolve) => {
        wsServer.once("freelance:unknown", resolve);
      });

      const serverAddress = wsServer.getServerStatus();
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://127.0.0.1:${serverAddress.port}/?did=test-did`);

      await new Promise((resolve) => {
        ws.on("open", resolve);
      });

      ws.send(JSON.stringify(unknownMessage));

      const errorData = await Promise.race([
        errorPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);

      ws.close();

      // 验证未知消息类型被处理
      expect(errorData).not.toBeNull();
    });
  });

  // ==========================================================================
  // 测试场景 4: 数据库连接失败处理
  // ==========================================================================

  describe("Database Connection Failure", () => {
    it("should handle database connection errors gracefully", () => {
      // 尝试用无效路径创建数据库
      expect(() => {
        new Database("/invalid/path/to/database.db");
      }).not.toThrow(); // better-sqlite3 可能延迟打开

      // 尝试执行操作应该失败
      const badDb = new Database("/invalid/path/.db");
      expect(() => {
        badDb.prepare("SELECT 1").get();
      }).toThrow();
    });

    it("should recover from transient database errors", () => {
      const testDb = createTestDatabase();
      const testRepository = new FreelanceRepository(testDb);

      // 正常操作
      const client = testRepository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "test-client",
        name: "Test Client",
      });

      expect(client).toBeDefined();
      expect(client.id).toBeDefined();

      // 关闭数据库
      testDb.close();

      // 尝试操作应该失败
      expect(() => {
        testRepository.getClient(client.id);
      }).toThrow();

      // 重新打开数据库
      const newDb = createTestDatabase();
      const newRepository = new FreelanceRepository(newDb);

      // 应该能够正常操作
      const newClient = newRepository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "test-client-2",
        name: "Test Client 2",
      });

      expect(newClient).toBeDefined();

      newDb.close();
    });

    it("should handle database query timeouts", () => {
      const testDb = createTestDatabase();

      // 创建一个复杂的查询（可能会超时）
      const complexQuery = `
        SELECT * FROM projects
        WHERE id IN (
          SELECT id FROM projects
          WHERE id IN (
            SELECT id FROM projects
          )
        )
      `;

      // 这个查询应该能够执行（即使返回空）
      expect(() => {
        testDb.prepare(complexQuery).all();
      }).not.toThrow();

      testDb.close();
    });
  });

  // ==========================================================================
  // 测试场景 5: LLM 调用失败处理
  // ==========================================================================

  describe("LLM Call Failure Handling", () => {
    it("should handle LLM API rate limit", async () => {
      const mockLLM = createMockLLMProvider({ rateLimit: true });

      // 尝试调用 LLM
      let errorOccurred = false;
      try {
        await mockLLM.chat({
          messages: [{ role: "user", content: "Test" }],
          tools: [],
          model: "gpt-4",
          temperature: 0.1,
          maxTokens: 1000,
        });
      } catch (error) {
        errorOccurred = true;
        expect((error as Error).message).toContain("rate limit");
      }

      expect(errorOccurred).toBe(true);
    });

    it("should handle LLM timeout", async () => {
      const mockLLM = createMockLLMProvider({ timeout: true });

      let errorOccurred = false;
      try {
        await mockLLM.chat({
          messages: [{ role: "user", content: "Test" }],
          tools: [],
          model: "gpt-4",
          temperature: 0.1,
          maxTokens: 1000,
        });
      } catch (error) {
        errorOccurred = true;
        expect((error as Error).message).toContain("timeout");
      }

      expect(errorOccurred).toBe(true);
    });

    it("should handle LLM API internal errors", async () => {
      const mockLLM = createMockLLMProvider({ apiError: true });

      let errorOccurred = false;
      try {
        await mockLLM.chat({
          messages: [{ role: "user", content: "Test" }],
          tools: [],
          model: "gpt-4",
          temperature: 0.1,
          maxTokens: 1000,
        });
      } catch (error) {
        errorOccurred = true;
        expect((error as Error).message).toContain("internal error");
      }

      expect(errorOccurred).toBe(true);
    });

    it("should retry LLM calls with exponential backoff", async () => {
      let callCount = 0;
      const mockLLM = {
        chat: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount <= 2) {
            throw new Error("Temporary error");
          }
          return {
            content: "Success",
            hasToolCalls: false,
            toolCalls: [],
          };
        }),
      };

      // 模拟重试逻辑
      let lastError: Error | null = null;
      for (let i = 0; i < 5; i++) {
        try {
          const result = await mockLLM.chat({
            messages: [{ role: "user", content: "Test" }],
            tools: [],
            model: "gpt-4",
            temperature: 0.1,
            maxTokens: 1000,
          });
          expect(result.content).toBe("Success");
          break;
        } catch (error) {
          lastError = error as Error;
          // 指数退避
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, i) * 100));
        }
      }

      // 验证最终成功
      expect(lastError).toBeNull();
      expect(callCount).toBe(3);
    });
  });

  // ==========================================================================
  // 测试场景 6: 进度报告错误处理
  // ==========================================================================

  describe("Progress Report Error Handling", () => {
    it("should handle invalid progress values", async () => {
      const invalidReport = {
        "anp:taskId": "test-task",
        "anp:progress": 150, // 无效：超过 100
        "anp:currentPhase": "testing",
      };

      let errorOccurred = false;
      try {
        await progressHandler.handleProgressReport(invalidReport as any);
      } catch (error) {
        errorOccurred = true;
        expect((error as Error).message).toContain("Invalid progress value");
      }

      expect(errorOccurred).toBe(true);
    });

    it("should handle negative progress values", async () => {
      const invalidReport = {
        "anp:taskId": "test-task",
        "anp:progress": -10, // 无效：负数
        "anp:currentPhase": "testing",
      };

      let errorOccurred = false;
      try {
        await progressHandler.handleProgressReport(invalidReport as any);
      } catch (error) {
        errorOccurred = true;
      }

      expect(errorOccurred).toBe(true);
    });

    it("should handle progress reports with blockers", async () => {
      const reportWithBlockers = {
        "anp:taskId": "test-task",
        "anp:progress": 50,
        "anp:currentPhase": "testing",
        "anp:blockers": ["API authentication failed", "Missing dependencies"],
      };

      const ack = await progressHandler.handleProgressReport(reportWithBlockers as any);

      // 验证确认包含所需操作
      expect(ack["freelance:actionRequired"]).toBeDefined();
      expect(ack["freelance:actionRequired"]).toContain("blockers");
    });

    it("should create interventions for critical blockers", async () => {
      const reportWithCriticalBlocker = {
        "anp:taskId": "test-task",
        "anp:progress": 50,
        "anp:currentPhase": "testing",
        "anp:blockers": ["Payment API authentication failed"],
        "freelance:projectId": "test-project",
      };

      const ack = await progressHandler.handleProgressReport(
        reportWithCriticalBlocker as any
      );

      // 验证创建了人工介入
      const interventions = db
        .prepare("SELECT * FROM manual_interventions WHERE project_id = ?")
        .all("test-project");
      expect(interventions.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 测试场景 7: 错误恢复和降级
  // ==========================================================================

  describe("Error Recovery and Degradation", () => {
    it("should degrade gracefully when external services fail", async () => {
      const mockClient = createMockUpworkClient({ networkError: true });
      const scheduler = new DiscoveryScheduler(
        mockClient as any,
        repository,
        analytics,
        {
          checkIntervalMs: 1000,
          maxJobsPerCheck: 10,
          minScoreThreshold: 60,
          autoBidEnabled: false,
        }
      );

      // 第一次运行失败
      const result1 = await scheduler.runDiscovery();
      expect(result1.discovered).toBe(0);

      // 系统应该继续运行
      const stats = scheduler.getStats();
      expect(stats.totalChecks).toBeGreaterThan(0);

      // 第二次运行也失败（但系统不崩溃）
      const result2 = await scheduler.runDiscovery();
      expect(result2.discovered).toBe(0);
    });

    it("should maintain service health during partial failures", async () => {
      // 创建部分失败的模拟
      let callCount = 0;
      const mockClient = {
        searchJobs: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount % 2 === 0) {
            throw new Error("Intermittent error");
          }
          return [
            {
              id: `job-${callCount}`,
              title: "Test Job",
              description: "Test",
              jobType: "fixed" as const,
              budget: { min: 100, max: 200, currency: "USD" },
              client: {
                id: "client-1",
                name: "Client",
                reputation: 80,
                totalSpent: 1000,
              },
              publishedAt: new Date().toISOString(),
            },
          ];
        }),
      };

      const scheduler = new DiscoveryScheduler(
        mockClient as any,
        repository,
        analytics,
        {
          checkIntervalMs: 100,
          maxJobsPerCheck: 10,
          minScoreThreshold: 60,
          autoBidEnabled: false,
        }
      );

      // 运行多次
      for (let i = 0; i < 4; i++) {
        await scheduler.runDiscovery();
      }

      // 验证系统仍然运行
      const stats = scheduler.getStats();
      expect(stats.totalChecks).toBe(4);

      // 验证至少有一些成功的调用
      expect(callCount).toBeGreaterThan(0);
    });

    it("should log errors for debugging", async () => {
      const mockClient = createMockUpworkClient({ networkError: true });
      const scheduler = new DiscoveryScheduler(
        mockClient as any,
        repository,
        analytics,
        {
          checkIntervalMs: 1000,
          maxJobsPerCheck: 10,
          minScoreThreshold: 60,
          autoBidEnabled: false,
        }
      );

      await scheduler.runDiscovery();

      // 验证错误被记录到分析事件
      const errorEvents = db
        .prepare("SELECT * FROM analytics_events WHERE event_type = ?")
        .all("error_occurred");

      expect(errorEvents.length).toBeGreaterThan(0);

      // 验证错误事件包含有用信息
      const errorEvent = errorEvents[0];
      expect(errorEvent.properties).toBeDefined();
    });
  });

  // ==========================================================================
  // 测试场景 8: 并发错误处理
  // ==========================================================================

  describe("Concurrent Error Handling", () => {
    it("should handle multiple simultaneous errors", async () => {
      const mockClient = createMockUpworkClient({ networkError: true });
      const scheduler = new DiscoveryScheduler(
        mockClient as any,
        repository,
        analytics,
        {
          checkIntervalMs: 100,
          maxJobsPerCheck: 10,
          minScoreThreshold: 60,
          autoBidEnabled: false,
        }
      );

      // 并发运行多次发现
      const promises = [
        scheduler.runDiscovery(),
        scheduler.runDiscovery(),
        scheduler.runDiscovery(),
      ];

      const results = await Promise.allSettled(promises);

      // 验证所有操作都完成了（即使失败）
      expect(results.length).toBe(3);

      // 验证系统仍然稳定
      const stats = scheduler.getStats();
      expect(stats.totalChecks).toBe(3);
    });

    it("should handle WebSocket connection storms", async () => {
      await wsServer.start();

      const serverAddress = wsServer.getServerStatus();
      const { WebSocket } = await import("ws");

      // 尝试创建多个连接
      const connections = [];
      for (let i = 0; i < 5; i++) {
        try {
          const ws = new WebSocket(
            `ws://127.0.0.1:${serverAddress.port}/?did=client-${i}`
          );
          connections.push(ws);
        } catch (error) {
          // 预期一些连接可能被拒绝
        }
      }

      // 验证服务器仍然运行
      const status = wsServer.getServerStatus();
      expect(status.running).toBe(true);

      // 清理连接
      connections.forEach((ws) => {
        if (ws.readyState === 1) {
          ws.close();
        }
      });
    });
  });
});
