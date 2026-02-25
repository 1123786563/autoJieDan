/**
 * @jest-environment node
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  hashMessage,
  hashPayload,
  signPayload,
  verifySignature,
  createANPMessage,
  verifyMessage,
} from "../../anp/signature.js";
import {
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
} from "../../anp/did.js";
import { AUTOMATON_DID } from "../../anp/types.js";
import type { ProgressReportPayload } from "../../anp/types.js";

describe("Signature Module", () => {
  let privateKey: ReturnType<typeof importPrivateKey>;
  let publicKey: ReturnType<typeof importPublicKey>;
  let testPayload: ProgressReportPayload;

  beforeEach(() => {
    const keyPair = generateKeyPair();
    privateKey = importPrivateKey(keyPair.privateKey);
    publicKey = importPublicKey(keyPair.publicKey);

    testPayload = {
      "@type": "anp:ProgressReport",
      "anp:taskId": "test-task-001",
      "anp:progress": 50,
      "anp:currentPhase": "testing",
      "anp:completedSteps": ["step1", "step2"],
      "anp:nextSteps": ["step3"],
    };
  });

  describe("hashPayload", () => {
    it("should generate consistent hash for same payload", () => {
      const hash1 = hashPayload(testPayload);
      const hash2 = hashPayload(testPayload);
      expect(hash1).toBeInstanceOf(Buffer);
      expect(hash1.equals(hash2)).toBe(true);
    });

    it("should generate different hash for different payload", () => {
      const hash1 = hashPayload(testPayload);
      const differentPayload = { ...testPayload, "anp:progress": 100 };
      const hash2 = hashPayload(differentPayload);
      expect(hash1.equals(hash2)).toBe(false);
    });
  });

  describe("signPayload", () => {
    it("should create valid signature", () => {
      const keyId = `${AUTOMATON_DID}#key-1`;
        const signature = signPayload(testPayload, privateKey, keyId);

        expect(signature.type).toBe("EcdsaSecp256r1Signature2019");
        expect(signature.verificationMethod).toBe(keyId);
        expect(signature.proofPurpose).toBe("authentication");
        expect(signature.proofValue).toBeDefined();
        expect(typeof signature.proofValue).toBe("string");
    });

    it("should create unique signatures for different payloads", () => {
      const keyId = `${AUTOMATON_DID}#key-1`;
        const signature1 = signPayload(testPayload, privateKey, keyId);

        const differentPayload = { ...testPayload, "anp:progress": 100 };
        const signature2 = signPayload(differentPayload, privateKey, keyId);

        expect(signature1.proofValue).not.toBe(signature2.proofValue);
    });
  });

  describe("verifySignature", () => {
    it("should verify valid signature", () => {
      const keyId = `${AUTOMATON_DID}#key-1`;
        const signature = signPayload(testPayload, privateKey, keyId);

      const message = {
        "@context": ["https://www.w3.org/ns/activitystreams/v1"],
        "@type": "ANPMessage",
        id: "test-id",
        timestamp: new Date().toISOString(),
        actor: AUTOMATON_DID,
        target: "",
        type: "ProgressEvent" as const,
        object: testPayload,
        signature,
      };

      expect(verifySignature(message, publicKey)).toBe(true);
    });

    it("should reject invalid signature", () => {
      const keyId = `${AUTOMATON_DID}#key-1`;
        const signature = signPayload(testPayload, privateKey, keyId);

      // 使用不同的 payload 创建消息
      const differentPayload = { ...testPayload, "anp:progress": 100 };
      const message = {
        "@context": ["https://www.w3.org/ns/activitystreams/v1"],
        "@type": "ANPMessage",
        id: "test-id",
        timestamp: new Date().toISOString(),
        actor: AUTOMATON_DID,
        target: "",
        type: "ProgressEvent" as const,
        object: differentPayload,
        signature,
      };

      expect(verifySignature(message, publicKey)).toBe(false);
    });

    it("should reject signature from different key", () => {
      const keyId = `${AUTOMATON_DID}#key-1`;
        const signature = signPayload(testPayload, privateKey, keyId);

      // 使用不同的密钥对
      const differentKeyPair = generateKeyPair();
      const differentPublicKey = importPublicKey(differentKeyPair.publicKey);

      const message = {
        "@context": ["https://www.w3.org/ns/activitystreams/v1"],
        "@type": "ANPMessage",
        id: "test-id",
        timestamp: new Date().toISOString(),
        actor: AUTOMATON_DID,
        target: "",
        type: "ProgressEvent" as const,
        object: testPayload,
        signature,
      };

      expect(verifySignature(message, differentPublicKey)).toBe(false);
    });
  });

  describe("createANPMessage", () => {
    it("should create valid ANP message with signature", () => {
      const message = createANPMessage(testPayload, privateKey, {
        type: "ProgressEvent",
        targetDid: "did:anp:nanobot:main",
        correlationId: "corr-001",
        ttl: 1800,
      });

      expect(message["@context"]).toBeDefined();
      expect(message["@type"]).toBe("ANPMessage");
      expect(message.id).toBeDefined();
      expect(message.timestamp).toBeDefined();
      expect(message.actor).toBe(AUTOMATON_DID);
      expect(message.target).toBe("did:anp:nanobot:main");
      expect(message.type).toBe("ProgressEvent");
      expect(message.object).toEqual(testPayload);
      expect(message.signature).toBeDefined();
      expect(message.correlationId).toBe("corr-001");
      expect(message.ttl).toBe(1800);
    });

    it("should create message that can be verified", () => {
      const message = createANPMessage(testPayload, privateKey, {
        type: "ProgressEvent",
      });

      expect(verifySignature(message, publicKey)).toBe(true);
    });
  });

  describe("verifyMessage", () => {
    it("should verify valid message", () => {
      const message = createANPMessage(testPayload, privateKey, {
        type: "ProgressEvent",
        ttl: 3600,
      });

      const result = verifyMessage(message, publicKey, 300000);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should reject message with invalid signature", () => {
      const message = createANPMessage(testPayload, privateKey, {
        type: "ProgressEvent",
      });

      // 使用不同的公钥
      const differentKeyPair = generateKeyPair();
      const differentPublicKey = importPublicKey(differentKeyPair.publicKey);

      const result = verifyMessage(message, differentPublicKey);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid signature");
    });

    it("should reject expired message", () => {
      const message = createANPMessage(testPayload, privateKey, {
        type: "ProgressEvent",
      });

      // 手动修改时间戳为很久以前
      const oldTimestamp = new Date(Date.now() - 600000).toISOString(); // 10 分钟前
      const expiredMessage = {
        ...message,
        timestamp: oldTimestamp,
      };

      const result = verifyMessage(expiredMessage, publicKey, 300000); // 5 分钟有效期
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Message expired");
    });
  });
});
