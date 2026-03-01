/**
 * @jest-environment node
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  generateECDHKeyPair,
  computeSharedSecret,
  encryptMessage,
  decryptMessage,
} from "../../src/anp/encryption.js";
import {
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
  registerDidDocument,
  resolveDid,
  initializeAgentIdentity,
} from "../../src/anp/did.js";
import {
  createANPMessage,
  verifySignature,
  verifyMessage,
} from "../../src/anp/signature.js";
import { AUTOMATON_DID, NANOBOT_DID } from "../../src/anp/types.js";
import type { ProgressReportPayload } from "../../src/anp/types.js";
import * as crypto from "crypto";

describe("E2E Encryption Tests - 双系统加密通信", () => {
  // Automaton 端密钥
  let automatonSigningKey: crypto.KeyObject;
  let automatonECDHKeyPair: { privateKey: Buffer; publicKey: Buffer };
  let automatonDidDoc: any;

  // Nanobot 端密钥
  let nanobotSigningKey: crypto.KeyObject;
  let nanobotECDHKeyPair: { privateKey: Buffer; publicKey: Buffer };
  let nanobotDidDoc: any;

  // 测试消息负载
  let testPayload: ProgressReportPayload;

  beforeEach(() => {
    // 初始化 Automaton 身份
    const automatonIdentity = initializeAgentIdentity({
      did: AUTOMATON_DID,
      serviceEndpoint: "https://automaton.example.com/anp",
      agentName: "Automaton Main",
      agentDescription: "Self-improving autonomous AI agent",
      capabilities: [
        "task_execution",
        "self_modification",
        "blockchain_interaction",
      ],
    });
    automatonSigningKey = automatonIdentity.privateKey;
    automatonDidDoc = automatonIdentity.didDocument;
    automatonECDHKeyPair = generateECDHKeyPair();

    // 初始化 Nanobot 身份
    const nanobotIdentity = initializeAgentIdentity({
      did: NANOBOT_DID,
      serviceEndpoint: "https://nanobot.example.com/anp",
      agentName: "Nanobot Main",
      agentDescription: "Lightweight personal AI assistant",
      capabilities: [
        "message_handling",
        "multi_platform_support",
        "skill_execution",
      ],
    });
    nanobotSigningKey = nanobotIdentity.privateKey;
    nanobotDidDoc = nanobotIdentity.didDocument;
    nanobotECDHKeyPair = generateECDHKeyPair();

    // 准备测试负载
    testPayload = {
      "@type": "anp:ProgressReport",
      "anp:taskId": "test-e2e-task-001",
      "anp:progress": 75,
      "anp:currentPhase": "encryption_testing",
      "anp:completedSteps": [
        "setup_identity",
        "generate_keys",
        "create_payload",
      ],
      "anp:nextSteps": [
        "encrypt_message",
        "transmit_securely",
        "decrypt_and_verify",
      ],
      "anp:etaSeconds": 300,
      "anp:blockers": [],
    };
  });

  describe("场景1: DID验证和签名验证", () => {
    it("应该验证Automaton发送的消息签名", () => {
      // Automaton 创建消息
      const message = createANPMessage(
        testPayload,
        automatonSigningKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
        }
      );

      // 验证消息结构
      expect(message.actor).toBe(AUTOMATON_DID);
      expect(message.target).toBe(NANOBOT_DID);
      expect(message.type).toBe("ProgressEvent");
      expect(message.signature).toBeDefined();
      expect(message.signature.type).toBe("EcdsaSecp256r1Signature2019");
      expect(message.signature.verificationMethod).toBe(`${AUTOMATON_DID}#key-1`);

      // Nanobot 验证签名
      const isValid = verifySignature(message, automatonSigningKey);
      expect(isValid).toBe(true);
    });

    it("应该验证Nanobot发送的消息签名", () => {
      // Nanobot 创建消息
      const message = createANPMessage(
        testPayload,
        nanobotSigningKey,
        {
          actorDid: NANOBOT_DID,
          type: "ProgressEvent",
          targetDid: AUTOMATON_DID,
        }
      );

      // 验证消息结构
      expect(message.actor).toBe(NANOBOT_DID);
      expect(message.target).toBe(AUTOMATON_DID);

      // Automaton 验证签名
      const isValid = verifySignature(message, nanobotSigningKey);
      expect(isValid).toBe(true);
    });

    it("应该拒绝被篡改的消息签名", () => {
      const message = createANPMessage(
        testPayload,
        automatonSigningKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
        }
      );

      // 篡改消息内容
      const tamperedMessage = {
        ...message,
        object: {
          ...message.object,
          "anp:progress": 999, // 修改进度值
        },
      };

      // 验证应该失败
      const isValid = verifySignature(tamperedMessage, automatonSigningKey);
      expect(isValid).toBe(false);
    });

    it("应该验证消息的完整性和时效性", () => {
      const message = createANPMessage(
        testPayload,
        automatonSigningKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
          ttl: 3600,
        }
      );

      // 完整验证
      const verification = verifyMessage(
        message,
        automatonSigningKey,
        300000 // 5分钟最大年龄
      );

      expect(verification.valid).toBe(true);
      expect(verification.error).toBeUndefined();
    });

    it("应该拒绝过期的消息", () => {
      const oldTimestamp = new Date(Date.now() - 400000).toISOString(); // 6分钟多前
      const message = createANPMessage(
        testPayload,
        automatonSigningKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
          ttl: 300, // 5分钟TTL
        }
      );

      // 修改时间戳模拟过期消息
      message.timestamp = oldTimestamp;

      const verification = verifyMessage(
        message,
        automatonSigningKey,
        300000
      );

      expect(verification.valid).toBe(false);
      expect(verification.error).toBe("Message expired");
    });
  });

  describe("场景2: 消息加密/解密完整性", () => {
    it("应该完成Automaton到Nanobot的端到端加密通信", () => {
      // Automaton 创建原始消息
      const originalMessage = createANPMessage(
        testPayload,
        automatonSigningKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
        }
      );

      // Automaton 加密消息
      const encryptedMessage = encryptMessage(
        originalMessage,
        automatonSigningKey,
        nanobotECDHKeyPair.publicKey,
        {
          recipientDid: NANOBOT_DID,
        }
      );

      // 验证加密消息结构
      expect(encryptedMessage["@type"]).toBe("ANPEncryptedMessage");
      expect(encryptedMessage.actor).toBe(AUTOMATON_DID);
      expect(encryptedMessage.target).toBe(NANOBOT_DID);
      expect(encryptedMessage.encryptedPayload).toBeDefined();
      expect(encryptedMessage.encryptedPayload.algorithm).toBe("AES-256-GCM");
      expect(encryptedMessage.encryptedPayload.ephemeralPublicKey).toBeDefined();

      // Nanobot 解密消息
      const decryptedMessage = decryptMessage(
        encryptedMessage,
        nanobotECDHKeyPair.privateKey
      );

      // 验证解密后的消息与原始消息一致
      expect(decryptedMessage.id).toBe(originalMessage.id);
      expect(decryptedMessage.actor).toBe(originalMessage.actor);
      expect(decryptedMessage.target).toBe(originalMessage.target);
      expect(decryptedMessage.type).toBe(originalMessage.type);
      expect(decryptedMessage.object).toEqual(originalMessage.object);
    });

    it("应该完成Nanobot到Automaton的端到端加密通信", () => {
      // Nanobot 创建原始消息
      const originalMessage = createANPMessage(
        testPayload,
        nanobotSigningKey,
        {
          actorDid: NANOBOT_DID,
          type: "ProgressEvent",
          targetDid: AUTOMATON_DID,
        }
      );

      // Nanobot 加密消息
      const encryptedMessage = encryptMessage(
        originalMessage,
        nanobotSigningKey,
        automatonECDHKeyPair.publicKey,
        {
          recipientDid: AUTOMATON_DID,
        }
      );

      // Automaton 解密消息
      const decryptedMessage = decryptMessage(
        encryptedMessage,
        automatonECDHKeyPair.privateKey
      );

      // 验证完整性
      expect(decryptedMessage.object).toEqual(originalMessage.object);
      expect(decryptedMessage.signature).toEqual(originalMessage.signature);
    });

    it("应该正确处理复杂的嵌套负载", () => {
      const complexPayload: ProgressReportPayload = {
        "@type": "anp:ProgressReport",
        "anp:taskId": "complex-task-123",
        "anp:progress": 50,
        "anp:currentPhase": "processing",
        "anp:completedSteps": [
          "step1",
          "step2",
          "step3",
          "step4",
          "step5",
        ],
        "anp:nextSteps": [
          "step6",
          "step7",
          "step8",
        ],
        "anp:etaSeconds": 600,
        "anp:blockers": [
          "resource_constraint",
          "dependency_delay",
        ],
      };

      const originalMessage = createANPMessage(
        complexPayload,
        automatonSigningKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
        }
      );

      const encryptedMessage = encryptMessage(
        originalMessage,
        automatonSigningKey,
        nanobotECDHKeyPair.publicKey,
        {
          recipientDid: NANOBOT_DID,
        }
      );

      const decryptedMessage = decryptMessage(
        encryptedMessage,
        nanobotECDHKeyPair.privateKey
      );

      expect(decryptedMessage.object).toEqual(complexPayload);
    });

    it("应该为每条消息生成唯一的临时密钥", () => {
      const originalMessage = createANPMessage(
        testPayload,
        automatonSigningKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
        }
      );

      const encrypted1 = encryptMessage(
        originalMessage,
        automatonSigningKey,
        nanobotECDHKeyPair.publicKey,
        { recipientDid: NANOBOT_DID }
      );

      const encrypted2 = encryptMessage(
        originalMessage,
        automatonSigningKey,
        nanobotECDHKeyPair.publicKey,
        { recipientDid: NANOBOT_DID }
      );

      // 临时公钥应该不同
      expect(encrypted1.encryptedPayload.ephemeralPublicKey).not.toBe(
        encrypted2.encryptedPayload.ephemeralPublicKey
      );

      // IV 也应该不同
      expect(encrypted1.encryptedPayload.iv).not.toBe(
        encrypted2.encryptedPayload.iv
      );
    });
  });

  describe("场景3: 中间人攻击防护", () => {
    it("应该拒绝使用错误密钥的解密尝试", () => {
      const originalMessage = createANPMessage(
        testPayload,
        automatonSigningKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
        }
      );

      const encryptedMessage = encryptMessage(
        originalMessage,
        automatonSigningKey,
        nanobotECDHKeyPair.publicKey,
        {
          recipientDid: NANOBOT_DID,
        }
      );

      // 使用错误的私钥（攻击者的密钥）尝试解密
      const attackerKeyPair = generateECDHKeyPair();

      expect(() => {
        decryptMessage(encryptedMessage, attackerKeyPair.privateKey);
      }).toThrow();
    });

    it("应该检测加密负载的篡改", () => {
      const originalMessage = createANPMessage(
        testPayload,
        automatonSigningKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
        }
      );

      const encryptedMessage = encryptMessage(
        originalMessage,
        automatonSigningKey,
        nanobotECDHKeyPair.publicKey,
        {
          recipientDid: NANOBOT_DID,
        }
      );

      // 篡改密文
      const tamperedMessage = {
        ...encryptedMessage,
        encryptedPayload: {
          ...encryptedMessage.encryptedPayload,
          ciphertext: "tampered" + encryptedMessage.encryptedPayload.ciphertext,
        },
      };

      expect(() => {
        decryptMessage(tamperedMessage, nanobotECDHKeyPair.privateKey);
      }).toThrow();
    });

    it("应该检测认证标签的篡改", () => {
      const originalMessage = createANPMessage(
        testPayload,
        automatonSigningKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
        }
      );

      const encryptedMessage = encryptMessage(
        originalMessage,
        automatonSigningKey,
        nanobotECDHKeyPair.publicKey,
        {
          recipientDid: NANOBOT_DID,
        }
      );

      // 篡改认证标签
      const tamperedMessage = {
        ...encryptedMessage,
        encryptedPayload: {
          ...encryptedMessage.encryptedPayload,
          tag: "invalid" + encryptedMessage.encryptedPayload.tag,
        },
      };

      expect(() => {
        decryptMessage(tamperedMessage, nanobotECDHKeyPair.privateKey);
      }).toThrow();
    });

    it("应该验证签名以防止身份伪造", () => {
      // 攻击者创建自己的密钥对
      const attackerKeyPair = generateKeyPair();
      const attackerPrivateKey = importPrivateKey(attackerKeyPair.privateKey);
      const attackerECDHKeyPair = generateECDHKeyPair();

      // 攻击者尝试伪造消息
      const fakeMessage = createANPMessage(
        testPayload,
        attackerPrivateKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
        }
      );

      // 修改actor字段伪装成Automaton
      fakeMessage.actor = AUTOMATON_DID;
      fakeMessage.signature.verificationMethod = `${AUTOMATON_DID}#key-1`;

      // 加密伪造的消息
      const encryptedFakeMessage = encryptMessage(
        fakeMessage,
        attackerPrivateKey,
        nanobotECDHKeyPair.publicKey,
        {
          recipientDid: NANOBOT_DID,
        }
      );

      const decryptedMessage = decryptMessage(
        encryptedFakeMessage,
        nanobotECDHKeyPair.privateKey
      );

      // 签名验证应该失败（因为签名是用攻击者的密钥创建的）
      const isValid = verifySignature(decryptedMessage, automatonSigningKey);
      expect(isValid).toBe(false);
    });
  });

  describe("场景4: 密钥轮换", () => {
    it("应该支持DID文档的密钥轮换", () => {
      // 获取初始密钥
      const initialKeyId = `${AUTOMATON_DID}#key-1`;

      // 创建初始消息
      const message1 = createANPMessage(
        testPayload,
        automatonSigningKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
          keyId: initialKeyId,
        }
      );

      expect(message1.signature.verificationMethod).toBe(initialKeyId);

      // 模拟密钥轮换
      const newKeyPair = generateKeyPair();
      const newPrivateKey = importPrivateKey(newKeyPair.privateKey);
      const newKeyId = `${AUTOMATON_DID}#key-2`;

      // 使用新密钥创建消息
      const message2 = createANPMessage(
        testPayload,
        newPrivateKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
          keyId: newKeyId,
        }
      );

      expect(message2.signature.verificationMethod).toBe(newKeyId);

      // 两个消息都应该有效
      expect(verifySignature(message1, automatonSigningKey)).toBe(true);
      expect(verifySignature(message2, newPrivateKey)).toBe(true);
    });

    it("应该支持加密密钥的轮换", () => {
      const originalMessage = createANPMessage(
        testPayload,
        automatonSigningKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
        }
      );

      // 使用初始ECDH密钥加密
      const encrypted1 = encryptMessage(
        originalMessage,
        automatonSigningKey,
        nanobotECDHKeyPair.publicKey,
        { recipientDid: NANOBOT_DID }
      );

      // Nanobot轮换加密密钥
      const newNanobotECDHKeyPair = generateECDHKeyPair();

      // 使用新密钥加密
      const encrypted2 = encryptMessage(
        originalMessage,
        automatonSigningKey,
        newNanobotECDHKeyPair.publicKey,
        { recipientDid: NANOBOT_DID }
      );

      // 验证可以用对应的新私钥解密
      const decrypted1 = decryptMessage(
        encrypted1,
        nanobotECDHKeyPair.privateKey
      );
      const decrypted2 = decryptMessage(
        encrypted2,
        newNanobotECDHKeyPair.privateKey
      );

      expect(decrypted1.object).toEqual(originalMessage.object);
      expect(decrypted2.object).toEqual(originalMessage.object);

      // 不能用错误的密钥解密
      expect(() => {
        decryptMessage(encrypted2, nanobotECDHKeyPair.privateKey);
      }).toThrow();
    });

    it("应该在密钥轮换期间保持向后兼容性", () => {
      // 创建使用旧密钥的消息
      const oldMessage = createANPMessage(
        testPayload,
        automatonSigningKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
          keyId: `${AUTOMATON_DID}#key-1`,
        }
      );

      // 轮换到新密钥
      const newKeyPair = generateKeyPair();
      const newPrivateKey = importPrivateKey(newKeyPair.privateKey);

      // 创建使用新密钥的消息
      const newMessage = createANPMessage(
        testPayload,
        newPrivateKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
          keyId: `${AUTOMATON_DID}#key-2`,
        }
      );

      // 两个消息都应该能被各自的公钥验证
      expect(verifySignature(oldMessage, automatonSigningKey)).toBe(true);
      expect(verifySignature(newMessage, newPrivateKey)).toBe(true);
    });
  });

  describe("场景5: 完整的双系统通信流程", () => {
    it("应该完成完整的双向安全通信", () => {
      // Automaton -> Nanobot
      const automatonMessage = createANPMessage(
        testPayload,
        automatonSigningKey,
        {
          type: "ProgressEvent",
          targetDid: NANOBOT_DID,
        }
      );

      const automatonToNanobot = encryptMessage(
        automatonMessage,
        automatonSigningKey,
        nanobotECDHKeyPair.publicKey,
        { recipientDid: NANOBOT_DID }
      );

      const nanobotReceived = decryptMessage(
        automatonToNanobot,
        nanobotECDHKeyPair.privateKey
      );

      expect(nanobotReceived.object).toEqual(testPayload);
      expect(verifySignature(nanobotReceived, automatonSigningKey)).toBe(true);

      // Nanobot -> Automaton (响应)
      const responsePayload: ProgressReportPayload = {
        "@type": "anp:ProgressReport",
        "anp:taskId": "test-e2e-task-001",
        "anp:progress": 100,
        "anp:currentPhase": "completed",
        "anp:completedSteps": [
          "setup_identity",
          "generate_keys",
          "create_payload",
          "encrypt_message",
          "transmit_securely",
          "decrypt_and_verify",
        ],
        "anp:nextSteps": [],
        "anp:blockers": [],
      };

      const nanobotMessage = createANPMessage(
        responsePayload,
        nanobotSigningKey,
        {
          actorDid: NANOBOT_DID,
          type: "ProgressEvent",
          targetDid: AUTOMATON_DID,
        }
      );

      const nanobotToAutomaton = encryptMessage(
        nanobotMessage,
        nanobotSigningKey,
        automatonECDHKeyPair.publicKey,
        { recipientDid: AUTOMATON_DID }
      );

      const automatonReceived = decryptMessage(
        nanobotToAutomaton,
        automatonECDHKeyPair.privateKey
      );

      expect(automatonReceived.object).toEqual(responsePayload);
      expect(verifySignature(automatonReceived, nanobotSigningKey)).toBe(true);
    });

    it("应该在多轮对话中保持安全性", async () => {
      const rounds = 5;
      const results: boolean[] = [];

      for (let i = 0; i < rounds; i++) {
        const roundPayload: ProgressReportPayload = {
          "@type": "anp:ProgressReport",
          "anp:taskId": `round-${i}`,
          "anp:progress": (i / rounds) * 100,
          "anp:currentPhase": `round-${i}`,
          "anp:completedSteps": [`step-${i}`],
          "anp:nextSteps": [`step-${i + 1}`],
        };

        const message = createANPMessage(
          roundPayload,
          automatonSigningKey,
          {
            type: "ProgressEvent",
            targetDid: NANOBOT_DID,
          }
        );

        const encrypted = encryptMessage(
          message,
          automatonSigningKey,
          nanobotECDHKeyPair.publicKey,
          { recipientDid: NANOBOT_DID }
        );

        const decrypted = decryptMessage(
          encrypted,
          nanobotECDHKeyPair.privateKey
        );

        const isValid = verifySignature(decrypted, automatonSigningKey);
        results.push(isValid);
      }

      // 所有轮次都应该是安全的
      expect(results.every((r) => r === true)).toBe(true);
    });
  });
});
