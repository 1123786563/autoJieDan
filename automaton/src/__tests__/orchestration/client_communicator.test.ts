/**
 * Tests for ClientCommunicator
 * @module __tests__/orchestration/client_communicator
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ClientCommunicator, type UpworkProject, type GeneratedBid, type ProjectContext } from "../../orchestration/client_communicator.js";
import { UnifiedInferenceClient } from "../../inference/inference-client.js";

// Mock the inference client
vi.mock("../../src/inference/inference-client.js");

describe("ClientCommunicator", () => {
  let communicator: ClientCommunicator;
  let mockInferenceClient: UnifiedInferenceClient;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Create mock inference client
    mockInferenceClient = {
      chat: vi.fn().mockResolvedValue({
        content: "This is a generated response",
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        cost: {
          inputCostCredits: 0.001,
          outputCostCredits: 0.002,
          totalCostCredits: 0.003,
        },
        metadata: {
          providerId: "test-provider",
          modelId: "test-model",
          tier: "smart",
          latencyMs: 100,
          retries: 0,
          failedProviders: [],
        },
      }),
    } as unknown as UnifiedInferenceClient;

    communicator = new ClientCommunicator(mockInferenceClient, {
      enableCache: false, // Disable cache for tests
    });
  });

  describe("generateProposal", () => {
    it("should generate a proposal for a project", async () => {
      const project: UpworkProject = {
        id: "test-project-123",
        title: "Python Developer Needed",
        description: "Need a Python developer for API work with FastAPI and PostgreSQL.",
        budget: {
          type: "fixed",
          min_amount: 500,
          max_amount: 1000,
          currency: "USD",
        },
        skills: ["python", "fastapi", "postgresql"],
        category: "Web Development",
        url: "https://upwork.com/jobs/test-project-123",
        job_type: "fixed",
      };

      const bid: GeneratedBid = {
        project_id: "test-project-123",
        cover_letter: "I am interested in this project",
        bid_amount: 800,
        duration_days: 14,
        match_score: 0.8,
        matched_skills: ["python", "fastapi"],
      };

      const proposal = await communicator.generateProposal(project, bid);

      expect(proposal).toBeDefined();
      expect(typeof proposal).toBe("string");
      expect(mockInferenceClient.chat).toHaveBeenCalled();
    });

    it("should include project title in proposal", async () => {
      const project: UpworkProject = {
        id: "test-project-456",
        title: "React Frontend Developer",
        description: "Looking for a React developer to build a modern UI.",
        budget: {
          type: "hourly",
          min_amount: 30,
          max_amount: 50,
          currency: "USD",
        },
        skills: ["react", "typescript", "tailwind"],
        category: "Web Development",
        url: "https://upwork.com/jobs/test-project-456",
        job_type: "hourly",
      };

      const bid: GeneratedBid = {
        project_id: "test-project-456",
        cover_letter: "Experienced React developer here",
        bid_amount: 40,
      };

      const proposal = await communicator.generateProposal(project, bid);

      expect(proposal).toContain("React Frontend Developer");
    });

    it("should use emphasized skills when provided", async () => {
      const project: UpworkProject = {
        id: "test-project-789",
        title: "Full Stack Developer",
        description: "Need full stack development help.",
        budget: null,
        skills: ["javascript", "python", "sql"],
        category: "Web Development",
        url: "https://upwork.com/jobs/test-project-789",
        job_type: "fixed",
      };

      const bid: GeneratedBid = {
        project_id: "test-project-789",
        cover_letter: "Full stack expert",
        bid_amount: 1500,
      };

      const proposal = await communicator.generateProposal(project, bid, {
        emphasizeSkills: ["python", "sql"],
      });

      expect(proposal).toBeDefined();
      expect(mockInferenceClient.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              content: expect.stringContaining("python"),
            }),
          ]),
        })
      );
    });

    it("should include questions when provided", async () => {
      const project: UpworkProject = {
        id: "test-project-101",
        title: "API Integration Project",
        description: "Need to integrate with third-party APIs.",
        budget: {
          type: "fixed",
          min_amount: 500,
          max_amount: 1000,
        },
        skills: ["api", "integration"],
        category: "Web Development",
        url: "https://upwork.com/jobs/test-project-101",
        job_type: "fixed",
      };

      const bid: GeneratedBid = {
        project_id: "test-project-101",
        cover_letter: "API expert",
        bid_amount: 750,
      };

      const questions = ["What is the expected timeline?", "Do you have API documentation?"];

      await communicator.generateProposal(project, bid, {
        questions,
      });

      expect(mockInferenceClient.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              content: expect.stringContaining("Questions to Ask"),
            }),
          ]),
        })
      );
    });
  });

  describe("generateCoverLetter", () => {
    it("should generate a cover letter for a project", async () => {
      const project: UpworkProject = {
        id: "test-project-202",
        title: "Mobile App Developer",
        description: "Need a mobile app developer for iOS/Android.",
        budget: {
          type: "fixed",
          min_amount: 2000,
          max_amount: 5000,
        },
        skills: ["mobile", "ios", "android"],
        category: "Mobile Development",
        url: "https://upwork.com/jobs/test-project-202",
        job_type: "fixed",
      };

      const coverLetter = await communicator.generateCoverLetter(project);

      expect(coverLetter).toBeDefined();
      expect(typeof coverLetter).toBe("string");
      expect(mockInferenceClient.chat).toHaveBeenCalled();
    });

    it("should include subject line in cover letter", async () => {
      const project: UpworkProject = {
        id: "test-project-303",
        title: "Data Analyst Needed",
        description: "Looking for data analysis help.",
        budget: null,
        skills: ["data", "analysis"],
        category: "Data Science",
        url: "https://upwork.com/jobs/test-project-303",
        job_type: "hourly",
      };

      const coverLetter = await communicator.generateCoverLetter(project);

      expect(coverLetter).toMatch(/subject|proposal|re:/i);
    });
  });

  describe("generateResponse", () => {
    it("should generate a response to a client question", async () => {
      const question = "When can you start this project?";
      const context: ProjectContext = {
        projectId: "project-123",
        projectName: "API Development",
        projectRoot: "/home/user/projects/api-dev",
        primaryLanguage: "typescript",
        frameworks: ["express", "vitest"],
        dependencies: {
          express: "^4.18.0",
          vitest: "^1.0.0",
        },
        git: {
          branch: "main",
          commit: "abc123",
          remote: "origin",
          isClean: true,
        },
        environment: {},
        customConfig: {},
      };

      const response = await communicator.generateResponse(question, context);

      expect(response).toBeDefined();
      expect(typeof response).toBe("string");
      expect(mockInferenceClient.chat).toHaveBeenCalled();
    });

    it("should use professional tone by default", async () => {
      const question = "What is your experience with Python?";
      const context: ProjectContext = {
        projectId: "project-456",
        projectName: "Python Backend",
        projectRoot: "/home/user/projects/python-backend",
        primaryLanguage: "python",
        frameworks: ["fastapi"],
        dependencies: {},
        git: {
          branch: "main",
          commit: "def456",
          remote: "origin",
          isClean: true,
        },
        environment: {},
        customConfig: {},
      };

      await communicator.generateResponse(question, context, "professional");

      expect(mockInferenceClient.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "system",
              content: expect.stringContaining("professional"),
            }),
          ]),
        })
      );
    });

    it("should use friendly tone when specified", async () => {
      const question = "Can you work on weekends?";
      const context: ProjectContext = {
        projectId: "project-789",
        projectName: "Weekend Project",
        projectRoot: "/home/user/projects/weekend",
        primaryLanguage: "javascript",
        frameworks: [],
        dependencies: {},
        git: {
          branch: "main",
          commit: "ghi789",
          remote: "origin",
          isClean: true,
        },
        environment: {},
        customConfig: {},
      };

      await communicator.generateResponse(question, context, "friendly");

      expect(mockInferenceClient.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "system",
              content: expect.stringContaining("friendly"),
            }),
          ]),
        })
      );
    });
  });

  describe("formatMessage", () => {
    it("should format message with template variables", () => {
      const template = "Dear {{client_name}},\n\nI am interested in {{project_title}}.\n\nBest regards, {{your_name}}";
      const data = {
        client_name: "John Doe",
        project_title: "Web Development Project",
        your_name: "AI Developer",
      };

      const formatted = communicator.formatMessage(template, data);

      expect(formatted).toContain("John Doe");
      expect(formatted).toContain("Web Development Project");
      expect(formatted).toContain("AI Developer");
      expect(formatted).not.toContain("{{");
    });

    it("should handle missing variables gracefully", () => {
      const template = "Dear {{client_name}},\n\nProject: {{project_title}}";
      const data = {
        client_name: "Jane Smith",
        // project_title is missing
      };

      const formatted = communicator.formatMessage(template, data);

      expect(formatted).toContain("Jane Smith");
      expect(formatted).toContain("Project: "); // Empty string for missing variable
    });
  });

  describe("template management", () => {
    it("should register and retrieve custom templates", () => {
      const customTemplate = {
        name: "custom_proposal",
        content: "Hello {{name}}, this is a custom template.",
        variables: ["name"],
        type: "proposal" as const,
      };

      communicator.registerTemplate(customTemplate);
      const retrieved = communicator.getTemplate("custom_proposal");

      expect(retrieved).toEqual(customTemplate);
    });

    it("should list all templates", () => {
      const templates = communicator.listTemplates();

      expect(templates.length).toBeGreaterThan(0);
      expect(templates.some((t) => t.name === "default_proposal")).toBe(true);
      expect(templates.some((t) => t.name === "default_cover_letter")).toBe(true);
      expect(templates.some((t) => t.name === "default_response")).toBe(true);
    });

    it("should generate from template", async () => {
      const result = await communicator.generateFromTemplate("default_proposal", {
        client_name: "Test Client",
        project_title: "Test Project",
        relevant_experience: "Test experience",
        deliverables: "Test deliverables",
        approach: "Test approach",
        timeline: "2 weeks",
        bid_amount: "$500",
        key_skills: "JavaScript",
        questions: "",
        your_name: "Test Developer",
      });

      expect(result).toContain("Test Client");
      expect(result).toContain("Test Project");
    });

    it("should throw error for non-existent template", async () => {
      await expect(
        communicator.generateFromTemplate("non_existent_template", {})
      ).rejects.toThrow("Template 'non_existent_template' not found");
    });
  });

  describe("cache management", () => {
    it("should cache generated content when enabled", async () => {
      const communicatorWithCache = new ClientCommunicator(mockInferenceClient, {
        enableCache: true,
        cacheTtlMs: 1000,
      });

      const project: UpworkProject = {
        id: "test-project-cache",
        title: "Cache Test Project",
        description: "Testing cache functionality.",
        budget: null,
        skills: ["test"],
        category: "Testing",
        url: "https://upwork.com/jobs/test",
        job_type: "fixed",
      };

      const bid: GeneratedBid = {
        project_id: "test-project-cache",
        cover_letter: "Test",
        bid_amount: 100,
      };

      // First call
      await communicatorWithCache.generateProposal(project, bid);
      // Second call should use cache
      await communicatorWithCache.generateProposal(project, bid);

      // Should only call chat once due to caching
      expect(mockInferenceClient.chat).toHaveBeenCalledTimes(1);
    });

    it("should clear cache", () => {
      const communicatorWithCache = new ClientCommunicator(mockInferenceClient, {
        enableCache: true,
      });

      communicatorWithCache.clearCache();
      // Cache should be empty after clear
      expect(communicatorWithCache["cache"].size).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should handle project without budget", async () => {
      const project: UpworkProject = {
        id: "test-no-budget",
        title: "Project Without Budget",
        description: "No budget specified.",
        budget: null,
        skills: ["test"],
        category: "Testing",
        url: "https://upwork.com/jobs/test",
        job_type: "fixed",
      };

      const bid: GeneratedBid = {
        project_id: "test-no-budget",
        cover_letter: "Test",
        bid_amount: 0,
      };

      const proposal = await communicator.generateProposal(project, bid);

      expect(proposal).toBeDefined();
    });

    it("should handle project without client info", async () => {
      const project: UpworkProject = {
        id: "test-no-client",
        title: "Project Without Client",
        description: "No client info.",
        budget: null,
        skills: ["test"],
        category: "Testing",
        client: null,
        url: "https://upwork.com/jobs/test",
        job_type: "fixed",
      };

      const coverLetter = await communicator.generateCoverLetter(project);

      expect(coverLetter).toBeDefined();
    });

    it("should handle empty skills list", async () => {
      const project: UpworkProject = {
        id: "test-no-skills",
        title: "Project Without Skills",
        description: "No skills listed.",
        budget: null,
        skills: [],
        category: "Testing",
        url: "https://upwork.com/jobs/test",
        job_type: "fixed",
      };

      const bid: GeneratedBid = {
        project_id: "test-no-skills",
        cover_letter: "Test",
        bid_amount: 100,
      };

      const proposal = await communicator.generateProposal(project, bid);

      expect(proposal).toBeDefined();
    });

    it("should handle very long descriptions", async () => {
      const longDescription = "A".repeat(5000);
      const project: UpworkProject = {
        id: "test-long-desc",
        title: "Project With Long Description",
        description: longDescription,
        budget: null,
        skills: ["test"],
        category: "Testing",
        url: "https://upwork.com/jobs/test",
        job_type: "fixed",
      };

      const bid: GeneratedBid = {
        project_id: "test-long-desc",
        cover_letter: "Test",
        bid_amount: 100,
      };

      const proposal = await communicator.generateProposal(project, bid);

      expect(proposal).toBeDefined();
    });
  });
});
