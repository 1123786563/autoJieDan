"""
Project Filter for Upwork Projects

Intelligent filtering and scoring of Upwork projects based on multiple criteria:
- Skill matching
- Budget range
- Project type
- Client rating
- Posting time
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Callable, Any
from enum import Enum


class Recommendation(Enum):
    """Project recommendation level"""
    ACCEPT = "accept"
    CONSIDER = "consider"
    REJECT = "reject"


@dataclass
class ScoringWeights:
    """Weights for different scoring factors"""
    skill_match: float = 0.40
    budget_fit: float = 0.25
    client_quality: float = 0.15
    freshness: float = 0.10
    competition: float = 0.10

    def validate(self) -> None:
        """Validate weights sum to approximately 1.0"""
        total = (
            self.skill_match +
            self.budget_fit +
            self.client_quality +
            self.freshness +
            self.competition
        )
        if abs(total - 1.0) > 0.01:
            raise ValueError(f"Weights must sum to 1.0, got {total}")


@dataclass
class ProjectCandidate:
    """Upwork project candidate for filtering"""
    id: str
    title: str
    description: str
    skills_required: List[str]
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    budget_type: str = "fixed"  # "fixed" or "hourly"
    currency: str = "USD"
    posted_date: Optional[datetime] = None
    deadline: Optional[datetime] = None

    # Client information
    client_id: Optional[str] = None
    client_rating: Optional[float] = None  # 1-5
    client_reviews_count: int = 0
    client_verified: bool = False
    client_total_spent: Optional[float] = None
    client_hire_rate: Optional[float] = None

    # Metadata
    proposal_count: Optional[int] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    url: str = ""


@dataclass
class ProjectScore:
    """Scoring result for a project"""
    project_id: str
    total_score: float  # 0.0 - 1.0
    recommendation: Recommendation
    factors: Dict[str, float] = field(default_factory=dict)
    matched_skills: List[str] = field(default_factory=list)
    excluded_reasons: List[str] = field(default_factory=list)
    reasoning: List[str] = field(default_factory=list)
    estimated_hours: Optional[float] = None


@dataclass
class FilterConfig:
    """Configuration for project filtering"""
    # Agent's skills
    agent_skills: List[str] = field(default_factory=lambda: [
        "typescript", "javascript", "python", "golang", "go",
        "react", "vue", "node.js", "api", "graphql"
    ])

    # Budget constraints
    min_budget_usd: float = 100.0
    max_budget_usd: float = 10000.0
    hourly_rate_usd: float = 50.0

    # Client requirements
    min_client_rating: Optional[float] = 4.0
    require_verified: bool = False

    # Project constraints
    max_proposals: Optional[int] = 30
    max_hours_estimate: Optional[float] = 100.0
    max_project_age_hours: Optional[float] = 48.0

    # Scoring weights
    weights: ScoringWeights = field(default_factory=ScoringWeights)

    # Recommendation thresholds
    accept_threshold: float = 0.55
    consider_threshold: float = 0.30


class ProjectFilter:
    """
    Filter and score Upwork projects based on multiple criteria.

    Supports chainable filtering methods for flexible project selection.
    """

    # Skill aliases for better matching
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

    def __init__(self, config: Optional[FilterConfig] = None):
        """
        Initialize the project filter.

        Args:
            config: Filter configuration, uses defaults if not provided
        """
        self.config = config or FilterConfig()
        self._normalized_skills = self._normalize_skills(self.config.agent_skills)
        self._filters: List[Callable[[ProjectCandidate], bool]] = []

    def _normalize_skills(self, skills: List[str]) -> set:
        """Normalize and expand skill list with aliases"""
        normalized = set()
        for skill in skills:
            skill_lower = skill.lower().strip()
            normalized.add(skill_lower)

            # Add alias if exists
            alias = self.SKILL_ALIASES.get(skill_lower)
            if alias:
                normalized.add(alias)

        return normalized

    def add_skill_filter(self, min_matches: int = 1) -> 'ProjectFilter':
        """
        Add skill matching filter.

        Args:
            min_matches: Minimum number of skills to match

        Returns:
            Self for chaining
        """
        def filter_fn(project: ProjectCandidate) -> bool:
            matched = self._get_matched_skills(project)
            return len(matched) >= min_matches

        self._filters.append(filter_fn)
        return self

    def add_budget_filter(self) -> 'ProjectFilter':
        """
        Add budget range filter.

        Returns:
            Self for chaining
        """
        def filter_fn(project: ProjectCandidate) -> bool:
            if project.budget_max is None:
                return True  # No budget info, don't filter out

            return (
                self.config.min_budget_usd <= project.budget_max <= self.config.max_budget_usd
            )

        self._filters.append(filter_fn)
        return self

    def add_client_filter(self) -> 'ProjectFilter':
        """
        Add client quality filter.

        Returns:
            Self for chaining
        """
        def filter_fn(project: ProjectCandidate) -> bool:
            if self.config.require_verified and not project.client_verified:
                return False

            if self.config.min_client_rating and project.client_rating:
                return project.client_rating >= self.config.min_client_rating

            return True

        self._filters.append(filter_fn)
        return self

    def add_competition_filter(self) -> 'ProjectFilter':
        """
        Add competition filter based on proposal count.

        Returns:
            Self for chaining
        """
        def filter_fn(project: ProjectCandidate) -> bool:
            if self.config.max_proposals and project.proposal_count:
                return project.proposal_count <= self.config.max_proposals
            return True

        self._filters.append(filter_fn)
        return self

    def add_freshness_filter(self) -> 'ProjectFilter':
        """
        Add freshness filter based on posting date.

        Returns:
            Self for chaining
        """
        def filter_fn(project: ProjectCandidate) -> bool:
            if not self.config.max_project_age_hours or not project.posted_date:
                return True

            age_hours = (datetime.now() - project.posted_date).total_seconds() / 3600
            return age_hours <= self.config.max_project_age_hours

        self._filters.append(filter_fn)
        return self

    def add_custom_filter(self, filter_fn: Callable[[ProjectCandidate], bool]) -> 'ProjectFilter':
        """
        Add custom filter function.

        Args:
            filter_fn: Function that returns True if project should be included

        Returns:
            Self for chaining
        """
        self._filters.append(filter_fn)
        return self

    def clear_filters(self) -> 'ProjectFilter':
        """Clear all filters."""
        self._filters = []
        return self

    def filter(self, projects: List[ProjectCandidate]) -> List[ProjectCandidate]:
        """
        Apply all active filters to project list.

        Args:
            projects: List of projects to filter

        Returns:
            Filtered list of projects
        """
        result = projects
        for filter_fn in self._filters:
            result = [p for p in result if filter_fn(p)]

        return result

    def score(self, project: ProjectCandidate) -> ProjectScore:
        """
        Calculate comprehensive score for a project.

        Args:
            project: Project to score

        Returns:
            Project score with recommendation
        """
        result = ProjectScore(
            project_id=project.id,
            total_score=0.0,
            recommendation=Recommendation.REJECT,
        )

        # Check immediate rejections
        rejection_reasons = self._check_immediate_rejections(project)
        if rejection_reasons:
            result.excluded_reasons = rejection_reasons
            result.recommendation = Recommendation.REJECT
            return result

        # Calculate individual factors
        result.factors["skill_match"] = self._calculate_skill_match(project)
        result.matched_skills = self._get_matched_skills(project)

        result.factors["budget_fit"] = self._calculate_budget_fit(project)
        result.factors["client_quality"] = self._calculate_client_quality(project)
        result.factors["freshness"] = self._calculate_freshness(project)
        result.factors["competition"] = self._calculate_competition(project)

        # Calculate weighted total
        weights = self.config.weights
        weights.validate()

        result.total_score = (
            result.factors["skill_match"] * weights.skill_match +
            result.factors["budget_fit"] * weights.budget_fit +
            result.factors["client_quality"] * weights.client_quality +
            result.factors["freshness"] * weights.freshness +
            result.factors["competition"] * weights.competition
        )

        # Determine recommendation
        result.recommendation = self._determine_recommendation(result.total_score)

        # Generate reasoning
        result.reasoning = self._generate_reasoning(project, result)

        # Estimate effort
        if project.budget_max:
            result.estimated_hours = self._estimate_effort(project)

        return result

    def batch_score(self, projects: List[ProjectCandidate]) -> List[ProjectScore]:
        """
        Score multiple projects in batch.

        Args:
            projects: List of projects to score

        Returns:
            List of project scores
        """
        return [self.score(project) for project in projects]

    def rank_projects(self, projects: List[ProjectCandidate]) -> List[ProjectCandidate]:
        """
        Rank projects by score (highest first).

        Args:
            projects: List of projects to rank

        Returns:
            Sorted list of projects
        """
        scored = [(project, self.score(project)) for project in projects]
        scored.sort(key=lambda x: x[1].total_score, reverse=True)
        return [project for project, _ in scored]

    def get_top_projects(
        self,
        projects: List[ProjectCandidate],
        n: int
    ) -> List[tuple[ProjectCandidate, ProjectScore]]:
        """
        Get top N projects with their scores.

        Args:
            projects: List of projects to rank
            n: Number of top projects to return

        Returns:
            List of (project, score) tuples
        """
        scored = [(project, self.score(project)) for project in projects]
        scored.sort(key=lambda x: x[1].total_score, reverse=True)
        return scored[:n]

    def set_weights(self, weights: ScoringWeights) -> None:
        """
        Update scoring weights.

        Args:
            weights: New weight configuration
        """
        weights.validate()
        self.config.weights = weights

    def update_config(self, **kwargs) -> None:
        """
        Update filter configuration.

        Args:
            **kwargs: Configuration parameters to update
        """
        for key, value in kwargs.items():
            if hasattr(self.config, key):
                setattr(self.config, key, value)

        # Re-normalize skills if agent_skills changed
        if "agent_skills" in kwargs:
            self._normalized_skills = self._normalize_skills(self.config.agent_skills)

    # Private methods

    def _check_immediate_rejections(self, project: ProjectCandidate) -> List[str]:
        """Check for immediate rejection criteria"""
        reasons = []

        # Budget constraints
        if project.budget_max:
            if project.budget_max < self.config.min_budget_usd:
                reasons.append(
                    f"Budget too low: ${project.budget_max} < ${self.config.min_budget_usd}"
                )
            if project.budget_max > self.config.max_budget_usd:
                reasons.append(
                    f"Budget too high: ${project.budget_max} > ${self.config.max_budget_usd}"
                )

        # Client requirements
        if self.config.min_client_rating and project.client_rating:
            if project.client_rating < self.config.min_client_rating:
                reasons.append(
                    f"Client rating too low: {project.client_rating} < {self.config.min_client_rating}"
                )

        if self.config.require_verified and not project.client_verified:
            reasons.append("Client not verified")

        # Proposal count
        if self.config.max_proposals and project.proposal_count:
            if project.proposal_count > self.config.max_proposals:
                reasons.append(
                    f"Too many proposals: {project.proposal_count} > {self.config.max_proposals}"
                )

        return reasons

    def _get_matched_skills(self, project: ProjectCandidate) -> List[str]:
        """Get list of matched skills"""
        matched = []
        project_skills = set(s.lower() for s in project.skills_required)
        project_text = f"{project.title} {project.description}".lower()

        for skill in self._normalized_skills:
            if skill in project_skills or skill in project_text:
                if skill not in matched:
                    matched.append(skill)

        return matched

    def _calculate_skill_match(self, project: ProjectCandidate) -> float:
        """Calculate skill match score (0.0 - 1.0)"""
        if not self._normalized_skills:
            return 0.5

        matched_skills = self._get_matched_skills(project)

        if not matched_skills:
            return 0.0

        # Match ratio
        match_ratio = len(matched_skills) / len(self._normalized_skills)

        # Coverage of project's required skills
        skill_coverage = 0.5
        if project.skills_required:
            skill_coverage = len(matched_skills) / max(len(project.skills_required), 1)

        # Combine: 60% match ratio, 40% coverage
        return min(1.0, match_ratio * 0.6 + skill_coverage * 0.4)

    def _calculate_budget_fit(self, project: ProjectCandidate) -> float:
        """Calculate budget fit score (0.0 - 1.0)"""
        if not project.budget_max:
            return 0.5

        # Calculate ideal fit: prefer budgets in the middle of our range
        our_range = self.config.max_budget_usd - self.config.min_budget_usd
        midpoint = self.config.min_budget_usd + our_range / 2

        distance = abs(project.budget_max - midpoint)
        fit_score = max(0, 1 - distance / our_range)

        return fit_score

    def _calculate_client_quality(self, project: ProjectCandidate) -> float:
        """Calculate client quality score (0.0 - 1.0)"""
        if not project.client_id:
            return 0.3

        score = 0.0

        # Rating
        if project.client_rating:
            score += (project.client_rating / 5.0) * 0.4
        else:
            score += 0.1

        # Verification
        if project.client_verified:
            score += 0.15

        # Total spent
        if project.client_total_spent:
            import math
            spent_score = math.log10(max(project.client_total_spent, 1)) / 5
            score += min(0.3, spent_score * 0.3)

        # Hire rate
        if project.client_hire_rate:
            score += (project.client_hire_rate / 100) * 0.15

        return min(1.0, score)

    def _calculate_freshness(self, project: ProjectCandidate) -> float:
        """Calculate project freshness score (0.0 - 1.0)"""
        if not project.posted_date:
            return 0.5

        age_hours = (datetime.now() - project.posted_date).total_seconds() / 3600

        # Fresher is better
        if age_hours < 1:
            return 1.0
        if age_hours < 6:
            return 0.9 - (age_hours - 1) * 0.05
        if age_hours < 24:
            return 0.7 - (age_hours - 6) * 0.02
        if age_hours < 72:
            return 0.5 - (age_hours - 24) * 0.01

        return 0.1

    def _calculate_competition(self, project: ProjectCandidate) -> float:
        """Calculate competition score (0.0 - 1.0, higher = less competition)"""
        if not project.proposal_count:
            return 0.5

        count = project.proposal_count

        if count <= 5:
            return 1.0
        if count <= 10:
            return 0.8 - ((count - 5) / 5) * 0.3
        if count <= 20:
            return 0.5 - ((count - 10) / 10) * 0.3
        if count <= 50:
            return 0.2 - ((count - 20) / 30) * 0.2

        return 0.0

    def _determine_recommendation(self, score: float) -> Recommendation:
        """Determine recommendation based on score"""
        if score >= self.config.accept_threshold:
            return Recommendation.ACCEPT
        if score >= self.config.consider_threshold:
            return Recommendation.CONSIDER
        return Recommendation.REJECT

    def _generate_reasoning(
        self,
        project: ProjectCandidate,
        result: ProjectScore
    ) -> List[str]:
        """Generate reasoning for the score"""
        reasoning = []

        # Skills
        if result.matched_skills:
            skills_str = ", ".join(result.matched_skills[:3])
            if len(result.matched_skills) > 3:
                skills_str += "..."
            reasoning.append(f"Matched {len(result.matched_skills)} skills: {skills_str}")

        # Budget
        if project.budget_max:
            reasoning.append(f"Budget: ${project.budget_max}")

        # Client
        if project.client_rating:
            reasoning.append(f"Client rating: {project.client_rating}/5")

        # Competition
        if project.proposal_count:
            reasoning.append(f"Proposals: {project.proposal_count}")

        return reasoning

    def _estimate_effort(self, project: ProjectCandidate) -> float:
        """Estimate project effort in hours"""
        if not project.budget_max:
            return 20.0

        hours = project.budget_max / max(self.config.hourly_rate_usd, 1)

        # Clamp between 2-200 hours
        return max(2.0, min(200.0, hours))
