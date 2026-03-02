"""
测试执行技能
运行单元测试、集成测试和 E2E 测试，收集覆盖率

@module nanobot.skills.freelance.testing
@version 1.0.0
"""

import asyncio
import json
import logging
import os
import re
import subprocess
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import List, Optional, Dict, Any


logger = logging.getLogger(__name__)


# ============================================================================
# 数据模型
# ============================================================================

class TestType(str, Enum):
    """测试类型"""
    UNIT = "unit"
    INTEGRATION = "integration"
    E2E = "e2e"


class TestStatus(str, Enum):
    """测试状态"""
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"
    ERROR = "error"


@dataclass
class TestCase:
    """测试用例"""
    name: str
    status: TestStatus
    duration_ms: int
    error_message: str = ""
    error_type: str = ""


@dataclass
class TestResult:
    """测试结果"""
    test_type: TestType
    passed: int
    failed: int
    skipped: int
    error_count: int = 0
    duration_ms: int = 0
    coverage: float = 0.0
    test_cases: List[TestCase] = field(default_factory=list)
    error_messages: List[str] = field(default_factory=list)
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "testType": self.test_type.value,
            "passed": self.passed,
            "failed": self.failed,
            "skipped": self.skipped,
            "errorCount": self.error_count,
            "durationMs": self.duration_ms,
            "coverage": self.coverage,
            "testCases": [
                {
                    "name": tc.name,
                    "status": tc.status.value,
                    "durationMs": tc.duration_ms,
                    "errorMessage": tc.error_message,
                    "errorType": tc.error_type,
                }
                for tc in self.test_cases
            ],
            "errors": self.error_messages,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class TestConfig:
    """测试配置"""
    project_root: Path
    python_path: str = "python"
    pytest_args: List[str] = field(default_factory=lambda: ["-v", "--tb=short"])
    timeout_seconds: int = 300
    enable_coverage: bool = True
    coverage_target: float = 0.8


# ============================================================================
# 测试运行器
# ============================================================================

class TestRunner:
    """
    测试运行器

    执行各种类型的测试并收集结果
    """

    def __init__(self, config: TestConfig):
        """
        初始化测试运行器

        Args:
            config: 测试配置
        """
        self.config = config

    async def run_unit_tests(self, path: str) -> TestResult:
        """
        运行单元测试

        Args:
            path: 测试路径或文件

        Returns:
            TestResult: 测试结果
        """
        logger.info(f"Running unit tests for: {path}")

        # 构建 pytest 命令
        cmd = [self.config.python_path, "-m", "pytest"]

        # 添加路径过滤器（只运行单元测试）
        test_path = Path(path)
        if test_path.is_file():
            cmd.append(str(test_path))
        elif test_path.is_dir():
            # 在目录中查找单元测试
            unit_pattern = str(test_path / "test_*.py")
            cmd.extend(["-k", "test_", str(test_path)])

        # 添加覆盖率
        if self.config.enable_coverage:
            cmd.extend(["--cov=.", "--cov-report=json", "--cov-report=term-missing"])

        # 添加其他参数
        cmd.extend(self.config.pytest_args)

        return await self._run_tests(cmd, TestType.UNIT)

    async def run_integration_tests(self, path: str) -> TestResult:
        """
        运行集成测试

        Args:
            path: 测试路径

        Returns:
            TestResult: 测试结果
        """
        logger.info(f"Running integration tests for: {path}")

        cmd = [
            self.config.python_path, "-m", "pytest",
            path,
            "-v",
            "-m", "integration",  # 假设集成测试标记为 integration
        ]

        if self.config.enable_coverage:
            cmd.extend(["--cov=.", "--cov-report=json"])

        return await self._run_tests(cmd, TestType.INTEGRATION)

    async def run_e2e_tests(self, path: str) -> TestResult:
        """
        运行 E2E 测试

        Args:
            path: 测试路径

        Returns:
            TestResult: 测试结果
        """
        logger.info(f"Running E2E tests for: {path}")

        cmd = [
            self.config.python_path, "-m", "pytest",
            path,
            "-v",
            "-m", "e2e",  # 假设 E2E 测试标记为 e2e
        ]

        return await self._run_tests(cmd, TestType.E2E)

    async def get_coverage(self, path: str) -> float:
        """
        获取测试覆盖率

        Args:
            path: 测试路径

        Returns:
            覆盖率 (0-1)
        """
        logger.info(f"Getting coverage for: {path}")

        # 运行带覆盖率报告的测试
        cmd = [
            self.config.python_path, "-m", "pytest",
            path,
            "--cov=.",
            "--cov-report=json",
            "--cov-report=term",
            "-q"
        ]

        try:
            result = await self._run_command(cmd)
            return self._parse_coverage(result.stdout)
        except Exception as e:
            logger.error(f"Failed to get coverage: {e}")
            return 0.0

    async def _run_tests(self, cmd: List[str], test_type: TestType) -> TestResult:
        """
        运行测试命令

        Args:
            cmd: 命令列表
            test_type: 测试类型

        Returns:
            TestResult: 测试结果
        """
        try:
            result = await self._run_command(cmd, timeout=self.config.timeout_seconds)

            # 解析输出
            return self._parse_test_output(result.stdout, result.stderr, test_type)

        except asyncio.TimeoutError:
            logger.error(f"Test execution timed out after {self.config.timeout_seconds}s")
            return TestResult(
                test_type=test_type,
                passed=0,
                failed=0,
                skipped=0,
                error_count=1,
                error_messages=[f"Test execution timed out after {self.config.timeout_seconds}s"]
            )
        except Exception as e:
            logger.error(f"Test execution failed: {e}")
            return TestResult(
                test_type=test_type,
                passed=0,
                failed=0,
                skipped=0,
                error_count=1,
                error_messages=[str(e)]
            )

    async def _run_command(
        self,
        cmd: List[str],
        timeout: int = 300,
        cwd: Optional[Path] = None
    ) -> subprocess.CompletedProcess:
        """
        运行命令

        Args:
            cmd: 命令列表
            timeout: 超时时间（秒）
            cwd: 工作目录

        Returns:
            命令执行结果
        """
        working_dir = cwd or self.config.project_root

        logger.debug(f"Running command: {' '.join(cmd)}")

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=working_dir
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout
            )

            return subprocess.CompletedProcess(
                args=cmd,
                returncode=process.returncode,
                stdout=stdout.decode('utf-8', errors='replace'),
                stderr=stderr.decode('utf-8', errors='replace')
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise

    def _parse_test_output(
        self,
        stdout: str,
        stderr: str,
        test_type: TestType
    ) -> TestResult:
        """
        解析 pytest 输出

        Args:
            stdout: 标准输出
            stderr: 标准错误
            test_type: 测试类型

        Returns:
            TestResult: 解析后的结果
        """
        result = TestResult(
            test_type=test_type,
            passed=0,
            failed=0,
            skipped=0
        )

        # 解析摘要行
        # 格式: "X passed, Y failed, Z skipped in W.WWs"
        summary_pattern = r'(\d+) passed(?:, (\d+) failed)?(?:, (\d+) skipped)?(?:, (\d+) error(?:s)?)? in ([\d.]+)s'
        summary_match = re.search(summary_pattern, stdout)

        if summary_match:
            result.passed = int(summary_match.group(1))
            if summary_match.group(2):
                result.failed = int(summary_match.group(2))
            if summary_match.group(3):
                result.skipped = int(summary_match.group(3))
            if summary_match.group(4):
                result.error_count = int(summary_match.group(4))

            duration_str = summary_match.group(5)
            result.duration_ms = int(float(duration_str) * 1000)

        # 解析覆盖率
        if self.config.enable_coverage:
            result.coverage = self._parse_coverage(stdout)

        # 解析失败的测试
        result.test_cases = self._parse_test_cases(stdout)

        # 收集错误信息
        if stderr:
            result.error_messages = [line.strip() for line in stderr.split('\n') if line.strip()]

        return result

    def _parse_coverage(self, output: str) -> float:
        """
        从输出中解析覆盖率

        Args:
            output: 命令输出

        Returns:
            覆盖率 (0-1)
        """
        # 尝试从终端输出解析
        # 格式: "TOTAL 100 50 50%"
        coverage_pattern = r'TOTAL\s+\d+\s+\d+\s+(\d+)%'
        match = re.search(coverage_pattern, output)
        if match:
            return int(match.group(1)) / 100.0

        # 尝试读取覆盖率 JSON 文件
        coverage_file = self.config.project_root / "coverage.json"
        if coverage_file.exists():
            try:
                with open(coverage_file) as f:
                    coverage_data = json.load(f)
                    total_coverage = coverage_data.get("totals", {}).get("percent_covered", 0)
                    return total_coverage / 100.0
            except Exception:
                pass

        return 0.0

    def _parse_test_cases(self, output: str) -> List[TestCase]:
        """
        解析测试用例结果

        Args:
            output: 命令输出

        Returns:
            测试用例列表
        """
        test_cases = []

        # 解析失败测试
        failed_pattern = r'FAILED\s+(.+?::\w+)\s+-\s+(.+)'
        for match in re.finditer(failed_pattern, output):
            test_cases.append(TestCase(
                name=match.group(1),
                status=TestStatus.FAILED,
                duration_ms=0,
                error_message=match.group(2)
            ))

        return test_cases


# ============================================================================
# 工厂函数
# ============================================================================

def create_test_runner(project_root: Path, **kwargs) -> TestRunner:
    """
    创建测试运行器

    Args:
        project_root: 项目根目录
        **kwargs: 额外配置参数

    Returns:
        TestRunner 实例
    """
    config = TestConfig(project_root=Path(project_root), **kwargs)
    return TestRunner(config)


def create_test_runner_from_env() -> TestRunner:
    """
    从环境变量创建测试运行器

    Returns:
        TestRunner 实例
    """
    project_root = Path(os.environ.get("PROJECT_ROOT", os.getcwd()))
    python_path = os.environ.get("PYTHON_PATH", "python")

    return create_test_runner(
        project_root=project_root,
        python_path=python_path
    )
