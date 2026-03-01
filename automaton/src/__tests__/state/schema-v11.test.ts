/**
 * Tests for Schema V11 Migration - AutoJieDan MVP Tables
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import os from "os";
import {
  SCHEMA_VERSION,
  CREATE_TABLES,
  MIGRATION_V9,
  MIGRATION_V11,
  MIGRATION_V11_ALTER_GOALS_PROJECT_ID,
  MIGRATION_V11_ALTER_GOALS_SOURCE,
  MIGRATION_V11_ALTER_GOALS_GENESIS_PROMPT_ID,
  MIGRATION_V11_ALTER_GOALS_RESOURCE_LIMIT,
  MIGRATION_V11_ALTER_GOALS_ACTUAL_COST,
  MIGRATION_V11_INDEX_GOALS,
} from "../../state/schema.js";

describe("Schema V11 Migration", () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    // Create a temporary database
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "automaton-test-"));
    dbPath = path.join(tmpDir, "test.db");
    db = new Database(dbPath);

    // Enable WAL mode and foreign keys
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    db.close();
    // Clean up temp directory
    const tmpDir = path.dirname(dbPath);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should have SCHEMA_VERSION set to 11", () => {
    expect(SCHEMA_VERSION).toBe(11);
  });

  it("should create clients table with correct columns", () => {
    // First create base tables
    db.exec(CREATE_TABLES);

    // Apply V11 migration
    db.exec(MIGRATION_V11);

    // Verify clients table exists
    const clientsTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='clients'"
      )
      .get();
    expect(clientsTable).toBeDefined();

    // Verify columns
    const columns = db
      .prepare("PRAGMA table_info(clients)")
      .all() as { name: string }[];
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("id");
    expect(columnNames).toContain("platform");
    expect(columnNames).toContain("platform_client_id");
    expect(columnNames).toContain("name");
    expect(columnNames).toContain("company");
    expect(columnNames).toContain("rating");
    expect(columnNames).toContain("total_spent_cents");
    expect(columnNames).toContain("payment_verified");
    expect(columnNames).toContain("country");
    expect(columnNames).toContain("tier");
    expect(columnNames).toContain("language_preference");
    expect(columnNames).toContain("response_time_hours");
    expect(columnNames).toContain("total_projects");
    expect(columnNames).toContain("hired_freelancers");
    expect(columnNames).toContain("created_at");
    expect(columnNames).toContain("updated_at");
    expect(columnNames).toContain("metadata");
  });

  it("should create projects table with correct columns", () => {
    db.exec(CREATE_TABLES);
    db.exec(MIGRATION_V11);

    const projectsTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='projects'"
      )
      .get();
    expect(projectsTable).toBeDefined();

    const columns = db
      .prepare("PRAGMA table_info(projects)")
      .all() as { name: string }[];
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("id");
    expect(columnNames).toContain("platform");
    expect(columnNames).toContain("platform_project_id");
    expect(columnNames).toContain("title");
    expect(columnNames).toContain("description");
    expect(columnNames).toContain("client_id");
    expect(columnNames).toContain("status");
    expect(columnNames).toContain("score");
    expect(columnNames).toContain("score_factors");
    expect(columnNames).toContain("bid_id");
    expect(columnNames).toContain("contract_id");
    expect(columnNames).toContain("budget_cents");
    expect(columnNames).toContain("deadline");
    expect(columnNames).toContain("created_at");
    expect(columnNames).toContain("updated_at");
    expect(columnNames).toContain("discovered_at");
    expect(columnNames).toContain("metadata");
  });

  it("should create bid_history table", () => {
    db.exec(CREATE_TABLES);
    db.exec(MIGRATION_V11);

    const bidHistoryTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='bid_history'"
      )
      .get();
    expect(bidHistoryTable).toBeDefined();
  });

  it("should create manual_interventions table", () => {
    db.exec(CREATE_TABLES);
    db.exec(MIGRATION_V11);

    const interventionsTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='manual_interventions'"
      )
      .get();
    expect(interventionsTable).toBeDefined();
  });

  it("should create analytics_events table", () => {
    db.exec(CREATE_TABLES);
    db.exec(MIGRATION_V11);

    const analyticsTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='analytics_events'"
      )
      .get();
    expect(analyticsTable).toBeDefined();
  });

  it("should create message_buffer table", () => {
    db.exec(CREATE_TABLES);
    db.exec(MIGRATION_V11);

    const messageBufferTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='message_buffer'"
      )
      .get();
    expect(messageBufferTable).toBeDefined();
  });

  it("should create resource_allocations table", () => {
    db.exec(CREATE_TABLES);
    db.exec(MIGRATION_V11);

    const resourceTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='resource_allocations'"
      )
      .get();
    expect(resourceTable).toBeDefined();
  });

  it("should create project_milestones table", () => {
    db.exec(CREATE_TABLES);
    db.exec(MIGRATION_V11);

    const milestonesTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='project_milestones'"
      )
      .get();
    expect(milestonesTable).toBeDefined();
  });

  it("should create unique index on clients(platform, platform_client_id)", () => {
    db.exec(CREATE_TABLES);
    db.exec(MIGRATION_V11);

    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='clients'"
      )
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("idx_clients_platform_id");
  });

  it("should create unique index on projects(platform, platform_project_id)", () => {
    db.exec(CREATE_TABLES);
    db.exec(MIGRATION_V11);

    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='projects'"
      )
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("idx_projects_platform_id");
  });

  it("should add project_id column to goals table", () => {
    db.exec(CREATE_TABLES);
    db.exec(MIGRATION_V9); // Create goals table first
    db.exec(MIGRATION_V11);

    // Apply ALTER statements
    try {
      db.exec(MIGRATION_V11_ALTER_GOALS_PROJECT_ID);
    } catch {
      /* may already exist */
    }

    const columns = db
      .prepare("PRAGMA table_info(goals)")
      .all() as { name: string }[];
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("project_id");
  });

  it("should add source column to goals table", () => {
    db.exec(CREATE_TABLES);
    db.exec(MIGRATION_V9); // Create goals table first
    db.exec(MIGRATION_V11);

    try {
      db.exec(MIGRATION_V11_ALTER_GOALS_SOURCE);
    } catch {
      /* may already exist */
    }

    const columns = db
      .prepare("PRAGMA table_info(goals)")
      .all() as { name: string }[];
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("source");
  });

  it("should add genesis_prompt_id column to goals table", () => {
    db.exec(CREATE_TABLES);
    db.exec(MIGRATION_V9); // Create goals table first
    db.exec(MIGRATION_V11);

    try {
      db.exec(MIGRATION_V11_ALTER_GOALS_GENESIS_PROMPT_ID);
    } catch {
      /* may already exist */
    }

    const columns = db
      .prepare("PRAGMA table_info(goals)")
      .all() as { name: string }[];
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("genesis_prompt_id");
  });

  it("should insert and query a client record", () => {
    db.exec(CREATE_TABLES);
    db.exec(MIGRATION_V11);

    // Insert a client
    db.prepare(`
      INSERT INTO clients (id, platform, platform_client_id, name, tier, rating)
      VALUES ('01HQXYZ123', 'upwork', 'client-123', 'Test Client', 'gold', 4.8)
    `).run();

    // Query the client
    const client = db
      .prepare("SELECT * FROM clients WHERE id = ?")
      .get("01HQXYZ123") as {
        id: string;
        platform: string;
        name: string;
        tier: string;
        rating: number;
      };

    expect(client).toBeDefined();
    expect(client.platform).toBe("upwork");
    expect(client.name).toBe("Test Client");
    expect(client.tier).toBe("gold");
    expect(client.rating).toBe(4.8);
  });

  it("should insert and query a project record", () => {
    db.exec(CREATE_TABLES);
    db.exec(MIGRATION_V11);

    // Insert a client first
    db.prepare(`
      INSERT INTO clients (id, platform, platform_client_id, name)
      VALUES ('01HQXYZ123', 'upwork', 'client-123', 'Test Client')
    `).run();

    // Insert a project
    db.prepare(`
      INSERT INTO projects (id, platform, platform_project_id, title, status, client_id, score, budget_cents)
      VALUES ('01HQPROJ456', 'upwork', 'proj-456', 'Test Project', 'discovered', '01HQXYZ123', 85, 50000)
    `).run();

    // Query the project
    const project = db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get("01HQPROJ456") as {
        id: string;
        title: string;
        status: string;
        score: number;
        budget_cents: number;
      };

    expect(project).toBeDefined();
    expect(project.title).toBe("Test Project");
    expect(project.status).toBe("discovered");
    expect(project.score).toBe(85);
    expect(project.budget_cents).toBe(50000);
  });

  it("should insert and query a manual_intervention record", () => {
    db.exec(CREATE_TABLES);
    db.exec(MIGRATION_V11);

    // Insert an intervention
    db.prepare(`
      INSERT INTO manual_interventions (id, intervention_type, reason, status)
      VALUES ('01HQINT789', 'contract_sign', 'New contract requires approval', 'pending')
    `).run();

    // Query the intervention
    const intervention = db
      .prepare("SELECT * FROM manual_interventions WHERE id = ?")
      .get("01HQINT789") as {
        id: string;
        intervention_type: string;
        reason: string;
        status: string;
      };

    expect(intervention).toBeDefined();
    expect(intervention.intervention_type).toBe("contract_sign");
    expect(intervention.status).toBe("pending");
  });
});
