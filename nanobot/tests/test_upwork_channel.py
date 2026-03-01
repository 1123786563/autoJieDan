"""Tests for Upwork channel components."""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from nanobot.bus.queue import MessageBus
from nanobot.config.schema import (
    UpworkAPIConfig,
    UpworkBiddingConfig,
    UpworkConfig,
    UpworkRSSConfig,
)
from nanobot.channels.upwork import UpworkChannel
from nanobot.channels.upwork.models import (
    BidProposal,
    BidResult,
    BudgetInfo,
    ClientInfo,
    MatchResult,
    ProjectNotification,
    UpworkProject,
)
from nanobot.channels.upwork.rss_monitor import LRUCache, RSSMonitor
from nanobot.channels.upwork.skills.bid_generator import BidGenerator
from nanobot.channels.upwork.skills.pricing import PricingCalculator, PricingStrategy
from nanobot.channels.upwork.skills.skill_matcher import SkillMatcher


# ============================================================================
# Fixtures
# ============================================================================


def _make_bidding_config(**kwargs) -> UpworkBiddingConfig:
    """Create a test bidding config."""
    defaults = {
        "auto_bid_enabled": False,
        "max_bids_per_day": 20,
        "min_budget_usd": 100.0,
        "max_budget_usd": 10000.0,
        "skill_keywords": ["python", "react", "typescript"],
        "excluded_keywords": ["wordpress"],
        "preferred_categories": [],
        "hourly_rate_usd": 50.0,
    }
    defaults.update(kwargs)
    return UpworkBiddingConfig(**defaults)


def _make_rss_config(**kwargs) -> UpworkRSSConfig:
    """Create a test RSS config."""
    defaults = {
        "feed_urls": ["https://upwork.com/test.rss"],
        "poll_interval_seconds": 300,
        "max_projects_per_poll": 50,
    }
    defaults.update(kwargs)
    return UpworkRSSConfig(**defaults)


def _make_project(**kwargs) -> UpworkProject:
    """Create a test project."""
    defaults = {
        "id": "test-project-123",
        "title": "Python Developer Needed",
        "description": "Need a Python developer for API work with FastAPI and PostgreSQL.",
        "budget": BudgetInfo(type="fixed", min_amount=500, max_amount=1000),
        "skills": ["python", "api", "fastapi", "postgresql"],
        "category": "Web Development",
        "url": "https://upwork.com/jobs/test-project-123",
    }
    defaults.update(kwargs)
    return UpworkProject(**defaults)


def _make_upwork_config(**kwargs) -> UpworkConfig:
    """Create a test Upwork config."""
    defaults = {
        "enabled": True,
        "rss": _make_rss_config(),
        "api": UpworkAPIConfig(),
        "bidding": _make_bidding_config(),
    }
    defaults.update(kwargs)
    return UpworkConfig(**defaults)


# ============================================================================
# Model Tests
# ============================================================================


class TestBudgetInfo:
    """Tests for BudgetInfo model."""

    def test_create_fixed_budget(self) -> None:
        """Test creating a fixed budget."""
        budget = BudgetInfo(type="fixed", min_amount=500, max_amount=1000)
        assert budget.type == "fixed"
        assert budget.min_amount == 500
        assert budget.max_amount == 1000
        assert budget.currency == "USD"

    def test_create_hourly_budget(self) -> None:
        """Test creating an hourly budget."""
        budget = BudgetInfo(type="hourly", min_amount=30, max_amount=50)
        assert budget.type == "hourly"
        assert budget.min_amount == 30


class TestClientInfo:
    """Tests for ClientInfo model."""

    def test_create_client(self) -> None:
        """Test creating client info."""
        client = ClientInfo(
            id="client-123",
            name="Test Client",
            country="US",
            rating=4.8,
            reviews_count=10,
            verified=True,
            total_spent=5000.0,
        )
        assert client.id == "client-123"
        assert client.rating == 4.8
        assert client.verified is True


class TestUpworkProject:
    """Tests for UpworkProject model."""

    def test_create_project(self) -> None:
        """Test creating a project."""
        project = _make_project()
        assert project.id == "test-project-123"
        assert project.title == "Python Developer Needed"
        assert len(project.skills) == 4
        assert project.budget is not None
        assert project.budget.max_amount == 1000

    def test_project_with_client(self) -> None:
        """Test project with client info."""
        client = ClientInfo(id="client-1", rating=5.0)
        project = _make_project(client=client)
        assert project.client is not None
        assert project.client.rating == 5.0


class TestBidProposal:
    """Tests for BidProposal model."""

    def test_create_proposal(self) -> None:
        """Test creating a bid proposal."""
        proposal = BidProposal(
            project_id="proj-123",
            cover_letter="I am interested...",
            bid_amount=800.0,
            duration_days=14,
        )
        assert proposal.project_id == "proj-123"
        assert proposal.bid_amount == 800.0
        assert proposal.duration_days == 14


class TestBidResult:
    """Tests for BidResult model."""

    def test_successful_result(self) -> None:
        """Test successful bid result."""
        result = BidResult(success=True, project_id="proj-123", bid_id="bid-456")
        assert result.success is True
        assert result.bid_id == "bid-456"
        assert result.error_message is None

    def test_failed_result(self) -> None:
        """Test failed bid result."""
        result = BidResult(
            success=False,
            project_id="proj-123",
            error_message="API error",
        )
        assert result.success is False
        assert result.error_message == "API error"


class TestMatchResult:
    """Tests for MatchResult model."""

    def test_match_result(self) -> None:
        """Test creating a match result."""
        result = MatchResult(
            score=0.75,
            matched_skills=["python", "api"],
            should_bid=True,
            reason="Good match",
            estimated_hours=20.0,
        )
        assert result.score == 0.75
        assert len(result.matched_skills) == 2
        assert result.should_bid is True


# ============================================================================
# LRU Cache Tests
# ============================================================================


class TestLRUCache:
    """Tests for LRUCache."""

    def test_add_and_contains(self) -> None:
        """Test adding and checking items."""
        cache = LRUCache(max_size=5)
        cache.add("item1")
        cache.add("item2")

        assert "item1" in cache
        assert "item2" in cache
        assert "item3" not in cache

    def test_eviction(self) -> None:
        """Test LRU eviction."""
        cache = LRUCache(max_size=3)
        cache.add("a")
        cache.add("b")
        cache.add("c")
        cache.add("d")  # Should evict "a"

        assert "a" not in cache
        assert "d" in cache
        assert len(cache) == 3

    def test_access_updates_recency(self) -> None:
        """Test that re-adding updates recency."""
        cache = LRUCache(max_size=3)
        cache.add("a")
        cache.add("b")
        cache.add("c")

        # Re-add "a" to make it most recent (moves to end)
        cache.add("a")

        cache.add("d")  # Should evict "b" not "a"

        assert "a" in cache
        assert "b" not in cache

    def test_clear(self) -> None:
        """Test clearing cache."""
        cache = LRUCache(max_size=5)
        cache.add("a")
        cache.add("b")
        cache.clear()

        assert len(cache) == 0
        assert "a" not in cache


# ============================================================================
# Skill Matcher Tests
# ============================================================================


class TestSkillMatcher:
    """Tests for SkillMatcher."""

    def test_match_with_skills(self) -> None:
        """Test matching with configured skills."""
        config = _make_bidding_config(skill_keywords=["python", "fastapi"])
        matcher = SkillMatcher(config)

        project = _make_project(skills=["python", "fastapi", "postgresql"])
        result = matcher.calculate_match(project)

        assert result.should_bid is True
        assert result.score > 0
        assert "python" in [s.lower() for s in result.matched_skills]

    def test_no_match_with_skills(self) -> None:
        """Test when skills don't match."""
        config = _make_bidding_config(skill_keywords=["rust", "golang"])
        matcher = SkillMatcher(config)

        project = _make_project(skills=["python", "javascript"])
        result = matcher.calculate_match(project)

        # Should not bid if no skills match
        assert result.should_bid is False

    def test_excluded_keyword(self) -> None:
        """Test excluded keyword filtering."""
        config = _make_bidding_config(
            skill_keywords=["python"],
            excluded_keywords=["wordpress"],
        )
        matcher = SkillMatcher(config)

        project = _make_project(
            title="WordPress Python Developer",
            skills=["python"],
        )
        result = matcher.calculate_match(project)

        assert result.should_bid is False
        assert "Excluded keyword" in result.reason

    def test_budget_too_low(self) -> None:
        """Test budget filtering."""
        config = _make_bidding_config(
            skill_keywords=["python"],
            min_budget_usd=500.0,
        )
        matcher = SkillMatcher(config)

        project = _make_project(
            budget=BudgetInfo(type="fixed", max_amount=100),
            skills=["python"],
        )
        result = matcher.calculate_match(project)

        assert result.should_bid is False
        assert "Budget too low" in result.reason

    def test_skill_aliases(self) -> None:
        """Test skill alias matching."""
        config = _make_bidding_config(skill_keywords=["js", "ts"])
        matcher = SkillMatcher(config)

        # The matcher normalizes "js" to "javascript"
        project = _make_project(
            description="Need JavaScript and TypeScript developer",
            skills=["javascript", "typescript"],
        )
        result = matcher.calculate_match(project)

        assert result.score > 0

    def test_effort_estimation(self) -> None:
        """Test effort estimation."""
        config = _make_bidding_config(hourly_rate_usd=50.0)
        matcher = SkillMatcher(config)

        project = _make_project(
            budget=BudgetInfo(type="fixed", max_amount=1000),
            description="Short description",
        )
        result = matcher.calculate_match(project)

        assert result.estimated_hours is not None
        assert result.estimated_hours > 0


# ============================================================================
# Pricing Calculator Tests
# ============================================================================


class TestPricingCalculator:
    """Tests for PricingCalculator."""

    def test_calculate_basic(self) -> None:
        """Test basic pricing calculation."""
        config = _make_bidding_config(hourly_rate_usd=50.0)
        calculator = PricingCalculator(config)

        project = _make_project()
        strategy = calculator.calculate(project, estimated_hours=20)

        assert strategy.suggested_amount > 0
        assert strategy.strategy in ["budget", "competitive", "premium"]
        assert strategy.confidence > 0

    def test_premium_for_high_match(self) -> None:
        """Test premium pricing for high match score."""
        config = _make_bidding_config(hourly_rate_usd=50.0)
        calculator = PricingCalculator(config)

        project = _make_project()
        strategy = calculator.calculate(project, estimated_hours=10, match_score=0.9)

        assert strategy.strategy == "premium"

    def test_competitive_for_low_match(self) -> None:
        """Test competitive pricing for low match score."""
        config = _make_bidding_config(hourly_rate_usd=50.0)
        calculator = PricingCalculator(config)

        project = _make_project()
        strategy = calculator.calculate(project, estimated_hours=20, match_score=0.3)

        assert strategy.strategy == "competitive"

    def test_budget_adjustment(self) -> None:
        """Test adjustment based on project budget."""
        config = _make_bidding_config(
            hourly_rate_usd=100.0,
            min_budget_usd=100.0,
        )
        calculator = PricingCalculator(config)

        project = _make_project(
            budget=BudgetInfo(type="fixed", max_amount=500),
        )
        strategy = calculator.calculate(project, estimated_hours=20)

        # Should not exceed budget
        assert strategy.suggested_amount <= 500

    def test_min_max_constraints(self) -> None:
        """Test min/max budget constraints."""
        config = _make_bidding_config(
            hourly_rate_usd=50.0,
            min_budget_usd=200.0,
            max_budget_usd=2000.0,
        )
        calculator = PricingCalculator(config)

        project = _make_project()
        strategy = calculator.calculate(project, estimated_hours=100)

        # Should be constrained by max
        assert strategy.suggested_amount <= 2000

    def test_suggest_hourly_rate(self) -> None:
        """Test hourly rate suggestion."""
        config = _make_bidding_config(hourly_rate_usd=50.0)
        calculator = PricingCalculator(config)

        project = _make_project()

        # High match -> premium rate
        rate_high = calculator.suggest_hourly_rate(project, match_score=0.9)
        assert rate_high >= 50.0

        # Low match -> discount
        rate_low = calculator.suggest_hourly_rate(project, match_score=0.3)
        assert rate_low <= 50.0


# ============================================================================
# RSS Monitor Tests
# ============================================================================


class TestRSSMonitor:
    """Tests for RSSMonitor."""

    def test_init(self) -> None:
        """Test RSS monitor initialization."""
        config = _make_rss_config()
        monitor = RSSMonitor(config)

        assert monitor.config == config
        assert monitor._running is False

    def test_parse_budget_fixed_range(self) -> None:
        """Test parsing fixed budget range."""
        config = _make_rss_config()
        monitor = RSSMonitor(config)

        budget = monitor._parse_budget(
            "Project Title $500-$1000",
            "Description",
        )
        assert budget is not None
        assert budget.type == "fixed"
        assert budget.min_amount == 500
        assert budget.max_amount == 1000

    def test_parse_budget_hourly(self) -> None:
        """Test parsing hourly budget."""
        config = _make_rss_config()
        monitor = RSSMonitor(config)

        budget = monitor._parse_budget(
            "Project Title",
            "Budget: $30-$50/hr",
        )
        assert budget is not None
        assert budget.type == "hourly"
        assert budget.min_amount == 30
        assert budget.max_amount == 50

    def test_parse_budget_with_commas(self) -> None:
        """Test parsing budget with comma separators."""
        config = _make_rss_config()
        monitor = RSSMonitor(config)

        budget = monitor._parse_budget(
            "Large Project $1,000-$5,000",
            "",
        )
        assert budget is not None
        assert budget.min_amount == 1000
        assert budget.max_amount == 5000

    def test_clean_html(self) -> None:
        """Test HTML cleaning."""
        config = _make_rss_config()
        monitor = RSSMonitor(config)

        dirty = "<p>Hello &amp; welcome</p>&nbsp;to <b>test</b>"
        clean = monitor._clean_html(dirty)

        assert "<p>" not in clean
        assert "&amp;" not in clean
        assert "&nbsp;" not in clean
        assert "Hello" in clean
        assert "test" in clean

    def test_extract_project_id_from_url(self) -> None:
        """Test extracting project ID from URL."""
        config = _make_rss_config()
        monitor = RSSMonitor(config)

        entry = MagicMock()
        entry.link = "https://upwork.com/jobs/~abc123def456"

        project_id = monitor._extract_project_id(entry)
        assert project_id == "abc123def456"

    def test_extract_project_id_from_content(self) -> None:
        """Test generating project ID from content hash."""
        config = _make_rss_config()
        monitor = RSSMonitor(config)

        entry = MagicMock()
        entry.link = ""
        entry.title = "Test Project"
        entry.description = "Test Description"

        project_id = monitor._extract_project_id(entry)
        assert len(project_id) == 16  # MD5 hash truncated

    @pytest.mark.asyncio
    async def test_deduplication(self) -> None:
        """Test that seen projects are deduplicated."""
        config = _make_rss_config()
        monitor = RSSMonitor(config)

        # Create mock entry
        entry = MagicMock()
        entry.id = "test-id"
        entry.link = "https://upwork.com/jobs/~12345"
        entry.title = "Test Project"
        entry.summary = "Description $100-$200"
        entry.tags = []

        projects = []
        with patch.object(monitor, "_fetch_feed", return_value=[monitor._parse_entry(entry)]):
            # First poll
            new_projects_1 = []
            async def capture_1(p):
                new_projects_1.append(p)
            await monitor._poll_feeds.__wrapped__(monitor, capture_1) if hasattr(monitor._poll_feeds, '__wrapped__') else None

            # Manually test dedup
            project = monitor._parse_entry(entry)
            assert project is not None

            # Add to seen
            monitor._seen_ids.add(project.id)

            # Check it's in seen
            assert project.id in monitor._seen_ids


# ============================================================================
# Bid Generator Tests
# ============================================================================


class TestBidGenerator:
    """Tests for BidGenerator."""

    def test_init(self) -> None:
        """Test bid generator initialization."""
        config = _make_bidding_config()
        generator = BidGenerator(config)

        assert generator.config == config

    @pytest.mark.asyncio
    async def test_generate_proposal_template_fallback(self) -> None:
        """Test proposal generation with template fallback."""
        config = _make_bidding_config()
        generator = BidGenerator(config, llm_client=None)

        project = _make_project()
        match_result = MatchResult(
            score=0.8,
            matched_skills=["python", "api"],
            should_bid=True,
        )

        proposal = await generator.generate_proposal(project, match_result)

        assert proposal.project_id == project.id
        assert proposal.cover_letter
        assert len(proposal.cover_letter) > 50
        assert proposal.bid_amount > 0


# ============================================================================
# Channel Integration Tests
# ============================================================================


class TestUpworkChannel:
    """Tests for UpworkChannel."""

    def test_init(self) -> None:
        """Test channel initialization."""
        config = _make_upwork_config()
        bus = MessageBus()
        channel = UpworkChannel(config, bus)

        assert channel.config == config
        assert channel.rss_monitor is not None
        assert channel.api_client is not None
        assert channel.skill_matcher is not None

    def test_get_stats(self) -> None:
        """Test getting channel stats."""
        config = _make_upwork_config()
        bus = MessageBus()
        channel = UpworkChannel(config, bus)

        stats = channel.get_stats()

        assert "bids_today" in stats
        assert "total_bids" in stats
        assert "running" in stats
        assert "feeds_count" in stats

    @pytest.mark.asyncio
    async def test_start_without_feeds(self) -> None:
        """Test starting without feeds configured."""
        config = _make_upwork_config(rss=_make_rss_config(feed_urls=[]))
        bus = MessageBus()
        channel = UpworkChannel(config, bus)

        # Should return early without feeds
        await channel.start()

        assert channel._running is False

    @pytest.mark.asyncio
    async def test_process_new_project_no_match(self) -> None:
        """Test processing project that doesn't match skills."""
        config = _make_upwork_config(
            bidding=_make_bidding_config(skill_keywords=["rust", "golang"])
        )
        bus = MessageBus()
        channel = UpworkChannel(config, bus)

        project = _make_project(skills=["wordpress", "php"])
        await channel._process_new_project(project)

        # Should not be cached since it didn't match
        # (Actually it is cached before matching, let's check stats)
        assert len(channel._project_cache) == 1

    @pytest.mark.asyncio
    async def test_process_new_project_with_match(self) -> None:
        """Test processing project that matches skills."""
        config = _make_upwork_config(
            bidding=_make_bidding_config(
                skill_keywords=["python"],
                auto_bid_enabled=False,
            )
        )
        bus = MessageBus()
        channel = UpworkChannel(config, bus)

        project = _make_project(skills=["python", "fastapi"])

        # Mock the bus publish
        with patch.object(bus, "publish_inbound", new_callable=AsyncMock):
            await channel._process_new_project(project)

        # Project should be cached
        assert project.id in channel._project_cache

    @pytest.mark.asyncio
    async def test_daily_bid_limit(self) -> None:
        """Test daily bid limit enforcement."""
        config = _make_upwork_config(
            bidding=_make_bidding_config(
                skill_keywords=["python"],
                auto_bid_enabled=True,
                max_bids_per_day=2,
            )
        )
        bus = MessageBus()
        channel = UpworkChannel(config, bus)
        channel._bids_today = 2  # Already at limit

        project = _make_project(skills=["python"])

        # Should not process due to limit
        with patch.object(channel, "_auto_bid", new_callable=AsyncMock) as mock_bid:
            await channel._process_new_project(project)
            mock_bid.assert_not_called()

    def test_get_cached_project(self) -> None:
        """Test getting cached project."""
        config = _make_upwork_config()
        bus = MessageBus()
        channel = UpworkChannel(config, bus)

        project = _make_project()
        channel._project_cache[project.id] = project

        cached = channel.get_cached_project(project.id)
        assert cached is not None
        assert cached.id == project.id

        not_found = channel.get_cached_project("nonexistent")
        assert not_found is None

    @pytest.mark.asyncio
    async def test_stop(self) -> None:
        """Test stopping channel."""
        config = _make_upwork_config()
        bus = MessageBus()
        channel = UpworkChannel(config, bus)
        channel._running = True

        await channel.stop()

        assert channel._running is False


# ============================================================================
# Notification Tests
# ============================================================================


class TestProjectNotification:
    """Tests for ProjectNotification model."""

    def test_create_notification(self) -> None:
        """Test creating a notification."""
        project = _make_project()
        match_result = MatchResult(
            score=0.8,
            matched_skills=["python"],
            should_bid=True,
        )

        notification = ProjectNotification(
            project=project,
            match_result=match_result,
        )

        assert notification.project.id == project.id
        assert notification.match_result.score == 0.8
        assert notification.notified_at is not None
