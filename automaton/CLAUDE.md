# Automaton - TypeScript AI Agent Runtime

> Conway Automaton - 自改进、自复制的自主 AI 代理运行时

## Overview

Automaton 是一个基于 TypeScript 的自主 AI 代理运行时，支持：
- **Conway Cloud 集成**: 与 Conway 平台的无缝连接
- **ANP 协议**: Agent Network Protocol 实现去中心化代理通信
- **自复制机制**: 支持自我复制和扩展
- **宪法约束**: 内置安全边界和行为约束

## Project Structure

```
automaton/
├── src/
│   ├── agent/           # 核心代理逻辑
│   ├── anp/             # ANP 协议实现
│   ├── biz/             # 业务逻辑
│   ├── conway/          # Conway Cloud 集成
│   ├── git/             # Git 操作
│   ├── heartbeat/       # 定时任务
│   ├── identity/        # 身份管理
│   ├── inference/       # AI 模型集成
│   ├── interagent/      # 双系统通信协议 (与 Nanobot)
│   ├── memory/          # 持久化存储 (SQLite)
│   ├── observability/   # 可观测性 (Prometheus)
│   ├── ollama/          # Ollama 本地模型
│   ├── orchestration/   # 任务编排
│   ├── registry/        # 注册中心
│   ├── replication/     # 自复制逻辑
│   ├── self-mod/        # 自我修改
│   ├── setup/           # 初始化设置
│   ├── skills/          # 技能系统
│   ├── social/          # 社交功能
│   ├── soul/            # 代理灵魂/个性
│   ├── state/           # 状态管理
│   ├── survival/        # 信用/层级管理
│   └── upwork/          # Upwork 集成
├── __tests__/           # 测试文件
├── dist/                # 编译输出
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Setup & Installation

### Prerequisites

- Node.js 20+
- pnpm 10.x

### Installation

```bash
cd automaton
pnpm install
```

### Development

```bash
pnpm dev              # 开发模式 (热重载)
pnpm build            # 构建项目
pnpm test             # 运行测试
pnpm test:coverage    # 测试覆盖率
pnpm typecheck        # 类型检查
```

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────┐
│                     Automaton                           │
├─────────────────────────────────────────────────────────┤
│  ┌─────────┐  ┌──────────┐  ┌───────────────────────┐  │
│  │  Agent  │  │  Conway  │  │     Interagent        │  │
│  │  Core   │  │  Client  │  │  (ANP + WebSocket)    │  │
│  └────┬────┘  └────┬─────┘  └───────────┬───────────┘  │
│       │            │                    │               │
│       └────────────┼────────────────────┘               │
│                    │                                    │
│  ┌─────────────────▼─────────────────────┐             │
│  │             Memory Layer               │             │
│  │          (better-sqlite3)              │             │
│  └───────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────┘
```

### Key Modules

| 模块 | 职责 |
|------|------|
| `agent/` | 代理核心逻辑、状态管理、决策引擎 |
| `anp/` | ANP 协议实现、去中心化身份 |
| `biz/` | 业务逻辑、领域服务 |
| `conway/` | Conway Cloud API 集成、认证、任务同步 |
| `identity/` | DID 身份管理、认证 |
| `interagent/` | 与 Nanobot 的双向通信 (ANP 协议) |
| `memory/` | SQLite 持久化、缓存管理 |
| `observability/` | Prometheus 指标、监控 |
| `orchestration/` | 任务调度、优先级队列 |
| `replication/` | 自复制逻辑、实例管理 |
| `soul/` | 代理个性、行为特征 |
| `state/` | 状态机、数据库模式 |
| `survival/` | 信用系统、层级管理 |

## Tech Stack

| 类别 | 技术 |
|------|------|
| **运行时** | Node.js 20+, TypeScript 5.9 |
| **包管理** | pnpm 10.x |
| **数据库** | better-sqlite3 |
| **区块链** | viem (Ethereum/Base) |
| **AI** | OpenAI SDK |
| **测试** | vitest |
| **日志** | pino |
| **指标** | prom-client |

## Coding Standards

### TypeScript 规范

```typescript
// 使用严格类型
interface AgentConfig {
  id: string;
  name: string;
  capabilities: string[];
}

// 优先使用 async/await
async function processTask(task: Task): Promise<Result> {
  const result = await executeTask(task);
  return result;
}

// 使用 ES 模块导入
import { Agent } from './agent.js';
```

### 文件命名

- 类文件: `PascalCase.ts` (如 `Agent.ts`)
- 工具函数: `camelCase.ts` (如 `httpClient.ts`)
- 测试文件: `*.test.ts` (如 `Agent.test.ts`)

### 错误处理

```typescript
// 使用自定义错误类
class AgentError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'AgentError';
  }
}

// 始终处理错误
try {
  await agent.execute();
} catch (error) {
  if (error instanceof AgentError) {
    logger.error({ code: error.code }, error.message);
  }
  throw error;
}
```

## Testing Requirements

### 测试命令

```bash
pnpm test              # 运行所有测试
pnpm test:coverage     # 生成覆盖率报告
pnpm test:security     # 安全相关测试
pnpm test:financial    # 财务相关测试
```

### 测试规范

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('Agent', () => {
  let agent: Agent;

  beforeEach(() => {
    agent = new Agent({ id: 'test-agent' });
  });

  it('should execute task correctly', async () => {
    const result = await agent.execute(mockTask);
    expect(result.success).toBe(true);
  });
});
```

### 覆盖率要求

- 行覆盖率: 80%+
- 分支覆盖率: 75%+
- 关键路径: 100%

## Interagent Communication

### ANP 协议

Automaton 通过 ANP (Agent Network Protocol) 与 Nanobot 通信：

```typescript
// 发送消息到 Nanobot
const message = {
  from: agentDid,
  to: nanobotDid,
  payload: { type: 'task', data: taskData },
  timestamp: Date.now(),
};

await interagent.send(message);
```

### WebSocket 配置

```typescript
// 环境变量
INTERAGENT_SECRET=your-hmac-secret
NANOBOT_WS_URL=ws://localhost:18791
```

## Common Commands

```bash
# 开发
pnpm dev                    # 启动开发服务器
pnpm build                  # 构建生产版本
pnpm typecheck              # 类型检查

# 测试
pnpm test                   # 运行测试
pnpm test:coverage          # 覆盖率报告
pnpm test -- --watch        # 监视模式

# 代码质量
pnpm lint                   # 代码检查 (如配置)
```

## Environment Variables

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AUTOMATON_HTTP_PORT` | HTTP 端口 | 18790 |
| `AUTOMATON_WS_PORT` | WebSocket 端口 | 18791 |
| `INTERAGENT_SECRET` | HMAC 认证密钥 | (必需) |
| `OPENAI_API_KEY` | OpenAI API 密钥 | (必需) |
| `LOG_LEVEL` | 日志级别 | info |
| `DATABASE_PATH` | SQLite 数据库路径 | ./data/automaton.db |

## Debugging

```bash
# 启用调试日志
LOG_LEVEL=debug pnpm dev

# 查看特定模块日志
DEBUG=automaton:agent pnpm dev
```

## Related Documentation

- [根目录 CLAUDE.md](../CLAUDE.md) - 项目总览
- [Nanobot 开发指南](../nanobot/CLAUDE.md) - Python 模块
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 详细架构文档
- [DOCUMENTATION.md](./DOCUMENTATION.md) - API 文档
