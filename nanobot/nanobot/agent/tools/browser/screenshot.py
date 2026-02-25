"""Browser screenshot tool for taking page screenshots."""

import json
import os
import tempfile
import time
from typing import Any

from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.browser.session import BrowserSessionManager


class BrowserScreenshotTool(Tool):
    """Take a screenshot of the page or an element."""

    name = "browser_screenshot"
    description = "Take a screenshot of the current page or a specific element."

    parameters = {
        "type": "object",
        "properties": {
            "selector": {
                "type": "string",
                "description": "Optional CSS selector to screenshot a specific element"
            },
            "full_page": {
                "type": "boolean",
                "default": False,
                "description": "Take a full page screenshot (scrolls to capture entire page)"
            },
            "format": {
                "type": "string",
                "enum": ["png", "jpeg"],
                "default": "png",
                "description": "Image format"
            },
            "timeout": {
                "type": "integer",
                "minimum": 1000,
                "maximum": 30000,
                "default": 5000
            }
        },
        "required": []
    }

    def __init__(self, screenshot_dir: str | None = None):
        self._manager = BrowserSessionManager()
        self._screenshot_dir = screenshot_dir or os.path.join(tempfile.gettempdir(), "nanobot", "screenshots")
        self._session_key: str = "default"

    def set_session(self, session_key: str) -> None:
        """Set the current session identifier."""
        self._session_key = session_key

    def _ensure_screenshot_dir(self) -> None:
        """Ensure screenshot directory exists."""
        os.makedirs(self._screenshot_dir, exist_ok=True)

    def _generate_filename(self, format: str) -> str:
        """Generate a unique filename for the screenshot."""
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        return f"screenshot_{timestamp}.{format}"

    async def execute(
        self,
        selector: str | None = None,
        full_page: bool = False,
        format: str = "png",
        timeout: int = 5000,
        **kwargs: Any
    ) -> str:
        try:
            self._ensure_screenshot_dir()
            page = await self._manager.get_or_create_page(self._session_key)

            filename = self._generate_filename(format)
            filepath = os.path.join(self._screenshot_dir, filename)

            screenshot_options = {
                "type": format,
                "timeout": timeout
            }

            if full_page and selector:
                return json.dumps({
                    "error": "Cannot use both full_page and selector together"
                }, ensure_ascii=False)

            if full_page:
                screenshot_options["full_page"] = True
                await page.screenshot(path=filepath, **screenshot_options)
            elif selector:
                locator = page.locator(selector)
                await locator.wait_for(state="visible", timeout=timeout)
                await locator.screenshot(path=filepath, type=format, timeout=timeout)
            else:
                await page.screenshot(path=filepath, **screenshot_options)

            # Get file size
            file_size = os.path.getsize(filepath)

            return json.dumps({
                "success": True,
                "path": filepath,
                "filename": filename,
                "format": format,
                "size_bytes": file_size
            }, ensure_ascii=False)

        except Exception as e:
            return json.dumps({"error": str(e)}, ensure_ascii=False)
