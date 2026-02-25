"""Markdown renderer utilities."""

from nanobot.canvas.renderer.backend import BackendRenderer
from nanobot.canvas.types import A2UIDocument


def render_document_to_markdown(document: A2UIDocument) -> str:
    """Render A2UI document to Markdown string."""
    renderer = BackendRenderer()
    return renderer.render_to_markdown(document)


async def render_document_to_image(
    document: A2UIDocument,
    format: str = "png",
    width: int = 800,
) -> bytes:
    """Render A2UI document to image bytes."""
    renderer = BackendRenderer()
    return await renderer.render_to_image(document, format, width)
