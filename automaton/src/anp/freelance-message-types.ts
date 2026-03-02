/**
 * ANP Freelance Message Types
 *
 * 专用于自由职业项目管理的 ANP 消息类型定义
 * 在基础 ANP 类型之上扩展，支持 Genesis Prompt、Progress Report、Error Report 等
 *
 * @module anp/freelance-message-types
 * @version 1.0.0
 */

import type {
  GenesisPromptPayload,
  ProgressReportPayload,
  ErrorReportPayload,
} from "./types.js";

// ============================================================================
// 自由职业项目专用 ANP 消息类型枚举
// ============================================================================

/**
 * 自由职业项目 ANP 消息类型
 * 扩展基础 ANP 消息类型，添加项目特定消息
 */
export type FreelanceANPMessageType =
  // 任务分发
  | "GenesisPrompt" // 从 Automaton 发送到 Nanobot 的初始任务提示
  | "GenesisPromptAck" // Nanobot 确认收到 Genesis Prompt
  | "TaskAccept" // Nanobot 接受任务
  | "TaskReject" // Nanobot 拒绝任务
  // 进度报告
  | "ProgressReport" // Nanobot 向 Automaton 报告进度
  | "ProgressReportAck" // Automaton 确认收到进度报告
  // 错误报告
  | "ErrorReport" // Nanobot 向 Automaton 报告错误
  | "ErrorReportAck" // Automaton 确认收到错误报告
  // 重连和状态同步
  | "ReconnectRequest" // Nanobot 请求重连
  | "StateSyncResponse" // Automaton 响应状态同步
  | "SyncCompleteAck" // Nanobot 确认同步完成
  // 人工介入
  | "HumanInterventionRequest" // Automaton 请求人工介入
  | "HumanInterventionResponse" // 人工响应介入请求
  // 任务控制
  | "TaskPause" // 暂停任务
  | "TaskResume" // 恢复任务
  | "TaskCancel" // 取消任务;

// ============================================================================
// Genesis Prompt 相关类型
// ============================================================================

/**
 * Genesis Prompt 确认负载
 * Nanobot 收到 Genesis Prompt 后返回确认
 */
export interface GenesisPromptAckPayload {
  "@type": "freelance:GenesisPromptAck";
  "freelance:taskId": string;
  "freelance:projectId": string;
  "freelance:accepted": boolean;
  "freelance:estimatedStartAt"?: string; // ISO 8601
  "freelance:rejectionReason"?: string;
}

/**
 * 任务接受负载
 */
export interface TaskAcceptPayload {
  "@type": "freelance:TaskAccept";
  "freelance:taskId": string;
  "freelance:projectId": string;
  "freelance:acceptedAt": string; // ISO 8601
  "freelance:estimatedCompletionAt": string; // ISO 8601
}

/**
 * 任务拒绝负载
 */
export interface TaskRejectPayload {
  "@type": "freelance:TaskReject";
  "freelance:taskId": string;
  "freelance:projectId": string;
  "freelance:rejectedAt": string; // ISO 8601
  "freelance:reason": string;
  "freelance:reasonCategory": "insufficient_budget" | "technical_constraints" | "capacity" | "other";
}

// ============================================================================
// Progress Report 相关类型
// ============================================================================

/**
 * 进度报告确认负载
 * Automaton 收到进度报告后返回确认
 */
export interface ProgressReportAckPayload {
  "@type": "freelance:ProgressReportAck";
  "freelance:taskId": string;
  "freelance:reportId": string;
  "freelance:acknowledgedAt": string; // ISO 8601
  "freelance:actionRequired"?: string;
}

/**
 * 扩展的进度报告负载
 * 添加自由职业项目特定字段
 */
export interface FreelanceProgressReportPayload extends Omit<ProgressReportPayload, "@type"> {
  "@type": "freelance:ProgressReport";
  "freelance:projectId"?: string;
  "freelance:goalId"?: string;
  "freelance:deliverablesCompleted"?: number;
  "freelance:deliverablesTotal"?: number;
  "freelance:timeSpentSeconds"?: number;
  "freelance:estimatedTimeRemainingSeconds"?: number;
}

// ============================================================================
// Error Report 相关类型
// ============================================================================

/**
 * 错误报告确认负载
 * Automaton 收到错误报告后返回确认
 */
export interface ErrorReportAckPayload {
  "@type": "freelance:ErrorReportAck";
  "freelance:taskId": string;
  "freelance:reportId": string;
  "freelance:acknowledgedAt": string; // ISO 8601
  "freelance:interventionCreated"?: boolean;
  "freelance:interventionId"?: string;
  "freelance:actionRequired"?: string;
}

/**
 * 扩展的错误报告负载
 * 添加自由职业项目特定字段
 */
export interface FreelanceErrorReportPayload extends Omit<ErrorReportPayload, "@type"> {
  "@type": "freelance:ErrorReport";
  "freelance:projectId"?: string;
  "freelance:goalId"?: string;
  "freelance:requiresHumanIntervention"?: boolean;
  "freelance:clientNotified"?: boolean;
}

// ============================================================================
// 重连和状态同步相关类型
// ============================================================================

/**
 * 重连请求负载
 * Nanobot 在网络断开后请求重连和状态同步
 */
export interface ReconnectRequestPayload {
  "@type": "freelance:ReconnectRequest";
  "freelance:connectionId": string;
  "freelance:lastSequenceNumber": number;
  "freelance:reconnectReason": "network_error" | "timeout" | "server_close" | "manual";
  "freelance:reconnectAt": string; // ISO 8601
  "freelance:activeTasks"?: string[]; // 活跃任务 ID 列表
}

/**
 * 错过的事件
 * 用于状态同步时描述错过的事件
 */
export interface MissedEvent {
  id: string;
  sequence: number;
  type: string;
  timestamp: string; // ISO 8601
  payload: string; // JSON 序列化的负载
}

/**
 * 状态同步响应负载
 * Automaton 响应重连请求，返回需要同步的状态
 */
export interface StateSyncResponsePayload {
  "@type": "freelance:StateSyncResponse";
  "freelance:connectionId": string;
  "freelance:syncRequired": boolean;
  "freelance:missedEvents"?: MissedEvent[];
  "freelance:currentSequenceNumber": number;
  "freelance:serverTime": string; // ISO 8601
  "freelance:activeTaskStates"?: TaskState[];
}

/**
 * 任务状态快照
 * 用于状态同步
 */
export interface TaskState {
  taskId: string;
  projectId?: string;
  goalId?: string;
  status: string;
  progress: number;
  lastUpdateAt: string; // ISO 8601
}

/**
 * 同步完成确认负载
 * Nanobot 完成状态同步后发送确认
 */
export interface SyncCompleteAckPayload {
  "@type": "freelance:SyncCompleteAck";
  "freelance:connectionId": string;
  "freelance:synchronizedAt": string; // ISO 8601
  "freelance:eventsProcessed": number;
  "freelance:lastProcessedSequence": number;
}

// ============================================================================
// 人工介入相关类型
// ============================================================================

/**
 * 人工介入请求负载
 * Automaton 请求人工审批或介入
 */
export interface HumanInterventionRequestPayload {
  "@type": "freelance:HumanInterventionRequest";
  "freelance:interventionId": string;
  "freelance:interventionType": "contract_sign" | "large_spend" | "project_start" | "refund" | "dispute_l2" | "dispute_l3" | "quality_review" | "customer_complaint";
  "freelance:projectId"?: string;
  "freelance:goalId"?: string;
  "freelance:taskId"?: string;
  "freelance:reason": string;
  "freelance:context": Record<string, unknown>;
  "freelance:priority": "low" | "normal" | "high" | "urgent";
  "freelance:slaDeadline": string; // ISO 8601
  "freelance:requestedAt": string; // ISO 8601
}

/**
 * 人工介入响应负载
 * 人类对介入请求的响应
 */
export interface HumanInterventionResponsePayload {
  "@type": "freelance:HumanInterventionResponse";
  "freelance:interventionId": string;
  "freelance:decision": "approve" | "reject" | "timeout";
  "freelance:respondedAt": string; // ISO 8601
  "freelance:responder": string;
  "freelance:notes"?: string;
  "freelance:actionTaken"?: string;
}

// ============================================================================
// 任务控制相关类型
// ============================================================================

/**
 * 任务暂停负载
 */
export interface TaskPausePayload {
  "@type": "freelance:TaskPause";
  "freelance:taskId": string;
  "freelance:projectId"?: string;
  "freelance:pausedAt": string; // ISO 8601
  "freelance:reason": string;
  "freelance:resumeAt"?: string; // ISO 8601
}

/**
 * 任务恢复负载
 */
export interface TaskResumePayload {
  "@type": "freelance:TaskResume";
  "freelance:taskId": string;
  "freelance:projectId"?: string;
  "freelance:resumedAt": string; // ISO 8601
}

/**
 * 任务取消负载
 */
export interface TaskCancelPayload {
  "@type": "freelance:TaskCancel";
  "freelance:taskId": string;
  "freelance:projectId"?: string;
  "freelance:cancelledAt": string; // ISO 8601
  "freelance:reason": string;
  "freelance:cleanupRequired"?: boolean;
}

// ============================================================================
// 消息持久化配置
// ============================================================================

/**
 * 消息持久化配置
 * 定义哪些消息类型需要持久化以及 TTL
 */
export interface MessagePersistenceConfig {
  /** 是否持久化到数据库 */
  persist: boolean;
  /** TTL（小时），0 表示不过期 */
  ttl: number;
}

/**
 * 自由职业消息持久化配置映射
 */
export const FREELANCE_MESSAGE_PERSISTENCE: Record<string, MessagePersistenceConfig> = {
  // 任务分发消息需要持久化，用于重连时同步
  GenesisPrompt: { persist: true, ttl: 24 },
  GenesisPromptAck: { persist: true, ttl: 24 },
  TaskAccept: { persist: true, ttl: 72 },
  TaskReject: { persist: true, ttl: 24 },

  // 进度报告短时间保留即可
  ProgressReport: { persist: true, ttl: 1 },
  ProgressReportAck: { persist: true, ttl: 1 },

  // 错误报告需要长期保留用于分析
  ErrorReport: { persist: true, ttl: 24 * 7 }, // 7天
  ErrorReportAck: { persist: true, ttl: 24 * 7 },

  // 人工介入消息需要持久化
  HumanInterventionRequest: { persist: true, ttl: 24 * 30 }, // 30天
  HumanInterventionResponse: { persist: true, ttl: 24 * 30 },

  // 任务控制消息
  TaskPause: { persist: true, ttl: 24 },
  TaskResume: { persist: true, ttl: 24 },
  TaskCancel: { persist: true, ttl: 72 },

  // 重连消息不需要持久化
  ReconnectRequest: { persist: false, ttl: 0 },
  StateSyncResponse: { persist: false, ttl: 0 },
  SyncCompleteAck: { persist: false, ttl: 0 },

  // 心跳不需要持久化
  HeartbeatEvent: { persist: false, ttl: 0 },
};

// ============================================================================
// 消息优先级
// ============================================================================

/**
 * 消息优先级枚举
 */
export type MessagePriority = "P0" | "P1" | "P2" | "P3";

/**
 * 消息优先级映射
 * P0 = 紧急（错误、取消、人工介入）
 * P1 = 高（任务接受/拒绝、暂停）
 * P2 = 正常（进度报告、状态同步）
 * P3 = 低（心跳、确认消息）
 */
export const FREELANCE_MESSAGE_PRIORITY: Record<string, MessagePriority> = {
  // 紧急消息
  ErrorReport: "P0",
  TaskCancel: "P0",
  HumanInterventionRequest: "P0",
  HumanInterventionResponse: "P0",

  // 高优先级
  GenesisPrompt: "P1",
  GenesisPromptAck: "P1",
  TaskAccept: "P1",
  TaskReject: "P1",
  TaskPause: "P1",

  // 正常优先级
  TaskResume: "P2",
  ProgressReport: "P2",
  ProgressReportAck: "P2",
  ErrorReportAck: "P2",
  ReconnectRequest: "P2",
  StateSyncResponse: "P2",
  SyncCompleteAck: "P2",

  // 低优先级
  HeartbeatEvent: "P3",
};

// ============================================================================
// 类型导出
// ============================================================================

/**
 * 自由职业 ANP 消息负载联合类型
 */
export type FreelanceANPPayload =
  | GenesisPromptPayload
  | GenesisPromptAckPayload
  | TaskAcceptPayload
  | TaskRejectPayload
  | FreelanceProgressReportPayload
  | ProgressReportAckPayload
  | FreelanceErrorReportPayload
  | ErrorReportAckPayload
  | ReconnectRequestPayload
  | StateSyncResponsePayload
  | SyncCompleteAckPayload
  | HumanInterventionRequestPayload
  | HumanInterventionResponsePayload
  | TaskPausePayload
  | TaskResumePayload
  | TaskCancelPayload;
