/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DeadLetterQueue,
  createDeadLetterQueue,
  createDLQEntryFromError,
  formatDLQEntry,
  DEFAULT_DLQ_CONFIG,
  type DLQEntry,
  type DLQFilter,
  type DLQConfig,
} from "../../interagent/dlq.js";

describe("DeadLetterQueue", () => {
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    dlq = new DeadLetterQueue({ autoCleanup: false });
  });

  afterEach(() => {
    dlq.destroy();
  });

  describe("enqueue", () => {
    it("should add entry to queue", () => {
      const entry = dlq.enqueue({
        originalTaskId: "task-1",
        originalTask: { command: "test" },
        error: "Something went wrong",
      });

      expect(entry.id).toBeDefined();
      expect(entry.originalTaskId).toBe("task-1");
      expect(entry.error).toBe("Something went wrong");
      expect(entry.status).toBe("pending");
    });

    it("should emit enqueued event", () => {
      const handler = vi.fn();
      dlq.on("enqueued", handler);

      dlq.enqueue({
        originalTaskId: "task-1",
        originalTask: {},
        error: "Error",
      });

      expect(handler).toHaveBeenCalled();
    });

    it("should include all options", () => {
      const entry = dlq.enqueue({
        originalTaskId: "task-1",
        originalTask: { data: "test" },
        error: "Test error",
        errorCode: "TEST_001",
        stack: "Error: Test error\n  at test.js:1",
        source: "timeout",
        retryCount: 3,
        metadata: { key: "value" },
      });

      expect(entry.errorCode).toBe("TEST_001");
      expect(entry.stack).toContain("test.js");
      expect(entry.source).toBe("timeout");
      expect(entry.retryCount).toBe(3);
      expect(entry.metadata).toEqual({ key: "value" });
    });

    it("should default source to unknown", () => {
      const entry = dlq.enqueue({
        originalTaskId: "task-1",
        originalTask: {},
        error: "Error",
      });

      expect(entry.source).toBe("unknown");
    });
  });

  describe("enqueueBatch", () => {
    it("should add multiple entries", () => {
      const entries = dlq.enqueueBatch([
        { originalTaskId: "task-1", originalTask: {}, error: "Error 1" },
        { originalTaskId: "task-2", originalTask: {}, error: "Error 2" },
      ]);

      expect(entries).toHaveLength(2);
      expect(entries[0].originalTaskId).toBe("task-1");
      expect(entries[1].originalTaskId).toBe("task-2");
    });
  });

  describe("get", () => {
    it("should return entry by id", () => {
      const entry = dlq.enqueue({
        originalTaskId: "task-1",
        originalTask: {},
        error: "Error",
      });

      const retrieved = dlq.get(entry.id);
      expect(retrieved).toEqual(entry);
    });

    it("should return undefined for non-existent id", () => {
      expect(dlq.get("non-existent")).toBeUndefined();
    });
  });

  describe("getAll", () => {
    it("should return all entries", () => {
      dlq.enqueue({ originalTaskId: "task-1", originalTask: {}, error: "Error 1" });
      dlq.enqueue({ originalTaskId: "task-2", originalTask: {}, error: "Error 2" });

      const all = dlq.getAll();
      expect(all).toHaveLength(2);
    });
  });

  describe("query", () => {
    beforeEach(() => {
      dlq.enqueue({
        originalTaskId: "task-1",
        originalTask: {},
        error: "Network timeout",
        source: "timeout",
        retryCount: 1,
      });
      dlq.enqueue({
        originalTaskId: "task-2",
        originalTask: {},
        error: "Validation failed",
        source: "validation",
        retryCount: 3,
      });
      dlq.enqueue({
        originalTaskId: "task-3",
        originalTask: {},
        error: "System error",
        source: "system",
        retryCount: 2,
      });
    });

    it("should filter by status", () => {
      const results = dlq.query({ status: "pending" });
      expect(results).toHaveLength(3);
    });

    it("should filter by source", () => {
      const results = dlq.query({ source: "timeout" });
      expect(results).toHaveLength(1);
      expect(results[0].originalTaskId).toBe("task-1");
    });

    it("should filter by min retry count", () => {
      const results = dlq.query({ minRetryCount: 2 });
      expect(results).toHaveLength(2);
    });

    it("should filter by max retry count", () => {
      const results = dlq.query({ maxRetryCount: 1 });
      expect(results).toHaveLength(1);
    });

    it("should filter by error keyword", () => {
      const results = dlq.query({ errorContains: "timeout" });
      expect(results).toHaveLength(1);
      expect(results[0].originalTaskId).toBe("task-1");
    });

    it("should support pagination", () => {
      const page1 = dlq.query({ limit: 2 });
      const page2 = dlq.query({ offset: 2, limit: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
    });

    it("should support multiple status values", () => {
      dlq.review(dlq.getAll()[0].id, { status: "reviewed" });

      const results = dlq.query({ status: ["pending", "reviewed"] });
      expect(results).toHaveLength(3);
    });
  });

  describe("getPending", () => {
    it("should return pending entries", () => {
      dlq.enqueue({ originalTaskId: "task-1", originalTask: {}, error: "Error" });
      dlq.enqueue({ originalTaskId: "task-2", originalTask: {}, error: "Error" });

      const pending = dlq.getPending();
      expect(pending).toHaveLength(2);
    });

    it("should respect limit", () => {
      dlq.enqueue({ originalTaskId: "task-1", originalTask: {}, error: "Error" });
      dlq.enqueue({ originalTaskId: "task-2", originalTask: {}, error: "Error" });

      const pending = dlq.getPending(1);
      expect(pending).toHaveLength(1);
    });
  });

  describe("getStats", () => {
    it("should return queue statistics", () => {
      dlq.enqueue({
        originalTaskId: "task-1",
        originalTask: {},
        error: "Error",
        source: "timeout",
      });

      const stats = dlq.getStats();

      expect(stats.total).toBe(1);
      expect(stats.byStatus.pending).toBe(1);
      expect(stats.bySource.timeout).toBe(1);
      expect(stats.addedToday).toBe(1);
    });
  });

  describe("review", () => {
    it("should mark entry as reviewed", () => {
      const entry = dlq.enqueue({
        originalTaskId: "task-1",
        originalTask: {},
        error: "Error",
      });

      const reviewed = dlq.review(entry.id, {
        notes: "Investigated",
        reviewedBy: "admin",
      });

      expect(reviewed?.status).toBe("reviewed");
      expect(reviewed?.reviewNotes).toBe("Investigated");
      expect(reviewed?.reviewedBy).toBe("admin");
      expect(reviewed?.reviewedAt).toBeDefined();
    });

    it("should return null for non-existent entry", () => {
      expect(dlq.review("non-existent", {})).toBeNull();
    });
  });

  describe("markRetried", () => {
    it("should mark entry as retried", () => {
      const entry = dlq.enqueue({
        originalTaskId: "task-1",
        originalTask: {},
        error: "Error",
      });

      const retried = dlq.markRetried(entry.id, true);

      expect(retried?.status).toBe("retried");
    });
  });

  describe("discard", () => {
    it("should discard entry", () => {
      const entry = dlq.enqueue({
        originalTaskId: "task-1",
        originalTask: {},
        error: "Error",
      });

      const discarded = dlq.discard(entry.id, "No longer needed");

      expect(discarded?.status).toBe("discarded");
      expect(discarded?.reviewNotes).toBe("No longer needed");
    });

    it("should emit discarded event", () => {
      const handler = vi.fn();
      dlq.on("discarded", handler);

      const entry = dlq.enqueue({
        originalTaskId: "task-1",
        originalTask: {},
        error: "Error",
      });

      dlq.discard(entry.id);

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("archive", () => {
    it("should archive entry", () => {
      const entry = dlq.enqueue({
        originalTaskId: "task-1",
        originalTask: {},
        error: "Error",
      });

      const archived = dlq.archive(entry.id);

      expect(archived?.status).toBe("archived");
    });
  });

  describe("prepareRetry", () => {
    it("should return original task for retry", () => {
      const entry = dlq.enqueue({
        originalTaskId: "task-1",
        originalTask: { command: "test", data: "value" },
        error: "Error",
      });

      const task = dlq.prepareRetry(entry.id);

      expect(task).toEqual({ command: "test", data: "value" });
      expect(dlq.get(entry.id)?.retryCount).toBe(1);
    });

    it("should return null for discarded entry", () => {
      const entry = dlq.enqueue({
        originalTaskId: "task-1",
        originalTask: {},
        error: "Error",
      });

      dlq.discard(entry.id);
      const task = dlq.prepareRetry(entry.id);

      expect(task).toBeNull();
    });
  });

  describe("prepareBatchRetry", () => {
    it("should prepare multiple entries for retry", () => {
      const entry1 = dlq.enqueue({
        originalTaskId: "task-1",
        originalTask: { a: 1 },
        error: "Error",
      });
      const entry2 = dlq.enqueue({
        originalTaskId: "task-2",
        originalTask: { b: 2 },
        error: "Error",
      });

      const results = dlq.prepareBatchRetry([entry1.id, entry2.id]);

      expect(results).toHaveLength(2);
      expect(results[0].task).toEqual({ a: 1 });
      expect(results[1].task).toEqual({ b: 2 });
    });
  });

  describe("cleanup", () => {
    it("should remove expired entries", () => {
      const shortRetentionDLQ = new DeadLetterQueue({
        autoCleanup: false,
        retentionMs: 100, // 100ms
      });

      const entry = shortRetentionDLQ.enqueue({
        originalTaskId: "task-1",
        originalTask: {},
        error: "Error",
      });

      // 修改入队时间为很久以前
      const oldEntry = shortRetentionDLQ.get(entry.id);
      if (oldEntry) {
        oldEntry.enqueuedAt = new Date(Date.now() - 1000);
      }

      // 等待超过 retentionMs
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const cleaned = shortRetentionDLQ.cleanup();
          expect(cleaned).toBe(1);
          expect(shortRetentionDLQ.getAll()).toHaveLength(0);
          shortRetentionDLQ.destroy();
          resolve();
        }, 150);
      });
    });
  });

  describe("delete", () => {
    it("should delete entry", () => {
      const entry = dlq.enqueue({
        originalTaskId: "task-1",
        originalTask: {},
        error: "Error",
      });

      const result = dlq.delete(entry.id);

      expect(result).toBe(true);
      expect(dlq.get(entry.id)).toBeUndefined();
    });
  });

  describe("clear", () => {
    it("should clear all entries", () => {
      dlq.enqueue({ originalTaskId: "task-1", originalTask: {}, error: "Error" });
      dlq.enqueue({ originalTaskId: "task-2", originalTask: {}, error: "Error" });

      const count = dlq.clear();

      expect(count).toBe(2);
      expect(dlq.getAll()).toHaveLength(0);
    });
  });

  describe("capacity", () => {
    it("should evict oldest when capacity exceeded", () => {
      const smallDLQ = new DeadLetterQueue({
        autoCleanup: false,
        maxSize: 2,
      });

      smallDLQ.enqueue({ originalTaskId: "task-1", originalTask: {}, error: "Error" });
      smallDLQ.enqueue({ originalTaskId: "task-2", originalTask: {}, error: "Error" });
      smallDLQ.enqueue({ originalTaskId: "task-3", originalTask: {}, error: "Error" });

      expect(smallDLQ.getAll()).toHaveLength(2);
      // task-1 should be evicted
      expect(smallDLQ.getAll().find((e) => e.originalTaskId === "task-1")).toBeUndefined();

      smallDLQ.destroy();
    });
  });
});

describe("Convenience Functions", () => {
  describe("createDeadLetterQueue", () => {
    it("should create DLQ instance", () => {
      const dlq = createDeadLetterQueue({ maxSize: 100 });
      expect(dlq).toBeInstanceOf(DeadLetterQueue);
      dlq.destroy();
    });
  });

  describe("createDLQEntryFromError", () => {
    it("should create entry from error", () => {
      const error = new Error("Test error");
      error.name = "TestError";

      const entry = createDLQEntryFromError("task-1", { command: "test" }, error, 2);

      expect(entry.originalTaskId).toBe("task-1");
      expect(entry.error).toBe("Test error");
      expect(entry.errorCode).toBe("TestError");
      expect(entry.retryCount).toBe(2);
      expect(entry.stack).toBeDefined();
    });
  });

  describe("formatDLQEntry", () => {
    it("should format entry as string", () => {
      const entry: DLQEntry = {
        id: "dlq-123",
        originalTaskId: "task-1",
        originalTask: {},
        error: "Test error",
        errorCode: "TEST_001",
        status: "pending",
        source: "timeout",
        retryCount: 2,
        enqueuedAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-01T00:00:00Z"),
        metadata: {},
      };

      const formatted = formatDLQEntry(entry);

      expect(formatted).toContain("dlq-123");
      expect(formatted).toContain("task-1");
      expect(formatted).toContain("pending");
      expect(formatted).toContain("timeout");
      expect(formatted).toContain("Test error");
      expect(formatted).toContain("Retries: 2");
      expect(formatted).toContain("TEST_001");
    });

    it("should include review notes if present", () => {
      const entry: DLQEntry = {
        id: "dlq-123",
        originalTaskId: "task-1",
        originalTask: {},
        error: "Test error",
        status: "reviewed",
        source: "unknown",
        retryCount: 0,
        enqueuedAt: new Date(),
        updatedAt: new Date(),
        reviewNotes: "Investigated and fixed",
        metadata: {},
      };

      const formatted = formatDLQEntry(entry);

      expect(formatted).toContain("Investigated and fixed");
    });
  });
});

describe("Default Config", () => {
  it("should have sensible defaults", () => {
    expect(DEFAULT_DLQ_CONFIG.maxSize).toBe(10000);
    expect(DEFAULT_DLQ_CONFIG.retentionMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(DEFAULT_DLQ_CONFIG.autoCleanup).toBe(true);
    expect(DEFAULT_DLQ_CONFIG.cleanupIntervalMs).toBe(24 * 60 * 60 * 1000);
  });
});
