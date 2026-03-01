"""
预算追踪系统测试

@module tests.test_budget_tracker
@version 1.0.0
"""

import pytest
from datetime import datetime, timedelta
from decimal import Decimal

from nanobot.interagent.budget_tracker import (
    AlertSeverity,
    BudgetAlert,
    BudgetForecast,
    BudgetReport,
    BudgetStatus,
    BudgetTracker,
    TransactionType,
    create_budget_tracker,
)


class TestBudgetTracker:
    """预算追踪器测试"""

    def setup_method(self):
        """每个测试前的设置"""
        self.tracker = BudgetTracker(precision=2)

    def test_record_income_transaction(self):
        """测试记录收入交易"""
        tx = self.tracker.record_transaction(
            project_id="project-1",
            transaction_type=TransactionType.INCOME,
            amount=1000.00,
            category="payment",
            description="Client payment",
        )

        assert tx.project_id == "project-1"
        assert tx.transaction_type == TransactionType.INCOME
        assert tx.amount == Decimal("1000.00")
        assert tx.category == "payment"
        assert tx.description == "Client payment"
        assert tx.id is not None
        assert isinstance(tx.timestamp, datetime)

    def test_record_expense_transaction(self):
        """测试记录支出交易"""
        tx = self.tracker.record_transaction(
            project_id="project-1",
            transaction_type=TransactionType.EXPENSE,
            amount=50.25,
            category="infrastructure",
            description="Server costs",
            reference="inv-12345",
        )

        assert tx.transaction_type == TransactionType.EXPENSE
        assert tx.amount == Decimal("50.25")
        assert tx.reference == "inv-12345"

    def test_round_to_precision(self):
        """测试精度四舍五入"""
        tx = self.tracker.record_transaction(
            project_id="project-1",
            transaction_type=TransactionType.INCOME,
            amount=1000.123456,
            category="payment",
            description="Test",
        )

        assert tx.amount == Decimal("1000.12")

    def test_get_transactions_all(self):
        """测试获取所有交易"""
        self.tracker.record_transaction(
            project_id="project-1",
            transaction_type=TransactionType.INCOME,
            amount=1000,
            category="payment",
            description="Payment 1",
        )
        self.tracker.record_transaction(
            project_id="project-2",
            transaction_type=TransactionType.EXPENSE,
            amount=50,
            category="infrastructure",
            description="Cost 1",
        )

        transactions = self.tracker.get_transactions()
        assert len(transactions) == 2

    def test_get_transactions_filtered_by_project(self):
        """测试按项目筛选交易"""
        self.tracker.record_transaction(
            project_id="project-1",
            transaction_type=TransactionType.INCOME,
            amount=1000,
            category="payment",
            description="Payment 1",
        )
        self.tracker.record_transaction(
            project_id="project-2",
            transaction_type=TransactionType.EXPENSE,
            amount=50,
            category="infrastructure",
            description="Cost 1",
        )

        transactions = self.tracker.get_transactions(project_id="project-1")
        assert len(transactions) == 1
        assert transactions[0].project_id == "project-1"

    def test_get_transactions_filtered_by_type(self):
        """测试按类型筛选交易"""
        self.tracker.record_transaction(
            project_id="project-1",
            transaction_type=TransactionType.INCOME,
            amount=1000,
            category="payment",
            description="Payment 1",
        )
        self.tracker.record_transaction(
            project_id="project-1",
            transaction_type=TransactionType.EXPENSE,
            amount=50,
            category="infrastructure",
            description="Cost 1",
        )

        transactions = self.tracker.get_transactions(
            project_id="project-1",
            transaction_type=TransactionType.EXPENSE,
        )
        assert len(transactions) == 1
        assert transactions[0].transaction_type == TransactionType.EXPENSE

    def test_set_and_get_budget(self):
        """测试设置和获取预算"""
        self.tracker.set_budget("project-1", 5000)
        self.tracker.record_transaction(
            project_id="project-1",
            transaction_type=TransactionType.EXPENSE,
            amount=1000,
            category="development",
            description="Dev cost",
        )

        status = self.tracker.get_budget_status("project-1")
        assert status.project_id == "project-1"
        assert status.total_budget == Decimal("5000")
        assert status.total_expenses == Decimal("1000")
        assert status.remaining == Decimal("4000")
        assert status.utilization_percent == 20.0

    def test_get_budget_status_new_project(self):
        """测试获取新项目的预算状态"""
        status = self.tracker.get_budget_status("new-project")
        assert status.project_id == "new-project"
        assert status.total_budget == Decimal("0")
        assert status.remaining == Decimal("0")
        assert status.utilization_percent == 0.0

    def test_check_alerts_overspend(self):
        """测试超支告警"""
        self.tracker.set_budget("project-1", 5000)
        self.tracker.record_transaction(
            project_id="project-1",
            transaction_type=TransactionType.EXPENSE,
            amount=5500,
            category="development",
            description="Overspend",
        )

        alerts = self.tracker.check_alerts("project-1")
        assert len(alerts) == 1
        assert alerts[0].severity == AlertSeverity.CRITICAL
        assert alerts[0].alert_type == "overspend"
        assert "已超支" in alerts[0].message

    def test_check_alerts_near_limit(self):
        """测试接近限额告警"""
        self.tracker.set_budget("project-1", 5000)
        self.tracker.record_transaction(
            project_id="project-1",
            transaction_type=TransactionType.EXPENSE,
            amount=4600,
            category="development",
            description="Near limit",
        )

        alerts = self.tracker.check_alerts("project-1")
        assert len(alerts) == 1
        assert alerts[0].severity == AlertSeverity.WARNING
        assert alerts[0].alert_type == "near_limit"

    def test_check_alerts_high_utilization(self):
        """测试高利用率告警"""
        self.tracker.set_budget("project-1", 5000)
        self.tracker.record_transaction(
            project_id="project-1",
            transaction_type=TransactionType.EXPENSE,
            amount=3800,
            category="development",
            description="High utilization",
        )

        alerts = self.tracker.check_alerts("project-1")
        assert len(alerts) == 1
        assert alerts[0].severity == AlertSeverity.INFO
        assert alerts[0].alert_type == "high_utilization"

    def test_check_alerts_healthy(self):
        """测试健康预算状态无告警"""
        self.tracker.set_budget("project-1", 5000)
        self.tracker.record_transaction(
            project_id="project-1",
            transaction_type=TransactionType.EXPENSE,
            amount=1000,
            category="development",
            description="Normal",
        )

        alerts = self.tracker.check_alerts("project-1")
        assert len(alerts) == 0

    def test_generate_report(self):
        """测试生成报告"""
        self.tracker.set_budget("project-1", 5000)
        self.tracker.record_transaction(
            project_id="project-1",
            transaction_type=TransactionType.INCOME,
            amount=1000,
            category="payment",
            description="Payment",
        )
        self.tracker.record_transaction(
            project_id="project-1",
            transaction_type=TransactionType.EXPENSE,
            amount=500,
            category="development",
            description="Dev cost",
        )

        report = self.tracker.generate_report("project-1")
        assert report.project_id == "project-1"
        assert report.total_budget == Decimal("5000")
        assert report.total_income == Decimal("1000")
        assert report.total_expenses == Decimal("500")
        assert report.net_balance == Decimal("5500")
        assert report.transaction_count == 2
        assert "payment" in report.income_by_category
        assert "development" in report.expenses_by_category

    def test_get_forecast_insufficient_data(self):
        """测试数据不足时的预测"""
        self.tracker.set_budget("project-1", 5000)
        forecast = self.tracker.get_forecast("project-1")

        assert forecast.estimated_days_remaining == -1
        assert forecast.daily_burn_rate == Decimal("0")
        assert forecast.projected_depletion_date is None
        assert forecast.confidence == "insufficient_data"

    def test_get_forecast_with_data(self):
        """测试有数据时的预测"""
        self.tracker.set_budget("project-1", 5000)

        # 创建多笔支出记录
        now = datetime.now()
        for i in range(5):
            self.tracker.record_transaction(
                project_id="project-1",
                transaction_type=TransactionType.EXPENSE,
                amount=100,
                category="infrastructure",
                description=f"Cost {i}",
            )

        forecast = self.tracker.get_forecast("project-1")
        assert forecast.estimated_days_remaining > 0
        assert forecast.daily_burn_rate > 0
        assert forecast.projected_depletion_date is not None
        assert forecast.confidence in ["low", "medium", "high"]


class TestCreateBudgetTracker:
    """创建预算追踪器测试"""

    def test_create_with_default_precision(self):
        """测试使用默认精度创建"""
        tracker = create_budget_tracker()
        assert tracker._precision == 2

    def test_create_with_custom_precision(self):
        """测试使用自定义精度创建"""
        tracker = create_budget_tracker(precision=4)
        assert tracker._precision == 4

    def test_round_with_custom_precision(self):
        """测试自定义精度四舍五入"""
        tracker = create_budget_tracker(precision=4)
        tx = tracker.record_transaction(
            project_id="project-1",
            transaction_type=TransactionType.INCOME,
            amount=1000.123456,
            category="payment",
            description="Test",
        )

        assert tx.amount == Decimal("1000.1235")
