# Automaton + Nanobot

> Conway Automaton + Nanobot - Sovereign AI Agent Runtime & Personal AI Assistant Framework

[![CI/CD Pipeline](https://github.com/1123786563/autoJieDan/actions/workflows/ci.yml/badge.svg)](https://github.com/1123786563/autoJieDan/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 项目概述

本项目是一个 **monorepo**，包含两个核心 AI 代理系统：

| 组件 | 语言 | 描述 |
|------|------|------|
| **Automaton** | TypeScript | 自改进、自复制的自主 AI 代理运行时，支持 Conway Cloud 集成 |
| **Nanobot** | Python | 轻量级个人 AI 助手框架，支持多平台和多 LLM 提供商 |

## 核心特性

### Automaton (TypeScript)

- **自主运行**: 基于 Conway Cloud 的自治代理系统
- **ANP 协议**: Agent Network Protocol 实现去中心化代理通信
- **WebSocket 实时通信**: 双向实时消息传递
- **HMAC 认证**: 安全的代理间认证机制
- **自动复制**: 支持自我复制和扩展
- **宪法约束**: 内置安全边界和行为约束

### Nanobot (Python)

- **多平台支持**: Telegram, Slack, Discord, WhatsApp 等
- **多 LLM 提供商**: OpenAI, Anthropic, Google, 本地模型等
- **MCP 协议**: Model Context Protocol 支持
- **技能系统**: 可扩展的插件架构
- **异步处理**: 高性能异步 I/O

### 双系统互联 (Interagent)

- **ANP 通信**: 基于 DID 的去中心化身份验证
- **WebSocket 通道**: 实时双向通信
- **可靠传输**: 消息确认、重试和死信队列
- **HMAC 签名**: 防篡改消息验证

## 快速开始

### 前置条件

- Docker 24+ 和 Docker Compose 2.x
- Git 2.x
- (可选) Node.js 20+ 用于本地开发
- (可选) Python 3.11+ 用于本地开发

### 使用 Docker Compose 启动

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
curl http://localhost:18790/health
curl http://localhost:18792/health
```

### 启动监控栈 (可选)

```bash
# 启动 Prometheus + Grafana
docker compose --profile monitoring up -d

# 访问 Grafana
open http://localhost:3000
# 默认账号: admin / admin
```

### 启动日志栈 (可选)

```bash
# 启动 ELK 栈
docker compose --profile logging up -d

# 访问 Kibana
open http://localhost:5601
```

## 项目结构

```
autoJieDan/
├── automaton/               # TypeScript AI 代理运行时
│   ├── src/
│   │   ├── agent/           # 核心代理逻辑
│   │   ├── conway/          # Conway Cloud 集成
│   │   ├── heartbeat/       # 定时任务
│   │   ├── inference/       # AI 模型集成
│   │   ├── interagent/      # 双系统通信协议
│   │   ├── memory/          # 持久化存储
│   │   ├── orchestration/   # 任务编排
│   │   ├── replication/     # 自复制逻辑
│   │   └── survival/        # 信用/层级管理
│   ├── __tests__/           # 测试文件
│   └── Dockerfile           # Docker 镜像
│
├── nanobot/                 # Python AI 助手
│   ├── nanobot/
│   │   ├── agent/           # 代理核心
│   │   ├── channels/        # 平台集成
│   │   ├── providers/       # LLM 提供商
│   │   └── skills/          # 代理技能
│   ├── tests/               # 测试文件
│   └── Dockerfile           # Docker 镜像
│
├── deploy/                  # 部署配置
│   ├── prometheus/          # Prometheus 配置
│   ├── grafana/             # Grafana 配置
│   └── logstash/            # Logstash 配置
│
├── scripts/                 # 运维脚本
│   ├── backup.sh            # 备份脚本
│   └── restore.sh           # 恢复脚本
│
├── docs/                    # 文档
│   ├── deployment-guide.md  # 部署指南
│   └── operations-manual.md # 运维手册
│
├── docker-compose.yml       # Docker Compose 配置
└── .env.example             # 环境变量模板
```

## 配置说明

### 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `INTERAGENT_SECRET` | ✅ | - | HMAC 认证密钥 |
| `OPENAI_API_KEY` | ✅ | - | OpenAI API 密钥 |
| `AUTOMATON_HTTP_PORT` | | 18790 | Automaton HTTP 端口 |
| `AUTOMATON_WS_PORT` | | 18791 | Automaton WebSocket 端口 |
| `NANOBOT_HTTP_PORT` | | 18792 | Nanobot HTTP 端口 |
| `LOG_LEVEL` | | info | 日志级别 |

完整配置请参考 [.env.example](.env.example)。

## 监控与运维

### Prometheus 指标

系统暴露以下关键指标：

| 指标 | 类型 | 说明 |
|------|------|------|
| `interagent_ws_connections` | Gauge | WebSocket 连接数 |
| `interagent_tasks_pending` | Gauge | 待处理任务数 |
| `interagent_request_latency_ms` | Histogram | 请求延迟 |
| `interagent_tasks_completed_total` | Counter | 完成任务数 |
| `interagent_tasks_failed_total` | Counter | 失败任务数 |
| `interagent_dlq_size` | Gauge | 死信队列大小 |

### 备份与恢复

```bash
# 执行备份
BACKUP_PASSWORD=secret ./scripts/backup.sh

# 恢复数据
BACKUP_PASSWORD=secret ./scripts/restore.sh /backups/latest
```

## 开发指南

### Automaton (TypeScript)

```bash
cd automaton
pnpm install          # 安装依赖
pnpm build            # 构建项目
pnpm dev              # 开发模式
pnpm test             # 运行测试
pnpm test:coverage    # 测试覆盖率
```

### Nanobot (Python)

```bash
cd nanobot
pip install -e ".[dev]"   # 安装开发依赖
pytest                    # 运行测试
ruff check .              # 代码检查
```

## 技术栈

### Automaton
- **运行时**: Node.js 20+, TypeScript 5.9
- **包管理**: pnpm 10.x
- **数据库**: better-sqlite3
- **区块链**: viem (Ethereum/Base)
- **测试**: vitest

### Nanobot
- **运行时**: Python 3.11+
- **包管理**: hatch/pip
- **LLM**: LiteLLM (多提供商)
- **验证**: Pydantic v2
- **协议**: MCP (Model Context Protocol)
- **测试**: pytest + pytest-asyncio

## 文档

- [部署指南](docs/deployment-guide.md) - 详细的部署步骤和配置说明
- [运维手册](docs/operations-manual.md) - 日常运维、监控告警和故障处理
- [Automaton 开发指南](automaton/CLAUDE.md) - TypeScript 开发规范
- [Nanobot 开发指南](nanobot/CLAUDE.md) - Python 开发规范

## 安全注意事项

- 永远不要提交 API 密钥或钱包私钥到代码库
- 使用环境变量管理敏感信息
- 定期轮换密钥 (建议每 30 天)
- 生产环境启用 TLS 加密
- 限制管理端口的访问范围

## 贡献指南

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 联系方式

- **Issues**: https://github.com/1123786563/autoJieDan/issues
- **文档**: /docs

---

由 Automaton + Nanobot 双系统驱动 | 版本 1.0.0
