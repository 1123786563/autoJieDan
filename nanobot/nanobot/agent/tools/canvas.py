"""Canvas tools for A2UI document rendering."""

import hashlib
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

from nanobot.agent.tools.base import Tool
from nanobot.canvas.renderer.backend import BackendRenderer
from nanobot.canvas.types import (
    A2UIDocument,
    CanvasElementType,
    ChartElement,
    ChartSeries,
    ChartType,
)


class CanvasRenderTool(Tool):
    """Render A2UI documents."""

    name = "canvas_render"
    description = """Render a structured UI document (A2UI format).
Use this to create visualizations like charts, tables, cards, and formatted layouts.
Returns a reference to the rendered output."""

    parameters = {
        "type": "object",
        "properties": {
            "document": {
                "type": "object",
                "description": "A2UI document structure with elements array"
            },
            "format": {
                "type": "string",
                "enum": ["image", "markdown", "html"],
                "default": "image",
                "description": "Output format"
            }
        },
        "required": ["document"]
    }

    def __init__(self, output_dir: str | None = None):
        self._renderer = BackendRenderer()
        self._output_dir = output_dir or os.path.join(tempfile.gettempdir(), "nanobot", "canvas")

    async def execute(self, document: dict, format: str = "image", **kwargs: Any) -> str:
        try:
            # Parse and validate A2UI document
            a2ui_doc = A2UIDocument.model_validate(document)

            if format == "markdown":
                result = self._renderer.render_to_markdown(a2ui_doc)
                return json.dumps({"format": "markdown", "content": result}, ensure_ascii=False)

            elif format == "image":
                image_bytes = await self._renderer.render_to_image(a2ui_doc)
                # Save to file
                content_hash = hashlib.md5(image_bytes).hexdigest()[:12]
                filename = f"canvas_{int(time.time())}_{content_hash}.png"
                output_path = Path(self._output_dir) / filename
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_bytes(image_bytes)

                return json.dumps({
                    "format": "image",
                    "path": str(output_path),
                    "size": len(image_bytes)
                }, ensure_ascii=False)

            else:  # html
                html = self._renderer._generate_html(a2ui_doc, 800)
                return json.dumps({"format": "html", "content": html}, ensure_ascii=False)

        except Exception as e:
            return json.dumps({"error": str(e)}, ensure_ascii=False)


class CanvasChartTool(Tool):
    """Quick chart generation tool."""

    name = "canvas_chart"
    description = """Quick chart generation tool.
Creates common chart types without needing full A2UI structure."""

    parameters = {
        "type": "object",
        "properties": {
            "type": {
                "type": "string",
                "enum": ["line", "bar", "pie", "scatter", "area"],
                "description": "Chart type"
            },
            "title": {
                "type": "string",
                "description": "Chart title"
            },
            "labels": {
                "type": "array",
                "items": {"type": "string"},
                "description": "X-axis labels"
            },
            "series": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "data": {"type": "array", "items": {"type": "number"}}
                    },
                    "required": ["name", "data"]
                },
                "description": "Data series"
            },
            "x_axis_label": {
                "type": "string",
                "description": "X-axis label"
            },
            "y_axis_label": {
                "type": "string",
                "description": "Y-axis label"
            }
        },
        "required": ["type", "labels", "series"]
    }

    def __init__(self, render_tool: CanvasRenderTool | None = None, output_dir: str | None = None):
        self._render_tool = render_tool or CanvasRenderTool(output_dir=output_dir)

    async def execute(
        self,
        type: str,
        labels: list[str],
        series: list[dict],
        title: str | None = None,
        x_axis_label: str | None = None,
        y_axis_label: str | None = None,
        **kwargs: Any
    ) -> str:
        try:
            chart_type = ChartType(type)
            chart_series = [ChartSeries(**s) for s in series]

            chart = ChartElement(
                type=CanvasElementType.CHART,
                chart_type=chart_type,
                labels=labels,
                series=chart_series,
                title=title,
                x_axis_label=x_axis_label,
                y_axis_label=y_axis_label,
            )

            doc = A2UIDocument(
                title=title,
                elements=[chart],
            )

            return await self._render_tool.execute(document=doc.model_dump(), format="image")

        except Exception as e:
            return json.dumps({"error": str(e)}, ensure_ascii=False)
