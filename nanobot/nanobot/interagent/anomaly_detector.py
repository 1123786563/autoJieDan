"""
异常检测与告警系统
实现异常分类、告警触发和恢复策略

@module interagent/anomaly_detector
@version 1.0.0
"""

from __future__ import annotations

import time
import threading
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Optional
import json


class AnomalySeverity(Enum):
    """异常严重程度"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AnomalyCategory(Enum):
    """异常类别"""
    RESOURCE = "resource"
    PERFORMANCE = "performance"
    ERROR_RATE = "error_rate"
    BUDGET = "budget"
    CONNECTION = "connection"
    TASK_FAILURE = "task_failure"
    TIMEOUT = "timeout"
    CUSTOM = "custom"


class AnomalyStatus(Enum):
    """异常状态"""
    ACTIVE = "active"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    IGNORED = "ignored"


class AlertChannel(Enum):
    """告警渠道"""
    LOG = "log"
    WEBHOOK = "webhook"
    EMAIL = "email"
    SLACK = "slack"
    CUSTOM = "custom"


class ConditionOperator(Enum):
    """条件操作符"""
    GT = "gt"
    GTE = "gte"
    LT = "lt"
    LTE = "lte"
    EQ = "eq"
    NEQ = "neq"
    BETWEEN = "between"
    OUTSIDE = "outside"


class RecoveryActionType(Enum):
    """恢复动作类型"""
    THROTTLE = "throttle"
    RETRY = "retry"
    FALLBACK = "fallback"
    NOTIFY = "notify"
    RESTART = "restart"
    SCALE = "scale"
    CUSTOM = "custom"


@dataclass
class AnomalyCondition:
    """异常条件"""
    metric: str
    operator: ConditionOperator
    threshold: float | tuple[float, float]
    duration_ms: Optional[float] = None
    data_points: Optional[int] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "metric": self.metric,
            "operator": self.operator.value,
            "threshold": list(self.threshold) if isinstance(self.threshold, tuple) else self.threshold,
            "durationMs": self.duration_ms,
            "dataPoints": self.data_points,
        }


@dataclass
class AlertConfig:
    """告警配置"""
    channels: list[AlertChannel]
    aggregate: bool = False
    template: Optional[str] = None
    webhook_url: Optional[str] = None
    custom_handler: Optional[str] = None
    aggregate_window_ms: Optional[float] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "channels": [c.value for c in self.channels],
            "aggregate": self.aggregate,
            "template": self.template,
            "webhookUrl": self.webhook_url,
            "customHandler": self.custom_handler,
            "aggregateWindowMs": self.aggregate_window_ms,
        }


@dataclass
class AnomalyRule:
    """异常检测规则"""
    id: str
    name: str
    category: AnomalyCategory
    severity: AnomalySeverity
    condition: AnomalyCondition
    alert_config: AlertConfig
    enabled: bool = True
    cooldown_ms: float = 60000
    description: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "category": self.category.value,
            "severity": self.severity.value,
            "condition": self.condition.to_dict(),
            "alertConfig": self.alert_config.to_dict(),
            "enabled": self.enabled,
            "cooldownMs": self.cooldown_ms,
            "metadata": self.metadata,
        }


@dataclass
class AnomalyRecord:
    """异常记录"""
    id: str
    rule_id: str
    category: AnomalyCategory
    severity: AnomalySeverity
    status: AnomalyStatus
    detected_at: datetime
    metric_value: float
    threshold: float | tuple[float, float]
    message: str
    context: dict[str, Any] = field(default_factory=dict)
    task_id: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    recovery_strategy_id: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "ruleId": self.rule_id,
            "category": self.category.value,
            "severity": self.severity.value,
            "status": self.status.value,
            "detectedAt": self.detected_at.isoformat(),
            "metricValue": self.metric_value,
            "threshold": list(self.threshold) if isinstance(self.threshold, tuple) else self.threshold,
            "message": self.message,
            "context": self.context,
            "taskId": self.task_id,
            "acknowledgedAt": self.acknowledged_at.isoformat() if self.acknowledged_at else None,
            "resolvedAt": self.resolved_at.isoformat() if self.resolved_at else None,
            "recoveryStrategyId": self.recovery_strategy_id,
        }


@dataclass
class RecoveryAction:
    """恢复动作"""
    type: RecoveryActionType
    params: dict[str, Any]
    order: int = 1

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type.value,
            "params": self.params,
            "order": self.order,
        }


@dataclass
class RecoveryStrategy:
    """恢复策略"""
    id: str
    name: str
    categories: list[AnomalyCategory]
    severities: list[AnomalySeverity]
    actions: list[RecoveryAction]
    max_retries: int = 3
    retry_interval_ms: float = 1000
    auto_execute: bool = True
    description: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "categories": [c.value for c in self.categories],
            "severities": [s.value for s in self.severities],
            "actions": [a.to_dict() for a in self.actions],
            "maxRetries": self.max_retries,
            "retryIntervalMs": self.retry_interval_ms,
            "autoExecute": self.auto_execute,
        }


@dataclass
class RecoveryResult:
    """恢复执行结果"""
    anomaly_id: str
    strategy_id: str
    executed_at: datetime
    success: bool
    actions_executed: list[str]
    context: dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "anomalyId": self.anomaly_id,
            "strategyId": self.strategy_id,
            "executedAt": self.executed_at.isoformat(),
            "success": self.success,
            "actionsExecuted": self.actions_executed,
            "error": self.error,
            "context": self.context,
        }


@dataclass
class MetricDataPoint:
    """指标数据点"""
    metric: str
    value: float
    timestamp: datetime
    tags: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "metric": self.metric,
            "value": self.value,
            "timestamp": self.timestamp.isoformat(),
            "tags": self.tags,
        }


@dataclass
class AnomalyEvent:
    """异常事件"""
    type: str
    timestamp: datetime
    anomaly: Optional[AnomalyRecord]
    data: Any

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "timestamp": self.timestamp.isoformat(),
            "anomaly": self.anomaly.to_dict() if self.anomaly else None,
            "data": self.data,
        }


@dataclass
class AnomalyDetectorConfig:
    """异常检测器配置"""
    check_interval_ms: float = 10000
    max_active_anomalies: int = 100
    history_retention_ms: float = 24 * 60 * 60 * 1000
    auto_recovery: bool = False
    default_alert_channels: list[AlertChannel] = field(default_factory=lambda: [AlertChannel.LOG])


# 内置规则
def get_builtin_rules() -> list[AnomalyRule]:
    """获取内置规则"""
    return [
        AnomalyRule(
            id="high-error-rate",
            name="高错误率",
            description="API 错误率超过阈值",
            category=AnomalyCategory.ERROR_RATE,
            severity=AnomalySeverity.HIGH,
            condition=AnomalyCondition(
                metric="error_rate",
                operator=ConditionOperator.GT,
                threshold=0.1,
                data_points=3,
            ),
            alert_config=AlertConfig(
                channels=[AlertChannel.LOG, AlertChannel.WEBHOOK],
                aggregate=True,
                aggregate_window_ms=60000,
            ),
            enabled=True,
            cooldown_ms=300000,
        ),
        AnomalyRule(
            id="high-latency",
            name="高延迟",
            description="API 响应延迟过高",
            category=AnomalyCategory.PERFORMANCE,
            severity=AnomalySeverity.MEDIUM,
            condition=AnomalyCondition(
                metric="latency_p99",
                operator=ConditionOperator.GT,
                threshold=5000,
                data_points=3,
            ),
            alert_config=AlertConfig(
                channels=[AlertChannel.LOG],
                aggregate=True,
            ),
            enabled=True,
            cooldown_ms=300000,
        ),
        AnomalyRule(
            id="budget-warning",
            name="预算警告",
            description="资源使用接近预算限制",
            category=AnomalyCategory.BUDGET,
            severity=AnomalySeverity.MEDIUM,
            condition=AnomalyCondition(
                metric="budget_usage_percent",
                operator=ConditionOperator.GT,
                threshold=80,
            ),
            alert_config=AlertConfig(
                channels=[AlertChannel.LOG],
                aggregate=False,
            ),
            enabled=True,
            cooldown_ms=60000,
        ),
        AnomalyRule(
            id="budget-exceeded",
            name="预算超支",
            description="资源使用超出预算限制",
            category=AnomalyCategory.BUDGET,
            severity=AnomalySeverity.CRITICAL,
            condition=AnomalyCondition(
                metric="budget_usage_percent",
                operator=ConditionOperator.GT,
                threshold=100,
            ),
            alert_config=AlertConfig(
                channels=[AlertChannel.LOG, AlertChannel.WEBHOOK],
                aggregate=False,
            ),
            enabled=True,
            cooldown_ms=0,
        ),
        AnomalyRule(
            id="task-failure-spike",
            name="任务失败激增",
            description="任务失败率突然增加",
            category=AnomalyCategory.TASK_FAILURE,
            severity=AnomalySeverity.HIGH,
            condition=AnomalyCondition(
                metric="task_failure_rate",
                operator=ConditionOperator.GT,
                threshold=0.2,
                data_points=2,
            ),
            alert_config=AlertConfig(
                channels=[AlertChannel.LOG, AlertChannel.WEBHOOK],
                aggregate=True,
            ),
            enabled=True,
            cooldown_ms=180000,
        ),
        AnomalyRule(
            id="connection-drop",
            name="连接中断",
            description="WebSocket 连接断开",
            category=AnomalyCategory.CONNECTION,
            severity=AnomalySeverity.HIGH,
            condition=AnomalyCondition(
                metric="connection_status",
                operator=ConditionOperator.EQ,
                threshold=0,
            ),
            alert_config=AlertConfig(
                channels=[AlertChannel.LOG],
                aggregate=False,
            ),
            enabled=True,
            cooldown_ms=60000,
        ),
    ]


# 内置恢复策略
def get_builtin_strategies() -> list[RecoveryStrategy]:
    """获取内置恢复策略"""
    return [
        RecoveryStrategy(
            id="retry-with-backoff",
            name="指数退避重试",
            description="使用指数退避策略重试失败操作",
            categories=[AnomalyCategory.ERROR_RATE, AnomalyCategory.TASK_FAILURE, AnomalyCategory.TIMEOUT],
            severities=[AnomalySeverity.LOW, AnomalySeverity.MEDIUM, AnomalySeverity.HIGH],
            actions=[
                RecoveryAction(type=RecoveryActionType.RETRY, params={"backoff": "exponential", "maxAttempts": 3}, order=1),
            ],
            max_retries=3,
            retry_interval_ms=1000,
            auto_execute=True,
        ),
        RecoveryStrategy(
            id="throttle-requests",
            name="请求限流",
            description="降低请求频率以减轻负载",
            categories=[AnomalyCategory.PERFORMANCE, AnomalyCategory.RESOURCE],
            severities=[AnomalySeverity.MEDIUM, AnomalySeverity.HIGH],
            actions=[
                RecoveryAction(type=RecoveryActionType.THROTTLE, params={"factor": 0.5}, order=1),
            ],
            max_retries=1,
            retry_interval_ms=0,
            auto_execute=True,
        ),
        RecoveryStrategy(
            id="fallback-model",
            name="降级模型",
            description="切换到更便宜的模型以节省成本",
            categories=[AnomalyCategory.BUDGET],
            severities=[AnomalySeverity.HIGH, AnomalySeverity.CRITICAL],
            actions=[
                RecoveryAction(type=RecoveryActionType.FALLBACK, params={"targetModel": "gpt-4o-mini"}, order=1),
            ],
            max_retries=1,
            retry_interval_ms=0,
            auto_execute=True,
        ),
        RecoveryStrategy(
            id="notify-admin",
            name="通知管理员",
            description="发送告警通知给管理员",
            categories=[AnomalyCategory.CONNECTION, AnomalyCategory.ERROR_RATE],
            severities=[AnomalySeverity.HIGH, AnomalySeverity.CRITICAL],
            actions=[
                RecoveryAction(type=RecoveryActionType.NOTIFY, params={"level": "critical"}, order=1),
            ],
            max_retries=3,
            retry_interval_ms=60000,
            auto_execute=True,
        ),
        RecoveryStrategy(
            id="restart-service",
            name="重启服务",
            description="重启受影响的服务",
            categories=[AnomalyCategory.CONNECTION, AnomalyCategory.PERFORMANCE],
            severities=[AnomalySeverity.CRITICAL],
            actions=[
                RecoveryAction(type=RecoveryActionType.RESTART, params={"graceful": True}, order=1),
            ],
            max_retries=1,
            retry_interval_ms=0,
            auto_execute=False,
        ),
    ]


class AnomalyDetector:
    """
    异常检测器
    检测、告警和处理系统异常
    """

    def __init__(self, config: Optional[AnomalyDetectorConfig] = None):
        self.config = config or AnomalyDetectorConfig()
        self.rules: dict[str, AnomalyRule] = {}
        self.strategies: dict[str, RecoveryStrategy] = {}
        self.anomalies: dict[str, AnomalyRecord] = {}
        self.metrics: dict[str, list[MetricDataPoint]] = {}
        self.last_triggered: dict[str, datetime] = {}
        self.event_handlers: list[Callable[[AnomalyEvent], None]] = []
        self.alert_aggregator: dict[str, list[AnomalyRecord]] = {}
        self._id_counter = 0
        self._lock = threading.Lock()
        self._check_timer: Optional[threading.Timer] = None

        # 加载内置规则和策略
        for rule in get_builtin_rules():
            self.rules[rule.id] = rule
        for strategy in get_builtin_strategies():
            self.strategies[strategy.id] = strategy

    def _generate_id(self, prefix: str) -> str:
        """生成唯一 ID"""
        self._id_counter += 1
        return f"{prefix}_{int(time.time() * 1000)}_{self._id_counter}"

    def _emit_event(self, event_type: str, anomaly: Optional[AnomalyRecord], data: Any = None) -> None:
        """发送事件"""
        event = AnomalyEvent(
            type=event_type,
            timestamp=datetime.now(),
            anomaly=anomaly,
            data=data,
        )
        for handler in self.event_handlers:
            try:
                handler(event)
            except Exception:
                pass

    def on(self, handler: Callable[[AnomalyEvent], None]) -> None:
        """注册事件处理器"""
        self.event_handlers.append(handler)

    def off(self, handler: Callable[[AnomalyEvent], None]) -> None:
        """移除事件处理器"""
        if handler in self.event_handlers:
            self.event_handlers.remove(handler)

    # ========================================================================
    # 规则管理
    # ========================================================================

    def add_rule(
        self,
        name: str,
        category: AnomalyCategory,
        severity: AnomalySeverity,
        condition: AnomalyCondition,
        alert_config: AlertConfig,
        enabled: bool = True,
        cooldown_ms: float = 60000,
        description: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> AnomalyRule:
        """添加规则"""
        rule = AnomalyRule(
            id=self._generate_id("rule"),
            name=name,
            category=category,
            severity=severity,
            condition=condition,
            alert_config=alert_config,
            enabled=enabled,
            cooldown_ms=cooldown_ms,
            description=description,
            metadata=metadata or {},
        )
        self.rules[rule.id] = rule
        return rule

    def get_rule(self, rule_id: str) -> Optional[AnomalyRule]:
        """获取规则"""
        return self.rules.get(rule_id)

    def get_all_rules(self) -> list[AnomalyRule]:
        """获取所有规则"""
        return list(self.rules.values())

    def update_rule(self, rule_id: str, **updates: Any) -> Optional[AnomalyRule]:
        """更新规则"""
        rule = self.rules.get(rule_id)
        if not rule:
            return None

        for key, value in updates.items():
            if hasattr(rule, key):
                setattr(rule, key, value)
        return rule

    def remove_rule(self, rule_id: str) -> bool:
        """删除规则"""
        if rule_id in self.rules:
            del self.rules[rule_id]
            return True
        return False

    def set_rule_enabled(self, rule_id: str, enabled: bool) -> bool:
        """启用/禁用规则"""
        rule = self.rules.get(rule_id)
        if rule:
            rule.enabled = enabled
            return True
        return False

    # ========================================================================
    # 指标收集
    # ========================================================================

    def record_metric(self, metric: str, value: float, tags: Optional[dict[str, str]] = None) -> None:
        """记录指标"""
        data_point = MetricDataPoint(
            metric=metric,
            value=value,
            timestamp=datetime.now(),
            tags=tags or {},
        )

        with self._lock:
            if metric not in self.metrics:
                self.metrics[metric] = []
            self.metrics[metric].append(data_point)

            # 保留最近 1000 个数据点
            if len(self.metrics[metric]) > 1000:
                self.metrics[metric].pop(0)

        # 立即检查相关规则
        self._check_rules_for_metric(metric)

    def get_metric_history(self, metric: str, limit: Optional[int] = None) -> list[MetricDataPoint]:
        """获取指标历史"""
        with self._lock:
            history = self.metrics.get(metric, []).copy()
        return history[-limit:] if limit else history

    def get_metric_stats(self, metric: str, window_ms: Optional[float] = None) -> dict[str, float]:
        """获取指标统计"""
        with self._lock:
            history = self.metrics.get(metric, []).copy()

        cutoff = datetime.now() - timedelta(milliseconds=window_ms) if window_ms else datetime.min
        filtered = [p for p in history if p.timestamp >= cutoff]

        if not filtered:
            return {"min": 0, "max": 0, "avg": 0, "count": 0, "latest": 0}

        values = [p.value for p in filtered]
        return {
            "min": min(values),
            "max": max(values),
            "avg": sum(values) / len(values),
            "count": len(values),
            "latest": values[-1],
        }

    # ========================================================================
    # 异常检测
    # ========================================================================

    def _check_rules_for_metric(self, metric: str) -> None:
        """检查指定指标的所有规则"""
        for rule in self.rules.values():
            if not rule.enabled:
                continue
            if rule.condition.metric != metric:
                continue
            self._evaluate_rule(rule)

    def _evaluate_rule(self, rule: AnomalyRule) -> bool:
        """评估规则"""
        condition = rule.condition
        history = self.metrics.get(condition.metric, [])

        data_points_needed = condition.data_points or 1
        if len(history) < data_points_needed:
            return False

        recent_points = history[-data_points_needed:]
        values = [p.value for p in recent_points]

        # 检查是否所有数据点都满足条件
        all_match = all(self._evaluate_condition(v, condition) for v in values)
        if not all_match:
            return False

        # 检查冷却时间
        last_triggered = self.last_triggered.get(rule.id)
        if last_triggered and rule.cooldown_ms > 0:
            elapsed = (datetime.now() - last_triggered).total_seconds() * 1000
            if elapsed < rule.cooldown_ms:
                return False

        # 触发异常
        self._trigger_anomaly(rule, values[-1])
        return True

    def _evaluate_condition(self, value: float, condition: AnomalyCondition) -> bool:
        """评估条件"""
        threshold = condition.threshold

        if condition.operator == ConditionOperator.GT:
            return value > threshold
        elif condition.operator == ConditionOperator.GTE:
            return value >= threshold
        elif condition.operator == ConditionOperator.LT:
            return value < threshold
        elif condition.operator == ConditionOperator.LTE:
            return value <= threshold
        elif condition.operator == ConditionOperator.EQ:
            return abs(value - threshold) < 1e-9
        elif condition.operator == ConditionOperator.NEQ:
            return abs(value - threshold) >= 1e-9
        elif condition.operator == ConditionOperator.BETWEEN:
            min_val, max_val = threshold
            return min_val <= value <= max_val
        elif condition.operator == ConditionOperator.OUTSIDE:
            min_val, max_val = threshold
            return value < min_val or value > max_val
        return False

    def _trigger_anomaly(self, rule: AnomalyRule, metric_value: float) -> AnomalyRecord:
        """触发异常"""
        anomaly = AnomalyRecord(
            id=self._generate_id("anomaly"),
            rule_id=rule.id,
            category=rule.category,
            severity=rule.severity,
            status=AnomalyStatus.ACTIVE,
            detected_at=datetime.now(),
            metric_value=metric_value,
            threshold=rule.condition.threshold,
            message=self._format_anomaly_message(rule, metric_value),
            context={},
        )

        with self._lock:
            self.anomalies[anomaly.id] = anomaly
            self.last_triggered[rule.id] = datetime.now()

        # 发送事件
        self._emit_event("anomaly_detected", anomaly)

        # 发送告警
        self._send_alert(rule, anomaly)

        # 自动恢复
        if self.config.auto_recovery:
            self.attempt_recovery(anomaly)

        return anomaly

    def _format_anomaly_message(self, rule: AnomalyRule, value: float) -> str:
        """格式化异常消息"""
        threshold_str = (
            f"{rule.condition.threshold[0]}-{rule.condition.threshold[1]}"
            if isinstance(rule.condition.threshold, tuple)
            else str(rule.condition.threshold)
        )
        return f"[{rule.severity.value.upper()}] {rule.name}: {rule.condition.metric}={value} (threshold: {rule.condition.operator.value} {threshold_str})"

    # ========================================================================
    # 告警系统
    # ========================================================================

    def _send_alert(self, rule: AnomalyRule, anomaly: AnomalyRecord) -> None:
        """发送告警"""
        alert_config = rule.alert_config

        # 聚合告警
        if alert_config.aggregate and alert_config.aggregate_window_ms:
            key = rule.id
            if key not in self.alert_aggregator:
                self.alert_aggregator[key] = []
                # 设置定时器发送聚合告警
                threading.Timer(
                    alert_config.aggregate_window_ms / 1000,
                    self._send_aggregated_alert,
                    args=(rule, key),
                ).start()
            self.alert_aggregator[key].append(anomaly)
            return

        # 发送单个告警
        for channel in alert_config.channels:
            self._send_alert_to_channel(channel, rule, anomaly, alert_config)

    def _send_aggregated_alert(self, rule: AnomalyRule, key: str) -> None:
        """发送聚合告警"""
        with self._lock:
            anomalies = self.alert_aggregator.pop(key, [])

        if not anomalies:
            return

        for channel in rule.alert_config.channels:
            message = f"Aggregated alert: {len(anomalies)} anomalies of type \"{rule.name}\""

            if channel == AlertChannel.LOG:
                print(f"[ALERT] {message}")
            elif channel == AlertChannel.WEBHOOK and rule.alert_config.webhook_url:
                self._send_webhook(rule.alert_config.webhook_url, {
                    "type": "aggregated",
                    "rule": rule.to_dict(),
                    "anomalies": [a.to_dict() for a in anomalies],
                    "message": message,
                })

        self._emit_event("alert_sent", None, {"rule": rule, "anomalies": anomalies, "aggregated": True})

    def _send_alert_to_channel(
        self,
        channel: AlertChannel,
        rule: AnomalyRule,
        anomaly: AnomalyRecord,
        config: AlertConfig,
    ) -> None:
        """发送告警到指定渠道"""
        if channel == AlertChannel.LOG:
            print(f"[ALERT] {anomaly.message}")
        elif channel == AlertChannel.WEBHOOK and config.webhook_url:
            self._send_webhook(config.webhook_url, {"rule": rule.to_dict(), "anomaly": anomaly.to_dict()})

        self._emit_event("alert_sent", anomaly, {"channel": channel.value})

    def _send_webhook(self, url: str, data: dict[str, Any]) -> None:
        """发送 Webhook"""
        try:
            import requests
            requests.post(url, json=data, timeout=10)
        except Exception as e:
            print(f"Failed to send webhook alert: {e}")

    # ========================================================================
    # 异常管理
    # ========================================================================

    def get_anomaly(self, anomaly_id: str) -> Optional[AnomalyRecord]:
        """获取异常"""
        return self.anomalies.get(anomaly_id)

    def get_active_anomalies(self) -> list[AnomalyRecord]:
        """获取所有活跃异常"""
        return [a for a in self.anomalies.values() if a.status == AnomalyStatus.ACTIVE]

    def get_anomalies_by_category(self, category: AnomalyCategory) -> list[AnomalyRecord]:
        """获取指定类别的异常"""
        return [a for a in self.anomalies.values() if a.category == category]

    def get_anomalies_by_severity(self, severity: AnomalySeverity) -> list[AnomalyRecord]:
        """获取指定严重程度的异常"""
        return [a for a in self.anomalies.values() if a.severity == severity]

    def acknowledge_anomaly(self, anomaly_id: str) -> bool:
        """确认异常"""
        anomaly = self.anomalies.get(anomaly_id)
        if not anomaly or anomaly.status != AnomalyStatus.ACTIVE:
            return False

        anomaly.status = AnomalyStatus.ACKNOWLEDGED
        anomaly.acknowledged_at = datetime.now()
        self._emit_event("anomaly_acknowledged", anomaly)
        return True

    def resolve_anomaly(self, anomaly_id: str) -> bool:
        """解决异常"""
        anomaly = self.anomalies.get(anomaly_id)
        if not anomaly or anomaly.status == AnomalyStatus.RESOLVED:
            return False

        anomaly.status = AnomalyStatus.RESOLVED
        anomaly.resolved_at = datetime.now()
        self._emit_event("anomaly_resolved", anomaly)
        return True

    def ignore_anomaly(self, anomaly_id: str) -> bool:
        """忽略异常"""
        anomaly = self.anomalies.get(anomaly_id)
        if not anomaly:
            return False

        anomaly.status = AnomalyStatus.IGNORED
        return True

    # ========================================================================
    # 恢复策略
    # ========================================================================

    def add_recovery_strategy(
        self,
        name: str,
        categories: list[AnomalyCategory],
        severities: list[AnomalySeverity],
        actions: list[RecoveryAction],
        max_retries: int = 3,
        retry_interval_ms: float = 1000,
        auto_execute: bool = True,
        description: Optional[str] = None,
    ) -> RecoveryStrategy:
        """添加恢复策略"""
        strategy = RecoveryStrategy(
            id=self._generate_id("strategy"),
            name=name,
            categories=categories,
            severities=severities,
            actions=actions,
            max_retries=max_retries,
            retry_interval_ms=retry_interval_ms,
            auto_execute=auto_execute,
            description=description,
        )
        self.strategies[strategy.id] = strategy
        return strategy

    def get_recovery_strategy(self, strategy_id: str) -> Optional[RecoveryStrategy]:
        """获取恢复策略"""
        return self.strategies.get(strategy_id)

    def get_applicable_strategies(self, anomaly: AnomalyRecord) -> list[RecoveryStrategy]:
        """获取适用的恢复策略"""
        return [
            s for s in self.strategies.values()
            if anomaly.category in s.categories
            and anomaly.severity in s.severities
            and s.auto_execute
        ]

    def attempt_recovery(self, anomaly: AnomalyRecord) -> Optional[RecoveryResult]:
        """尝试恢复"""
        strategies = self.get_applicable_strategies(anomaly)
        if not strategies:
            return None

        strategy = strategies[0]
        anomaly.recovery_strategy_id = strategy.id

        self._emit_event("recovery_started", anomaly, {"strategy": strategy.to_dict()})

        actions_executed: list[str] = []
        error: Optional[str] = None

        try:
            for action in sorted(strategy.actions, key=lambda a: a.order):
                self._execute_recovery_action(action, anomaly)
                actions_executed.append(action.type.value)
        except Exception as e:
            error = str(e)

        result = RecoveryResult(
            anomaly_id=anomaly.id,
            strategy_id=strategy.id,
            executed_at=datetime.now(),
            success=error is None,
            actions_executed=actions_executed,
            error=error,
        )

        self._emit_event("recovery_completed", anomaly, result.to_dict())

        if result.success:
            self.resolve_anomaly(anomaly.id)

        return result

    def _execute_recovery_action(self, action: RecoveryAction, anomaly: AnomalyRecord) -> None:
        """执行恢复动作"""
        action_type = action.type

        if action_type == RecoveryActionType.RETRY:
            print(f"[Recovery] Retrying for anomaly {anomaly.id}")
        elif action_type == RecoveryActionType.THROTTLE:
            print(f"[Recovery] Throttling requests for anomaly {anomaly.id}")
        elif action_type == RecoveryActionType.FALLBACK:
            print(f"[Recovery] Switching to fallback for anomaly {anomaly.id}")
        elif action_type == RecoveryActionType.NOTIFY:
            print(f"[Recovery] Sending notification for anomaly {anomaly.id}")
        elif action_type == RecoveryActionType.RESTART:
            print(f"[Recovery] Restarting service for anomaly {anomaly.id}")
        elif action_type == RecoveryActionType.SCALE:
            print(f"[Recovery] Scaling resources for anomaly {anomaly.id}")
        elif action_type == RecoveryActionType.CUSTOM:
            self._emit_event("recovery_action", anomaly, {"action": action.to_dict()})

    # ========================================================================
    # 定时检查
    # ========================================================================

    def start_periodic_check(self) -> None:
        """启动定时检查"""
        if self._check_timer:
            return

        def check_loop():
            self._run_periodic_check()
            if self._check_timer:
                self._check_timer = threading.Timer(
                    self.config.check_interval_ms / 1000,
                    check_loop,
                )
                self._check_timer.start()

        self._check_timer = threading.Timer(
            self.config.check_interval_ms / 1000,
            check_loop,
        )
        self._check_timer.start()

    def stop_periodic_check(self) -> None:
        """停止定时检查"""
        if self._check_timer:
            self._check_timer.cancel()
            self._check_timer = None

    def _run_periodic_check(self) -> None:
        """运行周期性检查"""
        self._cleanup_history()

        for rule in self.rules.values():
            if rule.enabled:
                self._evaluate_rule(rule)

    def _cleanup_history(self) -> None:
        """清理过期数据"""
        cutoff = datetime.now() - timedelta(milliseconds=self.config.history_retention_ms)

        # 清理异常历史
        to_remove = [
            aid for aid, a in self.anomalies.items()
            if a.detected_at < cutoff and a.status == AnomalyStatus.RESOLVED
        ]
        for aid in to_remove:
            del self.anomalies[aid]

    # ========================================================================
    # 辅助方法
    # ========================================================================

    def get_summary(self) -> dict[str, Any]:
        """获取统计摘要"""
        anomalies = list(self.anomalies.values())
        active = [a for a in anomalies if a.status == AnomalyStatus.ACTIVE]

        by_category: dict[str, int] = {}
        by_severity: dict[str, int] = {}

        for anomaly in active:
            cat = anomaly.category.value
            sev = anomaly.severity.value
            by_category[cat] = by_category.get(cat, 0) + 1
            by_severity[sev] = by_severity.get(sev, 0) + 1

        return {
            "totalAnomalies": len(anomalies),
            "activeAnomalies": len(active),
            "byCategory": by_category,
            "bySeverity": by_severity,
        }

    def clear(self) -> None:
        """清除所有数据"""
        with self._lock:
            self.anomalies.clear()
            self.metrics.clear()
            self.last_triggered.clear()
            self.alert_aggregator.clear()


# ============================================================================
# 导入 timedelta
# ============================================================================
from datetime import timedelta


# ============================================================================
# 工厂函数
# ============================================================================

def create_anomaly_detector(config: Optional[AnomalyDetectorConfig] = None) -> AnomalyDetector:
    """创建异常检测器"""
    return AnomalyDetector(config)


# ============================================================================
# 格式化函数
# ============================================================================

def format_anomaly(anomaly: AnomalyRecord) -> str:
    """格式化异常记录"""
    lines = [
        "=== 异常报告 ===",
        f"ID: {anomaly.id}",
        f"类别: {anomaly.category.value}",
        f"严重程度: {anomaly.severity.value}",
        f"状态: {anomaly.status.value}",
        f"检测时间: {anomaly.detected_at.isoformat()}",
        f"消息: {anomaly.message}",
        f"指标值: {anomaly.metric_value}",
        f"阈值: {anomaly.threshold if isinstance(anomaly.threshold, (int, float)) else '-'.join(map(str, anomaly.threshold))}",
    ]

    if anomaly.acknowledged_at:
        lines.append(f"确认时间: {anomaly.acknowledged_at.isoformat()}")
    if anomaly.resolved_at:
        lines.append(f"解决时间: {anomaly.resolved_at.isoformat()}")

    return "\n".join(lines)


def format_recovery_result(result: RecoveryResult) -> str:
    """格式化恢复结果"""
    lines = [
        "=== 恢复结果 ===",
        f"异常 ID: {result.anomaly_id}",
        f"策略 ID: {result.strategy_id}",
        f"执行时间: {result.executed_at.isoformat()}",
        f"状态: {'成功' if result.success else '失败'}",
        f"执行动作: {', '.join(result.actions_executed) or '无'}",
    ]

    if result.error:
        lines.append(f"错误: {result.error}")

    return "\n".join(lines)
