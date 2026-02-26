"""
OpenTelemetry 分布式追踪模块
实现跨服务的分布式追踪能力

@module interagent.tracing
@version 1.0.0
"""

from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Callable, TypeVar, ParamSpec
from contextlib import asynccontextmanager, contextmanager
from functools import wraps
import os

# OpenTelemetry 类型（延迟导入以支持可选依赖）
try:
    from opentelemetry import trace
    from opentelemetry.trace import Span, StatusCode, SpanKind
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
    from opentelemetry.sdk.resources import Resource

    OPENTELEMETRY_AVAILABLE = True
except ImportError:
    OPENTELEMETRY_AVAILABLE = False
    trace = None  # type: ignore
    Span = None  # type: ignore
    StatusCode = None  # type: ignore
    SpanKind = None  # type: ignore

P = ParamSpec("P")
T = TypeVar("T")


# ============================================================================
# Types
# ============================================================================


@dataclass
class TracingConfig:
    """追踪配置"""

    service_name: str = "nanobot"
    """服务名称"""

    jaeger_host: str = "localhost"
    """Jaeger 主机"""

    jaeger_port: int = 6831
    """Jaeger 端口"""

    sampling_rate: float = 1.0
    """采样率 (0-1)"""

    enabled: bool = True
    """是否启用追踪"""

    console_export: bool = False
    """是否导出到控制台（调试用）"""


@dataclass
class TraceContext:
    """追踪上下文"""

    trace_id: str
    """Trace ID"""

    span_id: str
    """Span ID"""

    sampled: bool = True
    """采样标志"""


@dataclass
class TracingStats:
    """追踪统计"""

    spans_created: int = 0
    """创建的 Span 数量"""

    error_spans: int = 0
    """错误 Span 数量"""

    active_spans: int = 0
    """活跃 Span 数量"""


# ============================================================================
# TracingManager Class
# ============================================================================


class TracingManager:
    """
    追踪管理器

    管理分布式追踪功能，提供 Span 创建、上下文传播等能力

    Example:
        tracing = TracingManager(TracingConfig(service_name="my-service"))

        # 创建 Span
        async with tracing.span("operation") as span:
            span.set_attribute("key", "value")
            # 执行操作

        # 传播上下文
        headers = {}
        tracing.inject_context(headers)
    """

    def __init__(self, config: Optional[TracingConfig] = None):
        """
        初始化追踪管理器

        Args:
            config: 追踪配置，默认使用空配置
        """
        self.config = config or TracingConfig()
        self.enabled = self.config.enabled and OPENTELEMETRY_AVAILABLE
        self._tracer = None
        self._stats = TracingStats()

        if self.enabled and trace:
            self._init_tracer()

    def _init_tracer(self) -> None:
        """初始化 OpenTelemetry Tracer"""
        if not OPENTELEMETRY_AVAILABLE or not trace:
            return

        resource = Resource.create({"service.name": self.config.service_name})
        provider = TracerProvider(resource=resource)

        # 控制台导出器（调试用）
        if self.config.console_export:
            console_exporter = ConsoleSpanExporter()
            provider.add_span_processor(BatchSpanProcessor(console_exporter))

        trace.set_tracer_provider(provider)
        self._tracer = trace.get_tracer(__name__)

    def is_enabled(self) -> bool:
        """检查追踪是否启用"""
        return self.enabled

    def enable(self) -> None:
        """启用追踪"""
        self.enabled = OPENTELEMETRY_AVAILABLE

    def disable(self) -> None:
        """禁用追踪"""
        self.enabled = False

    def get_tracer(self):
        """获取 Tracer 实例"""
        if not self.enabled or not self._tracer:
            return None
        return self._tracer

    def get_active_span(self) -> Optional[Any]:
        """获取当前活跃的 Span"""
        if not self.enabled or not trace:
            return None
        return trace.get_current_span()

    @asynccontextmanager
    async def span(
        self,
        name: str,
        attributes: Optional[Dict[str, Any]] = None,
        kind: Optional[str] = None,
    ):
        """
        创建异步 Span

        Args:
            name: Span 名称
            attributes: Span 属性
            kind: Span 类型

        Yields:
            Span 实例或 Mock 对象
        """
        if not self.enabled or not self._tracer:
            yield _MockSpan()
            return

        span_kind = self._get_span_kind(kind)
        with self._tracer.start_as_current_span(name, kind=span_kind) as span:
            self._stats.spans_created += 1
            self._stats.active_spans += 1

            if attributes:
                for key, value in attributes.items():
                    span.set_attribute(key, value)

            try:
                yield span
                span.set_status(StatusCode.OK)
            except Exception as e:
                self._stats.error_spans += 1
                span.set_status(StatusCode.ERROR, str(e))
                span.record_exception(e)
                raise
            finally:
                self._stats.active_spans -= 1

    @contextmanager
    def sync_span(
        self,
        name: str,
        attributes: Optional[Dict[str, Any]] = None,
        kind: Optional[str] = None,
    ):
        """
        创建同步 Span

        Args:
            name: Span 名称
            attributes: Span 属性
            kind: Span 类型

        Yields:
            Span 实例或 Mock 对象
        """
        if not self.enabled or not self._tracer:
            yield _MockSpan()
            return

        span_kind = self._get_span_kind(kind)
        with self._tracer.start_as_current_span(name, kind=span_kind) as span:
            self._stats.spans_created += 1
            self._stats.active_spans += 1

            if attributes:
                for key, value in attributes.items():
                    span.set_attribute(key, value)

            try:
                yield span
                span.set_status(StatusCode.OK)
            except Exception as e:
                self._stats.error_spans += 1
                span.set_status(StatusCode.ERROR, str(e))
                span.record_exception(e)
                raise
            finally:
                self._stats.active_spans -= 1

    def _get_span_kind(self, kind: Optional[str]) -> Any:
        """获取 Span 类型"""
        if not SpanKind or not kind:
            return SpanKind.INTERNAL if SpanKind else None

        kind_map = {
            "internal": SpanKind.INTERNAL,
            "server": SpanKind.SERVER,
            "client": SpanKind.CLIENT,
            "producer": SpanKind.PRODUCER,
            "consumer": SpanKind.CONSUMER,
        }
        return kind_map.get(kind, SpanKind.INTERNAL)

    def inject_context(self, carrier: Dict[str, str]) -> None:
        """
        注入追踪上下文到载体

        Args:
            carrier: 载体对象 (如 HTTP headers)
        """
        if not self.enabled or not trace:
            return

        span = trace.get_current_span()
        if not span or not span.is_recording():
            return

        span_context = span.get_span_context()
        # W3C Trace Context 格式
        carrier["traceparent"] = f"00-{span_context.trace_id}-{span_context.span_id}-01"

    def extract_context(self, carrier: Dict[str, str]) -> Optional[TraceContext]:
        """
        从载体提取追踪上下文

        Args:
            carrier: 载体对象 (如 HTTP headers)

        Returns:
            追踪上下文或 None
        """
        traceparent = carrier.get("traceparent")
        if not traceparent:
            return None

        # 解析 W3C Trace Context 格式
        import re

        match = re.match(
            r"^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$",
            traceparent,
            re.IGNORECASE,
        )
        if not match:
            return None

        return TraceContext(
            trace_id=match.group(2),
            span_id=match.group(3),
            sampled=match.group(4) == "01",
        )

    def add_event(self, name: str, attributes: Optional[Dict[str, Any]] = None) -> None:
        """
        添加 Span 事件

        Args:
            name: 事件名称
            attributes: 事件属性
        """
        if not self.enabled:
            return

        span = self.get_active_span()
        if span and hasattr(span, "add_event"):
            span.add_event(name, attributes or {})

    def set_attribute(self, key: str, value: Any) -> None:
        """
        设置 Span 属性

        Args:
            key: 属性名
            value: 属性值
        """
        if not self.enabled:
            return

        span = self.get_active_span()
        if span:
            span.set_attribute(key, value)

    def record_exception(self, error: Exception) -> None:
        """
        记录异常

        Args:
            error: 异常对象
        """
        if not self.enabled:
            return

        span = self.get_active_span()
        if span and hasattr(span, "record_exception"):
            span.record_exception(error)
            span.set_status(StatusCode.ERROR, str(error))

    def get_stats(self) -> TracingStats:
        """获取追踪统计"""
        return TracingStats(
            spans_created=self._stats.spans_created,
            error_spans=self._stats.error_spans,
            active_spans=self._stats.active_spans,
        )

    def reset_stats(self) -> None:
        """重置统计"""
        self._stats = TracingStats()


# ============================================================================
# Mock Span (用于追踪禁用时)
# ============================================================================


class _MockSpan:
    """Mock Span，用于追踪禁用时"""

    def set_attribute(self, key: str, value: Any) -> None:
        pass

    def add_event(self, name: str, attributes: Optional[Dict[str, Any]] = None) -> None:
        pass

    def set_status(self, status: Any, description: Optional[str] = None) -> None:
        pass

    def record_exception(self, exception: Exception) -> None:
        pass

    def is_recording(self) -> bool:
        return False


# ============================================================================
# Global Instance
# ============================================================================

_global_tracing_manager: Optional[TracingManager] = None


def get_tracing_manager() -> TracingManager:
    """获取全局追踪管理器"""
    global _global_tracing_manager
    if _global_tracing_manager is None:
        _global_tracing_manager = TracingManager()
    return _global_tracing_manager


def set_tracing_manager(manager: TracingManager) -> None:
    """设置全局追踪管理器"""
    global _global_tracing_manager
    _global_tracing_manager = manager


# ============================================================================
# Helper Functions
# ============================================================================


@asynccontextmanager
async def span(
    name: str,
    attributes: Optional[Dict[str, Any]] = None,
    kind: Optional[str] = None,
):
    """创建追踪 Span 的便捷函数"""
    manager = get_tracing_manager()
    async with manager.span(name, attributes, kind) as s:
        yield s


def inject_trace_context(carrier: Dict[str, str]) -> None:
    """注入追踪上下文的便捷函数"""
    get_tracing_manager().inject_context(carrier)


def extract_trace_context(carrier: Dict[str, str]) -> Optional[TraceContext]:
    """提取追踪上下文的便捷函数"""
    return get_tracing_manager().extract_context(carrier)
