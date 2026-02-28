/**
 * 测试密钥轮换机制
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, readFileSync, mkdirSync, rmdirSync } from "fs";
import { join } from "path";
import * as os from "os";

import {
  KeyMetadata,
  KeyRotationConfig,
  DEFAULT_KEY_ROTATION_CONFIG,
  shouldRotateKey,
  rotateKey,
  getAllKeysForDid,
  isKeyValidForSignature,
  initializeKeyRotation,
  getKeyMetadata,
  generateKeyPair,
  importPrivateKey,
  getKeyStorePath,
  saveKeyHistory,
  loadKeyHistory,
  getKeyHistoryPath,
  keyHistory,
} from "../../src/anp/did.js";

// ============================================================================
// Fixtures
// ============================================================================

let tempDir: string;
let originalGetKeyStorePath: typeof getKeyStorePath;

function setupTempKeyStore() {
  tempDir = join(os.tmpdir(), `automaton-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  // 保存并替换密钥存储路径
  originalGetKeyStorePath = getKeyStorePath;

  Object.defineProperty(global, "getKeyStorePath", {
    value: () => tempDir,
    writable: true,
  });

  // 清空密钥历史
  keyHistory.clear();
}

function teardownTempKeyStore() {
  // 恢复原函数
  Object.defineProperty(global, "getKeyStorePath", {
    value: originalGetKeyStorePath,
    writable: true,
  });

  // 清理临时目录
  try {
    const files = require("fs").readdirSync(tempDir);
    for (const file of files) {
      require("fs").unlinkSync(join(tempDir, file));
    }
    require("fs").rmdirSync(tempDir);
  } catch (error) {
    // 忽略清理错误
  }

  // 清空密钥历史
  keyHistory.clear();
}

// ============================================================================
// KeyRotationConfig Tests
// ============================================================================

describe("KeyRotationConfig", () => {
  it("should have default values", () => {
    const config: KeyRotationConfig = DEFAULT_KEY_ROTATION_CONFIG;

    expect(config.rotationIntervalDays).toBe(30);
    expect(config.keyLifetimeDays).toBe(90);
    expect(config.gracePeriodDays).toBe(7);
    expect(config.maxHistoryKeys).toBe(5);
  });
});

// ============================================================================
// 密钥轮换功能测试
// ============================================================================

describe("KeyRotation", () => {
  beforeEach(setupTempKeyStore);
  afterEach(teardownTempKeyStore);

  describe("shouldRotateKey", () => {
    it("should return false when no metadata exists", () => {
      const result = shouldRotateKey("did:anp:unknown");
      expect(result).toBe(false);
    });

    it("should return true for old keys (30+ days)", () => {
      const now = new Date();
      const metadata: KeyMetadata = {
        keyId: "did:anp:test#key-1",
        did: "did:anp:test",
        createdAt: new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(now.getTime() + 55 * 24 * 60 * 60 * 1000),
        isCurrent: true,
        privateKeyPath: join(tempDir, "test.pem"),
      };

      keyHistory.set("did:anp:test", [metadata]);

      const result = shouldRotateKey("did:anp:test");
      expect(result).toBe(true);
    });

    it("should return false for new keys (< 30 days)", () => {
      const now = new Date();
      const metadata: KeyMetadata = {
        keyId: "did:anp:test#key-1",
        did: "did:anp:test",
        createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(now.getTime() + 80 * 24 * 60 * 60 * 1000),
        isCurrent: true,
        privateKeyPath: join(tempDir, "test.pem"),
      };

      keyHistory.set("did:anp:test", [metadata]);

      const result = shouldRotateKey("did:anp:test");
      expect(result).toBe(false);
    });
  });

  describe("getAllKeysForDid", () => {
    it("should return empty array for unknown DID", () => {
      const keys = getAllKeysForDid("did:anp:unknown");
      expect(keys).toEqual([]);
    });

    it("should return all keys for DID", () => {
      const now = new Date();
      const keys: KeyMetadata[] = [
        {
          keyId: "did:anp:test#key-1",
          did: "did:anp:test",
          createdAt: now,
          expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
          isCurrent: true,
          privateKeyPath: join(tempDir, "key1.pem"),
        },
        {
          keyId: "did:anp:test#key-2",
          did: "did:anp:test",
          createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(now.getTime() + 80 * 24 * 60 * 60 * 1000),
          isCurrent: false,
          privateKeyPath: join(tempDir, "key2.pem"),
        },
      ];

      keyHistory.set("did:anp:test", keys);

      const result = getAllKeysForDid("did:anp:test");
      expect(result).toHaveLength(2);
    });
  });

  describe("isKeyValidForSignature", () => {
    it("should return true for current key", () => {
      const now = new Date();
      const metadata: KeyMetadata = {
        keyId: "did:anp:test#key-1",
        did: "did:anp:test",
        createdAt: now,
        expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
        isCurrent: true,
        privateKeyPath: join(tempDir, "key1.pem"),
      };

      keyHistory.set("did:anp:test", [metadata]);

      const result = isKeyValidForSignature("did:anp:test", metadata.keyId);
      expect(result).toBe(true);
    });

    it("should return true for old key within grace period", () => {
      const now = new Date();
      const metadata: KeyMetadata = {
        keyId: "did:anp:test#key-1",
        did: "did:anp:test",
        createdAt: new Date(now.getTime() - 32 * 24 * 60 * 60 * 1000), // 32天前
        expiresAt: new Date(now.getTime() + 58 * 24 * 60 * 60 * 1000),
        isCurrent: false,
        privateKeyPath: join(tempDir, "key1.pem"),
      };

      keyHistory.set("did:anp:test", [metadata]);

      // 32天前创建，宽限期是 30+7=37天，所以仍在宽限期内
      const result = isKeyValidForSignature("did:anp:test", metadata.keyId);
      expect(result).toBe(true);
    });

    it("should return false for old key outside grace period", () => {
      const now = new Date();
      const metadata: KeyMetadata = {
        keyId: "did:anp:test#key-1",
        did: "did:anp:test",
        createdAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000), // 40天前
        expiresAt: new Date(now.getTime() + 50 * 24 * 60 * 60 * 1000),
        isCurrent: false,
        privateKeyPath: join(tempDir, "key1.pem"),
      };

      keyHistory.set("did:anp:test", [metadata]);

      // 40天前创建，宽限期是 30+7=37天，所以已超出宽限期
      const result = isKeyValidForSignature("did:anp:test", metadata.keyId);
      expect(result).toBe(false);
    });

    it("should return false for unknown key", () => {
      const result = isKeyValidForSignature("did:anp:test", "did:anp:test#unknown");
      expect(result).toBe(false);
    });
  });

  describe("saveKeyHistory and loadKeyHistory", () => {
    it("should save and load key history", () => {
      const now = new Date();
      const keys: KeyMetadata[] = [
        {
          keyId: "did:anp:test#key-1",
          did: "did:anp:test",
          createdAt: now,
          expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
          isCurrent: true,
          privateKeyPath: join(tempDir, "key1.pem"),
        },
      ];

      keyHistory.set("did:anp:test", keys);

      // 保存
      saveKeyHistory();

      // 清空
      keyHistory.clear();

      // 加载
      loadKeyHistory();

      // 验证
      const loaded = keyHistory.get("did:anp:test");
      expect(loaded).toHaveLength(1);
      expect(loaded![0].keyId).toBe("did:anp:test#key-1");
    });
  });
});

// ============================================================================
// 验收标准测试
// ============================================================================

describe("AcceptanceCriteria", () => {
  beforeEach(setupTempKeyStore);
  afterEach(teardownTempKeyStore);

  describe("30-day automatic rotation", () => {
    it("should have 30-day rotation interval", () => {
      expect(DEFAULT_KEY_ROTATION_CONFIG.rotationIntervalDays).toBe(30);
    });

    it("should not rotate before 30 days", () => {
      const now = new Date();
      const metadata: KeyMetadata = {
        keyId: "did:anp:test#key-1",
        did: "did:anp:test",
        createdAt: new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(now.getTime() + 61 * 24 * 60 * 60 * 1000),
        isCurrent: true,
        privateKeyPath: join(tempDir, "key1.pem"),
      };

      keyHistory.set("did:anp:test", [metadata]);

      expect(shouldRotateKey("did:anp:test")).toBe(false);
    });

    it("should rotate at 30 days", () => {
      const now = new Date();
      const metadata: KeyMetadata = {
        keyId: "did:anp:test#key-1",
        did: "did:anp:test",
        createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
        isCurrent: true,
        privateKeyPath: join(tempDir, "key1.pem"),
      };

      keyHistory.set("did:anp:test", [metadata]);

      expect(shouldRotateKey("did:anp:test")).toBe(true);
    });

    it("should have 90-day key lifetime", () => {
      expect(DEFAULT_KEY_ROTATION_CONFIG.keyLifetimeDays).toBe(90);
    });

    it("should have 7-day grace period", () => {
      expect(DEFAULT_KEY_ROTATION_CONFIG.gracePeriodDays).toBe(7);
    });
  });
});
