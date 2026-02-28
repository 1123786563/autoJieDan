/**
 * Tests for ProjectFilter - project scoring and filtering in biz layer
 */

import { describe, it, expect } from "vitest";
import {
  ProjectFilter,
  IProjectFilter,
  ProjectCandidate,
  ProjectScore,
  ScoringWeights,
  DEFAULT_WEIGHTS,
  DEFAULT_CONFIG,
} from "../../biz/project-filter";

describe("ProjectFilter", () => {
  describe("IProjectFilter interface compliance", () => {
    it("should implement IProjectFilter interface", () => {
      const filter = new ProjectFilter();
      expect(filter).toBeDefined();
      expect(typeof filter.score).toBe("function");
      expect(typeof filter.batchScore).toBe("function");
      expect(typeof filter.setWeights).toBe("function");
    });
  });

  describe("score", () => {
    it("should score a project with all factors", async () => {
      const filter = new ProjectFilter();

      const project: ProjectCandidate = {
        id: "1",
        title: "TypeScript React Developer Needed",
        description: "Looking for an experienced TypeScript and React developer for a web application.",
        skills_required: ["typescript", "react", "node.js"],
        budget_range: {
          type: "fixed",
          max: 1000,
          currency: "USD",
        },
        deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        client: {
          id: "client1",
          rating: 5.0,
          reviews_count: 20,
          verified: true,
          total_spent: 5000,
          hire_rate: 80,
        },
        metadata: {
          proposal_count: 5,
          posted_date: new Date().toISOString(),
          category: "web development",
          complexity: "medium",
        },
      };

      const score = await filter.score(project);

      expect(score.project_id).toBe("1");
      expect(score.total_score).toBeGreaterThan(0);
      expect(score.total_score).toBeLessThanOrEqual(1);
      expect(score.recommendation).toMatch(/^(accept|consider|reject)$/);
      expect(score.factors.skill_match).toBeGreaterThanOrEqual(0);
      expect(score.factors.budget_fit).toBeGreaterThanOrEqual(0);
      expect(score.factors.deadline_risk).toBeGreaterThanOrEqual(0);
      expect(score.factors.client_quality).toBeGreaterThanOrEqual(0);
      expect(score.factors.competition).toBeGreaterThanOrEqual(0);
    });

    it("should return accept for high-quality project", async () => {
      const filter = new ProjectFilter();

      const project: ProjectCandidate = {
        id: "1",
        title: "TypeScript React Node.js Expert",
        description: "Need TypeScript, React, and Node.js expert for web application.",
        skills_required: ["typescript", "react", "node.js", "graphql"],
        budget_range: {
          type: "fixed",
          max: 2000,
          currency: "USD",
        },
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        client: {
          id: "client1",
          rating: 5.0,
          reviews_count: 50,
          verified: true,
          total_spent: 10000,
          hire_rate: 90,
        },
        metadata: {
          proposal_count: 2,
          posted_date: new Date().toISOString(),
          complexity: "medium",
        },
      };

      const score = await filter.score(project);

      expect(score.recommendation).toBe("accept");
      expect(score.total_score).toBeGreaterThanOrEqual(0.7);
    });

    it("should return reject for project with low budget", async () => {
      const filter = new ProjectFilter({
        min_budget_usd: 500,
      });

      const project: ProjectCandidate = {
        id: "1",
        title: "Small Task",
        description: "Quick task",
        skills_required: ["typescript"],
        budget_range: {
          type: "fixed",
          max: 100, // Below min_budget_usd
          currency: "USD",
        },
      };

      const score = await filter.score(project);

      expect(score.recommendation).toBe("reject");
      expect(score.reasoning.some((r) => r.includes("Budget too low"))).toBe(true);
    });

    it("should return reject for unverified client when required", async () => {
      const filter = new ProjectFilter({
        require_verified: true,
      });

      const project: ProjectCandidate = {
        id: "1",
        title: "TypeScript Project",
        description: "Need TypeScript help",
        skills_required: ["typescript"],
        budget_range: {
          type: "fixed",
          max: 1000,
          currency: "USD",
        },
        client: {
          id: "client1",
          rating: 5.0,
          verified: false, // Not verified
        },
      };

      const score = await filter.score(project);

      expect(score.recommendation).toBe("reject");
      expect(score.reasoning.some((r) => r.includes("not verified"))).toBe(true);
    });

    it("should calculate skill match score correctly", async () => {
      const filter = new ProjectFilter({
        agent_skills: ["typescript", "react", "python"],
      });

      const project: ProjectCandidate = {
        id: "1",
        title: "TypeScript and React Project",
        description: "Need TypeScript and React developer",
        skills_required: ["typescript", "react"],
        budget_range: {
          type: "fixed",
          max: 1000,
          currency: "USD",
        },
      };

      const score = await filter.score(project);

      expect(score.factors.skill_match).toBeGreaterThan(0.5);
      expect(score.reasoning.some((r) => r.includes("2 skills"))).toBe(true);
    });

    it("should calculate deadline risk correctly", async () => {
      const filter = new ProjectFilter();

      const urgentProject: ProjectCandidate = {
        id: "1",
        title: "Urgent Project",
        description: "Need help immediately",
        skills_required: ["typescript"],
        budget_range: {
          type: "fixed",
          max: 1000,
          currency: "USD",
        },
        deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days
      };

      const relaxedProject: ProjectCandidate = {
        id: "2",
        title: "Relaxed Project",
        description: "Need help",
        skills_required: ["typescript"],
        budget_range: {
          type: "fixed",
          max: 1000,
          currency: "USD",
        },
        deadline: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(), // 21 days
      };

      const urgentScore = await filter.score(urgentProject);
      const relaxedScore = await filter.score(relaxedProject);

      expect(relaxedScore.factors.deadline_risk).toBeGreaterThan(
        urgentScore.factors.deadline_risk
      );
    });

    it("should estimate hours correctly", async () => {
      const filter = new ProjectFilter({
        hourly_rate_usd: 50,
      });

      const project: ProjectCandidate = {
        id: "1",
        title: "Project",
        description: "Need help",
        skills_required: ["typescript"],
        budget_range: {
          type: "fixed",
          max: 1000,
          currency: "USD",
        },
        metadata: {
          complexity: "medium",
        },
      };

      const score = await filter.score(project);

      expect(score.estimated_hours).toBeDefined();
      // $1000 at $50/hr = 20 hours (adjusted by complexity)
      expect(score.estimated_hours).toBeGreaterThan(0);
    });
  });

  describe("batchScore", () => {
    it("should score multiple projects", async () => {
      const filter = new ProjectFilter();

      const projects: ProjectCandidate[] = [
        {
          id: "1",
          title: "TypeScript Project",
          description: "Need TypeScript",
          skills_required: ["typescript"],
          budget_range: { type: "fixed", max: 1000, currency: "USD" },
        },
        {
          id: "2",
          title: "Python Project",
          description: "Need Python",
          skills_required: ["python"],
          budget_range: { type: "fixed", max: 1000, currency: "USD" },
        },
        {
          id: "3",
          title: "Java Project",
          description: "Need Java",
          skills_required: ["java"],
          budget_range: { type: "fixed", max: 1000, currency: "USD" },
        },
      ];

      const scores = await filter.batchScore(projects);

      expect(scores).toHaveLength(3);
      expect(scores[0].project_id).toBe("1");
      expect(scores[1].project_id).toBe("2");
      expect(scores[2].project_id).toBe("3");
    });

    it("should return accept for good projects and reject for bad ones", async () => {
      const filter = new ProjectFilter();

      const projects: ProjectCandidate[] = [
        {
          id: "1",
          title: "Great TypeScript React Project",
          description: "Need TypeScript and React expert",
          skills_required: ["typescript", "react", "node.js"],
          budget_range: { type: "fixed", max: 2000, currency: "USD" },
          client: {
            id: "c1",
            rating: 5.0,
            verified: true,
            total_spent: 10000,
          },
          metadata: { proposal_count: 3 },
        },
        {
          id: "2",
          title: "Low Budget Project",
          description: "Quick task",
          skills_required: ["typescript"],
          budget_range: { type: "fixed", max: 50, currency: "USD" },
        },
      ];

      const scores = await filter.batchScore(projects);

      expect(scores[0].recommendation).toBe("accept");
      expect(scores[1].recommendation).toBe("reject");
    });
  });

  describe("setWeights", () => {
    it("should update scoring weights", async () => {
      const filter = new ProjectFilter();

      const project: ProjectCandidate = {
        id: "1",
        title: "TypeScript Project",
        description: "Need TypeScript",
        skills_required: ["typescript"],
        budget_range: { type: "fixed", max: 1000, currency: "USD" },
        client: {
          id: "c1",
          rating: 5.0,
        },
      };

      const originalScore = await filter.score(project);

      // Change weights to prioritize skill match more
      const newWeights: ScoringWeights = {
        skill_match: 0.60,
        budget_fit: 0.15,
        deadline_risk: 0.05,
        client_quality: 0.10,
        competition: 0.10,
      };

      filter.setWeights(newWeights);

      const newScore = await filter.score(project);

      // Scores should be different due to weight change
      expect(newScore.total_score).not.toBe(originalScore.total_score);
    });

    it("should throw error if weights do not sum to 1.0", () => {
      const filter = new ProjectFilter();

      const invalidWeights: ScoringWeights = {
        skill_match: 0.5,
        budget_fit: 0.3,
        deadline_risk: 0.1,
        client_quality: 0.1,
        competition: 0.1, // Sum = 1.1
      };

      expect(() => filter.setWeights(invalidWeights)).toThrow();
    });
  });

  describe("getConfig and updateConfig", () => {
    it("should return current configuration", () => {
      const customConfig = {
        agent_skills: ["typescript", "rust"],
        min_budget_usd: 200,
      };

      const filter = new ProjectFilter(customConfig);
      const config = filter.getConfig();

      expect(config.agent_skills).toContain("typescript");
      expect(config.agent_skills).toContain("rust");
      expect(config.min_budget_usd).toBe(200);
    });

    it("should update configuration", async () => {
      const filter = new ProjectFilter();

      const project: ProjectCandidate = {
        id: "1",
        title: "TypeScript Project",
        description: "Need TypeScript",
        skills_required: ["typescript"],
        budget_range: { type: "fixed", max: 1000, currency: "USD" },
      };

      const originalScore = await filter.score(project);

      filter.updateConfig({
        agent_skills: ["rust", "go"],
        min_budget_usd: 2000,
      });

      const newScore = await filter.score(project);

      // Score should change due to different skills
      expect(newScore.total_score).toBeLessThan(originalScore.total_score);
    });
  });

  describe("skill aliases", () => {
    it("should match skills using aliases", async () => {
      const filter = new ProjectFilter({
        agent_skills: ["js", "ts", "reactjs"], // Using aliases
      });

      const project: ProjectCandidate = {
        id: "1",
        title: "JavaScript TypeScript React Developer",
        description: "Need JS, TS, and React expertise",
        skills_required: ["javascript", "typescript", "react"],
        budget_range: { type: "fixed", max: 1000, currency: "USD" },
      };

      const score = await filter.score(project);

      expect(score.factors.skill_match).toBeGreaterThan(0.5);
    });
  });

  describe("DEFAULT_WEIGHTS", () => {
    it("should have weights that sum to 1.0", () => {
      const sum =
        DEFAULT_WEIGHTS.skill_match +
        DEFAULT_WEIGHTS.budget_fit +
        DEFAULT_WEIGHTS.deadline_risk +
        DEFAULT_WEIGHTS.client_quality +
        DEFAULT_WEIGHTS.competition;

      expect(sum).toBeCloseTo(1.0, 2);
    });
  });

  describe("DEFAULT_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_CONFIG.agent_skills.length).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.min_budget_usd).toBe(100);
      expect(DEFAULT_CONFIG.max_budget_usd).toBe(10000);
      expect(DEFAULT_CONFIG.hourly_rate_usd).toBe(50);
    });
  });

  describe("accuracy requirements", () => {
    it("should achieve >85% accuracy on test cases", async () => {
      const filter = new ProjectFilter();

      const testCases: Array<{
        project: ProjectCandidate;
        expected: "accept" | "consider" | "reject";
      }> = [
        {
          project: {
            id: "1",
            title: "TypeScript React Node.js Expert",
            description: "Full stack TypeScript expert",
            skills_required: ["typescript", "react", "node.js"],
            budget_range: { type: "fixed", max: 2000, currency: "USD" },
            client: {
              id: "c1",
              rating: 5.0,
              verified: true,
              total_spent: 10000,
            },
            metadata: { proposal_count: 3 },
          },
          expected: "accept",
        },
        {
          project: {
            id: "2",
            title: "Low Budget Task",
            description: "Quick fix",
            skills_required: ["typescript"],
            budget_range: { type: "fixed", max: 50, currency: "USD" },
          },
          expected: "reject",
        },
        {
          project: {
            id: "3",
            title: "Moderate TypeScript Project",
            description: "Need some TypeScript help",
            skills_required: ["typescript"],
            budget_range: { type: "fixed", max: 800, currency: "USD" },
            client: { id: "c3", rating: 4.0 },
          },
          expected: "consider",
        },
      ];

      let correct = 0;
      for (const testCase of testCases) {
        const score = await filter.score(testCase.project);
        if (score.recommendation === testCase.expected) {
          correct++;
        }
      }

      const accuracy = correct / testCases.length;
      expect(accuracy).toBeGreaterThan(0.85);
    });
  });
});
