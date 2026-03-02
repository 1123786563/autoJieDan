/**
 * Tests for Analytics Collector
 *
 * Verifies:
 * - Event tracking and buffering
 * - Batch flush mechanism
 * - Auto-flush timer
 * - Convenience tracking methods
 * - Stop behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnalyticsCollector, TrackParams } from '../../src/freelance/analytics.js';
import { FreelanceRepository } from '../../src/freelance/repository.js';

// Mock the repository
vi.mock('../../src/freelance/repository.js');

describe('AnalyticsCollector', () => {
  let mockRepository: vi.Mocked<FreelanceRepository>;
  let collector: AnalyticsCollector;

  beforeEach(() => {
    mockRepository = {
      recordEvents: vi.fn(),
    } as unknown as vi.Mocked<FreelanceRepository>;

    // Create collector with small batch size for testing
    collector = new AnalyticsCollector(mockRepository, {
      batchSize: 3,
      maxWaitMs: 1000,
    });
  });

  afterEach(() => {
    collector.stop();
  });

  describe('track', () => {
    it('should buffer events without immediate flush', () => {
      collector.track({
        eventType: 'project_viewed',
        projectId: 'project-1',
      });

      expect(collector.getBufferSize()).toBe(1);
      expect(mockRepository.recordEvents).not.toHaveBeenCalled();
    });

    it('should auto-flush when batch size reached', () => {
      collector.track({ eventType: 'event1', projectId: 'p1' });
      collector.track({ eventType: 'event2', projectId: 'p2' });
      collector.track({ eventType: 'event3', projectId: 'p3' });

      expect(mockRepository.recordEvents).toHaveBeenCalledTimes(1);
      expect(mockRepository.recordEvents).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ eventType: 'event1' }),
          expect.objectContaining({ eventType: 'event2' }),
          expect.objectContaining({ eventType: 'event3' }),
        ])
      );
      expect(collector.getBufferSize()).toBe(0);
    });

    it('should throw error when tracking after stop', () => {
      collector.stop();

      expect(() => {
        collector.track({ eventType: 'event1' });
      }).toThrow('AnalyticsCollector is stopped');
    });
  });

  describe('flush', () => {
    it('should flush buffered events to repository', () => {
      collector.track({ eventType: 'event1', projectId: 'p1' });
      collector.track({ eventType: 'event2', projectId: 'p2' });

      collector.flush();

      expect(mockRepository.recordEvents).toHaveBeenCalledTimes(1);
      expect(mockRepository.recordEvents).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ eventType: 'event1' }),
          expect.objectContaining({ eventType: 'event2' }),
        ])
      );
      expect(collector.getBufferSize()).toBe(0);
    });

    it('should not flush empty buffer', () => {
      collector.flush();

      expect(mockRepository.recordEvents).not.toHaveBeenCalled();
    });

    it('should handle flush during flush gracefully', () => {
      collector.track({ eventType: 'event1' });

      // Mock recordEvents to call flush recursively
      mockRepository.recordEvents.mockImplementationOnce(() => {
        collector.flush(); // Recursive flush
      });

      collector.flush();

      // Should only call recordEvents once
      expect(mockRepository.recordEvents).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop', () => {
    it('should stop the collector and flush remaining events', () => {
      collector.track({ eventType: 'event1' });

      collector.stop();

      expect(mockRepository.recordEvents).toHaveBeenCalledTimes(1);
      expect(collector.isStopped()).toBe(true);
    });

    it('should not allow double stop', () => {
      collector.stop();
      collector.stop();

      expect(mockRepository.recordEvents).toHaveBeenCalledTimes(0);
    });
  });

  describe('convenience methods', () => {
    it('should track project_viewed event', () => {
      collector.trackProjectViewed({
        projectId: 'project-1',
        clientId: 'client-1',
      });

      expect(collector.getBufferSize()).toBe(1);
    });

    it('should track project_scored event with properties', () => {
      collector.trackProjectScored({
        projectId: 'project-1',
        score: 85,
        scoreRange: 'high',
      });

      expect(collector.getBufferSize()).toBe(1);
    });

    it('should track bid_created event', () => {
      collector.trackBidCreated({
        projectId: 'project-1',
        templateId: 'template-1',
      });

      expect(collector.getBufferSize()).toBe(1);
    });

    it('should track bid_submitted event', () => {
      collector.trackBidSubmitted({
        projectId: 'project-1',
        bidId: 'bid-1',
        bidAmountCents: 45000,
      });

      expect(collector.getBufferSize()).toBe(1);
    });

    it('should track llm_call event', () => {
      collector.trackLLMCall({
        model: 'gpt-4',
        tokensUsed: 1000,
        costCents: 5,
        durationMs: 500,
      });

      expect(collector.getBufferSize()).toBe(1);
    });

    it('should track error_occurred event', () => {
      collector.trackError({
        errorCode: 'API_ERROR',
        errorMessage: 'Connection failed',
        severity: 'high',
      });

      expect(collector.getBufferSize()).toBe(1);
    });

    it('should track manual_intervention event', () => {
      collector.trackManualIntervention({
        interventionType: 'contract_sign',
        projectId: 'project-1',
        reason: 'Large contract requires approval',
      });

      expect(collector.getBufferSize()).toBe(1);
    });
  });

  describe('auto-flush timer', () => {
    it('should auto-flush after maxWaitMs', async () => {
      vi.useFakeTimers();

      const localCollector = new AnalyticsCollector(mockRepository, {
        batchSize: 100,
        maxWaitMs: 1000,
      });

      localCollector.track({ eventType: 'event1' });

      // Advance time but not enough to trigger flush
      vi.advanceTimersByTime(500);
      expect(mockRepository.recordEvents).not.toHaveBeenCalled();

      // Advance time past threshold
      vi.advanceTimersByTime(600);
      expect(mockRepository.recordEvents).toHaveBeenCalledTimes(1);

      localCollector.stop();
      vi.useRealTimers();
    });
  });

  describe('configuration', () => {
    it('should use default batch size of 100', () => {
      const defaultCollector = new AnalyticsCollector(mockRepository);

      // Add 99 events - should not flush
      for (let i = 0; i < 99; i++) {
        defaultCollector.track({ eventType: `event${i}` });
      }
      expect(mockRepository.recordEvents).not.toHaveBeenCalled();

      // Add 1 more to reach 100
      defaultCollector.track({ eventType: 'event100' });
      expect(mockRepository.recordEvents).toHaveBeenCalledTimes(1);

      defaultCollector.stop();
    });

    it('should use default maxWaitMs of 5000', () => {
      vi.useFakeTimers();

      const defaultCollector = new AnalyticsCollector(mockRepository);

      defaultCollector.track({ eventType: 'event1' });

      // Advance 4999ms - should not flush
      vi.advanceTimersByTime(4999);
      expect(mockRepository.recordEvents).not.toHaveBeenCalled();

      // Advance 2ms to reach 5001ms total
      vi.advanceTimersByTime(2);
      expect(mockRepository.recordEvents).toHaveBeenCalledTimes(1);

      defaultCollector.stop();
      vi.useRealTimers();
    });
  });
});
