/**
 * 任务管理器 - 管理任务生命周期
 *
 * @module interagent/task-manager
 * @version 1.0.0
 */

import { EventEmitter } from "events";
import { ulid } from "ulid";

// ============================================================================
// 类型定义
// ============================================================================

/** 任务状态 */
export type TaskStatus =
  | "pending"    // 等待处理
  | "queued"     // 已入队
  | "running"    // 正在执行
  | "completed"  // 已完成
  | "failed"     // 失败
  | "cancelled"; // 已取消

/** 任务优先级 */
export type TaskPriority = "critical" | "high" | "normal" | "low" | "background";

/** 任务类型 */
export type TaskType =
  | "genesis"     // Genesis Prompt 任务
  | "analysis"    // 分析任务
  | "execution"   // 执行任务
  | "report"      // 报告任务
  | "maintenance" // 维护任务
  | "custom";     // 自定义任务

/** 任务 */
export interface Task {
  /** 任务 ID */
  id: string;
  /** 任务类型 */
  type: TaskType;
  /** 任务状态 */
  status: TaskStatus;
  /** 优先级 */
  priority: TaskPriority;
  /** 来源 DID */
  sourceDid: string;
  /** 目标 DID (Nanobot) */
  targetDid: string;
  /** 任务输入 */
  input: Record<string, unknown>;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
  /** 开始时间 */
  startedAt?: Date;
  /** 完成时间 */
  completedAt?: Date;
  /** 租约过期时间 */
  leaseExpiresAt?: Date;
  /** 重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 错误信息 */
  error?: string;
  /** 结果 */
  result?: Record<string, unknown>;
  /** 元数据 */
  metadata: TaskMetadata;
}

/** 任务元数据 */
export interface TaskMetadata {
  /** 幂等性键 */
  idempotencyKey?: string;
  /** 父任务 ID */
  parentId?: string;
  /** 标签 */
  tags?: string[];
  /** 预算 (tokens) */
  budget?: number;
  /** 超时时间 (秒) */
  timeout?: number;
  /** 回调 URL */
  callbackUrl?: string;
}

/** 任务创建选项 */
export interface CreateTaskOptions {
  /** 任务类型 */
  type: TaskType;
  /** 优先级 */
  priority?: TaskPriority;
  /** 来源 DID */
  sourceDid: string;
  /** 目标 DID */
  targetDid: string;
  /** 任务输入 */
  input: Record<string, unknown>;
  /** 幂等性键 */
  idempotencyKey?: string;
  /** 父任务 ID */
  parentId?: string;
  /** 标签 */
  tags?: string[];
  /** 预算 */
  budget?: number;
  /** 超时 */
  timeout?: number;
  /** 回调 URL */
  callbackUrl?: string;
  /** 最大重试次数 */
  maxRetries?: number;
}

/** 任务过滤器 */
export interface TaskFilter {
  /** 按状态过滤 */
  status?: TaskStatus | TaskStatus[];
  /** 按类型过滤 */
  type?: TaskType | TaskType[];
  /** 按优先级过滤 */
  priority?: TaskPriority | TaskPriority[];
  /** 按目标 DID 过滤 */
  targetDid?: string;
  /** 限制数量 */
  limit?: number;
  /** 偏移量 */
  offset?: number;
}

/** 任务管理器配置 */
export interface TaskManagerConfig {
  /** 最大并发任务数 */
  maxConcurrent?: number;
  /** 默认任务超时 (秒) */
  defaultTimeout?: number;
  /** 默认最大重试次数 */
  defaultMaxRetries?: number;
  /** 清理已完成任务的间隔 (秒) */
  cleanupInterval?: number;
  /** 已完成任务保留时间 (秒) */
  completedTaskTTL?: number;
}

/** 任务事件 */
export interface TaskEvent {
  type: "created" | "started" | "completed" | "failed" | "cancelled" | "retries_exhausted";
  task: Task;
  timestamp: Date;
  data?: Record<string, unknown>;
}

// ============================================================================
// 任务管理器
// ============================================================================

/**
 * 任务管理器 - 管理任务的生命周期
 */
export class TaskManager extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private idempotencyKeys: Map<string, string> = new Map(); // key -> taskId
  private config: Required<TaskManagerConfig>;
  private cleanupTimer?: NodeJS.Timeout;

  /** 默认配置 */
  private static readonly DEFAULT_CONFIG: Required<TaskManagerConfig> = {
    maxConcurrent: 10,
    defaultTimeout: 300, // 5 分钟
    defaultMaxRetries: 3,
    cleanupInterval: 60, // 每分钟清理
    completedTaskTTL: 3600, // 保留 1 小时
  };

  constructor(config: Partial<TaskManagerConfig> = {}) {
    super();
    this.config = { ...TaskManager.DEFAULT_CONFIG, ...config };
  }

  /**
   * 启动任务管理器
   */
  start(): void {
    this.startCleanupTimer();
    this.emit("started");
  }

  /**
   * 停止任务管理器
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.emit("stopped");
  }

  /**
   * 创建新任务
   */
  createTask(options: CreateTaskOptions): Task {
    // 检查幂等性键
    if (options.idempotencyKey) {
      const existingId = this.idempotencyKeys.get(options.idempotencyKey);
      if (existingId) {
        const existingTask = this.tasks.get(existingId);
        if (existingTask) {
          return existingTask; // 返回已存在的任务
        }
      }
    }

    const taskId = ulid();
    const now = new Date();

    const task: Task = {
      id: taskId,
      type: options.type,
      status: "pending",
      priority: options.priority ?? "normal",
      sourceDid: options.sourceDid,
      targetDid: options.targetDid,
      input: options.input,
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
      maxRetries: options.maxRetries ?? this.config.defaultMaxRetries,
      metadata: {
        idempotencyKey: options.idempotencyKey,
        parentId: options.parentId,
        tags: options.tags,
        budget: options.budget,
        timeout: options.timeout ?? this.config.defaultTimeout,
        callbackUrl: options.callbackUrl,
      },
    };

    this.tasks.set(taskId, task);

    // 记录幂等性键
    if (options.idempotencyKey) {
      this.idempotencyKeys.set(options.idempotencyKey, taskId);
    }

    this.emit("task:created", { task, timestamp: now });

    return task;
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 通过幂等性键获取任务
   */
  getTaskByIdempotencyKey(key: string): Task | undefined {
    const taskId = this.idempotencyKeys.get(key);
    return taskId ? this.tasks.get(taskId) : undefined;
  }

  /**
   * 更新任务状态
   */
  updateTaskStatus(taskId: string, status: TaskStatus, data?: {
    error?: string;
    result?: Record<string, unknown>;
  }): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    const now = new Date();
    task.status = status;
    task.updatedAt = now;

    if (status === "running" && !task.startedAt) {
      task.startedAt = now;
    }

    if (status === "completed" || status === "failed" || status === "cancelled") {
      task.completedAt = now;
    }

    if (data?.error) {
      task.error = data.error;
    }

    if (data?.result) {
      task.result = data.result;
    }

    this.tasks.set(taskId, task);

    this.emit("task:updated", { task, timestamp: now, status });

    return task;
  }

  /**
   * 获取任务租约
   */
  acquireLease(taskId: string, durationSeconds: number): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    if (task.status !== "pending" && task.status !== "queued") {
      return undefined; // 无法获取租约
    }

    const now = new Date();
    task.status = "running";
    task.startedAt = now;
    task.updatedAt = now;
    task.leaseExpiresAt = new Date(now.getTime() + durationSeconds * 1000);

    this.tasks.set(taskId, task);

    this.emit("task:leased", { task, timestamp: now });

    return task;
  }

  /**
   * 释放任务租约
   */
  releaseLease(taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    task.leaseExpiresAt = undefined;
    task.updatedAt = new Date();

    this.tasks.set(taskId, task);

    this.emit("task:released", { task, timestamp: new Date() });

    return task;
  }

  /**
   * 检查租约是否过期
   */
  isLeaseExpired(task: Task): boolean {
    if (!task.leaseExpiresAt) return false;
    return new Date() > task.leaseExpiresAt;
  }

  /**
   * 重试任务
   */
  retryTask(taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    if (task.retryCount >= task.maxRetries) {
      this.updateTaskStatus(taskId, "failed", {
        error: `Max retries (${task.maxRetries}) exhausted`,
      });
      this.emit("task:retries_exhausted", { task, timestamp: new Date() });
      return task;
    }

    task.retryCount++;
    task.status = "pending";
    task.error = undefined;
    task.leaseExpiresAt = undefined;
    task.updatedAt = new Date();

    this.tasks.set(taskId, task);

    this.emit("task:retried", { task, timestamp: new Date() });

    return task;
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string, reason?: string): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    // Already in terminal state - return as-is
    if (task.status === "completed" || task.status === "cancelled") {
      return task;
    }

    const now = new Date();
    task.status = "cancelled";
    task.completedAt = now;
    task.updatedAt = now;

    if (reason) {
      task.error = reason;
    }

    this.tasks.set(taskId, task);

    this.emit("task:cancelled", { task, timestamp: now, reason });

    return task;
  }

  /**
   * 获取待处理的任务
   */
  getPendingTasks(filter?: TaskFilter): Task[] {
    let tasks = Array.from(this.tasks.values())
      .filter((t) => t.status === "pending" || t.status === "queued");

    if (filter) {
      tasks = this.applyFilter(tasks, filter);
    }

    // 按优先级排序
    return this.sortByPriority(tasks);
  }

  /**
   * 获取正在运行的任务
   */
  getRunningTasks(filter?: TaskFilter): Task[] {
    let tasks = Array.from(this.tasks.values())
      .filter((t) => t.status === "running");

    if (filter) {
      tasks = this.applyFilter(tasks, filter);
    }

    return tasks;
  }

  /**
   * 获取所有任务
   */
  getAllTasks(filter?: TaskFilter): Task[] {
    let tasks = Array.from(this.tasks.values());

    if (filter) {
      tasks = this.applyFilter(tasks, filter);
    }

    return tasks;
  }

  /**
   * 获取任务统计
   */
  getStats(): TaskStats {
    const tasks = Array.from(this.tasks.values());

    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === "pending").length,
      queued: tasks.filter((t) => t.status === "queued").length,
      running: tasks.filter((t) => t.status === "running").length,
      completed: tasks.filter((t) => t.status === "completed").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      cancelled: tasks.filter((t) => t.status === "cancelled").length,
    };
  }

  /**
   * 应用过滤器
   */
  private applyFilter(tasks: Task[], filter: TaskFilter): Task[] {
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      tasks = tasks.filter((t) => statuses.includes(t.status));
    }

    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      tasks = tasks.filter((t) => types.includes(t.type));
    }

    if (filter.priority) {
      const priorities = Array.isArray(filter.priority)
        ? filter.priority
        : [filter.priority];
      tasks = tasks.filter((t) => priorities.includes(t.priority));
    }

    if (filter.targetDid) {
      tasks = tasks.filter((t) => t.targetDid === filter.targetDid);
    }

    if (filter.offset !== undefined) {
      tasks = tasks.slice(filter.offset);
    }

    if (filter.limit !== undefined) {
      tasks = tasks.slice(0, filter.limit);
    }

    return tasks;
  }

  /**
   * 按优先级排序
   */
  private sortByPriority(tasks: Task[]): Task[] {
    const priorityOrder: Record<TaskPriority, number> = {
      critical: 0,
      high: 2,
      normal: 3,
      low: 4,
      background: 5,
    };

    return tasks.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupCompletedTasks();
    }, this.config.cleanupInterval * 1000);
  }

  /**
   * 清理已完成的任务
   */
  private cleanupCompletedTasks(): void {
    const now = Date.now();
    const ttlMs = this.config.completedTaskTTL * 1000;

    for (const [id, task] of this.tasks) {
      if (
        (task.status === "completed" || task.status === "failed" || task.status === "cancelled") &&
        task.completedAt &&
        now - task.completedAt.getTime() > ttlMs
      ) {
        this.tasks.delete(id);

        // 清理幂等性键
        if (task.metadata.idempotencyKey) {
          this.idempotencyKeys.delete(task.metadata.idempotencyKey);
        }
      }
    }
  }
}

/** 任务统计 */
export interface TaskStats {
  total: number;
  pending: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 检查任务是否可重试
 */
export function canRetry(task: Task): boolean {
  return task.retryCount < task.maxRetries;
}

/**
 * 检查任务是否已完成
 */
export function isCompleted(task: Task): boolean {
  return task.status === "completed" || task.status === "failed" || task.status === "cancelled";
}

/**
 * 获取任务运行时长 (秒)
 */
export function getTaskDuration(task: Task): number | undefined {
  if (!task.startedAt) return undefined;
  const endTime = task.completedAt ?? new Date();
  return (endTime.getTime() - task.startedAt.getTime()) / 1000;
}
