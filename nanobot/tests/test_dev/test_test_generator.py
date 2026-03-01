"""Tests for the test generator module."""

import tempfile

from nanobot.dev.code_generator import GeneratedFile, Language
from nanobot.dev.test_generator import (
    GeneratedTest,
    TestFramework,
    TestGenerationConfig,
    TestGenerationResult,
    TestGenerator,
    TestType,
)


class TestTestGenerator:
    """Test suite for TestGenerator."""

    def test_init_without_provider(self):
        """Test initialization without an LLM provider."""
        generator = TestGenerator()
        assert generator.provider is None

    def test_init_with_provider(self):
        """Test initialization with an LLM provider."""
        mock_provider = MockLLMProvider()
        generator = TestGenerator(provider=mock_provider)
        assert generator.provider is mock_provider

    def test_generate_python_tests_with_templates(self):
        """Test template-based Python test generation."""
        generator = TestGenerator()
        code_files = [
            GeneratedFile(
                path="src/main.py",
                content='def add(a, b):\n    return a + b\n\nasync def fetch_data():\n    return {"data": "value"}',
                language=Language.PYTHON,
            )
        ]

        config = TestGenerationConfig(
            framework=TestFramework.PYTEST,
            language=Language.PYTHON,
        )
        result = generator.generate(code_files, config)

        assert isinstance(result, TestGenerationResult)
        assert len(result.tests) > 0
        assert result.framework == TestFramework.PYTEST

    def test_generate_typescript_tests_with_templates(self):
        """Test template-based TypeScript test generation."""
        generator = TestGenerator()
        code_files = [
            GeneratedFile(
                path="src/main.ts",
                content="function add(a: number, b: number): number {\n    return a + b;\n}\n",
                language=Language.TYPESCRIPT,
            )
        ]

        config = TestGenerationConfig(
            framework=TestFramework.VITEST,
            language=Language.TYPESCRIPT,
        )
        result = generator.generate(code_files, config)

        assert isinstance(result, TestGenerationResult)
        assert len(result.tests) > 0

    def test_generate_without_edge_cases(self):
        """Test generation without edge case tests."""
        generator = TestGenerator()
        code_files = [
            GeneratedFile(
                path="src/main.py",
                content="def process(data):\n    return data",
                language=Language.PYTHON,
            )
        ]

        config = TestGenerationConfig(
            framework=TestFramework.PYTEST,
            language=Language.PYTHON,
            include_edge_cases=False,
        )
        result = generator.generate(code_files, config)

        # Should not have edge case tests
        edge_tests = [t for t in result.tests if t.test_type == TestType.EDGE_CASE]
        assert len(edge_tests) == 0

    def test_generate_without_integration_tests(self):
        """Test generation without integration tests."""
        generator = TestGenerator()
        code_files = [
            GeneratedFile(
                path="src/main.py",
                content="async def async_func():\n    pass",
                language=Language.PYTHON,
            )
        ]

        config = TestGenerationConfig(
            framework=TestFramework.PYTEST,
            language=Language.PYTHON,
            include_integration=False,
        )
        result = generator.generate(code_files, config)

        # Should not have integration tests
        integration_tests = [t for t in result.tests if t.test_type == TestType.INTEGRATION]
        assert len(integration_tests) == 0

    def test_extract_functions_from_python(self):
        """Test function extraction from Python code."""
        generator = TestGenerator()
        code = "def add(a, b):\n    return a + b\n\ndef multiply(x, y):\n    return x * y"

        functions = generator._extract_functions(code, Language.PYTHON)

        assert len(functions) >= 2
        assert any(f["name"] == "add" for f in functions)
        assert any(f["name"] == "multiply" for f in functions)

    def test_extract_functions_from_typescript(self):
        """Test function extraction from TypeScript code."""
        generator = TestGenerator()
        code = "function add(a: number, b: number): number { return a + b; }"

        functions = generator._extract_functions(code, Language.TYPESCRIPT)

        assert len(functions) >= 1
        assert functions[0]["name"] == "add"

    def test_to_camel_case(self):
        """Test snake_case to camelCase conversion."""
        generator = TestGenerator()

        assert generator._to_camel_case("snake_case") == "snakeCase"
        assert generator._to_camel_case("my_function_name") == "myFunctionName"
        assert generator._to_camel_case("single") == "single"

    def test_write_python_tests(self):
        """Test writing Python tests to disk."""
        generator = TestGenerator()
        result = TestGenerationResult(
            framework=TestFramework.PYTEST,
            tests=[
                GeneratedTest(
                    name="test_example",
                    content="def test_example():\n    pass",
                    test_type=TestType.UNIT,
                )
            ],
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            written = generator.write_tests(result, tmpdir)

            assert len(written) == 1
            assert "test_generated.py" in written[0]

    def test_write_typescript_tests(self):
        """Test writing TypeScript tests to disk."""
        generator = TestGenerator()
        result = TestGenerationResult(
            framework=TestFramework.VITEST,
            tests=[
                GeneratedTest(
                    name="testExample",
                    content="function testExample() {}",
                    test_type=TestType.UNIT,
                )
            ],
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            written = generator.write_tests(result, tmpdir)

            assert len(written) == 1
            assert "test.generated.ts" in written[0]

    def test_estimate_coverage(self):
        """Test coverage estimation."""
        generator = TestGenerator()
        code_files = [
            GeneratedFile(
                path="src/main.py",
                content="def func1(): pass\ndef func2(): pass\n" * 10,
                language=Language.PYTHON,
            )
        ]
        result = TestGenerationResult(
            tests=[
                GeneratedTest(
                    name="test1",
                    content="",
                    test_type=TestType.UNIT,
                )
            ] * 5,
        )

        coverage = generator.estimate_coverage(code_files, result)

        assert 0 <= coverage <= 1

    def test_generate_with_llm_provider(self):
        """Test generation with mock LLM provider."""
        mock_provider = MockLLMProvider()
        generator = TestGenerator(provider=mock_provider)
        code_files = [
            GeneratedFile(
                path="src/main.py",
                content="def example(): pass",
                language=Language.PYTHON,
            )
        ]

        config = TestGenerationConfig(language=Language.PYTHON)
        result = generator.generate(code_files, config)

        assert isinstance(result, TestGenerationResult)

    def test_llm_fallback_to_templates(self):
        """Test fallback to templates on LLM error."""
        mock_provider = MockLLMProvider(should_fail=True)
        generator = TestGenerator(provider=mock_provider)
        code_files = [
            GeneratedFile(
                path="src/main.py",
                content="def example(): pass",
                language=Language.PYTHON,
            )
        ]

        config = TestGenerationConfig(language=Language.PYTHON)
        result = generator.generate(code_files, config)

        # Should fall back to templates
        assert isinstance(result, TestGenerationResult)
        assert result.framework == TestFramework.PYTEST

    def test_test_generation_config_defaults(self):
        """Test test generation config defaults."""
        config = TestGenerationConfig()

        assert config.framework == TestFramework.PYTEST
        assert config.language == Language.PYTHON
        assert config.include_edge_cases is True
        assert config.include_integration is True
        assert config.target_coverage == 0.8

    def test_empty_code_files(self):
        """Test generation with empty code files list."""
        generator = TestGenerator()
        result = generator.generate([], TestGenerationConfig())

        assert isinstance(result, TestGenerationResult)
        assert len(result.tests) == 0

    def test_malformed_python_code(self):
        """Test generation with malformed Python code."""
        generator = TestGenerator()
        code_files = [
            GeneratedFile(
                path="src/main.py",
                content="this is not valid python code [[[",
                language=Language.PYTHON,
            )
        ]

        result = generator.generate(code_files, TestGenerationConfig())

        # Should handle gracefully
        assert isinstance(result, TestGenerationResult)


class MockLLMProvider:
    """Mock LLM provider for testing."""

    def __init__(self, should_fail: bool = False):
        self.should_fail = should_fail

    async def chat(self, messages, model=None, max_tokens=8192, temperature=0.3):
        """Mock chat method."""
        if self.should_fail:
            raise Exception("Mock LLM error")

        import json

        mock_response = {
            "tests": [
                {
                    "name": "test_example",
                    "content": "def test_example(): pass",
                    "test_type": "unit",
                    "target_function": "example",
                }
            ],
            "estimated_coverage": 0.85,
            "suggestions": [],
        }

        class MockContent:
            def __init__(self, content):
                self.content = content

        return MockContent(json.dumps(mock_response))
