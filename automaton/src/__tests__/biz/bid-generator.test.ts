/**
 * Tests for BidGenerator - bid proposal generation
 */

import { describe, it, expect } from "vitest";
import {
  BidGenerator,
  IBidGenerator,
  BidProposal,
  ClientHistory,
  DEFAULT_BID_CONFIG,
} from "../../biz/bid-generator";
import type { ProjectCandidate, ProjectScore } from "../../biz/project-filter";

describe("BidGenerator", () => {
  describe("IBidGenerator interface compliance", () => {
    it("should implement IBidGenerator interface", () => {
      const generator = new BidGenerator();
      expect(generator).toBeDefined();
      expect(typeof generator.generate).toBe("function");
      expect(typeof generator.personalize).toBe("function");
    });
  });

  describe("generate", () => {
    it("should generate a complete bid proposal", async () => {
      const generator = new BidGenerator();

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
        deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
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

      const score: ProjectScore = {
        project_id: "1",
        total_score: 0.75,
        recommendation: "accept",
        factors: {
          skill_match: 0.8,
          budget_fit: 0.7,
          deadline_risk: 0.8,
          client_quality: 0.9,
          competition: 0.7,
        },
        reasoning: ["Matched 3 skills", "Good budget"],
        estimated_hours: 20,
      };

      const proposal = await generator.generate(project, score);

      expect(proposal.project_id).toBe("1");
      expect(proposal.cover_letter).toBeTruthy();
      expect(proposal.cover_letter.length).toBeGreaterThan(100);
      expect(proposal.bid_amount).toBeGreaterThan(0);
      expect(proposal.duration_days).toBeGreaterThan(0);
      expect(proposal.strategy).toMatch(/^(competitive|premium|budget)$/);
      expect(proposal.confidence).toBeGreaterThan(0);
      expect(proposal.confidence).toBeLessThanOrEqual(1);
    });

    it("should include milestones when enabled", async () => {
      const generator = new BidGenerator({ include_milestones: true });

      const project: ProjectCandidate = {
        id: "1",
        title: "TypeScript Project",
        description: "Need TypeScript help",
        skills_required: ["typescript"],
        budget_range: { type: "fixed", max: 1000, currency: "USD" },
        metadata: { complexity: "medium" },
      };

      const score: ProjectScore = {
        project_id: "1",
        total_score: 0.6,
        recommendation: "accept",
        factors: {
          skill_match: 0.7,
          budget_fit: 0.7,
          deadline_risk: 0.5,
          client_quality: 0.5,
          competition: 0.5,
        },
        reasoning: [],
        estimated_hours: 20,
      };

      const proposal = await generator.generate(project, score);

      expect(proposal.milestone_plan).toBeDefined();
      expect(proposal.milestone_plan!.length).toBeGreaterThan(0);
      expect(proposal.milestone_plan![0].id).toBeTruthy();
      expect(proposal.milestone_plan![0].title).toBeTruthy();
      expect(proposal.milestone_plan![0].percentage).toBeGreaterThan(0);
    });

    it("should include questions when enabled", async () => {
      const generator = new BidGenerator({ include_questions: true });

      const project: ProjectCandidate = {
        id: "1",
        title: "Project",
        description: "Need help",
        skills_required: ["python"],
        budget_range: { type: "fixed", max: 1000, currency: "USD" },
      };

      const score: ProjectScore = {
        project_id: "1",
        total_score: 0.5,
        recommendation: "consider",
        factors: {
          skill_match: 0.5,
          budget_fit: 0.5,
          deadline_risk: 0.5,
          client_quality: 0.5,
          competition: 0.5,
        },
        reasoning: [],
        estimated_hours: 20,
      };

      const proposal = await generator.generate(project, score);

      expect(proposal.questions).toBeDefined();
      expect(proposal.questions!.length).toBeGreaterThan(0);
      expect(proposal.questions!.length).toBeLessThanOrEqual(5);
    });

    it("should use premium strategy for high-score projects", async () => {
      const generator = new BidGenerator();

      const project: ProjectCandidate = {
        id: "1",
        title: "Premium Project",
        description: "High value project",
        skills_required: ["typescript", "react", "node.js"],
        budget_range: { type: "fixed", max: 2000, currency: "USD" },
        client: {
          id: "c1",
          rating: 5.0,
          verified: true,
          total_spent: 10000,
        },
        metadata: { proposal_count: 2 },
      };

      const score: ProjectScore = {
        project_id: "1",
        total_score: 0.8,
        recommendation: "accept",
        factors: {
          skill_match: 0.9,
          budget_fit: 0.8,
          deadline_risk: 0.7,
          client_quality: 0.95,
          competition: 0.8,
        },
        reasoning: [],
        estimated_hours: 40,
      };

      const proposal = await generator.generate(project, score);

      expect(proposal.strategy).toBe("premium");
    });

    it("should calculate bid amount based on budget and strategy", async () => {
      const generator = new BidGenerator({ hourly_rate_usd: 50 });

      const project: ProjectCandidate = {
        id: "1",
        title: "Project",
        description: "Need help",
        skills_required: ["python"],
        budget_range: { type: "fixed", max: 1000, currency: "USD" },
        metadata: { complexity: "medium" },
      };

      const score: ProjectScore = {
        project_id: "1",
        total_score: 0.6,
        recommendation: "accept",
        factors: {
          skill_match: 0.7,
          budget_fit: 0.7,
          deadline_risk: 0.5,
          client_quality: 0.5,
          competition: 0.5,
        },
        reasoning: [],
        estimated_hours: 20,
      };

      const proposal = await generator.generate(project, score);

      // Should be around 75% of 1000 = 750
      expect(proposal.bid_amount).toBeGreaterThan(500);
      expect(proposal.bid_amount).toBeLessThan(1000);
    });

    it("should estimate duration based on hours", async () => {
      const generator = new BidGenerator();

      const project: ProjectCandidate = {
        id: "1",
        title: "Project",
        description: "Need help",
        skills_required: ["python"],
        budget_range: { type: "fixed", max: 1000, currency: "USD" },
        metadata: { complexity: "medium" },
      };

      const score: ProjectScore = {
        project_id: "1",
        total_score: 0.6,
        recommendation: "accept",
        factors: {
          skill_match: 0.7,
          budget_fit: 0.7,
          deadline_risk: 0.5,
          client_quality: 0.5,
          competition: 0.5,
        },
        reasoning: [],
        estimated_hours: 30, // 30 hours = 5 days at 6 hours/day
      };

      const proposal = await generator.generate(project, score);

      expect(proposal.duration_days).toBe(5);
    });

    it("should generate different milestone plans for different complexities", async () => {
      const generator = new BidGenerator({ include_milestones: true });

      const lowProject: ProjectCandidate = {
        id: "1",
        title: "Simple Task",
        description: "Quick fix",
        skills_required: ["python"],
        budget_range: { type: "fixed", max: 500, currency: "USD" },
        metadata: { complexity: "low" },
      };

      const highProject: ProjectCandidate = {
        id: "2",
        title: "Complex System",
        description: "Large project",
        skills_required: ["typescript", "react", "node.js", "graphql"],
        budget_range: { type: "fixed", max: 5000, currency: "USD" },
        metadata: { complexity: "high" },
      };

      const score: ProjectScore = {
        project_id: "1",
        total_score: 0.6,
        recommendation: "accept",
        factors: {
          skill_match: 0.7,
          budget_fit: 0.7,
          deadline_risk: 0.5,
          client_quality: 0.5,
          competition: 0.5,
        },
        reasoning: [],
        estimated_hours: 20,
      };

      const lowProposal = await generator.generate(lowProject, score);
      const highProposal = await generator.generate(highProject, {
        ...score,
        project_id: "2",
        estimated_hours: 100,
      });

      // Low complexity should have fewer milestones
      expect(lowProposal.milestone_plan!.length).toBeLessThan(highProposal.milestone_plan!.length);
    });
  });

  describe("personalize", () => {
    it("should adjust tone for formal communication style", async () => {
      const generator = new BidGenerator({ use_personalization: true });

      const proposal: BidProposal = {
        project_id: "1",
        cover_letter: "Hi there,\n\nI'm excited about this project. Let's discuss.",
        bid_amount: 500,
        duration_days: 5,
        generated_at: new Date().toISOString(),
        strategy: "competitive",
        confidence: 0.7,
      };

      const clientHistory: ClientHistory = {
        client_id: "client1",
        communication_style: "formal",
      };

      const personalized = generator.personalize(proposal, clientHistory);

      expect(personalized.cover_letter).toContain("I am");
      expect(personalized.cover_letter).toContain("Dear Client");
    });

    it("should adjust tone for casual communication style", async () => {
      const generator = new BidGenerator({ use_personalization: true });

      const proposal: BidProposal = {
        project_id: "1",
        cover_letter: "Dear Client,\n\nI am excited about this project. Let us discuss.",
        bid_amount: 500,
        duration_days: 5,
        generated_at: new Date().toISOString(),
        strategy: "competitive",
        confidence: 0.7,
      };

      const clientHistory: ClientHistory = {
        client_id: "client1",
        communication_style: "casual",
      };

      const personalized = generator.personalize(proposal, clientHistory);

      expect(personalized.cover_letter).toContain("I'm");
    });

    it("should add reference to past interactions", async () => {
      const generator = new BidGenerator({ use_personalization: true });

      const proposal: BidProposal = {
        project_id: "1",
        cover_letter: "Original cover letter.",
        bid_amount: 500,
        duration_days: 5,
        generated_at: new Date().toISOString(),
        strategy: "competitive",
        confidence: 0.7,
      };

      const clientHistory: ClientHistory = {
        client_id: "client1",
        previous_interactions: [
          {
            project_id: "old_project",
            outcome: "hired",
          },
        ],
      };

      const personalized = generator.personalize(proposal, clientHistory);

      expect(personalized.cover_letter).toContain("enjoyed working with you");
    });

    it("should refine questions for returning clients", async () => {
      const generator = new BidGenerator({ use_personalization: true });

      const proposal: BidProposal = {
        project_id: "1",
        cover_letter: "Cover letter",
        bid_amount: 500,
        duration_days: 5,
        questions: [
          "What is your expected timeline?",
          "What is your preferred communication method?",
          "Do you have design mockups?",
        ],
        generated_at: new Date().toISOString(),
        strategy: "competitive",
        confidence: 0.7,
      };

      const clientHistory: ClientHistory = {
        client_id: "client1",
        past_projects: 5,
      };

      const personalized = generator.personalize(proposal, clientHistory);

      // Timeline and communication questions should be removed, but at least one remains
      expect(personalized.questions?.length).toBeGreaterThan(0);
      expect(personalized.questions?.length).toBeLessThanOrEqual(proposal.questions!.length);
    });

    it("should not personalize when disabled", async () => {
      const generator = new BidGenerator({ use_personalization: false });

      const proposal: BidProposal = {
        project_id: "1",
        cover_letter: "Original cover letter.",
        bid_amount: 500,
        duration_days: 5,
        generated_at: new Date().toISOString(),
        strategy: "competitive",
        confidence: 0.7,
      };

      const clientHistory: ClientHistory = {
        client_id: "client1",
        communication_style: "formal",
      };

      const personalized = generator.personalize(proposal, clientHistory);

      expect(personalized.cover_letter).toBe(proposal.cover_letter);
    });
  });

  describe("getConfig and updateConfig", () => {
    it("should return current configuration", () => {
      const customConfig = {
        agent_name: "Custom Agent",
        hourly_rate_usd: 75,
      };

      const generator = new BidGenerator(customConfig);
      const config = generator.getConfig();

      expect(config.agent_name).toBe("Custom Agent");
      expect(config.hourly_rate_usd).toBe(75);
    });

    it("should update configuration", async () => {
      const generator = new BidGenerator();

      const project: ProjectCandidate = {
        id: "1",
        title: "Project",
        description: "Need help",
        skills_required: ["python"],
        budget_range: { type: "fixed", max: 1000, currency: "USD" },
      };

      const score: ProjectScore = {
        project_id: "1",
        total_score: 0.6,
        recommendation: "accept",
        factors: {
          skill_match: 0.7,
          budget_fit: 0.7,
          deadline_risk: 0.5,
          client_quality: 0.5,
          competition: 0.5,
        },
        reasoning: [],
        estimated_hours: 20,
      };

      const originalProposal = await generator.generate(project, score);

      generator.updateConfig({ hourly_rate_usd: 100 });

      const updatedProposal = await generator.generate(project, score);

      // Bid amount calculation should reflect updated hourly rate
      // Since we're not estimating hours, bid comes from budget_range
      // But we can verify the config was updated
      const config = generator.getConfig();
      expect(config.hourly_rate_usd).toBe(100);
    });
  });

  describe("confidence calculation", () => {
    it("should calculate higher confidence for better matches", async () => {
      const generator = new BidGenerator();

      const project: ProjectCandidate = {
        id: "1",
        title: "Project",
        description: "Need help",
        skills_required: ["typescript", "react"],
        budget_range: { type: "fixed", max: 1000, currency: "USD" },
        client: {
          id: "c1",
          rating: 5.0,
          verified: true,
          total_spent: 10000,
        },
        metadata: { proposal_count: 3 },
      };

      const highScore: ProjectScore = {
        project_id: "1",
        total_score: 0.8,
        recommendation: "accept",
        factors: {
          skill_match: 0.9,
          budget_fit: 0.8,
          deadline_risk: 0.7,
          client_quality: 0.95,
          competition: 0.8,
        },
        reasoning: [],
        estimated_hours: 20,
      };

      const lowScore: ProjectScore = {
        project_id: "1",
        total_score: 0.4,
        recommendation: "consider",
        factors: {
          skill_match: 0.3,
          budget_fit: 0.5,
          deadline_risk: 0.5,
          client_quality: 0.3,
          competition: 0.3,
        },
        reasoning: [],
        estimated_hours: 20,
      };

      const highProposal = await generator.generate(project, highScore);
      const lowProposal = await generator.generate(project, lowScore);

      expect(highProposal.confidence).toBeGreaterThan(lowProposal.confidence);
    });
  });

  describe("DEFAULT_BID_CONFIG", () => {
    it("should have sensible default values", () => {
      expect(DEFAULT_BID_CONFIG.agent_name).toBeTruthy();
      expect(DEFAULT_BID_CONFIG.hourly_rate_usd).toBe(50);
      expect(DEFAULT_BID_CONFIG.include_milestones).toBe(true);
      expect(DEFAULT_BID_CONFIG.include_questions).toBe(true);
      expect(DEFAULT_BID_CONFIG.use_personalization).toBe(true);
    });
  });

  describe("cover letter generation", () => {
    it("should include agent name and title", async () => {
      const generator = new BidGenerator({
        agent_name: "Test Agent",
        agent_title: "Senior Developer",
      });

      const project: ProjectCandidate = {
        id: "1",
        title: "Project",
        description: "Need help",
        skills_required: ["python"],
        budget_range: { type: "fixed", max: 1000, currency: "USD" },
      };

      const score: ProjectScore = {
        project_id: "1",
        total_score: 0.6,
        recommendation: "accept",
        factors: {
          skill_match: 0.7,
          budget_fit: 0.7,
          deadline_risk: 0.5,
          client_quality: 0.5,
          competition: 0.5,
        },
        reasoning: [],
        estimated_hours: 20,
      };

      const proposal = await generator.generate(project, score);

      expect(proposal.cover_letter).toContain("Test Agent");
      expect(proposal.cover_letter).toContain("Senior Developer");
    });

    it("should mention relevant skills", async () => {
      const generator = new BidGenerator({
        expertise_areas: ["TypeScript", "React", "Node.js"],
      });

      const project: ProjectCandidate = {
        id: "1",
        title: "TypeScript React Project",
        description: "Need TypeScript and React developer",
        skills_required: ["typescript", "react"],
        budget_range: { type: "fixed", max: 1000, currency: "USD" },
      };

      const score: ProjectScore = {
        project_id: "1",
        total_score: 0.7,
        recommendation: "accept",
        factors: {
          skill_match: 0.8,
          budget_fit: 0.7,
          deadline_risk: 0.5,
          client_quality: 0.5,
          competition: 0.5,
        },
        reasoning: [],
        matched_skills: ["typescript", "react"],
        estimated_hours: 20,
      };

      const proposal = await generator.generate(project, score);

      expect(proposal.cover_letter).toMatch(/typescript|react/i);
    });
  });
});
