"""RSS monitor for Upwork job feeds."""

import asyncio
import hashlib
import re
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any

import feedparser
from loguru import logger

from nanobot.config.schema import UpworkRSSConfig

from .models import BudgetInfo, UpworkProject

# Maximum number of seen project IDs to track (prevents unbounded memory growth)
MAX_SEEN_IDS = 10000


class LRUCache:
    """Fixed-size LRU cache for seen project IDs."""

    def __init__(self, max_size: int = MAX_SEEN_IDS):
        self._cache: OrderedDict[str, None] = OrderedDict()
        self._max_size = max_size

    def add(self, key: str) -> None:
        """Add a key to the cache, evicting oldest if at capacity."""
        if key in self._cache:
            # Move to end (most recently used)
            self._cache.move_to_end(key)
        else:
            self._cache[key] = None
            # Evict oldest if at capacity
            if len(self._cache) > self._max_size:
                self._cache.popitem(last=False)

    def __contains__(self, key: str) -> bool:
        """Check if key is in cache."""
        return key in self._cache

    def clear(self) -> None:
        """Clear all entries from cache."""
        self._cache.clear()

    def __len__(self) -> int:
        """Return number of entries in cache."""
        return len(self._cache)


class RSSMonitor:
    """Monitor Upwork RSS feeds for new projects."""

    def __init__(self, config: UpworkRSSConfig):
        self.config = config
        self._seen_ids: LRUCache = LRUCache()
        self._running = False
        self._on_new_project: Callable[[UpworkProject], Awaitable[None]] | None = None

    async def start(
        self, on_new_project: Callable[[UpworkProject], Awaitable[None]]
    ) -> None:
        """Start monitoring RSS feeds."""
        self._on_new_project = on_new_project
        self._running = True

        logger.info(
            "Starting RSS monitor with {} feeds, poll interval: {}s",
            len(self.config.feed_urls),
            self.config.poll_interval_seconds,
        )

        while self._running:
            try:
                await self._poll_feeds()
            except Exception as e:
                logger.error("RSS poll error: {}", e)

            await asyncio.sleep(self.config.poll_interval_seconds)

    async def stop(self) -> None:
        """Stop monitoring."""
        self._running = False
        logger.info("RSS monitor stopped")

    async def _poll_feeds(self) -> None:
        """Poll all configured feeds."""
        for feed_url in self.config.feed_urls:
            try:
                projects = await self._fetch_feed(feed_url)
                new_count = 0

                for project in projects:
                    if project.id not in self._seen_ids:
                        self._seen_ids.add(project.id)
                        new_count += 1

                        if self._on_new_project:
                            await self._on_new_project(project)

                if new_count > 0:
                    logger.info(
                        "Found {} new projects from feed",
                        new_count,
                    )

            except Exception as e:
                logger.error("Failed to fetch feed {}: {}", feed_url[:50], e)

    async def _fetch_feed(self, url: str) -> list[UpworkProject]:
        """Fetch and parse a single RSS feed."""
        # Run feedparser in thread pool since it's sync
        loop = asyncio.get_event_loop()
        feed = await loop.run_in_executor(None, feedparser.parse, url)

        if feed.bozo and feed.bozo_exception:
            logger.warning(
                "Feed parse warning for {}: {}",
                url[:50],
                feed.bozo_exception,
            )

        projects = []
        for entry in feed.entries[: self.config.max_projects_per_poll]:
            try:
                project = self._parse_entry(entry)
                if project:
                    projects.append(project)
            except Exception as e:
                logger.warning("Failed to parse entry: {}", e)

        return projects

    def _parse_entry(self, entry: Any) -> UpworkProject | None:
        """Parse RSS entry to UpworkProject."""
        if not hasattr(entry, "id") and not hasattr(entry, "link"):
            return None

        # Generate unique ID from link or content hash
        project_id = self._extract_project_id(entry)
        if not project_id:
            return None

        # Parse title
        title = getattr(entry, "title", "Untitled Project")

        # Parse description
        description = getattr(entry, "description", "")
        if hasattr(entry, "summary"):
            description = entry.summary

        # Clean HTML from description
        description = self._clean_html(description)

        # Parse budget from title or description
        budget = self._parse_budget(title, description)

        # Parse skills
        skills = self._parse_skills(entry)

        # Parse published date
        posted_at = None
        if hasattr(entry, "published_parsed") and entry.published_parsed:
            try:
                posted_at = datetime(*entry.published_parsed[:6])
            except Exception:
                pass

        # Parse link
        url = getattr(entry, "link", "")

        return UpworkProject(
            id=project_id,
            title=title,
            description=description,
            budget=budget,
            skills=skills,
            posted_at=posted_at,
            url=url,
            source="rss",
        )

    def _extract_project_id(self, entry: Any) -> str:
        """Extract unique project ID from entry."""
        link = getattr(entry, "link", "")
        if not link:
            # Generate hash from content
            content = getattr(entry, "title", "") + getattr(entry, "description", "")
            return hashlib.md5(content.encode()).hexdigest()[:16]

        # Extract ID from URL like ~0123456789abcdef
        match = re.search(r"~([a-f0-9]+)", link)
        if match:
            return match.group(1)

        # Fallback to URL hash
        return hashlib.md5(link.encode()).hexdigest()[:16]

    def _clean_html(self, text: str) -> str:
        """Remove HTML tags from text."""
        # Simple HTML stripping
        text = re.sub(r"<[^>]+>", "", text)
        text = re.sub(r"&nbsp;", " ", text)
        text = re.sub(r"&amp;", "&", text)
        text = re.sub(r"&lt;", "<", text)
        text = re.sub(r"&gt;", ">", text)
        text = re.sub(r"\s+", " ", text)
        return text.strip()

    def _parse_budget(self, title: str, description: str) -> BudgetInfo | None:
        """Parse budget information from title/description."""
        text = f"{title} {description}"

        # Hourly: "$20-50/hr" or "$20-$50/hour" - check before fixed
        hourly_match = re.search(
            r"\$(\d+(?:\.\d+)?)\s*-\s*\$?(\d+(?:\.\d+)?)\s*/\s*(?:hr|hour)",
            text,
            re.IGNORECASE,
        )
        if hourly_match:
            return BudgetInfo(
                type="hourly",
                min_amount=float(hourly_match.group(1)),
                max_amount=float(hourly_match.group(2)),
            )

        # Fixed price range: "$500-$1000" or "$1,000-$5,000" or "Budget: $500-$1000"
        fixed_range_match = re.search(
            r"\$(\d{1,6}(?:,\d{3})*(?:\.\d+)?)\s*-\s*\$(\d{1,6}(?:,\d{3})*(?:\.\d+)?)",
            text,
        )
        if fixed_range_match:
            return BudgetInfo(
                type="fixed",
                min_amount=float(fixed_range_match.group(1).replace(",", "")),
                max_amount=float(fixed_range_match.group(2).replace(",", "")),
            )

        # Single fixed price (only if not part of hourly)
        single_match = re.search(r"\$(\d{1,6}(?:,\d{3})*(?:\.\d+)?)", text)
        if single_match:
            amount = float(single_match.group(1).replace(",", ""))
            return BudgetInfo(type="fixed", min_amount=amount, max_amount=amount)

        return None

    def _parse_skills(self, entry: Any) -> list[str]:
        """Parse skills from entry tags."""
        skills = []

        # feedparser puts tags in entry.tags
        if hasattr(entry, "tags"):
            for tag in entry.tags:
                if hasattr(tag, "term") and tag.term:
                    skills.append(tag.term)
                elif hasattr(tag, "label") and tag.label:
                    skills.append(tag.label)

        return list(set(skills))  # Remove duplicates

    def clear_seen(self) -> None:
        """Clear the seen projects cache."""
        self._seen_ids.clear()
        logger.debug("Cleared seen projects cache")

    def get_seen_count(self) -> int:
        """Get the number of seen projects currently tracked."""
        return len(self._seen_ids)
