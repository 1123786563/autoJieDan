/**
 * Business Budget Tracker
 *
 * Tracks project budgets, income, expenses, and alerts on overspending risks.
 *精度 $0.01, 实时追踪, 超支预警
 */

import type {
  AutomatonDatabase,
  BudgetTransaction,
  BizBudgetAlert,
  BudgetReport,
  BudgetStatus,
} from "../types.js";

// Re-export with clearer name for this module
type BusinessBudgetAlert = BizBudgetAlert;

/**
 * Business Budget Tracker for project-level budget management.
 */
export class BudgetTracker {
  private db: AutomatonDatabase;
  private precision: number = 2; // $0.01 precision

  constructor(db: AutomatonDatabase) {
    this.db = db;
  }

  /**
   * Validate transaction input.
   * @throws Error if validation fails
   */
  private validateTransaction(transaction: Omit<BudgetTransaction, "id" | "timestamp">): void {
    const { amount, type, projectId, category, description } = transaction;

    // Validate amount
    if (typeof amount !== 'number') {
      throw new Error(`Invalid transaction amount type: expected number, got ${typeof amount}`);
    }
    if (!Number.isFinite(amount)) {
      throw new Error(`Invalid transaction amount: value is not finite (NaN or Infinity)`);
    }
    if (amount < 0) {
      throw new Error(`Invalid transaction amount: cannot be negative (${amount})`);
    }
    if (amount > Number.MAX_SAFE_INTEGER / 100) {
      throw new Error(`Invalid transaction amount: exceeds maximum allowed value (${amount})`);
    }

    // Validate type
    const validTypes = ['income', 'expense'] as const;
    if (!validTypes.includes(type as any)) {
      throw new Error(`Invalid transaction type: "${type}". Must be one of: ${validTypes.join(', ')}`);
    }

    // Validate projectId
    if (!projectId || typeof projectId !== 'string') {
      throw new Error('Invalid or missing projectId');
    }
    if (projectId.length > 256) {
      throw new Error('projectId exceeds maximum length of 256 characters');
    }
    if (!/^[\w\-./]+$/.test(projectId)) {
      throw new Error('projectId contains invalid characters (only alphanumeric, underscore, hyphen, dot, slash allowed)');
    }

    // Validate category if provided
    if (category !== undefined) {
      if (typeof category !== 'string') {
        throw new Error(`Invalid category type: expected string, got ${typeof category}`);
      }
      if (category.length > 128) {
        throw new Error('category exceeds maximum length of 128 characters');
      }
    }

    // Validate description if provided
    if (description !== undefined) {
      if (typeof description !== 'string') {
        throw new Error(`Invalid description type: expected string, got ${typeof description}`);
      }
      if (description.length > 1000) {
        throw new Error('description exceeds maximum length of 1000 characters');
      }
    }
  }

  /**
   * Record a budget transaction (income or expense).
   */
  recordTransaction(transaction: Omit<BudgetTransaction, "id" | "timestamp">): BudgetTransaction {
    // Validate all inputs before processing
    this.validateTransaction(transaction);

    const newTransaction: BudgetTransaction = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      ...transaction,
      amount: this.round(transaction.amount), // Round to precision
    };

    // Store transaction
    const transactions = this.getTransactions();
    transactions.push(newTransaction);
    this.db.setKV("budget_transactions", JSON.stringify(transactions));

    // Update budget status
    this.updateBudgetStatus(transaction.projectId);

    return newTransaction;
  }

  /**
   * Get all transactions, optionally filtered by project ID.
   */
  getTransactions(projectId?: string): BudgetTransaction[] {
    const transactionsStr = this.db.getKV("budget_transactions") || "[]";
    let transactions: BudgetTransaction[] = [];

    try {
      transactions = JSON.parse(transactionsStr);
    } catch {
      transactions = [];
    }

    if (projectId) {
      transactions = transactions.filter((t) => t.projectId === projectId);
    }

    // Sort by timestamp descending
    return transactions.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  /**
   * Get current budget status for a project.
   */
  getBudgetStatus(projectId: string): BudgetStatus {
    const statusStr = this.db.getKV(`budget_status_${projectId}`);
    if (!statusStr) {
      return {
        projectId,
        totalBudget: 0,
        totalIncome: 0,
        totalExpenses: 0,
        remaining: 0,
        utilizationPercent: 0,
        lastUpdated: new Date().toISOString(),
      };
    }

    try {
      return JSON.parse(statusStr);
    } catch {
      return {
        projectId,
        totalBudget: 0,
        totalIncome: 0,
        totalExpenses: 0,
        remaining: 0,
        utilizationPercent: 0,
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  /**
   * Set or update budget for a project.
   */
  setBudget(projectId: string, totalBudget: number, currency: string = "USD"): void {
    // Validate inputs
    if (!projectId || typeof projectId !== 'string') {
      throw new Error('Invalid or missing projectId');
    }
    if (typeof totalBudget !== 'number' || !Number.isFinite(totalBudget) || totalBudget < 0) {
      throw new Error(`Invalid totalBudget: must be a non-negative finite number`);
    }
    if (typeof currency !== 'string' || currency.length !== 3) {
      throw new Error(`Invalid currency: must be a 3-letter currency code`);
    }

    const budgetData = {
      projectId,
      totalBudget: this.round(totalBudget),
      currency,
      createdAt: new Date().toISOString(),
    };

    this.db.setKV(`budget_config_${projectId}`, JSON.stringify(budgetData));
    this.updateBudgetStatus(projectId);
  }

  /**
   * Get budget configuration for a project.
   */
  getBudgetConfig(projectId: string): { totalBudget: number; currency: string; createdAt: string } | null {
    const configStr = this.db.getKV(`budget_config_${projectId}`);
    if (!configStr) return null;

    try {
      return JSON.parse(configStr);
    } catch {
      return null;
    }
  }

  /**
   * Check for budget alerts (overspending warnings).
   */
  checkBudgetAlerts(projectId?: string): BizBudgetAlert[] {
    const alerts: BizBudgetAlert[] = [];

    if (projectId) {
      const alert = this.checkProjectAlert(projectId);
      if (alert) alerts.push(alert);
    } else {
      // Check all projects
      const projects = this.getAllProjectIds();
      for (const pid of projects) {
        const alert = this.checkProjectAlert(pid);
        if (alert) alerts.push(alert);
      }
    }

    return alerts;
  }

  /**
   * Generate a financial report for a project or all projects.
   */
  generateReport(projectId?: string): BudgetReport {
    const now = new Date();
    const transactions = this.getTransactions(projectId);

    let totalIncome = 0;
    let totalExpenses = 0;
    let totalBudget = 0;

    const incomeByCategory: Record<string, number> = {};
    const expensesByCategory: Record<string, number> = {};
    const projectSummaries: Record<string, {
      budget: number;
      income: number;
      expenses: number;
      remaining: number;
      utilizationPercent: number;
    }> = {};

    // Group transactions by project and category
    const projectIds = projectId ? [projectId] : this.getAllProjectIds();

    for (const pid of projectIds) {
      const config = this.getBudgetConfig(pid);
      const budget = config?.totalBudget || 0;
      totalBudget += budget;

      const projectTransactions = transactions.filter((t) => t.projectId === pid);
      let projectIncome = 0;
      let projectExpenses = 0;

      for (const tx of projectTransactions) {
        if (tx.type === "income") {
          const amount = this.round(tx.amount);
          projectIncome += amount;
          totalIncome += amount;
          incomeByCategory[tx.category] = (incomeByCategory[tx.category] || 0) + amount;
        } else {
          const amount = this.round(tx.amount);
          projectExpenses += amount;
          totalExpenses += amount;
          expensesByCategory[tx.category] = (expensesByCategory[tx.category] || 0) + amount;
        }
      }

      const remaining = budget + projectIncome - projectExpenses;
      const utilizationPercent = budget > 0 ? this.round((projectExpenses / budget) * 100) : 0;

      projectSummaries[pid] = {
        budget,
        income: projectIncome,
        expenses: projectExpenses,
        remaining,
        utilizationPercent,
      };
    }

    return {
      projectId: projectId || "all",
      generatedAt: now.toISOString(),
      totalBudget: this.round(totalBudget),
      totalIncome: this.round(totalIncome),
      totalExpenses: this.round(totalExpenses),
      netBalance: this.round(totalBudget + totalIncome - totalExpenses),
      incomeByCategory,
      expensesByCategory,
      projectSummaries,
      transactionCount: transactions.length,
      alerts: this.checkBudgetAlerts(projectId),
    };
  }

  /**
   * Get real-time budget tracking data.
   */
  getRealTimeTracking(projectId: string): {
    currentStatus: BudgetStatus;
    recentTransactions: BudgetTransaction[];
    alerts: BizBudgetAlert[];
    forecast: {
      estimatedDaysRemaining: number;
      dailyBurnRate: number;
      projectedDepletionDate: string | null;
    };
  } {
    const status = this.getBudgetStatus(projectId);
    const recentTransactions = this.getTransactions(projectId).slice(0, 10);
    const alerts = this.checkBudgetAlerts(projectId);

    // Calculate forecast based on recent spending
    const transactions = this.getTransactions(projectId);
    const expenseTransactions = transactions.filter((t) => t.type === "expense");

    let dailyBurnRate = 0;
    let estimatedDaysRemaining = -1;
    let projectedDepletionDate: string | null = null;

    if (expenseTransactions.length >= 2) {
      const oldestExpense = expenseTransactions[expenseTransactions.length - 1];
      const newestExpense = expenseTransactions[0];
      const daysDiff = Math.max(1,
        (new Date(newestExpense.timestamp).getTime() - new Date(oldestExpense.timestamp).getTime())
        / (24 * 60 * 60 * 1000)
      );

      const totalExpenses = expenseTransactions.reduce((sum, t) => sum + t.amount, 0);
      dailyBurnRate = this.round(totalExpenses / daysDiff);

      if (dailyBurnRate > 0 && status.remaining > 0) {
        estimatedDaysRemaining = Math.floor(status.remaining / dailyBurnRate);
        const depletionDate = new Date();
        depletionDate.setDate(depletionDate.getDate() + estimatedDaysRemaining);
        projectedDepletionDate = depletionDate.toISOString();
      }
    }

    return {
      currentStatus: status,
      recentTransactions,
      alerts,
      forecast: {
        estimatedDaysRemaining,
        dailyBurnRate,
        projectedDepletionDate,
      },
    };
  }

  /**
   * Update budget status for a project.
   */
  private updateBudgetStatus(projectId: string): void {
    const config = this.getBudgetConfig(projectId);
    const transactions = this.getTransactions(projectId);

    const totalBudget = config?.totalBudget || 0;
    let totalIncome = 0;
    let totalExpenses = 0;

    for (const tx of transactions) {
      if (tx.type === "income") {
        totalIncome += this.round(tx.amount);
      } else {
        totalExpenses += this.round(tx.amount);
      }
    }

    const remaining = this.round(totalBudget + totalIncome - totalExpenses);
    const utilizationPercent = totalBudget > 0 ? this.round((totalExpenses / totalBudget) * 100) : 0;

    const status: BudgetStatus = {
      projectId,
      totalBudget,
      totalIncome: this.round(totalIncome),
      totalExpenses: this.round(totalExpenses),
      remaining,
      utilizationPercent,
      lastUpdated: new Date().toISOString(),
    };

    this.db.setKV(`budget_status_${projectId}`, JSON.stringify(status));
  }

  /**
   * Check alert for a specific project.
   */
  private checkProjectAlert(projectId: string): BizBudgetAlert | null {
    const status = this.getBudgetStatus(projectId);
    const config = this.getBudgetConfig(projectId);

    if (!config || config.totalBudget === 0) {
      return null;
    }

    const { remaining, utilizationPercent, totalExpenses, totalBudget } = status;

    // Critical: Over budget
    if (remaining < 0) {
      return {
        id: this.generateId(),
        projectId,
        severity: "critical",
        type: "overspend",
        message: `CRITICAL: Project ${projectId} is over budget by $${Math.abs(remaining).toFixed(this.precision)}`,
        currentBudget: totalBudget,
        currentExpenses: totalExpenses,
        remaining,
        utilizationPercent,
        timestamp: new Date().toISOString(),
      };
    }

    // Warning: Near budget limit (>90% utilized)
    if (utilizationPercent > 90) {
      return {
        id: this.generateId(),
        projectId,
        severity: "warning",
        type: "near_limit",
        message: `WARNING: Project ${projectId} has used ${utilizationPercent.toFixed(this.precision)}% of budget`,
        currentBudget: totalBudget,
        currentExpenses: totalExpenses,
        remaining,
        utilizationPercent,
        timestamp: new Date().toISOString(),
      };
    }

    // Info: High utilization (>75%)
    if (utilizationPercent > 75) {
      return {
        id: this.generateId(),
        projectId,
        severity: "info",
        type: "high_utilization",
        message: `INFO: Project ${projectId} has used ${utilizationPercent.toFixed(this.precision)}% of budget`,
        currentBudget: totalBudget,
        currentExpenses: totalExpenses,
        remaining,
        utilizationPercent,
        timestamp: new Date().toISOString(),
      };
    }

    return null;
  }

  /**
   * Get all unique project IDs.
   */
  private getAllProjectIds(): string[] {
    const transactions = this.getTransactions();
    const projectIds = new Set(transactions.map((t) => t.projectId));

    // Also include projects with budget config
    const keys = this.db.getAllKV?.() || [];
    for (const key of keys) {
      if (key.startsWith("budget_config_")) {
        const projectId = key.replace("budget_config_", "");
        projectIds.add(projectId);
      }
    }

    return Array.from(projectIds);
  }

  /**
   * Round to specified precision.
   */
  private round(value: number): number {
    const multiplier = Math.pow(10, this.precision);
    return Math.round(value * multiplier) / multiplier;
  }

  /**
   * Generate unique ID.
   */
  private generateId(): string {
    return `btx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * Create a BudgetTracker instance.
 */
export function createBudgetTracker(db: AutomatonDatabase): BudgetTracker {
  return new BudgetTracker(db);
}
