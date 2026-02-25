"""A2UI type system definitions."""

from enum import Enum
from typing import Any, Literal, Union

from pydantic import BaseModel, Field


class CanvasElementType(str, Enum):
    """Canvas element types."""
    TEXT = "text"
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    LIST = "list"
    TABLE = "table"
    CODE = "code"
    IMAGE = "image"
    CHART = "chart"
    CARD = "card"
    CONTAINER = "container"
    DIVIDER = "divider"


class ChartType(str, Enum):
    """Chart types."""
    LINE = "line"
    BAR = "bar"
    PIE = "pie"
    SCATTER = "scatter"
    AREA = "area"


class TextAlign(str, Enum):
    """Text alignment options."""
    LEFT = "left"
    CENTER = "center"
    RIGHT = "right"


class Style(BaseModel):
    """Style definition."""
    color: str | None = None
    background: str | None = None
    font_size: int | None = None
    font_weight: Literal["normal", "bold"] | None = None
    padding: int | None = None
    margin: int | None = None
    border_radius: int | None = None
    text_align: TextAlign | None = None


class CanvasElement(BaseModel):
    """Base class for canvas elements."""
    type: CanvasElementType
    id: str | None = None
    style: Style | None = None
    children: list["CanvasElement"] = Field(default_factory=list)


class TextElement(CanvasElement):
    """Text element."""
    type: Literal[CanvasElementType.TEXT] = CanvasElementType.TEXT
    content: str


class HeadingElement(CanvasElement):
    """Heading element."""
    type: Literal[CanvasElementType.HEADING] = CanvasElementType.HEADING
    level: Literal[1, 2, 3, 4, 5, 6] = 1
    content: str


class ParagraphElement(CanvasElement):
    """Paragraph element."""
    type: Literal[CanvasElementType.PARAGRAPH] = CanvasElementType.PARAGRAPH
    content: str


class ListItem(BaseModel):
    """List item."""
    content: str
    children: list["ListItem"] = Field(default_factory=list)


class ListElement(CanvasElement):
    """List element."""
    type: Literal[CanvasElementType.LIST] = CanvasElementType.LIST
    ordered: bool = False
    items: list[ListItem]


class TableColumn(BaseModel):
    """Table column."""
    key: str
    label: str
    width: int | None = None


class TableRow(BaseModel):
    """Table row."""
    cells: dict[str, Any]


class TableElement(CanvasElement):
    """Table element."""
    type: Literal[CanvasElementType.TABLE] = CanvasElementType.TABLE
    columns: list[TableColumn]
    rows: list[TableRow]


class CodeElement(CanvasElement):
    """Code block element."""
    type: Literal[CanvasElementType.CODE] = CanvasElementType.CODE
    language: str = "text"
    content: str


class ImageElement(CanvasElement):
    """Image element."""
    type: Literal[CanvasElementType.IMAGE] = CanvasElementType.IMAGE
    src: str
    alt: str = ""
    width: int | None = None
    height: int | None = None


class ChartSeries(BaseModel):
    """Chart data series."""
    name: str
    data: list[Any]
    color: str | None = None


class ChartElement(CanvasElement):
    """Chart element."""
    type: Literal[CanvasElementType.CHART] = CanvasElementType.CHART
    chart_type: ChartType
    labels: list[str] = Field(default_factory=list)
    series: list[ChartSeries] = Field(default_factory=list)
    title: str | None = None
    x_axis_label: str | None = None
    y_axis_label: str | None = None


class CardElement(CanvasElement):
    """Card container."""
    type: Literal[CanvasElementType.CARD] = CanvasElementType.CARD
    title: str | None = None
    footer: str | None = None


class ContainerElement(CanvasElement):
    """Generic container."""
    type: Literal[CanvasElementType.CONTAINER] = CanvasElementType.CONTAINER
    layout: Literal["flex", "grid"] = "flex"
    direction: Literal["row", "column"] = "column"
    gap: int = 16


class DividerElement(CanvasElement):
    """Divider line."""
    type: Literal[CanvasElementType.DIVIDER] = CanvasElementType.DIVIDER


# Union type for all canvas elements
AnyCanvasElement = Union[
    TextElement, HeadingElement, ParagraphElement, ListElement,
    TableElement, CodeElement, ImageElement, ChartElement,
    CardElement, ContainerElement, DividerElement
]


class A2UIDocument(BaseModel):
    """A2UI document root node."""
    version: str = "1.0"
    title: str | None = None
    elements: list[AnyCanvasElement]
    metadata: dict[str, Any] = Field(default_factory=dict)


# Update forward references
CanvasElement.model_rebuild()
ListItem.model_rebuild()
