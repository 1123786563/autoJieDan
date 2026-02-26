/**
 * Prometheus 指标模块
 *
 * @module interagent/metrics
 * @description 导出系统运行指标供 Prometheus 采集
 */

import client, { Registry, Gauge, Counter, Histogram } from "prom-client";

// ============================================================================
// 指标注册表
// ============================================================================

/**
 * 自定义指标注册表
 */
export const register = new Registry();

// 添加默认指标 (CPU, 内存等)
client.collectDefaultMetrics({ register });

// ============================================================================
// Interagent 指标定义
// ============================================================================

/**
 * WebSocket 连接数
 */
export const wsConnectionsGauge = new Gauge({
  name: "interagent_ws_connections",
  help: "当前 WebSocket 连接数",
  registers: [register],
});

/**
 * 待处理任务数
 */
export const tasksPendingGauge = new Gauge({
  name: "interagent_tasks_pending",
  help: "待处理任务数",
  registers: [register],
});

/**
 * 正在执行的任务数
 */
export const tasksActiveGauge = new Gauge({
  name: "interagent_tasks_active",
  help: "正在执行的任务数",
  registers: [register],
});

/**
 * 已完成任务数
 */
export const tasksCompletedCounter = new Counter({
  name: "interagent_tasks_completed_total",
  help: "已完成任务总数",
  labelNames: ["status"], // success, failed, cancelled
  registers: [register],
});

/**
 * 失败任务数
 */
export const tasksFailedCounter = new Counter({
  name: "interagent_tasks_failed_total",
  help: "失败任务总数",
  labelNames: ["error_type"],
  registers: [register],
});

/**
 * 请求延迟分布
 */
export const latencyHistogram = new Histogram({
  name: "interagent_request_latency_ms",
  help: "请求延迟分布 (毫秒)",
  labelNames: ["operation", "method"],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
});

/**
 * 消息发送计数
 */
export const messagesSentCounter = new Counter({
  name: "interagent_messages_sent_total",
  help: "发送的消息总数",
  labelNames: ["type", "target"],
  registers: [register],
});

/**
 * 消息接收计数
 */
export const messagesReceivedCounter = new Counter({
  name: "interagent_messages_received_total",
  help: "接收的消息总数",
  labelNames: ["type", "source"],
  registers: [register],
});

/**
 * 死信队列大小
 */
export const dlqSizeGauge = new Gauge({
  name: "interagent_dlq_size",
  help: "死信队列当前大小",
  registers: [register],
});

/**
 * 密钥轮换计数
 */
export const keyRotationsCounter = new Counter({
  name: "interagent_key_rotations_total",
  help: "密钥轮换总次数",
  labelNames: ["key_type"],
  registers: [register],
});

/**
 * 加密操作计数
 */
export const encryptionOperationsCounter = new Counter({
  name: "interagent_encryption_operations_total",
  help: "加密操作总次数",
  labelNames: ["operation"], // encrypt, decrypt
  registers: [register],
});

/**
 * 签名验证计数
 */
export const signatureVerificationCounter = new Counter({
  name: "interagent_signature_verifications_total",
  help: "签名验证总次数",
  labelNames: ["result"], // success, failure
  registers: [register],
});

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 记录请求延迟
 */
export function recordLatency(
  operation: string,
  method: string,
  durationMs: number
): void {
  latencyHistogram.labels(operation, method).observe(durationMs);
}

/**
 * 递增完成任务计数
 */
export function incrementCompletedTasks(status: "success" | "failed" | "cancelled"): void {
  tasksCompletedCounter.labels(status).inc();
}

/**
 * 递增失败任务计数
 */
export function incrementFailedTasks(errorType: string): void {
  tasksFailedCounter.labels(errorType).inc();
}

/**
 * 更新 WebSocket 连接数
 */
export function setWsConnections(count: number): void {
  wsConnectionsGauge.set(count);
}

/**
 * 更新待处理任务数
 */
export function setPendingTasks(count: number): void {
  tasksPendingGauge.set(count);
}

/**
 * 更新活跃任务数
 */
export function setActiveTasks(count: number): void {
  tasksActiveGauge.set(count);
}

/**
 * 记录消息发送
 */
export function recordMessageSent(type: string, target: string): void {
  messagesSentCounter.labels(type, target).inc();
}

/**
 * 记录消息接收
 */
export function recordMessageReceived(type: string, source: string): void {
  messagesReceivedCounter.labels(type, source).inc();
}

/**
 * 导出指标数据
 */
export async function getMetrics(): Promise<string> {
  return register.metrics();
}

/**
 * 获取内容类型
 */
export function getContentType(): string {
  return register.contentType;
}
