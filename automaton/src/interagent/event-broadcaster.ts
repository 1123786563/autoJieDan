/**
 * WebSocket 事件广播增强
 * 提供订阅/发布、事件过滤、主题路由等功能
 *
 * @module interagent/event-broadcaster
 * @version 1.0.0
 */

import { EventEmitter } from "events";
import WebSocket from "ws";

// ============================================================================
// 类型定义
// ============================================================================

/** 广播事件类型 */
export type BroadcastEventType =
  // 任务相关
  | "task.created"
  | "task.started"
  | "task.progress"
  | "task.completed"
  | "task.failed"
  | "task.cancelled"
  // 资源相关
  | "resource.snapshot"
  | "resource.warning"
  | "resource.exceeded"
  | "resource.budget_update"
  // 异常相关
  | "anomaly.detected"
  | "anomaly.acknowledged"
  | "anomaly.resolved"
  | "anomaly.alert"
  // 系统相关
  | "system.heartbeat"
  | "system.status"
  | "system.shutdown"
  // 自定义
  | string;

/** 事件优先级 */
export type EventPriority = "low" | "normal" | "high" | "critical";

/** 广播事件 */
export interface BroadcastEvent {
  /** 事件 ID */
  id: string;
  /** 事件类型 */
  type: BroadcastEventType;
  /** 时间戳 */
  timestamp: Date;
  /** 来源 */
  source: string;
  /** 目标 (可选，定向发送) */
  target?: string;
  /** 优先级 */
  priority: EventPriority;
  /** 负载数据 */
  payload: Record<string, unknown>;
  /** 关联 ID */
  correlationId?: string;
  /** 元数据 */
  metadata: Record<string, unknown>;
  /** 是否需要确认 */
  requireAck: boolean;
  /** TTL (毫秒) */
  ttl?: number;
}

/** 订阅过滤器 */
export interface SubscriptionFilter {
  /** 事件类型模式 (支持通配符 *) */
  types?: string[];
  /** 来源过滤 */
  sources?: string[];
  /** 优先级过滤 */
  priorities?: EventPriority[];
  /** 自定义过滤函数 */
  custom?: (event: BroadcastEvent) => boolean;
}

/** 订阅信息 */
export interface Subscription {
  /** 订阅 ID */
  id: string;
  /** 客户端 DID */
  clientDid: string;
  /** 过滤器 */
  filter: SubscriptionFilter;
  /** 创建时间 */
  createdAt: Date;
  /** 最后活动 */
  lastActiveAt: Date;
  /** 事件计数 */
  eventCount: number;
  /** 是否活跃 */
  active: boolean;
}

/** 广播统计 */
export interface BroadcastStats {
  /** 发送的事件总数 */
  totalEventsSent: number;
  /** 接收的事件总数 */
  totalEventsReceived: number;
  /** 活跃订阅数 */
  activeSubscriptions: number;
  /** 按类型统计 */
  byType: Record<string, number>;
  /** 按来源统计 */
  bySource: Record<string, number>;
  /** 失败发送数 */
  failedSends: number;
  /** 平均发送时间 (ms) */
  avgSendTimeMs: number;
}

/** 客户端连接信息 */
export interface ClientConnection {
  /** WebSocket 连接 */
  ws: WebSocket;
  /** 客户端 DID */
  did: string;
  /** 订阅列表 */
  subscriptions: Set<string>;
  /** 连接时间 */
  connectedAt: Date;
  /** 最后活动 */
  lastActivity: Date;
  /** 发送队列大小 */
  queueSize: number;
  /** 是否已认证 */
  authenticated: boolean;
}

/** 事件广播器配置 */
export interface EventBroadcasterConfig {
  /** 最大队列大小 */
  maxQueueSize: number;
  /** 事件历史大小 */
  eventHistorySize: number;
  /** 批量发送大小 */
  batchSize: number;
  /** 批量发送间隔 (ms) */
  batchIntervalMs: number;
  /** 是否启用事件持久化 */
  enablePersistence: boolean;
  /** 心跳间隔 (ms) */
  heartbeatIntervalMs: number;
  /** 连接超时 (ms) */
  connectionTimeoutMs: number;
}

/** 主题定义 */
export interface Topic {
  /** 主题名称 */
  name: string;
  /** 主题模式 */
  pattern: string;
  /** 描述 */
  description?: string;
  /** 订阅者数量 */
  subscriberCount: number;
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_CONFIG: EventBroadcasterConfig = {
  maxQueueSize: 1000,
  eventHistorySize: 100,
  batchSize: 50,
  batchIntervalMs: 100,
  enablePersistence: false,
  heartbeatIntervalMs: 30000,
  connectionTimeoutMs: 60000,
};

// ============================================================================
// EventBroadcaster 类
// ============================================================================

/**
 * WebSocket 事件广播器
 * 管理事件订阅、过滤和广播
 */
export class EventBroadcaster extends EventEmitter {
  private config: EventBroadcasterConfig;
  private connections: Map<string, ClientConnection> = new Map();
  private subscriptions: Map<string, Subscription> = new Map();
  private eventHistory: BroadcastEvent[] = [];
  private stats: BroadcastStats;
  private idCounter = 0;
  private batchQueue: Map<string, BroadcastEvent[]> = new Map();
  private batchTimer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  constructor(config: Partial<EventBroadcasterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = this.createEmptyStats();
  }

  // ============================================================================
  // 连接管理
  // ============================================================================

  /**
   * 注册客户端连接
   */
  registerClient(ws: WebSocket, did: string): ClientConnection {
    const connection: ClientConnection = {
      ws,
      did,
      subscriptions: new Set(),
      connectedAt: new Date(),
      lastActivity: new Date(),
      queueSize: 0,
      authenticated: false,
    };

    this.connections.set(did, connection);

    // 设置 WebSocket 事件处理
    ws.on("close", () => this.unregisterClient(did));
    ws.on("message", (data) => this.handleClientMessage(did, data));

    this.emit("client:registered", { did, connection });

    return connection;
  }

  /**
   * 注销客户端连接
   */
  unregisterClient(did: string): void {
    const connection = this.connections.get(did);
    if (!connection) return;

    // 清理订阅
    for (const subId of connection.subscriptions) {
      const sub = this.subscriptions.get(subId);
      if (sub) sub.active = false;
    }

    this.connections.delete(did);
    this.batchQueue.delete(did);

    this.emit("client:unregistered", { did });
  }

  /**
   * 获取客户端连接
   */
  getClient(did: string): ClientConnection | undefined {
    return this.connections.get(did);
  }

  /**
   * 获取所有连接
   */
  getAllClients(): ClientConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * 获取连接数
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  // ============================================================================
  // 订阅管理
  // ============================================================================

  /**
   * 创建订阅
   */
  subscribe(clientDid: string, filter: SubscriptionFilter): Subscription {
    const subscription: Subscription = {
      id: this.generateId("sub"),
      clientDid,
      filter,
      createdAt: new Date(),
      lastActiveAt: new Date(),
      eventCount: 0,
      active: true,
    };

    this.subscriptions.set(subscription.id, subscription);

    const connection = this.connections.get(clientDid);
    if (connection) {
      connection.subscriptions.add(subscription.id);
    }

    this.emit("subscription:created", { subscription });

    return subscription;
  }

  /**
   * 取消订阅
   */
  unsubscribe(subscriptionId: string): boolean {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return false;

    subscription.active = false;

    const connection = this.connections.get(subscription.clientDid);
    if (connection) {
      connection.subscriptions.delete(subscriptionId);
    }

    this.emit("subscription:cancelled", { subscriptionId });

    return true;
  }

  /**
   * 获取客户端订阅
   */
  getSubscriptions(clientDid: string): Subscription[] {
    const connection = this.connections.get(clientDid);
    if (!connection) return [];

    return Array.from(connection.subscriptions)
      .map((id) => this.subscriptions.get(id))
      .filter((s): s is Subscription => s?.active ?? false);
  }

  /**
   * 获取活跃订阅数
   */
  getActiveSubscriptionCount(): number {
    return Array.from(this.subscriptions.values()).filter((s) => s.active).length;
  }

  // ============================================================================
  // 事件发布
  // ============================================================================

  /**
   * 发布事件
   */
  publish(event: Omit<BroadcastEvent, "id" | "timestamp">): BroadcastEvent {
    const fullEvent: BroadcastEvent = {
      ...event,
      id: this.generateId("evt"),
      timestamp: new Date(),
      metadata: event.metadata || {},
    };

    // 记录统计
    this.stats.totalEventsReceived++;
    this.stats.byType[event.type] = (this.stats.byType[event.type] || 0) + 1;
    this.stats.bySource[event.source] = (this.stats.bySource[event.source] || 0) + 1;

    // 保存历史
    this.eventHistory.push(fullEvent);
    if (this.eventHistory.length > this.config.eventHistorySize) {
      this.eventHistory.shift();
    }

    // 路由到订阅者
    this.routeEvent(fullEvent);

    // 发送事件
    this.emit("event:published", fullEvent);

    return fullEvent;
  }

  /**
   * 发布并等待确认
   */
  async publishWithAck(
    event: Omit<BroadcastEvent, "id" | "timestamp" | "requireAck">,
    timeoutMs: number = 5000
  ): Promise<{ event: BroadcastEvent; acks: string[] }> {
    const fullEvent = this.publish({
      ...event,
      requireAck: true,
    });

    return new Promise((resolve) => {
      const acks: string[] = [];
      const timeout = setTimeout(() => {
        this.emit("event:ack:timeout", { eventId: fullEvent.id, acks });
        resolve({ event: fullEvent, acks });
      }, timeoutMs);

      this.once(`ack:${fullEvent.id}`, (did: string) => {
        acks.push(did);
        // 当所有目标都确认时完成
        const targets = this.getEventTargets(fullEvent);
        if (acks.length >= targets.length) {
          clearTimeout(timeout);
          resolve({ event: fullEvent, acks });
        }
      });
    });
  }

  /**
   * 广播给所有客户端
   */
  broadcast(event: Omit<BroadcastEvent, "id" | "timestamp" | "target">): number {
    return this.publish({ ...event, target: "*" }).metadata.sentCount as number;
  }

  /**
   * 发送给指定客户端
   */
  sendTo(targetDid: string, event: Omit<BroadcastEvent, "id" | "timestamp" | "target">): boolean {
    const fullEvent = this.publish({ ...event, target: targetDid });
    return (fullEvent.metadata.sentCount as number) > 0;
  }

  // ============================================================================
  // 事件路由
  // ============================================================================

  /**
   * 路由事件到订阅者
   */
  private routeEvent(event: BroadcastEvent): void {
    const targets = this.getEventTargets(event);
    let sentCount = 0;

    for (const target of targets) {
      const connection = this.connections.get(target);
      if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
        continue;
      }

      // 直接目标的事件跳过订阅匹配
      const isDirectTarget = event.target && event.target !== "*";
      if (!isDirectTarget && !this.matchesSubscriptions(target, event)) {
        continue;
      }

      // 加入批量队列或直接发送
      if (this.config.batchSize > 1) {
        this.addToBatch(target, event);
      } else {
        if (this.sendToConnection(connection, event)) {
          sentCount++;
        }
      }
    }

    event.metadata.sentCount = sentCount;
  }

  /**
   * 获取事件目标
   */
  private getEventTargets(event: BroadcastEvent): string[] {
    if (event.target && event.target !== "*") {
      return [event.target];
    }

    // 广播给所有客户端
    return Array.from(this.connections.keys());
  }

  /**
   * 检查事件是否匹配客户端订阅
   */
  private matchesSubscriptions(clientDid: string, event: BroadcastEvent): boolean {
    const connection = this.connections.get(clientDid);
    if (!connection) return false;

    for (const subId of connection.subscriptions) {
      const subscription = this.subscriptions.get(subId);
      if (!subscription?.active) continue;

      if (this.matchesFilter(event, subscription.filter)) {
        subscription.lastActiveAt = new Date();
        subscription.eventCount++;
        return true;
      }
    }

    return false;
  }

  /**
   * 检查事件是否匹配过滤器
   */
  private matchesFilter(event: BroadcastEvent, filter: SubscriptionFilter): boolean {
    // 类型过滤
    if (filter.types && filter.types.length > 0) {
      const matches = filter.types.some((pattern) => this.matchPattern(event.type, pattern));
      if (!matches) return false;
    }

    // 来源过滤
    if (filter.sources && filter.sources.length > 0) {
      if (!filter.sources.includes(event.source)) return false;
    }

    // 优先级过滤
    if (filter.priorities && filter.priorities.length > 0) {
      if (!filter.priorities.includes(event.priority)) return false;
    }

    // 自定义过滤
    if (filter.custom) {
      return filter.custom(event);
    }

    return true;
  }

  /**
   * 模式匹配 (支持 * 通配符)
   */
  private matchPattern(value: string, pattern: string): boolean {
    if (pattern === "*") return true;
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return regex.test(value);
    }
    return value === pattern;
  }

  // ============================================================================
  // 发送逻辑
  // ============================================================================

  /**
   * 发送事件到连接
   */
  private sendToConnection(connection: ClientConnection, event: BroadcastEvent): boolean {
    const startTime = Date.now();

    try {
      connection.ws.send(JSON.stringify(event));
      connection.lastActivity = new Date();
      connection.queueSize = Math.max(0, connection.queueSize - 1);

      this.stats.totalEventsSent++;
      this.updateSendTime(Date.now() - startTime);

      return true;
    } catch (error) {
      this.stats.failedSends++;
      this.emit("send:error", { did: connection.did, error, event });
      return false;
    }
  }

  /**
   * 添加到批量队列
   */
  private addToBatch(clientDid: string, event: BroadcastEvent): void {
    if (!this.batchQueue.has(clientDid)) {
      this.batchQueue.set(clientDid, []);
    }

    const queue = this.batchQueue.get(clientDid)!;
    queue.push(event);

    // 限制队列大小
    if (queue.length > this.config.maxQueueSize) {
      queue.shift();
    }
  }

  /**
   * 启动批量发送
   */
  startBatchSending(): void {
    if (this.batchTimer) return;

    this.batchTimer = setInterval(() => {
      this.flushBatches();
    }, this.config.batchIntervalMs);
  }

  /**
   * 停止批量发送
   */
  stopBatchSending(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = undefined;
    }
  }

  /**
   * 刷新所有批量队列
   */
  private flushBatches(): void {
    for (const [did, events] of this.batchQueue) {
      if (events.length === 0) continue;

      const connection = this.connections.get(did);
      if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
        continue;
      }

      // 批量发送
      const batch = events.splice(0, this.config.batchSize);
      const batchMessage = {
        type: "batch",
        events: batch,
      };

      try {
        connection.ws.send(JSON.stringify(batchMessage));
        connection.lastActivity = new Date();
        connection.queueSize = events.length;
        this.stats.totalEventsSent += batch.length;
      } catch (error) {
        this.stats.failedSends += batch.length;
        this.emit("send:error", { did, error });
      }
    }
  }

  // ============================================================================
  // 客户端消息处理
  // ============================================================================

  /**
   * 处理客户端消息
   */
  private handleClientMessage(did: string, data: WebSocket.RawData): void {
    const connection = this.connections.get(did);
    if (!connection) return;

    connection.lastActivity = new Date();

    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "subscribe":
          this.subscribe(did, message.filter || {});
          break;

        case "unsubscribe":
          if (message.subscriptionId) {
            this.unsubscribe(message.subscriptionId);
          }
          break;

        case "ack":
          if (message.eventId) {
            this.emit(`ack:${message.eventId}`, did);
          }
          break;

        case "event":
          // 客户端发布事件
          this.publish({
            ...message,
            source: did,
          });
          break;

        case "ping":
          this.sendTo(did, {
            type: "pong",
            source: "broadcaster",
            priority: "high",
            payload: {},
            metadata: {},
            requireAck: false,
          });
          break;
      }
    } catch (error) {
      this.emit("message:error", { did, error });
    }
  }

  // ============================================================================
  // 主题管理
  // ============================================================================

  /**
   * 获取主题列表
   */
  getTopics(): Topic[] {
    const topicMap = new Map<string, number>();

    for (const subscription of this.subscriptions.values()) {
      if (!subscription.active) continue;

      const types = subscription.filter.types || ["*"];
      for (const type of types) {
        topicMap.set(type, (topicMap.get(type) || 0) + 1);
      }
    }

    return Array.from(topicMap.entries()).map(([name, count]) => ({
      name,
      pattern: name,
      subscriberCount: count,
    }));
  }

  /**
   * 获取主题订阅者
   */
  getTopicSubscribers(topic: string): string[] {
    const subscribers: string[] = [];

    for (const subscription of this.subscriptions.values()) {
      if (!subscription.active) continue;

      const types = subscription.filter.types || [];
      if (types.some((t) => this.matchPattern(topic, t))) {
        subscribers.push(subscription.clientDid);
      }
    }

    return subscribers;
  }

  // ============================================================================
  // 心跳
  // ============================================================================

  /**
   * 启动心跳
   */
  startHeartbeat(): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      this.checkConnections();
      this.sendHeartbeats();
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * 停止心跳
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /**
   * 检查连接状态
   */
  private checkConnections(): void {
    const now = Date.now();

    for (const [did, connection] of this.connections) {
      const inactiveTime = now - connection.lastActivity.getTime();

      if (inactiveTime > this.config.connectionTimeoutMs) {
        this.emit("client:timeout", { did });
        this.unregisterClient(did);
      }
    }
  }

  /**
   * 发送心跳
   */
  private sendHeartbeats(): void {
    for (const [did, connection] of this.connections) {
      if (connection.ws.readyState === WebSocket.OPEN) {
        this.sendTo(did, {
          type: "system.heartbeat",
          source: "broadcaster",
          priority: "low",
          payload: {
            timestamp: new Date().toISOString(),
          },
          metadata: {},
          requireAck: false,
        });
      }
    }
  }

  // ============================================================================
  // 历史和重放
  // ============================================================================

  /**
   * 获取事件历史
   */
  getEventHistory(filter?: {
    types?: string[];
    sources?: string[];
    since?: Date;
    limit?: number;
  }): BroadcastEvent[] {
    let events = [...this.eventHistory];

    if (filter) {
      if (filter.types) {
        events = events.filter((e) => filter.types!.includes(e.type));
      }
      if (filter.sources) {
        events = events.filter((e) => filter.sources!.includes(e.source));
      }
      if (filter.since) {
        events = events.filter((e) => e.timestamp >= filter.since!);
      }
      if (filter.limit) {
        events = events.slice(-filter.limit);
      }
    }

    return events;
  }

  /**
   * 重放历史事件给客户端
   */
  replayHistory(clientDid: string, filter?: SubscriptionFilter): number {
    const connection = this.connections.get(clientDid);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
      return 0;
    }

    const history = this.getEventHistory();
    let sent = 0;

    for (const event of history) {
      if (filter && !this.matchesFilter(event, filter)) {
        continue;
      }

      if (this.sendToConnection(connection, event)) {
        sent++;
      }
    }

    return sent;
  }

  // ============================================================================
  // 统计
  // ============================================================================

  /**
   * 获取统计
   */
  getStats(): BroadcastStats {
    return {
      ...this.stats,
      activeSubscriptions: this.getActiveSubscriptionCount(),
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = this.createEmptyStats();
  }

  /**
   * 创建空统计
   */
  private createEmptyStats(): BroadcastStats {
    return {
      totalEventsSent: 0,
      totalEventsReceived: 0,
      activeSubscriptions: 0,
      byType: {},
      bySource: {},
      failedSends: 0,
      avgSendTimeMs: 0,
    };
  }

  /**
   * 更新平均发送时间
   */
  private updateSendTime(timeMs: number): void {
    const total = this.stats.totalEventsSent;
    this.stats.avgSendTimeMs =
      (this.stats.avgSendTimeMs * (total - 1) + timeMs) / total;
  }

  // ============================================================================
  // 辅助方法
  // ============================================================================

  /**
   * 生成 ID
   */
  private generateId(prefix: string): string {
    this.idCounter++;
    return `${prefix}_${Date.now()}_${this.idCounter}`;
  }

  /**
   * 关闭所有连接
   */
  closeAll(): void {
    this.stopBatchSending();
    this.stopHeartbeat();

    for (const [did, connection] of this.connections) {
      try {
        connection.ws.close(1001, "Server shutting down");
      } catch {
        // Ignore errors
      }
    }

    this.connections.clear();
    this.subscriptions.clear();
    this.batchQueue.clear();
    this.eventHistory = [];
  }

  /**
   * 获取摘要
   */
  getSummary(): {
    connections: number;
    subscriptions: number;
    topics: number;
    eventHistory: number;
    stats: BroadcastStats;
  } {
    return {
      connections: this.connections.size,
      subscriptions: this.getActiveSubscriptionCount(),
      topics: this.getTopics().length,
      eventHistory: this.eventHistory.length,
      stats: this.getStats(),
    };
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建事件广播器
 */
export function createEventBroadcaster(config: Partial<EventBroadcasterConfig> = {}): EventBroadcaster {
  return new EventBroadcaster(config);
}

// ============================================================================
// 格式化函数
// ============================================================================

/**
 * 格式化事件
 */
export function formatEvent(event: BroadcastEvent): string {
  const lines = [
    `=== 事件 ===`,
    `ID: ${event.id}`,
    `类型: ${event.type}`,
    `来源: ${event.source}`,
    `目标: ${event.target || "广播"}`,
    `优先级: ${event.priority}`,
    `时间: ${event.timestamp.toISOString()}`,
  ];

  if (event.correlationId) {
    lines.push(`关联ID: ${event.correlationId}`);
  }

  lines.push(`负载: ${JSON.stringify(event.payload, null, 2)}`);

  return lines.join("\n");
}

/**
 * 格式化订阅
 */
export function formatSubscription(subscription: Subscription): string {
  const lines = [
    `=== 订阅 ===`,
    `ID: ${subscription.id}`,
    `客户端: ${subscription.clientDid}`,
    `状态: ${subscription.active ? "活跃" : "已取消"}`,
    `事件数: ${subscription.eventCount}`,
    `创建时间: ${subscription.createdAt.toISOString()}`,
  ];

  if (subscription.filter.types) {
    lines.push(`类型: ${subscription.filter.types.join(", ")}`);
  }
  if (subscription.filter.sources) {
    lines.push(`来源: ${subscription.filter.sources.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * 格式化统计
 */
export function formatStats(stats: BroadcastStats): string {
  const lines = [
    `=== 广播统计 ===`,
    `发送事件: ${stats.totalEventsSent}`,
    `接收事件: ${stats.totalEventsReceived}`,
    `活跃订阅: ${stats.activeSubscriptions}`,
    `失败发送: ${stats.failedSends}`,
    `平均发送时间: ${stats.avgSendTimeMs.toFixed(2)}ms`,
    ``,
    `按类型:`,
  ];

  for (const [type, count] of Object.entries(stats.byType)) {
    lines.push(`  ${type}: ${count}`);
  }

  lines.push(``, `按来源:`);

  for (const [source, count] of Object.entries(stats.bySource)) {
    lines.push(`  ${source}: ${count}`);
  }

  return lines.join("\n");
}
