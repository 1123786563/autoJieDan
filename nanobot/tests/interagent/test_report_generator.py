"""
T040: 集成测试报告生成器

收集所有测试结果并生成综合报告
包括测试通过率、性能指标、安全扫描结果等

@module tests.interagent.test_report_generator
@version 1.0.0
"""

import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import List, Dict, Optional


class TestStatus(str, Enum):
    """测试状态枚举"""
    PASS = "pass"
    FAIL = "fail"
    SKIP = "skip"


class SecurityStatus(str, Enum):
    """安全检查状态枚举"""
    PASS = "pass"
    FAIL = "fail"
    WARNING = "warning"


class OverallStatus(str, Enum):
    """整体状态枚举"""
    PASS = "pass"
    FAIL = "fail"
    PARTIAL = "partial"


@dataclass
class TestResult:
    """单个测试结果"""
    test_id: str
    test_name: str
    status: TestStatus
    duration: float  # 毫秒
    phase: int
    category: str
    details: Optional[str] = None


@dataclass
class PerformanceMetric:
    """性能指标"""
    name: str
    value: float
    unit: str
    threshold: float
    passed: bool


@dataclass
class SecurityCheck:
    """安全检查结果"""
    category: str
    description: str
    status: SecurityStatus
    details: Optional[str] = None


@dataclass
class CoverageReport:
    """覆盖率报告"""
    statements: float
    branches: float
    functions: float
    lines: float


@dataclass
class TestResults:
    """阶段测试结果统计"""
    total: int
    passed: int
    failed: int
    skipped: int
    pass_rate: float
    tests: List[TestResult] = field(default_factory=list)


@dataclass
class ReportSummary:
    """报告摘要"""
    overall_status: OverallStatus
    total_tests: int
    passed_tests: int
    failed_tests: int
    overall_pass_rate: float
    critical_issues: List[str] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)


@dataclass
class IntegrationTestReport:
    """集成测试完整报告"""
    generated_at: datetime
    project: str
    version: str
    phases: Dict[str, TestResults]
    performance: List[PerformanceMetric]
    security: List[SecurityCheck]
    coverage: CoverageReport
    summary: ReportSummary


class TestReportGenerator:
    """
    集成测试报告生成器类
    """

    def __init__(self):
        self.results: Dict[str, TestResult] = {}
        self.performance_metrics: List[PerformanceMetric] = []
        self.security_checks: List[SecurityCheck] = []
        self.coverage: Optional[CoverageReport] = None

    def add_test_result(self, result: TestResult) -> None:
        """添加测试结果"""
        self.results[result.test_id] = result

    def add_performance_metric(self, metric: PerformanceMetric) -> None:
        """添加性能指标"""
        self.performance_metrics.append(metric)

    def add_security_check(self, check: SecurityCheck) -> None:
        """添加安全检查结果"""
        self.security_checks.append(check)

    def set_coverage(self, coverage: CoverageReport) -> None:
        """设置覆盖率报告"""
        self.coverage = coverage

    def _group_tests_by_phase(self) -> Dict[int, List[TestResult]]:
        """按阶段分组测试结果"""
        grouped: Dict[int, List[TestResult]] = {}
        for result in self.results.values():
            phase = result.phase
            if phase not in grouped:
                grouped[phase] = []
            grouped[phase].append(result)
        return grouped

    def _calculate_phase_stats(self, tests: List[TestResult]) -> TestResults:
        """计算阶段测试统计"""
        passed = sum(1 for t in tests if t.status == TestStatus.PASS)
        failed = sum(1 for t in tests if t.status == TestStatus.FAIL)
        skipped = sum(1 for t in tests if t.status == TestStatus.SKIP)
        total = len(tests)

        return TestResults(
            total=total,
            passed=passed,
            failed=failed,
            skipped=skipped,
            pass_rate=(passed / total * 100) if total > 0 else 0,
            tests=tests,
        )

    def _generate_summary(self) -> ReportSummary:
        """生成报告摘要"""
        all_tests = list(self.results.values())
        total = len(all_tests)
        passed = sum(1 for t in all_tests if t.status == TestStatus.PASS)
        failed = sum(1 for t in all_tests if t.status == TestStatus.FAIL)
        pass_rate = (passed / total * 100) if total > 0 else 0

        # 收集关键问题
        critical_issues: List[str] = []
        recommendations: List[str] = []

        # 检查性能指标
        for metric in self.performance_metrics:
            if not metric.passed:
                critical_issues.append(
                    f"性能不达标: {metric.name} ({metric.value}{metric.unit} > {metric.threshold}{metric.unit})"
                )
                recommendations.append(
                    f"优化{metric.name}以符合阈值 {metric.threshold}{metric.unit}"
                )

        # 检查安全扫描
        for check in self.security_checks:
            if check.status == SecurityStatus.FAIL:
                critical_issues.append(f"安全问题: {check.category} - {check.description}")
                recommendations.append(f"修复{check.category}相关问题")
            elif check.status == SecurityStatus.WARNING:
                recommendations.append(f"关注{check.category}潜在风险: {check.description}")

        # 检查覆盖率
        if self.coverage and self.coverage.lines < 80:
            critical_issues.append(f"测试覆盖率不足: {self.coverage.lines}% < 80%")
            recommendations.append("增加测试用例以提高覆盖率")

        # 确定整体状态
        if failed == 0 and len(critical_issues) == 0:
            overall_status = OverallStatus.PASS
        elif failed > 0 or len(critical_issues) > 0:
            overall_status = OverallStatus.FAIL
        else:
            overall_status = OverallStatus.PARTIAL

        return ReportSummary(
            overall_status=overall_status,
            total_tests=total,
            passed_tests=passed,
            failed_tests=failed,
            overall_pass_rate=pass_rate,
            critical_issues=critical_issues,
            recommendations=recommendations,
        )

    def generate_report(self) -> IntegrationTestReport:
        """生成完整报告"""
        grouped = self._group_tests_by_phase()

        return IntegrationTestReport(
            generated_at=datetime.now(),
            project="autoJieDan",
            version="1.0.0",
            phases={
                "phase1": self._calculate_phase_stats(grouped.get(1, [])),
                "phase2": self._calculate_phase_stats(grouped.get(2, [])),
                "phase3": self._calculate_phase_stats(grouped.get(3, [])),
                "phase4": self._calculate_phase_stats(grouped.get(4, [])),
            },
            performance=self.performance_metrics,
            security=self.security_checks,
            coverage=self.coverage or CoverageReport(0, 0, 0, 0),
            summary=self._generate_summary(),
        )

    def save_report_json(self, file_path: str) -> None:
        """将报告保存为JSON文件"""
        report = self.generate_report()

        # 转换为可序列化的字典
        report_dict = {
            "generated_at": report.generated_at.isoformat(),
            "project": report.project,
            "version": report.version,
            "phases": {
                key: {
                    "total": value.total,
                    "passed": value.passed,
                    "failed": value.failed,
                    "skipped": value.skipped,
                    "pass_rate": value.pass_rate,
                    "tests": [
                        {
                            "test_id": t.test_id,
                            "test_name": t.test_name,
                            "status": t.status.value,
                            "duration": t.duration,
                            "phase": t.phase,
                            "category": t.category,
                            "details": t.details,
                        }
                        for t in value.tests
                    ],
                }
                for key, value in report.phases.items()
            },
            "performance": [
                {
                    "name": m.name,
                    "value": m.value,
                    "unit": m.unit,
                    "threshold": m.threshold,
                    "passed": m.passed,
                }
                for m in report.performance
            ],
            "security": [
                {
                    "category": s.category,
                    "description": s.description,
                    "status": s.status.value,
                    "details": s.details,
                }
                for s in report.security
            ],
            "coverage": {
                "statements": report.coverage.statements,
                "branches": report.coverage.branches,
                "functions": report.coverage.functions,
                "lines": report.coverage.lines,
            },
            "summary": {
                "overall_status": report.summary.overall_status.value,
                "total_tests": report.summary.total_tests,
                "passed_tests": report.summary.passed_tests,
                "failed_tests": report.summary.failed_tests,
                "overall_pass_rate": report.summary.overall_pass_rate,
                "critical_issues": report.summary.critical_issues,
                "recommendations": report.summary.recommendations,
            },
        }

        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(report_dict, f, indent=2, ensure_ascii=False)

    def save_report_markdown(self, file_path: str) -> None:
        """将报告保存为Markdown文件"""
        report = self.generate_report()
        markdown = self._format_markdown(report)

        with open(file_path, "w", encoding="utf-8") as f:
            f.write(markdown)

    def _format_markdown(self, report: IntegrationTestReport) -> str:
        """格式化Markdown报告"""
        lines: List[str] = []

        lines.append("# 集成测试报告")
        lines.append("")
        lines.append(f"**生成时间**: {report.generated_at.isoformat()}")
        lines.append(f"**项目**: {report.project}")
        lines.append(f"**版本**: {report.version}")
        lines.append("")

        # 摘要
        lines.append("## 摘要")
        lines.append("")
        lines.append(f"**整体状态**: {self._format_status(report.summary.overall_status)}")
        lines.append(f"**测试总数**: {report.summary.total_tests}")
        lines.append(f"**通过**: {report.summary.passed_tests}")
        lines.append(f"**失败**: {report.summary.failed_tests}")
        lines.append(f"**通过率**: {report.summary.overall_pass_rate:.2f}%")
        lines.append("")

        # 阶段结果
        lines.append("## 阶段测试结果")
        lines.append("")

        phases = [
            ("Phase 1: ANP基础设施", "phase1"),
            ("Phase 2: 协议层实现", "phase2"),
            ("Phase 3: 业务集成", "phase3"),
            ("Phase 4: 端到端测试", "phase4"),
        ]

        for phase_name, phase_key in phases:
            results = report.phases[phase_key]
            lines.append(f"### {phase_name}")
            lines.append("")
            lines.append(f"- 总数: {results.total}")
            lines.append(f"- 通过: {results.passed}")
            lines.append(f"- 失败: {results.failed}")
            lines.append(f"- 跳过: {results.skipped}")
            lines.append(f"- 通过率: {results.pass_rate:.2f}%")
            lines.append("")

        # 性能指标
        lines.append("## 性能指标")
        lines.append("")
        lines.append("| 指标 | 值 | 单位 | 阈值 | 状态 |")
        lines.append("|------|-----|------|------|------|")

        for metric in report.performance:
            status = "✓" if metric.passed else "✗"
            lines.append(f"| {metric.name} | {metric.value} | {metric.unit} | {metric.threshold} | {status} |")
        lines.append("")

        # 安全检查
        lines.append("## 安全检查")
        lines.append("")
        lines.append("| 类别 | 描述 | 状态 |")
        lines.push("|------|------|------|")

        for check in report.security:
            status = self._format_security_status(check.status)
            lines.append(f"| {check.category} | {check.description} | {status} |")
        lines.append("")

        # 代码覆盖率
        lines.append("## 代码覆盖率")
        lines.append("")
        lines.append(f"- 语句: {report.coverage.statements}%")
        lines.append(f"- 分支: {report.coverage.branches}%")
        lines.append(f"- 函数: {report.coverage.functions}%")
        lines.append(f"- 行: {report.coverage.lines}%")
        lines.append("")

        # 关键问题
        if report.summary.critical_issues:
            lines.append("## 关键问题")
            lines.append("")
            for issue in report.summary.critical_issues:
                lines.append(f"- {issue}")
            lines.append("")

        # 建议
        if report.summary.recommendations:
            lines.append("## 建议")
            lines.append("")
            for rec in report.summary.recommendations:
                lines.append(f"- {rec}")
            lines.append("")

        return "\n".join(lines)

    @staticmethod
    def _format_status(status: OverallStatus) -> str:
        """格式化状态标识"""
        status_map = {
            OverallStatus.PASS: "✅ 通过",
            OverallStatus.FAIL: "❌ 失败",
            OverallStatus.PARTIAL: "⚠️ 部分通过",
        }
        return status_map.get(status, status.value)

    @staticmethod
    def _format_security_status(status: SecurityStatus) -> str:
        """格式化安全状态"""
        status_map = {
            SecurityStatus.PASS: "✅ 通过",
            SecurityStatus.FAIL: "❌ 失败",
            SecurityStatus.WARNING: "⚠️ 警告",
        }
        return status_map.get(status, status.value)


def create_test_report_generator() -> TestReportGenerator:
    """创建测试报告生成器实例"""
    return TestReportGenerator()


def generate_test_report(
    test_results: List[TestResult],
    performance: List[PerformanceMetric],
    security: List[SecurityCheck],
    coverage: CoverageReport,
    output_path: str,
) -> None:
    """
    快速生成报告的辅助函数

    Args:
        test_results: 测试结果列表
        performance: 性能指标列表
        security: 安全检查列表
        coverage: 覆盖率报告
        output_path: 输出文件路径（不含扩展名）
    """
    generator = create_test_report_generator()

    # 添加所有测试结果
    for result in test_results:
        generator.add_test_result(result)

    # 添加性能指标
    for metric in performance:
        generator.add_performance_metric(metric)

    # 添加安全检查
    for check in security:
        generator.add_security_check(check)

    # 设置覆盖率
    generator.set_coverage(coverage)

    # 生成报告
    generator.save_report_json(f"{output_path}.json")
    generator.save_report_markdown(f"{output_path}.md")
