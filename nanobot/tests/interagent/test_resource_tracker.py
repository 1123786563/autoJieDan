"""
测试资源消耗追踪系统
"""

import pytest
from datetime import datetime
from unittest.mock import Mock

from nanobot.interagent.resource_tracker import (
    BudgetStatus,
    PredictionMethod,
    LLMProviderPricing,
    TokenUsageRecord,
    ApiCallRecord,
    ResourceSnapshot,
    ResourceBudget,
    BudgetStatusResult,
    ResourcePrediction,
    ResourceEvent,
    ResourceTrackerConfig,
    ResourceTracker,
    create_resource_tracker,
    format_cost,
    format_tokens,
    format_resource_report,
    format_budget_status,
)


class TestTokenUsageRecord:
    """测试 Token 使用记录"""

    def test_to_dict(self):
        """测试转换为字典"""
        record = TokenUsageRecord(
            id="res-1",
            task_id="task-1",
            provider="openai",
            model="gpt-4o",
            input_tokens=1000,
            output_tokens=500,
            timestamp=datetime(2026, 2, 26, 12, 0, 0),
            cached_input_tokens=200,
            metadata={"key": "value"},
        )

        data = record.to_dict()

        assert data["id"] == "res-1"
        assert data["taskId"] == "task-1"
        assert data["provider"] == "openai"
        assert data["inputTokens"] == 1000
        assert data["outputTokens"] == 500
        assert data["cachedInputTokens"] == 200

    def test_from_dict(self):
        """测试从字典创建"""
        data = {
            "id": "res-1",
            "taskId": "task-1",
            "provider": "openai",
            "model": "gpt-4o",
            "inputTokens": 1000,
            "outputTokens": 500,
            "timestamp": "2026-02-26T12:00:00",
            "cachedInputTokens": 200,
        }

        record = TokenUsageRecord.from_dict(data)

        assert record.id == "res-1"
        assert record.task_id == "task-1"
        assert record.input_tokens == 1000
        assert record.cached_input_tokens == 200


class TestApiCallRecord:
    """测试 API 调用记录"""

    def test_to_dict(self):
        """测试转换为字典"""
        record = ApiCallRecord(
            id="api-1",
            task_id="task-1",
            endpoint="/v1/chat/completions",
            method="POST",
            status_code=200,
            duration_ms=150.5,
            timestamp=datetime(2026, 2, 26, 12, 0, 0),
        )

        data = record.to_dict()

        assert data["id"] == "api-1"
        assert data["endpoint"] == "/v1/chat/completions"
        assert data["statusCode"] == 200
        assert data["durationMs"] == 150.5


class TestResourceTracker:
    """测试资源追踪器"""

    @pytest.fixture
    def tracker(self):
        return create_resource_tracker()

    def test_initial_state(self, tracker):
        """测试初始状态"""
        stats = tracker.get_token_stats()
        assert stats["total"] == 0
        assert stats["totalInput"] == 0

    # ========================================================================
    # Token 记录
    # ========================================================================

    def test_record_token_usage(self, tracker):
        """测试记录 Token 使用"""
        record = tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o",
            input_tokens=1000,
            output_tokens=500,
        )

        assert record.id.startswith("res_")
        assert record.task_id == "task-1"
        assert record.input_tokens == 1000
        assert record.output_tokens == 500

    def test_record_token_usage_with_caching(self, tracker):
        """测试带缓存的 Token 使用记录"""
        record = tracker.record_token_usage(
            task_id="task-1",
            provider="anthropic",
            model="claude-3-5-sonnet",
            input_tokens=2000,
            output_tokens=1000,
            cached_input_tokens=1500,
        )

        assert record.cached_input_tokens == 1500

    def test_record_token_usage_batch(self, tracker):
        """测试批量记录 Token 使用"""
        records = tracker.record_token_usage_batch([
            {"task_id": "task-1", "provider": "openai", "model": "gpt-4o", "input_tokens": 100, "output_tokens": 50},
            {"task_id": "task-1", "provider": "openai", "model": "gpt-4o", "input_tokens": 200, "output_tokens": 100},
        ])

        assert len(records) == 2

    # ========================================================================
    # API 调用记录
    # ========================================================================

    def test_record_api_call(self, tracker):
        """测试记录 API 调用"""
        record = tracker.record_api_call(
            task_id="task-1",
            endpoint="/v1/chat/completions",
            method="POST",
            status_code=200,
            duration_ms=150,
        )

        assert record.id.startswith("res_")
        assert record.endpoint == "/v1/chat/completions"
        assert record.status_code == 200

    def test_record_failed_api_call(self, tracker):
        """测试记录失败的 API 调用"""
        record = tracker.record_api_call(
            task_id="task-1",
            endpoint="/v1/chat/completions",
            method="POST",
            status_code=500,
            duration_ms=50,
            error="Internal Server Error",
        )

        assert record.status_code == 500
        assert record.error == "Internal Server Error"

    # ========================================================================
    # 成本计算
    # ========================================================================

    def test_calculate_cost_gpt4o(self, tracker):
        """测试 GPT-4o 成本计算"""
        record = TokenUsageRecord(
            id="test",
            task_id="task-1",
            provider="openai",
            model="gpt-4o",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
            timestamp=datetime.now(),
        )

        cost = tracker.calculate_cost(record)
        # Input: $2.5/M, Output: $10/M = $2.5 + $10 = $12.5
        assert abs(cost - 12.5) < 0.01

    def test_calculate_cost_with_caching(self, tracker):
        """测试带缓存的成本计算"""
        record = TokenUsageRecord(
            id="test",
            task_id="task-1",
            provider="openai",
            model="gpt-4o",
            input_tokens=2_000_000,
            output_tokens=1_000_000,
            timestamp=datetime.now(),
            cached_input_tokens=1_000_000,
        )

        cost = tracker.calculate_cost(record)
        # Effective input: 1M @ $2.5 = $2.5
        # Cached: 1M @ $1.25 = $1.25
        # Output: 1M @ $10 = $10
        # Total: $13.75
        assert abs(cost - 13.75) < 0.01

    def test_get_total_cost(self, tracker):
        """测试获取总成本"""
        tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o-mini",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
        )

        total_cost = tracker.get_total_cost()
        # Input: $0.15/M, Output: $0.6/M = $0.75
        assert abs(total_cost - 0.75) < 0.01

    def test_get_cost_breakdown(self, tracker):
        """测试获取成本明细"""
        tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
        )

        breakdown = tracker.get_cost_breakdown()

        assert abs(breakdown["input"] - 2.5) < 0.01
        assert abs(breakdown["output"] - 10) < 0.01
        assert abs(breakdown["total"] - 12.5) < 0.01

    # ========================================================================
    # 资源统计
    # ========================================================================

    def test_get_token_stats(self, tracker):
        """测试获取 Token 统计"""
        tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o",
            input_tokens=1000,
            output_tokens=500,
        )
        tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o",
            input_tokens=2000,
            output_tokens=1000,
        )
        tracker.record_token_usage(
            task_id="task-2",
            provider="openai",
            model="gpt-4o",
            input_tokens=500,
            output_tokens=250,
        )

        stats = tracker.get_token_stats()

        assert stats["totalInput"] == 3500
        assert stats["totalOutput"] == 1750
        assert stats["total"] == 5250

    def test_get_token_stats_for_task(self, tracker):
        """测试获取特定任务的 Token 统计"""
        tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o",
            input_tokens=1000,
            output_tokens=500,
        )
        tracker.record_token_usage(
            task_id="task-2",
            provider="openai",
            model="gpt-4o",
            input_tokens=500,
            output_tokens=250,
        )

        stats = tracker.get_token_stats("task-1")

        assert stats["totalInput"] == 1000
        assert stats["totalOutput"] == 500

    def test_get_api_call_stats(self, tracker):
        """测试获取 API 调用统计"""
        tracker.record_api_call(
            task_id="task-1",
            endpoint="/v1/chat/completions",
            method="POST",
            status_code=200,
            duration_ms=100,
        )
        tracker.record_api_call(
            task_id="task-1",
            endpoint="/v1/chat/completions",
            method="POST",
            status_code=500,
            duration_ms=50,
        )

        stats = tracker.get_api_call_stats()

        assert stats["total"] == 2
        assert stats["successful"] == 1
        assert stats["failed"] == 1
        assert stats["avgDurationMs"] == 75

    def test_get_task_usage(self, tracker):
        """测试获取任务资源使用"""
        tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o-mini",
            input_tokens=1000,
            output_tokens=500,
        )

        usage = tracker.get_task_usage("task-1")

        assert usage is not None
        assert usage["tokens"] == 1500

    # ========================================================================
    # 预算管理
    # ========================================================================

    def test_set_budget(self, tracker):
        """测试设置预算"""
        budget = tracker.set_budget(
            task_id="task-1",
            token_budget=10000,
            cost_budget=10,
            api_call_budget=100,
            start_time=datetime.now(),
            hard_limit=True,
        )

        assert budget.id.startswith("res_")
        assert budget.token_budget == 10000

    def test_set_task_budget(self, tracker):
        """测试设置任务预算"""
        budget = tracker.set_task_budget(
            task_id="task-1",
            token_budget=10000,
            cost_budget=5,
        )

        assert budget.task_id == "task-1"
        assert budget.hard_limit is False

    def test_get_budget_status_normal(self, tracker):
        """测试获取预算状态 - 正常"""
        budget = tracker.set_task_budget(
            task_id="task-1",
            token_budget=10000,
            cost_budget=10,
        )

        tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o-mini",
            input_tokens=1000,
            output_tokens=500,
        )

        status = tracker.get_budget_status(budget.id)

        assert status is not None
        assert status.status == BudgetStatus.NORMAL
        assert status.tokens_used == 1500

    def test_get_budget_status_warning(self, tracker):
        """测试获取预算状态 - 警告"""
        budget = tracker.set_task_budget(
            task_id="task-1",
            token_budget=1000,
            cost_budget=10,
        )

        tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o-mini",
            input_tokens=850,
            output_tokens=50,
        )

        status = tracker.get_budget_status(budget.id)

        assert status.status == BudgetStatus.WARNING

    def test_get_budget_status_exceeded(self, tracker):
        """测试获取预算状态 - 超支"""
        budget = tracker.set_task_budget(
            task_id="task-1",
            token_budget=100,
            cost_budget=10,
        )

        tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o-mini",
            input_tokens=200,
            output_tokens=100,
        )

        status = tracker.get_budget_status(budget.id)

        assert status.status == BudgetStatus.EXCEEDED

    def test_remove_budget(self, tracker):
        """测试移除预算"""
        budget = tracker.set_task_budget(task_id="task-1", token_budget=1000)

        removed = tracker.remove_budget(budget.id)
        assert removed is True

        status = tracker.get_budget_status(budget.id)
        assert status is None

    # ========================================================================
    # 资源预测
    # ========================================================================

    def test_predict_resources_insufficient_data(self, tracker):
        """测试预测资源 - 数据不足"""
        prediction = tracker.predict_resources("task-1")

        assert prediction.confidence == 0
        assert prediction.data_points_used == 0

    def test_predict_resources_linear(self, tracker):
        """测试预测资源 - 线性方法"""
        for i in range(5):
            tracker.record_token_usage(
                task_id="task-1",
                provider="openai",
                model="gpt-4o-mini",
                input_tokens=1000,
                output_tokens=500,
            )

        prediction = tracker.predict_resources("task-1", method=PredictionMethod.LINEAR)

        assert prediction.confidence > 0
        assert prediction.data_points_used == 5
        assert prediction.method == PredictionMethod.LINEAR

    def test_predict_resources_average(self, tracker):
        """测试预测资源 - 平均方法"""
        for i in range(5):
            tracker.record_token_usage(
                task_id="task-1",
                provider="openai",
                model="gpt-4o-mini",
                input_tokens=1000,
                output_tokens=500,
            )

        prediction = tracker.predict_resources("task-1", method=PredictionMethod.AVERAGE)

        assert prediction.method == PredictionMethod.AVERAGE

    # ========================================================================
    # 快照
    # ========================================================================

    def test_create_snapshot(self, tracker):
        """测试创建快照"""
        tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o",
            input_tokens=1000,
            output_tokens=500,
        )

        snapshot = tracker.create_snapshot()

        assert snapshot.timestamp is not None
        assert snapshot.total_tokens == 1500
        assert snapshot.total_input_tokens == 1000
        assert snapshot.total_output_tokens == 500

    def test_get_snapshots(self, tracker):
        """测试获取快照历史"""
        tracker.create_snapshot()
        tracker.create_snapshot()

        snapshots = tracker.get_snapshots()
        assert len(snapshots) == 2

    # ========================================================================
    # 事件
    # ========================================================================

    def test_emit_token_used_event(self, tracker):
        """测试 token_used 事件"""
        handler = Mock()
        tracker.on(handler)

        tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o",
            input_tokens=1000,
            output_tokens=500,
        )

        assert handler.called
        event = handler.call_args[0][0]
        assert event.type == "token_used"

    def test_emit_api_called_event(self, tracker):
        """测试 api_called 事件"""
        handler = Mock()
        tracker.on(handler)

        tracker.record_api_call(
            task_id="task-1",
            endpoint="/test",
            method="POST",
            status_code=200,
            duration_ms=100,
        )

        assert handler.called
        event = handler.call_args[0][0]
        assert event.type == "api_called"

    def test_emit_budget_warning_event(self, tracker):
        """测试 budget_warning 事件"""
        handler = Mock()
        tracker.on(handler)

        tracker.set_task_budget(task_id="task-1", token_budget=1000)
        tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o-mini",
            input_tokens=850,
            output_tokens=50,
        )

        # 找到 budget_warning 事件
        events = [call[0][0] for call in handler.call_args_list]
        warning_events = [e for e in events if e.type == "budget_warning"]
        assert len(warning_events) >= 1

    def test_off_handler(self, tracker):
        """测试移除事件处理器"""
        handler = Mock()
        tracker.on(handler)
        tracker.off(handler)

        tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o",
            input_tokens=1000,
            output_tokens=500,
        )

        assert not handler.called

    # ========================================================================
    # 辅助方法
    # ========================================================================

    def test_get_records(self, tracker):
        """测试获取所有记录"""
        tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o",
            input_tokens=1000,
            output_tokens=500,
        )
        tracker.record_api_call(
            task_id="task-1",
            endpoint="/test",
            method="POST",
            status_code=200,
            duration_ms=100,
        )

        records = tracker.get_records()

        assert len(records["tokens"]) == 1
        assert len(records["apiCalls"]) == 1

    def test_clear_history(self, tracker):
        """测试清除历史记录"""
        tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o",
            input_tokens=1000,
            output_tokens=500,
        )

        tracker.clear_history()
        records = tracker.get_records()

        assert len(records["tokens"]) == 0

    def test_clear_task_data(self, tracker):
        """测试清除任务数据"""
        tracker.record_token_usage(
            task_id="task-1",
            provider="openai",
            model="gpt-4o",
            input_tokens=1000,
            output_tokens=500,
        )
        tracker.record_token_usage(
            task_id="task-2",
            provider="openai",
            model="gpt-4o",
            input_tokens=1000,
            output_tokens=500,
        )

        tracker.clear_task_data("task-1")
        records = tracker.get_records()

        assert len(records["tokens"]) == 1
        assert records["tokens"][0].task_id == "task-2"

    def test_add_pricing(self, tracker):
        """测试添加定价配置"""
        tracker.add_pricing(LLMProviderPricing(
            provider="custom",
            model="custom-model",
            input_price_per_million=1.0,
            output_price_per_million=2.0,
            supports_caching=False,
        ))

        pricing = tracker.get_pricing("custom", "custom-model")

        assert pricing is not None
        assert pricing.input_price_per_million == 1.0


class TestFactoryFunctions:
    """测试工厂函数"""

    def test_create_resource_tracker(self):
        """测试创建资源追踪器"""
        tracker = create_resource_tracker()
        assert isinstance(tracker, ResourceTracker)

    def test_create_with_config(self):
        """测试使用配置创建"""
        config = ResourceTrackerConfig(
            max_history_entries=100,
            snapshot_interval_ms=30000,
        )
        tracker = create_resource_tracker(config)
        assert isinstance(tracker, ResourceTracker)


class TestFormatFunctions:
    """测试格式化函数"""

    def test_format_cost_mills(self):
        """测试格式化毫单位成本"""
        result = format_cost(0.001)
        assert result == "$1.0000m"

    def test_format_cost_small(self):
        """测试格式化小成本"""
        result = format_cost(0.05)
        assert result == "$0.0500"

    def test_format_cost_medium(self):
        """测试格式化中等成本"""
        result = format_cost(5.5)
        assert result == "$5.50"

    def test_format_cost_large(self):
        """测试格式化大成本"""
        result = format_cost(150)
        assert result == "$150"

    def test_format_tokens_small(self):
        """测试格式化小 Token 数"""
        result = format_tokens(500)
        assert result == "500"

    def test_format_tokens_thousands(self):
        """测试格式化千级 Token 数"""
        result = format_tokens(5000)
        assert result == "5.0K"

    def test_format_tokens_millions(self):
        """测试格式化百万级 Token 数"""
        result = format_tokens(1_500_000)
        assert result == "1.50M"

    def test_format_resource_report(self):
        """测试格式化资源报告"""
        snapshot = ResourceSnapshot(
            timestamp=datetime(2026, 2, 26, 0, 0, 0),
            total_tokens=10000,
            total_input_tokens=7000,
            total_output_tokens=3000,
            total_cached_tokens=1000,
            total_api_calls=50,
            total_cost=2.5,
            avg_tokens_per_request=200,
            avg_cost_per_request=0.05,
            memory_usage_mb=128.5,
            cpu_percent=25,
        )

        report = format_resource_report(snapshot)

        assert "资源使用报告" in report
        assert "10.0K" in report
        assert "50" in report
        assert "$2.50" in report
        assert "128.5 MB" in report

    def test_format_budget_status_normal(self):
        """测试格式化预算状态 - 正常"""
        status = BudgetStatusResult(
            budget_id="budget-1",
            tokens_used=5000,
            cost_used=1.5,
            api_calls_used=25,
            token_usage_percent=50,
            cost_usage_percent=30,
            api_call_usage_percent=25,
            status=BudgetStatus.NORMAL,
            remaining_tokens=5000,
            remaining_cost=3.5,
        )

        formatted = format_budget_status(status)

        assert "✅" in formatted
        assert "normal" in formatted
        assert "50.0%" in formatted

    def test_format_budget_status_warning(self):
        """测试格式化预算状态 - 警告"""
        status = BudgetStatusResult(
            budget_id="budget-1",
            tokens_used=8500,
            cost_used=8.5,
            api_calls_used=85,
            token_usage_percent=85,
            cost_usage_percent=85,
            api_call_usage_percent=85,
            status=BudgetStatus.WARNING,
            remaining_tokens=1500,
            remaining_cost=1.5,
        )

        formatted = format_budget_status(status)

        assert "⚠️" in formatted
        assert "warning" in formatted

    def test_format_budget_status_exceeded(self):
        """测试格式化预算状态 - 超支"""
        status = BudgetStatusResult(
            budget_id="budget-1",
            tokens_used=15000,
            cost_used=15,
            api_calls_used=150,
            token_usage_percent=150,
            cost_usage_percent=150,
            api_call_usage_percent=150,
            status=BudgetStatus.EXCEEDED,
            remaining_tokens=0,
            remaining_cost=0,
        )

        formatted = format_budget_status(status)

        assert "❌" in formatted
        assert "exceeded" in formatted
