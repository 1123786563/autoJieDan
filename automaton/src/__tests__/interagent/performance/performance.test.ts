/**
 * 性能优化模块测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ObjectPool,
  BufferPool,
  BatchProcessor,
  BenchmarkRunner,
  PerformanceMonitor,
  measure,
  formatBenchmarkResult,
  createObjectPool,
  createBufferPool,
  createBatchProcessor,
  createBenchmarkRunner,
  createPerformanceMonitor,
} from "../../../interagent/performance/index.js";

// ============================================================================
// ObjectPool Tests
// ============================================================================

describe("ObjectPool", () => {
  let pool: ObjectPool<{ data: string; count: number }>;

  beforeEach(() => {
    pool = new ObjectPool({
      factory: () => ({ data: "", count: 0 }),
      reset: (obj) => {
        obj.data = "";
        obj.count = 0;
      },
      initialSize: 5,
      maxSize: 10,
    });
  });

  describe("constructor", () => {
    it("should create pool with initial size", () => {
      expect(pool.available).toBe(5);
    });
  });

  describe("acquire", () => {
    it("should acquire object from pool", () => {
      const obj = pool.acquire();
      expect(obj).toBeDefined();
      expect(pool.inUse).toBe(1);
      expect(pool.available).toBe(4);
    });

    it("should create new object when pool is empty", () => {
      // 获取所有初始对象
      for (let i = 0; i < 5; i++) {
        pool.acquire();
      }
      expect(pool.available).toBe(0);

      // 获取新对象
      const obj = pool.acquire();
      expect(obj).toBeDefined();
      expect(pool.inUse).toBe(6);
    });
  });

  describe("release", () => {
    it("should release object back to pool", () => {
      const obj = pool.acquire();
      obj.data = "test";
      obj.count = 5;

      pool.release(obj);
      expect(pool.inUse).toBe(0);
      expect(pool.available).toBe(5);

      // 再次获取应该得到重置的对象
      const obj2 = pool.acquire();
      expect(obj2.data).toBe("");
      expect(obj2.count).toBe(0);
    });

    it("should not exceed max size", () => {
      const objects = [];
      for (let i = 0; i < 15; i++) {
        objects.push(pool.acquire());
      }

      // 释放所有
      objects.forEach((obj) => pool.release(obj));
      expect(pool.available).toBeLessThanOrEqual(10);
    });
  });

  describe("acquireBatch", () => {
    it("should acquire multiple objects", () => {
      const objects = pool.acquireBatch(3);
      expect(objects.length).toBe(3);
      expect(pool.inUse).toBe(3);
    });
  });

  describe("releaseBatch", () => {
    it("should release multiple objects", () => {
      const objects = pool.acquireBatch(3);
      pool.releaseBatch(objects);
      expect(pool.inUse).toBe(0);
    });
  });

  describe("getStats", () => {
    it("should return correct stats", () => {
      pool.acquire();
      pool.acquire();

      const stats = pool.getStats();
      expect(stats.inUse).toBe(2);
      expect(stats.available).toBe(3);
      expect(stats.totalAcquired).toBe(2);
    });

    it("should calculate hit rate", () => {
      pool.acquire();
      pool.acquire();

      const stats = pool.getStats();
      expect(stats.hitRate).toBe(1); // 100% hit rate
    });
  });

  describe("clear", () => {
    it("should clear pool", () => {
      pool.acquire();
      pool.clear();
      expect(pool.available).toBe(0);
      expect(pool.inUse).toBe(0);
    });
  });
});

// ============================================================================
// BufferPool Tests
// ============================================================================

describe("BufferPool", () => {
  let pool: BufferPool;

  beforeEach(() => {
    pool = new BufferPool({
      bufferSize: 1024,
      initialSize: 5,
      maxSize: 10,
    });
  });

  describe("constructor", () => {
    it("should create pool with specified buffer size", () => {
      expect(pool.getBufferSize()).toBe(1024);
      expect(pool.available).toBe(5);
    });
  });

  describe("acquire", () => {
    it("should acquire buffer of correct size", () => {
      const buffer = pool.acquire();
      expect(buffer.length).toBe(1024);
      expect(pool.inUse).toBe(1);
    });

    it("should return zeroed buffer", () => {
      const buffer = pool.acquire();
      for (let i = 0; i < buffer.length; i++) {
        expect(buffer[i]).toBe(0);
      }
    });
  });

  describe("release", () => {
    it("should release buffer back to pool", () => {
      const buffer = pool.acquire();
      pool.release(buffer);
      expect(pool.inUse).toBe(0);
      expect(pool.available).toBe(5);
    });
  });

  describe("getStats", () => {
    it("should return correct stats", () => {
      pool.acquire();
      pool.acquire();

      const stats = pool.getStats();
      expect(stats.inUse).toBe(2);
      expect(stats.available).toBe(3);
    });
  });
});

// ============================================================================
// BatchProcessor Tests
// ============================================================================

describe("BatchProcessor", () => {
  let processor: BatchProcessor<number, number>;

  beforeEach(() => {
    processor = new BatchProcessor({
      processor: async (items) => items.map((x) => x * 2),
      maxBatchSize: 5,
      maxWaitMs: 50,
    });
  });

  describe("add", () => {
    it("should process single item", async () => {
      const result = await processor.add(5);
      expect(result).toBe(10);
    });

    it("should process multiple items", async () => {
      const results = await Promise.all([
        processor.add(1),
        processor.add(2),
        processor.add(3),
      ]);
      expect(results).toEqual([2, 4, 6]);
    });
  });

  describe("addBatch", () => {
    it("should process batch of items", async () => {
      const results = await processor.addBatch([1, 2, 3, 4]);
      expect(results).toEqual([2, 4, 6, 8]);
    });
  });

  describe("getStats", () => {
    it("should track statistics", async () => {
      await processor.addBatch([1, 2, 3]);

      const stats = processor.getStats();
      expect(stats.totalItems).toBe(3);
      expect(stats.totalBatches).toBeGreaterThanOrEqual(1);
    });
  });

  describe("drain", () => {
    it("should wait for all pending items", async () => {
      processor.add(1);
      processor.add(2);
      await processor.drain();
      expect(processor.pendingCount).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should handle errors", async () => {
      const errorProcessor = new BatchProcessor({
        processor: async () => {
          throw new Error("Test error");
        },
        maxBatchSize: 5,
      });

      await expect(errorProcessor.add(1)).rejects.toThrow("Test error");
    });
  });
});

// ============================================================================
// BenchmarkRunner Tests
// ============================================================================

describe("BenchmarkRunner", () => {
  let runner: BenchmarkRunner;

  beforeEach(() => {
    runner = new BenchmarkRunner();
  });

  describe("run", () => {
    it("should run benchmark and return results", async () => {
      const result = await runner.run(
        {
          name: "test-benchmark",
          iterations: 100,
          warmupIterations: 10,
        },
        () => {
          // 简单计算
          let sum = 0;
          for (let i = 0; i < 100; i++) {
            sum += i;
          }
        }
      );

      expect(result.name).toBe("test-benchmark");
      expect(result.iterations).toBe(100);
      expect(result.avgMs).toBeGreaterThanOrEqual(0);
      expect(result.minMs).toBeLessThanOrEqual(result.maxMs);
      expect(result.opsPerSecond).toBeGreaterThan(0);
    });

    it("should calculate percentiles", async () => {
      const result = await runner.run(
        {
          name: "percentile-test",
          iterations: 100,
        },
        () => undefined
      );

      expect(result.p50Ms).toBeGreaterThanOrEqual(0);
      expect(result.p90Ms).toBeGreaterThanOrEqual(result.p50Ms);
      expect(result.p99Ms).toBeGreaterThanOrEqual(result.p90Ms);
    });
  });

  describe("getResults", () => {
    it("should return all results", async () => {
      await runner.run({ name: "test1", iterations: 10 }, () => undefined);
      await runner.run({ name: "test2", iterations: 10 }, () => undefined);

      const results = runner.getResults();
      expect(results.length).toBe(2);
    });
  });

  describe("compare", () => {
    it("should compare two benchmarks", async () => {
      await runner.run(
        { name: "fast", iterations: 100 },
        () => undefined
      );
      await runner.run(
        { name: "slow", iterations: 100 },
        () => {
          // 稍慢的操作
          let sum = 0;
          for (let i = 0; i < 1000; i++) {
            sum += i;
          }
        }
      );

      const comparison = runner.compare("fast", "slow");
      expect(comparison).toBeDefined();
    });
  });

  describe("clear", () => {
    it("should clear results", async () => {
      await runner.run({ name: "test", iterations: 10 }, () => undefined);
      runner.clear();
      expect(runner.getResults().length).toBe(0);
    });
  });
});

// ============================================================================
// PerformanceMonitor Tests
// ============================================================================

describe("PerformanceMonitor", () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor();
  });

  describe("record", () => {
    it("should record metric", () => {
      monitor.record("test-metric", 100, "ms");
      const metrics = monitor.getMetrics("test-metric");
      expect(metrics.length).toBe(1);
      expect(metrics[0].value).toBe(100);
      expect(metrics[0].unit).toBe("ms");
    });

    it("should record metric with tags", () => {
      monitor.record("test-metric", 50, "ms", { env: "test" });
      const metrics = monitor.getMetrics("test-metric");
      expect(metrics[0].tags).toEqual({ env: "test" });
    });
  });

  describe("time", () => {
    it("should measure execution time", async () => {
      const result = await monitor.time("test-operation", () => {
        let sum = 0;
        for (let i = 0; i < 1000; i++) {
          sum += i;
        }
        return sum;
      });

      expect(result).toBe(499500);
      const stats = monitor.getStats("test-operation");
      expect(stats).not.toBeNull();
      expect(stats!.avg).toBeGreaterThan(0);
    });
  });

  describe("getStats", () => {
    it("should return null for unknown metric", () => {
      const stats = monitor.getStats("unknown");
      expect(stats).toBeNull();
    });

    it("should calculate statistics", () => {
      monitor.record("test", 10, "ms");
      monitor.record("test", 20, "ms");
      monitor.record("test", 30, "ms");

      const stats = monitor.getStats("test");
      expect(stats!.avg).toBe(20);
      expect(stats!.min).toBe(10);
      expect(stats!.max).toBe(30);
      expect(stats!.count).toBe(3);
    });
  });

  describe("generateReport", () => {
    it("should generate report", () => {
      monitor.record("test1", 10, "ms");
      monitor.record("test2", 20, "ms");

      const report = monitor.generateReport();
      expect(report.metrics.length).toBe(2);
    });
  });

  describe("clear", () => {
    it("should clear all metrics", () => {
      monitor.record("test", 10, "ms");
      monitor.clear();
      expect(monitor.getMetrics("test").length).toBe(0);
    });
  });
});

// ============================================================================
// Helper Functions Tests
// ============================================================================

describe("Helper Functions", () => {
  describe("createObjectPool", () => {
    it("should create object pool", () => {
      const pool = createObjectPool({
        factory: () => ({ value: 0 }),
      });
      expect(pool).toBeInstanceOf(ObjectPool);
    });
  });

  describe("createBufferPool", () => {
    it("should create buffer pool", () => {
      const pool = createBufferPool({ bufferSize: 1024 });
      expect(pool).toBeInstanceOf(BufferPool);
    });
  });

  describe("createBatchProcessor", () => {
    it("should create batch processor", () => {
      const processor = createBatchProcessor({
        processor: async (items) => items,
      });
      expect(processor).toBeInstanceOf(BatchProcessor);
    });
  });

  describe("measure", () => {
    it("should measure execution time", async () => {
      const { result, durationMs } = await measure(async () => {
        return 42;
      });
      expect(result).toBe(42);
      expect(durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("formatBenchmarkResult", () => {
    it("should format result", () => {
      const result = {
        name: "test",
        iterations: 100,
        totalMs: 1000,
        avgMs: 10,
        minMs: 5,
        maxMs: 20,
        p50Ms: 9,
        p90Ms: 15,
        p99Ms: 19,
        opsPerSecond: 100,
        stdDevMs: 3,
      };
      const formatted = formatBenchmarkResult(result as any);
      expect(formatted).toContain("test");
      expect(formatted).toContain("100");
      expect(formatted).toContain("Ops/s");
    });
  });
});
