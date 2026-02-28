/**
 * Tests for ProjectFilter - project scoring and filtering
 */

import { describe, it, expect } from "vitest";
import {
  ProjectFilter,
  FilterCriteria,
  UpworkProject,
  DEFAULT_FILTER_CRITERIA,
} from "../../orchestration/project_filter";

describe("ProjectFilter", () => {
  describe("calculateScore", () => {
    const criteria: FilterCriteria = {
      skill_keywords: ["typescript", "react", "node.js"],
      excluded_keywords: ["urgent", "agency only"],
      preferred_categories: ["web development"],
      min_budget_usd: 100,
      max_budget_usd: 5000,
      hourly_rate_usd: 50,
      min_client_rating: 4.0,
      max_hours_estimate: 100,
      max_proposals: 30,
      max_project_age_hours: 48,
    };

    const filter = new ProjectFilter(criteria);

    it("should calculate high score for well-matched project", () => {
      const project: UpworkProject = {
        id: "1",
        title: "TypeScript React Developer Needed",
        description: "Looking for an experienced TypeScript and React developer for a web application.",
        skills: ["typescript", "react", "node.js"],
        category: "web development",
        subcategory: "frontend",
        budget: {
          type: "fixed",
          min_amount: 500,
          max_amount: 1000,
          currency: "USD",
        },
        client: {
          id: "client1",
          rating: 5.0,
          reviews_count: 20,
          verified: true,
          total_spent: 5000,
          jobs_posted: 10,
          hire_rate: 80,
        },
        posted_at: new Date(Date.now() - 3600000), // 1 hour ago
        url: "https://upwork.com/job/1",
        source: "rss",
        job_type: "fixed",
        proposal_count: 5,
      };

      const score = filter.calculateScore(project);

      expect(score.total_score).toBeGreaterThan(0.6);
      expect(score.should_bid).toBe(true);
      expect(score.matched_skills).toContain("typescript");
      expect(score.matched_skills).toContain("react");
      expect(score.factors.skill_match).toBeGreaterThan(0.7);
      expect(score.factors.client_quality).toBeGreaterThan(0.7);
    });

    it("should exclude project with excluded keywords", () => {
      const project: UpworkProject = {
        id: "2",
        title: "Urgent TypeScript Developer Needed",
        description: "Need someone URGENTLY to help with TypeScript project.",
        skills: ["typescript"],
        category: "web development",
        subcategory: "frontend",
        budget: {
          type: "fixed",
          max_amount: 500,
          currency: "USD",
        },
        posted_at: new Date(),
        url: "https://upwork.com/job/2",
        source: "rss",
        job_type: "fixed",
      };

      const score = filter.calculateScore(project);

      expect(score.should_bid).toBe(false);
      expect(score.excluded_reasons).toContain("Excluded keyword: urgent");
    });

    it("should exclude project with budget too low", () => {
      const project: UpworkProject = {
        id: "3",
        title: "Simple TypeScript Task",
        description: "Need help with TypeScript",
        skills: ["typescript"],
        category: "web development",
        subcategory: "frontend",
        budget: {
          type: "fixed",
          max_amount: 50, // Below min_budget_usd
          currency: "USD",
        },
        posted_at: new Date(),
        url: "https://upwork.com/job/3",
        source: "rss",
        job_type: "fixed",
      };

      const score = filter.calculateScore(project);

      expect(score.should_bid).toBe(false);
      expect(score.excluded_reasons.some((r) => r.includes("Budget too low"))).toBe(true);
    });

    it("should exclude project with too many proposals", () => {
      const project: UpworkProject = {
        id: "4",
        title: "TypeScript Project",
        description: "Looking for TypeScript developer",
        skills: ["typescript"],
        category: "web development",
        subcategory: "frontend",
        budget: {
          type: "fixed",
          max_amount: 500,
          currency: "USD",
        },
        posted_at: new Date(),
        url: "https://upwork.com/job/4",
        source: "rss",
        job_type: "fixed",
        proposal_count: 50, // Over max_proposals
      };

      const score = filter.calculateScore(project);

      expect(score.should_bid).toBe(false);
      expect(score.excluded_reasons.some((r) => r.includes("Too many proposals"))).toBe(true);
    });

    it("should give lower score for unrated client", () => {
      const project: UpworkProject = {
        id: "5",
        title: "TypeScript Developer",
        description: "Need TypeScript help",
        skills: ["typescript"],
        category: "web development",
        subcategory: "frontend",
        budget: {
          type: "fixed",
          max_amount: 500,
          currency: "USD",
        },
        client: {
          id: "newclient",
          reviews_count: 0,
          verified: false,
          jobs_posted: 1,
        },
        posted_at: new Date(),
        url: "https://upwork.com/job/5",
        source: "rss",
        job_type: "fixed",
      };

      const score = filter.calculateScore(project);

      expect(score.factors.client_quality).toBeLessThan(0.5);
    });

    it("should give higher score for fresh projects", () => {
      const freshProject: UpworkProject = {
        id: "6a",
        title: "TypeScript Project",
        description: "Need TypeScript help",
        skills: ["typescript"],
        category: "web development",
        subcategory: "frontend",
        budget: {
          type: "fixed",
          max_amount: 500,
          currency: "USD",
        },
        posted_at: new Date(Date.now() - 1800000), // 30 minutes ago
        url: "https://upwork.com/job/6a",
        source: "rss",
        job_type: "fixed",
      };

      const oldProject: UpworkProject = {
        id: "6b",
        title: "TypeScript Project",
        description: "Need TypeScript help",
        skills: ["typescript"],
        category: "web development",
        subcategory: "frontend",
        budget: {
          type: "fixed",
          max_amount: 500,
          currency: "USD",
        },
        posted_at: new Date(Date.now() - 48 * 3600000), // 48 hours ago
        url: "https://upwork.com/job/6b",
        source: "rss",
        job_type: "fixed",
      };

      const freshScore = filter.calculateScore(freshProject);
      const oldScore = filter.calculateScore(oldProject);

      expect(freshScore.factors.freshness).toBeGreaterThan(oldScore.factors.freshness);
    });

    it("should give lower score for high competition", () => {
      const lowCompetition: UpworkProject = {
        id: "7a",
        title: "TypeScript Project",
        description: "Need TypeScript help",
        skills: ["typescript"],
        category: "web development",
        subcategory: "frontend",
        budget: {
          type: "fixed",
          max_amount: 500,
          currency: "USD",
        },
        posted_at: new Date(),
        url: "https://upwork.com/job/7a",
        source: "rss",
        job_type: "fixed",
        proposal_count: 3,
      };

      const highCompetition: UpworkProject = {
        id: "7b",
        title: "TypeScript Project",
        description: "Need TypeScript help",
        skills: ["typescript"],
        category: "web development",
        subcategory: "frontend",
        budget: {
          type: "fixed",
          max_amount: 500,
          currency: "USD",
        },
        posted_at: new Date(),
        url: "https://upwork.com/job/7b",
        source: "rss",
        job_type: "fixed",
        proposal_count: 40,
      };

      const lowScore = filter.calculateScore(lowCompetition);
      const highScore = filter.calculateScore(highCompetition);

      expect(lowScore.factors.competition).toBeGreaterThan(highScore.factors.competition);
    });
  });

  describe("filterProjects", () => {
    it("should filter out projects that don't meet criteria", () => {
      const criteria: FilterCriteria = {
        skill_keywords: ["typescript", "react"],
        excluded_keywords: ["urgent"],
        preferred_categories: [],
        min_budget_usd: 100,
        max_budget_usd: 5000,
        hourly_rate_usd: 50,
      };

      const filter = new ProjectFilter(criteria);

      const projects: UpworkProject[] = [
        {
          id: "1",
          title: "Good TypeScript Project",
          description: "Need TypeScript developer",
          skills: ["typescript"],
          category: "web development",
          subcategory: "frontend",
          budget: { type: "fixed", max_amount: 500, currency: "USD" },
          posted_at: new Date(),
          url: "https://upwork.com/job/1",
          source: "rss",
          job_type: "fixed",
        },
        {
          id: "2",
          title: "Urgent Project",
          description: "Need help URGENTLY",
          skills: ["typescript"],
          category: "web development",
          subcategory: "frontend",
          budget: { type: "fixed", max_amount: 500, currency: "USD" },
          posted_at: new Date(),
          url: "https://upwork.com/job/2",
          source: "rss",
          job_type: "fixed",
        },
        {
          id: "3",
          title: "Low Budget Project",
          description: "Need TypeScript help",
          skills: ["typescript"],
          category: "web development",
          subcategory: "frontend",
          budget: { type: "fixed", max_amount: 50, currency: "USD" },
          posted_at: new Date(),
          url: "https://upwork.com/job/3",
          source: "rss",
          job_type: "fixed",
        },
      ];

      const filtered = filter.filterProjects(projects);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe("1");
    });
  });

  describe("rankProjects", () => {
    it("should rank projects by score", () => {
      const criteria: FilterCriteria = {
        skill_keywords: ["typescript", "react"],
        excluded_keywords: [],
        preferred_categories: [],
        min_budget_usd: 100,
        max_budget_usd: 5000,
        hourly_rate_usd: 50,
      };

      const filter = new ProjectFilter(criteria);

      const projects: UpworkProject[] = [
        {
          id: "1",
          title: "TypeScript Only",
          description: "Need TypeScript help",
          skills: ["typescript"],
          category: "web development",
          subcategory: "frontend",
          budget: { type: "fixed", max_amount: 500, currency: "USD" },
          posted_at: new Date(),
          url: "https://upwork.com/job/1",
          source: "rss",
          job_type: "fixed",
        },
        {
          id: "2",
          title: "TypeScript and React",
          description: "Need TypeScript and React developer",
          skills: ["typescript", "react", "node.js"],
          category: "web development",
          subcategory: "full stack",
          budget: { type: "fixed", max_amount: 1000, currency: "USD" },
          client: {
            id: "client2",
            rating: 5.0,
            reviews_count: 50,
            verified: true,
            total_spent: 10000,
            jobs_posted: 20,
            hire_rate: 90,
          },
          posted_at: new Date(Date.now() - 1800000),
          url: "https://upwork.com/job/2",
          source: "rss",
          job_type: "fixed",
          proposal_count: 3,
        },
        {
          id: "3",
          title: "Python Project",
          description: "Need Python developer",
          skills: ["python", "django"],
          category: "web development",
          subcategory: "backend",
          budget: { type: "fixed", max_amount: 800, currency: "USD" },
          posted_at: new Date(),
          url: "https://upwork.com/job/3",
          source: "rss",
          job_type: "fixed",
        },
      ];

      const ranked = filter.rankProjects(projects);

      expect(ranked[0].id).toBe("2"); // Highest score (more skills, good client)
      expect(ranked[1].id).toBe("1"); // Medium score (one skill match)
      expect(ranked[2].id).toBe("3"); // Lowest score (no skill match)
    });
  });

  describe("getTopProjects", () => {
    it("should return top N projects with scores", () => {
      const criteria: FilterCriteria = {
        skill_keywords: ["typescript"],
        excluded_keywords: [],
        preferred_categories: [],
        min_budget_usd: 100,
        max_budget_usd: 5000,
        hourly_rate_usd: 50,
      };

      const filter = new ProjectFilter(criteria);

      const projects: UpworkProject[] = [
        {
          id: "1",
          title: "TypeScript Project 1",
          description: "Need TypeScript",
          skills: ["typescript"],
          category: "web development",
          subcategory: "frontend",
          budget: { type: "fixed", max_amount: 500, currency: "USD" },
          posted_at: new Date(),
          url: "https://upwork.com/job/1",
          source: "rss",
          job_type: "fixed",
        },
        {
          id: "2",
          title: "TypeScript Project 2",
          description: "Need TypeScript expert",
          skills: ["typescript", "react"],
          category: "web development",
          subcategory: "full stack",
          budget: { type: "fixed", max_amount: 1200, currency: "USD" },
          client: {
            id: "client2",
            rating: 5.0,
            reviews_count: 20,
            verified: true,
            total_spent: 5000,
            jobs_posted: 10,
            hire_rate: 80,
          },
          posted_at: new Date(Date.now() - 1800000),
          url: "https://upwork.com/job/2",
          source: "rss",
          job_type: "fixed",
          proposal_count: 2,
        },
        {
          id: "3",
          title: "TypeScript Project 3",
          description: "Need TypeScript help",
          skills: ["typescript"],
          category: "web development",
          subcategory: "frontend",
          budget: { type: "fixed", max_amount: 400, currency: "USD" },
          posted_at: new Date(),
          url: "https://upwork.com/job/3",
          source: "rss",
          job_type: "fixed",
        },
      ];

      const top2 = filter.getTopProjects(projects, 2);

      expect(top2).toHaveLength(2);
      // Project 2 should have highest score due to more skills, good client, and low competition
      expect(top2[0].project.id).toBe("2");
      expect(top2[0].score.total_score).toBeGreaterThan(top2[1].score.total_score);
      // Verify project 2 has better metrics
      expect(top2[0].score.matched_skills.length).toBeGreaterThanOrEqual(top2[1].score.matched_skills.length);
    });
  });

  describe("estimateEffort", () => {
    it("should estimate effort based on budget and description", () => {
      const criteria: FilterCriteria = {
        skill_keywords: ["typescript"],
        excluded_keywords: [],
        preferred_categories: [],
        min_budget_usd: 100,
        max_budget_usd: 5000,
        hourly_rate_usd: 50,
      };

      const filter = new ProjectFilter(criteria);

      const simpleProject: UpworkProject = {
        id: "1",
        title: "Simple Fix",
        description: "Quick bug fix",
        skills: ["typescript"],
        category: "web development",
        subcategory: "frontend",
        budget: { type: "fixed", max_amount: 200, currency: "USD" },
        posted_at: new Date(),
        url: "https://upwork.com/job/1",
        source: "rss",
        job_type: "fixed",
      };

      const complexProject: UpworkProject = {
        id: "2",
        title: "Complex App",
        description: "A".repeat(2500), // Long description
        skills: ["typescript", "react", "node.js", "graphql", "mongodb", "redis", "docker", "kubernetes", "aws", "git"],
        category: "web development",
        subcategory: "full stack",
        budget: { type: "fixed", max_amount: 2000, currency: "USD" },
        posted_at: new Date(),
        url: "https://upwork.com/job/2",
        source: "rss",
        job_type: "fixed",
      };

      const simpleHours = filter.estimateEffort(simpleProject);
      const complexHours = filter.estimateEffort(complexProject);

      expect(complexHours).toBeGreaterThan(simpleHours);
      expect(simpleHours).toBeGreaterThan(0);
      expect(complexHours).toBeLessThanOrEqual(200);
    });
  });

  describe("skill aliases", () => {
    it("should match skills using aliases", () => {
      const criteria: FilterCriteria = {
        skill_keywords: ["js", "ts", "reactjs"], // Using aliases
        excluded_keywords: [],
        preferred_categories: [],
        min_budget_usd: 100,
        max_budget_usd: 5000,
        hourly_rate_usd: 50,
      };

      const filter = new ProjectFilter(criteria);

      const project: UpworkProject = {
        id: "1",
        title: "JavaScript TypeScript React Developer",
        description: "Need JS, TS, and React expertise",
        skills: ["javascript", "typescript", "react"], // Standard names
        category: "web development",
        subcategory: "frontend",
        budget: { type: "fixed", max_amount: 500, currency: "USD" },
        posted_at: new Date(),
        url: "https://upwork.com/job/1",
        source: "rss",
        job_type: "fixed",
      };

      const score = filter.calculateScore(project);

      expect(score.matched_skills.length).toBeGreaterThan(0);
      expect(score.should_bid).toBe(true);
    });
  });

  describe("DEFAULT_FILTER_CRITERIA", () => {
    it("should have sensible default values", () => {
      expect(DEFAULT_FILTER_CRITERIA.skill_keywords.length).toBeGreaterThan(0);
      expect(DEFAULT_FILTER_CRITERIA.min_budget_usd).toBe(100);
      expect(DEFAULT_FILTER_CRITERIA.max_budget_usd).toBe(5000);
      expect(DEFAULT_FILTER_CRITERIA.hourly_rate_usd).toBe(50);
    });
  });
});
