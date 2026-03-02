/**
 * Freelance Project Management - Type Definitions
 *
 * This file contains all TypeScript interfaces and types for the
 * freelance project management system (Phase 1A: AutoJieDan MVP).
 *
 * References:
 * - docs/detailed-design.md section 2.2
 * - docs/implementation-plan.md section 4
 * - automaton/src/state/schema-v11.ts
 */

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Project lifecycle status
 *
 * Represents the complete lifecycle of a freelance project from discovery
 * to closure. Each status represents a distinct state in the workflow.
 */
export type ProjectStatus =
  | "discovered" // Project discovered, awaiting scoring
  | "scored" // Scoring complete, awaiting decision
  | "filtered" // Filtered out, does not meet criteria
  | "bidding" // Bid submitted, awaiting response
  | "deferred" // Awaiting manual review
  | "rejected" // Rejected (by agent or client)
  | "negotiating" // Interview/negotiation in progress
  | "contracted" // Contract signed, awaiting start
  | "pending_start" // Awaiting start confirmation
  | "active" // Project in progress
  | "paused" // Project paused
  | "completed" // Completed, awaiting client confirmation
  | "disputed" // Dispute in progress
  | "resolved" // Dispute resolved
  | "escalated" // Escalated to platform
  | "cancelled" // Cancelled
  | "closed"; // Closed

/**
 * Analytics event types for business intelligence tracking
 *
 * Events are tracked throughout the project lifecycle to enable
 * data-driven decision making and optimization.
 */
export type AnalyticsEventType =
  // Project discovery and evaluation
  | "project_viewed" // Project appeared in search results
  | "project_scored" // Project scoring completed
  | "project_filtered" // Project was filtered out
  | "project_deferred" // Project queued for manual review

  // Bidding workflow
  | "bid_created" // Bid draft created
  | "bid_submitted" // Bid submitted to platform
  | "bid_withdrawn" // Bid withdrawn

  // Conversion funnel
  | "interview_invited" // Received interview invitation
  | "interview_accepted" // Interview accepted
  | "contract_signed" // Contract signed

  // Project execution
  | "project_started" // Project started
  | "milestone_completed" // Milestone completed
  | "project_completed" // Project completed
  | "project_cancelled" // Project cancelled

  // Quality and disputes
  | "review_received" // Review received from client
  | "dispute_opened" // Dispute opened
  | "dispute_resolved" // Dispute resolved

  // System events
  | "llm_call" // LLM API call made
  | "error_occurred" // Error occurred
  | "manual_intervention" // Human intervention requested
  | "customer_message" // Message from customer
  | "repeat_contract"; // Repeat contract from same client

/**
 * Manual intervention types
 *
 * Defines scenarios requiring human review or approval based on
 * risk thresholds and business rules.
 */
export type InterventionType =
  | "contract_sign" // Contract signing requires approval
  | "large_spend" // Large expenditure requires approval
  | "project_start" // Project start requires confirmation
  | "refund" // Refund requires approval
  | "dispute_l2" // Level 2 dispute (platform escalation)
  | "dispute_l3" // Level 3 dispute (legal escalation)
  | "quality_review" // Quality review required
  | "customer_complaint"; // Customer complaint received

/**
 * Client tier classification
 *
 * Based on historical spend, payment verification, and project history.
 */
export type ClientTier = "gold" | "silver" | "bronze" | "new";

/**
 * Platform identifiers
 */
export type Platform = "upwork" | "fiverr" | "freelancer" | "guru" | "peopleperhour";

/**
 * Bid status
 */
export type BidStatus = "draft" | "submitted" | "accepted" | "rejected" | "withdrawn";

/**
 * Intervention status
 */
export type InterventionStatus = "pending" | "approved" | "rejected" | "timeout";

/**
 * Milestone status
 */
export type MilestoneStatus = "pending" | "in_progress" | "completed" | "skipped";

/**
 * Resource priority levels
 */
export type ResourcePriority = "P0" | "P1" | "P2" | "P3";

// ============================================================================
// ENTITIES
// ============================================================================

/**
 * Client entity
 *
 * Represents a customer or client across freelance platforms.
 * Tracks historical performance and tier classification.
 */
export interface Client {
  /** ULID unique identifier */
  id: string;
  /** Platform identifier (e.g., 'upwork', 'fiverr') */
  platform: Platform;
  /** Platform-specific client ID */
  platformClientId: string;
  /** Client display name */
  name?: string;
  /** Company name */
  company?: string;
  /** Historical rating (1-5) */
  rating?: number;
  /** Total lifetime spend in cents */
  totalSpentCents: number;
  /** Payment verification rate (0-100) */
  paymentVerified: number;
  /** Country code */
  country?: string;
  /** Client tier classification */
  tier: ClientTier;
  /** Language preference: 'en', 'zh', 'auto' */
  languagePreference: string;
  /** Average response time in hours */
  responseTimeHours?: number;
  /** Total number of projects posted */
  totalProjects: number;
  /** Number of freelancers hired */
  hiredFreelancers: number;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last update timestamp */
  updatedAt: string;
  /** JSON metadata extension */
  metadata?: string;
}

/**
 * Project entity
 *
 * Represents a freelance project from discovery to closure.
 * Tracks ICP scoring, bidding status, and contract details.
 */
export interface Project {
  /** ULID unique identifier */
  id: string;
  /** Platform identifier */
  platform: Platform;
  /** Platform-specific project ID */
  platformProjectId: string;
  /** Project title */
  title: string;
  /** Project description */
  description?: string;
  /** Reference to clients.id */
  clientId?: string;
  /** Project lifecycle status */
  status: ProjectStatus;
  /** ICP score (0-100) */
  score?: number;
  /** JSON: detailed scoring factors */
  scoreFactors?: string;
  /** Reference to submitted bid */
  bidId?: string;
  /** Reference to signed contract */
  contractId?: string;
  /** Project budget in cents */
  budgetCents?: number;
  /** ISO 8601 deadline */
  deadline?: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last update timestamp */
  updatedAt: string;
  /** ISO 8601 discovery timestamp */
  discoveredAt: string;
  /** JSON metadata extension */
  metadata?: string;
}

/**
 * Bid history entity
 *
 * Tracks all bids submitted for projects, including drafts,
 * submitted bids, and their outcomes.
 */
export interface BidHistory {
  /** ULID unique identifier */
  id: string;
  /** Reference to projects.id */
  projectId: string;
  /** Reference to communication template used */
  templateId?: string;
  /** Cover letter content */
  coverLetter: string;
  /** Bid amount in cents */
  bidAmountCents?: number;
  /** Estimated duration in days */
  durationDays?: number;
  /** ISO 8601 submission timestamp */
  submittedAt?: string;
  /** Bid status */
  status: BidStatus;
  /** Whether interview was invited (0/1) */
  interviewInvited: number;
  /** ISO 8601 response received timestamp */
  responseReceivedAt?: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last update timestamp */
  updatedAt: string;
}

/**
 * Manual intervention entity
 *
 * Tracks human-in-the-loop escalation events requiring
 * manual review, approval, or intervention.
 */
export interface ManualIntervention {
  /** ULID unique identifier */
  id: string;
  /** Type of intervention required */
  interventionType: InterventionType;
  /** Reference to projects.id (if applicable) */
  projectId?: string;
  /** Reference to goals.id (if applicable) */
  goalId?: string;
  /** Reason for intervention */
  reason: string;
  /** JSON: context information */
  context?: string;
  /** Current status */
  status: InterventionStatus;
  /** ISO 8601 request timestamp */
  requestedAt: string;
  /** ISO 8601 response timestamp */
  respondedAt?: string;
  /** Responder identifier */
  responder?: string;
  /** Decision made: 'approve', 'reject', 'timeout_action' */
  decision?: string;
  /** Additional notes */
  notes?: string;
  /** ISO 8601 SLA deadline */
  slaDeadline?: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
}

/**
 * Analytics event entity
 *
 * Business intelligence tracking for all key events in the
 * project lifecycle.
 */
export interface AnalyticsEvent {
  /** ULID unique identifier */
  id: string;
  /** Event type */
  eventType: AnalyticsEventType;
  /** ISO 8601 event timestamp */
  timestamp: string;
  /** JSON: event-specific properties */
  properties?: string;
  /** Session identifier for correlation */
  sessionId?: string;
  /** Reference to projects.id (if applicable) */
  projectId?: string;
  /** Reference to clients.id (if applicable) */
  clientId?: string;
  /** Internal user identifier */
  userId?: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
}

/**
 * Resource allocation entity
 *
 * Manages CPU, token, and cost quotas per project to ensure
 * fair resource distribution and cost control.
 */
export interface ResourceAllocation {
  /** ULID unique identifier */
  id: string;
  /** Reference to projects.id */
  projectId: string;
  /** Reference to goals.id */
  goalId: string;
  /** Priority level: P0, P1, P2, P3 */
  priority: ResourcePriority;
  /** CPU core quota allocation */
  cpuQuota?: number;
  /** Hourly token quota */
  tokenQuotaHour?: number;
  /** Cost quota in cents */
  costQuotaCents?: number;
  /** ISO 8601 allocation timestamp */
  allocatedAt: string;
  /** Whether allocation is active (0/1) */
  active: number;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last update timestamp */
  updatedAt: string;
}

/**
 * Project milestone entity
 *
 * Tracks project milestones for milestone-based payment
 * and progress tracking.
 */
export interface Milestone {
  /** ULID unique identifier */
  id: string;
  /** Reference to projects.id */
  projectId: string;
  /** Reference to goals.id */
  goalId: string;
  /** Milestone name */
  name: string;
  /** Milestone description */
  description?: string;
  /** Payment percentage (0-100) */
  percentage: number;
  /** ISO 8601 due date */
  dueDate?: string;
  /** Milestone status */
  status: MilestoneStatus;
  /** ISO 8601 completion timestamp */
  completedAt?: string;
  /** ISO 8601 delivery timestamp */
  deliveredAt?: string;
  /** ISO 8601 approval timestamp */
  approvedAt?: string;
  /** Amount in cents */
  amountCents?: number;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last update timestamp */
  updatedAt: string;
}

/**
 * Message buffer entity
 *
 * Persists WebSocket messages for reconnection state sync.
 * Messages expire based on TTL.
 */
export interface MessageBuffer {
  /** ULID unique identifier */
  id: string;
  /** Connection identifier */
  connectionId: string;
  /** Message sequence number */
  sequence: number;
  /** Message type: GenesisPrompt, ProgressReport, ErrorReport */
  type: string;
  /** JSON: complete message payload */
  payload: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 expiration timestamp */
  expiresAt: string;
}

// ============================================================================
// VALUE OBJECTS
// ============================================================================

/**
 * Project score breakdown
 *
 * Detailed factors contributing to ICP scoring.
 */
export interface ProjectScoreFactors {
  /** Technical skill match (0-100) */
  technicalMatch: number;
  /** Budget reasonableness (0-100) */
  budgetReasonable: number;
  /** Delivery feasibility (0-100) */
  deliveryFeasible: number;
  /** Client quality score (0-100) */
  clientQuality: number;
  /** Strategic value (0-100) */
  strategicValue: number;
}

/**
 * Bid generation result
 *
 * Result from LLM-powered bid generation.
 */
export interface BidGenerationResult {
  /** Generated cover letter */
  coverLetter: string;
  /** Suggested bid amount in cents */
  bidAmountCents: number;
  /** Estimated duration in days */
  durationDays: number;
  /** Milestone description (if applicable) */
  milestoneDescription?: string;
  /** Suggested questions to ask client */
  suggestedQuestions: string[];
}

/**
 * Project cost tracking
 *
 * Tracks budget vs actual spend with alerts.
 */
export interface ProjectCost {
  /** Reference to projects.id */
  projectId: string;
  /** Budget in cents */
  budgetCents: number;
  /** Actual spend in cents */
  actualCents: number;
  /** Remaining budget in cents */
  remainingCents: number;
  /** Percentage of budget used */
  percentage: number;
  /** Active alerts */
  alerts: CostAlert[];
}

/**
 * Cost alert
 *
 * Alert triggered when budget thresholds are exceeded.
 */
export interface CostAlert {
  /** Alert level */
  level: "warning" | "critical";
  /** Alert message */
  message: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

// ============================================================================
// REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Create project request
 */
export interface CreateProjectRequest {
  platform: Platform;
  platformProjectId: string;
  title: string;
  description?: string;
  budgetCents?: number;
  deadline?: string;
}

/**
 * Update project status request
 */
export interface UpdateProjectStatusRequest {
  projectId: string;
  status: ProjectStatus;
  metadata?: Record<string, unknown>;
}

/**
 * Create bid request
 */
export interface CreateBidRequest {
  projectId: string;
  templateId?: string;
  coverLetter: string;
  bidAmountCents?: number;
  durationDays?: number;
}

/**
 * Submit bid request
 */
export interface SubmitBidRequest {
  bidId: string;
}

/**
 * Create intervention request
 */
export interface CreateInterventionRequest {
  interventionType: InterventionType;
  projectId?: string;
  goalId?: string;
  reason: string;
  context?: Record<string, unknown>;
  slaDeadline?: string;
}

/**
 * Respond to intervention request
 */
export interface RespondToInterventionRequest {
  interventionId: string;
  decision: "approve" | "reject";
  notes?: string;
}

/**
 * Track analytics event request
 */
export interface TrackAnalyticsEventRequest {
  eventType: AnalyticsEventType;
  properties?: Record<string, unknown>;
  sessionId?: string;
  projectId?: string;
  clientId?: string;
  userId?: string;
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Project query filters
 */
export interface ProjectQueryFilters {
  status?: ProjectStatus[];
  platform?: Platform[];
  clientId?: string;
  minScore?: number;
  maxScore?: number;
  minBudgetCents?: number;
  maxBudgetCents?: number;
  createdAfter?: string;
  createdBefore?: string;
}

/**
 * Client query filters
 */
export interface ClientQueryFilters {
  tier?: ClientTier[];
  platform?: Platform[];
  minRating?: number;
  minTotalSpentCents?: number;
}

/**
 * Analytics query filters
 */
export interface AnalyticsQueryFilters {
  eventTypes?: AnalyticsEventType[];
  projectId?: string;
  clientId?: string;
  sessionId?: string;
  startTime?: string;
  endTime?: string;
}

// ============================================================================
// RE-EXPORTS
// ============================================================================
// All types are already exported at their definition sites above.
// This file can be imported as: import { Project, Client, ... } from './types.js';
