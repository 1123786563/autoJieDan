/**
 * ProjectScorer Tests
 */

import { describe, it, expect } from 'vitest';
import {
  ProjectScorer,
  createProjectScorer,
  type UpworkJob,
  type ClientInfo,
  type BudgetInfo,
} from '../../upwork/scorer.js';

describe('ProjectScorer', () => {
  const scorer = createProjectScorer();

  const createMockJob = (
    overrides: Partial<UpworkJob> = {}
  ): UpworkJob => {
    const defaultClient: ClientInfo = {
      id: 'client-1',
      name: 'Test Client',
      companySize: 50,
      totalSpent: 10000,
      paymentVerificationRate: 0.95,
      averageRating: 4.5,
      totalJobsPosted: 10,
      hireRate: 0.8,
      averageResponseTime: 6,
      verified: true,
    };

    const defaultBudget: BudgetInfo = {
      type: 'fixed',
      minAmount: 3000,
      maxAmount: 5000,
      currency: 'USD',
    };

    const defaultJob: UpworkJob = {
      id: 'job-1',
      title: 'React Web Development',
      description: 'Build a React web application',
      requiredSkills: ['React', 'TypeScript', 'Node.js'],
      budget: defaultBudget,
      deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
      complexity: 'medium',
      client: defaultClient,
      postedAt: new Date().toISOString(),
    };

    return { ...defaultJob, ...overrides };
  };

  describe('scoreProject', () => {
    it('should return a complete ProjectScore object', () => {
      const job = createMockJob();
      const score = scorer.scoreProject(job);

      expect(score).toHaveProperty('total');
      expect(score).toHaveProperty('factors');
      expect(score).toHaveProperty('recommendation');
      expect(score).toHaveProperty('reasons');
      expect(score.total).toBeGreaterThanOrEqual(0);
      expect(score.total).toBeLessThanOrEqual(100);
    });

    it('should recommend auto_bid for high-quality projects', () => {
      const job = createMockJob({
        requiredSkills: ['React', 'TypeScript', 'Next.js'],
        budget: {
          type: 'fixed',
          minAmount: 5000,
          maxAmount: 10000,
          currency: 'USD',
        },
        client: {
          id: 'client-1',
          name: 'Ideal Client',
          companySize: 50,
          totalSpent: 20000,
          paymentVerificationRate: 1.0,
          averageRating: 5.0,
          totalJobsPosted: 20,
          hireRate: 0.9,
          averageResponseTime: 2,
          verified: true,
        },
      });

      const score = scorer.scoreProject(job);
      expect(score.total).toBeGreaterThan(80);
      expect(score.recommendation).toBe('auto_bid');
    });

    it('should recommend reject for low-quality projects', () => {
      const job = createMockJob({
        requiredSkills: ['Unity', 'Game Development'],
        budget: {
          type: 'fixed',
          minAmount: 100,
          maxAmount: 200,
          currency: 'USD',
        },
        client: {
          id: 'client-2',
          name: 'Low Quality Client',
          companySize: 600,
          totalSpent: 100,
          paymentVerificationRate: 0.3,
          averageRating: 2.0,
          totalJobsPosted: 1,
          hireRate: 0.1,
          averageResponseTime: 48,
          verified: false,
        },
      });

      const score = scorer.scoreProject(job);
      expect(score.recommendation).toBe('reject');
    });
  });

  describe('calculateTechMatch', () => {
    it('should return 100 for perfect core skill match', () => {
      const score = scorer.calculateTechMatch(['React', 'TypeScript', 'Node.js']);
      expect(score).toBeGreaterThan(80);
    });

    it('should return low score for excluded skills', () => {
      const score = scorer.calculateTechMatch(['Unity', 'Game Development']);
      expect(score).toBeLessThan(50);
    });

    it('should return 50 for empty skills array', () => {
      const score = scorer.calculateTechMatch([]);
      expect(score).toBe(50);
    });
  });

  describe('calculateBudgetScore', () => {
    it('should return 100 for ideal fixed budget range ($1000-$30000)', () => {
      const budget: BudgetInfo = {
        type: 'fixed',
        minAmount: 5000,
        maxAmount: 10000,
        currency: 'USD',
      };
      const score = scorer.calculateBudgetScore(budget);
      expect(score).toBe(100);
    });

    it('should return 0 for very low budget (<$500)', () => {
      const budget: BudgetInfo = {
        type: 'fixed',
        minAmount: 100,
        maxAmount: 300,
        currency: 'USD',
      };
      const score = scorer.calculateBudgetScore(budget);
      expect(score).toBe(0);
    });

    it('should return 100 for ideal hourly rate ($80-$150)', () => {
      const budget: BudgetInfo = {
        type: 'hourly',
        hourlyRateMin: 80,
        hourlyRateMax: 120,
        currency: 'USD',
      };
      const score = scorer.calculateBudgetScore(budget);
      expect(score).toBe(100);
    });
  });

  describe('calculateDeliveryFeasibility', () => {
    it('should return 100 for ample time', () => {
      const deadline = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days
      const score = scorer.calculateDeliveryFeasibility(deadline, 'medium');
      expect(score).toBe(100);
    });

    it('should return 0 for past deadline', () => {
      const deadline = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
      const score = scorer.calculateDeliveryFeasibility(deadline, 'low');
      expect(score).toBe(0);
    });

    it('should return 80 for no deadline', () => {
      const score = scorer.calculateDeliveryFeasibility(undefined, 'medium');
      expect(score).toBe(80);
    });
  });

  describe('calculateICP', () => {
    it('should return high score for ideal client', () => {
      const client: ClientInfo = {
        id: 'client-1',
        name: 'Ideal Client',
        companySize: 50,
        totalSpent: 15000,
        paymentVerificationRate: 0.98,
        averageRating: 4.8,
        totalJobsPosted: 15,
        hireRate: 0.85,
        averageResponseTime: 4,
        verified: true,
      };
      const score = scorer.calculateICP(client);
      expect(score).toBeGreaterThan(80);
    });

    it('should return low score for non-ideal client', () => {
      const client: ClientInfo = {
        id: 'client-2',
        name: 'Non-Ideal Client',
        companySize: 600,
        totalSpent: 200,
        paymentVerificationRate: 0.5,
        averageRating: 2.5,
        totalJobsPosted: 1,
        hireRate: 0.2,
        averageResponseTime: 48,
        verified: false,
      };
      const score = scorer.calculateICP(client);
      expect(score).toBeLessThan(60);
    });
  });
});
