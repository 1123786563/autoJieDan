/**
 * End-to-end tests for the order workflow
 *
 * Tests the complete flow from project filtering to bid generation to contract evaluation
 */

import { describe, it, expect } from 'vitest';
import {
  ProjectFilter,
  ProjectCandidate,
  DEFAULT_CONFIG,
} from '../../../biz/project-filter';
import {
  BidGenerator,
  BidProposal,
  DEFAULT_BID_CONFIG,
} from '../../../biz/bid-generator';
import {
  ContractEvaluator,
  ContractText,
  RiskLevel,
} from '../../../biz/contract-evaluator';

describe('Order Workflow E2E', () => {
  describe('Complete Order Flow', () => {
    it('should process a good project through the entire workflow', async () => {
      // Step 1: Create a project candidate
      const project: ProjectCandidate = {
        id: 'proj-001',
        title: 'React Dashboard Application',
        description: 'Build a responsive dashboard using React, TypeScript, and Node.js. Need data visualization, user authentication, and real-time updates.',
        skills_required: ['react', 'typescript', 'node.js', 'api'],
        budget_range: {
          type: 'fixed',
          min: 3000,
          max: 5000,
          currency: 'USD',
        },
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        client: {
          id: 'client-001',
          rating: 4.8,
          reviews_count: 25,
          verified: true,
          total_spent: 15000,
          hire_rate: 85,
        },
        metadata: {
          proposal_count: 5,
          posted_date: new Date('2024-01-15').toISOString(),
          category: 'Web Development',
          complexity: 'medium',
        },
      };

      // Step 2: Filter the project
      const filter = new ProjectFilter({
        agent_skills: ['typescript', 'javascript', 'react', 'node.js', 'python', 'golang'],
        min_budget_usd: 1000,
        max_budget_usd: 10000,
        min_client_rating: 4.0,
        max_proposals: 20,
      });
      const filterResult = await filter.score(project);

      // Verify project passes filtering
      expect(filterResult.recommendation).toBe('accept');
      expect(filterResult.total_score).toBeGreaterThan(0.5);
      expect(filterResult.reasoning.filter(r => r.includes('Budget too low') || r.includes('Client rating too low')).length).toBe(0);

      // Step 3: Generate bid
      const bidGenerator = new BidGenerator({
        hourly_rate_usd: 50,
        include_milestones: true,
        include_questions: true,
      });
      const bid: BidProposal = await bidGenerator.generate(project, filterResult);

      // Verify bid generation
      expect(bid.cover_letter).toBeTruthy();
      expect(bid.cover_letter.length).toBeGreaterThan(100);
      expect(bid.bid_amount).toBeGreaterThan(0);
      expect(bid.duration_days).toBeGreaterThan(0);
      expect(bid.strategy).toMatch(/^(competitive|premium|budget)$/);
      expect(bid.milestone_plan).toBeDefined();
      expect(bid.milestone_plan!.length).toBeGreaterThan(0);

      // Step 4: Evaluate contract (simulate contract from client)
      const contractText: ContractText = {
        id: 'contract-001',
        title: 'Dashboard Development Agreement',
        content: `
          This Agreement is between Client and Freelancer.

          1. PAYMENT TERMS
          Payment will be made within 30 days of invoice submission.
          A deposit of 30% is required upon signing.

          2. INTELLECTUAL PROPERTY
          Freelancer retains ownership of pre-existing intellectual property.
          Client receives exclusive license to custom code developed.

          3. LIABILITY
          Liability is limited to the amount paid under this contract.

          4. TERMINATION
          Either party may terminate with 14 days written notice.

          5. DELIVERABLES
          Project includes 2 rounds of revisions for each deliverable.
          Additional revisions will be charged separately.
        `,
      };

      const evaluator = new ContractEvaluator();
      const evaluation = evaluator.evaluate(contractText);

      // Verify contract evaluation
      expect(evaluation.should_accept).toBe(true);
      expect(evaluation.overall_risk).not.toBe(RiskLevel.CRITICAL);
      expect(evaluation.risk_score).toBeLessThan(0.5);

      // Overall workflow validation
      expect(filterResult.recommendation).toBe('accept');
      expect(bid.cover_letter).toBeTruthy();
      expect(evaluation.should_accept).toBe(true);
    });

    it('should reject a high-risk project', async () => {
      // High-risk project with poor client
      const project: ProjectCandidate = {
        id: 'proj-002',
        title: 'Quick Fix Needed',
        description: 'Need a bug fix ASAP, must be done by tomorrow.',
        skills_required: ['javascript', 'bug fixing'],
        budget_range: {
          type: 'fixed',
          max: 100,
          currency: 'USD',
        },
        deadline: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
        client: {
          id: 'client-002',
          rating: 2.5,
          reviews_count: 3,
          verified: false,
        },
        metadata: {
          proposal_count: 25,
          posted_date: new Date('2024-01-15').toISOString(),
        },
      };

      const filter = new ProjectFilter({
        agent_skills: ['typescript', 'javascript'],
        min_budget_usd: 100,
        max_budget_usd: 10000,
        min_client_rating: 4.0,
        max_proposals: 20,
      });
      const filterResult = await filter.score(project);

      // Should be rejected at filtering stage
      expect(['reject', 'consider']).toContain(filterResult.recommendation);
      expect(filterResult.reasoning.length).toBeGreaterThan(0);
    });

    it('should handle a project with risky contract terms', async () => {
      // Good project but risky contract
      const project: ProjectCandidate = {
        id: 'proj-003',
        title: 'E-commerce Platform',
        description: 'Build an e-commerce platform with React and Node.js.',
        skills_required: ['react', 'node.js', 'postgresql'],
        budget_range: {
          type: 'fixed',
          min: 5000,
          max: 8000,
          currency: 'USD',
        },
        client: {
          id: 'client-003',
          rating: 5.0,
          reviews_count: 50,
          verified: true,
          total_spent: 25000,
          hire_rate: 90,
        },
        metadata: {
          posted_date: new Date('2024-01-15').toISOString(),
          complexity: 'medium',
          proposal_count: 5,
        },
      };

      // Passes filter with higher max_budget_usd
      const filter = new ProjectFilter({
        max_budget_usd: 15000,
      });
      const filterResult = await filter.score(project);
      expect(filterResult.recommendation).toBe('accept');

      // Generate bid
      const bidGenerator = new BidGenerator();
      const bid = await bidGenerator.generate(project, filterResult);
      expect(bid.cover_letter).toBeTruthy();

      // Risky contract terms
      const contractText: ContractText = {
        id: 'contract-003',
        title: 'E-commerce Development',
        content: `
          This Agreement is between Client and Freelancer.

          1. PAYMENT TERMS
          Payment will be made within 60 days of invoice.
          No deposit required.

          2. INTELLECTUAL PROPERTY
          Freelancer agrees to transfer all rights, title, and interest in all work product to Client.
          This is a work for hire arrangement with full IP transfer.

          3. LIABILITY
          Freelancer assumes unlimited liability for any and all claims.

          4. TERMINATION
          Client may terminate immediately at any time without cause.

          5. EXCLUSIVITY
          Freelancer agrees not to work with any other clients during the project term.
        `,
      };

      const evaluator = new ContractEvaluator();
      const evaluation = evaluator.evaluate(contractText);

      // Should flag contract risks
      expect(evaluation.should_accept).toBe(false);
      expect(evaluation.deal_breakers.length).toBeGreaterThan(0);
      expect(evaluation.overall_risk).toBe(RiskLevel.CRITICAL);
    });

    it('should handle edge cases in the workflow', async () => {
      // Edge case 1: Missing optional fields
      const minimalProject: ProjectCandidate = {
        id: 'proj-minimal',
        title: 'Simple Task',
        description: 'Need help with a simple task.',
        skills_required: ['javascript'],
        budget_range: {
          type: 'fixed',
          max: 500,
          currency: 'USD',
        },
      };

      const filter = new ProjectFilter();
      const result = await filter.score(minimalProject);
      expect(result).toBeDefined();

      // Edge case 2: Empty contract
      const emptyContract: ContractText = {
        id: 'contract-empty',
        content: '',
      };

      const evaluator = new ContractEvaluator();
      const evaluation = evaluator.evaluate(emptyContract);
      expect(evaluation.risk_score).toBe(0);
      expect(evaluation.should_accept).toBe(true);
    });

    it('should test different budget scenarios', async () => {
      const scenarios = [
        { budget: 50, expected: 'reject' as const, name: 'Too low budget' },
        { budget: 2000, expected: 'accept' as const, name: 'Good budget' },
        { budget: 9000, expected: 'accept' as const, name: 'High budget' },
      ];

      for (const scenario of scenarios) {
        const project: ProjectCandidate = {
          id: `proj-budget-${scenario.budget}`,
          title: scenario.name,
          description: 'Web development project.',
          skills_required: ['react', 'typescript'],
          budget_range: {
            type: 'fixed',
            max: scenario.budget,
            currency: 'USD',
          },
          client: {
            id: `client-${scenario.budget}`,
            rating: 4.5,
            total_spent: 5000,
            verified: true,
          },
          metadata: {
            proposal_count: 5,
            posted_date: new Date().toISOString(),
          },
        };

        const filter = new ProjectFilter({
          min_budget_usd: 100,
          max_budget_usd: 15000,
          min_client_rating: 4.0,
        });
        const result = await filter.score(project);

        if (scenario.expected === 'reject') {
          expect(result.recommendation).toBe('reject');
        } else {
          expect(['accept', 'consider']).toContain(result.recommendation);
        }
      }
    });
  });

  describe('Workflow Integration Scenarios', () => {
    it('should handle a rush project scenario', async () => {
      const project: ProjectCandidate = {
        id: 'proj-rush',
        title: 'Urgent Bug Fix',
        description: 'Critical production bug needs immediate fixing.',
        skills_required: ['javascript'],
        budget_range: {
          type: 'fixed',
          min: 500,
          max: 1500,
          currency: 'USD',
        },
        deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        client: {
          id: 'client-rush',
          rating: 4.0,
        },
        metadata: {
          proposal_count: 2,
          posted_date: new Date().toISOString(),
        },
      };

      const filter = new ProjectFilter({
        min_budget_usd: 100,
        max_proposals: 15,
      });
      const result = await filter.score(project);

      // Rush projects are considered
      expect(result).toBeDefined();
    });

    it('should handle a long-term project scenario', async () => {
      const project: ProjectCandidate = {
        id: 'proj-longterm',
        title: 'Ongoing Development Partnership',
        description: 'Looking for a long-term developer for multiple projects over 6+ months.',
        skills_required: ['python', 'django', 'postgresql'],
        budget_range: {
          type: 'hourly',
          max: 8000,
          currency: 'USD',
        },
        client: {
          id: 'client-longterm',
          rating: 4.9,
          total_spent: 25000,
        },
        metadata: {
          posted_date: new Date().toISOString(),
          complexity: 'medium',
        },
      };

      const filter = new ProjectFilter();
      const result = await filter.score(project);

      // Long-term good client should be attractive
      expect(result.total_score).toBeGreaterThan(0.3);
    });

    it('should handle a new client scenario', async () => {
      const project: ProjectCandidate = {
        id: 'proj-new-client',
        title: 'First Project',
        description: 'New client posting their first project.',
        skills_required: ['react'],
        budget_range: {
          type: 'fixed',
          min: 1000,
          max: 2000,
          currency: 'USD',
        },
        metadata: {
          proposal_count: 0,
          posted_date: new Date().toISOString(),
        },
      };

      const filter = new ProjectFilter({
        min_client_rating: 0,
      });
      const result = await filter.score(project);

      // New client not rejected if rating requirement is low
      expect(result).toBeDefined();
    });
  });

  describe('Workflow Performance', () => {
    it('should process multiple projects efficiently', async () => {
      const projects: ProjectCandidate[] = [];

      for (let i = 0; i < 10; i++) {
        projects.push({
          id: `proj-batch-${i}`,
          title: `Project ${i}`,
          description: `Description for project ${i}`,
          skills_required: ['javascript', 'react'],
          budget_range: {
            type: 'fixed',
            min: 1000 + (i * 500),
            max: 2000 + (i * 500),
            currency: 'USD',
          },
          client: {
            id: `client-${i}`,
            rating: 4.0 + (i % 1.5),
          },
          metadata: {
            proposal_count: i,
            posted_date: new Date().toISOString(),
          },
        });
      }

      const filter = new ProjectFilter();
      const bidGenerator = new BidGenerator();

      const startTime = Date.now();

      // Process all projects
      const results: Array<{
        project: ProjectCandidate;
        filterResult: import('../../../../../biz/project-filter').ProjectScore;
        bid: BidProposal;
      }> = [];

      for (const project of projects) {
        const filterResult = await filter.score(project);
        const bid = await bidGenerator.generate(project, filterResult);
        results.push({ project, filterResult, bid });
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should process efficiently (< 5 seconds for 10 projects)
      expect(duration).toBeLessThan(5000);
      expect(results).toHaveLength(10);
    });
  });

  describe('Configuration Defaults', () => {
    it('should have sensible default configurations', () => {
      // Check ProjectFilter defaults
      expect(DEFAULT_CONFIG.agent_skills.length).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.min_budget_usd).toBe(100);
      expect(DEFAULT_CONFIG.max_budget_usd).toBe(10000);
      expect(DEFAULT_CONFIG.hourly_rate_usd).toBe(50);

      // Check BidGenerator defaults
      expect(DEFAULT_BID_CONFIG.agent_name).toBeTruthy();
      expect(DEFAULT_BID_CONFIG.hourly_rate_usd).toBe(50);
      expect(DEFAULT_BID_CONFIG.include_milestones).toBe(true);
      expect(DEFAULT_BID_CONFIG.include_questions).toBe(true);
    });
  });
});
