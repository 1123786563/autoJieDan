/**
 * 心跳机制类型定义
 */

import type { EventEmitter } from "events";

/** 心跳状态 */
export type HeartbeatStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

/** 心跳事件类型 */
export type HeartbeatEventType =
  | "heartbeat:sent"
  | "heartbeat:received"
  | "heartbeat:timeout"
  | "heartbeat:recovered"
  | "heartbeat:failed";

/** 心跳配置 */
export interface HeartbeatConfig {
  /** 心跳间隔 (毫秒)，默认 30000 (30秒) */
  interval: number;
  /** 心跳超时 (毫秒)，默认 90000 (3次间隔) */
  timeout: number;
  /** 失败阈值，达到此次数触发重连，默认 3 */
  failureThreshold: number;
  /** 是否启用心跳，默认 true */
  enabled: boolean;
  /** 最大重试次数，默认 5 */
  maxRetries: number;
  /** 重连延迟基数 (毫秒)，默认 1000 */
  reconnectDelayBase: number;
  /** 重连延迟最大值 (毫秒)，默认 30000 */
  reconnectDelayMax: number;
}

/** 心跳负载 */
export interface HeartbeatPayload {
  /** 状态 */
  status: HeartbeatStatus;
  /** 运行时间 (秒) */
  uptime: number;
  /** 活跃任务数 */
  activeTasks: number;
  /** 队列任务数 */
  queuedTasks: number;
  /** 时间戳 */
  timestamp: string;
  /** 序列号 */
  sequence: number;
  /** 版本 */
  version: string;
}

/** 心跳事件 */
export interface HeartbeatEvent {
  /** 事件 ID */
  id: string;
  /** 事件类型 */
  type: HeartbeatEventType;
  /** 目标 DID */
  targetDid: string;
  /** 心跳负载 */
  payload: HeartbeatPayload;
  /** 时间戳 */
  timestamp: string;
}

/** 连接状态 */
export interface ConnectionState {
  /** 连接 ID */
  connectionId: string;
  /** 目标 DID */
  targetDid: string;
  /** 是否连接 */
  connected: boolean;
  /** 最后心跳时间 */
  lastHeartbeat: Date | null;
  /** 最后发送时间 */
  lastSent: Date | null;
  /** 最后接收时间 */
  lastReceived: Date | null;
  /** 连续失败次数 */
  consecutiveFailures: number;
  /** 总发送次数 */
  totalSent: number;
  /** 总接收次数 */
  totalReceived: number;
  /** 总失败次数 */
  totalFailures: number;
  /** 当前状态 */
  status: HeartbeatStatus;
  /** 重连次数 */
  reconnectCount: number;
}

/** 心跳统计 */
export interface HeartbeatStats {
  /** 总连接数 */
  totalConnections: number;
  /** 健康连接数 */
  healthyConnections: number;
  /** 降级连接数 */
  degradedConnections: number;
  /** 不健康连接数 */
  unhealthyConnections: number;
  /** 总发送次数 */
  totalSent: number;
  /** 总接收次数 */
  totalReceived: number;
  /** 总失败次数 */
  totalFailures: number;
  /** 平均延迟 (毫秒) */
  averageLatency: number;
  /** 心跳丢失率 (%) */
  lossRate: number;
}

/** 心跳管理器事件 */
export interface HeartbeatManagerEvents {
  /** 心跳已发送 */
  "heartbeat:sent": (event: { connectionId: string; sequence: number }) => void;
  /** 心跳已接收 */
  "heartbeat:received": (event: { connectionId: string; payload: HeartbeatPayload }) => void;
  /** 心跳超时 */
  "heartbeat:timeout": (event: { connectionId: string; lastReceived: Date | null }) => void;
  /** 连接恢复 */
  "heartbeat:recovered": (event: { connectionId: string }) => void;
  /** 连接失败 */
  "heartbeat:failed": (event: { connectionId: string; reason: string }) => void;
  /** 需要重连 */
  "reconnect:requested": (event: { connectionId: string; targetDid: string }) => void;
}

/** 心跳记录 */
export interface HeartbeatRecord {
  /** 序列号 */
  sequence: number;
  /** 发送时间 */
  sentAt: Date;
  /** 接收时间 (如果已确认) */
  receivedAt?: Date;
  /** 往返时间 (毫秒) */
  rtt?: number;
}
