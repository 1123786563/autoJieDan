# Interagent Communication System

> 双系统通信协议 - Automaton (TypeScript) + Nanobot (Python)

## 概述

Interagent 是一个用于 Automaton 和 Nanobot 双系统之间安全、可靠通信的协议实现。它提供了任务分发、进度跟踪、资源管理和安全保障等核心功能。

## 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                     Interagent Communication                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐         ┌──────────────────┐              │
│  │    Automaton     │         │     Nanobot      │              │
│  │   (TypeScript)   │◄───────►│     (Python)     │              │
│  └──────────────────┘         └──────────────────┘              │
│                                                                  │
│  通信层: HTTP API + WebSocket                                    │
│  安全层: HMAC 签名 + TLS 加密 + 访问控制                         │
│  任务层: 任务队列 + 租约机制 + 重试策略                          │
│  报告层: 进度报告 + 资源追踪 + 异常检测                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 模块列表

### Week 1-2: 通信层基础

| 模块 | TypeScript | Python | 描述 |
|------|------------|--------|------|
| 共享类型 | `types.ts` | `types.py` | 跨系统类型定义 |
| 任务管理器 | `task-manager.ts` | - | SQLite 任务队列 |
| WebSocket | `websocket.ts` | `websocket.py` | 双向实时通信 |
| 健康服务 | `health-server.ts` | `health_server.py` | 健康检查端点 |
| 租约管理 | `lease.ts` | `lease.py` | 任务租约机制 |

### Week 2: 可靠性保障

| 模块 | TypeScript | Python | 描述 |
|------|------------|--------|------|
| 重试机制 | `retry.ts` | `retry.py` | 指数退避重试 |
| 幂等性 | `idempotency.ts` | - | 请求幂等处理 |
| 死信队列 | `dlq.ts` | - | 失败任务存储 |
| 任务生命周期 | `task-lifecycle.ts` | `task_lifecycle.py` | 状态机管理 |
| 过滤器 | - | `filters.py` | 任务过滤 |
| 轮询器 | - | `poller.py` | 任务轮询 |

### Week 3-4: Genesis Prompt 与报告

| 模块 | TypeScript | Python | 描述 |
|------|------------|--------|------|
| Genesis Prompt | `genesis-prompt.ts` | `genesis_prompt.py` | 任务分发核心 |
| 任务分发器 | `task-dispatcher.ts` | - | 智能任务路由 |
| 预算管理 | `budget-manager.ts` | - | Token 预算控制 |
| 进度报告 | `progress-reporter.ts` | `progress_reporter.py` | 进度跟踪 |
| 进度管理 | - | `progress.py` | 进度状态管理 |
| 报告器 | - | `reporter.py` | 报告生成 |

### Week 4: 资源与异常

| 模块 | TypeScript | Python | 描述 |
|------|------------|--------|------|
| 资源追踪 | `resource-tracker.ts` | `resource_tracker.py` | Token/成本追踪 |
| 异常检测 | `anomaly-detector.ts` | `anomaly_detector.py` | 异常检测告警 |
| 事件广播 | `event-broadcaster.ts` | `event_broadcaster.py` | WebSocket 事件 |

### Week 5: 安全与认证

| 模块 | TypeScript | Python | 描述 |
|------|------------|--------|------|
| 密钥管理 | `key-manager.ts` | `key_manager.py` | 密钥生成/轮换 |
| TLS 管理 | `tls-manager.ts` | `tls_manager.py` | 证书管理 |
| 访问控制 | `access-control.ts` | `access_control.py` | RBAC/ACL |

## 快速开始

### TypeScript (Automaton)

```typescript
import { TaskManager } from "./interagent/task-manager";
import { createKeyManager } from "./interagent/key-manager";
import { createAccessControlManager } from "./interagent/access-control";

// 创建任务管理器
const taskManager = new TaskManager({
  dbPath: "./tasks.db",
  maxRetries: 3,
});
taskManager.start();

// 创建任务
const task = taskManager.createTask({
  type: "process_data",
  priority: "normal",
  payload: { input: "data" },
  targetAgent: "nanobot-1",
});

// 获取待处理任务
const pending = taskManager.getPendingTasks();

// 创建密钥管理器
const keyManager = createKeyManager({
  keyStorePath: "./keys",
  autoRotate: true,
});

// 生成密钥
const key = await keyManager.generateKey("encryption", {
  name: "api-key",
});

// 创建访问控制管理器
const acManager = createAccessControlManager({
  defaultPolicy: "deny",
  enableInheritance: true,
});

// 注册主体
acManager.registerSubject({
  id: "user-1",
  type: "user",
  roles: ["admin"],
  attributes: {},
  createdAt: new Date(),
});

// 检查访问权限
const decision = acManager.checkAccess({
  subjectId: "user-1",
  resource: "task",
  resourceId: "task-1",
  action: "read",
});
```

### Python (Nanobot)

```python
from nanobot.interagent.key_manager import create_key_manager, KeyManagerConfig
from nanobot.interagent.access_control import (
    create_access_control_manager,
    AccessControlConfig,
    Subject,
    SubjectType,
    AccessRequest,
    ResourceType,
    PermissionAction,
)
from nanobot.interagent.lease import LeaseManager
from nanobot.interagent.retry import RetryConfig, retry_with_backoff
from nanobot.interagent.genesis_prompt import GenesisPromptManager

# 创建密钥管理器
key_manager = create_key_manager(KeyManagerConfig(
    storage=MemoryKeyStorage(),
    auto_rotate=True,
))

# 生成密钥
key = key_manager.generate_key(purpose="encryption", name="api-key")

# 创建访问控制管理器
ac_manager = create_access_control_manager(AccessControlConfig(
    default_policy="deny",
    enable_inheritance=True,
))

# 注册主体
user = Subject(
    id="user-1",
    type=SubjectType.USER,
    roles=["admin"],
    attributes={},
    created_at=datetime.now(),
)
ac_manager.register_subject(user)

# 检查访问权限
request = AccessRequest(
    subject_id="user-1",
    resource=ResourceType.TASK,
    resource_id="task-1",
    action=PermissionAction.READ,
)
decision = ac_manager.check_access(request)

# 重试机制
config = RetryConfig(max_retries=3, initial_delay=1.0, backoff_factor=2.0)
result = retry_with_backoff(some_operation, config)

# Genesis Prompt 管理
genesis = GenesisPromptManager()
prompt = genesis.create_prompt(task_type="process_data", context={})
```

## API 参考

### 任务管理器 (TaskManager)

| 方法 | 描述 |
|------|------|
| `createTask(options)` | 创建新任务 |
| `getTask(id)` | 获取任务 |
| `updateTaskStatus(id, status)` | 更新任务状态 |
| `getPendingTasks()` | 获取待处理任务列表 |
| `acquireLease(taskId, ownerId, duration)` | 获取任务租约 |
| `releaseLease(taskId)` | 释放租约 |
| `start()` | 启动管理器 |
| `stop()` | 停止管理器 |

### 密钥管理器 (KeyManager)

| 方法 | 描述 |
|------|------|
| `generateKey(purpose, options)` | 生成新密钥 |
| `getKey(id)` | 获取密钥 |
| `validateKey(id)` | 验证密钥有效性 |
| `rotateKey(id)` | 轮换密钥 |
| `revokeKey(id)` | 撤销密钥 |
| `listKeys(filter)` | 列出密钥 |

### 访问控制 (AccessControlManager)

| 方法 | 描述 |
|------|------|
| `registerSubject(subject)` | 注册主体 |
| `getSubject(id)` | 获取主体 |
| `checkAccess(request)` | 检查访问权限 |
| `grantPermission(policy)` | 授予权限 |
| `revokePermission(policyId)` | 撤销权限 |

### TLS 管理器 (TLSManager)

| 方法 | 描述 |
|------|------|
| `generateSelfSignedCertificate(options)` | 生成自签名证书 |
| `getCertificate(id)` | 获取证书 |
| `validateCertificate(id)` | 验证证书 |
| `renewCertificate(id)` | 续期证书 |
| `revokeCertificate(id)` | 撤销证书 |

## 配置选项

### TaskManagerConfig

```typescript
interface TaskManagerConfig {
  dbPath: string;        // 数据库路径
  maxRetries: number;    // 最大重试次数
  retryDelay: number;    // 重试延迟(ms)
}
```

### KeyManagerConfig

```typescript
interface KeyManagerConfig {
  storage: KeyStorage;   // 存储后端
  autoRotate: boolean;   // 自动轮换
  rotationDays: number;  // 轮换周期
}
```

### AccessControlConfig

```typescript
interface AccessControlConfig {
  defaultPolicy: "allow" | "deny";  // 默认策略
  enableInheritance: boolean;       // 启用继承
  enableConditions: boolean;        // 启用条件
}
```

## 安全最佳实践

1. **密钥管理**
   - 定期轮换密钥（建议 90 天）
   - 使用强密钥（RSA 2048+ 或 AES 256）
   - 不要在日志中暴露密钥材料

2. **访问控制**
   - 遵循最小权限原则
   - 使用 RBAC 角色分组
   - 定期审计权限

3. **TLS 配置**
   - 使用 TLS 1.2 或更高版本
   - 启用证书验证
   - 定期续期证书

4. **通信安全**
   - 所有通信使用 HTTPS/WSS
   - 验证请求签名
   - 实施请求时间戳防重放

## 测试覆盖

| 测试类型 | 文件 | 覆盖率 |
|----------|------|--------|
| 单元测试 | `*.test.ts` / `test_*.py` | >80% |
| 集成测试 | `e2e-integration.test.ts` | 通过 |
| 故障恢复 | `fault-recovery.test.ts` | 通过 |
| 性能基准 | `performance-benchmark.test.ts` | 通过 |
| 安全渗透 | `security-penetration.test.ts` | 通过 |

## 性能基准

基于测试环境（macOS, M1）的性能指标：

| 操作 | 吞吐量 | 平均延迟 |
|------|--------|----------|
| 任务创建 | 100+ tasks/sec | <5ms |
| 任务查询 | 500+ queries/sec | <2ms |
| 访问控制检查 | 10000+ checks/sec | <1ms |
| 密钥生成 | 5+ keys/sec | <200ms |
| 证书验证 | 500+ validations/sec | <2ms |

## 错误处理

系统使用统一的错误处理模式：

```typescript
// TypeScript
try {
  const result = await someOperation();
} catch (error) {
  if (error instanceof ValidationError) {
    // 处理验证错误
  } else if (error instanceof AuthorizationError) {
    // 处理授权错误
  }
}
```

```python
# Python
try:
    result = some_operation()
except ValidationError as e:
    # 处理验证错误
except AuthorizationError as e:
    # 处理授权错误
```

## 故障恢复

系统提供多层次的故障恢复机制：

1. **重试机制** - 指数退避重试，最大重试次数可配置
2. **租约机制** - 任务超时自动释放，防止死锁
3. **死信队列** - 失败任务存储，支持人工干预
4. **健康检查** - 定期健康检查，自动恢复

## 版本历史

| 版本 | 日期 | 描述 |
|------|------|------|
| 1.0.0 | 2026-02-26 | 初始发布 - 完整通信系统 |

## 贡献指南

1. 遵循现有代码风格
2. 添加适当的类型注解
3. 保持测试覆盖率 >80%
4. 提交前运行所有测试

## 许可证

MIT License
