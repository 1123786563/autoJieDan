"""Browser type tool for typing text into elements."""

import json
from typing import Any

from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.browser.session import BrowserSessionManager


class BrowserTypeTool(Tool):
    """Type text into an element on the page."""

    name = "browser_type"
    description = "Type text into an input element. Supports fill (replace) or type (append) modes."

    parameters = {
        "type": "object",
        "properties": {
            "selector": {
                "type": "string",
                "description": "CSS selector for the input element"
            },
            "text": {
                "type": "string",
                "description": "Text to type into the element"
            },
            "mode": {
                "type": "string",
                "enum": ["fill", "type"],
                "default": "fill",
                "description": "'fill' replaces content, 'type' appends character by character"
            },
            "submit": {
                "type": "boolean",
                "default": False,
                "description": "Press Enter after typing"
            },
            "slowly": {
                "type": "boolean",
                "default": False,
                "description": "Type slowly to trigger key handlers (only for 'type' mode)"
            },
            "timeout": {
                "type": "integer",
                "minimum": 1000,
                "maximum": 30000,
                "default": 5000
            }
        },
        "required": ["selector", "text"]
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
        text: str,
        mode: str = "fill",
        submit: bool = False,
        slowly: bool = False,
        timeout: int = 5000,
        **kwargs: Any
    ) -> str:
        try:
            page = await self._manager.get_or_create_page(self._session_key)
            locator = page.locator(selector)

            # Wait for element to be visible
            await locator.wait_for(state="visible", timeout=timeout)

            if mode == "fill":
                await locator.fill(text, timeout=timeout)
            else:
                # Type mode - character by character
                await locator.type(text, delay=50 if slowly else 0, timeout=timeout)

            # Optionally submit by pressing Enter
            if submit:
                await locator.press("Enter")

            return json.dumps({
                "success": True,
                "selector": selector,
                "text_length": len(text),
                "mode": mode
            }, ensure_ascii=False)

        except Exception as e:
            return json.dumps({"error": str(e), "selector": selector}, ensure_ascii=False)
