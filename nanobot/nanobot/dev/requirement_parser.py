"""Requirement parser for extracting structured requirements from natural language.

This module provides tools to parse project descriptions, extract technical
specifications, identify constraints, and flag ambiguities.
"""

import json
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Complexity(str, Enum):
    """Project complexity levels."""
    TRIVIAL = "trivial"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    VERY_HIGH = "very_high"


@dataclass
class Deliverable:
    """A project deliverable."""
    name: str
    description: str
    type: str  # code, documentation, design, infrastructure, etc.
    estimated_hours: float = 0.0


@dataclass
class Ambiguity:
    """An ambiguity found in requirements."""
    text: str
    category: str  # scope, technical, timeline, budget, etc.
    suggestion: str = ""


@dataclass
class UserStory:
    """A user story extracted from requirements."""
    title: str
    description: str
    acceptance_criteria: list[str] = field(default_factory=list)
    priority: str = "medium"  # low, medium, high, critical


class ParsedRequirements(BaseModel):
    """Structured representation of parsed requirements."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    summary: str = Field(description="Brief summary of the project")
    technologies: list[str] = Field(default_factory=list, description="Technologies to be used")
    deliverables: list[Deliverable] = Field(default_factory=list, description="Project deliverables")
    constraints: list[str] = Field(default_factory=list, description="Constraints and limitations")
    ambiguities: list[Ambiguity] = Field(default_factory=list, description="Ambiguous requirements")
    user_stories: list[UserStory] = Field(default_factory=list, description="User stories")
    complexity: Complexity = Field(default=Complexity.MEDIUM, description="Project complexity")
    estimated_hours: float = Field(default=0.0, description="Total estimated hours")
    confidence: float = Field(default=0.5, description="Confidence score (0-1)")


class RequirementParser:
    """
    Parser for extracting structured requirements from natural language descriptions.

    Uses LLM to intelligently parse project requirements and extract:
    - Technical specifications
    - User stories
    - Constraints
    - Deliverables
    - Ambiguities
    """

    # Common technology patterns
    TECH_PATTERNS = {
        "frontend": [
            r"\breact\b", r"\bvue\b", r"\bangular\b", r"\bsvelte\b",
            r"\bnext\.?js\b", r"\bnuxt\b", r"\btypescript\b", r"\bjavascript\b",
        ],
        "backend": [
            r"\bpython\b", r"\bnode\b", r"\bexpress\b", r"\bfastapi\b",
            r"\bdjango\b", r"\bflask\b", r"\bspring\b", r"\bjava\b",
        ],
        "database": [
            r"\bpostgresql\b", r"\bmysql\b", r"\bmongodb\b", r"\bredis\b",
            r"\bsqlite\b", r"\bprisma\b", r"\bsequelize\b", r"\btypeorm\b",
        ],
        "infrastructure": [
            r"\bdocker\b", r"\bkubernetes\b", r"\bak\b", r"\bgcp\b",
            r"\baws\b", r"\bazure\b", r"\bvercel\b", r"\brailway\b",
        ],
    }

    def __init__(self, provider: Any = None):
        """
        Initialize the requirement parser.

        Args:
            provider: LLM provider instance for intelligent parsing.
                     If None, uses rule-based parsing only.
        """
        self.provider = provider

    def parse(self, description: str) -> ParsedRequirements:
        """
        Parse a natural language project description into structured requirements.

        Args:
            description: Natural language project description.

        Returns:
            ParsedRequirements with structured information.
        """
        if self.provider:
            return self._parse_with_llm(description)
        return self._parse_with_rules(description)

    def _parse_with_llm(self, description: str) -> ParsedRequirements:
        """Parse using LLM for intelligent extraction."""
        prompt = self._build_parse_prompt(description)

        try:
            response = self._call_llm(prompt)
            return self._parse_llm_response(response)
        except Exception:
            # Fallback to rule-based parsing
            return self._parse_with_rules(description)

    def _build_parse_prompt(self, description: str) -> str:
        """Build the prompt for LLM parsing."""
        return f"""You are a requirements analyst. Extract structured information from the following project description.

Project Description:
{description}

Please extract and return a JSON with the following structure:
{{
    "summary": "Brief 1-2 sentence summary",
    "technologies": ["tech1", "tech2", ...],
    "deliverables": [
        {{"name": "name", "description": "desc", "type": "code|documentation|design|infrastructure", "estimated_hours": 10}}
    ],
    "constraints": ["constraint1", "constraint2", ...],
    "ambiguities": [
        {{"text": "unclear text", "category": "scope|technical|timeline|budget", "suggestion": "clarification"}}
    ],
    "user_stories": [
        {{"title": "story title", "description": "as a... I want... so that...", "acceptance_criteria": ["criterion1"], "priority": "low|medium|high|critical"}}
    ],
    "complexity": "trivial|low|medium|high|very_high",
    "estimated_hours": 100,
    "confidence": 0.8
}}

Guidelines:
- Be thorough but realistic
- Mark items as ambiguous if they lack clarity
- Estimate conservatively
- confidence should reflect how clear the requirements are (0-1)

Return ONLY valid JSON, no other text."""

    def _call_llm(self, prompt: str) -> str:
        """Call the LLM provider."""
        import asyncio

        async def _call():
            messages = [{"role": "user", "content": prompt}]
            response = await self.provider.chat(
                messages=messages,
                model=None,
                max_tokens=4096,
                temperature=0.3,
            )
            return response.content or ""

        return asyncio.run(_call())

    def _parse_llm_response(self, response: str) -> ParsedRequirements:
        """Parse the LLM response into ParsedRequirements."""
        try:
            # Extract JSON from response
            json_match = re.search(r'\{[\s\S]*\}', response)
            if json_match:
                data = json.loads(json_match.group(0))
            else:
                raise ValueError("No JSON found in response")

            # Convert to ParsedRequirements
            deliverables = [
                Deliverable(**d) for d in data.get("deliverables", [])
            ]
            ambiguities = [
                Ambiguity(**a) for a in data.get("ambiguities", [])
            ]
            user_stories = [
                UserStory(**s) for s in data.get("user_stories", [])
            ]

            return ParsedRequirements(
                summary=data.get("summary", ""),
                technologies=data.get("technologies", []),
                deliverables=deliverables,
                constraints=data.get("constraints", []),
                ambiguities=ambiguities,
                user_stories=user_stories,
                complexity=Complexity(data.get("complexity", "medium")),
                estimated_hours=data.get("estimated_hours", 0),
                confidence=data.get("confidence", 0.5),
            )
        except Exception as e:
            # Fallback to rule-based
            return ParsedRequirements(
                summary=f"Error parsing LLM response: {e}",
                confidence=0.0,
            )

    def _parse_with_rules(self, description: str) -> ParsedRequirements:
        """Parse using rule-based extraction."""
        # Extract summary
        summary = self._extract_summary(description)

        # Extract technologies
        technologies = self.extract_technologies(description)

        # Extract deliverables (basic patterns)
        deliverables = self._extract_deliverables_rules(description)

        # Extract constraints (basic patterns)
        constraints = self._extract_constraints_rules(description)

        # Estimate complexity
        complexity = self.estimate_complexity_from_rules(
            description, technologies, deliverables
        )

        # Estimate hours
        estimated_hours = self._estimate_hours_rules(complexity, deliverables)

        # Identify ambiguities (basic)
        ambiguities = self._identify_ambiguities_rules(description)

        return ParsedRequirements(
            summary=summary,
            technologies=technologies,
            deliverables=deliverables,
            constraints=constraints,
            ambiguities=ambiguities,
            complexity=complexity,
            estimated_hours=estimated_hours,
            confidence=0.3,  # Lower confidence for rule-based
        )

    def _extract_summary(self, text: str) -> str:
        """Extract a brief summary from the text."""
        # Take first few sentences
        sentences = re.split(r'[.!?]+', text)
        summary_sentences = []
        for sentence in sentences[:3]:
            sentence = sentence.strip()
            if len(sentence) > 10:
                summary_sentences.append(sentence)
            if len(' '.join(summary_sentences)) > 200:
                break
        return ' '.join(summary_sentences) if summary_sentences else text[:200]

    def extract_technologies(self, text: str) -> list[str]:
        """
        Extract mentioned technologies from text.

        Args:
            text: Text to search for technology mentions.

        Returns:
            List of technology names found.
        """
        text_lower = text.lower()
        technologies = set()

        for category, patterns in self.TECH_PATTERNS.items():
            for pattern in patterns:
                matches = re.findall(pattern, text_lower, re.IGNORECASE)
                technologies.update(matches)

        return sorted(list(technologies))

    def _extract_deliverables_rules(self, text: str) -> list[Deliverable]:
        """Extract deliverables using rule-based patterns."""
        deliverables = []

        # Common deliverable patterns
        patterns = [
            (r'(?:build|create|develop|implement)\s+(?:a\s+)?(\w+(?:\s+\w+)?)',
             "code"),
            (r'(?:write|document)\s+(?:a\s+)?(\w+(?:\s+\w+)?)',
             "documentation"),
            (r'(?:design|create)\s+(?:a\s+)?(\w+(?:\s+\w+)?)\s+(?:ui|interface|design)',
             "design"),
        ]

        for pattern, deliv_type in patterns:
            matches = re.finditer(pattern, text, re.IGNORECASE)
            for match in matches:
                name = match.group(1).strip()
                if len(name) > 3:
                    deliverables.append(Deliverable(
                        name=name.title(),
                        description=f"Deliverable: {name}",
                        type=deliv_type,
                        estimated_hours=8.0,  # Default estimate
                    ))

        return deliverables[:10]  # Limit results

    def _extract_constraints_rules(self, text: str) -> list[str]:
        """Extract constraints using rule-based patterns."""
        constraints = []

        # Constraint indicators
        patterns = [
            r'must\s+(?:be|have|use|support)\s+([^,.]+)',
            r'cannot\s+(?:use|have|exceed)\s+([^,.]+)',
            r'require(?:s|d)?\s+([^,.]+)',
            r'limit(?:ed|ation)?\s+(?:to|of)?\s+([^,.]+)',
            r'within\s+([^,.]+)',
        ]

        for pattern in patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            constraints.extend(matches)

        return list(set(constraints))[:10]

    def _identify_ambiguities_rules(self, text: str) -> list[Ambiguity]:
        """Identify ambiguities using rule-based patterns."""
        ambiguities = []

        # Ambiguity indicators
        ambiguous_patterns = [
            (r'(?:sometime|eventually|later|soon)(?:\s+\w+)?', "timeline",
             "Please specify exact timeline"),
            (r'(?:flexible|reasonable|competitive)(?:\s+(?:price|budget|cost))?', "budget",
             "Please specify exact budget or budget range"),
            (r'(?:etc|and so forth|and so on|things like that)', "scope",
             "Please provide complete list of requirements"),
            (r'(?:maybe|possibly|might|could)(?:\s+\w+)?', "scope",
             "Clarify if this is required or optional"),
        ]

        for pattern, category, suggestion in ambiguous_patterns:
            matches = re.finditer(pattern, text, re.IGNORECASE)
            for match in matches:
                ambiguities.append(Ambiguity(
                    text=match.group(0),
                    category=category,
                    suggestion=suggestion,
                ))

        return ambiguities

    def estimate_complexity_from_rules(
        self,
        description: str,
        technologies: list[str],
        deliverables: list[Deliverable],
    ) -> Complexity:
        """
        Estimate project complexity based on rules.

        Args:
            description: Project description.
            technologies: List of technologies.
            deliverables: List of deliverables.

        Returns:
            Complexity level.
        """
        score = 0

        # Description length (indicator of scope)
        desc_words = len(description.split())
        if desc_words > 500:
            score += 2
        elif desc_words > 200:
            score += 1

        # Technology count
        if len(technologies) > 8:
            score += 2
        elif len(technologies) > 4:
            score += 1

        # Deliverable count
        if len(deliverables) > 10:
            score += 2
        elif len(deliverables) > 5:
            score += 1

        # Complexity keywords
        high_complexity_terms = [
            'scalable', 'distributed', 'microservice', 'real-time',
            'integration', 'migration', 'architecture',
        ]
        for term in high_complexity_terms:
            if term.lower() in description.lower():
                score += 1

        # Map score to complexity
        if score <= 1:
            return Complexity.TRIVIAL
        elif score <= 3:
            return Complexity.LOW
        elif score <= 5:
            return Complexity.MEDIUM
        elif score <= 7:
            return Complexity.HIGH
        return Complexity.VERY_HIGH

    def _estimate_hours_rules(
        self,
        complexity: Complexity,
        deliverables: list[Deliverable],
    ) -> float:
        """Estimate hours based on complexity and deliverables."""
        base_hours = {
            Complexity.TRIVIAL: 8,
            Complexity.LOW: 24,
            Complexity.MEDIUM: 80,
            Complexity.HIGH: 200,
            Complexity.VERY_HIGH: 500,
        }

        hours = base_hours.get(complexity, 80)

        # Add per-deliverable estimate
        for deliv in deliverables:
            if deliv.estimated_hours > 0:
                hours += deliv.estimated_hours

        return hours

    def estimate_complexity(self, requirements: ParsedRequirements) -> Complexity:
        """
        Estimate complexity from parsed requirements.

        This is a convenience method that uses the already-computed complexity
        but could apply additional heuristics.

        Args:
            requirements: Parsed requirements.

        Returns:
            Complexity level.
        """
        return requirements.complexity
