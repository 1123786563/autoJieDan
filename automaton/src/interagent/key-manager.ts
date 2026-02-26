/**
 * 密钥管理与轮换
 * 提供密钥存储、轮换和过期处理
 *
 * @module interagent/key-manager
 * @version 1.0.0
 */

import { EventEmitter } from "events";
import crypto from "crypto";

// ============================================================================
// 类型定义
// ============================================================================

/** 密钥状态 */
export type KeyStatus = "active" | "expired" | "rotating" | "inactive";

/** 密钥算法 */
export type KeyAlgorithm = "aes-256-gcm" | "aes-128-cbc" | "chacha20-poly1305";

/** 密钥用途 */
export type KeyPurpose = "encryption" | "signing" | "authentication";

/** 密钥 */
export interface Key {
  /** 密钥 ID */
  id: string;
  /** 密钥名称 */
  name: string;
  /** 密钥用途 */
  purpose: KeyPurpose;
  /** 算法 */
  algorithm: KeyAlgorithm;
  /** 密钥值 (Base64) */
  value: string;
  /** 创建时间 */
  createdAt: Date;
  /** 过期时间 */
  expiresAt?: Date;
  /** 最后使用时间 */
  lastUsedAt?: Date;
  /** 状态 */
  status: KeyStatus;
  /** 元数据 */
  metadata: Record<string, unknown>;
  /** 轮换次数 */
  rotationCount: number;
}

/** 轮换策略 */
export interface RotationPolicy {
  /** 轮换间隔 (毫秒) */
  intervalMs: number;
  /** 提前轮换时间 (毫秒) */
  advanceMs: number;
  /** 最小密钥长度 */
  minLength: number;
  /** 最大密钥长度 */
  maxLength: number;
}

/** 密钥管理器配置 */
export interface KeyManagerConfig {
  /** 默认密钥算法 */
  defaultAlgorithm: KeyAlgorithm;
  /** 默认轮换策略 */
  rotationPolicy: RotationPolicy;
  /** 密钥存储 */
  storage: KeyStorage;
  /** 是否自动轮换 */
  autoRotate: boolean;
}

/** 密钥存储接口 */
export interface KeyStorage {
  /** 获取密钥 */
  get(keyId: string): Promise<Key | undefined>;
  /** 存储密钥 */
  set(key: Key): Promise<void>;
  /** 删除密钥 */
  delete(keyId: string): Promise<void>;
  /** 列出密钥 */
  list(filter?: KeyFilter): Promise<Key[]>;
}

/** 密钥过滤条件 */
export interface KeyFilter {
  /** 按用途过滤 */
  purpose?: KeyPurpose;
  /** 按算法过滤 */
  algorithm?: KeyAlgorithm;
  /** 按状态过滤 */
  status?: KeyStatus;
  /** 按名称模式过滤 */
  namePattern?: string;
}

// ============================================================================
// 内存存储实现
// ============================================================================

/**
 * 内存密钥存储
 */
export class MemoryKeyStorage implements KeyStorage {
  private keys: Map<string, Key> = new Map();

  async get(keyId: string): Promise<Key | undefined> {
    const key = this.keys.get(keyId);
    return key ? { ...key } : undefined;
  }

  async set(key: Key): Promise<void> {
    this.keys.set(key.id, { ...key });
  }

  async delete(keyId: string): Promise<void> {
    this.keys.delete(keyId);
  }

  async list(filter?: KeyFilter): Promise<Key[]> {
    let result = Array.from(this.keys.values());

    if (filter) {
      if (filter.purpose) {
        result = result.filter((k) => k.purpose === filter.purpose);
      }
      if (filter.algorithm) {
        result = result.filter((k) => k.algorithm === filter.algorithm);
      }
      if (filter.status) {
        result = result.filter((k) => k.status === filter.status);
      }
      if (filter.namePattern) {
        const regex = new RegExp(filter.namePattern);
        result = result.filter((k) => regex.test(k.name));
      }
    }

    return result;
  }
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_ROTATION_POLICY: RotationPolicy = {
  intervalMs: 24 * 60 * 60 * 1000, // 24 hours
  advanceMs: 60 * 60 * 1000, // 1 hour before expiration
  minLength: 32,
  maxLength: 64,
};

const DEFAULT_KEY_MANAGER_CONFIG: KeyManagerConfig = {
  defaultAlgorithm: "aes-256-gcm",
  rotationPolicy: DEFAULT_ROTATION_POLICY,
  storage: new MemoryKeyStorage(),
  autoRotate: true,
};

// ============================================================================
// KeyManager 类
// ============================================================================

/**
 * 密钥管理器
 */
export class KeyManager extends EventEmitter {
  private config: KeyManagerConfig;
  private rotationTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private autoRotationTimer?: ReturnType<typeof setInterval>;

  constructor(config: Partial<KeyManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_KEY_MANAGER_CONFIG, ...config };
  }

  // ============================================================================
  // 密钥生成
  // ============================================================================

  /**
   * 生成密钥
   */
  generateKey(
    purpose: KeyPurpose,
    options: {
      algorithm?: KeyAlgorithm;
      name?: string;
      expiresIn?: number;
      metadata?: Record<string, unknown>;
    } = {}
  ): Key {
    const algorithm = options.algorithm || this.config.defaultAlgorithm;
    const keyBytes = this.getKeyLength(algorithm);
    const rawKey = crypto.randomBytes(keyBytes);
    const id = this.generateKeyId();
    const now = new Date();
    const expiresAt = options.expiresIn
      ? new Date(now.getTime() + options.expiresIn)
      : undefined;

    const key: Key = {
      id,
      name: options.name || `key-${purpose}-${now.getTime()}`,
      purpose,
      algorithm,
      value: rawKey.toString("base64"),
      createdAt: now,
      expiresAt,
      status: "active",
      metadata: options.metadata || {},
      rotationCount: 0,
    };

    this.config.storage.set(key);
    this.emit("key:generated", key);

    return key;
  }

  /**
   * 从密码生成密钥
   */
  generateKeyFromPassphrase(
    purpose: KeyPurpose,
    passphrase: string,
    options: {
      algorithm?: KeyAlgorithm;
      name?: string;
      expiresIn?: number;
      salt?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): Key {
    const algorithm = options.algorithm || this.config.defaultAlgorithm;
    const salt = options.salt || crypto.randomBytes(16).toString("hex");
    const keyMaterial = passphrase + salt;
    const keyBytes = this.getKeyLength(algorithm);
    const derivedKey = crypto
      .createHash("sha256")
      .update(keyMaterial)
      .digest()
      .subarray(0, keyBytes);

    const id = this.generateKeyId();
    const now = new Date();
    const expiresAt = options.expiresIn
      ? new Date(now.getTime() + options.expiresIn)
      : undefined;

    const key: Key = {
      id,
      name: options.name || `key-${purpose}-${now.getTime()}`,
      purpose,
      algorithm,
      value: derivedKey.toString("base64"),
      createdAt: now,
      expiresAt,
      status: "active",
      metadata: { ...options.metadata, salt },
      rotationCount: 0,
    };

    this.config.storage.set(key);
    this.emit("key:generated", key);

    return key;
  }

  // ============================================================================
  // 密钥轮换
  // ============================================================================

  /**
   * 轮换密钥
   */
  async rotateKey(keyId: string): Promise<Key> {
    const oldKey = await this.config.storage.get(keyId);
    if (!oldKey) {
      throw new Error(`Key not found: ${keyId}`);
    }

    // 生成新密钥
    const newKey = this.generateKey(oldKey.purpose, {
      algorithm: oldKey.algorithm,
      name: `${oldKey.name}-rotated`,
      metadata: {
        ...oldKey.metadata,
        previousKeyId: oldKey.id,
        rotationNumber: oldKey.rotationCount + 1,
      },
    });

    // 标记旧密钥为轮换中
    oldKey.status = "rotating";
    await this.config.storage.set(oldKey);

    this.emit("key:rotating", { oldKey, newKey });

    // 激活新密钥
    newKey.status = "active";
    newKey.rotationCount = oldKey.rotationCount + 1;
    await this.config.storage.set(newKey);

    // 清理轮换计时器
    this.clearRotationTimer(keyId);

    // 设置过渡期
    setTimeout(() => {
      oldKey.status = "inactive";
      this.config.storage.set(oldKey);
      this.emit("key:deactivated", oldKey);
    }, 60000); // 1 minute transition

    this.emit("key:rotated", { oldKey, newKey });
    return newKey;
  }

  /**
   * 自动轮换检查
   */
  async checkAndRotate(): Promise<void> {
    const keys = await this.config.storage.list({ status: "active" });
    const now = Date.now();

    for (const key of keys) {
      if (!key.expiresAt) continue;

      const timeUntilExpiry = key.expiresAt.getTime() - now;
      const timeUntilRotation =
        timeUntilExpiry - this.config.rotationPolicy.advanceMs;

      if (timeUntilRotation <= 0) {
        await this.rotateKey(key.id);
      }
    }
  }

  /**
   * 启动自动轮换
   */
  startAutoRotation(): void {
    if (!this.config.autoRotate) return;

    this.autoRotationTimer = setInterval(() => {
      this.checkAndRotate().catch((err) => {
        this.emit("rotation:error", err);
      });
    }, 60000); // Check every minute
  }

  /**
   * 停止自动轮换
   */
  stopAutoRotation(): void {
    // Clear auto rotation timer
    if (this.autoRotationTimer) {
      clearInterval(this.autoRotationTimer);
      this.autoRotationTimer = undefined;
    }

    // Clear all key-specific timers
    for (const [keyId, timer] of this.rotationTimers) {
      clearInterval(timer);
    }
    this.rotationTimers.clear();
  }

  // ============================================================================
  // 密钥获取
  // ============================================================================

  /**
   * 获取密钥
   */
  async getKey(keyId: string): Promise<Key | undefined> {
    const key = await this.config.storage.get(keyId);

    if (key && key.status === "active") {
      key.lastUsedAt = new Date();
      await this.config.storage.set(key);
      return key;
    }

    return undefined;
  }

  /**
   * 按用途获取活跃密钥
   */
  async getActiveKey(purpose: KeyPurpose): Promise<Key | undefined> {
    const keys = await this.config.storage.list({
      purpose,
      status: "active",
    });

    // 按创建时间排序，返回最新的密钥
    return keys.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }

  /**
   * 获取所有密钥
   */
  async getAllKeys(filter?: KeyFilter): Promise<Key[]> {
    return this.config.storage.list(filter);
  }

  // ============================================================================
  // 密钥验证
  // ============================================================================

  /**
   * 验证密钥是否有效
   */
  async validateKey(keyId: string): Promise<boolean> {
    const key = await this.config.storage.get(keyId);

    if (!key) return false;
    if (key.status !== "active") return false;
    if (key.expiresAt && key.expiresAt < new Date()) return false;

    return true;
  }

  // ============================================================================
  // 密钥删除
  // ============================================================================

  /**
   * 删除密钥 (软删除)
   */
  async deleteKey(keyId: string): Promise<boolean> {
    const key = await this.config.storage.get(keyId);

    if (!key) return false;

    key.status = "inactive";
    await this.config.storage.set(key);
    this.emit("key:deleted", key);

    return true;
  }

  /**
   * 彻底删除密钥
   */
  async destroyKey(keyId: string): Promise<boolean> {
    await this.config.storage.delete(keyId);
    this.clearRotationTimer(keyId);
    this.emit("key:destroyed", keyId);

    return true;
  }

  // ============================================================================
  // 统计
  // ============================================================================

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    totalKeys: number;
    activeKeys: number;
    expiredKeys: number;
    byPurpose: Record<string, number>;
    byAlgorithm: Record<string, number>;
  }> {
    const keys = await this.config.storage.list();

    const stats = {
      totalKeys: keys.length,
      activeKeys: 0,
      expiredKeys: 0,
      byPurpose: {} as Record<string, number>,
      byAlgorithm: {} as Record<string, number>,
    };

    for (const key of keys) {
      if (key.status === "active") stats.activeKeys++;
      if (key.status === "expired") stats.expiredKeys++;

      stats.byPurpose[key.purpose] = (stats.byPurpose[key.purpose] || 0) + 1;
      stats.byAlgorithm[key.algorithm] = (stats.byAlgorithm[key.algorithm] || 0) + 1;
    }

    return stats;
  }

  /**
   * 获取摘要
   */
  async getSummary(): Promise<{
    keys: number;
    active: number;
    rotating: number;
    expired: number;
    stats: Awaited<ReturnType<KeyManager["getStats"]>>;
  }> {
    const keys = await this.config.storage.list();
    const stats = await this.getStats();

    return {
      keys: keys.length,
      active: keys.filter((k) => k.status === "active").length,
      rotating: keys.filter((k) => k.status === "rotating").length,
      expired: keys.filter((k) => k.status === "expired").length,
      stats,
    };
  }

  // ============================================================================
  // 清理
  // ============================================================================

  /**
   * 关闭管理器
   */
  close(): void {
    this.stopAutoRotation();
    this.removeAllListeners();
  }

  // ============================================================================
  // 辅助方法
  // ============================================================================

  private generateKeyId(): string {
    return `key-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  }

  private getKeyLength(algorithm: KeyAlgorithm): number {
    switch (algorithm) {
      case "aes-256-gcm":
        return 32;
      case "aes-128-cbc":
        return 16;
      case "chacha20-poly1305":
        return 32;
      default:
        return 32;
    }
  }

  private clearRotationTimer(keyId: string): void {
    const timer = this.rotationTimers.get(keyId);
    if (timer) {
      clearInterval(timer);
      this.rotationTimers.delete(keyId);
    }
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建密钥管理器
 */
export function createKeyManager(config?: Partial<KeyManagerConfig>): KeyManager {
  return new KeyManager(config);
}

// ============================================================================
// 格式化函数
// ============================================================================

/**
 * 格式化密钥
 */
export function formatKey(key: Key): string {
  const lines = [
    "=== 密钥 ===",
    `ID: ${key.id}`,
    `名称: ${key.name}`,
    `用途: ${key.purpose}`,
    `算法: ${key.algorithm}`,
    `状态: ${key.status}`,
    `创建时间: ${key.createdAt.toISOString()}`,
  ];

  if (key.expiresAt) {
    lines.push(`过期时间: ${key.expiresAt.toISOString()}`);
  }

  if (key.lastUsedAt) {
    lines.push(`最后使用: ${key.lastUsedAt.toISOString()}`);
  }

  lines.push(`轮换次数: ${key.rotationCount}`);

  return lines.join("\n");
}

/**
 * 格式化轮换策略
 */
export function formatRotationPolicy(policy: RotationPolicy): string {
  const lines = [
    "=== 轮换策略 ===",
    `轮换间隔: ${policy.intervalMs / 1000 / 60} 分钟`,
    `提前轮换: ${policy.advanceMs / 1000 / 60} 分钟`,
    `最小长度: ${policy.minLength} 字节`,
    `最大长度: ${policy.maxLength} 字节`,
  ];

  return lines.join("\n");
}
