# AutoJieDan - Monorepo AI Agent Framework

> Conway Automaton + Nanobot - Sovereign AI Agent Runtime & Personal AI Assistant Framework

## Overview

本项目是一个 **monorepo**，包含两个核心 AI 代理系统：

- **Automaton** (TypeScript): 自改进、自复制的自主 AI 代理运行时，支持 Conway Cloud 集成
- **Nanobot** (Python): 轻量级个人 AI 助手框架，支持多平台和多 LLM 提供商

## Project Structure

```
autoJieDan/
├── automaton/               # TypeScript AI 代理运行时
│   ├── src/
│   │   ├── agent/           # 核心代理逻辑
│   │   ├── anp/             # ANP 协议实现
│   │   ├── biz/             # 业务逻辑
│   │   ├── conway/          # Conway Cloud 集成
│   │   ├── identity/        # 身份管理
│   │   ├── inference/       # AI 模型推理
│   │   ├── interagent/      # 双系统通信协议
│   │   ├── memory/          # 持久化存储
│   │   ├── observability/   # 可观测性
│   │   ├── orchestration/   # 任务编排
│   │   ├── replication/     # 自复制逻辑
│   │   ├── soul/            # 代理灵魂/个性
│   │   ├── state/           # 状态管理
│   │   └── survival/        # 信用/层级管理
│   ├── __tests__/           # 测试文件
│   └── CLAUDE.md            # Automaton 开发指南
│
├── nanobot/                 # Python AI 助手
│   ├── nanobot/
│   │   ├── agent/           # 代理核心
│   │   ├── anp/             # ANP 协议实现
│   │   ├── channels/        # 平台集成
│   │   ├── interagent/      # 与 Automaton 通信
│   │   ├── providers/       # LLM 提供商
│   │   └── skills/          # 代理技能
│   ├── tests/               # 测试文件
│   └── CLAUDE.md            # Nanobot 开发指南
│
├── docs/                    # 项目文档
├── config/                  # 配置文件
├── docker-compose.yml       # Docker Compose 配置
├── .env.example             # 环境变量模板
└── README.md                # 项目说明文档
```

## Setup & Installation

### Prerequisites

- Docker 24+ 和 Docker Compose 2.x
- Git 2.x
- (可选) Node.js 20+ 用于本地开发 Automaton
- (可选) Python 3.11+ 用于本地开发 Nanobot

### Quick Start

```bash
# 克隆仓库
git clone https://github.com/1123786563/autoJieDan.git
cd autoJieDan

# 配置环境变量
cp .env.example .env
nano .env  # 编辑配置

# 启动核心服务
docker compose up -d

# 验证部署
curl http://localhost:18790/health  # Automaton
curl http://localhost:18792/health  # Nanobot
```

### Local Development

```bash
# Automaton (TypeScript)
cd automaton
pnpm install          # 安装依赖
pnpm build            # 构建项目
pnpm dev              # 开发模式
pnpm test             # 运行测试

# Nanobot (Python)
cd nanobot
pip install -e ".[dev]"   # 安装开发依赖
pytest                    # 运行测试
ruff check .              # 代码检查
```

## Architecture

### 双系统互联 (Interagent)

```
┌─────────────────┐     ANP Protocol     ┌─────────────────┐
│   Automaton     │◄──────────────────► │    Nanobot      │
│   (TypeScript)  │     WebSocket + HMAC │    (Python)     │
│                 │                      │                 │
│ - 自主代理运行时  │                      │ - 多平台支持     │
│ - Conway 集成   │                      │ - 多 LLM 提供商  │
│ - 宪法约束      │                      │ - 技能系统       │
└─────────────────┘                      └─────────────────┘
```

### 核心组件

| 组件 | 功能 |
|------|------|
| ANP 协议 | 基于 DID 的去中心化身份验证 |
| WebSocket 通道 | 实时双向通信 |
| HMAC 签名 | 防篡改消息验证 |
| 死信队列 | 消息确认、重试机制 |

## Core Principles

1. **安全优先**: 永远不要提交 API 密钥或钱包私钥到代码库
2. **模块化设计**: Automaton 和 Nanobot 可独立运行或协同工作
3. **异步优先**: 使用 async/await 处理 I/O 操作
4. **类型安全**: TypeScript 严格模式 + Python 类型提示
5. **测试驱动**: 新功能必须包含测试

## Tech Stack

| 组件 | 技术 |
|------|------|
| **Automaton** | TypeScript 5.9, Node.js 20+, pnpm, viem, better-sqlite3, vitest |
| **Nanobot** | Python 3.11+, LiteLLM, Pydantic v2, MCP, pytest |
| **基础设施** | Docker, Prometheus, Grafana, ELK 栈 |

## Common Commands

### Docker

```bash
docker compose up -d                    # 启动服务
docker compose --profile monitoring up -d  # 启动监控栈
docker compose logs -f automaton        # 查看日志
docker compose down                     # 停止服务
```

### Automaton

```bash
cd automaton
pnpm install          # 安装依赖
pnpm build            # 构建
pnpm dev              # 开发模式
pnpm test             # 运行测试
pnpm test:coverage    # 测试覆盖率
```

### Nanobot

```bash
cd nanobot
pip install -e ".[dev]"   # 安装开发依赖
pytest                    # 运行测试
pytest -v                 # 详细输出
ruff check .              # 代码检查
ruff check . --fix        # 自动修复
```

## Testing Requirements

- 所有新功能必须包含单元测试
- 测试覆盖率目标: 80%+
- 使用 `pnpm test:coverage` (Automaton) 或 `pytest --cov` (Nanobot)
- CI/CD 管道自动运行测试

## Environment Variables

| 变量 | 必需 | 说明 |
|------|------|------|
| `INTERAGENT_SECRET` | ✅ | HMAC 认证密钥 |
| `OPENAI_API_KEY` | ✅ | OpenAI API 密钥 |
| `AUTOMATON_HTTP_PORT` | | Automaton HTTP 端口 (默认: 18790) |
| `NANOBOT_HTTP_PORT` | | Nanobot HTTP 端口 (默认: 18792) |
| `LOG_LEVEL` | | 日志级别 (默认: info) |

完整配置请参考 `.env.example`。

## Module-Specific Guides

- **[Automaton 开发指南](automaton/CLAUDE.md)** - TypeScript 开发规范、代理逻辑、Conway 集成
- **[Nanobot 开发指南](nanobot/CLAUDE.md)** - Python 开发规范、技能系统、平台集成

## Documentation

- [部署指南](docs/deployment-guide.md) - 详细的部署步骤和配置说明
- [运维手册](docs/operations-manual.md) - 日常运维、监控告警和故障处理

## Security Notes

- 永远不要提交 API 密钥或钱包私钥到代码库
- 使用环境变量管理敏感信息
- 定期轮换密钥 (建议每 30 天)
- 生产环境启用 TLS 加密
- 限制管理端口的访问范围
