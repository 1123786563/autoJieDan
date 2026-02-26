/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  BudgetManager,
  CostCalculator,
  CostEstimator,
  createBudgetManager,
  createCostCalculator,
  createCostEstimator,
  formatBudgetStatus,
  formatCost,
  formatTokens,
  type BudgetConfig,
  type ModelPricing,
} from "../../interagent/budget-manager.js";

describe("CostCalculator", () => {
  let calculator: CostCalculator;

  beforeEach(() => {
    calculator = new CostCalculator();
  });

  describe("calculateCost", () => {
    it("should calculate cost for known models", () => {
      const cost = calculator.calculateCost("gpt-4o-mini", 1000, 500);

      // gpt-4o-mini: $0.00015/1K input, $0.0006/1K output
      // 1000 input = $0.00015, 500 output = $0.0003
      // Total = $0.00045
      expect(cost).toBeCloseTo(0.00045, 6);
    });

    it("should calculate cost for Claude models", () => {
      const cost = calculator.calculateCost("claude-sonnet-4-20250514", 2000, 1000);

      // claude-sonnet-4: $0.003/1K input, $0.015/1K output
      // 2000 input = $0.006, 1000 output = $0.015
      // Total = $0.021
      expect(cost).toBeCloseTo(0.021, 4);
    });

    it("should use default pricing for unknown models", () => {
      const cost = calculator.calculateCost("unknown-model", 1000, 1000);

      // Default: $0.001 per token
      expect(cost).toBeCloseTo(2, 1);
    });
  });

  describe("getModelPricing", () => {
    it("should return pricing for known model", () => {
      const pricing = calculator.getModelPricing("gpt-4o");

      expect(pricing).toBeDefined();
      expect(pricing?.model).toBe("gpt-4o");
      expect(pricing?.contextWindow).toBe(128000);
    });

    it("should return undefined for unknown model", () => {
      const pricing = calculator.getModelPricing("unknown-model");

      expect(pricing).toBeUndefined();
    });
  });

  describe("addModelPricing", () => {
    it("should add custom model pricing", () => {
      const customPricing: ModelPricing = {
        model: "custom-model",
        inputPricePerThousand: 0.01,
        outputPricePerThousand: 0.02,
        contextWindow: 8000,
      };

      calculator.addModelPricing(customPricing);

      const retrieved = calculator.getModelPricing("custom-model");
      expect(retrieved).toEqual(customPricing);

      const cost = calculator.calculateCost("custom-model", 1000, 500);
      expect(cost).toBeCloseTo(0.02, 4);
    });
  });
});

describe("CostEstimator", () => {
  let estimator: CostEstimator;

  beforeEach(() => {
    estimator = new CostEstimator();
  });

  describe("estimateTaskCost", () => {
    it("should estimate cost for genesis task", () => {
      const estimate = estimator.estimateTaskCost(
        "genesis",
        "Create a new authentication system with OAuth2 support"
      );

      expect(estimate.estimatedInputTokens).toBeGreaterThan(0);
      expect(estimate.estimatedOutputTokens).toBeGreaterThan(0);
      expect(estimate.estimatedTotalTokens).toBe(
        estimate.estimatedInputTokens + estimate.estimatedOutputTokens
      );
      expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
      expect(estimate.confidence).toBeGreaterThan(0);
      expect(estimate.confidence).toBeLessThanOrEqual(1);
      expect(estimate.method).toBe("heuristic");
    });

    it("should estimate higher tokens for longer descriptions", () => {
      const shortEstimate = estimator.estimateTaskCost("genesis", "Fix bug");
      const longEstimate = estimator.estimateTaskCost(
        "genesis",
        "Create a comprehensive authentication system with OAuth2, JWT tokens, refresh tokens, session management, and multi-factor authentication support"
      );

      expect(longEstimate.estimatedInputTokens).toBeGreaterThan(shortEstimate.estimatedInputTokens);
    });

    it("should use different multipliers for different task types", () => {
      const genesisEstimate = estimator.estimateTaskCost("genesis", "Test task description");
      const reportEstimate = estimator.estimateTaskCost("report", "Test task description");

      // Genesis tasks typically require more output
      expect(genesisEstimate.estimatedOutputTokens).toBeGreaterThan(reportEstimate.estimatedOutputTokens);
    });

    it("should use historical data when available", () => {
      // Record some usage
      for (let i = 0; i < 5; i++) {
        estimator.recordUsage({
          taskId: `task-${i}`,
          model: "claude-sonnet-4-20250514",
          inputTokens: 1000 + i * 100,
          outputTokens: 2000 + i * 200,
          totalTokens: 3000 + i * 300,
          costUsd: 0.03,
          metadata: { taskType: "genesis" },
        });
      }

      const estimate = estimator.estimateTaskCost("genesis", "New genesis task");

      expect(estimate.method).toBe("historical");
    });
  });

  describe("recordUsage", () => {
    it("should record usage", () => {
      const record = estimator.recordUsage({
        taskId: "task-1",
        model: "claude-sonnet-4-20250514",
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        costUsd: 0.01,
        metadata: {},
      });

      expect(record.id).toBeDefined();
      expect(record.timestamp).toBeInstanceOf(Date);
      expect(record.taskId).toBe("task-1");
    });
  });

  describe("getHistory", () => {
    it("should return all history", () => {
      estimator.recordUsage({
        taskId: "task-1",
        model: "test",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        costUsd: 0.01,
        metadata: {},
      });

      estimator.recordUsage({
        taskId: "task-2",
        model: "test",
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        costUsd: 0.02,
        metadata: {},
      });

      const history = estimator.getHistory();
      expect(history).toHaveLength(2);
    });

    it("should filter by task ID", () => {
      estimator.recordUsage({
        taskId: "task-1",
        model: "test",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        costUsd: 0.01,
        metadata: {},
      });

      estimator.recordUsage({
        taskId: "task-2",
        model: "test",
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        costUsd: 0.02,
        metadata: {},
      });

      const history = estimator.getHistory("task-1");
      expect(history).toHaveLength(1);
      expect(history[0].taskId).toBe("task-1");
    });
  });
});

describe("BudgetManager", () => {
  let manager: BudgetManager;

  beforeEach(() => {
    manager = new BudgetManager({ total: 1000000 });
  });

  describe("createAllocation", () => {
    it("should create root allocation on initialization", () => {
      const root = manager.getRootAllocation();

      expect(root).toBeDefined();
      expect(root?.tier).toBe("system");
      expect(root?.total).toBe(1000000);
    });

    it("should create child allocation", () => {
      const root = manager.getRootAllocation();
      const childId = manager.createAllocation({
        parentId: root!.id,
        tier: "project",
        type: "token",
        total: 50000,
      });

      const child = manager.getAllocation(childId);
      expect(child).toBeDefined();
      expect(child?.tier).toBe("project");
      expect(child?.total).toBe(50000);
      expect(child?.parentId).toBe(root!.id);
    });

    it("should reserve from parent when creating child", () => {
      const root = manager.getRootAllocation();
      const initialAvailable = root!.available;

      manager.createAllocation({
        parentId: root!.id,
        tier: "project",
        type: "token",
        total: 50000,
      });

      const updatedRoot = manager.getRootAllocation();
      expect(updatedRoot!.available).toBeLessThan(initialAvailable);
    });
  });

  describe("reserve", () => {
    it("should reserve budget", () => {
      const root = manager.getRootAllocation();
      const result = manager.reserve(root!.id, 10000);

      expect(result).toBe(true);

      const allocation = manager.getAllocation(root!.id);
      expect(allocation!.reserved).toBeGreaterThan(0);
    });

    it("should fail when insufficient budget", () => {
      const root = manager.getRootAllocation();
      const result = manager.reserve(root!.id, 2000000);

      expect(result).toBe(false);
    });
  });

  describe("commit", () => {
    it("should commit reserved budget", () => {
      const root = manager.getRootAllocation();
      manager.reserve(root!.id, 10000);

      const record = manager.commit(root!.id, 8000, {
        taskId: "task-1",
        model: "test",
        inputTokens: 5000,
        outputTokens: 3000,
        totalTokens: 8000,
        costUsd: 0.01,
        metadata: {},
      });

      expect(record.id).toBeDefined();

      const allocation = manager.getAllocation(root!.id);
      expect(allocation!.used).toBe(8000);
    });
  });

  describe("release", () => {
    it("should release reserved budget", () => {
      const root = manager.getRootAllocation();

      // First reserve some budget
      const reserveResult = manager.reserve(root!.id, 10000);
      expect(reserveResult).toBe(true);

      const allocationBefore = manager.getAllocation(root!.id);
      const reservedBefore = allocationBefore!.reserved;

      // Release half
      manager.release(root!.id, 5000);

      const allocationAfter = manager.getAllocation(root!.id);

      // Reserved should decrease
      expect(allocationAfter!.reserved).toBe(reservedBefore - 5000);

      // Available should increase (or stay same if calculated differently)
      // Some implementations calculate available = total - used - reserved
      expect(allocationAfter!.available).toBeGreaterThanOrEqual(allocationBefore!.available);
    });
  });

  describe("canAfford", () => {
    it("should return true when sufficient budget", () => {
      const root = manager.getRootAllocation();
      expect(manager.canAfford(root!.id, 10000)).toBe(true);
    });

    it("should return false when insufficient budget", () => {
      const smallManager = new BudgetManager({ total: 1000 });
      const root = smallManager.getRootAllocation();
      expect(smallManager.canAfford(root!.id, 2000)).toBe(false);
    });

    it("should allow overage when configured", () => {
      const overageManager = new BudgetManager({
        total: 1000,
        allowOverage: true,
        overageLimit: 50,
      });

      const root = overageManager.getRootAllocation();
      // With 50% overage, max should be 1500
      expect(overageManager.canAfford(root!.id, 1200)).toBe(true);
    });
  });

  describe("status tracking", () => {
    it("should start as healthy", () => {
      const root = manager.getRootAllocation();
      expect(manager.getStatus(root!.id)).toBe("healthy");
    });

    it("should become warning at threshold", () => {
      const warningManager = new BudgetManager({
        total: 10000,
        warningThreshold: 70,
        criticalThreshold: 90,
      });

      const root = warningManager.getRootAllocation();
      warningManager.reserve(root!.id, 7000);
      warningManager.commit(root!.id, 7000, {
        taskId: "task-1",
        model: "test",
        inputTokens: 7000,
        outputTokens: 0,
        totalTokens: 7000,
        costUsd: 0.01,
        metadata: {},
      });

      expect(warningManager.getStatus(root!.id)).toBe("warning");
    });

    it("should become critical at threshold", () => {
      const criticalManager = new BudgetManager({
        total: 10000,
        warningThreshold: 70,
        criticalThreshold: 90,
      });

      const root = criticalManager.getRootAllocation();
      criticalManager.reserve(root!.id, 9500);
      criticalManager.commit(root!.id, 9500, {
        taskId: "task-1",
        model: "test",
        inputTokens: 9500,
        outputTokens: 0,
        totalTokens: 9500,
        costUsd: 0.01,
        metadata: {},
      });

      expect(criticalManager.getStatus(root!.id)).toBe("critical"); // 95% = critical, not exhausted (>=100%)
    });
  });

  describe("events", () => {
    it("should emit allocation_created event", () => {
      const handler = vi.fn();
      manager.on("allocation_created", handler);

      manager.createAllocation({
        tier: "project",
        type: "token",
        total: 50000,
      });

      expect(handler).toHaveBeenCalled();
    });

    it("should emit overrun event", () => {
      const smallManager = new BudgetManager({
        total: 1000,
        warningThreshold: 50,
      });

      const handler = vi.fn();
      smallManager.on("overrun", handler);

      const root = smallManager.getRootAllocation();
      smallManager.reserve(root!.id, 600);
      smallManager.commit(root!.id, 600, {
        taskId: "task-1",
        model: "test",
        inputTokens: 600,
        outputTokens: 0,
        totalTokens: 600,
        costUsd: 0.01,
        metadata: {},
      });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("getSummary", () => {
    it("should return budget summary", () => {
      manager.createAllocation({
        tier: "project",
        type: "token",
        total: 50000,
      });

      const summary = manager.getSummary();

      expect(summary.root).toBeDefined();
      expect(summary.children).toHaveLength(1);
      expect(summary.totalUsed).toBeDefined();
    });
  });

  describe("estimateCost", () => {
    it("should estimate task cost", () => {
      const estimate = manager.estimateCost("genesis", "Create a feature");

      expect(estimate.estimatedTotalTokens).toBeGreaterThan(0);
      expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
    });
  });
});

describe("Factory Functions", () => {
  it("should create budget manager", () => {
    const manager = createBudgetManager({ total: 500000 });

    expect(manager).toBeInstanceOf(BudgetManager);
    expect(manager.getRootAllocation()?.total).toBe(500000);
  });

  it("should create cost calculator", () => {
    const calculator = createCostCalculator();

    expect(calculator).toBeInstanceOf(CostCalculator);
  });

  it("should create cost calculator with custom pricing", () => {
    const customPricing: ModelPricing = {
      model: "custom",
      inputPricePerThousand: 0.05,
      outputPricePerThousand: 0.1,
      contextWindow: 4000,
    };

    const calculator = createCostCalculator([customPricing]);

    expect(calculator.getModelPricing("custom")).toEqual(customPricing);
  });

  it("should create cost estimator", () => {
    const estimator = createCostEstimator();

    expect(estimator).toBeInstanceOf(CostEstimator);
  });
});

describe("Format Functions", () => {
  describe("formatBudgetStatus", () => {
    it("should format status in Chinese", () => {
      expect(formatBudgetStatus("healthy")).toBe("健康");
      expect(formatBudgetStatus("warning")).toBe("警告");
      expect(formatBudgetStatus("critical")).toBe("临界");
      expect(formatBudgetStatus("exhausted")).toBe("耗尽");
    });
  });

  describe("formatCost", () => {
    it("should format cost in cents for small amounts", () => {
      expect(formatCost(0.005)).toContain("¢");
    });

    it("should format cost in dollars for larger amounts", () => {
      const formatted = formatCost(1.5);
      expect(formatted).toContain("$");
    });
  });

  describe("formatTokens", () => {
    it("should format millions", () => {
      expect(formatTokens(1500000)).toBe("1.50M");
    });

    it("should format thousands", () => {
      expect(formatTokens(5000)).toBe("5.0K");
    });

    it("should format small numbers", () => {
      expect(formatTokens(500)).toBe("500");
    });
  });
});
