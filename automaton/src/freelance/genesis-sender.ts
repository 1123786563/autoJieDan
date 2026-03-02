/**
 * Genesis Prompt Sender - Freelance Project Task Dispatcher
 *
 * 发送自由职业项目任务到 Nanobot
 * 负责构建 Genesis Prompt 消息并通过 WebSocket 发送
 *
 * References:
 * - docs/implementation-plan.md section 3.2 (task 1B-02)
 * - automaton/src/interagent/genesis/GenesisPromptSender.ts (base implementation)
 * - automaton/src/anp/freelance-message-types.ts
 * - automaton/src/freelance/types.ts
 */

import { ulid } from 'ulid';
import type {
  GenesisPromptPayload,
  ANPMessage,
  ANPSignature,
} from '../anp/types.js';
import type { FreelanceANPMessageType } from '../anp/freelance-message-types.js';
import type { Project, Client } from './types.js';
import { FreelanceRepository } from './repository.js';
import { AnalyticsCollector } from './analytics.js';
import type { InteragentWebSocketServer, InteragentEvent } from '../interagent/websocket.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Goal entity (task execution context)
 * Defined here to avoid circular dependencies
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
 * Send Genesis Prompt parameters
 */
export interface SendGenesisPromptParams {
  /** Project from database */
  project: Project;
  /** Goal/task to execute */
  goal: Goal;
  /** Detailed requirements */
  requirements: string;
  /** Required technology stack */
  techStack: string[];
  /** Prohibited technology stack */
  prohibitedStack?: string[];
  /** Maximum cost in cents */
  maxCostCents: number;
  /** Maximum duration in milliseconds */
  maxDurationMs: number;
  /** Optional client information */
  client?: Client;
}

/**
 * Send result
 */
export interface SendGenesisPromptResult {
  /** Success status */
  success: boolean;
  /** Generated message ID */
  messageId: string;
  /** Genesis Prompt ID */
  genesisPromptId: string;
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Genesis Prompt Sender configuration
 */
export interface GenesisPromptSenderConfig {
  /** Default TTL for messages (seconds) */
  defaultTtl?: number;
  /** Whether to require confirmation */
  requireConfirmation?: boolean;
  /** Default priority level */
  defaultPriority?: 'low' | 'normal' | 'high';
}

// ============================================================================
// GENESIS PROMPT SENDER
// ============================================================================

/**
 * Genesis Prompt Sender for Freelance Projects
 *
 * Responsibilities:
 * - Build Genesis Prompt payload from project/goal data
 * - Send via WebSocket to Nanobot
 * - Track analytics events
 * - Return message ID for correlation
 */
export class GenesisPromptSender {
  private repository: FreelanceRepository;
  private analytics: AnalyticsCollector;
  private ws: InteragentWebSocketServer;
  private config: Required<GenesisPromptSenderConfig>;

  // Message counter for tracking
  private sentCount = 0;
  private successCount = 0;

  constructor(
    ws: InteragentWebSocketServer,
    repository: FreelanceRepository,
    analytics: AnalyticsCollector,
    config: GenesisPromptSenderConfig = {}
  ) {
    this.ws = ws;
    this.repository = repository;
    this.analytics = analytics;
    this.config = {
      defaultTtl: config.defaultTtl || 3600, // 1 hour
      requireConfirmation: config.requireConfirmation ?? true,
      defaultPriority: config.defaultPriority || 'normal',
    };
  }

  // ==========================================================================
  // PUBLIC METHODS
  // ==========================================================================

  /**
   * Send Genesis Prompt to Nanobot
   *
   * @param params - Send parameters
   * @returns Result with message ID
   */
  async sendGenesisPrompt(params: SendGenesisPromptParams): Promise<SendGenesisPromptResult> {
    const genesisPromptId = ulid();
    const messageId = ulid();

    try {
      // Build Genesis Prompt payload
      const payload = this.buildPayload(params, genesisPromptId);

      // Create ANP message wrapper
      const message = this.buildANPMessage(payload, messageId, genesisPromptId);

      // Create Interagent event for WebSocket transmission
      const event = this.createInteragentEvent(message, params);

      // Send via WebSocket
      const sent = this.ws.sendToDid('did:anp:nanobot:main', event, true);

      if (!sent) {
        return {
          success: false,
          messageId,
          genesisPromptId,
          error: 'Failed to send message: WebSocket not connected',
        };
      }

      // Track analytics
      this.trackSendEvent(params, genesisPromptId);

      // Update counters
      this.sentCount++;
      this.successCount++;

      return {
        success: true,
        messageId,
        genesisPromptId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Track error
      this.analytics.trackError({
        errorCode: 'GENESIS_SEND_FAILED',
        errorMessage,
        severity: 'error',
      });

      return {
        success: false,
        messageId,
        genesisPromptId,
        error: errorMessage,
      };
    }
  }

  /**
   * Get send statistics
   */
  getStats(): { sentCount: number; successCount: number; failureCount: number } {
    return {
      sentCount: this.sentCount,
      successCount: this.successCount,
      failureCount: this.sentCount - this.successCount,
    };
  }

  // ==========================================================================
  // PRIVATE METHODS - PAYLOAD BUILDING
  // ==========================================================================

  /**
   * Build Genesis Prompt payload from parameters
   */
  private buildPayload(
    params: SendGenesisPromptParams,
    genesisPromptId: string
  ): GenesisPromptPayload {
    const { project, goal, requirements, techStack, prohibitedStack, maxCostCents, maxDurationMs } = params;

    // Build technical constraints
    const technicalConstraints = {
      '@type': 'genesis:TechnicalConstraints' as const,
      'genesis:requiredStack': techStack,
      'genesis:prohibitedStack': prohibitedStack || [],
      'genesis:targetPlatform': this.inferTargetPlatform(techStack),
    };

    // Build contract terms
    const contractTerms = {
      '@type': 'genesis:ContractTerms' as const,
      'genesis:totalBudget': {
        '@type': 'schema:MonetaryAmount' as const,
        'schema:value': maxCostCents,
        'schema:currency': 'USD',
      },
      'genesis:deadline': project.deadline || this.calculateDeadline(maxDurationMs),
      'genesis:milestones': this.createMilestones(maxDurationMs),
    };

    // Build resource limits
    const resourceLimits = {
      '@type': 'genesis:ResourceLimits' as const,
      'genesis:maxTokensPerTask': this.calculateMaxTokens(maxCostCents),
      'genesis:maxCostCents': maxCostCents,
      'genesis:maxDurationMs': maxDurationMs,
    };

    // Build special instructions
    const specialInstructions = {
      '@type': 'genesis:SpecialInstructions' as const,
      'genesis:priorityLevel': this.mapPriorityFromProject(project),
      'genesis:riskFlags': this.extractRiskFlags(project, params.client),
      'genesis:humanReviewRequired': this.config.requireConfirmation,
    };

    // Assemble full payload
    const payload: GenesisPromptPayload = {
      '@type': 'genesis:GenesisPrompt',
      'genesis:projectId': project.id,
      'genesis:platform': project.platform,
      'genesis:requirementSummary': this.buildRequirementSummary(project, goal, requirements),
      'genesis:technicalConstraints': technicalConstraints,
      'genesis:contractTerms': contractTerms,
      'genesis:resourceLimits': resourceLimits,
      'genesis:specialInstructions': specialInstructions,
    };

    return payload;
  }

  /**
   * Build ANP message wrapper
   */
  private buildANPMessage(
    payload: GenesisPromptPayload,
    messageId: string,
    genesisPromptId: string
  ): ANPMessage {
    return {
      '@context': [
        'https://www.w3.org/ns/activitystreams/v1',
        'https://w3id.org/anp/v1',
        'https://w3id.org/security/v1',
        'https://w3id.org/anp/genesis#',
      ],
      '@type': 'ANPMessage',
      id: messageId,
      timestamp: new Date().toISOString(),
      actor: 'did:anp:automaton:main',
      target: 'did:anp:nanobot:main',
      type: 'TaskCreate',
      object: payload,
      signature: this.createMockSignature(messageId), // TODO: Use real signature
      correlationId: genesisPromptId,
      ttl: this.config.defaultTtl,
    };
  }

  /**
   * Create Interagent event for WebSocket transmission
   */
  private createInteragentEvent(
    message: Omit<ANPMessage, 'signature'>,
    params: SendGenesisPromptParams
  ): InteragentEvent {
    return {
      id: message.id,
      type: 'task.complete', // Using existing event type
      timestamp: message.timestamp,
      source: message.actor,
      target: message.target,
      correlationId: message.correlationId,
      payload: {
        taskId: params.goal.id,
        result: message as unknown as Record<string, unknown>,
        duration: 0,
      },
    };
  }

  // ==========================================================================
  // PRIVATE METHODS - HELPERS
  // ==========================================================================

  /**
   * Build requirement summary from project, goal, and requirements
   */
  private buildRequirementSummary(project: Project, goal: Goal, requirements: string): string {
    const parts = [
      `Project: ${project.title}`,
      project.description ? `Description: ${project.description}` : null,
      `Task: ${goal.description}`,
      `Requirements: ${requirements}`,
    ];

    return parts.filter(Boolean).join('\n');
  }

  /**
   * Infer target platform from tech stack
   */
  private inferTargetPlatform(techStack: string[]): string {
    const stack = techStack.map(s => s.toLowerCase()).join(',');

    if (stack.includes('react') || stack.includes('next') || stack.includes('vue')) {
      return 'web';
    }
    if (stack.includes('swift') || stack.includes('kotlin')) {
      return 'mobile';
    }
    if (stack.includes('python') && stack.includes('pandas')) {
      return 'data-science';
    }
    if (stack.includes('node') || stack.includes('typescript')) {
      return 'backend';
    }

    return 'general';
  }

  /**
   * Calculate deadline from duration
   */
  private calculateDeadline(maxDurationMs: number): string {
    const deadline = new Date(Date.now() + maxDurationMs);
    return deadline.toISOString();
  }

  /**
   * Create milestones for the project
   */
  private createMilestones(maxDurationMs: number): Array<{
    '@type': 'genesis:Milestone';
    'genesis:name': string;
    'genesis:percentage': number;
    'genesis:dueDate': string;
  }> {
    const now = Date.now();
    const deadline = now + maxDurationMs;

    return [
      {
        '@type': 'genesis:Milestone' as const,
        'genesis:name': 'analysis',
        'genesis:percentage': 25,
        'genesis:dueDate': new Date(now + maxDurationMs * 0.25).toISOString(),
      },
      {
        '@type': 'genesis:Milestone' as const,
        'genesis:name': 'implementation',
        'genesis:percentage': 75,
        'genesis:dueDate': new Date(now + maxDurationMs * 0.75).toISOString(),
      },
      {
        '@type': 'genesis:Milestone' as const,
        'genesis:name': 'completion',
        'genesis:percentage': 100,
        'genesis:dueDate': new Date(deadline).toISOString(),
      },
    ];
  }

  /**
   * Calculate max tokens based on cost budget
   */
  private calculateMaxTokens(maxCostCents: number): number {
    // Assume $0.002 per 1K tokens (GPT-4 pricing approximation)
    const dollars = maxCostCents / 100;
    const tokensPerDollar = 500000; // 1K tokens = $0.002
    return Math.floor(dollars * tokensPerDollar);
  }

  /**
   * Map project properties to priority level
   */
  private mapPriorityFromProject(project: Project): 'low' | 'normal' | 'high' {
    // High priority if score is high or budget is significant
    if (project.score && project.score >= 80) {
      return 'high';
    }
    if (project.budgetCents && project.budgetCents >= 50000) { // $500+
      return 'high';
    }
    return this.config.defaultPriority;
  }

  /**
   * Extract risk flags from project and client
   */
  private extractRiskFlags(project: Project, client?: Client): string[] {
    const flags: string[] = [];

    // Check client tier
    if (client) {
      if (client.tier === 'new') {
        flags.push('new_client');
      }
      if (client.paymentVerified < 80) {
        flags.push('payment_risk');
      }
      if (client.rating && client.rating < 4.0) {
        flags.push('low_rating');
      }
    }

    // Check project urgency
    if (project.deadline) {
      const deadline = new Date(project.deadline);
      const daysUntilDeadline = (deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysUntilDeadline < 3) {
        flags.push('tight_deadline');
      }
    }

    // Check budget reasonableness
    if (project.budgetCents && project.budgetCents < 10000) { // Less than $100
      flags.push('low_budget');
    }

    return flags;
  }

  /**
   * Create mock signature (TODO: implement real signing)
   */
  private createMockSignature(messageId: string): ANPSignature {
    return {
      type: 'EcdsaSecp256r1Signature2019',
      created: new Date().toISOString(),
      verificationMethod: 'did:anp:automaton:main#key-1',
      proofPurpose: 'authentication',
      proofValue: `mock_signature_${messageId}`, // TODO: Real signature
    };
  }

  /**
   * Track send event for analytics
   */
  private trackSendEvent(params: SendGenesisPromptParams, genesisPromptId: string): void {
    this.analytics.track({
      eventType: 'llm_call',
      timestamp: new Date().toISOString(),
      properties: {
        genesisPromptId,
        projectId: params.project.id,
        goalId: params.goal.id,
        platform: params.project.platform,
        budgetCents: params.maxCostCents,
        techStack: params.techStack,
      },
      projectId: params.project.id,
    });
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create Genesis Prompt Sender
 */
export function createGenesisPromptSender(
  ws: InteragentWebSocketServer,
  repository: FreelanceRepository,
  analytics: AnalyticsCollector,
  config?: GenesisPromptSenderConfig
): GenesisPromptSender {
  return new GenesisPromptSender(ws, repository, analytics, config);
}
