"""Skill matcher for Upwork projects."""

from loguru import logger

from nanobot.config.schema import UpworkBiddingConfig

from ..models import MatchResult, UpworkProject


class SkillMatcher:
    """Match project requirements with agent skills."""

    # Common skill aliases and variations
    SKILL_ALIASES = {
        "js": "javascript",
        "ts": "typescript",
        "reactjs": "react",
        "vuejs": "vue",
        "nodejs": "node.js",
        "python3": "python",
        "golang": "go",
        "aws": "amazon web services",
        "gcp": "google cloud",
        "ai": "artificial intelligence",
        "ml": "machine learning",
        "nlp": "natural language processing",
    }

    def __init__(self, config: UpworkBiddingConfig):
        self.config = config
        self._normalize_config_skills()

    def _normalize_config_skills(self) -> None:
        """Normalize configured skills for better matching."""
        self._normalized_skills = []
        for skill in self.config.skill_keywords:
            normalized = skill.lower().strip()
            # Also add alias if exists
            if normalized in self.SKILL_ALIASES:
                self._normalized_skills.append(self.SKILL_ALIASES[normalized])
            self._normalized_skills.append(normalized)

    def calculate_match(self, project: UpworkProject) -> MatchResult:
        """Calculate skill match score and determine if should bid."""
        matched_skills: list[str] = []
        score = 0.0
        reasons: list[str] = []

        # Combine project text for matching
        project_text = f"{project.title} {project.description}".lower()
        project_skills = [s.lower() for s in project.skills]

        # Check skill keywords
        for skill in self._normalized_skills:
            # Check in project skills list
            if skill in project_skills:
                if skill not in [s.lower() for s in matched_skills]:
                    matched_skills.append(skill)
                continue

            # Check in project text
            if skill in project_text:
                if skill not in [s.lower() for s in matched_skills]:
                    matched_skills.append(skill)

        # Check excluded keywords
        for excluded in self.config.excluded_keywords:
            if excluded.lower() in project_text:
                logger.debug(
                    "Project {} excluded due to keyword: {}",
                    project.id,
                    excluded,
                )
                return MatchResult(
                    score=0.0,
                    matched_skills=matched_skills,
                    should_bid=False,
                    reason=f"Excluded keyword found: {excluded}",
                )

        # Check preferred categories
        category_match = False
        if self.config.preferred_categories:
            for cat in self.config.preferred_categories:
                if cat.lower() in project.category.lower():
                    category_match = True
                    break

        # Calculate score
        if self._normalized_skills:
            # Score based on how many of our skills match
            match_ratio = len(matched_skills) / len(self._normalized_skills)
            # Also consider project's required skills
            if project_skills:
                skill_coverage = len(matched_skills) / max(len(project_skills), 1)
                score = (match_ratio * 0.6) + (skill_coverage * 0.4)
            else:
                score = match_ratio
        else:
            # No skills configured, use category match
            score = 0.5 if category_match else 0.3

        # Boost score for category match
        if category_match:
            score = min(1.0, score * 1.2)

        # Check budget constraints
        if project.budget:
            if project.budget.max_amount:
                if project.budget.max_amount < self.config.min_budget_usd:
                    return MatchResult(
                        score=score,
                        matched_skills=matched_skills,
                        should_bid=False,
                        reason=f"Budget too low: ${project.budget.max_amount} < ${self.config.min_budget_usd}",
                    )
                if project.budget.max_amount > self.config.max_budget_usd:
                    reasons.append(f"Budget high: ${project.budget.max_amount}")

        # Estimate effort based on budget and description length
        estimated_hours = self._estimate_effort(project)

        # Determine if should bid
        should_bid = (
            score >= 0.25
            and len(matched_skills) >= 1
            and (not self.config.preferred_categories or category_match or score >= 0.5)
        )

        reason = f"Matched {len(matched_skills)} skills, score: {score:.0%}"
        if reasons:
            reason += f" ({', '.join(reasons)})"

        logger.debug(
            "Project {} match: score={:.0%}, skills={}, should_bid={}",
            project.id,
            score,
            len(matched_skills),
            should_bid,
        )

        return MatchResult(
            score=score,
            matched_skills=matched_skills,
            should_bid=should_bid,
            reason=reason,
            estimated_hours=estimated_hours,
        )

    def _estimate_effort(self, project: UpworkProject) -> float:
        """Estimate project effort in hours."""
        # Start with budget-based estimate
        if project.budget and project.budget.max_amount:
            # Assume hourly rate
            hours_from_budget = project.budget.max_amount / max(
                self.config.hourly_rate_usd, 1
            )
        else:
            hours_from_budget = 20.0  # Default

        # Adjust based on description length
        desc_length = len(project.description)
        if desc_length > 2000:
            complexity_factor = 1.5
        elif desc_length > 1000:
            complexity_factor = 1.2
        elif desc_length < 300:
            complexity_factor = 0.7
        else:
            complexity_factor = 1.0

        # Adjust based on skills count
        if len(project.skills) > 5:
            complexity_factor *= 1.2
        elif len(project.skills) > 8:
            complexity_factor *= 1.4

        estimated = hours_from_budget * complexity_factor
        return max(2.0, min(200.0, estimated))  # Clamp between 2-200 hours

    def extract_skills_from_description(self, description: str) -> list[str]:
        """Extract potential skills from project description."""
        # Common technical terms
        tech_patterns = [
            r"\b(python|javascript|typescript|react|vue|angular|node\.?js|go|golang|rust|java)\b",
            r"\b(aws|azure|gcp|docker|kubernetes|terraform)\b",
            r"\b(postgresql|mysql|mongodb|redis|elasticsearch)\b",
            r"\b(rest|graphql|grpc|api)\b",
            r"\b(machine learning|deep learning|nlp|ai|ml)\b",
        ]

        found_skills = set()
        text = description.lower()

        for pattern in tech_patterns:
            import re

            matches = re.findall(pattern, text, re.IGNORECASE)
            found_skills.update(matches)

        return list(found_skills)
