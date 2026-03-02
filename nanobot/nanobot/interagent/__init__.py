"""
Interagent module for nanobot.

Provides project filtering and evaluation capabilities for autonomous agent operations.
"""

from nanobot.interagent.project_filter import (
    FilterConfig,
    ProjectCandidate,
    ProjectFilter,
    ProjectScore,
    Recommendation,
    ScoringWeights,
)
from nanobot.interagent.requirement_parser import (
    ComplexityLevel,
    EffortEstimate,
    ParsedRequirement,
    RequirementParser,
    RiskFactor,
    RiskLevel,
    SkillRequirement,
    TechStack,
)

# 导入错误报告模块
from nanobot.interagent.error_reporter import (
    ErrorHandler,
    ErrorRecoveryStrategy,
    ErrorSeverity,
    RecoverySuggestion,
    ErrorContext,
    ErrorReportOptions,
)

__all__ = [
    "ProjectFilter",
    "ProjectCandidate",
    "ProjectScore",
    "ScoringWeights",
    "FilterConfig",
    "Recommendation",
    "RequirementParser",
    "ParsedRequirement",
    "TechStack",
    "RiskFactor",
    "RiskLevel",
    "ComplexityLevel",
    "SkillRequirement",
    "EffortEstimate",
    # 错误报告
    "ErrorHandler",
    "ErrorRecoveryStrategy",
    "ErrorSeverity",
    "RecoverySuggestion",
    "ErrorContext",
    "ErrorReportOptions",
]
