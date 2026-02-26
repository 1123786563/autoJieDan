/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  TaskLifecycleManager,
  canTransition,
  getValidTransitions,
  isTerminalState,
  formatStatus,
  getStatusColor,
  createErrorCode,
  parseErrorCode,
  ErrorCodes,
  type TaskContext,
  type CompletionData,
  type FailureData,
} from "../../interagent/task-lifecycle.js";

describe("State Transitions", () => {
  describe("canTransition", () => {
    it("should allow valid transitions from pending", () => {
      expect(canTransition("pending", "queued")).toBe(true);
      expect(canTransition("pending", "running")).toBe(true);
      expect(canTransition("pending", "cancelled")).toBe(true);
    });

    it("should allow valid transitions from running", () => {
      expect(canTransition("running", "completed")).toBe(true);
      expect(canTransition("running", "failed")).toBe(true);
      expect(canTransition("running", "cancelled")).toBe(true);
    });

    it("should not allow invalid transitions", () => {
      expect(canTransition("pending", "completed")).toBe(false);
      expect(canTransition("completed", "running")).toBe(false);
      expect(canTransition("cancelled", "pending")).toBe(false);
    });

    it("should allow retry from failed", () => {
      expect(canTransition("failed", "pending")).toBe(true);
      expect(canTransition("failed", "queued")).toBe(true);
    });
  });

  describe("getValidTransitions", () => {
    it("should return valid target states for pending", () => {
      const targets = getValidTransitions("pending");
      expect(targets).toContain("queued");
      expect(targets).toContain("running");
      expect(targets).toContain("cancelled");
    });

    it("should return empty array for terminal states", () => {
      expect(getValidTransitions("completed")).toEqual([]);
      expect(getValidTransitions("cancelled")).toEqual([]);
    });
  });

  describe("isTerminalState", () => {
    it("should return true for terminal states", () => {
      expect(isTerminalState("completed")).toBe(true);
      expect(isTerminalState("failed")).toBe(true);
      expect(isTerminalState("cancelled")).toBe(true);
    });

    it("should return false for non-terminal states", () => {
      expect(isTerminalState("pending")).toBe(false);
      expect(isTerminalState("running")).toBe(false);
    });
  });
});

describe("TaskLifecycleManager", () => {
  let manager: TaskLifecycleManager;
  let context: TaskContext;

  beforeEach(() => {
    const now = new Date();
    context = {
      id: "task-1",
      type: "execution",
      status: "pending",
      priority: "normal",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:worker1",
      input: { command: "test" },
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
      maxRetries: 3,
      metadata: {},
    };
    manager = new TaskLifecycleManager(context);
  });

  describe("start", () => {
    it("should start task from pending", async () => {
      const result = await manager.start();

      expect(result.success).toBe(true);
      expect(result.from).toBe("pending");
      expect(result.to).toBe("running");
      expect(manager.getStatus()).toBe("running");
    });

    it("should not start task from completed", async () => {
      await manager.start();
      await manager.complete({});

      const result = await manager.start();

      expect(result.success).toBe(false);
    });

    it("should set startedAt", async () => {
      await manager.start();

      const ctx = manager.getContext();
      expect(ctx.startedAt).toBeDefined();
    });

    it("should emit started event", async () => {
      const handler = vi.fn();
      manager.on("started", handler);

      await manager.start();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("complete", () => {
    beforeEach(async () => {
      await manager.start();
    });

    it("should complete task", async () => {
      const data: CompletionData = {
        result: { output: "done" },
      };

      const result = await manager.complete(data);

      expect(result.success).toBe(true);
      expect(result.status).toBe("completed");
      expect(manager.getStatus()).toBe("completed");
    });

    it("should store result", async () => {
      const data: CompletionData = {
        result: { value: 42 },
        artifacts: [{ name: "file.txt", type: "text" }],
      };

      const result = await manager.complete(data);

      expect(result.result).toEqual({ value: 42 });
      expect(result.artifacts).toHaveLength(1);
    });

    it("should calculate duration", async () => {
      const result = await manager.complete({});

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should emit completed event", async () => {
      const handler = vi.fn();
      manager.on("completed", handler);

      await manager.complete({});

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("fail", () => {
    beforeEach(async () => {
      await manager.start();
    });

    it("should fail task", async () => {
      const data: FailureData = {
        error: "Something went wrong",
        recoverable: true,
        retryable: true,
      };

      const result = await manager.fail(data);

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(manager.getStatus()).toBe("failed");
    });

    it("should store error", async () => {
      const data: FailureData = {
        error: "Test error",
        errorCode: "TEST_001",
        recoverable: false,
        retryable: true,
      };

      const result = await manager.fail(data);

      expect(result.error).toBe("Test error");

      const ctx = manager.getContext();
      expect(ctx.error).toBe("Test error");
      expect(ctx.errorCode).toBe("TEST_001");
    });

    it("should emit failed event", async () => {
      const handler = vi.fn();
      manager.on("failed", handler);

      await manager.fail({ error: "Failed", recoverable: true, retryable: true });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("should cancel pending task", async () => {
      const result = await manager.cancel("User requested");

      expect(result.success).toBe(false);
      expect(result.status).toBe("cancelled");
      expect(manager.getStatus()).toBe("cancelled");
    });

    it("should cancel running task", async () => {
      await manager.start();

      const result = await manager.cancel("Timeout");

      expect(result.status).toBe("cancelled");
    });

    it("should store cancel reason", async () => {
      await manager.cancel("User cancelled");

      const ctx = manager.getContext();
      expect(ctx.error).toBe("User cancelled");
    });
  });

  describe("retry", () => {
    beforeEach(async () => {
      await manager.start();
      await manager.fail({ error: "Failed", recoverable: true, retryable: true });
    });

    it("should retry failed task", async () => {
      const result = await manager.retry();

      expect(result.success).toBe(true);
      expect(result.to).toBe("pending");
      expect(manager.getStatus()).toBe("pending");
    });

    it("should increment retry count", async () => {
      await manager.retry();

      const ctx = manager.getContext();
      expect(ctx.retryCount).toBe(1);
    });

    it("should clear error on retry", async () => {
      await manager.retry();

      const ctx = manager.getContext();
      expect(ctx.error).toBeUndefined();
    });

    it("should not exceed max retries", async () => {
      await manager.retry();
      await manager.start();
      await manager.fail({ error: "Failed", recoverable: true, retryable: true });

      await manager.retry();
      await manager.start();
      await manager.fail({ error: "Failed", recoverable: true, retryable: true });

      await manager.retry();
      await manager.start();
      await manager.fail({ error: "Failed", recoverable: true, retryable: true });

      // 4th retry should fail
      const result = await manager.retry();

      expect(result.success).toBe(false);
      expect(result.error).toBe("Max retries exceeded");
    });
  });

  describe("query methods", () => {
    it("should return correct status", () => {
      expect(manager.getStatus()).toBe("pending");
      expect(manager.isRunning()).toBe(false);
      expect(manager.isCompleted()).toBe(false);
    });

    it("should detect running state", async () => {
      await manager.start();

      expect(manager.isRunning()).toBe(true);
    });

    it("should detect completed state", async () => {
      await manager.start();
      await manager.complete({});

      expect(manager.isCompleted()).toBe(true);
      expect(manager.isTerminal()).toBe(true);
    });

    it("should detect failed state", async () => {
      await manager.start();
      await manager.fail({ error: "Error", recoverable: true, retryable: true });

      expect(manager.isFailed()).toBe(true);
    });

    it("should check canRetry", async () => {
      expect(manager.canRetry()).toBe(false);

      await manager.start();
      await manager.fail({ error: "Error", recoverable: true, retryable: true });

      expect(manager.canRetry()).toBe(true);
    });
  });

  describe("hooks", () => {
    it("should call onStarting hook", async () => {
      const hook = vi.fn();
      const managerWithHooks = new TaskLifecycleManager(context, {
        onStarting: hook,
      });

      await managerWithHooks.start();

      expect(hook).toHaveBeenCalled();
    });

    it("should call onCompleted hook", async () => {
      const hook = vi.fn();
      const managerWithHooks = new TaskLifecycleManager(context, {
        onCompleted: hook,
      });

      await managerWithHooks.start();
      await managerWithHooks.complete({});

      expect(hook).toHaveBeenCalled();
    });

    it("should call onFailed hook", async () => {
      const hook = vi.fn();
      const managerWithHooks = new TaskLifecycleManager(context, {
        onFailed: hook,
      });

      await managerWithHooks.start();
      await managerWithHooks.fail({ error: "Error", recoverable: true, retryable: true });

      expect(hook).toHaveBeenCalled();
    });
  });

  describe("transition history", () => {
    it("should record transitions", async () => {
      await manager.start();
      await manager.complete({});

      const history = manager.getTransitionHistory();

      expect(history).toHaveLength(2);
      expect(history[0].from).toBe("pending");
      expect(history[0].to).toBe("running");
      expect(history[1].from).toBe("running");
      expect(history[1].to).toBe("completed");
    });
  });
});

describe("Helper Functions", () => {
  describe("formatStatus", () => {
    it("should format status in Chinese", () => {
      expect(formatStatus("pending")).toBe("待处理");
      expect(formatStatus("running")).toBe("执行中");
      expect(formatStatus("completed")).toBe("已完成");
    });
  });

  describe("getStatusColor", () => {
    it("should return correct colors", () => {
      expect(getStatusColor("pending")).toBe("yellow");
      expect(getStatusColor("running")).toBe("cyan");
      expect(getStatusColor("completed")).toBe("green");
      expect(getStatusColor("failed")).toBe("red");
    });
  });

  describe("createErrorCode", () => {
    it("should create error code", () => {
      const code = createErrorCode("TEST", 1, "Test error");
      expect(code).toBe("TEST_001: Test error");
    });

    it("should pad code number", () => {
      const code = createErrorCode("VAL", 42, "Validation error");
      expect(code).toBe("VAL_042: Validation error");
    });
  });

  describe("parseErrorCode", () => {
    it("should parse valid error code", () => {
      const parsed = parseErrorCode("TEST_001: Test error");

      expect(parsed).not.toBeNull();
      expect(parsed?.category).toBe("TEST");
      expect(parsed?.code).toBe(1);
      expect(parsed?.message).toBe("Test error");
    });

    it("should return null for invalid code", () => {
      expect(parseErrorCode("invalid")).toBeNull();
      expect(parseErrorCode("TEST_1: Error")).toBeNull();
    });
  });

  describe("ErrorCodes", () => {
    it("should have predefined codes", () => {
      expect(ErrorCodes.INVALID_INPUT).toContain("VALIDATION_101");
      expect(ErrorCodes.EXECUTION_FAILED).toContain("EXECUTION_201");
      expect(ErrorCodes.INTERNAL_ERROR).toContain("SYSTEM_301");
    });
  });
});
