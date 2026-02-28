/**
 * TypeScript <-> Python 类型互操作性测试
 * 验证双向序列化/反序列化一致性
 *
 * @module anp/interop
 * @version 1.0.0
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ANPMessage,
  GenesisPromptPayload,
  ProgressReportPayload,
  ProtocolNegotiatePayload,
  DEFAULT_CONTEXT,
  AUTOMATON_DID,
  NANOBOT_DID,
} from "../../anp/types";
import { createANPMessage } from "../../anp/signature";
import { generateKeyPair, importPrivateKey } from "../../anp/did";
import type { ProgressReportPayload as ProgressReportPayloadType } from "../../anp/types";

/**
 * 辅助函数: 创建 Genesis Prompt 负载
 */
function createGenesisPromptPayload(): GenesisPromptPayload {
  return {
    "@type": "genesis:GenesisPrompt",
    "genesis:projectId": "interop-test-project",
    "genesis:platform": "upwork",
    "genesis:requirementSummary": "Test TypeScript/Python interoperability",
    "genesis:technicalConstraints": {
      "@type": "genesis:TechnicalConstraints",
      "genesis:requiredStack": ["typescript", "python"],
      "genesis:prohibitedStack": ["java"],
      "genesis:targetPlatform": "linux",
    },
    "genesis:contractTerms": {
      "@type": "genesis:ContractTerms",
      "genesis:totalBudget": {
        "@type": "schema:MonetaryAmount",
        "schema:value": 5000,
        "schema:currency": "USD",
      },
      "genesis:deadline": new Date("2025-12-31T23:59:59Z").toISOString(),
      "genesis:milestones": [
        {
          "@type": "genesis:Milestone",
          "genesis:name": "Phase 1",
          "genesis:percentage": 30,
          "genesis:dueDate": new Date("2025-11-15T23:59:59Z").toISOString(),
        },
        {
          "@type": "genesis:Milestone",
          "genesis:name": "Phase 2",
          "genesis:percentage": 70,
          "genesis:dueDate": new Date("2025-12-15T23:59:59Z").toISOString(),
        },
      ],
    },
    "genesis:resourceLimits": {
      "@type": "genesis:ResourceLimits",
      "genesis:maxTokensPerTask": 200000,
      "genesis:maxCostCents": 1000,
      "genesis:maxDurationMs": 7200000,
    },
    "genesis:specialInstructions": {
      "@type": "genesis:SpecialInstructions",
      "genesis:priorityLevel": "high",
      "genesis:riskFlags": ["deadline-tight", "complex-integration"],
      "genesis:humanReviewRequired": true,
    },
  };
}

/**
 * 辅助函数: 创建 Progress Report 负载
 */
function createProgressReportPayload(): ProgressReportPayloadType {
  return {
    "@type": "anp:ProgressReport",
    "anp:taskId": "interop-task-123",
    "anp:progress": 65,
    "anp:currentPhase": "integration-testing",
    "anp:completedSteps": [
      "typescript-setup",
      "python-setup",
      "serialization-validation",
    ],
    "anp:nextSteps": ["bidirectional-testing", "documentation"],
    "anp:etaSeconds": 7200,
    "anp:blockers": ["cross-platform-timezone-handling"],
  };
}

/**
 * 辅助函数: 创建 Protocol Negotiate 负载
 */
function createProtocolNegotiatePayload(): ProtocolNegotiatePayload {
  return {
    "@type": "anp:ProtocolNegotiation",
    "anp:proposedProtocol": "ANP",
    "anp:protocolVersion": "1.0.0",
    "anp:capabilities": ["encryption", "compression", "streaming"],
    "anp:constraints": {
      "anp:maxLatency": 500,
      "anp:encryptionRequired": true,
      "anp:compression": "gzip",
    },
  };
}

describe("TypeScript <-> Python 类型互操作性", () => {
  describe("Genesis Prompt 双向序列化", () => {
    it("应该生成 Python 可解析的 JSON 格式", () => {
      const payload = createGenesisPromptPayload();

      // 序列化为 JSON
      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      // 验证关键字段使用带命名空间的格式
      expect(parsed["@type"]).toBe("genesis:GenesisPrompt");
      expect(parsed["genesis:projectId"]).toBe("interop-test-project");
      expect(parsed["genesis:platform"]).toBe("upwork");
      expect(parsed["genesis:requirementSummary"]).toBe("Test TypeScript/Python interoperability");

      // 验证嵌套对象
      expect(parsed["genesis:technicalConstraints"]).toBeDefined();
      expect(parsed["genesis:technicalConstraints"]["@type"]).toBe("genesis:TechnicalConstraints");
      expect(parsed["genesis:technicalConstraints"]["genesis:requiredStack"]).toEqual([
        "typescript",
        "python",
      ]);
      expect(parsed["genesis:technicalConstraints"]["genesis:prohibitedStack"]).toEqual(["java"]);

      // 验证预算对象
      expect(parsed["genesis:contractTerms"]).toBeDefined();
      expect(parsed["genesis:contractTerms"]["@type"]).toBe("genesis:ContractTerms");
      expect(parsed["genesis:contractTerms"]["genesis:totalBudget"]).toBeDefined();
      expect(parsed["genesis:contractTerms"]["genesis:totalBudget"]["@type"]).toBe("schema:MonetaryAmount");
      expect(parsed["genesis:contractTerms"]["genesis:totalBudget"]["schema:value"]).toBe(5000);
      expect(parsed["genesis:contractTerms"]["genesis:totalBudget"]["schema:currency"]).toBe("USD");

      // 验证里程碑
      expect(parsed["genesis:contractTerms"]["genesis:milestones"]).toBeDefined();
      expect(parsed["genesis:contractTerms"]["genesis:milestones"].length).toBe(2);
      expect(parsed["genesis:contractTerms"]["genesis:milestones"][0]["genesis:name"]).toBe("Phase 1");
      expect(parsed["genesis:contractTerms"]["genesis:milestones"][0]["genesis:percentage"]).toBe(30);

      // 验证资源限制
      expect(parsed["genesis:resourceLimits"]).toBeDefined();
      expect(parsed["genesis:resourceLimits"]["@type"]).toBe("genesis:ResourceLimits");
      expect(parsed["genesis:resourceLimits"]["genesis:maxTokensPerTask"]).toBe(200000);

      // 验证特殊指示
      expect(parsed["genesis:specialInstructions"]).toBeDefined();
      expect(parsed["genesis:specialInstructions"]["@type"]).toBe("genesis:SpecialInstructions");
      expect(parsed["genesis:specialInstructions"]["genesis:priorityLevel"]).toBe("high");
      expect(parsed["genesis:specialInstructions"]["genesis:riskFlags"]).toEqual([
        "deadline-tight",
        "complex-integration",
      ]);
    });

    it("应该能够往返序列化 Genesis Prompt", () => {
      const originalPayload = createGenesisPromptPayload();

      // 第一次序列化
      const json1 = JSON.stringify(originalPayload);
      const parsed1 = JSON.parse(json1);

      // 第二次序列化（从第一次解析的结果）
      const json2 = JSON.stringify(parsed1);
      const parsed2 = JSON.parse(json2);

      // 验证三次序列化结果一致
      expect(parsed1).toEqual(parsed2);

      // 验证所有关键字段保持不变
      expect(parsed2["genesis:projectId"]).toBe(originalPayload["genesis:projectId"]);
      expect(parsed2["genesis:platform"]).toBe(originalPayload["genesis:platform"]);
      expect(parsed2["genesis:technicalConstraints"]["genesis:requiredStack"]).toEqual(
        originalPayload["genesis:technicalConstraints"]["genesis:requiredStack"]
      );
      expect(parsed2["genesis:contractTerms"]["genesis:totalBudget"]["schema:value"]).toBe(
        originalPayload["genesis:contractTerms"]["genesis:totalBudget"]["schema:value"]
      );
    });

    it("日期时间应该使用 ISO 8601 格式", () => {
      const payload = createGenesisPromptPayload();

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      // 验证日期时间格式
      const deadline = parsed["genesis:contractTerms"]["genesis:deadline"];
      expect(deadline).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

      // 验证里程碑日期
      const milestones = parsed["genesis:contractTerms"]["genesis:milestones"];
      milestones.forEach((milestone: any) => {
        expect(milestone["genesis:dueDate"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      });

      // Python datetime.fromisoformat() 应该能够解析这些格式
      expect(() => new Date(deadline)).not.toThrow();
      milestones.forEach((milestone: any) => {
        expect(() => new Date(milestone["genesis:dueDate"])).not.toThrow();
      });
    });
  });

  describe("Progress Report 双向序列化", () => {
    it("应该生成 Python 可解析的 JSON 格式", () => {
      const payload = createProgressReportPayload();

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      // 验证字段使用带命名空间的格式
      expect(parsed["@type"]).toBe("anp:ProgressReport");
      expect(parsed["anp:taskId"]).toBe("interop-task-123");
      expect(parsed["anp:progress"]).toBe(65);
      expect(parsed["anp:currentPhase"]).toBe("integration-testing");
      expect(parsed["anp:completedSteps"]).toEqual([
        "typescript-setup",
        "python-setup",
        "serialization-validation",
      ]);
      expect(parsed["anp:nextSteps"]).toEqual(["bidirectional-testing", "documentation"]);
      expect(parsed["anp:etaSeconds"]).toBe(7200);
      expect(parsed["anp:blockers"]).toEqual(["cross-platform-timezone-handling"]);
    });

    it("应该能够往返序列化 Progress Report", () => {
      const originalPayload = createProgressReportPayload();

      const json = JSON.stringify(originalPayload);
      const parsed = JSON.parse(json);

      // 验证所有字段保持不变
      expect(parsed["anp:taskId"]).toBe(originalPayload["anp:taskId"]);
      expect(parsed["anp:progress"]).toBe(originalPayload["anp:progress"]);
      expect(parsed["anp:currentPhase"]).toBe(originalPayload["anp:currentPhase"]);
      expect(parsed["anp:completedSteps"]).toEqual(originalPayload["anp:completedSteps"]);
      expect(parsed["anp:nextSteps"]).toEqual(originalPayload["anp:nextSteps"]);
      expect(parsed["anp:etaSeconds"]).toBe(originalPayload["anp:etaSeconds"]);
      expect(parsed["anp:blockers"]).toEqual(originalPayload["anp:blockers"]);
    });
  });

  describe("Protocol Negotiation 双向序列化", () => {
    it("应该生成 Python 可解析的 JSON 格式", () => {
      const payload = createProtocolNegotiatePayload();

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      // 验证字段使用带命名空间的格式
      expect(parsed["@type"]).toBe("anp:ProtocolNegotiation");
      expect(parsed["anp:proposedProtocol"]).toBe("ANP");
      expect(parsed["anp:protocolVersion"]).toBe("1.0.0");
      expect(parsed["anp:capabilities"]).toEqual(["encryption", "compression", "streaming"]);
      expect(parsed["anp:constraints"]).toBeDefined();
      expect(parsed["anp:constraints"]["anp:maxLatency"]).toBe(500);
      expect(parsed["anp:constraints"]["anp:encryptionRequired"]).toBe(true);
      expect(parsed["anp:constraints"]["anp:compression"]).toBe("gzip");
    });

    it("应该能够往返序列化 Protocol Negotiation", () => {
      const originalPayload = createProtocolNegotiatePayload();

      const json = JSON.stringify(originalPayload);
      const parsed = JSON.parse(json);

      // 验证所有字段保持不变
      expect(parsed["anp:proposedProtocol"]).toBe(originalPayload["anp:proposedProtocol"]);
      expect(parsed["anp:protocolVersion"]).toBe(originalPayload["anp:protocolVersion"]);
      expect(parsed["anp:capabilities"]).toEqual(originalPayload["anp:capabilities"]);
      expect(parsed["anp:constraints"]["anp:maxLatency"]).toBe(
        originalPayload["anp:constraints"]["anp:maxLatency"]
      );
      expect(parsed["anp:constraints"]["anp:encryptionRequired"]).toBe(
        originalPayload["anp:constraints"]["anp:encryptionRequired"]
      );
    });
  });

  describe("完整 ANP 消息互操作性", () => {
    let signingKey: crypto.KeyObject;

    beforeEach(() => {
      const keyPair = generateKeyPair();
      signingKey = importPrivateKey(keyPair.privateKey);
    });

    it("Genesis Prompt 消息应该可以跨语言序列化", () => {
      const payload = createGenesisPromptPayload();
      const message = createANPMessage(payload, signingKey, {
        type: "TaskCreate",
        targetDid: NANOBOT_DID,
      });

      // 序列化为 JSON
      const json = JSON.stringify(message);
      const parsed = JSON.parse(json);

      // 验证消息头
      expect(parsed["@context"]).toBeDefined();
      expect(parsed["@type"]).toBe("ANPMessage");
      expect(parsed["id"]).toBeDefined();
      expect(parsed["timestamp"]).toBeDefined();
      expect(parsed["actor"]).toBe(AUTOMATON_DID);
      expect(parsed["target"]).toBe(NANOBOT_DID);
      expect(parsed["type"]).toBe("TaskCreate");

      // 验证负载
      expect(parsed["object"]).toBeDefined();
      expect(parsed["object"]["@type"]).toBe("genesis:GenesisPrompt");
      expect(parsed["object"]["genesis:projectId"]).toBe("interop-test-project");

      // 验证签名
      expect(parsed["signature"]).toBeDefined();
      expect(parsed["signature"]["type"]).toBe("EcdsaSecp256r1Signature2019");
      expect(parsed["signature"]["created"]).toBeDefined();
      expect(parsed["signature"]["verificationMethod"]).toBeDefined();
      expect(parsed["signature"]["proofPurpose"]).toBeDefined();
      expect(parsed["signature"]["proofValue"]).toBeDefined();
    });

    it("Progress Report 消息应该可以跨语言序列化", () => {
      const payload = createProgressReportPayload();
      const message = createANPMessage(payload, signingKey, {
        type: "ProgressEvent",
        targetDid: NANOBOT_DID,
      });

      const json = JSON.stringify(message);
      const parsed = JSON.parse(json);

      // 验证负载
      expect(parsed["object"]["@type"]).toBe("anp:ProgressReport");
      expect(parsed["object"]["anp:taskId"]).toBe("interop-task-123");
      expect(parsed["object"]["anp:progress"]).toBe(65);
      expect(parsed["object"]["anp:currentPhase"]).toBe("integration-testing");
    });
  });

  describe("数据类型一致性验证", () => {
    it("字符串类型应该正确序列化", () => {
      const payload: ProgressReportPayloadType = {
        "@type": "anp:ProgressReport",
        "anp:taskId": "test-with-unicode-🚀",
        "anp:progress": 50,
        "anp:currentPhase": "测试中文",
        "anp:completedSteps": [],
        "anp:nextSteps": [],
        "anp:blockers": [],
      };

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      expect(parsed["anp:taskId"]).toBe("test-with-unicode-🚀");
      expect(parsed["anp:currentPhase"]).toBe("测试中文");
    });

    it("数字类型应该正确序列化", () => {
      const payload = createGenesisPromptPayload();

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      // 验证数字类型
      expect(typeof parsed["genesis:contractTerms"]["genesis:totalBudget"]["schema:value"]).toBe("number");
      expect(parsed["genesis:contractTerms"]["genesis:totalBudget"]["schema:value"]).toBe(5000);

      // 验证里程碑百分比
      const milestones = parsed["genesis:contractTerms"]["genesis:milestones"];
      milestones.forEach((milestone: any) => {
        expect(typeof milestone["genesis:percentage"]).toBe("number");
      });
    });

    it("数组类型应该正确序列化", () => {
      const payload = createProgressReportPayload();

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed["anp:completedSteps"])).toBe(true);
      expect(Array.isArray(parsed["anp:nextSteps"])).toBe(true);
      expect(Array.isArray(parsed["anp:blockers"])).toBe(true);

      expect(parsed["anp:completedSteps"]).toHaveLength(3);
      expect(parsed["anp:nextSteps"]).toHaveLength(2);
    });

    it("布尔类型应该正确序列化", () => {
      const payload = createGenesisPromptPayload();

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      expect(typeof parsed["genesis:specialInstructions"]["genesis:humanReviewRequired"]).toBe("boolean");
      expect(parsed["genesis:specialInstructions"]["genesis:humanReviewRequired"]).toBe(true);

      expect(typeof parsed["genesis:contractTerms"]["genesis:totalBudget"]["schema:value"]).not.toBe("boolean");
    });
  });

  describe("命名空间一致性验证", () => {
    it("Genesis 字段应该使用 genesis: 命名空间", () => {
      const payload = createGenesisPromptPayload();
      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      // 验证所有 Genesis 字段使用 genesis: 前缀
      const genesisFields = [
        "genesis:projectId",
        "genesis:platform",
        "genesis:requirementSummary",
        "genesis:technicalConstraints",
        "genesis:contractTerms",
        "genesis:resourceLimits",
        "genesis:specialInstructions",
      ];

      genesisFields.forEach((field) => {
        expect(parsed[field]).toBeDefined();
      });

      // 验证嵌套的 Genesis 字段
      expect(parsed["genesis:technicalConstraints"]["genesis:requiredStack"]).toBeDefined();
      expect(parsed["genesis:technicalConstraints"]["genesis:prohibitedStack"]).toBeDefined();
      expect(parsed["genesis:technicalConstraints"]["genesis:targetPlatform"]).toBeDefined();

      expect(parsed["genesis:contractTerms"]["genesis:totalBudget"]).toBeDefined();
      expect(parsed["genesis:contractTerms"]["genesis:deadline"]).toBeDefined();
      expect(parsed["genesis:contractTerms"]["genesis:milestones"]).toBeDefined();

      expect(parsed["genesis:resourceLimits"]["genesis:maxTokensPerTask"]).toBeDefined();
      expect(parsed["genesis:resourceLimits"]["genesis:maxCostCents"]).toBeDefined();
      expect(parsed["genesis:resourceLimits"]["genesis:maxDurationMs"]).toBeDefined();

      expect(parsed["genesis:specialInstructions"]["genesis:priorityLevel"]).toBeDefined();
      expect(parsed["genesis:specialInstructions"]["genesis:riskFlags"]).toBeDefined();
      expect(parsed["genesis:specialInstructions"]["genesis:humanReviewRequired"]).toBeDefined();
    });

    it("ANP 字段应该使用 anp: 命名空间", () => {
      const payload = createProgressReportPayload();
      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      // 验证所有 ANP 字段使用 anp: 前缀
      const anpFields = [
        "anp:taskId",
        "anp:progress",
        "anp:currentPhase",
        "anp:completedSteps",
        "anp:nextSteps",
        "anp:etaSeconds",
        "anp:blockers",
      ];

      anpFields.forEach((field) => {
        expect(parsed[field]).toBeDefined();
      });
    });

    it("Schema 字段应该使用 schema: 命名空间", () => {
      const payload = createGenesisPromptPayload();
      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      // 验证 Schema 字段使用 schema: 前缀
      expect(parsed["genesis:contractTerms"]["genesis:totalBudget"]["schema:value"]).toBeDefined();
      expect(parsed["genesis:contractTerms"]["genesis:totalBudget"]["schema:currency"]).toBeDefined();
    });
  });
});
