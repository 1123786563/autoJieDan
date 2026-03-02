/**
 * Cost Tracker Service
 *
 * Tracks LLM usage costs and project budgets with alerting.
 * Monitors resource consumption and triggers alerts at thresholds.
 *
 * References:
 * - docs/implementation-plan.md section 6, task 1C-08
 * - automaton/src/freelance/types.ts
 */

import type { FreelanceRepository } from './repository.js';
import type { ProjectCost, CostAlert } from './types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parameters for tracking LLM cost
 */
export interface TrackLLMCostParams {
  /** Project ID (optional, for project-level tracking) */
  projectId?: string;
  /** Goal ID (optional, for goal-level tracking) */
  goalId?: string;
  /** Model used (e.g., 'gpt-4', 'claude-3-opus') */
  model: string;
  /** Number of tokens consumed */
  tokens: number;
  /** Cost in cents */
  costCents: number;
  /** Optional session ID for correlation */
  sessionId?: string;
}

/**
 * Cost tracking summary
 */
export interface CostSummary {
  /** Total cost in cents */
  totalCents: number;
  /** Total tokens used */
  totalTokens: number;
  /** Total LLM calls */
  totalCalls: number;
  /** Breakdown by model */
  byModel: Record<string, { costCents: number; tokens: number; calls: number }>;
}

/**
 * Budget alert thresholds
 */
export interface AlertThresholds {
  /** Warning threshold (percentage, 0-100) */
  warningThreshold: number;
  /** Critical threshold (percentage, 0-100) */
  criticalThreshold: number;
}

/**
 * Cost tracker configuration
 */
export interface CostTrackerConfig {
  /** Alert thresholds */
  alertThresholds: AlertThresholds;
  /** Enable automatic cost tracking */
  enableTracking: boolean;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default alert thresholds
 */
const DEFAULT_THRESHOLDS: AlertThresholds = {
  warningThreshold: 50,  // 50% budget used
  criticalThreshold: 80, // 80% budget used
};

/**
 * Default cost tracker configuration
 */
const DEFAULT_CONFIG: CostTrackerConfig = {
  alertThresholds: DEFAULT_THRESHOLDS,
  enableTracking: true,
};

// ============================================================================
// COST TRACKER SERVICE
// ============================================================================

/**
 * Cost Tracker Service
 *
 * Monitors and tracks LLM usage costs with:
 * - Real-time cost accumulation
 * - Budget vs actual tracking
 * - Alert generation at thresholds
 * - Project and goal level tracking
 */
export class CostTracker {
  private repository: FreelanceRepository;
  private config: CostTrackerConfig;
  private costCache: Map<string, number> = new Map();

  constructor(repository: FreelanceRepository, config?: Partial<CostTrackerConfig>) {
    this.repository = repository;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Track LLM API cost
   *
   * Records cost and optionally checks for budget alerts.
   *
   * @param params - Cost tracking parameters
   */
  async trackLLMCost(params: TrackLLMCostParams): Promise<void> {
    if (!this.config.enableTracking) {
      return;
    }

    // Record analytics event for cost tracking
    await this.repository.recordEvent({
      eventType: 'llm_call',
      timestamp: new Date().toISOString(),
      properties: JSON.stringify({
        model: params.model,
        tokens: params.tokens,
        cost_cents: params.costCents,
        session_id: params.sessionId,
      }),
      projectId: params.projectId,
      sessionId: params.sessionId,
    });

    // Update goal cost if provided
    if (params.goalId) {
      await this.updateGoalCost(params.goalId, params.costCents);
    }

    // Update project-level cost cache
    if (params.projectId) {
      const currentCost = this.costCache.get(params.projectId) || 0;
      this.costCache.set(params.projectId, currentCost + params.costCents);

      // Check for budget alerts
      await this.checkAndAlert(params.projectId);
    }
  }

  /**
   * Get project cost summary
   *
   * Calculates total spend vs budget with remaining and percentage.
   *
   * @param projectId - Project ID to get cost for
   * @returns Project cost summary
   */
  async getProjectCost(projectId: string): Promise<ProjectCost> {
    const project = this.repository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const budgetCents = project.budgetCents || 0;
    const actualCents = await this.calculateActualCost(projectId);
    const remainingCents = Math.max(0, budgetCents - actualCents);
    const percentage = budgetCents > 0 ? (actualCents / budgetCents) * 100 : 0;

    // Generate alerts based on thresholds
    const alerts = this.generateAlerts(percentage, budgetCents, actualCents);

    return {
      projectId,
      budgetCents,
      actualCents,
      remainingCents,
      percentage: Math.round(percentage),
      alerts,
    };
  }

  /**
   * Check budget alert status for a project
   *
   * Returns active alerts without modifying state.
   *
   * @param projectId - Project ID to check
   * @returns Array of active alerts
   */
  async checkBudgetAlert(projectId: string): Promise<CostAlert[]> {
    const cost = await this.getProjectCost(projectId);
    return cost.alerts;
  }

  /**
   * Get cost summary for all projects or a specific time range
   *
   * @param options - Optional filters
   * @returns Cost summary
   */
  async getCostSummary(options?: {
    projectId?: string;
    startTime?: string;
    endTime?: string;
  }): Promise<CostSummary> {
    // This would query the analytics_events table
    // For now, return a basic summary
    return {
      totalCents: 0,
      totalTokens: 0,
      totalCalls: 0,
      byModel: {},
    };
  }

  /**
   * Clear cost cache for a project
   *
   * Useful after fetching fresh data from database.
   *
   * @param projectId - Project ID to clear cache for
   */
  clearCache(projectId: string): void {
    this.costCache.delete(projectId);
  }

  /**
   * Clear all cost caches
   */
  clearAllCaches(): void {
    this.costCache.clear();
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  /**
   * Update goal cost tracking
   *
   * Updates goal-level cost accumulation.
   */
  private async updateGoalCost(goalId: string, costCents: number): Promise<void> {
    // This would update a goals table with cost tracking
    // For now, record an analytics event
    await this.repository.recordEvent({
      eventType: 'llm_call',
      timestamp: new Date().toISOString(),
      properties: JSON.stringify({
        goal_id: goalId,
        cost_cents: costCents,
      }),
    });

    console.info(`[CostTracker] Updated goal ${goalId} cost by ${costCents} cents`);
  }

  /**
   * Calculate actual cost for a project from analytics
   */
  private async calculateActualCost(projectId: string): Promise<number> {
    // Use cached value if available
    const cached = this.costCache.get(projectId);
    if (cached !== undefined) {
      return cached;
    }

    // Query analytics events for LLM calls
    // This would aggregate from analytics_events table
    // For now, return 0
    return 0;
  }

  /**
   * Check and generate alerts for budget thresholds
   */
  private async checkAndAlert(projectId: string): Promise<void> {
    const cost = await this.getProjectCost(projectId);

    if (cost.alerts.length > 0) {
      // Record alert events
      for (const alert of cost.alerts) {
        await this.repository.recordEvent({
          eventType: 'error_occurred',
          timestamp: new Date().toISOString(),
          properties: JSON.stringify({
            alert_type: 'budget',
            level: alert.level,
            message: alert.message,
            project_id: projectId,
          }),
          projectId,
        });
      }
    }
  }

  /**
   * Generate alerts based on percentage used
   */
  private generateAlerts(
    percentage: number,
    budgetCents: number,
    actualCents: number
  ): CostAlert[] {
    const alerts: CostAlert[] = [];
    const now = new Date().toISOString();

    // Critical alert
    if (percentage >= this.config.alertThresholds.criticalThreshold) {
      alerts.push({
        level: 'critical',
        message: `Budget ${this.config.alertThresholds.criticalThreshold}% used ($${(actualCents / 100).toFixed(2)} of $${(budgetCents / 100).toFixed(2)})`,
        timestamp: now,
      });
    }

    // Warning alert
    if (percentage >= this.config.alertThresholds.warningThreshold &&
        percentage < this.config.alertThresholds.criticalThreshold) {
      alerts.push({
        level: 'warning',
        message: `Budget ${this.config.alertThresholds.warningThreshold}% used ($${(actualCents / 100).toFixed(2)} of $${(budgetCents / 100).toFixed(2)})`,
        timestamp: now,
      });
    }

    // Exceeded budget alert
    if (percentage >= 100) {
      alerts.push({
        level: 'critical',
        message: `Budget exceeded ($${(actualCents / 100).toFixed(2)} spent vs $${(budgetCents / 100).toFixed(2)} budget)`,
        timestamp: now,
      });
    }

    return alerts;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate LLM cost from token count
 *
 * Approximate pricing per 1M tokens (input/output):
 * - GPT-4o: $5/$15
 * - GPT-4o-mini: $0.15/$0.60
 * - Claude 3.5 Sonnet: $3/$15
 *
 * @param model - Model name
 * @param inputTokens - Input token count
 * @param outputTokens - Output token count
 * @returns Cost in cents
 */
export function calculateLLMCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  // Prices per 1M tokens in USD
  const prices: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 5, output: 15 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-4-turbo': { input: 10, output: 30 },
    'claude-3-5-sonnet': { input: 3, output: 15 },
    'claude-3-opus': { input: 15, output: 75 },
    'claude-3-haiku': { input: 0.25, output: 1.25 },
  };

  const pricing = prices[model];
  if (!pricing) {
    // Default pricing for unknown models
    return Math.ceil((inputTokens + outputTokens) / 1000 * 0.01);
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const totalCost = inputCost + outputCost;

  // Convert to cents
  return Math.ceil(totalCost * 100);
}

/**
 * Format cost for display
 *
 * @param costCents - Cost in cents
 * @returns Formatted string (e.g., "$12.34")
 */
export function formatCost(costCents: number): string {
  return `$${(costCents / 100).toFixed(2)}`;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default CostTracker;
