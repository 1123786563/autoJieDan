/**
 * Schema v11 Migration - AutoJieDan MVP Project Management Tables
 *
 * Phase 1A: Freelance Project Management System
 *
 * Tables Created:
 * - clients: Customer information and tier management
 * - projects: Project discovery, scoring, and lifecycle tracking
 * - bid_history: Bid submission and tracking
 * - manual_interventions: Human-in-the-loop escalation records
 * - analytics_events: Event tracking for business intelligence
 * - message_buffer: WebSocket message persistence for reconnection
 * - resource_allocations: Resource quota management per project
 * - project_milestones: Milestone-based payment tracking
 *
 * References:
 * - docs/detailed-design.md section 2.2.1
 */

import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";

type DatabaseType = BetterSqlite3.Database;

/**
 * Result returned after applying schema migration
 */
export interface MigrationResult {
  /** Target schema version */
  version: number;
  /** ISO 8601 timestamp when migration was applied */
  appliedAt: string;
  /** Names of tables created during migration */
  tablesCreated: string[];
  /** Names of indexes created during migration */
  indexesCreated: string[];
}

/**
 * DDL SQL statements for Schema v11
 *
 * This constant contains all CREATE TABLE and CREATE INDEX statements
 * for the freelance project management system.
 */
export const SCHEMA_V11_MIGRATION = `
  -- -------------------------------------------------------------------------
  -- clients: Customer information and tier management
  -- -------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,                    -- ULID
    platform TEXT NOT NULL,                 -- 'upwork', 'fiverr', etc.
    platform_client_id TEXT NOT NULL,       -- Platform-specific client ID
    name TEXT,
    company TEXT,
    rating REAL,                            -- Historical rating (1-5)
    total_spent_cents INTEGER DEFAULT 0,    -- Total lifetime spend
    payment_verified INTEGER DEFAULT 0,     -- Payment verification rate (0-100)
    country TEXT,
    tier TEXT DEFAULT 'new',                -- Customer tier: 'gold', 'silver', 'bronze', 'new'
    language_preference TEXT DEFAULT 'en',  -- 'en', 'zh', 'auto'
    response_time_hours REAL,               -- Average response time (hours)
    total_projects INTEGER DEFAULT 0,       -- Total number of projects posted
    hired_freelancers INTEGER DEFAULT 0,    -- Number of freelancers hired
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    metadata TEXT                           -- JSON extension field
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_platform_id ON clients(platform, platform_client_id);
  CREATE INDEX IF NOT EXISTS idx_clients_tier ON clients(tier);
  CREATE INDEX IF NOT EXISTS idx_clients_rating ON clients(rating);

  -- -------------------------------------------------------------------------
  -- projects: Project discovery, scoring, and lifecycle tracking
  -- -------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,                    -- ULID
    platform TEXT NOT NULL,                 -- 'upwork', 'fiverr', etc.
    platform_project_id TEXT NOT NULL,      -- Platform-specific project ID
    title TEXT NOT NULL,
    description TEXT,
    client_id TEXT,                         -- References clients(id)
    status TEXT NOT NULL,                   -- discovered|scored|filtered|bidding|deferred|rejected|negotiating|contracted|pending_start|active|paused|completed|disputed|resolved|escalated|cancelled|closed
    score INTEGER,                          -- ICP score (0-100)
    score_factors TEXT,                     -- JSON: detailed scoring factors
    bid_id TEXT,                            -- Submitted bid ID
    contract_id TEXT,                       -- Signed contract ID
    budget_cents INTEGER,                   -- Project budget (in cents)
    deadline TEXT,                          -- ISO 8601 deadline
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
    metadata TEXT,                          -- JSON extension field
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_platform_id ON projects(platform, platform_project_id);
  CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
  CREATE INDEX IF NOT EXISTS idx_projects_score ON projects(score);
  CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);
  CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);

  -- -------------------------------------------------------------------------
  -- bid_history: Bid submission and tracking
  -- -------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS bid_history (
    id TEXT PRIMARY KEY,                    -- ULID
    project_id TEXT NOT NULL,
    template_id TEXT,
    cover_letter TEXT NOT NULL,
    bid_amount_cents INTEGER,
    duration_days INTEGER,
    submitted_at TEXT,
    status TEXT NOT NULL DEFAULT 'draft',   -- draft|submitted|accepted|rejected|withdrawn
    interview_invited INTEGER DEFAULT 0,
    response_received_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bid_history_project_id ON bid_history(project_id);
  CREATE INDEX IF NOT EXISTS idx_bid_history_status ON bid_history(status);

  -- -------------------------------------------------------------------------
  -- manual_interventions: Human-in-the-loop escalation records
  -- -------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS manual_interventions (
    id TEXT PRIMARY KEY,                    -- ULID
    intervention_type TEXT NOT NULL,        -- contract_sign|large_spend|project_start|refund|dispute_l2|dispute_l3|quality_review|customer_complaint
    project_id TEXT,
    goal_id TEXT,
    reason TEXT NOT NULL,
    context TEXT,                           -- JSON: context information
    status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected|timeout
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    responded_at TEXT,
    responder TEXT,
    decision TEXT,                          -- approve|reject|timeout_action
    notes TEXT,
    sla_deadline TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_manual_interventions_type ON manual_interventions(intervention_type);
  CREATE INDEX IF NOT EXISTS idx_manual_interventions_status ON manual_interventions(status);
  CREATE INDEX IF NOT EXISTS idx_manual_interventions_project_id ON manual_interventions(project_id);

  -- -------------------------------------------------------------------------
  -- analytics_events: Event tracking for business intelligence
  -- -------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,                    -- ULID
    event_type TEXT NOT NULL,               -- project_viewed|project_scored|project_filtered|bid_created|bid_submitted|interview_invited|contract_signed|project_started|milestone_completed|project_completed|review_received|dispute_opened|llm_call|error_occurred|manual_intervention|customer_message|repeat_contract
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    properties TEXT,                        -- JSON: event properties
    session_id TEXT,
    project_id TEXT,
    client_id TEXT,
    user_id TEXT,                           -- Internal user ID
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);
  CREATE INDEX IF NOT EXISTS idx_analytics_events_timestamp ON analytics_events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_analytics_events_project_id ON analytics_events(project_id);
  CREATE INDEX IF NOT EXISTS idx_analytics_events_session_id ON analytics_events(session_id);

  -- -------------------------------------------------------------------------
  -- message_buffer: WebSocket message persistence for reconnection sync
  -- -------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS message_buffer (
    id TEXT PRIMARY KEY,                    -- ULID
    connection_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    type TEXT NOT NULL,                     -- GenesisPrompt|ProgressReport|ErrorReport
    payload TEXT NOT NULL,                  -- JSON: complete message
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL                -- TTL expiration time
  );

  CREATE INDEX IF NOT EXISTS idx_message_buffer_connection ON message_buffer(connection_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_message_buffer_expires ON message_buffer(expires_at);

  -- -------------------------------------------------------------------------
  -- resource_allocations: Resource quota management per project
  -- -------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS resource_allocations (
    id TEXT PRIMARY KEY,                    -- ULID
    project_id TEXT NOT NULL,
    goal_id TEXT NOT NULL,
    priority TEXT NOT NULL,                 -- P0|P1|P2|P3
    cpu_quota REAL,                         -- CPU core quota
    token_quota_hour INTEGER,               -- Hourly token quota
    cost_quota_cents INTEGER,               -- Cost quota in cents
    allocated_at TEXT NOT NULL DEFAULT (datetime('now')),
    active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_resource_allocations_project_id ON resource_allocations(project_id);
  CREATE INDEX IF NOT EXISTS idx_resource_allocations_priority ON resource_allocations(priority);

  -- -------------------------------------------------------------------------
  -- project_milestones: Milestone-based payment tracking
  -- -------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS project_milestones (
    id TEXT PRIMARY KEY,                    -- ULID
    project_id TEXT NOT NULL,
    goal_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    percentage INTEGER NOT NULL,            -- Payment percentage
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending|in_progress|completed|skipped
    completed_at TEXT,
    delivered_at TEXT,
    approved_at TEXT,
    amount_cents INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_milestones_project_id ON project_milestones(project_id);
  CREATE INDEX IF NOT EXISTS idx_milestones_status ON project_milestones(status);
`;

/**
 * ALTER statements for extending the goals table
 *
 * These must be executed separately from CREATE TABLE statements
 * due to SQLite limitations.
 */
export const SCHEMA_V11_ALTER_GOALS_PROJECT_ID = `
  ALTER TABLE goals ADD COLUMN project_id TEXT REFERENCES projects(id);
`;

export const SCHEMA_V11_ALTER_GOALS_SOURCE = `
  ALTER TABLE goals ADD COLUMN source TEXT DEFAULT 'internal';
`;

export const SCHEMA_V11_ALTER_GOALS_GENESIS_PROMPT_ID = `
  ALTER TABLE goals ADD COLUMN genesis_prompt_id TEXT;
`;

export const SCHEMA_V11_ALTER_GOALS_RESOURCE_LIMIT = `
  ALTER TABLE goals ADD COLUMN resource_limit_cents INTEGER DEFAULT 0;
`;

export const SCHEMA_V11_ALTER_GOALS_ACTUAL_COST = `
  ALTER TABLE goals ADD COLUMN actual_cost_cents INTEGER DEFAULT 0;
`;

/**
 * Index creation for goals table extensions
 */
export const SCHEMA_V11_INDEX_GOALS = `
  CREATE INDEX IF NOT EXISTS idx_goals_project_id ON goals(project_id);
  CREATE INDEX IF NOT EXISTS idx_goals_source ON goals(source);
`;

/**
 * Apply Schema v11 migration to the database
 *
 * This function:
 * 1. Creates all new tables (clients, projects, etc.)
 * 2. Extends the existing goals table with new columns
 * 3. Creates all required indexes
 * 4. Updates schema_version to 11
 *
 * @param db - better-sqlite3 Database instance
 * @returns MigrationResult with details of what was created
 *
 * @example
 * ```typescript
 * import Database from 'better-sqlite3';
 * import { applySchemaV11 } from './schema-v11.js';
 *
 * const db = new Database('automaton.db');
 * const result = applySchemaV11(db);
 * console.log(`Created ${result.tablesCreated.length} tables`);
 * ```
 */
export function applySchemaV11(db: DatabaseType): MigrationResult {
  const tablesCreated: string[] = [
    'clients',
    'projects',
    'bid_history',
    'manual_interventions',
    'analytics_events',
    'message_buffer',
    'resource_allocations',
    'project_milestones',
  ];

  const indexesCreated: string[] = [
    'idx_clients_platform_id',
    'idx_clients_tier',
    'idx_clients_rating',
    'idx_projects_platform_id',
    'idx_projects_status',
    'idx_projects_score',
    'idx_projects_client',
    'idx_projects_created_at',
    'idx_bid_history_project_id',
    'idx_bid_history_status',
    'idx_manual_interventions_type',
    'idx_manual_interventions_status',
    'idx_manual_interventions_project_id',
    'idx_analytics_events_type',
    'idx_analytics_events_timestamp',
    'idx_analytics_events_project_id',
    'idx_analytics_events_session_id',
    'idx_message_buffer_connection',
    'idx_message_buffer_expires',
    'idx_resource_allocations_project_id',
    'idx_resource_allocations_priority',
    'idx_milestones_project_id',
    'idx_milestones_status',
    'idx_goals_project_id',
    'idx_goals_source',
  ];

  const migrate = db.transaction(() => {
    // Apply main migration (CREATE TABLE and CREATE INDEX)
    db.exec(SCHEMA_V11_MIGRATION);

    // Apply ALTER TABLE statements for goals table
    // Use try-catch because columns may already exist in partial migrations
    try {
      db.exec(SCHEMA_V11_ALTER_GOALS_PROJECT_ID);
    } catch {
      // Column may already exist - ignore
    }

    try {
      db.exec(SCHEMA_V11_ALTER_GOALS_SOURCE);
    } catch {
      // Column may already exist - ignore
    }

    try {
      db.exec(SCHEMA_V11_ALTER_GOALS_GENESIS_PROMPT_ID);
    } catch {
      // Column may already exist - ignore
    }

    try {
      db.exec(SCHEMA_V11_ALTER_GOALS_RESOURCE_LIMIT);
    } catch {
      // Column may already exist - ignore
    }

    try {
      db.exec(SCHEMA_V11_ALTER_GOALS_ACTUAL_COST);
    } catch {
      // Column may already exist - ignore
    }

    // Create indexes for goals table
    try {
      db.exec(SCHEMA_V11_INDEX_GOALS);
    } catch {
      // Indexes may already exist - ignore
    }

    // Update schema version
    db.prepare("INSERT INTO schema_version (version) VALUES (11)").run();
  });

  migrate();

  return {
    version: 11,
    appliedAt: new Date().toISOString(),
    tablesCreated,
    indexesCreated,
  };
}
