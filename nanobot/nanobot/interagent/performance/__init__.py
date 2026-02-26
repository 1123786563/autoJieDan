"""
性能优化模块
提供对象池、批量处理、基准测试等工具

@module interagent.performance
"""

from nanobot.interagent.performance.pool import (
    ObjectPool,
    BufferPool,
    PoolStats,
    create_object_pool,
    create_buffer_pool,
)

from nanobot.interagent.performance.batch import (
    BatchProcessor,
    ThrottledBatchProcessor,
    BatchResult,
    BatchStats,
    create_batch_processor,
)

from nanobot.interagent.performance.benchmark import (
    BenchmarkRunner,
    BenchmarkOptions,
    BenchmarkResult,
    PerformanceMonitor,
    PerformanceMetric,
    PerformanceReport,
    create_benchmark_runner,
    create_performance_monitor,
    measure,
    format_benchmark_result,
)

__all__ = [
    # Pool
    "ObjectPool",
    "BufferPool",
    "PoolStats",
    "create_object_pool",
    "create_buffer_pool",
    # Batch
    "BatchProcessor",
    "ThrottledBatchProcessor",
    "BatchResult",
    "BatchStats",
    "create_batch_processor",
    # Benchmark
    "BenchmarkRunner",
    "BenchmarkOptions",
    "BenchmarkResult",
    "PerformanceMonitor",
    "PerformanceMetric",
    "PerformanceReport",
    "create_benchmark_runner",
    "create_performance_monitor",
    "measure",
    "format_benchmark_result",
]
