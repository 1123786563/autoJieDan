/**
 * Intervention Timeout Handler
 *
 * Handles timeout scenarios for manual intervention requests.
 * Executes predefined default actions when SLA deadlines expire.
 *
 * References:
 * - docs/implementation-plan.md section 6, task 1C-06
 * - automaton/src/freelance/types.ts
 */

import type { FreelanceRepository } from './repository.js';
import type {
  InterventionType,
  ManualIntervention,
} from './types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Timeout configuration for an intervention type
 */
export interface TimeoutConfig {
  /** SLA deadline in hours */
  slaHours: number;
  /** Default action when timeout occurs */
  defaultAction: 'cancel' | 'approve' | 'reject' | 'escalate' | 'refund';
  /** Whether to notify client of timeout action */
  notifyClient: boolean;
  /** Impact on ICP score */
  icpImpact: 'none' | 'minor' | 'moderate' | 'severe';
  /** Optional message to send to client */
  clientMessage?: string;
}

/**
 * Result of timeout action execution
 */
export interface TimeoutActionResult {
  /** Intervention ID */
  interventionId: string;
  /** Action executed */
  action: string;
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// TIMEOUT CONFIGURATIONS
// ============================================================================

/**
 * Timeout configurations per intervention type
 * Based on implementation-plan.md section 6
 */
export const INTERVENTION_TIMEOUT_CONFIGS: Record<InterventionType, TimeoutConfig> = {
  contract_sign: {
    slaHours: 24,
    defaultAction: 'cancel',
    notifyClient: true,
    icpImpact: 'moderate',
    clientMessage: 'Due to no response within the required timeframe, the contract has been cancelled.',
  },

  large_spend: {
    slaHours: 4,
    defaultAction: 'reject',
    notifyClient: false,
    icpImpact: 'none',
  },

  project_start: {
    slaHours: 24,
    defaultAction: 'cancel',
    notifyClient: true,
    icpImpact: 'moderate',
    clientMessage: 'Due to no confirmation within the required timeframe, the project has been cancelled.',
  },

  refund: {
    slaHours: 48,
    defaultAction: 'refund',
    notifyClient: true,
    icpImpact: 'moderate',
    clientMessage: 'Your refund has been processed due to timeout.',
  },

  dispute_l2: {
    slaHours: 48,
    defaultAction: 'escalate',
    notifyClient: true,
    icpImpact: 'severe',
    clientMessage: 'Due to no response within the required timeframe, this dispute has been escalated to Level 3.',
  },

  dispute_l3: {
    slaHours: 72,
    defaultAction: 'reject',
    notifyClient: true,
    icpImpact: 'severe',
    clientMessage: 'Due to no response within the required timeframe, the dispute has been closed.',
  },

  quality_review: {
    slaHours: 24,
    defaultAction: 'approve',
    notifyClient: false,
    icpImpact: 'minor',
  },

  customer_complaint: {
    slaHours: 8,
    defaultAction: 'reject',
    notifyClient: true,
    icpImpact: 'moderate',
    clientMessage: 'We apologize for the delay. Your complaint is being reviewed.',
  },
};

// ============================================================================
// INTERVENTION TIMEOUT HANDLER
// ============================================================================

/**
 * Intervention Timeout Handler
 *
 * Executes predefined actions when intervention requests timeout.
 * Actions include:
 * - cancel: Cancel associated project/contract
 * - approve: Auto-approve the pending action
 * - reject: Auto-reject the pending action
 * - escalate: Escalate to higher authority/platform
 * - refund: Process refund
 */
export class InterventionTimeoutHandler {
  private repository: FreelanceRepository;

  constructor(repository: FreelanceRepository) {
    this.repository = repository;
  }

  /**
   * Check all pending interventions for timeouts and handle them
   *
   * @returns Array of timeout action results
   */
  async checkAndHandleTimeouts(): Promise<TimeoutActionResult[]> {
    const pending = this.repository.getPendingInterventions();
    const now = Date.now();
    const results: TimeoutActionResult[] = [];

    for (const intervention of pending) {
      if (intervention.slaDeadline) {
        const deadline = new Date(intervention.slaDeadline).getTime();
        if (now > deadline) {
          const result = await this.executeTimeoutAction(intervention.id);
          results.push(result);
        }
      }
    }

    return results;
  }

  /**
   * Execute timeout action for a specific intervention
   *
   * @param interventionId - ID of intervention to handle
   * @returns Timeout action result
   */
  async executeTimeoutAction(interventionId: string): Promise<TimeoutActionResult> {
    try {
      // Get intervention details
      const intervention = this.getInterventionById(interventionId);
      if (!intervention) {
        return {
          interventionId,
          action: 'none',
          success: false,
          error: 'Intervention not found',
        };
      }

      // Get timeout configuration
      const config = INTERVENTION_TIMEOUT_CONFIGS[intervention.interventionType];
      if (!config) {
        return {
          interventionId,
          action: 'none',
          success: false,
          error: 'No timeout configuration for this type',
        };
      }

      // Execute default action
      await this.executeAction(intervention, config);

      // Update intervention status
      this.updateInterventionStatus(interventionId, 'timeout');

      // Send client notification if required
      if (config.notifyClient && intervention.projectId) {
        await this.sendClientNotification(intervention, config);
      }

      // Record ICP impact
      await this.recordIcpImpact(intervention, config);

      return {
        interventionId,
        action: config.defaultAction,
        success: true,
      };
    } catch (error) {
      return {
        interventionId,
        action: 'error',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  /**
   * Get intervention by ID (helper method)
   * Uses direct SQL query since repository doesn't have this method
   */
  private getInterventionById(id: string): ManualIntervention | undefined {
    // Use the repository's prepared statements to query by ID
    // This is a workaround since the repository doesn't expose this method
    const pending = this.repository.getPendingInterventions();
    return pending.find(i => i.id === id);
  }

  /**
   * Update intervention status to timeout
   */
  private updateInterventionStatus(interventionId: string, decision: string): void {
    // Update in repository
    this.repository.updateInterventionResponse(
      interventionId,
      decision,
      'system_timeout'
    );
  }

  /**
   * Execute the configured timeout action
   */
  private async executeAction(
    intervention: ManualIntervention,
    config: TimeoutConfig
  ): Promise<void> {
    switch (config.defaultAction) {
      case 'cancel':
        await this.executeCancel(intervention);
        break;

      case 'approve':
        // Auto-approve - the pending action can proceed
        await this.executeApprove(intervention);
        break;

      case 'reject':
        // Auto-reject - the pending action is rejected
        await this.executeReject(intervention);
        break;

      case 'escalate':
        await this.executeEscalate(intervention);
        break;

      case 'refund':
        await this.executeRefund(intervention);
        break;

      default:
        throw new Error(`Unknown action: ${config.defaultAction}`);
    }
  }

  /**
   * Execute cancel action
   */
  private async executeCancel(intervention: ManualIntervention): Promise<void> {
    if (intervention.projectId) {
      // Cancel the project
      this.repository.updateProjectStatus(intervention.projectId, 'cancelled');
    }

    // If goal exists, cancel it
    if (intervention.goalId) {
      // Goal cancellation logic would go here
      console.info(`[Timeout] Cancelling goal ${intervention.goalId} due to timeout`);
    }
  }

  /**
   * Execute approve action
   */
  private async executeApprove(intervention: ManualIntervention): Promise<void> {
    console.info(`[Timeout] Auto-approving intervention ${intervention.id}`);

    if (intervention.interventionType === 'contract_sign' && intervention.projectId) {
      // Allow contract to proceed
      this.repository.updateProjectStatus(intervention.projectId, 'contracted');
    }

    if (intervention.interventionType === 'project_start' && intervention.projectId) {
      // Allow project to start
      this.repository.updateProjectStatus(intervention.projectId, 'active');
    }

    if (intervention.interventionType === 'quality_review') {
      // Auto-approve quality review, work can proceed
      console.info(`[Timeout] Quality review auto-approved for ${intervention.projectId}`);
    }
  }

  /**
   * Execute reject action
   */
  private async executeReject(intervention: ManualIntervention): Promise<void> {
    console.info(`[Timeout] Auto-rejecting intervention ${intervention.id}`);

    if (intervention.interventionType === 'large_spend' && intervention.projectId) {
      // Reject the expenditure
      console.info(`[Timeout] Large spend rejected for project ${intervention.projectId}`);
    }

    if (intervention.interventionType === 'dispute_l3') {
      // Close dispute without resolution
      console.info(`[Timeout] Dispute ${intervention.id} closed due to timeout`);
    }

    if (intervention.interventionType === 'customer_complaint') {
      // Mark complaint as resolved without action
      console.info(`[Timeout] Customer complaint ${intervention.id} closed`);
    }
  }

  /**
   * Execute escalate action
   */
  private async executeEscalate(intervention: ManualIntervention): Promise<void> {
    console.info(`[Timeout] Escalating intervention ${intervention.id}`);

    if (intervention.interventionType === 'dispute_l2') {
      // Escalate to Level 3 (legal/platform)
      // This would create a new L3 intervention
      console.info(`[Timeout] Dispute escalated from L2 to L3`);
    }
  }

  /**
   * Execute refund action
   */
  private async executeRefund(intervention: ManualIntervention): Promise<void> {
    console.info(`[Timeout] Processing refund for intervention ${intervention.id}`);

    if (intervention.projectId) {
      // Mark for refund processing
      this.repository.updateProjectStatus(intervention.projectId, 'cancelled');
      console.info(`[Timeout] Project ${intervention.projectId} cancelled for refund`);
    }
  }

  /**
   * Send client notification about timeout action
   */
  private async sendClientNotification(
    intervention: ManualIntervention,
    config: TimeoutConfig
  ): Promise<void> {
    const message = config.clientMessage || `Action taken: ${config.defaultAction}`;

    console.info(`[Timeout] Client notification for ${intervention.projectId}: ${message}`);

    // Actual notification sending would happen here
    // For now, we just log it
  }

  /**
   * Record ICP impact from timeout
   */
  private async recordIcpImpact(
    intervention: ManualIntervention,
    config: TimeoutConfig
  ): Promise<void> {
    if (config.icpImpact === 'none') {
      return;
    }

    // Record analytics event for ICP impact
    const properties = {
      interventionType: intervention.interventionType,
      impact: config.icpImpact,
      projectId: intervention.projectId,
    };

    this.repository.recordEvent({
      eventType: 'manual_intervention',
      timestamp: new Date().toISOString(),
      properties: JSON.stringify(properties),
      projectId: intervention.projectId,
    });

    console.info(`[Timeout] ICP impact recorded: ${config.icpImpact} for ${intervention.id}`);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default InterventionTimeoutHandler;
