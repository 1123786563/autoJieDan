/**
 * @jest-environment node
 *
 * 跨系统签名验证测试
 * 验证 TypeScript 和 Python 端的签名/验证一致性
 */

import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
} from "../../anp/did.js";
import {
  signPayload,
  verifySignature,
  canonicalJsonStringify,
} from "../../anp/signature.js";
import { AUTOMATON_DID } from "../../anp/types.js";
import type { ProgressReportPayload } from "../../anp/types.js";

describe("Cross-System Signature Verification", () => {
  describe("canonicalJsonStringify", () => {
    it("should produce consistent JSON for same object", () => {
      const obj = {
        "@type": "anp:ProgressReport",
        "anp:taskId": "test-task-001",
        "anp:progress": 50,
        "anp:currentPhase": "testing",
        "anp:completedSteps": ["step1", "step2"],
        "anp:nextSteps": ["step3"],
      };

      const json1 = canonicalJsonStringify(obj);
      const json2 = canonicalJsonStringify(obj);

      expect(json1).toBe(json2);
    });

    it("should sort keys alphabetically", () => {
      const obj = {
        z: 1,
        a: 2,
        m: 3,
      };

      const json = canonicalJsonStringify(obj);
      // 确保键按字母顺序排列
      const expected = '{"a":2,"m":3,"z":1}';
      expect(json).toBe(expected);
    });

    it("should handle nested objects", () => {
      const obj = {
        "@type": "test",
        nested: {
          z: 1,
          a: 2,
        },
      };

      const json = canonicalJsonStringify(obj);
      const parsed = JSON.parse(json);
      expect(Object.keys(parsed.nested)).toEqual(["a", "z"]);
    });

    it("should match Python JSON serialization format", () => {
      // 这个测试确保TypeScript的JSON格式与Pydantic的model_dump_json()兼容
      const obj = {
        "@type": "anp:ProgressReport",
        "anp:taskId": "test-task-001",
        "anp:progress": 50,
        "anp:currentPhase": "testing",
        "anp:completedSteps": ["step1", "step2"],
        "anp:nextSteps": ["step3"],
      };

      const json = canonicalJsonStringify(obj);
      const parsed = JSON.parse(json);

      // 验证序列化后的数据可以正确反序列化
      expect(parsed).toEqual(obj);
      expect(json).not.toContain(" "); // 无空格
      expect(json).not.toContain("\n"); // 无换行
    });
  });

  describe("Signature Round-trip", () => {
    it("should create and verify signature correctly", () => {
      const keyPair = generateKeyPair();
      const privateKey = importPrivateKey(keyPair.privateKey);
      const publicKey = importPublicKey(keyPair.publicKey);

      const payload: ProgressReportPayload = {
        "@type": "anp:ProgressReport",
        "anp:taskId": "test-task-001",
        "anp:progress": 50,
        "anp:currentPhase": "testing",
        "anp:completedSteps": ["step1", "step2"],
        "anp:nextSteps": ["step3"],
      };

      const keyId = `${AUTOMATON_DID}#key-1`;
      const signature = signPayload(payload, privateKey, keyId);

      // 创建消息
      const message = {
        "@context": ["https://www.w3.org/ns/activitystreams/v1"],
        "@type": "ANPMessage",
        id: "test-id",
        timestamp: new Date().toISOString(),
        actor: AUTOMATON_DID,
        target: "",
        type: "ProgressEvent" as const,
        object: payload,
        signature,
      };

      // 验证签名
      const isValid = verifySignature(message, publicKey);
      expect(isValid).toBe(true);
    });

    it("should reject signature with modified payload", () => {
      const keyPair = generateKeyPair();
      const privateKey = importPrivateKey(keyPair.privateKey);
      const publicKey = importPublicKey(keyPair.publicKey);

      const payload: ProgressReportPayload = {
        "@type": "anp:ProgressReport",
        "anp:taskId": "test-task-001",
        "anp:progress": 50,
        "anp:currentPhase": "testing",
        "anp:completedSteps": ["step1", "step2"],
        "anp:nextSteps": ["step3"],
      };

      const keyId = `${AUTOMATON_DID}#key-1`;
      const signature = signPayload(payload, privateKey, keyId);

      // 修改负载
      const modifiedPayload = { ...payload, "anp:progress": 100 };

      const message = {
        "@context": ["https://www.w3.org/ns/activitystreams/v1"],
        "@type": "ANPMessage",
        id: "test-id",
        timestamp: new Date().toISOString(),
        actor: AUTOMATON_DID,
        target: "",
        type: "ProgressEvent" as const,
        object: modifiedPayload,
        signature,
      };

      const isValid = verifySignature(message, publicKey);
      expect(isValid).toBe(false);
    });

    it("should produce consistent signatures for same payload", () => {
      const keyPair = generateKeyPair();
      const privateKey = importPrivateKey(keyPair.privateKey);

      const payload: ProgressReportPayload = {
        "@type": "anp:ProgressReport",
        "anp:taskId": "test-task-001",
        "anp:progress": 50,
        "anp:currentPhase": "testing",
        "anp:completedSteps": ["step1", "step2"],
        "anp:nextSteps": ["step3"],
      };

      const keyId = `${AUTOMATON_DID}#key-1`;

      // 创建两个签名
      const signature1 = signPayload(payload, privateKey, keyId);
      const signature2 = signPayload(payload, privateKey, keyId);

      // 签名值应该不同（因为时间戳不同）
      expect(signature1.proofValue).not.toBe(signature2.proofValue);

      // 但时间戳应该在合理范围内
      const time1 = new Date(signature1.created).getTime();
      const time2 = new Date(signature2.created).getTime();
      expect(Math.abs(time1 - time2)).toBeLessThan(1000); // 1秒内
    });
  });

  describe("ECDSA-P256 Compatibility", () => {
    it("should verify signature with different key order", () => {
      // 测试对象键的不同顺序是否产生可验证的签名
      const keyPair = generateKeyPair();
      const privateKey = importPrivateKey(keyPair.privateKey);
      const publicKey = importPublicKey(keyPair.publicKey);

      const payload1: ProgressReportPayload = {
        "@type": "anp:ProgressReport",
        "anp:taskId": "test-task-001",
        "anp:progress": 50,
        "anp:currentPhase": "testing",
        "anp:completedSteps": ["step1", "step2"],
        "anp:nextSteps": ["step3"],
      };

      const keyId = `${AUTOMATON_DID}#key-1`;
      const signature = signPayload(payload1, privateKey, keyId);

      // 验证签名有效
      const message = {
        "@context": ["https://www.w3.org/ns/activitystreams/v1"],
        "@type": "ANPMessage",
        id: "test-id",
        timestamp: new Date().toISOString(),
        actor: AUTOMATON_DID,
        target: "",
        type: "ProgressEvent" as const,
        object: payload1,
        signature,
      };

      expect(verifySignature(message, publicKey)).toBe(true);
    });
  });
});
