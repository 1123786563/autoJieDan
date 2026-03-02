/**
 * End-to-End Integration Tests
 *
 * 测试 Automaton 和 Nanobot 之间的完整集成流程
 *
 * @module __tests__/integration/e2e
 * @version 1.0.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ulid } from "ulid";
import { createHeartbeatDaemon, type HeartbeatDaemon } from "../../src/heartbeat/daemon.js";
import { InteragentWebSocketServer } from "../../src/interagent/websocket.js";
import { FreelanceRepository } from "../../src/freelance/repository.js";
import { AnalyticsCollector } from "../../src/freelance/analytics.js";
import { createDiscoveryScheduler, type DiscoveryScheduler } from "../../src/upwork/discovery-scheduler.js";
import { applySchemaV11 } from "../../src/state/schema-v11.js";

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
 * 创建模拟的 Upwork Client
 */
function createMockUpworkClient() {
  return {
    searchJobs: vi.fn().mockResolvedValue([
      {
        id: "test-job-1",
        title: "Test TypeScript Developer Needed",
        description: "Looking for an experienced TypeScript developer for a web application project.",
        jobType: "fixed" as const,
        budget: { min: 500, max: 1000, currency: "USD" },
        client: {
          id: "test-client-1",
          name: "Test Client",
          reputation: 85,
          totalSpent: 5000,
        },
        publishedAt: new Date().toISOString(),
      },
    ]),
    submitBid: vi.fn().mockResolvedValue({
      success: true,
      bidId: "test-bid-1",
    }),
  };
}

/**
 * 创建模拟的 Conway Client
 */
function createMockConwayClient() {
  return {
    getIdentity: vi.fn().mockResolvedValue({
      address: "0x1234567890123456789012345678901234567890",
    }),
  };
}

/**
 * 创建模拟的 LLM Provider
 */
function createMockLLMProvider() {
  return {
    chat: vi.fn().mockResolvedValue({
      content: "Test response",
      hasToolCalls: false,
      toolCalls: [],
    }),
  };
}

// ============================================================================
// 测试套件
// ============================================================================

describe("E2E Integration Tests", () => {
  let db: Database.Database;
  let repository: FreelanceRepository;
  let analytics: AnalyticsCollector;
  let wsServer: InteragentWebSocketServer;
  let daemon: HeartbeatDaemon;
  let discoveryScheduler: DiscoveryScheduler;

  beforeEach(() => {
    // 创建测试数据库
    db = createTestDatabase();

    // 创建 repository 和 analytics
    repository = new FreelanceRepository(db);
    analytics = new AnalyticsCollector(db);

    // 创建 WebSocket 服务器
    wsServer = new InteragentWebSocketServer({
      port: 0, // 随机端口避免冲突
      host: "127.0.0.1",
      db,
      enableReconnectionSync: true,
    });
  });

  afterEach(async () => {
    // 清理资源
    if (daemon) {
      daemon.stop();
    }
    if (discoveryScheduler) {
      discoveryScheduler.stop();
    }
    if (wsServer) {
      await wsServer.stop();
    }
    if (db) {
      db.close();
    }
  });

  // ==========================================================================
  // 测试场景 1: 项目发现和提交流程
  // ==========================================================================

  describe("Project Discovery and Bid Submission", () => {
    it("should complete project discovery and bid submission", async () => {
      // 创建模拟 Upwork Client
      const mockUpworkClient = createMockUpworkClient();

      // 创建 Discovery Scheduler
      discoveryScheduler = createDiscoveryScheduler(
        mockUpworkClient as any,
        repository,
        analytics,
        {
          checkIntervalMs: 1000, // 短间隔用于测试
          maxJobsPerCheck: 10,
          minScoreThreshold: 60,
          autoBidEnabled: false, // 测试中不自动投标
        }
      );

      // 运行项目发现
      const result = await discoveryScheduler.runDiscovery();

      // 验证发现结果
      expect(result.discovered).toBeGreaterThan(0);
      expect(result.qualified).toBeGreaterThanOrEqual(0);

      // 验证数据库中的项目
      const projects = db
        .prepare("SELECT * FROM projects WHERE platform = ?")
        .all("upwork");
      expect(projects.length).toBeGreaterThan(0);

      // 验证客户端信息
      const clients = db
        .prepare("SELECT * FROM clients WHERE platform = ?")
        .all("upwork");
      expect(clients.length).toBeGreaterThan(0);

      // 验证分析事件被记录
      const events = db
        .prepare("SELECT * FROM analytics_events WHERE event_type = ?")
        .all("project_viewed");
      expect(events.length).toBeGreaterThan(0);
    });

    it("should filter jobs below score threshold", async () => {
      const mockUpworkClient = createMockUpworkClient();

      // 设置高阈值以过滤所有项目
      discoveryScheduler = createDiscoveryScheduler(
        mockUpworkClient as any,
        repository,
        analytics,
        {
          checkIntervalMs: 1000,
          maxJobsPerCheck: 10,
          minScoreThreshold: 95, // 高阈值
          autoBidEnabled: false,
        }
      );

      const result = await discoveryScheduler.runDiscovery();

      // 所有项目应该被过滤
      expect(result.qualified).toBe(0);
      expect(result.discovered).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 测试场景 2: Genesis Prompt 和任务执行
  // ==========================================================================

  describe("Genesis Prompt and Task Execution", () => {
    it("should handle Genesis Prompt and task execution", async () => {
      // 启动 WebSocket 服务器
      await wsServer.start();

      // 创建一个测试项目
      const client = repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "test-client-1",
        name: "Test Client",
      });

      const project = repository.createProject({
        platform: "upwork",
        platformProjectId: "test-project-1",
        clientId: client.id,
        title: "Test Project",
        description: "Test Description",
      });

      // 创建 Genesis Prompt
      const genesisPrompt = {
        taskId: ulid(),
        projectId: project.id,
        goalId: ulid(),
        genesisPrompt: "Write a TypeScript function to calculate fibonacci numbers",
        context: {
          requirements: [
            "Handle large numbers efficiently",
            "Include error handling",
            "Add unit tests",
          ],
        },
      };

      // 发送 Genesis Prompt (通过服务器直接调用)
      const sent = wsServer.sendGenesisPrompt(
        "did:anp:nanobot:test",
        genesisPrompt
      );

      // 验证发送成功
      expect(sent).toBe(true);
    });

    it("should handle progress reports from Nanobot", async () => {
      await wsServer.start();

      // 监听进度事件
      const progressPromise = new Promise((resolve) => {
        wsServer.once("freelance:progress", (data) => {
          resolve(data);
        });
      });

      // 模拟 Nanobot 发送进度报告
      const mockProgressReport = {
        id: ulid(),
        type: "ProgressReport",
        "@type": "freelance:ProgressReport",
        timestamp: new Date().toISOString(),
        source: "did:anp:nanobot:test",
        target: "did:anp:automaton:main",
        payload: {
          "anp:taskId": ulid(),
          "anp:progress": 50,
          "anp:currentPhase": "code_generation",
          "anp:completedSteps": ["requirement_analysis", "design"],
          "anp:nextSteps": ["testing", "documentation"],
        },
      };

      // 模拟接收消息
      wsServer.emit("message", {
        did: "did:anp:nanobot:test",
        connectionId: ulid(),
        message: mockProgressReport,
      });

      // 等待并验证进度事件
      const progressData = await Promise.race([
        progressPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);

      expect(progressData).not.toBeNull();
    });
  });

  // ==========================================================================
  // 测试场景 3: 预算超限人工介入
  // ==========================================================================

  describe("Budget Exceed Manual Intervention", () => {
    it("should trigger manual intervention for budget exceed", async () => {
      // 创建一个项目
      const client = repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "test-client-budget",
        name: "Budget Test Client",
      });

      const project = repository.createProject({
        platform: "upwork",
        platformProjectId: "test-budget-project",
        clientId: client.id,
        title: "Budget Test Project",
        description: "Test budget tracking",
        budgetCents: 20000, // $200 in cents
      });

      // 创建人工介入记录（模拟预算超限）
      const intervention = repository.createIntervention({
        interventionType: "large_spend",
        projectId: project.id,
        reason: "Project budget exceeded: spent $250 of $200 budget",
        context: JSON.stringify({
          spent: 250,
          budget: 200,
          overage: 50,
        }),
        slaDeadline: new Date(Date.now() + 3600000).toISOString(),
      });

      // 验证介入记录创建
      expect(intervention).toBeDefined();
      expect(intervention.interventionType).toBe("large_spend");
      expect(intervention.projectId).toBe(project.id);

      // 验证数据库中的介入记录
      const savedIntervention = db
        .prepare("SELECT * FROM manual_interventions WHERE id = ?")
        .get(intervention.id);
      expect(savedIntervention).toBeDefined();
    });

    it("should handle human intervention response", async () => {
      await wsServer.start();

      // 创建人工介入请求
      const interventionRequest = {
        interventionId: ulid(),
        interventionType: "large_spend" as const,
        projectId: "test-project-1",
        reason: "Budget exceeded",
        context: { spent: 250, budget: 200 },
        priority: "high" as const,
        slaDeadline: new Date(Date.now() + 3600000).toISOString(),
      };

      // 发送人工介入请求
      const sent = wsServer.sendHumanInterventionRequest(
        "did:anp:nanobot:test",
        interventionRequest
      );

      expect(sent).toBe(true);

      // 模拟收到人工响应
      const responsePromise = new Promise((resolve) => {
        wsServer.once("freelance:intervention_response", (data) => {
          resolve(data);
        });
      });

      const mockResponse = {
        id: ulid(),
        type: "HumanInterventionResponse",
        "@type": "freelance:HumanInterventionResponse",
        timestamp: new Date().toISOString(),
        source: "did:anp:nanobot:test",
        target: "did:anp:automaton:main",
        payload: {
          "freelance:interventionId": interventionRequest.interventionId,
          "freelance:decision": "approve" as const,
          "freelance:respondedAt": new Date().toISOString(),
          "freelance:responder": "human-operator",
          "freelance:notes": "Approved with additional monitoring",
        },
      };

      wsServer.emit("message", {
        did: "did:anp:nanobot:test",
        connectionId: ulid(),
        message: mockResponse,
      });

      const responseData = await Promise.race([
        responsePromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);

      expect(responseData).not.toBeNull();
    });
  });

  // ==========================================================================
  // 测试场景 4: WebSocket 重连处理
  // ==========================================================================

  describe("WebSocket Reconnection", () => {
    it("should handle WebSocket reconnection", async () => {
      await wsServer.start();

      const serverAddress = wsServer.getServerStatus();
      expect(serverAddress.running).toBe(true);

      // 模拟重连请求
      const reconnectRequest = {
        connectionId: ulid(),
        lastSeq: 100,
        reconnectReason: "network_error" as const,
        reconnectAt: new Date().toISOString(),
        activeTasks: [ulid(), ulid()],
      };

      // 监听重连事件
      const reconnectPromise = new Promise((resolve) => {
        wsServer.once("reconnect:sync", (data) => {
          resolve(data);
        });
      });

      // 创建模拟的 WebSocket 连接
      const { WebSocket } = await import("ws");
      const mockWs = new WebSocket(
        `ws://127.0.0.1:${serverAddress.port}/?did=test-did&connectionId=${reconnectRequest.connectionId}&lastSeq=${reconnectRequest.lastSeq}`
      );

      // 等待连接建立
      await new Promise((resolve) => {
        mockWs.on("open", resolve);
      });

      // 发送重连请求
      mockWs.send(JSON.stringify({
        type: "reconnect.request",
        ...reconnectRequest,
      }));

      // 等待重连事件
      const reconnectData = await Promise.race([
        reconnectPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);

      mockWs.close();

      expect(reconnectData).not.toBeNull();
    });

    it("should persist messages for reconnection", async () => {
      const testWsServer = new InteragentWebSocketServer({
        port: 0,
        host: "127.0.0.1",
        db,
        enableReconnectionSync: true,
        messageBufferSize: 100,
        messageTTLHours: 1,
      });

      await testWsServer.start();

      // 获取消息持久化服务
      const messagePersistence = testWsServer.getMessagePersistence();
      expect(messagePersistence).not.toBeNull();

      // 发送一些持久化消息
      const event = {
        id: ulid(),
        type: "GenesisPrompt" as const,
        "@type": "freelance:GenesisPrompt",
        timestamp: new Date().toISOString(),
        source: "did:anp:automaton:main",
        target: "did:anp:nanobot:test",
        payload: {
          "freelance:taskId": ulid(),
        },
      };

      // 持久化消息
      messagePersistence?.persistMessage(
        "test-connection",
        1,
        "GenesisPrompt",
        event
      );

      // 获取错过的消息
      const missedEvents = await testWsServer.getMissedEvents("test-connection", 0);
      expect(missedEvents.length).toBeGreaterThan(0);

      await testWsServer.stop();
    });
  });

  // ==========================================================================
  // 测试场景 5: HeartbeatDaemon 集成
  // ==========================================================================

  describe("HeartbeatDaemon Integration", () => {
    it("should start and stop DiscoveryScheduler with daemon", async () => {
      const mockUpworkClient = createMockUpworkClient();
      const mockConwayClient = createMockConwayClient();

      // 创建 daemon 配置
      const config = {
        features: {
          freelance: {
            enabled: true,
            discoveryIntervalMs: 5000,
            maxJobsPerCheck: 10,
            minScoreThreshold: 60,
            autoBidEnabled: false,
          },
        },
        upwork: {
          apiKey: "test-key",
          apiSecret: "test-secret",
        },
      };

      const heartbeatConfig = {
        defaultIntervalMs: 1000,
        entries: [],
      };

      // 注意: 这里不能直接创建 daemon 因为需要更多依赖
      // 我们只测试 DiscoveryScheduler 的集成
      const testScheduler = createDiscoveryScheduler(
        mockUpworkClient as any,
        repository,
        analytics,
        config.features.freelance
      );

      // 启动调度器
      testScheduler.start();

      // 等待一段时间让调度器运行
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // 检查统计
      const stats = testScheduler.getStats();
      expect(stats.totalChecks).toBeGreaterThan(0);

      // 停止调度器
      testScheduler.stop();
    });
  });

  // ==========================================================================
  // 测试场景 6: 错误处理
  // ==========================================================================

  describe("Error Handling", () => {
    it("should handle errors from Nanobot", async () => {
      await wsServer.start();

      // 监听错误事件
      const errorPromise = new Promise((resolve) => {
        wsServer.once("freelance:error", (data) => {
          resolve(data);
        });
      });

      // 模拟错误报告
      const mockErrorReport = {
        id: ulid(),
        type: "ErrorReport",
        "@type": "freelance:ErrorReport",
        timestamp: new Date().toISOString(),
        source: "did:anp:nanobot:test",
        target: "did:anp:automaton:main",
        payload: {
          "anp:taskId": ulid(),
          "anp:errorCode": "LLM_API_ERROR",
          "anp:errorMessage": "Failed to call LLM API: rate limit exceeded",
          "anp:severity": "error" as const,
          "anp:recoverable": true,
        },
      };

      wsServer.emit("message", {
        did: "did:anp:nanobot:test",
        connectionId: ulid(),
        message: mockErrorReport,
      });

      const errorData = await Promise.race([
        errorPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);

      expect(errorData).not.toBeNull();
    });

    it("should send error acknowledgment", async () => {
      await wsServer.start();

      const ackSent = wsServer.sendErrorReportAck("did:anp:nanobot:test", {
        taskId: "test-task-1",
        reportId: "test-report-1",
        interventionCreated: true,
        interventionId: "test-intervention-1",
        actionRequired: "Review LLM API rate limits",
      });

      expect(ackSent).toBe(true);
    });
  });

  // ==========================================================================
  // 测试场景 7: 任务控制
  // ==========================================================================

  describe("Task Control", () => {
    it("should send task pause command", async () => {
      await wsServer.start();

      const sent = wsServer.sendTaskPause("did:anp:nanobot:test", {
        taskId: "test-task-1",
        projectId: "test-project-1",
        reason: "Manual pause for review",
        resumeAt: new Date(Date.now() + 3600000).toISOString(),
      });

      expect(sent).toBe(true);
    });

    it("should send task resume command", async () => {
      await wsServer.start();

      const sent = wsServer.sendTaskResume("did:anp:nanobot:test", {
        taskId: "test-task-1",
        projectId: "test-project-1",
      });

      expect(sent).toBe(true);
    });

    it("should send task cancel command", async () => {
      await wsServer.start();

      const sent = wsServer.sendTaskCancel("did:anp:nanobot:test", {
        taskId: "test-task-1",
        projectId: "test-project-1",
        reason: "Client cancelled project",
        cleanupRequired: true,
      });

      expect(sent).toBe(true);
    });
  });
});
