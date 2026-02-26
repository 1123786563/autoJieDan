/**
 * 租约管理模块
 * 管理任务租约的获取、释放和续期
 *
 * @module interagent/lease
 * @version 1.0.0
 */

import { EventEmitter } from "events";

// ============================================================================
// 类型定义
// ============================================================================

/** 租约状态 */
export type LeaseStatus =
  | "active"      // 活跃中
  | "expired"     // 已过期
  | "released"    // 已释放
  | "revoked";    // 已撤销

/** 租约 */
export interface Lease {
  /** 租约 ID */
  id: string;
  /** 关联的任务 ID */
  taskId: string;
  /** 持有者 DID (Nanobot) */
  holderDid: string;
  /** 获取时间 */
  acquiredAt: Date;
  /** 过期时间 */
  expiresAt: Date;
  /** 状态 */
  status: LeaseStatus;
  /** 续期次数 */
  renewCount: number;
  /** 最大续期次数 */
  maxRenews: number;
  /** 元数据 */
  metadata: LeaseMetadata;
}

/** 租约元数据 */
export interface LeaseMetadata {
  /** 初始持续时间 (秒) */
  durationSeconds: number;
  /** 最后心跳时间 */
  lastHeartbeat?: Date;
  /** 释放原因 */
  releaseReason?: string;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
}

/** 租赁选项 */
export interface AcquireLeaseOptions {
  /** 任务 ID */
  taskId: string;
  /** 持有者 DID */
  holderDid: string;
  /** 持续时间 (秒) */
  durationSeconds: number;
  /** 最大续期次数 */
  maxRenews?: number;
}

/** 续期选项 */
export interface RenewLeaseOptions {
  /** 额外持续时间 (秒) */
  additionalSeconds: number;
}

/** 租约管理器配置 */
export interface LeaseManagerConfig {
  /** 默认租约持续时间 (秒) */
  defaultDuration?: number;
  /** 默认最大续期次数 */
  defaultMaxRenews?: number;
  /** 清理间隔 (秒) */
  cleanupInterval?: number;
  /** 心跳超时 (秒) */
  heartbeatTimeout?: number;
}

/** 租约统计 */
export interface LeaseStats {
  total: number;
  active: number;
  expired: number;
  released: number;
  revoked: number;
}

// ============================================================================
// 租约管理器
// ============================================================================

/**
 * 租约管理器
 * 管理任务租约的生命周期
 */
export class LeaseManager extends EventEmitter {
  private leases: Map<string, Lease> = new Map(); // leaseId -> Lease
  private taskLeases: Map<string, string> = new Map(); // taskId -> leaseId
  private config: Required<LeaseManagerConfig>;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  /** 默认配置 */
  private static readonly DEFAULT_CONFIG: Required<LeaseManagerConfig> = {
    defaultDuration: 60, // 1 分钟
    defaultMaxRenews: 5,
    cleanupInterval: 30, // 30 秒
    heartbeatTimeout: 120, // 2 分钟
  };

  constructor(config: Partial<LeaseManagerConfig> = {}) {
    super();
    this.config = { ...LeaseManager.DEFAULT_CONFIG, ...config };
  }

  /**
   * 启动租约管理器
   */
  start(): void {
    this.startCleanupTimer();
    this.emit("started");
  }

  /**
   * 停止租约管理器
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.emit("stopped");
  }

  // ===========================================================================
  // 租约操作
  // ===========================================================================

  /**
   * 获取租约
   */
  acquire(options: AcquireLeaseOptions): Lease | null {
    const { taskId, holderDid, durationSeconds, maxRenews } = options;

    // 检查任务是否已有活跃租约
    const existingLeaseId = this.taskLeases.get(taskId);
    if (existingLeaseId) {
      const existing = this.leases.get(existingLeaseId);
      if (existing && existing.status === "active" && !this.isExpired(existing)) {
        // 已有活跃租约
        return null;
      }
    }

    const now = new Date();
    const leaseId = this.generateLeaseId();

    const lease: Lease = {
      id: leaseId,
      taskId,
      holderDid,
      acquiredAt: now,
      expiresAt: new Date(now.getTime() + durationSeconds * 1000),
      status: "active",
      renewCount: 0,
      maxRenews: maxRenews ?? this.config.defaultMaxRenews,
      metadata: {
        durationSeconds,
        createdAt: now,
        updatedAt: now,
      },
    };

    this.leases.set(leaseId, lease);
    this.taskLeases.set(taskId, leaseId);

    this.emit("lease:acquired", { lease, timestamp: now });

    return lease;
  }

  /**
   * 释放租约
   */
  release(leaseId: string, reason?: string): Lease | null {
    const lease = this.leases.get(leaseId);
    if (!lease) return null;

    const now = new Date();
    lease.status = "released";
    lease.metadata.updatedAt = now;
    lease.metadata.releaseReason = reason;

    this.leases.set(leaseId, lease);
    this.taskLeases.delete(lease.taskId);

    this.emit("lease:released", { lease, timestamp: now, reason });

    return lease;
  }

  /**
   * 通过任务 ID 释放租约
   */
  releaseByTaskId(taskId: string, reason?: string): Lease | null {
    const leaseId = this.taskLeases.get(taskId);
    if (!leaseId) return null;
    return this.release(leaseId, reason);
  }

  /**
   * 续期租约
   */
  renew(leaseId: string, options: RenewLeaseOptions): Lease | null {
    const lease = this.leases.get(leaseId);
    if (!lease) return null;

    // 检查租约状态
    if (lease.status !== "active") {
      return null;
    }

    // 检查是否已过期
    if (this.isExpired(lease)) {
      this.markExpired(leaseId);
      return null;
    }

    // 检查续期次数
    if (lease.renewCount >= lease.maxRenews) {
      return null;
    }

    const now = new Date();
    const newExpiresAt = new Date(lease.expiresAt.getTime() + options.additionalSeconds * 1000);

    lease.expiresAt = newExpiresAt;
    lease.renewCount++;
    lease.metadata.updatedAt = now;

    this.leases.set(leaseId, lease);

    this.emit("lease:renewed", {
      lease,
      timestamp: now,
      additionalSeconds: options.additionalSeconds,
    });

    return lease;
  }

  /**
   * 撤销租约
   */
  revoke(leaseId: string, reason: string): Lease | null {
    const lease = this.leases.get(leaseId);
    if (!lease) return null;

    const now = new Date();
    lease.status = "revoked";
    lease.metadata.updatedAt = now;
    lease.metadata.releaseReason = reason;

    this.leases.set(leaseId, lease);
    this.taskLeases.delete(lease.taskId);

    this.emit("lease:revoked", { lease, timestamp: now, reason });

    return lease;
  }

  /**
   * 心跳
   */
  heartbeat(leaseId: string): Lease | null {
    const lease = this.leases.get(leaseId);
    if (!lease) return null;

    if (lease.status !== "active") {
      return null;
    }

    const now = new Date();
    lease.metadata.lastHeartbeat = now;
    lease.metadata.updatedAt = now;

    this.leases.set(leaseId, lease);

    this.emit("lease:heartbeat", { lease, timestamp: now });

    return lease;
  }

  // ===========================================================================
  // 查询方法
  // ===========================================================================

  /**
   * 获取租约
   */
  get(leaseId: string): Lease | undefined {
    return this.leases.get(leaseId);
  }

  /**
   * 通过任务 ID 获取租约
   */
  getByTaskId(taskId: string): Lease | undefined {
    const leaseId = this.taskLeases.get(taskId);
    return leaseId ? this.leases.get(leaseId) : undefined;
  }

  /**
   * 获取持有者的所有活跃租约
   */
  getActiveByHolder(holderDid: string): Lease[] {
    return Array.from(this.leases.values()).filter(
      (lease) => lease.holderDid === holderDid && lease.status === "active" && !this.isExpired(lease)
    );
  }

  /**
   * 检查租约是否过期
   */
  isExpired(lease: Lease): boolean {
    if (lease.status !== "active") return false;
    return new Date() > lease.expiresAt;
  }

  /**
   * 检查租约是否有效
   */
  isValid(leaseId: string): boolean {
    const lease = this.leases.get(leaseId);
    if (!lease) return false;
    return lease.status === "active" && !this.isExpired(lease);
  }

  /**
   * 获取剩余时间 (秒)
   */
  getRemainingTime(lease: Lease): number {
    if (lease.status !== "active") return 0;

    const remaining = lease.expiresAt.getTime() - Date.now();
    return Math.max(0, Math.floor(remaining / 1000));
  }

  /**
   * 获取统计信息
   */
  getStats(): LeaseStats {
    let active = 0;
    let expired = 0;
    let released = 0;
    let revoked = 0;

    for (const lease of this.leases.values()) {
      switch (lease.status) {
        case "active":
          if (this.isExpired(lease)) {
            expired++;
          } else {
            active++;
          }
          break;
        case "expired":
          expired++;
          break;
        case "released":
          released++;
          break;
        case "revoked":
          revoked++;
          break;
      }
    }

    return {
      total: this.leases.size,
      active,
      expired,
      released,
      revoked,
    };
  }

  // ===========================================================================
  // 内部方法
  // ===========================================================================

  /**
   * 生成租约 ID
   */
  private generateLeaseId(): string {
    return `lease-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 标记租约为过期
   */
  private markExpired(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (!lease) return;

    const now = new Date();
    lease.status = "expired";
    lease.metadata.updatedAt = now;

    this.leases.set(leaseId, lease);
    this.taskLeases.delete(lease.taskId);

    this.emit("lease:expired", { lease, timestamp: now });
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredLeases();
    }, this.config.cleanupInterval * 1000);
  }

  /**
   * 清理过期租约
   */
  private cleanupExpiredLeases(): void {
    for (const [leaseId, lease] of this.leases) {
      if (lease.status === "active" && this.isExpired(lease)) {
        this.markExpired(leaseId);
      }
    }
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 格式化租约剩余时间
 */
export function formatRemainingTime(seconds: number): string {
  if (seconds <= 0) return "0s";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(" ");
}

/**
 * 检查租约是否即将过期
 */
export function isExpiringSoon(lease: Lease, thresholdSeconds: number = 30): boolean {
  if (lease.status !== "active") return false;

  const remaining = lease.expiresAt.getTime() - Date.now();
  return remaining > 0 && remaining <= thresholdSeconds * 1000;
}
