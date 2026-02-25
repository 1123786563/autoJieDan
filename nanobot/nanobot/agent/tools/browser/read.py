"""Browser read tool for reading page content."""

import json
from typing import Any

from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.browser.session import BrowserSessionManager


class BrowserReadTool(Tool):
    """Read page content as text or markdown."""

    name = "browser_read"
    description = "Read page content as text or markdown format."

    parameters = {
        "type": "object",
        "properties": {
            "format": {
                "type": "string",
                "enum": ["text", "markdown"],
                "default": "markdown",
                "description": "Output format (markdown recommended for structured content)"
            },
            "selector": {
                "type": "string",
                "description": "Optional CSS selector to read specific element"
            },
            "max_length": {
                "type": "integer",
                "minimum": 100,
                "maximum": 50000,
                "default": 10000,
                "description": "Maximum output length"
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
        format: str = "markdown",
        selector: str | None = None,
        max_length: int = 10000,
        **kwargs: Any
    ) -> str:
        try:
            page = await self._manager.get_or_create_page(self._session_key)

            if format == "markdown":
                # Convert to Markdown
                content = await self._to_markdown(page, selector)

            else:  # text
                if selector:
                    element = page.locator(selector)
                    content = await element.inner_text()
                else:
                    content = await page.inner_text("body")

            # Truncate if necessary
            truncated = len(content) > max_length
            if truncated:
                content = content[:max_length] + "\n... (truncated)"

            return json.dumps({
                "content": content,
                "format": format,
                "truncated": truncated,
                "length": len(content)
            }, ensure_ascii=False)

        except Exception as e:
            return json.dumps({"error": str(e)}, ensure_ascii=False)

    async def _to_markdown(self, page, selector: str | None) -> str:
        """Convert page to Markdown using JavaScript."""
        target = selector or "body"

        # Use page.evaluate with arg parameter (Playwright style)
        content = await page.evaluate("""
            (selector) => {
                const title = document.title;

                // Simple Markdown conversion
                const walk = (node, depth = 0) => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        return node.textContent.trim();
                    }
                    if (node.nodeType !== Node.ELEMENT_NODE) return '';

                    const tag = node.tagName.toLowerCase();
                    const children = Array.from(node.childNodes)
                        .map(c => walk(c, depth))
                        .filter(c => c)
                        .join('\\n');

                    switch (tag) {
                        case 'h1': return `# ${children}\\n\\n`;
                        case 'h2': return `## ${children}\\n\\n`;
                        case 'h3': return `### ${children}\\n\\n`;
                        case 'h4': return `#### ${children}\\n\\n`;
                        case 'p': return `${children}\\n\\n`;
                        case 'li': return `- ${children}\\n`;
                        case 'a': return `[${children}](${node.href})`;
                        case 'strong': case 'b': return `**${children}**`;
                        case 'em': case 'i': return `*${children}*`;
                        case 'code': return `\\`${children}\\``;
                        case 'pre': return `\\`\\`\\`\\n${children}\\n\\`\\`\\`\\n`;
                        case 'br': return '\\n';
                        default: return children;
                    }
                };

                const root = document.querySelector(selector);
                return `# ${title}\\n\\n` + (root ? walk(root) : '');
            }
        """, target)
        return content
