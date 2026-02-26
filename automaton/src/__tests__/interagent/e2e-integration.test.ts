/**
 * Day 36-37: 端到端集成测试
 *
 * 测试 Automaton 和 Nanobot 之间的完整通信流程：
 * - 安全认证的完整流程
 * - 任务管理集成
 * - 重试机制集成
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
import {
  TaskManager,
  type CreateTaskOptions,
} from "../../interagent/task-manager";
import { retry, type RetryConfig } from "../../interagent/retry";

describe("End-to-End Integration Tests", () => {
  let keyManager: KeyManager;
  let tlsManager: TLSManager;
  let acManager: AccessControlManager;
  let taskManager: TaskManager;

  const testKeyStore = "./test-e2e-keys";
  const testCertStore = "./test-e2e-certs";
  const testDbPath = "./test-e2e-tasks.db";

  const retryConfig: RetryConfig = {
    maxRetries: 3,
    initialDelay: 100,
    maxDelay: 5000,
    backoffStrategy: "exponential",
    jitterType: "full",
  };

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

    // 创建任务组件
    taskManager = new TaskManager({
      dbPath: testDbPath,
      maxRetries: 3,
      retryDelay: 1000,
    });

    // 启动任务管理器
    taskManager.start();
  });

  afterEach(async () => {
    // 停止组件
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
  // 安全组件集成测试
  // ========================================================================

  describe("Security Integration", () => {
    it("should enforce access control for task operations", async () => {
      // 注册用户
      const adminUser: Subject = {
        id: "admin",
        type: "user",
        roles: ["admin"],
        attributes: {},
        createdAt: new Date(),
      };

      const normalUser: Subject = {
        id: "user",
        type: "user",
        roles: ["user"],
        attributes: {},
        createdAt: new Date(),
      };

      acManager.registerSubject(adminUser);
      acManager.registerSubject(normalUser);

      // 管理员可以创建任务
      const adminRequest: AccessRequest = {
        subjectId: "admin",
        resource: "task",
        resourceId: "*",
        action: "create",
      };
      expect(acManager.checkAccess(adminRequest).allowed).toBe(true);

      // 普通用户可以读取任务
      const userReadRequest: AccessRequest = {
        subjectId: "user",
        resource: "task",
        resourceId: "task-1",
        action: "read",
      };
      expect(acManager.checkAccess(userReadRequest).allowed).toBe(true);

      // 普通用户不能删除任务
      const userDeleteRequest: AccessRequest = {
        subjectId: "user",
        resource: "task",
        resourceId: "task-1",
        action: "delete",
      };
      expect(acManager.checkAccess(userDeleteRequest).allowed).toBe(false);
    });

    it("should generate and validate keys for secure communication", async () => {
      // 生成密钥
      const key = await keyManager.generateKey("encryption" as any, {
        name: "test-comm-key",
      });

      expect(key.id).toBeDefined();
      expect(key.status).toBe("active");

      // 验证密钥
      const isValid = await keyManager.validateKey(key.id);
      expect(isValid).toBe(true);
    });

    it("should manage certificates for TLS", async () => {
      // 生成证书
      const subject: CertificateSubject = {
        commonName: "test.example.com",
      };
      const { info: certInfo } = tlsManager.generateSelfSignedCertificate({
        certType: "server" as any,
        subject,
        days: 365,
        keyType: "rsa" as any,
      });

      expect(certInfo.id).toBeDefined();

      // 验证证书
      const validation = tlsManager.validateCertificate(certInfo.id);
      expect(validation.valid).toBe(true);
    });
  });

  // ========================================================================
  // 任务管理集成测试
  // ========================================================================

  describe("Task Management Integration", () => {
    it("should create and manage tasks", async () => {
      // 创建任务
      const options: CreateTaskOptions = {
        type: "code_generation",
        priority: "high",
        payload: {
          prompt: "Write a function",
          language: "typescript",
        },
        targetAgent: "nanobot-1",
        maxRetries: 3,
        timeout: 60000,
      };

      const task = taskManager.createTask(options);

      expect(task.id).toBeDefined();
      expect(task.status).toBe("pending");
      expect(task.type).toBe("code_generation");
      expect(task.priority).toBe("high");
    });

    it("should handle task lifecycle transitions", async () => {
      // 创建任务
      const task = taskManager.createTask({
        type: "test",
        priority: "normal",
        payload: {},
        targetAgent: "test-agent",
      });

      expect(task.status).toBe("pending");

      // 更新状态到运行中
      const runningTask = taskManager.updateTaskStatus(task.id, "running");
      expect(runningTask?.status).toBe("running");

      // 更新状态到完成
      const completedTask = taskManager.updateTaskStatus(task.id, "completed", {
        result: { output: "done" },
      });
      expect(completedTask?.status).toBe("completed");
      expect(completedTask?.result).toEqual({ output: "done" });
    });

    it("should handle task retry with exponential backoff", async () => {
      let attempts = 0;
      const result = await retry(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error("Temporary failure");
          }
          return "success";
        },
        retryConfig
      );

      expect(result).toBe("success");
      expect(attempts).toBe(3);
    });

    it("should handle task lease management", async () => {
      // 创建任务
      const task = taskManager.createTask({
        type: "lease_test",
        priority: "normal",
        payload: {},
        targetAgent: "test-agent",
      });

      // 获取租约
      const leasedTask = taskManager.acquireLease(task.id, 60);
      expect(leasedTask?.leaseExpiresAt).toBeDefined();

      // 释放租约
      const releasedTask = taskManager.releaseLease(task.id);
      expect(releasedTask?.leaseExpiresAt).toBeUndefined();
    });

    it("should handle task cancellation", async () => {
      // 创建任务
      const task = taskManager.createTask({
        type: "cancel_test",
        priority: "normal",
        payload: {},
        targetAgent: "test-agent",
      });

      // 取消任务
      const cancelledTask = taskManager.cancelTask(task.id, "User requested");
      expect(cancelledTask?.status).toBe("cancelled");
      expect(cancelledTask?.error).toBe("User requested");
    });
  });

  // ========================================================================
  // 完整工作流集成测试
  // ========================================================================

  describe("Complete Workflow Integration", () => {
    it("should complete a full workflow with security and tasks", async () => {
      // 1. 设置安全上下文
      const agentSubject: Subject = {
        id: "agent-nanobot-1",
        type: "agent",
        roles: ["agent"],
        attributes: { tier: "standard" },
        createdAt: new Date(),
      };
      acManager.registerSubject(agentSubject);

      // 2. 生成通信密钥
      const commKey = await keyManager.generateKey("encryption" as any, {
        name: "agent-comm-key",
      });
      expect(commKey.id).toBeDefined();

      // 3. 验证访问权限
      const accessRequest: AccessRequest = {
        subjectId: "agent-nanobot-1",
        resource: "task",
        resourceId: "*",
        action: "execute",
      };
      const accessDecision = acManager.checkAccess(accessRequest);
      expect(accessDecision.allowed).toBe(true);

      // 4. 创建任务
      const task = taskManager.createTask({
        type: "agent_task",
        priority: "high",
        payload: {
          action: "process_data",
          data: { items: [1, 2, 3, 4, 5] },
        },
        targetAgent: "nanobot-1",
      });

      // 5. 执行任务（通过状态转换模拟）
      taskManager.updateTaskStatus(task.id, "running");

      // 6. 完成任务
      const result = {
        processed: 5,
        output: [2, 4, 6, 8, 10],
      };
      taskManager.updateTaskStatus(task.id, "completed", { result });

      // 7. 验证完整工作流
      const finalTask = taskManager.getTask(task.id);
      expect(finalTask?.status).toBe("completed");
      expect(finalTask?.result).toEqual(result);
    });

    it("should handle concurrent tasks correctly", async () => {
      // 创建多个任务
      const task1 = taskManager.createTask({
        type: "concurrent_test",
        priority: "normal",
        payload: { id: 1 },
        targetAgent: "agent-1",
      });
      const task2 = taskManager.createTask({
        type: "concurrent_test",
        priority: "normal",
        payload: { id: 2 },
        targetAgent: "agent-2",
      });
      const task3 = taskManager.createTask({
        type: "concurrent_test",
        priority: "normal",
        payload: { id: 3 },
        targetAgent: "agent-3",
      });

      const tasks = [task1, task2, task3];
      expect(tasks.length).toBe(3);
      tasks.forEach((task) => {
        expect(task.status).toBe("pending");
      });

      // 并发执行（更新状态）
      for (const task of tasks) {
        taskManager.updateTaskStatus(task.id, "running");
        taskManager.updateTaskStatus(task.id, "completed", {
          result: `completed-${task.id}`,
        });
      }

      // 验证所有任务都完成
      const finalTasks = tasks.map((t) => taskManager.getTask(t.id));
      finalTasks.forEach((task) => {
        expect(task?.status).toBe("completed");
      });
    });

    it("should handle task failures in workflow", async () => {
      // 创建任务
      const task = taskManager.createTask({
        type: "fail_test",
        priority: "normal",
        payload: { shouldFail: true },
        targetAgent: "test-agent",
        maxRetries: 3,
      });

      // 更新状态到运行中
      taskManager.updateTaskStatus(task.id, "running");

      // 模拟失败
      taskManager.updateTaskStatus(task.id, "failed", {
        error: "Simulated failure for testing",
      });

      const failedTask = taskManager.getTask(task.id);
      expect(failedTask?.status).toBe("failed");
      expect(failedTask?.error).toBe("Simulated failure for testing");
    });
  });

  // ========================================================================
  // 安全 + 任务 集成测试
  // ========================================================================

  describe("Security + Task Integration", () => {
    it("should authorize task creation based on roles", async () => {
      // 注册不同角色的用户
      const admin: Subject = {
        id: "admin-user",
        type: "user",
        roles: ["admin"],
        attributes: {},
        createdAt: new Date(),
      };

      const guest: Subject = {
        id: "guest-user",
        type: "user",
        roles: ["guest"],
        attributes: {},
        createdAt: new Date(),
      };

      acManager.registerSubject(admin);
      acManager.registerSubject(guest);

      // 验证 admin 可以创建任务
      const adminCreateRequest: AccessRequest = {
        subjectId: "admin-user",
        resource: "task",
        resourceId: "*",
        action: "create",
      };
      expect(acManager.checkAccess(adminCreateRequest).allowed).toBe(true);

      // 验证 guest 不能创建任务
      const guestCreateRequest: AccessRequest = {
        subjectId: "guest-user",
        resource: "task",
        resourceId: "*",
        action: "create",
      };
      expect(acManager.checkAccess(guestCreateRequest).allowed).toBe(false);
    });

    it("should protect sensitive task operations", async () => {
      // 注册普通用户
      const user: Subject = {
        id: "regular-user",
        type: "user",
        roles: ["user"],
        attributes: {},
        createdAt: new Date(),
      };

      acManager.registerSubject(user);

      // 用户可以读取任务
      const readRequest: AccessRequest = {
        subjectId: "regular-user",
        resource: "task",
        resourceId: "task-1",
        action: "read",
      };
      expect(acManager.checkAccess(readRequest).allowed).toBe(true);

      // 用户不能删除任务
      const deleteRequest: AccessRequest = {
        subjectId: "regular-user",
        resource: "task",
        resourceId: "task-1",
        action: "delete",
      };
      expect(acManager.checkAccess(deleteRequest).allowed).toBe(false);
    });
  });
});
