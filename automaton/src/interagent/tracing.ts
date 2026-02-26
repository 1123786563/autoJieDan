/**
 * OpenTelemetry 分布式追踪模块
 * 实现跨服务的分布式追踪能力
 *
 * @module interagent.tracing
 * @version 1.0.0
 */

import {
  trace,
  context,
  Span,
  SpanStatusCode,
  SpanOptions,
  Context,
  Tracer,
} from "@opentelemetry/api";

// ============================================================================
// Types
// ============================================================================

/**
 * 追踪配置
 */
export interface TracingConfig {
  /** 服务名称 */
  serviceName: string;
  /** Jaeger 端点 */
  jaegerEndpoint?: string;
  /** 采样率 (0-1) */
  samplingRate?: number;
  /** 是否启用追踪 */
  enabled?: boolean;
}

/**
 * Span 属性类型
 */
export type SpanAttributeValue = string | number | boolean;

/**
 * Span 创建选项
 */
export interface CreateSpanOptions {
  /** Span 属性 */
  attributes?: Record<string, SpanAttributeValue>;
  /** Span 类型 */
  kind?: "internal" | "server" | "client" | "producer" | "consumer";
  /** 父 Span */
  parent?: Span;
}

/**
 * 追踪上下文
 */
export interface TraceContext {
  /** Trace ID */
  traceId: string;
  /** Span ID */
  spanId: string;
  /** 采样标志 */
  sampled: boolean;
}

/**
 * 追踪统计
 */
export interface TracingStats {
  /** 创建的 Span 数量 */
  spansCreated: number;
  /** 错误 Span 数量 */
  errorSpans: number;
  /** 活跃 Span 数量 */
  activeSpans: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: Partial<TracingConfig> = {
  jaegerEndpoint: "http://localhost:14268/api/traces",
  samplingRate: 1.0,
  enabled: true,
};

const TRACER_NAME = "interagent";

// ============================================================================
// TracingManager Class
// ============================================================================

/**
 * 追踪管理器
 *
 * 管理分布式追踪功能，提供 Span 创建、上下文传播等能力
 *
 * @example
 * ```typescript
 * const tracing = new TracingManager({ serviceName: "my-service" });
 *
 * // 创建 Span
 * await tracing.withSpan("operation", async (span) => {
 *   span.setAttribute("key", "value");
 *   // 执行操作
 * });
 *
 * // 传播上下文
 * const headers = {};
 * tracing.injectContext(headers);
 * ```
 */
export class TracingManager {
  private config: TracingConfig;
  private tracer: Tracer;
  private stats: TracingStats;
  private enabled: boolean;

  constructor(config: TracingConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.enabled = this.config.enabled ?? true;
    this.tracer = trace.getTracer(TRACER_NAME);
    this.stats = {
      spansCreated: 0,
      errorSpans: 0,
      activeSpans: 0,
    };
  }

  /**
   * 检查追踪是否启用
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 启用追踪
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * 禁用追踪
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * 获取当前活跃的 Span
   */
  getActiveSpan(): Span | undefined {
    return trace.getActiveSpan();
  }

  /**
   * 创建 Span 并执行函数
   *
   * @param name - Span 名称
   * @param fn - 要执行的函数
   * @param options - Span 选项
   * @returns 函数执行结果
   */
  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options: CreateSpanOptions = {}
  ): Promise<T> {
    if (!this.enabled) {
      // 追踪禁用时直接执行函数
      return fn({} as Span);
    }

    const spanOptions: SpanOptions = {
      attributes: options.attributes,
    };

    return this.tracer.startActiveSpan(name, spanOptions, async (span: Span) => {
      this.stats.spansCreated++;
      this.stats.activeSpans++;

      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        this.stats.errorSpans++;
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        span.recordException(error as Error);
        throw error;
      } finally {
        this.stats.activeSpans--;
        span.end();
      }
    });
  }

  /**
   * 创建子 Span
   *
   * @param name - Span 名称
   * @param fn - 要执行的函数
   * @param options - Span 选项
   */
  async withChildSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options: CreateSpanOptions = {}
  ): Promise<T> {
    const parentSpan = this.getActiveSpan();

    if (!parentSpan) {
      return this.withSpan(name, fn, options);
    }

    return this.withSpan(name, fn, { ...options, parent: parentSpan });
  }

  /**
   * 注入追踪上下文到载体
   *
   * @param carrier - 载体对象 (如 HTTP headers)
   */
  injectContext(carrier: Record<string, string>): void {
    if (!this.enabled) return;

    const activeSpan = this.getActiveSpan();
    if (!activeSpan) return;

    const spanContext = activeSpan.spanContext();
    // W3C Trace Context 格式
    carrier["traceparent"] = `00-${spanContext.traceId}-${spanContext.spanId}-01`;
    carrier["tracestate"] = spanContext.traceState?.serialize() || "";
  }

  /**
   * 从载体提取追踪上下文
   *
   * @param carrier - 载体对象 (如 HTTP headers)
   * @returns 追踪上下文或 null
   */
  extractContext(carrier: Record<string, string>): TraceContext | null {
    const traceparent = carrier["traceparent"];
    if (!traceparent) return null;

    // 解析 W3C Trace Context 格式
    const match = traceparent.match(/^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i);
    if (!match) return null;

    return {
      traceId: match[2],
      spanId: match[3],
      sampled: match[4] === "01",
    };
  }

  /**
   * 添加 Span 事件
   *
   * @param name - 事件名称
   * @param attributes - 事件属性
   */
  addEvent(name: string, attributes?: Record<string, SpanAttributeValue>): void {
    const span = this.getActiveSpan();
    if (span) {
      span.addEvent(name, attributes);
    }
  }

  /**
   * 设置 Span 属性
   *
   * @param key - 属性名
   * @param value - 属性值
   */
  setAttribute(key: string, value: SpanAttributeValue): void {
    const span = this.getActiveSpan();
    if (span) {
      span.setAttribute(key, value);
    }
  }

  /**
   * 记录异常
   *
   * @param error - 异常对象
   */
  recordException(error: Error): void {
    const span = this.getActiveSpan();
    if (span) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
    }
  }

  /**
   * 获取追踪统计
   */
  getStats(): Readonly<TracingStats> {
    return { ...this.stats };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      spansCreated: 0,
      errorSpans: 0,
      activeSpans: 0,
    };
  }
}

// ============================================================================
// Global Instance
// ============================================================================

let globalTracingManager: TracingManager | null = null;

/**
 * 获取全局追踪管理器
 */
export function getTracingManager(): TracingManager {
  if (!globalTracingManager) {
    globalTracingManager = new TracingManager({
      serviceName: "automaton",
    });
  }
  return globalTracingManager;
}

/**
 * 设置全局追踪管理器
 */
export function setTracingManager(manager: TracingManager): void {
  globalTracingManager = manager;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 创建追踪 Span 的便捷函数
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: CreateSpanOptions
): Promise<T> {
  return getTracingManager().withSpan(name, fn, options);
}

/**
 * 创建子 Span 的便捷函数
 */
export async function withChildSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: CreateSpanOptions
): Promise<T> {
  return getTracingManager().withChildSpan(name, fn, options);
}

/**
 * 注入追踪上下文的便捷函数
 */
export function injectTraceContext(carrier: Record<string, string>): void {
  getTracingManager().injectContext(carrier);
}

/**
 * 提取追踪上下文的便捷函数
 */
export function extractTraceContext(carrier: Record<string, string>): TraceContext | null {
  return getTracingManager().extractContext(carrier);
}

// ============================================================================
// Default Export
// ============================================================================

export default TracingManager;
