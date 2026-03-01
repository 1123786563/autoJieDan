/**
 * Tests for Manual Intervention Service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import os from "os";
import {
  ManualInterventionService,
  DEFAULT_SLA_CONFIGS,
  type ManualInterventionRequest,
  type InterventionType,
} from "../../interagent/manual-intervention.js";

describe("ManualInterventionService", () => {
  let db: Database.Database;
  let service: ManualInterventionService;
  let dbPath: string;

  beforeEach(() => {
    // Create a temporary database
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "automaton-test-"));
    dbPath = path.join(tmpDir, "test.db");
    db = new Database(dbPath);

    // Enable WAL mode and foreign keys
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    // Create manual_interventions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS manual_interventions (
        id TEXT PRIMARY KEY,
        intervention_type TEXT NOT NULL,
        project_id TEXT,
        goal_id TEXT,
        reason TEXT NOT NULL,
        context TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_at TEXT NOT NULL DEFAULT (datetime('now')),
        responded_at TEXT,
        responder TEXT,
        decision TEXT,
        notes TEXT,
        sla_deadline TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_manual_interventions_type ON manual_interventions(intervention_type)
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_manual_interventions_status ON manual_interventions(status)
    `);

    service = new ManualInterventionService(db);
  });

  afterEach(() => {
    service.stopSLAChecker();
    db.close();
    // Clean up temp directory
    const tmpDir = path.dirname(dbPath);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("DEFAULT_SLA_CONFIGS", () => {
    it("should have SLA configs for all intervention types", () => {
      const types: InterventionType[] = [
        "contract_sign",
        "large_spend",
        "project_start",
        "refund",
        "dispute_l2",
        "dispute_l3",
        "quality_review",
        "customer_complaint",
      ];

      for (const type of types) {
        expect(DEFAULT_SLA_CONFIGS[type]).toBeDefined();
        expect(DEFAULT_SLA_CONFIGS[type].slaHours).toBeGreaterThan(0);
        expect(DEFAULT_SLA_CONFIGS[type].timeoutDecision).toBeDefined();
      }
    });
  });

  describe("createIntervention", () => {
    it("should create intervention with correct fields", () => {
      const request: ManualInterventionRequest = {
        interventionType: "contract_sign",
        projectId: "proj-123",
        reason: "New contract requires approval",
      };

      const intervention = service.createIntervention(request);

      expect(intervention.id).toBeDefined();
      expect(intervention.interventionType).toBe("contract_sign");
      expect(intervention.projectId).toBe("proj-123");
      expect(intervention.reason).toBe("New contract requires approval");
      expect(intervention.status).toBe("pending");
    });

    it("should set SLA deadline based on intervention type", () => {
      const request: ManualInterventionRequest = {
        interventionType: "large_spend",
        reason: "Large spend requires approval",
      };

      const intervention = service.createIntervention(request);
      const expectedDeadline = new Date(
        intervention.requestedAt.getTime() + DEFAULT_SLA_CONFIGS.large_spend.slaHours * 60 * 60 * 1000
      );

      // Allow 1 second tolerance
      expect(Math.abs(intervention.slaDeadline.getTime() - expectedDeadline.getTime())).toBeLessThan(1000);
    });

    it("should emit intervention:created event", () => {
      const listener = vi.fn();
      service.on("intervention:created", listener);

      service.createIntervention({
        interventionType: "contract_sign",
        reason: "Test",
      });

      expect(listener).toHaveBeenCalled();
    });

    it("should store context as JSON", () => {
      const request: ManualInterventionRequest = {
        interventionType: "large_spend",
        reason: "Large spend",
        context: { amount: 1000, currency: "USD" },
      };

      const intervention = service.createIntervention(request);

      expect(intervention.context).toEqual({ amount: 1000, currency: "USD" });
    });
  });

  describe("getIntervention", () => {
    it("should return intervention by id", () => {
      const created = service.createIntervention({
        interventionType: "contract_sign",
        reason: "Test",
      });

      const fetched = service.getIntervention(created.id);

      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(created.id);
    });

    it("should return null for non-existent id", () => {
      const fetched = service.getIntervention("non-existent");

      expect(fetched).toBeNull();
    });
  });

  describe("getPendingInterventions", () => {
    it("should return pending interventions", () => {
      service.createIntervention({
        interventionType: "contract_sign",
        reason: "Test 1",
      });
      service.createIntervention({
        interventionType: "large_spend",
        reason: "Test 2",
      });

      const pending = service.getPendingInterventions();

      expect(pending).toHaveLength(2);
    });

    it("should filter by intervention type", () => {
      service.createIntervention({
        interventionType: "contract_sign",
        reason: "Test 1",
      });
      service.createIntervention({
        interventionType: "large_spend",
        reason: "Test 2",
      });

      const pending = service.getPendingInterventions("contract_sign");

      expect(pending).toHaveLength(1);
      expect(pending[0].interventionType).toBe("contract_sign");
    });

    it("should not return resolved interventions", () => {
      const intervention = service.createIntervention({
        interventionType: "contract_sign",
        reason: "Test",
      });

      service.respondToIntervention({
        interventionId: intervention.id,
        decision: "approve",
      });

      const pending = service.getPendingInterventions();

      expect(pending).toHaveLength(0);
    });
  });

  describe("respondToIntervention", () => {
    it("should update status to approved", () => {
      const intervention = service.createIntervention({
        interventionType: "contract_sign",
        reason: "Test",
      });

      const resolved = service.respondToIntervention({
        interventionId: intervention.id,
        decision: "approve",
        notes: "Looks good",
        responder: "admin",
      });

      expect(resolved.status).toBe("approved");
      expect(resolved.decision).toBe("approve");
      expect(resolved.notes).toBe("Looks good");
      expect(resolved.responder).toBe("admin");
    });

    it("should update status to rejected", () => {
      const intervention = service.createIntervention({
        interventionType: "contract_sign",
        reason: "Test",
      });

      const resolved = service.respondToIntervention({
        interventionId: intervention.id,
        decision: "reject",
      });

      expect(resolved.status).toBe("rejected");
      expect(resolved.decision).toBe("reject");
    });

    it("should throw for non-existent intervention", () => {
      expect(() =>
        service.respondToIntervention({
          interventionId: "non-existent",
          decision: "approve",
        })
      ).toThrow("Intervention not found");
    });

    it("should throw for already resolved intervention", () => {
      const intervention = service.createIntervention({
        interventionType: "contract_sign",
        reason: "Test",
      });

      service.respondToIntervention({
        interventionId: intervention.id,
        decision: "approve",
      });

      expect(() =>
        service.respondToIntervention({
          interventionId: intervention.id,
          decision: "reject",
        })
      ).toThrow("already resolved");
    });

    it("should emit intervention:resolved event", () => {
      const listener = vi.fn();
      service.on("intervention:resolved", listener);

      const intervention = service.createIntervention({
        interventionType: "contract_sign",
        reason: "Test",
      });

      service.respondToIntervention({
        interventionId: intervention.id,
        decision: "approve",
      });

      expect(listener).toHaveBeenCalled();
    });
  });

  describe("cancelIntervention", () => {
    it("should cancel pending intervention", () => {
      const intervention = service.createIntervention({
        interventionType: "contract_sign",
        reason: "Test",
      });

      const cancelled = service.cancelIntervention(intervention.id, "No longer needed");

      expect(cancelled.status).toBe("rejected");
      expect(cancelled.notes).toContain("No longer needed");
    });

    it("should throw for non-pending intervention", () => {
      const intervention = service.createIntervention({
        interventionType: "contract_sign",
        reason: "Test",
      });

      service.respondToIntervention({
        interventionId: intervention.id,
        decision: "approve",
      });

      expect(() => service.cancelIntervention(intervention.id, "Test")).toThrow("Cannot cancel");
    });
  });

  describe("checkSLATimeouts", () => {
    it("should timeout expired interventions", () => {
      vi.useFakeTimers();

      // Create service with fake timers
      const timeoutService = new ManualInterventionService(db);

      const intervention = timeoutService.createIntervention({
        interventionType: "large_spend",
        reason: "Test",
        slaHours: 0.001, // ~3.6 seconds
      });

      // Advance time past SLA
      vi.advanceTimersByTime(5000);

      const timedOut = timeoutService.checkSLATimeouts();

      expect(timedOut).toHaveLength(1);
      expect(timedOut[0].id).toBe(intervention.id);

      timeoutService.stopSLAChecker();
      vi.useRealTimers();
    });
  });

  describe("getStatistics", () => {
    it("should return correct statistics", () => {
      service.createIntervention({
        interventionType: "contract_sign",
        reason: "Test 1",
      });
      service.createIntervention({
        interventionType: "contract_sign",
        reason: "Test 2",
      });
      service.createIntervention({
        interventionType: "large_spend",
        reason: "Test 3",
      });

      const stats = service.getStatistics();

      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(3);
      expect(stats.byType["contract_sign"]).toBe(2);
      expect(stats.byType["large_spend"]).toBe(1);
    });
  });
});
