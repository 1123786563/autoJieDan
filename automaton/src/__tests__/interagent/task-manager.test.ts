/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  TaskManager,
  type Task,
  type CreateTaskOptions,
  canRetry,
  isCompleted,
  getTaskDuration,
} from "../../interagent/task-manager.js";

describe("TaskManager", () => {
  let manager: TaskManager;

  beforeEach(() => {
    manager = new TaskManager();
    manager.start();
  });

  afterEach(() => {
    manager.stop();
  });

  describe("Task Creation", () => {
    it("should create a task with default values", () => {
      const options: CreateTaskOptions = {
        type: "execution",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        input: { command: "test" },
      };

      const task = manager.createTask(options);

      expect(task.id).toBeDefined();
      expect(task.type).toBe("execution");
      expect(task.status).toBe("pending");
      expect(task.priority).toBe("normal");
      expect(task.sourceDid).toBe("did:anp:automaton:main");
      expect(task.targetDid).toBe("did:anp:nanobot:worker1");
      expect(task.retryCount).toBe(0);
      expect(task.maxRetries).toBe(3);
    });

    it("should create a task with custom priority", () => {
      const options: CreateTaskOptions = {
        type: "genesis",
        priority: "critical",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        input: { prompt: "Build feature X" },
      };

      const task = manager.createTask(options);

      expect(task.priority).toBe("critical");
    });

    it("should create a task with idempotency key", () => {
      const options: CreateTaskOptions = {
        type: "execution",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        input: { command: "test" },
        idempotencyKey: "unique-key-123",
      };

      const task1 = manager.createTask(options);
      const task2 = manager.createTask(options);

      // 相同幂等性键应返回相同任务
      expect(task1.id).toBe(task2.id);
    });

    it("should create multiple tasks with different idempotency keys", () => {
      const task1 = manager.createTask({
        type: "execution",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        input: { command: "test1" },
        idempotencyKey: "key-1",
      });

      const task2 = manager.createTask({
        type: "execution",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        input: { command: "test2" },
        idempotencyKey: "key-2",
      });

      expect(task1.id).not.toBe(task2.id);
    });
  });

  describe("Task Retrieval", () => {
    it("should get task by id", () => {
      const created = manager.createTask({
        type: "execution",
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        input: {},
      });

      const retrieved = manager.getTask(created.id);

      expect(retrieved).toEqual(created);
    });

    it("should return undefined for non-existent task", () => {
      const task = manager.getTask("non-existent-id");
      expect(task).toBeUndefined();
    });

    it("should get task by idempotency key", () => {
      manager.createTask({
        type: "execution",
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        input: {},
        idempotencyKey: "test-key",
      });

      const task = manager.getTaskByIdempotencyKey("test-key");

      expect(task).toBeDefined();
      expect(task?.metadata.idempotencyKey).toBe("test-key");
    });
  });

  describe("Task Status Updates", () => {
    it("should update task status", () => {
      const task = manager.createTask({
        type: "execution",
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        input: {},
      });

      const updated = manager.updateTaskStatus(task.id, "running");

      expect(updated?.status).toBe("running");
      expect(updated?.startedAt).toBeDefined();
    });

    it("should complete a task with result", () => {
      const task = manager.createTask({
        type: "execution",
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        input: {},
      });

      const result = { output: "success" };
      const updated = manager.updateTaskStatus(task.id, "completed", { result });

      expect(updated?.status).toBe("completed");
      expect(updated?.result).toEqual(result);
      expect(updated?.completedAt).toBeDefined();
    });

    it("should fail a task with error", () => {
      const task = manager.createTask({
        type: "execution",
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        input: {},
      });

      const updated = manager.updateTaskStatus(task.id, "failed", {
        error: "Something went wrong",
      });

      expect(updated?.status).toBe("failed");
      expect(updated?.error).toBe("Something went wrong");
    });
  });

  describe("Lease Management", () => {
    it("should acquire a lease", () => {
      const task = manager.createTask({
        type: "execution",
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        input: {},
      });

      const leased = manager.acquireLease(task.id, 60);

      expect(leased?.status).toBe("running");
      expect(leased?.leaseExpiresAt).toBeDefined();
    });

    it("should not acquire lease for non-pending task", () => {
      const task = manager.createTask({
        type: "execution",
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        input: {},
      });

      manager.updateTaskStatus(task.id, "completed", { result: {} });

      const leased = manager.acquireLease(task.id, 60);

      expect(leased).toBeUndefined();
    });

    it("should release a lease", () => {
      const task = manager.createTask({
        type: "execution",
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        input: {},
      });

      manager.acquireLease(task.id, 60);
      const released = manager.releaseLease(task.id);

      expect(released?.leaseExpiresAt).toBeUndefined();
    });

    it("should detect expired lease", async () => {
      const task = manager.createTask({
        type: "execution",
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        input: {},
      });

      // Acquire lease with 0 duration (already expired)
      manager.acquireLease(task.id, 0);

      // Wait a bit
      await new Promise((r) => setTimeout(r, 10));

      const retrieved = manager.getTask(task.id)!;
      expect(manager.isLeaseExpired(retrieved)).toBe(true);
    });
  });

  describe("Task Retry", () => {
    it("should retry a failed task", () => {
      const task = manager.createTask({
        type: "execution",
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        input: {},
        maxRetries: 3,
      });

      manager.updateTaskStatus(task.id, "failed", { error: "Error" });
      const retried = manager.retryTask(task.id);

      expect(retried?.status).toBe("pending");
      expect(retried?.retryCount).toBe(1);
    });

    it("should mark task as failed after max retries", () => {
      const task = manager.createTask({
        type: "execution",
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        input: {},
        maxRetries: 2,
      });

      // Retry twice
      manager.retryTask(task.id);
      manager.retryTask(task.id);

      // Third retry should fail
      const retried = manager.retryTask(task.id);

      expect(retried?.status).toBe("failed");
      expect(retried?.error).toContain("exhausted");
    });
  });

  describe("Task Queries", () => {
    beforeEach(() => {
      // Create some test tasks
      manager.createTask({
        type: "genesis",
        priority: "critical",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        input: {},
      });

      manager.createTask({
        type: "execution",
        priority: "high",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker2",
        input: {},
      });

      manager.createTask({
        type: "execution",
        priority: "normal",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        input: {},
      });
    });

    it("should get pending tasks sorted by priority", () => {
      const pending = manager.getPendingTasks();

      expect(pending.length).toBe(3);
      expect(pending[0].priority).toBe("critical");
      expect(pending[1].priority).toBe("high");
      expect(pending[2].priority).toBe("normal");
    });

    it("should filter tasks by type", () => {
      const genesis = manager.getPendingTasks({ type: "genesis" });

      expect(genesis.length).toBe(1);
      expect(genesis[0].type).toBe("genesis");
    });

    it("should filter tasks by target", () => {
      const worker1Tasks = manager.getPendingTasks({
        targetDid: "did:anp:nanobot:worker1",
      });

      expect(worker1Tasks.length).toBe(2);
    });

    it("should limit results", () => {
      const limited = manager.getPendingTasks({ limit: 2 });

      expect(limited.length).toBe(2);
    });

    it("should get task stats", () => {
      const stats = manager.getStats();

      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(3);
      expect(stats.running).toBe(0);
    });
  });

  describe("Events", () => {
    it("should emit task:created event", () => {
      const handler = vi.fn();
      manager.on("task:created", handler);

      manager.createTask({
        type: "execution",
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        input: {},
      });

      expect(handler).toHaveBeenCalled();
    });

    it("should emit task:updated event", () => {
      const handler = vi.fn();
      manager.on("task:updated", handler);

      const task = manager.createTask({
        type: "execution",
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        input: {},
      });

      manager.updateTaskStatus(task.id, "running");

      expect(handler).toHaveBeenCalled();
    });
  });
});

describe("Helper Functions", () => {
  describe("canRetry", () => {
    it("should return true when retries remaining", () => {
      const task = { retryCount: 1, maxRetries: 3 } as Task;
      expect(canRetry(task)).toBe(true);
    });

    it("should return false when max retries reached", () => {
      const task = { retryCount: 3, maxRetries: 3 } as Task;
      expect(canRetry(task)).toBe(false);
    });
  });

  describe("isCompleted", () => {
    it("should return true for completed status", () => {
      expect(isCompleted({ status: "completed" } as Task)).toBe(true);
      expect(isCompleted({ status: "failed" } as Task)).toBe(true);
      expect(isCompleted({ status: "cancelled" } as Task)).toBe(true);
    });

    it("should return false for other status", () => {
      expect(isCompleted({ status: "pending" } as Task)).toBe(false);
      expect(isCompleted({ status: "running" } as Task)).toBe(false);
    });
  });

  describe("getTaskDuration", () => {
    it("should return undefined for tasks not started", () => {
      const task = { startedAt: undefined } as Task;
      expect(getTaskDuration(task)).toBeUndefined();
    });

    it("should return duration for running task", () => {
      const task = {
        startedAt: new Date(Date.now() - 5000),
        completedAt: undefined,
      } as Task;

      const duration = getTaskDuration(task);

      expect(duration).toBeGreaterThanOrEqual(5);
    });

    it("should return duration for completed task", () => {
      const task = {
        startedAt: new Date(Date.now() - 10000),
        completedAt: new Date(Date.now() - 3000),
      } as Task;

      const duration = getTaskDuration(task);

      expect(duration).toBeCloseTo(7, 0);
    });
  });
});
