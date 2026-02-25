/**
 * @jest-environment node
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  generateECDHKeyPair,
  computeSharedSecret,
  deriveAESKey,
  encryptAES,
  decryptAES,
  encryptMessage,
  decryptMessage,
  ECDHKeyPair,
  EncryptResult,
} from "../../anp/encryption.js";
import { generateKeyPair, importPrivateKey } from "../../anp/did.js";
import { createANPMessage } from "../../anp/signature.js";
import { AUTOMATON_DID, NANOBOT_DID } from "../../anp/types.js";
import type { ProgressReportPayload } from "../../anp/types.js";
import * as crypto from "crypto";

describe("Encryption Module", () => {
  // 签名密钥 (ECDSA P-256)
  let signingPrivateKeyObj: crypto.KeyObject;

  // 加密密钥 (ECDH P-256) - 发送方
  let senderECDHPrivateKey: Buffer;
  let senderECDHPublicKey: Buffer;

  // 加密密钥 (ECDH P-256) - 接收方
  let recipientECDHPrivateKey: Buffer;
  let recipientECDHPublicKey: Buffer;

  let testPayload: ProgressReportPayload;

  beforeEach(() => {
    // 生成签名密钥对 (ECDSA)
    const signingKeyPair = generateKeyPair();
    signingPrivateKeyObj = importPrivateKey(signingKeyPair.privateKey);

    // 生成发送方 ECDH 加密密钥对
    const senderECDHKeyPair = generateECDHKeyPair();
    senderECDHPrivateKey = senderECDHKeyPair.privateKey;
    senderECDHPublicKey = senderECDHKeyPair.publicKey;

    // 生成接收方 ECDH 加密密钥对
    const recipientECDHKeyPair = generateECDHKeyPair();
    recipientECDHPrivateKey = recipientECDHKeyPair.privateKey;
    recipientECDHPublicKey = recipientECDHKeyPair.publicKey;

    testPayload = {
      "@type": "anp:ProgressReport",
      "anp:taskId": "test-task-001",
      "anp:progress": 50,
      "anp:currentPhase": "testing",
      "anp:completedSteps": ["step1", "step2"],
      "anp:nextSteps": ["step3"],
    };
  });

  describe("generateECDHKeyPair", () => {
    it("should generate valid ECDH key pair", () => {
      const { privateKey, publicKey } = generateECDHKeyPair();

      expect(privateKey).toBeDefined();
      expect(publicKey).toBeDefined();
      expect(privateKey).toBeInstanceOf(Buffer);
      expect(publicKey).toBeInstanceOf(Buffer);
      expect(privateKey.length).toBe(32); // P-256 私钥是 32 字节
      expect(publicKey.length).toBe(65); // 未压缩公钥是 65 字节
    });
  });

  describe("computeSharedSecret", () => {
    it("should compute same secret from both sides", () => {
      // Alice 的密钥对
      const aliceKeyPair = generateECDHKeyPair();
      // Bob 的密钥对
      const bobKeyPair = generateECDHKeyPair();

      // Alice 使用 Bob 的公钥计算共享密钥
      const aliceSecret = computeSharedSecret(
        aliceKeyPair.privateKey,
        bobKeyPair.publicKey
      );

      // Bob 使用 Alice 的公钥计算共享密钥
      const bobSecret = computeSharedSecret(
        bobKeyPair.privateKey,
        aliceKeyPair.publicKey
      );

      // 两边应该得到相同的共享密钥
      expect(aliceSecret).toBeDefined();
      expect(aliceSecret.equals(bobSecret)).toBe(true);
    });
  });

  describe("deriveAESKey", () => {
    it("should derive consistent AES key from same secret", () => {
      const sharedSecret = crypto.randomBytes(32);
      const key1 = deriveAESKey(sharedSecret);
      const key2 = deriveAESKey(sharedSecret);

      expect(key1).toBeInstanceOf(Buffer);
      expect(key1.length).toBe(32);
      expect(key1.equals(key2)).toBe(true);
    });

    it("should derive different keys for different info", () => {
      const sharedSecret = crypto.randomBytes(32);
      const key1 = deriveAESKey(sharedSecret, Buffer.from("info1", "utf-8"));
      const key2 = deriveAESKey(sharedSecret, Buffer.from("info2", "utf-8"));

      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe("encryptAES and decryptAES", () => {
    it("should encrypt and decrypt data correctly", () => {
      const key = crypto.randomBytes(32);
      const plaintext = "Hello, ANP!";

      const encrypted = encryptAES(plaintext, key);
      const decrypted = decryptAES(encrypted, key);

      expect(decrypted.toString()).toBe(plaintext);
    });

    it("should encrypt and decrypt binary data", () => {
      const key = crypto.randomBytes(32);
      const plaintext = crypto.randomBytes(100);

      const encrypted = encryptAES(plaintext, key);
      const decrypted = decryptAES(encrypted, key);

      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it("should reject decryption with wrong key", () => {
      const key = crypto.randomBytes(32);
      const wrongKey = crypto.randomBytes(32);
      const plaintext = "Hello, ANP!";

      const encrypted = encryptAES(plaintext, key);

      expect(() => decryptAES(encrypted, wrongKey)).toThrow();
    });

    it("should support additional authenticated data", () => {
      const key = crypto.randomBytes(32);
      const plaintext = "Hello, ANP!";
      const aad = "additional-data";

      const encrypted = encryptAES(plaintext, key, { additionalData: aad });
      const decrypted = decryptAES(encrypted, key, { additionalData: aad });

      expect(decrypted.toString()).toBe(plaintext);
    });
  });

  describe("encryptMessage and decryptMessage", () => {
    it("should encrypt and decrypt ANP message", () => {
      // 创建原始消息 (使用签名密钥)
      const originalMessage = createANPMessage(testPayload, signingPrivateKeyObj, {
        type: "ProgressEvent",
        targetDid: NANOBOT_DID,
      });

      // 加密消息 (使用签名 KeyObject 和 ECDH 公钥)
      const encryptedMessage = encryptMessage(
        originalMessage,
        signingPrivateKeyObj,  // 使用 KeyObject 进行签名
        recipientECDHPublicKey,  // 使用 ECDH 公钥进行加密
        {
          recipientDid: NANOBOT_DID,
        }
      );

      // 验证加密消息结构
      expect(encryptedMessage["@type"]).toBe("ANPEncryptedMessage");
      expect(encryptedMessage.actor).toBe(AUTOMATON_DID);
      expect(encryptedMessage.target).toBe(NANOBOT_DID);
      expect(encryptedMessage.encryptedPayload).toBeDefined();
      expect(encryptedMessage.signature).toBeDefined();

      // 解密消息
      const decryptedMessage = decryptMessage(
        encryptedMessage,
        recipientECDHPrivateKey
      );

      // 验证解密后的消息
      expect(decryptedMessage.actor).toBe(originalMessage.actor);
      expect(decryptedMessage.target).toBe(originalMessage.target);
      expect(decryptedMessage.type).toBe(originalMessage.type);
      expect(decryptedMessage.object).toEqual(originalMessage.object);
    });

    it("should fail decryption with wrong private key", () => {
      const originalMessage = createANPMessage(testPayload, signingPrivateKeyObj, {
        type: "ProgressEvent",
        targetDid: NANOBOT_DID,
      });

      const encryptedMessage = encryptMessage(
        originalMessage,
        signingPrivateKeyObj,
        recipientECDHPublicKey,
        {
          recipientDid: NANOBOT_DID,
        }
      );

      // 使用错误的私钥
      const wrongKeyPair = generateECDHKeyPair();
      const wrongPrivateKey = wrongKeyPair.privateKey;

      expect(() =>
        decryptMessage(encryptedMessage, wrongPrivateKey)
      ).toThrow();
    });

    it("should produce unique ephemeral keys for each message", () => {
      const originalMessage = createANPMessage(testPayload, signingPrivateKeyObj, {
        type: "ProgressEvent",
        targetDid: NANOBOT_DID,
      });

      const encrypted1 = encryptMessage(
        originalMessage,
        signingPrivateKeyObj,
        recipientECDHPublicKey,
        { recipientDid: NANOBOT_DID }
      );

      const encrypted2 = encryptMessage(
        originalMessage,
        signingPrivateKeyObj,
        recipientECDHPublicKey,
        { recipientDid: NANOBOT_DID }
      );

      // 每条消息应该有不同的临时公钥
      expect(encrypted1.encryptedPayload.ephemeralPublicKey).toBeDefined();
      expect(encrypted1.encryptedPayload.ephemeralPublicKey).not.toBe(
        encrypted2.encryptedPayload.ephemeralPublicKey
      );
    });
  });
});
