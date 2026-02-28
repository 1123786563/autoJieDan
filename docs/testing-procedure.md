# 完整测试流程文档

> **文档版本**: 1.0.0
> **创建日期**: 2026-02-28
> **适用范围**: automaton (TypeScript) + nanobot (Python) 双系统

---

## 目录

1. [测试概览](#1-测试概览)
2. [完整性测试](#2-完整性测试)
3. [稳定性测试](#3-稳定性测试)
4. [安全性测试](#4-安全性测试)
5. [可行性测试](#5-可行性测试)
6. [测试报告模板](#6-测试报告模板)

---

## 1. 测试概览

### 1.1 测试目标

| 维度 | 目标 | 验证方法 |
|------|------|----------|
| **完整性** | 功能覆盖率≥80%，边界条件 100% 覆盖，异常处理全覆盖 | 单元测试 + 集成测试 + 覆盖率工具 |
| **稳定性** | 72 小时连续运行无故障，P99 延迟<5s，故障恢复<5min | 负载测试 + 压力测试 + 故障注入 |
| **安全性** | 0 高危漏洞，依赖审计通过，权限验证 100% | 漏洞扫描 + 渗透测试 + 安全审计 |
| **可行性** | 部署成功率 100%，跨平台兼容，性能基准达标 | 部署验证 + 兼容性测试 + 基准测试 |

### 1.2 测试环境

```bash
# 自动化测试环境
- CI/CD: GitHub Actions
- 测试框架：vitest (TypeScript), pytest (Python)
- 覆盖率工具：c8/v8 (TS), pytest-cov (Python)

# 稳定性测试环境
- 压测工具：k6, locust
- 监控：Prometheus + Grafana
- 日志：pino (TS), loguru (Python)

# 安全性测试环境
- 漏洞扫描：npm audit, pip-audit, trivy
- 渗透测试：OWASP ZAP, Burp Suite
- 代码审计：Semgrep, Bandit (Python)

# 可行性测试环境
- 容器化：Docker + docker-compose
- 平台：macOS, Linux, Windows (WSL)
- 基准：内置 benchmark 工具
```

---

## 2. 完整性测试

### 2.1 单元测试

#### 2.1.1 TypeScript (automaton)

```bash
# 运行单元测试并生成覆盖率报告
cd automaton
pnpm test:coverage

# 覆盖率要求
# - 行覆盖率：≥80%
# - 分支覆盖率：≥80%
# - 函数覆盖率：≥80%
```

**测试文件组织：**

```
automaton/src/__tests__/
├── unit/                    # 单元测试
│   ├── agent/               # Agent 核心逻辑
│   ├── anp/                 # ANP 协议层
│   ├── interagent/          # Interagent 通信
│   ├── memory/              # 记忆系统
│   ├── orchestration/       # 编排系统
│   ├── inference/           # 推理引擎
│   └── survival/            # 生存管理
├── integration/             # 集成测试
│   ├── compression-cascade.test.ts
│   ├── inference-failover.test.ts
│   ├── memory-retrieval.test.ts
│   └── multi-agent-coordination.test.ts
└── e2e/                     # 端到端测试
    ├── genesis-prompt-flow.test.ts
    └── task-lifecycle.test.ts
```

**关键测试用例清单：**

| 模块 | 测试项 | 验收标准 |
|------|--------|----------|
| ANP | DID 签名验证 | 100% 通过 |
| ANP | E2E 加密 | 加密/解密正确性 100% |
| ANP | 协议协商 | 版本协商成功率>95% |
| Interagent | Genesis Prompt | 任务创建成功率>95% |
| Interagent | 进度报告 | 延迟<5s |
| Interagent | 故障恢复 | 重试成功率>99% |
| Memory | 上下文压缩 | 压缩率>50% |
| Memory | 向量检索 | 检索准确率>90% |
| Orchestration | 任务调度 | 调度正确率 100% |
| Survival | 层级切换 | 自动切换正确率 100% |

#### 2.1.2 Python (nanobot)

```bash
# 运行单元测试并生成覆盖率报告
cd nanobot
pytest --cov=nanobot --cov-report=html --cov-report=term

# 覆盖率要求
# - 行覆盖率：≥80%
# - 分支覆盖率：≥75%
```

**测试文件组织：**

```
nanobot/tests/
├── anp/                     # ANP 协议测试
│   ├── test_adapter.py
│   ├── test_did.py
│   ├── test_signature.py
│   ├── test_encryption.py
│   ├── test_dlq.py
│   ├── test_key_rotation.py
│   └── test_interop.py      # 类型互操作性
├── interagent/              # Interagent 通信测试
│   ├── test_genesis_prompt.py
│   ├── test_progress_reporter.py
│   ├── test_event_broadcaster.py
│   ├── test_fault_recovery.py
│   └── test_security_integration.py
├── channels/                # 平台集成测试
│   ├── test_upwork.py
│   ├── test_telegram.py
│   └── test_slack.py
├── dev/                     # 开发引擎测试
│   ├── test_requirement_parser.py
│   ├── test_code_generator.py
│   └── test_memory_system.py
├── qa/                      # QA 测试
│   ├── test_unit_test_generator.py
│   └── test_security_scanner.py
└── test_cli_input.py        # CLI 测试
```

**关键测试用例清单：**

| 模块 | 测试项 | 验收标准 |
|------|--------|----------|
| ANP | 类型互操作性 | camelCase 双向序列化 100% |
| ANP | 密钥轮换 | 30 天自动轮换 |
| Interagent | 双向通信 | 消息延迟<5s |
| Channels | RSS 监控 | 监控延迟<1min |
| Channels | API 调用 | 成功率>99% |
| DEV | 需求解析 | 解析成功率>90% |
| DEV | 代码生成 | 编译成功>90% |
| QA | 测试生成 | 覆盖率>80% |

### 2.2 边界条件测试

#### 2.2.1 输入边界

```typescript
// automaton/src/__tests__/boundary/input-boundary.test.ts
describe('Input Boundary Tests', () => {
  test('empty input handling', () => { ... })
  test('max length input (1M tokens)', () => { ... })
  test('special characters injection', () => { ... })
  test('unicode edge cases', () => { ... })
  test('null/undefined handling', () => { ... })
})
```

```python
# nanobot/tests/test_boundary.py
class TestInputBoundary:
    def test_empty_input(self): ...
    def test_max_context_length(self): ...
    def test_sql_injection_attempt(self): ...
    def test_xss_attempt(self): ...
    def test_unicode_edge_cases(self): ...
```

#### 2.2.2 资源边界

| 测试项 | 测试方法 | 通过标准 |
|--------|----------|----------|
| 内存限制 | 分配>4GB 内存 | 优雅降级或错误提示 |
| CPU 限制 | 100%CPU 负载 | 系统不崩溃 |
| 磁盘空间 | 写满磁盘 | 提前预警 |
| 网络延迟 | 模拟 1000ms 延迟 | 超时处理正确 |
| 并发连接 | 1000 并发 WebSocket | 连接池正常工作 |

### 2.3 异常处理测试

#### 2.3.1 异常类型覆盖

```typescript
// automaton/src/__tests__/error-handling.test.ts
describe('Error Handling', () => {
  test('API timeout', () => { ... })
  test('Database connection lost', () => { ... })
  test('Invalid JSON response', () => { ... })
  test('Network interruption', () => { ... })
  test('Rate limit exceeded', () => { ... })
  test('Authentication failure', () => { ... })
  test('Insufficient funds', () => { ... })
})
```

#### 2.3.2 错误恢复

| 场景 | 恢复策略 | 验证方法 |
|------|----------|----------|
| API 限流 | 指数退避 | 重试 3 次后成功 |
| 网络断开 | 自动重连 | 5s 内恢复 |
| 数据库锁定 | 事务回滚 + 重试 | 数据一致性 |
| 内存溢出 | 清理缓存 + 降级 | 服务不中断 |

---

## 3. 稳定性测试

### 3.1 负载测试

#### 3.1.1 Automaton 负载测试

```typescript
// automaton/src/__tests__/load-test.ts
import { Worker } from 'k6'

export const options = {
  stages: [
    { duration: '5m', target: 10 },   // 逐步增加到 10 并发
    { duration: '10m', target: 50 },  // 增加到 50 并发
    { duration: '15m', target: 100 }, // 增加到 100 并发
    { duration: '10m', target: 100 }, // 保持 100 并发
    { duration: '5m', target: 0 },    // 逐步减少
  ],
  thresholds: {
    http_req_duration: ['p(99)<5000'], // P99<5s
    http_req_failed: ['rate<0.01'],    // 错误率<1%
  },
}
```

**测试场景：**

| 场景 | 并发数 | 持续时间 | 通过标准 |
|------|--------|----------|----------|
| 轻度负载 | 10 | 30min | 无错误 |
| 中度负载 | 50 | 1h | 错误率<1% |
| 重度负载 | 100 | 2h | 错误率<5% |
| 极限负载 | 500 | 30min | 系统不崩溃 |

#### 3.1.2 Nanobot 负载测试

```python
# nanobot/tests/load_test.py
from locust import HttpUser, task, between

class AgentUser(HttpUser):
    wait_time = between(1, 5)

    @task(3)
    def send_message(self):
        self.client.post("/api/message", json={...})

    @task(1)
    def get_progress(self):
        self.client.get("/api/progress")
```

### 3.2 压力测试

#### 3.2.1 测试脚本

```bash
# 使用 k6 进行压力测试
k6 run --vus 200 --duration 30m automaton/src/__tests__/stress-test.ts

# 使用 locust 进行压力测试
locust -f nanobot/tests/load_test.py --users 500 --spawn-rate 50
```

#### 3.2.2 压力指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 请求/秒 | ≥1000 RPS | k6/locust |
| P50 延迟 | <500ms | 响应时间统计 |
| P95 延迟 | <2000ms | 响应时间统计 |
| P99 延迟 | <5000ms | 响应时间统计 |
| 错误率 | <1% | 失败请求/总请求 |

### 3.3 长时间运行测试 (72 小时)

#### 3.3.1 测试配置

```yaml
# .github/workflows/stability-test.yml
name: 72-Hour Stability Test

on:
  schedule:
    - cron: '0 0 * * 0'  # 每周日运行

jobs:
  stability:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run 72h test
        run: |
          # 启动服务
          docker-compose up -d

          # 运行 72 小时持续测试
          ./scripts/stability-test.sh --duration 72h

          # 生成报告
          ./scripts/generate-stability-report.sh
```

#### 3.3.2 监控指标

| 指标 | 告警阈值 | 测量工具 |
|------|----------|----------|
| 内存泄漏 | >100MB/24h | Prometheus |
| CPU 使用率 | >80% 持续 1h | Prometheus |
| 磁盘增长 | >1GB/24h | 文件系统监控 |
| 连接数 | >90% 容量 | WebSocket 监控 |
| 错误率 | >5%/h | 日志分析 |

### 3.4 故障恢复测试

#### 3.4.1 故障注入场景

| 故障类型 | 注入方法 | 预期恢复时间 |
|----------|----------|--------------|
| 数据库宕机 | kill postgres | <5min |
| Redis 宕机 | stop redis | <1min (降级) |
| 网络分区 | tc netem | <2min |
| 服务崩溃 | kill -9 | <30s (重启) |
| 磁盘满 | dd if=/dev/zero | 提前预警 |
| API 限流 | mock rate limit | 指数退避 |

#### 3.4.2 恢复验证

```bash
# 故障恢复测试脚本
./scripts/chaos-test.sh \
  --target automaton \
  --scenarios db-crash,redis-crash,network-partition \
  --max-recovery-time 300 \
  --report chaos-report.html
```

---

## 4. 安全性测试

### 4.1 漏洞扫描

#### 4.1.1 依赖漏洞扫描

```bash
# TypeScript 依赖扫描
cd automaton
npm audit --audit-level=high
pnpm audit --audit-level=high

# Python 依赖扫描
cd nanobot
pip-audit --severity-threshold HIGH
safety check --severity threshold

# 容器镜像扫描
trivy image autojiedan/automaton:latest
trivy image autojiedan/nanobot:latest
```

#### 4.1.2 代码安全扫描

```bash
# TypeScript 代码扫描
npx semgrep --config auto automaton/src/

# Python 代码扫描
bandit -r nanobot/nanobot/ --severity-level high
semgrep --config auto nanobot/
```

### 4.2 渗透测试

#### 4.2.1 OWASP Top 10 测试

| 漏洞类型 | 测试方法 | 工具 |
|----------|----------|------|
| A01 权限控制失效 | 尝试越权访问 | OWASP ZAP |
| A02 加密失效 | 检查 TLS 配置 | SSL Labs |
| A03 注入 | SQL/NoSQL 注入测试 | SQLMap |
| A04 不安全设计 | 架构审查 | 人工审计 |
| A05 配置错误 | 配置扫描 | Nmap |
| A06 漏洞组件 | 依赖审计 | npm audit/pip-audit |
| A07 认证失效 | 暴力破解测试 | Hydra |
| A08 数据完整性 | 篡改测试 | 人工审计 |
| A09 日志失效 | 日志审查 | 人工审计 |
| A10 SSRF | 内部网络扫描 | OWASP ZAP |

#### 4.2.2 渗透测试脚本

```bash
# OWASP ZAP 自动化测试
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t http://localhost:8080 \
  -r zap-report.html
```

### 4.3 权限验证

#### 4.3.1 权限矩阵测试

| 角色 | 资源 | 预期权限 | 测试方法 |
|------|------|----------|----------|
| 匿名用户 | API 端点 | 只读公开数据 | 未认证请求 |
| 普通用户 | 个人数据 | 读写自己数据 | JWT 认证 |
| Agent | Interagent | 同行通信 | DID 签名验证 |
| 管理员 | 系统配置 | 完全访问 | Admin JWT |

#### 4.3.2 权限测试用例

```typescript
// automaton/src/__tests__/security/permission.test.ts
describe('Permission Tests', () => {
  test('unauthenticated user cannot access private API', () => { ... })
  test('user A cannot access user B data', () => { ... })
  test('agent with invalid signature is rejected', () => { ... })
  test('admin can access all resources', () => { ... })
  test('revoked token is rejected', () => { ... })
})
```

### 4.4 敏感信息检测

```bash
# 扫描代码中的敏感信息
gitleaks detect --source . --report gitleaks-report.json

# 检查环境变量
./scripts/check-secrets.sh
```

**检测项：**

- [ ] API 密钥
- [ ] 数据库密码
- [ ] 私钥文件
- [ ] JWT 密钥
- [ ] 钱包私钥
- [ ] OAuth 凭证

---

## 5. 可行性测试

### 5.1 部署验证

#### 5.1.1 Docker 部署测试

```bash
# 构建镜像
docker-compose build

# 启动服务
docker-compose up -d

# 健康检查
docker-compose ps
curl http://localhost:8080/health

# 日志检查
docker-compose logs automaton
docker-compose logs nanobot
```

#### 5.1.2 部署检查清单

| 检查项 | 验证方法 | 通过标准 |
|--------|----------|----------|
| 镜像构建 | docker build | 无错误 |
| 容器启动 | docker-compose up | 所有服务运行 |
| 健康检查 | /health 端点 | 返回 200 OK |
| 数据库连接 | 查询测试 | 返回数据 |
| 外部 API | 调用测试 | 成功响应 |
| 日志输出 | docker logs | 无 ERROR |
| 资源限制 | docker stats | 符合配置 |

### 5.2 环境兼容性测试

#### 5.2.1 操作系统兼容性

| 操作系统 | 版本 | 测试状态 |
|----------|------|----------|
| macOS | 14.x (Sonoma) | ✅ 支持 |
| macOS | 15.x (Sequoia) | ✅ 支持 |
| Ubuntu | 22.04 LTS | ✅ 支持 |
| Ubuntu | 24.04 LTS | ✅ 支持 |
| Windows | WSL2 (Ubuntu) | ✅ 支持 |
| Docker | 24.x+ | ✅ 支持 |

#### 5.2.2 运行时兼容性

```bash
# Node.js 版本测试
nvm use 20 && pnpm test
nvm use 22 && pnpm test

# Python 版本测试
pyenv shell 3.11 && pytest
pyenv shell 3.12 && pytest
```

### 5.3 性能基准测试

#### 5.3.1 Automaton 基准

```typescript
// automaton/src/__tests__/benchmark.ts
import { Bench } from 'tinybench'

const bench = new Bench({ time: 1000 })

bench
  .add('Genesis Prompt 处理', async () => { ... })
  .add('ANP 加密/解密', async () => { ... })
  .add('向量检索', async () => { ... })
  .add('任务调度', async () => { ... })

await bench.run()
console.table(bench.table())
```

**基准指标：**

| 操作 | P50 | P95 | P99 | 目标 |
|------|-----|-----|-----|------|
| Genesis Prompt | <100ms | <500ms | <1s | <1s |
| ANP 加密 | <10ms | <50ms | <100ms | <100ms |
| 向量检索 | <50ms | <200ms | <500ms | <500ms |
| 任务调度 | <10ms | <50ms | <100ms | <100ms |

#### 5.3.2 Nanobot 基准

```python
# nanobot/tests/benchmark.py
import pytest_benchmark

def test_genesis_prompt_processing(benchmark):
    result = benchmark(process_genesis_prompt, prompt_data)
    assert result.success

def test_anp_encryption(benchmark):
    encrypted = benchmark(encrypt_message, message)
    assert len(encrypted) > 0
```

### 5.4 资源消耗基准

| 组件 | 空闲内存 | 负载内存 | CPU (空闲) | CPU (负载) |
|------|----------|----------|------------|------------|
| Automaton | <500MB | <2GB | <5% | <50% |
| Nanobot | <200MB | <1GB | <3% | <30% |
| PostgreSQL | <300MB | <1GB | <5% | <40% |
| Redis | <50MB | <100MB | <1% | <5% |

---

## 6. 测试报告模板

### 6.1 完整性测试报告

```markdown
# 完整性测试报告

## 执行信息
- **执行日期**: YYYY-MM-DD
- **执行者**: [姓名/Agent]
- **代码版本**: [Git SHA]

## 覆盖率汇总

| 组件 | 行覆盖率 | 分支覆盖率 | 函数覆盖率 | 状态 |
|------|----------|------------|------------|------|
| automaton | XX% | XX% | XX% | ✅/❌ |
| nanobot | XX% | XX% | XX% | ✅/❌ |

## 未覆盖模块

| 文件 | 覆盖率 | 原因 | 行动计划 |
|------|--------|------|----------|
| src/xxx.ts | 45% | 新添加功能 | 补充测试 |

## 边界条件测试

| 测试项 | 通过数 | 失败数 | 状态 |
|--------|--------|--------|------|
| 输入边界 | XX | XX | ✅/❌ |
| 资源边界 | XX | XX | ✅/❌ |

## 异常处理测试

| 异常类型 | 测试数 | 通过数 | 状态 |
|----------|--------|--------|------|
| 网络异常 | XX | XX | ✅/❌ |
| 数据库异常 | XX | XX | ✅/❌ |
```

### 6.2 稳定性测试报告

```markdown
# 稳定性测试报告

## 执行信息
- **执行日期**: YYYY-MM-DD
- **测试时长**: 72 小时
- **并发数**: 100

## 性能指标

| 指标 | 目标 | 实际 | 状态 |
|------|------|------|------|
| P99 延迟 | <5s | X.Xs | ✅/❌ |
| 错误率 | <1% | X.X% | ✅/❌ |
| 请求/秒 | >1000 | XXXX | ✅/❌ |

## 长时间运行

| 指标 | 72h 变化 | 告警阈值 | 状态 |
|------|----------|----------|------|
| 内存 | +XX MB | <100MB/24h | ✅/❌ |
| CPU | XX% | <80% | ✅/❌ |
| 磁盘 | +XX GB | <1GB/24h | ✅/❌ |

## 故障恢复

| 故障场景 | 恢复时间 | 目标 | 状态 |
|----------|----------|------|------|
| 数据库宕机 | Xmin | <5min | ✅/❌ |
| 网络分区 | Xmin | <2min | ✅/❌ |
```

### 6.3 安全性测试报告

```markdown
# 安全性测试报告

## 执行信息
- **执行日期**: YYYY-MM-DD
- **执行者**: [安全团队/Agent]
- **工具版本**: [工具列表]

## 漏洞扫描

| 组件 | 高危 | 中危 | 低危 | 状态 |
|------|------|------|------|------|
| automaton 依赖 | 0 | X | X | ✅/❌ |
| nanobot 依赖 | 0 | X | X | ✅/❌ |
| 代码扫描 | 0 | X | X | ✅/❌ |

## 渗透测试

| OWASP 项 | 测试结果 | 发现数 | 状态 |
|----------|----------|--------|------|
| A01 权限控制 | 通过 | 0 | ✅ |
| A03 注入 | 通过 | 0 | ✅ |
| A07 认证 | 通过 | 0 | ✅ |

## 权限验证

| 场景 | 测试数 | 通过数 | 状态 |
|------|--------|--------|------|
| 未认证访问 | XX | XX | ✅/❌ |
| 越权访问 | XX | XX | ✅/❌ |
| 签名验证 | XX | XX | ✅/❌ |
```

### 6.4 可行性测试报告

```markdown
# 可行性测试报告

## 执行信息
- **执行日期**: YYYY-MM-DD
- **测试环境**: [环境列表]

## 部署验证

| 检查项 | 结果 | 备注 |
|--------|------|------|
| 镜像构建 | ✅/❌ | |
| 容器启动 | ✅/❌ | |
| 健康检查 | ✅/❌ | |

## 兼容性测试

| 平台 | 版本 | 测试结果 |
|------|------|----------|
| macOS | 15.x | ✅ 通过 |
| Ubuntu | 24.04 | ✅ 通过 |
| WSL2 | Ubuntu 22.04 | ✅ 通过 |

## 性能基准

| 操作 | P50 | P95 | P99 | 目标达成 |
|------|-----|-----|-----|----------|
| Genesis Prompt | XXms | XXms | XXms | ✅/❌ |
| ANP 加密 | XXms | XXms | XXms | ✅/❌ |
```

---

## 附录

### A. 测试命令速查

```bash
# ===== 完整性测试 =====
# TypeScript
cd automaton && pnpm test:coverage

# Python
cd nanobot && pytest --cov=nanobot

# ===== 稳定性测试 =====
k6 run automaton/src/__tests__/load-test.ts
locust -f nanobot/tests/load_test.py

# ===== 安全性测试 =====
npm audit --audit-level=high
pip-audit --severity-threshold HIGH
semgrep --config auto .

# ===== 可行性测试 =====
docker-compose up -d
./scripts/benchmark.sh
```

### B. 测试准入/准出标准

| 阶段 | 准入条件 | 准出条件 |
|------|----------|----------|
| 单元测试 | 代码完成 | 覆盖率≥80% |
| 集成测试 | 单元测试通过 | 所有接口测试通过 |
| 稳定性测试 | 集成测试通过 | 72h 无故障 |
| 安全性测试 | 功能测试通过 | 0 高危漏洞 |
| 可行性测试 | 所有测试通过 | 部署验证通过 |

### C. 参考文档

- [implementation-plan.md](./implementation-plan.md)
- [testing-guide.md](./testing-guide.md)
- [security-audit-report.md](./security-audit-report.md)
- [phase4-test-report.md](./phase4-test-report.md)

---

*文档结束*
