"""
性能基准测试工具
用于测量和记录性能指标

@module interagent.performance.benchmark
@version 1.0.0
"""

import statistics
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional


# ============================================================================
# Types
# ============================================================================


@dataclass
class BenchmarkOptions:
    """基准测试选项"""

    name: str
    """测试名称"""

    iterations: int = 100
    """迭代次数"""

    warmup_iterations: int = 10
    """预热次数"""

    timeout_ms: float = 60000
    """超时时间 (毫秒)"""


@dataclass
class BenchmarkResult:
    """基准测试结果"""

    name: str
    """测试名称"""

    iterations: int
    """迭代次数"""

    total_ms: float
    """总耗时 (毫秒)"""

    avg_ms: float
    """平均耗时 (毫秒)"""

    min_ms: float
    """最小耗时 (毫秒)"""

    max_ms: float
    """最大耗时 (毫秒)"""

    p50_ms: float
    """P50 延迟 (毫秒)"""

    p90_ms: float
    """P90 延迟 (毫秒)"""

    p99_ms: float
    """P99 延迟 (毫秒)"""

    ops_per_second: float
    """每秒操作数"""

    std_dev_ms: float
    """标准差 (毫秒)"""


@dataclass
class PerformanceMetric:
    """性能指标"""

    name: str
    """指标名称"""

    value: float
    """指标值"""

    unit: str
    """单位"""

    timestamp: datetime
    """时间戳"""

    tags: Optional[Dict[str, str]] = None
    """标签"""


@dataclass
class PerformanceReport:
    """性能报告"""

    generated_at: datetime
    """报告时间"""

    benchmarks: List[BenchmarkResult]
    """基准测试结果"""

    metrics: List[PerformanceMetric]
    """性能指标"""


# ============================================================================
# BenchmarkRunner
# ============================================================================


class BenchmarkRunner:
    """
    基准测试运行器

    Example:
        runner = BenchmarkRunner()

        result = await runner.run(BenchmarkOptions(
            name='message-processing',
            iterations=1000,
        ), lambda: process_message(create_test_message()))

        print(f"Ops/s: {result.ops_per_second}")
    """

    def __init__(self):
        self._results: Dict[str, BenchmarkResult] = {}

    def run(
        self,
        options: BenchmarkOptions,
        fn: Callable[[], Any],
    ) -> BenchmarkResult:
        """
        运行基准测试

        Args:
            options: 测试选项
            fn: 测试函数

        Returns:
            测试结果
        """
        iterations = options.iterations
        warmup_iterations = options.warmup_iterations
        timeout_ms = options.timeout_ms

        # 预热
        for _ in range(warmup_iterations):
            fn()

        # 正式测试
        latencies: List[float] = []
        start_time = time.time()

        for _ in range(iterations):
            if (time.time() - start_time) * 1000 > timeout_ms:
                break

            iter_start = time.perf_counter()
            fn()
            iter_end = time.perf_counter()
            latencies.append((iter_end - iter_start) * 1000)

        # 计算统计
        result = self._calculate_stats(options.name, latencies)
        self._results[options.name] = result
        return result

    def _calculate_stats(self, name: str, latencies: List[float]) -> BenchmarkResult:
        """计算统计数据"""
        if not latencies:
            return BenchmarkResult(
                name=name,
                iterations=0,
                total_ms=0,
                avg_ms=0,
                min_ms=0,
                max_ms=0,
                p50_ms=0,
                p90_ms=0,
                p99_ms=0,
                ops_per_second=0,
                std_dev_ms=0,
            )

        sorted_latencies = sorted(latencies)
        total_ms = sum(latencies)
        avg_ms = total_ms / len(latencies)

        # 标准差
        std_dev_ms = statistics.stdev(latencies) if len(latencies) > 1 else 0

        # 百分位数
        def percentile(p: float) -> float:
            index = int((p / 100) * len(sorted_latencies)) - 1
            return sorted_latencies[max(0, index)]

        return BenchmarkResult(
            name=name,
            iterations=len(latencies),
            total_ms=total_ms,
            avg_ms=avg_ms,
            min_ms=sorted_latencies[0],
            max_ms=sorted_latencies[-1],
            p50_ms=percentile(50),
            p90_ms=percentile(90),
            p99_ms=percentile(99),
            ops_per_second=(len(latencies) / total_ms) * 1000 if total_ms > 0 else 0,
            std_dev_ms=std_dev_ms,
        )

    def get_results(self) -> List[BenchmarkResult]:
        """获取所有结果"""
        return list(self._results.values())

    def get_result(self, name: str) -> Optional[BenchmarkResult]:
        """获取特定结果"""
        return self._results.get(name)

    def clear(self) -> None:
        """清除结果"""
        self._results.clear()

    def compare(self, name1: str, name2: str) -> Optional[Dict[str, Any]]:
        """比较两个基准测试"""
        r1 = self._results.get(name1)
        r2 = self._results.get(name2)

        if not r1 or not r2:
            return None

        if r1.avg_ms < r2.avg_ms:
            return {
                "faster": name1,
                "improvement": ((r2.avg_ms - r1.avg_ms) / r2.avg_ms) * 100,
            }
        else:
            return {
                "faster": name2,
                "improvement": ((r1.avg_ms - r2.avg_ms) / r1.avg_ms) * 100,
            }


# ============================================================================
# PerformanceMonitor
# ============================================================================


class PerformanceMonitor:
    """性能监控器"""

    def __init__(self, max_metrics_per_name: int = 1000):
        self._metrics: Dict[str, List[PerformanceMetric]] = {}
        self._max_metrics_per_name = max_metrics_per_name

    def record(
        self,
        name: str,
        value: float,
        unit: str,
        tags: Optional[Dict[str, str]] = None,
    ) -> None:
        """记录指标"""
        metric = PerformanceMetric(
            name=name,
            value=value,
            unit=unit,
            timestamp=datetime.now(),
            tags=tags,
        )

        if name not in self._metrics:
            self._metrics[name] = []

        self._metrics[name].append(metric)

        # 限制存储数量
        if len(self._metrics[name]) > self._max_metrics_per_name:
            self._metrics[name].pop(0)

    def time(self, name: str, fn: Callable[[], Any]) -> Any:
        """记录计时"""
        start = time.perf_counter()
        result = fn()
        duration = (time.perf_counter() - start) * 1000
        self.record(name, duration, "ms")
        return result

    def get_metrics(self, name: str) -> List[PerformanceMetric]:
        """获取指标"""
        return self._metrics.get(name, [])

    def get_stats(self, name: str) -> Optional[Dict[str, float]]:
        """获取指标统计"""
        metrics = self._metrics.get(name)
        if not metrics:
            return None

        values = [m.value for m in metrics]
        return {
            "avg": sum(values) / len(values),
            "min": min(values),
            "max": max(values),
            "count": len(values),
        }

    def generate_report(self) -> PerformanceReport:
        """生成报告"""
        all_metrics: List[PerformanceMetric] = []
        for metrics in self._metrics.values():
            all_metrics.extend(metrics)

        return PerformanceReport(
            generated_at=datetime.now(),
            benchmarks=[],
            metrics=all_metrics,
        )

    def clear(self) -> None:
        """清除所有指标"""
        self._metrics.clear()


# ============================================================================
# Helper Functions
# ============================================================================


def create_benchmark_runner() -> BenchmarkRunner:
    """创建基准测试运行器"""
    return BenchmarkRunner()


def create_performance_monitor() -> PerformanceMonitor:
    """创建性能监控器"""
    return PerformanceMonitor()


def measure(fn: Callable[[], Any]) -> Dict[str, Any]:
    """测量函数执行时间"""
    start = time.perf_counter()
    result = fn()
    duration_ms = (time.perf_counter() - start) * 1000
    return {"result": result, "duration_ms": duration_ms}


def format_benchmark_result(result: BenchmarkResult) -> str:
    """格式化基准测试结果"""
    return "\n".join(
        [
            f"Benchmark: {result.name}",
            f"  Iterations: {result.iterations}",
            f"  Total: {result.total_ms:.2f}ms",
            f"  Avg: {result.avg_ms:.3f}ms",
            f"  Min: {result.min_ms:.3f}ms",
            f"  Max: {result.max_ms:.3f}ms",
            f"  P50: {result.p50_ms:.3f}ms",
            f"  P90: {result.p90_ms:.3f}ms",
            f"  P99: {result.p99_ms:.3f}ms",
            f"  Ops/s: {result.ops_per_second:.2f}",
            f"  StdDev: {result.std_dev_ms:.3f}ms",
        ]
    )
