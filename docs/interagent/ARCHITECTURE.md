# Interagent 系统架构

> 双系统通信协议架构设计

## 系统概览

Interagent 是 Automaton (TypeScript) 和 Nanobot (Python) 双系统之间的通信协议实现。它提供了任务分发、进度跟踪、资源管理和安全保障等核心功能。

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Interagent System                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│    ┌──────────────────────────────────────────────────────────────┐     │
│    │                      Application Layer                         │     │
│    │  ┌─────────────────┐         ┌─────────────────────┐          │     │
│    │  │    Automaton    │         │      Nanobot        │          │     │
│    │  │   (TypeScript)  │         │     (Python)        │          │     │
│    │  │                 │         │                     │          │     │
│    │  │ - Task Dispatch │         │ - Task Processing   │          │     │
│    │  │ - Progress Rpt  │         │ - Progress Report   │          │     │
│    │  │ - Resource Mgmt │         │ - Resource Track    │          │     │
│    │  └─────────────────┘         └─────────────────────┘          │     │
│    └──────────────────────────────────────────────────────────────┘     │
│                                   │                                      │
│                                   ▼                                      │
│    ┌──────────────────────────────────────────────────────────────┐     │
│    │                     Communication Layer                        │     │
│    │                                                                │     │
│    │   ┌────────────┐    ┌────────────┐    ┌────────────┐          │     │
│    │   │ HTTP API   │    │ WebSocket  │    │  Events    │          │     │
│    │   │  RESTful   │    │  Real-time │    │ Broadcast  │          │     │
│    │   └────────────┘    └────────────┘    └────────────┘          │     │
│    └──────────────────────────────────────────────────────────────┘     │
│                                   │                                      │
│                                   ▼                                      │
│    ┌──────────────────────────────────────────────────────────────┐     │
│    │                       Security Layer                           │     │
│    │                                                                │     │
│    │   ┌────────────┐    ┌────────────┐    ┌────────────┐          │     │
│    │   │Key Manager │    │TLS Manager │    │Access Ctrl │          │     │
│    │   │ HMAC/RSA   │    │ Cert/PKI   │    │ RBAC/ACL   │          │     │
│    │   └────────────┘    └────────────┘    └────────────┘          │     │
│    └──────────────────────────────────────────────────────────────┘     │
│                                   │                                      │
│                                   ▼                                      │
│    ┌──────────────────────────────────────────────────────────────┐     │
│    │                        Task Layer                              │     │
│    │                                                                │     │
│    │   ┌────────────┐    ┌────────────┐    ┌────────────┐          │     │
│    │   │Task Manager│    │   Lease    │    │   Retry    │          │     │
│    │   │  SQLite    │    │  Locking   │    │ Backoff    │          │     │
│    │   └────────────┘    └────────────┘    └────────────┘          │     │
│    └──────────────────────────────────────────────────────────────┘     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## 核心模块

### 1. 通信层 (Communication Layer)

#### HTTP API Server

- **Automaton (TypeScript)**: Fastify 框架
- **Nanobot (Python)**: FastAPI 框架

**端点设计:**

```
Automaton (Port 18790):
├── POST   /api/v1/task           创建任务
├── GET    /api/v1/task/:id       获取任务
├── PUT    /api/v1/task/:id       更新任务
├── DELETE /api/v1/task/:id       删除任务
└── GET    /api/v1/health         健康检查

Nanobot (Port 18791):
├── GET    /api/v1/task/next      获取下一个任务
├── POST   /api/v1/task/:id/lease 获取租约
├── POST   /api/v1/task/:id/report 提交报告
└── GET    /api/v1/health         健康检查
```

#### WebSocket Server

双向实时通信，支持：
- 任务状态推送
- 进度更新
- 异常告警
- 心跳检测

### 2. 安全层 (Security Layer)

#### 密钥管理 (Key Manager)

```
┌──────────────────────────────────────┐
│           Key Manager                 │
├──────────────────────────────────────┤
│  ┌─────────────────────────────────┐ │
│  │ Key Generation                  │ │
│  │ - RSA (2048/4096 bits)          │ │
│  │ - AES (128/256 bits)            │ │
│  │ - HMAC-SHA256                   │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Key Rotation                    │ │
│  │ - Auto-rotation (90 days)       │ │
│  │ - Manual rotation               │ │
│  │ - Key versioning                │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Key Storage                     │ │
│  │ - Memory (testing)              │ │
│  │ - File (production)             │ │
│  │ - HSM (enterprise)              │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

#### TLS 管理 (TLS Manager)

```
┌──────────────────────────────────────┐
│           TLS Manager                 │
├──────────────────────────────────────┤
│  ┌─────────────────────────────────┐ │
│  │ Certificate Management          │ │
│  │ - Self-signed generation        │ │
│  │ - CA-signed requests            │ │
│  │ - Certificate renewal           │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Certificate Validation          │ │
│  │ - Chain verification            │ │
│  │ - Expiration check              │ │
│  │ - Revocation check (CRL/OCSP)   │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ TLS Configuration               │ │
│  │ - TLS 1.2+ only                 │ │
│  │ - Cipher suite selection        │ │
│  │ - Client certificate auth       │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

#### 访问控制 (Access Control)

```
┌──────────────────────────────────────┐
│       Access Control Manager          │
├──────────────────────────────────────┤
│  ┌─────────────────────────────────┐ │
│  │ Subject Management              │ │
│  │ - User registration             │ │
│  │ - Service accounts              │ │
│  │ - Role assignment               │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Policy Engine                   │ │
│  │ - RBAC (Role-Based)             │ │
│  │ - ACL (Access Control List)     │ │
│  │ - ABAC (Attribute-Based)        │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Permission Check                │ │
│  │ - Resource: Task/System/Config  │ │
│  │ - Action: Read/Write/Admin      │ │
│  │ - Condition: Time/IP/Attribute  │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

### 3. 任务层 (Task Layer)

#### 任务管理器 (Task Manager)

```
┌──────────────────────────────────────┐
│          Task Manager                 │
├──────────────────────────────────────┤
│  ┌─────────────────────────────────┐ │
│  │ SQLite Database (WAL mode)      │ │
│  │ - tasks表                       │ │
│  │ - leases表                      │ │
│  │ - dead_letter_queue表           │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Task Lifecycle                  │ │
│  │                                 │ │
│  │   pending ──> running ──> done  │ │
│  │      │          │               │ │
│  │      │          └──> failed     │ │
│  │      │                 │        │ │
│  │      └────> cancelled <┘        │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Lease Management                │ │
│  │ - TTL-based expiration          │ │
│  │ - Automatic release             │ │
│  │ - Owner verification            │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

#### 任务状态机

```
┌─────────┐   acquire   ┌─────────┐   complete   ┌───────────┐
│ pending │ ──────────> │ running │ ──────────> │ completed │
└─────────┘             └─────────┘             └───────────┘
      │                       │
      │ cancel                │ fail
      │                       │
      ▼                       ▼
┌───────────┐           ┌─────────┐
│ cancelled │           │  failed │
└───────────┘           └─────────┘
                              │
                              │ retry
                              ▼
                          ┌─────────┐
                          │ pending │
                          └─────────┘
```

#### 重试机制

```
┌──────────────────────────────────────┐
│          Retry Mechanism              │
├──────────────────────────────────────┤
│  ┌─────────────────────────────────┐ │
│  │ Exponential Backoff             │ │
│  │                                 │ │
│  │  delay = base * (2 ^ attempt)   │ │
│  │  + jitter (random 0-1)          │ │
│  │                                 │ │
│  │  Example: base=1s               │ │
│  │  Attempt 1: 1s + jitter         │ │
│  │  Attempt 2: 2s + jitter         │ │
│  │  Attempt 3: 4s + jitter         │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Retry Policy                    │ │
│  │ - Max retries: 3 (configurable) │ │
│  │ - Max delay: 30s                │ │
│  │ - Retryable errors only         │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

### 4. 报告层 (Reporting Layer)

#### 进度报告

```
┌──────────────────────────────────────┐
│         Progress Reporter             │
├──────────────────────────────────────┤
│  ┌─────────────────────────────────┐ │
│  │ Progress Tracking               │ │
│  │ - percentage: 0-100             │ │
│  │ - currentStep: string           │ │
│  │ - totalSteps: number            │ │
│  │ - ETA: timestamp                │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Report Types                    │ │
│  │ - Status update                 │ │
│  │ - Milestone reached             │ │
│  │ - Error occurred                │ │
│  │ - Resource usage                │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

#### 资源追踪

```
┌──────────────────────────────────────┐
│        Resource Tracker               │
├──────────────────────────────────────┤
│  ┌─────────────────────────────────┐ │
│  │ Token Tracking                  │ │
│  │ - Input tokens                  │ │
│  │ - Output tokens                 │ │
│  │ - Total per task/agent          │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Cost Calculation                │ │
│  │ - Per-model pricing             │ │
│  │ - Accumulated cost              │ │
│  │ - Budget tracking               │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Duration Tracking               │ │
│  │ - Task duration                 │ │
│  │ - Wait time                     │ │
│  │ - Processing time               │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

#### 异常检测

```
┌──────────────────────────────────────┐
│       Anomaly Detector                │
├──────────────────────────────────────┤
│  ┌─────────────────────────────────┐ │
│  │ Detection Rules                 │ │
│  │ - Error rate threshold          │ │
│  │ - Latency threshold             │ │
│  │ - Cost spike detection          │ │
│  │ - Pattern anomalies             │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Alert Levels                    │ │
│  │ - Info: Minor deviation         │ │
│  │ - Warning: Moderate issue       │ │
│  │ - Critical: Severe problem      │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Actions                         │ │
│  │ - Log alert                     │ │
│  │ - Notify subscribers            │ │
│  │ - Trigger auto-recovery         │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

## 数据流

### 任务创建流程

```
┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────┐
│ Client  │────>│ Automaton   │────>│ Task Queue  │────>│  DB     │
│         │     │ HTTP API    │     │ (SQLite)    │     │         │
└─────────┘     └─────────────┘     └─────────────┘     └─────────┘
                      │
                      │ WebSocket Event
                      ▼
                ┌─────────────┐
                │  Nanobot    │
                │ Subscriber  │
                └─────────────┘
```

### 任务执行流程

```
┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────┐
│ Nanobot │────>│ Get Next    │────>│ Acquire     │────>│ Execute │
│ Poller  │     │ Task        │     │ Lease       │     │ Task    │
└─────────┘     └─────────────┘     └─────────────┘     └─────────┘
                                                              │
                      ┌───────────────────────────────────────┘
                      │
                      ▼
┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────┐
│ Submit  │<────│ Generate    │<────│ Track       │<────│ Process │
│ Report  │     │ Report      │     │ Progress    │     │ Result  │
└─────────┘     └─────────────┘     └─────────────┘     └─────────┘
     │
     ▼
┌─────────────┐
│  Automaton  │
│  Receiver   │
└─────────────┘
```

## 安全架构

### 认证流程

```
┌─────────┐                         ┌─────────────┐
│ Client  │                         │   Server    │
└─────────┘                         └─────────────┘
     │                                    │
     │ 1. Request + Timestamp             │
     │───────────────────────────────────>│
     │                                    │
     │                    2. Verify Timestamp
     │                       (within 5 min window)
     │                                    │
     │                    3. Lookup API Key
     │                                    │
     │                    4. Verify HMAC Signature
     │                       HMAC-SHA256(payload, key)
     │                                    │
     │ 5. Response                        │
     │<───────────────────────────────────│
     │                                    │
```

### 授权检查

```
┌──────────────────────────────────────────────────────────┐
│                    Access Control Flow                    │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  1. Identify Subject                                      │
│     └──> Lookup subject by ID                             │
│                                                           │
│  2. Check Default Policy                                  │
│     └──> If "deny", require explicit allow                │
│                                                           │
│  3. Evaluate Policies                                     │
│     ├──> Check RBAC roles                                 │
│     ├──> Check ACL entries                                │
│     └──> Evaluate ABAC conditions                         │
│                                                           │
│  4. Apply Inheritance                                     │
│     └──> Parent policies may grant access                 │
│                                                           │
│  5. Return Decision                                       │
│     └──> allowed: true/false + reason                     │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

## 部署架构

### 单机部署

```
┌─────────────────────────────────────────────────────────┐
│                    Single Host                           │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────┐      ┌──────────────────┐         │
│  │   Automaton      │      │    Nanobot       │         │
│  │   :18790         │      │    :18791        │         │
│  └────────┬─────────┘      └────────┬─────────┘         │
│           │                         │                    │
│           │    ┌─────────────────┐  │                    │
│           └───>│  SQLite DB      │<─┘                    │
│                │  tasks.db       │                       │
│                └─────────────────┘                       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 分布式部署

```
┌─────────────────────────────────────────────────────────┐
│                    Load Balancer                         │
└───────────────────────────┬─────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
            ▼               ▼               ▼
     ┌──────────┐    ┌──────────┐    ┌──────────┐
     │Automaton1│    │Automaton2│    │Automaton3│
     └────┬─────┘    └────┬─────┘    └────┬─────┘
          │               │               │
          └───────────────┼───────────────┘
                          │
                          ▼
               ┌──────────────────┐
               │  Shared Storage  │
               │  (NFS/S3)        │
               └──────────────────┘
                          │
            ┌─────────────┼─────────────┐
            │             │             │
            ▼             ▼             ▼
     ┌──────────┐  ┌──────────┐  ┌──────────┐
     │Nanobot 1 │  │Nanobot 2 │  │Nanobot 3 │
     └──────────┘  └──────────┘  └──────────┘
```

## 性能考虑

### 数据库优化

- WAL 模式启用
- 适当的索引（status, priority, target_agent）
- 连接池管理
- 定期 VACUUM

### 并发处理

- 任务级别锁（租约机制）
- 乐观并发控制
- 死锁检测和恢复

### 缓存策略

- 密钥缓存（带 TTL）
- 权限决策缓存
- 任务状态缓存

## 监控和日志

### 健康检查端点

```json
GET /api/v1/health
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600,
  "components": {
    "database": "healthy",
    "keyManager": "healthy",
    "tlsManager": "healthy"
  }
}
```

### 日志格式

```
[timestamp] [level] [component] message {metadata}
```

示例:
```
2026-02-26T10:00:00Z INFO task-manager Task created {"taskId": "01HXYZ...", "type": "process_data"}
```

## 扩展性

### 插件系统

系统支持通过插件扩展功能：

1. **任务处理器插件** - 自定义任务类型处理
2. **认证插件** - 自定义认证方法
3. **存储插件** - 自定义存储后端
4. **告警插件** - 自定义告警通道

### 事件钩子

```typescript
// 任务生命周期钩子
onTaskCreated(task: Task): void
onTaskStarted(task: Task): void
onTaskCompleted(task: Task): void
onTaskFailed(task: Task, error: Error): void
```
