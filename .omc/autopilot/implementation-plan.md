# 实施计划：融合 Automaton 与 Nanobot 的接单 AI 代理系统

> 文档版本: 1.0.0 | 创建日期: 2026-02-25

---

## 1. 项目概述

### 1.1 目标

构建一个端到端自动化的接单 AI 代理系统，实现：
- Automaton (TypeScript) 负责经济决策与项目治理
- Nanobot (Python) 负责技术执行与客户沟通
- 双系统通过 HTTP REST + WebSocket + 共享 SQLite 协作

### 1.2 范围

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 0 | 需求分析 | ✅ 已完成 |
| Phase 1 | 技术设计 | ✅ 已完成 |
| Phase 2 | 核心实现 | 📋 待实施 |
| Phase 3 | 集成测试 | 📋 待实施 |
| Phase 4 | 生产部署 | 📋 待实施 |

---

## 2. 实施阶段

### Phase 2: 核心基础设施 (预计 2 周)

#### 2.1 Sprint 1: 通信层基础 (Week 1)

**目标**: 建立双系统通信能力

| 任务 | 负责系统 | 优先级 | 预计工时 | 依赖 |
|------|----------|--------|----------|------|
| T2.1.1 定义共享类型 | 双系统 | P0 | 4h | 无 |
| T2.1.2 创建 SQLite 任务队列 | Automaton | P0 | 8h | T2.1.1 |
| T2.1.3 实现 HTTP API 服务器 (Automaton) | Automaton | P0 | 8h | T2.1.2 |
| T2.1.4 实现 HTTP API 服务器 (Nanobot) | Nanobot | P0 | 8h | T2.1.1 |
| T2.1.5 实现 WebSocket 服务器 | 双系统 | P1 | 8h | T2.1.3, T2.1.4 |
| T2.1.6 健康检查端点 | 双系统 | P0 | 2h | T2.1.3, T2.1.4 |

**交付物**:
- `automaton/src/interagent/` 模块
- `nanobot/nanobot/interagent/` 模块
- 共享数据库 schema
- API 端点文档

#### 2.2 Sprint 2: 任务队列与可靠性 (Week 2)

**目标**: 实现可靠的任务处理机制

| 任务 | 负责系统 | 优先级 | 预计工时 | 依赖 |
|------|----------|--------|----------|------|
| T2.2.1 任务创建 API | Automaton | P0 | 4h | T2.1.3 |
| T2.2.2 任务轮询与获取 | Nanobot | P0 | 4h | T2.1.4 |
| T2.2.3 租约(Lease)管理 | 双系统 | P0 | 4h | T2.2.1, T2.2.2 |
| T2.2.4 进度更新机制 | Nanobot | P0 | 4h | T2.2.2 |
| T2.2.5 任务完成/失败处理 | 双系统 | P0 | 4h | T2.2.4 |
| T2.2.6 重试与指数退避 | 双系统 | P1 | 4h | T2.2.5 |
| T2.2.7 死信队列(DLQ) | Automaton | P1 | 4h | T2.2.6 |
| T2.2.8 幂等性保证 | 双系统 | P1 | 4h | T2.2.1 |

**交付物**:
- 完整的任务生命周期管理
- 可靠性测试套件
- 监控指标

### Phase 3: 业务集成 (预计 3 周)

#### 3.1 Sprint 3: Genesis Prompt 实现 (Week 3)

**目标**: 实现任务分发核心流程

| 任务 | 负责系统 | 优先级 | 预计工时 | 依赖 |
|------|----------|--------|----------|------|
| T3.1.1 Genesis Prompt 类型定义 | 双系统 | P0 | 2h | T2.1.1 |
| T3.1.2 Automaton 任务分发逻辑 | Automaton | P0 | 8h | T3.1.1, T2.2.1 |
| T3.1.3 Nanobot 任务接收与解析 | Nanobot | P0 | 8h | T3.1.1, T2.2.2 |
| T3.1.4 预算约束集成 | 双系统 | P0 | 4h | T3.1.3 |
| T3.1.5 项目上下文传递 | 双系统 | P1 | 4h | T3.1.3 |

**交付物**:
- Genesis Prompt 序列化/反序列化
- 任务分发端到端测试

#### 3.2 Sprint 4: 报告机制 (Week 4)

**目标**: 实现双向反馈机制

| 任务 | 负责系统 | 优先级 | 预计工时 | 依赖 |
|------|----------|--------|----------|------|
| T3.2.1 进度报告生成 | Nanobot | P0 | 4h | T2.2.4 |
| T3.2.2 进度报告处理 | Automaton | P0 | 4h | T3.2.1 |
| T3.2.3 资源消耗追踪 | Nanobot | P1 | 4h | T3.1.3 |
| T3.2.4 资源报告处理 | Automaton | P1 | 4h | T3.2.3 |
| T3.2.5 异常检测与报告 | Nanobot | P0 | 4h | T3.1.3 |
| T3.2.6 异常处理与告警 | Automaton | P0 | 4h | T3.2.5 |
| T3.2.7 WebSocket 事件广播 | 双系统 | P1 | 4h | T2.1.5 |

**交付物**:
- 完整的报告系统
- 实时事件推送
- 告警机制

#### 3.3 Sprint 5: 安全与认证 (Week 5)

**目标**: 实现安全通信机制

| 任务 | 负责系统 | 优先级 | 预计工时 | 依赖 |
|------|----------|--------|----------|------|
| T3.3.1 HMAC 签名实现 | 双系统 | P0 | 4h | T2.1.3 |
| T3.3.2 请求验证中间件 | 双系统 | P0 | 4h | T3.3.1 |
| T3.3.3 密钥管理与轮换 | Automaton | P1 | 4h | T3.3.1 |
| T3.3.4 TLS 配置(生产) | 双系统 | P1 | 2h | T3.3.2 |
| T3.3.5 访问控制矩阵 | 双系统 | P1 | 4h | T3.3.2 |

**交付物**:
- 认证中间件
- 密钥管理工具
- 安全测试套件

### Phase 4: 集成测试 (预计 1 周)

#### 4.1 Sprint 6: 端到端测试 (Week 6)

| 任务 | 优先级 | 预计工时 |
|------|--------|----------|
| T4.1.1 集成测试环境搭建 | P0 | 4h |
| T4.1.2 任务生命周期测试 | P0 | 8h |
| T4.1.3 故障恢复测试 | P0 | 4h |
| T4.1.4 性能基准测试 | P1 | 4h |
| T4.1.5 安全渗透测试 | P1 | 4h |
| T4.1.6 文档完善 | P1 | 4h |

---

## 3. 文件结构

### 3.1 Automaton 新增模块

```
automaton/src/
├── interagent/
│   ├── index.ts              # 模块导出
│   ├── types.ts              # 跨系统类型定义
│   ├── client.ts             # Nanobot HTTP 客户端
│   ├── server.ts             # Express/Fastify 服务器
│   ├── websocket.ts          # WebSocket 服务器
│   ├── queue.ts              # 任务队列管理
│   ├── task-manager.ts       # 任务生命周期管理
│   ├── report-handler.ts     # 报告处理器
│   ├── dlq.ts                # 死信队列
│   └── auth.ts               # HMAC 认证
├── __tests__/
│   └── interagent/
│       ├── client.test.ts
│       ├── queue.test.ts
│       ├── auth.test.ts
│       └── integration.test.ts
```

### 3.2 Nanobot 新增模块

```
nanobot/nanobot/
├── interagent/
│   ├── __init__.py
│   ├── types.py              # Pydantic 模型
│   ├── client.py             # Automaton HTTP 客户端
│   ├── server.py             # FastAPI 服务器
│   ├── websocket.py          # WebSocket 客户端
│   ├── queue.py              # 任务轮询与处理
│   ├── task_executor.py      # 任务执行器
│   ├── reporter.py           # 报告生成器
│   └── auth.py               # HMAC 认证
├── tests/
│   └── test_interagent/
│       ├── test_client.py
│       ├── test_queue.py
│       ├── test_auth.py
│       └── test_integration.py
```

### 3.3 共享资源

```
shared/
├── schemas/
│   └── interagent.sql        # SQLite schema
├── docs/
│   ├── api-spec.yaml         # OpenAPI 规范
│   └── message-formats.md    # 消息格式文档
└── scripts/
    ├── init-db.sh            # 数据库初始化
    └── key-rotation.sh       # 密钥轮换脚本
```

---

## 4. 技术栈确认

### 4.1 Automaton 端

| 组件 | 技术选择 | 版本 | 说明 |
|------|----------|------|------|
| HTTP Server | Fastify | 5.x | 高性能，内置验证 |
| WebSocket | ws | 8.x | 稳定，广泛使用 |
| Database | better-sqlite3 | 已有 | 复用现有依赖 |
| Validation | zod | 3.x | TypeScript 优先 |
| HTTP Client | 已有 ResilientHttpClient | - | 复用熔断器 |

### 4.2 Nanobot 端

| 组件 | 技术选择 | 版本 | 说明 |
|------|----------|------|------|
| HTTP Server | FastAPI | 0.109+ | Python 异步首选 |
| WebSocket | websockets | 12+ | 标准库兼容 |
| Database | sqlite3 | 标准库 | 无额外依赖 |
| Validation | Pydantic | 已有 v2 | 复用现有依赖 |
| HTTP Client | httpx | 0.27+ | 异步 HTTP |

---

## 5. 数据库 Schema

### 5.1 任务队列表

```sql
-- 共享 SQLite 数据库: ~/.automaton/interagent.db

CREATE TABLE interagent_tasks (
    id TEXT PRIMARY KEY,              -- ULID
    created_at TEXT NOT NULL,         -- ISO 8601
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL,             -- 'automaton' | 'nanobot'
    target TEXT NOT NULL,             -- 'automaton' | 'nanobot'
    type TEXT NOT NULL,               -- 任务类型
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER DEFAULT 1,       -- 0=low, 1=normal, 2=high, 3=critical
    payload TEXT NOT NULL,            -- JSON
    result TEXT,                      -- JSON
    error TEXT,
    correlation_id TEXT,
    idempotency_key TEXT UNIQUE,
    lease_owner TEXT,
    lease_expires_at TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    deadline TEXT
);

CREATE INDEX idx_tasks_status ON interagent_tasks(status);
CREATE INDEX idx_tasks_target_status ON interagent_tasks(target, status);
CREATE INDEX idx_tasks_priority ON interagent_tasks(priority DESC, created_at ASC);
CREATE INDEX idx_tasks_idempotency ON interagent_tasks(idempotency_key);
```

### 5.2 死信队列表

```sql
CREATE TABLE interagent_dlq (
    id TEXT PRIMARY KEY,
    original_task_id TEXT NOT NULL,
    original_payload TEXT NOT NULL,
    failure_reason TEXT NOT NULL,
    failed_at TEXT NOT NULL,
    retry_after TEXT,
    reviewed INTEGER DEFAULT 0
);

CREATE INDEX idx_dlq_reviewed ON interagent_dlq(reviewed);
```

### 5.3 幂等性缓存表

```sql
CREATE TABLE idempotency_cache (
    key TEXT PRIMARY KEY,
    response TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- TTL 清理: DELETE FROM idempotency_cache
--           WHERE datetime(created_at) < datetime('now', '-24 hours');
```

---

## 6. API 端点规范

### 6.1 Automaton 端点 (Port: 18790)

| Method | Path | 描述 | 请求体 | 响应 |
|--------|------|------|--------|------|
| POST | `/api/v1/task` | 创建任务 | GenesisPrompt | TaskResponse |
| GET | `/api/v1/task/:id` | 获取任务状态 | - | TaskStatus |
| POST | `/api/v1/task/:id/progress` | 更新进度 | ProgressReport | Ack |
| POST | `/api/v1/task/:id/complete` | 标记完成 | CompletionReport | Ack |
| POST | `/api/v1/task/:id/fail` | 标记失败 | FailureReport | Ack |
| GET | `/api/v1/health` | 健康检查 | - | HealthStatus |
| POST | `/api/v1/budget/query` | 预算查询 | BudgetQuery | BudgetResponse |
| GET | `/ws/events` | WebSocket 事件流 | - | Stream |

### 6.2 Nanobot 端点 (Port: 18791)

| Method | Path | 描述 | 请求体 | 响应 |
|--------|------|------|--------|------|
| GET | `/api/v1/task/next` | 获取下一个待处理任务 | - | Task | null |
| POST | `/api/v1/task/:id/lease` | 获取任务租约 | - | LeaseResponse |
| POST | `/api/v1/task/:id/progress` | 更新进度 | ProgressReport | Ack |
| POST | `/api/v1/task/:id/complete` | 标记完成 | CompletionReport | Ack |
| POST | `/api/v1/task/:id/fail` | 标记失败 | FailureReport | Ack |
| GET | `/api/v1/health` | 健康检查 | - | HealthStatus |
| GET | `/ws/events` | WebSocket 事件流 | - | Stream |

---

## 7. 配置规范

### 7.1 环境变量

```bash
# Automaton 配置
INTERAGENT_ENABLED=true
INTERAGENT_DB_PATH=~/.automaton/interagent.db
INTERAGENT_HTTP_PORT=18790
INTERAGENT_NANOBOT_URL=http://localhost:18791
INTERAGENT_SECRET=<hmac-secret-key>
INTERAGENT_WS_ENABLED=true

# Nanobot 配置
INTERAGENT_ENABLED=true
INTERAGENT_DB_PATH=~/.automaton/interagent.db  # 共享路径
INTERAGENT_HTTP_PORT=18791
INTERAGENT_AUTOMATON_URL=http://localhost:18790
INTERAGENT_SECRET=<hmac-secret-key>
INTERAGENT_WS_ENABLED=true
INTERAGENT_POLL_INTERVAL_MS=1000
```

### 7.2 配置文件示例

```yaml
# automaton 配置
interagent:
  enabled: true
  database:
    path: ~/.automaton/interagent.db
    wal_mode: true
    pool_size: 5
  http:
    port: 18790
    timeout_ms: 30000
    max_retries: 3
  websocket:
    enabled: true
    ping_interval_ms: 30000
  auth:
    secret_env: INTERAGENT_SECRET
    key_rotation_days: 30
  reliability:
    circuit_breaker_threshold: 5
    circuit_breaker_reset_ms: 60000
    dlq_retention_days: 7
    idempotency_ttl_hours: 24
    lease_duration_seconds: 30
  nanobot:
    url: http://localhost:18791
```

---

## 8. 监控与告警

### 8.1 关键指标

| 指标名称 | 类型 | 描述 | 告警阈值 |
|----------|------|------|----------|
| `interagent.tasks.created` | Counter | 创建的任务数 | - |
| `interagent.tasks.completed` | Counter | 完成的任务数 | - |
| `interagent.tasks.failed` | Counter | 失败的任务数 | >10%/5min |
| `interagent.latency.ms` | Histogram | 请求延迟 | P99 > 500ms |
| `interagent.queue.depth` | Gauge | 队列深度 | >100 |
| `interagent.dlq.size` | Gauge | 死信队列大小 | >10/小时 |
| `interagent.ws.connections` | Gauge | WebSocket 连接数 | <1 (Critical) |

### 8.2 日志格式

```json
{
  "timestamp": "2026-02-25T10:30:00.000Z",
  "level": "info",
  "module": "interagent",
  "message": "Task created",
  "context": {
    "taskId": "01HXYZ...",
    "source": "automaton",
    "target": "nanobot",
    "type": "code_generation"
  },
  "traceId": "abc123"
}
```

---

## 9. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解策略 |
|------|--------|------|----------|
| SQLite 并发瓶颈 | 中 | 高 | WAL 模式 + 连接池 |
| WebSocket 连接不稳定 | 高 | 中 | 自动重连 + 心跳 |
| 消息丢失 | 低 | 高 | 持久化 + ACK 机制 |
| 密钥泄露 | 低 | 高 | 环境变量 + 定期轮换 |
| 性能不达标 | 中 | 中 | 负载测试 + 优化 |

---

## 10. 验收检查清单

### Phase 2 完成标准
- [ ] 双向 HTTP 通信正常
- [ ] WebSocket 连接稳定
- [ ] 任务队列 CRUD 完整
- [ ] 租约机制正常工作
- [ ] 单元测试覆盖率 >80%

### Phase 3 完成标准
- [ ] Genesis Prompt 端到端流程正常
- [ ] 进度报告实时更新
- [ ] 异常告警触发正常
- [ ] HMAC 认证通过
- [ ] 集成测试全部通过

### Phase 4 完成标准
- [ ] 性能基准达标
- [ ] 安全测试通过
- [ ] 文档完整
- [ ] 生产部署就绪

---

*文档版本: 1.0.0*
*最后更新: 2026-02-25*
*作者: Claude Planner Agent*
