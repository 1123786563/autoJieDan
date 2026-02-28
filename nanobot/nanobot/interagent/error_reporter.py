"""
ANP 错误报告器

实现错误报告的 ANP 协议适配
支持错误传递和恢复建议

@module interagent.error_reporter
@version 1.0.0
"""

import logging
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from nanobot.anp.types import (
    ANPMessage,
    ANPMessageType,
    ErrorReportPayload,
)


# ============================================================================
# 类型定义
# ============================================================================

class ErrorSeverity(str, Enum):
    """错误严重级别"""
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class RecoverySuggestion(BaseModel):
    """错误恢复建议"""
    action: str
    priority: Literal["low", "medium", "high"] = "medium"
    expected_outcome: Optional[str] = None


class ErrorContext(BaseModel):
    """错误上下文"""
    task_id: str
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    phase: Optional[str] = None
    files: Optional[List[str]] = None
    modules: Optional[List[str]] = None
    stack_trace: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ErrorReportOptions(BaseModel):
    """错误报告选项"""
    include_stack_trace: bool = False
    custom_suggestions: List[RecoverySuggestion] = Field(default_factory=list)
    related_files: List[str] = Field(default_factory=list)
    related_modules: List[str] = Field(default_factory=list)
    phase: Optional[str] = None


logger = logging.getLogger(__name__)


# ============================================================================
# 错误处理器
# ============================================================================

class ErrorHandler:
    """
    ANP 错误报告处理器

    功能:
    - 创建标准化错误报告
    - 生成错误恢复建议
    - 序列化/反序列化错误消息
    - 错误分类和分析
    """

    # 错误代码映射
    ERROR_CODES: Dict[str, str] = {
        # 通用错误
        "UNKNOWN_ERROR": "ANP_ERR_0001",
        "INVALID_INPUT": "ANP_ERR_0002",
        "TIMEOUT": "ANP_ERR_0003",
        "NOT_FOUND": "ANP_ERR_0004",

        # 任务相关错误
        "TASK_FAILED": "ANP_ERR_1001",
        "TASK_TIMEOUT": "ANP_ERR_1002",
        "TASK_CANCELLED": "ANP_ERR_1003",

        # 网络相关错误
        "NETWORK_ERROR": "ANP_ERR_2001",
        "CONNECTION_FAILED": "ANP_ERR_2002",
        "ENCRYPTION_FAILED": "ANP_ERR_2003",

        # 资源相关错误
        "OUT_OF_MEMORY": "ANP_ERR_3001",
        "DISK_FULL": "ANP_ERR_3002",
        "QUOTA_EXCEEDED": "ANP_ERR_3003",

        # 协议相关错误
        "PROTOCOL_ERROR": "ANP_ERR_4001",
        "INVALID_MESSAGE": "ANP_ERR_4002",
        "VERSION_MISMATCH": "ANP_ERR_4003",
    }

    def create_error_report(
        self,
        task_id: str,
        message: str,
        severity: ErrorSeverity,
        recoverable: bool,
        options: Optional[ErrorReportOptions] = None,
    ) -> ErrorReportPayload:
        """
        创建错误报告负载

        Args:
            task_id: 任务 ID
            message: 错误消息
            severity: 错误严重级别
            recoverable: 是否可恢复
            options: 错误报告选项

        Returns:
            ErrorReportPayload: 错误报告负载
        """
        options = options or ErrorReportOptions()

        error_code = self._infer_error_code(message, severity)
        context = self._build_error_context(task_id, options)
        suggestion = self._generate_suggestion(error_code, severity, options)

        return ErrorReportPayload(
            type="anp:ErrorReport",
            task_id=task_id,
            severity=severity,
            error_code=error_code,
            message=message,
            context=context,
            recoverable=recoverable,
            suggested_action=suggestion,
        )

    def create_error_from_exception(
        self,
        task_id: str,
        error: Exception,
        severity: ErrorSeverity = ErrorSeverity.ERROR,
        options: Optional[ErrorReportOptions] = None,
    ) -> ErrorReportPayload:
        """
        从异常创建错误报告

        Args:
            task_id: 任务 ID
            error: 异常对象
            severity: 错误严重级别
            options: 错误报告选项

        Returns:
            ErrorReportPayload: 错误报告负载
        """
        message = str(error)
        stack_trace = getattr(error, "__traceback__", None)

        # 包含堆栈跟踪
        enhanced_options = ErrorReportOptions(
            include_stack_trace=True,
            custom_suggestions=options.custom_suggestions if options else [],
            related_files=options.related_files if options else [],
            related_modules=options.related_modules if options else [],
            phase=options.phase if options else None,
        )

        report = self.create_error_report(
            task_id,
            message,
            severity,
            self._is_recoverable(error),
            enhanced_options,
        )

        # 添加堆栈跟踪到上下文
        import traceback
        if stack_trace:
            report.context["stackTrace"] = "".join(traceback.format_exception(
                type(error), error, stack_trace
            ))
        else:
            # 如果没有 traceback,生成当前堆栈跟踪
            report.context["stackTrace"] = "".join(traceback.format_stack())

        return report

    def _infer_error_code(
        self,
        message: str,
        severity: ErrorSeverity,
    ) -> str:
        """推断错误代码"""
        upper_message = message.upper()

        # 检查常见错误模式
        if "TIMEOUT" in upper_message or "超时" in message:
            return self.ERROR_CODES["TIMEOUT"]
        if "NOT FOUND" in upper_message or "未找到" in message:
            return self.ERROR_CODES["NOT_FOUND"]
        if "NETWORK" in upper_message or "网络" in message:
            return self.ERROR_CODES["NETWORK_ERROR"]
        if "CONNECTION" in upper_message or "连接" in message:
            return self.ERROR_CODES["CONNECTION_FAILED"]
        if "ENCRYPT" in upper_message or "加密" in message:
            return self.ERROR_CODES["ENCRYPTION_FAILED"]
        if "MEMORY" in upper_message or "内存" in message:
            return self.ERROR_CODES["OUT_OF_MEMORY"]
        if "DISK" in upper_message or "磁盘" in message:
            return self.ERROR_CODES["DISK_FULL"]
        if "QUOTA" in upper_message or "配额" in message:
            return self.ERROR_CODES["QUOTA_EXCEEDED"]
        if "PROTOCOL" in upper_message or "协议" in message:
            return self.ERROR_CODES["PROTOCOL_ERROR"]
        if "VERSION" in upper_message or "版本" in message:
            return self.ERROR_CODES["VERSION_MISMATCH"]

        # 根据严重级别返回默认代码
        return (
            self.ERROR_CODES["TASK_FAILED"]
            if severity == ErrorSeverity.CRITICAL
            else self.ERROR_CODES["UNKNOWN_ERROR"]
        )

    def _build_error_context(
        self,
        task_id: str,
        options: ErrorReportOptions,
    ) -> Dict[str, Any]:
        """构建错误上下文"""
        context: Dict[str, Any] = {
            "taskId": task_id,
            "timestamp": datetime.utcnow().isoformat(),
        }

        if options.include_stack_trace:
            import traceback
            context["stackTrace"] = "".join(traceback.format_stack())

        if options.related_files:
            context["files"] = options.related_files

        if options.related_modules:
            context["modules"] = options.related_modules

        if options.phase:
            context["phase"] = options.phase

        return context

    def _generate_suggestion(
        self,
        error_code: str,
        severity: ErrorSeverity,
        options: ErrorReportOptions,
    ) -> str:
        """生成恢复建议"""
        # 使用自定义建议
        if options.custom_suggestions:
            suggestion = options.custom_suggestions[0]
            return f"{suggestion.action} (优先级: {suggestion.priority})"

        # 根据错误代码生成建议
        suggestions: Dict[str, str] = {
            self.ERROR_CODES["TIMEOUT"]: "增加超时时间或检查网络连接",
            self.ERROR_CODES["NOT_FOUND"]: "验证资源路径是否正确",
            self.ERROR_CODES["NETWORK_ERROR"]: "检查网络连接并重试",
            self.ERROR_CODES["CONNECTION_FAILED"]: "验证目标服务是否可用",
            self.ERROR_CODES["ENCRYPTION_FAILED"]: "检查加密密钥配置",
            self.ERROR_CODES["OUT_OF_MEMORY"]: "减少并发任务或增加内存",
            self.ERROR_CODES["DISK_FULL"]: "清理磁盘空间",
            self.ERROR_CODES["QUOTA_EXCEEDED"]: "等待配额重置或升级计划",
            self.ERROR_CODES["PROTOCOL_ERROR"]: "验证协议版本兼容性",
            self.ERROR_CODES["INVALID_MESSAGE"]: "检查消息格式是否符合规范",
            self.ERROR_CODES["VERSION_MISMATCH"]: "更新到兼容的版本",
            self.ERROR_CODES["TASK_FAILED"]: "查看详细日志以获取更多信息",
        }

        return suggestions.get(
            error_code,
            "检查日志以获取更多详细信息,必要时联系支持团队",
        )

    def _is_recoverable(self, error: Exception) -> bool:
        """判断错误是否可恢复"""
        message = str(error).lower()

        # 可恢复的错误模式 (英文 + 中文)
        recoverable_patterns = [
            "timeout",
            "network",
            "connection",
            "temporary",
            "retry",
            # 中文模式
            "超时",
            "网络",
            "连接",
            "临时",
            "重试",
        ]

        return any(pattern in message for pattern in recoverable_patterns)

    def parse_error_report(
        self,
        payload: ErrorReportPayload,
    ) -> Dict[str, Any]:
        """解析错误报告"""
        return {
            "task_id": payload.task_id,
            "severity": payload.severity,
            "error_code": payload.error_code,
            "message": payload.message,
            "recoverable": payload.recoverable,
            "suggestion": payload.suggested_action or "无可用建议",
        }

    def format_error_report(self, payload: ErrorReportPayload) -> str:
        """格式化错误报告为可读文本"""
        parsed = self.parse_error_report(payload)

        severity_emoji = {
            ErrorSeverity.WARNING: "⚠️",
            ErrorSeverity.ERROR: "❌",
            ErrorSeverity.CRITICAL: "🚨",
        }

        return "\n".join([
            f"{severity_emoji[parsed['severity']]} 错误报告",
            f"任务 ID: {parsed['task_id']}",
            f"严重级别: {parsed['severity']}",
            f"错误代码: {parsed['error_code']}",
            f"消息: {parsed['message']}",
            f"可恢复: {'是' if parsed['recoverable'] else '否'}",
            f"建议: {parsed['suggestion']}",
        ])

    def validate_error_report(self, payload: ErrorReportPayload) -> Dict[str, Any]:
        """验证错误报告"""
        errors = []

        if not payload.task_id:
            errors.append("缺少 taskId")

        if not payload.error_code:
            errors.append("缺少 errorCode")

        if not payload.message:
            errors.append("缺少 message")

        valid_severities = [ErrorSeverity.WARNING, ErrorSeverity.ERROR, ErrorSeverity.CRITICAL]
        if payload.severity not in valid_severities:
            errors.append(f"无效的 severity: {payload.severity}")

        if not isinstance(payload.recoverable, bool):
            errors.append("recoverable 必须是布尔值")

        return {
            "valid": len(errors) == 0,
            "errors": errors,
        }


# ============================================================================
# 错误恢复策略生成器
# ============================================================================

class ErrorRecoveryStrategy:
    """错误恢复策略"""

    def __init__(self):
        self.handler = ErrorHandler()

    def generate_retry_strategy(
        self,
        max_retries: int = 3,
        backoff_ms: int = 1000,
    ) -> RecoverySuggestion:
        """生成重试策略"""
        return RecoverySuggestion(
            action=f"重试操作 (最多 {max_retries} 次, 退避 {backoff_ms}ms)",
            priority="medium",
            expected_outcome="操作在重试后成功",
        )

    def generate_fallback_strategy(
        self,
        fallback_action: str,
    ) -> RecoverySuggestion:
        """生成回退策略"""
        return RecoverySuggestion(
            action=f"执行回退操作: {fallback_action}",
            priority="high",
            expected_outcome="使用替代方案完成操作",
        )

    def generate_escalation_strategy(
        self,
        escalate_to: str,
        reason: str,
    ) -> RecoverySuggestion:
        """生成升级策略"""
        return RecoverySuggestion(
            action=f"升级到 {escalate_to}: {reason}",
            priority="high",
            expected_outcome="获得更高级别的支持或干预",
        )

    def generate_default_strategy(
        self,
        error_code: str,
    ) -> List[RecoverySuggestion]:
        """为错误类型生成默认恢复策略"""
        strategies: Dict[str, List[RecoverySuggestion]] = {
            ErrorHandler.ERROR_CODES["TIMEOUT"]: [
                self.generate_retry_strategy(3, 2000),
                RecoverySuggestion(
                    action="检查网络连接稳定性",
                    priority="medium",
                ),
            ],
            ErrorHandler.ERROR_CODES["NETWORK_ERROR"]: [
                self.generate_retry_strategy(5, 1000),
                RecoverySuggestion(
                    action="验证目标服务可用性",
                    priority="high",
                ),
            ],
            ErrorHandler.ERROR_CODES["CONNECTION_FAILED"]: [
                self.generate_retry_strategy(3, 5000),
                self.generate_fallback_strategy("使用备用连接"),
            ],
            ErrorHandler.ERROR_CODES["OUT_OF_MEMORY"]: [
                RecoverySuggestion(
                    action="减少并发任务数量",
                    priority="high",
                    expected_outcome="降低内存使用",
                ),
                RecoverySuggestion(
                    action="增加可用内存",
                    priority="medium",
                ),
            ],
            ErrorHandler.ERROR_CODES["QUOTA_EXCEEDED"]: [
                RecoverySuggestion(
                    action="等待配额重置",
                    priority="low",
                ),
                self.generate_escalation_strategy("管理员", "请求增加配额"),
            ],
        }

        return strategies.get(
            error_code,
            [
                RecoverySuggestion(
                    action="查看详细日志",
                    priority="low",
                ),
                self.generate_escalation_strategy("技术支持", "无法自动恢复"),
            ],
        )


# ============================================================================
# 导出
# ============================================================================

__all__ = [
    "ErrorHandler",
    "ErrorRecoveryStrategy",
    "ErrorSeverity",
    "RecoverySuggestion",
    "ErrorContext",
    "ErrorReportOptions",
]
