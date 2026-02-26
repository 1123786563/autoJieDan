"""
资源消耗追踪系统
实现 Token 使用统计、成本计算和资源预测

@module interagent/resource_tracker
@version 1.0.0
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Optional
import threading
import math


class BudgetStatus(Enum):
    """预算状态枚举"""
    NORMAL = "normal"
    WARNING = "warning"
    CRITICAL = "critical"
    EXCEEDED = "exceeded"


class PredictionMethod(Enum):
    """预测方法枚举"""
    LINEAR = "linear"
    EXPONENTIAL = "exponential"
    AVERAGE = "average"


@dataclass
class LLMProviderPricing:
    """LLM 提供商定价配置"""
    provider: str
    model: str
    input_price_per_million: float
    output_price_per_million: float
    supports_caching: bool = False
    cache_read_price_per_million: Optional[float] = None
    cache_write_price_per_million: Optional[float] = None


@dataclass
class TokenUsageRecord:
    """Token 使用记录"""
    id: str
    task_id: str
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    timestamp: datetime
    cached_input_tokens: Optional[int] = None
    cached_write_tokens: Optional[int] = None
    request_id: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """转换为字典"""
        return {
            "id": self.id,
            "taskId": self.task_id,
            "provider": self.provider,
            "model": self.model,
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
            "timestamp": self.timestamp.isoformat(),
            "cachedInputTokens": self.cached_input_tokens,
            "cachedWriteTokens": self.cached_write_tokens,
            "requestId": self.request_id,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TokenUsageRecord":
        """从字典创建"""
        return cls(
            id=data["id"],
            task_id=data["taskId"],
            provider=data["provider"],
            model=data["model"],
            input_tokens=data["inputTokens"],
            output_tokens=data["outputTokens"],
            timestamp=datetime.fromisoformat(data["timestamp"]),
            cached_input_tokens=data.get("cachedInputTokens"),
            cached_write_tokens=data.get("cachedWriteTokens"),
            request_id=data.get("requestId"),
            metadata=data.get("metadata", {}),
        )


@dataclass
class ApiCallRecord:
    """API 调用记录"""
    id: str
    task_id: str
    endpoint: str
    method: str
    status_code: int
    duration_ms: float
    timestamp: datetime
    error: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """转换为字典"""
        return {
            "id": self.id,
            "taskId": self.task_id,
            "endpoint": self.endpoint,
            "method": self.method,
            "statusCode": self.status_code,
            "durationMs": self.duration_ms,
            "timestamp": self.timestamp.isoformat(),
            "error": self.error,
            "metadata": self.metadata,
        }


@dataclass
class ResourceSnapshot:
    """资源消耗快照"""
    timestamp: datetime
    total_tokens: int
    total_input_tokens: int
    total_output_tokens: int
    total_cached_tokens: int
    total_api_calls: int
    total_cost: float
    avg_tokens_per_request: float
    avg_cost_per_request: float
    memory_usage_mb: float = 0.0
    cpu_percent: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        """转换为字典"""
        return {
            "timestamp": self.timestamp.isoformat(),
            "totalTokens": self.total_tokens,
            "totalInputTokens": self.total_input_tokens,
            "totalOutputTokens": self.total_output_tokens,
            "totalCachedTokens": self.total_cached_tokens,
            "totalApiCalls": self.total_api_calls,
            "totalCost": self.total_cost,
            "avgTokensPerRequest": self.avg_tokens_per_request,
            "avgCostPerRequest": self.avg_cost_per_request,
            "memoryUsageMb": self.memory_usage_mb,
            "cpuPercent": self.cpu_percent,
        }


@dataclass
class ResourceBudget:
    """资源预算"""
    id: str
    token_budget: int
    cost_budget: float
    api_call_budget: int
    start_time: datetime
    task_id: Optional[str] = None
    end_time: Optional[datetime] = None
    hard_limit: bool = False
    warning_threshold: float = 80.0
    critical_threshold: float = 95.0


@dataclass
class BudgetStatusResult:
    """预算状态结果"""
    budget_id: str
    tokens_used: int
    cost_used: float
    api_calls_used: int
    token_usage_percent: float
    cost_usage_percent: float
    api_call_usage_percent: float
    status: BudgetStatus
    remaining_tokens: int
    remaining_cost: float
    estimated_exhaustion_ms: Optional[float] = None

    def to_dict(self) -> dict[str, Any]:
        """转换为字典"""
        return {
            "budgetId": self.budget_id,
            "tokensUsed": self.tokens_used,
            "costUsed": self.cost_used,
            "apiCallsUsed": self.api_calls_used,
            "tokenUsagePercent": self.token_usage_percent,
            "costUsagePercent": self.cost_usage_percent,
            "apiCallUsagePercent": self.api_call_usage_percent,
            "status": self.status.value,
            "remainingTokens": self.remaining_tokens,
            "remainingCost": self.remaining_cost,
            "estimatedExhaustionMs": self.estimated_exhaustion_ms,
        }


@dataclass
class ResourcePrediction:
    """资源预测结果"""
    task_id: str
    prediction_time: datetime
    predicted_total_tokens: int
    predicted_total_cost: float
    predicted_total_api_calls: int
    predicted_remaining_ms: float
    confidence: float
    data_points_used: int
    method: PredictionMethod

    def to_dict(self) -> dict[str, Any]:
        """转换为字典"""
        return {
            "taskId": self.task_id,
            "predictionTime": self.prediction_time.isoformat(),
            "predictedTotalTokens": self.predicted_total_tokens,
            "predictedTotalCost": self.predicted_total_cost,
            "predictedTotalApiCalls": self.predicted_total_api_calls,
            "predictedRemainingMs": self.predicted_remaining_ms,
            "confidence": self.confidence,
            "dataPointsUsed": self.data_points_used,
            "method": self.method.value,
        }


@dataclass
class ResourceEvent:
    """资源事件"""
    type: str
    timestamp: datetime
    task_id: Optional[str]
    data: Any

    def to_dict(self) -> dict[str, Any]:
        """转换为字典"""
        return {
            "type": self.type,
            "timestamp": self.timestamp.isoformat(),
            "taskId": self.task_id,
            "data": self.data,
        }


# 默认定价配置
DEFAULT_PRICING: list[LLMProviderPricing] = [
    LLMProviderPricing(
        provider="openai",
        model="gpt-4o",
        input_price_per_million=2.5,
        output_price_per_million=10.0,
        supports_caching=True,
        cache_read_price_per_million=1.25,
        cache_write_price_per_million=3.125,
    ),
    LLMProviderPricing(
        provider="openai",
        model="gpt-4o-mini",
        input_price_per_million=0.15,
        output_price_per_million=0.6,
        supports_caching=True,
        cache_read_price_per_million=0.075,
        cache_write_price_per_million=0.1875,
    ),
    LLMProviderPricing(
        provider="anthropic",
        model="claude-3-5-sonnet",
        input_price_per_million=3.0,
        output_price_per_million=15.0,
        supports_caching=True,
        cache_read_price_per_million=0.3,
        cache_write_price_per_million=3.75,
    ),
    LLMProviderPricing(
        provider="anthropic",
        model="claude-3-haiku",
        input_price_per_million=0.25,
        output_price_per_million=1.25,
        supports_caching=True,
        cache_read_price_per_million=0.03,
        cache_write_price_per_million=0.3,
    ),
    LLMProviderPricing(
        provider="openai",
        model="o1",
        input_price_per_million=15.0,
        output_price_per_million=60.0,
        supports_caching=False,
    ),
    LLMProviderPricing(
        provider="openai",
        model="o1-mini",
        input_price_per_million=1.5,
        output_price_per_million=6.0,
        supports_caching=False,
    ),
]


@dataclass
class ResourceTrackerConfig:
    """资源追踪器配置"""
    max_history_entries: int = 1000
    snapshot_interval_ms: int = 60000
    prediction_window_size: int = 10
    track_system_resources: bool = True
    default_pricing: list[LLMProviderPricing] = field(default_factory=lambda: DEFAULT_PRICING)


class ResourceTracker:
    """
    资源消耗追踪器
    追踪 Token 使用、API 调用、成本和系统资源
    """

    def __init__(self, config: Optional[ResourceTrackerConfig] = None):
        self.config = config or ResourceTrackerConfig()
        self.pricing_map: dict[str, LLMProviderPricing] = {}
        self.token_records: list[TokenUsageRecord] = []
        self.api_call_records: list[ApiCallRecord] = []
        self.snapshots: list[ResourceSnapshot] = []
        self.budgets: dict[str, ResourceBudget] = {}
        self.task_usage: dict[str, dict[str, float]] = {}
        self.event_handlers: list[Callable[[ResourceEvent], None]] = []
        self._id_counter = 0
        self._snapshot_timer: Optional[threading.Timer] = None
        self._lock = threading.Lock()

        # 初始化定价映射
        for pricing in self.config.default_pricing:
            self.pricing_map[f"{pricing.provider}:{pricing.model}"] = pricing

    def _generate_id(self) -> str:
        """生成唯一 ID"""
        self._id_counter += 1
        return f"res_{int(time.time() * 1000)}_{self._id_counter}"

    def _emit_event(self, event_type: str, task_id: Optional[str], data: Any) -> None:
        """发送事件"""
        event = ResourceEvent(
            type=event_type,
            timestamp=datetime.now(),
            task_id=task_id,
            data=data,
        )
        for handler in self.event_handlers:
            try:
                handler(event)
            except Exception:
                pass

    def on(self, handler: Callable[[ResourceEvent], None]) -> None:
        """注册事件处理器"""
        self.event_handlers.append(handler)

    def off(self, handler: Callable[[ResourceEvent], None]) -> None:
        """移除事件处理器"""
        if handler in self.event_handlers:
            self.event_handlers.remove(handler)

    # ========================================================================
    # Token 记录
    # ========================================================================

    def record_token_usage(
        self,
        task_id: str,
        provider: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cached_input_tokens: Optional[int] = None,
        cached_write_tokens: Optional[int] = None,
        request_id: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> TokenUsageRecord:
        """记录 Token 使用"""
        with self._lock:
            record = TokenUsageRecord(
                id=self._generate_id(),
                task_id=task_id,
                provider=provider,
                model=model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                timestamp=datetime.now(),
                cached_input_tokens=cached_input_tokens,
                cached_write_tokens=cached_write_tokens,
                request_id=request_id,
                metadata=metadata or {},
            )

            self.token_records.append(record)

            # 限制历史记录数
            if len(self.token_records) > self.config.max_history_entries:
                self.token_records.pop(0)

            # 更新任务累计使用
            self._update_task_usage(task_id, record)

        # 检查预算
        self._check_budgets(task_id)

        # 发送事件
        self._emit_event("token_used", task_id, record)

        return record

    def record_token_usage_batch(
        self,
        records: list[dict[str, Any]],
    ) -> list[TokenUsageRecord]:
        """批量记录 Token 使用"""
        return [self.record_token_usage(**r) for r in records]

    # ========================================================================
    # API 调用记录
    # ========================================================================

    def record_api_call(
        self,
        task_id: str,
        endpoint: str,
        method: str,
        status_code: int,
        duration_ms: float,
        error: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> ApiCallRecord:
        """记录 API 调用"""
        with self._lock:
            record = ApiCallRecord(
                id=self._generate_id(),
                task_id=task_id,
                endpoint=endpoint,
                method=method,
                status_code=status_code,
                duration_ms=duration_ms,
                timestamp=datetime.now(),
                error=error,
                metadata=metadata or {},
            )

            self.api_call_records.append(record)

            # 限制历史记录数
            if len(self.api_call_records) > self.config.max_history_entries:
                self.api_call_records.pop(0)

            # 更新任务 API 调用计数
            usage = self.task_usage.get(task_id, {"tokens": 0, "cost": 0, "apiCalls": 0})
            usage["apiCalls"] = usage.get("apiCalls", 0) + 1
            self.task_usage[task_id] = usage

        # 发送事件
        self._emit_event("api_called", task_id, record)

        return record

    # ========================================================================
    # 成本计算
    # ========================================================================

    def calculate_cost(self, record: TokenUsageRecord) -> float:
        """计算 Token 成本"""
        key = f"{record.provider}:{record.model}"
        pricing = self.pricing_map.get(key)

        if not pricing:
            # 使用默认价格 (GPT-4o-mini 作为基准)
            default = next((p for p in DEFAULT_PRICING if p.model == "gpt-4o-mini"), DEFAULT_PRICING[1])
            return self._calculate_cost_with_pricing(record, default)

        return self._calculate_cost_with_pricing(record, pricing)

    def _calculate_cost_with_pricing(
        self,
        record: TokenUsageRecord,
        pricing: LLMProviderPricing,
    ) -> float:
        """使用定价配置计算成本"""
        cost = 0.0

        # 输入 Token 成本
        effective_input_tokens = record.input_tokens - (record.cached_input_tokens or 0)
        cost += (effective_input_tokens / 1_000_000) * pricing.input_price_per_million

        # 缓存读取成本
        if record.cached_input_tokens and pricing.cache_read_price_per_million:
            cost += (record.cached_input_tokens / 1_000_000) * pricing.cache_read_price_per_million

        # 缓存写入成本
        if record.cached_write_tokens and pricing.cache_write_price_per_million:
            cost += (record.cached_write_tokens / 1_000_000) * pricing.cache_write_price_per_million

        # 输出 Token 成本
        cost += (record.output_tokens / 1_000_000) * pricing.output_price_per_million

        return cost

    def get_total_cost(self, task_id: Optional[str] = None) -> float:
        """获取总成本"""
        with self._lock:
            records = (
                self.token_records
                if task_id is None
                else [r for r in self.token_records if r.task_id == task_id]
            )

        return sum(self.calculate_cost(r) for r in records)

    def get_cost_breakdown(
        self,
        task_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """获取成本明细"""
        with self._lock:
            records = (
                self.token_records
                if task_id is None
                else [r for r in self.token_records if r.task_id == task_id]
            )

        input_cost = 0.0
        output_cost = 0.0
        cached_cost = 0.0
        by_provider: dict[str, float] = {}

        for record in records:
            pricing = self.pricing_map.get(f"{record.provider}:{record.model}")
            if not pricing:
                continue

            effective_input = record.input_tokens - (record.cached_input_tokens or 0)
            input_cost += (effective_input / 1_000_000) * pricing.input_price_per_million
            output_cost += (record.output_tokens / 1_000_000) * pricing.output_price_per_million

            if record.cached_input_tokens and pricing.cache_read_price_per_million:
                cached_cost += (record.cached_input_tokens / 1_000_000) * pricing.cache_read_price_per_million

            provider_key = f"{record.provider}/{record.model}"
            by_provider[provider_key] = by_provider.get(provider_key, 0) + self.calculate_cost(record)

        return {
            "input": input_cost,
            "output": output_cost,
            "cached": cached_cost,
            "total": input_cost + output_cost + cached_cost,
            "byProvider": by_provider,
        }

    # ========================================================================
    # 资源统计
    # ========================================================================

    def get_token_stats(self, task_id: Optional[str] = None) -> dict[str, Any]:
        """获取 Token 统计"""
        with self._lock:
            records = (
                self.token_records
                if task_id is None
                else [r for r in self.token_records if r.task_id == task_id]
            )

        total_input = sum(r.input_tokens for r in records)
        total_output = sum(r.output_tokens for r in records)
        total_cached = sum(r.cached_input_tokens or 0 for r in records)
        count = len(records)

        return {
            "totalInput": total_input,
            "totalOutput": total_output,
            "totalCached": total_cached,
            "total": total_input + total_output,
            "avgInputPerRequest": total_input / count if count > 0 else 0,
            "avgOutputPerRequest": total_output / count if count > 0 else 0,
        }

    def get_api_call_stats(self, task_id: Optional[str] = None) -> dict[str, Any]:
        """获取 API 调用统计"""
        with self._lock:
            records = (
                self.api_call_records
                if task_id is None
                else [r for r in self.api_call_records if r.task_id == task_id]
            )

        successful = sum(1 for r in records if 200 <= r.status_code < 300)
        failed = len(records) - successful
        total_duration = sum(r.duration_ms for r in records)
        by_endpoint: dict[str, int] = {}

        for record in records:
            by_endpoint[record.endpoint] = by_endpoint.get(record.endpoint, 0) + 1

        return {
            "total": len(records),
            "successful": successful,
            "failed": failed,
            "avgDurationMs": total_duration / len(records) if records else 0,
            "byEndpoint": by_endpoint,
        }

    def get_task_usage(self, task_id: str) -> Optional[dict[str, float]]:
        """获取任务资源使用"""
        return self.task_usage.get(task_id)

    def get_all_task_usage(self) -> dict[str, dict[str, float]]:
        """获取所有任务资源使用"""
        return dict(self.task_usage)

    def _update_task_usage(self, task_id: str, record: TokenUsageRecord) -> None:
        """更新任务使用统计"""
        usage = self.task_usage.get(task_id, {"tokens": 0, "cost": 0, "apiCalls": 0})
        usage["tokens"] = usage.get("tokens", 0) + record.input_tokens + record.output_tokens
        usage["cost"] = usage.get("cost", 0) + self.calculate_cost(record)
        self.task_usage[task_id] = usage

    # ========================================================================
    # 预算管理
    # ========================================================================

    def set_budget(
        self,
        token_budget: int,
        cost_budget: float,
        api_call_budget: int,
        start_time: datetime,
        task_id: Optional[str] = None,
        end_time: Optional[datetime] = None,
        hard_limit: bool = False,
        warning_threshold: float = 80.0,
        critical_threshold: float = 95.0,
    ) -> ResourceBudget:
        """设置预算"""
        budget = ResourceBudget(
            id=self._generate_id(),
            task_id=task_id,
            token_budget=token_budget,
            cost_budget=cost_budget,
            api_call_budget=api_call_budget,
            start_time=start_time,
            end_time=end_time,
            hard_limit=hard_limit,
            warning_threshold=warning_threshold,
            critical_threshold=critical_threshold,
        )
        self.budgets[budget.id] = budget
        return budget

    def set_task_budget(
        self,
        task_id: str,
        token_budget: Optional[int] = None,
        cost_budget: Optional[float] = None,
        api_call_budget: Optional[int] = None,
        hard_limit: bool = False,
    ) -> ResourceBudget:
        """设置任务预算"""
        return self.set_budget(
            task_id=task_id,
            token_budget=token_budget or float("inf"),
            cost_budget=cost_budget or float("inf"),
            api_call_budget=api_call_budget or float("inf"),
            start_time=datetime.now(),
            hard_limit=hard_limit,
        )

    def get_budget_status(self, budget_id: str) -> Optional[BudgetStatusResult]:
        """获取预算状态"""
        budget = self.budgets.get(budget_id)
        if not budget:
            return None

        usage = self.task_usage.get(budget.task_id) if budget.task_id else None
        tokens_used = int(usage.get("tokens", 0)) if usage else self.get_token_stats()["total"]
        cost_used = usage.get("cost", 0) if usage else self.get_total_cost()
        api_calls_used = int(usage.get("apiCalls", 0)) if usage else self.get_api_call_stats()["total"]

        token_usage_percent = (tokens_used / budget.token_budget * 100) if budget.token_budget > 0 else 0
        cost_usage_percent = (cost_used / budget.cost_budget * 100) if budget.cost_budget > 0 else 0
        api_call_usage_percent = (api_calls_used / budget.api_call_budget * 100) if budget.api_call_budget > 0 else 0

        max_usage_percent = max(token_usage_percent, cost_usage_percent, api_call_usage_percent)

        if max_usage_percent >= 100:
            status = BudgetStatus.EXCEEDED
        elif max_usage_percent >= budget.critical_threshold:
            status = BudgetStatus.CRITICAL
        elif max_usage_percent >= budget.warning_threshold:
            status = BudgetStatus.WARNING
        else:
            status = BudgetStatus.NORMAL

        return BudgetStatusResult(
            budget_id=budget_id,
            tokens_used=tokens_used,
            cost_used=cost_used,
            api_calls_used=api_calls_used,
            token_usage_percent=token_usage_percent,
            cost_usage_percent=cost_usage_percent,
            api_call_usage_percent=api_call_usage_percent,
            status=status,
            remaining_tokens=max(0, budget.token_budget - tokens_used),
            remaining_cost=max(0, budget.cost_budget - cost_used),
        )

    def _check_budgets(self, task_id: str) -> None:
        """检查预算并发送事件"""
        for budget_id, budget in self.budgets.items():
            if budget.task_id and budget.task_id != task_id:
                continue

            status = self.get_budget_status(budget_id)
            if not status:
                continue

            if status.status == BudgetStatus.EXCEEDED:
                self._emit_event("budget_exceeded", task_id, {"budgetId": budget_id, "status": status.to_dict()})
            elif status.status in (BudgetStatus.WARNING, BudgetStatus.CRITICAL):
                self._emit_event("budget_warning", task_id, {"budgetId": budget_id, "status": status.to_dict()})

    def remove_budget(self, budget_id: str) -> bool:
        """移除预算"""
        if budget_id in self.budgets:
            del self.budgets[budget_id]
            return True
        return False

    # ========================================================================
    # 资源预测
    # ========================================================================

    def predict_resources(
        self,
        task_id: str,
        method: PredictionMethod = PredictionMethod.LINEAR,
        window_size: Optional[int] = None,
    ) -> ResourcePrediction:
        """预测资源消耗"""
        window_size = window_size or self.config.prediction_window_size

        with self._lock:
            task_records = [r for r in self.token_records if r.task_id == task_id][-window_size:]

        if len(task_records) < 2:
            return ResourcePrediction(
                task_id=task_id,
                prediction_time=datetime.now(),
                predicted_total_tokens=0,
                predicted_total_cost=0,
                predicted_total_api_calls=0,
                predicted_remaining_ms=0,
                confidence=0,
                data_points_used=len(task_records),
                method=method,
            )

        # 计算累计使用
        cumulative_tokens: list[int] = []
        cumulative_cost: list[float] = []
        timestamps: list[float] = []

        token_sum = 0
        cost_sum = 0

        for record in task_records:
            token_sum += record.input_tokens + record.output_tokens
            cost_sum += self.calculate_cost(record)
            cumulative_tokens.append(token_sum)
            cumulative_cost.append(cost_sum)
            timestamps.append(record.timestamp.timestamp())

        # 根据方法预测
        if method == PredictionMethod.LINEAR:
            predicted_total_tokens = token_sum * 2
            predicted_total_cost = cost_sum * 2
            confidence = 0.7
        elif method == PredictionMethod.EXPONENTIAL:
            if cumulative_tokens[-1] > 0 and cumulative_tokens[0] > 0:
                growth_factor = math.pow(
                    cumulative_tokens[-1] / cumulative_tokens[0],
                    1 / (len(cumulative_tokens) - 1)
                )
            else:
                growth_factor = 1.5
            predicted_total_tokens = cumulative_tokens[-1] * growth_factor * 2
            predicted_total_cost = cumulative_cost[-1] * growth_factor * 2
            confidence = 0.5
        else:  # AVERAGE
            avg_tokens_per_request = sum(cumulative_tokens) / len(cumulative_tokens)
            avg_cost_per_request = sum(cumulative_cost) / len(cumulative_cost)
            predicted_total_tokens = token_sum + avg_tokens_per_request * len(task_records)
            predicted_total_cost = cost_sum + avg_cost_per_request * len(task_records)
            confidence = 0.6

        # 计算 API 调用预测
        with self._lock:
            api_records = [r for r in self.api_call_records if r.task_id == task_id]
        predicted_total_api_calls = len(api_records) * 2

        # 计算预计剩余时间
        duration_ms = (timestamps[-1] - timestamps[0]) * 1000 if len(timestamps) > 1 else 0
        predicted_remaining_ms = duration_ms

        prediction = ResourcePrediction(
            task_id=task_id,
            prediction_time=datetime.now(),
            predicted_total_tokens=int(predicted_total_tokens),
            predicted_total_cost=predicted_total_cost,
            predicted_total_api_calls=predicted_total_api_calls,
            predicted_remaining_ms=predicted_remaining_ms,
            confidence=confidence,
            data_points_used=len(task_records),
            method=method,
        )

        self._emit_event("prediction", task_id, prediction.to_dict())

        return prediction

    # ========================================================================
    # 快照
    # ========================================================================

    def create_snapshot(self) -> ResourceSnapshot:
        """创建快照"""
        token_stats = self.get_token_stats()
        api_stats = self.get_api_call_stats()
        total_cost = self.get_total_cost()

        snapshot = ResourceSnapshot(
            timestamp=datetime.now(),
            total_tokens=token_stats["total"],
            total_input_tokens=token_stats["totalInput"],
            total_output_tokens=token_stats["totalOutput"],
            total_cached_tokens=token_stats["totalCached"],
            total_api_calls=api_stats["total"],
            total_cost=total_cost,
            avg_tokens_per_request=token_stats["total"] / len(self.token_records) if self.token_records else 0,
            avg_cost_per_request=total_cost / len(self.token_records) if self.token_records else 0,
        )

        with self._lock:
            self.snapshots.append(snapshot)
            if len(self.snapshots) > 100:
                self.snapshots.pop(0)

        self._emit_event("snapshot", None, snapshot.to_dict())

        return snapshot

    def get_snapshots(self) -> list[ResourceSnapshot]:
        """获取快照历史"""
        return list(self.snapshots)

    def start_auto_snapshot(self) -> None:
        """启动自动快照"""
        if self._snapshot_timer:
            return

        def snapshot_loop():
            self.create_snapshot()
            if self._snapshot_timer:
                self._snapshot_timer = threading.Timer(
                    self.config.snapshot_interval_ms / 1000,
                    snapshot_loop,
                )
                self._snapshot_timer.start()

        self._snapshot_timer = threading.Timer(
            self.config.snapshot_interval_ms / 1000,
            snapshot_loop,
        )
        self._snapshot_timer.start()

    def stop_auto_snapshot(self) -> None:
        """停止自动快照"""
        if self._snapshot_timer:
            self._snapshot_timer.cancel()
            self._snapshot_timer = None

    # ========================================================================
    # 辅助方法
    # ========================================================================

    def get_records(self) -> dict[str, list]:
        """获取所有记录"""
        with self._lock:
            return {
                "tokens": list(self.token_records),
                "apiCalls": list(self.api_call_records),
            }

    def clear_history(self) -> None:
        """清除历史记录"""
        with self._lock:
            self.token_records.clear()
            self.api_call_records.clear()
            self.snapshots.clear()

    def clear_task_data(self, task_id: str) -> None:
        """清除任务数据"""
        with self._lock:
            self.token_records = [r for r in self.token_records if r.task_id != task_id]
            self.api_call_records = [r for r in self.api_call_records if r.task_id != task_id]
            self.task_usage.pop(task_id, None)

    def add_pricing(self, pricing: LLMProviderPricing) -> None:
        """添加定价配置"""
        self.pricing_map[f"{pricing.provider}:{pricing.model}"] = pricing

    def get_pricing(self, provider: str, model: str) -> Optional[LLMProviderPricing]:
        """获取定价配置"""
        return self.pricing_map.get(f"{provider}:{model}")


# ============================================================================
# 工厂函数
# ============================================================================

def create_resource_tracker(config: Optional[ResourceTrackerConfig] = None) -> ResourceTracker:
    """创建资源追踪器"""
    return ResourceTracker(config)


# ============================================================================
# 格式化函数
# ============================================================================

def format_cost(cost: float) -> str:
    """格式化成本"""
    if cost < 0.01:
        return f"${cost * 1000:.4f}m"  # mills
    elif cost < 1:
        return f"${cost:.4f}"
    elif cost < 100:
        return f"${cost:.2f}"
    else:
        return f"${cost:.0f}"


def format_tokens(tokens: int) -> str:
    """格式化 Token 数量"""
    if tokens < 1000:
        return str(tokens)
    elif tokens < 1_000_000:
        return f"{tokens / 1000:.1f}K"
    else:
        return f"{tokens / 1_000_000:.2f}M"


def format_resource_report(snapshot: ResourceSnapshot) -> str:
    """格式化资源报告"""
    lines = [
        "=== 资源使用报告 ===",
        f"时间: {snapshot.timestamp.isoformat()}",
        "",
        "Token 使用:",
        f"  总计: {format_tokens(snapshot.total_tokens)}",
        f"  输入: {format_tokens(snapshot.total_input_tokens)}",
        f"  输出: {format_tokens(snapshot.total_output_tokens)}",
        f"  缓存: {format_tokens(snapshot.total_cached_tokens)}",
        "",
        f"API 调用: {snapshot.total_api_calls}",
        f"成本: {format_cost(snapshot.total_cost)}",
        "",
        f"平均 Token/请求: {format_tokens(int(snapshot.avg_tokens_per_request))}",
        f"平均成本/请求: {format_cost(snapshot.avg_cost_per_request)}",
        "",
        "系统资源:",
        f"  内存: {snapshot.memory_usage_mb:.1f} MB",
        f"  CPU: {snapshot.cpu_percent:.1f}%",
    ]
    return "\n".join(lines)


def format_budget_status(status: BudgetStatusResult) -> str:
    """格式化预算状态"""
    status_emoji = {
        BudgetStatus.NORMAL: "✅",
        BudgetStatus.WARNING: "⚠️",
        BudgetStatus.CRITICAL: "🔴",
        BudgetStatus.EXCEEDED: "❌",
    }

    lines = [
        f"=== 预算状态 {status_emoji[status.status]} ===",
        f"状态: {status.status.value}",
        "",
        f"Token: {format_tokens(status.tokens_used)} / {format_tokens(status.remaining_tokens + status.tokens_used)} ({status.token_usage_percent:.1f}%)",
        f"成本: {format_cost(status.cost_used)} / {format_cost(status.remaining_cost + status.cost_used)} ({status.cost_usage_percent:.1f}%)",
        f"API 调用: {status.api_calls_used} ({status.api_call_usage_percent:.1f}%)",
    ]
    return "\n".join(lines)
