/**
 * 人工介入服务
 * 用于处理需要人工确认的关键决策
 *
 * @module interagent/manual-intervention
 * @version 1.0.0
 */

import { EventEmitter } from "events";
import { ulid } from "ulid";
import type { Database } from "better-sqlite3";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("manual-intervention");

// ============================================================================
// 类型定义
// ============================================================================

/** 介入类型 */
export type InterventionType =
  | "contract_sign"
  | "large_spend"
  | "project_start"
  | "refund"
  | "dispute_l2"
  | "dispute_l3"
  | "quality_review"
  | "customer_complaint";

/** 介入状态 */
export type InterventionStatus = "pending" | "approved" | "rejected" | "timeout";

/** 决策类型 */
export type DecisionType = "approve" | "reject" | "timeout_action";

/** 人工介入请求 */
export interface ManualInterventionRequest {
  /** 介入类型 */
  interventionType: InterventionType;
  /** 项目 ID */
  projectId?: string;
  /** 目标 ID */
  goalId?: string;
  /** 原因 */
  reason: string;
  /** 上下文信息 */
  context?: Record<string, unknown>;
  /** SLA 截止时间 (小时) */
  slaHours?: number;
}

/** 人工介入记录 */
export interface ManualIntervention {
  /** ID */
  id: string;
  /** 介入类型 */
  interventionType: InterventionType;
  /** 项目 ID */
  projectId?: string;
  /** 目标 ID */
  goalId?: string;
  /** 原因 */
  reason: string;
  /** 上下文信息 */
  context?: Record<string, unknown>;
  /** 状态 */
  status: InterventionStatus;
  /** 请求时间 */
  requestedAt: Date;
  /** 响应时间 */
  respondedAt?: Date;
  /** 响应者 */
  responder?: string;
  /** 决策 */
  decision?: DecisionType;
  /** 备注 */
  notes?: string;
  /** SLA 截止时间 */
  slaDeadline: Date;
  /** 创建时间 */
  createdAt: Date;
}

/** 人工介入响应 */
export interface ManualInterventionResponse {
  /** 介入 ID */
  interventionId: string;
  /** 决策 */
  decision: DecisionType;
  /** 备注 */
  notes?: string;
  /** 响应者 */
  responder?: string;
}

/** SLA 配置 */
export interface SLAConfig {
  /** 介入类型 */
  interventionType: InterventionType;
  /** SLA 小时数 */
  slaHours: number;
  /** 超时默认决策 */
  timeoutDecision: DecisionType;
}

// ============================================================================
// 常量
// ============================================================================

/** 默认 SLA 配置 */
export const DEFAULT_SLA_CONFIGS: Record<InterventionType, SLAConfig> = {
  contract_sign: {
    interventionType: "contract_sign",
    slaHours: 24,
    timeoutDecision: "reject",
  },
  large_spend: {
    interventionType: "large_spend",
    slaHours: 4,
    timeoutDecision: "reject",
  },
  project_start: {
    interventionType: "project_start",
    slaHours: 2,
    timeoutDecision: "reject",
  },
  refund: {
    interventionType: "refund",
    slaHours: 48,
    timeoutDecision: "reject",
  },
  dispute_l2: {
    interventionType: "dispute_l2",
    slaHours: 48,
    timeoutDecision: "timeout_action",
  },
  dispute_l3: {
    interventionType: "dispute_l3",
    slaHours: 72,
    timeoutDecision: "timeout_action",
  },
  quality_review: {
    interventionType: "quality_review",
    slaHours: 24,
    timeoutDecision: "reject",
  },
  customer_complaint: {
    interventionType: "customer_complaint",
    slaHours: 4,
    timeoutDecision: "timeout_action",
  },
};

// ============================================================================
// 人工介入服务
// ============================================================================

/**
 * 人工介入服务
 *
 * 功能：
 * - 创建人工介入请求
 * - 处理人工响应
 * - SLA 超时处理
 * - 多渠道通知
 */
export class ManualInterventionService extends EventEmitter {
  private db: Database;
  private slaConfigs: Record<InterventionType, SLAConfig>;
  private slaCheckTimer: NodeJS.Timeout | null = null;

  constructor(
    db: Database,
    slaConfigs?: Partial<Record<InterventionType, Partial<SLAConfig>>>
  ) {
    super();
    this.db = db;
    this.slaConfigs = { ...DEFAULT_SLA_CONFIGS };

    // 合并自定义 SLA 配置
    if (slaConfigs) {
      for (const [type, config] of Object.entries(slaConfigs)) {
        if (config.slaHours !== undefined || config.timeoutDecision !== undefined) {
          this.slaConfigs[type as InterventionType] = {
            ...this.slaConfigs[type as InterventionType],
            ...config,
          };
        }
      }
    }

    this.startSLAChecker();
  }

  /**
   * 创建人工介入请求
   */
  createIntervention(request: ManualInterventionRequest): ManualIntervention {
    const id = ulid();
    const now = new Date();
    const slaConfig = this.slaConfigs[request.interventionType];
    const slaHours = request.slaHours ?? slaConfig.slaHours;
    const slaDeadline = new Date(now.getTime() + slaHours * 60 * 60 * 1000);

    const stmt = this.db.prepare(`
      INSERT INTO manual_interventions (
        id, intervention_type, project_id, goal_id, reason, context,
        status, requested_at, sla_deadline
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `);

    stmt.run(
      id,
      request.interventionType,
      request.projectId ?? null,
      request.goalId ?? null,
      request.reason,
      request.context ? JSON.stringify(request.context) : null,
      now.toISOString(),
      slaDeadline.toISOString()
    );

    const intervention = this.getIntervention(id);
    if (!intervention) {
      throw new Error("Failed to create intervention");
    }

    logger.info("Intervention created", {
      id,
      type: request.interventionType,
      projectId: request.projectId,
      slaDeadline: slaDeadline.toISOString(),
    });

    this.emit("intervention:created", intervention);

    // 发送通知
    this.sendNotification(intervention);

    return intervention;
  }

  /**
   * 获取介入记录
   */
  getIntervention(id: string): ManualIntervention | null {
    const stmt = this.db.prepare(`
      SELECT * FROM manual_interventions WHERE id = ?
    `);

    const row = stmt.get(id) as any;
    if (!row) return null;

    return this.mapRowToIntervention(row);
  }

  /**
   * 获取待处理的介入列表
   */
  getPendingInterventions(interventionType?: InterventionType): ManualIntervention[] {
    let sql = `
      SELECT * FROM manual_interventions
      WHERE status = 'pending'
    `;
    const params: any[] = [];

    if (interventionType) {
      sql += ` AND intervention_type = ?`;
      params.push(interventionType);
    }

    sql += ` ORDER BY requested_at ASC`;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map((row) => this.mapRowToIntervention(row));
  }

  /**
   * 响应介入请求
   */
  respondToIntervention(response: ManualInterventionResponse): ManualIntervention {
    const intervention = this.getIntervention(response.interventionId);
    if (!intervention) {
      throw new Error(`Intervention not found: ${response.interventionId}`);
    }

    if (intervention.status !== "pending") {
      throw new Error(`Intervention already resolved: ${intervention.status}`);
    }

    const now = new Date();
    const stmt = this.db.prepare(`
      UPDATE manual_interventions
      SET status = ?,
          responded_at = ?,
          responder = ?,
          decision = ?,
          notes = ?
      WHERE id = ?
    `);

    const status = response.decision === "approve" ? "approved" : "rejected";

    stmt.run(
      status,
      now.toISOString(),
      response.responder ?? "system",
      response.decision,
      response.notes ?? null,
      response.interventionId
    );

    const updated = this.getIntervention(response.interventionId);
    if (!updated) {
      throw new Error("Failed to update intervention");
    }

    logger.info("Intervention resolved", {
      id: response.interventionId,
      decision: response.decision,
      responder: response.responder,
    });

    this.emit("intervention:resolved", updated);

    return updated;
  }

  /**
   * 检查并处理 SLA 超时
   */
  checkSLATimeouts(): ManualIntervention[] {
    const now = new Date();
    const timedOut: ManualIntervention[] = [];

    const pending = this.getPendingInterventions();

    for (const intervention of pending) {
      if (now > intervention.slaDeadline) {
        const slaConfig = this.slaConfigs[intervention.interventionType];
        const timeoutDecision = slaConfig.timeoutDecision;

        // 自动响应超时
        const resolved = this.respondToIntervention({
          interventionId: intervention.id,
          decision: timeoutDecision,
          notes: "SLA timeout - automatic resolution",
          responder: "system",
        });

        // 更新状态为 timeout
        this.db.prepare(`
          UPDATE manual_interventions SET status = 'timeout' WHERE id = ?
        `).run(intervention.id);

        timedOut.push(resolved);

        logger.warn("Intervention SLA timeout", {
          id: intervention.id,
          type: intervention.interventionType,
          decision: timeoutDecision,
        });

        this.emit("intervention:timeout", resolved);
      }
    }

    return timedOut;
  }

  /**
   * 取消介入请求
   */
  cancelIntervention(id: string, reason: string): ManualIntervention {
    const intervention = this.getIntervention(id);
    if (!intervention) {
      throw new Error(`Intervention not found: ${id}`);
    }

    if (intervention.status !== "pending") {
      throw new Error(`Cannot cancel intervention in status: ${intervention.status}`);
    }

    const now = new Date();
    this.db.prepare(`
      UPDATE manual_interventions
      SET status = 'rejected',
          responded_at = ?,
          responder = 'system',
          decision = 'reject',
          notes = ?
      WHERE id = ?
    `).run(now.toISOString(), `Cancelled: ${reason}`, id);

    const updated = this.getIntervention(id);
    if (!updated) {
      throw new Error("Failed to cancel intervention");
    }

    this.emit("intervention:cancelled", updated);

    return updated;
  }

  /**
   * 获取介入统计
   */
  getStatistics(): {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    timeout: number;
    byType: Record<InterventionType, number>;
  } {
    const stats = {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      timeout: 0,
      byType: {} as Record<InterventionType, number>,
    };

    // 初始化所有类型
    for (const type of Object.keys(DEFAULT_SLA_CONFIGS) as InterventionType[]) {
      stats.byType[type] = 0;
    }

    const rows = this.db.prepare(`
      SELECT status, intervention_type, COUNT(*) as count
      FROM manual_interventions
      GROUP BY status, intervention_type
    `).all() as { status: string; intervention_type: string; count: number }[];

    for (const row of rows) {
      stats.total += row.count;
      stats[row.status as keyof typeof stats] =
        (stats[row.status as keyof typeof stats] as number) + row.count;
      if (row.intervention_type in stats.byType) {
        stats.byType[row.intervention_type as InterventionType] += row.count;
      }
    }

    return stats;
  }

  /**
   * 发送通知 (占位实现)
   */
  private sendNotification(intervention: ManualIntervention): void {
    // TODO: 集成实际通知渠道 (Email, Telegram, Web)
    logger.info("Sending intervention notification", {
      id: intervention.id,
      type: intervention.interventionType,
    });

    this.emit("notification:sent", {
      interventionId: intervention.id,
      channels: ["email", "telegram", "web"],
    });
  }

  /**
   * 启动 SLA 检查定时器
   */
  private startSLAChecker(): void {
    // 每分钟检查一次 SLA 超时
    this.slaCheckTimer = setInterval(() => {
      this.checkSLATimeouts();
    }, 60 * 1000);
  }

  /**
   * 停止 SLA 检查定时器
   */
  stopSLAChecker(): void {
    if (this.slaCheckTimer) {
      clearInterval(this.slaCheckTimer);
      this.slaCheckTimer = null;
    }
  }

  /**
   * 映射数据库行到介入对象
   */
  private mapRowToIntervention(row: any): ManualIntervention {
    return {
      id: row.id,
      interventionType: row.intervention_type,
      projectId: row.project_id ?? undefined,
      goalId: row.goal_id ?? undefined,
      reason: row.reason,
      context: row.context ? JSON.parse(row.context) : undefined,
      status: row.status,
      requestedAt: new Date(row.requested_at),
      respondedAt: row.responded_at ? new Date(row.responded_at) : undefined,
      responder: row.responder ?? undefined,
      decision: row.decision ?? undefined,
      notes: row.notes ?? undefined,
      slaDeadline: new Date(row.sla_deadline),
      createdAt: new Date(row.created_at),
    };
  }
}
