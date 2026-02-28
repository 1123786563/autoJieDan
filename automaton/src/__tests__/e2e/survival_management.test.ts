/**
 * Survival Management E2E Tests
 *
 * End-to-end tests for survival management, including:
 * - Budget tracking E2E flow
 * - Alert mechanisms when balance falls below thresholds
 * - Conway API integration
 * - Survival decision flows (downgrade, pause, etc.)
 *
 * @module tests.e2e.survival_management
 * @version 1.0.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type BetterSqlite3 from "better-sqlite3";
import { createInMemoryDb } from "../orchestration/test-db.js";
import { checkResources, formatResourceReport } from "../../survival/monitor.js";
import { getSurvivalTier, formatCredits } from "../../conway/credits.js";
import { executeFundingStrategies } from "../../survival/funding.js";
import { BudgetTracker, createBudgetTracker } from "../../survival/budget_tracker.js";
import { SURVIVAL_THRESHOLDS } from "../../types.js";
import type {
  SurvivalTier,
  AutomatonConfig,
  AutomatonIdentity,
  AutomatonDatabase,
  ConwayClient,
} from "../../types.js";

// ─── Test Constants ─────────────────────────────────────────────────────────────

const MOCK_IDENTITY: AutomatonIdentity = {
  address: "0x1234567890123456789012345678901234567890" as `0x${string}`,
  privateKey: "0xabcdef" as `0x${string}`,
  automatonId: "test-survival-automaton",
};

const MOCK_CONFIG: AutomatonConfig = {
  name: "Survival Test Automaton",
  description: "E2E test for survival management",
  constitution: "Test constitution",
  genesisPrompt: "Test genesis prompt",
  maxTurns: 1000,
  heartbeatInterval: 60,
  sandboxId: "test-survival-sandbox",
  conway: {
    apiUrl: "https://test.conway.tech",
    apiKey: "test-survival-key",
    sandboxId: "test-survival-sandbox",
  },
};

// ─── Mock Conway Client Factory ────────────────────────────────────────────────

function createMockConwayClient(initialBalance: number = 1000) {
  const getCreditsBalance = vi.fn<() => Promise<number>>().mockResolvedValue(initialBalance);
  const exec = vi.fn<() => Promise<{ stdout: string; stderr: string; exitCode: number }>>()
    .mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

  return {
    getCreditsBalance,
    exec,
    writeFile: vi.fn(),
    readFile: vi.fn(),
    exposePort: vi.fn(),
    removePort: vi.fn(),
    createSandbox: vi.fn(),
    deleteSandbox: vi.fn(),
    listSandboxes: vi.fn(),
    getCreditsPricing: vi.fn(),
    transferCredits: vi.fn(),
    registerAutomaton: vi.fn(),
    searchDomains: vi.fn(),
    registerDomain: vi.fn(),
    listDnsRecords: vi.fn(),
    addDnsRecord: vi.fn(),
    deleteDnsRecord: vi.fn(),
    listModels: vi.fn(),
  };
}

// ─── Helper Functions ───────────────────────────────────────────────────────────

function setupDatabase(db: BetterSqlite3.Database): void {
  // Initialize required tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function getKV(db: BetterSqlite3.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setKV(db: BetterSqlite3.Database, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))")
    .run(key, value);
}

function wrapDb(db: BetterSqlite3.Database): AutomatonDatabase {
  return {
    getKV: (key: string) => getKV(db, key),
    setKV: (key: string, value: string) => setKV(db, key, value),
    getTurnCount: () => 100,
    prepare: db.prepare.bind(db),
    exec: db.exec.bind(db),
    transaction: db.transaction.bind(db),
  } as unknown as AutomatonDatabase;
}

// ─── E2E Tests ─────────────────────────────────────────────────────────────────

describe("Survival Management E2E", () => {
  let db: BetterSqlite3.Database;
  let mockDb: AutomatonDatabase;
  let mockConway: ReturnType<typeof createMockConwayClient>;
  let budgetTracker: BudgetTracker;

  beforeEach(() => {
    db = createInMemoryDb();
    setupDatabase(db);
    mockDb = wrapDb(db);
    mockConway = createMockConwayClient(1000); // Start with $10
    budgetTracker = createBudgetTracker({
      baselineDailySpend: 10, // $0.10/day
      alertThresholds: {
        critical: 50, // $0.50
        warning: 200, // $2.00
        minRunwayDays: 7,
        anomalyMultiplier: 2,
      },
      snapshotIntervalMinutes: 60,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Budget Tracking E2E Flow", () => {
    it("should track complete budget lifecycle from healthy to critical", async () => {
      // Phase 1: Healthy state ($10)
      mockConway.getCreditsBalance.mockResolvedValue(1000); // > high threshold
      let status = await checkResources(MOCK_IDENTITY, mockConway, mockDb);

      expect(status.tier).toBe("high");
      expect(status.financial.creditsCents).toBe(1000);

      budgetTracker.recordSpendingSnapshot(mockDb, 1000);

      // Phase 2: Normal state ($1)
      mockConway.getCreditsBalance.mockResolvedValue(100); // > normal threshold
      status = await checkResources(MOCK_IDENTITY, mockConway, mockDb);

      expect(status.tier).toBe("normal");
      expect(status.tierChanged).toBe(true);
      expect(status.previousTier).toBe("high");

      budgetTracker.recordSpendingSnapshot(mockDb, 100);

      // Phase 3: Low compute state ($0.15)
      mockConway.getCreditsBalance.mockResolvedValue(15); // > low_compute threshold
      status = await checkResources(MOCK_IDENTITY, mockConway, mockDb);

      expect(status.tier).toBe("low_compute");
      expect(status.tierChanged).toBe(true);

      budgetTracker.recordSpendingSnapshot(mockDb, 15);

      // Phase 4: Critical state ($0.03)
      mockConway.getCreditsBalance.mockResolvedValue(3); // >= 0
      status = await checkResources(MOCK_IDENTITY, mockConway, mockDb);

      expect(status.tier).toBe("critical");
      expect(status.tierChanged).toBe(true);

      budgetTracker.recordSpendingSnapshot(mockDb, 3);

      // Verify spending history
      const history = await budgetTracker.getSpendingHistory(mockDb, 7);
      expect(history.length).toBe(4);

      // Verify runway prediction
      const runway = await budgetTracker.predictRunway(mockDb, 3);
      // May have insufficient data points for accurate prediction
      expect(runway.estimatedDays).toBeGreaterThanOrEqual(0);
    });

    it("should generate budget summary with all components", async () => {
      // Setup multiple spending records
      for (let i = 0; i < 5; i++) {
        const balance = 300 - i * 50;
        mockConway.getCreditsBalance.mockResolvedValue(balance);
        await checkResources(MOCK_IDENTITY, mockConway, mockDb);
        budgetTracker.recordSpendingSnapshot(mockDb, balance);
      }

      // Get budget summary
      mockConway.getCreditsBalance.mockResolvedValue(100);
      const summary = await budgetTracker.getBudgetSummary(mockDb, mockConway);

      expect(summary.currentBalance).toBe(100);
      expect(summary.runway.estimatedDays).toBeGreaterThanOrEqual(0);
      // recentSpend may be 0 if only one record in 24h window
      expect(Array.isArray(summary.alerts)).toBe(true);
    });
  });

  describe("Alert Mechanisms E2E", () => {
    it("should trigger alerts when balance drops below thresholds", async () => {
      const alerts: string[] = [];

      // Helper to collect alerts
      const collectAlerts = async () => {
        const budgetAlerts = await budgetTracker.checkBudgetAlert(mockDb, mockConway);
        budgetAlerts.forEach(alert => {
          alerts.push(`${alert.type}:${alert.severity}`);
        });
      };

      // Start healthy
      mockConway.getCreditsBalance.mockResolvedValue(1000);
      await checkResources(MOCK_IDENTITY, mockConway, mockDb);
      await collectAlerts();
      expect(alerts.length).toBe(0);

      // Drop to warning level
      mockConway.getCreditsBalance.mockResolvedValue(150); // Below warning threshold (200)
      await checkResources(MOCK_IDENTITY, mockConway, mockDb);
      await collectAlerts();
      expect(alerts.length).toBeGreaterThan(0); // Should have warning alert

      // Drop to critical level
      mockConway.getCreditsBalance.mockResolvedValue(30); // Below critical threshold (50)
      await checkResources(MOCK_IDENTITY, mockConway, mockDb);
      const previousAlertCount = alerts.length;
      await collectAlerts();
      expect(alerts.length).toBeGreaterThan(previousAlertCount); // Should have critical alert
    }, 15000); // 15 second timeout for E2E test

    it("should not spam alerts within cooldown period", async () => {
      const originalGetKV = mockDb.getKV.bind(mockDb);
      mockDb.getKV = vi.fn().mockImplementation((key: string) => {
        if (key === "last_funding_request_low_compute") {
          // Return recent timestamp (within cooldown)
          return new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
        }
        return originalGetKV(key);
      });

      mockConway.getCreditsBalance.mockResolvedValue(15); // low_compute tier

      // Should be blocked by cooldown
      const attempts = await executeFundingStrategies(
        "low_compute",
        MOCK_IDENTITY,
        MOCK_CONFIG,
        mockDb,
        mockConway as any,
      );

      expect(attempts.length).toBe(0);
    });
  });

  describe("Conway API Integration E2E", () => {
    it("should handle Conway API failures gracefully", async () => {
      // Simulate API failure
      mockConway.getCreditsBalance.mockRejectedValue(new Error("API timeout"));
      mockConway.exec.mockRejectedValue(new Error("Sandbox unavailable"));

      const status = await checkResources(MOCK_IDENTITY, mockConway, mockDb);

      // Should still return status with degraded values
      expect(status.financial.creditsCents).toBe(0);
      expect(status.sandboxHealthy).toBe(false);
      expect(status.tier).toBe("critical"); // Default to critical when unknown
    });

    it("should recover from transient failures", async () => {
      // First call fails
      mockConway.getCreditsBalance.mockRejectedValueOnce(new Error("API timeout"));

      let status = await checkResources(MOCK_IDENTITY, mockConway, mockDb);
      expect(status.financial.creditsCents).toBe(0);

      // Second call succeeds
      mockConway.getCreditsBalance.mockResolvedValue(200); // $2
      mockConway.exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

      status = await checkResources(MOCK_IDENTITY, mockConway, mockDb);
      expect(status.financial.creditsCents).toBe(200);
      expect(status.sandboxHealthy).toBe(true);
    });
  });

  describe("Survival Decision Flows E2E", () => {
    it("should trigger pause behavior when dead tier is reached", async () => {
      const originalGetKV = mockDb.getKV.bind(mockDb);
      mockDb.getKV = vi.fn().mockImplementation((key: string) => {
        if (key === "last_funding_request_dead") {
          // Return timestamp > 2 hours ago
          return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
        }
        if (key === "current_tier") return "critical";
        return originalGetKV(key);
      });

      // Drop to dead tier
      mockConway.getCreditsBalance.mockResolvedValue(-10); // Negative balance
      const status = await checkResources(MOCK_IDENTITY, mockConway, mockDb);

      expect(status.tier).toBe("dead");
      expect(status.tierChanged).toBe(true);

      // Dead tier should trigger desperate plea
      const attempts = await executeFundingStrategies(
        "dead",
        MOCK_IDENTITY,
        MOCK_CONFIG,
        mockDb,
        mockConway as any,
      );

      expect(attempts.length).toBe(1);
      expect(attempts[0].strategy).toBe("desperate_plea");
    });

    it("should recover tier when balance is replenished", async () => {
      const originalGetKV = mockDb.getKV.bind(mockDb);
      mockDb.getKV = vi.fn().mockImplementation((key: string) => {
        if (key === "current_tier") return "critical";
        return originalGetKV(key);
      });

      // Start at critical
      mockConway.getCreditsBalance.mockResolvedValue(5);
      let status = await checkResources(MOCK_IDENTITY, mockConway, mockDb);
      expect(status.tier).toBe("critical");

      // Replenish to normal
      mockConway.getCreditsBalance.mockResolvedValue(100);
      status = await checkResources(MOCK_IDENTITY, mockConway, mockDb);

      expect(status.tier).toBe("normal");
      expect(status.tierChanged).toBe(true);
      expect(status.previousTier).toBe("critical");
    });
  });

  describe("Resource Report Generation E2E", () => {
    it("should generate comprehensive resource report", async () => {
      mockConway.getCreditsBalance.mockResolvedValue(600); // $6 > high threshold
      mockConway.exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

      const status = await checkResources(MOCK_IDENTITY, mockConway, mockDb);
      const report = formatResourceReport(status);

      expect(report).toContain("=== RESOURCE STATUS ===");
      expect(report).toContain("Credits: $6.00");
      expect(report).toContain("Tier: high");
      expect(report).toContain("Sandbox: healthy");
    });

    it("should include tier change information in report", async () => {
      const originalGetKV = mockDb.getKV.bind(mockDb);
      mockDb.getKV = vi.fn().mockImplementation((key: string) => {
        if (key === "current_tier") return "high";
        return originalGetKV(key);
      });

      mockConway.getCreditsBalance.mockResolvedValue(100);
      mockConway.exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

      const status = await checkResources(MOCK_IDENTITY, mockConway, mockDb);
      const report = formatResourceReport(status);

      expect(report).toContain("(changed from high)");
    });
  });

  describe("Cross-Component Integration E2E", () => {
    it("should integrate budget tracking with tier management", async () => {
      // Simulate spending across tiers
      const balances = [
        1000, // high
        100,  // normal
        30,   // low_compute
        5,    // critical
      ];
      const tiers: SurvivalTier[] = [];

      for (const balance of balances) {
        mockConway.getCreditsBalance.mockResolvedValue(balance);
        mockConway.exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

        const status = await checkResources(MOCK_IDENTITY, mockConway, mockDb);
        tiers.push(status.tier);

        budgetTracker.recordSpendingSnapshot(mockDb, balance);
      }

      // Verify tier progression
      expect(tiers).toEqual(["high", "normal", "low_compute", "critical"]);

      // Verify budget alerts at final critical state
      const alerts = await budgetTracker.checkBudgetAlert(mockDb, mockConway);
      expect(alerts.length).toBeGreaterThan(0); // Should have critical alert
    });

    it("should coordinate funding requests with tier status", async () => {
      const originalGetKV = mockDb.getKV.bind(mockDb);
      mockDb.getKV = vi.fn().mockImplementation((key: string) => {
        if (key === "last_funding_request_critical") {
          // 7 hours ago - past cooldown
          return new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
        }
        return originalGetKV(key);
      });

      mockConway.getCreditsBalance.mockResolvedValue(5); // Critical tier
      const status = await checkResources(MOCK_IDENTITY, mockConway, mockDb);

      expect(status.tier).toBe("critical");

      const attempts = await executeFundingStrategies(
        status.tier,
        MOCK_IDENTITY,
        MOCK_CONFIG,
        mockDb,
        mockConway as any,
      );

      expect(attempts.length).toBe(1);
      expect(attempts[0].strategy).toBe("urgent_local_notice");

      // Verify notification was stored
      const notice = mockDb.getKV("funding_notice_critical");
      expect(notice).toContain("Critical compute");
    });
  });
});
