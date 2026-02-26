/**
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import {
  createGenesisPrompt,
  createAcceptanceResponse,
  createRejectionResponse,
  createDeferralResponse,
  createSuccessResult,
  createFailureResult,
  validateGenesisPrompt,
  isValidGenesisPrompt,
  serializeGenesisPrompt,
  deserializeGenesisPrompt,
  formatPriority,
  formatTaskType,
  estimateComplexity,
  getPriorityValue,
  type GenesisPrompt,
  type GenesisTaskType,
  type GenesisPriority,
} from "../../interagent/genesis-prompt.js";

describe("createGenesisPrompt", () => {
  it("should create a valid genesis prompt", () => {
    const prompt = createGenesisPrompt({
      id: "task-1",
      taskType: "genesis",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:worker1",
      description: "Create a new feature",
    });

    expect(prompt.id).toBe("task-1");
    expect(prompt.taskType).toBe("genesis");
    expect(prompt.version).toBe("1.0.0");
    expect(prompt.priority).toBe("normal");
    expect(prompt.sourceDid).toBe("did:anp:automaton:main");
    expect(prompt.targetDid).toBe("did:anp:nanobot:worker1");
    expect(prompt.input.description).toBe("Create a new feature");
    expect(prompt.createdAt).toBeInstanceOf(Date);
  });

  it("should include all options", () => {
    const prompt = createGenesisPrompt({
      id: "task-2",
      taskType: "analysis",
      priority: "high",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:worker1",
      description: "Analyze code",
      specification: "Detailed specs",
      technical: {
        allowedLanguages: ["typescript", "python"],
        testCoverage: { minimum: 80, enforce: true },
      },
      business: {
        budget: { total: 100, currency: "USD" },
        quality: { level: "premium" },
      },
    });

    expect(prompt.priority).toBe("high");
    expect(prompt.input.specification).toBe("Detailed specs");
    expect(prompt.technical?.allowedLanguages).toContain("typescript");
    expect(prompt.business?.budget?.total).toBe(100);
  });
});

describe("Response Factories", () => {
  const promptId = "test-prompt";

  describe("createAcceptanceResponse", () => {
    it("should create acceptance response", () => {
      const response = createAcceptanceResponse(promptId);

      expect(response.promptId).toBe(promptId);
      expect(response.status).toBe("accepted");
      expect(response.respondedAt).toBeInstanceOf(Date);
      expect(response.acceptance).toBeDefined();
    });

    it("should include options", () => {
      const estimatedStartTime = new Date();
      const estimatedCompletionTime = new Date(Date.now() + 3600000);

      const response = createAcceptanceResponse(promptId, {
        estimatedStartTime,
        estimatedCompletionTime,
        allocatedResources: ["cpu-1", "memory-2gb"],
      });

      expect(response.acceptance?.estimatedStartTime).toEqual(estimatedStartTime);
      expect(response.acceptance?.estimatedCompletionTime).toEqual(estimatedCompletionTime);
      expect(response.acceptance?.allocatedResources).toContain("cpu-1");
    });
  });

  describe("createRejectionResponse", () => {
    it("should create rejection response", () => {
      const response = createRejectionResponse(promptId, "Not enough resources");

      expect(response.promptId).toBe(promptId);
      expect(response.status).toBe("rejected");
      expect(response.rejection?.reason).toBe("Not enough resources");
    });

    it("should include options", () => {
      const response = createRejectionResponse(promptId, "Invalid task", {
        code: "INVALID_TASK",
        suggestions: ["Try a different approach"],
      });

      expect(response.rejection?.code).toBe("INVALID_TASK");
      expect(response.rejection?.suggestions).toContain("Try a different approach");
    });
  });

  describe("createDeferralResponse", () => {
    it("should create deferral response", () => {
      const response = createDeferralResponse(promptId, "Busy now");

      expect(response.promptId).toBe(promptId);
      expect(response.status).toBe("deferred");
      expect(response.deferral?.reason).toBe("Busy now");
    });

    it("should include suggested time", () => {
      const suggestedTime = new Date(Date.now() + 3600000);
      const response = createDeferralResponse(promptId, "Busy now", suggestedTime);

      expect(response.deferral?.suggestedTime).toEqual(suggestedTime);
    });
  });
});

describe("Result Factories", () => {
  const promptId = "test-prompt";

  describe("createSuccessResult", () => {
    it("should create success result", () => {
      const result = createSuccessResult(promptId, {
        data: { value: 42 },
        summary: "Task completed",
      });

      expect(result.promptId).toBe(promptId);
      expect(result.status).toBe("success");
      expect(result.output?.data).toEqual({ value: 42 });
      expect(result.output?.summary).toBe("Task completed");
    });

    it("should include metrics", () => {
      const result = createSuccessResult(
        promptId,
        { summary: "Done" },
        { tokensUsed: 1000, apiCalls: 5 }
      );

      expect(result.metrics?.tokensUsed).toBe(1000);
      expect(result.metrics?.apiCalls).toBe(5);
    });
  });

  describe("createFailureResult", () => {
    it("should create failure result", () => {
      const result = createFailureResult(promptId, {
        message: "Something went wrong",
      });

      expect(result.promptId).toBe(promptId);
      expect(result.status).toBe("failed");
      expect(result.error?.message).toBe("Something went wrong");
      expect(result.error?.recoverable).toBe(false);
    });

    it("should include all error details", () => {
      const result = createFailureResult(
        promptId,
        {
          message: "API error",
          code: "API_ERROR",
          phase: "execution",
          recoverable: true,
        },
        5000
      );

      expect(result.error?.code).toBe("API_ERROR");
      expect(result.error?.phase).toBe("execution");
      expect(result.error?.recoverable).toBe(true);
      expect(result.durationMs).toBe(5000);
    });
  });
});

describe("validateGenesisPrompt", () => {
  it("should validate valid prompt", () => {
    const prompt = createGenesisPrompt({
      id: "task-1",
      taskType: "genesis",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:worker1",
      description: "Test task",
    });

    const errors = validateGenesisPrompt(prompt);
    expect(errors).toHaveLength(0);
  });

  it("should return errors for missing fields", () => {
    const errors = validateGenesisPrompt({});

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.field === "id")).toBeDefined();
    expect(errors.find((e) => e.field === "taskType")).toBeDefined();
    expect(errors.find((e) => e.field === "sourceDid")).toBeDefined();
  });

  it("should validate DID format", () => {
    const prompt = createGenesisPrompt({
      id: "task-1",
      taskType: "genesis",
      sourceDid: "invalid-did",
      targetDid: "did:anp:nanobot:worker1",
      description: "Test",
    });

    const errors = validateGenesisPrompt(prompt);
    expect(errors.find((e) => e.field === "sourceDid")).toBeDefined();
  });

  it("should validate task type", () => {
    const prompt = {
      version: "1.0.0",
      id: "task-1",
      taskType: "invalid_type",
      priority: "normal",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:worker1",
      createdAt: new Date(),
      input: { description: "Test" },
    };

    const errors = validateGenesisPrompt(prompt);
    expect(errors.find((e) => e.field === "taskType")).toBeDefined();
  });

  it("should validate priority", () => {
    const prompt = {
      version: "1.0.0",
      id: "task-1",
      taskType: "genesis",
      priority: "invalid",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:worker1",
      createdAt: new Date(),
      input: { description: "Test" },
    };

    const errors = validateGenesisPrompt(prompt);
    expect(errors.find((e) => e.field === "priority")).toBeDefined();
  });

  it("should validate budget", () => {
    const prompt = createGenesisPrompt({
      id: "task-1",
      taskType: "genesis",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:worker1",
      description: "Test",
      business: { budget: { total: -100 } },
    });

    const errors = validateGenesisPrompt(prompt);
    expect(errors.find((e) => e.field === "business.budget.total")).toBeDefined();
  });

  it("should validate timeout", () => {
    const prompt = createGenesisPrompt({
      id: "task-1",
      taskType: "genesis",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:worker1",
      description: "Test",
    });
    (prompt as any).timeoutMs = -100;

    const errors = validateGenesisPrompt(prompt);
    expect(errors.find((e) => e.field === "timeoutMs")).toBeDefined();
  });

  it("should validate test coverage", () => {
    const prompt = createGenesisPrompt({
      id: "task-1",
      taskType: "genesis",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:worker1",
      description: "Test",
      technical: { testCoverage: { minimum: 150 } },
    });

    const errors = validateGenesisPrompt(prompt);
    expect(errors.find((e) => e.field === "technical.testCoverage.minimum")).toBeDefined();
  });

  it("should validate input description", () => {
    const prompt = createGenesisPrompt({
      id: "task-1",
      taskType: "genesis",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:worker1",
      description: "Test",
    });
    prompt.input.description = "";

    const errors = validateGenesisPrompt(prompt);
    expect(errors.find((e) => e.field === "input.description")).toBeDefined();
  });
});

describe("isValidGenesisPrompt", () => {
  it("should return true for valid prompt", () => {
    const prompt = createGenesisPrompt({
      id: "task-1",
      taskType: "genesis",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:worker1",
      description: "Test",
    });

    expect(isValidGenesisPrompt(prompt)).toBe(true);
  });

  it("should return false for invalid prompt", () => {
    expect(isValidGenesisPrompt(null)).toBe(false);
    expect(isValidGenesisPrompt({})).toBe(false);
  });
});

describe("Serialization", () => {
  it("should serialize and deserialize prompt", () => {
    const original = createGenesisPrompt({
      id: "task-1",
      taskType: "genesis",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:worker1",
      description: "Test task",
    });

    const json = serializeGenesisPrompt(original);
    const deserialized = deserializeGenesisPrompt(json);

    expect(deserialized.id).toBe(original.id);
    expect(deserialized.taskType).toBe(original.taskType);
    expect(deserialized.createdAt).toBeInstanceOf(Date);
  });
});

describe("formatPriority", () => {
  it("should format priorities in Chinese", () => {
    expect(formatPriority("critical")).toBe("紧急");
    expect(formatPriority("high")).toBe("高");
    expect(formatPriority("normal")).toBe("普通");
    expect(formatPriority("low")).toBe("低");
    expect(formatPriority("background")).toBe("后台");
  });
});

describe("formatTaskType", () => {
  it("should format task types in Chinese", () => {
    expect(formatTaskType("genesis")).toBe("创世");
    expect(formatTaskType("analysis")).toBe("分析");
    expect(formatTaskType("execution")).toBe("执行");
    expect(formatTaskType("report")).toBe("报告");
    expect(formatTaskType("maintenance")).toBe("维护");
    expect(formatTaskType("exploration")).toBe("探索");
    expect(formatTaskType("custom")).toBe("自定义");
  });
});

describe("estimateComplexity", () => {
  it("should return simple for basic tasks", () => {
    const prompt = createGenesisPrompt({
      id: "task-1",
      taskType: "report",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:worker1",
      description: "Simple report",
    });

    expect(estimateComplexity(prompt)).toBe("simple");
  });

  it("should return complex for constrained tasks", () => {
    const prompt = createGenesisPrompt({
      id: "task-2",
      taskType: "genesis",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:worker1",
      description: "Complex feature",
      technical: {
        forbiddenLibraries: ["lib1", "lib2"],
        requiredLibraries: ["lib3", "lib4"],
        testCoverage: { minimum: 90, enforce: true },
        security: { noNetworkAccess: true },
      },
      business: {
        quality: { requireCodeReview: true, requireSecurityReview: true },
        delivery: { documentation: "comprehensive" },
      },
    });

    const complexity = estimateComplexity(prompt);
    expect(["complex", "very_complex"]).toContain(complexity);
  });

  it("should increase complexity for many output files", () => {
    const prompt = createGenesisPrompt({
      id: "task-3",
      taskType: "genesis",
      sourceDid: "did:anp:automaton:main",
      targetDid: "did:anp:nanobot:worker1",
      description: "Multi-file output",
    });
    prompt.outputExpectation = {
      type: "code",
      files: [
        { path: "file1.ts", type: "typescript", required: true },
        { path: "file2.ts", type: "typescript", required: true },
        { path: "file3.ts", type: "typescript", required: true },
        { path: "file4.ts", type: "typescript", required: true },
      ],
    };

    const complexity = estimateComplexity(prompt);
    expect(["medium", "complex", "very_complex"]).toContain(complexity);
  });
});

describe("getPriorityValue", () => {
  it("should return correct numeric values", () => {
    expect(getPriorityValue("critical")).toBe(5);
    expect(getPriorityValue("high")).toBe(4);
    expect(getPriorityValue("normal")).toBe(3);
    expect(getPriorityValue("low")).toBe(2);
    expect(getPriorityValue("background")).toBe(1);
  });

  it("should allow sorting by priority", () => {
    const priorities: GenesisPriority[] = ["low", "critical", "normal", "high"];
    const sorted = [...priorities].sort(
      (a, b) => getPriorityValue(b) - getPriorityValue(a)
    );

    expect(sorted).toEqual(["critical", "high", "normal", "low"]);
  });
});
