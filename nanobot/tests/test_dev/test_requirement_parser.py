"""Tests for the requirement parser module."""


from nanobot.dev.requirement_parser import (
    Ambiguity,
    Complexity,
    Deliverable,
    ParsedRequirements,
    RequirementParser,
)


class TestRequirementParser:
    """Test suite for RequirementParser."""

    def test_init_without_provider(self):
        """Test initialization without an LLM provider."""
        parser = RequirementParser()
        assert parser.provider is None

    def test_init_with_provider(self):
        """Test initialization with an LLM provider."""
        mock_provider = MockLLMProvider()
        parser = RequirementParser(provider=mock_provider)
        assert parser.provider is mock_provider

    def test_parse_with_rules_simple(self):
        """Test rule-based parsing with simple description."""
        parser = RequirementParser()
        description = "Build a simple todo app using React and Python."

        result = parser.parse(description)

        assert isinstance(result, ParsedRequirements)
        assert result.summary
        assert len(result.technologies) > 0
        assert result.complexity in Complexity

    def test_parse_with_rules_technologies(self):
        """Test technology extraction."""
        parser = RequirementParser()
        description = """
        I need a full-stack application using React, TypeScript, Node.js,
        PostgreSQL, and Docker for deployment.
        """

        result = parser.parse(description)

        tech_lower = [t.lower() for t in result.technologies]
        assert any("react" in t for t in tech_lower)
        assert any("typescript" in t or "ts" in t for t in tech_lower)

    def test_parse_with_rules_deliverables(self):
        """Test deliverable extraction."""
        parser = RequirementParser()
        description = """
        Build a user authentication system.
        Create a dashboard UI.
        Write API documentation.
        """

        result = parser.parse(description)

        assert len(result.deliverables) > 0
        assert all(isinstance(d, Deliverable) for d in result.deliverables)

    def test_parse_with_rules_constraints(self):
        """Test constraint extraction."""
        parser = RequirementParser()
        description = """
        The system must support 1000 concurrent users.
        Cannot use MongoDB.
        Required to use Python.
        """

        result = parser.parse(description)

        assert len(result.constraints) > 0

    def test_parse_with_rules_ambiguities(self):
        """Test ambiguity detection."""
        parser = RequirementParser()
        description = """
        Build a website that will eventually scale.
        Budget should be flexible.
        Include features like login, user management, etc.
        """

        result = parser.parse(description)

        assert len(result.ambiguities) > 0
        assert all(isinstance(a, Ambiguity) for a in result.ambiguities)

    def test_complexity_estimation_trivial(self):
        """Test complexity estimation for trivial projects."""
        parser = RequirementParser()
        description = "Fix a bug in the login form."  # Very simple

        result = parser.parse(description)

        assert result.complexity in [Complexity.TRIVIAL, Complexity.LOW]

    def test_complexity_estimation_high(self):
        """Test complexity estimation for complex projects."""
        parser = RequirementParser()
        description = """
        Build a scalable distributed microservices architecture for real-time
        data processing. The system must handle millions of users and integrate
        with multiple third-party services. Use React, Node.js, Python, PostgreSQL,
        Redis, Kafka, Docker, and Kubernetes. Implement user authentication,
        payment processing, analytics dashboard, notification system, and
        admin panel. Support migration from legacy system.
        """ * 3  # Repeat to increase word count

        result = parser.parse(description)

        assert result.complexity in [Complexity.HIGH, Complexity.VERY_HIGH]

    def test_extract_summary(self):
        """Test summary extraction."""
        parser = RequirementParser()
        long_text = "This is a test. " * 100

        result = parser.parse(long_text)

        assert result.summary
        assert len(result.summary) < 500  # Should be truncated

    def test_estimate_hours(self):
        """Test hour estimation."""
        parser = RequirementParser()
        description = "Build a simple todo app."

        result = parser.parse(description)

        assert result.estimated_hours > 0

    def test_confidence_score(self):
        """Test confidence score for rule-based parsing."""
        parser = RequirementParser()
        description = "Build something."

        result = parser.parse(description)

        # Rule-based should have lower confidence
        assert 0 <= result.confidence <= 1

    def test_parse_with_llm_provider(self):
        """Test parsing with mock LLM provider."""
        mock_provider = MockLLMProvider()
        parser = RequirementParser(provider=mock_provider)

        description = "Build a web application"
        result = parser.parse(description)

        assert isinstance(result, ParsedRequirements)
        assert result.summary == "Test summary from LLM"

    def test_llm_fallback_to_rules(self):
        """Test fallback to rule-based parsing on LLM error."""
        mock_provider = MockLLMProvider(should_fail=True)
        parser = RequirementParser(provider=mock_provider)

        description = "Build a React app"
        result = parser.parse(description)

        # Should fall back to rules
        assert isinstance(result, ParsedRequirements)
        assert result.confidence < 1.0

    def test_deliverable_types(self):
        """Test different deliverable type detection."""
        parser = RequirementParser()
        description = """
        Build the backend API.
        Design the user interface.
        Write the user manual.
        """

        result = parser.parse(description)

        # Should detect code and design deliverables
        assert len(result.deliverables) > 0


class MockLLMProvider:
    """Mock LLM provider for testing."""

    def __init__(self, should_fail: bool = False):
        self.should_fail = should_fail

    async def chat(self, messages, model=None, max_tokens=4096, temperature=0.7):
        """Mock chat method."""
        if self.should_fail:
            raise Exception("Mock LLM error")

        # Return mock JSON response
        import json

        mock_response = {
            "summary": "Test summary from LLM",
            "technologies": ["python", "react"],
            "deliverables": [
                {
                    "name": "API",
                    "description": "Backend API",
                    "type": "code",
                    "estimated_hours": 20,
                }
            ],
            "constraints": ["Must use Python"],
            "ambiguities": [],
            "user_stories": [
                {
                    "title": "User Login",
                    "description": "As a user, I want to log in",
                    "acceptance_criteria": ["Can log in with valid credentials"],
                    "priority": "high",
                }
            ],
            "complexity": "medium",
            "estimated_hours": 100,
            "confidence": 0.8,
        }

        class MockContent:
            def __init__(self, content):
                self.content = content

        return MockContent(json.dumps(mock_response))
