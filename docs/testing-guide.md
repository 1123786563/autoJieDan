# 融合Automaton与Nanobot的接单AI代理系统 - 测试指南

> **文档版本**: 1.0.0
> **创建日期**: 2026-02-28
> **更新日期**: 2026-02-28
> **状态**: 测试指南

---

## 目录

1. [测试策略概述](#1-测试策略概述)
2. [单元测试](#2-单元测试)
3. [集成测试](#3-集成测试)
4. [E2E测试](#4-e2e测试)
5. [性能测试](#5-性能测试)
6. [压力测试](#6-压力测试)
7. [安全测试](#7-安全测试)
8. [测试覆盖率](#8-测试覆盖率)
9. [CI/CD集成](#9-cicd集成)
10. [故障恢复测试](#10-故障恢复测试)
11. [回归测试](#11-回归测试)

---

## 1. 测试策略概述

### 1.1 测试金字塔

```
                    ┌─────────┐
                   /    E2E   \              5% - 关键用户流程
                  ─────────────
                 /              \
                /   集成测试     \          20% - API和模块交互
               ─────────────────
              /                    \
             /      单元测试          \      75% - 快速反馈
            └────────────────────────┘
```

### 1.2 测试原则

| 原则 | 说明 | 适用范围 |
|------|------|----------|
| **测试驱动开发** | 先写测试，再实现代码 | 所有新功能 |
| **80%覆盖率** | 最低测试覆盖率要求 | 所有模块 |
| **快速反馈** | 单元测试<1秒，集成<10秒 | 测试执行时间 |
| **隔离性** | 测试间无依赖，可并行执行 | 所有测试 |
| **可重复性** | 多次运行结果一致 | 所有测试 |
| **真实数据** | 使用工厂模式构建测试数据 | 数据驱动测试 |

### 1.3 测试环境

| 环境 | 用途 | 触发条件 |
|------|------|----------|
| **本地开发** | 快速迭代 | 开发过程中 |
| **CI/CD** | 自动化验证 | 每次提交/PR |
| **预发布** | 集成验证 | 合并到main前 |
| **生产监控** | 合规验证 | 部署后 |

---

## 2. 单元测试

### 2.1 Automaton (TypeScript + Vitest)

#### 运行测试

```bash
cd automaton

# 运行所有测试
pnpm test

# 监听模式
pnpm test --watch

# 覆盖率报告
pnpm test:coverage

# CI模式 (单次运行)
pnpm test:ci
```

#### 配置文件

`automaton/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    include: ["src/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/**",
        "src/types.ts",
        "node_modules/**",
      ],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 55,
        lines: 60,
      },
      reporter: ["text", "text-summary", "json-summary"],
    },
  },
});
```

#### 测试示例

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { BudgetTracker } from "../src/biz/budget-tracker";

describe("BudgetTracker", () => {
  let tracker: BudgetTracker;

  beforeEach(() => {
    tracker = new BudgetTracker();
  });

  describe("收入追踪", () => {
    it("应该正确记录收入", () => {
      tracker.addIncome(10000, "USD");
      expect(tracker.getTotalIncome()).toBe(10000);
    });

    it("应该支持多币种收入", () => {
      tracker.addIncome(1000, "USD");
      tracker.addIncome(500, "EUR");
      expect(tracker.getTotalIncome("USD")).toBeGreaterThan(1000);
    });
  });

  describe("支出追踪", () => {
    it("应该正确记录支出", () => {
      tracker.addExpense(5000, "USD", "API调用");
      expect(tracker.getTotalExpenses()).toBe(5000);
    });

    it("应该记录支出类别", () => {
      tracker.addExpense(3000, "USD", "API调用");
      tracker.addExpense(2000, "USD", "存储");

      const expenses = tracker.getExpensesByCategory();
      expect(expenses["API调用"]).toBe(3000);
      expect(expenses["存储"]).toBe(2000);
    });
  });

  describe("预算计算", () => {
    it("应该正确计算剩余预算", () => {
      tracker.addIncome(10000, "USD");
      tracker.addExpense(3000, "USD");

      expect(tracker.getRemainingBudget()).toBe(7000);
    });

    it("预算为负时应该触发警告", () => {
      tracker.addIncome(1000, "USD");
      tracker.addExpense(2000, "USD");

      expect(tracker.isOverBudget()).toBe(true);
    });
  });
});
```

### 2.2 Nanobot (Python + Pytest)

#### 运行测试

```bash
cd nanobot

# 运行所有测试
pytest

# 运行特定文件
pytest tests/test_interagent/test_progress_anp.py

# 覆盖率报告
pytest --cov --cov-report=html

# 显示详细输出
pytest -v

# 只运行失败的测试
pytest --lf

# 并行运行 (需安装 pytest-xdist)
pytest -n auto
```

#### 配置文件

`nanobot/pyproject.toml`:

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "function"
testpaths = ["tests"]
```

#### 测试示例

```python
import pytest
from nanobot.interagent.progress_reporter import ProgressTracker, ProgressUpdate

class TestProgressTracker:
    """测试进度追踪器"""

    @pytest.fixture
    def tracker(self):
        """创建追踪器实例"""
        return ProgressTracker("test-task-1")

    def test_initial_state(self, tracker):
        """测试初始状态"""
        assert tracker.get_percentage() == 0.0
        assert tracker.get_message() == ""
        assert tracker.is_completed() is False

    def test_progress_update(self, tracker):
        """测试进度更新"""
        tracker.update(ProgressUpdate(
            percentage=50.0,
            message="Half done"
        ))

        assert tracker.get_percentage() == 50.0
        assert "Half done" in tracker.get_message()

    @pytest.mark.asyncio
    async def test_async_progress_tracking(self, tracker):
        """测试异步进度追踪"""
        tracker.start()

        # 模拟异步更新
        for i in range(10):
            await tracker.update_async(ProgressUpdate(
                percentage=float(i * 10),
                message=f"Step {i}"
            ))

        assert tracker.get_percentage() == 90.0

    def test_completion(self, tracker):
        """测试完成状态"""
        tracker.update(ProgressUpdate(
            percentage=100.0,
            message="Complete"
        ))

        assert tracker.is_completed() is True
```

### 2.3 测试工厂模式

```python
# tests/factories.py
from dataclasses import dataclass
from datetime import datetime

@dataclass
class ANPMessageFactory:
    """ANP消息工厂"""

    @staticmethod
    def create_genesis_prompt(
        project_id: str = "test-project-1",
        platform: str = "upwork",
        budget: int = 1000
    ) -> dict:
        return {
            "@context": ["https://w3id.org/anp/v1"],
            "@type": "ANPMessage",
            "id": f"msg-{datetime.now().timestamp()}",
            "type": "TaskCreate",
            "object": {
                "@type": "genesis:GenesisPrompt",
                "genesis:projectId": project_id,
                "genesis:platform": platform,
                "genesis:contractTerms": {
                    "genesis:totalBudget": {
                        "schema:value": budget,
                        "schema:currency": "USD"
                    }
                }
            }
        }
```

---

## 3. 集成测试

### 3.1 ANP通信集成测试

#### 测试场景

| 测试ID | 场景 | 验收标准 |
|--------|------|----------|
| INT-001 | 端到端加密通信 | 消息加密解密成功率100% |
| INT-002 | DID签名验证 | 签名验证通过率100% |
| INT-003 | 协议协商 | 版本协商成功率>95% |
| INT-004 | 进度报告同步 | 同步延迟<5秒 (P99) |

#### 测试示例

```python
import pytest
from nanobot.anp.types import ANPMessage, ANPMessageType
from nanobot.anp.encryption import encrypt_message, decrypt_message
from nanobot.anp.signature import create_anp_message, verify_anp_message

@pytest.mark.asyncio
class TestANPIntegration:
    """ANP协议集成测试"""

    async def test_encrypted_communication(self):
        """测试加密通信"""
        # 创建原始消息
        payload = {"task": "test", "data": "sensitive"}

        # 加密
        encrypted = await encrypt_message(payload, public_key)
        assert encrypted != payload

        # 解密
        decrypted = await decrypt_message(encrypted, private_key)
        assert decrypted == payload

    async def test_signature_verification(self):
        """测试签名验证"""
        # 创建签名消息
        message = create_anp_message(
            payload,
            private_key,
            CreateMessageOptions(
                type=ANPMessageType.TASK_CREATE,
                target_did=NANOBOT_DID
            )
        )

        # 验证签名
        is_valid = verify_anp_message(message, public_key)
        assert is_valid is True
```

### 3.2 Interagent集成测试

```typescript
// tests/integration/interagent.integration.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { GenesisPromptReceiver } from "../src/interagent/genesis/receiver";
import { ProgressReportSender } from "../src/interagent/progress/sender";

describe("Interagent集成测试", () => {
  let receiver: GenesisPromptReceiver;
  let sender: ProgressReportSender;

  beforeEach(async () => {
    receiver = new GenesisPromptReceiver();
    sender = new ProgressReportSender();
    await receiver.start();
    await sender.start();
  });

  it("应该能发送并接收Genesis Prompt", async () => {
    const genesis = createTestGenesisPrompt();

    await receiver.handle(genesis);

    const tasks = await receiver.getActiveTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].projectId).toBe(genesis.object.projectId);
  });

  it("应该能同步进度报告", async () => {
    const taskId = "test-task-1";

    await sender.reportProgress(taskId, 50, "Half done");

    // 等待同步
    await sleep(200);

    const stats = sender.getStats();
    expect(stats.totalSyncs).toBeGreaterThan(0);
  });
});
```

---

## 4. E2E测试

### 4.1 测试场景

| 场景ID | 场景描述 | 步骤 | 验收标准 |
|--------|----------|------|----------|
| E2E-001 | 完整接单流程 | RSS监控→筛选→投标→签约 | 成功接单，准确率>85% |
| E2E-002 | 端到端加密 | Automaton→Nanobot全程加密 | 无明文泄露 |
| E2E-003 | 任务生命周期 | 创建→执行→完成→结算 | 状态转换正确 |
| E2E-004 | 错误恢复 | 模拟网络故障 | 自动重连成功 |

### 4.2 能力发现E2E测试

`tests/e2e/capability/discovery.e2e.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe.e2e("能力发现E2E测试", () => {
  it("应该能发现并协商双方能力", async () => {
    // 1. Automaton发布能力
    const automatonCapabilities = {
      "platform_bidding": { version: "1.0" },
      "budget_management": { version: "1.0" }
    };

    // 2. Nanobot发布能力
    const nanobotCapabilities = {
      "code_generation": { version: "1.0" },
      "testing": { version: "1.0" }
    };

    // 3. 自动协商
    const negotiated = await negotiateCapabilities(
      automatonCapabilities,
      nanobotCapabilities
    );

    expect(negotiated.agreedVersion).toBe("1.0");
  });
});
```

### 4.3 消息流E2E测试

`tests/e2e/message-flow/task-lifecycle.e2e.test.ts`:

```typescript
describe.e2e("任务生命周期E2E测试", () => {
  it("应该能完成完整的任务生命周期", async () => {
    // 1. Automaton创建任务
    const genesis = await createGenesisPrompt({
      projectId: "upwork-12345",
      requirement: "开发React电商前端"
    });

    // 2. 发送到Nanobot
    await sendToNanobot(genesis);

    // 3. Nanobot执行并报告进度
    const progress = await waitForProgress("upwork-12345", 100);

    // 4. 验证任务完成
    expect(progress.percentage).toBe(100);
    expect(progress.status).toBe("completed");
  });
});
```

---

## 5. 性能测试

### 5.1 性能基准

| 指标 | 目标值 | 测量方法 |
|------|--------|----------|
| 消息延迟 (P99) | <5秒 | ANP消息往返时间 |
| 代码生成速度 | <30秒/100行 | 基准测试 |
| 并发任务处理 | >=10个并行任务 | 压力测试 |
| 内存占用 | <4GB (正常模式) | 进程监控 |
| 冷启动时间 | <60秒 | 系统重启计时 |

### 5.2 基准测试

```python
import pytest
import time
from nanobot.interagent.progress_reporter import ProgressTracker

class TestPerformanceBenchmarks:
    """性能基准测试"""

    @pytest.mark.benchmark
    def test_message_roundtrip_latency(self):
        """测试消息往返延迟"""
        start = time.time()

        # 发送消息
        message = create_test_message()
        response = await send_and_wait(message)

        latency = time.time() - start

        # P99延迟应<5秒
        assert latency < 5.0, f"Latency {latency}s exceeds 5s requirement"

    @pytest.mark.benchmark
    def test_concurrent_task_handling(self):
        """测试并发任务处理"""
        import asyncio

        async def handle_task(task_id):
            tracker = ProgressTracker(task_id)
            tracker.start()
            await asyncio.sleep(0.1)
            tracker.update(ProgressUpdate(percentage=100))

        # 并发处理10个任务
        start = time.time()
        tasks = [handle_task(f"task-{i}") for i in range(10)]
        asyncio.run(asyncio.gather(*tasks))
        duration = time.time() - start

        # 应能高效处理并发
        assert duration < 5.0, f"Too slow: {duration}s for 10 tasks"

    @pytest.mark.benchmark
    def test_memory_usage(self):
        """测试内存使用"""
        import psutil
        import os

        process = psutil.Process(os.getpid())
        initial_memory = process.memory_info().rss / 1024 / 1024  # MB

        # 执行大量操作
        for i in range(1000):
            tracker = ProgressTracker(f"task-{i}")
            tracker.update(ProgressUpdate(percentage=50))

        final_memory = process.memory_info().rss / 1024 / 1024  # MB
        memory_increase = final_memory - initial_memory

        # 内存增长应合理
        assert memory_increase < 100, f"Memory increase {memory_increase}MB too high"
```

### 5.3 TypeScript基准测试

```typescript
import { describe, bench } from "vitest";

describe("性能基准测试", () => {
  bench("消息签名性能", () => {
    const message = createTestMessage();
    signMessage(message, privateKey);
  }, { iterations: 1000, time: 5000 });

  bench("DID解析性能", () => {
    resolveDID("did:anp:automaton:main");
  }, { iterations: 10000, time: 5000 });
});
```

---

## 6. 压力测试

### 6.1 测试场景

| 场景 | 描述 | 验收标准 |
|------|------|----------|
| 高频消息 | 100 msg/s | 无消息丢失 |
| 长时间运行 | 24小时 | 无内存泄漏 |
| 限制资源 | CPU/内存限制 | 优雅降级 |
| 网络抖动 | 模拟不稳定网络 | 自动重连 |

### 6.2 压力测试示例

```python
import pytest
import asyncio
from nanobot.interagent.progress_reporter import ProgressTracker

@pytest.mark.stress
class TestStressScenarios:
    """压力测试场景"""

    @pytest.mark.asyncio
    async def test_high_frequency_messages(self):
        """测试高频消息处理"""
        sender = ProgressReportSender()
        receiver = ProgressReportReceiver()

        await sender.start()
        await receiver.start()

        # 发送1000条消息
        tasks = []
        for i in range(1000):
            task = sender.report_progress(
                task_id=f"stress-{i}",
                percentage=float(i % 100),
                message=f"Message {i}"
            )
            tasks.append(task)

        results = await asyncio.gather(*tasks)

        # 验证无失败
        success_rate = sum(1 for r in results if r) / len(results)
        assert success_rate > 0.99, f"Success rate {success_rate} too low"

    @pytest.mark.asyncio
    async def test_memory_leak_detection(self):
        """测试内存泄漏检测"""
        import gc
        import tracemalloc

        tracemalloc.start()
        snapshot1 = tracemalloc.take_snapshot()

        # 执行大量操作
        for i in range(10000):
            tracker = ProgressTracker(f"task-{i}")
            tracker.start()
            tracker.update(ProgressUpdate(percentage=50))
            del tracker

        gc.collect()
        snapshot2 = tracemalloc.take_snapshot()

        # 计算内存增长
        top_stats = snapshot2.compare_to(snapshot1, 'lineno')
        total_increase = sum(stat.size_diff for stat in top_stats) / 1024 / 1024  # MB

        # 内存增长应<50MB
        assert total_increase < 50, f"Memory leak detected: {total_increase}MB increase"
```

---

## 7. 安全测试

### 7.1 安全检查清单

| 检查项 | 说明 | 工具 |
|--------|------|------|
| 硬编码密钥 | 检测代码中的密钥 | git-secrets, truffleHog |
| 依赖漏洞 | 扫描依赖安全问题 | npm audit, pip-audit |
| SQL注入 | 检测数据库注入风险 | 手动代码审查 |
| XSS漏洞 | 检测跨站脚本风险 | 手动代码审查 |
| 加密强度 | 验证加密算法安全性 | 安全审计 |

### 7.2 加密安全测试

```python
@pytest.mark.security
class TestEncryptionSecurity:
    """加密安全测试"""

    def test_end_to_end_encryption(self):
        """测试端到端加密"""
        # 原始敏感数据
        sensitive_data = {
            "apiKey": "sk-test-12345",
            "secret": "my-secret-key"
        }

        # 加密
        encrypted = encrypt_with_aes_gcm(
            json.dumps(sensitive_data).encode(),
            encryption_key
        )

        # 验证加密后数据不可读
        assert b"sk-test" not in encrypted
        assert b"secret" not in encrypted

        # 解密
        decrypted_json = decrypt_with_aes_gcm(encrypted, encryption_key)
        decrypted = json.loads(decrypted_json)

        assert decrypted == sensitive_data

    def test_signature_integrity(self):
        """测试签名完整性"""
        message = {"task": "test", "amount": 1000}

        # 生成签名
        signature = sign_message(message, private_key)

        # 篡改消息
        tampered_message = message.copy()
        tampered_message["amount"] = 999999

        # 验证签名应失败
        is_valid = verify_signature(tampered_message, signature, public_key)
        assert is_valid is False
```

---

## 8. 测试覆盖率

### 8.1 覆盖率目标

| 系统 | 语句 | 分支 | 函数 | 行 |
|------|------|------|------|-----|
| Automaton | 60% | 50% | 55% | 60% |
| Nanobot | 80% | 75% | 80% | 80% |
| 整体目标 | 80% | 75% | 80% | 80% |

### 8.2 生成覆盖率报告

#### Automaton

```bash
cd automaton
pnpm test:coverage

# 报告位置
# - coverage/lcov.info (机器可读)
# - coverage/index.html (浏览器查看)
```

#### Nanobot

```bash
cd nanobot
pytest --cov --cov-report=html --cov-report=term

# 报告位置
# - htmlcov/index.html (浏览器查看)
# - terminal output (终端查看)
```

### 8.3 覆盖率报告模板

```markdown
# 测试覆盖率报告

**生成时间**: 2026-02-28
**报告范围**: Automaton + Nanobot

## 整体覆盖率

| 指标 | 目标 | 实际 | 状态 |
|------|------|------|------|
| 语句覆盖率 | 80% | 78.5% | ⚠️ |
| 分支覆盖率 | 75% | 72.3% | ⚠️ |
| 函数覆盖率 | 80% | 81.2% | ✅ |
| 行覆盖率 | 80% | 79.1% | ⚠️ |

## 模块覆盖率详情

### Automaton

| 模块 | 语句 | 分支 | 函数 | 线 |
|------|------|------|------|-----|
| anp/ | 85% | 80% | 88% | 85% |
| interagent/ | 72% | 65% | 75% | 70% |
| survival/ | 90% | 85% | 92% | 90% |
| biz/ | 45% | 35% | 50% | 42% | ❌

### Nanobot

| 模块 | 语句 | 分支 | 函数 | 线 |
|------|------|------|------|-----|
| anp/ | 88% | 82% | 90% | 88% |
| interagent/ | 75% | 70% | 78% | 75% |
| channels/ | 82% | 78% | 85% | 82% |
| skills/ | 65% | 60% | 68% | 64% | ⚠️

## 需要改进的模块

1. **automaton/src/biz/** - 覆盖率偏低，需增加商务决策逻辑测试
2. **nanobot/nanobot/skills/** - 需补充技能系统测试用例

## 下一步行动

- [ ] 为 biz/ 模块添加至少15个测试用例
- [ ] 为 skills/ 模块添加至少10个测试用例
- [ ] 确保所有新代码都有对应测试
```

---

## 9. CI/CD集成

### 9.1 GitHub Actions配置

`.github/workflows/ci.yml`:

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test-automaton:
    name: Test Automaton
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 10.28.1
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
          cache-dependency-path: automaton/pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile
        working-directory: ./automaton

      - name: Type check
        run: pnpm typecheck
        working-directory: ./automaton

      - name: Run tests
        run: pnpm test:ci
        working-directory: ./automaton

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: automaton/coverage/lcov.info
          flags: automaton

  test-nanobot:
    name: Test Nanobot
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'
          cache-dependency-path: nanobot/pyproject.toml

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -e ".[dev]"
        working-directory: ./nanobot

      - name: Run linting
        run: ruff check .
        working-directory: ./nanobot

      - name: Run tests
        run: pytest --cov --cov-report=xml -v
        working-directory: ./nanobot

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: nanobot/coverage.xml
          flags: nanobot

  security-scan:
    name: Security Scan
    runs-on: ubuntu-latest
    needs: [test-automaton, test-nanobot]
    steps:
      - uses: actions/checkout@v4

      - name: Run Trivy (Automaton)
        uses: aquasecurity/trivy-action@master
        with:
          scan-ref: './automaton'
          format: 'table'
          exit-code: '0'

      - name: Run Trivy (Nanobot)
        uses: aquasecurity/trivy-action@master
        with:
          scan-ref: './nanobot'
          format: 'table'
          exit-code: '0'
```

### 9.2 本地Pre-commit钩子

`.git/hooks/pre-commit`:

```bash
#!/bin/bash

# Automaton类型检查
cd automaton
pnpm typecheck || exit 1
pnpm test --run || exit 1
cd ..

# Nanobot代码检查
cd nanobot
ruff check . || exit 1
pytest --quiet || exit 1
cd ..

echo "✅ All checks passed!"
```

---

## 10. 故障恢复测试

### 10.1 测试场景

| 场景ID | 场景描述 | 模拟方法 | 预期行为 |
|--------|----------|----------|----------|
| REC-001 | 网络中断 | 关闭网络接口 | 自动重连 |
| REC-002 | 进程崩溃 | kill -9 | 自动重启 |
| REC-003 | 数据库损坏 | 损坏SQLite文件 | 从备份恢复 |
| REC-004 | API限流 | 返回429 | 退避重试 |

### 10.2 故障恢复测试示例

```python
@pytest.mark.recovery
class TestFailureRecovery:
    """故障恢复测试"""

    @pytest.mark.asyncio
    async def test_network_reconnection(self):
        """测试网络重连"""
        sender = ProgressReportSender()
        await sender.start()

        # 模拟网络断开
        await sender.disconnect()

        # 尝试发送消息
        success = await sender.report_progress(
            task_id="test-1",
            percentage=50
        )

        # 应该缓存消息
        assert success is True
        assert sender.get_pending_count() > 0

        # 恢复网络
        await sender.reconnect()

        # 等待缓存发送
        await asyncio.sleep(1)

        # 验证消息已发送
        assert sender.get_pending_count() == 0

    @pytest.mark.asyncio
    async def test_process_restart_recovery(self):
        """测试进程重启恢复"""
        # 创建持久化状态
        tracker = ProgressTracker("persistent-task")
        tracker.set_persistent(True)
        tracker.update(ProgressUpdate(percentage=50))

        # 保存状态
        state = tracker.get_state()
        save_to_disk(state)

        # 模拟进程重启
        del tracker

        # 恢复状态
        restored_state = load_from_disk()
        new_tracker = ProgressTracker.from_state(restored_state)

        # 验证状态恢复
        assert new_tracker.get_percentage() == 50.0

    @pytest.mark.asyncio
    async def test_api_rate_limit_handling(self):
        """测试API限流处理"""
        # 模拟429响应
        with mock_response(status=429, headers={"Retry-After": "5"}):
            result = await api_client.call(endpoint)

            # 应该自动退避
            assert result.retried is True
            assert result.retry_delay >= 5
```

---

## 11. 回归测试

### 11.1 回归测试套件

回归测试确保现有功能在代码变更后仍然正常工作。

```python
# tests/regression/test_regression_suite.py
import pytest

@pytest.mark.regression
class TestRegressionSuite:
    """回归测试套件"""

    def test_anp_message_format_unchanged(self):
        """确保ANP消息格式未改变"""
        message = create_test_message()

        # 验证必需字段
        assert "@context" in message
        assert "@type" in message
        assert "id" in message
        assert message["@type"] == "ANPMessage"

    def test_did_format_backward_compatible(self):
        """确保DID格式向后兼容"""
        old_did = "did:anp:automaton:main"
        new_did = resolve_did(old_did)

        assert new_did is not None
        assert new_did.startswith("did:anp:")

    def test_progress_sync_protocol_unchanged(self):
        """确保进度同步协议未改变"""
        sender = ProgressReportSender()
        receiver = ProgressReportReceiver()

        # 使用旧协议版本
        old_protocol_message = create_v1_progress_message()
        can_handle = receiver.can_handle(old_protocol_message)

        assert can_handle is True

    def test_budget_tracking_calculation_consistent(self):
        """确保预算追踪计算一致"""
        tracker = BudgetTracker()
        tracker.addIncome(10000, "USD")
        tracker.addExpense(3000, "USD")

        # 计算应该与之前版本一致
        remaining = tracker.getRemainingBudget()
        assert remaining == 7000

    def test_survival_tier_transitions_unchanged(self):
        """确保生存层级转换未改变"""
        survival = SurvivalManager()

        # 测试层级转换阈值
        survival.setBalance(10000)
        assert survival.getTier() == "normal"

        survival.setBalance(1000)
        assert survival.getTier() == "low_compute"

        survival.setBalance(100)
        assert survival.getTier() == "critical"
```

### 11.2 运行回归测试

```bash
# 只运行回归测试
pytest -m regression

# Automaton回归测试
cd automaton
pnpm test --tag=regression

# 运行所有回归测试并生成报告
pytest -m regression --cov --cov-report=html --html=regression-report.html
```

---

## 附录

### A. 测试最佳实践

1. **AAA模式** - Arrange, Act, Assert
2. **单一断言** - 每个测试只验证一件事
3. **描述性命名** - 测试名称应描述被测试的行为
4. **避免测试实现细节** - 测试行为而非实现
5. **使用工厂** - 避免在测试中构建复杂对象

### B. 常用测试命令速查

#### Automaton (TypeScript)

```bash
# 运行所有测试
pnpm test

# 覆盖率报告
pnpm test:coverage

# 监听模式
pnpm test --watch

# CI模式
pnpm test:ci

# 类型检查
pnpm typecheck

# 安全测试
pnpm test:security

# 金融测试
pnpm test:financial
```

#### Nanobot (Python)

```bash
# 运行所有测试
pytest

# 详细输出
pytest -v

# 覆盖率报告
pytest --cov --cov-report=html

# 只运行失败的测试
pytest --lf

# 运行特定标记的测试
pytest -m regression
pytest -m integration
pytest -m e2e
pytest -m stress
pytest -m security
pytest -m benchmark

# 并行运行
pytest -n auto

# 代码检查
ruff check .

# 格式化代码
ruff format .
```

### C. 测试标记

| 标记 | 含义 | 用途 |
|------|------|------|
| `@pytest.mark.unit` | 单元测试 | 快速隔离测试 |
| `@pytest.mark.integration` | 集成测试 | 模块交互测试 |
| `@pytest.mark.e2e` | 端到端测试 | 完整流程测试 |
| `@pytest.mark.stress` | 压力测试 | 极限条件测试 |
| `@pytest.mark.security` | 安全测试 | 安全漏洞测试 |
| `@pytest.mark.benchmark` | 基准测试 | 性能基准测试 |
| `@pytest.mark.regression` | 回归测试 | 防止功能退化 |
| `@pytest.mark.recovery` | 恢复测试 | 故障恢复测试 |

### D. 测试数据管理

```python
# tests/conftest.py
import pytest

@pytest.fixture(scope="session")
def test_did_keys():
    """会话级DID密钥对"""
    return generate_key_pair()

@pytest.fixture(scope="function")
def clean_database():
    """函数级干净数据库"""
    db = create_test_database()
    yield db
    db.cleanup()

@pytest.fixture
def mock_external_api(monkeypatch):
    """模拟外部API"""
    def mock_call(endpoint):
        return {"status": "ok", "data": "test"}

    monkeypatch.setattr("external_api.call", mock_call)
```

### E. 参考文档

- [Vitest文档](https://vitest.dev/)
- [Pytest文档](https://docs.pytest.org/)
- [pytest-asyncio文档](https://pytest-asyncio.readthedocs.io/)
- [项目需求分析](./requirements-analysis.md)
- [实施计划](./implementation-plan.md)
- [ANP通信设计](./anp-communication-design.md)
- [安全审计报告](./security-audit-report.md)

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-28
**维护者**: autoJieDan项目组
