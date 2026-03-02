/**
 * Analytics Collector - Event Tracking with Batch Processing
 *
 * Collects analytics events in memory and flushes them to the database
 * in batches for performance optimization. Includes auto-flush based on
 * time thresholds and convenience methods for common event types.
 *
 * References:
 * - docs/implementation-plan.md section 4
 * - automaton/src/freelance/repository.ts
 */

import { FreelanceRepository } from './repository.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface AnalyticsCollectorConfig {
  /** Number of events to accumulate before auto-flush */
  batchSize?: number;
  /** Maximum time to wait before flushing (ms) */
  maxWaitMs?: number;
}

// ============================================================================
// TRACKING PARAMETERS
// ============================================================================

export interface TrackParams {
  /** Event type (AnalyticsEventType) */
  eventType: string;
  /** Optional timestamp (defaults to now) */
  timestamp?: string;
  /** Optional JSON properties */
  properties?: Record<string, unknown>;
  /** Optional session ID */
  sessionId?: string;
  /** Optional project ID */
  projectId?: string;
  /** Optional client ID */
  clientId?: string;
  /** Optional user ID */
  userId?: string;
}

// ============================================================================
// ANALYTICS COLLECTOR CLASS
// ============================================================================

export class AnalyticsCollector {
  private repository: FreelanceRepository;
  private config: Required<AnalyticsCollectorConfig>;

  // Event buffer
  private buffer: TrackParams[] = [];

  // Timer for auto-flush
  private flushTimer: NodeJS.Timeout | null = null;

  // State flags
  private stopped = false;
  private flushInProgress = false;

  constructor(repository: FreelanceRepository, config: AnalyticsCollectorConfig = {}) {
    this.repository = repository;
    this.config = {
      batchSize: config.batchSize || 100,
      maxWaitMs: config.maxWaitMs || 5000,
    };

    // Start auto-flush timer
    this.startFlushTimer();
  }

  // ==========================================================================
  // CORE TRACKING METHODS
  // ==========================================================================

  /**
   * Track an analytics event
   *
   * Events are buffered in memory and flushed to the database when:
   * - Buffer reaches batchSize
   * - maxWaitMs time elapses
   * - flush() is called manually
   *
   * @param params - Event tracking parameters
   */
  track(params: TrackParams): void {
    if (this.stopped) {
      throw new Error('AnalyticsCollector is stopped. Cannot track new events.');
    }

    // Add to buffer
    this.buffer.push(params);

    // Auto-flush if buffer is full
    if (this.buffer.length >= this.config.batchSize) {
      this.flush();
    }
  }

  /**
   * Manually flush buffered events to database
   *
   * This method is safe to call multiple times. If a flush is already
   * in progress, it will be skipped.
   */
  flush(): void {
    if (this.stopped || this.flushInProgress) {
      return;
    }

    if (this.buffer.length === 0) {
      return;
    }

    this.flushInProgress = true;

    try {
      // Convert TrackParams to repository format
      const events = this.buffer.map(params => ({
        eventType: params.eventType,
        timestamp: params.timestamp,
        properties: params.properties ? JSON.stringify(params.properties) : undefined,
        sessionId: params.sessionId,
        projectId: params.projectId,
        clientId: params.clientId,
        userId: params.userId,
      }));

      // Batch insert to database
      this.repository.recordEvents(events);

      // Clear buffer
      this.buffer = [];
    } finally {
      this.flushInProgress = false;
    }
  }

  /**
   * Stop the collector and flush remaining events
   *
   * After calling stop(), no new events can be tracked.
   * Any remaining events in the buffer are flushed before stopping.
   */
  stop(): void {
    if (this.stopped) {
      return;
    }

    this.stopped = true;

    // Stop auto-flush timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining events
    this.flush();
  }

  // ==========================================================================
  // CONVENIENCE METHODS
  // ==========================================================================

  /**
   * Track project viewed event
   */
  trackProjectViewed(params: { projectId: string; clientId?: string }): void {
    this.track({
      eventType: 'project_viewed',
      projectId: params.projectId,
      clientId: params.clientId,
    });
  }

  /**
   * Track project scored event
   */
  trackProjectScored(params: {
    projectId: string;
    score: number;
    scoreRange: string;
  }): void {
    this.track({
      eventType: 'project_scored',
      projectId: params.projectId,
      properties: {
        score: params.score,
        scoreRange: params.scoreRange,
      },
    });
  }

  /**
   * Track bid created event
   */
  trackBidCreated(params: { projectId: string; templateId?: string }): void {
    this.track({
      eventType: 'bid_created',
      projectId: params.projectId,
      properties: {
        templateId: params.templateId,
      },
    });
  }

  /**
   * Track bid submitted event
   */
  trackBidSubmitted(params: {
    projectId: string;
    bidId: string;
    bidAmountCents: number;
  }): void {
    this.track({
      eventType: 'bid_submitted',
      projectId: params.projectId,
      properties: {
        bidId: params.bidId,
        bidAmountCents: params.bidAmountCents,
      },
    });
  }

  /**
   * Track LLM API call event
   */
  trackLLMCall(params: {
    model: string;
    tokensUsed: number;
    costCents: number;
    durationMs: number;
  }): void {
    this.track({
      eventType: 'llm_call',
      properties: {
        model: params.model,
        tokensUsed: params.tokensUsed,
        costCents: params.costCents,
        durationMs: params.durationMs,
      },
    });
  }

  /**
   * Track error event
   */
  trackError(params: {
    errorCode: string;
    errorMessage: string;
    severity: string;
  }): void {
    this.track({
      eventType: 'error_occurred',
      properties: {
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
        severity: params.severity,
      },
    });
  }

  /**
   * Track manual intervention event
   */
  trackManualIntervention(params: {
    interventionType: string;
    projectId?: string;
    reason: string;
  }): void {
    this.track({
      eventType: 'manual_intervention',
      projectId: params.projectId,
      properties: {
        interventionType: params.interventionType,
        reason: params.reason,
      },
    });
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  /**
   * Start auto-flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      this.flush();
      // Restart timer after flush
      if (!this.stopped) {
        this.startFlushTimer();
      }
    }, this.config.maxWaitMs);
  }

  /**
   * Get current buffer size (useful for testing/monitoring)
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Check if collector is stopped
   */
  isStopped(): boolean {
    return this.stopped;
  }
}
