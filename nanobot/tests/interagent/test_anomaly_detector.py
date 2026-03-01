"""
测试异常检测与告警系统
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch
import time

from nanobot.interagent.anomaly_detector import (
    AnomalySeverity,
    AnomalyCategory,
    AnomalyStatus,
    AlertChannel,
    ConditionOperator,
    RecoveryActionType,
    AnomalyCondition,
    AlertConfig,
    AnomalyRule,
    AnomalyRecord,
    RecoveryAction,
    RecoveryStrategy,
    RecoveryResult,
    MetricDataPoint,
    AnomalyEvent,
    AnomalyDetectorConfig,
    AnomalyDetector,
    create_anomaly_detector,
    format_anomaly,
    format_recovery_result,
)


class TestEnums:
    """测试枚举类型"""

    def test_anomaly_severity_values(self):
        """测试严重程度值"""
        assert AnomalySeverity.LOW.value == "low"
        assert AnomalySeverity.MEDIUM.value == "medium"
        assert AnomalySeverity.HIGH.value == "high"
        assert AnomalySeverity.CRITICAL.value == "critical"

    def test_anomaly_category_values(self):
        """测试类别值"""
        assert AnomalyCategory.RESOURCE.value == "resource"
        assert AnomalyCategory.PERFORMANCE.value == "performance"
        assert AnomalyCategory.ERROR_RATE.value == "error_rate"
        assert AnomalyCategory.BUDGET.value == "budget"

    def test_anomaly_status_values(self):
        """测试状态值"""
        assert AnomalyStatus.ACTIVE.value == "active"
        assert AnomalyStatus.ACKNOWLEDGED.value == "acknowledged"
        assert AnomalyStatus.RESOLVED.value == "resolved"
        assert AnomalyStatus.IGNORED.value == "ignored"

    def test_condition_operator_values(self):
        """测试条件操作符值"""
        assert ConditionOperator.GT.value == "gt"
        assert ConditionOperator.LT.value == "lt"
        assert ConditionOperator.BETWEEN.value == "between"


class TestDataClasses:
    """测试数据类"""

    def test_anomaly_condition_to_dict(self):
        """测试条件转换"""
        condition = AnomalyCondition(
            metric="test_metric",
            operator=ConditionOperator.GT,
            threshold=100,
            data_points=3,
        )

        data = condition.to_dict()

        assert data["metric"] == "test_metric"
        assert data["operator"] == "gt"
        assert data["threshold"] == 100
        assert data["dataPoints"] == 3

    def test_anomaly_condition_tuple_threshold(self):
        """测试元组阈值"""
        condition = AnomalyCondition(
            metric="range_test",
            operator=ConditionOperator.BETWEEN,
            threshold=(10, 20),
        )

        data = condition.to_dict()
        assert data["threshold"] == [10, 20]

    def test_alert_config_to_dict(self):
        """测试告警配置转换"""
        config = AlertConfig(
            channels=[AlertChannel.LOG, AlertChannel.WEBHOOK],
            aggregate=True,
            webhook_url="https://example.com/webhook",
            aggregate_window_ms=60000,
        )

        data = config.to_dict()

        assert data["channels"] == ["log", "webhook"]
        assert data["aggregate"] is True
        assert data["webhookUrl"] == "https://example.com/webhook"

    def test_anomaly_rule_to_dict(self):
        """测试规则转换"""
        rule = AnomalyRule(
            id="rule-1",
            name="Test Rule",
            category=AnomalyCategory.PERFORMANCE,
            severity=AnomalySeverity.HIGH,
            condition=AnomalyCondition(
                metric="latency",
                operator=ConditionOperator.GT,
                threshold=1000,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
        )

        data = rule.to_dict()

        assert data["id"] == "rule-1"
        assert data["name"] == "Test Rule"
        assert data["category"] == "performance"
        assert data["severity"] == "high"

    def test_anomaly_record_to_dict(self):
        """测试异常记录转换"""
        record = AnomalyRecord(
            id="anomaly-1",
            rule_id="rule-1",
            category=AnomalyCategory.ERROR_RATE,
            severity=AnomalySeverity.HIGH,
            status=AnomalyStatus.ACTIVE,
            detected_at=datetime(2026, 2, 26, 12, 0, 0),
            metric_value=0.15,
            threshold=0.1,
            message="High error rate",
        )

        data = record.to_dict()

        assert data["id"] == "anomaly-1"
        assert data["ruleId"] == "rule-1"
        assert data["status"] == "active"

    def test_recovery_action_to_dict(self):
        """测试恢复动作转换"""
        action = RecoveryAction(
            type=RecoveryActionType.RETRY,
            params={"maxAttempts": 3},
            order=1,
        )

        data = action.to_dict()

        assert data["type"] == "retry"
        assert data["params"]["maxAttempts"] == 3

    def test_recovery_strategy_to_dict(self):
        """测试恢复策略转换"""
        strategy = RecoveryStrategy(
            id="strategy-1",
            name="Test Strategy",
            categories=[AnomalyCategory.ERROR_RATE],
            severities=[AnomalySeverity.HIGH],
            actions=[
                RecoveryAction(type=RecoveryActionType.RETRY, params={}, order=1),
            ],
        )

        data = strategy.to_dict()

        assert data["id"] == "strategy-1"
        assert data["name"] == "Test Strategy"
        assert "error_rate" in data["categories"]


class TestAnomalyDetector:
    """测试异常检测器"""

    @pytest.fixture
    def detector(self):
        return create_anomaly_detector(AnomalyDetectorConfig(
            auto_recovery=False,
            check_interval_ms=100,
        ))

    def teardown_method(self):
        """清理"""
        pass

    def test_initial_state(self, detector):
        """测试初始状态"""
        rules = detector.get_all_rules()
        assert len(rules) > 0  # Should have built-in rules

    # ========================================================================
    # 规则管理
    # ========================================================================

    def test_add_rule(self, detector):
        """测试添加规则"""
        rule = detector.add_rule(
            name="Custom Rule",
            category=AnomalyCategory.CUSTOM,
            severity=AnomalySeverity.MEDIUM,
            condition=AnomalyCondition(
                metric="custom_metric",
                operator=ConditionOperator.GT,
                threshold=100,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
        )

        assert rule.id is not None
        assert rule.name == "Custom Rule"

        retrieved = detector.get_rule(rule.id)
        assert retrieved is not None

    def test_update_rule(self, detector):
        """测试更新规则"""
        rule = detector.add_rule(
            name="Test Rule",
            category=AnomalyCategory.CUSTOM,
            severity=AnomalySeverity.LOW,
            condition=AnomalyCondition(
                metric="test",
                operator=ConditionOperator.GT,
                threshold=10,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
        )

        updated = detector.update_rule(rule.id, severity=AnomalySeverity.HIGH)
        assert updated.severity == AnomalySeverity.HIGH

    def test_remove_rule(self, detector):
        """测试删除规则"""
        rule = detector.add_rule(
            name="Test Rule",
            category=AnomalyCategory.CUSTOM,
            severity=AnomalySeverity.LOW,
            condition=AnomalyCondition(
                metric="test",
                operator=ConditionOperator.GT,
                threshold=10,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
        )

        removed = detector.remove_rule(rule.id)
        assert removed is True
        assert detector.get_rule(rule.id) is None

    def test_set_rule_enabled(self, detector):
        """测试启用/禁用规则"""
        rule = detector.add_rule(
            name="Test Rule",
            category=AnomalyCategory.CUSTOM,
            severity=AnomalySeverity.LOW,
            condition=AnomalyCondition(
                metric="test",
                operator=ConditionOperator.GT,
                threshold=10,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
            enabled=True,
        )

        detector.set_rule_enabled(rule.id, False)
        assert detector.get_rule(rule.id).enabled is False

    # ========================================================================
    # 指标收集
    # ========================================================================

    def test_record_metric(self, detector):
        """测试记录指标"""
        detector.record_metric("test_metric", 100)

        history = detector.get_metric_history("test_metric")
        assert len(history) == 1
        assert history[0].value == 100

    def test_record_multiple_metrics(self, detector):
        """测试记录多个指标"""
        detector.record_metric("test", 10)
        detector.record_metric("test", 20)
        detector.record_metric("test", 30)

        history = detector.get_metric_history("test")
        assert len(history) == 3

    def test_get_metric_stats(self, detector):
        """测试获取指标统计"""
        detector.record_metric("test", 10)
        detector.record_metric("test", 20)
        detector.record_metric("test", 30)

        stats = detector.get_metric_stats("test")

        assert stats["min"] == 10
        assert stats["max"] == 30
        assert stats["avg"] == 20
        assert stats["count"] == 3
        assert stats["latest"] == 30

    # ========================================================================
    # 异常检测
    # ========================================================================

    def test_detect_anomaly_gt(self, detector):
        """测试检测异常 - 大于"""
        handler = Mock()
        detector.on(handler)

        detector.add_rule(
            name="High Value",
            category=AnomalyCategory.CUSTOM,
            severity=AnomalySeverity.HIGH,
            condition=AnomalyCondition(
                metric="test_value",
                operator=ConditionOperator.GT,
                threshold=100,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
            cooldown_ms=0,
        )

        detector.record_metric("test_value", 50)
        assert handler.call_count == 0

        detector.record_metric("test_value", 150)
        assert handler.call_count >= 1

    def test_detect_anomaly_lt(self, detector):
        """测试检测异常 - 小于"""
        handler = Mock()
        detector.on(handler)

        detector.add_rule(
            name="Low Value",
            category=AnomalyCategory.CUSTOM,
            severity=AnomalySeverity.MEDIUM,
            condition=AnomalyCondition(
                metric="low_test",
                operator=ConditionOperator.LT,
                threshold=10,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
            cooldown_ms=0,
        )

        detector.record_metric("low_test", 5)
        assert handler.call_count >= 1

    def test_detect_anomaly_between(self, detector):
        """测试检测异常 - 范围内"""
        handler = Mock()
        detector.on(handler)

        detector.add_rule(
            name="In Range",
            category=AnomalyCategory.CUSTOM,
            severity=AnomalySeverity.LOW,
            condition=AnomalyCondition(
                metric="range_test",
                operator=ConditionOperator.BETWEEN,
                threshold=(10, 20),
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
            cooldown_ms=0,
        )

        detector.record_metric("range_test", 15)
        assert handler.call_count >= 1

        handler.reset_mock()
        detector.record_metric("range_test", 25)
        assert handler.call_count == 0

    def test_cooldown_period(self, detector):
        """测试冷却时间"""
        handler = Mock()
        detector.on(handler)

        detector.add_rule(
            name="Cooldown Test",
            category=AnomalyCategory.CUSTOM,
            severity=AnomalySeverity.LOW,
            condition=AnomalyCondition(
                metric="cooldown_test",
                operator=ConditionOperator.GT,
                threshold=100,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
            cooldown_ms=1000,
        )

        detector.record_metric("cooldown_test", 150)
        first_count = handler.call_count

        detector.record_metric("cooldown_test", 150)
        assert handler.call_count == first_count  # Should not increase

    # ========================================================================
    # 异常管理
    # ========================================================================

    def test_get_active_anomalies(self, detector):
        """测试获取活跃异常"""
        detector.add_rule(
            name="Test Rule",
            category=AnomalyCategory.CUSTOM,
            severity=AnomalySeverity.HIGH,
            condition=AnomalyCondition(
                metric="active_test",
                operator=ConditionOperator.GT,
                threshold=100,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
            cooldown_ms=0,
        )

        detector.record_metric("active_test", 150)

        active = detector.get_active_anomalies()
        assert len(active) > 0
        assert active[0].status == AnomalyStatus.ACTIVE

    def test_acknowledge_anomaly(self, detector):
        """测试确认异常"""
        detector.add_rule(
            name="Ack Test",
            category=AnomalyCategory.CUSTOM,
            severity=AnomalySeverity.MEDIUM,
            condition=AnomalyCondition(
                metric="ack_test",
                operator=ConditionOperator.GT,
                threshold=100,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
            cooldown_ms=0,
        )

        detector.record_metric("ack_test", 150)
        anomaly = detector.get_active_anomalies()[0]

        result = detector.acknowledge_anomaly(anomaly.id)
        assert result is True

        updated = detector.get_anomaly(anomaly.id)
        assert updated.status == AnomalyStatus.ACKNOWLEDGED
        assert updated.acknowledged_at is not None

    def test_resolve_anomaly(self, detector):
        """测试解决异常"""
        detector.add_rule(
            name="Resolve Test",
            category=AnomalyCategory.CUSTOM,
            severity=AnomalySeverity.MEDIUM,
            condition=AnomalyCondition(
                metric="resolve_test",
                operator=ConditionOperator.GT,
                threshold=100,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
            cooldown_ms=0,
        )

        detector.record_metric("resolve_test", 150)
        anomaly = detector.get_active_anomalies()[0]

        result = detector.resolve_anomaly(anomaly.id)
        assert result is True

        updated = detector.get_anomaly(anomaly.id)
        assert updated.status == AnomalyStatus.RESOLVED
        assert updated.resolved_at is not None

    def test_ignore_anomaly(self, detector):
        """测试忽略异常"""
        detector.add_rule(
            name="Ignore Test",
            category=AnomalyCategory.CUSTOM,
            severity=AnomalySeverity.MEDIUM,
            condition=AnomalyCondition(
                metric="ignore_test",
                operator=ConditionOperator.GT,
                threshold=100,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
            cooldown_ms=0,
        )

        detector.record_metric("ignore_test", 150)
        anomaly = detector.get_active_anomalies()[0]

        result = detector.ignore_anomaly(anomaly.id)
        assert result is True

        updated = detector.get_anomaly(anomaly.id)
        assert updated.status == AnomalyStatus.IGNORED

    # ========================================================================
    # 事件
    # ========================================================================

    def test_anomaly_detected_event(self, detector):
        """测试异常检测事件"""
        events = []
        detector.on(lambda e: events.append(e))

        detector.add_rule(
            name="Event Test",
            category=AnomalyCategory.CUSTOM,
            severity=AnomalySeverity.HIGH,
            condition=AnomalyCondition(
                metric="event_test",
                operator=ConditionOperator.GT,
                threshold=100,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
            cooldown_ms=0,
        )

        detector.record_metric("event_test", 150)

        # Check that we have events
        assert len(events) >= 1
        # Check that anomaly_detected event exists
        event_types = [e.type for e in events]
        assert "anomaly_detected" in event_types

    def test_off_handler(self, detector):
        """测试移除事件处理器"""
        handler = Mock()
        detector.on(handler)
        detector.off(handler)

        detector.add_rule(
            name="Off Test",
            category=AnomalyCategory.CUSTOM,
            severity=AnomalySeverity.HIGH,
            condition=AnomalyCondition(
                metric="off_test",
                operator=ConditionOperator.GT,
                threshold=100,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
            cooldown_ms=0,
        )

        detector.record_metric("off_test", 150)
        assert handler.call_count == 0

    # ========================================================================
    # 恢复策略
    # ========================================================================

    def test_add_recovery_strategy(self, detector):
        """测试添加恢复策略"""
        strategy = detector.add_recovery_strategy(
            name="Custom Strategy",
            categories=[AnomalyCategory.CUSTOM],
            severities=[AnomalySeverity.LOW, AnomalySeverity.MEDIUM],
            actions=[
                RecoveryAction(type=RecoveryActionType.RETRY, params={}, order=1),
            ],
        )

        assert strategy.id is not None
        assert strategy.name == "Custom Strategy"

    def test_get_applicable_strategies(self, detector):
        """测试获取适用的恢复策略"""
        detector.add_rule(
            name="Recovery Test",
            category=AnomalyCategory.ERROR_RATE,
            severity=AnomalySeverity.HIGH,
            condition=AnomalyCondition(
                metric="recovery_test",
                operator=ConditionOperator.GT,
                threshold=100,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
            cooldown_ms=0,
        )

        detector.record_metric("recovery_test", 150)
        anomaly = detector.get_active_anomalies()[0]

        strategies = detector.get_applicable_strategies(anomaly)
        assert len(strategies) > 0

    # ========================================================================
    # 辅助方法
    # ========================================================================

    def test_get_summary(self, detector):
        """测试获取摘要"""
        detector.add_rule(
            name="Summary Test",
            category=AnomalyCategory.CUSTOM,
            severity=AnomalySeverity.HIGH,
            condition=AnomalyCondition(
                metric="summary_test",
                operator=ConditionOperator.GT,
                threshold=100,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
            cooldown_ms=0,
        )

        detector.record_metric("summary_test", 150)

        summary = detector.get_summary()

        assert summary["totalAnomalies"] > 0
        assert summary["activeAnomalies"] > 0

    def test_clear(self, detector):
        """测试清除"""
        detector.add_rule(
            name="Clear Test",
            category=AnomalyCategory.CUSTOM,
            severity=AnomalySeverity.MEDIUM,
            condition=AnomalyCondition(
                metric="clear_test",
                operator=ConditionOperator.GT,
                threshold=100,
            ),
            alert_config=AlertConfig(channels=[AlertChannel.LOG], aggregate=False),
            cooldown_ms=0,
        )

        detector.record_metric("clear_test", 150)
        detector.clear()

        active = detector.get_active_anomalies()
        assert len(active) == 0


class TestFactoryFunctions:
    """测试工厂函数"""

    def test_create_anomaly_detector(self):
        """测试创建异常检测器"""
        detector = create_anomaly_detector()
        assert isinstance(detector, AnomalyDetector)

    def test_create_with_config(self):
        """测试使用配置创建"""
        config = AnomalyDetectorConfig(
            auto_recovery=True,
            check_interval_ms=5000,
        )
        detector = create_anomaly_detector(config)
        assert isinstance(detector, AnomalyDetector)


class TestFormatFunctions:
    """测试格式化函数"""

    def test_format_anomaly(self):
        """测试格式化异常"""
        anomaly = AnomalyRecord(
            id="anomaly-1",
            rule_id="rule-1",
            category=AnomalyCategory.ERROR_RATE,
            severity=AnomalySeverity.HIGH,
            status=AnomalyStatus.ACTIVE,
            detected_at=datetime(2026, 2, 26, 12, 0, 0),
            metric_value=0.15,
            threshold=0.1,
            message="High error rate detected",
        )

        formatted = format_anomaly(anomaly)

        assert "anomaly-1" in formatted
        assert "error_rate" in formatted
        assert "high" in formatted
        assert "active" in formatted
        assert "High error rate detected" in formatted

    def test_format_anomaly_with_times(self):
        """测试格式化带时间的异常"""
        anomaly = AnomalyRecord(
            id="anomaly-2",
            rule_id="rule-2",
            category=AnomalyCategory.BUDGET,
            severity=AnomalySeverity.CRITICAL,
            status=AnomalyStatus.RESOLVED,
            detected_at=datetime(2026, 2, 26, 12, 0, 0),
            acknowledged_at=datetime(2026, 2, 26, 12, 1, 0),
            resolved_at=datetime(2026, 2, 26, 12, 5, 0),
            metric_value=105,
            threshold=100,
            message="Budget exceeded",
        )

        formatted = format_anomaly(anomaly)

        assert "确认时间" in formatted
        assert "解决时间" in formatted

    def test_format_recovery_result_success(self):
        """测试格式化成功的恢复结果"""
        result = RecoveryResult(
            anomaly_id="anomaly-1",
            strategy_id="strategy-1",
            executed_at=datetime(2026, 2, 26, 12, 0, 0),
            success=True,
            actions_executed=["retry", "throttle"],
        )

        formatted = format_recovery_result(result)

        assert "anomaly-1" in formatted
        assert "成功" in formatted
        assert "retry" in formatted
        assert "throttle" in formatted

    def test_format_recovery_result_failure(self):
        """测试格式化失败的恢复结果"""
        result = RecoveryResult(
            anomaly_id="anomaly-1",
            strategy_id="strategy-1",
            executed_at=datetime(2026, 2, 26, 12, 0, 0),
            success=False,
            actions_executed=["retry"],
            error="Max retries exceeded",
        )

        formatted = format_recovery_result(result)

        assert "失败" in formatted
        assert "Max retries exceeded" in formatted
