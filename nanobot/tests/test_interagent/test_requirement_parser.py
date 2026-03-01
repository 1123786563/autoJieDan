"""Tests for the requirement parser module."""

from nanobot.interagent.requirement_parser import (
    ComplexityLevel,
    ParsedRequirement,
    RequirementParser,
    RiskFactor,
    RiskLevel,
    SkillRequirement,
    TechStack,
)


class TestRequirementParser:
    """Test suite for RequirementParser."""

    def test_init_without_provider(self):
        """Test initialization without an LLM provider."""
        parser = RequirementParser()
        assert parser.llm_provider is None

    def test_init_with_provider(self):
        """Test initialization with an LLM provider."""
        mock_provider = MockLLMProvider()
        parser = RequirementParser(llm_provider=mock_provider)
        assert parser.llm_provider is mock_provider

    def test_parse_simple_description(self):
        """Test parsing a simple project description."""
        parser = RequirementParser()
        description = "Build a todo app using React and Python."

        result = parser.parse(description)

        assert isinstance(result, ParsedRequirement)
        assert result.summary
        assert result.complexity in ComplexityLevel

    def test_detect_tech_stack_frontend(self):
        """Test tech stack detection for frontend."""
        parser = RequirementParser()
        description = "Create a web application using React, TypeScript, and Tailwind CSS."

        tech_stack = parser.detect_tech_stack(description)

        assert len(tech_stack.frontend) > 0
        assert any("react" in t for t in tech_stack.frontend)

    def test_detect_tech_stack_backend(self):
        """Test tech stack detection for backend."""
        parser = RequirementParser()
        description = "Backend API using Python, FastAPI, and PostgreSQL."

        tech_stack = parser.detect_tech_stack(description)

        assert len(tech_stack.backend) > 0
        assert len(tech_stack.database) > 0

    def test_detect_tech_stack_infrastructure(self):
        """Test tech stack detection for infrastructure."""
        parser = RequirementParser()
        description = "Deploy using Docker and Kubernetes on AWS."

        tech_stack = parser.detect_tech_stack(description)

        assert len(tech_stack.infrastructure) > 0

    def test_extract_key_skills(self):
        """Test key skills extraction."""
        parser = RequirementParser()
        description = "Need React expert with Python knowledge."

        tech_stack = parser.detect_tech_stack(description)
        skills = parser.extract_key_skills(description, tech_stack)

        assert len(skills) > 0
        assert any(s.name.lower() in ["react", "python"] for s in skills)

    def test_estimate_effort_simple(self):
        """Test effort estimation for simple project."""
        parser = RequirementParser()
        description = "Simple contact form with email sending."
        tech_stack = parser.detect_tech_stack(description)

        effort = parser.estimate_effort(description, tech_stack)

        assert effort.total_hours > 0
        assert effort.development_hours > 0
        assert effort.min_hours <= effort.total_hours <= effort.max_hours

    def test_estimate_effort_complex(self):
        """Test effort estimation for complex project."""
        parser = RequirementParser()
        description = "Build a full e-commerce platform with React, Node.js, MongoDB, " \
                      "Docker, Kubernetes, payment integration, user authentication, " \
                      "admin panel, analytics dashboard, inventory management, " \
                      "order processing, and shipping integration. " * 5

        tech_stack = parser.detect_tech_stack(description)
        effort = parser.estimate_effort(description, tech_stack)

        assert effort.total_hours > 50  # Complex project should have higher estimate

    def test_assess_complexity_trivial(self):
        """Test complexity assessment for trivial project."""
        parser = RequirementParser()
        description = "Fix CSS bug on login page."
        tech_stack = parser.detect_tech_stack(description)

        complexity = parser.assess_complexity(description, tech_stack)

        assert complexity in [ComplexityLevel.TRIVIAL, ComplexityLevel.LOW]

    def test_assess_complexity_high(self):
        """Test complexity assessment for complex project."""
        parser = RequirementParser()
        description = """
        Build a scalable distributed microservices architecture for real-time
        data processing with millions of users. Integrate with multiple third-party
        services. Use React, Node.js, Python, PostgreSQL, Redis, Docker, Kubernetes.
        Include migration from legacy system.
        """ * 3

        tech_stack = parser.detect_tech_stack(description)
        complexity = parser.assess_complexity(description, tech_stack)

        assert complexity in [ComplexityLevel.HIGH, ComplexityLevel.VERY_HIGH]

    def test_identify_risks_timeline(self):
        """Test risk identification for timeline issues."""
        parser = RequirementParser()
        description = "Need this done ASAP by tomorrow, it's urgent."

        risks = parser.identify_risks(description)

        assert len(risks) > 0
        assert any(r.category == "timeline" for r in risks)

    def test_identify_risks_scope(self):
        """Test risk identification for scope issues."""
        parser = RequirementParser()
        description = "Build an MVP that can expand later, etc. Maybe add more features."

        risks = parser.identify_risks(description)

        assert len(risks) > 0
        assert any(r.category == "scope" for r in risks)

    def test_calculate_overall_risk(self):
        """Test overall risk calculation."""
        parser = RequirementParser()
        risks = [
            RiskFactor(category="technical", description="Integration risk", level=RiskLevel.HIGH),
            RiskFactor(category="scope", description="Unclear scope", level=RiskLevel.MEDIUM),
        ]

        overall = parser._calculate_overall_risk(risks, ComplexityLevel.MEDIUM)

        assert overall in [RiskLevel.HIGH, RiskLevel.CRITICAL]

    def test_extract_summary(self):
        """Test summary extraction."""
        parser = RequirementParser()
        long_text = "This is a test. " * 100

        summary = parser._extract_summary(long_text)

        assert summary
        assert len(summary) < 400

    def test_parse_with_project_metadata(self):
        """Test parsing with project ID and title."""
        parser = RequirementParser()
        result = parser.parse(
            description="Build a web app",
            project_id="proj-123",
            title="Web Application",
        )

        assert result.project_id == "proj-123"
        assert result.title == "Web Application"

    def test_effort_estimate_weeks_calculation(self):
        """Test weeks calculation in effort estimate."""
        parser = RequirementParser()
        description = "Build a simple API."
        tech_stack = parser.detect_tech_stack(description)
        effort = parser.estimate_effort(description, tech_stack)

        assert effort.weeks > 0
        assert abs(effort.weeks - (effort.total_hours / 40.0)) < 0.1

    def test_skill_requirement_proficiency_levels(self):
        """Test skill requirement with different proficiency levels."""
        skill = SkillRequirement(
            name="React",
            category="frontend",
            proficiency="expert",
            mandatory=True,
        )

        assert skill.proficiency == "expert"
        assert skill.mandatory is True

    def test_tech_stack_all_technologies(self):
        """Test getting all technologies from tech stack."""
        tech_stack = TechStack(
            frontend=["react", "vue"],
            backend=["python", "node"],
            database=["postgresql"],
            infrastructure=["docker"],
            other=["redis"],
        )

        all_tech = tech_stack.all_technologies()

        # 7 distinct technologies
        assert len(all_tech) == 7
        assert "react" in all_tech
        assert "python" in all_tech

    def test_parse_with_llm_provider(self):
        """Test parsing with mock LLM provider."""
        mock_provider = MockLLMProvider()
        parser = RequirementParser(llm_provider=mock_provider)

        result = parser.parse("Build a web app")

        assert isinstance(result, ParsedRequirement)
        assert result.confidence > 0.5  # LLM should have higher confidence

    def test_llm_fallback_to_rules(self):
        """Test fallback to rule-based parsing on LLM error."""
        mock_provider = MockLLMProvider(should_fail=True)
        parser = RequirementParser(llm_provider=mock_provider)

        result = parser.parse("Build a React app")

        # Should fall back to rules
        assert isinstance(result, ParsedRequirement)
        assert result.confidence < 1.0

    def test_empty_description(self):
        """Test parsing empty description."""
        parser = RequirementParser()
        result = parser.parse("")

        assert isinstance(result, ParsedRequirement)
        assert result.complexity == ComplexityLevel.TRIVIAL

    def test_multiple_risk_categories(self):
        """Test identifying multiple risk categories."""
        parser = RequirementParser()
        description = """
        Need this ASAP (urgent), working on weekends.
        Budget is low, want pro bono work.
        Scope is unclear, etc., might add features later.
        Need integration with legacy systems for real-time data.
        """

        risks = parser.identify_risks(description)

        categories = {r.category for r in risks}
        assert len(categories) >= 2


class MockLLMProvider:
    """Mock LLM provider for testing."""

    def __init__(self, should_fail: bool = False):
        self.should_fail = should_fail

    async def chat(self, messages, max_tokens=4096, temperature=0.3):
        """Mock chat method."""
        if self.should_fail:
            raise Exception("Mock LLM error")

        import json

        mock_response = {
            "summary": "Build a web application",
            "tech_stack": {
                "frontend": ["react"],
                "backend": ["python"],
                "database": [],
                "infrastructure": [],
                "other": [],
            },
            "key_skills": [
                {"name": "React", "category": "frontend", "proficiency": "expert", "mandatory": True}
            ],
            "effort": {
                "total_hours": 80,
                "development_hours": 56,
                "testing_hours": 16,
                "deployment_hours": 4,
                "buffer_hours": 4,
                "min_hours": 60,
                "max_hours": 120,
                "confidence": 0.75,
            },
            "complexity": "medium",
            "risks": [],
            "overall_risk": "low",
            "confidence": 0.8,
        }

        class MockContent:
            def __init__(self, content):
                self.content = content

        return MockContent(json.dumps(mock_response))
