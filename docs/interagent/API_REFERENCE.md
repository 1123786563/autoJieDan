# Interagent API Reference

> 完整 API 参考文档

## 目录

1. [任务管理 (Task Management)](#任务管理)
2. [密钥管理 (Key Management)](#密钥管理)
3. [TLS 管理 (TLS Management)](#tls管理)
4. [访问控制 (Access Control)](#访问控制)
5. [重试机制 (Retry Mechanism)](#重试机制)
6. [租约管理 (Lease Management)](#租约管理)
7. [进度报告 (Progress Reporting)](#进度报告)
8. [资源追踪 (Resource Tracking)](#资源追踪)
9. [异常检测 (Anomaly Detection)](#异常检测)
10. [事件广播 (Event Broadcasting)](#事件广播)
11. [Genesis Prompt](#genesis-prompt)

---

## 任务管理

### TaskManager (TypeScript)

任务管理器负责创建、更新和查询任务。

#### 构造函数

```typescript
new TaskManager(config: TaskManagerConfig)
```

**配置选项：**

| 字段 | 类型 | 必需 | 默认值 | 描述 |
|------|------|------|--------|------|
| `dbPath` | string | 是 | - | SQLite 数据库路径 |
| `maxRetries` | number | 否 | 3 | 最大重试次数 |
| `retryDelay` | number | 否 | 1000 | 重试延迟 (ms) |

#### 方法

##### createTask

创建新任务。

```typescript
createTask(options: CreateTaskOptions): Task
```

**参数：**

| 字段 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `type` | string | 是 | 任务类型 |
| `priority` | "low" \| "normal" \| "high" \| "critical" | 否 | 优先级 |
| `payload` | Record<string, unknown> | 否 | 任务负载数据 |
| `targetAgent` | string | 否 | 目标代理 ID |
| `timeout` | number | 否 | 超时时间 (ms) |

**返回值：**

```typescript
interface Task {
  id: string;                    // ULID 任务 ID
  type: string;                  // 任务类型
  status: TaskStatus;            // pending | running | completed | failed | cancelled
  priority: TaskPriority;        // low | normal | high | critical
  input: Record<string, unknown>; // 输入数据
  output?: Record<string, unknown>; // 输出数据
  error?: string;                // 错误信息
  targetAgent?: string;          // 目标代理
  leaseExpiresAt?: number;       // 租约过期时间
  retryCount: number;            // 重试次数
  createdAt: number;             // 创建时间
  updatedAt: number;             // 更新时间
}
```

##### getTask

获取任务详情。

```typescript
getTask(id: string): Task | undefined
```

##### updateTaskStatus

更新任务状态。

```typescript
updateTaskStatus(id: string, status: TaskStatus, output?: Record<string, unknown>, error?: string): Task | undefined
```

##### getPendingTasks

获取所有待处理任务。

```typescript
getPendingTasks(): Task[]
```

##### acquireLease

获取任务租约。

```typescript
acquireLease(taskId: string, ownerId: string, duration: number): Lease | null
```

**参数：**

| 字段 | 类型 | 描述 |
|------|------|------|
| `taskId` | string | 任务 ID |
| `ownerId` | string | 租约持有者 ID |
| `duration` | number | 租约持续时间 (ms) |

**返回值：**

```typescript
interface Lease {
  taskId: string;
  ownerId: string;
  expiresAt: number;
  acquiredAt: number;
}
```

##### releaseLease

释放任务租约。

```typescript
releaseLease(taskId: string): boolean
```

---

## 密钥管理

### KeyManager

管理加密密钥的生成、轮换和撤销。

#### 工厂函数

```typescript
// TypeScript
import { createKeyManager, KeyManagerConfig } from "./interagent/key-manager";

const keyManager = createKeyManager({
  keyStorePath: "./keys",
  autoRotate: false,
  rotationDays: 90,
});

# Python
from nanobot.interagent.key_manager import create_key_manager, KeyManagerConfig

key_manager = create_key_manager(KeyManagerConfig(
    storage=MemoryKeyStorage(),
    auto_rotate=False,
    rotation_days=90,
))
```

#### 方法

##### generateKey

生成新密钥。

```typescript
// TypeScript
await keyManager.generateKey(purpose: KeyPurpose, options?: KeyOptions): Promise<KeyInfo>

# Python
key_manager.generate_key(purpose: str, name: str) -> KeyInfo
```

**用途类型：**
- `encryption` - 加密密钥
- `signing` - 签名密钥
- `api` - API 密钥

**返回值：**

```typescript
interface KeyInfo {
  id: string;
  name: string;
  purpose: string;
  algorithm: string;
  status: "active" | "revoked" | "expired";
  createdAt: Date;
  expiresAt?: Date;
  rotatedAt?: Date;
}
```

##### getKey

获取密钥信息。

```typescript
await keyManager.getKey(id: string): Promise<KeyInfo | null>
```

##### validateKey

验证密钥是否有效。

```typescript
// TypeScript
await keyManager.validateKey(id: string): Promise<boolean>

# Python (async)
await key_manager.validate_key(id: str) -> bool
```

##### rotateKey

轮换密钥。

```typescript
await keyManager.rotateKey(id: string): Promise<KeyInfo>
```

##### revokeKey

撤销密钥。

```typescript
await keyManager.revokeKey(id: string): Promise<void>
```

##### listKeys

列出所有密钥。

```typescript
await keyManager.listKeys(filter?: KeyFilter): Promise<KeyInfo[]>
```

---

## TLS 管理

### TLSManager

管理 TLS 证书的生成、验证和续期。

#### 工厂函数

```typescript
// TypeScript
import { createTLSManager, TLSManagerConfig } from "./interagent/tls-manager";

const tlsManager = createTLSManager({
  certStorePath: "./certs",
  autoRenew: false,
  renewDaysBefore: 30,
});

# Python
from nanobot.interagent.tls_manager import create_tls_manager, TLSManagerConfig

tls_manager = create_tls_manager(TLSManagerConfig(
    cert_store_path="./certs",
    auto_renew=False,
))
```

#### 方法

##### generateSelfSignedCertificate

生成自签名证书。

```typescript
tlsManager.generateSelfSignedCertificate(options: CertificateOptions): CertificateResult
```

**选项：**

```typescript
interface CertificateOptions {
  certType: "server" | "client" | "ca";
  subject: CertificateSubject;
  days: number;
  keyType: "rsa" | "ecdsa";
  keySize?: number;
  sans?: string[];
}

interface CertificateSubject {
  commonName: string;
  organization?: string;
  organizationalUnit?: string;
  locality?: string;
  state?: string;
  country?: string;
}
```

**返回值：**

```typescript
interface CertificateResult {
  cert: string;      // PEM 格式证书
  key: string;       // PEM 格式私钥
  info: CertificateInfo;
}

interface CertificateInfo {
  id: string;
  type: string;
  subject: CertificateSubject;
  issuer: CertificateSubject;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
  status: "valid" | "expired" | "revoked";
}
```

##### validateCertificate

验证证书有效性。

```typescript
tlsManager.validateCertificate(id: string): CertificateValidationResult
```

##### renewCertificate

续期证书。

```typescript
tlsManager.renewCertificate(id: string): CertificateResult
```

##### revokeCertificate

撤销证书。

```typescript
tlsManager.revokeCertificate(id: string): void
```

---

## 访问控制

### AccessControlManager

实现 RBAC 和 ACL 访问控制。

#### 工厂函数

```typescript
// TypeScript
import { createAccessControlManager, AccessControlConfig } from "./interagent/access-control";

const acManager = createAccessControlManager({
  defaultPolicy: "deny",
  enableInheritance: true,
  enableConditions: true,
});

# Python
from nanobot.interagent.access_control import (
    create_access_control_manager,
    AccessControlConfig,
)

ac_manager = create_access_control_manager(AccessControlConfig(
    default_policy="deny",
    enable_inheritance=True,
    enable_conditions=True,
))
```

#### 类型定义

```typescript
// TypeScript
type SubjectType = "user" | "agent" | "service" | "system";
type ResourceType = "task" | "agent" | "system" | "data" | "config";
type PermissionAction = "create" | "read" | "update" | "delete" | "execute" | "admin";

# Python
class SubjectType(Enum):
    USER = "user"
    AGENT = "agent"
    SERVICE = "service"
    SYSTEM = "system"

class ResourceType(Enum):
    TASK = "task"
    AGENT = "agent"
    SYSTEM = "system"
    DATA = "data"
    CONFIG = "config"

class PermissionAction(Enum):
    CREATE = "create"
    READ = "read"
    UPDATE = "update"
    DELETE = "delete"
    EXECUTE = "execute"
    ADMIN = "admin"
```

#### 方法

##### registerSubject

注册主体。

```typescript
// TypeScript
acManager.registerSubject(subject: Subject): void

# Python
ac_manager.register_subject(subject: Subject) -> None
```

```typescript
interface Subject {
  id: string;
  type: SubjectType;
  roles: string[];
  attributes: Record<string, unknown>;
  createdAt: Date;
}
```

##### checkAccess

检查访问权限。

```typescript
// TypeScript
const decision = acManager.checkAccess(request: AccessRequest): AccessDecision

# Python
decision = ac_manager.check_access(request: AccessRequest) -> AccessDecision
```

```typescript
interface AccessRequest {
  subjectId: string;
  resource: ResourceType;
  resourceId: string;
  action: PermissionAction;
  context?: Record<string, unknown>;
}

interface AccessDecision {
  allowed: boolean;
  reason: string;
  policies?: string[];
  expiresAt?: number;
}
```

##### grantPermission

授予权限策略。

```typescript
acManager.grantPermission(policy: PermissionPolicy): string
```

```typescript
interface PermissionPolicy {
  id?: string;
  name: string;
  description?: string;
  subjects: string[];
  resources: string[];
  actions: string[];
  effect: "allow" | "deny";
  conditions?: PermissionCondition[];
}
```

##### revokePermission

撤销权限策略。

```typescript
acManager.revokePermission(policyId: string): boolean
```

---

## 重试机制

### RetryConfig

```typescript
// TypeScript
import { RetryConfig, retrySafe } from "./interagent/retry";

const config: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  jitter: true,
};

const result = await retrySafe(async () => {
  // 可能失败的操作
  return await someOperation();
}, config);

if (result.success) {
  console.log("Result:", result.value);
} else {
  console.log("Error:", result.error);
}

# Python
from nanobot.interagent.retry import RetryConfig, retry_with_backoff

config = RetryConfig(
    max_retries=3,
    initial_delay=1.0,
    max_delay=30.0,
    backoff_factor=2.0,
    jitter=True,
)

result = retry_with_backoff(some_operation, config)
```

### 返回值

```typescript
interface RetryResult<T> {
  success: boolean;
  value?: T;
  error?: string;
  totalAttempts: number;
  totalTime: number;
}
```

---

## 租约管理

### LeaseManager

```python
# Python
from nanobot.interagent.lease import LeaseManager

lease_manager = LeaseManager(default_duration=60000)  # 60 seconds

# 获取租约
lease = lease_manager.acquire("task-1", "agent-1", 60000)
if lease:
    print(f"Lease acquired until {lease.expires_at}")

# 检查租约
if lease_manager.is_valid("task-1"):
    print("Lease is valid")

# 释放租约
lease_manager.release("task-1")
```

---

## 进度报告

### ProgressReporter

```typescript
// TypeScript
import { ProgressReporter } from "./interagent/progress-reporter";

const reporter = new ProgressReporter({
  taskId: "task-1",
  totalSteps: 10,
});

reporter.update(5, "Processing step 5");
reporter.complete({ result: "done" });

# Python
from nanobot.interagent.progress_reporter import ProgressReporter

reporter = ProgressReporter(task_id="task-1", total_steps=10)
reporter.update(5, "Processing step 5")
reporter.complete({"result": "done"})
```

### 进度状态

```typescript
interface Progress {
  taskId: string;
  currentStep: number;
  totalSteps: number;
  status: "in_progress" | "completed" | "failed";
  message?: string;
  percentage: number;
  startedAt: number;
  updatedAt: number;
  estimatedTimeRemaining?: number;
}
```

---

## 资源追踪

### ResourceTracker

```typescript
// TypeScript
import { ResourceTracker } from "./interagent/resource-tracker";

const tracker = new ResourceTracker();

// 记录使用
tracker.recordUsage({
  agentId: "agent-1",
  taskType: "process_data",
  tokens: { input: 1000, output: 500 },
  cost: 0.05,
  duration: 2000,
});

// 获取统计
const stats = tracker.getStats("agent-1", { period: "24h" });
console.log(`Total tokens: ${stats.totalTokens}`);
console.log(`Total cost: $${stats.totalCost}`);
```

---

## 异常检测

### AnomalyDetector

```typescript
// TypeScript
import { AnomalyDetector } from "./interagent/anomaly-detector";

const detector = new AnomalyDetector({
  thresholds: {
    errorRate: 0.1,      // 10% 错误率
    latency: 5000,       // 5 秒延迟
    costSpike: 2.0,      // 2 倍成本突增
  },
});

// 检测异常
const anomalies = detector.detect(metrics);
for (const anomaly of anomalies) {
  console.log(`Anomaly: ${anomaly.type} - ${anomaly.severity}`);
}
```

---

## 事件广播

### EventBroadcaster

```typescript
// TypeScript
import { EventBroadcaster } from "./interagent/event-broadcaster";

const broadcaster = new EventBroadcaster();

// 广播事件
broadcaster.broadcast({
  type: "task.completed",
  taskId: "task-1",
  timestamp: Date.now(),
  data: { result: "success" },
});

// 订阅事件
broadcaster.subscribe("task.*", (event) => {
  console.log(`Event: ${event.type}`);
});
```

---

## Genesis Prompt

### GenesisPromptManager

```python
# Python
from nanobot.interagent.genesis_prompt import GenesisPromptManager

manager = GenesisPromptManager()

# 创建提示
prompt = manager.create_prompt(
    task_type="process_data",
    context={
        "input": "data",
        "requirements": ["fast", "accurate"],
    },
)

# 执行
result = manager.execute(prompt)
print(f"Result: {result.output}")
```

### GenesisPrompt 结构

```typescript
interface GenesisPrompt {
  id: string;
  taskType: string;
  context: Record<string, unknown>;
  instructions: string[];
  constraints: string[];
  expectedOutput: string;
  createdAt: number;
}
```

---

## 错误代码

| 代码 | 描述 |
|------|------|
| `ERR_TASK_NOT_FOUND` | 任务不存在 |
| `ERR_TASK_ALREADY_COMPLETED` | 任务已完成 |
| `ERR_LEASE_NOT_ACQUIRED` | 租约获取失败 |
| `ERR_LEASE_EXPIRED` | 租约已过期 |
| `ERR_KEY_NOT_FOUND` | 密钥不存在 |
| `ERR_KEY_REVOKED` | 密钥已撤销 |
| `ERR_ACCESS_DENIED` | 访问被拒绝 |
| `ERR_SUBJECT_NOT_FOUND` | 主体不存在 |
| `ERR_CERT_EXPIRED` | 证书已过期 |
| `ERR_CERT_REVOKED` | 证书已撤销 |
| `ERR_VALIDATION_FAILED` | 验证失败 |
| `ERR_RATE_LIMITED` | 请求频率受限 |

---

## 配置常量

```typescript
// 默认配置
const DEFAULTS = {
  TASK_MAX_RETRIES: 3,
  TASK_RETRY_DELAY: 1000,        // ms
  LEASE_DEFAULT_DURATION: 60000, // ms
  KEY_ROTATION_DAYS: 90,
  CERT_RENEW_DAYS_BEFORE: 30,
  WS_HEARTBEAT_INTERVAL: 30000,  // ms
  WS_CONNECTION_TIMEOUT: 10000,  // ms
  API_RATE_LIMIT: 100,           // requests/min
};
```

---

## 类型定义完整列表

参见：
- TypeScript: `automaton/src/interagent/types.ts`
- Python: `nanobot/nanobot/interagent/types.py`
