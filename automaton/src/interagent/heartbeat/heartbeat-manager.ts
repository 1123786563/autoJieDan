/**
 * 心跳管理器
 * 负责管理和监控与 Nanobot 之间连接的心跳状态
 */

import { EventEmitter } from "events";
import { ulid } from "ulid";
import type {
  HeartbeatConfig,
  HeartbeatStatus,
  HeartbeatPayload,
  HeartbeatEvent,
  ConnectionState,
  HeartbeatStats,
  HeartbeatRecord,
  HeartbeatManagerEvents,
} from "./types.js";

/** 默认配置 */
const DEFAULT_CONFIG: Required<HeartbeatConfig> = {
  interval: 30000, // 30 秒
  timeout: 90000, // 90 秒 (3次间隔)
  failureThreshold: 3,
  enabled: true,
  maxRetries: 5,
  reconnectDelayBase: 1000,
  reconnectDelayMax: 30000,
};

/**
 * 心跳管理器
 *
 * 功能：
 * - 定期发送心跳到所有连接的对等方
 * - 监控心跳响应，检测连接健康状态
 * - 超时检测：3次丢失心跳触发重连
 * - 自动恢复：连接恢复后重置状态
 */
export class HeartbeatManager extends EventEmitter {
  private config: Required<HeartbeatConfig>;
  private connections: Map<string, ConnectionState> = new Map();
  private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();
  private heartbeatRecords: Map<string, HeartbeatRecord[]> = new Map();
  private globalTimer: NodeJS.Timeout | null = null;
  private sequenceNumbers: Map<string, number> = new Map();
  private isRunning = false;
  private ownDid: string;
  private startTime: Date;

  /** 心跳发送器回调 */
  private senderCallback?: (event: HeartbeatEvent) => Promise<boolean>;

  constructor(
    ownDid: string,
    config: Partial<HeartbeatConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ownDid = ownDid;
    this.startTime = new Date();
  }

  /**
   * 启动心跳管理器
   */
  async start(
    senderCallback?: (event: HeartbeatEvent) => Promise<boolean>
  ): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.senderCallback = senderCallback;
    this.isRunning = true;

    // 启动全局心跳循环
    this.globalTimer = setInterval(() => {
      this.sendHeartbeats();
    }, this.config.interval);

    this.emit("started");
  }

  /**
   * 停止心跳管理器
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // 清除全局定时器
    if (this.globalTimer) {
      clearInterval(this.globalTimer);
      this.globalTimer = null;
    }

    // 清除所有连接的定时器
    for (const timer of this.heartbeatTimers.values()) {
      clearTimeout(timer);
    }
    this.heartbeatTimers.clear();

    this.emit("stopped");
  }

  /**
   * 注册连接
   */
  registerConnection(
    connectionId: string,
    targetDid: string
  ): void {
    if (this.connections.has(connectionId)) {
      return;
    }

    const state: ConnectionState = {
      connectionId,
      targetDid,
      connected: true,
      lastHeartbeat: null,
      lastSent: null,
      lastReceived: null,
      consecutiveFailures: 0,
      totalSent: 0,
      totalReceived: 0,
      totalFailures: 0,
      status: "unknown",
      reconnectCount: 0,
    };

    this.connections.set(connectionId, state);
    this.heartbeatRecords.set(connectionId, []);
    this.sequenceNumbers.set(connectionId, 0);

    // 启动该连接的超时检测
    this.startTimeoutCheck(connectionId);

    this.emit("connection:registered", { connectionId, targetDid });
  }

  /**
   * 注销连接
   */
  unregisterConnection(connectionId: string): void {
    // 清除定时器
    const timer = this.heartbeatTimers.get(connectionId);
    if (timer) {
      clearTimeout(timer);
      this.heartbeatTimers.delete(connectionId);
    }

    // 清除记录
    this.heartbeatRecords.delete(connectionId);
    this.sequenceNumbers.delete(connectionId);

    // 删除连接状态
    this.connections.delete(connectionId);

    this.emit("connection:unregistered", { connectionId });
  }

  /**
   * 处理接收到的心跳
   */
  handleHeartbeat(
    connectionId: string,
    payload: HeartbeatPayload
  ): void {
    const state = this.connections.get(connectionId);
    if (!state) {
      return;
    }

    const now = new Date();
    state.lastReceived = now;
    state.lastHeartbeat = now;
    state.totalReceived++;

    // 如果之前状态不健康，现在恢复
    if (state.status !== "healthy" && state.consecutiveFailures > 0) {
      state.consecutiveFailures = 0;
      state.status = this.determineStatus(state);
      this.emit("heartbeat:recovered", { connectionId });
    }

    // 确定状态
    state.status = this.determineStatus(state);

    // 查找对应的心跳记录并更新 RTT
    this.updateHeartbeatRecord(connectionId, payload.sequence, now);

    this.emit("heartbeat:received", { connectionId, payload });
  }

  /**
   * 手动触发心跳发送
   */
  async sendHeartbeats(): Promise<void> {
    if (!this.isRunning || !this.config.enabled) {
      return;
    }

    const promises: Promise<boolean>[] = [];

    for (const [connectionId, state] of this.connections) {
      if (state.connected) {
        promises.push(this.sendHeartbeat(connectionId));
      }
    }

    await Promise.all(promises);
  }

  /**
   * 发送心跳到指定连接
   */
  async sendHeartbeat(connectionId: string): Promise<boolean> {
    const state = this.connections.get(connectionId);
    if (!state || !state.connected) {
      return false;
    }

    const now = new Date();
    const sequence = this.getNextSequence(connectionId);

    const payload: HeartbeatPayload = {
      status: "healthy",
      uptime: Math.floor((now.getTime() - this.startTime.getTime()) / 1000),
      activeTasks: 0,
      queuedTasks: 0,
      timestamp: now.toISOString(),
      sequence,
      version: "1.0.0",
    };

    const event: HeartbeatEvent = {
      id: ulid(),
      type: "heartbeat:sent",
      targetDid: state.targetDid,
      payload,
      timestamp: now.toISOString(),
    };

    // 记录心跳
    this.recordHeartbeat(connectionId, sequence, now);

    // 使用回调发送
    let sent = false;
    if (this.senderCallback) {
      try {
        sent = await this.senderCallback(event);
      } catch (error) {
        this.emit("error", { connectionId, error });
      }
    }

    if (sent) {
      state.lastSent = now;
      state.totalSent++;
      this.emit("heartbeat:sent", { connectionId, sequence });
    } else {
      state.totalFailures++;
      state.consecutiveFailures++;
      this.checkFailureThreshold(connectionId, state);
    }

    // 即使发送成功，也要检查是否已经达到失败阈值（用于测试场景）
    this.checkFailureThreshold(connectionId, state);

    return sent;
  }

  /**
   * 启动超时检测
   */
  private startTimeoutCheck(connectionId: string): void {
    // 清除现有定时器
    const existingTimer = this.heartbeatTimers.get(connectionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // 设置超时检测定时器
    const timer = setTimeout(() => {
      this.checkTimeout(connectionId);
      // 递归设置下一次检测
      if (this.connections.has(connectionId)) {
        this.startTimeoutCheck(connectionId);
      }
    }, this.config.interval);

    this.heartbeatTimers.set(connectionId, timer);
  }

  /**
   * 检查连接超时
   */
  private checkTimeout(connectionId: string): void {
    const state = this.connections.get(connectionId);
    if (!state) {
      return;
    }

    const now = new Date();
    const lastReceived = state.lastReceived;

    if (!lastReceived) {
      // 从未收到过心跳，检查最后发送时间
      if (state.lastSent && now.getTime() - state.lastSent.getTime() > this.config.timeout) {
        this.handleTimeout(connectionId, state);
      }
      return;
    }

    // 检查是否超时
    const timeSinceLastReceived = now.getTime() - lastReceived.getTime();
    if (timeSinceLastReceived > this.config.timeout) {
      this.handleTimeout(connectionId, state);
    }
  }

  /**
   * 处理超时
   */
  private handleTimeout(
    connectionId: string,
    state: ConnectionState
  ): void {
    state.consecutiveFailures++;
    state.totalFailures++;
    state.status = "unhealthy";

    this.emit("heartbeat:timeout", {
      connectionId,
      lastReceived: state.lastReceived,
    });

    this.checkFailureThreshold(connectionId, state);
  }

  /**
   * 检查失败阈值
   */
  private checkFailureThreshold(
    connectionId: string,
    state: ConnectionState
  ): void {
    if (state.consecutiveFailures >= this.config.failureThreshold) {
      const stateCopy = { ...state };
      state.status = "unhealthy";
      state.connected = false;

      this.emit("heartbeat:failed", {
        connectionId,
        reason: `Failure threshold reached: ${state.consecutiveFailures}`,
      });

      // 请求重连
      if (state.reconnectCount < this.config.maxRetries) {
        state.reconnectCount++;
        this.emit("reconnect:requested", {
          connectionId,
          targetDid: state.targetDid,
        });
      } else {
        this.emit("reconnect:abandoned", {
          connectionId,
          reason: "Max retries reached",
        });
      }
    } else {
      state.status = this.determineStatus(state);
    }
  }

  /**
   * 确定连接状态
   */
  private determineStatus(state: ConnectionState): HeartbeatStatus {
    if (!state.connected) {
      return "unhealthy";
    }

    if (state.consecutiveFailures >= this.config.failureThreshold) {
      return "unhealthy";
    }

    if (state.consecutiveFailures > 0) {
      return "degraded";
    }

    if (!state.lastReceived) {
      return "unknown";
    }

    const now = new Date();
    const timeSinceLastReceived = now.getTime() - state.lastReceived!.getTime();

    if (timeSinceLastReceived > this.config.timeout) {
      return "unhealthy";
    }

    if (timeSinceLastReceived > this.config.interval * 2) {
      return "degraded";
    }

    return "healthy";
  }

  /**
   * 记录心跳
   */
  private recordHeartbeat(
    connectionId: string,
    sequence: number,
    sentAt: Date
  ): void {
    const records = this.heartbeatRecords.get(connectionId);
    if (!records) {
      return;
    }

    records.push({ sequence, sentAt });

    // 只保留最近 100 条记录
    if (records.length > 100) {
      records.shift();
    }
  }

  /**
   * 更新心跳记录
   */
  private updateHeartbeatRecord(
    connectionId: string,
    sequence: number,
    receivedAt: Date
  ): void {
    const records = this.heartbeatRecords.get(connectionId);
    if (!records) {
      return;
    }

    const record = records.find((r) => r.sequence === sequence);
    if (record) {
      record.receivedAt = receivedAt;
      record.rtt = receivedAt.getTime() - record.sentAt.getTime();
    }
  }

  /**
   * 获取下一个序列号
   */
  private getNextSequence(connectionId: string): number {
    const current = this.sequenceNumbers.get(connectionId) || 0;
    const next = current + 1;
    this.sequenceNumbers.set(connectionId, next);
    return next;
  }

  /**
   * 获取连接状态
   */
  getConnectionState(connectionId: string): ConnectionState | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * 获取所有连接状态
   */
  getAllConnectionStates(): ConnectionState[] {
    return Array.from(this.connections.values());
  }

  /**
   * 获取统计信息
   */
  getStats(): HeartbeatStats {
    const connections = Array.from(this.connections.values());

    const healthy = connections.filter((c) => c.status === "healthy").length;
    const degraded = connections.filter((c) => c.status === "degraded").length;
    const unhealthy = connections.filter((c) => c.status === "unhealthy").length;

    const totalSent = connections.reduce((sum, c) => sum + c.totalSent, 0);
    const totalReceived = connections.reduce((sum, c) => sum + c.totalReceived, 0);
    const totalFailures = connections.reduce((sum, c) => sum + c.totalFailures, 0);

    // 计算平均延迟
    const allRtts: number[] = [];
    for (const records of this.heartbeatRecords.values()) {
      for (const record of records) {
        if (record.rtt !== undefined) {
          allRtts.push(record.rtt);
        }
      }
    }

    const averageLatency =
      allRtts.length > 0
        ? allRtts.reduce((sum, rtt) => sum + rtt, 0) / allRtts.length
        : 0;

    // 计算丢失率
    const lossRate =
      totalSent > 0 ? ((totalSent - totalReceived) / totalSent) * 100 : 0;

    return {
      totalConnections: connections.length,
      healthyConnections: healthy,
      degradedConnections: degraded,
      unhealthyConnections: unhealthy,
      totalSent,
      totalReceived,
      totalFailures,
      averageLatency,
      lossRate,
    };
  }

  /**
   * 重置连接状态
   */
  resetConnection(connectionId: string): void {
    const state = this.connections.get(connectionId);
    if (!state) {
      return;
    }

    state.connected = true;
    state.consecutiveFailures = 0;
    state.status = this.determineStatus(state);

    this.emit("connection:reset", { connectionId });
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<HeartbeatConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 检查是否运行中
   */
  isActive(): boolean {
    return this.isRunning;
  }
}
