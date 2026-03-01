"""Tests for the code generator module."""

import tempfile

from nanobot.dev.code_generator import (
    CodeGenerationConfig,
    CodeGenerator,
    CodeQuality,
    GeneratedFile,
    GenerationResult,
    Language,
)
from nanobot.dev.requirement_parser import (
    Ambiguity,
    Complexity,
    Deliverable,
    ParsedRequirements,
)


class TestCodeGenerator:
    """Test suite for CodeGenerator."""

    def test_init_without_provider(self):
        """Test initialization without an LLM provider."""
        generator = CodeGenerator()
        assert generator.provider is None

    def test_init_with_provider(self):
        """Test initialization with an LLM provider."""
        mock_provider = MockLLMProvider()
        generator = CodeGenerator(provider=mock_provider)
        assert generator.provider is mock_provider

    def test_generate_python_with_templates(self):
        """Test template-based Python code generation."""
        generator = CodeGenerator()
        requirements = self._create_simple_requirements()

        config = CodeGenerationConfig(language=Language.PYTHON)
        result = generator.generate(requirements, config)

        assert isinstance(result, GenerationResult)
        assert len(result.files) > 0
        assert result.success_rate > 0
        assert result.quality in CodeQuality

    def test_generate_typescript_with_templates(self):
        """Test template-based TypeScript code generation."""
        generator = CodeGenerator()
        requirements = self._create_simple_requirements()

        config = CodeGenerationConfig(language=Language.TYPESCRIPT)
        result = generator.generate(requirements, config)

        assert isinstance(result, GenerationResult)
        assert len(result.files) > 0
        assert result.success_rate > 0

    def test_generate_with_tests_disabled(self):
        """Test generation without test files."""
        generator = CodeGenerator()
        requirements = self._create_simple_requirements()

        config = CodeGenerationConfig(
            language=Language.PYTHON,
            include_tests=False,
        )
        result = generator.generate(requirements, config)

        # Should not have test files
        test_files = [f for f in result.files if "test" in f.path.lower()]
        assert len(test_files) == 0

    def test_generate_with_docs_disabled(self):
        """Test generation without documentation."""
        generator = CodeGenerator()
        requirements = self._create_simple_requirements()

        config = CodeGenerationConfig(
            language=Language.PYTHON,
            include_docs=False,
        )
        result = generator.generate(requirements, config)

        # Should not have README
        readme_files = [f for f in result.files if "readme" in f.path.lower()]
        assert len(readme_files) == 0

    def test_write_files(self):
        """Test writing generated files to disk."""
        generator = CodeGenerator()
        requirements = self._create_simple_requirements()

        config = CodeGenerationConfig(language=Language.PYTHON)
        result = generator.generate(requirements, config)

        with tempfile.TemporaryDirectory() as tmpdir:
            written = generator.write_files(result, tmpdir)

            assert len(written) > 0
            for path in written:
                assert path.startswith(tmpdir)

    def test_derive_project_name_from_deliverables(self):
        """Test project name derivation from deliverables."""
        generator = CodeGenerator()
        requirements = ParsedRequirements(
            summary="A project",
            deliverables=[Deliverable(
                name="MyAwesomeApp",
                description="An awesome app",
                type="code",
            )],
        )

        name = generator._derive_project_name(requirements)
        assert "MyAwesomeApp" in name

    def test_review_code_empty_result(self):
        """Test code review with empty result."""
        generator = CodeGenerator()
        result = GenerationResult()

        review = generator.review_code(result)

        assert review["total_files"] == 0
        assert review["score"] == 0.0

    def test_review_code_with_issues(self):
        """Test code review detects issues."""
        generator = CodeGenerator()
        result = GenerationResult(
            files=[
                GeneratedFile(
                    path="test.py",
                    content=""",
                    # Very long content
                    """ + "x" * 11000,
                    language=Language.PYTHON,
                ),
                GeneratedFile(
                    path="empty.py",
                    content="",
                    language=Language.PYTHON,
                ),
            ],
        )

        review = generator.review_code(result)

        assert review["total_files"] == 2
        assert len(review["issues"]) > 0
        assert review["score"] < 1.0

    def test_estimate_success_rate(self):
        """Test success rate estimation."""
        generator = CodeGenerator()

        # High confidence, no ambiguities
        requirements = ParsedRequirements(
            summary="Clear requirements",
            confidence=0.9,
            ambiguities=[],
        )
        rate = generator.estimate_success_rate(requirements)
        assert rate > 0.7

        # Low confidence, many ambiguities
        requirements = ParsedRequirements(
            summary="Unclear requirements",
            confidence=0.3,
            ambiguities=[
                Ambiguity(text="issue1", category="scope", suggestion="Fix this"),
                Ambiguity(text="issue2", category="technical", suggestion="Clarify"),
            ],
        )
        rate = generator.estimate_success_rate(requirements)
        assert rate < 0.7

    def test_unsupported_language_template_generation(self):
        """Test template generation with unsupported language."""
        generator = CodeGenerator()
        requirements = self._create_simple_requirements()

        config = CodeGenerationConfig(language=Language.GO)
        result = generator.generate(requirements, config)

        assert result.success_rate == 0.0
        assert len(result.errors) > 0

    def test_generate_with_llm_provider(self):
        """Test generation with mock LLM provider."""
        mock_provider = MockLLMProvider()
        generator = CodeGenerator(provider=mock_provider)
        requirements = self._create_simple_requirements()

        config = CodeGenerationConfig(language=Language.PYTHON)
        result = generator.generate(requirements, config)

        assert isinstance(result, GenerationResult)

    def test_llm_fallback_to_templates(self):
        """Test fallback to templates on LLM error."""
        mock_provider = MockLLMProvider(should_fail=True)
        generator = CodeGenerator(provider=mock_provider)
        requirements = self._create_simple_requirements()

        config = CodeGenerationConfig(language=Language.PYTHON)
        result = generator.generate(requirements, config)

        # Should fall back to templates
        assert isinstance(result, GenerationResult)
        assert len(result.files) > 0

    def test_code_generation_config_defaults(self):
        """Test code generation config defaults."""
        config = CodeGenerationConfig()

        assert config.language == Language.PYTHON
        assert config.output_dir == "./generated"
        assert config.include_tests is True
        assert config.include_docs is True

    def _create_simple_requirements(self) -> ParsedRequirements:
        """Create simple requirements for testing."""
        return ParsedRequirements(
            summary="A simple todo application",
            technologies=["Python", "FastAPI"],
            deliverables=[Deliverable(
                name="Todo App",
                description="A todo application",
                type="code",
                estimated_hours=10.0,
            )],
            constraints=[],
            ambiguities=[],
            complexity=Complexity.LOW,
            estimated_hours=20,
            confidence=0.8,
        )


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
            "files": [
                {
                    "path": "src/main.py",
                    "content": '"""Main module."""\nprint("Hello")',
                    "language": "python",
                }
            ],
            "quality": "good",
            "warnings": [],
        }

        class MockContent:
            def __init__(self, content):
                self.content = content

        return MockContent(json.dumps(mock_response))
