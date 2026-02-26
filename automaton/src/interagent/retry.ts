/**
 * 重试与指数退避机制
 * 提供可配置的重试策略和抖动算法
 *
 * @module interagent/retry
 * @version 1.0.0
 */

// ============================================================================
// 类型定义
// ============================================================================

/** 退避策略类型 */
export type BackoffStrategy =
  | "exponential"    // 指数退避
  | "linear"         // 线性退避
  | "fixed"          // 固定间隔
  | "decorrelated";  // 去相关抖动

/** 抖动类型 */
export type JitterType =
  | "none"           // 无抖动
  | "full"           // 完全抖动
  | "equal"          // 等差抖动
  | "decorrelated";  // 去相关抖动

/** 重试配置 */
export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始延迟（毫秒） */
  initialDelayMs: number;
  /** 最大延迟（毫秒） */
  maxDelayMs: number;
  /** 退避策略 */
  backoffStrategy: BackoffStrategy;
  /** 抖动类型 */
  jitterType: JitterType;
  /** 抖动因子 (0-1) */
  jitterFactor: number;
  /** 退避乘数（用于指数退避） */
  multiplier: number;
  /** 可重试的错误类型 */
  retryableErrors?: string[];
  /** 超时时间（毫秒） */
  timeoutMs?: number;
}

/** 重试上下文 */
export interface RetryContext {
  /** 当前尝试次数（从1开始） */
  attempt: number;
  /** 最大尝试次数 */
  maxAttempts: number;
  /** 上次错误 */
  lastError?: Error;
  /** 上次延迟（毫秒） */
  lastDelayMs: number;
  /** 总等待时间（毫秒） */
  totalWaitMs: number;
  /** 开始时间 */
  startTime: Date;
}

/** 重试结果 */
export interface RetryResult<T> {
  /** 是否成功 */
  success: boolean;
  /** 结果值 */
  value?: T;
  /** 错误信息 */
  error?: string;
  /** 总尝试次数 */
  totalAttempts: number;
  /** 总等待时间（毫秒） */
  totalWaitMs: number;
  /** 是否耗尽重试 */
  exhausted: boolean;
}

/** 重试事件 */
export interface RetryEvent {
  type: "attempt" | "success" | "failure" | "exhausted";
  context: RetryContext;
  timestamp: Date;
  error?: Error;
}

/** 重试监听器 */
export type RetryListener = (event: RetryEvent) => void;

/** 可重试函数签名 */
export type RetryableFunction<T> = () => T | Promise<T>;

/** 可重试判断函数 */
export type ShouldRetryFn = (error: Error, context: RetryContext) => boolean;

// ============================================================================
// 默认配置
// ============================================================================

/** 默认重试配置 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffStrategy: "exponential",
  jitterType: "full",
  jitterFactor: 0.5,
  multiplier: 2,
};

// ============================================================================
// 退避计算
// ============================================================================

/**
 * 计算基础退避时间
 */
export function calculateBaseDelay(
  attempt: number,
  config: RetryConfig
): number {
  const { initialDelayMs, maxDelayMs, backoffStrategy, multiplier } = config;

  let delay: number;

  switch (backoffStrategy) {
    case "exponential":
      delay = initialDelayMs * Math.pow(multiplier, attempt - 1);
      break;

    case "linear":
      delay = initialDelayMs * attempt;
      break;

    case "fixed":
      delay = initialDelayMs;
      break;

    case "decorrelated":
      // 去相关抖动使用上一轮的延迟作为基础
      delay = Math.min(initialDelayMs * multiplier, maxDelayMs);
      break;

    default:
      delay = initialDelayMs;
  }

  return Math.min(delay, maxDelayMs);
}

/**
 * 应用抖动
 */
export function applyJitter(delay: number, config: RetryConfig): number {
  const { jitterType, jitterFactor } = config;

  if (jitterType === "none" || jitterFactor <= 0) {
    return delay;
  }

  switch (jitterType) {
    case "full":
      // 完全抖动：[0, delay]
      return Math.random() * delay;

    case "equal":
      // 等差抖动：[delay/2, delay]
      return delay / 2 + Math.random() * (delay / 2);

    case "decorrelated":
      // 去相关抖动：[0, delay * 3]
      return Math.random() * delay * 3;

    default:
      return delay;
  }
}

/**
 * 计算下一次重试的延迟时间
 */
export function calculateDelay(
  attempt: number,
  config: Partial<RetryConfig> = {}
): number {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const baseDelay = calculateBaseDelay(attempt, fullConfig);
  const delayWithJitter = applyJitter(baseDelay, fullConfig);

  return Math.round(Math.min(delayWithJitter, fullConfig.maxDelayMs));
}

// ============================================================================
// 延迟工具
// ============================================================================

/**
 * 延迟执行
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// 重试执行器
// ============================================================================

/**
 * 重试执行器
 * 提供灵活的重试机制
 */
export class RetryExecutor<T> {
  private config: RetryConfig;
  private listeners: RetryListener[] = [];
  private shouldRetryFn?: ShouldRetryFn;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /**
   * 设置可重试判断函数
   */
  setShouldRetry(fn: ShouldRetryFn): this {
    this.shouldRetryFn = fn;
    return this;
  }

  /**
   * 添加事件监听器
   */
  on(listener: RetryListener): this {
    this.listeners.push(listener);
    return this;
  }

  /**
   * 移除事件监听器
   */
  off(listener: RetryListener): this {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
    return this;
  }

  /**
   * 执行带重试的函数
   */
  async execute(fn: RetryableFunction<T>): Promise<RetryResult<T>> {
    const startTime = new Date();
    const maxAttempts = this.config.maxRetries + 1;
    let lastError: Error | undefined;
    let totalWaitMs = 0;
    let lastDelayMs = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const context: RetryContext = {
        attempt,
        maxAttempts,
        lastError,
        lastDelayMs,
        totalWaitMs,
        startTime,
      };

      try {
        // 发射尝试事件
        this.emit({ type: "attempt", context, timestamp: new Date() });

        // 执行函数
        const value = await fn();

        // 成功
        const result: RetryResult<T> = {
          success: true,
          value,
          totalAttempts: attempt,
          totalWaitMs,
          exhausted: false,
        };

        this.emit({ type: "success", context, timestamp: new Date() });

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 检查是否应该重试
        const shouldRetry = this.shouldRetry(attempt, lastError, context);

        if (!shouldRetry || attempt >= maxAttempts) {
          // 重试耗尽或不可重试
          const exhausted = attempt >= maxAttempts;
          const result: RetryResult<T> = {
            success: false,
            error: lastError.message,
            totalAttempts: attempt,
            totalWaitMs,
            exhausted,
          };

          this.emit({
            type: exhausted ? "exhausted" : "failure",
            context,
            timestamp: new Date(),
            error: lastError,
          });

          return result;
        }

        // 计算延迟
        lastDelayMs = calculateDelay(attempt, this.config);

        // 发射失败事件
        this.emit({
          type: "failure",
          context,
          timestamp: new Date(),
          error: lastError,
        });

        // 等待
        await sleep(lastDelayMs);
        totalWaitMs += lastDelayMs;
      }
    }

    // 理论上不会到达这里
    return {
      success: false,
      error: lastError?.message || "Unknown error",
      totalAttempts: maxAttempts,
      totalWaitMs,
      exhausted: true,
    };
  }

  /**
   * 判断是否应该重试
   */
  private shouldRetry(
    attempt: number,
    error: Error,
    context: RetryContext
  ): boolean {
    // 使用自定义判断函数
    if (this.shouldRetryFn) {
      return this.shouldRetryFn(error, context);
    }

    // 检查可重试错误类型
    if (this.config.retryableErrors && this.config.retryableErrors.length > 0) {
      const errorName = error.name || error.constructor.name;
      const errorMessage = error.message;
      return this.config.retryableErrors.some(
        (retryable) =>
          errorName.includes(retryable) || errorMessage.includes(retryable)
      );
    }

    // 默认重试
    return true;
  }

  /**
   * 发射事件
   */
  private emit(event: RetryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略监听器错误
      }
    }
  }
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 带重试执行异步函数
 */
export async function retry<T>(
  fn: RetryableFunction<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const executor = new RetryExecutor<T>(config);
  const result = await executor.execute(fn);

  if (result.success) {
    return result.value!;
  }

  throw new Error(
    `Retry exhausted after ${result.totalAttempts} attempts: ${result.error}`
  );
}

/**
 * 带重试执行异步函数（返回结果而非抛出异常）
 */
export async function retrySafe<T>(
  fn: RetryableFunction<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const executor = new RetryExecutor<T>(config);
  return executor.execute(fn);
}

// ============================================================================
// 预定义配置
// ============================================================================

/** 快速重试配置（短间隔，少次数） */
export const FAST_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 2,
  initialDelayMs: 100,
  maxDelayMs: 1000,
  backoffStrategy: "exponential",
  jitterType: "full",
};

/** 标准重试配置 */
export const STANDARD_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffStrategy: "exponential",
  jitterType: "equal",
};

/** 持久重试配置（长间隔，多次数） */
export const PERSISTENT_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 10,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffStrategy: "exponential",
  jitterType: "decorrelated",
};

/** 网络请求重试配置 */
export const NETWORK_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 5,
  initialDelayMs: 500,
  maxDelayMs: 30000,
  backoffStrategy: "exponential",
  jitterType: "full",
  retryableErrors: ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "network"],
};

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 检查错误是否可重试
 */
export function isRetryableError(error: Error, retryablePatterns: string[]): boolean {
  const errorString = `${error.name} ${error.message}`.toLowerCase();
  return retryablePatterns.some((pattern) =>
    errorString.includes(pattern.toLowerCase())
  );
}

/**
 * 创建带超时的重试执行器
 */
export function createTimedExecutor<T>(
  config: Partial<RetryConfig>,
  timeoutMs: number
): RetryExecutor<T> {
  return new RetryExecutor<T>({ ...config, timeoutMs });
}

/**
 * 格式化重试配置
 */
export function formatRetryConfig(config: RetryConfig): string {
  return [
    `maxRetries: ${config.maxRetries}`,
    `initialDelay: ${config.initialDelayMs}ms`,
    `maxDelay: ${config.maxDelayMs}ms`,
    `strategy: ${config.backoffStrategy}`,
    `jitter: ${config.jitterType}`,
  ].join(", ");
}
