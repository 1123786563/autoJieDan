"""Browser tools for Playwright-based browser automation."""

from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.browser.click import BrowserClickTool
from nanobot.agent.tools.browser.close import BrowserCloseTool
from nanobot.agent.tools.browser.evaluate import BrowserEvaluateTool
from nanobot.agent.tools.browser.navigate import BrowserNavigateTool
from nanobot.agent.tools.browser.read import BrowserReadTool
from nanobot.agent.tools.browser.screenshot import BrowserScreenshotTool
from nanobot.agent.tools.browser.session import BrowserConfig, BrowserSessionManager
from nanobot.agent.tools.browser.type import BrowserTypeTool

__all__ = [
    "BrowserNavigateTool",
    "BrowserClickTool",
    "BrowserTypeTool",
    "BrowserReadTool",
    "BrowserScreenshotTool",
    "BrowserEvaluateTool",
    "BrowserCloseTool",
    "BrowserSessionManager",
    "BrowserConfig",
    "get_browser_tools",
]


def get_browser_tools(
    allowed_domains: list[str] | None = None,
    screenshot_dir: str | None = None,
    session_key: str = "default"
) -> list[Tool]:
    """
    Get all browser tools configured with the given options.

    Args:
        allowed_domains: List of allowed domains for navigation (None = all domains)
        screenshot_dir: Directory for saving screenshots
        session_key: Default session key for all tools

    Returns:
        List of configured browser tools.
    """
    tools: list[Tool] = [
        BrowserNavigateTool(allowed_domains=allowed_domains),
        BrowserClickTool(),
        BrowserTypeTool(),
        BrowserReadTool(),
        BrowserScreenshotTool(screenshot_dir=screenshot_dir),
        BrowserEvaluateTool(),
        BrowserCloseTool(),
    ]

    # Set session key for all tools
    for tool in tools:
        tool.set_session(session_key)

    return tools
