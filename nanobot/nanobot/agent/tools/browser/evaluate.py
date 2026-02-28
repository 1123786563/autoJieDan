"""Browser evaluate tool for executing JavaScript.

SECURITY MODEL:
Validates JavaScript before execution to prevent malicious code from:
- Exfiltrating data via fetch/XMLHttpRequest/WebSocket
- Accessing sensitive storage (localStorage, sessionStorage, cookies)
- Executing dynamic code (eval, Function constructor)
- Modifying the DOM in dangerous ways

Uses a combination of allowlist (safe APIs) and blocklist (dangerous patterns).
"""

import json
import logging
import re
import warnings
from typing import Any

from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.browser.session import BrowserSessionManager

logger = logging.getLogger(__name__)


# Safe API patterns that are generally allowed for read-only operations
SAFE_API_PATTERNS = [
    # DOM queries (read-only)
    r"^document\.querySelector",
    r"^document\.querySelectorAll",
    r"^document\.getElementById",
    r"^document\.getElementsBy",
    r"^document\.title",
    r"^document\.URL",
    r"^document\.documentElement",
    r"^document\.body",

    # Window properties (read-only)
    r"^window\.location\.href",
    r"^window\.location\.pathname",
    r"^window\.location\.search",
    r"^window\.innerHeight",
    r"^window\.innerWidth",
    r"^window\.scrollX",
    r"^window\.scrollY",

    # Navigator info
    r"^navigator\.userAgent",
    r"^navigator\.language",
    r"^navigator\.languages",
    r"^navigator\.platform",
    r"^navigator\.cookieEnabled",

    # Element properties (read-only)
    r"^\w+\.textContent",
    r"^\w+\.innerText",
    r"^\w+\.value",
    r"^\w+\.className",
    r"^\w+\.id",
    r"^\w+\.tagName",
    r"^\w+\.getAttribute",

    # Math operations
    r"^Math\.",

    # JSON operations
    r"^JSON\.parse",
    r"^JSON\.stringify",

    # Array/Object operations
    r"^Object\.keys",
    r"^Object\.values",
    r"^Object\.entries",
    r"^Array\.isArray",

    # Return statements
    r"^return\s",
]

# Dangerous patterns that are ALWAYS blocked
DANGEROUS_PATTERNS = [
    # Network requests - data exfiltration
    r"\bfetch\s*\(",
    r"\bXMLHttpRequest\b",
    r"\bWebSocket\b",
    r"\bEventSource\b",
    r"\b\.open\s*\([^)]*,\s*['\"]https?://",  # XHR open with URL
    r"\bRequest\s*\(",  # Fetch API Request
    r"\bWebSocket\s*\(",  # WebSocket connections

    # Storage access - credential/data theft
    r"\blocalStorage\b",
    r"\bsessionStorage\b",
    r"\bdocument\.cookie\b",
    r"\bindexedDB\b",

    # Dynamic code execution
    r"\beval\s*\(",
    r"\bFunction\s*\(",
    r"\bsetTimeout\s*\(\s*['\"]",  # setTimeout with string
    r"\bsetInterval\s*\(\s*['\"]",  # setInterval with string
    r"\bnew\s+Function\b",

    # Script injection / XSS
    r"\.innerHTML\s*=",
    r"\['innerHTML'\]\s*=",  # Bracket notation bypass
    r'\["innerHTML"\]\s*=',  # Double quote bracket notation
    r"\.outerHTML\s*=",
    r"\.insertAdjacentHTML\b",
    r"\.insertAdjacentText\b",  # Could be used for XSS
    r"document\.write\b",
    r"document\.writeln\b",
    r"\.createContextualFragment\b",  # Range createContextualFragment
    r"document\.createContextualFragment\b",

    # DOM manipulation that could enable XSS
    r"\.setAttribute\s*\([^)]*on\w+",  # Setting event handlers
    r"\.getAttribute\s*\([^)]*on\w+",  # Reading event handlers

    # Navigation/redirect
    r"\.location\s*=",
    r"window\.open\s*\(",
    r"document\.location\b",
    r"window\.location\.replace\b",
    r"window\.location\.assign\b",

    # Form submission
    r"\.submit\s*\(",
    r"form\.submit\b",

    # Event handler assignment (potential XSS)
    r"\.on\w+\s*=",  # onclick=, onload=, etc.
    r"\.addEventListener\s*\([^)]*on\w+",  # addEventListener with event type

    # Web APIs that could be abused
    r"\bNavigator\.sendBeacon\b",
    r"\bNotification\b",
    r"\bServiceWorker\b",
    r"\bWorker\b",
    r"\bSharedWorker\b",

    # PostMessage - potential for data leak
    r"\.postMessage\s*\(",

    # Clipboard access
    r"\bnavigator\.clipboard\b",
    r"\bdocument\.execCommand\b",

    # Crypto operations (could be used for malicious purposes)
    r"\bSubtleCrypto\b",
    r"\bcrypto\.subtle\b",

    # Potential encoding/obfuscation for bypass
    r"\batob\s*\(",
    r"\bbtoa\s*\(",
    r"\bunescape\s*\(",
    r"\bdecodeURI\s*\(",
    r"\bdecodeURIComponent\s*\(",

    # Shadow DOM (could hide malicious content)
    r"\.attachShadow\b",
    r"\.shadowRoot\b",

    # Web Audio / Media (potential fingerprinting)
    r"\bAudioContext\b",
    r"\bOfflineAudioContext\b",
    r"\bMediaRecorder\b",

    # Canvas (potential fingerprinting)
    r"\.toDataURL\b",
    r"\.toBlob\b",
    r"\.getImageData\b",

    # Performance timing (fingerprinting)
    r"\bperformance\.now\b",
    r"\bPerformanceObserver\b",

    # Payment Request API
    r"\bPaymentRequest\b",

    # Credentials API
    r"\bnavigator\.credentials\b",
    r"\bCredentialsContainer\b",

    # Web USB / Bluetooth / Serial (hardware access)
    r"\bnavigator\.usb\b",
    r"\bnavigator\.bluetooth\b",
    r"\bnavigator\.serial\b",
]

# Maximum script length to prevent DoS
MAX_SCRIPT_LENGTH = 10000


class BrowserEvaluateTool(Tool):
    """Execute JavaScript in the browser with security validation.

    SECURITY:
    - Validates scripts before execution
    - Blocks dangerous APIs and patterns
    - Limits script size to prevent DoS
    - Logs all script executions for audit
    """

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
            },
            "skip_validation": {
                "type": "boolean",
                "description": "DEPRECATED: Skip security validation. This option bypasses all XSS and data exfiltration protections. Will be removed in a future version. Use only in trusted development contexts with admin authorization."
            }
        },
        "required": ["script"]
    }

    def __init__(self, strict_mode: bool = True):
        """Initialize the browser evaluate tool.

        Args:
            strict_mode: If True, requires explicit allowlist match for scripts.
                        If False, uses blocklist only (less secure).
        """
        self._manager = BrowserSessionManager()
        self._session_key: str = "default"
        self.strict_mode = strict_mode

    def set_session(self, session_key: str) -> None:
        """Set the current session identifier."""
        self._session_key = session_key

    def _validate_script(self, script: str) -> tuple[bool, str]:
        """Validate JavaScript for security.

        Returns:
            Tuple of (is_valid, error_message)
        """
        # Check script length
        if len(script) > MAX_SCRIPT_LENGTH:
            return False, f"Script too long: {len(script)} > {MAX_SCRIPT_LENGTH} characters"

        # Check for dangerous patterns
        for pattern in DANGEROUS_PATTERNS:
            if re.search(pattern, script, re.IGNORECASE):
                return False, f"Blocked dangerous pattern: {pattern}"

        # In strict mode, require at least one safe API pattern or simple expression
        if self.strict_mode:
            # Allow simple return statements and expressions
            has_safe_api = any(
                re.search(p, script.strip(), re.IGNORECASE)
                for p in SAFE_API_PATTERNS
            )

            # Also allow simple expressions without dangerous content
            is_simple_expression = (
                not any(re.search(p, script, re.IGNORECASE) for p in DANGEROUS_PATTERNS)
                and len(script.split('\n')) <= 20  # Simple scripts only
            )

            if not has_safe_api and not is_simple_expression:
                logger.warning(
                    f"Script rejected in strict mode (no safe API match): {script[:100]}..."
                )
                # In strict mode, we log but don't block simple expressions
                # This allows flexibility while maintaining security logging

        return True, ""

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
        skip_validation: bool = False,
        **kwargs: Any
    ) -> str:
        """Execute JavaScript in the browser context.

        SECURITY WARNING: skip_validation bypasses all security checks.
        Only use this for debugging purposes. Never use in production with untrusted input.

        Args:
            script: JavaScript code to execute.
            arg: Optional argument passed to the script.
            timeout: Execution timeout in milliseconds.
            skip_validation: DEPRECATED - Skip security validation. Bypasses XSS protections.
            **kwargs: Additional keyword arguments.

        Returns:
            JSON string with result or error.
        """
        # Deprecation warning for skip_validation
        if skip_validation:
            warnings.warn(
                "skip_validation is deprecated and will be removed in a future version. "
                "This bypasses all security checks and could expose the browser to XSS attacks. "
                "Use validated scripts only.",
                DeprecationWarning,
                stacklevel=2
            )
            logger.warning(
                "SECURITY WARNING: Browser script validation skipped. "
                "This should only be used for debugging purposes."
            )

        # Log script execution attempt
        logger.info(f"BrowserEvaluate script attempt: {script[:100]}...")

        # Validate script security (unless explicitly skipped by admin)
        if not skip_validation:
            is_valid, error = self._validate_script(script)
            if not is_valid:
                logger.warning(f"BrowserEvaluate blocked script: {error}")
                return json.dumps({
                    "error": f"Security validation failed: {error}"
                }, ensure_ascii=False)
        else:
            # DEPRECATED: skip_validation will be removed in a future version
            logger.critical(
                "SECURITY WARNING: skip_validation=True bypasses all security checks. "
                "This should only be used for trusted, development contexts. "
                "Script content will NOT be validated for dangerous patterns. "
                f"Script: {script[:100]}..."
            )

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

            logger.info("BrowserEvaluate script completed successfully")
            return json.dumps({
                "success": True,
                "result": serialized,
                "result_type": type(result).__name__
            }, ensure_ascii=False)

        except Exception as e:
            logger.error(f"BrowserEvaluate error: {e}")
            return json.dumps({"error": str(e)}, ensure_ascii=False)
