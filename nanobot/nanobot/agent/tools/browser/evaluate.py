"""Browser evaluate tool for executing JavaScript."""

import json
from typing import Any

from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.browser.session import BrowserSessionManager


class BrowserEvaluateTool(Tool):
    """Execute JavaScript in the browser."""

    name = "browser_evaluate"
    description = "Execute JavaScript code in the browser context and return the result."

    parameters = {
        "type": "object",
        "properties": {
            "script": {
                "type": "string",
                "description": "JavaScript code to execute. Use 'return' to return a value."
            },
            "arg": {
                "type": ["string", "number", "boolean", "object", "array"],
                "description": "Optional argument passed to the script (accessible as first argument)"
            },
            "timeout": {
                "type": "integer",
                "minimum": 1000,
                "maximum": 30000,
                "default": 5000
            }
        },
        "required": ["script"]
    }

    def __init__(self):
        self._manager = BrowserSessionManager()
        self._session_key: str = "default"

    def set_session(self, session_key: str) -> None:
        """Set the current session identifier."""
        self._session_key = session_key

    def _serialize_result(self, result: Any) -> Any:
        """Serialize result to JSON-compatible format."""
        if result is None:
            return None
        if isinstance(result, (str, int, float, bool)):
            return result
        if isinstance(result, (list, dict)):
            return result
        # For complex objects, try to convert to string
        try:
            return str(result)
        except Exception:
            return "<non-serializable>"

    async def execute(
        self,
        script: str,
        arg: Any = None,
        timeout: int = 5000,
        **kwargs: Any
    ) -> str:
        try:
            page = await self._manager.get_or_create_page(self._session_key)

            # Wrap script to handle both expression and statement forms
            wrapped_script = f"""
            (() => {{
                try {{
                    {script}
                }} catch (e) {{
                    return {{ __error__: e.message }};
                }}
            }})()
            """

            # Evaluate the script (timeout is handled via page.set_default_timeout)
            if arg is not None:
                result = await page.evaluate(wrapped_script, arg)
            else:
                result = await page.evaluate(wrapped_script)

            # Check for error from script
            if isinstance(result, dict) and "__error__" in result:
                return json.dumps({
                    "error": f"JavaScript error: {result['__error__']}"
                }, ensure_ascii=False)

            serialized = self._serialize_result(result)

            return json.dumps({
                "success": True,
                "result": serialized,
                "result_type": type(result).__name__
            }, ensure_ascii=False)

        except Exception as e:
            return json.dumps({"error": str(e)}, ensure_ascii=False)
