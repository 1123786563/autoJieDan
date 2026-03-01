/**
 * Genesis Handler - Automaton 端 Genesis Prompt 处理器
 *
 * 负责创建和发送 Genesis Prompt 到 Nanobot，并跟踪执行进度
 *
 * @module orchestration/genesis-handler
 * @version 1.0.0
 */

import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";
import type {
  GenesisPromptPayload,
  TechnicalConstraints,
  ContractTerms,
  ResourceLimits,
  Milestone,
  ProgressReportPayload,
  ErrorReportPayload,
} from "../anp/types.js";
import { AUTOMATON_DID, NANOBOT_DID, GENESIS_PROMPT_PROTOCOL } from "../anp/types.js";

const logger = createLogger("orchestration.genesis-handler");

// ============================================================================
// 类型定义
// ============================================================================

/** 项目信息 - 用于创建 Genesis Prompt */
export interface ProjectInfo {
  /** 项目唯一标识 (如 "upwork-123456") */
  projectId: string;
  /** 来源平台 */
  platform: string;
  /** 需求摘要 */
  requirementSummary: string;
  /** 技术约束 */
  technicalConstraints: {
    requiredStack?: string[];
    prohibitedStack?: string[];
    targetPlatform?: string;
  };
  /** 合同条款 */
  contractTerms: {
    totalBudgetCents: number;
    currency: string;
    deadline: string;
    milestones?: Array<{
      name: string;
      percentage: number;
      dueDate: string;
    }>;
  };
  /** 资源限制 */
  resourceLimits: {
    maxTokensPerTask: number;
    maxCostCents: number;
    maxDurationMs: number;
  };
  /** 特殊指示 */
  specialInstructions?: {
    priorityLevel: "low" | "normal" | "high";
    riskFlags: string[];
    humanReviewRequired: boolean;
  };
}

/** 进度状态 */
export interface ProgressStatus {
  promptId: string;
  projectId: string;
  status: "pending" | "accepted" | "in_progress" | "completed" | "failed";
  progress: number;
  currentPhase: string;
  completedSteps: string[];
  nextSteps: string[];
  etaSeconds?: number;
  blockers: string[];
  lastUpdated: string;
  error?: {
    severity: "warning" | "error" | "critical";
    code: string;
    message: string;
  };
}

/** 发送消息的回调类型 */
export type MessageSender = (target: string, payload: GenesisPromptPayload) => Promise<void>;

/** 进度更新回调类型 */
export type ProgressCallback = (status: ProgressStatus) => void;

// ============================================================================
// Genesis Handler 类
// ============================================================================

/**
 * GenesisHandler - 处理 Genesis Prompt 的创建、发送和状态跟踪
 *
 * 负责将项目任务从 Automaton 分发到 Nanobot 执行
 */
export class GenesisHandler {
  private readonly progressTracker: Map<string, ProgressStatus> = new Map();
  private readonly progressCallbacks: Map<string, Set<ProgressCallback>> = new Map();

  constructor(
    private readonly sendMessage: MessageSender,
  ) {}

  // ========================================================================
  // 公共 API
  // ========================================================================

  /**
   * 创建 Genesis Prompt
   *
   * @param project - 项目信息
   * @returns Genesis Prompt 负载
   */
  createGenesisPrompt(project: ProjectInfo): GenesisPromptPayload {
    const technicalConstraints: TechnicalConstraints = {
      "@type": "genesis:TechnicalConstraints",
      "genesis:requiredStack": project.technicalConstraints.requiredStack ?? [],
      "genesis:prohibitedStack": project.technicalConstraints.prohibitedStack ?? [],
      "genesis:targetPlatform": project.technicalConstraints.targetPlatform,
    };

    const milestones: Milestone[] | undefined = project.contractTerms.milestones?.map((m) => ({
      "@type": "genesis:Milestone",
      "genesis:name": m.name,
      "genesis:percentage": m.percentage,
      "genesis:dueDate": m.dueDate,
    }));

    const contractTerms: ContractTerms = {
      "@type": "genesis:ContractTerms",
      "genesis:totalBudget": {
        "@type": "schema:MonetaryAmount",
        "schema:value": project.contractTerms.totalBudgetCents,
        "schema:currency": project.contractTerms.currency,
      },
      "genesis:deadline": project.contractTerms.deadline,
      "genesis:milestones": milestones,
    };

    const resourceLimits: ResourceLimits = {
      "@type": "genesis:ResourceLimits",
      "genesis:maxTokensPerTask": project.resourceLimits.maxTokensPerTask,
      "genesis:maxCostCents": project.resourceLimits.maxCostCents,
      "genesis:maxDurationMs": project.resourceLimits.maxDurationMs,
    };

    const payload: GenesisPromptPayload = {
      "@type": "genesis:GenesisPrompt",
      "genesis:projectId": project.projectId,
      "genesis:platform": project.platform,
      "genesis:requirementSummary": project.requirementSummary,
      "genesis:technicalConstraints": technicalConstraints,
      "genesis:contractTerms": contractTerms,
      "genesis:resourceLimits": resourceLimits,
    };

    if (project.specialInstructions) {
      payload["genesis:specialInstructions"] = {
        "genesis:priorityLevel": project.specialInstructions.priorityLevel,
        "genesis:riskFlags": project.specialInstructions.riskFlags,
        "genesis:humanReviewRequired": project.specialInstructions.humanReviewRequired,
      };
    }

    return payload;
  }

  /**
   * 发送 Genesis Prompt 到 Nanobot
   *
   * @param prompt - Genesis Prompt 负载
   * @param targetDid - 目标 Nanobot DID (默认为 NANOBOT_DID)
   * @returns prompt ID 用于后续跟踪
   */
  async sendToNanobot(
    prompt: GenesisPromptPayload,
    targetDid: string = NANOBOT_DID,
  ): Promise<string> {
    const promptId = ulid();
    const projectId = prompt["genesis:projectId"];

    // 初始化进度状态
    const initialStatus: ProgressStatus = {
      promptId,
      projectId,
      status: "pending",
      progress: 0,
      currentPhase: "init",
      completedSteps: [],
      nextSteps: ["validation", "setup", "execution"],
      blockers: [],
      lastUpdated: new Date().toISOString(),
    };

    this.progressTracker.set(promptId, initialStatus);

    try {
      await this.sendMessage(targetDid, prompt);

      // 更新状态为已发送
      this.updateProgress(promptId, {
        status: "accepted",
        currentPhase: "sent",
        completedSteps: ["init", "sent"],
        nextSteps: ["validation", "setup", "execution"],
      });

      logger.info("Genesis Prompt sent successfully", {
        promptId,
        projectId,
        target: targetDid,
      });

      return promptId;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      this.updateProgress(promptId, {
        status: "failed",
        error: {
          severity: "critical",
          code: "SEND_FAILED",
          message: err.message,
        },
      });

      logger.error("Failed to send Genesis Prompt", err, {
        promptId,
        projectId,
        target: targetDid,
      });

      throw err;
    }
  }

  /**
   * 跟踪 Genesis Prompt 执行进度
   *
   * @param promptId - Prompt ID
   * @returns 当前进度状态
   */
  async trackProgress(promptId: string): Promise<ProgressStatus> {
    const status = this.progressTracker.get(promptId);
    if (!status) {
      throw new Error(`Unknown prompt ID: ${promptId}`);
    }
    return status;
  }

  /**
   * 处理来自 Nanobot 的进度报告
   *
   * @param report - 进度报告负载
   */
  handleProgressReport(report: ProgressReportPayload): void {
    const taskId = report["anp:taskId"];
    const status = this.findStatusByProjectId(taskId);

    if (!status) {
      logger.warn("Received progress report for unknown task", { taskId });
      return;
    }

    this.updateProgress(status.promptId, {
      status: "in_progress",
      progress: report["anp:progress"],
      currentPhase: report["anp:currentPhase"],
      completedSteps: report["anp:completedSteps"],
      nextSteps: report["anp:nextSteps"],
      etaSeconds: report["anp:etaSeconds"],
      blockers: report["anp:blockers"] ?? [],
    });

    // 检查是否完成
    if (report["anp:progress"] >= 100) {
      this.updateProgress(status.promptId, {
        status: "completed",
        progress: 100,
      });
    }

    logger.info("Progress report processed", {
      promptId: status.promptId,
      projectId: taskId,
      progress: report["anp:progress"],
      phase: report["anp:currentPhase"],
    });
  }

  /**
   * 处理来自 Nanobot 的错误报告
   *
   * @param report - 错误报告负载
   */
  handleErrorReport(report: ErrorReportPayload): void {
    const taskId = report["anp:taskId"];
    const status = this.findStatusByProjectId(taskId);

    if (!status) {
      logger.warn("Received error report for unknown task", { taskId });
      return;
    }

    const errorInfo = {
      severity: report["anp:severity"],
      code: report["anp:errorCode"],
      message: report["anp:message"],
    };

    this.updateProgress(status.promptId, {
      error: errorInfo,
      blockers: report["anp:recoverable"]
        ? [...status.blockers, report["anp:message"]]
        : status.blockers,
    });

    // 如果不可恢复，标记为失败
    if (!report["anp:recoverable"]) {
      this.updateProgress(status.promptId, {
        status: "failed",
      });
    }

    logger.error("Error report received from Nanobot", new Error(report["anp:message"]), {
      promptId: status.promptId,
      projectId: taskId,
      severity: report["anp:severity"],
      code: report["anp:errorCode"],
      recoverable: report["anp:recoverable"],
    });
  }

  /**
   * 注册进度更新回调
   *
   * @param promptId - Prompt ID
   * @param callback - 回调函数
   */
  onProgress(promptId: string, callback: ProgressCallback): () => void {
    if (!this.progressCallbacks.has(promptId)) {
      this.progressCallbacks.set(promptId, new Set());
    }

    const callbacks = this.progressCallbacks.get(promptId)!;
    callbacks.add(callback);

    // 返回取消订阅函数
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.progressCallbacks.delete(promptId);
      }
    };
  }

  /**
   * 获取所有活跃的 Genesis Prompt 状态
   */
  getActivePrompts(): ProgressStatus[] {
    return Array.from(this.progressTracker.values()).filter(
      (s) => s.status !== "completed" && s.status !== "failed",
    );
  }

  /**
   * 清理已完成或失败的 Prompt 状态
   *
   * @param promptId - 可选，指定清理特定 Prompt
   */
  cleanup(promptId?: string): void {
    if (promptId) {
      this.progressTracker.delete(promptId);
      this.progressCallbacks.delete(promptId);
    } else {
      // 清理所有已完成或失败的
      const entries = Array.from(this.progressTracker.entries());
      for (const [id, status] of entries) {
        if (status.status === "completed" || status.status === "failed") {
          this.progressTracker.delete(id);
          this.progressCallbacks.delete(id);
        }
      }
    }
  }

  // ========================================================================
  // 私有方法
  // ========================================================================

  private updateProgress(
    promptId: string,
    updates: Partial<ProgressStatus>,
  ): void {
    const current = this.progressTracker.get(promptId);
    if (!current) return;

    const updated: ProgressStatus = {
      ...current,
      ...updates,
      lastUpdated: new Date().toISOString(),
    };

    this.progressTracker.set(promptId, updated);

    // 触发回调
    const callbacks = this.progressCallbacks.get(promptId);
    if (callbacks) {
      const callbackList = Array.from(callbacks);
      for (const callback of callbackList) {
        try {
          callback(updated);
        } catch (error) {
          logger.warn("Progress callback error", {
            promptId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  private findStatusByProjectId(projectId: string): ProgressStatus | undefined {
    const values = Array.from(this.progressTracker.values());
    for (const status of values) {
      if (status.projectId === projectId) {
        return status;
      }
    }
    return undefined;
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 Genesis Handler 实例
 *
 * @param sendMessage - 消息发送函数
 * @returns GenesisHandler 实例
 */
export function createGenesisHandler(
  sendMessage: MessageSender,
): GenesisHandler {
  return new GenesisHandler(sendMessage);
}
