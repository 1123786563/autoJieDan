/**
 * 性能基准测试工具
 * 用于测量和记录性能指标
 *
 * @module interagent.performance.benchmark
 * @version 1.0.0
 */

// ============================================================================
// Types
// ============================================================================

export interface BenchmarkOptions {
  /** 测试名称 */
  name: string;
  /** 迭代次数 */
  iterations?: number;
  /** 预热次数 */
  warmupIterations?: number;
  /** 超时时间 (毫秒) */
  timeoutMs?: number;
}

export interface BenchmarkResult {
  /** 测试名称 */
  name: string;
  /** 迭代次数 */
  iterations: number;
  /** 总耗时 (毫秒) */
  totalMs: number;
  /** 平均耗时 (毫秒) */
  avgMs: number;
  /** 最小耗时 (毫秒) */
  minMs: number;
  /** 最大耗时 (毫秒) */
  maxMs: number;
  /** P50 延迟 (毫秒) */
  p50Ms: number;
  /** P90 延迟 (毫秒) */
  p90Ms: number;
  /** P99 延迟 (毫秒) */
  p99Ms: number;
  /** 每秒操作数 */
  opsPerSecond: number;
  /** 标准差 (毫秒) */
  stdDevMs: number;
}

export interface PerformanceMetric {
  /** 指标名称 */
  name: string;
  /** 指标值 */
  value: number;
  /** 单位 */
  unit: string;
  /** 时间戳 */
  timestamp: Date;
  /** 标签 */
  tags?: Record<string, string>;
}

export interface PerformanceReport {
  /** 报告时间 */
  generatedAt: Date;
  /** 基准测试结果 */
  benchmarks: BenchmarkResult[];
  /** 性能指标 */
  metrics: PerformanceMetric[];
  /** 内存使用 */
  memoryUsage: NodeJS.MemoryUsage;
}

// ============================================================================
// BenchmarkRunner
// ============================================================================

/**
 * 基准测试运行器
 *
 * Example:
 * ```typescript
 * const runner = new BenchmarkRunner();
 *
 * const result = await runner.run({
 *   name: 'message-processing',
 *   iterations: 1000,
 * }, async () => {
 *   await processMessage(createTestMessage());
 * });
 *
 * console.log(`Ops/s: ${result.opsPerSecond}`);
 * ```
 */
export class BenchmarkRunner {
  private results: BenchmarkResult[] = new Map<string, BenchmarkResult>();

  /**
   * 运行基准测试
   */
  async run(
    options: BenchmarkOptions,
    fn: () => Promise<void> | void
  ): Promise<BenchmarkResult> {
    const iterations = options.iterations ?? 100;
    const warmupIterations = options.warmupIterations ?? 10;
    const timeoutMs = options.timeoutMs ?? 60000;

    // 预热
    for (let i = 0; i < warmupIterations; i++) {
      await fn();
    }

    // 正式测试
    const latencies: number[] = [];
    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
      if (Date.now() - startTime > timeoutMs) {
        break;
      }

      const iterStart = performance.now();
      await fn();
      const iterEnd = performance.now();
      latencies.push(iterEnd - iterStart);
    }

    // 计算统计
    const result = this.calculateStats(options.name, latencies);
    this.results.set(options.name, result);
    return result;
  }

  /**
   * 计算统计数据
   */
  private calculateStats(name: string, latencies: number[]): BenchmarkResult {
    const sorted = [...latencies].sort((a, b) => a - b);
    const totalMs = latencies.reduce((sum, v) => sum + v, 0);
    const avgMs = totalMs / latencies.length;

    // 标准差
    const variance =
      latencies.reduce((sum, v) => sum + Math.pow(v - avgMs, 2), 0) /
      latencies.length;
    const stdDevMs = Math.sqrt(variance);

    // 百分位数
    const percentile = (p: number): number => {
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)];
    };

    return {
      name,
      iterations: latencies.length,
      totalMs,
      avgMs,
      minMs: sorted[0] ?? 0,
      maxMs: sorted[sorted.length - 1] ?? 0,
      p50Ms: percentile(50),
      p90Ms: percentile(90),
      p99Ms: percentile(99),
      opsPerSecond: (latencies.length / totalMs) * 1000,
      stdDevMs,
    };
  }

  /**
   * 获取所有结果
   */
  getResults(): BenchmarkResult[] {
    return Array.from(this.results.values());
  }

  /**
   * 获取特定结果
   */
  getResult(name: string): BenchmarkResult | undefined {
    return this.results.get(name);
  }

  /**
   * 清除结果
   */
  clear(): void {
    this.results.clear();
  }

  /**
   * 比较两个基准测试
   */
  compare(name1: string, name2: string): {
    faster: string;
    improvement: number;
  } | null {
    const r1 = this.results.get(name1);
    const r2 = this.results.get(name2);

    if (!r1 || !r2) {
      return null;
    }

    if (r1.avgMs < r2.avgMs) {
      return {
        faster: name1,
        improvement: ((r2.avgMs - r1.avgMs) / r2.avgMs) * 100,
      };
    } else {
      return {
        faster: name2,
        improvement: ((r1.avgMs - r2.avgMs) / r1.avgMs) * 100,
      };
    }
  }
}

// ============================================================================
// PerformanceMonitor
// ============================================================================

/**
 * 性能监控器
 */
export class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private maxMetricsPerName = 1000;

  /**
   * 记录指标
   */
  record(
    name: string,
    value: number,
    unit: string,
    tags?: Record<string, string>
  ): void {
    const metric: PerformanceMetric = {
      name,
      value,
      unit,
      timestamp: new Date(),
      tags,
    };

    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metricsList = this.metrics.get(name)!;
    metricsList.push(metric);

    // 限制存储数量
    if (metricsList.length > this.maxMetricsPerName) {
      metricsList.shift();
    }
  }

  /**
   * 记录计时
   */
  time<T>(name: string, fn: () => Promise<T>): Promise<T>;
  time<T>(name: string, fn: () => T): T;
  async time<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    this.record(name, duration, "ms");
    return result;
  }

  /**
   * 获取指标
   */
  getMetrics(name: string): PerformanceMetric[] {
    return this.metrics.get(name) ?? [];
  }

  /**
   * 获取指标统计
   */
  getStats(name: string): {
    avg: number;
    min: number;
    max: number;
    count: number;
  } | null {
    const metrics = this.metrics.get(name);
    if (!metrics || metrics.length === 0) {
      return null;
    }

    const values = metrics.map((m) => m.value);
    return {
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length,
    };
  }

  /**
   * 生成报告
   */
  generateReport(): PerformanceReport {
    const allMetrics: PerformanceMetric[] = [];
    for (const metrics of this.metrics.values()) {
      allMetrics.push(...metrics);
    }

    return {
      generatedAt: new Date(),
      benchmarks: [],
      metrics: allMetrics,
      memoryUsage: process.memoryUsage(),
    };
  }

  /**
   * 清除所有指标
   */
  clear(): void {
    this.metrics.clear();
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 创建基准测试运行器
 */
export function createBenchmarkRunner(): BenchmarkRunner {
  return new BenchmarkRunner();
}

/**
 * 创建性能监控器
 */
export function createPerformanceMonitor(): PerformanceMonitor {
  return new PerformanceMonitor();
}

/**
 * 测量异步函数执行时间
 */
export async function measure<T>(
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

/**
 * 格式化基准测试结果
 */
export function formatBenchmarkResult(result: BenchmarkResult): string {
  return [
    `Benchmark: ${result.name}`,
    `  Iterations: ${result.iterations}`,
    `  Total: ${result.totalMs.toFixed(2)}ms`,
    `  Avg: ${result.avgMs.toFixed(3)}ms`,
    `  Min: ${result.minMs.toFixed(3)}ms`,
    `  Max: ${result.maxMs.toFixed(3)}ms`,
    `  P50: ${result.p50Ms.toFixed(3)}ms`,
    `  P90: ${result.p90Ms.toFixed(3)}ms`,
    `  P99: ${result.p99Ms.toFixed(3)}ms`,
    `  Ops/s: ${result.opsPerSecond.toFixed(2)}`,
    `  StdDev: ${result.stdDevMs.toFixed(3)}ms`,
  ].join("\n");
}
