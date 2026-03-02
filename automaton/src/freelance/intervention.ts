/**
 * Manual Intervention Service
 *
 * Handles human-in-the-loop escalation events requiring manual review,
 * approval, or intervention based on risk thresholds and business rules.
 *
 * References:
 * - docs/implementation-plan.md section 6, tasks 1C-05/1C-06
 * - automaton/src/freelance/types.ts
 */

import { ulid } from 'ulid';
import type {
  InterventionType,
  ManualIntervention,
  InterventionStatus,
} from './types.js';
import type { FreelanceRepository } from './repository.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for creating an intervention request
 */
export interface CreateInterventionParams {
  /** Type of intervention required */
  type: InterventionType;
  /** Reference to project ID (if applicable) */
  projectId?: string;
  /** Reference to goal ID (if applicable) */
  goalId?: string;
  /** Reason for the intervention */
  reason: string;
  /** Additional context information */
  context?: Record<string, unknown>;
  /** SLA deadline in hours (optional, uses default per type) */
  slaHours?: number;
}

/**
 * Response from intervention request
 */
export interface InterventionResponse {
  /** Intervention ID */
  id: string;
  /** Current status */
  status: InterventionStatus;
  /** SLA deadline */
  slaDeadline: string;
}

/**
 * Result of awaiting intervention response
 */
export interface AwaitResult {
  /** Decision made: approve, reject, or timeout */
  decision: 'approve' | 'reject' | 'timeout';
  /** Responder identifier (if applicable) */
  responder?: string;
  /** Additional notes */
  notes?: string;
  /** When response was received */
  respondedAt: string;
}

/**
 * Notification service interface
 */
export interface NotificationService {
  /** Send notification about intervention request */
  sendNotification(params: {
    type: InterventionType;
    interventionId: string;
    reason: string;
    context?: string;
    slaDeadline: string;
  }): Promise<void>;
}

/**
 * Configuration for ManualInterventionService
 */
export interface InterventionServiceConfig {
  /** Enable automatic timeout checking */
  enableTimeoutCheck: boolean;
  /** Timeout check interval in milliseconds */
  timeoutCheckIntervalMs: number;
  /** Default SLA hours per intervention type */
  defaultSlaHours: Record<InterventionType, number>;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default SLA hours per intervention type
 * Based on implementation-plan.md section 6
 */
const DEFAULT_SLA_HOURS: Record<InterventionType, number> = {
  contract_sign: 24,
  large_spend: 4,
  project_start: 24,
  refund: 48,
  dispute_l2: 48,
  dispute_l3: 72,
  quality_review: 24,
  customer_complaint: 8,
} as const;

/**
 * Default service configuration
 */
const DEFAULT_CONFIG: InterventionServiceConfig = {
  enableTimeoutCheck: true,
  timeoutCheckIntervalMs: 60000, // 1 minute
  defaultSlaHours: DEFAULT_SLA_HOURS,
};

// ============================================================================
// MANUAL INTERVENTION SERVICE
// ============================================================================

/**
 * Manual Intervention Service
 *
 * Manages human-in-the-loop workflows for critical decisions.
 * Provides:
 * - Intervention request creation with SLA tracking
 * - Response awaiting with timeout handling
 * - Notification dispatch
 * - Status management
 */
export class ManualInterventionService {
  private repository: FreelanceRepository;
  private notificationService?: NotificationService;
  private config: InterventionServiceConfig;
  private timeoutCheckTimer?: ReturnType<typeof setInterval>;
  private pendingRequests: Map<string, {
    resolve: (result: AwaitResult) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  constructor(
    repository: FreelanceRepository,
    notificationService?: NotificationService,
    config?: Partial<InterventionServiceConfig>
  ) {
    this.repository = repository;
    this.notificationService = notificationService;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Start timeout check if enabled
    if (this.config.enableTimeoutCheck) {
      this.startTimeoutCheck();
    }
  }

  /**
   * Create a new manual intervention request
   *
   * @param params - Intervention parameters
   * @returns Intervention response with ID and deadline
   */
  async createRequest(params: CreateInterventionParams): Promise<InterventionResponse> {
    const slaHours = params.slaHours ?? this.config.defaultSlaHours[params.type];
    const slaDeadline = this.calculateSlaDeadline(slaHours);
    const contextJson = params.context ? JSON.stringify(params.context) : undefined;

    // Create intervention in database
    const intervention = this.repository.createIntervention({
      interventionType: params.type,
      projectId: params.projectId,
      goalId: params.goalId,
      reason: params.reason,
      context: contextJson,
      slaDeadline,
    });

    // Send notification
    await this.sendNotification(intervention);

    return {
      id: intervention.id,
      status: intervention.status,
      slaDeadline: intervention.slaDeadline!,
    };
  }

  /**
   * Await response for an intervention request
   *
   * Waits until human responds or SLA timeout occurs.
   *
   * @param requestId - Intervention ID to wait for
   * @param timeoutMs - Optional custom timeout (default: SLA deadline)
   * @returns Promise resolving to response decision
   */
  async awaitResponse(
    requestId: string,
    timeoutMs?: number
  ): Promise<AwaitResult> {
    return new Promise((resolve, reject) => {
      // Check if intervention exists by looking at pending list
      const pending = this.repository.getPendingInterventions();
      const intervention = pending.find(i => i.id === requestId);

      // Also check if it might be already resolved (not in pending list)
      // We need to handle the case where intervention was already responded to
      if (!intervention) {
        // Intervention might not be pending anymore, could be resolved
        // For now, treat as not found
        reject(new Error(`Intervention not found or already resolved: ${requestId}`));
        return;
      }

      // Calculate timeout
      let timeout = timeoutMs;
      if (!timeout && intervention.slaDeadline) {
        const deadline = new Date(intervention.slaDeadline).getTime();
        const now = Date.now();
        timeout = Math.max(0, deadline - now);
      }
      if (!timeout) {
        timeout = 24 * 60 * 60 * 1000; // Default 24 hours
      }

      // Set up timeout handler
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve({
          decision: 'timeout',
          respondedAt: new Date().toISOString(),
        });
        // Trigger timeout action
        this.handleTimeout(requestId).catch(console.error);
      }, timeout);

      // Store promise handlers for response
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutHandle,
      });
    });
  }

  /**
   * Record human response to intervention request
   *
   * Called by notification handler when human responds.
   *
   * @param requestId - Intervention ID
   * @param decision - Decision made (approve/reject)
   * @param responder - Who made the decision
   * @param notes - Optional notes
   */
  async recordResponse(
    requestId: string,
    decision: 'approve' | 'reject',
    responder: string,
    notes?: string
  ): Promise<void> {
    // Update in database
    this.repository.updateInterventionResponse(
      requestId,
      decision,
      responder
    );

    // Resolve pending await if any
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      pending.resolve({
        decision,
        responder,
        notes,
        respondedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Check for timed-out interventions
   *
   * Should be called periodically (usually by a timer).
   * Automatically handles timeout actions for expired requests.
   */
  async checkTimeouts(): Promise<void> {
    const pending = this.repository.getPendingInterventions();
    const now = Date.now();

    for (const intervention of pending) {
      if (intervention.slaDeadline) {
        const deadline = new Date(intervention.slaDeadline).getTime();
        if (now > deadline) {
          await this.handleTimeout(intervention.id);
        }
      }
    }
  }

  /**
   * Stop the service and cleanup resources
   */
  stop(): void {
    if (this.timeoutCheckTimer) {
      clearInterval(this.timeoutCheckTimer);
      this.timeoutCheckTimer = undefined;
    }

    // Reject all pending requests
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Service stopped'));
    }
    this.pendingRequests.clear();
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  /**
   * Calculate SLA deadline from hours
   */
  private calculateSlaDeadline(hours: number): string {
    const deadline = new Date();
    deadline.setTime(deadline.getTime() + hours * 60 * 60 * 1000);
    return deadline.toISOString();
  }

  /**
   * Send notification for intervention request
   */
  private async sendNotification(intervention: ManualIntervention): Promise<void> {
    if (!this.notificationService) {
      console.info(`[Intervention] Would send notification for ${intervention.id}`);
      return;
    }

    await this.notificationService.sendNotification({
      type: intervention.interventionType,
      interventionId: intervention.id,
      reason: intervention.reason,
      context: intervention.context,
      slaDeadline: intervention.slaDeadline!,
    });
  }

  /**
   * Handle timeout for intervention request
   */
  private async handleTimeout(requestId: string): Promise<void> {
    // Get timeout handler to execute default action
    const { InterventionTimeoutHandler } = await import('./intervention-timeout.js');
    const handler = new InterventionTimeoutHandler(this.repository);

    await handler.executeTimeoutAction(requestId);
  }

  /**
   * Start periodic timeout checking
   */
  private startTimeoutCheck(): void {
    this.timeoutCheckTimer = setInterval(async () => {
      try {
        await this.checkTimeouts();
      } catch (error) {
        console.error('Error checking timeouts:', error);
      }
    }, this.config.timeoutCheckIntervalMs);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ManualInterventionService;
