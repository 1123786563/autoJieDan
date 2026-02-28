"""Test generator for creating test cases from code and requirements.

This module provides tools to generate unit tests, integration tests,
and edge case tests based on code and requirements.
"""

import ast
import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from nanobot.dev.code_generator import GeneratedFile, Language


class TestType(str, Enum):
    """Types of tests to generate."""
    UNIT = "unit"
    INTEGRATION = "integration"
    EDGE_CASE = "edge_case"
    PROPERTY = "property"


class TestFramework(str, Enum):
    """Supported test frameworks."""
    PYTEST = "pytest"
    VITEST = "vitest"
    JEST = "jest"
    GO_TEST = "go_test"


@dataclass
class GeneratedTest:
    """A generated test case."""
    name: str
    content: str
    test_type: TestType
    target_function: str | None = None


@dataclass
class TestGenerationResult:
    """Result of test generation."""
    tests: list[GeneratedTest] = field(default_factory=list)
    framework: TestFramework = TestFramework.PYTEST
    estimated_coverage: float = 0.0
    suggestions: list[str] = field(default_factory=list)


class TestGenerationConfig(BaseModel):
    """Configuration for test generation."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    framework: TestFramework = Field(default=TestFramework.PYTEST, description="Test framework to use")
    language: Language = Field(default=Language.PYTHON, description="Programming language")
    include_edge_cases: bool = Field(default=True, description="Include edge case tests")
    include_integration: bool = Field(default=True, description="Include integration tests")
    target_coverage: float = Field(default=0.8, description="Target coverage (0-1)")
    max_tests_per_function: int = Field(default=5, description="Maximum tests per function")


class TestGenerator:
    """
    Test generator for creating test cases from code.

    Generates:
    - Unit tests for individual functions
    - Integration tests for component interactions
    - Edge case tests for boundary conditions
    """

    # Test templates
    PYTHON_TEMPLATES = {
        TestType.UNIT: '''async def test_{function_name}_basic():
    """Test basic functionality of {function_name}."""
    # Arrange
    {setup_code}

    # Act
    result = {function_name}({args})

    # Assert
    assert result is not None
    # Add more specific assertions based on your code


def test_{function_name}_with_valid_input():
    """Test {function_name} with valid input."""
    {setup_code}
    result = {function_name}({args})
    assert result is not None


def test_{function_name}_with_invalid_input():
    """Test {function_name} with invalid input."""
    {setup_code}
    with pytest.raises((ValueError, TypeError)):
        {function_name}({invalid_args})
''',
        TestType.INTEGRATION: '''@pytest.mark.asyncio
async def test_{function_name}_integration():
    """Test {function_name} in integration context."""
    # Setup integration dependencies
    async with get_test_client() as client:
        {setup_code}
        result = await {function_name}({args})
        assert result is not None
''',
        TestType.EDGE_CASE: '''def test_{function_name}_empty_input():
    """Test {function_name} with empty input."""
    result = {function_name}({empty_args})
    # Assert expected behavior for empty input


def test_{function_name}_null_input():
    """Test {function_name} with null/None input."""
    result = {function_name}({null_args})
    # Assert expected behavior for null input


def test_{function_name}_large_input():
    """Test {function_name} with large input."""
    large_input = generate_large_test_data()
    result = {function_name}({large_args})
    assert result is not None
''',
        TestType.PROPERTY: '''@pytest.mark.parametrize("input_data", [
    # Test cases based on properties
    ({{"key": "value"}}),
    ({{"key": 123}}),
    ({{"key": None}}),
])
def test_{function_name}_property(input_data):
    """Test {function_name} properties."""
    result = {function_name}(input_data)
    # Property-based assertions
    assert isinstance(result, expected_type)
''',
    }

    # TypeScript templates use $ as placeholder to avoid conflicts with {}
    TYPESCRIPT_TEMPLATES = {
        TestType.UNIT: """async function test$functionName$Basic() {
    // Arrange
    $setupCode

    // Act
    const result = await $functionName($args);

    // Assert
    expect(result).toBeDefined();
    // Add more specific assertions based on your code
}

function test$functionName$WithValidInput() {
    const result = $functionName($args);
    expect(result).toBeDefined();
}

function test$functionName$WithInvalidInput() {
    expect(() => $functionName($invalidArgs)).toThrow();
}""",
        TestType.INTEGRATION: """async function test$functionName$Integration() {
    // Setup integration dependencies
    const client = await getTestClient();
    $setupCode
    const result = await $functionName($args);
    expect(result).toBeDefined();
    await client.close();
}""",
        TestType.EDGE_CASE: """function test$functionName$EmptyInput() {
    const result = $functionName($emptyArgs);
    // Assert expected behavior for empty input
}

function test$functionName$NullInput() {
    const result = $functionName($nullArgs);
    // Assert expected behavior for null input
}

function test$functionName$LargeInput() {
    const largeInput = generateLargeTestData();
    const result = $functionName($largeArgs);
    expect(result).toBeDefined();
}""",
        TestType.PROPERTY: """describe.each([
    {{"key": "value"}},
    {{"key": 123}},
    {{"key": null}},
])("$functionName property tests", (inputData) => {
    function test$functionName$Property() {
        const result = $functionName(inputData);
        // Property-based assertions
        expect(result).toBeDefined();
    }
});""",
    }

    def __init__(self, provider: Any = None):
        """
        Initialize the test generator.

        Args:
            provider: LLM provider for intelligent test generation.
        """
        self.provider = provider

    def generate(
        self,
        code_files: list[GeneratedFile],
        config: TestGenerationConfig | None = None,
    ) -> TestGenerationResult:
        """
        Generate tests from code files.

        Args:
            code_files: List of generated code files.
            config: Generation configuration.

        Returns:
            TestGenerationResult with generated tests.
        """
        if config is None:
            config = TestGenerationConfig()

        result = TestGenerationResult(framework=config.framework)

        try:
            if self.provider:
                return self._generate_with_llm(code_files, config)
            return self._generate_with_templates(code_files, config)
        except Exception as e:
            result.suggestions.append(f"Generation failed: {e}")
            return result

    def _generate_with_llm(
        self,
        code_files: list[GeneratedFile],
        config: TestGenerationConfig,
    ) -> TestGenerationResult:
        """Generate tests using LLM."""
        prompt = self._build_generation_prompt(code_files, config)

        try:
            response = self._call_llm(prompt)
            return self._parse_llm_response(response, config)
        except Exception:
            return self._generate_with_templates(code_files, config)

    def _build_generation_prompt(
        self,
        code_files: list[GeneratedFile],
        config: TestGenerationConfig,
    ) -> str:
        """Build the prompt for LLM test generation."""
        code_summary = "\n\n".join(
            f"File: {f.path}\n```\n{f.content[:2000]}...\n```"
            for f in code_files[:5]  # Limit context
        )

        return f"""You are a test generator. Generate comprehensive tests for the following code.

Code to test:
{code_summary}

Generate tests in {config.language.value} using {config.framework.value} with:
- Unit tests for each function
- Integration tests for component interactions
- Edge case tests for boundary conditions
- Target coverage: {config.target_coverage * 100}%

Return a JSON with this structure:
{{
    "tests": [
        {{
            "name": "test_function_name",
            "content": "full test code",
            "test_type": "unit|integration|edge_case|property",
            "target_function": "function_name"
        }}
    ],
    "estimated_coverage": 0.85,
    "suggestions": ["any testing suggestions"]
}}

Guidelines:
- Follow {config.framework.value} best practices
- Include setup/teardown where needed
- Test both success and failure cases
- Use descriptive test names
- Include assertions for expected behavior

Return ONLY valid JSON, no other text."""

    def _call_llm(self, prompt: str) -> str:
        """Call the LLM provider."""
        import asyncio

        async def _call():
            messages = [{"role": "user", "content": prompt}]
            response = await self.provider.chat(
                messages=messages,
                model=None,
                max_tokens=8192,
                temperature=0.3,
            )
            return response.content or ""

        return asyncio.run(_call())

    def _parse_llm_response(
        self,
        response: str,
        config: TestGenerationConfig,
    ) -> TestGenerationResult:
        """Parse LLM response into TestGenerationResult."""
        import json

        result = TestGenerationResult(framework=config.framework)

        try:
            json_match = re.search(r'\{[\s\S]*\}', response)
            if not json_match:
                raise ValueError("No JSON found")

            data = json.loads(json_match.group(0))

            for test_data in data.get("tests", []):
                result.tests.append(GeneratedTest(
                    name=test_data["name"],
                    content=test_data["content"],
                    test_type=TestType(test_data.get("test_type", "unit")),
                    target_function=test_data.get("target_function"),
                ))

            result.estimated_coverage = data.get("estimated_coverage", 0.8)
            result.suggestions = data.get("suggestions", [])

        except Exception as e:
            result.suggestions.append(f"Failed to parse LLM response: {e}")

        return result

    def _generate_with_templates(
        self,
        code_files: list[GeneratedFile],
        config: TestGenerationConfig,
    ) -> TestGenerationResult:
        """Generate tests using template-based generation."""
        result = TestGenerationResult(framework=config.framework)

        for code_file in code_files:
            if code_file.language != config.language:
                continue

            # Extract functions from code
            functions = self._extract_functions(code_file.content, config.language)

            for func in functions:
                # Generate unit tests
                if config.framework == TestFramework.PYTEST:
                    tests = self._generate_python_tests(func, config)
                else:
                    tests = self._generate_typescript_tests(func, config)

                result.tests.extend(tests)

        # Estimate coverage
        if result.tests:
            result.estimated_coverage = min(0.95, len(result.tests) * 0.15)

        return result

    def _extract_functions(self, code: str, language: Language) -> list[dict[str, Any]]:
        """Extract function signatures from code."""
        functions = []

        if language == Language.PYTHON:
            try:
                tree = ast.parse(code)
                for node in ast.walk(tree):
                    if isinstance(node, ast.FunctionDef):
                        functions.append({
                            "name": node.name,
                            "args": [arg.arg for arg in node.args.args],
                            "is_async": isinstance(node, ast.AsyncFunctionDef),
                        })
            except Exception:
                # Fallback to regex
                pattern = r'(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)'
                for match in re.finditer(pattern, code):
                    functions.append({
                        "name": match.group(1),
                        "args": [a.strip() for a in match.group(2).split(",") if a.strip()],
                        "is_async": match.group(0).strip().startswith("async"),
                    })

        elif language == Language.TYPESCRIPT:
            # Regex-based extraction for TypeScript
            pattern = r'(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)'
            for match in re.finditer(pattern, code):
                functions.append({
                    "name": match.group(1),
                    "args": [a.strip() for a in match.group(2).split(",") if a.strip()],
                    "is_async": match.group(0).strip().startswith("async"),
                })

        return functions

    def _generate_python_tests(
        self,
        func: dict[str, Any],
        config: TestGenerationConfig,
    ) -> list[GeneratedTest]:
        """Generate Python tests for a function."""
        tests = []
        func_name = func["name"]
        args = ", ".join(func["args"]) if func["args"] else ""

        # Generate setup code
        setup_code = "# Setup test data"
        if func["args"]:
            setup_code += f"\n    {args} = get_test_data()"

        # Unit test
        unit_template = self.PYTHON_TEMPLATES[TestType.UNIT]
        unit_content = unit_template.format(
            function_name=func_name,
            setup_code=setup_code,
            args=args or "test_data",
            invalid_args="None" if not args else "invalid_data",
        )
        tests.append(GeneratedTest(
            name=f"test_{func_name}_unit",
            content=unit_content,
            test_type=TestType.UNIT,
            target_function=func_name,
        ))

        # Edge case tests
        if config.include_edge_cases:
            edge_template = self.PYTHON_TEMPLATES[TestType.EDGE_CASE]
            edge_content = edge_template.format(
                function_name=func_name,
                empty_args="" if not args else f'{args.split(",")[0]}=""',
                null_args="None" if not args else f'{args.split(",")[0]}=None',
                large_args="large_input" if not args else f'{args.split(",")[0]}=large_input',
            )
            tests.append(GeneratedTest(
                name=f"test_{func_name}_edge_cases",
                content=edge_content,
                test_type=TestType.EDGE_CASE,
                target_function=func_name,
            ))

        # Integration tests
        if config.include_integration and func["is_async"]:
            integration_template = self.PYTHON_TEMPLATES[TestType.INTEGRATION]
            integration_content = integration_template.format(
                function_name=func_name,
                setup_code=setup_code,
                args=args or "test_data",
            )
            tests.append(GeneratedTest(
                name=f"test_{func_name}_integration",
                content=integration_content,
                test_type=TestType.INTEGRATION,
                target_function=func_name,
            ))

        return tests

    def _generate_typescript_tests(
        self,
        func: dict[str, Any],
        config: TestGenerationConfig,
    ) -> list[GeneratedTest]:
        """Generate TypeScript tests for a function."""
        tests = []
        func_name_camel = self._to_camel_case(func["name"])
        args = ", ".join(func["args"]) if func["args"] else ""

        setup_code = "// Setup test data"
        if func["args"]:
            setup_code += f"\n    const {args} = getTestData();"

        # Unit test - use replace instead of format to avoid {} conflicts
        unit_template = self.TYPESCRIPT_TEMPLATES[TestType.UNIT]
        unit_content = unit_template.replace("$functionName", func_name_camel)
        unit_content = unit_content.replace("$setupCode", setup_code)
        unit_content = unit_content.replace("$args", args or "testData")
        unit_content = unit_content.replace("$invalidArgs", "undefined" if not args else "invalidData")
        tests.append(GeneratedTest(
            name=f"test{func_name_camel}Unit",
            content=unit_content,
            test_type=TestType.UNIT,
            target_function=func["name"],
        ))

        # Edge case tests
        if config.include_edge_cases:
            edge_template = self.TYPESCRIPT_TEMPLATES[TestType.EDGE_CASE]
            edge_content = edge_template.replace("$functionName", func_name_camel)
            empty_args = "" if not args else f"{args.split(',')[0]}: ''"
            null_args = "null" if not args else f"{args.split(',')[0]}: null"
            large_args = "largeInput" if not args else f"{args.split(',')[0]}: largeInput"
            edge_content = edge_content.replace("$emptyArgs", empty_args)
            edge_content = edge_content.replace("$nullArgs", null_args)
            edge_content = edge_content.replace("$largeArgs", large_args)
            tests.append(GeneratedTest(
                name=f"test{func_name_camel}EdgeCases",
                content=edge_content,
                test_type=TestType.EDGE_CASE,
                target_function=func["name"],
            ))

        return tests

    def _to_camel_case(self, snake_str: str) -> str:
        """Convert snake_case to camelCase."""
        components = snake_str.split("_")
        return components[0] + "".join(x.title() for x in components[1:])

    def write_tests(
        self,
        result: TestGenerationResult,
        output_dir: str,
    ) -> list[str]:
        """
        Write generated tests to disk.

        Args:
            result: Test generation result.
            output_dir: Output directory.

        Returns:
            List of written file paths.
        """
        written = []

        # Group tests by target function or create one test file
        if result.framework == TestFramework.PYTEST:
            test_file = Path(output_dir) / "test_generated.py"
            content = self._format_python_test_file(result)
        else:
            test_file = Path(output_dir) / "test.generated.ts"
            content = self._format_typescript_test_file(result)

        test_file.parent.mkdir(parents=True, exist_ok=True)

        try:
            test_file.write_text(content, encoding="utf-8")
            written.append(str(test_file))
        except Exception as e:
            result.suggestions.append(f"Failed to write test file: {e}")

        return written

    def _format_python_test_file(self, result: TestGenerationResult) -> str:
        """Format tests into a Python test file."""
        lines = [
            '"""Generated tests."""\n',
            "import pytest",
            "from typing import Any",
            "",
        ]

        # Add helper functions
        lines.extend([
            "def get_test_data() -> Any:",
            '    """Generate test data."""',
            "    return {}",
            "",
            "",
        ])

        # Add tests
        for test in result.tests:
            lines.append(f'# {test.test_type.value}')
            lines.append(test.content)
            lines.append("")

        return "\n".join(lines)

    def _format_typescript_test_file(self, result: TestGenerationResult) -> str:
        """Format tests into a TypeScript test file."""
        lines = [
            "// Generated tests",
            "import { describe, it, expect } from 'vitest';",
            "",
        ]

        # Add helper functions
        lines.extend([
            "function getTestData(): any {",
            '    // Generate test data',
            "    return {};",
            "}",
            "",
            "",
        ])

        # Add tests
        for test in result.tests:
            lines.append(f"// {test.test_type.value}")
            lines.append(test.content)
            lines.append("")
            lines.append("")

        return "\n".join(lines)

    def estimate_coverage(
        self,
        code_files: list[GeneratedFile],
        result: TestGenerationResult,
    ) -> float:
        """
        Estimate test coverage.

        Args:
            code_files: Original code files.
            result: Test generation result.

        Returns:
            Estimated coverage (0-1).
        """
        if not code_files:
            return 0.0

        total_lines = sum(len(f.content.split('\n')) for f in code_files)
        test_count = len(result.tests)

        # Rough estimate: each test covers ~10 lines of code
        covered_lines = test_count * 10
        return min(1.0, covered_lines / total_lines) if total_lines > 0 else 0.0
