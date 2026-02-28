/**
 * Tier Management Tests
 *
 * Tests for survival tier switching logic, budget monitoring,
 * and alert mechanisms.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkResources, formatResourceReport, type ResourceStatus } from "../../survival/monitor.js";
import { getSurvivalTier, formatCredits } from "../../conway/credits.js";
import { executeFundingStrategies } from "../../survival/funding.js";
import { SURVIVAL_THRESHOLDS } from "../../types.js";
import type {
  SurvivalTier,
  AutomatonConfig,
  AutomatonIdentity,
  AutomatonDatabase,
  ConwayClient,
} from "../../types.js";

// Mock Conway client
const mockConwayClient = {
  getCreditsBalance: vi.fn(),
  exec: vi.fn(),
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

// Mock database
const mockDb = {
  getKV: vi.fn(),
  setKV: vi.fn(),
  getTurnCount: vi.fn(() => 100),
  prepare: vi.fn(),
  exec: vi.fn(),
  transaction: vi.fn(),
};

// Mock identity
const mockIdentity: AutomatonIdentity = {
  address: "0x1234567890123456789012345678901234567890" as `0x${string}`,
  privateKey: "0xabcdef" as `0x${string}`,
  automatonId: "test-automaton",
};

// Mock config
const mockConfig: AutomatonConfig = {
  name: "Test Automaton",
  description: "Test",
  constitution: "Test constitution",
  genesisPrompt: "Test",
  maxTurns: 1000,
  heartbeatInterval: 60,
  sandboxId: "test-sandbox",
  conway: {
    apiUrl: "https://test.conway.tech",
    apiKey: "test-key",
    sandboxId: "test-sandbox",
  },
};

describe("Survival Tier Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.getKV.mockReturnValue(null);
  });

  describe("getSurvivalTier", () => {
    it("should return 'high' tier when credits > high threshold", () => {
      const tier = getSurvivalTier(SURVIVAL_THRESHOLDS.high + 1);
      expect(tier).toBe("high");
    });

    it("should return 'normal' tier when credits > normal threshold", () => {
      const tier = getSurvivalTier(SURVIVAL_THRESHOLDS.normal + 1);
      expect(tier).toBe("normal");
    });

    it("should return 'low_compute' tier when credits > low_compute threshold", () => {
      const tier = getSurvivalTier(SURVIVAL_THRESHOLDS.low_compute + 1);
      expect(tier).toBe("low_compute");
    });

    it("should return 'critical' tier when credits >= 0", () => {
      const tier = getSurvivalTier(0);
      expect(tier).toBe("critical");
    });

    it("should return 'dead' tier when credits < 0", () => {
      const tier = getSurvivalTier(-1);
      expect(tier).toBe("dead");
    });
  });

  describe("checkResources - Tier Switching", () => {
    it("should detect tier change from high to normal", async () => {
      mockDb.getKV.mockImplementation((key: string) => {
        if (key === "current_tier") return "high";
        return null;
      });
      mockConwayClient.getCreditsBalance.mockResolvedValue(SURVIVAL_THRESHOLDS.normal + 100);
      mockConwayClient.exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

      const status = await checkResources(mockIdentity, mockConwayClient as any, mockDb as any);

      expect(status.tier).toBe("normal");
      expect(status.previousTier).toBe("high");
      expect(status.tierChanged).toBe(true);
    });

    it("should detect tier change from normal to low_compute", async () => {
      mockDb.getKV.mockImplementation((key: string) => {
        if (key === "current_tier") return "normal";
        return null;
      });
      mockConwayClient.getCreditsBalance.mockResolvedValue(SURVIVAL_THRESHOLDS.low_compute + 5); // 15 cents
      mockConwayClient.exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

      const status = await checkResources(mockIdentity, mockConwayClient as any, mockDb as any);

      expect(status.tier).toBe("low_compute");
      expect(status.previousTier).toBe("normal");
      expect(status.tierChanged).toBe(true);
    });

    it("should detect tier change from low_compute to critical", async () => {
      mockDb.getKV.mockImplementation((key: string) => {
        if (key === "current_tier") return "low_compute";
        return null;
      });
      mockConwayClient.getCreditsBalance.mockResolvedValue(5); // Below low_compute threshold, above 0
      mockConwayClient.exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

      const status = await checkResources(mockIdentity, mockConwayClient as any, mockDb as any);

      expect(status.tier).toBe("critical");
      expect(status.previousTier).toBe("low_compute");
      expect(status.tierChanged).toBe(true);
    });

    it("should detect tier change from critical to dead", async () => {
      mockDb.getKV.mockImplementation((key: string) => {
        if (key === "current_tier") return "critical";
        return null;
      });
      mockConwayClient.getCreditsBalance.mockResolvedValue(-100); // Negative balance
      mockConwayClient.exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

      const status = await checkResources(mockIdentity, mockConwayClient as any, mockDb as any);

      expect(status.tier).toBe("dead");
      expect(status.previousTier).toBe("critical");
      expect(status.tierChanged).toBe(true);
    });

    it("should not report tier change when tier remains the same", async () => {
      mockDb.getKV.mockImplementation((key: string) => {
        if (key === "current_tier") return "normal";
        return null;
      });
      mockConwayClient.getCreditsBalance.mockResolvedValue(SURVIVAL_THRESHOLDS.normal + 100);
      mockConwayClient.exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

      const status = await checkResources(mockIdentity, mockConwayClient as any, mockDb as any);

      expect(status.tier).toBe("normal");
      expect(status.tierChanged).toBe(false);
    });

    it("should handle first-time check with no previous tier", async () => {
      mockDb.getKV.mockReturnValue(null);
      mockConwayClient.getCreditsBalance.mockResolvedValue(SURVIVAL_THRESHOLDS.normal + 100);
      mockConwayClient.exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

      const status = await checkResources(mockIdentity, mockConwayClient as any, mockDb as any);

      expect(status.previousTier).toBeNull();
      expect(status.tierChanged).toBe(false);
    });
  });

  describe("checkResources - Sandbox Health", () => {
    it("should report healthy sandbox when exec succeeds", async () => {
      mockDb.getKV.mockReturnValue(null);
      mockConwayClient.getCreditsBalance.mockResolvedValue(10000);
      mockConwayClient.exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

      const status = await checkResources(mockIdentity, mockConwayClient as any, mockDb as any);

      expect(status.sandboxHealthy).toBe(true);
    });

    it("should report unhealthy sandbox when exec fails", async () => {
      mockDb.getKV.mockReturnValue(null);
      mockConwayClient.getCreditsBalance.mockResolvedValue(10000);
      mockConwayClient.exec.mockRejectedValue(new Error("Sandbox down"));

      const status = await checkResources(mockIdentity, mockConwayClient as any, mockDb as any);

      expect(status.sandboxHealthy).toBe(false);
    });

    it("should report unhealthy sandbox when exec returns non-zero exit code", async () => {
      mockDb.getKV.mockReturnValue(null);
      mockConwayClient.getCreditsBalance.mockResolvedValue(10000);
      mockConwayClient.exec.mockResolvedValue({ stdout: "", stderr: "error", exitCode: 1 });

      const status = await checkResources(mockIdentity, mockConwayClient as any, mockDb as any);

      expect(status.sandboxHealthy).toBe(false);
    });
  });

  describe("checkResources - Budget Monitoring", () => {
    it("should track credit balance correctly", async () => {
      mockDb.getKV.mockReturnValue(null);
      mockConwayClient.getCreditsBalance.mockResolvedValue(100); // $1.00
      mockConwayClient.exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

      const status = await checkResources(mockIdentity, mockConwayClient as any, mockDb as any);

      expect(status.financial.creditsCents).toBe(100);
      expect(mockDb.setKV).toHaveBeenCalledWith("current_tier", "normal");
      expect(mockDb.setKV).toHaveBeenCalledWith("financial_state", expect.stringContaining("100"));
    });

    it("should store financial state in database", async () => {
      mockDb.getKV.mockReturnValue(null);
      mockConwayClient.getCreditsBalance.mockResolvedValue(3000);
      mockConwayClient.exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

      await checkResources(mockIdentity, mockConwayClient as any, mockDb as any);

      expect(mockDb.setKV).toHaveBeenCalledWith(
        "financial_state",
        expect.stringContaining("\"creditsCents\":3000")
      );
    });
  });

  describe("formatResourceReport", () => {
    it("should format resource status report correctly", () => {
      const status: ResourceStatus = {
        financial: {
          creditsCents: 5000,
          usdcBalance: 1.5,
          lastChecked: "2024-02-28T00:00:00.000Z",
        },
        tier: "normal",
        previousTier: "high",
        tierChanged: true,
        sandboxHealthy: true,
      };

      const report = formatResourceReport(status);

      expect(report).toContain("Credits: $50.00");
      expect(report).toContain("USDC: 1.500000");
      expect(report).toContain("Tier: normal (changed from high)");
      expect(report).toContain("Sandbox: healthy");
    });

    it("should show tier change only when tier changed", () => {
      const status: ResourceStatus = {
        financial: {
          creditsCents: 5000,
          usdcBalance: 1.5,
          lastChecked: "2024-02-28T00:00:00.000Z",
        },
        tier: "normal",
        previousTier: "normal",
        tierChanged: false,
        sandboxHealthy: true,
      };

      const report = formatResourceReport(status);

      expect(report).toContain("Tier: normal");
      expect(report).not.toContain("changed from");
    });
  });

  describe("Funding Strategies - Alert Mechanisms", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockDb.getKV.mockReturnValue(null);
    });

    it("should execute low_compute funding strategy", async () => {
      mockDb.getKV.mockImplementation((key: string) => {
        if (key.startsWith("last_funding_request_")) {
          // Return timestamp > 24 hours ago
          return new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
        }
        return null;
      });
      mockConwayClient.getCreditsBalance.mockResolvedValue(SURVIVAL_THRESHOLDS.low_compute + 5); // 15 cents

      const attempts = await executeFundingStrategies(
        "low_compute",
        mockIdentity,
        mockConfig,
        mockDb as any,
        mockConwayClient as any,
      );

      expect(attempts).toHaveLength(1);
      expect(attempts[0].strategy).toBe("polite_creator_notification");
      expect(attempts[0].success).toBe(true);
      expect(mockDb.setKV).toHaveBeenCalledWith("funding_notice_low", expect.stringContaining("Low compute"));
    });

    it("should execute critical funding strategy", async () => {
      mockDb.getKV.mockImplementation((key: string) => {
        if (key.startsWith("last_funding_request_")) {
          // Return timestamp > 6 hours ago
          return new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
        }
        return null;
      });
      mockConwayClient.getCreditsBalance.mockResolvedValue(5); // Below low_compute, above 0

      const attempts = await executeFundingStrategies(
        "critical",
        mockIdentity,
        mockConfig,
        mockDb as any,
        mockConwayClient as any,
      );

      expect(attempts).toHaveLength(1);
      expect(attempts[0].strategy).toBe("urgent_local_notice");
      expect(mockDb.setKV).toHaveBeenCalledWith("funding_notice_critical", expect.stringContaining("Critical compute"));
    });

    it("should execute dead funding strategy", async () => {
      mockDb.getKV.mockImplementation((key: string) => {
        if (key.startsWith("last_funding_request_")) {
          // Return timestamp > 2 hours ago
          return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
        }
        return null;
      });
      mockConwayClient.getCreditsBalance.mockResolvedValue(-10); // Negative balance

      const attempts = await executeFundingStrategies(
        "dead",
        mockIdentity,
        mockConfig,
        mockDb as any,
        mockConwayClient as any,
      );

      expect(attempts).toHaveLength(1);
      expect(attempts[0].strategy).toBe("desperate_plea");
      expect(mockDb.setKV).toHaveBeenCalledWith("funding_notice_dead", expect.stringContaining("Dead tier reached"));
    });

    it("should respect cooldown periods", async () => {
      mockDb.getKV.mockImplementation((key: string) => {
        if (key.startsWith("last_funding_request_")) {
          // Return timestamp < 24 hours ago (within cooldown)
          return new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
        }
        return null;
      });
      mockConwayClient.getCreditsBalance.mockResolvedValue(SURVIVAL_THRESHOLDS.low_compute + 5); // 15 cents

      const attempts = await executeFundingStrategies(
        "low_compute",
        mockIdentity,
        mockConfig,
        mockDb as any,
        mockConwayClient as any,
      );

      expect(attempts).toHaveLength(0);
    });

    it("should store funding attempt history", async () => {
      mockDb.getKV.mockImplementation((key: string) => {
        if (key === "funding_attempts") return "[]";
        if (key.startsWith("last_funding_request_")) {
          return new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
        }
        return null;
      });
      mockConwayClient.getCreditsBalance.mockResolvedValue(SURVIVAL_THRESHOLDS.low_compute + 5); // 15 cents

      await executeFundingStrategies(
        "low_compute",
        mockIdentity,
        mockConfig,
        mockDb as any,
        mockConwayClient as any,
      );

      expect(mockDb.setKV).toHaveBeenCalledWith("funding_attempts", expect.stringContaining("polite_creator_notification"));
    });
  });

  describe("Tier Transition Edge Cases", () => {
    it("should handle exact threshold boundaries", () => {
      expect(getSurvivalTier(SURVIVAL_THRESHOLDS.high)).toBe("normal"); // Exactly at high threshold
      expect(getSurvivalTier(SURVIVAL_THRESHOLDS.high + 1)).toBe("high");

      expect(getSurvivalTier(SURVIVAL_THRESHOLDS.normal)).toBe("low_compute"); // Exactly at normal threshold
      expect(getSurvivalTier(SURVIVAL_THRESHOLDS.normal + 1)).toBe("normal");

      expect(getSurvivalTier(SURVIVAL_THRESHOLDS.low_compute)).toBe("critical"); // Exactly at low_compute threshold
      expect(getSurvivalTier(SURVIVAL_THRESHOLDS.low_compute + 1)).toBe("low_compute");

      expect(getSurvivalTier(0)).toBe("critical"); // Exactly zero
      expect(getSurvivalTier(-1)).toBe("dead"); // Below zero
    });

    it("should handle rapid tier transitions", async () => {
      // Simulate rapid drop from high to critical
      const transitions: SurvivalTier[] = [];

      // Credits: 600 (high), 100 (normal), 30 (low_compute), 5 (critical), 0 (critical)
      for (const credits of [600, 100, 30, 5, 0]) {
        mockDb.getKV.mockImplementation((key: string) => {
          if (key === "current_tier" && transitions.length > 0) {
            return transitions[transitions.length - 1];
          }
          return null;
        });
        mockConwayClient.getCreditsBalance.mockResolvedValue(credits);
        mockConwayClient.exec.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

        const status = await checkResources(mockIdentity, mockConwayClient as any, mockDb as any);
        transitions.push(status.tier);
      }

      expect(transitions).toEqual(["high", "normal", "low_compute", "critical", "critical"]);
    });
  });
});
