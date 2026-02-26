/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  AnomalyDetector,
  createAnomalyDetector,
  formatAnomaly,
  formatRecoveryResult,
  type AnomalyRule,
  type AnomalyRecord,
  type RecoveryResult,
  type AnomalySeverity,
  type AnomalyCategory,
} from "../../interagent/anomaly-detector.js";

describe("AnomalyDetector", () => {
  let detector: AnomalyDetector;

  beforeEach(() => {
    detector = createAnomalyDetector({
      autoRecovery: false,
      checkIntervalMs: 100,
    });
  });

  afterEach(() => {
    detector.stopPeriodicCheck();
    detector.clear();
  });

  describe("Rule Management", () => {
    it("should have built-in rules", () => {
      const rules = detector.getAllRules();
      expect(rules.length).toBeGreaterThan(0);
    });

    it("should add custom rule", () => {
      const rule = detector.addRule({
        name: "Custom Rule",
        category: "custom",
        severity: "medium",
        condition: {
          metric: "custom_metric",
          operator: "gt",
          threshold: 100,
        },
        alertConfig: {
          channels: ["log"],
          aggregate: false,
        },
        enabled: true,
        cooldownMs: 60000,
        metadata: {},
      });

      expect(rule.id).toBeDefined();
      expect(rule.name).toBe("Custom Rule");

      const retrieved = detector.getRule(rule.id);
      expect(retrieved).toBeDefined();
    });

    it("should update rule", () => {
      const rule = detector.addRule({
        name: "Test Rule",
        category: "custom",
        severity: "low",
        condition: {
          metric: "test",
          operator: "gt",
          threshold: 10,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 60000,
        metadata: {},
      });

      const updated = detector.updateRule(rule.id, { severity: "high" });
      expect(updated?.severity).toBe("high");
    });

    it("should remove rule", () => {
      const rule = detector.addRule({
        name: "Test Rule",
        category: "custom",
        severity: "low",
        condition: {
          metric: "test",
          operator: "gt",
          threshold: 10,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 60000,
        metadata: {},
      });

      const removed = detector.removeRule(rule.id);
      expect(removed).toBe(true);
      expect(detector.getRule(rule.id)).toBeUndefined();
    });

    it("should enable/disable rule", () => {
      const rule = detector.addRule({
        name: "Test Rule",
        category: "custom",
        severity: "low",
        condition: {
          metric: "test",
          operator: "gt",
          threshold: 10,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 60000,
        metadata: {},
      });

      detector.setRuleEnabled(rule.id, false);
      expect(detector.getRule(rule.id)?.enabled).toBe(false);
    });
  });

  describe("Metric Collection", () => {
    it("should record metric", () => {
      detector.recordMetric("test_metric", 100);

      const history = detector.getMetricHistory("test_metric");
      expect(history).toHaveLength(1);
      expect(history[0].value).toBe(100);
    });

    it("should record multiple metrics", () => {
      detector.recordMetric("test", 10);
      detector.recordMetric("test", 20);
      detector.recordMetric("test", 30);

      const history = detector.getMetricHistory("test");
      expect(history).toHaveLength(3);
    });

    it("should get metric stats", () => {
      detector.recordMetric("test", 10);
      detector.recordMetric("test", 20);
      detector.recordMetric("test", 30);

      const stats = detector.getMetricStats("test");

      expect(stats.min).toBe(10);
      expect(stats.max).toBe(30);
      expect(stats.avg).toBe(20);
      expect(stats.count).toBe(3);
      expect(stats.latest).toBe(30);
    });

    it("should limit history", () => {
      for (let i = 0; i < 1500; i++) {
        detector.recordMetric("test", i);
      }

      const history = detector.getMetricHistory("test");
      expect(history.length).toBeLessThanOrEqual(1000);
    });
  });

  describe("Anomaly Detection", () => {
    it("should detect anomaly with gt operator", () => {
      const handler = vi.fn();
      detector.on("anomaly_detected", handler);

      detector.addRule({
        name: "High Value",
        category: "custom",
        severity: "high",
        condition: {
          metric: "test_value",
          operator: "gt",
          threshold: 100,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("test_value", 50);
      expect(handler).not.toHaveBeenCalled();

      detector.recordMetric("test_value", 150);
      expect(handler).toHaveBeenCalled();
    });

    it("should detect anomaly with lt operator", () => {
      const handler = vi.fn();
      detector.on("anomaly_detected", handler);

      detector.addRule({
        name: "Low Value",
        category: "custom",
        severity: "medium",
        condition: {
          metric: "low_test",
          operator: "lt",
          threshold: 10,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("low_test", 5);
      expect(handler).toHaveBeenCalled();
    });

    it("should detect anomaly with between operator", () => {
      const handler = vi.fn();
      detector.on("anomaly_detected", handler);

      detector.addRule({
        name: "In Range",
        category: "custom",
        severity: "low",
        condition: {
          metric: "range_test",
          operator: "between",
          threshold: [10, 20],
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("range_test", 15);
      expect(handler).toHaveBeenCalled();

      handler.mockClear();
      detector.recordMetric("range_test", 25);
      expect(handler).not.toHaveBeenCalled();
    });

    it("should detect anomaly with dataPoints requirement", () => {
      const handler = vi.fn();
      detector.on("anomaly_detected", handler);

      detector.addRule({
        name: "Multiple Points",
        category: "custom",
        severity: "medium",
        condition: {
          metric: "multi_test",
          operator: "gt",
          threshold: 100,
          dataPoints: 3,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("multi_test", 150);
      detector.recordMetric("multi_test", 150);
      expect(handler).not.toHaveBeenCalled();

      detector.recordMetric("multi_test", 150);
      expect(handler).toHaveBeenCalled();
    });

    it("should respect cooldown period", () => {
      const handler = vi.fn();
      detector.on("anomaly_detected", handler);

      detector.addRule({
        name: "Cooldown Test",
        category: "custom",
        severity: "low",
        condition: {
          metric: "cooldown_test",
          operator: "gt",
          threshold: 100,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 1000,
        metadata: {},
      });

      detector.recordMetric("cooldown_test", 150);
      expect(handler).toHaveBeenCalledTimes(1);

      detector.recordMetric("cooldown_test", 150);
      expect(handler).toHaveBeenCalledTimes(1); // Still 1 due to cooldown
    });
  });

  describe("Anomaly Management", () => {
    it("should get active anomalies", () => {
      detector.addRule({
        name: "Test Rule",
        category: "custom",
        severity: "high",
        condition: {
          metric: "active_test",
          operator: "gt",
          threshold: 100,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("active_test", 150);

      const active = detector.getActiveAnomalies();
      expect(active.length).toBeGreaterThan(0);
      expect(active[0].status).toBe("active");
    });

    it("should get anomalies by category", () => {
      detector.addRule({
        name: "Category Test",
        category: "resource",
        severity: "medium",
        condition: {
          metric: "cat_test",
          operator: "gt",
          threshold: 100,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("cat_test", 150);

      const anomalies = detector.getAnomaliesByCategory("resource");
      expect(anomalies.length).toBeGreaterThan(0);
    });

    it("should get anomalies by severity", () => {
      detector.addRule({
        name: "Severity Test",
        category: "custom",
        severity: "critical",
        condition: {
          metric: "sev_test",
          operator: "gt",
          threshold: 100,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("sev_test", 150);

      const anomalies = detector.getAnomaliesBySeverity("critical");
      expect(anomalies.length).toBeGreaterThan(0);
    });

    it("should acknowledge anomaly", () => {
      detector.addRule({
        name: "Ack Test",
        category: "custom",
        severity: "medium",
        condition: {
          metric: "ack_test",
          operator: "gt",
          threshold: 100,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("ack_test", 150);
      const anomaly = detector.getActiveAnomalies()[0];

      const result = detector.acknowledgeAnomaly(anomaly.id);
      expect(result).toBe(true);

      const updated = detector.getAnomaly(anomaly.id);
      expect(updated?.status).toBe("acknowledged");
      expect(updated?.acknowledgedAt).toBeDefined();
    });

    it("should resolve anomaly", () => {
      detector.addRule({
        name: "Resolve Test",
        category: "custom",
        severity: "medium",
        condition: {
          metric: "resolve_test",
          operator: "gt",
          threshold: 100,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("resolve_test", 150);
      const anomaly = detector.getActiveAnomalies()[0];

      const result = detector.resolveAnomaly(anomaly.id);
      expect(result).toBe(true);

      const updated = detector.getAnomaly(anomaly.id);
      expect(updated?.status).toBe("resolved");
      expect(updated?.resolvedAt).toBeDefined();
    });

    it("should ignore anomaly", () => {
      detector.addRule({
        name: "Ignore Test",
        category: "custom",
        severity: "medium",
        condition: {
          metric: "ignore_test",
          operator: "gt",
          threshold: 100,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("ignore_test", 150);
      const anomaly = detector.getActiveAnomalies()[0];

      const result = detector.ignoreAnomaly(anomaly.id);
      expect(result).toBe(true);

      const updated = detector.getAnomaly(anomaly.id);
      expect(updated?.status).toBe("ignored");
    });
  });

  describe("Events", () => {
    it("should emit anomaly_detected event", () => {
      const handler = vi.fn();
      detector.on("anomaly_detected", handler);

      detector.addRule({
        name: "Event Test",
        category: "custom",
        severity: "high",
        condition: {
          metric: "event_test",
          operator: "gt",
          threshold: 100,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("event_test", 150);

      expect(handler).toHaveBeenCalled();
    });

    it("should emit anomaly_acknowledged event", () => {
      const handler = vi.fn();
      detector.on("anomaly_acknowledged", handler);

      detector.addRule({
        name: "Ack Event Test",
        category: "custom",
        severity: "medium",
        condition: {
          metric: "ack_event",
          operator: "gt",
          threshold: 100,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("ack_event", 150);
      const anomaly = detector.getActiveAnomalies()[0];

      detector.acknowledgeAnomaly(anomaly.id);
      expect(handler).toHaveBeenCalled();
    });

    it("should emit anomaly_resolved event", () => {
      const handler = vi.fn();
      detector.on("anomaly_resolved", handler);

      detector.addRule({
        name: "Resolve Event Test",
        category: "custom",
        severity: "medium",
        condition: {
          metric: "resolve_event",
          operator: "gt",
          threshold: 100,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("resolve_event", 150);
      const anomaly = detector.getActiveAnomalies()[0];

      detector.resolveAnomaly(anomaly.id);
      expect(handler).toHaveBeenCalled();
    });

    it("should emit alert_sent event", () => {
      const handler = vi.fn();
      detector.on("alert_sent", handler);

      detector.addRule({
        name: "Alert Event Test",
        category: "custom",
        severity: "medium",
        condition: {
          metric: "alert_event",
          operator: "gt",
          threshold: 100,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("alert_event", 150);
      expect(handler).toHaveBeenCalled();
    });
  });

  describe("Recovery Strategies", () => {
    it("should have built-in recovery strategies", () => {
      const strategy = detector.getRecoveryStrategy("retry-with-backoff");
      expect(strategy).toBeDefined();
    });

    it("should add custom recovery strategy", () => {
      const strategy = detector.addRecoveryStrategy({
        name: "Custom Strategy",
        categories: ["custom"],
        severities: ["low", "medium"],
        actions: [{ type: "custom", params: {}, order: 1 }],
        maxRetries: 2,
        retryIntervalMs: 1000,
        autoExecute: true,
      });

      expect(strategy.id).toBeDefined();
      expect(strategy.name).toBe("Custom Strategy");
    });

    it("should get applicable strategies", () => {
      detector.addRule({
        name: "Recovery Test",
        category: "error_rate",
        severity: "high",
        condition: {
          metric: "recovery_test",
          operator: "gt",
          threshold: 100,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("recovery_test", 150);
      const anomaly = detector.getActiveAnomalies()[0];

      const strategies = detector.getApplicableStrategies(anomaly);
      expect(strategies.length).toBeGreaterThan(0);
    });
  });

  describe("Periodic Check", () => {
    it("should start and stop periodic check", () => {
      vi.useFakeTimers();

      detector.startPeriodicCheck();
      vi.advanceTimersByTime(500);

      detector.stopPeriodicCheck();
      vi.advanceTimersByTime(500);

      vi.useRealTimers();
    });
  });

  describe("Summary", () => {
    it("should get summary", () => {
      detector.addRule({
        name: "Summary Test",
        category: "custom",
        severity: "high",
        condition: {
          metric: "summary_test",
          operator: "gt",
          threshold: 100,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("summary_test", 150);

      const summary = detector.getSummary();

      expect(summary.totalAnomalies).toBeGreaterThan(0);
      expect(summary.activeAnomalies).toBeGreaterThan(0);
    });
  });

  describe("Clear", () => {
    it("should clear all data", () => {
      detector.addRule({
        name: "Clear Test",
        category: "custom",
        severity: "medium",
        condition: {
          metric: "clear_test",
          operator: "gt",
          threshold: 100,
        },
        alertConfig: { channels: ["log"], aggregate: false },
        enabled: true,
        cooldownMs: 0,
        metadata: {},
      });

      detector.recordMetric("clear_test", 150);

      detector.clear();

      const active = detector.getActiveAnomalies();
      expect(active).toHaveLength(0);
    });
  });
});

describe("Factory Functions", () => {
  it("should create anomaly detector", () => {
    const detector = createAnomalyDetector();
    expect(detector).toBeInstanceOf(AnomalyDetector);
  });

  it("should create with config", () => {
    const detector = createAnomalyDetector({
      autoRecovery: true,
      checkIntervalMs: 5000,
    });
    expect(detector).toBeInstanceOf(AnomalyDetector);
  });
});

describe("Format Functions", () => {
  describe("formatAnomaly", () => {
    it("should format anomaly record", () => {
      const anomaly: AnomalyRecord = {
        id: "anomaly-1",
        ruleId: "rule-1",
        category: "error_rate",
        severity: "high",
        status: "active",
        detectedAt: new Date("2026-02-26T12:00:00Z"),
        metricValue: 0.15,
        threshold: 0.1,
        message: "High error rate detected",
        context: {},
      };

      const formatted = formatAnomaly(anomaly);

      expect(formatted).toContain("anomaly-1");
      expect(formatted).toContain("error_rate");
      expect(formatted).toContain("high");
      expect(formatted).toContain("active");
      expect(formatted).toContain("High error rate detected");
    });

    it("should format resolved anomaly", () => {
      const anomaly: AnomalyRecord = {
        id: "anomaly-2",
        ruleId: "rule-2",
        category: "budget",
        severity: "critical",
        status: "resolved",
        detectedAt: new Date("2026-02-26T12:00:00Z"),
        acknowledgedAt: new Date("2026-02-26T12:01:00Z"),
        resolvedAt: new Date("2026-02-26T12:05:00Z"),
        metricValue: 105,
        threshold: 100,
        message: "Budget exceeded",
        context: {},
      };

      const formatted = formatAnomaly(anomaly);

      expect(formatted).toContain("确认时间");
      expect(formatted).toContain("解决时间");
    });
  });

  describe("formatRecoveryResult", () => {
    it("should format successful recovery", () => {
      const result: RecoveryResult = {
        anomalyId: "anomaly-1",
        strategyId: "strategy-1",
        executedAt: new Date("2026-02-26T12:00:00Z"),
        success: true,
        actionsExecuted: ["retry", "throttle"],
        context: {},
      };

      const formatted = formatRecoveryResult(result);

      expect(formatted).toContain("anomaly-1");
      expect(formatted).toContain("成功");
      expect(formatted).toContain("retry");
      expect(formatted).toContain("throttle");
    });

    it("should format failed recovery", () => {
      const result: RecoveryResult = {
        anomalyId: "anomaly-1",
        strategyId: "strategy-1",
        executedAt: new Date("2026-02-26T12:00:00Z"),
        success: false,
        actionsExecuted: ["retry"],
        error: "Max retries exceeded",
        context: {},
      };

      const formatted = formatRecoveryResult(result);

      expect(formatted).toContain("失败");
      expect(formatted).toContain("Max retries exceeded");
    });
  });
});
