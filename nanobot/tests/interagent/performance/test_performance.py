"""
性能优化模块测试
"""

import asyncio
import pytest

from nanobot.interagent.performance.pool import (
    ObjectPool,
    BufferPool,
    create_object_pool,
    create_buffer_pool,
)
from nanobot.interagent.performance.batch import (
    BatchProcessor,
    create_batch_processor,
)
from nanobot.interagent.performance.benchmark import (
    BenchmarkRunner,
    BenchmarkOptions,
    PerformanceMonitor,
    measure,
    format_benchmark_result,
    create_benchmark_runner,
    create_performance_monitor,
)


# ============================================================================
# ObjectPool Tests
# ============================================================================


class TestObjectPool:
    """ObjectPool 测试"""

    @pytest.fixture
    def pool(self):
        """创建对象池"""
        return ObjectPool(
            factory=lambda: {"data": "", "count": 0},
            reset=lambda obj: obj.update({"data": "", "count": 0}),
            initial_size=5,
            max_size=10,
        )

    def test_create_with_initial_size(self, pool):
        """应该创建指定初始大小的池"""
        assert pool.available == 5

    def test_acquire(self, pool):
        """应该从池中获取对象"""
        obj = pool.acquire()
        assert obj is not None
        assert pool.in_use == 1
        assert pool.available == 4

    def test_acquire_creates_new_when_empty(self, pool):
        """池空时应该创建新对象"""
        for _ in range(5):
            pool.acquire()
        assert pool.available == 0

        obj = pool.acquire()
        assert obj is not None
        assert pool.in_use == 6

    def test_release(self, pool):
        """应该释放对象回池"""
        obj = pool.acquire()
        obj["data"] = "test"
        obj["count"] = 5

        pool.release(obj)
        assert pool.in_use == 0
        assert pool.available == 5

        obj2 = pool.acquire()
        assert obj2["data"] == ""
        assert obj2["count"] == 0

    def test_release_respects_max_size(self, pool):
        """释放时不应该超过最大大小"""
        objects = []
        for _ in range(15):
            objects.append(pool.acquire())

        for obj in objects:
            pool.release(obj)

        assert pool.available <= 10

    def test_acquire_batch(self, pool):
        """应该批量获取对象"""
        objects = pool.acquire_batch(3)
        assert len(objects) == 3
        assert pool.in_use == 3

    def test_release_batch(self, pool):
        """应该批量释放对象"""
        objects = pool.acquire_batch(3)
        pool.release_batch(objects)
        assert pool.in_use == 0

    def test_get_stats(self, pool):
        """应该返回正确的统计"""
        pool.acquire()
        pool.acquire()

        stats = pool.get_stats()
        assert stats.in_use == 2
        assert stats.available == 3
        assert stats.total_acquired == 2

    def test_hit_rate(self, pool):
        """应该计算命中率"""
        pool.acquire()
        pool.acquire()

        stats = pool.get_stats()
        assert stats.hit_rate == 1.0  # 100% hit rate

    def test_clear(self, pool):
        """应该清空池"""
        pool.acquire()
        pool.clear()
        assert pool.available == 0
        assert pool.in_use == 0


# ============================================================================
# BufferPool Tests
# ============================================================================


class TestBufferPool:
    """BufferPool 测试"""

    @pytest.fixture
    def pool(self):
        """创建 Buffer 池"""
        return BufferPool(
            buffer_size=1024,
            initial_size=5,
            max_size=10,
        )

    def test_create_with_buffer_size(self, pool):
        """应该创建指定大小的 Buffer 池"""
        assert pool.buffer_size == 1024
        assert pool.available == 5

    def test_acquire(self, pool):
        """应该获取正确大小的 Buffer"""
        buffer = pool.acquire()
        assert len(buffer) == 1024
        assert pool.in_use == 1

    def test_acquire_returns_zeroed_buffer(self, pool):
        """应该返回清零的 Buffer"""
        buffer = pool.acquire()
        for i in range(len(buffer)):
            assert buffer[i] == 0

    def test_release(self, pool):
        """应该释放 Buffer 回池"""
        buffer = pool.acquire()
        pool.release(buffer)
        assert pool.in_use == 0
        assert pool.available == 5

    def test_get_stats(self, pool):
        """应该返回正确的统计"""
        pool.acquire()
        pool.acquire()

        stats = pool.get_stats()
        assert stats.in_use == 2
        assert stats.available == 3


# ============================================================================
# BatchProcessor Tests
# ============================================================================


class TestBatchProcessor:
    """BatchProcessor 测试"""

    @pytest.fixture
    def processor(self):
        """创建批量处理器"""
        return BatchProcessor(
            processor=lambda items: [x * 2 for x in items],
            max_batch_size=5,
            max_wait_ms=50,
        )

    @pytest.mark.asyncio
    async def test_add_single_item(self, processor):
        """应该处理单个项目"""
        result = await processor.add(5)
        assert result == 10

    @pytest.mark.asyncio
    async def test_add_multiple_items(self, processor):
        """应该处理多个项目"""
        results = await asyncio.gather(
            processor.add(1),
            processor.add(2),
            processor.add(3),
        )
        assert results == [2, 4, 6]

    @pytest.mark.asyncio
    async def test_add_batch(self, processor):
        """应该处理批量项目"""
        results = await processor.add_batch([1, 2, 3, 4])
        assert results == [2, 4, 6, 8]

    @pytest.mark.asyncio
    async def test_get_stats(self, processor):
        """应该跟踪统计"""
        await processor.add_batch([1, 2, 3])

        stats = processor.get_stats()
        assert stats.total_items == 3
        assert stats.total_batches >= 1

    @pytest.mark.asyncio
    async def test_drain(self, processor):
        """应该等待所有待处理项目"""
        processor.add(1)
        processor.add(2)
        await processor.drain()
        assert processor.pending_count == 0

    @pytest.mark.asyncio
    async def test_error_handling(self):
        """应该处理错误"""
        error_processor = BatchProcessor(
            processor=lambda items: (_ for _ in ()).throw(Exception("Test error")),
            max_batch_size=5,
        )

        with pytest.raises(Exception, match="Test error"):
            await error_processor.add(1)


# ============================================================================
# BenchmarkRunner Tests
# ============================================================================


class TestBenchmarkRunner:
    """BenchmarkRunner 测试"""

    @pytest.fixture
    def runner(self):
        """创建基准测试运行器"""
        return BenchmarkRunner()

    def test_run_benchmark(self, runner):
        """应该运行基准测试并返回结果"""
        result = runner.run(
            BenchmarkOptions(
                name="test-benchmark",
                iterations=100,
                warmup_iterations=10,
            ),
            lambda: sum(range(100)),
        )

        assert result.name == "test-benchmark"
        assert result.iterations == 100
        assert result.avg_ms >= 0
        assert result.min_ms <= result.max_ms
        assert result.ops_per_second > 0

    def test_percentiles(self, runner):
        """应该计算百分位数"""
        result = runner.run(
            BenchmarkOptions(name="percentile-test", iterations=100),
            lambda: None,
        )

        assert result.p50_ms >= 0
        assert result.p90_ms >= result.p50_ms
        assert result.p99_ms >= result.p90_ms

    def test_get_results(self, runner):
        """应该返回所有结果"""
        runner.run(BenchmarkOptions(name="test1", iterations=10), lambda: None)
        runner.run(BenchmarkOptions(name="test2", iterations=10), lambda: None)

        results = runner.get_results()
        assert len(results) == 2

    def test_compare(self, runner):
        """应该比较两个基准测试"""
        runner.run(BenchmarkOptions(name="fast", iterations=100), lambda: None)
        runner.run(
            BenchmarkOptions(name="slow", iterations=100),
            lambda: sum(range(1000)),
        )

        comparison = runner.compare("fast", "slow")
        assert comparison is not None

    def test_clear(self, runner):
        """应该清除结果"""
        runner.run(BenchmarkOptions(name="test", iterations=10), lambda: None)
        runner.clear()
        assert len(runner.get_results()) == 0


# ============================================================================
# PerformanceMonitor Tests
# ============================================================================


class TestPerformanceMonitor:
    """PerformanceMonitor 测试"""

    @pytest.fixture
    def monitor(self):
        """创建性能监控器"""
        return PerformanceMonitor()

    def test_record_metric(self, monitor):
        """应该记录指标"""
        monitor.record("test-metric", 100, "ms")
        metrics = monitor.get_metrics("test-metric")
        assert len(metrics) == 1
        assert metrics[0].value == 100
        assert metrics[0].unit == "ms"

    def test_record_metric_with_tags(self, monitor):
        """应该记录带标签的指标"""
        monitor.record("test-metric", 50, "ms", {"env": "test"})
        metrics = monitor.get_metrics("test-metric")
        assert metrics[0].tags == {"env": "test"}

    def test_time_execution(self, monitor):
        """应该测量执行时间"""
        result = monitor.time("test-operation", lambda: sum(range(1000)))

        assert result == 499500
        stats = monitor.get_stats("test-operation")
        assert stats is not None
        assert stats["avg"] > 0

    def test_get_stats_unknown_metric(self, monitor):
        """未知指标应该返回 None"""
        stats = monitor.get_stats("unknown")
        assert stats is None

    def test_get_stats_calculates_statistics(self, monitor):
        """应该计算统计数据"""
        monitor.record("test", 10, "ms")
        monitor.record("test", 20, "ms")
        monitor.record("test", 30, "ms")

        stats = monitor.get_stats("test")
        assert stats["avg"] == 20
        assert stats["min"] == 10
        assert stats["max"] == 30
        assert stats["count"] == 3

    def test_generate_report(self, monitor):
        """应该生成报告"""
        monitor.record("test1", 10, "ms")
        monitor.record("test2", 20, "ms")

        report = monitor.generate_report()
        assert len(report.metrics) == 2

    def test_clear(self, monitor):
        """应该清除所有指标"""
        monitor.record("test", 10, "ms")
        monitor.clear()
        assert len(monitor.get_metrics("test")) == 0


# ============================================================================
# Helper Functions Tests
# ============================================================================


class TestHelperFunctions:
    """辅助函数测试"""

    def test_create_object_pool(self):
        """应该创建对象池"""
        pool = create_object_pool(factory=lambda: {"value": 0})
        assert isinstance(pool, ObjectPool)

    def test_create_buffer_pool(self):
        """应该创建 Buffer 池"""
        pool = create_buffer_pool(buffer_size=1024)
        assert isinstance(pool, BufferPool)

    def test_create_batch_processor(self):
        """应该创建批量处理器"""
        processor = create_batch_processor(processor=lambda items: items)
        assert isinstance(processor, BatchProcessor)

    def test_create_benchmark_runner(self):
        """应该创建基准测试运行器"""
        runner = create_benchmark_runner()
        assert isinstance(runner, BenchmarkRunner)

    def test_create_performance_monitor(self):
        """应该创建性能监控器"""
        monitor = create_performance_monitor()
        assert isinstance(monitor, PerformanceMonitor)

    def test_measure(self):
        """应该测量执行时间"""
        result = measure(lambda: 42)
        assert result["result"] == 42
        assert result["duration_ms"] >= 0

    def test_format_benchmark_result(self):
        """应该格式化结果"""
        from nanobot.interagent.performance.benchmark import BenchmarkResult

        result = BenchmarkResult(
            name="test",
            iterations=100,
            total_ms=1000,
            avg_ms=10,
            min_ms=5,
            max_ms=20,
            p50_ms=9,
            p90_ms=15,
            p99_ms=19,
            ops_per_second=100,
            std_dev_ms=3,
        )
        formatted = format_benchmark_result(result)
        assert "test" in formatted
        assert "100" in formatted
        assert "Ops/s" in formatted
