import { createLogger } from "../observability/logger.js";

const logger = createLogger("orchestration.resource-manager");

/** Priority levels for resource allocation */
export type Priority = "P0" | "P1" | "P2" | "P3";

/** Resource quota configuration */
export interface ResourceQuota {
  llmTokensPerHour: number;
  cpuCores: number;
  maxConcurrent: number;
}

/** Resource usage tracking */
export interface ResourceUsage {
  tokens: number;
  cpuTime: number;
}

/** Project resource allocation */
export interface ProjectResource {
  projectId: string;
  priority: Priority;
  quota: ResourceQuota;
  used: ResourceUsage;
  deadline: Date | null;
  createdAt: Date;
}

/** Priority quota configuration */
interface PriorityConfig {
  llmTokensPerHour: number;
  cpuCores: number;
  description: string;
}

/** System-wide resource limits */
interface SystemLimits {
  maxTotalTokensPerHour: number;
  maxTotalCpuCores: number;
  maxConcurrentProjects: number;
  maxProjectQuotaRatio: number; // Max ratio of total quota a single project can use
}

/** Preemption result */
export interface PreemptionResult {
  preemptedProjectIds: string[];
  releasedTokens: number;
  releasedCpuCores: number;
}

// Priority configurations based on design doc
const PRIORITY_CONFIGS: Record<Priority, PriorityConfig> = {
  P0: {
    llmTokensPerHour: Number.MAX_SAFE_INTEGER, // Unlimited
    cpuCores: 4, // Exclusive access
    description: "Deadline < 24h - Highest priority",
  },
  P1: {
    llmTokensPerHour: 100_000,
    cpuCores: 2,
    description: "Normal execution",
  },
  P2: {
    llmTokensPerHour: 50_000,
    cpuCores: 1,
    description: "New project evaluation",
  },
  P3: {
    llmTokensPerHour: 20_000,
    cpuCores: 0.5, // Shared
    description: "Waitlist queue",
  },
};

const DEFAULT_SYSTEM_LIMITS: SystemLimits = {
  maxTotalTokensPerHour: 500_000,
  maxTotalCpuCores: 8,
  maxConcurrentProjects: 5,
  maxProjectQuotaRatio: 0.5, // 50% max per project
};

const PRIORITY_ORDER: Priority[] = ["P0", "P1", "P2", "P3"];

function getPriorityIndex(priority: Priority): number {
  return PRIORITY_ORDER.indexOf(priority);
}

/**
 * ResourceManager handles resource scheduling and allocation across projects.
 *
 * Features:
 * - Priority-based resource allocation (P0-P3)
 * - Deadline-based automatic priority upgrade
 * - Preemption of low-priority resources when high-priority needs arise
 * - Fair resource distribution with max quota caps
 */
export class ResourceManager {
  private projects: Map<string, ProjectResource> = new Map();
  private maxConcurrent: number;
  private systemLimits: SystemLimits;
  private usageWindowStart: Date = new Date();

  constructor(
    maxConcurrent: number = DEFAULT_SYSTEM_LIMITS.maxConcurrentProjects,
    systemLimits: Partial<SystemLimits> = {},
  ) {
    this.maxConcurrent = maxConcurrent;
    this.systemLimits = { ...DEFAULT_SYSTEM_LIMITS, ...systemLimits };
    logger.info("ResourceManager initialized", {
      maxConcurrent,
      systemLimits: this.systemLimits,
    });
  }

  /**
   * Allocate resources for a project
   * @returns true if allocation successful, false if insufficient resources
   */
  allocateResource(projectId: string, priority: Priority, deadline?: Date): boolean {
    const existing = this.projects.get(projectId);

    if (existing) {
      // Update existing allocation
      const oldPriority = existing.priority;
      existing.priority = priority;
      existing.deadline = deadline ?? existing.deadline;
      logger.info("Resource allocation updated", {
        projectId,
        oldPriority,
        newPriority: priority,
      });
      return true;
    }

    // Check concurrent limit
    if (this.projects.size >= this.maxConcurrent) {
      // Try preemption for high-priority requests
      if (priority === "P0" || priority === "P1") {
        const preemption = this.preemptLowPriority();
        if (preemption.preemptedProjectIds.length === 0) {
          logger.warn("Resource allocation failed - max concurrent reached", {
            projectId,
            priority,
            activeProjects: this.projects.size,
          });
          return false;
        }
      } else {
        logger.warn("Resource allocation failed - max concurrent reached", {
          projectId,
          priority,
          activeProjects: this.projects.size,
        });
        return false;
      }
    }

    // Check quota availability
    const available = this.getAvailableQuota();
    const requiredQuota = this.getQuotaForPriority(priority);

    if (!this.canAllocate(requiredQuota, available)) {
      logger.warn("Resource allocation failed - insufficient quota", {
        projectId,
        priority,
        required: requiredQuota,
        available,
      });
      return false;
    }

    // Create new allocation
    const allocation: ProjectResource = {
      projectId,
      priority,
      quota: requiredQuota,
      used: { tokens: 0, cpuTime: 0 },
      deadline: deadline ?? null,
      createdAt: new Date(),
    };

    this.projects.set(projectId, allocation);
    logger.info("Resource allocated", { projectId, priority, quota: requiredQuota });
    return true;
  }

  /**
   * Release resources for a project
   */
  releaseResource(projectId: string): void {
    const allocation = this.projects.get(projectId);
    if (!allocation) {
      logger.warn("Attempted to release non-existent allocation", { projectId });
      return;
    }

    this.projects.delete(projectId);
    logger.info("Resource released", {
      projectId,
      priority: allocation.priority,
      usedTokens: allocation.used.tokens,
    });
  }

  /**
   * Get current available quota
   */
  getAvailableQuota(): ResourceQuota {
    const used = this.calculateTotalUsage();
    const allocated = this.calculateAllocatedQuota();

    return {
      llmTokensPerHour: Math.max(
        0,
        this.systemLimits.maxTotalTokensPerHour - allocated.llmTokensPerHour,
      ),
      cpuCores: Math.max(0, this.systemLimits.maxTotalCpuCores - allocated.cpuCores),
      maxConcurrent: Math.max(0, this.maxConcurrent - this.projects.size),
    };
  }

  /**
   * Get resource usage for a specific project
   */
  getProjectUsage(projectId: string): ProjectResource | null {
    return this.projects.get(projectId) ?? null;
  }

  /**
   * Get all active project allocations
   */
  getAllProjects(): ProjectResource[] {
    return Array.from(this.projects.values());
  }

  /**
   * Upgrade priority for a project (e.g., deadline approaching)
   */
  upgradePriority(projectId: string): boolean {
    const allocation = this.projects.get(projectId);
    if (!allocation) {
      return false;
    }

    const currentIndex = getPriorityIndex(allocation.priority);
    if (currentIndex === 0) {
      // Already at highest priority
      return false;
    }

    const newPriority = PRIORITY_ORDER[currentIndex - 1];
    const oldPriority = allocation.priority;

    allocation.priority = newPriority;
    allocation.quota = this.getQuotaForPriority(newPriority);

    logger.info("Priority upgraded", {
      projectId,
      oldPriority,
      newPriority,
    });

    return true;
  }

  /**
   * Automatically upgrade priorities based on deadlines
   * Rule: Every day closer to deadline = +1 priority level
   */
  autoUpgradeByDeadline(): string[] {
    const upgraded: string[] = [];
    const now = new Date();

    for (const [projectId, allocation] of this.projects) {
      if (!allocation.deadline) {
        continue;
      }

      const hoursUntilDeadline =
        (allocation.deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Upgrade if deadline < 24 hours
      if (hoursUntilDeadline < 24 && allocation.priority !== "P0") {
        allocation.priority = "P0";
        allocation.quota = this.getQuotaForPriority("P0");
        upgraded.push(projectId);
        logger.info("Auto-upgraded to P0 due to deadline", {
          projectId,
          hoursUntilDeadline: Math.round(hoursUntilDeadline),
        });
        continue;
      }

      // Upgrade if deadline < 48 hours and currently P2 or lower
      if (hoursUntilDeadline < 48 && getPriorityIndex(allocation.priority) >= 2) {
        this.upgradePriority(projectId);
        upgraded.push(projectId);
      }
    }

    return upgraded;
  }

  /**
   * Preempt low-priority resources to make room for high-priority
   * @returns Array of preempted project IDs
   */
  preemptLowPriority(): PreemptionResult {
    const result: PreemptionResult = {
      preemptedProjectIds: [],
      releasedTokens: 0,
      releasedCpuCores: 0,
    };

    // Find P3 and P2 projects to preempt
    const candidates = Array.from(this.projects.values())
      .filter((p) => p.priority === "P3" || p.priority === "P2")
      .sort((a, b) => getPriorityIndex(b.priority) - getPriorityIndex(a.priority)); // Lowest priority first

    for (const candidate of candidates) {
      if (this.projects.size < this.maxConcurrent) {
        break;
      }

      result.preemptedProjectIds.push(candidate.projectId);
      result.releasedTokens += candidate.quota.llmTokensPerHour;
      result.releasedCpuCores += candidate.quota.cpuCores;

      this.projects.delete(candidate.projectId);
      logger.warn("Preempted low-priority project", {
        projectId: candidate.projectId,
        priority: candidate.priority,
      });
    }

    if (result.preemptedProjectIds.length > 0) {
      logger.info("Preemption complete", {
        preemptedCount: result.preemptedProjectIds.length,
        releasedTokens: result.releasedTokens,
        releasedCpuCores: result.releasedCpuCores,
      });
    }

    return result;
  }

  /**
   * Record token usage for a project
   */
  recordTokenUsage(projectId: string, tokens: number): boolean {
    const allocation = this.projects.get(projectId);
    if (!allocation) {
      return false;
    }

    // Check quota limit (skip for P0 which is unlimited)
    if (allocation.quota.llmTokensPerHour !== Number.MAX_SAFE_INTEGER) {
      const newTotal = allocation.used.tokens + tokens;
      if (newTotal > allocation.quota.llmTokensPerHour) {
        logger.warn("Token quota exceeded", {
          projectId,
          used: newTotal,
          quota: allocation.quota.llmTokensPerHour,
        });
        return false;
      }
    }

    allocation.used.tokens += tokens;
    return true;
  }

  /**
   * Record CPU time for a project
   */
  recordCpuTime(projectId: string, cpuMs: number): void {
    const allocation = this.projects.get(projectId);
    if (allocation) {
      allocation.used.cpuTime += cpuMs;
    }
  }

  /**
   * Reset usage counters (typically called hourly)
   */
  resetUsageWindow(): void {
    this.usageWindowStart = new Date();

    for (const allocation of this.projects.values()) {
      allocation.used = { tokens: 0, cpuTime: 0 };
    }

    logger.info("Usage window reset", {
      activeProjects: this.projects.size,
    });
  }

  /**
   * Check if a project can start a new concurrent task
   */
  canStartTask(projectId: string): boolean {
    const allocation = this.projects.get(projectId);
    if (!allocation) {
      return false;
    }

    // For simplicity, we track this at the project level
    // A more sophisticated implementation would track actual concurrent tasks
    return true;
  }

  // Private helper methods

  private getQuotaForPriority(priority: Priority): ResourceQuota {
    const config = PRIORITY_CONFIGS[priority];
    return {
      llmTokensPerHour: config.llmTokensPerHour,
      cpuCores: config.cpuCores,
      maxConcurrent: 1,
    };
  }

  private canAllocate(required: ResourceQuota, available: ResourceQuota): boolean {
    // P0 can always allocate (unlimited)
    if (required.llmTokensPerHour === Number.MAX_SAFE_INTEGER) {
      return available.maxConcurrent > 0;
    }

    return (
      available.llmTokensPerHour >= required.llmTokensPerHour &&
      available.cpuCores >= required.cpuCores &&
      available.maxConcurrent > 0
    );
  }

  private calculateTotalUsage(): ResourceUsage {
    let tokens = 0;
    let cpuTime = 0;

    for (const allocation of this.projects.values()) {
      tokens += allocation.used.tokens;
      cpuTime += allocation.used.cpuTime;
    }

    return { tokens, cpuTime };
  }

  private calculateAllocatedQuota(): ResourceQuota {
    let tokens = 0;
    let cpuCores = 0;

    for (const allocation of this.projects.values()) {
      // P0 doesn't count toward normal allocation
      if (allocation.quota.llmTokensPerHour !== Number.MAX_SAFE_INTEGER) {
        tokens += allocation.quota.llmTokensPerHour;
      }
      cpuCores += allocation.quota.cpuCores;
    }

    return {
      llmTokensPerHour: tokens,
      cpuCores,
      maxConcurrent: this.projects.size,
    };
  }

  /**
   * Get resource statistics summary
   */
  getStats(): {
    activeProjects: number;
    maxConcurrent: number;
    totalTokensUsed: number;
    totalCpuTimeMs: number;
    byPriority: Record<Priority, number>;
  } {
    const usage = this.calculateTotalUsage();
    const byPriority: Record<Priority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };

    for (const allocation of this.projects.values()) {
      byPriority[allocation.priority]++;
    }

    return {
      activeProjects: this.projects.size,
      maxConcurrent: this.maxConcurrent,
      totalTokensUsed: usage.tokens,
      totalCpuTimeMs: usage.cpuTime,
      byPriority,
    };
  }
}
