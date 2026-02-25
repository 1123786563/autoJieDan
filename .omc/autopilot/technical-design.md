# Technical Architecture Design: Automaton + Nanobot Integration

> Fusion Architecture for TypeScript/Python Dual-Agent System

## Executive Summary

This document defines the technical architecture for integrating **Automaton** (TypeScript/Node.js) with **Nanobot** (Python) to create a unified dual-agent system where Automaton handles economic decisions, project management, and platform integration, while Nanobot handles technical execution, code generation, and customer communication.

---

## 1. System Overview

### 1.1 Component Responsibilities

| System | Language | Primary Responsibilities |
|--------|----------|-------------------------|
| **Automaton** | TypeScript | Economic decisions, project management, resource scheduling, blockchain operations, survival management, Conway Cloud integration |
| **Nanobot** | Python | Technical execution, code generation, testing, customer communication, multi-platform messaging |

### 1.2 Existing Architecture Patterns

**Automaton** (`/automaton/src/`):
- In-memory SQLite via `better-sqlite3` for state persistence
- Resilient HTTP client with circuit breaker (`conway/http-client.ts:22-121`)
- Policy engine for tool execution governance (`agent/policy-engine.ts`)
- Heartbeat daemon for scheduled tasks (`heartbeat/daemon.ts`)
- Conway API client for cloud operations (`conway/http-client.ts`)

**Nanobot** (`/nanobot/nanobot/`):
- Async message bus pattern (`bus/queue.py:8-45`)
- Channel abstraction for multi-platform support (`channels/base.py:12-132`)
- LiteLLM for multi-provider AI (`providers/litellm_provider.py`)
- MCP protocol support (`agent/tools/mcp.py`)
- Session management with memory consolidation (`session/manager.py`)

---

## 2. Communication Architecture

### 2.1 Protocol Selection: HTTP REST + WebSocket

**Decision**: Hybrid approach using:
- **HTTP REST** for synchronous request-response operations
- **WebSocket** for real-time events and streaming
- **Shared SQLite** for high-throughput task queue

**Rationale**:

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| HTTP REST only | Simple, stateless, easy debug | No real-time, polling overhead | Partial |
| gRPC | Strong typing, streaming | Complex setup, Python/TS friction | Rejected |
| Message Queue (Redis/RabbitMQ) | Decoupled, scalable | External dependency, ops overhead | Rejected |
| WebSocket only | Real-time | Connection management, no standard request pattern | Partial |
| **HTTP + WebSocket + SQLite** | Best of all, low latency, persistent queue | More code | **Selected** |

### 2.2 Service Architecture

```
+------------------+     HTTP REST      +------------------+
|    Automaton     |<------------------>|     Nanobot      |
|   (TypeScript)   |                    |     (Python)     |
|   Port: 18790    |<--- WebSocket ---->|   Port: 18791    |
+--------+---------+                    +--------+---------+
         |                                       |
         |              Shared SQLite            |
         +---------------------------------------+
                        (task.db)
```

### 2.3 Port Assignment

| Service | Port | Protocol |
|---------|------|----------|
| Automaton Gateway | 18790 | HTTP + WS |
| Nanobot Gateway | 18791 | HTTP + WS |
| Automaton Conway API | External | HTTPS |

---

## 3. Data Exchange Format

### 3.1 Message Envelope Schema

**TypeScript Interface** (add to `automaton/src/types.ts`):

```typescript
// === Inter-Agent Communication Types ===

export interface InterAgentMessage {
  id: string;                    // ULID
  version: string;               // Schema version, e.g., "1.0.0"
  timestamp: string;             // ISO 8601
  source: AgentSource;
  target: AgentTarget;
  type: MessageType;
  payload: unknown;
  metadata: MessageMetadata;
  correlationId?: string;        // For request-response linking
  ttl?: number;                  // Time-to-live in seconds
}

export type AgentSource = "automaton" | "nanobot";
export type AgentTarget = "automaton" | "nanobot" | "both";

export type MessageType =
  // Task management
  | "task.create"
  | "task.update"
  | "task.complete"
  | "task.fail"
  // Status queries
  | "status.request"
  | "status.response"
  // Events
  | "event.progress"
  | "event.error"
  | "event.heartbeat"
  // Economic
  | "economic.budget_update"
  | "economic.payment_required"
  // Communication
  | "comm.message_inbound"
  | "comm.message_outbound";

export interface MessageMetadata {
  priority: "low" | "normal" | "high" | "critical";
  retryCount: number;
  idempotencyKey?: string;
  traceId?: string;              // Distributed tracing
}

export interface TaskPayload {
  taskId: string;
  taskType: TaskType;
  description: string;
  parameters: Record<string, unknown>;
  deadline?: string;
  budget?: TaskBudget;
}

export type TaskType =
  | "code_generation"
  | "code_review"
  | "testing"
  | "deployment"
  | "customer_reply"
  | "research"
  | "analysis";

export interface TaskBudget {
  maxTokens: number;
  maxCostCents: number;
  maxDurationMs: number;
}
```

**Python Pydantic Model** (add to `nanobot/nanobot/interagent/types.py`):

```python
"""Inter-agent communication types."""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class AgentSource(str, Enum):
    AUTOMATON = "automaton"
    NANOBOT = "nanobot"


class AgentTarget(str, Enum):
    AUTOMATON = "automaton"
    NANOBOT = "nanobot"
    BOTH = "both"


class MessageType(str, Enum):
    TASK_CREATE = "task.create"
    TASK_UPDATE = "task.update"
    TASK_COMPLETE = "task.complete"
    TASK_FAIL = "task.fail"
    STATUS_REQUEST = "status.request"
    STATUS_RESPONSE = "status.response"
    EVENT_PROGRESS = "event.progress"
    EVENT_ERROR = "event.error"
    EVENT_HEARTBEAT = "event.heartbeat"
    ECONOMIC_BUDGET_UPDATE = "economic.budget_update"
    ECONOMIC_PAYMENT_REQUIRED = "economic.payment_required"
    COMM_MESSAGE_INBOUND = "comm.message_inbound"
    COMM_MESSAGE_OUTBOUND = "comm.message_outbound"


class MessagePriority(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


class MessageMetadata(BaseModel):
    priority: MessagePriority = MessagePriority.NORMAL
    retry_count: int = 0
    idempotency_key: str | None = None
    trace_id: str | None = None


class InterAgentMessage(BaseModel):
    id: str  # ULID
    version: str = "1.0.0"
    timestamp: datetime
    source: AgentSource
    target: AgentTarget
    type: MessageType
    payload: dict[str, Any]
    metadata: MessageMetadata = Field(default_factory=MessageMetadata)
    correlation_id: str | None = None
    ttl: int | None = None
```

### 3.2 Serialization

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Format | JSON | Universal, debugging-friendly, native support |
| Date Format | ISO 8601 | Unambiguous, timezone-aware |
| Binary Data | Base64 in JSON | Simplicity over MessagePack |
| Large Payloads | Chunked upload to shared DB | Avoid message size limits |

### 3.3 Version Compatibility Strategy

1. **Semantic Versioning**: `MAJOR.MINOR.PATCH` for schema
2. **Backward Compatibility**: New fields optional with defaults
3. **Version Negotiation**: Handshake on connection establishes min version
4. **Deprecation Policy**: 30-day notice before removing fields

---

## 4. Collaboration Patterns

### 4.1 Synchronous Calls (Request-Response)

**Use Cases**:
- Real-time status queries
- Budget checks before operations
- Health checks

**Implementation**:

```typescript
// Automaton requesting status from Nanobot
const response = await httpClient.request(
  "http://localhost:18791/api/v1/status",
  {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Correlation-Id": ulid() },
    body: JSON.stringify({
      id: ulid(),
      type: "status.request",
      source: "automaton",
      target: "nanobot",
      payload: { detail_level: "full" }
    }),
    timeout: 5000,
    idempotencyKey: ulid(),
  }
);
```

**Timeout Strategy**:
- Status queries: 5s
- Task creation: 10s
- Budget queries: 3s

### 4.2 Asynchronous Tasks

**Use Cases**:
- Code development tasks
- Long-running analysis
- Multi-step workflows

**Flow**:

```
Automaton                    Shared DB                     Nanobot
    |                           |                             |
    |-- task.create ----------->|                             |
    |                           |<-------- poll/read ---------|
    |                           |                             |
    |                           |<------ task.update (20%) ---|
    |<-- WebSocket event -------|                             |
    |                           |                             |
    |                           |<------ task.update (60%) ---|
    |<-- WebSocket event -------|                             |
    |                           |                             |
    |                           |<------ task.complete ------|
    |<-- WebSocket event -------|                             |
```

**Task Queue Schema** (SQLite):

```sql
CREATE TABLE interagent_tasks (
    id TEXT PRIMARY KEY,              -- ULID
    created_at TEXT NOT NULL,         -- ISO 8601
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL,             -- 'automaton' | 'nanobot'
    target TEXT NOT NULL,             -- 'automaton' | 'nanobot'
    type TEXT NOT NULL,               -- task type
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | in_progress | completed | failed
    priority INTEGER DEFAULT 0,       -- 0=low, 1=normal, 2=high, 3=critical
    payload TEXT NOT NULL,            -- JSON
    result TEXT,                      -- JSON
    error TEXT,
    correlation_id TEXT,
    idempotency_key TEXT UNIQUE,
    lease_owner TEXT,                 -- Who's processing
    lease_expires_at TEXT,            -- Lease timeout
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    deadline TEXT
);

CREATE INDEX idx_tasks_status ON interagent_tasks(status);
CREATE INDEX idx_tasks_target_status ON interagent_tasks(target, status);
CREATE INDEX idx_tasks_priority ON interagent_tasks(priority DESC, created_at ASC);
```

### 4.3 Event-Driven (WebSocket)

**Use Cases**:
- Progress updates during long tasks
- Error notifications
- Heartbeat/health broadcasts

**WebSocket Message Format**:

```json
{
  "event": "task.progress",
  "data": {
    "taskId": "01HXYZ...",
    "progress": 45,
    "message": "Generating test cases...",
    "eta_seconds": 120
  }
}
```

**Event Types**:

| Event | Direction | Description |
|-------|-----------|-------------|
| `task.progress` | Nanobot -> Automaton | Progress update |
| `task.error` | Either | Error notification |
| `status.heartbeat` | Either | Health ping |
| `economic.alert` | Automaton -> Nanobot | Budget threshold reached |
| `comm.received` | Nanobot -> Automaton | Customer message received |

---

## 5. API Specification

### 5.1 Automaton HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/task` | Create task for Nanobot |
| GET | `/api/v1/task/:id` | Get task status |
| POST | `/api/v1/status` | Status query (request-response) |
| GET | `/api/v1/health` | Health check |
| POST | `/api/v1/budget/query` | Query budget availability |

### 5.2 Nanobot HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/task/next` | Poll for next task |
| POST | `/api/v1/task/:id/progress` | Update task progress |
| POST | `/api/v1/task/:id/complete` | Mark task complete |
| POST | `/api/v1/task/:id/fail` | Mark task failed |
| POST | `/api/v1/status` | Status query (request-response) |
| GET | `/api/v1/health` | Health check |

### 5.3 WebSocket Channels

| Channel | Purpose |
|---------|---------|
| `/ws/events` | General event broadcast |
| `/ws/task/:id` | Task-specific updates |

---

## 6. Reliability Design

### 6.1 Message Persistence

**Guaranteed Delivery**:
1. All tasks written to SQLite before acknowledgment
2. WAL mode enabled for crash recovery
3. Periodic checkpointing (every 1000 writes)

```typescript
// Enable WAL mode in Automaton
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('wal_autocheckpoint = 1000');
```

### 6.2 Retry Strategy

**Exponential Backoff with Jitter** (already implemented in Automaton's `ResilientHttpClient`):

```typescript
// From automaton/src/conway/http-client.ts:99-106
private async backoff(attempt: number): Promise<void> {
  const delay = Math.min(
    this.config.backoffBase *
      Math.pow(2, attempt) *
      (0.5 + Math.random()),  // Jitter
    this.config.backoffMax,
  );
  await new Promise((resolve) => setTimeout(resolve, delay));
}
```

**Retry Configuration**:

| Parameter | Value | Notes |
|-----------|-------|-------|
| Max Retries | 3 | For transient failures |
| Base Delay | 1000ms | Initial backoff |
| Max Delay | 30000ms | Cap for exponential growth |
| Jitter | 50-100% | Prevent thundering herd |

### 6.3 Circuit Breaker

**Already implemented in Automaton** (`conway/http-client.ts:13-20, 109-116`):

```typescript
// Circuit breaker trips after 5 consecutive failures
// Resets after 60 seconds
export class CircuitOpenError extends Error {
  constructor(public readonly resetAt: number) {
    super(`Circuit breaker is open until ${new Date(resetAt).toISOString()}`);
    this.name = "CircuitOpenError";
  }
}
```

**Configuration**:

| Parameter | Value |
|-----------|-------|
| Threshold | 5 failures |
| Reset Time | 60 seconds |

### 6.4 Dead Letter Queue

**Implementation**:

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
```

**DLQ Policy**:
1. After 3 failed attempts, move to DLQ
2. Keep for 7 days for analysis
3. Manual or automated retry possible

### 6.5 Idempotency

**Idempotency Keys**:
- Every mutating operation includes `idempotency_key`
- Keys stored with 24-hour TTL
- Duplicate requests return cached response

```typescript
interface IdempotencyCache {
  key: string;          // Primary key
  response: string;     // Cached response
  created_at: string;   // For TTL cleanup
}
```

### 6.6 Lease-Based Task Processing

**Preventing duplicate processing**:

```sql
-- Claim a task
UPDATE interagent_tasks
SET lease_owner = :owner_id,
    lease_expires_at = datetime('now', '+30 seconds')
WHERE id = :task_id
  AND (lease_owner IS NULL OR lease_expires_at < datetime('now'));

-- Check if claimed
SELECT changes() > 0;
```

**Lease Duration**: 30 seconds (extendable for long tasks)

---

## 7. Security Design

### 7.1 Service-to-Service Authentication

**HMAC-Based Authentication**:

```typescript
// Request signing
function signRequest(
  method: string,
  path: string,
  timestamp: number,
  body: string,
  secret: string
): string {
  const payload = `${method}\n${path}\n${timestamp}\n${body}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

// Headers
{
  "X-Auth-Timestamp": "1709000000",
  "X-Auth-Signature": "hmac-sha256=..."
}
```

**Key Management**:
- Shared secret stored in environment variables
- Rotated monthly via automated script
- Separate keys for production/development

### 7.2 Transport Security

| Environment | Transport |
|-------------|-----------|
| Development | HTTP (localhost only) |
| Production | HTTPS + WSS with TLS 1.3 |

**Certificate Management**:
- Use Let's Encrypt for production
- Self-signed for development

### 7.3 Access Control

**Role-Based Permissions**:

| Operation | Automaton | Nanobot |
|-----------|-----------|---------|
| Create task | Yes | Yes |
| Query budget | Yes | Read-only |
| Modify config | Yes | No |
| Send customer message | No | Yes |
| Execute financial transfer | Yes | No |

---

## 8. Implementation Roadmap

### Phase 1: Core Infrastructure (Week 1-2)

1. **Shared Database Layer**
   - Create SQLite schema
   - Implement connection pooling
   - Add WAL mode configuration

2. **Type Definitions**
   - Add inter-agent types to `automaton/src/types.ts`
   - Create `nanobot/nanobot/interagent/types.py`

3. **HTTP API Server**
   - Add Express/Fastify server to Automaton
   - Add FastAPI server to Nanobot
   - Implement health check endpoints

### Phase 2: Task Queue (Week 3)

1. **Task Creation**
   - Implement POST `/api/v1/task` in Automaton
   - Implement task polling in Nanobot

2. **Task Processing**
   - Implement task execution in Nanobot
   - Add progress updates

3. **Lease Management**
   - Implement lease claiming
   - Add lease extension for long tasks

### Phase 3: Real-Time Events (Week 4)

1. **WebSocket Server**
   - Add WebSocket support to both services
   - Implement event broadcasting

2. **Event Integration**
   - Connect to existing Nanobot message bus
   - Connect to Automaton heartbeat system

### Phase 4: Reliability (Week 5)

1. **Retry Logic**
   - Implement exponential backoff
   - Add circuit breaker

2. **Dead Letter Queue**
   - Implement DLQ schema
   - Add DLQ monitoring

3. **Idempotency**
   - Add idempotency key tracking
   - Implement cache cleanup

### Phase 5: Security (Week 6)

1. **Authentication**
   - Implement HMAC signing
   - Add key rotation script

2. **Transport Security**
   - Add TLS configuration
   - Implement certificate management

---

## 9. Monitoring & Observability

### 9.1 Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `interagent.tasks.created` | Counter | Tasks created |
| `interagent.tasks.completed` | Counter | Tasks completed |
| `interagent.tasks.failed` | Counter | Tasks failed |
| `interagent.latency.ms` | Histogram | Request latency |
| `interagent.queue.depth` | Gauge | Pending tasks |
| `interagent.dlq.size` | Gauge | Dead letter count |

### 9.2 Logging

**Structured Log Format** (consistent with Automaton's existing pattern):

```json
{
  "timestamp": "2024-02-27T10:30:00.000Z",
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

### 9.3 Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| High Failure Rate | >10% task failures in 5min | Critical |
| Queue Backlog | >100 pending tasks | Warning |
| DLQ Growth | >10 items in 1 hour | Warning |
| Service Down | Health check fails | Critical |

---

## 10. File Structure

### 10.1 Automaton Additions

```
automaton/src/
├── interagent/
│   ├── index.ts           # Module exports
│   ├── types.ts           # Inter-agent types (extend types.ts)
│   ├── client.ts          # HTTP client for Nanobot
│   ├── server.ts          # Express/Fastify server
│   ├── websocket.ts       # WebSocket server
│   ├── queue.ts           # Task queue management
│   ├── dlq.ts             # Dead letter queue
│   └── auth.ts            # Authentication utilities
├── __tests__/
│   └── interagent/
│       ├── client.test.ts
│       ├── queue.test.ts
│       └── auth.test.ts
```

### 10.2 Nanobot Additions

```
nanobot/nanobot/
├── interagent/
│   ├── __init__.py
│   ├── types.py           # Pydantic models
│   ├── client.py          # HTTP client for Automaton
│   ├── server.py          # FastAPI server
│   ├── websocket.py       # WebSocket client
│   ├── queue.py           # Task queue polling
│   └── auth.py            # Authentication utilities
├── tests/
│   └── test_interagent/
│       ├── test_client.py
│       ├── test_queue.py
│       └── test_auth.py
```

---

## 11. Trade-offs

| Decision | Benefit | Cost |
|----------|---------|------|
| SQLite over Redis | No external dependency, simpler ops | Less scalable for high throughput |
| HTTP + WebSocket over gRPC | Easier debugging, universal support | More code, no strong typing |
| JSON over MessagePack | Human-readable, native support | Larger message size |
| Shared DB over Message Queue | Simpler architecture, ACID guarantees | Tighter coupling |
| HMAC over mTLS | Simpler key management | Less secure than certificate-based |

---

## 12. References

### Code References

| File | Purpose |
|------|---------|
| `/automaton/src/types.ts:1-1441` | Core type definitions for Automaton |
| `/automaton/src/conway/http-client.ts:22-121` | Resilient HTTP client with circuit breaker |
| `/nanobot/nanobot/bus/events.py:8-38` | Event types (InboundMessage, OutboundMessage) |
| `/nanobot/nanobot/bus/queue.py:8-45` | Message bus pattern |
| `/nanobot/nanobot/agent/loop.py:36-487` | Agent loop and message processing |
| `/nanobot/nanobot/channels/base.py:12-132` | Channel abstraction pattern |
| `/nanobot/nanobot/config/schema.py:1-383` | Pydantic configuration schema |

### External References

- [SQLite WAL Mode](https://www.sqlite.org/wal.html)
- [HMAC Authentication Best Practices](https://developer.mozilla.org/en-US/docs/Web/HTTP/Authentication)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Idempotency Key Pattern](https://stripe.com/docs/api/idempotent_requests)

---

## Appendix A: Configuration Example

```yaml
# ~/.automaton/interagent.yml
interagent:
  enabled: true

  database:
    path: ~/.automaton/interagent.db
    wal_mode: true
    pool_size: 5

  http:
    automaton_port: 18790
    nanobot_port: 18791
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
```

---

## Appendix B: Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `TASK_NOT_FOUND` | 404 | Task ID does not exist |
| `INVALID_PAYLOAD` | 400 | Payload validation failed |
| `LEASE_CONFLICT` | 409 | Task already leased by another worker |
| `CIRCUIT_OPEN` | 503 | Circuit breaker is open |
| `AUTH_FAILED` | 401 | Authentication failed |
| `RATE_LIMITED` | 429 | Too many requests |
| `BUDGET_EXCEEDED` | 402 | Budget limit reached |
| `DEADLINE_EXCEEDED` | 408 | Task deadline passed |

---

*Document Version: 1.0.0*
*Last Updated: 2025-02-25*
*Author: Architecture Analysis (Claude Architect Agent)*
