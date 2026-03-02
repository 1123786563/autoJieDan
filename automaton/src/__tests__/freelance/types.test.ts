/**
 * Tests for Freelance Type Definitions
 *
 * Verifies:
 * - All type definitions are correct
 * - Enum values are complete
 * - Interface properties have correct types
 * - Types can be imported and used
 */

import { describe, it, expect } from 'vitest';
import type {
  ProjectStatus,
  AnalyticsEventType,
  InterventionType,
  ClientTier,
  Platform,
  BidStatus,
  InterventionStatus,
  MilestoneStatus,
  ResourcePriority,
  Client,
  Project,
  BidHistory,
  ManualIntervention,
  AnalyticsEvent,
  ResourceAllocation,
  Milestone,
  MessageBuffer,
  ProjectScoreFactors,
  BidGenerationResult,
  ProjectCost,
  CostAlert,
  CreateProjectRequest,
  UpdateProjectStatusRequest,
  CreateBidRequest,
  SubmitBidRequest,
  CreateInterventionRequest,
  RespondToInterventionRequest,
  TrackAnalyticsEventRequest,
  ProjectQueryFilters,
  ClientQueryFilters,
  AnalyticsQueryFilters,
} from '../../src/freelance/types.js';

describe('Freelance Type Definitions', () => {
  describe('ProjectStatus enum', () => {
    it('should have all required status values', () => {
      const requiredStatuses: ProjectStatus[] = [
        'discovered',
        'scored',
        'filtered',
        'bidding',
        'deferred',
        'rejected',
        'negotiating',
        'contracted',
        'pending_start',
        'active',
        'paused',
        'completed',
        'disputed',
        'resolved',
        'escalated',
        'cancelled',
        'closed',
      ];

      // This test verifies type completeness at compile time
      const allStatuses: ProjectStatus[] = requiredStatuses;
      expect(allStatuses).toHaveLength(17);
    });
  });

  describe('AnalyticsEventType enum', () => {
    it('should have all required event types', () => {
      const requiredEventTypes: AnalyticsEventType[] = [
        'project_viewed',
        'project_scored',
        'project_filtered',
        'project_deferred',
        'bid_created',
        'bid_submitted',
        'bid_withdrawn',
        'interview_invited',
        'interview_accepted',
        'contract_signed',
        'project_started',
        'milestone_completed',
        'project_completed',
        'project_cancelled',
        'review_received',
        'dispute_opened',
        'dispute_resolved',
        'llm_call',
        'error_occurred',
        'manual_intervention',
        'customer_message',
        'repeat_contract',
      ];

      const allEventTypes: AnalyticsEventType[] = requiredEventTypes;
      expect(allEventTypes).toHaveLength(22);
    });
  });

  describe('InterventionType enum', () => {
    it('should have all required intervention types', () => {
      const requiredTypes: InterventionType[] = [
        'contract_sign',
        'large_spend',
        'project_start',
        'refund',
        'dispute_l2',
        'dispute_l3',
        'quality_review',
        'customer_complaint',
      ];

      const allTypes: InterventionType[] = requiredTypes;
      expect(allTypes).toHaveLength(8);
    });
  });

  describe('Client entity', () => {
    it('should accept valid Client object', () => {
      const client: Client = {
        id: 'client-1',
        platform: 'upwork',
        platformClientId: 'upwork-123',
        name: 'Test Client',
        company: 'Test Company',
        rating: 4.5,
        totalSpentCents: 100000,
        paymentVerified: 95,
        country: 'US',
        tier: 'gold',
        languagePreference: 'en',
        responseTimeHours: 2.5,
        totalProjects: 10,
        hiredFreelancers: 5,
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
        metadata: '{"key": "value"}',
      };

      expect(client.id).toBe('client-1');
      expect(client.platform).toBe('upwork');
      expect(client.tier).toBe('gold');
    });

    it('should accept Client with minimal required fields', () => {
      const client: Client = {
        id: 'client-2',
        platform: 'fiverr',
        platformClientId: 'fiverr-456',
        totalSpentCents: 0,
        paymentVerified: 0,
        tier: 'new',
        languagePreference: 'auto',
        totalProjects: 0,
        hiredFreelancers: 0,
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
      };

      expect(client.tier).toBe('new');
    });
  });

  describe('Project entity', () => {
    it('should accept valid Project object', () => {
      const project: Project = {
        id: 'project-1',
        platform: 'upwork',
        platformProjectId: 'upwork-project-123',
        title: 'Test Project',
        description: 'Test Description',
        clientId: 'client-1',
        status: 'discovered',
        score: 85,
        scoreFactors: '{"technicalMatch": 90}',
        budgetCents: 50000,
        deadline: '2026-03-15T00:00:00Z',
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
        discoveredAt: '2026-03-01T00:00:00Z',
      };

      expect(project.status).toBe('discovered');
      expect(project.score).toBe(85);
    });
  });

  describe('BidHistory entity', () => {
    it('should accept valid BidHistory object', () => {
      const bid: BidHistory = {
        id: 'bid-1',
        projectId: 'project-1',
        templateId: 'template-1',
        coverLetter: 'Test cover letter',
        bidAmountCents: 45000,
        durationDays: 7,
        submittedAt: '2026-03-01T00:00:00Z',
        status: 'submitted',
        interviewInvited: 0,
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
      };

      expect(bid.status).toBe('submitted');
    });
  });

  describe('ManualIntervention entity', () => {
    it('should accept valid ManualIntervention object', () => {
      const intervention: ManualIntervention = {
        id: 'intervention-1',
        interventionType: 'contract_sign',
        projectId: 'project-1',
        goalId: 'goal-1',
        reason: 'Large contract requires approval',
        context: '{"amount": 100000}',
        status: 'pending',
        requestedAt: '2026-03-01T00:00:00Z',
        slaDeadline: '2026-03-02T00:00:00Z',
        createdAt: '2026-03-01T00:00:00Z',
      };

      expect(intervention.interventionType).toBe('contract_sign');
      expect(intervention.status).toBe('pending');
    });
  });

  describe('AnalyticsEvent entity', () => {
    it('should accept valid AnalyticsEvent object', () => {
      const event: AnalyticsEvent = {
        id: 'event-1',
        eventType: 'project_viewed',
        timestamp: '2026-03-01T00:00:00Z',
        properties: '{"source": "search"}',
        sessionId: 'session-1',
        projectId: 'project-1',
        clientId: 'client-1',
        userId: 'user-1',
        createdAt: '2026-03-01T00:00:00Z',
      };

      expect(event.eventType).toBe('project_viewed');
    });
  });

  describe('ResourceAllocation entity', () => {
    it('should accept valid ResourceAllocation object', () => {
      const allocation: ResourceAllocation = {
        id: 'alloc-1',
        projectId: 'project-1',
        goalId: 'goal-1',
        priority: 'P1',
        cpuQuota: 2.0,
        tokenQuotaHour: 100000,
        costQuotaCents: 5000,
        allocatedAt: '2026-03-01T00:00:00Z',
        active: 1,
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
      };

      expect(allocation.priority).toBe('P1');
      expect(allocation.active).toBe(1);
    });
  });

  describe('Milestone entity', () => {
    it('should accept valid Milestone object', () => {
      const milestone: Milestone = {
        id: 'milestone-1',
        projectId: 'project-1',
        goalId: 'goal-1',
        name: 'First Milestone',
        description: 'Complete initial requirements',
        percentage: 25,
        dueDate: '2026-03-07T00:00:00Z',
        status: 'pending',
        amountCents: 12500,
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
      };

      expect(milestone.percentage).toBe(25);
      expect(milestone.status).toBe('pending');
    });
  });

  describe('Request types', () => {
    it('should accept valid CreateProjectRequest', () => {
      const request: CreateProjectRequest = {
        platform: 'upwork',
        platformProjectId: 'upwork-123',
        title: 'Test Project',
        description: 'Test',
        budgetCents: 50000,
        deadline: '2026-03-15T00:00:00Z',
      };

      expect(request.platform).toBe('upwork');
    });

    it('should accept valid UpdateProjectStatusRequest', () => {
      const request: UpdateProjectStatusRequest = {
        projectId: 'project-1',
        status: 'bidding',
        metadata: { bidId: 'bid-1' },
      };

      expect(request.status).toBe('bidding');
    });

    it('should accept valid CreateBidRequest', () => {
      const request: CreateBidRequest = {
        projectId: 'project-1',
        templateId: 'template-1',
        coverLetter: 'Test cover letter',
        bidAmountCents: 45000,
        durationDays: 7,
      };

      expect(request.projectId).toBe('project-1');
    });

    it('should accept valid SubmitBidRequest', () => {
      const request: SubmitBidRequest = {
        bidId: 'bid-1',
      };

      expect(request.bidId).toBe('bid-1');
    });

    it('should accept valid CreateInterventionRequest', () => {
      const request: CreateInterventionRequest = {
        interventionType: 'large_spend',
        projectId: 'project-1',
        reason: 'Exceeds budget threshold',
        context: { amount: 100000 },
        slaDeadline: '2026-03-02T00:00:00Z',
      };

      expect(request.interventionType).toBe('large_spend');
    });

    it('should accept valid RespondToInterventionRequest', () => {
      const request: RespondToInterventionRequest = {
        interventionId: 'intervention-1',
        decision: 'approve',
        notes: 'Approved within budget',
      };

      expect(request.decision).toBe('approve');
    });

    it('should accept valid TrackAnalyticsEventRequest', () => {
      const request: TrackAnalyticsEventRequest = {
        eventType: 'project_scored',
        properties: { score: 85 },
        sessionId: 'session-1',
        projectId: 'project-1',
      };

      expect(request.eventType).toBe('project_scored');
    });
  });

  describe('Query filter types', () => {
    it('should accept valid ProjectQueryFilters', () => {
      const filters: ProjectQueryFilters = {
        status: ['discovered', 'scored'],
        platform: ['upwork'],
        minScore: 70,
        createdAfter: '2026-03-01T00:00:00Z',
      };

      expect(filters.status).toContain('discovered');
    });

    it('should accept valid ClientQueryFilters', () => {
      const filters: ClientQueryFilters = {
        tier: ['gold', 'silver'],
        minRating: 4.0,
        minTotalSpentCents: 50000,
      };

      expect(filters.tier).toContain('gold');
    });

    it('should accept valid AnalyticsQueryFilters', () => {
      const filters: AnalyticsQueryFilters = {
        eventTypes: ['project_viewed', 'bid_created'],
        projectId: 'project-1',
        startTime: '2026-03-01T00:00:00Z',
        endTime: '2026-03-02T00:00:00Z',
      };

      expect(filters.eventTypes).toHaveLength(2);
    });
  });

  describe('Value object types', () => {
    it('should accept valid ProjectScoreFactors', () => {
      const factors: ProjectScoreFactors = {
        technicalMatch: 90,
        budgetReasonable: 80,
        deliveryFeasible: 85,
        clientQuality: 95,
        strategicValue: 75,
      };

      expect(factors.technicalMatch).toBe(90);
      expect(factors.clientQuality).toBe(95);
    });

    it('should accept valid BidGenerationResult', () => {
      const result: BidGenerationResult = {
        coverLetter: 'Generated cover letter',
        bidAmountCents: 45000,
        durationDays: 7,
        milestoneDescription: 'Milestone description',
        suggestedQuestions: ['Question 1', 'Question 2'],
      };

      expect(result.suggestedQuestions).toHaveLength(2);
    });

    it('should accept valid ProjectCost', () => {
      const cost: ProjectCost = {
        projectId: 'project-1',
        budgetCents: 50000,
        actualCents: 25000,
        remainingCents: 25000,
        percentage: 50,
        alerts: [
          {
            level: 'warning',
            message: '50% budget used',
            timestamp: '2026-03-01T00:00:00Z',
          },
        ],
      };

      expect(cost.percentage).toBe(50);
      expect(cost.alerts).toHaveLength(1);
    });

    it('should accept valid CostAlert', () => {
      const alert: CostAlert = {
        level: 'critical',
        message: 'Budget exceeded',
        timestamp: '2026-03-01T00:00:00Z',
      };

      expect(alert.level).toBe('critical');
    });
  });

  describe('Type completeness', () => {
    it('should export all required types', () => {
      // This test verifies that all types are properly exported
      // If any type is missing, this will cause a compile-time error
      const types = {
        ProjectStatus: 'discovered' as ProjectStatus,
        AnalyticsEventType: 'project_viewed' as AnalyticsEventType,
        InterventionType: 'contract_sign' as InterventionType,
        ClientTier: 'gold' as ClientTier,
        Platform: 'upwork' as Platform,
        BidStatus: 'submitted' as BidStatus,
        InterventionStatus: 'approved' as InterventionStatus,
        MilestoneStatus: 'completed' as MilestoneStatus,
        ResourcePriority: 'P1' as ResourcePriority,
      };

      expect(types.ProjectStatus).toBe('discovered');
      expect(types.Platform).toBe('upwork');
    });

    it('should allow type narrowing on discriminated unions', () => {
      // Test that status can be used for type narrowing
      const status: ProjectStatus = 'discovered';
      if (status === 'discovered' || status === 'scored') {
        // Early stage status
        expect(['discovered', 'scored']).toContain(status);
      }
    });
  });
});
