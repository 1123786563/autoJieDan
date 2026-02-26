/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  TLSManager,
  createTLSManager,
  formatCertificateInfo,
  formatTLSConfig,
  formatConnectionInfo,
  type CertificateInfo,
  type TLSConfig,
  type TLSConnectionInfo,
  type CertificateType,
  type CertificateStatus,
  type KeyType,
} from "../../interagent/tls-manager.js";

describe("TLSManager", () => {
  let tlsManager: TLSManager;
  const testCertStore = "./test-certs";

  beforeEach(() => {
    // 清理测试目录
    if (fs.existsSync(testCertStore)) {
      const files = fs.readdirSync(testCertStore);
      for (const file of files) {
        fs.unlinkSync(path.join(testCertStore, file));
      }
      fs.rmdirSync(testCertStore);
    }

    tlsManager = createTLSManager({
      certStorePath: testCertStore,
      autoRenew: false,
    });
  });

  afterEach(() => {
    tlsManager.close();

    // 清理测试目录
    if (fs.existsSync(testCertStore)) {
      const files = fs.readdirSync(testCertStore);
      for (const file of files) {
        fs.unlinkSync(path.join(testCertStore, file));
      }
      fs.rmdirSync(testCertStore);
    }
  });

  // ==========================================================================
  // 证书生成
  // ==========================================================================

  describe("Certificate Generation", () => {
    it("should generate self-signed RSA certificate", () => {
      const result = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "test.example.com" },
        days: 365,
        keyType: "rsa",
        keySize: 2048,
      });

      expect(result.cert).toBeDefined();
      expect(result.key).toBeDefined();
      expect(result.info.id).toBeDefined();
      expect(result.info.subject).toContain("test.example.com");
      expect(result.info.type).toBe("server");
      expect(result.info.keyType).toBe("rsa");
      expect(result.info.selfSigned).toBe(true);
      expect(result.info.status).toBe("valid");
    });

    it("should generate self-signed ECDSA certificate", () => {
      const result = tlsManager.generateSelfSignedCertificate({
        type: "client",
        subject: { commonName: "client.example.com" },
        days: 365,
        keyType: "ecdsa",
      });

      expect(result.info.keyType).toBe("ecdsa");
      expect(result.info.type).toBe("client");
    });

    it("should generate self-signed Ed25519 certificate", () => {
      const result = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "ed25519.example.com" },
        days: 365,
        keyType: "ed25519",
      });

      expect(result.info.keyType).toBe("ed25519");
    });

    it("should generate certificate with SAN", () => {
      const result = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "multi.example.com" },
        days: 365,
        keyType: "rsa",
        san: ["DNS:example.com", "DNS:www.example.com", "IP:127.0.0.1"],
      });

      expect(result.info.san).toHaveLength(3);
      expect(result.info.san).toContain("DNS:example.com");
    });

    it("should generate certificate with full subject", () => {
      const result = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: {
          commonName: "test.example.com",
          country: "US",
          state: "California",
          locality: "San Francisco",
          organization: "Test Org",
          organizationalUnit: "Test Unit",
          emailAddress: "test@example.com",
        },
        days: 365,
        keyType: "rsa",
      });

      expect(result.info.subject).toContain("C=US");
      expect(result.info.subject).toContain("ST=California");
      expect(result.info.subject).toContain("O=Test Org");
    });

    it("should emit certificate:generated event", () => {
      const handler = vi.fn();
      tlsManager.on("certificate:generated", handler);

      tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "test.example.com" },
        days: 365,
        keyType: "rsa",
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should calculate certificate fingerprint", () => {
      const result = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "test.example.com" },
        days: 365,
        keyType: "rsa",
      });

      expect(result.info.fingerprint).toBeDefined();
      expect(result.info.fingerprint.length).toBe(64); // SHA-256 hex
    });
  });

  // ==========================================================================
  // 证书存储
  // ==========================================================================

  describe("Certificate Storage", () => {
    it("should save certificate to file", () => {
      const result = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "test.example.com" },
        days: 365,
        keyType: "rsa",
      });

      const certPath = path.join(testCertStore, `${result.info.id}.crt`);
      const keyPath = path.join(testCertStore, `${result.info.id}.key`);

      expect(fs.existsSync(certPath)).toBe(true);
      expect(fs.existsSync(keyPath)).toBe(true);
    });

    it("should load certificate from file", () => {
      const generated = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "test.example.com" },
        days: 365,
        keyType: "rsa",
      });

      const loaded = tlsManager.loadCertificate(generated.info.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.cert).toBe(generated.cert);
      expect(loaded!.key).toBe(generated.key);
    });

    it("should return null for non-existent certificate", () => {
      const loaded = tlsManager.loadCertificate("non-existent");

      expect(loaded).toBeNull();
    });

    it("should create cert store directory", () => {
      const customPath = "./test-certs-custom";
      if (fs.existsSync(customPath)) {
        fs.rmdirSync(customPath);
      }

      createTLSManager({ certStorePath: customPath, autoRenew: false });

      expect(fs.existsSync(customPath)).toBe(true);

      // Cleanup
      fs.rmdirSync(customPath);
    });
  });

  // ==========================================================================
  // 证书管理
  // ==========================================================================

  describe("Certificate Management", () => {
    it("should get certificate info", () => {
      const result = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "test.example.com" },
        days: 365,
        keyType: "rsa",
      });

      const info = tlsManager.getCertificateInfo(result.info.id);

      expect(info).toBeDefined();
      expect(info!.id).toBe(result.info.id);
    });

    it("should list all certificates", () => {
      tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "server1.example.com" },
        days: 365,
        keyType: "rsa",
      });
      tlsManager.generateSelfSignedCertificate({
        type: "client",
        subject: { commonName: "client1.example.com" },
        days: 365,
        keyType: "rsa",
      });

      const certs = tlsManager.listCertificates();

      expect(certs).toHaveLength(2);
    });

    it("should filter certificates by type", () => {
      tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "server.example.com" },
        days: 365,
        keyType: "rsa",
      });
      tlsManager.generateSelfSignedCertificate({
        type: "client",
        subject: { commonName: "client.example.com" },
        days: 365,
        keyType: "rsa",
      });

      const serverCerts = tlsManager.listCertificates({ type: "server" });

      expect(serverCerts).toHaveLength(1);
      expect(serverCerts[0].type).toBe("server");
    });

    it("should revoke certificate", () => {
      const result = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "test.example.com" },
        days: 365,
        keyType: "rsa",
      });

      const revoked = tlsManager.revokeCertificate(result.info.id);
      const info = tlsManager.getCertificateInfo(result.info.id);

      expect(revoked).toBe(true);
      expect(info!.status).toBe("revoked");
    });

    it("should emit certificate:revoked event", () => {
      const handler = vi.fn();
      tlsManager.on("certificate:revoked", handler);

      const result = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "test.example.com" },
        days: 365,
        keyType: "rsa",
      });

      tlsManager.revokeCertificate(result.info.id);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should delete certificate", () => {
      const result = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "test.example.com" },
        days: 365,
        keyType: "rsa",
      });

      const deleted = tlsManager.deleteCertificate(result.info.id);
      const info = tlsManager.getCertificateInfo(result.info.id);

      expect(deleted).toBe(true);
      expect(info).toBeUndefined();
    });

    it("should emit certificate:deleted event", () => {
      const handler = vi.fn();
      tlsManager.on("certificate:deleted", handler);

      const result = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "test.example.com" },
        days: 365,
        keyType: "rsa",
      });

      tlsManager.deleteCertificate(result.info.id);

      expect(handler).toHaveBeenCalledWith(result.info.id);
    });
  });

  // ==========================================================================
  // 证书验证
  // ==========================================================================

  describe("Certificate Validation", () => {
    it("should validate valid certificate", () => {
      const result = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "test.example.com" },
        days: 365,
        keyType: "rsa",
      });

      const validation = tlsManager.validateCertificate(result.info.id);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should fail validation for non-existent certificate", () => {
      const validation = tlsManager.validateCertificate("non-existent");

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Certificate not found");
    });

    it("should fail validation for revoked certificate", () => {
      const result = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "test.example.com" },
        days: 365,
        keyType: "rsa",
      });

      tlsManager.revokeCertificate(result.info.id);
      const validation = tlsManager.validateCertificate(result.info.id);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Certificate has been revoked");
    });

    it("should warn for weak RSA key", () => {
      const result = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "test.example.com" },
        days: 365,
        keyType: "rsa",
        keySize: 1024,
      });

      const validation = tlsManager.validateCertificate(result.info.id);

      expect(validation.warnings.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // TLS 配置
  // ==========================================================================

  describe("TLS Configuration", () => {
    it("should get server TLS options", () => {
      const result = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "test.example.com" },
        days: 365,
        keyType: "rsa",
      });

      const options = tlsManager.getServerTLSOptions(result.info.id);

      expect(options.cert).toBeDefined();
      expect(options.key).toBeDefined();
      expect(options.requestCert).toBe(true);
      expect(options.rejectUnauthorized).toBe(true);
    });

    it("should get server TLS options with custom config", () => {
      const result = tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "test.example.com" },
        days: 365,
        keyType: "rsa",
      });

      const options = tlsManager.getServerTLSOptions(result.info.id, {
        requestCert: false,
        minVersion: "TLSv1.3",
      });

      expect(options.requestCert).toBe(false);
      expect(options.minVersion).toBe("TLSv1.3");
    });

    it("should throw error for non-existent certificate", () => {
      expect(() => {
        tlsManager.getServerTLSOptions("non-existent");
      }).toThrow("Certificate not found");
    });

    it("should get client TLS options", () => {
      const result = tlsManager.generateSelfSignedCertificate({
        type: "client",
        subject: { commonName: "client.example.com" },
        days: 365,
        keyType: "rsa",
      });

      const options = tlsManager.getClientTLSOptions(result.info.id);

      expect(options.cert).toBeDefined();
      expect(options.key).toBeDefined();
      expect(options.rejectUnauthorized).toBe(true);
    });

    it("should get client TLS options without certificate", () => {
      const options = tlsManager.getClientTLSOptions();

      expect(options.cert).toBeUndefined();
      expect(options.key).toBeUndefined();
    });
  });

  // ==========================================================================
  // 统计
  // ==========================================================================

  describe("Statistics", () => {
    it("should get certificate stats", () => {
      tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "server1.example.com" },
        days: 365,
        keyType: "rsa",
      });
      tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "server2.example.com" },
        days: 365,
        keyType: "rsa",
      });
      tlsManager.generateSelfSignedCertificate({
        type: "client",
        subject: { commonName: "client1.example.com" },
        days: 365,
        keyType: "rsa",
      });

      const stats = tlsManager.getStats();

      expect(stats.totalCertificates).toBe(3);
      expect(stats.byType.server).toBe(2);
      expect(stats.byType.client).toBe(1);
    });

    it("should count expiring certificates", () => {
      // 生成一个即将过期的证书 (30天内)
      tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "expiring.example.com" },
        days: 15,
        keyType: "rsa",
      });

      // 生成一个长期有效的证书
      tlsManager.generateSelfSignedCertificate({
        type: "server",
        subject: { commonName: "longterm.example.com" },
        days: 365,
        keyType: "rsa",
      });

      const stats = tlsManager.getStats();

      expect(stats.expiringWithin30Days).toBe(1);
    });
  });

  // ==========================================================================
  // 清理
  // ==========================================================================

  describe("Cleanup", () => {
    it("should close manager", () => {
      const manager = createTLSManager({
        certStorePath: testCertStore,
        autoRenew: true,
      });

      manager.close();

      // Should not throw
    });

    it("should remove all listeners on close", () => {
      const handler = vi.fn();
      tlsManager.on("certificate:generated", handler);

      tlsManager.close();

      expect(tlsManager.listenerCount("certificate:generated")).toBe(0);
    });
  });
});

// ==========================================================================
// 格式化函数测试
// ==========================================================================

describe("Format Functions", () => {
  it("should format certificate info", () => {
    const info: CertificateInfo = {
      id: "cert-123",
      type: "server",
      subject: "CN=test.example.com",
      issuer: "CN=test.example.com",
      serialNumber: "ABC123",
      fingerprint: "AA:BB:CC:DD",
      notBefore: new Date("2026-01-01"),
      notAfter: new Date("2027-01-01"),
      status: "valid",
      san: ["DNS:example.com"],
      keyType: "rsa",
      keySize: 2048,
      selfSigned: true,
      metadata: {},
    };

    const formatted = formatCertificateInfo(info);

    expect(formatted).toContain("cert-123");
    expect(formatted).toContain("server");
    expect(formatted).toContain("test.example.com");
    expect(formatted).toContain("valid");
    expect(formatted).toContain("rsa");
  });

  it("should format TLS config", () => {
    const config: TLSConfig = {
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      caCertPath: "/path/to/ca.crt",
    };

    const formatted = formatTLSConfig(config);

    expect(formatted).toContain("是");
    expect(formatted).toContain("TLSv1.2");
    expect(formatted).toContain("/path/to/ca.crt");
  });

  it("should format connection info", () => {
    const info: TLSConnectionInfo = {
      authorized: true,
      version: "TLSv1.3",
      cipher: "TLS_AES_256_GCM_SHA384",
      remoteAddress: "192.168.1.1",
    };

    const formatted = formatConnectionInfo(info);

    expect(formatted).toContain("已授权: 是");
    expect(formatted).toContain("TLSv1.3");
    expect(formatted).toContain("192.168.1.1");
  });

  it("should format connection info with error", () => {
    const info: TLSConnectionInfo = {
      authorized: false,
      authorizationError: "CERT_HAS_EXPIRED",
      version: "TLSv1.2",
      cipher: "ECDHE-RSA-AES128-GCM-SHA256",
    };

    const formatted = formatConnectionInfo(info);

    expect(formatted).toContain("已授权: 否");
    expect(formatted).toContain("CERT_HAS_EXPIRED");
  });
});
