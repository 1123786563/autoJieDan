/**
 * Freelance Repository - Data Access Layer
 *
 * Provides CRUD operations for the freelance project management system.
 * All database operations use better-sqlite3 with prepared statements
 * for performance and SQL injection prevention.
 *
 * References:
 * - docs/implementation-plan.md section 4
 * - automaton/src/freelance/types.ts
 * - automaton/src/state/schema-v11.ts
 */

import Database from 'better-sqlite3';
import { ulid } from 'ulid';
import type {
  Project,
  Client,
  BidHistory,
  ManualIntervention,
  AnalyticsEvent,
  ProjectStatus,
  BidStatus,
  InterventionStatus,
  Platform,
  ProjectScoreFactors,
} from './types.js';

// ============================================================================
// PARAMETER TYPES
// ============================================================================

export interface CreateProjectParams {
  platform: Platform;
  platformProjectId: string;
  title: string;
  description?: string;
  budgetCents?: number;
  deadline?: string;
  clientId?: string;
}

export interface GetOrCreateClientParams {
  platform: Platform;
  platformClientId: string;
  name?: string;
  company?: string;
  rating?: number;
  totalSpentCents?: number;
  paymentVerified?: number;
  country?: string;
  tier?: 'gold' | 'silver' | 'bronze' | 'new';
  languagePreference?: string;
  responseTimeHours?: number;
  totalProjects?: number;
  hiredFreelancers?: number;
}

export interface CreateBidParams {
  projectId: string;
  templateId?: string;
  coverLetter: string;
  bidAmountCents?: number;
  durationDays?: number;
}

export interface CreateInterventionParams {
  interventionType: string;
  projectId?: string;
  goalId?: string;
  reason: string;
  context?: string;
  slaDeadline?: string;
}

export interface RecordEventParams {
  eventType: string;
  timestamp?: string;
  properties?: string;
  sessionId?: string;
  projectId?: string;
  clientId?: string;
  userId?: string;
}

// ============================================================================
// REPOSITORY CLASS
// ============================================================================

export class FreelanceRepository {
  private db: Database.Database;

  // Prepared statements for performance
  private statements: Map<string, Database.Statement> = new Map();

  constructor(db: Database.Database) {
    this.db = db;
    this.prepareStatements();
  }

  /**
   * Prepare all SQL statements once at construction
   */
  private prepareStatements(): void {
    // Project statements
    this.statement('createProject', `
      INSERT INTO projects (
        id, platform, platform_project_id, title, description,
        client_id, budget_cents, deadline, status, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'discovered', datetime('now'))
    `);

    this.statement('getProject', `
      SELECT * FROM projects WHERE id = ?
    `);

    this.statement('getProjectByPlatformId', `
      SELECT * FROM projects WHERE platform = ? AND platform_project_id = ?
    `);

    this.statement('updateProjectStatus', `
      UPDATE projects
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    this.statement('updateProjectScore', `
      UPDATE projects
      SET score = ?, score_factors = ?, status = 'scored', updated_at = datetime('now')
      WHERE id = ?
    `);

    this.statement('getProjectsToScore', `
      SELECT * FROM projects
      WHERE status = 'discovered'
      ORDER BY discovered_at ASC
      LIMIT ?
    `);

    // Client statements
    this.statement('getClient', `
      SELECT * FROM clients WHERE id = ?
    `);

    this.statement('getClientByPlatformId', `
      SELECT * FROM clients
      WHERE platform = ? AND platform_client_id = ?
    `);

    this.statement('createClient', `
      INSERT INTO clients (
        id, platform, platform_client_id, name, company, rating,
        total_spent_cents, payment_verified, country, tier,
        language_preference, response_time_hours, total_projects, hired_freelancers
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.statement('updateClient', `
      UPDATE clients
      SET name = ?, company = ?, rating = ?, total_spent_cents = ?,
          payment_verified = ?, country = ?, tier = ?, language_preference = ?,
          response_time_hours = ?, total_projects = ?, hired_freelancers = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    // Bid statements
    this.statement('createBid', `
      INSERT INTO bid_history (
        id, project_id, template_id, cover_letter, bid_amount_cents, duration_days
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.statement('getBid', `
      SELECT * FROM bid_history WHERE id = ?
    `);

    this.statement('updateBidStatus', `
      UPDATE bid_history
      SET status = ?, submitted_at = CASE WHEN ? = 'submitted' THEN datetime('now') ELSE submitted_at END,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    // Intervention statements
    this.statement('createIntervention', `
      INSERT INTO manual_interventions (
        id, intervention_type, project_id, goal_id, reason, context, sla_deadline
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.statement('getPendingInterventions', `
      SELECT * FROM manual_interventions
      WHERE status = 'pending'
      ORDER BY requested_at ASC
    `);

    this.statement('updateInterventionResponse', `
      UPDATE manual_interventions
      SET status = ?, decision = ?, responder = ?, responded_at = datetime('now')
      WHERE id = ?
    `);

    // Analytics statements
    this.statement('recordEvent', `
      INSERT INTO analytics_events (
        id, event_type, timestamp, properties, session_id, project_id, client_id, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  /**
   * Get or create a prepared statement
   */
  private statement(name: string, sql: string): Database.Statement {
    const stmt = this.db.prepare(sql);
    this.statements.set(name, stmt);
    return stmt;
  }

  private getStatement(name: string): Database.Statement {
    const stmt = this.statements.get(name);
    if (!stmt) {
      throw new Error(`Statement not found: ${name}`);
    }
    return stmt;
  }

  // ==========================================================================
  // PROJECT OPERATIONS
  // ==========================================================================

  /**
   * Create a new project
   */
  createProject(params: CreateProjectParams): Project {
    const id = ulid();
    const now = new Date().toISOString();

    this.getStatement('createProject').run(
      id,
      params.platform,
      params.platformProjectId,
      params.title,
      params.description || null,
      params.clientId || null,
      params.budgetCents || null,
      params.deadline || null
    );

    const project = this.getProject(id);
    if (!project) {
      throw new Error('Failed to create project');
    }
    return project;
  }

  /**
   * Get project by ID
   */
  getProject(id: string): Project | undefined {
    const row = this.getStatement('getProject').get(id) as any;
    if (!row) return undefined;
    return this.mapRowToProject(row);
  }

  /**
   * Get project by platform and platform project ID
   */
  getProjectByPlatformId(platform: string, id: string): Project | undefined {
    const row = this.getStatement('getProjectByPlatformId').get(platform, id) as any;
    if (!row) return undefined;
    return this.mapRowToProject(row);
  }

  /**
   * Update project status
   */
  updateProjectStatus(id: string, status: ProjectStatus): void {
    const result = this.getStatement('updateProjectStatus').run(status, id);
    if (result.changes === 0) {
      throw new Error(`Project not found: ${id}`);
    }
  }

  /**
   * Update project score
   */
  updateProjectScore(id: string, score: number, factors: ProjectScoreFactors): void {
    const factorsJson = JSON.stringify(factors);
    const result = this.getStatement('updateProjectScore').run(score, factorsJson, id);
    if (result.changes === 0) {
      throw new Error(`Project not found: ${id}`);
    }
  }

  /**
   * Get projects that need scoring
   */
  getProjectsToScore(limit: number = 100): Project[] {
    const rows = this.getStatement('getProjectsToScore').all(limit) as any[];
    return rows.map(row => this.mapRowToProject(row));
  }

  // ==========================================================================
  // CLIENT OPERATIONS
  // ==========================================================================

  /**
   * Get existing client or create new one
   */
  getOrCreateClient(params: GetOrCreateClientParams): Client {
    // Try to find existing client
    const existing = this.getStatement('getClientByPlatformId').get(
      params.platform,
      params.platformClientId
    ) as any;

    if (existing) {
      // Update with latest data
      this.getStatement('updateClient').run(
        params.name || existing.name,
        params.company || existing.company,
        params.rating ?? existing.rating,
        params.totalSpentCents ?? existing.total_spent_cents,
        params.paymentVerified ?? existing.payment_verified,
        params.country || existing.country,
        params.tier || existing.tier,
        params.languagePreference || existing.language_preference,
        params.responseTimeHours ?? existing.response_time_hours,
        params.totalProjects ?? existing.total_projects,
        params.hiredFreelancers ?? existing.hired_freelancers,
        existing.id
      );
      return this.getClient(existing.id)!;
    }

    // Create new client
    const id = ulid();
    this.getStatement('createClient').run(
      id,
      params.platform,
      params.platformClientId,
      params.name || null,
      params.company || null,
      params.rating || null,
      params.totalSpentCents || 0,
      params.paymentVerified || 0,
      params.country || null,
      params.tier || 'new',
      params.languagePreference || 'en',
      params.responseTimeHours || null,
      params.totalProjects || 0,
      params.hiredFreelancers || 0
    );

    return this.getClient(id)!;
  }

  /**
   * Get client by ID
   */
  getClient(id: string): Client | undefined {
    const row = this.getStatement('getClient').get(id) as any;
    if (!row) return undefined;
    return this.mapRowToClient(row);
  }

  // ==========================================================================
  // BID OPERATIONS
  // ==========================================================================

  /**
   * Create a new bid
   */
  createBid(params: CreateBidParams): BidHistory {
    const id = ulid();

    this.getStatement('createBid').run(
      id,
      params.projectId,
      params.templateId || null,
      params.coverLetter,
      params.bidAmountCents || null,
      params.durationDays || null
    );

    const bid = this.db.prepare('SELECT * FROM bid_history WHERE id = ?').get(id) as any;
    return this.mapRowToBid(bid);
  }

  /**
   * Update bid status
   */
  updateBidStatus(id: string, status: BidStatus): void {
    const result = this.getStatement('updateBidStatus').run(status, status, id);
    if (result.changes === 0) {
      throw new Error(`Bid not found: ${id}`);
    }
  }

  // ==========================================================================
  // INTERVENTION OPERATIONS
  // ==========================================================================

  /**
   * Create a manual intervention request
   */
  createIntervention(params: CreateInterventionParams): ManualIntervention {
    const id = ulid();

    this.getStatement('createIntervention').run(
      id,
      params.interventionType,
      params.projectId || null,
      params.goalId || null,
      params.reason,
      params.context || null,
      params.slaDeadline || null
    );

    const intervention = this.db.prepare('SELECT * FROM manual_interventions WHERE id = ?').get(id) as any;
    return this.mapRowToIntervention(intervention);
  }

  /**
   * Get all pending interventions
   */
  getPendingInterventions(): ManualIntervention[] {
    const rows = this.getStatement('getPendingInterventions').all() as any[];
    return rows.map(row => this.mapRowToIntervention(row));
  }

  /**
   * Update intervention with human response
   */
  updateInterventionResponse(id: string, decision: string, responder: string): void {
    const status: InterventionStatus = decision === 'approve' ? 'approved' : 'rejected';
    const result = this.getStatement('updateInterventionResponse').run(status, decision, responder, id);
    if (result.changes === 0) {
      throw new Error(`Intervention not found: ${id}`);
    }
  }

  // ==========================================================================
  // ANALYTICS OPERATIONS
  // ==========================================================================

  /**
   * Record a single analytics event
   */
  recordEvent(params: RecordEventParams): AnalyticsEvent {
    const id = ulid();
    const timestamp = params.timestamp || new Date().toISOString();

    this.getStatement('recordEvent').run(
      id,
      params.eventType,
      timestamp,
      params.properties || null,
      params.sessionId || null,
      params.projectId || null,
      params.clientId || null,
      params.userId || null
    );

    const event = this.db.prepare('SELECT * FROM analytics_events WHERE id = ?').get(id) as any;
    return this.mapRowToEvent(event);
  }

  /**
   * Record multiple analytics events in a transaction
   */
  recordEvents(events: RecordEventParams[]): void {
    const insert = this.getStatement('recordEvent');

    const insertMany = this.db.transaction((items: RecordEventParams[]) => {
      for (const params of items) {
        const id = ulid();
        const timestamp = params.timestamp || new Date().toISOString();
        insert.run(
          id,
          params.eventType,
          timestamp,
          params.properties || null,
          params.sessionId || null,
          params.projectId || null,
          params.clientId || null,
          params.userId || null
        );
      }
    });

    insertMany(events);
  }

  // ==========================================================================
  // ROW MAPPERS
  // ==========================================================================

  private mapRowToProject(row: any): Project {
    return {
      id: row.id,
      platform: row.platform,
      platformProjectId: row.platform_project_id,
      title: row.title,
      description: row.description || undefined,
      clientId: row.client_id || undefined,
      status: row.status,
      score: row.score || undefined,
      scoreFactors: row.score_factors || undefined,
      bidId: row.bid_id || undefined,
      contractId: row.contract_id || undefined,
      budgetCents: row.budget_cents || undefined,
      deadline: row.deadline || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      discoveredAt: row.discovered_at,
      metadata: row.metadata || undefined,
    };
  }

  private mapRowToClient(row: any): Client {
    return {
      id: row.id,
      platform: row.platform,
      platformClientId: row.platform_client_id,
      name: row.name || undefined,
      company: row.company || undefined,
      rating: row.rating || undefined,
      totalSpentCents: row.total_spent_cents,
      paymentVerified: row.payment_verified,
      country: row.country || undefined,
      tier: row.tier,
      languagePreference: row.language_preference,
      responseTimeHours: row.response_time_hours || undefined,
      totalProjects: row.total_projects,
      hiredFreelancers: row.hired_freelancers,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata || undefined,
    };
  }

  private mapRowToBid(row: any): BidHistory {
    return {
      id: row.id,
      projectId: row.project_id,
      templateId: row.template_id || undefined,
      coverLetter: row.cover_letter,
      bidAmountCents: row.bid_amount_cents || undefined,
      durationDays: row.duration_days || undefined,
      submittedAt: row.submitted_at || undefined,
      status: row.status,
      interviewInvited: row.interview_invited,
      responseReceivedAt: row.response_received_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRowToIntervention(row: any): ManualIntervention {
    return {
      id: row.id,
      interventionType: row.intervention_type,
      projectId: row.project_id || undefined,
      goalId: row.goal_id || undefined,
      reason: row.reason,
      context: row.context || undefined,
      status: row.status,
      requestedAt: row.requested_at,
      respondedAt: row.responded_at || undefined,
      responder: row.responder || undefined,
      decision: row.decision || undefined,
      notes: row.notes || undefined,
      slaDeadline: row.sla_deadline || undefined,
      createdAt: row.created_at,
    };
  }

  private mapRowToEvent(row: any): AnalyticsEvent {
    return {
      id: row.id,
      eventType: row.event_type,
      timestamp: row.timestamp,
      properties: row.properties || undefined,
      sessionId: row.session_id || undefined,
      projectId: row.project_id || undefined,
      clientId: row.client_id || undefined,
      userId: row.user_id || undefined,
      createdAt: row.created_at,
    };
  }
}
