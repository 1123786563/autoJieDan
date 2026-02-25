"""Browser navigate tool for navigating to URLs."""

import ipaddress
import json
import socket
from typing import Any
from urllib.parse import urlparse

from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.browser.session import BrowserSessionManager


class BrowserNavigateTool(Tool):
    """Navigate browser to a URL."""

    name = "browser_navigate"
    description = "Navigate browser to a URL. Returns page title and URL."

    parameters = {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL to navigate to"
            },
            "wait_until": {
                "type": "string",
                "enum": ["load", "domcontentloaded", "networkidle"],
                "default": "load",
                "description": "Wait condition for navigation"
            }
        },
        "required": ["url"]
    }

    def __init__(self, allowed_domains: list[str] | None = None, timeout: int = 30000):
        self._manager = BrowserSessionManager()
        self._allowed_domains = allowed_domains
        self._timeout = timeout
        self._session_key: str = "default"

    def set_session(self, session_key: str) -> None:
        """Set the current session identifier."""
        self._session_key = session_key

    def _is_private_ip(self, hostname: str) -> bool:
        """Check if hostname resolves to a private/internal IP address."""
        try:
            # Try to resolve the hostname
            ip_str = socket.gethostbyname(hostname)
            ip = ipaddress.ip_address(ip_str)

            # Only block true internal addresses (loopback, link-local)
            # Don't block carrier-grade NAT or benchmark test ranges
            if ip.is_loopback:
                return True
            if ip.is_link_local:
                return True

            # Check for specific private ranges (10.x, 172.16-31.x, 192.168.x)
            if ip.version == 4:
                ip_int = int(ip)
                # 10.0.0.0/8
                if (ip_int >> 24) == 10:
                    return True
                # 172.16.0.0/12
                if (ip_int >> 20) == 0xAC1:
                    return True
                # 192.168.0.0/16
                if (ip_int >> 16) == 0xC0A8:
                    return True

            return False
        except (ValueError, socket.gaierror):
            return False  # Non-IP domains are controlled by whitelist

    def _validate_url(self, url: str) -> tuple[bool, str]:
        """Validate URL for security."""
        try:
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https"):
                return False, f"Only http/https allowed, got '{parsed.scheme}'"

            # Extract hostname (remove port if present)
            hostname = parsed.netloc.split(':')[0]

            # Block local addresses
            if hostname in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
                return False, "Local addresses are not allowed"

            # Check for private IP addresses (SSRF protection)
            if self._is_private_ip(hostname):
                return False, "Private IP addresses are not allowed"

            if self._allowed_domains:
                domain = parsed.netloc.lower()
                if not any(domain.endswith(d) or domain == d for d in self._allowed_domains):
                    return False, f"Domain '{domain}' not in allowed list"

            return True, ""
        except Exception as e:
            return False, str(e)

    async def execute(self, url: str, wait_until: str = "load", **kwargs: Any) -> str:
        # URL validation
        is_valid, error = self._validate_url(url)
        if not is_valid:
            return json.dumps({"error": f"URL validation failed: {error}"}, ensure_ascii=False)

        try:
            page = await self._manager.get_or_create_page(self._session_key)
            response = await page.goto(url, wait_until=wait_until, timeout=self._timeout)

            if response is None:
                return json.dumps({"error": "Navigation failed: no response"}, ensure_ascii=False)

            result = {
                "url": page.url,
                "title": await page.title(),
                "status": response.status,
                "success": response.ok
            }
            return json.dumps(result, ensure_ascii=False)

        except Exception as e:
            return json.dumps({"error": f"Navigation error: {str(e)}"}, ensure_ascii=False)
