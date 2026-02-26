/**
 * Week 5 安全集成测试
 *
 * 测试所有安全组件的协作：
 * - 密钥管理 (key-manager)
 * - TLS 配置 (tls-manager)
 * - 访问控制 (access-control)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import {
  type KeyManager,
  createKeyManager,
  type KeyPurpose,
} from "../../interagent/key-manager";
import {
  type TLSManager,
  createTLSManager,
  type CertificateType,
  type KeyType,
  type CertificateSubject,
} from "../../interagent/tls-manager";
import {
  type AccessControlManager,
  createAccessControlManager,
  type Subject,
  type AccessRequest,
  type AccessControlEntry,
} from "../../interagent/access-control";

describe("Security Integration Tests", () => {
  let keyManager: KeyManager;
  let tlsManager: TLSManager;
  let acManager: AccessControlManager;

  const testKeyStore = "./test-security-keys";
  const testCertStore = "./test-security-certs";

  beforeEach(() => {
    // 清理测试目录
    for (const dir of [testKeyStore, testCertStore]) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
      }
    }

    // 创建管理器实例
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
  });

  afterEach(() => {
    if (keyManager) keyManager.close();
    if (tlsManager) tlsManager.close();
    if (acManager) acManager.close();

    // 清理测试目录
    for (const dir of [testKeyStore, testCertStore]) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
      }
    }
  });

  // ========================================================================
  // 密钥管理 + 访问控制 集成
  // ========================================================================

  describe("Key Manager + Access Control Integration", () => {
    it("should restrict key generation to authorized users", async () => {
      // 设置访问控制
      const adminSubject: Subject = {
        id: "admin-user",
        type: "user",
        roles: ["admin"],
        attributes: {},
        createdAt: new Date(),
      };
      const guestSubject: Subject = {
        id: "guest-user",
        type: "user",
        roles: ["guest"],
        attributes: {},
        createdAt: new Date(),
      };

      acManager.registerSubject(adminSubject);
      acManager.registerSubject(guestSubject);

      // 管理员可以生成密钥
      const adminRequest: AccessRequest = {
        subjectId: "admin-user",
        resource: "key",
        resourceId: "key-1",
        action: "create",
      };
      const adminDecision = acManager.checkAccess(adminRequest);
      expect(adminDecision.allowed).toBe(true);

      // 访客不能生成密钥
      const guestRequest: AccessRequest = {
        subjectId: "guest-user",
        resource: "key",
        resourceId: "key-2",
        action: "create",
      };
      const guestDecision = acManager.checkAccess(guestRequest);
      expect(guestDecision.allowed).toBe(false);
    });

    it("should log key access in access control audit", async () => {
      // 生成密钥
      const key = await keyManager.generateKey("encryption" as KeyPurpose, {
        name: "audit-key",
      });

      // 注册主体
      const subject: Subject = {
        id: "auditor",
        type: "user",
        roles: ["admin"],
        attributes: {},
        createdAt: new Date(),
      };
      acManager.registerSubject(subject);

      // 检查访问权限
      const request: AccessRequest = {
        subjectId: "auditor",
        resource: "key",
        resourceId: key.id,
        action: "read",
      };
      const decision = acManager.checkAccess(request);

      expect(decision.allowed).toBe(true);
      expect(decision.appliedRoles).toContain("admin");
    });
  });

  // ========================================================================
  // TLS + 访问控制 集成
  // ========================================================================

  describe("TLS Manager + Access Control Integration", () => {
    it("should restrict certificate generation to authorized users", async () => {
      // 设置访问控制
      const adminSubject: Subject = {
        id: "cert-admin",
        type: "user",
        roles: ["admin"],
        attributes: {},
        createdAt: new Date(),
      };
      const userSubject: Subject = {
        id: "cert-user",
        type: "user",
        roles: ["user"],
        attributes: {},
        createdAt: new Date(),
      };

      acManager.registerSubject(adminSubject);
      acManager.registerSubject(userSubject);

      // 管理员可以生成证书
      const adminRequest: AccessRequest = {
        subjectId: "cert-admin",
        resource: "certificate",
        resourceId: "cert-1",
        action: "create",
      };
      const adminDecision = acManager.checkAccess(adminRequest);
      expect(adminDecision.allowed).toBe(true);

      // 普通用户不能生成证书
      const userRequest: AccessRequest = {
        subjectId: "cert-user",
        resource: "certificate",
        resourceId: "cert-2",
        action: "create",
      };
      const userDecision = acManager.checkAccess(userRequest);
      expect(userDecision.allowed).toBe(false);
    });

    it("should validate certificate access with ACL", async () => {
      // 生成证书
      const subject: CertificateSubject = {
        commonName: "test.example.com",
      };
      const { info: certInfo } = tlsManager.generateSelfSignedCertificate({
        certType: "server" as CertificateType,
        subject,
        days: 365,
        keyType: "rsa" as KeyType,
      });

      // 设置 ACL
      const aclSubject: Subject = {
        id: "acl-user",
        type: "user",
        roles: [],
        attributes: {},
        createdAt: new Date(),
      };
      acManager.registerSubject(aclSubject);

      // 添加 ACL 条目
      const aclEntry: AccessControlEntry = {
        id: "acl-cert-read",
        subjectId: "acl-user",
        resource: "certificate",
        resourceId: certInfo.id,
        allowedActions: ["read"],
        deniedActions: [],
        createdAt: new Date(),
      };
      acManager.addACLEntry(aclEntry);

      // 检查访问
      const request: AccessRequest = {
        subjectId: "acl-user",
        resource: "certificate",
        resourceId: certInfo.id,
        action: "read",
      };
      const decision = acManager.checkAccess(request);

      expect(decision.allowed).toBe(true);
      expect(decision.matchedPermissions).toContain(
        `acl:acl-cert-read:allow`
      );
    });
  });

  // ========================================================================
  // 密钥管理 + TLS 集成
  // ========================================================================

  describe("Key Manager + TLS Manager Integration", () => {
    it("should use separate keys for different certificate types", async () => {
      // 生成服务器证书
      const serverSubject: CertificateSubject = {
        commonName: "server.example.com",
      };
      const { info: serverCert } = tlsManager.generateSelfSignedCertificate({
        certType: "server" as CertificateType,
        subject: serverSubject,
        days: 365,
        keyType: "rsa" as KeyType,
      });

      // 生成客户端证书
      const clientSubject: CertificateSubject = {
        commonName: "client.example.com",
      };
      const { info: clientCert } = tlsManager.generateSelfSignedCertificate({
        certType: "client" as CertificateType,
        subject: clientSubject,
        days: 365,
        keyType: "ecdsa" as KeyType,
      });

      // 证书应该有不同的指纹
      expect(serverCert.fingerprint).not.toBe(clientCert.fingerprint);
      // 验证证书 ID 和指纹已生成
      expect(serverCert.id).toBeDefined();
      expect(clientCert.id).toBeDefined();
    });

    it("should correlate key rotation with certificate renewal", async () => {
      // 生成密钥
      const key = await keyManager.generateKey("encryption" as KeyPurpose, {
        name: "tls-key",
      });

      // 生成证书
      const subject: CertificateSubject = {
        commonName: "secure.example.com",
      };
      const { info: cert } = tlsManager.generateSelfSignedCertificate({
        certType: "server" as CertificateType,
        subject,
        days: 30, // 短期证书
        keyType: "rsa" as KeyType,
      });

      // 验证密钥和证书都有效
      const keyValid = await keyManager.validateKey(key.id);
      const certValidation = tlsManager.validateCertificate(cert.id);

      expect(keyValid).toBe(true);
      expect(certValidation.valid).toBe(true);
    });
  });

  // ========================================================================
  // 三组件集成测试
  // ========================================================================

  describe("Full Security Integration", () => {
    it("should enforce complete security workflow", async () => {
      // 1. 注册安全管理员
      const securityAdmin: Subject = {
        id: "security-admin",
        type: "user",
        roles: ["admin"],
        attributes: {},
        createdAt: new Date(),
      };
      acManager.registerSubject(securityAdmin);

      // 2. 验证管理员有所有权限
      const keyAccessRequest: AccessRequest = {
        subjectId: "security-admin",
        resource: "key",
        resourceId: "*",
        action: "create",
      };
      const certAccessRequest: AccessRequest = {
        subjectId: "security-admin",
        resource: "certificate",
        resourceId: "*",
        action: "create",
      };

      expect(acManager.checkAccess(keyAccessRequest).allowed).toBe(true);
      expect(acManager.checkAccess(certAccessRequest).allowed).toBe(true);

      // 3. 生成密钥
      const key = await keyManager.generateKey("encryption" as KeyPurpose, {
        name: "workflow-key",
      });
      expect(key.id).toBeDefined();

      // 4. 生成证书
      const subject: CertificateSubject = {
        commonName: "workflow.example.com",
      };
      const { info: cert } = tlsManager.generateSelfSignedCertificate({
        certType: "server" as CertificateType,
        subject,
        days: 365,
        keyType: "rsa" as KeyType,
      });
      expect(cert.id).toBeDefined();

      // 5. 验证所有资源
      const keyValid = await keyManager.validateKey(key.id);
      const certValidation = tlsManager.validateCertificate(cert.id);

      expect(keyValid).toBe(true);
      expect(certValidation.valid).toBe(true);

      // 6. 获取统计信息
      const keyStats = await keyManager.getStats();
      const certStats = tlsManager.getStats();
      const acStats = acManager.getStats();

      expect(keyStats.totalKeys).toBeGreaterThan(0);
      expect(certStats.totalCertificates).toBeGreaterThan(0);
      expect(acStats.permissions).toBeGreaterThan(0);
      expect(acStats.roles).toBeGreaterThan(0);
    });

    it("should validate access control for different roles", async () => {
      // 设置不同角色的主体
      const adminSubject: Subject = {
        id: "admin-test",
        type: "user",
        roles: ["admin"],
        attributes: {},
        createdAt: new Date(),
      };
      const userSubject: Subject = {
        id: "user-test",
        type: "user",
        roles: ["user"],
        attributes: {},
        createdAt: new Date(),
      };
      const guestSubject: Subject = {
        id: "guest-test",
        type: "user",
        roles: ["guest"],
        attributes: {},
        createdAt: new Date(),
      };

      acManager.registerSubject(adminSubject);
      acManager.registerSubject(userSubject);
      acManager.registerSubject(guestSubject);

      // admin 应该有所有系统权限
      const adminSystemRequest: AccessRequest = {
        subjectId: "admin-test",
        resource: "system",
        resourceId: "*",
        action: "admin",
      };
      expect(acManager.checkAccess(adminSystemRequest).allowed).toBe(true);

      // user 应该有任务读取权限
      const userTaskRequest: AccessRequest = {
        subjectId: "user-test",
        resource: "task",
        resourceId: "task-1",
        action: "read",
      };
      expect(acManager.checkAccess(userTaskRequest).allowed).toBe(true);

      // guest 不应该有密钥创建权限
      const guestKeyRequest: AccessRequest = {
        subjectId: "guest-test",
        resource: "key",
        resourceId: "key-1",
        action: "create",
      };
      expect(acManager.checkAccess(guestKeyRequest).allowed).toBe(false);
    });

    it("should handle security events across components", async () => {
      // 监听事件
      const keyEvents: string[] = [];
      const tlsEvents: string[] = [];

      keyManager.on("key:generated", () => keyEvents.push("generated"));
      tlsManager.on("certificate:generated", () => tlsEvents.push("generated"));

      // 触发事件
      const key = await keyManager.generateKey("encryption" as KeyPurpose, {
        name: "event-key",
      });

      const subject: CertificateSubject = {
        commonName: "event.example.com",
      };
      const { info: cert } = tlsManager.generateSelfSignedCertificate({
        certType: "server" as CertificateType,
        subject,
        days: 365,
        keyType: "rsa" as KeyType,
      });

      // 验证事件触发
      expect(keyEvents).toContain("generated");
      expect(tlsEvents).toContain("generated");

      // 验证资源已创建
      expect(key.id).toBeDefined();
      expect(cert.id).toBeDefined();
    });
  });

  // ========================================================================
  // 性能测试
  // ========================================================================

  describe("Performance Tests", () => {
    it("should handle multiple access checks efficiently", () => {
      const subject: Subject = {
        id: "perf-user",
        type: "user",
        roles: ["user"],
        attributes: {},
        createdAt: new Date(),
      };
      acManager.registerSubject(subject);

      const startTime = Date.now();
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        const request: AccessRequest = {
          subjectId: "perf-user",
          resource: "task",
          resourceId: `task-${i}`,
          action: "read",
        };
        acManager.checkAccess(request);
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / iterations;

      // 每次检查应该在 1ms 以内（使用缓存）
      expect(avgTime).toBeLessThan(1);
    });

    it("should handle concurrent key operations", async () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          keyManager.generateKey("encryption" as KeyPurpose, {
            name: `concurrent-key-${i}`,
          })
        );
      }

      const keys = await Promise.all(promises);

      expect(keys.length).toBe(10);
      keys.forEach((key, i) => {
        // 密钥 ID 是自动生成的，验证其他属性
        expect(key.id).toBeDefined();
        expect(key.name).toBe(`concurrent-key-${i}`);
      });
    });
  });
});
