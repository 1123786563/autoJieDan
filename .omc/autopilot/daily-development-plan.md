# 每日开发计划 - Automaton + Nanobot 双系统融合

> 版本: 1.0.0 | 创建日期: 2026-02-25

---

## 项目总览

| 周次 | 主题 | 主要目标 |
|------|------|----------|
| Week 1 | 通信层基础 | 建立双系统通信能力 |
| Week 2 | 任务队列与可靠性 | 实现可靠的任务处理机制 |
| Week 3 | Genesis Prompt | 实现任务分发核心流程 |
| Week 4 | 报告机制 | 实现双向反馈机制 |
| Week 5 | 安全与认证 | 实现安全通信机制 |
| Week 6 | 集成测试 | 端到端测试与部署准备 |

---

## Week 1: 通信层基础 (Day 1-7)

### Day 1 (2026-02-25): 项目初始化与共享类型定义

**任务**: T2.1.1 定义共享类型

**技术点**:
- TypeScript 接口设计 (`automaton/src/interagent/types.ts`)
- Python Pydantic 模型 (`nanobot/nanobot/interagent/types.py`)
- ULID 唯一标识符
- JSON Schema 验证

**代码文件**:
```
automaton/src/interagent/
├── index.ts              # 模块导出
├── types.ts              # 跨系统类型定义
└── constants.ts          # 常量定义

nanobot/nanobot/interagent/
├── __init__.py
├── types.py              # Pydantic 模型
└── constants.py          # 常量定义
```

**风险点**:
| 风险 | 影响 | 解决方法 |
|------|------|----------|
| TypeScript/Python 类型不一致 | 高 | 使用 JSON Schema 作为单一真相源，自动生成双端类型 |
| ULID 生成库不兼容 | 中 | 使用标准 ulid 库，确保格式一致 |

**验收标准**:
- [ ] 类型定义覆盖所有消息类型
- [ ] 双端类型可互相转换
- [ ] 单元测试覆盖率 >80%

**提交信息**: `feat(interagent): 定义跨系统共享类型`

---

### Day 2: SQLite 任务队列表设计

**任务**: T2.1.2 创建 SQLite 任务队列

**技术点**:
- SQLite WAL 模式配置
- 任务队列表 schema 设计
- 索引优化（状态、优先级、目标）
- better-sqlite3 集成

**代码文件**:
```
automaton/src/interagent/
├── database.ts           # 数据库连接管理
├── queue.ts              # 任务队列管理
└── schema.sql            # 数据库 schema

shared/schemas/
└── interagent.sql        # 共享 schema 定义
```

**风险点**:
| 风险 | 影响 | 解决方法 |
|------|------|----------|
| SQLite 并发写入冲突 | 高 | 使用 WAL 模式 + 合理的锁超时 |
| 跨进程文件锁问题 | 中 | 配置 busy_timeout，添加重试逻辑 |

**验收标准**:
- [ ] 数据库初始化脚本可运行
- [ ] WAL 模式已启用
- [ ] 基本 CRUD 操作测试通过

**提交信息**: `feat(interagent): 实现 SQLite 任务队列`

---

### Day 3: Automaton HTTP API 服务器

**任务**: T2.1.3 实现 HTTP API 服务器 (Automaton)

**技术点**:
- Fastify 服务器框架
- 路由设计与实现
- 请求验证 (Zod)
- 错误处理中间件

**代码文件**:
```
automaton/src/interagent/
├── server.ts             # Fastify 服务器
├── routes/
│   ├── index.ts          # 路由注册
│   ├── task.ts           # 任务相关路由
│   └── health.ts         # 健康检查路由
└── middleware/
    ├── validation.ts     # 请求验证
    └── error-handler.ts  # 错误处理
```

**API 端点**:
| Method | Path | 描述 |
|--------|------|------|
| POST | `/api/v1/task` | 创建任务 |
| GET | `/api/v1/task/:id` | 获取任务状态 |
| GET | `/api/v1/health` | 健康检查 |

**风险点**:
| 风险 | 影响 | 解决方法 |
|------|------|----------|
| 端口冲突 | 中 | 配置文件指定端口，支持环境变量覆盖 |
| 请求验证绕过 | 高 | 使用严格 Zod schema，所有输入都经过验证 |

**验收标准**:
- [ ] 服务器可启动并响应请求
- [ ] 健康检查端点正常工作
- [ ] 任务创建 API 可用

**提交信息**: `feat(interagent): 实现 Automaton HTTP 服务器`

---

### Day 4: Nanobot HTTP API 服务器

**任务**: T2.1.4 实现 HTTP API 服务器 (Nanobot)

**技术点**:
- FastAPI 服务器框架
- Pydantic 请求模型
- 异步路由处理
- OpenAPI 文档生成

**代码文件**:
```
nanobot/nanobot/interagent/
├── server.py             # FastAPI 服务器
├── routes/
│   ├── __init__.py
│   ├── task.py           # 任务相关路由
│   └── health.py         # 健康检查路由
└── middleware/
    ├── __init__.py
    └── error_handler.py  # 错误处理
```

**API 端点**:
| Method | Path | 描述 |
|--------|------|------|
| GET | `/api/v1/task/next` | 获取下一个待处理任务 |
| POST | `/api/v1/task/:id/lease` | 获取任务租约 |
| GET | `/api/v1/health` | 健康检查 |

**风险点**:
| 风险 | 影响 | 解决方法 |
|------|------|----------|
| 异步数据库访问 | 中 | 使用 aiosqlite 或线程池 |
| Python/Node 端口冲突 | 低 | 默认使用不同端口 (18790/18791) |

**验收标准**:
- [ ] 服务器可启动并响应请求
- [ ] 任务获取 API 可用
- [ ] OpenAPI 文档自动生成

**提交信息**: `feat(interagent): 实现 Nanobot HTTP 服务器`

---

### Day 5: WebSocket 服务器实现

**任务**: T2.1.5 实现 WebSocket 服务器

**技术点**:
- ws 库 (Node.js)
- websockets 库 (Python)
- 心跳检测
- 连接状态管理

**代码文件**:
```
automaton/src/interagent/
├── websocket.ts          # WebSocket 服务器

nanobot/nanobot/interagent/
├── websocket.py          # WebSocket 客户端
```

**事件类型**:
| Event | Direction | Description |
|-------|-----------|-------------|
| `task.progress` | Nanobot -> Automaton | 进度更新 |
| `task.error` | Either | 错误通知 |
| `status.heartbeat` | Either | 健康心跳 |

**风险点**:
| 风险 | 影响 | 解决方法 |
|------|------|----------|
| 连接不稳定 | 高 | 实现自动重连 + 心跳机制 |
| 消息顺序问题 | 中 | 使用消息 ID 和确认机制 |

**验收标准**:
- [ ] WebSocket 连接可建立
- [ ] 心跳机制正常工作
- [ ] 事件可双向推送

**提交信息**: `feat(interagent): 实现 WebSocket 通信`

---

### Day 6: 健康检查端点完善

**任务**: T2.1.6 健康检查端点

**技术点**:
- 健康状态格式设计
- 依赖检查（数据库、外部服务）
- 就绪/存活探针分离

**代码文件**:
```
automaton/src/interagent/routes/
├── health.ts             # 详细健康检查
└── readiness.ts          # 就绪探针

nanobot/nanobot/interagent/routes/
├── health.py             # 详细健康检查
└── readiness.py          # 就绪探针
```

**健康状态格式**:
```json
{
  "status": "healthy" | "degraded" | "unhealthy",
  "version": "1.0.0",
  "uptime": 3600,
  "dependencies": {
    "database": "healthy",
    "automaton": "healthy"
  }
}
```

**提交信息**: `feat(interagent): 完善健康检查端点`

---

### Day 7: Week 1 集成测试

**任务**: Week 1 回顾与集成测试

**技术点**:
- 端到端测试设计
- 测试覆盖率检查
- 文档更新

**测试文件**:
```
automaton/src/__tests__/interagent/
├── types.test.ts
├── queue.test.ts
├── server.test.ts
└── websocket.test.ts

nanobot/tests/test_interagent/
├── test_types.py
├── test_server.py
└── test_websocket.py
```

**验收标准**:
- [ ] 所有单元测试通过
- [ ] 测试覆盖率 >80%
- [ ] 双系统可互相通信

**提交信息**: `test(interagent): Week 1 集成测试`

---

## Week 2: 任务队列与可靠性 (Day 8-14)

### Day 8: 任务创建 API 完善

**任务**: T2.2.1 任务创建 API

**技术点**:
- 任务创建流程
- 幂等性键处理
- 任务优先级排序

**代码文件**:
```
automaton/src/interagent/
├── task-manager.ts       # 任务生命周期管理
└── idempotency.ts        # 幂等性处理
```

**提交信息**: `feat(interagent): 完善任务创建 API`

---

### Day 9: 任务轮询与获取

**任务**: T2.2.2 任务轮询与获取

**技术点**:
- 长轮询实现
- 任务过滤（类型、优先级）
- 批量获取支持

**代码文件**:
```
nanobot/nanobot/interagent/
├── poller.py             # 任务轮询器
└── filters.py            # 任务过滤逻辑
```

**提交信息**: `feat(interagent): 实现任务轮询机制`

---

### Day 10: 租约(Lease)管理

**任务**: T2.2.3 租约(Lease)管理

**技术点**:
- 租约获取与释放
- 租约超时处理
- 租约续期

**代码文件**:
```
automaton/src/interagent/
├── lease.ts              # 租约管理

nanobot/nanobot/interagent/
├── lease.py              # 租约管理
```

**风险点**:
| 风险 | 影响 | 解决方法 |
|------|------|----------|
| 租约竞争 | 高 | 使用原子性 UPDATE 语句 |
| 时钟漂移 | 中 | 使用数据库时间戳而非应用时间 |

**提交信息**: `feat(interagent): 实现租约管理机制`

---

### Day 11: 进度更新机制

**任务**: T2.2.4 进度更新机制

**技术点**:
- 进度百分比计算
- 里程碑追踪
- 预计完成时间

**代码文件**:
```
nanobot/nanobot/interagent/
├── reporter.py           # 进度报告生成
└── progress.py           # 进度追踪
```

**提交信息**: `feat(interagent): 实现进度更新机制`

---

### Day 12: 任务完成/失败处理

**任务**: T2.2.5 任务完成/失败处理

**技术点**:
- 任务状态转换
- 结果存储
- 失败原因记录

**代码文件**:
```
automaton/src/interagent/
├── task-lifecycle.ts     # 任务生命周期

nanobot/nanobot/interagent/
├── task_lifecycle.py     # 任务生命周期
```

**提交信息**: `feat(interagent): 实现任务完成/失败处理`

---

### Day 13: 重试与指数退避

**任务**: T2.2.6 重试与指数退避

**技术点**:
- 指数退避算法
- 抖动(Jitter)策略
- 最大重试次数

**代码文件**:
```
automaton/src/interagent/
├── retry.ts              # 重试逻辑

nanobot/nanobot/interagent/
├── retry.py              # 重试逻辑
```

**提交信息**: `feat(interagent): 实现重试与退避机制`

---

### Day 14: 死信队列(DLQ)

**任务**: T2.2.7 死信队列(DLQ)

**技术点**:
- DLQ schema 设计
- 失败任务移动
- DLQ 审查与重试

**代码文件**:
```
automaton/src/interagent/
├── dlq.ts                # 死信队列管理
```

**提交信息**: `feat(interagent): 实现死信队列`

---

## Week 3: Genesis Prompt 实现 (Day 15-21)

### Day 15: Genesis Prompt 类型定义

**任务**: T3.1.1 Genesis Prompt 类型定义

**技术点**:
- GenesisPrompt 接口设计
- 技术约束建模
- 商务条款建模

**提交信息**: `feat(interagent): 定义 Genesis Prompt 类型`

---

### Day 16-17: Automaton 任务分发逻辑

**任务**: T3.1.2 Automaton 任务分发逻辑

**技术点**:
- 项目上下文构建
- 预算计算与分配
- 任务分发决策

**提交信息**: `feat(interagent): 实现 Automaton 任务分发`

---

### Day 18-19: Nanobot 任务接收与解析

**任务**: T3.1.3 Nanobot 任务接收与解析

**技术点**:
- Genesis Prompt 解析
- 任务参数验证
- 执行计划生成

**提交信息**: `feat(interagent): 实现 Nanobot 任务解析`

---

### Day 20: 预算约束集成

**任务**: T3.1.4 预算约束集成

**技术点**:
- Token 预算追踪
- 成本预估
- 超支检测

**提交信息**: `feat(interagent): 集成预算约束`

---

### Day 21: Week 3 集成测试

**任务**: Week 3 回顾与测试

**提交信息**: `test(interagent): Week 3 集成测试`

---

## Week 4: 报告机制 (Day 22-28)

### Day 22-23: 进度报告系统

**任务**: T3.2.1-T3.2.2 进度报告

**技术点**:
- 实时进度追踪
- 报告聚合
- 历史记录

**提交信息**: `feat(interagent): 实现进度报告系统`

---

### Day 24-25: 资源消耗追踪

**任务**: T3.2.3-T3.2.4 资源消耗

**技术点**:
- Token 使用统计
- 成本计算
- 资源预测

**提交信息**: `feat(interagent): 实现资源消耗追踪`

---

### Day 26-27: 异常检测与告警

**任务**: T3.2.5-T3.2.6 异常处理

**技术点**:
- 异常分类
- 告警触发
- 恢复策略

**提交信息**: `feat(interagent): 实现异常检测与告警`

---

### Day 28: WebSocket 事件广播完善

**任务**: T3.2.7 WebSocket 事件广播

**提交信息**: `feat(interagent): 完善 WebSocket 事件广播`

---

## Week 5: 安全与认证 (Day 29-35)

### Day 29-30: HMAC 签名实现

**任务**: T3.3.1-T3.3.2 HMAC 认证

**技术点**:
- HMAC-SHA256 签名
- 请求验证中间件
- 时间戳防重放

**提交信息**: `feat(interagent): 实现 HMAC 认证`

---

### Day 31: 密钥管理与轮换

**任务**: T3.3.3 密钥管理

**提交信息**: `feat(interagent): 实现密钥管理`

---

### Day 32: TLS 配置

**任务**: T3.3.4 TLS 配置

**提交信息**: `feat(interagent): 配置 TLS`

---

### Day 33-34: 访问控制矩阵

**任务**: T3.3.5 访问控制

**提交信息**: `feat(interagent): 实现访问控制`

---

### Day 35: Week 5 安全测试

**提交信息**: `test(interagent): Week 5 安全测试`

---

## Week 6: 集成测试 (Day 36-42)

### Day 36-37: 端到端测试

**任务**: T4.1.1-T4.1.2 集成测试

**提交信息**: `test(interagent): 端到端集成测试`

---

### Day 38: 故障恢复测试

**任务**: T4.1.3 故障恢复测试

**提交信息**: `test(interagent): 故障恢复测试`

---

### Day 39: 性能基准测试

**任务**: T4.1.4 性能测试

**提交信息**: `test(interagent): 性能基准测试`

---

### Day 40: 安全渗透测试

**任务**: T4.1.5 安全测试

**提交信息**: `test(interagent): 安全渗透测试`

---

### Day 41-42: 文档完善与发布准备

**任务**: T4.1.6 文档完善

**提交信息**: `docs(interagent): 完善文档`

---

## 验收标准总览

### Phase 2 (Week 1-2)
- [ ] 双向 HTTP 通信正常
- [ ] WebSocket 连接稳定
- [ ] 任务队列 CRUD 完整
- [ ] 租约机制正常工作
- [ ] 单元测试覆盖率 >80%

### Phase 3 (Week 3-5)
- [ ] Genesis Prompt 端到端流程正常
- [ ] 进度报告实时更新
- [ ] 异常告警触发正常
- [ ] HMAC 认证通过
- [ ] 集成测试全部通过

### Phase 4 (Week 6)
- [ ] 性能基准达标
- [ ] 安全测试通过
- [ ] 文档完整
- [ ] 生产部署就绪

---

*文档版本: 1.0.0*
*创建日期: 2026-02-25*
