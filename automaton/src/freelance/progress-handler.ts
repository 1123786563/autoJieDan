/**
 * Progress Report Handler - Process Progress Reports from Nanobot
 *
 * Handles progress reports from Nanobot, including:
 * - Updating goal progress in the database
 * - Recording analytics events
 * - Creating interventions for blockers
 * - Sending acknowledgments back to Nanobot
 *
 * References:
 * - docs/implementation-plan.md section 3.2 (task 1B-03)
 * - automaton/src/anp/freelance-message-types.ts
 * - automaton/src/freelance/types.ts
 */

import { ulid } from 'ulid';
import type {
  FreelanceProgressReportPayload,
  ProgressReportAckPayload,
} from '../anp/freelance-message-types.js';
import type { ProgressReportPayload } from '../anp/types.js';
import type { ManualIntervention, InterventionType } from './types.js';
import { FreelanceRepository } from './repository.js';
import { AnalyticsCollector } from './analytics.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Goal entity for progress tracking
 */
export interface Goal {
  id: string;
  projectId: string;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'paused';
  progress: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Progress report handler configuration
 */
export interface ProgressReportHandlerConfig {
  /** Blocker thresholds */
  blockerThresholds?: {
    /** Number of blockers before creating intervention */
    count: number;
    /** Severity levels that require intervention */
    severities: string[];
  };
  /** Progress thresholds for alerts */
  progressAlerts?: {
    /** Alert when progress stalls for this many milliseconds */
    stallDurationMs: number;
    /** Alert when ETA is exceeded by this much */
    etaExceededMs: number;
  };
}

// ============================================================================
// PROGRESS REPORT HANDLER
// ============================================================================

/**
 * Handler for progress reports from Nanobot
 *
 * Responsibilities:
 * - Parse and validate progress report messages
 * - Update goal progress in database
 * - Record analytics events
 * - Create interventions for blockers
 * - Return acknowledgment to Nanobot
 */
export class ProgressReportHandler {
  private repository: FreelanceRepository;
  private analytics: AnalyticsCollector;
  private config: Required<ProgressReportHandlerConfig>;

  // In-memory goal progress tracking (in production, use database)
  private goalProgress: Map<string, { progress: number; lastUpdate: number }> = new Map();

  constructor(
    repository: FreelanceRepository,
    analytics: AnalyticsCollector,
    config: ProgressReportHandlerConfig = {}
  ) {
    this.repository = repository;
    this.analytics = analytics;
    this.config = {
      blockerThresholds: config.blockerThresholds || {
        count: 1, // Any blocker triggers intervention
        severities: ['critical', 'high'],
      },
      progressAlerts: config.progressAlerts || {
        stallDurationMs: 30 * 60 * 1000, // 30 minutes
        etaExceededMs: 60 * 60 * 1000, // 1 hour
      },
    };
  }

  // ==========================================================================
  // PUBLIC METHODS
  // ==========================================================================

  /**
   * Handle a progress report from Nanobot
   *
   * @param report - The progress report payload
   * @returns Acknowledgment payload to send back to Nanobot
   */
  async handleProgressReport(
    report: FreelanceProgressReportPayload | ProgressReportPayload
  ): Promise<ProgressReportAckPayload> {
    const reportId = ulid();
    const taskId = report['anp:taskId'];
    const progress = report['anp:progress'];
    const currentPhase = report['anp:currentPhase'];
    const blockers = report['anp:blockers'] || [];

    // Validate progress value
    if (progress < 0 || progress > 100) {
      throw new Error(`Invalid progress value: ${progress}. Must be between 0 and 100.`);
    }

    // Record progress event for analytics
    this.recordProgressEvent(report);

    // Update goal progress (if goal exists)
    if ('freelance:goalId' in report && report['freelance:goalId']) {
      this.updateGoalProgress(report['freelance:goalId'], progress);
    }

    // Handle blockers
    let actionRequired: string | undefined;
    if (blockers.length > 0) {
      const interventionCreated = await this.handleBlockers(report, reportId);
      if (interventionCreated) {
        actionRequired = `Blockers detected: ${blockers.join(', ')}`;
      }
    }

    // Check for progress stalls
    const stallWarning = this.checkProgressStall(taskId, progress);
    if (stallWarning) {
      actionRequired = actionRequired
        ? `${actionRequired}; ${stallWarning}`
        : stallWarning;
    }

    // Check for ETA exceeded
    if ('anp:etaSeconds' in report && report['anp:etaSeconds']) {
      const etaWarning = this.checkEtaExceeded(report);
      if (etaWarning) {
        actionRequired = actionRequired
          ? `${actionRequired}; ${etaWarning}`
          : etaWarning;
      }
    }

    // Build acknowledgment payload
    const ack: ProgressReportAckPayload = {
      '@type': 'freelance:ProgressReportAck',
      'freelance:taskId': taskId,
      'freelance:reportId': reportId,
      'freelance:acknowledgedAt': new Date().toISOString(),
      'freelance:actionRequired': actionRequired,
    };

    return ack;
  }

  /**
   * Get current progress tracking state
   */
  getProgressState(): Map<string, { progress: number; lastUpdate: number }> {
    return new Map(this.goalProgress);
  }

  /**
   * Clear progress tracking state
   */
  clearProgressState(): void {
    this.goalProgress.clear();
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  /**
   * Update goal progress in tracking
   */
  private updateGoalProgress(goalId: string, progress: number): void {
    const now = Date.now();
    const previous = this.goalProgress.get(goalId);

    this.goalProgress.set(goalId, {
      progress,
      lastUpdate: now,
    });

    // If this is the first update or progress increased, track it
    if (!previous || progress > previous.progress) {
      this.analytics.track({
        eventType: 'milestone_completed',
        timestamp: new Date(now).toISOString(),
        properties: {
          goalId,
          previousProgress: previous?.progress || 0,
          newProgress: progress,
          progressDelta: progress - (previous?.progress || 0),
        },
      });
    }
  }

  /**
   * Record progress event for analytics
   */
  private recordProgressEvent(report: FreelanceProgressReportPayload | ProgressReportPayload): void {
    const taskId = report['anp:taskId'];
    const progress = report['anp:progress'];
    const currentPhase = report['anp:currentPhase'];
    const completedSteps = report['anp:completedSteps'] || [];
    const nextSteps = report['anp:nextSteps'] || [];

    this.analytics.track({
      eventType: 'project_viewed', // Using existing event type for progress tracking
      timestamp: new Date().toISOString(),
      properties: {
        taskId,
        progress,
        currentPhase,
        completedSteps,
        nextSteps,
        blockerCount: (report['anp:blockers'] || []).length,
      },
      projectId: 'freelance:projectId' in report ? report['freelance:projectId'] : undefined,
    });
  }

  /**
   * Handle blockers in progress report
   */
  private async handleBlockers(
    report: FreelanceProgressReportPayload | ProgressReportPayload,
    reportId: string
  ): Promise<boolean> {
    const blockers = report['anp:blockers'] || [];
    const taskId = report['anp:taskId'];

    // Check if any blockers require intervention
    const requiresIntervention = blockers.length >= this.config.blockerThresholds.count;

    if (!requiresIntervention) {
      return false;
    }

    // Determine intervention type based on blocker severity
    const interventionType = this.classifyBlockerIntervention(report);

    // Calculate SLA deadline based on blocker count and severity
    const slaDeadline = this.calculateBlockerSla(blockers.length);

    // Create intervention
    try {
      const intervention = this.repository.createIntervention({
        interventionType: interventionType,
        projectId: 'freelance:projectId' in report ? report['freelance:projectId'] : undefined,
        goalId: 'freelance:goalId' in report ? report['freelance:goalId'] : undefined,
        reason: `Task ${taskId} has ${blockers.length} blocker(s): ${blockers.join(', ')}`,
        context: JSON.stringify({
          taskId,
          blockers,
          progress: report['anp:progress'],
          currentPhase: report['anp:currentPhase'],
          reportId,
        }),
        slaDeadline,
      });

      // Track intervention event
      this.analytics.trackManualIntervention({
        interventionType: interventionType,
        projectId: intervention.projectId,
        reason: intervention.reason,
      });

      return true;
    } catch (error) {
      // Log error but don't fail the progress report
      console.error('Failed to create intervention for blockers:', error);
      return false;
    }
  }

  /**
   * Classify blocker severity to intervention type
   */
  private classifyBlockerIntervention(
    report: FreelanceProgressReportPayload | ProgressReportPayload
  ): InterventionType {
    const blockers = report['anp:blockers'] || [];

    // Check for critical blocker keywords
    const criticalKeywords = ['api', 'authentication', 'payment', 'security', 'legal'];
    const hasCriticalBlocker = blockers.some((blocker: string) =>
      criticalKeywords.some((keyword: string) => blocker.toLowerCase().includes(keyword))
    );

    if (hasCriticalBlocker) {
      return 'dispute_l2';
    }

    // Check for quality issues
    const qualityKeywords = ['bug', 'error', 'failure', 'test'];
    const hasQualityBlocker = blockers.some((blocker: string) =>
      qualityKeywords.some((keyword: string) => blocker.toLowerCase().includes(keyword))
    );

    if (hasQualityBlocker) {
      return 'quality_review';
    }

    // Default to project start review
    return 'project_start';
  }

  /**
   * Calculate SLA deadline for blocker resolution
   */
  private calculateBlockerSla(blockerCount: number): string {
    const now = Date.now();
    // More blockers = longer SLA
    const slaMs = Math.min(
      60 * 60 * 1000 + blockerCount * 30 * 60 * 1000, // Base 1 hour + 30 min per blocker
      4 * 60 * 60 * 1000 // Max 4 hours
    );
    return new Date(now + slaMs).toISOString();
  }

  /**
   * Check for progress stall
   */
  private checkProgressStall(taskId: string, currentProgress: number): string | undefined {
    const previous = this.goalProgress.get(taskId);
    if (!previous) return undefined;

    const timeSinceUpdate = Date.now() - previous.lastUpdate;
    const hasStalled = timeSinceUpdate > this.config.progressAlerts.stallDurationMs;

    if (hasStalled && previous.progress === currentProgress) {
      return `Progress stalled at ${currentProgress}% for ${Math.round(timeSinceUpdate / 60000)} minutes`;
    }

    return undefined;
  }

  /**
   * Check for ETA exceeded
   */
  private checkEtaExceeded(report: FreelanceProgressReportPayload | ProgressReportPayload): string | undefined {
    // This would require comparing actual progress vs ETA
    // For now, just a placeholder
    const etaSeconds = report['anp:etaSeconds'];
    if (!etaSeconds) return undefined;

    // TODO: Implement actual ETA tracking
    return undefined;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create Progress Report Handler
 */
export function createProgressReportHandler(
  repository: FreelanceRepository,
  analytics: AnalyticsCollector,
  config?: ProgressReportHandlerConfig
): ProgressReportHandler {
  return new ProgressReportHandler(repository, analytics, config);
}

/**
 * Convert base ProgressReportPayload to FreelanceProgressReportPayload
 */
export function toFreelanceProgressReport(
  report: ProgressReportPayload | FreelanceProgressReportPayload
): FreelanceProgressReportPayload {
  if ('freelance:projectId' in report) {
    return report as FreelanceProgressReportPayload;
  }

  // Convert base type to extended type
  return {
    ...report,
    '@type': 'freelance:ProgressReport',
    'freelance:projectId': undefined,
    'freelance:goalId': undefined,
    'freelance:deliverablesCompleted': undefined,
    'freelance:deliverablesTotal': undefined,
    'freelance:timeSpentSeconds': undefined,
    'freelance:estimatedTimeRemainingSeconds': undefined,
  };
}
