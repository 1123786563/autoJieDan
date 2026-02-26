/**
 * 性能优化模块
 * 提供对象池、批量处理、基准测试等工具
 *
 * @module interagent.performance
 */

export {
  ObjectPool,
  BufferPool,
  PoolOptions,
  BufferPoolOptions,
  PoolStats,
  createObjectPool,
  createBufferPool,
} from "./pool.js";

export {
  BatchProcessor,
  ThrottledBatchProcessor,
  BatchProcessorOptions,
  BatchResult,
  BatchStats,
  createBatchProcessor,
} from "./batch.js";

export {
  BenchmarkRunner,
  PerformanceMonitor,
  BenchmarkOptions,
  BenchmarkResult,
  PerformanceMetric,
  PerformanceReport,
  createBenchmarkRunner,
  createPerformanceMonitor,
  measure,
  formatBenchmarkResult,
} from "./benchmark.js";
