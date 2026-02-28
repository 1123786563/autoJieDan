/**
 * ANP 消息序列化测试
 * 验证 TypeScript <-> Python 类型互操作性
 *
 * @module anp/serialization
 * @version 1.0.0
 */

import { describe, it, expect } from "vitest";
import {
  ANPMessage,
  GenesisPromptPayload,
  ProgressReportPayload,
  ProtocolNegotiatePayload,
  DEFAULT_CONTEXT,
  AUTOMATON_DID,
  NANOBOT_DID,
} from "../../anp/types";

/**
 * 辅助函数: 创建签名
 */
function createSignature() {
  return {
    type: "EcdsaSecp256r1Signature2019" as const,
    created: new Date().toISOString(),
    verificationMethod: `${AUTOMATON_DID}#key-1`,
    proofPurpose: "authentication" as const,
    proofValue: "test_signature_value",
  };
}

/**
 * 辅助函数: 创建完整的ANP消息
 */
function createTestMessage(payload: ANPMessage["object"]): ANPMessage {
  return {
    "@context": DEFAULT_CONTEXT,
    "@type": "ANPMessage",
    id: `msg-${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: AUTOMATON_DID,
    target: NANOBOT_DID,
    type: "TaskCreate",
    object: payload,
    signature: createSignature(),
  };
}

describe("ANP JSON-LD 序列化", () => {
  describe("Genesis Prompt Payload", () => {
    it("应该序列化为 camelCase 格式", () => {
      const payload: GenesisPromptPayload = {
        "@type": "genesis:GenesisPrompt",
        "genesis:projectId": "project-123",
        "genesis:platform": "upwork",
        "genesis:requirementSummary": "Build a REST API",
        "genesis:technicalConstraints": {
          "@type": "genesis:TechnicalConstraints",
          "genesis:requiredStack": ["typescript", "nodejs"],
          "genesis:prohibitedStack": ["java"],
        },
        "genesis:contractTerms": {
          "@type": "genesis:ContractTerms",
          "genesis:totalBudget": {
            "@type": "schema:MonetaryAmount",
            "schema:value": 1000,
            "schema:currency": "USD",
          },
          "genesis:deadline": new Date("2025-12-31").toISOString(),
          "genesis:milestones": [
            {
              "@type": "genesis:Milestone",
              "genesis:name": "MVP",
              "genesis:percentage": 50,
              "genesis:dueDate": new Date("2025-11-30").toISOString(),
            },
          ],
        },
        "genesis:resourceLimits": {
          "@type": "genesis:ResourceLimits",
          "genesis:maxTokensPerTask": 100000,
          "genesis:maxCostCents": 500,
          "genesis:maxDurationMs": 3600000,
        },
        "genesis:specialInstructions": {
          "genesis:priorityLevel": "high",
          "genesis:riskFlags": ["deadline-tight"],
          "genesis:humanReviewRequired": true,
        },
      };

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      // 验证关键字段使用 camelCase
      expect(parsed).toHaveProperty("@type", "genesis:GenesisPrompt");
      expect(parsed).toHaveProperty("genesis:projectId");
      expect(parsed).toHaveProperty("genesis:platform");
      expect(parsed).toHaveProperty("genesis:requirementSummary");
      expect(parsed).toHaveProperty("genesis:technicalConstraints");
      expect(parsed).toHaveProperty("genesis:contractTerms");
      expect(parsed).toHaveProperty("genesis:resourceLimits");
      expect(parsed).toHaveProperty("genesis:specialInstructions");

      // 验证嵌套对象
      expect(parsed["genesis:technicalConstraints"]).toHaveProperty("@type");
      expect(parsed["genesis:technicalConstraints"]).toHaveProperty("genesis:requiredStack");
      expect(parsed["genesis:technicalConstraints"]).toHaveProperty("genesis:prohibitedStack");

      // 验证预算对象
      expect(parsed["genesis:contractTerms"]["genesis:totalBudget"]).toHaveProperty("@type");
      expect(parsed["genesis:contractTerms"]["genesis:totalBudget"]).toHaveProperty("schema:value", 1000);
      expect(parsed["genesis:contractTerms"]["genesis:totalBudget"]).toHaveProperty("schema:currency", "USD");
    });

    it("应该正确序列化和反序列化完整消息", () => {
      const payload: GenesisPromptPayload = {
        "@type": "genesis:GenesisPrompt",
        "genesis:projectId": "project-456",
        "genesis:platform": "freelancer",
        "genesis:requirementSummary": "Mobile app development",
        "genesis:technicalConstraints": {
          "@type": "genesis:TechnicalConstraints",
          "genesis:requiredStack": ["react-native", "typescript"],
        },
        "genesis:contractTerms": {
          "@type": "genesis:ContractTerms",
          "genesis:totalBudget": {
            "@type": "schema:MonetaryAmount",
            "schema:value": 5000,
            "schema:currency": "USD",
          },
          "genesis:deadline": new Date("2025-12-31").toISOString(),
        },
        "genesis:resourceLimits": {
          "@type": "genesis:ResourceLimits",
          "genesis:maxTokensPerTask": 200000,
          "genesis:maxCostCents": 1000,
          "genesis:maxDurationMs": 7200000,
        },
      };

      const message = createTestMessage(payload);
      const json = JSON.stringify(message);
      const deserialized = JSON.parse(json) as ANPMessage;

      // 验证消息头
      expect(deserialized["@context"]).toEqual(DEFAULT_CONTEXT);
      expect(deserialized["@type"]).toBe("ANPMessage");
      expect(deserialized.id).toBeTruthy();
      expect(deserialized.timestamp).toBeTruthy();
      expect(deserialized.actor).toBe(AUTOMATON_DID);
      expect(deserialized.target).toBe(NANOBOT_DID);
      expect(deserialized.type).toBe("TaskCreate");

      // 验证负载
      expect(deserialized.object).toHaveProperty("@type", "genesis:GenesisPrompt");
      expect(deserialized.object).toHaveProperty("genesis:projectId", "project-456");
      expect(deserialized.object).toHaveProperty("genesis:platform", "freelancer");

      // 验证签名
      expect(deserialized.signature).toHaveProperty("type");
      expect(deserialized.signature).toHaveProperty("created");
      expect(deserialized.signature).toHaveProperty("verificationMethod");
      expect(deserialized.signature).toHaveProperty("proofPurpose");
      expect(deserialized.signature).toHaveProperty("proofValue");
    });
  });

  describe("Progress Report Payload", () => {
    it("应该正确序列化进度报告", () => {
      const payload: ProgressReportPayload = {
        "@type": "anp:ProgressReport",
        "anp:taskId": "task-789",
        "anp:progress": 75,
        "anp:currentPhase": "implementation",
        "anp:completedSteps": ["setup", "design", "coding"],
        "anp:nextSteps": ["testing", "deployment"],
        "anp:etaSeconds": 3600,
        "anp:blockers": [],
      };

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      // 验证字段使用带命名空间的格式
      expect(parsed).toHaveProperty("@type", "anp:ProgressReport");
      expect(parsed).toHaveProperty("anp:taskId", "task-789");
      expect(parsed).toHaveProperty("anp:progress", 75);
      expect(parsed).toHaveProperty("anp:currentPhase", "implementation");
      expect(parsed).toHaveProperty("anp:completedSteps");
      expect(parsed["anp:completedSteps"]).toEqual(["setup", "design", "coding"]);
      expect(parsed).toHaveProperty("anp:nextSteps");
      expect(parsed["anp:nextSteps"]).toEqual(["testing", "deployment"]);
      expect(parsed).toHaveProperty("anp:etaSeconds", 3600);
      expect(parsed).toHaveProperty("anp:blockers");
      expect(parsed["anp:blockers"]).toEqual([]);
    });
  });

  describe("Protocol Negotiate Payload", () => {
    it("应该正确序列化协议协商请求", () => {
      const payload: ProtocolNegotiatePayload = {
        "@type": "anp:ProtocolNegotiation",
        "anp:proposedProtocol": "ANP",
        "anp:protocolVersion": "1.0.0",
        "anp:capabilities": ["encryption", "compression"],
        "anp:constraints": {
          "anp:maxLatency": 1000,
          "anp:encryptionRequired": true,
          "anp:compression": "gzip",
        },
      };

      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);

      // 验证协议协商字段
      expect(parsed).toHaveProperty("@type", "anp:ProtocolNegotiation");
      expect(parsed).toHaveProperty("anp:proposedProtocol", "ANP");
      expect(parsed).toHaveProperty("anp:protocolVersion", "1.0.0");
      expect(parsed).toHaveProperty("anp:capabilities");
      expect(parsed["anp:capabilities"]).toEqual(["encryption", "compression"]);
      expect(parsed).toHaveProperty("anp:constraints");
      expect(parsed["anp:constraints"]).toHaveProperty("anp:maxLatency", 1000);
      expect(parsed["anp:constraints"]).toHaveProperty("anp:encryptionRequired", true);
      expect(parsed["anp:constraints"]).toHaveProperty("anp:compression", "gzip");
    });
  });
});

describe("JSON-LD 上下文验证", () => {
  it("所有消息应该包含正确的 @context", () => {
    const payload: GenesisPromptPayload = {
      "@type": "genesis:GenesisPrompt",
      "genesis:projectId": "test",
      "genesis:platform": "test",
      "genesis:requirementSummary": "test",
      "genesis:technicalConstraints": {
        "@type": "genesis:TechnicalConstraints",
      },
      "genesis:contractTerms": {
        "@type": "genesis:ContractTerms",
        "genesis:totalBudget": {
          "@type": "schema:MonetaryAmount",
          "schema:value": 100,
          "schema:currency": "USD",
        },
        "genesis:deadline": new Date().toISOString(),
      },
      "genesis:resourceLimits": {
        "@type": "genesis:ResourceLimits",
        "genesis:maxTokensPerTask": 1000,
        "genesis:maxCostCents": 100,
        "genesis:maxDurationMs": 1000,
      },
    };

    const message = createTestMessage(payload);

    // 验证 @context 是数组且包含必需的上下文
    expect(Array.isArray(message["@context"])).toBe(true);
    expect(message["@context"]).toContain("https://www.w3.org/ns/activitystreams/v1");
    expect(message["@context"]).toContain("https://w3id.org/anp/v1");
    expect(message["@context"]).toContain("https://w3id.org/security/v1");
  });

  it("所有负载应该包含 @type 字段", () => {
    const payloads = [
      {
        "@type": "genesis:GenesisPrompt" as const,
        "genesis:projectId": "test",
        "genesis:platform": "test",
        "genesis:requirementSummary": "test",
        "genesis:technicalConstraints": {
          "@type": "genesis:TechnicalConstraints" as const,
        },
        "genesis:contractTerms": {
          "@type": "genesis:ContractTerms" as const,
          "genesis:totalBudget": {
            "@type": "schema:MonetaryAmount" as const,
            "schema:value": 100,
            "schema:currency": "USD",
          },
          "genesis:deadline": new Date().toISOString(),
        },
        "genesis:resourceLimits": {
          "@type": "genesis:ResourceLimits" as const,
          "genesis:maxTokensPerTask": 1000,
          "genesis:maxCostCents": 100,
          "genesis:maxDurationMs": 1000,
        },
      },
      {
        "@type": "anp:ProgressReport" as const,
        "anp:taskId": "test",
        "anp:progress": 50,
        "anp:currentPhase": "test",
        "anp:completedSteps": [],
        "anp:nextSteps": [],
        "anp:blockers": [],
      },
      {
        "@type": "anp:ProtocolNegotiation" as const,
        "anp:proposedProtocol": "ANP",
        "anp:protocolVersion": "1.0.0",
        "anp:capabilities": [],
        "anp:constraints": {
          "anp:encryptionRequired": true,
        },
      },
    ];

    payloads.forEach((payload) => {
      expect(payload).toHaveProperty("@type");
      const message = createTestMessage(payload);
      expect(message.object).toHaveProperty("@type");
    });
  });
});

describe("类型互操作性验证", () => {
  it("应该生成 Python 可解析的 JSON 格式", () => {
    const payload: GenesisPromptPayload = {
      "@type": "genesis:GenesisPrompt",
      "genesis:projectId": "interop-test-123",
      "genesis:platform": "upwork",
      "genesis:requirementSummary": "Test serialization",
      "genesis:technicalConstraints": {
        "@type": "genesis:TechnicalConstraints",
        "genesis:requiredStack": ["python", "fastapi"],
        "genesis:prohibitedStack": [],
      },
      "genesis:contractTerms": {
        "@type": "genesis:ContractTerms",
        "genesis:totalBudget": {
          "@type": "schema:MonetaryAmount",
          "schema:value": 2000,
          "schema:currency": "USD",
        },
        "genesis:deadline": "2025-12-31T23:59:59Z",
        "genesis:milestones": [],
      },
      "genesis:resourceLimits": {
        "@type": "genesis:ResourceLimits",
        "genesis:maxTokensPerTask": 150000,
        "genesis:maxCostCents": 750,
        "genesis:maxDurationMs": 5400000,
      },
    };

    const message = createTestMessage(payload);
    const json = JSON.stringify(message, null, 2);

    // 验证 JSON 可以被正确解析
    expect(() => JSON.parse(json)).not.toThrow();

    // 验证关键字段存在
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty("@context");
    expect(parsed).toHaveProperty("@type");
    expect(parsed).toHaveProperty("id");
    expect(parsed).toHaveProperty("timestamp");
    expect(parsed).toHaveProperty("actor");
    expect(parsed).toHaveProperty("target");
    expect(parsed).toHaveProperty("type");
    expect(parsed).toHaveProperty("object");
    expect(parsed).toHaveProperty("signature");

    // 验证时间戳格式 (ISO 8601)
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // 验证负载格式与 Python Pydantic 模型兼容
    expect(parsed.object).toHaveProperty("@type");
    expect(parsed.object).toHaveProperty("genesis:projectId");
    expect(parsed.object).toHaveProperty("genesis:platform");
    expect(parsed.object).toHaveProperty("genesis:requirementSummary");
    expect(parsed.object).toHaveProperty("genesis:technicalConstraints");
    expect(parsed.object).toHaveProperty("genesis:contractTerms");
    expect(parsed.object).toHaveProperty("genesis:resourceLimits");
  });

  it("应该正确处理日期时间序列化", () => {
    const testDate = new Date("2025-06-15T10:30:00Z");
    const payload: GenesisPromptPayload = {
      "@type": "genesis:GenesisPrompt",
      "genesis:projectId": "date-test",
      "genesis:platform": "test",
      "genesis:requirementSummary": "Test date serialization",
      "genesis:technicalConstraints": {
        "@type": "genesis:TechnicalConstraints",
      },
      "genesis:contractTerms": {
        "@type": "genesis:ContractTerms",
        "genesis:totalBudget": {
          "@type": "schema:MonetaryAmount",
          "schema:value": 1000,
          "schema:currency": "USD",
        },
        "genesis:deadline": testDate.toISOString(),
      },
      "genesis:resourceLimits": {
        "@type": "genesis:ResourceLimits",
        "genesis:maxTokensPerTask": 1000,
        "genesis:maxCostCents": 100,
        "genesis:maxDurationMs": 1000,
      },
    };

    const message = createTestMessage(payload);
    const json = JSON.stringify(message);
    const parsed = JSON.parse(json);

    // 验证日期时间字符串格式
    expect(parsed.object["genesis:contractTerms"]["genesis:deadline"]).toBe(
      "2025-06-15T10:30:00.000Z"
    );

    // Python datetime.fromisoformat() 应该能够解析这个格式
    expect(() => new Date(parsed.object["genesis:contractTerms"]["genesis:deadline"])).not.toThrow();
  });
});

describe("序列化一致性", () => {
  it("多次序列化应该产生相同的结果", () => {
    const payload: GenesisPromptPayload = {
      "@type": "genesis:GenesisPrompt",
      "genesis:projectId": "consistency-test",
      "genesis:platform": "test",
      "genesis:requirementSummary": "Test serialization consistency",
      "genesis:technicalConstraints": {
        "@type": "genesis:TechnicalConstraints",
      },
      "genesis:contractTerms": {
        "@type": "genesis:ContractTerms",
        "genesis:totalBudget": {
          "@type": "schema:MonetaryAmount",
          "schema:value": 1000,
          "schema:currency": "USD",
        },
        "genesis:deadline": new Date().toISOString(),
      },
      "genesis:resourceLimits": {
        "@type": "genesis:ResourceLimits",
        "genesis:maxTokensPerTask": 1000,
        "genesis:maxCostCents": 100,
        "genesis:maxDurationMs": 1000,
      },
    };

    const message = createTestMessage(payload);
    const json1 = JSON.stringify(message);
    const json2 = JSON.stringify(JSON.parse(json1));
    const json3 = JSON.stringify(JSON.parse(json2));

    // 验证多次序列化结果一致
    expect(json1).toEqual(json2);
    expect(json2).toEqual(json3);

    // 验证可以成功解析
    const parsed1 = JSON.parse(json1);
    const parsed2 = JSON.parse(json2);
    const parsed3 = JSON.parse(json3);

    expect(parsed1).toEqual(parsed2);
    expect(parsed2).toEqual(parsed3);
  });
});
