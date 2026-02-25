"""Backend renderer for A2UI documents."""

import ipaddress
import json
import socket
from urllib.parse import urlparse

from nanobot.canvas.types import (
    A2UIDocument,
    AnyCanvasElement,
    CardElement,
    ChartElement,
    ChartType,
    CodeElement,
    ContainerElement,
    DividerElement,
    HeadingElement,
    ImageElement,
    ListElement,
    ListItem,
    ParagraphElement,
    TableElement,
    TextElement,
)


class BackendRenderer:
    """
    Backend renderer - converts A2UI to images or markdown.

    Use cases:
    - Channels without frontend support (email, some IM)
    - Report export
    - Preview generation
    """

    def _validate_image_url(self, url: str) -> tuple[bool, str]:
        """Validate image URL for security (SSRF protection)."""
        try:
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https"):
                return False, f"Only http/https allowed, got '{parsed.scheme}'"

            hostname = parsed.netloc.split(':')[0]

            # Block local addresses
            if hostname in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
                return False, "Local addresses blocked"

            # Check for private IP addresses
            try:
                ip = ipaddress.ip_address(socket.gethostbyname(hostname))
                if ip.is_private or ip.is_loopback or ip.is_link_local:
                    return False, "Private IP addresses blocked"
            except (ValueError, socket.gaierror):
                pass  # Non-IP domains are allowed

            return True, ""
        except Exception as e:
            return False, str(e)

    async def render_to_image(
        self,
        document: A2UIDocument,
        format: str = "png",
        width: int = 800,
    ) -> bytes:
        """
        Render A2UI document to image.

        Uses Playwright headless browser for server-side rendering.
        """
        # 1. Generate HTML
        html = self._generate_html(document, width)

        # 2. Use Playwright screenshot
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            raise RuntimeError(
                "Playwright is required for image rendering. "
                "Install with: pip install playwright && playwright install"
            )

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page(viewport={"width": width, "height": 600})
            await page.set_content(html, wait_until="networkidle")

            # Wait for charts to render
            await page.wait_for_timeout(500)

            # Take full page screenshot
            screenshot = await page.screenshot(
                type=format,
                full_page=True,
            )
            await browser.close()

        return screenshot

    def render_to_markdown(self, document: A2UIDocument) -> str:
        """Convert A2UI document to Markdown (fallback rendering)."""
        lines = []

        if document.title:
            lines.append(f"# {document.title}\n")

        for element in document.elements:
            lines.append(self._element_to_markdown(element))

        return "\n".join(lines)

    def _generate_html(self, document: A2UIDocument, width: int) -> str:
        """Generate HTML string."""
        elements_html = "\n".join(
            self._element_to_html(el) for el in document.elements
        )

        title = document.title or "A2UI Document"

        return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{title}</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: {width}px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
            color: #333;
            background: #fff;
        }}
        h1, h2, h3, h4, h5, h6 {{
            margin-top: 24px;
            margin-bottom: 16px;
            font-weight: 600;
            line-height: 1.25;
        }}
        h1 {{ font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: .3em; }}
        h2 {{ font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: .3em; }}
        h3 {{ font-size: 1.25em; }}
        h4 {{ font-size: 1em; }}
        h5 {{ font-size: 0.875em; }}
        h6 {{ font-size: 0.85em; color: #6a737d; }}
        .card {{
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 16px;
            margin: 16px 0;
            background: #fafafa;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }}
        .card-title {{
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 12px;
            color: #333;
        }}
        .card-footer {{
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid #e0e0e0;
            font-size: 14px;
            color: #666;
        }}
        table {{
            border-collapse: collapse;
            width: 100%;
            margin: 16px 0;
        }}
        th, td {{
            border: 1px solid #ddd;
            padding: 8px 12px;
            text-align: left;
        }}
        th {{
            background: #f5f5f5;
            font-weight: 600;
        }}
        tr:nth-child(even) {{
            background: #fafafa;
        }}
        pre {{
            background: #f6f8fa;
            padding: 16px;
            border-radius: 6px;
            overflow-x: auto;
            border: 1px solid #e1e4e8;
        }}
        code {{
            font-family: 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
            font-size: 14px;
        }}
        .chart-container {{
            width: 100%;
            height: 400px;
            margin: 16px 0;
        }}
        .divider {{
            border: none;
            border-top: 1px solid #e1e4e8;
            margin: 24px 0;
        }}
        .container {{
            display: flex;
            gap: 16px;
            margin: 16px 0;
        }}
        .container.column {{
            flex-direction: column;
        }}
        .container.row {{
            flex-direction: row;
        }}
        img {{
            max-width: 100%;
            height: auto;
            border-radius: 4px;
        }}
        ul, ol {{
            padding-left: 2em;
            margin: 16px 0;
        }}
        li {{
            margin: 4px 0;
        }}
    </style>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
</head>
<body>
    {elements_html}
</body>
</html>"""

    def _element_to_html(self, element: AnyCanvasElement) -> str:
        """Convert single element to HTML."""
        element_type = element.type

        if isinstance(element, TextElement):
            style = self._style_to_css(element.style)
            return f'<p style="{style}">{self._escape_html(element.content)}</p>'

        elif isinstance(element, HeadingElement):
            tag = f"h{element.level}"
            style = self._style_to_css(element.style)
            return f'<{tag} style="{style}">{self._escape_html(element.content)}</{tag}>'

        elif isinstance(element, ParagraphElement):
            style = self._style_to_css(element.style)
            return f'<p style="{style}">{self._escape_html(element.content)}</p>'

        elif isinstance(element, ListElement):
            tag = "ol" if element.ordered else "ul"
            items_html = self._list_items_to_html(element.items)
            return f'<{tag}>{items_html}</{tag}>'

        elif isinstance(element, TableElement):
            return self._table_to_html(element)

        elif isinstance(element, CodeElement):
            return f'<pre><code class="language-{element.language}">{self._escape_html(element.content)}</code></pre>'

        elif isinstance(element, ImageElement):
            # Validate image URL for SSRF protection
            is_valid, error = self._validate_image_url(element.src)
            if not is_valid:
                return f'<!-- Image blocked: {self._escape_html(error)} -->'
            width_attr = f' width="{element.width}"' if element.width else ""
            height_attr = f' height="{element.height}"' if element.height else ""
            return f'<img src="{element.src}" alt="{self._escape_html(element.alt)}"{width_attr}{height_attr}>'

        elif isinstance(element, ChartElement):
            return self._chart_to_html(element)

        elif isinstance(element, CardElement):
            title_html = f'<div class="card-title">{self._escape_html(element.title)}</div>' if element.title else ""
            footer_html = f'<div class="card-footer">{self._escape_html(element.footer)}</div>' if element.footer else ""
            children_html = "".join(self._element_to_html(child) for child in element.children)
            return f'<div class="card">{title_html}{children_html}{footer_html}</div>'

        elif isinstance(element, ContainerElement):
            children_html = "".join(self._element_to_html(child) for child in element.children)
            direction = element.direction
            return f'<div class="container {direction}">{children_html}</div>'

        elif isinstance(element, DividerElement):
            return '<hr class="divider">'

        # Fallback for unknown types
        return f'<!-- Unknown element type: {element_type} -->'

    def _style_to_css(self, style) -> str:
        """Convert Style object to CSS string."""
        if not style:
            return ""

        css_parts = []
        if style.color:
            css_parts.append(f"color: {style.color}")
        if style.background:
            css_parts.append(f"background: {style.background}")
        if style.font_size:
            css_parts.append(f"font-size: {style.font_size}px")
        if style.font_weight:
            css_parts.append(f"font-weight: {style.font_weight}")
        if style.padding is not None:
            css_parts.append(f"padding: {style.padding}px")
        if style.margin is not None:
            css_parts.append(f"margin: {style.margin}px")
        if style.border_radius is not None:
            css_parts.append(f"border-radius: {style.border_radius}px")
        if style.text_align:
            css_parts.append(f"text-align: {style.text_align.value}")

        return "; ".join(css_parts)

    def _escape_html(self, text: str) -> str:
        """Escape HTML special characters."""
        return (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&#39;")
        )

    def _list_items_to_html(self, items: list[ListItem]) -> str:
        """Convert list items to HTML."""
        html_parts = []
        for item in items:
            content = self._escape_html(item.content)
            if item.children:
                children_html = self._list_items_to_html(item.children)
                html_parts.append(f"<li>{content}<ul>{children_html}</ul></li>")
            else:
                html_parts.append(f"<li>{content}</li>")
        return "".join(html_parts)

    def _table_to_html(self, table: TableElement) -> str:
        """Convert table element to HTML."""
        # Header
        header_cells = "".join(
            f'<th style="width: {col.width}px">{self._escape_html(col.label)}</th>'
            if col.width else f"<th>{self._escape_html(col.label)}</th>"
            for col in table.columns
        )
        header = f"<tr>{header_cells}</tr>"

        # Body
        rows_html = []
        for row in table.rows:
            cells = []
            for col in table.columns:
                value = row.cells.get(col.key, "")
                cells.append(f"<td>{self._escape_html(str(value))}</td>")
            rows_html.append(f"<tr>{''.join(cells)}</tr>")

        return f"<table><thead>{header}</thead><tbody>{''.join(rows_html)}</tbody></table>"

    def _chart_to_html(self, chart: ChartElement) -> str:
        """Convert chart element to HTML with ECharts."""
        chart_id = f"chart_{id(chart)}"

        # Build ECharts option
        option = {
            "title": {"text": chart.title} if chart.title else {},
            "tooltip": {"trigger": "axis" if chart.chart_type != ChartType.PIE else "item"},
            "legend": {"data": [s.name for s in chart.series]},
            "xAxis": {"type": "category", "data": chart.labels, "name": chart.x_axis_label} if chart.chart_type != ChartType.PIE else {},
            "yAxis": {"type": "value", "name": chart.y_axis_label} if chart.chart_type != ChartType.PIE else {},
            "series": [],
        }

        chart_type = chart.chart_type.value
        for series in chart.series:
            series_data = {
                "name": series.name,
                "type": chart_type,
                "data": series.data,
            }
            if series.color:
                series_data["itemStyle"] = {"color": series.color}
            if chart_type == "area":
                series_data["type"] = "line"
                series_data["areaStyle"] = {}
            option["series"].append(series_data)

        # For pie charts, restructure the data
        if chart.chart_type == ChartType.PIE and chart.labels and chart.series:
            pie_data = []
            for i, label in enumerate(chart.labels):
                value = chart.series[0].data[i] if i < len(chart.series[0].data) else 0
                pie_data.append({"name": label, "value": value})
            option["series"] = [{
                "name": chart.series[0].name if chart.series else "Data",
                "type": "pie",
                "radius": "50%",
                "data": pie_data,
            }]
            option["xAxis"] = {}
            option["yAxis"] = {}

        option_json = json.dumps(option, ensure_ascii=False)

        return f"""<div id="{chart_id}" class="chart-container"></div>
<script>
    (function() {{
        var chart = echarts.init(document.getElementById('{chart_id}'));
        chart.setOption({option_json});
    }})();
</script>"""

    def _element_to_markdown(self, element: AnyCanvasElement) -> str:
        """Convert single element to Markdown."""
        if isinstance(element, HeadingElement):
            prefix = "#" * element.level
            return f"{prefix} {element.content}\n"

        elif isinstance(element, TextElement):
            return f"{element.content}\n"

        elif isinstance(element, ParagraphElement):
            return f"{element.content}\n"

        elif isinstance(element, ListElement):
            lines = []
            self._list_items_to_markdown(element.items, lines, 0, element.ordered)
            return "\n".join(lines) + "\n"

        elif isinstance(element, TableElement):
            return self._table_to_markdown(element)

        elif isinstance(element, CodeElement):
            return f"```{element.language}\n{element.content}\n```\n"

        elif isinstance(element, ImageElement):
            return f"![{element.alt}]({element.src})\n"

        elif isinstance(element, ChartElement):
            # Chart as text representation
            lines = [f"**{element.title}**" if element.title else "**Chart**"]
            for series in element.series:
                lines.append(f"- {series.name}: {series.data}")
            return "\n".join(lines) + "\n"

        elif isinstance(element, CardElement):
            lines = []
            if element.title:
                lines.append(f"### {element.title}")
            for child in element.children:
                lines.append(self._element_to_markdown(child).strip())
            if element.footer:
                lines.append(f"*{element.footer}*")
            return "\n".join(lines) + "\n"

        elif isinstance(element, ContainerElement):
            return "\n".join(
                self._element_to_markdown(child).strip()
                for child in element.children
            ) + "\n"

        elif isinstance(element, DividerElement):
            return "---\n"

        return ""

    def _list_items_to_markdown(
        self,
        items: list[ListItem],
        lines: list[str],
        level: int,
        ordered: bool
    ) -> None:
        """Convert list items to Markdown recursively."""
        indent = "  " * level
        for i, item in enumerate(items):
            prefix = f"{i + 1}." if ordered else "-"
            lines.append(f"{indent}{prefix} {item.content}")
            if item.children:
                self._list_items_to_markdown(item.children, lines, level + 1, ordered)

    def _table_to_markdown(self, table: TableElement) -> str:
        """Convert table element to Markdown."""
        if not table.columns:
            return ""

        # Header
        header = "| " + " | ".join(col.label for col in table.columns) + " |"
        separator = "| " + " | ".join("---" for _ in table.columns) + " |"

        # Rows
        rows = []
        for row in table.rows:
            cells = [str(row.cells.get(col.key, "")) for col in table.columns]
            rows.append("| " + " | ".join(cells) + " |")

        return "\n".join([header, separator] + rows) + "\n"
