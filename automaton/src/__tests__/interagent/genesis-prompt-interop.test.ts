/**
 * @jest-environment node
 *
 * Genesis Prompt 类型互操作性测试
 * 验证 TypeScript 和 Python 端的 JSON 序列化一致性
 */

import { describe, it, expect } from "vitest";
import {
  createGenesisPrompt,
  serializeGenesisPrompt,
  deserializeGenesisPrompt,
  validateGenesisPrompt,
  type GenesisPrompt,
} from "../../interagent/genesis-prompt.js";

describe("Genesis Prompt Interoperability", () => {
  describe("JSON Serialization", () => {
    it("should use camelCase for field names", () => {
      const prompt: GenesisPrompt = {
        version: "1.0.0",
        id: "test-prompt-001",
        taskType: "genesis",
        priority: "normal",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:main",
        createdAt: new Date(),
        input: {
          description: "测试任务",
        },
        requireConfirmation: false,
        timeoutMs: 30000,
        tags: ["test", "interop"],
      };

      const json = serializeGenesisPrompt(prompt);
      const parsed = JSON.parse(json);

      // 验证使用 camelCase
      expect(parsed.taskType).toBe("genesis");
      expect(parsed.sourceDid).toBe("did:anp:automaton:main");
      expect(parsed.targetDid).toBe("did:anp:nanobot:main");
      expect(parsed.createdAt).toBeDefined();
      expect(parsed.requireConfirmation).toBe(false);
      expect(parsed.timeoutMs).toBe(30000);
      expect(parsed.tags).toEqual(["test", "interop"]);

      // 验证不使用 snake_case
      expect(parsed.task_type).toBeUndefined();
      expect(parsed.source_did).toBeUndefined();
      expect(parsed.target_did).toBeUndefined();
      expect(parsed.created_at).toBeUndefined();
      expect(parsed.require_confirmation).toBeUndefined();
      expect(parsed.timeout_ms).toBeUndefined();
    });

    it("should serialize datetime in ISO 8601 format", () => {
      const prompt = createGenesisPrompt({
        id: "test-prompt-002",
        taskType: "analysis",
        priority: "high",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:main",
        description: "分析任务",
      });

      const json = serializeGenesisPrompt(prompt);
      const parsed = JSON.parse(json);

      // 验证时间序列化为 ISO 8601 格式
      expect(parsed.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("should handle complex input data", () => {
      const prompt: GenesisPrompt = {
        version: "1.0.0",
        id: "test-prompt-003",
        taskType: "execution",
        priority: "critical",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:main",
        createdAt: new Date(),
        input: {
          description: "执行任务",
          specification: "详细规格说明",
          data: { key1: "value1", key2: 123 },
          files: ["file1.txt", "file2.py"],
          environment: { ENV: "test", DEBUG: "false" },
          dependencies: ["dep1", "dep2"],
        },
      };

      const json = serializeGenesisPrompt(prompt);
      const parsed = JSON.parse(json);

      // 验证输入字段正确序列化
      expect(parsed.input.description).toBe("执行任务");
      expect(parsed.input.specification).toBe("详细规格说明");
      expect(parsed.input.data).toEqual({ key1: "value1", key2: 123 });
      expect(parsed.input.files).toEqual(["file1.txt", "file2.py"]);
      expect(parsed.input.environment).toEqual({ ENV: "test", DEBUG: "false" });
      expect(parsed.input.dependencies).toEqual(["dep1", "dep2"]);
    });
  });

  describe("Deserialization", () => {
    it("should deserialize from camelCase JSON", () => {
      const jsonData = {
        version: "1.0.0",
        id: "test-prompt-004",
        taskType: "report" as const,
        priority: "low" as const,
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:main",
        createdAt: "2026-02-27T14:30:45.000Z",
        input: {
          description: "报告任务",
        },
        requireConfirmation: true,
        timeoutMs: 60000,
      };

      const prompt = deserializeGenesisPrompt(JSON.stringify(jsonData));

      expect(prompt.id).toBe("test-prompt-004");
      expect(prompt.taskType).toBe("report");
      expect(prompt.priority).toBe("low");
      expect(prompt.sourceDid).toBe("did:anp:automaton:main");
      expect(prompt.targetDid).toBe("did:anp:nanobot:main");
      expect(prompt.requireConfirmation).toBe(true);
      expect(prompt.timeoutMs).toBe(60000);
      expect(prompt.createdAt instanceof Date).toBe(true);
    });

    it("should handle round-trip serialization", () => {
      const original = createGenesisPrompt({
        id: "test-prompt-005",
        taskType: "maintenance",
        priority: "normal",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:main",
        description: "维护任务",
        requireConfirmation: false,
        timeoutMs: 30000,
        tags: ["roundtrip", "test"],
      });

      // 序列化
      const json = serializeGenesisPrompt(original);

      // 反序列化
      const restored = deserializeGenesisPrompt(json);

      // 验证关键字段保持一致
      expect(restored.id).toBe(original.id);
      expect(restored.taskType).toBe(original.taskType);
      expect(restored.priority).toBe(original.priority);
      expect(restored.sourceDid).toBe(original.sourceDid);
      expect(restored.targetDid).toBe(original.targetDid);
      expect(restored.requireConfirmation).toBe(original.requireConfirmation);
      expect(restored.timeoutMs).toBe(original.timeoutMs);
      expect(restored.tags).toEqual(original.tags);
    });
  });

  describe("Validation", () => {
    it("should validate required camelCase fields", () => {
      const invalidPrompt = {
        version: "1.0.0",
        id: "test-prompt-006",
        // 缺少 taskType (camelCase)
        task_type: "genesis", // snake_case - 应该被拒绝
        priority: "normal",
        // 缺少 sourceDid 和 targetDid
        source_did: "did:anp:automaton:main",
        target_did: "did:anp:nanobot:main",
        createdAt: new Date(),
        input: {
          description: "测试",
        },
      };

      const errors = validateGenesisPrompt(invalidPrompt);

      // 应该有验证错误
      expect(errors.length).toBeGreaterThan(0);

      // 验证缺少的 camelCase 字段
      const missingFields = errors.map(e => e.field);
      expect(missingFields).toContain("taskType");
      expect(missingFields).toContain("sourceDid");
      expect(missingFields).toContain("targetDid");
    });

    it("should accept valid camelCase prompt", () => {
      const validPrompt: GenesisPrompt = {
        version: "1.0.0",
        id: "test-prompt-007",
        taskType: "exploration",
        priority: "normal",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:main",
        createdAt: new Date(),
        input: {
          description: "探索任务",
        },
        requireConfirmation: false,
        timeoutMs: 30000,
      };

      const errors = validateGenesisPrompt(validPrompt);

      // 应该没有验证错误
      expect(errors.length).toBe(0);
    });
  });

  describe("Cross-System Compatibility", () => {
    it("should match Python JSON format", () => {
      // 这个测试确保TypeScript序列化的JSON格式与Python端一致
      const prompt: GenesisPrompt = {
        version: "1.0.0",
        id: "test-prompt-008",
        taskType: "custom",
        priority: "background",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:main",
        createdAt: new Date(),
        input: {
          description: "自定义任务",
        },
        requireConfirmation: false,
        timeoutMs: 30000,
        tags: ["cross-system", "test"],
      };

      const json = serializeGenesisPrompt(prompt);
      const parsed = JSON.parse(json);

      // 验证关键字段使用 camelCase（与Python端一致）
      expect(parsed).toHaveProperty("taskType");
      expect(parsed).toHaveProperty("sourceDid");
      expect(parsed).toHaveProperty("targetDid");
      expect(parsed).toHaveProperty("createdAt");
      expect(parsed).toHaveProperty("requireConfirmation");
      expect(parsed).toHaveProperty("timeoutMs");

      // 验证值类型正确
      expect(typeof parsed.taskType).toBe("string");
      expect(typeof parsed.sourceDid).toBe("string");
      expect(typeof parsed.targetDid).toBe("string");
      expect(typeof parsed.createdAt).toBe("string");
      expect(typeof parsed.requireConfirmation).toBe("boolean");
    });

    it("should deserialize JSON from Python", () => {
      // 模拟Python端生成的JSON
      const pythonJson = JSON.stringify({
        version: "1.0.0",
        id: "test-prompt-009",
        taskType: "genesis",
        priority: "high",
        sourceDid: "did:anp:automaton:main",
        targetDid: "did:anp:nanobot:main",
        createdAt: "2026-02-27T12:00:00",
        input: {
          description: "从Python发送的任务",
        },
        requireConfirmation: true,
        timeoutMs: 60000,
        tags: ["python-to-typescript"],
      });

      // TypeScript应该能够正确解析
      const prompt = deserializeGenesisPrompt(pythonJson);

      expect(prompt.taskType).toBe("genesis");
      expect(prompt.priority).toBe("high");
      expect(prompt.sourceDid).toBe("did:anp:automaton:main");
      expect(prompt.targetDid).toBe("did:anp:nanobot:main");
      expect(prompt.requireConfirmation).toBe(true);
      expect(prompt.timeoutMs).toBe(60000);
      expect(prompt.tags).toEqual(["python-to-typescript"]);
    });
  });
});
