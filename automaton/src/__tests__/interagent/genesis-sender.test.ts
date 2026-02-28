/**
 * Genesis Prompt ANP 发送器测试
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  GenesisPromptSender,
  createGenesisPromptSender,
  type GenesisPromptSenderConfig,
} from "../../interagent/genesis/GenesisPromptSender.js";
import {
  createGenesisPrompt,
  type GenesisPrompt,
} from "../../interagent/genesis-prompt.js";
import * as crypto from "crypto";

// Mock fetch
global.fetch = vi.fn();

// Mock KeyObject for testing
const mockKeyObject = {} as crypto.KeyObject;

// Mock importPrivateKey to return mock KeyObject
vi.mock("../../anp/did.js", () => ({
  importPrivateKey: vi.fn(() => mockKeyObject),
}));

// Mock signPayload to avoid real crypto operations with mock keys
vi.mock("../../anp/signature.js", () => ({
  signPayload: vi.fn(() => ({
    type: "EcdsaSecp256r1Signature2019",
    created: new Date().toISOString(),
    verificationMethod: "did:anp:automaton:main#key-1",
    proofPurpose: "authentication",
    proofValue: "mock-signature-base64",
  })),
}));

describe("GenesisPromptSender", () => {
  let sender: GenesisPromptSender;
  let config: GenesisPromptSenderConfig;

  beforeEach(() => {
    config = {
      did: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:worker1",
      privateKey: "mock-private-key",
      serviceEndpoint: "http://localhost:8080/anp",
      defaultTtl: 3600,
    };

    sender = new GenesisPromptSender(config);

    vi.clearAllMocks();
  });

  describe("构造函数", () => {
    it("应该使用默认 DID", () => {
      const configWithoutDid = {
        privateKey: "mock-key",
        targetDid: "did:anp:nanobot:worker1",
        serviceEndpoint: "http://localhost:8080/anp",
      };
      const sender2 = new GenesisPromptSender(configWithoutDid);
      expect(sender2).toBeDefined();
    });

    it("应该正确设置配置", () => {
      expect(sender).toBeDefined();
    });
  });

  describe("convertToANPPayload", () => {
    it("应该转换基本的 Genesis Prompt", async () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create a feature",
      });

      const message = await (sender as any).buildANPMessage(prompt);

      expect(message).toBeDefined();
      expect(message["@type"]).toBe("ANPMessage");
      expect(message.type).toBe("TaskCreate");
      expect(message.actor).toBe("did:anp:automaton:main");
      expect(message.target).toBe("did:anp:nanobot:worker1");
    });

    it("应该包含 Genesis Prompt 负载", async () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create a feature",
      });

      const message = await (sender as any).buildANPMessage(prompt);

      expect(message.object).toBeDefined();
      expect(message.object["@type"]).toBe("genesis:GenesisPrompt");
      expect(message.object["genesis:projectId"]).toBe("task-1");
      expect(message.object["genesis:requirementSummary"]).toBe("Create a feature");
    });

    it("应该转换技术约束", async () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create a feature",
        technical: {
          allowedLanguages: ["typescript", "python"],
          forbiddenLibraries: ["jquery"],
        },
      });

      const message = await (sender as any).buildANPMessage(prompt);

      expect(message.object["genesis:technicalConstraints"]).toBeDefined();
      expect(
        message.object["genesis:technicalConstraints"]["genesis:requiredStack"]
      ).toEqual(["typescript", "python"]);
      expect(
        message.object["genesis:technicalConstraints"]["genesis:prohibitedStack"]
      ).toEqual(["jquery"]);
    });

    it("应该转换商务条款", async () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create a feature",
        business: {
          budget: {
            total: 1000,
            currency: "USD",
          },
          timeline: {
            deadline: new Date("2026-03-01"),
          },
        },
      });

      const message = await (sender as any).buildANPMessage(prompt);

      expect(message.object["genesis:contractTerms"]).toBeDefined();
      expect(
        message.object["genesis:contractTerms"]["genesis:totalBudget"]["schema:value"]
      ).toBe(1000);
      expect(
        message.object["genesis:contractTerms"]["genesis:totalBudget"]["schema:currency"]
      ).toBe("USD");
    });

    it("应该映射优先级", async () => {
      const highPrompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        priority: "high",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create a feature",
      });

      const highMessage = await (sender as any).buildANPMessage(highPrompt);

      expect(
        highMessage.object["genesis:specialInstructions"]["genesis:priorityLevel"]
      ).toBe("high");

      const lowPrompt = createGenesisPrompt({
        id: "task-2",
        taskType: "genesis",
        priority: "low",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create a feature",
      });

      const lowMessage = await (sender as any).buildANPMessage(lowPrompt);

      expect(
        lowMessage.object["genesis:specialInstructions"]["genesis:priorityLevel"]
      ).toBe("low");
    });
  });

  describe("send", () => {
    it("应该成功发送消息", async () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create a feature",
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "resp-1",
          status: "accepted",
          respondedAt: new Date().toISOString(),
          acceptance: {
            estimatedStartTime: new Date().toISOString(),
            estimatedCompletionTime: new Date(Date.now() + 3600000).toISOString(),
          },
        }),
      });

      const result = await sender.send(prompt);

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(result.response).toBeDefined();
      expect(result.response?.status).toBe("accepted");
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8080/anp",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("应该处理发送失败", async () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create a feature",
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const result = await sender.send(prompt);

      expect(result.success).toBe(false);
      expect(result.error).toContain("500");
    });

    it("应该处理网络错误", async () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create a feature",
      });

      (global.fetch as any).mockRejectedValueOnce(new Error("Network error"));

      const result = await sender.send(prompt);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });
  });

  describe("sendBatch", () => {
    it("应该批量发送消息", async () => {
      const prompts = [
        createGenesisPrompt({
          id: "task-1",
          taskType: "genesis",
          sourceDid: "did:anp:automaton:main",
          targetDid: "did:anp:nanobot:worker1",
          description: "Feature 1",
        }),
        createGenesisPrompt({
          id: "task-2",
          taskType: "genesis",
          sourceDid: "did:anp:automaton:main",
          targetDid: "did:anp:nanobot:worker1",
          description: "Feature 2",
        }),
      ];

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: "resp-1",
            status: "accepted",
            respondedAt: new Date().toISOString(),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: "resp-2",
            status: "accepted",
            respondedAt: new Date().toISOString(),
          }),
        });

      const results = await sender.sendBatch(prompts);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });
  });

  describe("validateMessage", () => {
    it("应该验证有效的消息", () => {
      const validMessage = {
        "@context": ["https://w3id.org/anp/v1"],
        "@type": "ANPMessage",
        id: "msg-1",
        timestamp: "2026-02-27T00:00:00.000Z",
        actor: "did:anp:automaton:main",
        target: "did:anp:nanobot:worker1",
        type: "TaskCreate",
        object: {
          "@type": "genesis:GenesisPrompt",
        },
        signature: {
          type: "EcdsaSecp256r1Signature2019",
          created: "2026-02-27T00:00:00.000Z",
          verificationMethod: "did:anp:automaton:main#key-1",
          proofPurpose: "authentication",
          proofValue: "signature",
        },
      };

      const isValid = (sender as any).validateMessage(validMessage);
      expect(isValid).toBe(true);
    });

    it("应该拒绝无效的消息", () => {
      const invalidMessage = {
        "@type": "ANPMessage",
        id: "msg-1",
      };

      const isValid = (sender as any).validateMessage(invalidMessage);
      expect(isValid).toBe(false);
    });

    it("应该拒绝错误的负载类型", () => {
      const invalidPayloadMessage = {
        "@context": ["https://w3id.org/anp/v1"],
        "@type": "ANPMessage",
        id: "msg-1",
        timestamp: "2026-02-27T00:00:00.000Z",
        actor: "did:anp:automaton:main",
        target: "did:anp:nanobot:worker1",
        type: "TaskCreate",
        object: {
          "@type": "wrong:type",
        },
        signature: {},
      };

      const isValid = (sender as any).validateMessage(invalidPayloadMessage);
      expect(isValid).toBe(false);
    });
  });

  describe("工厂函数", () => {
    it("应该创建发送器实例", () => {
      const sender2 = createGenesisPromptSender(config);

      expect(sender2).toBeInstanceOf(GenesisPromptSender);
    });
  });

  describe("资源限制转换", () => {
    it("应该使用 timeoutMs 作为最大持续时间", async () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create a feature",
        timeoutMs: 7200000, // 2 hours
      });

      const message = await (sender as any).buildANPMessage(prompt);

      expect(message.object["genesis:resourceLimits"]["genesis:maxDurationMs"]).toBe(7200000);
    });

    it("应该使用默认值当 timeoutMs 未设置", async () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create a feature",
      });

      const message = await (sender as any).buildANPMessage(prompt);

      expect(message.object["genesis:resourceLimits"]["genesis:maxDurationMs"]).toBe(86400000);
    });
  });

  describe("特殊指令转换", () => {
    it("应该包含 requireConfirmation", async () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create a feature",
        requireConfirmation: true,
      });

      const message = await (sender as any).buildANPMessage(prompt);

      expect(message.object["genesis:specialInstructions"]).toBeDefined();
      expect(
        message.object["genesis:specialInstructions"]["genesis:humanReviewRequired"]
      ).toBe(true);
    });

    it("应该包含标签作为风险标志", async () => {
      const prompt = createGenesisPrompt({
        id: "task-1",
        taskType: "genesis",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:worker1",
        description: "Create a feature",
        tags: ["high-risk", "experimental"],
      });

      const message = await (sender as any).buildANPMessage(prompt);

      expect(message.object["genesis:specialInstructions"]).toBeDefined();
      expect(message.object["genesis:specialInstructions"]["genesis:riskFlags"]).toEqual([
        "high-risk",
        "experimental",
      ]);
    });
  });
});
