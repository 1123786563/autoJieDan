/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  IdempotencyStore,
  IdempotencyHandler,
  generateIdempotencyKey,
  isValidIdempotencyKey,
  generateTimeWindowKey,
} from "../../interagent/idempotency.js";

describe("IdempotencyStore", () => {
  let store: IdempotencyStore;

  beforeEach(() => {
    store = new IdempotencyStore({
      defaultTTL: 60,
      cleanupInterval: 10,
    });
    store.start();
  });

  afterEach(() => {
    store.stop();
  });

  describe("Basic Operations", () => {
    it("should set and get a record", () => {
      store.set("test-key", "task-123");

      const record = store.get("test-key");

      expect(record).toBeDefined();
      expect(record?.key).toBe("test-key");
      expect(record?.taskId).toBe("task-123");
      expect(record?.status).toBe("pending");
    });

    it("should return undefined for non-existent key", () => {
      const record = store.get("non-existent");
      expect(record).toBeUndefined();
    });

    it("should check if key exists", () => {
      store.set("existing-key", "task-123");

      expect(store.has("existing-key")).toBe(true);
      expect(store.has("non-existent")).toBe(false);
    });

    it("should delete a record", () => {
      store.set("to-delete", "task-123");
      expect(store.has("to-delete")).toBe(true);

      store.delete("to-delete");
      expect(store.has("to-delete")).toBe(false);
    });
  });

  describe("TTL and Expiration", () => {
    it("should set expiration time based on TTL", () => {
      const now = new Date();
      store.set("ttl-key", "task-123", 30);

      const record = store.get("ttl-key");
      expect(record?.expiresAt.getTime()).toBeGreaterThan(now.getTime());
    });

    it("should not return expired records", async () => {
      const shortStore = new IdempotencyStore({ defaultTTL: 0.01 });
      shortStore.start();

      shortStore.set("expire-quick", "task-123", 0.01);

      await new Promise((r) => setTimeout(r, 20));

      const record = shortStore.get("expire-quick");
      expect(record).toBeUndefined();

      shortStore.stop();
    });
  });

  describe("Status Updates", () => {
    it("should update record status", () => {
      store.set("status-key", "task-123");
      const updated = store.updateStatus("status-key", "processing");

      expect(updated?.status).toBe("processing");
    });

    it("should store response with completed status", () => {
      store.set("response-key", "task-123");
      const response = { result: "success" };
      store.updateStatus("response-key", "completed", response);

      const record = store.get("response-key");
      expect(record?.response).toEqual(response);
    });
  });

  describe("Get or Create", () => {
    it("should create new record if not exists", () => {
      const { record, created } = store.getOrCreate("new-key", "task-123");

      expect(created).toBe(true);
      expect(record.taskId).toBe("task-123");
    });

    it("should return existing record if exists", () => {
      store.set("existing-key", "task-456");

      const { record, created } = store.getOrCreate("existing-key", "task-789");

      expect(created).toBe(false);
      expect(record.taskId).toBe("task-456");
    });
  });

  describe("Statistics", () => {
    it("should return correct stats", () => {
      store.set("task-1", "task-1");
      store.set("task-2", "task-2");
      store.updateStatus("task-1", "processing");
      store.updateStatus("task-2", "completed");

      const stats = store.getStats();

      expect(stats.total).toBe(2);
      expect(stats.processing).toBe(1);
      expect(stats.completed).toBe(1);
    });
  });
});

describe("IdempotencyHandler", () => {
  let store: IdempotencyStore;
  let handler: IdempotencyHandler;

  beforeEach(() => {
    store = new IdempotencyStore({ defaultTTL: 60 });
    store.start();
    handler = new IdempotencyHandler(store);
  });

  afterEach(() => {
    store.stop();
  });

  describe("Execute", () => {
    it("should execute operation and cache result", async () => {
      const operation = vi.fn().mockResolvedValue({ data: "result" });

      const { result, cached } = await handler.execute(
        "exec-key",
        "task-123",
        operation
      );

      expect(result).toEqual({ data: "result" });
      expect(cached).toBe(false);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should return cached result on second call", async () => {
      const operation = vi.fn().mockResolvedValue({ data: "result" });

      await handler.execute("cache-key", "task-123", operation);
      const { result, cached } = await handler.execute(
        "cache-key",
        "task-123",
        operation
      );

      expect(cached).toBe(true);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should call onDuplicate callback for existing records", async () => {
      const onDuplicate = vi.fn();
      const operation = vi.fn().mockResolvedValue({ data: "result" });

      await handler.execute("dup-key", "task-123", operation);
      await handler.execute("dup-key", "task-123", operation, { onDuplicate });

      expect(onDuplicate).toHaveBeenCalled();
    });

    it("should throw if operation is processing", async () => {
      store.set("processing-key", "task-123");
      store.updateStatus("processing-key", "processing");

      const operation = vi.fn().mockResolvedValue({});

      await expect(
        handler.execute("processing-key", "task-123", operation)
      ).rejects.toThrow("already being processed");
    });

    it("should mark as failed on operation error", async () => {
      const operation = vi.fn().mockRejectedValue(new Error("Operation failed"));

      await expect(
        handler.execute("fail-key", "task-123", operation)
      ).rejects.toThrow("Operation failed");

      const record = store.get("fail-key");
      expect(record?.status).toBe("failed");
    });
  });

  describe("Check and Lock", () => {
    it("should lock if key does not exist", () => {
      const { locked, existing } = handler.checkAndLock("lock-key", "task-123");

      expect(locked).toBe(true);
      expect(existing).toBeUndefined();

      const record = store.get("lock-key");
      expect(record?.status).toBe("processing");
    });

    it("should not lock if key exists", () => {
      store.set("locked-key", "task-456");

      const { locked, existing } = handler.checkAndLock("locked-key", "task-789");

      expect(locked).toBe(false);
      expect(existing?.taskId).toBe("task-456");
    });
  });

  describe("Unlock", () => {
    it("should unlock and set result", () => {
      store.set("unlock-key", "task-123");

      const result = handler.unlock("unlock-key", { data: "done" });

      expect(result).toBe(true);

      const record = store.get("unlock-key");
      expect(record?.status).toBe("completed");
      expect(record?.response).toEqual({ data: "done" });
    });
  });
});

describe("Key Generation", () => {
  describe("generateIdempotencyKey", () => {
    it("should generate consistent keys for same input", () => {
      const options = {
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        taskType: "execution",
        input: { command: "test" },
      };

      const key1 = generateIdempotencyKey(options);
      const key2 = generateIdempotencyKey(options);

      expect(key1).toBe(key2);
    });

    it("should generate different keys for different input", () => {
      const key1 = generateIdempotencyKey({
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        taskType: "execution",
        input: { command: "test1" },
      });

      const key2 = generateIdempotencyKey({
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        taskType: "execution",
        input: { command: "test2" },
      });

      expect(key1).not.toBe(key2);
    });

    it("should include salt in key generation", () => {
      const key1 = generateIdempotencyKey({
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        taskType: "execution",
        input: { command: "test" },
        salt: "salt1",
      });

      const key2 = generateIdempotencyKey({
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        taskType: "execution",
        input: { command: "test" },
        salt: "salt2",
      });

      expect(key1).not.toBe(key2);
    });
  });

  describe("isValidIdempotencyKey", () => {
    it("should validate correct key format", () => {
      const key = generateIdempotencyKey({
        sourceDid: "did:anp:source",
        targetDid: "did:anp:target",
        taskType: "execution",
        input: {},
      });

      expect(isValidIdempotencyKey(key)).toBe(true);
    });

    it("should reject invalid keys", () => {
      expect(isValidIdempotencyKey("invalid")).toBe(false);
      expect(isValidIdempotencyKey("idemp:short")).toBe(false);
    });
  });

  describe("generateTimeWindowKey", () => {
    it("should generate same key within time window", () => {
      const baseKey = "test-operation";
      const key1 = generateTimeWindowKey(baseKey, 60);
      const key2 = generateTimeWindowKey(baseKey, 60);

      expect(key1).toBe(key2);
      expect(key1).toContain(baseKey);
    });

    it("should generate different keys across time windows", async () => {
      const baseKey = "time-test";
      const key1 = generateTimeWindowKey(baseKey, 0.01);

      await new Promise((r) => setTimeout(r, 15));

      const key2 = generateTimeWindowKey(baseKey, 0.01);

      expect(key1).not.toBe(key2);
    });
  });
});
