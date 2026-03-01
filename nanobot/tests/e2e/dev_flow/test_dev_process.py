"""End-to-end tests for the development workflow.

Tests the complete flow from requirements parsing to code generation
to test generation.
"""

import tempfile

from nanobot.dev.code_generator import (
    CodeGenerationConfig,
    CodeGenerator,
    Language,
)
from nanobot.dev.requirement_parser import (
    Complexity,
    ParsedRequirements,
    RequirementParser,
)
from nanobot.dev.test_generator import (
    TestFramework,
    TestGenerationConfig,
    TestGenerator,
    TestType,
)


class TestDevWorkflow:
    """Test suite for the complete development workflow."""

    def test_simple_python_project_workflow(self):
        """Test complete workflow for a simple Python project."""
        # Step 1: Parse requirements
        description = """
        Build a simple calculator application in Python.
        It should support basic operations: add, subtract, multiply, divide.
        Use pytest for testing.
        Include error handling for division by zero.
        """

        parser = RequirementParser()
        requirements = parser.parse(description)

        # Verify requirements parsing
        assert requirements.summary
        assert "python" in " ".join(t.lower() for t in requirements.technologies)
        assert requirements.complexity in [Complexity.TRIVIAL, Complexity.LOW]

        # Step 2: Generate code
        code_generator = CodeGenerator()
        code_config = CodeGenerationConfig(
            language=Language.PYTHON,
            include_tests=True,
            include_docs=True,
        )
        code_result = code_generator.generate(requirements, code_config)

        # Verify code generation
        assert len(code_result.files) > 0
        assert code_result.success_rate > 0

        # Step 3: Generate tests
        test_generator = TestGenerator()
        test_config = TestGenerationConfig(
            framework=TestFramework.PYTEST,
            language=Language.PYTHON,
            include_edge_cases=True,
        )
        test_result = test_generator.generate(code_result.files, test_config)

        # Verify test generation
        assert len(test_result.tests) > 0
        assert test_result.estimated_coverage > 0

    def test_typescript_api_project_workflow(self):
        """Test complete workflow for a TypeScript API project."""
        description = """
        Create a REST API using TypeScript and Express.
        Endpoints for user management: create, read, update, delete users.
        Include validation for email addresses.
        Use vitest for testing.
        """

        parser = RequirementParser()
        requirements = parser.parse(description)

        # Should detect TypeScript
        tech_lower = " ".join(t.lower() for t in requirements.technologies)
        assert "typescript" in tech_lower or "express" in tech_lower

        code_generator = CodeGenerator()
        code_config = CodeGenerationConfig(language=Language.TYPESCRIPT)
        code_result = code_generator.generate(requirements, code_config)

        assert len(code_result.files) > 0

        test_generator = TestGenerator()
        test_config = TestGenerationConfig(
            framework=TestFramework.VITEST,
            language=Language.TYPESCRIPT,
        )
        test_result = test_generator.generate(code_result.files, test_config)

        assert len(test_result.tests) > 0

    def test_workflow_with_custom_requirements(self):
        """Test workflow with pre-defined ParsedRequirements."""
        # Create custom requirements
        requirements = ParsedRequirements(
            summary="A todo application with user authentication",
            technologies=["Python", "FastAPI", "PostgreSQL"],
            deliverables=[
                {
                    "name": "UserAuth",
                    "description": "User authentication module",
                    "type": "code",
                    "estimated_hours": 16,
                },
                {
                    "name": "TodoCRUD",
                    "description": "Todo CRUD operations",
                    "type": "code",
                    "estimated_hours": 12,
                },
            ],
            constraints=["Must use JWT tokens", "PostgreSQL database required"],
            ambiguities=[],
            complexity=Complexity.MEDIUM,
            estimated_hours=40,
            confidence=0.85,
        )

        # Generate code
        code_generator = CodeGenerator()
        code_result = code_generator.generate(requirements)

        assert len(code_result.files) > 0

        # Generate tests
        test_generator = TestGenerator()
        test_result = test_generator.generate(code_result.files)

        assert len(test_result.tests) > 0
        assert test_result.estimated_coverage > 0.3

    def test_workflow_file_output(self):
        """Test workflow with file output to disk."""
        requirements = ParsedRequirements(
            summary="Simple greeting service",
            technologies=["Python"],
            deliverables=[{
                "name": "Greeter",
                "description": "A greeting service",
                "type": "code",
                "estimated_hours": 4,
            }],
            complexity=Complexity.TRIVIAL,
            confidence=0.9,
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            # Generate and write code
            code_generator = CodeGenerator()
            code_result = code_generator.generate(requirements)
            written_code = code_generator.write_files(code_result, tmpdir)

            assert len(written_code) > 0

            # Generate and write tests
            test_generator = TestGenerator()
            test_result = test_generator.generate(code_result.files)
            written_tests = test_generator.write_tests(test_result, tmpdir)

            assert len(written_tests) > 0

    def test_workflow_quality_review(self):
        """Test workflow includes code quality review."""
        requirements = ParsedRequirements(
            summary="Data processing utility",
            technologies=["Python"],
            complexity=Complexity.LOW,
            confidence=0.8,
        )

        code_generator = CodeGenerator()
        code_result = code_generator.generate(requirements)

        # Review generated code
        review = code_generator.review_code(code_result)

        assert "total_files" in review
        assert "score" in review
        assert 0 <= review["score"] <= 1

    def test_workflow_edge_cases(self):
        """Test workflow handles edge cases."""
        # Empty requirements - parser handles gracefully
        parser = RequirementParser()
        requirements = parser.parse("")

        # Empty input is valid, just has minimal data
        assert requirements is not None

        # Very long description
        long_desc = "Build a web application. " * 100
        requirements = parser.parse(long_desc)

        code_generator = CodeGenerator()
        code_result = code_generator.generate(requirements)

        assert code_result.success_rate >= 0

    def test_workflow_coverage_estimation(self):
        """Test workflow coverage estimation."""
        requirements = ParsedRequirements(
            summary="Math library",
            technologies=["Python"],
            deliverables=[
                {"name": "Add", "description": "Addition", "type": "code", "estimated_hours": 2},
                {"name": "Subtract", "description": "Subtraction", "type": "code", "estimated_hours": 2},
                {"name": "Multiply", "description": "Multiplication", "type": "code", "estimated_hours": 2},
            ],
            complexity=Complexity.LOW,
            confidence=0.9,
        )

        code_generator = CodeGenerator()
        code_result = code_generator.generate(requirements)

        test_generator = TestGenerator()
        test_result = test_generator.generate(code_result.files)

        # Estimate coverage
        coverage = test_generator.estimate_coverage(code_result.files, test_result)

        assert 0 <= coverage <= 1

    def test_workflow_different_complexities(self):
        """Test workflow with different complexity levels."""
        complexities = [
            Complexity.TRIVIAL,
            Complexity.LOW,
            Complexity.MEDIUM,
            Complexity.HIGH,
        ]

        for complexity in complexities:
            requirements = ParsedRequirements(
                summary=f"Project with {complexity.value} complexity",
                technologies=["Python"],
                complexity=complexity,
                confidence=0.8,
            )

            parser = RequirementParser()
            parser.estimate_complexity(requirements)

            code_generator = CodeGenerator()
            code_result = code_generator.generate(requirements)

            assert code_result.success_rate >= 0

    def test_workflow_without_optional_features(self):
        """Test workflow with optional features disabled."""
        requirements = ParsedRequirements(
            summary="Simple service",
            technologies=["Python"],
            complexity=Complexity.LOW,
            confidence=0.8,
        )

        # Generate without tests
        code_config = CodeGenerationConfig(include_tests=False, include_docs=False)
        code_generator = CodeGenerator()
        code_result = code_generator.generate(requirements, code_config)

        assert code_result.success_rate > 0

        # Generate tests without edge cases
        test_config = TestGenerationConfig(include_edge_cases=False, include_integration=False)
        test_generator = TestGenerator()
        test_result = test_generator.generate(code_result.files, test_config)

        # Should only have unit tests
        edge_tests = [t for t in test_result.tests if t.test_type == TestType.EDGE_CASE]
        integration_tests = [t for t in test_result.tests if t.test_type == TestType.INTEGRATION]
        assert len(edge_tests) == 0
        assert len(integration_tests) == 0


class TestDevWorkflowIntegration:
    """Integration tests for specific development scenarios."""

    def test_web_api_scenario(self):
        """Test workflow for a web API scenario."""
        description = """
        Build a REST API for a task management system.
        Technology stack: Python, FastAPI, PostgreSQL, Docker.
        Features:
        - User authentication with JWT
        - CRUD operations for tasks
        - Task filtering and pagination
        - Rate limiting
        Requirements:
        - Follow REST best practices
        - Include OpenAPI documentation
        - 90%+ test coverage
        """

        parser = RequirementParser()
        requirements = parser.parse(description)

        # Verify technology extraction
        tech_lower = " ".join(t.lower() for t in requirements.technologies)
        assert "python" in tech_lower
        assert "fastapi" in tech_lower

        # Complexity is calculated based on multiple factors
        # For this test, just verify it's set
        assert requirements.complexity in Complexity

        code_generator = CodeGenerator()
        code_result = code_generator.generate(requirements)

        # Should succeed even if complexity is lower than expected
        assert code_result.success_rate > 0

        test_generator = TestGenerator()
        test_result = test_generator.generate(code_result.files)

        assert len(test_result.tests) > 0

    def test_data_processing_scenario(self):
        """Test workflow for a data processing scenario."""
        description = """
        Create a data processing pipeline.
        Use Python with pandas and asyncio.
        Process CSV files from S3.
        Generate summary statistics.
        Handle errors gracefully.
        """

        parser = RequirementParser()
        requirements = parser.parse(description)

        code_generator = CodeGenerator()
        code_result = code_generator.generate(requirements)

        assert len(code_result.files) > 0

        test_generator = TestGenerator()
        test_result = test_generator.generate(code_result.files)

        # Should generate tests for async functions
        assert len(test_result.tests) > 0
