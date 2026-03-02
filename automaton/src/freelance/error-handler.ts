/**
 * Error Report Handler - Process Error Reports from Nanobot
 *
 * Handles error reports from Nanobot, including:
 * - Logging errors for analytics
 * - Creating human interventions when needed
 * - Sending acknowledgments back to Nanobot
 *
 * References:
 * - docs/implementation-plan.md section 3.2 (task 1B-04)
 * - automaton/src/anp/freelance-message-types.ts
 * - automaton/src/freelance/types.ts
 */

import { ulid } from 'ulid';
import type { FreelanceErrorReportPayload, ErrorReportAckPayload } from '../anp/freelance-message-types.js';
import type { ErrorReportPayload } from '../anp/types.js';
import type { ManualIntervention, InterventionType } from './types.js';
import { FreelanceRepository } from './repository.js';
import { AnalyticsCollector } from './analytics.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Error handler configuration
 */
export interface ErrorHandlerConfig {
  /** Severity levels that require human intervention */
  interventionSeverities?: string[];
  /** Error codes that always require intervention */
  interventionErrorCodes?: string[];
  /** Whether to notify client for critical errors */
  notifyClientOnCritical?: boolean;
}

// ============================================================================
// ERROR HANDLER CLASS
// ============================================================================

/**
 * Handler for error reports from Nanobot
 *
 * Processes error reports and determines appropriate actions:
 * - Log for analytics
 * - Create intervention if severity warrants it
 * - Return acknowledgment payload
 */
export class ErrorReportHandler {
  private repository: FreelanceRepository;
  private analytics: AnalyticsCollector;
  private config: Required<ErrorHandlerConfig>;

  constructor(
    repository: FreelanceRepository,
    analytics: AnalyticsCollector,
    config: ErrorHandlerConfig = {}
  ) {
    this.repository = repository;
    this.analytics = analytics;
    this.config = {
      interventionSeverities: config.interventionSeverities || ['critical'],
      interventionErrorCodes: config.interventionErrorCodes || [
        'PAYMENT_FAILED',
        'API_QUOTA_EXCEEDED',
        'AUTHENTICATION_FAILED',
        'CLIENT_COMPLAINT',
        'LEGAL_ISSUE',
      ],
      notifyClientOnCritical: config.notifyClientOnCritical ?? true,
    };
  }

  // ==========================================================================
  // PUBLIC METHODS
  // ==========================================================================

  /**
   * Handle an error report from Nanobot
   *
   * @param report - The error report payload
   * @returns Acknowledgment payload to send back to Nanobot
   */
  async handleErrorReport(report: FreelanceErrorReportPayload | ErrorReportPayload): Promise<ErrorReportAckPayload> {
    const reportId = ulid();
    const taskId = report['anp:taskId'];
    const severity = report['anp:severity'];
    const errorCode = report['anp:errorCode'];

    // Record error event for analytics
    this.recordErrorEvent(report);

    // Determine if intervention is needed
    const shouldIntervene = this.shouldCreateIntervention(report);
    let interventionId: string | undefined;
    let actionRequired: string | undefined;

    if (shouldIntervene) {
      const intervention = await this.createIntervention(report);
      interventionId = intervention.id;

      // Set action required based on severity
      if (severity === 'critical') {
        actionRequired = `Immediate attention required: ${report['anp:message']}`;
      } else {
        actionRequired = `Review needed: ${errorCode}`;
      }
    }

    // Build acknowledgment payload
    const ack: ErrorReportAckPayload = {
      '@type': 'freelance:ErrorReportAck',
      'freelance:taskId': taskId,
      'freelance:reportId': reportId,
      'freelance:acknowledgedAt': new Date().toISOString(),
      'freelance:interventionCreated': shouldIntervene,
      'freelance:interventionId': interventionId,
      'freelance:actionRequired': actionRequired,
    };

    return ack;
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  /**
   * Determine if an error report requires human intervention
   *
   * Intervention is triggered when:
   * - Severity level is critical
   * - Error code is in the intervention list
   * - Error is marked as non-recoverable
   */
  private shouldCreateIntervention(report: FreelanceErrorReportPayload | ErrorReportPayload): boolean {
    const severity = report['anp:severity'];
    const errorCode = report['anp:errorCode'];
    const recoverable = report['anp:recoverable'];

    // Check severity level
    if (this.config.interventionSeverities.includes(severity)) {
      return true;
    }

    // Check error code
    if (this.config.interventionErrorCodes.includes(errorCode)) {
      return true;
    }

    // Check if non-recoverable
    if (!recoverable && severity === 'error') {
      return true;
    }

    // Check if explicitly marked for human intervention
    if ('freelance:requiresHumanIntervention' in report && report['freelance:requiresHumanIntervention']) {
      return true;
    }

    return false;
  }

  /**
   * Create a manual intervention for the error
   */
  private async createIntervention(report: FreelanceErrorReportPayload | ErrorReportPayload): Promise<ManualIntervention> {
    const taskId = report['anp:taskId'];
    const severity = report['anp:severity'];
    const errorCode = report['anp:errorCode'];
    const message = report['anp:message'];

    // Determine intervention type based on error
    const interventionType = this.classifyErrorToInterventionType(errorCode, severity);

    // Calculate SLA deadline based on severity
    const slaDeadline = this.calculateSlaDeadline(severity);

    // Create intervention
    const intervention = this.repository.createIntervention({
      interventionType: interventionType,
      projectId: 'freelance:projectId' in report ? report['freelance:projectId'] : undefined,
      goalId: 'freelance:goalId' in report ? report['freelance:goalId'] : undefined,
      reason: `Error Report: ${errorCode} - ${message}`,
      context: JSON.stringify({
        taskId,
        severity,
        errorCode,
        message,
        context: report['anp:context'],
        suggestedAction: report['anp:suggestedAction'],
      }),
      slaDeadline,
    });

    // Track intervention event
    this.analytics.trackManualIntervention({
      interventionType: interventionType,
      projectId: intervention.projectId,
      reason: intervention.reason,
    });

    return intervention;
  }

  /**
   * Classify error code to intervention type
   */
  private classifyErrorToInterventionType(errorCode: string, severity: string): InterventionType {
    // Payment related errors
    if (errorCode.includes('PAYMENT') || errorCode.includes('BILLING')) {
      return 'refund';
    }

    // Legal/compliance issues
    if (errorCode.includes('LEGAL') || errorCode.includes('COMPLIANCE')) {
      return severity === 'critical' ? 'dispute_l3' : 'dispute_l2';
    }

    // Quality issues
    if (errorCode.includes('QUALITY') || errorCode.includes('BUG')) {
      return 'quality_review';
    }

    // Customer complaints
    if (errorCode.includes('CUSTOMER') || errorCode.includes('CLIENT')) {
      return 'customer_complaint';
    }

    // Default to project start review for general errors
    return 'project_start';
  }

  /**
   * Calculate SLA deadline based on error severity
   */
  private calculateSlaDeadline(severity: string): string {
    const now = new Date();
    const deadlineMs = severity === 'critical' ? 1 * 60 * 60 * 1000 : // 1 hour for critical
      severity === 'error' ? 4 * 60 * 60 * 1000 : // 4 hours for error
      24 * 60 * 60 * 1000; // 24 hours for warning

    return new Date(now.getTime() + deadlineMs).toISOString();
  }

  /**
   * Record error event for analytics
   */
  private recordErrorEvent(report: FreelanceErrorReportPayload | ErrorReportPayload): void {
    const severity = report['anp:severity'];
    const errorCode = report['anp:errorCode'];
    const message = report['anp:message'];

    this.analytics.trackError({
      errorCode,
      errorMessage: message,
      severity,
    });
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert base ErrorReportPayload to FreelanceErrorReportPayload
 *
 * Nanobot may send either the base type or the extended type.
 * This function ensures we have the extended type for processing.
 */
export function toFreelanceErrorReport(
  report: ErrorReportPayload | FreelanceErrorReportPayload
): FreelanceErrorReportPayload {
  if ('freelance:projectId' in report) {
    return report as FreelanceErrorReportPayload;
  }

  // Convert base type to extended type
  return {
    ...report,
    '@type': 'freelance:ErrorReport',
    'freelance:projectId': undefined,
    'freelance:goalId': undefined,
    'freelance:requiresHumanIntervention': undefined,
    'freelance:clientNotified': undefined,
  };
}
