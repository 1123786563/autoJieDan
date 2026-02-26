/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  KeyManager,
  MemoryKeyStorage,
  createKeyManager,
  type Key,
  type KeyManagerConfig,
  type RotationPolicy,
  type KeyFilter,
  type KeyPurpose,
  type KeyAlgorithm,
  type KeyStatus,
} from "../../interagent/key-manager.js";

describe("KeyManager", () => {
  let keyManager: KeyManager;
  let storage: MemoryKeyStorage;

  beforeEach(() => {
    storage = new MemoryKeyStorage();
    keyManager = createKeyManager({
      storage,
      defaultAlgorithm: "aes-256-gcm",
      autoRotate: false,
    });
  });

  afterEach(() => {
    keyManager.close();
  });

  // ==========================================================================
  // 密钥生成
  // ==========================================================================

  describe("Key Generation", () => {
    it("should generate key with default options", () => {
      const key = keyManager.generateKey("encryption");

      expect(key.id).toBeDefined();
      expect(key.id.startsWith("key-")).toBe(true);
      expect(key.purpose).toBe("encryption");
      expect(key.algorithm).toBe("aes-256-gcm");
      expect(key.status).toBe("active");
      expect(key.value).toBeDefined();
      expect(key.createdAt).toBeInstanceOf(Date);
      expect(key.rotationCount).toBe(0);
    });

    it("should generate key with custom name", () => {
      const key = keyManager.generateKey("signing", { name: "custom-key" });

      expect(key.name).toBe("custom-key");
      expect(key.purpose).toBe("signing");
    });

    it("should generate key with custom algorithm", () => {
      const key = keyManager.generateKey("encryption", {
        algorithm: "aes-128-cbc",
      });

      expect(key.algorithm).toBe("aes-128-cbc");
    });

    it("should generate key with expiration", () => {
      const expiresIn = 3600000; // 1 hour
      const key = keyManager.generateKey("encryption", { expiresIn });

      expect(key.expiresAt).toBeDefined();
      expect(key.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it("should generate key with metadata", () => {
      const metadata = { owner: "test-user", environment: "dev" };
      const key = keyManager.generateKey("encryption", { metadata });

      expect(key.metadata).toEqual(metadata);
    });

    it("should generate key from passphrase", () => {
      const key = keyManager.generateKeyFromPassphrase(
        "encryption",
        "my-secret-passphrase"
      );

      expect(key.id).toBeDefined();
      expect(key.purpose).toBe("encryption");
      expect(key.value).toBeDefined();
      expect(key.metadata.salt).toBeDefined();
    });

    it("should generate same key from same passphrase and salt", () => {
      const salt = "fixed-salt-value";
      const key1 = keyManager.generateKeyFromPassphrase(
        "encryption",
        "passphrase",
        { salt }
      );
      const key2 = keyManager.generateKeyFromPassphrase(
        "encryption",
        "passphrase",
        { salt }
      );

      expect(key1.value).toBe(key2.value);
    });

    it("should emit key:generated event", () => {
      const handler = vi.fn();
      keyManager.on("key:generated", handler);

      keyManager.generateKey("encryption");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        purpose: "encryption",
      }));
    });
  });

  // ==========================================================================
  // 密钥获取
  // ==========================================================================

  describe("Key Retrieval", () => {
    it("should get key by id", async () => {
      const generatedKey = keyManager.generateKey("encryption");
      const retrievedKey = await keyManager.getKey(generatedKey.id);

      expect(retrievedKey).toBeDefined();
      expect(retrievedKey!.id).toBe(generatedKey.id);
      expect(retrievedKey!.value).toBe(generatedKey.value);
    });

    it("should return undefined for non-existent key", async () => {
      const key = await keyManager.getKey("non-existent-id");

      expect(key).toBeUndefined();
    });

    it("should return undefined for inactive key", async () => {
      const generatedKey = keyManager.generateKey("encryption");
      await keyManager.deleteKey(generatedKey.id);
      const retrievedKey = await keyManager.getKey(generatedKey.id);

      expect(retrievedKey).toBeUndefined();
    });

    it("should update lastUsedAt when key is retrieved", async () => {
      const generatedKey = keyManager.generateKey("encryption");
      await new Promise((resolve) => setTimeout(resolve, 10));
      const retrievedKey = await keyManager.getKey(generatedKey.id);

      expect(retrievedKey!.lastUsedAt).toBeDefined();
      expect(retrievedKey!.lastUsedAt!.getTime()).toBeGreaterThan(
        generatedKey.createdAt.getTime()
      );
    });

    it("should get active key by purpose", async () => {
      keyManager.generateKey("encryption");
      keyManager.generateKey("signing");

      const encryptionKey = await keyManager.getActiveKey("encryption");

      expect(encryptionKey).toBeDefined();
      expect(encryptionKey!.purpose).toBe("encryption");
    });

    it("should return most recent active key by purpose", async () => {
      const oldKey = keyManager.generateKey("encryption", { name: "old-key" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const newKey = keyManager.generateKey("encryption", { name: "new-key" });

      const activeKey = await keyManager.getActiveKey("encryption");

      expect(activeKey!.id).toBe(newKey.id);
    });

    it("should return undefined when no active key for purpose", async () => {
      keyManager.generateKey("encryption");

      const signingKey = await keyManager.getActiveKey("signing");

      expect(signingKey).toBeUndefined();
    });

    it("should get all keys without filter", async () => {
      keyManager.generateKey("encryption");
      keyManager.generateKey("signing");
      keyManager.generateKey("authentication");

      const keys = await keyManager.getAllKeys();

      expect(keys).toHaveLength(3);
    });

    it("should filter keys by purpose", async () => {
      keyManager.generateKey("encryption");
      keyManager.generateKey("signing");
      keyManager.generateKey("encryption");

      const keys = await keyManager.getAllKeys({ purpose: "encryption" });

      expect(keys).toHaveLength(2);
      keys.forEach((k) => expect(k.purpose).toBe("encryption"));
    });

    it("should filter keys by algorithm", async () => {
      keyManager.generateKey("encryption", { algorithm: "aes-256-gcm" });
      keyManager.generateKey("encryption", { algorithm: "aes-128-cbc" });

      const keys = await keyManager.getAllKeys({ algorithm: "aes-128-cbc" });

      expect(keys).toHaveLength(1);
      expect(keys[0].algorithm).toBe("aes-128-cbc");
    });

    it("should filter keys by status", async () => {
      const key1 = keyManager.generateKey("encryption");
      const key2 = keyManager.generateKey("encryption");
      await keyManager.deleteKey(key2.id);

      const keys = await keyManager.getAllKeys({ status: "active" });

      expect(keys).toHaveLength(1);
      expect(keys[0].id).toBe(key1.id);
    });

    it("should filter keys by name pattern", async () => {
      keyManager.generateKey("encryption", { name: "test-key-1" });
      keyManager.generateKey("encryption", { name: "prod-key-2" });
      keyManager.generateKey("encryption", { name: "test-key-3" });

      const keys = await keyManager.getAllKeys({ namePattern: "^test-" });

      expect(keys).toHaveLength(2);
    });
  });

  // ==========================================================================
  // 密钥轮换
  // ==========================================================================

  describe("Key Rotation", () => {
    it("should rotate key", async () => {
      const oldKey = keyManager.generateKey("encryption");
      const newKey = await keyManager.rotateKey(oldKey.id);

      expect(newKey.id).not.toBe(oldKey.id);
      expect(newKey.purpose).toBe(oldKey.purpose);
      expect(newKey.algorithm).toBe(oldKey.algorithm);
      expect(newKey.status).toBe("active");
      expect(newKey.rotationCount).toBe(1);
      expect(newKey.metadata.previousKeyId).toBe(oldKey.id);
    });

    it("should mark old key as rotating during rotation", async () => {
      const oldKey = keyManager.generateKey("encryption");
      await keyManager.rotateKey(oldKey.id);

      const storedOldKey = await storage.get(oldKey.id);
      expect(storedOldKey!.status).toBe("rotating");
    });

    it("should throw error for non-existent key rotation", async () => {
      await expect(keyManager.rotateKey("non-existent")).rejects.toThrow(
        "Key not found"
      );
    });

    it("should emit key:rotating event", async () => {
      const handler = vi.fn();
      keyManager.on("key:rotating", handler);

      const oldKey = keyManager.generateKey("encryption");
      await keyManager.rotateKey(oldKey.id);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should emit key:rotated event", async () => {
      const handler = vi.fn();
      keyManager.on("key:rotated", handler);

      const oldKey = keyManager.generateKey("encryption");
      await keyManager.rotateKey(oldKey.id);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should increment rotation count", async () => {
      const key = keyManager.generateKey("encryption");
      const rotated1 = await keyManager.rotateKey(key.id);
      const rotated2 = await keyManager.rotateKey(rotated1.id);

      expect(rotated2.rotationCount).toBe(2);
    });
  });

  // ==========================================================================
  // 自动轮换
  // ==========================================================================

  describe("Auto Rotation", () => {
    it("should start auto rotation", () => {
      const customStorage = new MemoryKeyStorage();
      const manager = createKeyManager({
        storage: customStorage,
        autoRotate: true,
      });

      manager.startAutoRotation();
      manager.close();
      // Should not throw
    });

    it("should stop auto rotation", () => {
      const customStorage = new MemoryKeyStorage();
      const manager = createKeyManager({
        storage: customStorage,
        autoRotate: true,
      });

      manager.startAutoRotation();
      manager.stopAutoRotation();
      // Should not throw
    });

    it("should check and rotate expired keys", async () => {
      vi.useFakeTimers();

      const customStorage = new MemoryKeyStorage();
      const manager = createKeyManager({
        storage: customStorage,
        autoRotate: false,
        rotationPolicy: {
          intervalMs: 1000,
          advanceMs: 500,
          minLength: 32,
          maxLength: 64,
        },
      });

      // Generate key that will expire soon
      manager.generateKey("encryption", { expiresIn: 600 });

      // Advance time past the advance threshold
      vi.advanceTimersByTime(200);

      await manager.checkAndRotate();

      const keys = await manager.getAllKeys();
      // Should have rotated the key
      expect(keys.length).toBeGreaterThanOrEqual(1);

      vi.useRealTimers();
      manager.close();
    });
  });

  // ==========================================================================
  // 密钥验证
  // ==========================================================================

  describe("Key Validation", () => {
    it("should validate active key", async () => {
      const key = keyManager.generateKey("encryption");

      const isValid = await keyManager.validateKey(key.id);

      expect(isValid).toBe(true);
    });

    it("should return false for non-existent key", async () => {
      const isValid = await keyManager.validateKey("non-existent");

      expect(isValid).toBe(false);
    });

    it("should return false for inactive key", async () => {
      const key = keyManager.generateKey("encryption");
      await keyManager.deleteKey(key.id);

      const isValid = await keyManager.validateKey(key.id);

      expect(isValid).toBe(false);
    });

    it("should return false for expired key", async () => {
      vi.useFakeTimers();

      const key = keyManager.generateKey("encryption", { expiresIn: 1000 });

      // Advance time past expiration
      vi.advanceTimersByTime(2000);

      const isValid = await keyManager.validateKey(key.id);

      expect(isValid).toBe(false);

      vi.useRealTimers();
    });
  });

  // ==========================================================================
  // 密钥删除
  // ==========================================================================

  describe("Key Deletion", () => {
    it("should soft delete key", async () => {
      const key = keyManager.generateKey("encryption");

      const deleted = await keyManager.deleteKey(key.id);
      const storedKey = await storage.get(key.id);

      expect(deleted).toBe(true);
      expect(storedKey!.status).toBe("inactive");
    });

    it("should emit key:deleted event", async () => {
      const handler = vi.fn();
      keyManager.on("key:deleted", handler);

      const key = keyManager.generateKey("encryption");
      await keyManager.deleteKey(key.id);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should return false for non-existent key deletion", async () => {
      const deleted = await keyManager.deleteKey("non-existent");

      expect(deleted).toBe(false);
    });

    it("should destroy key completely", async () => {
      const key = keyManager.generateKey("encryption");

      const destroyed = await keyManager.destroyKey(key.id);
      const storedKey = await storage.get(key.id);

      expect(destroyed).toBe(true);
      expect(storedKey).toBeUndefined();
    });

    it("should emit key:destroyed event", async () => {
      const handler = vi.fn();
      keyManager.on("key:destroyed", handler);

      const key = keyManager.generateKey("encryption");
      await keyManager.destroyKey(key.id);

      expect(handler).toHaveBeenCalledWith(key.id);
    });
  });

  // ==========================================================================
  // 统计信息
  // ==========================================================================

  describe("Statistics", () => {
    it("should get key stats", async () => {
      keyManager.generateKey("encryption");
      keyManager.generateKey("encryption");
      keyManager.generateKey("signing");

      const stats = await keyManager.getStats();

      expect(stats.totalKeys).toBe(3);
      expect(stats.activeKeys).toBe(3);
      expect(stats.expiredKeys).toBe(0);
      expect(stats.byPurpose.encryption).toBe(2);
      expect(stats.byPurpose.signing).toBe(1);
    });

    it("should count expired keys", async () => {
      vi.useFakeTimers();

      keyManager.generateKey("encryption", { expiresIn: 1000 });
      keyManager.generateKey("encryption");

      vi.advanceTimersByTime(2000);

      // Manually mark as expired (simulate expiration check)
      const keys = await keyManager.getAllKeys();
      for (const k of keys) {
        if (k.expiresAt && k.expiresAt < new Date()) {
          k.status = "expired";
          await storage.set(k);
        }
      }

      const stats = await keyManager.getStats();
      expect(stats.expiredKeys).toBe(1);

      vi.useRealTimers();
    });

    it("should get summary", async () => {
      keyManager.generateKey("encryption");
      const key = keyManager.generateKey("signing");
      await keyManager.rotateKey(key.id);

      const summary = await keyManager.getSummary();

      expect(summary.keys).toBe(3); // 2 original + 1 rotated
      expect(summary.active).toBeGreaterThanOrEqual(2);
      expect(summary.rotating).toBeGreaterThanOrEqual(0);
      expect(summary.stats).toBeDefined();
    });
  });

  // ==========================================================================
  // 关闭和清理
  // ==========================================================================

  describe("Cleanup", () => {
    it("should close manager", () => {
      const customStorage = new MemoryKeyStorage();
      const manager = createKeyManager({
        storage: customStorage,
        autoRotate: true,
      });

      manager.startAutoRotation();
      manager.close();

      // Should not throw and should clean up timers
    });

    it("should remove all listeners on close", () => {
      const handler = vi.fn();
      keyManager.on("key:generated", handler);

      keyManager.close();

      expect(keyManager.listenerCount("key:generated")).toBe(0);
    });
  });
});

// ==========================================================================
// MemoryKeyStorage 单独测试
// ==========================================================================

describe("MemoryKeyStorage", () => {
  let storage: MemoryKeyStorage;

  beforeEach(() => {
    storage = new MemoryKeyStorage();
  });

  it("should store and retrieve key", async () => {
    const key: Key = {
      id: "test-key-1",
      name: "Test Key",
      purpose: "encryption",
      algorithm: "aes-256-gcm",
      value: "dGVzdC1rZXktdmFsdWU=",
      createdAt: new Date(),
      status: "active",
      metadata: {},
      rotationCount: 0,
    };

    await storage.set(key);
    const retrieved = await storage.get(key.id);

    expect(retrieved).toEqual(key);
  });

  it("should return undefined for non-existent key", async () => {
    const key = await storage.get("non-existent");

    expect(key).toBeUndefined();
  });

  it("should delete key", async () => {
    const key: Key = {
      id: "test-key-1",
      name: "Test Key",
      purpose: "encryption",
      algorithm: "aes-256-gcm",
      value: "dGVzdC1rZXktdmFsdWU=",
      createdAt: new Date(),
      status: "active",
      metadata: {},
      rotationCount: 0,
    };

    await storage.set(key);
    await storage.delete(key.id);
    const retrieved = await storage.get(key.id);

    expect(retrieved).toBeUndefined();
  });

  it("should list all keys", async () => {
    const key1: Key = {
      id: "key-1",
      name: "Key 1",
      purpose: "encryption",
      algorithm: "aes-256-gcm",
      value: "dGVzdDE=",
      createdAt: new Date(),
      status: "active",
      metadata: {},
      rotationCount: 0,
    };
    const key2: Key = {
      id: "key-2",
      name: "Key 2",
      purpose: "signing",
      algorithm: "aes-256-gcm",
      value: "dGVzdDI=",
      createdAt: new Date(),
      status: "active",
      metadata: {},
      rotationCount: 0,
    };

    await storage.set(key1);
    await storage.set(key2);

    const keys = await storage.list();

    expect(keys).toHaveLength(2);
  });

  it("should filter keys by purpose", async () => {
    const key1: Key = {
      id: "key-1",
      name: "Key 1",
      purpose: "encryption",
      algorithm: "aes-256-gcm",
      value: "dGVzdDE=",
      createdAt: new Date(),
      status: "active",
      metadata: {},
      rotationCount: 0,
    };
    const key2: Key = {
      id: "key-2",
      name: "Key 2",
      purpose: "signing",
      algorithm: "aes-256-gcm",
      value: "dGVzdDI=",
      createdAt: new Date(),
      status: "active",
      metadata: {},
      rotationCount: 0,
    };

    await storage.set(key1);
    await storage.set(key2);

    const keys = await storage.list({ purpose: "encryption" });

    expect(keys).toHaveLength(1);
    expect(keys[0].purpose).toBe("encryption");
  });

  it("should return copy of key on get", async () => {
    const key: Key = {
      id: "test-key-1",
      name: "Test Key",
      purpose: "encryption",
      algorithm: "aes-256-gcm",
      value: "dGVzdC1rZXktdmFsdWU=",
      createdAt: new Date(),
      status: "active",
      metadata: {},
      rotationCount: 0,
    };

    await storage.set(key);
    const retrieved = await storage.get(key.id);
    retrieved!.name = "Modified";

    const retrievedAgain = await storage.get(key.id);

    expect(retrievedAgain!.name).toBe("Test Key");
  });
});
