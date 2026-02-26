/**
 * 异常检测与告警系统
 * 实现异常分类、告警触发和恢复策略
 *
 * @module interagent/anomaly-detector
 * @version 1.0.0
 */

import { EventEmitter } from "events";

// ============================================================================
// 类型定义
// ============================================================================

/** 异常严重程度 */
export type AnomalySeverity = "low" | "medium" | "high" | "critical";

/** 异常类别 */
export type AnomalyCategory =
  | "resource"
  | "performance"
  | "error_rate"
  | "budget"
  | "connection"
  | "task_failure"
  | "timeout"
  | "custom";

/** 异常状态 */
export type AnomalyStatus = "active" | "acknowledged" | "resolved" | "ignored";

/** 告警渠道 */
export type AlertChannel = "log" | "webhook" | "email" | "slack" | "custom";

/** 异常检测规则 */
export interface AnomalyRule {
  /** 规则 ID */
  id: string;
  /** 规则名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 异常类别 */
  category: AnomalyCategory;
  /** 严重程度 */
  severity: AnomalySeverity;
  /** 条件表达式 */
  condition: AnomalyCondition;
  /** 告警配置 */
  alertConfig: AlertConfig;
  /** 是否启用 */
  enabled: boolean;
  /** 冷却时间 (ms) */
  cooldownMs: number;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/** 异常条件 */
export interface AnomalyCondition {
  /** 指标名称 */
  metric: string;
  /** 比较操作符 */
  operator: "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "between" | "outside";
  /** 阈值 */
  threshold: number | [number, number];
  /** 持续时间 (ms) - 条件必须持续的时间 */
  durationMs?: number;
  /** 数据点数量 - 触发所需的连续数据点 */
  dataPoints?: number;
}

/** 告警配置 */
export interface AlertConfig {
  /** 告警渠道 */
  channels: AlertChannel[];
  /** 告警模板 */
  template?: string;
  /** Webhook URL */
  webhookUrl?: string;
  /** 自定义处理器 */
  customHandler?: string;
  /** 是否聚合告警 */
  aggregate: boolean;
  /** 聚合时间窗口 (ms) */
  aggregateWindowMs?: number;
}

/** 异常记录 */
export interface AnomalyRecord {
  /** 异常 ID */
  id: string;
  /** 规则 ID */
  ruleId: string;
  /** 类别 */
  category: AnomalyCategory;
  /** 严重程度 */
  severity: AnomalySeverity;
  /** 状态 */
  status: AnomalyStatus;
  /** 检测时间 */
  detectedAt: Date;
  /** 确认时间 */
  acknowledgedAt?: Date;
  /** 解决时间 */
  resolvedAt?: Date;
  /** 指标值 */
  metricValue: number;
  /** 阈值 */
  threshold: number | [number, number];
  /** 消息 */
  message: string;
  /** 上下文数据 */
  context: Record<string, unknown>;
  /** 关联的任务 ID */
  taskId?: string;
  /** 恢复策略 ID */
  recoveryStrategyId?: string;
}

/** 恢复策略 */
export interface RecoveryStrategy {
  /** 策略 ID */
  id: string;
  /** 策略名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 适用类别 */
  categories: AnomalyCategory[];
  /** 适用严重程度 */
  severities: AnomalySeverity[];
  /** 恢复动作 */
  actions: RecoveryAction[];
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试间隔 (ms) */
  retryIntervalMs: number;
  /** 是否自动执行 */
  autoExecute: boolean;
}

/** 恢复动作 */
export interface RecoveryAction {
  /** 动作类型 */
  type: "throttle" | "retry" | "fallback" | "notify" | "restart" | "scale" | "custom";
  /** 动作参数 */
  params: Record<string, unknown>;
  /** 执行顺序 */
  order: number;
}

/** 恢复执行结果 */
export interface RecoveryResult {
  /** 异常 ID */
  anomalyId: string;
  /** 策略 ID */
  strategyId: string;
  /** 执行时间 */
  executedAt: Date;
  /** 是否成功 */
  success: boolean;
  /** 执行的动作 */
  actionsExecuted: string[];
  /** 错误信息 */
  error?: string;
  /** 上下文 */
  context: Record<string, unknown>;
}

/** 异常检测器配置 */
export interface AnomalyDetectorConfig {
  /** 检查间隔 (ms) */
  checkIntervalMs: number;
  /** 最大活跃异常数 */
  maxActiveAnomalies: number;
  /** 异常历史保留时间 (ms) */
  historyRetentionMs: number;
  /** 是否自动恢复 */
  autoRecovery: boolean;
  /** 默认告警渠道 */
  defaultAlertChannels: AlertChannel[];
}

/** 指标数据点 */
export interface MetricDataPoint {
  /** 指标名称 */
  metric: string;
  /** 值 */
  value: number;
  /** 时间戳 */
  timestamp: Date;
  /** 标签 */
  tags: Record<string, string>;
}

/** 异常事件 */
export interface AnomalyEvent {
  /** 事件类型 */
  type: "anomaly_detected" | "anomaly_acknowledged" | "anomaly_resolved" | "alert_sent" | "recovery_started" | "recovery_completed";
  /** 时间戳 */
  timestamp: Date;
  /** 异常记录 */
  anomaly?: AnomalyRecord;
  /** 数据 */
  data: unknown;
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_CONFIG: AnomalyDetectorConfig = {
  checkIntervalMs: 10000, // 10 seconds
  maxActiveAnomalies: 100,
  historyRetentionMs: 24 * 60 * 60 * 1000, // 24 hours
  autoRecovery: false,
  defaultAlertChannels: ["log"],
};

// ============================================================================
// 内置规则
// ============================================================================

const BUILTIN_RULES: AnomalyRule[] = [
  {
    id: "high-error-rate",
    name: "高错误率",
    description: "API 错误率超过阈值",
    category: "error_rate",
    severity: "high",
    condition: {
      metric: "error_rate",
      operator: "gt",
      threshold: 0.1, // 10%
      dataPoints: 3,
    },
    alertConfig: {
      channels: ["log", "webhook"],
      aggregate: true,
      aggregateWindowMs: 60000,
    },
    enabled: true,
    cooldownMs: 300000, // 5 minutes
    metadata: {},
  },
  {
    id: "high-latency",
    name: "高延迟",
    description: "API 响应延迟过高",
    category: "performance",
    severity: "medium",
    condition: {
      metric: "latency_p99",
      operator: "gt",
      threshold: 5000, // 5 seconds
      dataPoints: 3,
    },
    alertConfig: {
      channels: ["log"],
      aggregate: true,
    },
    enabled: true,
    cooldownMs: 300000,
    metadata: {},
  },
  {
    id: "budget-warning",
    name: "预算警告",
    description: "资源使用接近预算限制",
    category: "budget",
    severity: "medium",
    condition: {
      metric: "budget_usage_percent",
      operator: "gt",
      threshold: 80,
    },
    alertConfig: {
      channels: ["log"],
      aggregate: false,
    },
    enabled: true,
    cooldownMs: 60000,
    metadata: {},
  },
  {
    id: "budget-exceeded",
    name: "预算超支",
    description: "资源使用超出预算限制",
    category: "budget",
    severity: "critical",
    condition: {
      metric: "budget_usage_percent",
      operator: "gt",
      threshold: 100,
    },
    alertConfig: {
      channels: ["log", "webhook"],
      aggregate: false,
    },
    enabled: true,
    cooldownMs: 0, // No cooldown for critical
    metadata: {},
  },
  {
    id: "task-failure-spike",
    name: "任务失败激增",
    description: "任务失败率突然增加",
    category: "task_failure",
    severity: "high",
    condition: {
      metric: "task_failure_rate",
      operator: "gt",
      threshold: 0.2, // 20%
      dataPoints: 2,
    },
    alertConfig: {
      channels: ["log", "webhook"],
      aggregate: true,
    },
    enabled: true,
    cooldownMs: 180000,
    metadata: {},
  },
  {
    id: "connection-drop",
    name: "连接中断",
    description: "WebSocket 连接断开",
    category: "connection",
    severity: "high",
    condition: {
      metric: "connection_status",
      operator: "eq",
      threshold: 0, // 0 = disconnected
    },
    alertConfig: {
      channels: ["log"],
      aggregate: false,
    },
    enabled: true,
    cooldownMs: 60000,
    metadata: {},
  },
];

// ============================================================================
// 内置恢复策略
// ============================================================================

const BUILTIN_RECOVERY_STRATEGIES: RecoveryStrategy[] = [
  {
    id: "retry-with-backoff",
    name: "指数退避重试",
    description: "使用指数退避策略重试失败操作",
    categories: ["error_rate", "task_failure", "timeout"],
    severities: ["low", "medium", "high"],
    actions: [
      { type: "retry", params: { backoff: "exponential", maxAttempts: 3 }, order: 1 },
    ],
    maxRetries: 3,
    retryIntervalMs: 1000,
    autoExecute: true,
  },
  {
    id: "throttle-requests",
    name: "请求限流",
    description: "降低请求频率以减轻负载",
    categories: ["performance", "resource"],
    severities: ["medium", "high"],
    actions: [
      { type: "throttle", params: { factor: 0.5 }, order: 1 },
    ],
    maxRetries: 1,
    retryIntervalMs: 0,
    autoExecute: true,
  },
  {
    id: "fallback-model",
    name: "降级模型",
    description: "切换到更便宜的模型以节省成本",
    categories: ["budget"],
    severities: ["high", "critical"],
    actions: [
      { type: "fallback", params: { targetModel: "gpt-4o-mini" }, order: 1 },
    ],
    maxRetries: 1,
    retryIntervalMs: 0,
    autoExecute: true,
  },
  {
    id: "notify-admin",
    name: "通知管理员",
    description: "发送告警通知给管理员",
    categories: ["connection", "error_rate"],
    severities: ["high", "critical"],
    actions: [
      { type: "notify", params: { level: "critical" }, order: 1 },
    ],
    maxRetries: 3,
    retryIntervalMs: 60000,
    autoExecute: true,
  },
  {
    id: "restart-service",
    name: "重启服务",
    description: "重启受影响的服务",
    categories: ["connection", "performance"],
    severities: ["critical"],
    actions: [
      { type: "restart", params: { graceful: true }, order: 1 },
    ],
    maxRetries: 1,
    retryIntervalMs: 0,
    autoExecute: false, // Manual approval required
  },
];

// ============================================================================
// AnomalyDetector 类
// ============================================================================

/**
 * 异常检测器
 * 检测、告警和处理系统异常
 */
export class AnomalyDetector extends EventEmitter {
  private config: AnomalyDetectorConfig;
  private rules: Map<string, AnomalyRule> = new Map();
  private strategies: Map<string, RecoveryStrategy> = new Map();
  private anomalies: Map<string, AnomalyRecord> = new Map();
  private metrics: Map<string, MetricDataPoint[]> = new Map();
  private lastTriggered: Map<string, Date> = new Map();
  private checkTimer?: ReturnType<typeof setInterval>;
  private alertAggregator: Map<string, AnomalyRecord[]> = new Map();
  private idCounter = 0;

  constructor(config: Partial<AnomalyDetectorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 加载内置规则
    for (const rule of BUILTIN_RULES) {
      this.rules.set(rule.id, rule);
    }

    // 加载内置恢复策略
    for (const strategy of BUILTIN_RECOVERY_STRATEGIES) {
      this.strategies.set(strategy.id, strategy);
    }
  }

  // ============================================================================
  // 规则管理
  // ============================================================================

  /**
   * 添加规则
   */
  addRule(rule: Omit<AnomalyRule, "id">): AnomalyRule {
    const fullRule: AnomalyRule = {
      ...rule,
      id: this.generateId("rule"),
    };
    this.rules.set(fullRule.id, fullRule);
    return fullRule;
  }

  /**
   * 获取规则
   */
  getRule(ruleId: string): AnomalyRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * 获取所有规则
   */
  getAllRules(): AnomalyRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * 更新规则
   */
  updateRule(ruleId: string, updates: Partial<AnomalyRule>): AnomalyRule | undefined {
    const rule = this.rules.get(ruleId);
    if (!rule) return undefined;

    const updated = { ...rule, ...updates };
    this.rules.set(ruleId, updated);
    return updated;
  }

  /**
   * 删除规则
   */
  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * 启用/禁用规则
   */
  setRuleEnabled(ruleId: string, enabled: boolean): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;
    rule.enabled = enabled;
    return true;
  }

  // ============================================================================
  // 指标收集
  // ============================================================================

  /**
   * 记录指标
   */
  recordMetric(metric: string, value: number, tags: Record<string, string> = {}): void {
    const dataPoint: MetricDataPoint = {
      metric,
      value,
      timestamp: new Date(),
      tags,
    };

    if (!this.metrics.has(metric)) {
      this.metrics.set(metric, []);
    }

    const history = this.metrics.get(metric)!;
    history.push(dataPoint);

    // 保留最近 1000 个数据点
    if (history.length > 1000) {
      history.shift();
    }

    // 立即检查相关规则
    this.checkRulesForMetric(metric);
  }

  /**
   * 获取指标历史
   */
  getMetricHistory(metric: string, limit?: number): MetricDataPoint[] {
    const history = this.metrics.get(metric) || [];
    return limit ? history.slice(-limit) : [...history];
  }

  /**
   * 获取指标统计
   */
  getMetricStats(metric: string, windowMs?: number): {
    min: number;
    max: number;
    avg: number;
    count: number;
    latest: number;
  } {
    const history = this.metrics.get(metric) || [];
    const cutoff = windowMs ? new Date(Date.now() - windowMs) : new Date(0);
    const filtered = history.filter((p) => p.timestamp >= cutoff);

    if (filtered.length === 0) {
      return { min: 0, max: 0, avg: 0, count: 0, latest: 0 };
    }

    const values = filtered.map((p) => p.value);
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      count: values.length,
      latest: values[values.length - 1],
    };
  }

  // ============================================================================
  // 异常检测
  // ============================================================================

  /**
   * 检查指定指标的所有规则
   */
  private checkRulesForMetric(metric: string): void {
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      if (rule.condition.metric !== metric) continue;

      this.evaluateRule(rule);
    }
  }

  /**
   * 评估规则
   */
  private evaluateRule(rule: AnomalyRule): boolean {
    const { condition } = rule;
    const history = this.metrics.get(condition.metric) || [];

    // 检查数据点数量
    const dataPointsNeeded = condition.dataPoints || 1;
    if (history.length < dataPointsNeeded) {
      return false;
    }

    // 获取最近的数据点
    const recentPoints = history.slice(-dataPointsNeeded);
    const values = recentPoints.map((p) => p.value);

    // 检查是否所有数据点都满足条件
    const allMatch = values.every((v) => this.evaluateCondition(v, condition));

    if (!allMatch) {
      return false;
    }

    // 检查冷却时间
    const lastTriggered = this.lastTriggered.get(rule.id);
    if (lastTriggered && rule.cooldownMs > 0) {
      const elapsed = Date.now() - lastTriggered.getTime();
      if (elapsed < rule.cooldownMs) {
        return false;
      }
    }

    // 触发异常
    this.triggerAnomaly(rule, values[values.length - 1]);
    return true;
  }

  /**
   * 评估条件
   */
  private evaluateCondition(value: number, condition: AnomalyCondition): boolean {
    const { operator, threshold } = condition;

    switch (operator) {
      case "gt":
        return value > (threshold as number);
      case "gte":
        return value >= (threshold as number);
      case "lt":
        return value < (threshold as number);
      case "lte":
        return value <= (threshold as number);
      case "eq":
        return value === (threshold as number);
      case "neq":
        return value !== (threshold as number);
      case "between":
        const [min, max] = threshold as [number, number];
        return value >= min && value <= max;
      case "outside":
        const [minVal, maxVal] = threshold as [number, number];
        return value < minVal || value > maxVal;
      default:
        return false;
    }
  }

  /**
   * 触发异常
   */
  private triggerAnomaly(rule: AnomalyRule, metricValue: number): AnomalyRecord {
    const anomaly: AnomalyRecord = {
      id: this.generateId("anomaly"),
      ruleId: rule.id,
      category: rule.category,
      severity: rule.severity,
      status: "active",
      detectedAt: new Date(),
      metricValue,
      threshold: rule.condition.threshold,
      message: this.formatAnomalyMessage(rule, metricValue),
      context: {},
    };

    this.anomalies.set(anomaly.id, anomaly);
    this.lastTriggered.set(rule.id, new Date());

    // 发送事件
    this.emitEvent("anomaly_detected", anomaly);

    // 发送告警
    this.sendAlert(rule, anomaly);

    // 自动恢复
    if (this.config.autoRecovery) {
      this.attemptRecovery(anomaly);
    }

    return anomaly;
  }

  /**
   * 格式化异常消息
   */
  private formatAnomalyMessage(rule: AnomalyRule, value: number): string {
    const thresholdStr = Array.isArray(rule.condition.threshold)
      ? `${rule.condition.threshold[0]}-${rule.condition.threshold[1]}`
      : rule.condition.threshold.toString();

    return `[${rule.severity.toUpperCase()}] ${rule.name}: ${rule.condition.metric}=${value} (threshold: ${rule.condition.operator} ${thresholdStr})`;
  }

  // ============================================================================
  // 告警系统
  // ============================================================================

  /**
   * 发送告警
   */
  private async sendAlert(rule: AnomalyRule, anomaly: AnomalyRecord): Promise<void> {
    const { alertConfig } = rule;

    // 聚合告警
    if (alertConfig.aggregate && alertConfig.aggregateWindowMs) {
      const key = rule.id;
      if (!this.alertAggregator.has(key)) {
        this.alertAggregator.set(key, []);
        // 设置定时器发送聚合告警
        setTimeout(() => {
          const aggregated = this.alertAggregator.get(key) || [];
          this.alertAggregator.delete(key);
          if (aggregated.length > 0) {
            this.sendAggregatedAlert(rule, aggregated);
          }
        }, alertConfig.aggregateWindowMs);
      }
      this.alertAggregator.get(key)!.push(anomaly);
      return;
    }

    // 发送单个告警
    for (const channel of alertConfig.channels) {
      await this.sendAlertToChannel(channel, rule, anomaly, alertConfig);
    }
  }

  /**
   * 发送聚合告警
   */
  private async sendAggregatedAlert(rule: AnomalyRule, anomalies: AnomalyRecord[]): Promise<void> {
    const alertConfig = rule.alertConfig;

    for (const channel of alertConfig.channels) {
      const message = `Aggregated alert: ${anomalies.length} anomalies of type "${rule.name}"`;

      switch (channel) {
        case "log":
          console.warn(`[ALERT] ${message}`);
          break;
        case "webhook":
          if (alertConfig.webhookUrl) {
            await this.sendWebhook(alertConfig.webhookUrl, {
              type: "aggregated",
              rule,
              anomalies,
              message,
            });
          }
          break;
      }
    }

    this.emitEvent("alert_sent", undefined, { rule, anomalies, aggregated: true });
  }

  /**
   * 发送告警到指定渠道
   */
  private async sendAlertToChannel(
    channel: AlertChannel,
    rule: AnomalyRule,
    anomaly: AnomalyRecord,
    config: AlertConfig
  ): Promise<void> {
    switch (channel) {
      case "log":
        console.warn(`[ALERT] ${anomaly.message}`);
        break;

      case "webhook":
        if (config.webhookUrl) {
          await this.sendWebhook(config.webhookUrl, { rule, anomaly });
        }
        break;

      case "custom":
        // 自定义处理器通过事件系统处理
        break;
    }

    this.emitEvent("alert_sent", anomaly, { channel });
  }

  /**
   * 发送 Webhook
   */
  private async sendWebhook(url: string, data: unknown): Promise<void> {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    } catch (error) {
      console.error("Failed to send webhook alert:", error);
    }
  }

  // ============================================================================
  // 异常管理
  // ============================================================================

  /**
   * 获取异常
   */
  getAnomaly(anomalyId: string): AnomalyRecord | undefined {
    return this.anomalies.get(anomalyId);
  }

  /**
   * 获取所有活跃异常
   */
  getActiveAnomalies(): AnomalyRecord[] {
    return Array.from(this.anomalies.values()).filter((a) => a.status === "active");
  }

  /**
   * 获取指定类别的异常
   */
  getAnomaliesByCategory(category: AnomalyCategory): AnomalyRecord[] {
    return Array.from(this.anomalies.values()).filter((a) => a.category === category);
  }

  /**
   * 获取指定严重程度的异常
   */
  getAnomaliesBySeverity(severity: AnomalySeverity): AnomalyRecord[] {
    return Array.from(this.anomalies.values()).filter((a) => a.severity === severity);
  }

  /**
   * 确认异常
   */
  acknowledgeAnomaly(anomalyId: string): boolean {
    const anomaly = this.anomalies.get(anomalyId);
    if (!anomaly || anomaly.status !== "active") return false;

    anomaly.status = "acknowledged";
    anomaly.acknowledgedAt = new Date();
    this.emitEvent("anomaly_acknowledged", anomaly);

    return true;
  }

  /**
   * 解决异常
   */
  resolveAnomaly(anomalyId: string): boolean {
    const anomaly = this.anomalies.get(anomalyId);
    if (!anomaly || anomaly.status === "resolved") return false;

    anomaly.status = "resolved";
    anomaly.resolvedAt = new Date();
    this.emitEvent("anomaly_resolved", anomaly);

    return true;
  }

  /**
   * 忽略异常
   */
  ignoreAnomaly(anomalyId: string): boolean {
    const anomaly = this.anomalies.get(anomalyId);
    if (!anomaly) return false;

    anomaly.status = "ignored";
    return true;
  }

  // ============================================================================
  // 恢复策略
  // ============================================================================

  /**
   * 添加恢复策略
   */
  addRecoveryStrategy(strategy: Omit<RecoveryStrategy, "id">): RecoveryStrategy {
    const fullStrategy: RecoveryStrategy = {
      ...strategy,
      id: this.generateId("strategy"),
    };
    this.strategies.set(fullStrategy.id, fullStrategy);
    return fullStrategy;
  }

  /**
   * 获取恢复策略
   */
  getRecoveryStrategy(strategyId: string): RecoveryStrategy | undefined {
    return this.strategies.get(strategyId);
  }

  /**
   * 获取适用的恢复策略
   */
  getApplicableStrategies(anomaly: AnomalyRecord): RecoveryStrategy[] {
    return Array.from(this.strategies.values()).filter(
      (s) =>
        s.categories.includes(anomaly.category) &&
        s.severities.includes(anomaly.severity) &&
        s.autoExecute
    );
  }

  /**
   * 尝试恢复
   */
  async attemptRecovery(anomaly: AnomalyRecord): Promise<RecoveryResult | undefined> {
    const strategies = this.getApplicableStrategies(anomaly);
    if (strategies.length === 0) return undefined;

    // 使用第一个适用的策略
    const strategy = strategies[0];
    anomaly.recoveryStrategyId = strategy.id;

    this.emitEvent("recovery_started", anomaly, { strategy });

    const actionsExecuted: string[] = [];
    let error: string | undefined;

    try {
      for (const action of strategy.actions.sort((a, b) => a.order - b.order)) {
        await this.executeRecoveryAction(action, anomaly);
        actionsExecuted.push(action.type);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const result: RecoveryResult = {
      anomalyId: anomaly.id,
      strategyId: strategy.id,
      executedAt: new Date(),
      success: !error,
      actionsExecuted,
      error,
      context: {},
    };

    this.emitEvent("recovery_completed", anomaly, result);

    // 如果恢复成功，解决异常
    if (result.success) {
      this.resolveAnomaly(anomaly.id);
    }

    return result;
  }

  /**
   * 执行恢复动作
   */
  private async executeRecoveryAction(
    action: RecoveryAction,
    anomaly: AnomalyRecord
  ): Promise<void> {
    switch (action.type) {
      case "retry":
        console.log(`[Recovery] Retrying for anomaly ${anomaly.id}`);
        break;

      case "throttle":
        console.log(`[Recovery] Throttling requests for anomaly ${anomaly.id}`);
        break;

      case "fallback":
        console.log(`[Recovery] Switching to fallback for anomaly ${anomaly.id}`);
        break;

      case "notify":
        console.log(`[Recovery] Sending notification for anomaly ${anomaly.id}`);
        break;

      case "restart":
        console.log(`[Recovery] Restarting service for anomaly ${anomaly.id}`);
        break;

      case "scale":
        console.log(`[Recovery] Scaling resources for anomaly ${anomaly.id}`);
        break;

      case "custom":
        // 自定义动作通过事件系统处理
        this.emit("recovery_action", { action, anomaly });
        break;
    }
  }

  // ============================================================================
  // 定时检查
  // ============================================================================

  /**
   * 启动定时检查
   */
  startPeriodicCheck(): void {
    if (this.checkTimer) return;

    this.checkTimer = setInterval(() => {
      this.runPeriodicCheck();
    }, this.config.checkIntervalMs);
  }

  /**
   * 停止定时检查
   */
  stopPeriodicCheck(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
  }

  /**
   * 运行周期性检查
   */
  private runPeriodicCheck(): void {
    // 清理过期历史
    this.cleanupHistory();

    // 检查所有启用的规则
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      this.evaluateRule(rule);
    }
  }

  /**
   * 清理过期数据
   */
  private cleanupHistory(): void {
    const cutoff = new Date(Date.now() - this.config.historyRetentionMs);

    // 清理异常历史
    for (const [id, anomaly] of this.anomalies) {
      if (anomaly.detectedAt < cutoff && anomaly.status === "resolved") {
        this.anomalies.delete(id);
      }
    }

    // 限制活跃异常数量
    const active = this.getActiveAnomalies();
    if (active.length > this.config.maxActiveAnomalies) {
      // 移除最旧的已解决异常
      const resolved = active
        .filter((a) => a.status === "resolved")
        .sort((a, b) => a.detectedAt.getTime() - b.detectedAt.getTime());

      const toRemove = resolved.slice(0, active.length - this.config.maxActiveAnomalies);
      for (const anomaly of toRemove) {
        this.anomalies.delete(anomaly.id);
      }
    }
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
   * 发送事件
   */
  private emitEvent(type: AnomalyEvent["type"], anomaly: AnomalyRecord | undefined, data: unknown = {}): void {
    const event: AnomalyEvent = {
      type,
      timestamp: new Date(),
      anomaly,
      data,
    };

    this.emit("anomaly", event);
    this.emit(type, event);
  }

  /**
   * 获取统计摘要
   */
  getSummary(): {
    totalAnomalies: number;
    activeAnomalies: number;
    byCategory: Record<AnomalyCategory, number>;
    bySeverity: Record<AnomalySeverity, number>;
  } {
    const anomalies = Array.from(this.anomalies.values());
    const active = anomalies.filter((a) => a.status === "active");

    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const anomaly of active) {
      byCategory[anomaly.category] = (byCategory[anomaly.category] || 0) + 1;
      bySeverity[anomaly.severity] = (bySeverity[anomaly.severity] || 0) + 1;
    }

    return {
      totalAnomalies: anomalies.length,
      activeAnomalies: active.length,
      byCategory: byCategory as Record<AnomalyCategory, number>,
      bySeverity: bySeverity as Record<AnomalySeverity, number>,
    };
  }

  /**
   * 清除所有数据
   */
  clear(): void {
    this.anomalies.clear();
    this.metrics.clear();
    this.lastTriggered.clear();
    this.alertAggregator.clear();
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建异常检测器
 */
export function createAnomalyDetector(config: Partial<AnomalyDetectorConfig> = {}): AnomalyDetector {
  return new AnomalyDetector(config);
}

// ============================================================================
// 格式化函数
// ============================================================================

/**
 * 格式化异常记录
 */
export function formatAnomaly(anomaly: AnomalyRecord): string {
  const lines = [
    `=== 异常报告 ===`,
    `ID: ${anomaly.id}`,
    `类别: ${anomaly.category}`,
    `严重程度: ${anomaly.severity}`,
    `状态: ${anomaly.status}`,
    `检测时间: ${anomaly.detectedAt.toISOString()}`,
    `消息: ${anomaly.message}`,
    `指标值: ${anomaly.metricValue}`,
    `阈值: ${Array.isArray(anomaly.threshold) ? anomaly.threshold.join("-") : anomaly.threshold}`,
  ];

  if (anomaly.acknowledgedAt) {
    lines.push(`确认时间: ${anomaly.acknowledgedAt.toISOString()}`);
  }
  if (anomaly.resolvedAt) {
    lines.push(`解决时间: ${anomaly.resolvedAt.toISOString()}`);
  }

  return lines.join("\n");
}

/**
 * 格式化恢复结果
 */
export function formatRecoveryResult(result: RecoveryResult): string {
  const lines = [
    `=== 恢复结果 ===`,
    `异常 ID: ${result.anomalyId}`,
    `策略 ID: ${result.strategyId}`,
    `执行时间: ${result.executedAt.toISOString()}`,
    `状态: ${result.success ? "成功" : "失败"}`,
    `执行动作: ${result.actionsExecuted.join(", ") || "无"}`,
  ];

  if (result.error) {
    lines.push(`错误: ${result.error}`);
  }

  return lines.join("\n");
}
