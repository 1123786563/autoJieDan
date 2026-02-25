"""Browser close tool for closing browser sessions."""

import json
from typing import Any

from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.browser.session import BrowserSessionManager


class BrowserCloseTool(Tool):
    """Close the browser page or session."""

    name = "browser_close"
    description = "Close the current browser page or the entire browser session."

    parameters = {
        "type": "object",
        "properties": {
            "close_all": {
                "type": "boolean",
                "default": False,
                "description": "If true, close entire browser and all pages; if false, close only current page"
            }
        },
        "required": []
    }

    def __init__(self):
        self._manager = BrowserSessionManager()
        self._session_key: str = "default"

    def set_session(self, session_key: str) -> None:
        """Set the current session identifier."""
        self._session_key = session_key

    async def execute(
        self,
        close_all: bool = False,
        **kwargs: Any
    ) -> str:
        try:
            if close_all:
                # Close entire browser
                await self._manager.shutdown()
                return json.dumps({
                    "success": True,
                    "action": "closed_all",
                    "message": "Browser and all pages closed"
                }, ensure_ascii=False)
            else:
                # Close only the current session
                closed = await self._manager.close_session(self._session_key)
                if closed:
                    return json.dumps({
                        "success": True,
                        "action": "closed_session",
                        "session_key": self._session_key,
                        "message": f"Session '{self._session_key}' closed"
                    }, ensure_ascii=False)
                else:
                    return json.dumps({
                        "success": False,
                        "action": "closed_session",
                        "session_key": self._session_key,
                        "message": f"No session found for '{self._session_key}'"
                    }, ensure_ascii=False)

        except Exception as e:
            return json.dumps({"error": str(e)}, ensure_ascii=False)
