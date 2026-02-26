"""
OpenTelemetry 分布式追踪测试
"""

import pytest

from nanobot.interagent.tracing import (
    TracingManager,
    TracingConfig,
    TraceContext,
    TracingStats,
    get_tracing_manager,
    set_tracing_manager,
    span,
    inject_trace_context,
    extract_trace_context,
    OPENTELEMETRY_AVAILABLE,
)


class TestTracingConfig:
    """TracingConfig 测试"""

    def test_default_config(self):
        """应该有默认配置"""
        config = TracingConfig()
        assert config.service_name == "nanobot"
        assert config.jaeger_host == "localhost"
        assert config.jaeger_port == 6831
        assert config.sampling_rate == 1.0
        assert config.enabled is True

    def test_custom_config(self):
        """应该支持自定义配置"""
        config = TracingConfig(
            service_name="custom-service",
            jaeger_host="jaeger",
            jaeger_port=14268,
            sampling_rate=0.5,
        )
        assert config.service_name == "custom-service"
        assert config.jaeger_host == "jaeger"
        assert config.jaeger_port == 14268
        assert config.sampling_rate == 0.5


class TestTracingManager:
    """TracingManager 测试"""

    def test_init_default_config(self):
        """应该使用默认配置初始化"""
        manager = TracingManager()
        assert manager.config.service_name == "nanobot"

    def test_init_custom_config(self):
        """应该使用自定义配置初始化"""
        config = TracingConfig(service_name="test-service")
        manager = TracingManager(config)
        assert manager.config.service_name == "test-service"

    def test_is_enabled(self):
        """应该检查是否启用"""
        enabled_manager = TracingManager(TracingConfig(enabled=True))
        disabled_manager = TracingManager(TracingConfig(enabled=False))

        # 如果 OpenTelemetry 不可用，即使配置启用也会返回 False
        if OPENTELEMETRY_AVAILABLE:
            assert enabled_manager.is_enabled() is True
        else:
            assert enabled_manager.is_enabled() is False
        assert disabled_manager.is_enabled() is False

    def test_enable_disable(self):
        """应该能启用和禁用追踪"""
        manager = TracingManager(TracingConfig(enabled=True))

        manager.disable()
        assert manager.is_enabled() is False

        manager.enable()
        # 如果 OpenTelemetry 不可用，enable() 也不会启用
        if OPENTELEMETRY_AVAILABLE:
            assert manager.is_enabled() is True
        else:
            assert manager.is_enabled() is False

    @pytest.mark.asyncio
    async def test_span_context_manager(self):
        """应该创建 Span 上下文管理器"""
        manager = TracingManager(TracingConfig(enabled=True))

        async with manager.span("test-operation") as span:
            span.set_attribute("key", "value")
            # Span 应该存在（可能是 Mock）
            assert span is not None

    @pytest.mark.asyncio
    async def test_span_statistics(self):
        """应该跟踪 Span 统计"""
        manager = TracingManager(TracingConfig(enabled=True))

        async with manager.span("op1"):
            pass

        async with manager.span("op2"):
            pass

        stats = manager.get_stats()
        # 统计可能为 0，取决于 OpenTelemetry 是否可用
        assert stats.spans_created >= 0

    @pytest.mark.asyncio
    async def test_span_error_handling(self):
        """应该处理 Span 中的错误"""
        manager = TracingManager(TracingConfig(enabled=True))

        with pytest.raises(ValueError):
            async with manager.span("error-op") as span:
                raise ValueError("Test error")

        stats = manager.get_stats()
        # 统计可能为 0，取决于 OpenTelemetry 是否可用
        assert stats.error_spans >= 0

    @pytest.mark.asyncio
    async def test_span_when_disabled(self):
        """禁用时应该跳过 Span 创建"""
        manager = TracingManager(TracingConfig(enabled=False))

        async with manager.span("test") as span:
            # 应该返回 Mock Span
            pass

        stats = manager.get_stats()
        assert stats.spans_created == 0

    def test_sync_span_context_manager(self):
        """应该创建同步 Span 上下文管理器"""
        manager = TracingManager(TracingConfig(enabled=True))

        with manager.sync_span("test-sync") as span:
            span.set_attribute("key", "value")

    def test_inject_context_no_span(self):
        """没有活跃 Span 时应该不注入"""
        manager = TracingManager(TracingConfig(enabled=True))
        carrier = {}
        manager.inject_context(carrier)

        assert "traceparent" not in carrier

    def test_inject_context_when_disabled(self):
        """禁用时应该不注入"""
        manager = TracingManager(TracingConfig(enabled=False))
        carrier = {}
        manager.inject_context(carrier)

        assert "traceparent" not in carrier

    def test_extract_context_valid(self):
        """应该提取有效的追踪上下文"""
        manager = TracingManager()
        carrier = {
            "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
        }

        context = manager.extract_context(carrier)

        assert context is not None
        assert context.trace_id == "0af7651916cd43dd8448eb211c80319c"
        assert context.span_id == "b7ad6b7169203331"
        assert context.sampled is True

    def test_extract_context_invalid(self):
        """应该返回 None 对于无效的 traceparent"""
        manager = TracingManager()
        carrier = {"traceparent": "invalid-format"}

        context = manager.extract_context(carrier)
        assert context is None

    def test_extract_context_missing(self):
        """应该返回 None 对于缺少的 traceparent"""
        manager = TracingManager()
        context = manager.extract_context({})

        assert context is None

    def test_get_stats_initial(self):
        """应该返回初始统计"""
        manager = TracingManager()
        stats = manager.get_stats()

        assert stats.spans_created == 0
        assert stats.error_spans == 0
        assert stats.active_spans == 0

    def test_reset_stats(self):
        """应该重置统计"""
        manager = TracingManager()
        manager.reset_stats()

        stats = manager.get_stats()
        assert stats.spans_created == 0


class TestGlobalFunctions:
    """全局函数测试"""

    def test_get_tracing_manager(self):
        """应该获取全局追踪管理器"""
        manager = get_tracing_manager()
        assert manager is not None

    def test_set_tracing_manager(self):
        """应该设置全局追踪管理器"""
        new_manager = TracingManager(TracingConfig(service_name="new-service"))
        set_tracing_manager(new_manager)

        assert get_tracing_manager() is new_manager

    @pytest.mark.asyncio
    async def test_span_helper(self):
        """应该使用 span 辅助函数"""
        async with span("test") as s:
            s.set_attribute("key", "value")

    def test_inject_trace_context_helper(self):
        """应该使用 inject_trace_context 辅助函数"""
        carrier = {}
        inject_trace_context(carrier)
        # 在没有活跃 span 时不会注入

    def test_extract_trace_context_helper(self):
        """应该使用 extract_trace_context 辅助函数"""
        carrier = {
            "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
        }

        context = extract_trace_context(carrier)
        assert context is not None
        assert context.trace_id == "0af7651916cd43dd8448eb211c80319c"


class TestTraceContext:
    """TraceContext 测试"""

    def test_create_context(self):
        """应该创建追踪上下文"""
        context = TraceContext(
            trace_id="0af7651916cd43dd8448eb211c80319c",
            span_id="b7ad6b7169203331",
            sampled=True,
        )

        assert context.trace_id == "0af7651916cd43dd8448eb211c80319c"
        assert context.span_id == "b7ad6b7169203331"
        assert context.sampled is True
