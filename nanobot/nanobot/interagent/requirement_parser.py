"""
Requirement Parser for Project Analysis

Intelligent parsing and analysis of project requirements to extract:
- Tech stack detection
- Effort estimation
- Key skills extraction
- Risk assessment
"""

import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class RiskLevel(str, Enum):
    """Risk level for a project."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ComplexityLevel(str, Enum):
    """Complexity level for a project."""
    TRIVIAL = "trivial"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    VERY_HIGH = "very_high"


@dataclass
class TechStack:
    """Detected technology stack."""
    frontend: list[str] = field(default_factory=list)
    backend: list[str] = field(default_factory=list)
    database: list[str] = field(default_factory=list)
    infrastructure: list[str] = field(default_factory=list)
    other: list[str] = field(default_factory=list)

    def all_technologies(self) -> list[str]:
        """Get all technologies as a flat list, deduplicated."""
        all_tech = (
            self.frontend + self.backend + self.database +
            self.infrastructure + self.other
        )
        # Deduplicate while preserving order
        seen = set()
        unique = []
        for tech in all_tech:
            normalized = tech.lower()
            # Handle common aliases
            if normalized == "node.js":
                normalized = "node"
            if normalized not in seen:
                seen.add(normalized)
                unique.append(tech)
        return unique


@dataclass
class RiskFactor:
    """A identified risk factor."""
    category: str  # technical, timeline, scope, budget, etc.
    description: str
    level: RiskLevel
    mitigation: str = ""


@dataclass
class SkillRequirement:
    """A required skill for the project."""
    name: str
    category: str  # frontend, backend, devops, etc.
    proficiency: str = "intermediate"  # beginner, intermediate, expert
    mandatory: bool = True


class EffortEstimate(BaseModel):
    """Effort estimation for a project."""
    model_config = ConfigDict(arbitrary_types_allowed=True)

    total_hours: float = Field(description="Total estimated hours")
    development_hours: float = Field(description="Development time hours")
    testing_hours: float = Field(description="Testing time hours")
    deployment_hours: float = Field(description="Deployment time hours")
    buffer_hours: float = Field(description="Buffer for unexpected issues")

    min_hours: float = Field(description="Optimistic estimate")
    max_hours: float = Field(description="Pessimistic estimate")
    confidence: float = Field(default=0.7, description="Confidence in estimate (0-1)")

    weeks: float = Field(default=0.0, description="Estimated weeks (40h/week)")


class ParsedRequirement(BaseModel):
    """Result of parsing a project requirement."""
    model_config = ConfigDict(arbitrary_types_allowed=True)

    # Project identification
    project_id: str = ""
    title: str = ""
    summary: str = Field(default="", description="Brief project summary")

    # Technical analysis
    tech_stack: TechStack = Field(default_factory=TechStack)
    key_skills: list[SkillRequirement] = Field(default_factory=list)

    # Effort estimation
    effort: EffortEstimate = Field(default_factory=EffortEstimate)
    complexity: ComplexityLevel = Field(default=ComplexityLevel.MEDIUM)

    # Risk assessment
    risks: list[RiskFactor] = Field(default_factory=list)
    overall_risk: RiskLevel = Field(default=RiskLevel.MEDIUM)

    # Metadata
    parse_timestamp: datetime = Field(default_factory=datetime.now)
    confidence: float = Field(default=0.5, description="Parse confidence (0-1)")
    raw_description: str = Field(default="")


class RequirementParser:
    """
    Parser for extracting structured information from project requirements.

    Uses LLM for intelligent parsing when available, with rule-based fallback.
    """

    # Technology patterns for detection
    TECH_PATTERNS = {
        "frontend": [
            r"\breact\b", r"\bvue\b", r"\bangular\b", r"\bsvelte\b",
            r"\bnext\.?js\b", r"\bnuxt\b", r"\btypescript\b", r"\bjavascript\b",
            r"\btsx\b", r"\bjsx\b", r"\bhtml\b", r"\bcss\b", r"\btailwind\b",
            r"\bbootstrap\b", r"\bmaterial[- ]ui\b",
        ],
        "backend": [
            r"\bpython\b", r"\bnode\b", r"\bexpress\b", r"\bfastapi\b",
            r"\bdjango\b", r"\bflask\b", r"\bspring\b", r"\bjava\b",
            r"\bgo\b", r"\bgolang\b", r"\brust\b", r"\bc\+\+\b", r"\bphp\b",
            r"\bruby\b", r"\brails\b", r"\b\.net\b", r"\bc#\b",
        ],
        "database": [
            r"\bpostgresql\b", r"\bpostgres\b", r"\bmysql\b", r"\bmongodb\b",
            r"\bredis\b", r"\bsqlite\b", r"\belastic\b", r"\bdynamodb\b",
            r"\bprisma\b", r"\bsequelize\b", r"\btypeorm\b", r"\bsql\b",
        ],
        "infrastructure": [
            r"\bdocker\b", r"\bkubernetes\b", r"\bk8s\b", r"\bak\b", r"\bgcp\b",
            r"\baws\b", r"\bazure\b", r"\bvercel\b", r"\brailway\b",
            r"\bterraform\b", r"\bansible\b", r"\bci/cd\b", r"\bgithub[- ]actions\b",
        ],
    }

    # Risk indicators
    RISK_PATTERNS = {
        "technical": [
            r"\bintegrat(?:ion|e)\b.*\bthird\s+party\b",
            r"\bmigrat(?:e|ion)\b.*\blegacy\b",
            r"\b(?:real-?time|live)\b.*\bdata\b",
            r"\bscal(?:e|able|ability)\b.*\bmillion",
        ],
        "scope": [
            r"\bmvp\b.*\b(?:expand|grow|add)\b",
            r"\b(?:phase|stage)\s+\d+\b",
            r"\b(?:etc|etcetera|and\s+more)\b",
            r"\b(?:maybe|possibly|might)\b",
        ],
        "timeline": [
            r"\basap\b",
            r"\byesterday\b",
            r"\b(?:urgent|rush)\b",
            r"\b(?:weekend|holiday)\b",
        ],
        "budget": [
            r"\b(?:low|cheap|budget)\b.*\bprice\b",
            r"\bpro\s+bono\b",
            r"\b(?:equity|share)\b.*\bp(?:ayment|ay)\b",
        ],
    }

    def __init__(self, llm_provider: Any = None):
        """
        Initialize the requirement parser.

        Args:
            llm_provider: Optional LLM provider for intelligent parsing.
        """
        self.llm_provider = llm_provider

    def parse(
        self,
        description: str,
        project_id: str = "",
        title: str = "",
    ) -> ParsedRequirement:
        """
        Parse a project requirement description.

        Args:
            description: Project description text.
            project_id: Optional project identifier.
            title: Optional project title.

        Returns:
            ParsedRequirement with extracted information.
        """
        if self.llm_provider:
            return self._parse_with_llm(description, project_id, title)
        return self._parse_with_rules(description, project_id, title)

    def _parse_with_llm(
        self,
        description: str,
        project_id: str,
        title: str,
    ) -> ParsedRequirement:
        """Parse using LLM for intelligent extraction."""
        prompt = self._build_llm_prompt(description, project_id, title)

        try:
            response = self._call_llm(prompt)
            return self._parse_llm_response(response, description, project_id, title)
        except Exception:
            return self._parse_with_rules(description, project_id, title)

    def _build_llm_prompt(
        self,
        description: str,
        project_id: str,
        title: str,
    ) -> str:
        """Build the prompt for LLM parsing."""
        return f"""You are a project analyst. Extract structured information from this project description.

Project ID: {project_id or "N/A"}
Title: {title or "N/A"}

Description:
{description}

Extract and return JSON with:
{{
    "summary": "Brief 2-3 sentence summary",
    "tech_stack": {{
        "frontend": ["tech1", "tech2"],
        "backend": ["tech1", "tech2"],
        "database": ["tech1"],
        "infrastructure": ["tech1"],
        "other": ["other"]
    }},
    "key_skills": [
        {{"name": "React", "category": "frontend", "proficiency": "expert", "mandatory": true}}
    ],
    "effort": {{
        "total_hours": 100,
        "development_hours": 70,
        "testing_hours": 20,
        "deployment_hours": 5,
        "buffer_hours": 5,
        "min_hours": 80,
        "max_hours": 150,
        "confidence": 0.75
    }},
    "complexity": "trivial|low|medium|high|very_high",
    "risks": [
        {{"category": "technical", "description": "Risk desc", "level": "medium", "mitigation": "How to mitigate"}}
    ],
    "overall_risk": "low|medium|high|critical",
    "confidence": 0.8
}}

Guidelines:
- Be thorough but realistic
- Estimate conservatively (under-promise, over-deliver)
- Mark risks even if small
- confidence reflects clarity of requirements

Return ONLY valid JSON, no other text."""

    def _call_llm(self, prompt: str) -> str:
        """Call the LLM provider."""
        import asyncio

        async def _call():
            messages = [{"role": "user", "content": prompt}]
            response = await self.llm_provider.chat(
                messages=messages,
                max_tokens=4096,
                temperature=0.3,
            )
            return response.content or ""

        return asyncio.run(_call())

    def _parse_llm_response(
        self,
        response: str,
        description: str,
        project_id: str,
        title: str,
    ) -> ParsedRequirement:
        """Parse LLM response into ParsedRequirement."""
        import json

        try:
            json_match = re.search(r'\{[\s\S]*\}', response)
            if not json_match:
                raise ValueError("No JSON found")

            data = json.loads(json_match.group(0))

            # Parse tech stack
            tech_data = data.get("tech_stack", {})
            tech_stack = TechStack(
                frontend=tech_data.get("frontend", []),
                backend=tech_data.get("backend", []),
                database=tech_data.get("database", []),
                infrastructure=tech_data.get("infrastructure", []),
                other=tech_data.get("other", []),
            )

            # Parse skills
            key_skills = [
                SkillRequirement(**s) for s in data.get("key_skills", [])
            ]

            # Parse effort
            effort_data = data.get("effort", {})
            effort = EffortEstimate(**effort_data)
            effort.weeks = effort.total_hours / 40.0

            # Parse risks
            risks = [
                RiskFactor(**r) for r in data.get("risks", [])
            ]

            return ParsedRequirement(
                project_id=project_id,
                title=title,
                summary=data.get("summary", ""),
                tech_stack=tech_stack,
                key_skills=key_skills,
                effort=effort,
                complexity=ComplexityLevel(data.get("complexity", "medium")),
                risks=risks,
                overall_risk=RiskLevel(data.get("overall_risk", "medium")),
                confidence=data.get("confidence", 0.7),
                raw_description=description,
            )

        except Exception:
            # Fallback to rules
            return self._parse_with_rules(description, project_id, title)

    def _parse_with_rules(
        self,
        description: str,
        project_id: str,
        title: str,
    ) -> ParsedRequirement:
        """Parse using rule-based extraction."""
        # Extract summary
        summary = self._extract_summary(description)

        # Detect tech stack
        tech_stack = self.detect_tech_stack(description)

        # Extract key skills
        key_skills = self.extract_key_skills(description, tech_stack)

        # Estimate effort
        effort = self.estimate_effort(description, tech_stack)

        # Assess complexity
        complexity = self.assess_complexity(description, tech_stack)

        # Identify risks
        risks = self.identify_risks(description)
        overall_risk = self._calculate_overall_risk(risks, complexity)

        return ParsedRequirement(
            project_id=project_id,
            title=title,
            summary=summary,
            tech_stack=tech_stack,
            key_skills=key_skills,
            effort=effort,
            complexity=complexity,
            risks=risks,
            overall_risk=overall_risk,
            confidence=0.4,  # Lower for rule-based
            raw_description=description,
        )

    def detect_tech_stack(self, text: str) -> TechStack:
        """Detect technologies from text."""
        text_lower = text.lower()
        tech_stack = TechStack()

        for category, patterns in self.TECH_PATTERNS.items():
            found = set()
            for pattern in patterns:
                matches = re.findall(pattern, text_lower, re.IGNORECASE)
                found.update(m.lower() for m in matches)
            setattr(tech_stack, category, sorted(list(found)))

        return tech_stack

    def extract_key_skills(
        self,
        text: str,
        tech_stack: TechStack,
    ) -> list[SkillRequirement]:
        """Extract key skill requirements."""
        skills = []
        seen = set()

        # Skills from tech stack
        for tech in tech_stack.all_technologies():
            if tech not in seen:
                category = self._categorize_tech(tech, tech_stack)
                skills.append(SkillRequirement(
                    name=tech,
                    category=category,
                    proficiency="intermediate",
                    mandatory=True,
                ))
                seen.add(tech)

        # Look for explicit skill mentions
        skill_patterns = [
            r"(?:expert|experienced|senior)\s+in\s+(\w+)",
            r"(?:knowledge|experience)\s+(?:of|with)\s+(\w+)",
            r"(?:must|should|require)\s+(?:have|know)\s+(\w+)",
        ]

        for pattern in skill_patterns:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                skill = match.group(1).lower()
                if skill not in seen:
                    skills.append(SkillRequirement(
                        name=skill,
                        category="other",
                        proficiency="intermediate",
                        mandatory=True,
                    ))
                    seen.add(skill)

        return skills[:20]  # Limit to top 20

    def _categorize_tech(self, tech: str, tech_stack: TechStack) -> str:
        """Categorize a technology."""
        tech_lower = tech.lower()
        if tech_lower in tech_stack.frontend:
            return "frontend"
        if tech_lower in tech_stack.backend:
            return "backend"
        if tech_lower in tech_stack.database:
            return "database"
        if tech_lower in tech_stack.infrastructure:
            return "devops"
        return "other"

    def estimate_effort(
        self,
        description: str,
        tech_stack: TechStack,
    ) -> EffortEstimate:
        """Estimate project effort in hours."""
        # Base effort from complexity indicators
        word_count = len(description.split())
        base_hours = 8

        # Tech stack complexity
        tech_count = len(tech_stack.all_technologies())
        if tech_count > 10:
            base_hours += 120
        elif tech_count > 5:
            base_hours += 60
        elif tech_count > 2:
            base_hours += 24

        # Description length indicates scope
        if word_count > 500:
            base_hours += 100
        elif word_count > 200:
            base_hours += 40

        # Look for specific complexity indicators
        if any(term in description.lower() for term in ["ecommerce", "e-commerce", "platform", "system"]):
            base_hours += 80

        # Look for hourly/fixed price clues
        hour_match = re.search(r'(\d+)\s*hours?', description, re.IGNORECASE)
        if hour_match:
            base_hours = max(base_hours, int(hour_match.group(1)))

        # Calculate components
        development = int(base_hours * 0.70)
        testing = int(base_hours * 0.20)
        deployment = int(base_hours * 0.05)
        buffer = int(base_hours * 0.05)

        # Range estimates
        min_hours = int(base_hours * 0.8)
        max_hours = int(base_hours * 1.5)

        effort = EffortEstimate(
            total_hours=base_hours,
            development_hours=development,
            testing_hours=testing,
            deployment_hours=deployment,
            buffer_hours=buffer,
            min_hours=min_hours,
            max_hours=max_hours,
            weeks=base_hours / 40.0,
        )

        return effort

    def assess_complexity(
        self,
        description: str,
        tech_stack: TechStack,
    ) -> ComplexityLevel:
        """Assess project complexity."""
        score = 0

        # Technology diversity
        tech_count = len(tech_stack.all_technologies())
        if tech_count > 8:
            score += 3
        elif tech_count > 5:
            score += 2
        elif tech_count > 2:
            score += 1

        # Description length
        word_count = len(description.split())
        if word_count > 500:
            score += 2
        elif word_count > 200:
            score += 1

        # Complexity keywords
        complex_terms = [
            "scalable", "distributed", "microservice", "real-time",
            "integration", "migration", "architecture", "system",
        ]
        for term in complex_terms:
            if term.lower() in description.lower():
                score += 1

        # Map to level
        if score <= 1:
            return ComplexityLevel.TRIVIAL
        if score <= 3:
            return ComplexityLevel.LOW
        if score <= 5:
            return ComplexityLevel.MEDIUM
        if score <= 7:
            return ComplexityLevel.HIGH
        return ComplexityLevel.VERY_HIGH

    def identify_risks(self, description: str) -> list[RiskFactor]:
        """Identify risk factors in the description."""
        risks = []
        desc_lower = description.lower()

        for category, patterns in self.RISK_PATTERNS.items():
            for pattern in patterns:
                matches = re.finditer(pattern, desc_lower)
                for match in matches:
                    context = self._get_risk_context(description, match.start())
                    level = self._assess_risk_level(category, context)
                    mitigation = self._suggest_mitigation(category, context)

                    risks.append(RiskFactor(
                        category=category,
                        description=context[:200],
                        level=level,
                        mitigation=mitigation,
                    ))

        # Deduplicate by description
        seen = set()
        unique_risks = []
        for risk in risks:
            key = f"{risk.category}:{risk.description[:50]}"
            if key not in seen:
                seen.add(key)
                unique_risks.append(risk)

        return unique_risks[:10]  # Limit to top 10

    def _get_risk_context(self, text: str, pos: int) -> str:
        """Get context around a risk match."""
        start = max(0, pos - 50)
        end = min(len(text), pos + 100)
        return text[start:end].strip()

    def _assess_risk_level(self, category: str, context: str) -> RiskLevel:
        """Assess the severity of a risk."""
        if category == "timeline":
            return RiskLevel.HIGH
        if category == "budget":
            return RiskLevel.MEDIUM
        if "critical" in context.lower() or "urgent" in context.lower():
            return RiskLevel.CRITICAL
        return RiskLevel.MEDIUM

    def _suggest_mitigation(self, category: str, context: str) -> str:
        """Suggest risk mitigation strategies."""
        mitigations = {
            "technical": "Clarify requirements and consider phased implementation",
            "scope": "Define clear MVP boundaries and change management process",
            "timeline": "Set realistic milestones with buffer for unexpected delays",
            "budget": "Establish clear payment terms and scope-based pricing",
        }
        return mitigations.get(category, "Monitor closely and communicate proactively")

    def _calculate_overall_risk(
        self,
        risks: list[RiskFactor],
        complexity: ComplexityLevel,
    ) -> RiskLevel:
        """Calculate overall project risk."""
        # Count high/critical risks
        high_count = sum(1 for r in risks if r.level in [RiskLevel.HIGH, RiskLevel.CRITICAL])

        # Start with risk count
        if high_count >= 3:
            return RiskLevel.CRITICAL
        if high_count >= 2:
            return RiskLevel.HIGH

        # Consider complexity if no high risks
        if high_count == 0:
            if complexity in [ComplexityLevel.TRIVIAL, ComplexityLevel.LOW]:
                return RiskLevel.LOW
            if complexity in [ComplexityLevel.HIGH, ComplexityLevel.VERY_HIGH]:
                return RiskLevel.HIGH
            return RiskLevel.MEDIUM

        # One high risk
        return RiskLevel.HIGH

    def _extract_summary(self, text: str) -> str:
        """Extract a brief summary from text."""
        # Take first few sentences
        sentences = re.split(r'[.!?]+', text)
        summary_parts = []
        char_count = 0
        max_chars = 300

        for sentence in sentences:
            sentence = sentence.strip()
            if len(sentence) > 10:
                if char_count + len(sentence) > max_chars:
                    break
                summary_parts.append(sentence)
                char_count += len(sentence)

        return " ".join(summary_parts) if summary_parts else text[:max_chars]
