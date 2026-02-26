/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  TaskDispatcher,
  CostEstimator,
  createTaskDispatcher,
  createDefaultNanobotCapabilities,
  type NanobotCapabilities,
  type DispatcherConfig,
} from "../../interagent/task-dispatcher.js";
import {
  createGenesisPrompt,
  type GenesisPrompt,
} from "../../interagent/genesis-prompt.js";

describe("CostEstimator", () => {
  let estimator: CostEstimator;

  beforeEach(() => {
    estimator = new CostEstimator();
  });

  describe("estimate", () => {
    it("should estimate task cost", () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create a simple function",
      });

      const estimate = estimator.estimate(prompt);

      expect(estimate.estimatedTokens).toBeGreaterThan(0);
      expect(estimate.estimatedDurationMs).toBeGreaterThan(0);
      expect(estimate.estimatedCost).toBeGreaterThan(0);
      expect(estimate.complexity).toBeDefined();
      expect(estimate.riskLevel).toBeDefined();
      expect(estimate.confidence).toBeGreaterThan(0);
      expect(estimate.confidence).toBeLessThanOrEqual(1);
    });

    it("should estimate higher cost for complex tasks", () => {
      const simple = createGenesisPrompt({
        id: "simple",
        taskType: "report",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Generate report",
      });

      const complex = createGenesisPrompt({
        id: "complex",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create complex feature",
        technical: {
          testCoverage: { minimum: 90, enforce: true },
          security: { noNetworkAccess: true },
        },
        business: {
          quality: { requireCodeReview: true },
        },
      });

      const simpleEstimate = estimator.estimate(simple);
      const complexEstimate = estimator.estimate(complex);

      expect(complexEstimate.estimatedTokens).toBeGreaterThan(simpleEstimate.estimatedTokens);
      expect(complexEstimate.estimatedDurationMs).toBeGreaterThan(simpleEstimate.estimatedDurationMs);
    });

    it("should assess risk based on task type", () => {
      const genesisPrompt = createGenesisPrompt({
        id: "genesis",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "New feature",
      });

      const reportPrompt = createGenesisPrompt({
        id: "report",
        taskType: "report",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Generate report",
      });

      const genesisEstimate = estimator.estimate(genesisPrompt);
      const reportEstimate = estimator.estimate(reportPrompt);

      // Genesis should have higher or equal risk
      const riskLevels = { low: 0, medium: 1, high: 2 };
      expect(riskLevels[genesisEstimate.riskLevel]).toBeGreaterThanOrEqual(
        riskLevels[reportEstimate.riskLevel]
      );
    });

    it("should adjust confidence based on constraint clarity", () => {
      const withConstraints = createGenesisPrompt({
        id: "with",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Task",
        technical: { testCoverage: { minimum: 80 } },
        business: { budget: { total: 100 } },
      });

      const withoutConstraints = createGenesisPrompt({
        id: "without",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Task",
      });

      const withEstimate = estimator.estimate(withConstraints);
      const withoutEstimate = estimator.estimate(withoutConstraints);

      expect(withEstimate.confidence).toBeGreaterThan(withoutEstimate.confidence);
    });
  });
});

describe("TaskDispatcher", () => {
  let dispatcher: TaskDispatcher;

  beforeEach(() => {
    dispatcher = new TaskDispatcher({}, 100);
  });

  describe("Nanobot Management", () => {
    it("should register nanobot", () => {
      const capabilities = createDefaultNanobotCapabilities("did:anp:nanobot:worker1");
      dispatcher.registerNanobot(capabilities);

      const online = dispatcher.getOnlineNanobots();
      expect(online).toHaveLength(1);
      expect(online[0].did).toBe("did:anp:nanobot:worker1");
    });

    it("should unregister nanobot", () => {
      const capabilities = createDefaultNanobotCapabilities("did:anp:nanobot:worker1");
      dispatcher.registerNanobot(capabilities);
      dispatcher.unregisterNanobot("did:anp:nanobot:worker1");

      expect(dispatcher.getOnlineNanobots()).toHaveLength(0);
    });

    it("should update nanobot status", () => {
      const capabilities = createDefaultNanobotCapabilities("did:anp:nanobot:worker1");
      dispatcher.registerNanobot(capabilities);

      dispatcher.updateNanobotStatus("did:anp:nanobot:worker1", {
        currentLoad: 2,
        performanceScore: 90,
      });

      const nanobots = dispatcher.getOnlineNanobots();
      expect(nanobots[0].currentLoad).toBe(2);
      expect(nanobots[0].performanceScore).toBe(90);
    });

    it("should filter offline nanobots", () => {
      const capabilities = createDefaultNanobotCapabilities("did:anp:nanobot:worker1");
      capabilities.isOnline = false;
      dispatcher.registerNanobot(capabilities);

      expect(dispatcher.getOnlineNanobots()).toHaveLength(0);
    });

    it("should filter by heartbeat timeout", () => {
      const capabilities = createDefaultNanobotCapabilities("did:anp:nanobot:worker1");
      capabilities.lastHeartbeat = new Date(Date.now() - 120000); // 2 分钟前
      dispatcher.registerNanobot(capabilities);

      expect(dispatcher.getOnlineNanobots()).toHaveLength(0);
    });

    it("should get available nanobots", () => {
      const cap1 = createDefaultNanobotCapabilities("did:anp:nanobot:worker1");
      cap1.maxConcurrentTasks = 3;
      cap1.currentLoad = 2;

      const cap2 = createDefaultNanobotCapabilities("did:anp:nanobot:worker2");
      cap2.maxConcurrentTasks = 3;
      cap2.currentLoad = 3; // 满载

      dispatcher.registerNanobot(cap1);
      dispatcher.registerNanobot(cap2);

      const available = dispatcher.getAvailableNanobots();
      expect(available).toHaveLength(1);
      expect(available[0].did).toBe("did:anp:nanobot:worker1");
    });
  });

  describe("Budget Management", () => {
    it("should track budget", () => {
      const budget = dispatcher.getBudgetStatus();

      expect(budget.total).toBe(100);
      expect(budget.available).toBe(100);
      expect(budget.allocated).toBe(0);
    });

    it("should add budget", () => {
      dispatcher.addBudget(50);
      const budget = dispatcher.getBudgetStatus();

      expect(budget.total).toBe(150);
      expect(budget.available).toBe(150);
    });

    it("should reserve budget", () => {
      const result = dispatcher.reserveBudget(30);
      const budget = dispatcher.getBudgetStatus();

      expect(result).toBe(true);
      expect(budget.reserved).toBe(30);
      expect(budget.available).toBe(70);
    });

    it("should fail to reserve more than available", () => {
      const result = dispatcher.reserveBudget(150);

      expect(result).toBe(false);
      expect(dispatcher.getBudgetStatus().reserved).toBe(0);
    });

    it("should commit reserved budget", () => {
      dispatcher.reserveBudget(30);
      dispatcher.commitReservedBudget(20);
      const budget = dispatcher.getBudgetStatus();

      expect(budget.allocated).toBe(20);
      expect(budget.reserved).toBe(10);
    });

    it("should release reserved budget", () => {
      dispatcher.reserveBudget(30);
      dispatcher.releaseReservedBudget(20);
      const budget = dispatcher.getBudgetStatus();

      expect(budget.reserved).toBe(10);
      expect(budget.available).toBe(90);
    });
  });

  describe("Dispatch Decision", () => {
    beforeEach(() => {
      const cap1 = createDefaultNanobotCapabilities("did:anp:nanobot:worker1");
      cap1.currentLoad = 1;
      cap1.performanceScore = 80;

      const cap2 = createDefaultNanobotCapabilities("did:anp:nanobot:worker2");
      cap2.currentLoad = 0;
      cap2.performanceScore = 90;

      dispatcher.registerNanobot(cap1);
      dispatcher.registerNanobot(cap2);
    });

    it("should make positive dispatch decision", () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create feature",
      });

      const decision = dispatcher.makeDispatchDecision(prompt);

      expect(decision.canDispatch).toBe(true);
      expect(decision.targetNanobot).toBeDefined();
      expect(decision.allocatedBudget).toBeGreaterThan(0);
    });

    it("should reject when no suitable nanobot", () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create feature",
        technical: {
          allowedLanguages: ["rust"], // 没有支持 rust 的 nanobot
        },
      });

      const decision = dispatcher.makeDispatchDecision(prompt);

      expect(decision.canDispatch).toBe(false);
      expect(decision.rejectionReason).toBeDefined();
    });

    it("should reject when insufficient budget", () => {
      const smallBudgetDispatcher = new TaskDispatcher({}, 0.0001);

      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Complex feature",
      });

      const decision = smallBudgetDispatcher.makeDispatchDecision(prompt);

      expect(decision.canDispatch).toBe(false);
      expect(decision.rejectionReason).toMatch(/budget|可用/); // 支持 English 或 Chinese
    });

    it("should select least loaded nanobot", () => {
      const leastLoadedDispatcher = new TaskDispatcher({
        loadBalanceStrategy: "least_loaded",
      });

      const cap1 = createDefaultNanobotCapabilities("did:anp:nanobot:worker1");
      cap1.currentLoad = 2;

      const cap2 = createDefaultNanobotCapabilities("did:anp:nanobot:worker2");
      cap2.currentLoad = 0;

      leastLoadedDispatcher.registerNanobot(cap1);
      leastLoadedDispatcher.registerNanobot(cap2);

      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Task",
      });

      const decision = leastLoadedDispatcher.makeDispatchDecision(prompt);

      expect(decision.targetNanobot?.did).toBe("did:anp:nanobot:worker2");
    });

    it("should provide alternatives", () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Task",
      });

      const decision = dispatcher.makeDispatchDecision(prompt);

      expect(decision.alternatives.length).toBeGreaterThan(0);
    });
  });

  describe("Dispatch", () => {
    beforeEach(() => {
      const cap = createDefaultNanobotCapabilities("did:anp:nanobot:worker1");
      dispatcher.registerNanobot(cap);
    });

    it("should dispatch task successfully", async () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create feature",
      });

      const result = await dispatcher.dispatch(prompt);

      expect(result.success).toBe(true);
      expect(result.decision.canDispatch).toBe(true);
    });

    it("should emit dispatched event", async () => {
      const handler = vi.fn();
      dispatcher.on("dispatched", handler);

      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create feature",
      });

      await dispatcher.dispatch(prompt);

      expect(handler).toHaveBeenCalled();
    });

    it("should track active tasks", async () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create feature",
      });

      await dispatcher.dispatch(prompt);

      expect(dispatcher.getActiveTaskCount()).toBe(1);
    });

    it("should complete task", async () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create feature",
      });

      await dispatcher.dispatch(prompt);
      dispatcher.completeTask("task-1", true, 0.5);

      expect(dispatcher.getActiveTaskCount()).toBe(0);
    });
  });

  describe("createAndDispatch", () => {
    beforeEach(() => {
      const cap = createDefaultNanobotCapabilities("did:anp:nanobot:worker1");
      dispatcher.registerNanobot(cap);
    });

    it("should create and dispatch task", async () => {
      const result = await dispatcher.createAndDispatch({
        id: "task-1",
        taskType: "genesis",
        description: "Create feature",
      });

      expect(result.success).toBe(true);
      expect(result.prompt.id).toBe("task-1");
      expect(result.prompt.taskType).toBe("genesis");
    });
  });
});

describe("Factory Functions", () => {
  it("should create task dispatcher", () => {
    const dispatcher = createTaskDispatcher({ maxRetries: 5 });

    expect(dispatcher).toBeInstanceOf(TaskDispatcher);
  });

  it("should create default nanobot capabilities", () => {
    const capabilities = createDefaultNanobotCapabilities("did:anp:nanobot:test");

    expect(capabilities.did).toBe("did:anp:nanobot:test");
    expect(capabilities.supportedTaskTypes.length).toBeGreaterThan(0);
    expect(capabilities.isOnline).toBe(true);
  });
});
