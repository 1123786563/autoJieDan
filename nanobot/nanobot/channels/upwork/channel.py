"""Upwork channel for project monitoring and bidding."""

import asyncio
from datetime import date
from typing import Any

from loguru import logger

from nanobot.bus.events import InboundMessage, OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.channels.base import BaseChannel
from nanobot.config.schema import UpworkConfig

from .api_client import UpworkAPIClient
from .models import BidProposal, BidResult, MatchResult, UpworkProject
from .rss_monitor import RSSMonitor
from .skills.bid_generator import BidGenerator
from .skills.pricing import PricingCalculator
from .skills.skill_matcher import SkillMatcher

# Maximum length of project description to show in notifications
DESCRIPTION_PREVIEW_LENGTH = 500


class UpworkChannel(BaseChannel):
    """Upwork channel for project monitoring and bidding."""

    name = "upwork"

    def __init__(self, config: UpworkConfig, bus: MessageBus, llm_client=None):
        super().__init__(config, bus)
        self.config: UpworkConfig = config

        # Initialize components
        self.rss_monitor = RSSMonitor(config.rss)
        self.api_client = UpworkAPIClient(config.api)
        self.skill_matcher = SkillMatcher(config.bidding)
        self.bid_generator = BidGenerator(config.bidding, llm_client)
        self.pricing = PricingCalculator(config.bidding)

        # Tracking
        self._bids_today: int = 0
        self._bids_today_date: date = date.today()
        self._bid_history: dict[str, BidResult] = {}
        self._project_cache: dict[str, UpworkProject] = {}
        self._monitor_task: asyncio.Task | None = None

    async def start(self) -> None:
        """Start RSS monitoring."""
        if not self.config.rss.feed_urls:
            logger.warning("No Upwork RSS feeds configured")
            return

        self._running = True
        logger.info(
            "Starting Upwork channel with {} feeds",
            len(self.config.rss.feed_urls),
        )

        # Start RSS monitor in background
        self._monitor_task = asyncio.create_task(self.rss_monitor.start(self._process_new_project))

        # Keep running
        while self._running:
            await asyncio.sleep(1)

    async def stop(self) -> None:
        """Stop all monitors and cleanup."""
        self._running = False

        if self._monitor_task:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass

        await self.rss_monitor.stop()
        await self.api_client.close()
        logger.info("Upwork channel stopped")

    async def send(self, msg: OutboundMessage) -> None:
        """Send message to Upwork client."""
        # Extract project_id and recipient from metadata
        project_id = msg.metadata.get("project_id")
        recipient_id = msg.metadata.get("client_id")

        if project_id and recipient_id and msg.content:
            success = await self.api_client.send_message(project_id, recipient_id, msg.content)
            if not success:
                logger.error(
                    "Failed to send message to client for project {}",
                    project_id,
                )
        else:
            logger.warning("Cannot send message: missing project_id or client_id in metadata")

    async def _process_new_project(self, project: UpworkProject) -> None:
        """Process a newly discovered project."""
        logger.info("New project discovered: {} - {}", project.id, project.title[:50])

        # Cache the project
        self._project_cache[project.id] = project

        # Check skill match
        match_result = self.skill_matcher.calculate_match(project)

        if not match_result.should_bid:
            logger.debug(
                "Skipping project {}: {}",
                project.id,
                match_result.reason,
            )
            return

        # Reset daily bid counter if day changed
        today = date.today()
        if self._bids_today_date != today:
            self._bids_today = 0
            self._bids_today_date = today

        # Check daily bid limit
        if self._bids_today >= self.config.bidding.max_bids_per_day:
            logger.warning(
                "Daily bid limit reached ({}/{}), skipping project {}",
                self._bids_today,
                self.config.bidding.max_bids_per_day,
                project.id,
            )
            return

        # Auto bid if enabled
        if self.config.bidding.auto_bid_enabled:
            await self._auto_bid(project, match_result)
        else:
            # Notify for manual review
            await self._notify_new_project(project, match_result)

    async def _auto_bid(
        self,
        project: UpworkProject,
        match_result: MatchResult,
    ) -> None:
        """Automatically bid on a project."""
        try:
            logger.info("Auto-bidding on project: {}", project.id)

            # Generate proposal
            proposal = await self.bid_generator.generate_proposal(project, match_result)

            # Submit bid
            result = await self.api_client.submit_bid(proposal)

            if result.success:
                self._bids_today += 1
                self._bid_history[project.id] = result
                logger.info(
                    "Bid submitted for project {}: ${:.0f}",
                    project.id,
                    proposal.bid_amount,
                )

                # Notify about successful bid
                await self._notify_bid_result(project, proposal, result)
            else:
                logger.error(
                    "Bid failed for project {}: {}",
                    project.id,
                    result.error_message,
                )

        except Exception as e:
            logger.error("Auto-bid error for project {}: {}", project.id, e)

    async def _notify_new_project(
        self,
        project: UpworkProject,
        match_result: MatchResult,
    ) -> None:
        """Notify about a new project for manual review."""
        budget_str = ""
        if project.budget:
            if project.budget.max_amount:
                budget_str = f"${project.budget.max_amount:.0f}"
                if project.budget.min_amount:
                    budget_str = f"${project.budget.min_amount:.0f} - {budget_str}"

        content = f"""🔔 New Upwork Project Match!

**{project.title}**

{project.description[:DESCRIPTION_PREVIEW_LENGTH]}...

💰 Budget: {budget_str or "Not specified"}
🎯 Match Score: {match_result.score:.0%}
✅ Matched Skills: {", ".join(match_result.matched_skills[:5]) or "General fit"}
📊 Estimated Hours: {match_result.estimated_hours:.0f}h

📎 URL: {project.url}
📝 Reason: {match_result.reason}

Reply with "bid" to submit a proposal, or "skip" to ignore."""

        msg = InboundMessage(
            channel="upwork",
            sender_id="system",
            chat_id="upwork_projects",
            content=content,
            metadata={
                "project_id": project.id,
                "project_url": project.url,
                "match_score": match_result.score,
                "type": "new_project",
            },
        )
        await self.bus.publish_inbound(msg)

    async def _notify_bid_result(
        self,
        project: UpworkProject,
        proposal: BidProposal,
        result: BidResult,
    ) -> None:
        """Notify about bid result."""
        status = "✅ Success" if result.success else "❌ Failed"
        content = f"""{status} - Upwork Bid

Project: {project.title}
Amount: ${proposal.bid_amount:.2f}
Duration: {proposal.duration_days} days
{f"Error: {result.error_message}" if not result.success else ""}"""

        msg = InboundMessage(
            channel="upwork",
            sender_id="system",
            chat_id="upwork_bids",
            content=content,
            metadata={
                "project_id": project.id,
                "bid_id": result.bid_id,
                "type": "bid_result",
            },
        )
        await self.bus.publish_inbound(msg)

    async def manual_bid(self, project_id: str) -> BidResult | None:
        """Manually submit a bid for a cached project."""
        project = self._project_cache.get(project_id)
        if not project:
            logger.warning("Project {} not found in cache", project_id)
            return None

        match_result = self.skill_matcher.calculate_match(project)
        proposal = await self.bid_generator.generate_proposal(project, match_result)

        result = await self.api_client.submit_bid(proposal)

        if result.success:
            self._bids_today += 1
            self._bid_history[project_id] = result

        return result

    def get_stats(self) -> dict[str, Any]:
        """Get channel statistics."""
        return {
            "bids_today": self._bids_today,
            "bids_today_date": str(self._bids_today_date),
            "total_bids": len(self._bid_history),
            "successful_bids": sum(1 for r in self._bid_history.values() if r.success),
            "cached_projects": len(self._project_cache),
            "running": self._running,
            "feeds_count": len(self.config.rss.feed_urls),
        }

    def get_cached_project(self, project_id: str) -> UpworkProject | None:
        """Get a cached project by ID."""
        return self._project_cache.get(project_id)
