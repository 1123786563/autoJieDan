/**
 * Budget Tracker
 *
 * Tracks Conway compute credit spending, predicts runway,
 * and triggers budget alerts when thresholds are crossed.
 */

import type {
  ConwayClient,
  AutomatonDatabase,
  BudgetAlert,
  BudgetConfig,
  SpendingRecord,
  RunwayInfo,
} from "../types.js";
import { formatCredits } from "../conway/credits.js";

/**
 * Budget Tracker for monitoring compute credit consumption.
 */
export class BudgetTracker {
  private config: BudgetConfig;

  constructor(config: BudgetConfig) {
    this.config = config;
  }

  /**
   * Get the current credit balance.
   */
  async getCurrentBalance(
    conway: ConwayClient,
  ): Promise<number> {
    try {
      return await conway.getCreditsBalance();
    } catch (error) {
      console.error("Failed to get credit balance:", error);
      return 0;
    }
  }

  /**
   * Get spending history for the specified number of days.
   * Reads from database storage where historical snapshots are stored.
   */
  async getSpendingHistory(
    db: AutomatonDatabase,
    days: number = 7,
  ): Promise<SpendingRecord[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const historyStr = db.getKV("spending_history");
    if (!historyStr) return [];

    try {
      const allHistory: SpendingRecord[] = JSON.parse(historyStr);
      return allHistory
        .filter((record) => new Date(record.timestamp) >= cutoffDate)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    } catch {
      return [];
    }
  }

  /**
   * Predict runway based on current balance and spending patterns.
   */
  async predictRunway(
    db: AutomatonDatabase,
    balance: number,
  ): Promise<RunwayInfo> {
    // Get recent spending history
    const history = await this.getSpendingHistory(db, 7);

    if (history.length < 2) {
      // Insufficient data for prediction
      return {
        estimatedDays: -1,
        confidence: "insufficient_data",
        averageDailySpend: 0,
        projectedDepletionDate: null,
      };
    }

    // Calculate average daily spend using actual time span
    const firstRecord = history[0];
    const lastRecord = history[history.length - 1];
    const totalSpent = firstRecord.balanceCents - lastRecord.balanceCents; // Positive when spent

    // Calculate actual days between first and last record
    const firstTime = new Date(firstRecord.timestamp).getTime();
    const lastTime = new Date(lastRecord.timestamp).getTime();
    const daysSpan = Math.max(1, (lastTime - firstTime) / (24 * 60 * 60 * 1000));

    const averageDailySpend = Math.abs(totalSpent) / daysSpan;

    // Predict runway
    let estimatedDays = -1;
    let confidence: "high" | "medium" | "low" | "insufficient_data" = "low";

    if (averageDailySpend > 0) {
      estimatedDays = Math.floor(balance / averageDailySpend);

      // Confidence based on data points
      if (history.length >= 14) {
        confidence = "high";
      } else if (history.length >= 7) {
        confidence = "medium";
      } else {
        confidence = "low";
      }
    }

    // Calculate projected depletion date
    let projectedDepletionDate: string | null = null;
    if (estimatedDays >= 0) {
      const depletionDate = new Date();
      depletionDate.setDate(depletionDate.getDate() + estimatedDays);
      projectedDepletionDate = depletionDate.toISOString();
    }

    return {
      estimatedDays,
      confidence,
      averageDailySpend,
      projectedDepletionDate,
    };
  }

  /**
   * Check for budget alerts based on current balance and runway.
   */
  async checkBudgetAlert(
    db: AutomatonDatabase,
    conway: ConwayClient,
  ): Promise<BudgetAlert[]> {
    const alerts: BudgetAlert[] = [];
    const balance = await this.getCurrentBalance(conway);
    const runway = await this.predictRunway(db, balance);

    // Check balance threshold alerts
    if (balance < this.config.alertThresholds.critical) {
      alerts.push({
        type: "critical",
        severity: "urgent",
        message: `Critical balance: ${formatCredits(balance)} remaining. Immediate funding required.`,
        balanceCents: balance,
        estimatedDays: runway.estimatedDays,
        timestamp: new Date().toISOString(),
      });
    } else if (balance < this.config.alertThresholds.warning) {
      alerts.push({
        type: "warning",
        severity: "high",
        message: `Low balance: ${formatCredits(balance)} remaining. Consider funding soon.`,
        balanceCents: balance,
        estimatedDays: runway.estimatedDays,
        timestamp: new Date().toISOString(),
      });
    }

    // Check runway threshold alerts
    if (runway.estimatedDays >= 0 && runway.estimatedDays < this.config.alertThresholds.minRunwayDays) {
      alerts.push({
        type: "runway",
        severity: runway.estimatedDays < 3 ? "urgent" : "high",
        message: `Low runway: ${runway.estimatedDays} days estimated at ${formatCredits(runway.averageDailySpend)}/day.`,
        balanceCents: balance,
        estimatedDays: runway.estimatedDays,
        timestamp: new Date().toISOString(),
      });
    }

    // Check spending rate anomaly alert
    const history = await this.getSpendingHistory(db, 7);
    if (history.length >= 7) {
      const recentSpend = Math.abs(history[history.length - 1].balanceCents - history[history.length - 4].balanceCents) / 3;
      const olderSpend = Math.abs(history[3].balanceCents - history[0].balanceCents) / 3;

      if (recentSpend > olderSpend * 2 && recentSpend > this.config.alertThresholds.anomalyMultiplier * this.config.baselineDailySpend) {
        alerts.push({
          type: "anomaly",
          severity: "medium",
          message: `Spending anomaly detected: Recent daily spend (${formatCredits(recentSpend)}) is 2x+ baseline.`,
          balanceCents: balance,
          estimatedDays: runway.estimatedDays,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return alerts;
  }

  /**
   * Record a spending snapshot for historical tracking.
   */
  recordSpendingSnapshot(
    db: AutomatonDatabase,
    balanceCents: number,
  ): void {
    const snapshot: SpendingRecord = {
      timestamp: new Date().toISOString(),
      balanceCents,
    };

    const historyStr = db.getKV("spending_history") || "[]";
    let history: SpendingRecord[] = [];

    try {
      history = JSON.parse(historyStr);
    } catch {
      history = [];
    }

    history.push(snapshot);

    // Keep only last 90 days of data
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    history = history.filter((record) => new Date(record.timestamp) >= cutoff);

    db.setKV("spending_history", JSON.stringify(history));
  }

  /**
   * Get budget statistics summary.
   */
  async getBudgetSummary(
    db: AutomatonDatabase,
    conway: ConwayClient,
  ): Promise<{
    currentBalance: number;
    runway: RunwayInfo;
    recentSpend: number;
    alerts: BudgetAlert[];
  }> {
    const balance = await this.getCurrentBalance(conway);
    const runway = await this.predictRunway(db, balance);

    // Calculate recent spend (last 24h)
    const history = await this.getSpendingHistory(db, 1);
    let recentSpend = 0;
    if (history.length >= 2) {
      recentSpend = Math.abs(history[history.length - 1].balanceCents - history[0].balanceCents);
    }

    const alerts = await this.checkBudgetAlert(db, conway);

    return {
      currentBalance: balance,
      runway,
      recentSpend,
      alerts,
    };
  }
}

/**
 * Create a BudgetTracker with default configuration.
 */
export function createBudgetTracker(config?: Partial<BudgetConfig>): BudgetTracker {
  const defaultConfig: BudgetConfig = {
    baselineDailySpend: 100, // $1.00 per day in cents
    alertThresholds: {
      critical: 500, // $5.00
      warning: 2000, // $20.00
      minRunwayDays: 7,
      anomalyMultiplier: 2,
    },
    snapshotIntervalMinutes: 60,
  };

  const mergedConfig = { ...defaultConfig, ...config };
  return new BudgetTracker(mergedConfig);
}
