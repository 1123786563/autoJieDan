/**
 * Day 39: 性能基准测试
 *
 * 测试系统性能基准：
 * - 任务吞吐量测试
 * - 响应时间测试
 * - 并发处理测试
 * - 安全组件性能
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";

// Security Components
import {
  type KeyManager,
  createKeyManager,
} from "../../interagent/key-manager";
import {
  type TLSManager,
  createTLSManager,
  type CertificateSubject,
} from "../../interagent/tls-manager";
import {
  type AccessControlManager,
  createAccessControlManager,
  type Subject,
  type AccessRequest,
} from "../../interagent/access-control";

// Task Components
import { TaskManager, type CreateTaskOptions } from "../../interagent/task-manager";

describe("Performance Benchmark Tests", () => {
  let keyManager: KeyManager;
  let tlsManager: TLSManager;
  let acManager: AccessControlManager;
  let taskManager: TaskManager;

  const testKeyStore = "./test-perf-keys";
  const testCertStore = "./test-perf-certs";
  const testDbPath = "./test-perf-tasks.db";

  beforeEach(async () => {
    // 清理测试目录
    for (const dir of [testDbPath, testKeyStore, testCertStore]) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
      }
    }

    // 创建安全组件
    keyManager = createKeyManager({
      keyStorePath: testKeyStore,
      autoRotate: false,
    });

    tlsManager = createTLSManager({
      certStorePath: testCertStore,
      autoRenew: false,
    });

    acManager = createAccessControlManager({
      defaultPolicy: "deny",
      enableInheritance: true,
      enableConditions: true,
    });

    // 创建任务管理器
    taskManager = new TaskManager({
      dbPath: testDbPath,
      maxRetries: 3,
      retryDelay: 1000,
    });

    taskManager.start();
  });

  afterEach(async () => {
    taskManager.stop();
    keyManager.close();
    tlsManager.close();
    acManager.close();

    // 清理测试目录
    for (const dir of [testDbPath, testKeyStore, testCertStore]) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
      }
    }
  });

  // ========================================================================
  // 任务吞吐量测试
  // ========================================================================

  describe("Task Throughput Benchmarks", () => {
    it("should measure task creation throughput", async () => {
      const taskCount = 100;
      const startTime = Date.now();

      for (let i = 0; i < taskCount; i++) {
        taskManager.createTask({
          type: "throughput_test",
          priority: "normal",
          payload: { index: i },
          targetAgent: "test-agent",
        });
      }

      const duration = Date.now() - startTime;
      const throughput = taskCount / (duration / 1000);

      console.log(`Task creation throughput: ${throughput.toFixed(2)} tasks/sec`);
      console.log(`Total time for ${taskCount} tasks: ${duration}ms`);

      // 基准：应该能处理至少 100 tasks/sec
      expect(throughput).toBeGreaterThan(100);
    });

    it("should measure task status update throughput", async () => {
      const task = taskManager.createTask({
        type: "update_test",
        priority: "normal",
        payload: {},
        targetAgent: "test-agent",
      });

      const updateCount = 100;
      const startTime = Date.now();

      for (let i = 0; i < updateCount; i++) {
        taskManager.updateTaskStatus(task.id, "running");
        taskManager.updateTaskStatus(task.id, "pending");
      }

      const duration = Date.now() - startTime;
      const throughput = (updateCount * 2) / (duration / 1000);

      console.log(`Status update throughput: ${throughput.toFixed(2)} updates/sec`);
      console.log(`Total time for ${updateCount * 2} updates: ${duration}ms`);

      // 基准：应该能处理至少 200 updates/sec
      expect(throughput).toBeGreaterThan(200);
    });

    it("should measure task query throughput", async () => {
      // 创建一些任务
      for (let i = 0; i < 50; i++) {
        taskManager.createTask({
          type: "query_test",
          priority: "normal",
          payload: { index: i },
          targetAgent: "test-agent",
        });
      }

      const queryCount = 100;
      const startTime = Date.now();

      for (let i = 0; i < queryCount; i++) {
        taskManager.getPendingTasks();
      }

      const duration = Date.now() - startTime;
      const throughput = queryCount / (duration / 1000);

      console.log(`Query throughput: ${throughput.toFixed(2)} queries/sec`);
      console.log(`Total time for ${queryCount} queries: ${duration}ms`);

      // 基准：应该能处理至少 500 queries/sec
      expect(throughput).toBeGreaterThan(500);
    });
  });

  // ========================================================================
  // 响应时间测试
  // ========================================================================

  describe("Response Time Benchmarks", () => {
    it("should measure task creation latency", async () => {
      const latencies: number[] = [];

      for (let i = 0; i < 50; i++) {
        const startTime = Date.now();
        taskManager.createTask({
          type: "latency_test",
          priority: "normal",
          payload: { index: i },
          targetAgent: "test-agent",
        });
        latencies.push(Date.now() - startTime);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);
      const minLatency = Math.min(...latencies);

      console.log(`Task creation latency - Avg: ${avgLatency.toFixed(2)}ms, Max: ${maxLatency}ms, Min: ${minLatency}ms`);

      // 基准：平均延迟应小于 5ms
      expect(avgLatency).toBeLessThan(5);
    });

    it("should measure access control check latency", async () => {
      // 注册用户
      const user: Subject = {
        id: "perf-user",
        type: "user",
        roles: ["user"],
        attributes: {},
        createdAt: new Date(),
      };
      acManager.registerSubject(user);

      const latencies: number[] = [];

      for (let i = 0; i < 100; i++) {
        const startTime = Date.now();
        acManager.checkAccess({
          subjectId: "perf-user",
          resource: "task",
          resourceId: `task-${i}`,
          action: "read",
        });
        latencies.push(Date.now() - startTime);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);

      console.log(`Access control latency - Avg: ${avgLatency.toFixed(2)}ms, Max: ${maxLatency}ms`);

      // 基准：平均延迟应小于 1ms
      expect(avgLatency).toBeLessThan(1);
    });
  });

  // ========================================================================
  // 并发处理测试
  // ========================================================================

  describe("Concurrency Benchmarks", () => {
    it("should measure concurrent task creation", async () => {
      const concurrency = 10;
      const tasksPerBatch = 10;
      const startTime = Date.now();

      const promises = [];
      for (let batch = 0; batch < concurrency; batch++) {
        promises.push(
          (async () => {
            for (let i = 0; i < tasksPerBatch; i++) {
              taskManager.createTask({
                type: "concurrent_test",
                priority: "normal",
                payload: { batch, index: i },
                targetAgent: "test-agent",
              });
            }
          })()
        );
      }

      await Promise.all(promises);

      const duration = Date.now() - startTime;
      const totalTasks = concurrency * tasksPerBatch;
      const throughput = totalTasks / (duration / 1000);

      console.log(`Concurrent creation throughput: ${throughput.toFixed(2)} tasks/sec`);
      console.log(`Created ${totalTasks} tasks in ${duration}ms with ${concurrency} concurrent writers`);

      // 基准：并发创建应该能处理至少 50 tasks/sec
      expect(throughput).toBeGreaterThan(50);
    });

    it("should handle concurrent read/write operations", async () => {
      // 预创建一些任务
      const taskIds: string[] = [];
      for (let i = 0; i < 20; i++) {
        const task = taskManager.createTask({
          type: "rw_test",
          priority: "normal",
          payload: { index: i },
          targetAgent: "test-agent",
        });
        taskIds.push(task.id);
      }

      const startTime = Date.now();
      const operations = 100;

      const promises = [];
      for (let i = 0; i < operations; i++) {
        const taskId = taskIds[i % taskIds.length];
        if (i % 2 === 0) {
          // 读操作
          promises.push(Promise.resolve(taskManager.getTask(taskId)));
        } else {
          // 写操作
          promises.push(
            Promise.resolve(taskManager.updateTaskStatus(taskId, "running"))
          );
        }
      }

      await Promise.all(promises);

      const duration = Date.now() - startTime;
      const throughput = operations / (duration / 1000);

      console.log(`Concurrent R/W throughput: ${throughput.toFixed(2)} ops/sec`);
      console.log(`Completed ${operations} operations in ${duration}ms`);

      // 基准：应该能处理至少 200 ops/sec
      expect(throughput).toBeGreaterThan(200);
    });
  });

  // ========================================================================
  // 安全组件性能测试
  // ========================================================================

  describe("Security Component Benchmarks", () => {
    it("should measure key generation performance", async () => {
      const keyCount = 20;
      const startTime = Date.now();

      for (let i = 0; i < keyCount; i++) {
        await keyManager.generateKey("encryption" as any, {
          name: `perf-key-${i}`,
        });
      }

      const duration = Date.now() - startTime;
      const throughput = keyCount / (duration / 1000);

      console.log(`Key generation throughput: ${throughput.toFixed(2)} keys/sec`);
      console.log(`Generated ${keyCount} keys in ${duration}ms`);

      // 基准：应该能生成至少 5 keys/sec
      expect(throughput).toBeGreaterThan(5);
    });

    it("should measure key validation performance", async () => {
      // 生成测试密钥
      const key = await keyManager.generateKey("encryption" as any, {
        name: "validation-test-key",
      });

      const validationCount = 100;
      const startTime = Date.now();

      for (let i = 0; i < validationCount; i++) {
        await keyManager.validateKey(key.id);
      }

      const duration = Date.now() - startTime;
      const throughput = validationCount / (duration / 1000);

      console.log(`Key validation throughput: ${throughput.toFixed(2)} validations/sec`);
      console.log(`Validated ${validationCount} times in ${duration}ms`);

      // 基准：应该能验证至少 100 keys/sec
      expect(throughput).toBeGreaterThan(100);
    });

    it("should measure certificate generation performance", async () => {
      const certCount = 10;
      const startTime = Date.now();

      for (let i = 0; i < certCount; i++) {
        const subject: CertificateSubject = {
          commonName: `perf-cert-${i}.example.com`,
        };
        tlsManager.generateSelfSignedCertificate({
          certType: "server" as any,
          subject,
          days: 365,
          keyType: "rsa" as any,
        });
      }

      const duration = Date.now() - startTime;
      const throughput = certCount / (duration / 1000);

      console.log(`Certificate generation throughput: ${throughput.toFixed(2)} certs/sec`);
      console.log(`Generated ${certCount} certificates in ${duration}ms`);

      // 基准：应该能生成至少 2 certs/sec
      expect(throughput).toBeGreaterThan(2);
    });

    it("should measure certificate validation performance", async () => {
      // 生成测试证书
      const subject: CertificateSubject = {
        commonName: "validation-test.example.com",
      };
      const { info: certInfo } = tlsManager.generateSelfSignedCertificate({
        certType: "server" as any,
        subject,
        days: 365,
        keyType: "rsa" as any,
      });

      const validationCount = 100;
      const startTime = Date.now();

      for (let i = 0; i < validationCount; i++) {
        tlsManager.validateCertificate(certInfo.id);
      }

      const duration = Date.now() - startTime;
      const throughput = validationCount / (duration / 1000);

      console.log(`Certificate validation throughput: ${throughput.toFixed(2)} validations/sec`);
      console.log(`Validated ${validationCount} times in ${duration}ms`);

      // 基准：应该能验证至少 500 certs/sec
      expect(throughput).toBeGreaterThan(500);
    });
  });

  // ========================================================================
  // 综合性能报告
  // ========================================================================

  describe("Performance Summary", () => {
    it("should generate performance summary", async () => {
      const results: { operation: string; duration: number; count: number }[] = [];

      // 任务创建
      let startTime = Date.now();
      for (let i = 0; i < 50; i++) {
        taskManager.createTask({
          type: "summary_test",
          priority: "normal",
          payload: {},
          targetAgent: "test-agent",
        });
      }
      results.push({
        operation: "Task Creation (50)",
        duration: Date.now() - startTime,
        count: 50,
      });

      // 访问控制检查
      const user: Subject = {
        id: "summary-user",
        type: "user",
        roles: ["user"],
        attributes: {},
        createdAt: new Date(),
      };
      acManager.registerSubject(user);

      startTime = Date.now();
      for (let i = 0; i < 100; i++) {
        acManager.checkAccess({
          subjectId: "summary-user",
          resource: "task",
          resourceId: `task-${i}`,
          action: "read",
        });
      }
      results.push({
        operation: "Access Check (100)",
        duration: Date.now() - startTime,
        count: 100,
      });

      // 密钥生成
      startTime = Date.now();
      for (let i = 0; i < 10; i++) {
        await keyManager.generateKey("encryption" as any, {
          name: `summary-key-${i}`,
        });
      }
      results.push({
        operation: "Key Generation (10)",
        duration: Date.now() - startTime,
        count: 10,
      });

      // 输出摘要
      console.log("\n=== Performance Summary ===");
      for (const result of results) {
        const throughput = result.count / (result.duration / 1000);
        console.log(
          `${result.operation}: ${result.duration}ms (${throughput.toFixed(2)} ops/sec)`
        );
      }
      console.log("===========================\n");

      expect(results.length).toBe(3);
    });
  });
});
