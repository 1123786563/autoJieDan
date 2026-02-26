/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ResourceTracker,
  createResourceTracker,
  formatCost,
  formatTokens,
  formatResourceReport,
  formatBudgetStatus,
  type TokenUsageRecord,
  type ResourceSnapshot,
  type BudgetStatus,
} from "../../interagent/resource-tracker.js";

describe("ResourceTracker", () => {
  let tracker: ResourceTracker;

  beforeEach(() => {
    tracker = createResourceTracker();
  });

  describe("Token Recording", () => {
    it("should record token usage", () => {
      const record = tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
        metadata: {},
      });

      expect(record.id).toBeDefined();
      expect(record.timestamp).toBeInstanceOf(Date);
      expect(record.taskId).toBe("task-1");
      expect(record.inputTokens).toBe(1000);
      expect(record.outputTokens).toBe(500);
    });

    it("should record token usage with caching", () => {
      const record = tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        inputTokens: 2000,
        outputTokens: 1000,
        cachedInputTokens: 1500,
        metadata: {},
      });

      expect(record.cachedInputTokens).toBe(1500);
    });

    it("should record batch token usage", () => {
      const records = tracker.recordTokenUsageBatch([
        { taskId: "task-1", provider: "openai", model: "gpt-4o", inputTokens: 100, outputTokens: 50, metadata: {} },
        { taskId: "task-1", provider: "openai", model: "gpt-4o", inputTokens: 200, outputTokens: 100, metadata: {} },
      ]);

      expect(records).toHaveLength(2);
    });
  });

  describe("API Call Recording", () => {
    it("should record API call", () => {
      const record = tracker.recordApiCall({
        taskId: "task-1",
        endpoint: "/v1/chat/completions",
        method: "POST",
        statusCode: 200,
        durationMs: 150,
        metadata: {},
      });

      expect(record.id).toBeDefined();
      expect(record.timestamp).toBeInstanceOf(Date);
      expect(record.statusCode).toBe(200);
      expect(record.durationMs).toBe(150);
    });

    it("should record failed API call", () => {
      const record = tracker.recordApiCall({
        taskId: "task-1",
        endpoint: "/v1/chat/completions",
        method: "POST",
        statusCode: 500,
        durationMs: 50,
        error: "Internal Server Error",
        metadata: {},
      });

      expect(record.statusCode).toBe(500);
      expect(record.error).toBe("Internal Server Error");
    });
  });

  describe("Cost Calculation", () => {
    it("should calculate cost for GPT-4o", () => {
      const record: TokenUsageRecord = {
        id: "test",
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        timestamp: new Date(),
        metadata: {},
      };

      const cost = tracker.calculateCost(record);
      // Input: $2.5/M, Output: $10/M = $2.5 + $10 = $12.5
      expect(cost).toBeCloseTo(12.5, 2);
    });

    it("should calculate cost with caching", () => {
      const record: TokenUsageRecord = {
        id: "test",
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 2_000_000,
        outputTokens: 1_000_000,
        cachedInputTokens: 1_000_000,
        timestamp: new Date(),
        metadata: {},
      };

      const cost = tracker.calculateCost(record);
      // Effective input: 1M @ $2.5 = $2.5
      // Cached: 1M @ $1.25 = $1.25
      // Output: 1M @ $10 = $10
      // Total: $13.75
      expect(cost).toBeCloseTo(13.75, 2);
    });

    it("should calculate cost for Claude", () => {
      const record: TokenUsageRecord = {
        id: "test",
        taskId: "task-1",
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        timestamp: new Date(),
        metadata: {},
      };

      const cost = tracker.calculateCost(record);
      // Input: $3/M, Output: $15/M = $3 + $15 = $18
      expect(cost).toBeCloseTo(18, 2);
    });

    it("should get total cost", () => {
      tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o-mini",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        metadata: {},
      });

      const totalCost = tracker.getTotalCost();
      // Input: $0.15/M, Output: $0.6/M = $0.75
      expect(totalCost).toBeCloseTo(0.75, 3);
    });

    it("should get cost breakdown", () => {
      tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        metadata: {},
      });

      const breakdown = tracker.getCostBreakdown();
      expect(breakdown.input).toBeCloseTo(2.5, 2);
      expect(breakdown.output).toBeCloseTo(10, 2);
      expect(breakdown.total).toBeCloseTo(12.5, 2);
      expect(breakdown.byProvider["openai/gpt-4o"]).toBeCloseTo(12.5, 2);
    });
  });

  describe("Resource Statistics", () => {
    beforeEach(() => {
      tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
        metadata: {},
      });
      tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 2000,
        outputTokens: 1000,
        metadata: {},
      });
      tracker.recordTokenUsage({
        taskId: "task-2",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 500,
        outputTokens: 250,
        metadata: {},
      });
    });

    it("should get token stats", () => {
      const stats = tracker.getTokenStats();

      expect(stats.totalInput).toBe(3500);
      expect(stats.totalOutput).toBe(1750);
      expect(stats.total).toBe(5250);
      expect(stats.avgInputPerRequest).toBeCloseTo(3500 / 3, 2);
    });

    it("should get token stats for specific task", () => {
      const stats = tracker.getTokenStats("task-1");

      expect(stats.totalInput).toBe(3000);
      expect(stats.totalOutput).toBe(1500);
    });

    it("should get API call stats", () => {
      tracker.recordApiCall({
        taskId: "task-1",
        endpoint: "/v1/chat/completions",
        method: "POST",
        statusCode: 200,
        durationMs: 100,
        metadata: {},
      });
      tracker.recordApiCall({
        taskId: "task-1",
        endpoint: "/v1/chat/completions",
        method: "POST",
        statusCode: 500,
        durationMs: 50,
        metadata: {},
      });

      const stats = tracker.getApiCallStats();

      expect(stats.total).toBe(2);
      expect(stats.successful).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.avgDurationMs).toBe(75);
    });

    it("should get task usage", () => {
      const usage = tracker.getTaskUsage("task-1");

      expect(usage).toBeDefined();
      expect(usage?.tokens).toBe(4500); // 1000+500+2000+1000
    });

    it("should get all task usage", () => {
      const allUsage = tracker.getAllTaskUsage();

      expect(allUsage.size).toBe(2);
      expect(allUsage.get("task-1")?.tokens).toBe(4500);
      expect(allUsage.get("task-2")?.tokens).toBe(750);
    });
  });

  describe("Budget Management", () => {
    it("should set budget", () => {
      const budget = tracker.setBudget({
        taskId: "task-1",
        tokenBudget: 10000,
        costBudget: 10,
        apiCallBudget: 100,
        startTime: new Date(),
        hardLimit: true,
        warningThreshold: 80,
        criticalThreshold: 95,
      });

      expect(budget.id).toBeDefined();
      expect(budget.tokenBudget).toBe(10000);
    });

    it("should set task budget with defaults", () => {
      const budget = tracker.setTaskBudget("task-1", {
        tokenBudget: 10000,
        costBudget: 5,
      });

      expect(budget.taskId).toBe("task-1");
      expect(budget.hardLimit).toBe(false);
    });

    it("should get budget status - normal", () => {
      const budget = tracker.setTaskBudget("task-1", {
        tokenBudget: 10000,
        costBudget: 10,
      });

      tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o-mini",
        inputTokens: 1000,
        outputTokens: 500,
        metadata: {},
      });

      const status = tracker.getBudgetStatus(budget.id);

      expect(status).toBeDefined();
      expect(status?.status).toBe("normal");
      expect(status?.tokensUsed).toBe(1500);
    });

    it("should get budget status - warning", () => {
      const budget = tracker.setTaskBudget("task-1", {
        tokenBudget: 1000,
        costBudget: 10,
      });

      tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o-mini",
        inputTokens: 850,
        outputTokens: 50,
        metadata: {},
      });

      const status = tracker.getBudgetStatus(budget.id);

      expect(status?.status).toBe("warning");
      expect(status?.tokenUsagePercent).toBeCloseTo(90, 0);
    });

    it("should get budget status - exceeded", () => {
      const budget = tracker.setTaskBudget("task-1", {
        tokenBudget: 100,
        costBudget: 10,
      });

      tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o-mini",
        inputTokens: 200,
        outputTokens: 100,
        metadata: {},
      });

      const status = tracker.getBudgetStatus(budget.id);

      expect(status?.status).toBe("exceeded");
    });

    it("should remove budget", () => {
      const budget = tracker.setTaskBudget("task-1", { tokenBudget: 1000 });

      const removed = tracker.removeBudget(budget.id);
      expect(removed).toBe(true);

      const status = tracker.getBudgetStatus(budget.id);
      expect(status).toBeUndefined();
    });
  });

  describe("Resource Prediction", () => {
    it("should predict resources with insufficient data", () => {
      const prediction = tracker.predictResources("task-1");

      expect(prediction.confidence).toBe(0);
      expect(prediction.dataPointsUsed).toBe(0);
    });

    it("should predict resources with linear method", () => {
      // 添加多个数据点
      for (let i = 0; i < 5; i++) {
        tracker.recordTokenUsage({
          taskId: "task-1",
          provider: "openai",
          model: "gpt-4o-mini",
          inputTokens: 1000,
          outputTokens: 500,
          metadata: {},
        });
      }

      const prediction = tracker.predictResources("task-1", { method: "linear" });

      expect(prediction.confidence).toBeGreaterThan(0);
      expect(prediction.dataPointsUsed).toBe(5);
      expect(prediction.method).toBe("linear");
    });

    it("should predict resources with average method", () => {
      for (let i = 0; i < 5; i++) {
        tracker.recordTokenUsage({
          taskId: "task-1",
          provider: "openai",
          model: "gpt-4o-mini",
          inputTokens: 1000,
          outputTokens: 500,
          metadata: {},
        });
      }

      const prediction = tracker.predictResources("task-1", { method: "average" });

      expect(prediction.method).toBe("average");
    });

    it("should predict resources with exponential method", () => {
      for (let i = 0; i < 5; i++) {
        tracker.recordTokenUsage({
          taskId: "task-1",
          provider: "openai",
          model: "gpt-4o-mini",
          inputTokens: 1000 * (i + 1),
          outputTokens: 500 * (i + 1),
          metadata: {},
        });
      }

      const prediction = tracker.predictResources("task-1", { method: "exponential" });

      expect(prediction.method).toBe("exponential");
    });
  });

  describe("Snapshots", () => {
    it("should create snapshot", () => {
      tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
        metadata: {},
      });

      const snapshot = tracker.createSnapshot();

      expect(snapshot.timestamp).toBeInstanceOf(Date);
      expect(snapshot.totalTokens).toBe(1500);
      expect(snapshot.totalInputTokens).toBe(1000);
      expect(snapshot.totalOutputTokens).toBe(500);
    });

    it("should get snapshots history", () => {
      tracker.createSnapshot();
      tracker.createSnapshot();

      const snapshots = tracker.getSnapshots();
      expect(snapshots).toHaveLength(2);
    });

    it("should start and stop auto snapshot", () => {
      vi.useFakeTimers();

      tracker.startAutoSnapshot();
      vi.advanceTimersByTime(120000);
      const snapshots = tracker.getSnapshots();
      expect(snapshots.length).toBeGreaterThanOrEqual(2);

      tracker.stopAutoSnapshot();
      vi.advanceTimersByTime(120000);
      const newSnapshots = tracker.getSnapshots();
      expect(newSnapshots.length).toBe(snapshots.length);

      vi.useRealTimers();
    });
  });

  describe("Events", () => {
    it("should emit token_used event", () => {
      const handler = vi.fn();
      tracker.on("token_used", handler);

      tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
        metadata: {},
      });

      expect(handler).toHaveBeenCalled();
    });

    it("should emit api_called event", () => {
      const handler = vi.fn();
      tracker.on("api_called", handler);

      tracker.recordApiCall({
        taskId: "task-1",
        endpoint: "/test",
        method: "POST",
        statusCode: 200,
        durationMs: 100,
        metadata: {},
      });

      expect(handler).toHaveBeenCalled();
    });

    it("should emit budget_warning event", () => {
      const handler = vi.fn();
      tracker.on("budget_warning", handler);

      tracker.setTaskBudget("task-1", { tokenBudget: 1000 });
      tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o-mini",
        inputTokens: 850,
        outputTokens: 50,
        metadata: {},
      });

      expect(handler).toHaveBeenCalled();
    });

    it("should emit budget_exceeded event", () => {
      const handler = vi.fn();
      tracker.on("budget_exceeded", handler);

      tracker.setTaskBudget("task-1", { tokenBudget: 100 });
      tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o-mini",
        inputTokens: 200,
        outputTokens: 100,
        metadata: {},
      });

      expect(handler).toHaveBeenCalled();
    });

    it("should emit generic resource event", () => {
      const handler = vi.fn();
      tracker.on("resource", handler);

      tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
        metadata: {},
      });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("Utility Methods", () => {
    it("should get all records", () => {
      tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
        metadata: {},
      });
      tracker.recordApiCall({
        taskId: "task-1",
        endpoint: "/test",
        method: "POST",
        statusCode: 200,
        durationMs: 100,
        metadata: {},
      });

      const records = tracker.getRecords();

      expect(records.tokens).toHaveLength(1);
      expect(records.apiCalls).toHaveLength(1);
    });

    it("should clear history", () => {
      tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
        metadata: {},
      });

      tracker.clearHistory();
      const records = tracker.getRecords();

      expect(records.tokens).toHaveLength(0);
    });

    it("should clear task data", () => {
      tracker.recordTokenUsage({
        taskId: "task-1",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
        metadata: {},
      });
      tracker.recordTokenUsage({
        taskId: "task-2",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
        metadata: {},
      });

      tracker.clearTaskData("task-1");
      const records = tracker.getRecords();

      expect(records.tokens).toHaveLength(1);
      expect(records.tokens[0].taskId).toBe("task-2");
    });

    it("should add and get pricing", () => {
      tracker.addPricing({
        provider: "custom",
        model: "custom-model",
        inputPricePerMillion: 1.0,
        outputPricePerMillion: 2.0,
        supportsCaching: false,
      });

      const pricing = tracker.getPricing("custom", "custom-model");

      expect(pricing).toBeDefined();
      expect(pricing?.inputPricePerMillion).toBe(1.0);
    });
  });
});

describe("Factory Functions", () => {
  it("should create resource tracker", () => {
    const tracker = createResourceTracker();
    expect(tracker).toBeInstanceOf(ResourceTracker);
  });

  it("should create with custom config", () => {
    const tracker = createResourceTracker({
      maxHistoryEntries: 100,
      snapshotIntervalMs: 30000,
    });

    expect(tracker).toBeInstanceOf(ResourceTracker);
  });
});

describe("Format Functions", () => {
  describe("formatCost", () => {
    it("should format mills for very small costs", () => {
      expect(formatCost(0.001)).toBe("$1.0000m");
    });

    it("should format small costs", () => {
      expect(formatCost(0.05)).toBe("$0.0500");
    });

    it("should format medium costs", () => {
      expect(formatCost(5.5)).toBe("$5.50");
    });

    it("should format large costs", () => {
      expect(formatCost(150)).toBe("$150");
    });
  });

  describe("formatTokens", () => {
    it("should format small numbers", () => {
      expect(formatTokens(500)).toBe("500");
    });

    it("should format thousands", () => {
      expect(formatTokens(5000)).toBe("5.0K");
    });

    it("should format millions", () => {
      expect(formatTokens(1_500_000)).toBe("1.50M");
    });
  });

  describe("formatResourceReport", () => {
    it("should format complete report", () => {
      const snapshot: ResourceSnapshot = {
        timestamp: new Date("2026-02-26T00:00:00Z"),
        totalTokens: 10000,
        totalInputTokens: 7000,
        totalOutputTokens: 3000,
        totalCachedTokens: 1000,
        totalApiCalls: 50,
        totalCost: 2.5,
        avgTokensPerRequest: 200,
        avgCostPerRequest: 0.05,
        memoryUsageMb: 128.5,
        cpuPercent: 25,
      };

      const report = formatResourceReport(snapshot);

      expect(report).toContain("资源使用报告");
      expect(report).toContain("10.0K");
      expect(report).toContain("50");
      expect(report).toContain("$2.50");
      expect(report).toContain("128.5 MB");
    });
  });

  describe("formatBudgetStatus", () => {
    it("should format normal status", () => {
      const status: BudgetStatus = {
        budgetId: "budget-1",
        tokensUsed: 5000,
        costUsed: 1.5,
        apiCallsUsed: 25,
        tokenUsagePercent: 50,
        costUsagePercent: 30,
        apiCallUsagePercent: 25,
        status: "normal",
        remainingTokens: 5000,
        remainingCost: 3.5,
      };

      const formatted = formatBudgetStatus(status);

      expect(formatted).toContain("✅");
      expect(formatted).toContain("normal");
      expect(formatted).toContain("50.0%");
    });

    it("should format warning status", () => {
      const status: BudgetStatus = {
        budgetId: "budget-1",
        tokensUsed: 8500,
        costUsed: 8.5,
        apiCallsUsed: 85,
        tokenUsagePercent: 85,
        costUsagePercent: 85,
        apiCallUsagePercent: 85,
        status: "warning",
        remainingTokens: 1500,
        remainingCost: 1.5,
      };

      const formatted = formatBudgetStatus(status);

      expect(formatted).toContain("⚠️");
      expect(formatted).toContain("warning");
    });

    it("should format exceeded status", () => {
      const status: BudgetStatus = {
        budgetId: "budget-1",
        tokensUsed: 15000,
        costUsed: 15,
        apiCallsUsed: 150,
        tokenUsagePercent: 150,
        costUsagePercent: 150,
        apiCallUsagePercent: 150,
        status: "exceeded",
        remainingTokens: 0,
        remainingCost: 0,
      };

      const formatted = formatBudgetStatus(status);

      expect(formatted).toContain("❌");
      expect(formatted).toContain("exceeded");
    });
  });
});
