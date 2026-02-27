"""Upwork data models."""

from datetime import datetime

from pydantic import BaseModel, Field


class BudgetInfo(BaseModel):
    """Budget information for a project."""
    type: str  # "fixed" or "hourly"
    min_amount: float | None = None
    max_amount: float | None = None
    currency: str = "USD"


class ClientInfo(BaseModel):
    """Client information."""
    id: str = ""
    name: str | None = None
    country: str | None = None
    rating: float | None = None
    reviews_count: int = 0
    verified: bool = False
    total_spent: float | None = None
    jobs_posted: int = 0
    hire_rate: float | None = None


class UpworkProject(BaseModel):
    """Upwork project/job posting."""
    id: str
    title: str
    description: str = ""
    budget: BudgetInfo | None = None
    skills: list[str] = Field(default_factory=list)
    category: str = ""
    subcategory: str = ""
    client: ClientInfo | None = None
    posted_at: datetime | None = None
    url: str = ""
    source: str = "rss"  # rss or api
    job_type: str = ""  # "fixed", "hourly", etc.


class BidProposal(BaseModel):
    """Bid proposal for a project."""
    project_id: str
    cover_letter: str
    bid_amount: float
    duration_days: int | None = None
    milestone_description: str | None = None
    created_at: datetime = Field(default_factory=datetime.now)


class BidResult(BaseModel):
    """Result of a bid submission."""
    success: bool
    project_id: str
    error_message: str | None = None
    bid_id: str | None = None
    submitted_at: datetime = Field(default_factory=datetime.now)


class MatchResult(BaseModel):
    """Result of skill matching."""
    score: float  # 0.0 - 1.0
    matched_skills: list[str] = Field(default_factory=list)
    should_bid: bool = False
    reason: str = ""
    estimated_hours: float | None = None


class ProjectNotification(BaseModel):
    """Notification about a new project."""
    project: UpworkProject
    match_result: MatchResult
    notified_at: datetime = Field(default_factory=datetime.now)
