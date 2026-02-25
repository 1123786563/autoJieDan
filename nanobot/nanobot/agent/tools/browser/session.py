"""
Browser session management for Playwright-based web automation.

This module provides a singleton BrowserSessionManager that handles:
- Lazy initialization of Playwright and browser instances
- Session isolation by session_key (e.g., "channel:chat_id")
- Automatic expiration cleanup
- Optional dependency protection (Playwright is optional)
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from playwright.async_api import Browser, BrowserContext, Page, Playwright


@dataclass
class BrowserSession:
    """Single browser session state."""

    session_key: str
    context: "BrowserContext | None" = None
    page: "Page | None" = None
    created_at: datetime = field(default_factory=datetime.now)
    last_active: datetime = field(default_factory=datetime.now)

    async def close(self) -> None:
        """Close the session and release resources."""
        if self.context:
            await self.context.close()
            self.context = None
            self.page = None


@dataclass
class BrowserConfig:
    """Browser configuration settings."""

    browser_type: str = "chromium"  # chromium, firefox, webkit
    headless: bool = True
    viewport_width: int = 1280
    viewport_height: int = 720
    user_agent: str | None = None
    locale: str = "zh-CN"
    timezone: str = "Asia/Shanghai"
    default_timeout: int = 30000  # milliseconds
    browser_args: list[str] = field(default_factory=lambda: [
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
    ])
    block_resources: list[str] = field(default_factory=list)  # e.g., ["image", "font", "stylesheet"]
    allowed_domains: list[str] = field(default_factory=list)  # empty means allow all


class BrowserSessionManager:
    """
    Browser session manager - Singleton pattern.

    Responsibilities:
    1. Manage Playwright instance lifecycle
    2. Isolate browser contexts by session_key
    3. Automatically clean up expired sessions
    4. Provide page access interface
    """

    _instance: "BrowserSessionManager | None" = None
    _lock: Any = None  # asyncio.Lock, set lazily

    def __new__(cls) -> "BrowserSessionManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._playwright: "Playwright | None" = None
        self._browser: "Browser | None" = None
        self._sessions: dict[str, BrowserSession] = {}
        self._config: BrowserConfig = BrowserConfig()
        self._session_timeout: int = 1800  # 30 minutes

    @property
    def config(self) -> BrowserConfig:
        """Get current browser configuration."""
        return self._config

    def set_config(self, config: BrowserConfig) -> None:
        """Set browser configuration."""
        self._config = config
        self._session_timeout = config.default_timeout // 1000 * 60  # Convert to seconds

    async def _get_lock(self):
        """Get or create the asyncio lock lazily."""
        if self._lock is None:
            import asyncio
            self._lock = asyncio.Lock()
        return self._lock

    async def initialize(self) -> None:
        """Initialize Playwright and browser instance (lazy loading)."""
        lock = await self._get_lock()
        async with lock:
            if self._playwright is not None:
                return

            # Import Playwright here to allow optional dependency
            try:
                from playwright.async_api import async_playwright
            except ImportError as e:
                raise ImportError(
                    "Playwright is not installed. Install it with: pip install playwright && playwright install"
                ) from e

            self._playwright = await async_playwright().start()

            # Select browser type based on configuration
            browser_type = getattr(self._playwright, self._config.browser_type)
            self._browser = await browser_type.launch(
                headless=self._config.headless,
                args=self._config.browser_args,
            )

    async def get_or_create_page(self, session_key: str) -> "Page":
        """
        Get or create a page for the given session.

        Args:
            session_key: Session identifier, format "channel:chat_id"

        Returns:
            Playwright Page instance
        """
        await self.initialize()

        if self._browser is None:
            raise RuntimeError("Browser not initialized")

        if session_key in self._sessions:
            session = self._sessions[session_key]
            session.last_active = datetime.now()
            if session.page and not session.page.is_closed():
                return session.page

        # Create new isolated context
        context = await self._browser.new_context(
            viewport={
                "width": self._config.viewport_width,
                "height": self._config.viewport_height,
            },
            user_agent=self._config.user_agent,
            locale=self._config.locale,
            timezone_id=self._config.timezone,
        )

        # Configure route rules (optional ad blocking, etc.)
        if self._config.block_resources:
            await context.route("**/*", self._route_handler)

        page = await context.new_page()
        page.set_default_timeout(self._config.default_timeout)

        session = BrowserSession(
            session_key=session_key,
            context=context,
            page=page,
        )
        self._sessions[session_key] = session

        return page

    async def _route_handler(self, route: Any) -> None:
        """Resource route handler for blocking specific resource types."""
        resource_type = route.request.resource_type
        if resource_type in self._config.block_resources:
            await route.abort()
        else:
            await route.continue_()

    async def close_session(self, session_key: str) -> bool:
        """Close a specific session."""
        session = self._sessions.pop(session_key, None)
        if session:
            await session.close()
            return True
        return False

    async def cleanup_expired(self) -> int:
        """Clean up expired sessions and return the count of cleaned sessions."""
        now = datetime.now()
        expired = [
            key
            for key, session in self._sessions.items()
            if (now - session.last_active).total_seconds() > self._session_timeout
        ]
        for key in expired:
            await self.close_session(key)
        return len(expired)

    async def shutdown(self) -> None:
        """Completely shut down the browser manager."""
        for session in list(self._sessions.values()):
            await session.close()
        self._sessions.clear()

        if self._browser:
            await self._browser.close()
            self._browser = None

        if self._playwright:
            await self._playwright.stop()
            self._playwright = None

    @classmethod
    def reset_instance(cls) -> None:
        """Reset the singleton instance (for testing purposes)."""
        if cls._instance is not None:
            cls._instance._initialized = False
            cls._instance._playwright = None
            cls._instance._browser = None
            cls._instance._sessions.clear()
            cls._instance = None
