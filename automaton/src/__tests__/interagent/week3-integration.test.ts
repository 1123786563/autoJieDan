/**
 * @vitest-environment node
 *
 * Week 3 Integration Tests
 * 测试 Genesis Prompt 端到端流程
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createGenesisPrompt,
  validateGenesisPrompt,
  estimateComplexity,
  type GenesisPrompt,
} from "../../interagent/genesis-prompt.js";
import {
  TaskDispatcher,
  CostEstimator,
  createTaskDispatcher,
  createDefaultNanobotCapabilities,
  type NanobotCapabilities,
} from "../../interagent/task-dispatcher.js";
import {
  BudgetManager,
  CostCalculator,
  CostEstimator as BudgetCostEstimator,
  createBudgetManager,
  createCostCalculator,
  formatBudgetStatus,
  formatCost,
  formatTokens,
  type BudgetConfig,
  type TokenUsageRecord,
} from "../../interagent/budget-manager.js";
import {
  TaskLifecycleManager,
  canTransition,
  isTerminalState,
  formatStatus,
  type TaskContext,
  type CompletionData,
  type FailureData,
  type TaskStatus,
} from "../../interagent/task-lifecycle.js";
import { RetryExecutor, retrySafe, STANDARD_RETRY_CONFIG } from "../../interagent/retry.js";
import { DeadLetterQueue } from "../../interagent/dlq.js";

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_NANOBOT_CAPABILITIES: NanobotCapabilities[] = [
  {
    did: "did:anp:nanobot:worker1",
    name: "Worker 1",
    version: "1.0.0",
    supportedTaskTypes: ["genesis", "analysis", "execution", "report"],
    supportedLanguages: ["typescript", "python", "javascript"],
    maxConcurrentTasks: 3,
    currentLoad: 0,
    performanceScore: 90,
    averageTaskDurationMs: 60000,
    lastHeartbeat: new Date(),
    isOnline: true,
    specializations: ["backend", "api"],
  },
  {
    did: "did:anp:nanobot:worker2",
    name: "Worker 2",
    version: "1.0.0",
    supportedTaskTypes: ["genesis", "maintenance", "exploration"],
    supportedLanguages: ["python", "go", "rust"],
    maxConcurrentTasks: 2,
    currentLoad: 1,
    performanceScore: 85,
    averageTaskDurationMs: 90000,
    lastHeartbeat: new Date(),
    isOnline: true,
    specializations: ["infrastructure", "devops"],
  },
];

// Helper to create a TaskLifecycleManager with default context
function createTestLifecycleManager(taskId: string, options: Partial<TaskContext> = {}): TaskLifecycleManager {
  const context: TaskContext = {
    id: taskId,
    type: options.type || "genesis",
    status: "pending",
    priority: options.priority || "normal",
    sourceDid: options.sourceDid || "did:anp:automaton:main",
    targetDid: options.targetDid || "did:anp:nanobot:worker1",
    input: options.input || {},
    createdAt: new Date(),
    updatedAt: new Date(),
    retryCount: 0,
    maxRetries: options.maxRetries ?? 3,
    metadata: options.metadata || {},
    ...options,
  };
  return new TaskLifecycleManager(context);
}

// ============================================================================
// Week 3 Integration Tests
// ============================================================================

describe("Week 3 Integration: Genesis Prompt Flow", () => {
  let dispatcher: TaskDispatcher;
  let budgetManager: BudgetManager;

  beforeEach(() => {
    // 创建 TaskDispatcher
    dispatcher = new TaskDispatcher({
      loadBalanceStrategy: "best_fit",
    }, 100);

    // 注册 Nanobots
    TEST_NANOBOT_CAPABILITIES.forEach((cap) => {
      dispatcher.registerNanobot(cap);
    });

    // 创建 BudgetManager
    budgetManager = new BudgetManager({
      total: 1000000,
      warningThreshold: 70,
      criticalThreshold: 90,
      allowOverage: false,
    });
  });

  describe("Complete Task Dispatch Flow", () => {
    it("should complete full genesis task dispatch flow", async () => {
      // Step 1: 创建 Genesis Prompt
      const prompt = createGenesisPrompt({
        id: "genesis-task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create a REST API endpoint for user authentication",
        specification: "Implement /api/auth/login with JWT token generation",
        technical: {
          allowedLanguages: ["typescript"],
          testCoverage: { minimum: 80, enforce: true },
        },
        business: {
          budget: { total: 50 },
          quality: { level: "high" },
        },
      });

      // Step 2: 验证 Prompt
      const errors = validateGenesisPrompt(prompt);
      expect(errors).toHaveLength(0);

      // Step 3: 评估复杂度
      const complexity = estimateComplexity(prompt);
      expect(["simple", "medium", "complex", "very_complex"]).toContain(complexity);

      // Step 4: 分发决策
      const decision = dispatcher.makeDispatchDecision(prompt);
      expect(decision.canDispatch).toBe(true);
      expect(decision.targetNanobot).toBeDefined();
      expect(decision.allocatedBudget).toBeGreaterThan(0);

      // Step 5: 执行分发
      const result = await dispatcher.dispatch(prompt);
      expect(result.success).toBe(true);

      // Step 6: 完成任务
      dispatcher.completeTask(prompt.id, true, 0.06);

      // 验证最终状态
      const budget = dispatcher.getBudgetStatus();
      expect(budget.allocated).toBeGreaterThan(0);
      expect(dispatcher.getActiveTaskCount()).toBe(0);
    });

    it("should handle analysis task with budget constraints", async () => {
      const prompt = createGenesisPrompt({
        id: "analysis-task-1",
        taskType: "analysis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Analyze codebase architecture",
        business: {
          budget: { total: 20 },
        },
      });

      const decision = dispatcher.makeDispatchDecision(prompt);
      expect(decision.canDispatch).toBe(true);
    });

    it("should dispatch to worker2 that supports rust", async () => {
      // Worker2 supports rust but worker1 does not
      const prompt = createGenesisPrompt({
        id: "genesis-task-2",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker2",
        description: "Create a Rust microservice",
        technical: {
          allowedLanguages: ["rust"],
        },
      });

      const decision = dispatcher.makeDispatchDecision(prompt);
      // Worker2 supports rust so this should dispatch
      expect(decision.canDispatch).toBe(true);
      expect(decision.targetNanobot?.did).toBe("did:anp:nanobot:worker2");
    });
  });

  describe("Budget Management Integration", () => {
    it("should track budget across multiple tasks", async () => {
      // 执行多个任务
      for (let i = 0; i < 5; i++) {
        const prompt = createGenesisPrompt({
          id: `task-${i}`,
          taskType: "genesis",
          sourceDid: "did:anp:automaton:main",
          targetDid: "did:anp:nanobot:worker1",
          description: `Task ${i}`,
        });

        const decision = dispatcher.makeDispatchDecision(prompt);
        if (decision.canDispatch) {
          await dispatcher.dispatch(prompt);
          dispatcher.completeTask(`task-${i}`, true, 0.01);
        }
      }

      const summary = budgetManager.getSummary();
      expect(summary.root).toBeDefined();
      expect(summary.totalUsed).toBeGreaterThanOrEqual(0);
    });

    it("should emit budget events", () => {
      const overrunHandler = vi.fn();
      budgetManager.on("overrun", overrunHandler);

      const rootAllocation = budgetManager.getRootAllocation();

      // 大量使用预算以触发警告 (超过70%)
      budgetManager.reserve(rootAllocation!.id, 750000);
      budgetManager.commit(rootAllocation!.id, 750000, {
        taskId: "expensive-task",
        model: "claude-opus-4-20250514",
        inputTokens: 500000,
        outputTokens: 250000,
        totalTokens: 750000,
        costUsd: 20,
        metadata: {},
      });

      expect(overrunHandler).toHaveBeenCalled();
    });
  });

  describe("Cost Estimation Integration", () => {
    it("should estimate costs accurately", () => {
      const estimator = new CostEstimator();
      const calculator = createCostCalculator();

      const prompt = createGenesisPrompt({
        id: "cost-test",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Complex feature implementation",
        technical: {
          testCoverage: { minimum: 90 },
        },
      });

      const estimate = estimator.estimate(prompt);
      expect(estimate.estimatedTokens).toBeGreaterThan(0);
      expect(estimate.estimatedCost).toBeGreaterThan(0);
      expect(estimate.confidence).toBeGreaterThan(0);
      expect(estimate.confidence).toBeLessThanOrEqual(1);

      // 验证格式化函数
      const formattedCost = formatCost(estimate.estimatedCost);
      expect(formattedCost).toBeDefined();

      const formattedTokens = formatTokens(estimate.estimatedTokens);
      expect(formattedTokens).toBeDefined();
    });

    it("should calculate model-specific costs", () => {
      const calculator = createCostCalculator();

      // GPT-4o-mini
      const gpt4oMiniCost = calculator.calculateCost("gpt-4o-mini", 1000, 500);
      expect(gpt4oMiniCost).toBeCloseTo(0.00045, 6);

      // Claude Sonnet
      const claudeCost = calculator.calculateCost("claude-sonnet-4-20250514", 2000, 1000);
      expect(claudeCost).toBeCloseTo(0.021, 4);
    });
  });

  describe("Task Lifecycle Integration", () => {
    it("should manage task lifecycle through states", async () => {
      const taskId = "lifecycle-test-1";
      const manager = createTestLifecycleManager(taskId);

      // 验证初始状态
      expect(manager.getStatus()).toBe("pending");

      // 启动任务
      const startResult = await manager.start();
      expect(startResult.success).toBe(true);
      expect(manager.getStatus()).toBe("running");

      // 完成任务
      const completionData: CompletionData = {
        result: { message: "Task completed successfully" },
        metrics: { tokensUsed: 1000 },
      };
      const completeResult = await manager.complete(completionData);
      expect(completeResult.success).toBe(true);
      expect(manager.getStatus()).toBe("completed");
      expect(manager.isTerminal()).toBe(true);
    });

    it("should handle task failure with retry", async () => {
      const taskId = "retry-test-1";
      const manager = createTestLifecycleManager(taskId, { maxRetries: 2 });

      // 启动任务
      await manager.start();
      expect(manager.getStatus()).toBe("running");

      // 模拟失败
      const failureData: FailureData = {
        error: "Temporary failure",
        recoverable: true,
        retryable: true,
      };
      const failResult = await manager.fail(failureData);
      expect(failResult.success).toBe(false);

      let task = manager.getContext();
      expect(task.status).toBe("failed");

      // 重试
      const retryResult = await manager.retry();
      expect(retryResult.success).toBe(true);
      expect(manager.getStatus()).toBe("pending");
      expect(manager.getContext().retryCount).toBe(1);

      // 再次启动并完成
      await manager.start();
      const completeResult = await manager.complete({ result: { success: true } });
      expect(completeResult.success).toBe(true);
      expect(manager.getStatus()).toBe("completed");
    });

    it("should validate state transitions", () => {
      // 有效转换
      expect(canTransition("pending", "running")).toBe(true);
      expect(canTransition("running", "completed")).toBe(true);
      expect(canTransition("failed", "pending")).toBe(true);

      // 无效转换
      expect(canTransition("completed", "running")).toBe(false);
      expect(canTransition("cancelled", "pending")).toBe(false);
    });
  });

  describe("Error Handling and DLQ Integration", () => {
    it("should move failed tasks to DLQ after max retries", async () => {
      const dlq = new DeadLetterQueue();
      const taskId = "dlq-test-1";
      const manager = createTestLifecycleManager(taskId, { maxRetries: 2 });

      // 模拟多次失败
      for (let i = 0; i < 3; i++) {
        await manager.start();
        await manager.fail({ error: `Failure ${i + 1}`, retryable: true });

        if (i < 2) {
          await manager.retry();
        }
      }

      const task = manager.getContext();
      expect(task.status).toBe("failed");
      expect(task.retryCount).toBe(2);

      // 移动到 DLQ
      const entry = dlq.enqueue({
        originalTaskId: taskId,
        originalTask: task,
        error: "Exceeded max retries",
        source: "task_queue",
        retryCount: task.retryCount,
      });

      expect(entry).toBeDefined();
      expect(entry.originalTaskId).toBe(taskId);

      // 验证可以从 DLQ 查询
      const queried = dlq.query({ status: "pending" });
      expect(queried.length).toBeGreaterThanOrEqual(1);
      expect(queried.some(e => e.originalTaskId === taskId)).toBe(true);
    });

    it("should support DLQ retry preparation", () => {
      const dlq = new DeadLetterQueue();

      const entry = dlq.enqueue({
        originalTaskId: "retry-prep-test",
        originalTask: { description: "Original task" },
        error: "Temporary error",
        source: "task_queue",
        retryCount: 0,
      });

      // 准备重试
      const retryPayload = dlq.prepareRetry(entry.id);
      expect(retryPayload).toBeDefined();
      expect(retryPayload).toEqual({ description: "Original task" });

      // 验证重试计数已增加
      const retrieved = dlq.get(entry.id);
      expect(retrieved?.retryCount).toBe(1);
    });
  });

  describe("Retry Mechanism Integration", () => {
    it("should retry with exponential backoff", async () => {
      const executor = new RetryExecutor({
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        multiplier: 2,
        jitterType: "none",
      });

      let attempts = 0;
      const start = Date.now();

      const result = await executor.execute(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Temporary failure");
        }
        return { success: true, attempts };
      });

      const duration = Date.now() - start;

      expect(result.success).toBe(true);
      expect(result.value?.attempts).toBe(3);
      expect(result.totalAttempts).toBe(3);
      // 100ms + 200ms = 300ms minimum backoff
      expect(duration).toBeGreaterThanOrEqual(250);
    });

    it("should fail after max retries", async () => {
      const executor = new RetryExecutor({
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 100,
        multiplier: 2,
        jitterType: "none",
      });

      const result = await executor.execute(async () => {
        throw new Error("Permanent failure");
      });

      expect(result.success).toBe(false);
      expect(result.totalAttempts).toBe(3); // 初始 + 2 次重试
      expect(result.error).toBeDefined();
      expect(result.exhausted).toBe(true);
    });

    it("should use retrySafe for non-throwing results", async () => {
      let attempts = 0;

      const result = await retrySafe(
        async () => {
          attempts++;
          if (attempts < 2) {
            throw new Error("Temporary error");
          }
          return "success";
        },
        { maxRetries: 3, initialDelayMs: 10 }
      );

      expect(result.success).toBe(true);
      expect(result.value).toBe("success");
      expect(result.totalAttempts).toBe(2);
    });
  });
});

// ============================================================================
// Cross-Component Integration Tests
// ============================================================================

describe("Cross-Component Integration", () => {
  it("should integrate dispatcher with budget manager", async () => {
    const budgetManager = new BudgetManager({ total: 100000 });
    const dispatcher = new TaskDispatcher({}, 100);

    const cap = createDefaultNanobotCapabilities("did:anp:nanobot:test");
    dispatcher.registerNanobot(cap);

    const prompt = createGenesisPrompt({
      id: "cross-test-1",
      taskType: "genesis",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:test",
      description: "Cross-component test",
    });

    // 从预算管理器获取预算分配
    const rootAllocation = budgetManager.getRootAllocation();

    // 分发任务
    const decision = dispatcher.makeDispatchDecision(prompt);
    expect(decision.canDispatch).toBe(true);

    // 预留和提交预算
    const reserved = budgetManager.reserve(rootAllocation!.id, decision.allocatedBudget || 1000);
    expect(reserved).toBe(true);

    // 执行
    const result = await dispatcher.dispatch(prompt);
    expect(result.success).toBe(true);

    // 提交使用
    budgetManager.commit(rootAllocation!.id, 500, {
      taskId: prompt.id,
      model: "claude-sonnet-4-20250514",
      inputTokens: 300,
      outputTokens: 200,
      totalTokens: 500,
      costUsd: 0.01,
      metadata: {},
    });

    dispatcher.completeTask(prompt.id, true, 0.01);

    // 验证预算状态
    const budget = budgetManager.getSummary();
    expect(budget.totalUsed).toBe(500);
  });

  it("should handle high-priority task with budget priority", async () => {
    const dispatcher = new TaskDispatcher({
      loadBalanceStrategy: "best_fit",
    }, 100);

    const cap = createDefaultNanobotCapabilities("did:anp:nanobot:priority-worker");
    cap.performanceScore = 95;
    dispatcher.registerNanobot(cap);

    const prompt = createGenesisPrompt({
      id: "priority-task-1",
      taskType: "genesis",
      priority: "critical",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:priority-worker",
      description: "Critical priority task",
    });

    const decision = dispatcher.makeDispatchDecision(prompt);
    expect(decision.canDispatch).toBe(true);
    expect(decision.targetNanobot).toBeDefined();
  });

  it("should handle multi-nanobot task distribution", async () => {
    const dispatcher = new TaskDispatcher({}, 100);

    // 注册多个 workers
    for (let i = 0; i < 5; i++) {
      const cap = createDefaultNanobotCapabilities(`did:anp:nanobot:worker-${i}`);
      cap.currentLoad = i % 2; // 交替负载
      dispatcher.registerNanobot(cap);
    }

    // 分发多个任务
    const results = [];
    for (let i = 0; i < 3; i++) {
      const prompt = createGenesisPrompt({
        id: `multi-task-${i}`,
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: `did:anp:nanobot:worker-${i}`,
        description: `Multi task ${i}`,
      });

      const result = await dispatcher.dispatch(prompt);
      results.push(result);
    }

    // 至少部分成功
    const successCount = results.filter((r) => r.success).length;
    expect(successCount).toBeGreaterThan(0);
  });
});

// ============================================================================
// Performance and Stress Tests
// ============================================================================

describe("Performance Integration", () => {
  it("should handle rapid task dispatch", async () => {
    const dispatcher = new TaskDispatcher({}, 1000);
    const cap = createDefaultNanobotCapabilities("did:anp:nanobot:fast-worker");
    cap.maxConcurrentTasks = 100;
    dispatcher.registerNanobot(cap);

    const start = Date.now();
    const promises = [];

    for (let i = 0; i < 50; i++) {
      const prompt = createGenesisPrompt({
        id: `rapid-task-${i}`,
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:fast-worker",
        description: `Rapid task ${i}`,
      });

      promises.push(dispatcher.dispatch(prompt));
    }

    await Promise.all(promises);
    const duration = Date.now() - start;

    // 应在 5 秒内完成
    expect(duration).toBeLessThan(5000);
    expect(dispatcher.getActiveTaskCount()).toBe(50);
  });

  it("should efficiently query DLQ with many entries", () => {
    const dlq = new DeadLetterQueue();

    // 添加大量条目（使用不同的 source 来模拟不同类型）
    for (let i = 0; i < 100; i++) {
      dlq.enqueue({
        originalTaskId: `query-task-${i}`,
        originalTask: { index: i },
        error: `Error ${i}`,
        source: i % 2 === 0 ? "task_queue" : "timeout",
        retryCount: 0,
      });
    }

    const start = Date.now();

    // 查询 - 使用 source 过滤
    const taskQueueEntries = dlq.query({ source: "task_queue" });
    const timeoutEntries = dlq.query({ source: "timeout" });

    const duration = Date.now() - start;

    expect(taskQueueEntries.length).toBe(50);
    expect(timeoutEntries.length).toBe(50);
    expect(duration).toBeLessThan(100); // 应该非常快
  });

  it("should format status correctly in Chinese", () => {
    expect(formatStatus("pending")).toBe("待处理");
    expect(formatStatus("running")).toBe("执行中");
    expect(formatStatus("completed")).toBe("已完成");
    expect(formatStatus("failed")).toBe("已失败");
  });

  it("should detect terminal states correctly", () => {
    expect(isTerminalState("completed")).toBe(true);
    expect(isTerminalState("failed")).toBe(true);
    expect(isTerminalState("cancelled")).toBe(true);
    expect(isTerminalState("pending")).toBe(false);
    expect(isTerminalState("running")).toBe(false);
  });

  it("should format budget status in Chinese", () => {
    expect(formatBudgetStatus("healthy")).toBe("健康");
    expect(formatBudgetStatus("warning")).toBe("警告");
    expect(formatBudgetStatus("critical")).toBe("临界");
    expect(formatBudgetStatus("exhausted")).toBe("耗尽");
  });

  it("should format costs correctly", () => {
    // 小金额使用分
    const smallCost = formatCost(0.005);
    expect(smallCost).toContain("¢");

    // 大金额使用美元
    const largeCost = formatCost(1.5);
    expect(largeCost).toContain("$");
  });

  it("should format tokens correctly", () => {
    // 百万级别
    expect(formatTokens(1500000)).toBe("1.50M");

    // 千级别
    expect(formatTokens(5000)).toBe("5.0K");

    // 小数字
    expect(formatTokens(500)).toBe("500");
  });
});
