"""Browser click tool for clicking elements."""

import json
from typing import Any

from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.browser.session import BrowserSessionManager


class BrowserClickTool(Tool):
    """Click an element on the page."""

    name = "browser_click"
    description = "Click an element on the page by selector or text."

    parameters = {
        "type": "object",
        "properties": {
            "selector": {
                "type": "string",
                "description": "CSS selector or Playwright locator (e.g., 'button:has-text(\"Submit\")')"
            },
            "button": {
                "type": "string",
                "enum": ["left", "right", "middle"],
                "default": "left"
            },
            "double_click": {
                "type": "boolean",
                "default": False
            },
            "timeout": {
                "type": "integer",
                "minimum": 1000,
                "maximum": 30000,
                "default": 5000
            }
        },
        "required": ["selector"]
    }

    def __init__(self):
        self._manager = BrowserSessionManager()
        self._session_key: str = "default"

    def set_session(self, session_key: str) -> None:
        """Set the current session identifier."""
        self._session_key = session_key

    async def execute(
        self,
        selector: str,
        button: str = "left",
        double_click: bool = False,
        timeout: int = 5000,
        **kwargs: Any
    ) -> str:
        try:
            page = await self._manager.get_or_create_page(self._session_key)
            locator = page.locator(selector)

            # Wait for element to be visible
            await locator.wait_for(state="visible", timeout=timeout)

            if double_click:
                await locator.dblclick(button=button, timeout=timeout)
            else:
                await locator.click(button=button, timeout=timeout)

            return json.dumps({"success": True, "selector": selector}, ensure_ascii=False)

        except Exception as e:
            return json.dumps({"error": str(e), "selector": selector}, ensure_ascii=False)
