/**
 * Business Budget Tracker Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { BudgetTracker, createBudgetTracker } from "../../biz/budget-tracker.js";
import type { BudgetTransaction, BudgetAlert } from "../../types.js";

// Mock database
const mockDb = {
  getKV: vi.fn(),
  setKV: vi.fn(),
  getTurnCount: vi.fn(() => 100),
  prepare: vi.fn(),
  exec: vi.fn(),
  transaction: vi.fn(),
  getAllKV: vi.fn(() => []),
};

describe("BudgetTracker", () => {
  let tracker: BudgetTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    tracker = new BudgetTracker(mockDb as any);
  });

  describe("recordTransaction", () => {
    it("should record an income transaction", () => {
      mockDb.getKV.mockReturnValue("[]");

      const transaction = tracker.recordTransaction({
        projectId: "project-1",
        type: "income",
        amount: 1000.00,
        category: "payment",
        description: "Client payment",
      });

      expect(transaction.id).toBeDefined();
      expect(transaction.projectId).toBe("project-1");
      expect(transaction.type).toBe("income");
      expect(transaction.amount).toBe(1000.00);
      expect(transaction.timestamp).toBeDefined();

      expect(mockDb.setKV).toHaveBeenCalledWith(
        "budget_transactions",
        expect.stringContaining("project-1")
      );
    });

    it("should record an expense transaction", () => {
      mockDb.getKV.mockReturnValue("[]");

      const transaction = tracker.recordTransaction({
        projectId: "project-1",
        type: "expense",
        amount: 50.25,
        category: "infrastructure",
        description: "Server costs",
        reference: "inv-12345",
      });

      expect(transaction.type).toBe("expense");
      expect(transaction.amount).toBe(50.25);
      expect(transaction.reference).toBe("inv-12345");
    });

    it("should round amounts to $0.01 precision", () => {
      mockDb.getKV.mockReturnValue("[]");

      const transaction = tracker.recordTransaction({
        projectId: "project-1",
        type: "income",
        amount: 1000.123456,
        category: "payment",
        description: "Test",
      });

      expect(transaction.amount).toBe(1000.12);
    });
  });

  describe("getTransactions", () => {
    it("should return all transactions when no project filter", () => {
      const transactions: BudgetTransaction[] = [
        {
          id: "1",
          projectId: "project-1",
          type: "income",
          amount: 1000,
          category: "payment",
          description: "Payment 1",
          timestamp: new Date().toISOString(),
        },
        {
          id: "2",
          projectId: "project-2",
          type: "expense",
          amount: 50,
          category: "infrastructure",
          description: "Cost 1",
          timestamp: new Date().toISOString(),
        },
      ];
      mockDb.getKV.mockReturnValue(JSON.stringify(transactions));

      const result = tracker.getTransactions();

      expect(result).toHaveLength(2);
    });

    it("should filter transactions by project ID", () => {
      const transactions: BudgetTransaction[] = [
        {
          id: "1",
          projectId: "project-1",
          type: "income",
          amount: 1000,
          category: "payment",
          description: "Payment 1",
          timestamp: new Date().toISOString(),
        },
        {
          id: "2",
          projectId: "project-2",
          type: "expense",
          amount: 50,
          category: "infrastructure",
          description: "Cost 1",
          timestamp: new Date().toISOString(),
        },
      ];
      mockDb.getKV.mockReturnValue(JSON.stringify(transactions));

      const result = tracker.getTransactions("project-1");

      expect(result).toHaveLength(1);
      expect(result[0].projectId).toBe("project-1");
    });
  });

  describe("setBudget and getBudgetConfig", () => {
    it("should set budget for a project", () => {
      tracker.setBudget("project-1", 5000, "USD");

      expect(mockDb.setKV).toHaveBeenCalledWith(
        "budget_config_project-1",
        expect.stringContaining("5000")
      );
    });

    it("should get budget config for a project", () => {
      const config = {
        projectId: "project-1",
        totalBudget: 5000,
        currency: "USD",
        createdAt: new Date().toISOString(),
      };
      mockDb.getKV.mockReturnValue(JSON.stringify(config));

      const result = tracker.getBudgetConfig("project-1");

      expect(result).toEqual(config);
    });

    it("should return null for non-existent project", () => {
      mockDb.getKV.mockReturnValue(null);

      const result = tracker.getBudgetConfig("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("getBudgetStatus", () => {
    it("should return default status for new project", () => {
      mockDb.getKV.mockReturnValue(null);

      const status = tracker.getBudgetStatus("new-project");

      expect(status.projectId).toBe("new-project");
      expect(status.totalBudget).toBe(0);
      expect(status.remaining).toBe(0);
      expect(status.utilizationPercent).toBe(0);
    });

    it("should return stored status", () => {
      const status = {
        projectId: "project-1",
        totalBudget: 5000,
        totalIncome: 1000,
        totalExpenses: 2000,
        remaining: 4000,
        utilizationPercent: 40,
        lastUpdated: new Date().toISOString(),
      };
      mockDb.getKV.mockReturnValue(JSON.stringify(status));

      const result = tracker.getBudgetStatus("project-1");

      expect(result).toEqual(status);
    });
  });

  describe("checkBudgetAlerts", () => {
    beforeEach(() => {
      // Set up budget config
      const config = {
        projectId: "project-1",
        totalBudget: 5000,
        currency: "USD",
        createdAt: new Date().toISOString(),
      };
      mockDb.getKV.mockImplementation((key: string) => {
        if (key === "budget_config_project-1") return JSON.stringify(config);
        if (key === "budget_status_project-1") {
          return JSON.stringify({
            projectId: "project-1",
            totalBudget: 5000,
            totalIncome: 0,
            totalExpenses: 0,
            remaining: 5000,
            utilizationPercent: 0,
            lastUpdated: new Date().toISOString(),
          });
        }
        if (key === "budget_transactions") return "[]";
        return null;
      });
    });

    it("should generate critical alert when over budget", () => {
      const overBudgetStatus = {
        projectId: "project-1",
        totalBudget: 5000,
        totalIncome: 0,
        totalExpenses: 5500,
        remaining: -500,
        utilizationPercent: 110,
        lastUpdated: new Date().toISOString(),
      };
      mockDb.getKV.mockImplementation((key: string) => {
        if (key === "budget_config_project-1") {
          return JSON.stringify({
            projectId: "project-1",
            totalBudget: 5000,
            currency: "USD",
            createdAt: new Date().toISOString(),
          });
        }
        if (key === "budget_status_project-1") return JSON.stringify(overBudgetStatus);
        if (key === "budget_transactions") return "[]";
        return null;
      });

      const alerts = tracker.checkBudgetAlerts("project-1");

      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("critical");
      expect(alerts[0].type).toBe("overspend");
    });

    it("should generate warning alert when near budget limit", () => {
      const nearLimitStatus = {
        projectId: "project-1",
        totalBudget: 5000,
        totalIncome: 0,
        totalExpenses: 4600,
        remaining: 400,
        utilizationPercent: 92,
        lastUpdated: new Date().toISOString(),
      };
      mockDb.getKV.mockImplementation((key: string) => {
        if (key === "budget_config_project-1") {
          return JSON.stringify({
            projectId: "project-1",
            totalBudget: 5000,
            currency: "USD",
            createdAt: new Date().toISOString(),
          });
        }
        if (key === "budget_status_project-1") return JSON.stringify(nearLimitStatus);
        if (key === "budget_transactions") return "[]";
        return null;
      });

      const alerts = tracker.checkBudgetAlerts("project-1");

      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("warning");
      expect(alerts[0].type).toBe("near_limit");
    });

    it("should generate info alert when utilization is high", () => {
      const highUtilizationStatus = {
        projectId: "project-1",
        totalBudget: 5000,
        totalIncome: 0,
        totalExpenses: 3800,
        remaining: 1200,
        utilizationPercent: 76,
        lastUpdated: new Date().toISOString(),
      };
      mockDb.getKV.mockImplementation((key: string) => {
        if (key === "budget_config_project-1") {
          return JSON.stringify({
            projectId: "project-1",
            totalBudget: 5000,
            currency: "USD",
            createdAt: new Date().toISOString(),
          });
        }
        if (key === "budget_status_project-1") return JSON.stringify(highUtilizationStatus);
        if (key === "budget_transactions") return "[]";
        return null;
      });

      const alerts = tracker.checkBudgetAlerts("project-1");

      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("info");
      expect(alerts[0].type).toBe("high_utilization");
    });

    it("should return no alerts when budget is healthy", () => {
      const healthyStatus = {
        projectId: "project-1",
        totalBudget: 5000,
        totalIncome: 0,
        totalExpenses: 1000,
        remaining: 4000,
        utilizationPercent: 20,
        lastUpdated: new Date().toISOString(),
      };
      mockDb.getKV.mockImplementation((key: string) => {
        if (key === "budget_config_project-1") {
          return JSON.stringify({
            projectId: "project-1",
            totalBudget: 5000,
            currency: "USD",
            createdAt: new Date().toISOString(),
          });
        }
        if (key === "budget_status_project-1") return JSON.stringify(healthyStatus);
        if (key === "budget_transactions") return "[]";
        return null;
      });

      const alerts = tracker.checkBudgetAlerts("project-1");

      expect(alerts).toHaveLength(0);
    });
  });

  describe("generateReport", () => {
    it("should generate report for all projects", () => {
      const transactions: BudgetTransaction[] = [
        {
          id: "1",
          projectId: "project-1",
          type: "income",
          amount: 5000,
          category: "payment",
          description: "Payment",
          timestamp: new Date().toISOString(),
        },
        {
          id: "2",
          projectId: "project-1",
          type: "expense",
          amount: 1000,
          category: "development",
          description: "Dev cost",
          timestamp: new Date().toISOString(),
        },
        {
          id: "3",
          projectId: "project-2",
          type: "income",
          amount: 3000,
          category: "payment",
          description: "Payment",
          timestamp: new Date().toISOString(),
        },
      ];

      mockDb.getKV.mockImplementation((key: string) => {
        if (key === "budget_transactions") return JSON.stringify(transactions);
        if (key === "budget_config_project-1") {
          return JSON.stringify({ projectId: "project-1", totalBudget: 5000, currency: "USD", createdAt: new Date().toISOString() });
        }
        if (key === "budget_config_project-2") {
          return JSON.stringify({ projectId: "project-2", totalBudget: 3000, currency: "USD", createdAt: new Date().toISOString() });
        }
        if (key.startsWith("budget_status_")) {
          return JSON.stringify({
            projectId: key.replace("budget_status_", ""),
            totalBudget: 5000,
            totalIncome: 0,
            totalExpenses: 0,
            remaining: 5000,
            utilizationPercent: 0,
            lastUpdated: new Date().toISOString(),
          });
        }
        return null;
      });
      mockDb.getAllKV.mockReturnValue(["budget_config_project-1", "budget_config_project-2"]);

      const report = tracker.generateReport();

      expect(report.projectId).toBe("all");
      expect(report.totalIncome).toBe(8000);
      expect(report.totalExpenses).toBe(1000);
      expect(report.transactionCount).toBe(3);
    });
  });

  describe("getRealTimeTracking", () => {
    it("should return real-time tracking data", () => {
      const now = new Date();
      const transactions: BudgetTransaction[] = [
        {
          id: "1",
          projectId: "project-1",
          type: "expense",
          amount: 100,
          category: "infrastructure",
          description: "Server",
          timestamp: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: "2",
          projectId: "project-1",
          type: "expense",
          amount: 150,
          category: "infrastructure",
          description: "Server",
          timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ];

      mockDb.getKV.mockImplementation((key: string) => {
        if (key === "budget_transactions") return JSON.stringify(transactions);
        if (key === "budget_config_project-1") {
          return JSON.stringify({ projectId: "project-1", totalBudget: 5000, currency: "USD", createdAt: now.toISOString() });
        }
        if (key === "budget_status_project-1") {
          return JSON.stringify({
            projectId: "project-1",
            totalBudget: 5000,
            totalIncome: 0,
            totalExpenses: 250,
            remaining: 4750,
            utilizationPercent: 5,
            lastUpdated: now.toISOString(),
          });
        }
        return null;
      });

      const tracking = tracker.getRealTimeTracking("project-1");

      expect(tracking.currentStatus.projectId).toBe("project-1");
      expect(tracking.recentTransactions).toHaveLength(2);
      expect(tracking.forecast.dailyBurnRate).toBeGreaterThan(0);
    });
  });
});

describe("createBudgetTracker", () => {
  it("should create BudgetTracker instance", () => {
    const tracker = createBudgetTracker(mockDb as any);

    expect(tracker).toBeInstanceOf(BudgetTracker);
  });
});
