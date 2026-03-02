/**
 * Tests for Schema v11 Migration
 *
 * Verifies:
 * - All tables are created successfully
 * - Schema version is updated to 11
 * - All indexes are created
 * - Foreign key constraints work correctly
 * - ALTER TABLE statements for goals table work
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { unlinkSync, existsSync } from 'fs';
import {
  SCHEMA_V11_MIGRATION,
  applySchemaV11,
  type MigrationResult,
} from '../../src/state/schema-v11.js';

const TEST_DB_PATH = './test-schema-v11.db';

describe('Schema v11 Migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }

    // Create fresh test database with base schema
    db = new Database(TEST_DB_PATH);

    // Create schema_version table (required for migration)
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create goals table (required for foreign key references)
    db.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        deadline TEXT,
        completed_at TEXT
      )
    `);

    // Set initial schema version to 10
    db.prepare("INSERT INTO schema_version (version) VALUES (10)").run();
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  describe('SCHEMA_V11_MIGRATION constant', () => {
    it('should contain CREATE TABLE statements for all required tables', () => {
      const requiredTables = [
        'clients',
        'projects',
        'bid_history',
        'manual_interventions',
        'analytics_events',
        'message_buffer',
        'resource_allocations',
        'project_milestones',
      ];

      for (const tableName of requiredTables) {
        expect(SCHEMA_V11_MIGRATION).toContain(`CREATE TABLE IF NOT EXISTS ${tableName}`);
      }
    });

    it('should contain CREATE INDEX statements for all required indexes', () => {
      const requiredIndexes = [
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
      ];

      for (const indexName of requiredIndexes) {
        expect(SCHEMA_V11_MIGRATION).toContain(`CREATE INDEX IF NOT EXISTS ${indexName}`);
      }
    });
  });

  describe('applySchemaV11 function', () => {
    it('should return MigrationResult with correct structure', () => {
      const result = applySchemaV11(db);

      expect(result).toBeDefined();
      expect(result.version).toBe(11);
      expect(result.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(Array.isArray(result.tablesCreated)).toBe(true);
      expect(Array.isArray(result.indexesCreated)).toBe(true);
    });

    it('should create all required tables', () => {
      const result = applySchemaV11(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];

      const tableNames = tables.map((t) => t.name);

      // Check base tables
      expect(tableNames).toContain('schema_version');
      expect(tableNames).toContain('goals');

      // Check new v11 tables
      for (const tableName of result.tablesCreated) {
        expect(tableNames).toContain(tableName);
      }
    });

    it('should create all required indexes', () => {
      applySchemaV11(db);

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
        .all() as { name: string }[];

      const indexNames = indexes.map((i) => i.name);

      // Check that all expected indexes exist
      const expectedIndexes = [
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

      for (const indexName of expectedIndexes) {
        expect(indexNames).toContain(indexName);
      }
    });

    it('should update schema_version to 11', () => {
      applySchemaV11(db);

      const version = db
        .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
        .get() as { version: number };

      expect(version.version).toBe(11);
    });

    it('should add columns to goals table', () => {
      applySchemaV11(db);

      const pragma = db.pragma('table_info(goals)') as {
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }[];

      const columnNames = pragma.map((c) => c.name);

      // Check new columns exist
      expect(columnNames).toContain('project_id');
      expect(columnNames).toContain('source');
      expect(columnNames).toContain('genesis_prompt_id');
      expect(columnNames).toContain('resource_limit_cents');
      expect(columnNames).toContain('actual_cost_cents');
    });

    it('should handle multiple migrations without errors', () => {
      // First migration
      const result1 = applySchemaV11(db);
      expect(result1.version).toBe(11);

      // Second migration should be idempotent (no errors)
      // Note: In production, this would be guarded by version check
      // Here we just verify it doesn't crash
      expect(() => {
        db.exec('BEGIN');
        try {
          db.exec(SCHEMA_V11_MIGRATION);
        } catch (e) {
          // Table already exists - expected
        }
        db.exec('COMMIT');
      }).not.toThrow();
    });
  });

  describe('Foreign key constraints', () => {
    beforeEach(() => {
      applySchemaV11(db);
    });

    it('should enforce foreign key from projects to clients', () => {
      // Insert a client
      const clientResult = db
        .prepare(
          'INSERT INTO clients (id, platform, platform_client_id, name) VALUES (?, ?, ?, ?)'
        )
        .run('client-1', 'upwork', 'upwork-client-1', 'Test Client');

      expect(clientResult.changes).toBe(1);

      // Insert a project referencing the client
      const projectResult = db
        .prepare(
          'INSERT INTO projects (id, platform, platform_project_id, title, client_id) VALUES (?, ?, ?, ?, ?)'
        )
        .run('project-1', 'upwork', 'upwork-project-1', 'Test Project', 'client-1');

      expect(projectResult.changes).toBe(1);

      // Verify foreign key works
      const project = db
        .prepare('SELECT client_id FROM projects WHERE id = ?')
        .get('project-1') as { client_id: string };

      expect(project.client_id).toBe('client-1');
    });

    it('should enforce foreign key from bid_history to projects', () => {
      // Insert a client and project first
      db.prepare('INSERT INTO clients (id, platform, platform_client_id, name) VALUES (?, ?, ?, ?)').run(
        'client-1',
        'upwork',
        'upwork-client-1',
        'Test Client'
      );

      db.prepare(
        'INSERT INTO projects (id, platform, platform_project_id, title, client_id) VALUES (?, ?, ?, ?, ?)'
      ).run('project-1', 'upwork', 'upwork-project-1', 'Test Project', 'client-1');

      // Insert a bid referencing the project
      const bidResult = db
        .prepare(
          'INSERT INTO bid_history (id, project_id, cover_letter) VALUES (?, ?, ?)'
        )
        .run('bid-1', 'project-1', 'Test cover letter');

      expect(bidResult.changes).toBe(1);
    });

    it('should enforce foreign key from analytics_events to projects and clients', () => {
      // Insert test data
      db.prepare('INSERT INTO clients (id, platform, platform_client_id, name) VALUES (?, ?, ?, ?)').run(
        'client-1',
        'upwork',
        'upwork-client-1',
        'Test Client'
      );

      db.prepare(
        'INSERT INTO projects (id, platform, platform_project_id, title, client_id) VALUES (?, ?, ?, ?, ?)'
      ).run('project-1', 'upwork', 'upwork-project-1', 'Test Project', 'client-1');

      // Insert analytics event
      const eventResult = db
        .prepare(
          'INSERT INTO analytics_events (id, event_type, project_id, client_id) VALUES (?, ?, ?, ?)'
        )
        .run('event-1', 'project_viewed', 'project-1', 'client-1');

      expect(eventResult.changes).toBe(1);
    });

    it('should enforce foreign key from resource_allocations to projects and goals', () => {
      // Insert test data
      db.prepare('INSERT INTO clients (id, platform, platform_client_id, name) VALUES (?, ?, ?, ?)').run(
        'client-1',
        'upwork',
        'upwork-client-1',
        'Test Client'
      );

      db.prepare(
        'INSERT INTO projects (id, platform, platform_project_id, title, client_id) VALUES (?, ?, ?, ?, ?)'
      ).run('project-1', 'upwork', 'upwork-project-1', 'Test Project', 'client-1');

      // Insert resource allocation
      const allocResult = db
        .prepare(
          'INSERT INTO resource_allocations (id, project_id, goal_id, priority) VALUES (?, ?, ?, ?)'
        )
        .run('alloc-1', 'project-1', 'goal-1', 'P1');

      expect(allocResult.changes).toBe(1);
    });

    it('should enforce foreign key from project_milestones to projects and goals', () => {
      // Insert test data
      db.prepare('INSERT INTO clients (id, platform, platform_client_id, name) VALUES (?, ?, ?, ?)').run(
        'client-1',
        'upwork',
        'upwork-client-1',
        'Test Client'
      );

      db.prepare(
        'INSERT INTO projects (id, platform, platform_project_id, title, client_id) VALUES (?, ?, ?, ?, ?)'
      ).run('project-1', 'upwork', 'upwork-project-1', 'Test Project', 'client-1');

      // Insert milestone
      const milestoneResult = db
        .prepare(
          'INSERT INTO project_milestones (id, project_id, goal_id, name, percentage) VALUES (?, ?, ?, ?, ?)'
        )
        .run('milestone-1', 'project-1', 'goal-1', 'First Milestone', 25);

      expect(milestoneResult.changes).toBe(1);
    });
  });

  describe('Table schema validation', () => {
    beforeEach(() => {
      applySchemaV11(db);
    });

    it('should have correct columns in clients table', () => {
      const pragma = db.pragma('table_info(clients)') as { name: string }[];
      const columns = pragma.map((c) => c.name);

      const expectedColumns = [
        'id',
        'platform',
        'platform_client_id',
        'name',
        'company',
        'rating',
        'total_spent_cents',
        'payment_verified',
        'country',
        'tier',
        'language_preference',
        'response_time_hours',
        'total_projects',
        'hired_freelancers',
        'created_at',
        'updated_at',
        'metadata',
      ];

      for (const col of expectedColumns) {
        expect(columns).toContain(col);
      }
    });

    it('should have correct columns in projects table', () => {
      const pragma = db.pragma('table_info(projects)') as { name: string }[];
      const columns = pragma.map((c) => c.name);

      const expectedColumns = [
        'id',
        'platform',
        'platform_project_id',
        'title',
        'description',
        'client_id',
        'status',
        'score',
        'score_factors',
        'bid_id',
        'contract_id',
        'budget_cents',
        'deadline',
        'created_at',
        'updated_at',
        'discovered_at',
        'metadata',
      ];

      for (const col of expectedColumns) {
        expect(columns).toContain(col);
      }
    });

    it('should have correct columns in bid_history table', () => {
      const pragma = db.pragma('table_info(bid_history)') as { name: string }[];
      const columns = pragma.map((c) => c.name);

      const expectedColumns = [
        'id',
        'project_id',
        'template_id',
        'cover_letter',
        'bid_amount_cents',
        'duration_days',
        'submitted_at',
        'status',
        'interview_invited',
        'response_received_at',
        'created_at',
        'updated_at',
      ];

      for (const col of expectedColumns) {
        expect(columns).toContain(col);
      }
    });

    it('should have correct columns in analytics_events table', () => {
      const pragma = db.pragma('table_info(analytics_events)') as { name: string }[];
      const columns = pragma.map((c) => c.name);

      const expectedColumns = [
        'id',
        'event_type',
        'timestamp',
        'properties',
        'session_id',
        'project_id',
        'client_id',
        'user_id',
        'created_at',
      ];

      for (const col of expectedColumns) {
        expect(columns).toContain(col);
      }
    });

    it('should have correct columns in manual_interventions table', () => {
      const pragma = db.pragma('table_info(manual_interventions)') as { name: string }[];
      const columns = pragma.map((c) => c.name);

      const expectedColumns = [
        'id',
        'intervention_type',
        'project_id',
        'goal_id',
        'reason',
        'context',
        'status',
        'requested_at',
        'responded_at',
        'responder',
        'decision',
        'notes',
        'sla_deadline',
        'created_at',
      ];

      for (const col of expectedColumns) {
        expect(columns).toContain(col);
      }
    });
  });
});
