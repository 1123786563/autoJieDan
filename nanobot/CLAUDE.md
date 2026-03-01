# Nanobot - Python AI Assistant Framework

> 轻量级个人 AI 助手框架，支持多平台和多 LLM 提供商

## Overview

Nanobot 是一个基于 Python 的 AI 助手框架，支持：
- **多平台支持**: Telegram, Slack, Discord, WhatsApp, 钉钉, 飞书, QQ 等
- **多 LLM 提供商**: OpenAI, Anthropic, Google, 本地模型等 (通过 LiteLLM)
- **MCP 协议**: Model Context Protocol 支持
- **技能系统**: 可扩展的插件架构
- **异步处理**: 高性能异步 I/O

## Project Structure

```
nanobot/
├── nanobot/
│   ├── agent/           # 代理核心
│   │   ├── agent.py     # 主代理类
│   │   ├── context.py   # 上下文管理
│   │   └── memory.py    # 记忆系统
│   ├── anp/             # ANP 协议实现
│   ├── bus/             # 消息总线
│   ├── canvas/          # 画布/工作区
│   ├── channels/        # 平台集成
│   │   ├── telegram.py  # Telegram 频道
│   │   ├── slack.py     # Slack 频道
│   │   └── discord.py   # Discord 频道
│   ├── cli/             # 命令行接口
│   ├── config/          # 配置管理
│   ├── cron/            # 定时任务
│   ├── dev/             # 开发工具
│   ├── heartbeat/       # 心跳检测
│   ├── interagent/      # ANP 桥接 (与 Automaton 通信)
│   ├── orchestration/   # 任务编排
│   ├── providers/       # LLM 提供商
│   │   └── litellm_provider.py
│   ├── session/         # 会话管理
│   ├── skills/          # 代理技能
│   │   └── skill_loader.py
│   ├── templates/       # 模板文件
│   └── utils/           # 工具函数
├── tests/               # 测试文件
├── pyproject.toml       # 项目配置
└── constraints.txt      # 依赖约束
```

## Setup & Installation

### Prerequisites

- Python 3.11+
- pip 或 hatch

### Installation

```bash
cd nanobot

# 开发安装 (推荐)
pip install -e ".[dev]"

# 或使用 hatch
hatch env create
```

### Development

```bash
# 运行测试
pytest

# 详细输出
pytest -v

# 覆盖率报告
pytest --cov=nanobot

# 代码检查
ruff check .

# 自动修复
ruff check . --fix

# 格式化
ruff format .
```

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────┐
│                      Nanobot                            │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │    Channels     │  │         Providers           │  │
│  │ - Telegram      │  │ - LiteLLM (多 LLM)          │  │
│  │ - Slack         │  │ - OpenAI, Anthropic, etc.   │  │
│  │ - Discord       │  └─────────────────────────────┘  │
│  │ - 钉钉/飞书/QQ   │                                   │
│  └────────┬────────┘                                   │
│           │                                            │
│  ┌────────▼────────┐  ┌─────────────────────────────┐  │
│  │   Agent Core    │  │      Bridge (ANP)           │  │
│  │ - 上下文管理     │  │ - WebSocket 客户端          │  │
│  │ - 记忆系统       │◄─┤ - HMAC 认证                 │  │
│  │ - 技能调度       │  │ - 与 Automaton 通信         │  │
│  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Key Modules

| 模块 | 职责 |
|------|------|
| `agent/` | 代理核心逻辑、上下文管理、记忆系统 |
| `anp/` | ANP 协议实现、去中心化身份 |
| `bus/` | 消息总线、事件分发 |
| `channels/` | 各平台的消息收发、事件处理 |
| `cron/` | 定时任务调度 |
| `interagent/` | ANP 桥接、与 Automaton 通信 |
| `orchestration/` | 任务编排、工作流 |
| `providers/` | LLM 提供商抽象、LiteLLM 集成 |
| `session/` | 会话管理、状态保持 |
| `skills/` | 技能加载、执行、生命周期管理 |

## Tech Stack

| 类别 | 技术 |
|------|------|
| **运行时** | Python 3.11+ |
| **包管理** | pip / hatch |
| **LLM** | LiteLLM (多提供商支持) |
| **验证** | Pydantic v2 |
| **协议** | MCP (Model Context Protocol) |
| **异步** | asyncio, websockets, httpx |
| **测试** | pytest + pytest-asyncio |
| **代码质量** | ruff |
| **日志** | loguru |
| **CLI** | typer, rich |

## Coding Standards

### Python 规范

```python
# 使用类型提示
from typing import Optional
from pydantic import BaseModel

class Message(BaseModel):
    """消息模型"""
    content: str
    sender: str
    timestamp: float

# 优先使用 async/await
async def process_message(message: Message) -> Optional[str]:
    """处理消息并返回响应"""
    result = await llm_client.generate(message.content)
    return result
```

### 文件命名

- 模块文件: `snake_case.py` (如 `skill_loader.py`)
- 类名: `PascalCase` (如 `SkillLoader`)
- 测试文件: `test_*.py` (如 `test_agent.py`)

### 错误处理

```python
from nanobot.exceptions import NanobotError

class ChannelError(NanobotError):
    """频道相关错误"""
    pass

# 始终处理异常
try:
    response = await channel.send_message(message)
except ChannelError as e:
    logger.error(f"Failed to send message: {e}")
    raise
```

## Testing Requirements

### 测试命令

```bash
pytest                    # 运行所有测试
pytest -v                 # 详细输出
pytest --cov=nanobot      # 覆盖率报告
pytest tests/test_agent/  # 运行特定目录
pytest -k "test_send"     # 运行匹配的测试
```

### 测试规范

```python
import pytest
from nanobot.agent import Agent

@pytest.fixture
def agent():
    """创建测试用的代理实例"""
    return Agent(config={"test_mode": True})

@pytest.mark.asyncio
async def test_agent_process_message(agent):
    """测试代理消息处理"""
    message = Message(content="Hello", sender="user", timestamp=0)
    response = await agent.process(message)
    assert response is not None
```

### 覆盖率要求

- 行覆盖率: 80%+
- 关键模块: 90%+

## Channels

### 支持的平台

| 平台 | 依赖 | 状态 |
|------|------|------|
| Telegram | python-telegram-bot | ✅ |
| Slack | slack-sdk | ✅ |
| Discord | (待实现) | 🚧 |
| 钉钉 | dingtalk-stream | ✅ |
| 飞书 | lark-oapi | ✅ |
| QQ | qq-botpy | ✅ |

### 添加新频道

```python
from nanobot.channels.base import BaseChannel

class MyChannel(BaseChannel):
    async def start(self):
        """启动频道"""
        pass

    async def send_message(self, message: str):
        """发送消息"""
        pass

    async def stop(self):
        """停止频道"""
        pass
```

## Skills System

### 技能结构

```
skills/
└── my_skill/
    ├── __init__.py
    ├── skill.py          # 技能主逻辑
    └── skill.md          # 技能描述
```

### 创建技能

```python
from nanobot.skills import Skill

class MySkill(Skill):
    name = "my_skill"
    description = "我的自定义技能"

    async def execute(self, context):
        """执行技能"""
        return {"result": "success"}
```

## Interagent Communication (Bridge)

### ANP 桥接配置

```bash
# 环境变量
INTERAGENT_SECRET=your-hmac-secret
AUTOMATON_WS_URL=ws://localhost:18791
```

### 使用 Interagent

```python
from nanobot.interagent import ANPBridge

async with ANPBridge(config) as bridge:
    # 发送消息到 Automaton
    await bridge.send({
        "type": "task",
        "payload": {"action": "analyze", "data": "..."}
    })

    # 接收消息
    async for message in bridge.receive():
        await handle_message(message)
```

## Common Commands

```bash
# 开发
pip install -e ".[dev]"     # 安装开发依赖
nanobot                     # 启动 CLI

# 测试
pytest                      # 运行测试
pytest --cov=nanobot        # 覆盖率
pytest -x                   # 首次失败停止

# 代码质量
ruff check .                # 检查
ruff check . --fix          # 自动修复
ruff format .               # 格式化

# 安全
pip-audit                   # 检查依赖漏洞
```

## Environment Variables

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NANOBOT_HTTP_PORT` | HTTP 端口 | 18792 |
| `INTERAGENT_SECRET` | HMAC 认证密钥 | (必需) |
| `OPENAI_API_KEY` | OpenAI API 密钥 | (必需) |
| `LOG_LEVEL` | 日志级别 | INFO |
| `DATABASE_URL` | 数据库 URL | (可选) |

## Debugging

```bash
# 启用调试日志
LOG_LEVEL=DEBUG python -m nanobot

# 使用 rich 日志
RICH_TRACEBACK=1 python -m nanobot
```

## Security Notes

- 查看 [SECURITY.md](./SECURITY.md) 了解安全策略
- 使用 `constraints.txt` 管理有 CVE 的间接依赖
- 定期运行 `pip-audit` 检查漏洞

## Related Documentation

- [根目录 CLAUDE.md](../CLAUDE.md) - 项目总览
- [Automaton 开发指南](../automaton/CLAUDE.md) - TypeScript 模块
- [README.md](./README.md) - Nanobot 详细文档
- [SECURITY.md](./SECURITY.md) - 安全策略
