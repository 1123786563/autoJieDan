/**
 * ANP 集成测试 - Day 37
 *
 * 测试内容：
 * - DID 文档生成与解析
 * - 签名/验证双向测试
 * - 加密/解密双向测试
 * - 完整消息流程
 *
 * @module anp/integration.test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  initializeAgentIdentity,
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
  publicKeyToJwk,
  resolveDid,
  registerDidDocument,
  getKeyStorePath,
  getPrivateKeyPath,
} from "../../anp/did.js";
import {
  signPayload,
  verifySignature,
  createANPMessage,
  verifyMessage,
  hashPayload,
} from "../../anp/signature.js";
import {
  generateECDHKeyPair,
  computeSharedSecret,
  deriveAESKey,
  encryptAES,
  decryptAES,
  encryptMessage,
  decryptMessage,
} from "../../anp/encryption.js";
import {
  DidDocument,
  ANPMessage,
  ANPEncryptedMessage,
  GenesisPromptPayload,
  ProgressReportPayload,
  AUTOMATON_DID,
  NANOBOT_DID,
  DEFAULT_CONTEXT,
} from "../../anp/types.js";

// ============================================================================
// 测试辅助函数
// ============================================================================

/** 创建临时测试目录 */
function createTempTestDir(): string {
  const tempDir = path.join(process.cwd(), ".test-temp", `test-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

/** 删除临时测试目录 */
function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 创建测试用 Genesis Prompt 负载 */
function createTestGenesisPayload(): GenesisPromptPayload {
  return {
    "@type": "genesis:GenesisPrompt",
    "genesis:projectId": "test-project-001",
    "genesis:platform": "test-platform",
    "genesis:requirementSummary": "Test requirement for integration testing",
    "genesis:technicalConstraints": {
      "@type": "genesis:TechnicalConstraints",
      "genesis:requiredStack": ["TypeScript", "Node.js"],
      "genesis:prohibitedStack": [],
      "genesis:targetPlatform": "linux",
    },
    "genesis:contractTerms": {
      "@type": "genesis:ContractTerms",
      "genesis:totalBudget": {
        "@type": "schema:MonetaryAmount",
        "schema:value": 10000,
        "schema:currency": "USD",
      },
      "genesis:deadline": new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      "genesis:milestones": [],
    },
    "genesis:resourceLimits": {
      "@type": "genesis:ResourceLimits",
      "genesis:maxTokensPerTask": 100000,
      "genesis:maxCostCents": 500,
      "genesis:maxDurationMs": 3600000,
    },
  };
}

/** 创建测试用进度报告负载 */
function createTestProgressPayload(): ProgressReportPayload {
  return {
    "@type": "anp:ProgressReport",
    "anp:taskId": "task-001",
    "anp:progress": 50,
    "anp:currentPhase": "testing",
    "anp:completedSteps": ["setup", "implementation"],
    "anp:nextSteps": ["review", "deploy"],
    "anp:etaSeconds": 3600,
    "anp:blockers": [],
  };
}

// ============================================================================
// DID 文档生成测试
// ============================================================================

describe("ANP Integration - DID Document Generation", () => {
  it("should generate valid ECDSA P-256 key pair", () => {
    const keyPair = generateKeyPair();

    expect(keyPair.privateKey).toBeDefined();
    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.privateKey).toContain("-----BEGIN EC PRIVATE KEY-----");
    expect(keyPair.publicKey).toContain("-----BEGIN PUBLIC KEY-----");
  });

  it("should import PEM format keys correctly", () => {
    const keyPair = generateKeyPair();

    const privateKey = importPrivateKey(keyPair.privateKey);
    const publicKey = importPublicKey(keyPair.publicKey);

    expect(privateKey.asymmetricKeyType).toBe("ec");
    expect(publicKey.asymmetricKeyType).toBe("ec");
  });

  it("should convert public key to JWK format", () => {
    const keyPair = generateKeyPair();
    const publicKey = importPublicKey(keyPair.publicKey);
    const jwk = publicKeyToJwk(publicKey);

    expect(jwk.kty).toBe("EC");
    expect(jwk.crv).toBe("P-256");
    expect(jwk.x).toBeDefined();
    expect(jwk.y).toBeDefined();
    expect(typeof jwk.x).toBe("string");
    expect(typeof jwk.y).toBe("string");
  });

  it("should initialize complete agent identity", () => {
    const identity = initializeAgentIdentity({
      did: "did:anp:test:agent001",
      serviceEndpoint: "https://test.example.com/anp",
      agentName: "Test Agent",
      agentDescription: "Agent for integration testing",
      capabilities: ["testing", "integration"],
    });

    expect(identity.didDocument).toBeDefined();
    expect(identity.didDocument.id).toBe("did:anp:test:agent001");
    expect(identity.didDocument.verificationMethod).toHaveLength(1);
    expect(identity.didDocument.service).toHaveLength(1);
    expect(identity.privateKey).toBeDefined();
    expect(identity.publicKey).toBeDefined();
  });

  it("should generate consistent DID document structure", () => {
    const identity = initializeAgentIdentity({
      did: "did:anp:test:agent002",
      serviceEndpoint: "https://test.example.com/anp",
      agentName: "Test Agent 2",
      agentDescription: "Another test agent",
      capabilities: ["testing"],
    });

    const doc = identity.didDocument;

    // 验证 JSON-LD 上下文
    expect(doc["@context"]).toContain("https://www.w3.org/ns/did/v1");

    // 验证验证方法
    const vm = doc.verificationMethod[0];
    expect(vm.type).toBe("JsonWebKey2020");
    expect(vm.publicKeyJwk.kty).toBe("EC");
    expect(vm.publicKeyJwk.crv).toBe("P-256");

    // 验证服务端点
    const service = doc.service[0];
    expect(service.type).toBe("ANPMessageService");
    expect(service.serviceEndpoint).toBe("https://test.example.com/anp");
  });
});

// ============================================================================
// 签名验证测试
// ============================================================================

describe("ANP Integration - Signature Verification", () => {
  let privateKey: crypto.KeyObject;
  let publicKey: crypto.KeyObject;

  beforeEach(() => {
    const keyPair = generateKeyPair();
    privateKey = importPrivateKey(keyPair.privateKey);
    publicKey = importPublicKey(keyPair.publicKey);
  });

  it("should sign and verify payload with same key", () => {
    const payload = createTestProgressPayload();
    const keyId = `${AUTOMATON_DID}#key-1`;

    const signature = signPayload(payload, privateKey, keyId);

    expect(signature.type).toBe("EcdsaSecp256r1Signature2019");
    expect(signature.verificationMethod).toBe(keyId);
    expect(signature.proofValue).toBeDefined();

    // 创建带签名的消息
    const message: ANPMessage = {
      "@context": DEFAULT_CONTEXT,
      "@type": "ANPMessage",
      id: "test-msg-001",
      timestamp: new Date().toISOString(),
      actor: AUTOMATON_DID,
      target: NANOBOT_DID,
      type: "TaskUpdate",
      object: payload,
      signature,
    };

    const isValid = verifySignature(message, publicKey);
    expect(isValid).toBe(true);
  });

  it("should reject tampered payload", () => {
    const payload = createTestProgressPayload();
    const keyId = `${AUTOMATON_DID}#key-1`;

    const signature = signPayload(payload, privateKey, keyId);

    // 创建消息并篡改负载
    const message: ANPMessage = {
      "@context": DEFAULT_CONTEXT,
      "@type": "ANPMessage",
      id: "test-msg-002",
      timestamp: new Date().toISOString(),
      actor: AUTOMATON_DID,
      target: NANOBOT_DID,
      type: "TaskUpdate",
      object: { ...payload, "anp:progress": 99 }, // 篡改进度值
      signature,
    };

    const isValid = verifySignature(message, publicKey);
    expect(isValid).toBe(false);
  });

  it("should reject signature from different key", () => {
    const payload = createTestProgressPayload();
    const keyId = `${AUTOMATON_DID}#key-1`;

    const signature = signPayload(payload, privateKey, keyId);

    // 使用不同的公钥验证
    const otherKeyPair = generateKeyPair();
    const otherPublicKey = importPublicKey(otherKeyPair.publicKey);

    const message: ANPMessage = {
      "@context": DEFAULT_CONTEXT,
      "@type": "ANPMessage",
      id: "test-msg-003",
      timestamp: new Date().toISOString(),
      actor: AUTOMATON_DID,
      target: NANOBOT_DID,
      type: "TaskUpdate",
      object: payload,
      signature,
    };

    const isValid = verifySignature(message, otherPublicKey);
    expect(isValid).toBe(false);
  });

  it("should create and verify complete ANP message", () => {
    const payload = createTestGenesisPayload();

    const message = createANPMessage(payload, privateKey, {
      targetDid: NANOBOT_DID,
      type: "TaskCreate",
    });

    expect(message["@context"]).toEqual(DEFAULT_CONTEXT);
    expect(message.actor).toBe(AUTOMATON_DID);
    expect(message.target).toBe(NANOBOT_DID);
    expect(message.type).toBe("TaskCreate");
    expect(message.signature).toBeDefined();

    // 验证消息
    const result = verifyMessage(message, publicKey);
    expect(result.valid).toBe(true);
  });

  it("should reject expired messages", () => {
    const payload = createTestProgressPayload();

    // 创建过期消息 (时间戳设为 10 分钟前)
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const keyId = `${AUTOMATON_DID}#key-1`;
    const signature = signPayload(payload, privateKey, keyId);

    const message: ANPMessage = {
      "@context": DEFAULT_CONTEXT,
      "@type": "ANPMessage",
      id: "test-msg-004",
      timestamp: oldTimestamp,
      actor: AUTOMATON_DID,
      target: NANOBOT_DID,
      type: "TaskUpdate",
      object: payload,
      signature,
      ttl: 300, // 5 分钟 TTL
    };

    const result = verifyMessage(message, publicKey, 300000); // 5 分钟最大年龄
    expect(result.valid).toBe(false);
    expect(result.error).toContain("expired");
  });
});

// ============================================================================
// 加密解密测试
// ============================================================================

describe("ANP Integration - Encryption", () => {
  let senderPrivateKey: crypto.KeyObject;
  let senderPublicKey: crypto.KeyObject;
  let recipientPrivateKey: Buffer;
  let recipientPublicKey: Buffer;

  beforeEach(() => {
    // 发送方签名密钥
    const senderKeyPair = generateKeyPair();
    senderPrivateKey = importPrivateKey(senderKeyPair.privateKey);
    senderPublicKey = importPublicKey(senderKeyPair.publicKey);

    // 接收方加密密钥 (ECDH)
    const recipientEcdhKeyPair = generateECDHKeyPair();
    recipientPrivateKey = recipientEcdhKeyPair.privateKey;
    recipientPublicKey = recipientEcdhKeyPair.publicKey;
  });

  it("should generate ECDH key pair", () => {
    const ecdhKeyPair = generateECDHKeyPair();

    expect(ecdhKeyPair.privateKey).toBeInstanceOf(Buffer);
    expect(ecdhKeyPair.publicKey).toBeInstanceOf(Buffer);
    expect(ecdhKeyPair.privateKey.length).toBeGreaterThan(0);
    expect(ecdhKeyPair.publicKey.length).toBeGreaterThan(0);
  });

  it("should compute shared secret", () => {
    // Alice 生成密钥对
    const aliceKeyPair = generateECDHKeyPair();
    // Bob 生成密钥对
    const bobKeyPair = generateECDHKeyPair();

    // 双方计算共享密钥
    const aliceShared = computeSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey);
    const bobShared = computeSharedSecret(bobKeyPair.privateKey, aliceKeyPair.publicKey);

    // 共享密钥应该相同
    expect(aliceShared.equals(bobShared)).toBe(true);
    expect(aliceShared.length).toBe(32); // P-256 产生 32 字节共享密钥
  });

  it("should derive AES key from shared secret", () => {
    const sharedSecret = crypto.randomBytes(32);
    const aesKey = deriveAESKey(sharedSecret);

    expect(aesKey.length).toBe(32); // AES-256 需要 32 字节密钥
  });

  it("should encrypt and decrypt with AES-256-GCM", () => {
    const plaintext = "Hello, ANP World!";
    const key = crypto.randomBytes(32);

    const encrypted = encryptAES(plaintext, key);

    expect(encrypted.ciphertext).toBeInstanceOf(Buffer);
    expect(encrypted.iv.length).toBe(12); // GCM 推荐 12 字节 IV
    expect(encrypted.tag.length).toBe(16); // GCM 标签 16 字节

    const decrypted = decryptAES(encrypted, key);
    expect(decrypted.toString("utf-8")).toBe(plaintext);
  });

  it("should fail decryption with wrong key", () => {
    const plaintext = "Secret message";
    const correctKey = crypto.randomBytes(32);
    const wrongKey = crypto.randomBytes(32);

    const encrypted = encryptAES(plaintext, correctKey);

    expect(() => decryptAES(encrypted, wrongKey)).toThrow();
  });

  it("should encrypt and decrypt complete ANP message", () => {
    // 创建原始消息
    const originalMessage: ANPMessage = {
      "@context": DEFAULT_CONTEXT,
      "@type": "ANPMessage",
      id: "test-encrypted-001",
      timestamp: new Date().toISOString(),
      actor: AUTOMATON_DID,
      target: NANOBOT_DID,
      type: "TaskCreate",
      object: createTestGenesisPayload(),
      signature: signPayload(createTestGenesisPayload(), senderPrivateKey, `${AUTOMATON_DID}#key-1`),
    };

    // 加密消息
    const encryptedMessage = encryptMessage(originalMessage, senderPrivateKey, recipientPublicKey, {
      recipientDid: NANOBOT_DID,
    });

    expect(encryptedMessage["@type"]).toBe("ANPEncryptedMessage");
    expect(encryptedMessage.encryptedPayload).toBeDefined();
    expect(encryptedMessage.encryptedPayload.algorithm).toBe("AES-256-GCM");
    expect(encryptedMessage.encryptedPayload.ephemeralPublicKey).toBeDefined();

    // 解密消息
    const decryptedMessage = decryptMessage(encryptedMessage, recipientPrivateKey);

    expect(decryptedMessage.id).toBe(originalMessage.id);
    expect(decryptedMessage.actor).toBe(originalMessage.actor);
    expect(decryptedMessage.type).toBe(originalMessage.type);
  });

  it("should fail decryption with wrong recipient key", () => {
    const message: ANPMessage = {
      "@context": DEFAULT_CONTEXT,
      "@type": "ANPMessage",
      id: "test-encrypted-002",
      timestamp: new Date().toISOString(),
      actor: AUTOMATON_DID,
      target: NANOBOT_DID,
      type: "TaskUpdate",
      object: createTestProgressPayload(),
      signature: signPayload(createTestProgressPayload(), senderPrivateKey, `${AUTOMATON_DID}#key-1`),
    };

    const encryptedMessage = encryptMessage(message, senderPrivateKey, recipientPublicKey, {
      recipientDid: NANOBOT_DID,
    });

    // 使用错误的私钥
    const wrongKeyPair = generateECDHKeyPair();
    expect(() => decryptMessage(encryptedMessage, wrongKeyPair.privateKey)).toThrow();
  });
});

// ============================================================================
// 完整流程测试
// ============================================================================

describe("ANP Integration - Complete Flow", () => {
  it("should complete full message flow: create -> sign -> encrypt -> decrypt -> verify", () => {
    // 1. 双方初始化身份
    const automatonIdentity = initializeAgentIdentity({
      did: AUTOMATON_DID,
      serviceEndpoint: "https://automaton.example.com/anp",
      agentName: "Automaton",
      agentDescription: "Economic decision agent",
      capabilities: ["economic", "governance"],
    });

    const nanobotIdentity = initializeAgentIdentity({
      did: NANOBOT_DID,
      serviceEndpoint: "https://nanobot.example.com/anp",
      agentName: "Nanobot",
      agentDescription: "Technical execution agent",
      capabilities: ["coding", "testing"],
    });

    // 2. 创建任务消息
    const genesisPayload = createTestGenesisPayload();
    const message = createANPMessage(genesisPayload, automatonIdentity.privateKey, {
      targetDid: NANOBOT_DID,
      type: "TaskCreate",
      correlationId: "corr-001",
    });

    // 3. 验证原始消息签名
    const verifyResult = verifyMessage(message, automatonIdentity.publicKey);
    expect(verifyResult.valid).toBe(true);

    // 4. 获取接收方 ECDH 公钥 (从 DID 文档)
    // 注：实际应用中会从 DID 文档的 keyAgreement 获取
    const nanobotEcdhKeyPair = generateECDHKeyPair();

    // 5. 加密消息
    const encryptedMessage = encryptMessage(message, automatonIdentity.privateKey, nanobotEcdhKeyPair.publicKey, {
      recipientDid: NANOBOT_DID,
    });

    // 6. 解密消息
    const decryptedMessage = decryptMessage(encryptedMessage, nanobotEcdhKeyPair.privateKey);

    // 7. 验证解密后的消息
    expect(decryptedMessage.id).toBe(message.id);
    expect(decryptedMessage.type).toBe("TaskCreate");
    expect(decryptedMessage.correlationId).toBe("corr-001");

    // 8. 验证签名
    const finalVerifyResult = verifyMessage(decryptedMessage, automatonIdentity.publicKey);
    expect(finalVerifyResult.valid).toBe(true);
  });

  it("should handle progress report flow", () => {
    // 初始化身份
    const automatonIdentity = initializeAgentIdentity({
      did: AUTOMATON_DID,
      serviceEndpoint: "https://automaton.example.com/anp",
      agentName: "Automaton",
      agentDescription: "Economic decision agent",
      capabilities: ["economic"],
    });

    // 创建进度报告
    const progressPayload: ProgressReportPayload = {
      "@type": "anp:ProgressReport",
      "anp:taskId": "task-integration-001",
      "anp:progress": 75,
      "anp:currentPhase": "integration-testing",
      "anp:completedSteps": ["unit-tests", "setup"],
      "anp:nextSteps": ["e2e-tests"],
      "anp:etaSeconds": 1800,
    };

    // 创建消息 (从 Nanobot 发送到 Automaton)
    const message = createANPMessage(progressPayload, automatonIdentity.privateKey, {
      targetDid: AUTOMATON_DID,
      type: "TaskUpdate",
      correlationId: "progress-001",
    });

    // 验证
    const result = verifyMessage(message, automatonIdentity.publicKey);
    expect(result.valid).toBe(true);
    expect(message.type).toBe("TaskUpdate");
  });
});

// ============================================================================
// 哈希一致性测试
// ============================================================================

describe("ANP Integration - Hash Consistency", () => {
  it("should produce consistent hash for same payload", () => {
    const payload = createTestProgressPayload();

    const hash1 = hashPayload(payload);
    const hash2 = hashPayload(payload);

    expect(hash1.equals(hash2)).toBe(true);
  });

  it("should produce different hash for different payload", () => {
    const payload1 = createTestProgressPayload();
    const payload2: ProgressReportPayload = {
      ...payload1,
      "anp:progress": 99, // 不同的进度值
    };

    const hash1 = hashPayload(payload1);
    const hash2 = hashPayload(payload2);

    expect(hash1.equals(hash2)).toBe(false);
  });
});
