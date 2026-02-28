"""
预算追踪系统
实现项目收入、支出记录、预算分析和超支预警

@module interagent.budget_tracker
@version 1.0.0
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Any, Optional
import uuid


class AlertSeverity(Enum):
    """告警严重程度"""
    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


class TransactionType(Enum):
    """交易类型"""
    INCOME = "income"
    EXPENSE = "expense"


@dataclass
class BudgetTransaction:
    """预算交易记录"""
    id: str
    project_id: str
    transaction_type: TransactionType
    amount: Decimal
    category: str
    description: str
    timestamp: datetime
    reference: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class BudgetStatus:
    """预算状态"""
    project_id: str
    total_budget: Decimal
    total_income: Decimal
    total_expenses: Decimal
    remaining: Decimal
    utilization_percent: float
    last_updated: datetime


@dataclass
class BudgetAlert:
    """预算告警"""
    id: str
    project_id: str
    severity: AlertSeverity
    alert_type: str
    message: str
    current_budget: Decimal
    current_expenses: Decimal
    remaining: Decimal
    utilization_percent: float
    timestamp: datetime


@dataclass
class BudgetReport:
    """预算报告"""
    project_id: str
    generated_at: datetime
    total_budget: Decimal
    total_income: Decimal
    total_expenses: Decimal
    net_balance: Decimal
    income_by_category: dict[str, Decimal]
    expenses_by_category: dict[str, Decimal]
    transaction_count: int
    alerts: list[BudgetAlert]


@dataclass
class BudgetForecast:
    """预算预测"""
    estimated_days_remaining: int
    daily_burn_rate: Decimal
    projected_depletion_date: Optional[datetime]
    confidence: str  # "high", "medium", "low"


class BudgetTracker:
    """
    预算追踪器

    提供项目级别的预算管理功能：
    - 收入记录
    - 支出记录
    - 预算分析
    - 超支预警
    """

    def __init__(self, precision: int = 2):
        """
        初始化预算追踪器

        Args:
            precision: 金额精度（小数位数），默认为2（$0.01）
        """
        self._precision = precision
        self._lock = threading.RLock()
        self._transactions: dict[str, list[BudgetTransaction]] = {}
        self._budget_configs: dict[str, Decimal] = {}
        self._budget_status: dict[str, BudgetStatus] = {}

    def record_transaction(
        self,
        project_id: str,
        transaction_type: TransactionType,
        amount: float,
        category: str,
        description: str,
        reference: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> BudgetTransaction:
        """
        记录交易

        Args:
            project_id: 项目ID
            transaction_type: 交易类型（收入/支出）
            amount: 金额
            category: 类别（如：development, infrastructure, marketing）
            description: 描述
            reference: 外部引用ID（发票号、交易哈希等）
            metadata: 额外元数据

        Returns:
            创建的交易记录
        """
        transaction = BudgetTransaction(
            id=str(uuid.uuid4()),
            project_id=project_id,
            transaction_type=transaction_type,
            amount=self._round(Decimal(str(amount))),
            category=category,
            description=description,
            timestamp=datetime.now(),
            reference=reference,
            metadata=metadata or {},
        )

        with self._lock:
            if project_id not in self._transactions:
                self._transactions[project_id] = []
            self._transactions[project_id].append(transaction)
            self._update_budget_status(project_id)

        return transaction

    def get_transactions(
        self,
        project_id: Optional[str] = None,
        transaction_type: Optional[TransactionType] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> list[BudgetTransaction]:
        """
        获取交易记录

        Args:
            project_id: 项目ID（None表示所有项目）
            transaction_type: 交易类型过滤
            start_date: 开始日期
            end_date: 结束日期

        Returns:
            交易记录列表（按时间倒序）
        """
        with self._lock:
            results: list[BudgetTransaction] = []

            for pid, transactions in self._transactions.items():
                if project_id and pid != project_id:
                    continue

                for tx in transactions:
                    if transaction_type and tx.transaction_type != transaction_type:
                        continue
                    if start_date and tx.timestamp < start_date:
                        continue
                    if end_date and tx.timestamp > end_date:
                        continue
                    results.append(tx)

            return sorted(results, key=lambda x: x.timestamp, reverse=True)

    def set_budget(self, project_id: str, total_budget: float) -> None:
        """
        设置项目预算

        Args:
            project_id: 项目ID
            total_budget: 总预算
        """
        with self._lock:
            self._budget_configs[project_id] = self._round(Decimal(str(total_budget)))
            self._update_budget_status(project_id)

    def get_budget_status(self, project_id: str) -> BudgetStatus:
        """
        获取预算状态

        Args:
            project_id: 项目ID

        Returns:
            预算状态
        """
        with self._lock:
            if project_id not in self._budget_status:
                return BudgetStatus(
                    project_id=project_id,
                    total_budget=Decimal("0"),
                    total_income=Decimal("0"),
                    total_expenses=Decimal("0"),
                    remaining=Decimal("0"),
                    utilization_percent=0.0,
                    last_updated=datetime.now(),
                )
            return self._budget_status[project_id]

    def check_alerts(self, project_id: Optional[str] = None) -> list[BudgetAlert]:
        """
        检查预算告警

        Args:
            project_id: 项目ID（None表示检查所有项目）

        Returns:
            告警列表
        """
        alerts: list[BudgetAlert] = []

        with self._lock:
            project_ids = [project_id] if project_id else list(self._budget_configs.keys())

            for pid in project_ids:
                if pid not in self._budget_configs:
                    continue

                status = self.get_budget_status(pid)
                budget = self._budget_configs[pid]

                if budget == 0:
                    continue

                # 超支告警
                if status.remaining < 0:
                    alerts.append(BudgetAlert(
                        id=str(uuid.uuid4()),
                        project_id=pid,
                        severity=AlertSeverity.CRITICAL,
                        alert_type="overspend",
                        message=f"CRITICAL: 项目 {pid} 已超支 ${abs(float(status.remaining)):.2f}",
                        current_budget=budget,
                        current_expenses=status.total_expenses,
                        remaining=status.remaining,
                        utilization_percent=status.utilization_percent,
                        timestamp=datetime.now(),
                    ))
                # 接近限额告警 (>90%)
                elif status.utilization_percent > 90:
                    alerts.append(BudgetAlert(
                        id=str(uuid.uuid4()),
                        project_id=pid,
                        severity=AlertSeverity.WARNING,
                        alert_type="near_limit",
                        message=f"WARNING: 项目 {pid} 已使用 {status.utilization_percent:.1f}% 预算",
                        current_budget=budget,
                        current_expenses=status.total_expenses,
                        remaining=status.remaining,
                        utilization_percent=status.utilization_percent,
                        timestamp=datetime.now(),
                    ))
                # 高利用率告警 (>75%)
                elif status.utilization_percent > 75:
                    alerts.append(BudgetAlert(
                        id=str(uuid.uuid4()),
                        project_id=pid,
                        severity=AlertSeverity.INFO,
                        alert_type="high_utilization",
                        message=f"INFO: 项目 {pid} 已使用 {status.utilization_percent:.1f}% 预算",
                        current_budget=budget,
                        current_expenses=status.total_expenses,
                        remaining=status.remaining,
                        utilization_percent=status.utilization_percent,
                        timestamp=datetime.now(),
                    ))

        return alerts

    def generate_report(self, project_id: Optional[str] = None) -> BudgetReport:
        """
        生成预算报告

        Args:
            project_id: 项目ID（None表示所有项目）

        Returns:
            预算报告
        """
        transactions = self.get_transactions(project_id)

        total_budget = Decimal("0")
        total_income = Decimal("0")
        total_expenses = Decimal("0")
        income_by_category: dict[str, Decimal] = {}
        expenses_by_category: dict[str, Decimal] = {}

        for tx in transactions:
            if tx.transaction_type == TransactionType.INCOME:
                total_income += tx.amount
                income_by_category[tx.category] = (
                    income_by_category.get(tx.category, Decimal("0")) + tx.amount
                )
            else:
                total_expenses += tx.amount
                expenses_by_category[tx.category] = (
                    expenses_by_category.get(tx.category, Decimal("0")) + tx.amount
                )

        with self._lock:
            if project_id:
                total_budget = self._budget_configs.get(project_id, Decimal("0"))
            else:
                total_budget = sum(self._budget_configs.values()) or Decimal("0")

        net_balance = total_budget + total_income - total_expenses

        return BudgetReport(
            project_id=project_id or "all",
            generated_at=datetime.now(),
            total_budget=total_budget,
            total_income=total_income,
            total_expenses=total_expenses,
            net_balance=net_balance,
            income_by_category=income_by_category,
            expenses_by_category=expenses_by_category,
            transaction_count=len(transactions),
            alerts=self.check_alerts(project_id),
        )

    def get_forecast(self, project_id: str) -> BudgetForecast:
        """
        获取预算预测

        Args:
            project_id: 项目ID

        Returns:
            预算预测
        """
        transactions = self.get_transactions(project_id, TransactionType.EXPENSE)
        status = self.get_budget_status(project_id)

        if len(transactions) < 2:
            return BudgetForecast(
                estimated_days_remaining=-1,
                daily_burn_rate=Decimal("0"),
                projected_depletion_date=None,
                confidence="insufficient_data",
            )

        # 计算每日消耗率
        oldest = transactions[-1]
        newest = transactions[0]
        days_diff = max(1, (newest.timestamp - oldest.timestamp).days)

        total_expenses = sum(tx.amount for tx in transactions)
        daily_burn_rate = self._round(total_expenses / Decimal(days_diff))

        # 预测剩余天数
        estimated_days_remaining = -1
        projected_depletion_date = None
        confidence = "low"

        if daily_burn_rate > 0 and status.remaining > 0:
            estimated_days_remaining = int(status.remaining / daily_burn_rate)
            projected_depletion_date = datetime.now() + timedelta(days=estimated_days_remaining)

            # 根据数据量确定置信度
            if len(transactions) >= 14:
                confidence = "high"
            elif len(transactions) >= 7:
                confidence = "medium"

        return BudgetForecast(
            estimated_days_remaining=estimated_days_remaining,
            daily_burn_rate=daily_burn_rate,
            projected_depletion_date=projected_depletion_date,
            confidence=confidence,
        )

    def _update_budget_status(self, project_id: str) -> None:
        """更新预算状态"""
        transactions = self._transactions.get(project_id, [])
        budget = self._budget_configs.get(project_id, Decimal("0"))

        total_income = Decimal("0")
        total_expenses = Decimal("0")

        for tx in transactions:
            if tx.transaction_type == TransactionType.INCOME:
                total_income += tx.amount
            else:
                total_expenses += tx.amount

        remaining = budget + total_income - total_expenses
        utilization_percent = (
            float((total_expenses / budget) * 100) if budget > 0 else 0.0
        )

        self._budget_status[project_id] = BudgetStatus(
            project_id=project_id,
            total_budget=budget,
            total_income=total_income,
            total_expenses=total_expenses,
            remaining=remaining,
            utilization_percent=utilization_percent,
            last_updated=datetime.now(),
        )

    def _round(self, value: Decimal) -> Decimal:
        """四舍五入到指定精度"""
        return value.quantize(Decimal(f"1.{'0' * self._precision}"))


def create_budget_tracker(precision: int = 2) -> BudgetTracker:
    """
    创建预算追踪器实例

    Args:
        precision: 金额精度（小数位数）

    Returns:
        BudgetTracker 实例
    """
    return BudgetTracker(precision=precision)
