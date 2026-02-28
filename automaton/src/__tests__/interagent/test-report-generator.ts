/**
 * T040: 集成测试报告生成器
 *
 * 收集所有测试结果并生成综合报告
 * 包括测试通过率、性能指标、安全扫描结果等
 *
 * @module interagent/test-report-generator
 */

import fs from "fs";
import path from "path";

interface TestResult {
  testId: string;
  testName: string;
  status: "pass" | "fail" | "skip";
  duration: number;
  phase: number;
  category: string;
  details?: string;
}

interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  threshold: number;
  passed: boolean;
}

interface SecurityCheck {
  category: string;
  description: string;
  status: "pass" | "fail" | "warning";
  details?: string;
}

interface CoverageReport {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

interface IntegrationTestReport {
  generatedAt: Date;
  project: string;
  version: string;
  phases: {
    phase1: TestResults;
    phase2: TestResults;
    phase3: TestResults;
    phase4: TestResults;
  };
  performance: PerformanceMetric[];
  security: SecurityCheck[];
  coverage: CoverageReport;
  summary: ReportSummary;
}

interface TestResults {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  tests: TestResult[];
}

interface ReportSummary {
  overallStatus: "pass" | "fail" | "partial";
  totalTests: number;
  passedTests: number;
  failedTests: number;
  overallPassRate: number;
  criticalIssues: string[];
  recommendations: string[];
}

/**
 * 集成测试报告生成器类
 */
export class TestReportGenerator {
  private results: Map<string, TestResult> = new Map();
  private performanceMetrics: PerformanceMetric[] = [];
  private securityChecks: SecurityCheck[] = [];
  private coverage?: CoverageReport;

  /**
   * 添加测试结果
   */
  addTestResult(result: TestResult): void {
    this.results.set(result.testId, result);
  }

  /**
   * 添加性能指标
   */
  addPerformanceMetric(metric: PerformanceMetric): void {
    this.performanceMetrics.push(metric);
  }

  /**
   * 添加安全检查结果
   */
  addSecurityCheck(check: SecurityCheck): void {
    this.securityChecks.push(check);
  }

  /**
   * 设置覆盖率报告
   */
  setCoverage(coverage: CoverageReport): void {
    this.coverage = coverage;
  }

  /**
   * 按阶段分组测试结果
   */
  private groupTestsByPhase(): Map<number, TestResult[]> {
    const grouped = new Map<number, TestResult[]>();
    for (const [_, result] of this.results) {
      const phase = result.phase;
      if (!grouped.has(phase)) {
        grouped.set(phase, []);
      }
      grouped.get(phase)!.push(result);
    }
    return grouped;
  }

  /**
   * 计算阶段测试统计
   */
  private calculatePhaseStats(tests: TestResult[]): TestResults {
    const passed = tests.filter((t) => t.status === "pass").length;
    const failed = tests.filter((t) => t.status === "fail").length;
    const skipped = tests.filter((t) => t.status === "skip").length;
    const total = tests.length;

    return {
      total,
      passed,
      failed,
      skipped,
      passRate: total > 0 ? (passed / total) * 100 : 0,
      tests,
    };
  }

  /**
   * 生成报告摘要
   */
  private generateSummary(): ReportSummary {
    const allTests = Array.from(this.results.values());
    const total = allTests.length;
    const passed = allTests.filter((t) => t.status === "pass").length;
    const failed = allTests.filter((t) => t.status === "fail").length;
    const passRate = total > 0 ? (passed / total) * 100 : 0;

    // 收集关键问题
    const criticalIssues: string[] = [];
    const recommendations: string[] = [];

    // 检查性能指标
    for (const metric of this.performanceMetrics) {
      if (!metric.passed) {
        criticalIssues.push(
          `性能不达标: ${metric.name} (${metric.value}${metric.unit} > ${metric.threshold}${metric.unit})`
        );
        recommendations.push(
          `优化${metric.name}以符合阈值 ${metric.threshold}${metric.unit}`
        );
      }
    }

    // 检查安全扫描
    for (const check of this.securityChecks) {
      if (check.status === "fail") {
        criticalIssues.push(`安全问题: ${check.category} - ${check.description}`);
        recommendations.push(`修复${check.category}相关问题`);
      } else if (check.status === "warning") {
        recommendations.push(`关注${check.category}潜在风险: ${check.description}`);
      }
    }

    // 检查覆盖率
    if (this.coverage) {
      const coverageThreshold = 80;
      if (this.coverage.lines < coverageThreshold) {
        criticalIssues.push(
          `测试覆盖率不足: ${this.coverage.lines}% < ${coverageThreshold}%`
        );
        recommendations.push("增加测试用例以提高覆盖率");
      }
    }

    // 确定整体状态
    let overallStatus: "pass" | "fail" | "partial";
    if (failed === 0 && criticalIssues.length === 0) {
      overallStatus = "pass";
    } else if (failed > 0 || criticalIssues.length > 0) {
      overallStatus = "fail";
    } else {
      overallStatus = "partial";
    }

    return {
      overallStatus,
      totalTests: total,
      passedTests: passed,
      failedTests: failed,
      overallPassRate: passRate,
      criticalIssues,
      recommendations,
    };
  }

  /**
   * 生成完整报告
   */
  generateReport(): IntegrationTestReport {
    const grouped = this.groupTestsByPhase();

    return {
      generatedAt: new Date(),
      project: "autoJieDan",
      version: "1.0.0",
      phases: {
        phase1: this.calculatePhaseStats(grouped.get(1) || []),
        phase2: this.calculatePhaseStats(grouped.get(2) || []),
        phase3: this.calculatePhaseStats(grouped.get(3) || []),
        phase4: this.calculatePhaseStats(grouped.get(4) || []),
      },
      performance: this.performanceMetrics,
      security: this.securityChecks,
      coverage: this.coverage || {
        statements: 0,
        branches: 0,
        functions: 0,
        lines: 0,
      },
      summary: this.generateSummary(),
    };
  }

  /**
   * 将报告保存为JSON文件
   */
  saveReportJson(filePath: string): void {
    const report = this.generateReport();
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf-8");
  }

  /**
   * 将报告保存为Markdown文件
   */
  saveReportMarkdown(filePath: string): void {
    const report = this.generateReport();
    const markdown = this.formatMarkdown(report);
    fs.writeFileSync(filePath, markdown, "utf-8");
  }

  /**
   * 格式化Markdown报告
   */
  private formatMarkdown(report: IntegrationTestReport): string {
    const lines: string[] = [];

    lines.push("# 集成测试报告");
    lines.push("");
    lines.push(`**生成时间**: ${report.generatedAt.toISOString()}`);
    lines.push(`**项目**: ${report.project}`);
    lines.push(`**版本**: ${report.version}`);
    lines.push("");

    // 摘要
    lines.push("## 摘要");
    lines.push("");
    lines.push(`**整体状态**: ${this.formatStatus(report.summary.overallStatus)}`);
    lines.push(`**测试总数**: ${report.summary.totalTests}`);
    lines.push(`**通过**: ${report.summary.passedTests}`);
    lines.push(`**失败**: ${report.summary.failedTests}`);
    lines.push(`**通过率**: ${report.summary.overallPassRate.toFixed(2)}%`);
    lines.push("");

    // 阶段结果
    lines.push("## 阶段测试结果");
    lines.push("");

    const phases = [
      { name: "Phase 1: ANP基础设施", key: "phase1" as const },
      { name: "Phase 2: 协议层实现", key: "phase2" as const },
      { name: "Phase 3: 业务集成", key: "phase3" as const },
      { name: "Phase 4: 端到端测试", key: "phase4" as const },
    ];

    for (const phase of phases) {
      const results = report.phases[phase.key];
      lines.push(`### ${phase.name}`);
      lines.push("");
      lines.push(`- 总数: ${results.total}`);
      lines.push(`- 通过: ${results.passed}`);
      lines.push(`- 失败: ${results.failed}`);
      lines.push(`- 跳过: ${results.skipped}`);
      lines.push(`- 通过率: ${results.passRate.toFixed(2)}%`);
      lines.push("");
    }

    // 性能指标
    lines.push("## 性能指标");
    lines.push("");
    lines.push("| 指标 | 值 | 单位 | 阈值 | 状态 |");
    lines.push("|------|-----|------|------|------|");

    for (const metric of report.performance) {
      const status = metric.passed ? "✓" : "✗";
      lines.push(
        `| ${metric.name} | ${metric.value} | ${metric.unit} | ${metric.threshold} | ${status} |`
      );
    }
    lines.push("");

    // 安全检查
    lines.push("## 安全检查");
    lines.push("");
    lines.push("| 类别 | 描述 | 状态 |");
    lines.push("|------|------|------|");

    for (const check of report.security) {
      const status = this.formatSecurityStatus(check.status);
      lines.push(`| ${check.category} | ${check.description} | ${status} |`);
    }
    lines.push("");

    // 代码覆盖率
    lines.push("## 代码覆盖率");
    lines.push("");
    lines.push(`- 语句: ${report.coverage.statements}%`);
    lines.push(`- 分支: ${report.coverage.branches}%`);
    lines.push(`- 函数: ${report.coverage.functions}%`);
    lines.push(`- 行: ${report.coverage.lines}%`);
    lines.push("");

    // 关键问题
    if (report.summary.criticalIssues.length > 0) {
      lines.push("## 关键问题");
      lines.push("");
      for (const issue of report.summary.criticalIssues) {
        lines.push(`- ${issue}`);
      }
      lines.push("");
    }

    // 建议
    if (report.summary.recommendations.length > 0) {
      lines.push("## 建议");
      lines.push("");
      for (const rec of report.summary.recommendations) {
        lines.push(`- ${rec}`);
      }
      lines.push("");
    }

    // 详细测试结果
    lines.push("## 详细测试结果");
    lines.push("");

    for (const phase of phases) {
      const results = report.phases[phase.key];
      if (results.tests.length > 0) {
        lines.push(`### ${phase.name}`);
        lines.push("");
        lines.push("| 测试ID | 测试名称 | 状态 | 耗时(ms) |");
        lines.push("|--------|----------|------|----------|");

        for (const test of results.tests) {
          const status = this.formatTestStatus(test.status);
          lines.push(`| ${test.testId} | ${test.testName} | ${status} | ${test.duration} |`);
        }
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  /**
   * 格式化状态标识
   */
  private formatStatus(status: "pass" | "fail" | "partial"): string {
    switch (status) {
      case "pass":
        return "✅ 通过";
      case "fail":
        return "❌ 失败";
      case "partial":
        return "⚠️ 部分通过";
    }
  }

  /**
   * 格式化安全状态
   */
  private formatSecurityStatus(status: "pass" | "fail" | "warning"): string {
    switch (status) {
      case "pass":
        return "✅ 通过";
      case "fail":
        return "❌ 失败";
      case "warning":
        return "⚠️ 警告";
    }
  }

  /**
   * 格式化测试状态
   */
  private formatTestStatus(status: "pass" | "fail" | "skip"): string {
    switch (status) {
      case "pass":
        return "✅";
      case "fail":
        return "❌";
      case "skip":
        return "⏭️";
    }
  }
}

/**
 * 创建测试报告生成器实例
 */
export function createTestReportGenerator(): TestReportGenerator {
  return new TestReportGenerator();
}

/**
 * 快速生成报告的辅助函数
 */
export function generateTestReport(
  testResults: TestResult[],
  performance: PerformanceMetric[],
  security: SecurityCheck[],
  coverage: CoverageReport,
  outputPath: string
): void {
  const generator = createTestReportGenerator();

  // 添加所有测试结果
  for (const result of testResults) {
    generator.addTestResult(result);
  }

  // 添加性能指标
  for (const metric of performance) {
    generator.addPerformanceMetric(metric);
  }

  // 添加安全检查
  for (const check of security) {
    generator.addSecurityCheck(check);
  }

  // 设置覆盖率
  generator.setCoverage(coverage);

  // 生成报告
  generator.saveReportJson(`${outputPath}.json`);
  generator.saveReportMarkdown(`${outputPath}.md`);
}
