"""
自由职业技能模块
包含需求分析、代码生成和测试执行技能

@module nanobot.skills.freelance
@version 1.0.0
"""

from nanobot.skills.freelance.requirement import RequirementAnalyzer, RequirementAnalysis
from nanobot.skills.freelance.codegen import CodeGenerator, ComponentSpec
from nanobot.skills.freelance.testing import TestRunner, TestResult

__all__ = [
    "RequirementAnalyzer",
    "RequirementAnalysis",
    "CodeGenerator",
    "ComponentSpec",
    "TestRunner",
    "TestResult",
]
