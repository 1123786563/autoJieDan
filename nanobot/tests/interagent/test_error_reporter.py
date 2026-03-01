"""
ANP 错误报告器测试

测试错误传递和恢复建议

@module tests.interagent.test_error_reporter
@version 1.0.0
"""

import pytest
from nanobot.interagent.error_reporter import (
    ErrorHandler,
    ErrorRecoveryStrategy,
    ErrorSeverity,
    RecoverySuggestion,
    ErrorReportOptions,
)


class TestErrorHandler:
    """错误处理器测试"""

    def test_create_basic_error_report(self):
        """测试创建基本错误报告"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-123",
            message="测试错误",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
        )

        assert report.type == "anp:ErrorReport"
        assert report.task_id == "task-123"
        assert report.message == "测试错误"
        assert report.severity == ErrorSeverity.ERROR
        assert report.recoverable is True
        assert report.error_code is not None
        assert report.suggested_action is not None

    def test_create_error_from_exception(self):
        """测试从异常创建错误报告"""
        handler = ErrorHandler()
        error = Exception("操作超时")  # 使用可恢复的错误消息
        report = handler.create_error_from_exception(
            task_id="task-456",
            error=error,
            severity=ErrorSeverity.CRITICAL,
        )

        assert report.task_id == "task-456"
        assert report.message == "操作超时"
        assert report.severity == ErrorSeverity.CRITICAL
        assert report.context.get("stackTrace") is not None  # context 是字典
        assert report.recoverable is True  # 超时错误应该被识别为可恢复

    def test_infer_timeout_error_code(self):
        """测试推断超时错误代码"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-789",
            message="操作超时",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
        )

        assert report.error_code == "ANP_ERR_0003"

    def test_infer_network_error_code(self):
        """测试推断网络错误代码"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-101",
            message="网络连接失败",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
        )

        assert report.error_code == "ANP_ERR_2001"

    def test_infer_not_found_error_code(self):
        """测试推断未找到错误代码"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-102",
            message="资源未找到",
            severity=ErrorSeverity.ERROR,
            recoverable=False,
        )

        assert report.error_code == "ANP_ERR_0004"


class TestErrorSeverity:
    """错误严重级别测试"""

    def test_create_warning_error(self):
        """测试创建警告级别错误"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-201",
            message="警告消息",
            severity=ErrorSeverity.WARNING,
            recoverable=True,
        )

        assert report.severity == ErrorSeverity.WARNING

    def test_create_error_severity(self):
        """测试创建错误级别错误"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-202",
            message="错误消息",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
        )

        assert report.severity == ErrorSeverity.ERROR

    def test_create_critical_severity(self):
        """测试创建严重级别错误"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-203",
            message="严重错误",
            severity=ErrorSeverity.CRITICAL,
            recoverable=False,
        )

        assert report.severity == ErrorSeverity.CRITICAL


class TestErrorRecoverySuggestions:
    """错误恢复建议测试"""

    def test_generate_suggestion_for_timeout(self):
        """测试为超时错误生成建议"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-301",
            message="操作超时",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
        )

        assert "超时" in report.suggested_action or "timeout" in report.suggested_action.lower()

    def test_generate_suggestion_for_network(self):
        """测试为网络错误生成建议"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-302",
            message="网络连接失败",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
        )

        assert "网络" in report.suggested_action or "network" in report.suggested_action.lower()

    def test_custom_suggestions(self):
        """测试自定义建议"""
        handler = ErrorHandler()
        custom_suggestion = RecoverySuggestion(
            action="重启服务",
            priority="high",
            expected_outcome="服务恢复正常",
        )

        report = handler.create_error_report(
            task_id="task-303",
            message="服务无响应",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
            options=ErrorReportOptions(custom_suggestions=[custom_suggestion]),
        )

        assert "重启服务" in report.suggested_action

    def test_unrecoverable_error_suggestion(self):
        """测试不可恢复错误建议"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-304",
            message="严重故障",
            severity=ErrorSeverity.CRITICAL,
            recoverable=False,
        )

        assert report.recoverable is False
        assert report.suggested_action is not None


class TestErrorContext:
    """错误上下文测试"""

    def test_include_task_id(self):
        """测试包含任务 ID"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-401",
            message="测试错误",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
        )

        assert report.context["taskId"] == "task-401"

    def test_include_timestamp(self):
        """测试包含时间戳"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-402",
            message="测试错误",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
        )

        assert "timestamp" in report.context
        assert report.context["timestamp"] is not None

    def test_include_related_files(self):
        """测试包含相关文件"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-403",
            message="测试错误",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
            options=ErrorReportOptions(
                related_files=["/path/to/file.ts", "/path/to/another.ts"]
            ),
        )

        assert report.context["files"] == ["/path/to/file.ts", "/path/to/another.ts"]

    def test_include_related_modules(self):
        """测试包含相关模块"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-404",
            message="测试错误",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
            options=ErrorReportOptions(related_modules=["module1", "module2"]),
        )

        assert report.context["modules"] == ["module1", "module2"]

    def test_include_error_phase(self):
        """测试包含错误阶段"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-405",
            message="测试错误",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
            options=ErrorReportOptions(phase="execution"),
        )

        assert report.context["phase"] == "execution"


class TestErrorParsing:
    """错误解析测试"""

    def test_parse_error_report(self):
        """测试解析错误报告"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-501",
            message="解析测试",
            severity=ErrorSeverity.WARNING,
            recoverable=True,
        )

        parsed = handler.parse_error_report(report)

        assert parsed["task_id"] == "task-501"
        assert parsed["message"] == "解析测试"
        assert parsed["severity"] == ErrorSeverity.WARNING
        assert parsed["recoverable"] is True


class TestErrorFormatting:
    """错误格式化测试"""

    def test_format_error_report(self):
        """测试格式化错误报告为可读文本"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-601",
            message="格式化测试",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
        )

        formatted = handler.format_error_report(report)

        assert "错误报告" in formatted
        assert "task-601" in formatted
        assert "格式化测试" in formatted

    def test_format_includes_severity_emoji(self):
        """测试格式化包含严重级别表情符号"""
        handler = ErrorHandler()

        warning_report = handler.create_error_report(
            task_id="task-602",
            message="警告",
            severity=ErrorSeverity.WARNING,
            recoverable=True,
        )
        error_report = handler.create_error_report(
            task_id="task-603",
            message="错误",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
        )
        critical_report = handler.create_error_report(
            task_id="task-604",
            message="严重",
            severity=ErrorSeverity.CRITICAL,
            recoverable=False,
        )

        assert "⚠️" in handler.format_error_report(warning_report)
        assert "❌" in handler.format_error_report(error_report)
        assert "🚨" in handler.format_error_report(critical_report)


class TestErrorValidation:
    """错误验证测试"""

    def test_validate_valid_error_report(self):
        """测试验证有效的错误报告"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="task-801",
            message="验证测试",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
        )

        validation = handler.validate_error_report(report)

        assert validation["valid"] is True
        assert len(validation["errors"]) == 0

    def test_detect_missing_task_id(self):
        """测试检测缺少 taskId"""
        handler = ErrorHandler()
        report = handler.create_error_report(
            task_id="",
            message="测试",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
        )

        validation = handler.validate_error_report(report)

        assert validation["valid"] is False
        assert any("taskId" in error for error in validation["errors"])


class TestErrorRecoveryStrategy:
    """错误恢复策略测试"""

    def test_generate_retry_strategy(self):
        """测试生成重试策略"""
        strategy = ErrorRecoveryStrategy()
        retry = strategy.generate_retry_strategy(max_retries=3, backoff_ms=2000)

        assert "重试" in retry.action
        assert "3" in retry.action
        assert "2000" in retry.action
        assert retry.priority == "medium"

    def test_generate_fallback_strategy(self):
        """测试生成回退策略"""
        strategy = ErrorRecoveryStrategy()
        fallback = strategy.generate_fallback_strategy("使用缓存")

        assert "使用缓存" in fallback.action
        assert fallback.priority == "high"

    def test_generate_escalation_strategy(self):
        """测试生成升级策略"""
        strategy = ErrorRecoveryStrategy()
        escalation = strategy.generate_escalation_strategy("管理员", "需要权限")

        assert "管理员" in escalation.action
        assert "需要权限" in escalation.action
        assert escalation.priority == "high"

    def test_generate_default_strategy_for_timeout(self):
        """测试为超时错误生成默认策略"""
        strategy = ErrorRecoveryStrategy()
        strategies = strategy.generate_default_strategy("ANP_ERR_0003")

        assert len(strategies) > 0
        assert any("重试" in s.action for s in strategies)

    def test_generate_default_strategy_for_network(self):
        """测试为网络错误生成默认策略"""
        strategy = ErrorRecoveryStrategy()
        strategies = strategy.generate_default_strategy("ANP_ERR_2001")

        assert len(strategies) > 0

    def test_generate_default_strategy_for_memory(self):
        """测试为内存错误生成默认策略"""
        strategy = ErrorRecoveryStrategy()
        strategies = strategy.generate_default_strategy("ANP_ERR_3001")

        assert len(strategies) > 0
        reduce_tasks = next((s for s in strategies if "减少" in s.action), None)
        assert reduce_tasks is not None

    def test_generate_default_strategy_for_quota(self):
        """测试为配额错误生成默认策略"""
        strategy = ErrorRecoveryStrategy()
        strategies = strategy.generate_default_strategy("ANP_ERR_3003")

        assert len(strategies) > 0
        escalate = next((s for s in strategies if "升级" in s.action), None)
        assert escalate is not None


class TestErrorRecoveryIntegration:
    """错误恢复集成测试"""

    def test_complete_error_handling_flow(self):
        """测试完整的错误处理流程"""
        handler = ErrorHandler()
        strategy = ErrorRecoveryStrategy()

        # 模拟错误发生
        error = Exception("操作超时")  # 使用可恢复的错误消息

        # 创建错误报告
        report = handler.create_error_from_exception(
            task_id="task-integration-1",
            error=error,
            severity=ErrorSeverity.ERROR,
        )

        # 验证报告
        assert report.task_id == "task-integration-1"
        assert report.recoverable is True  # 超时错误应该被识别为可恢复

        # 生成恢复策略
        recovery_strategies = strategy.generate_default_strategy(report.error_code)

        # 验证策略
        assert len(recovery_strategies) > 0

        # 格式化错误报告
        formatted = handler.format_error_report(report)

        # 验证格式化
        assert "❌" in formatted
        assert "task-integration-1" in formatted

    def test_error_propagation_chain(self):
        """测试错误传递链"""
        handler1 = ErrorHandler()
        handler2 = ErrorHandler()

        # Agent 1 创建错误
        error_report1 = handler1.create_error_report(
            task_id="task-chain-1",
            message="初始错误",
            severity=ErrorSeverity.ERROR,
            recoverable=True,
        )

        # Agent 2 接收并处理错误
        parsed1 = handler1.parse_error_report(error_report1)
        error_report2 = handler2.create_error_report(
            task_id=parsed1["task_id"],
            message=f"接收到的错误: {parsed1['message']}",
            severity=ErrorSeverity.ERROR,
            recoverable=parsed1["recoverable"],
        )

        # 验证错误传递
        assert error_report2.task_id == "task-chain-1"
        assert "初始错误" in error_report2.message
