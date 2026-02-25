# CLAUDE.md - Nanobot

> Lightweight Personal AI Assistant Framework

## Overview

Nanobot is a **Python-based AI assistant framework** that supports:
- Multiple LLM providers via LiteLLM
- Multi-platform messaging (Telegram, Slack, DingTalk, Lark, QQ)
- MCP (Model Context Protocol) integration
- Extensible skills system

## Tech Stack

| Component | Technology |
|-----------|------------|
| Language | Python 3.11+ |
| Package Manager | hatch/pip |
| AI/LLM | LiteLLM (multi-provider) |
| Validation | Pydantic v2 |
| Configuration | pydantic-settings |
| Messaging | websockets, websocket-client |
| CLI | typer |
| Testing | pytest + pytest-asyncio |
| Linting | ruff |

## Development Commands

```bash
# Install with dev dependencies
pip install -e ".[dev]"

# Install with browser support
pip install -e ".[browser]"

# Run tests
pytest

# Run tests with asyncio
pytest --asyncio-mode=auto

# Lint code
ruff check .

# Format code
ruff format .

# Run CLI
nanobot --help
```

## Project Structure

```
nanobot/
├── nanobot/
│   ├── __init__.py
│   ├── __main__.py
│   │
│   ├── agent/           # Core agent logic
│   │   └── Conversation handling, context
│   │
│   ├── bus/             # Event bus
│   │   └── Message routing
│   │
│   ├── canvas/          # Canvas/rendering
│   │
│   ├── channels/        # Platform integrations
│   │   ├── telegram/    # Telegram bot
│   │   ├── slack/       # Slack bot
│   │   ├── dingtalk/    # DingTalk bot
│   │   ├── lark/        # Lark/Feishu bot
│   │   └── qq/          # QQ bot
│   │
│   ├── cli/             # Command-line interface
│   │   └── Typer commands
│   │
│   ├── config/          # Configuration management
│   │   └── Pydantic settings
│   │
│   ├── cron/            # Scheduled tasks
│   │   └── Croniter-based scheduling
│   │
│   ├── heartbeat/       # Health monitoring
│   │
│   ├── providers/       # LLM providers
│   │   └── LiteLLM integration
│   │
│   ├── session/         # Session management
│   │
│   ├── skills/          # Agent skills
│   │   └── Extensible skill system
│   │
│   ├── templates/       # Prompt templates
│   │
│   └── utils/           # Utilities
│
├── tests/               # Test files
├── bridge/              # Bridge utilities
└── pyproject.toml       # Project configuration
```

## Supported Platforms

| Platform | Library |
|----------|---------|
| Telegram | python-telegram-bot |
| Slack | slack-sdk |
| DingTalk | dingtalk-stream |
| Lark/Feishu | lark-oapi |
| QQ | qq-botpy |

## Coding Standards

- **Python 3.11+** features allowed
- **Pydantic v2** for all models
- **Type hints required** on all functions
- **Line length**: 100 characters (ruff)
- **Async/await** where beneficial
- **Docstrings** for public APIs

```python
# Example style
from pydantic import BaseModel

class Message(BaseModel):
    """Represents a chat message."""
    content: str
    role: str = "user"

async def process_message(msg: Message) -> str:
    """Process a message and return response."""
    return f"Received: {msg.content}"
```

## Configuration

Uses `pydantic-settings` for configuration:

```python
from nanobot.config import Settings

settings = Settings()  # Loads from env vars
```

Environment variables:
- `NANOBOT_LLM_PROVIDER` - LLM provider (openai, anthropic, etc.)
- `NANOBOT_API_KEY` - API key for LLM
- `NANOBOT_TELEGRAM_TOKEN` - Telegram bot token
- `NANOBOT_SLACK_TOKEN` - Slack bot token

## Skills System

Skills are located in `nanobot/skills/`:

```python
# Example skill structure
class Skill:
    name: str
    description: str
    parameters: dict

    async def execute(self, **kwargs) -> str:
        """Execute the skill."""
        pass
```

## MCP Integration

Nanobot supports MCP (Model Context Protocol):

```python
from nanobot.providers.mcp import MCPClient

client = MCPClient()
await client.connect()
```

## Testing Strategy

- **pytest** with **pytest-asyncio**
- Tests in `tests/` directory
- Async tests use `async def test_...`

```python
# Example test
import pytest

@pytest.mark.asyncio
async def test_message_processing():
    msg = Message(content="Hello")
    result = await process_message(msg)
    assert "Hello" in result
```

## Common Tasks

### Adding a New Channel

1. Create directory in `nanobot/channels/`
2. Implement channel interface
3. Register in channel factory
4. Add configuration in `nanobot/config/`

### Adding a New Skill

1. Create skill file in `nanobot/skills/`
2. Inherit from base skill class
3. Implement `execute()` method
4. Register skill in skill registry

### Adding a New LLM Provider

1. LiteLLM supports most providers automatically
2. Add provider-specific config if needed
3. Test with `pytest tests/test_providers.py`

## Ruff Configuration

```toml
[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "N", "W"]
ignore = ["E501"]
```

## Security Considerations

- **Never commit tokens/keys** - Use environment variables
- **Validate all inputs** - Especially from external platforms
- **Sanitize user content** - Before sending to LLM
- **Rate limit** - Prevent abuse
