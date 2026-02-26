/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ProgressTracker,
  ProgressAggregator,
  createProgressTracker,
  createProgressAggregator,
  formatProgressStatus,
  formatDuration,
  formatProgressBar,
  formatProgressReport,
  type ProgressUpdate,
  type ProgressReport,
  type ProgressStatus,
} from "../../interagent/progress-reporter.js";

describe("ProgressTracker", () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    tracker = createProgressTracker("task-1");
  });

  describe("Lifecycle", () => {
    it("should start with not_started status", () => {
      expect(tracker.getStatus()).toBe("not_started");
      expect(tracker.getPercentage()).toBe(0);
    });

    it("should start task", () => {
      tracker.start("Starting task");

      expect(tracker.getStatus()).toBe("in_progress");
      const report = tracker.getReport();
      expect(report.message).toBe("Starting task");
      expect(report.timing.startedAt).toBeDefined();
    });

    it("should complete task", () => {
      tracker.start();
      tracker.complete("Task done");

      expect(tracker.getStatus()).toBe("completed");
      expect(tracker.getPercentage()).toBe(100);
      expect(tracker.isCompleted()).toBe(true);
      expect(tracker.isTerminal()).toBe(true);
    });

    it("should fail task", () => {
      tracker.start();
      tracker.fail("Something went wrong");

      expect(tracker.getStatus()).toBe("failed");
      expect(tracker.isFailed()).toBe(true);
      expect(tracker.isTerminal()).toBe(true);
    });

    it("should cancel task", () => {
      tracker.start();
      tracker.cancel("User cancelled");

      expect(tracker.getStatus()).toBe("cancelled");
      expect(tracker.isTerminal()).toBe(true);
    });

    it("should pause and resume task", () => {
      tracker.start();
      tracker.update({ percentage: 30 });

      tracker.pause("Taking a break");
      expect(tracker.getStatus()).toBe("paused");

      tracker.resume();
      expect(tracker.getStatus()).toBe("in_progress");
    });
  });

  describe("Progress Updates", () => {
    beforeEach(() => {
      tracker.start();
    });

    it("should update percentage", () => {
      tracker.update({ percentage: 25 });
      expect(tracker.getPercentage()).toBe(25);

      tracker.update({ percentage: 50 });
      expect(tracker.getPercentage()).toBe(50);

      tracker.update({ percentage: 100 });
      expect(tracker.getPercentage()).toBe(100);
    });

    it("should clamp percentage to 0-100", () => {
      tracker.update({ percentage: -10 });
      expect(tracker.getPercentage()).toBe(0);

      tracker.update({ percentage: 150 });
      expect(tracker.getPercentage()).toBe(100);
    });

    it("should track step progress", () => {
      tracker.update({
        percentage: 50,
        currentStep: "Processing step 2",
        totalSteps: 4,
        completedSteps: 2,
      });

      const report = tracker.getReport();
      expect(report.currentStep).toBe("Processing step 2");
      expect(report.stepProgress).toEqual({ current: 2, total: 4 });
    });

    it("should track item progress", () => {
      tracker.update({
        percentage: 30,
        itemsProcessed: 30,
        totalItems: 100,
      });

      const report = tracker.getReport();
      expect(report.itemProgress).toEqual({ processed: 30, total: 100 });
    });

    it("should track resources", () => {
      tracker.update({
        percentage: 50,
        resources: {
          tokensUsed: 5000,
          apiCalls: 10,
        },
      });

      const report = tracker.getReport();
      expect(report.resources.tokensUsed).toBe(5000);
      expect(report.resources.apiCalls).toBe(10);

      // 累积更新
      tracker.update({
        percentage: 75,
        resources: {
          tokensUsed: 8000,
          cpuPercent: 45,
        },
      });

      const updatedReport = tracker.getReport();
      expect(updatedReport.resources.tokensUsed).toBe(8000);
      expect(updatedReport.resources.cpuPercent).toBe(45);
      expect(updatedReport.resources.apiCalls).toBe(10);
    });

    it("should not update when not in progress", () => {
      tracker.complete();
      tracker.update({ percentage: 50 });

      expect(tracker.getPercentage()).toBe(100);
    });
  });

  describe("Milestones", () => {
    beforeEach(() => {
      tracker.start();
    });

    it("should set milestones", () => {
      tracker.setMilestones([
        { name: "Phase 1", targetPercentage: 25 },
        { name: "Phase 2", targetPercentage: 50 },
        { name: "Phase 3", targetPercentage: 75 },
      ]);

      const report = tracker.getReport();
      expect(report.milestones).toHaveLength(3);
      expect(report.milestones[0].name).toBe("Phase 1");
      expect(report.milestones[0].targetPercentage).toBe(25);
    });

    it("should complete milestone manually", () => {
      tracker.setMilestones([
        { name: "Phase 1", targetPercentage: 25 },
      ]);

      const result = tracker.completeMilestone("milestone-1");
      expect(result).toBe(true);

      const report = tracker.getReport();
      expect(report.milestones[0].status).toBe("completed");
      expect(report.milestones[0].completedAt).toBeDefined();
    });

    it("should return false for non-existent milestone", () => {
      const result = tracker.completeMilestone("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("Events", () => {
    it("should emit started event", () => {
      const handler = vi.fn();
      tracker.on("started", handler);

      tracker.start("Starting");

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0].message).toBe("Starting");
    });

    it("should emit progress_update event", () => {
      const handler = vi.fn();
      tracker.on("progress_update", handler);

      tracker.start();
      tracker.update({ percentage: 50, message: "Halfway" });

      expect(handler).toHaveBeenCalled();
      const event = handler.mock.calls[0][0];
      expect(event.update.percentage).toBe(50);
      expect(event.update.message).toBe("Halfway");
    });

    it("should emit completed event", () => {
      const handler = vi.fn();
      tracker.on("completed", handler);

      tracker.start();
      tracker.complete("Done");

      expect(handler).toHaveBeenCalled();
    });

    it("should emit failed event", () => {
      const handler = vi.fn();
      tracker.on("failed", handler);

      tracker.start();
      tracker.fail("Error");

      expect(handler).toHaveBeenCalled();
    });

    it("should emit paused and resumed events", () => {
      const pauseHandler = vi.fn();
      const resumeHandler = vi.fn();

      tracker.on("paused", pauseHandler);
      tracker.on("resumed", resumeHandler);

      tracker.start();
      tracker.pause();
      tracker.resume();

      expect(pauseHandler).toHaveBeenCalled();
      expect(resumeHandler).toHaveBeenCalled();
    });

    it("should emit generic progress event for all events", () => {
      const handler = vi.fn();
      tracker.on("progress", handler);

      tracker.start();
      tracker.update({ percentage: 25 });
      tracker.complete();

      expect(handler).toHaveBeenCalledTimes(3);
    });
  });

  describe("History", () => {
    it("should record history entries", () => {
      tracker.start();
      tracker.update({ percentage: 25 });
      tracker.update({ percentage: 50 });
      tracker.complete();

      const history = tracker.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(4);
      expect(history[0].status).toBe("in_progress");
      expect(history[history.length - 1].status).toBe("completed");
    });

    it("should limit history entries", () => {
      const limitedTracker = createProgressTracker("limited", {
        maxHistoryEntries: 5,
      });

      limitedTracker.start();
      for (let i = 0; i < 10; i++) {
        limitedTracker.update({ percentage: i * 10 });
      }

      const history = limitedTracker.getHistory();
      expect(history.length).toBeLessThanOrEqual(5);
    });
  });

  describe("ETA Calculation", () => {
    it("should calculate ETA based on progress rate", async () => {
      tracker.start();

      // 模拟进度
      tracker.update({ percentage: 10 });
      await new Promise((r) => setTimeout(r, 100));
      tracker.update({ percentage: 20 });

      const report = tracker.getReport();
      // ETA 应该被计算（虽然可能不精确）
      expect(report.timing.etaMs).toBeDefined();
    });

    it("should not calculate ETA when disabled", () => {
      const noEtaTracker = createProgressTracker("no-eta", {
        autoCalculateEta: false,
      });

      noEtaTracker.start();
      noEtaTracker.update({ percentage: 50 });

      const report = noEtaTracker.getReport();
      expect(report.timing.etaMs).toBeUndefined();
    });
  });

  describe("Report Generation", () => {
    it("should generate complete report", () => {
      tracker.start();
      tracker.setMilestones([{ name: "Halfway", targetPercentage: 50 }]);
      tracker.update({
        percentage: 50,
        message: "Processing",
        currentStep: "Step 2",
        totalSteps: 4,
        completedSteps: 2,
        resources: {
          tokensUsed: 1000,
          apiCalls: 5,
        },
      });

      const report = tracker.getReport();

      expect(report.taskId).toBe("task-1");
      expect(report.status).toBe("in_progress");
      expect(report.percentage).toBe(50);
      expect(report.message).toBe("Processing");
      expect(report.currentStep).toBe("Step 2");
      expect(report.stepProgress).toEqual({ current: 2, total: 4 });
      expect(report.milestones).toHaveLength(1);
      expect(report.resources.tokensUsed).toBe(1000);
      expect(report.timing.elapsedMs).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("ProgressAggregator", () => {
  let aggregator: ProgressAggregator;

  beforeEach(() => {
    aggregator = createProgressAggregator();
  });

  describe("Tracker Management", () => {
    it("should create and track trackers", () => {
      const tracker = aggregator.createTracker("task-1");

      expect(tracker).toBeDefined();
      expect(aggregator.getTracker("task-1")).toBe(tracker);
    });

    it("should return existing tracker for same ID", () => {
      const tracker1 = aggregator.createTracker("task-1");
      const tracker2 = aggregator.createTracker("task-1");

      expect(tracker1).toBe(tracker2);
    });

    it("should remove tracker", () => {
      aggregator.createTracker("task-1");
      const result = aggregator.removeTracker("task-1");

      expect(result).toBe(true);
      expect(aggregator.getTracker("task-1")).toBeUndefined();
    });

    it("should return false when removing non-existent tracker", () => {
      const result = aggregator.removeTracker("non-existent");
      expect(result).toBe(false);
    });

    it("should get all trackers", () => {
      aggregator.createTracker("task-1");
      aggregator.createTracker("task-2");

      const trackers = aggregator.getAllTrackers();
      expect(trackers).toHaveLength(2);
    });
  });

  describe("Report Aggregation", () => {
    beforeEach(() => {
      // 创建并启动多个任务
      const t1 = aggregator.createTracker("task-1");
      t1.start();
      t1.update({ percentage: 25 });

      const t2 = aggregator.createTracker("task-2");
      t2.start();
      t2.update({ percentage: 50 });

      const t3 = aggregator.createTracker("task-3");
      t3.start();
      t3.complete();
    });

    it("should get all reports", () => {
      const reports = aggregator.getAllReports();
      expect(reports).toHaveLength(3);
    });

    it("should get single task report", () => {
      const report = aggregator.getTaskReport("task-1");
      expect(report?.taskId).toBe("task-1");
      expect(report?.percentage).toBe(25);
    });

    it("should get aggregated report", () => {
      const aggregated = aggregator.getAggregatedReport();

      expect(aggregated.totalTasks).toBe(3);
      expect(aggregated.byStatus.in_progress).toBe(2);
      expect(aggregated.byStatus.completed).toBe(1);
      expect(aggregated.averageCompletion).toBeCloseTo(58.33, 1); // (25 + 50 + 100) / 3
    });

    it("should filter by status", () => {
      const aggregated = aggregator.getAggregatedReport(undefined, {
        status: "in_progress",
      });

      expect(aggregated.totalTasks).toBe(2);
    });

    it("should get in-progress tasks", () => {
      const inProgress = aggregator.getInProgressTasks();
      expect(inProgress).toHaveLength(2);
    });

    it("should get recently completed tasks", () => {
      const completed = aggregator.getRecentlyCompleted();
      expect(completed).toHaveLength(1);
      expect(completed[0].taskId).toBe("task-3");
    });
  });

  describe("Event Forwarding", () => {
    it("should forward tracker events", () => {
      const handler = vi.fn();
      aggregator.on("task_progress", handler);

      const tracker = aggregator.createTracker("task-1");
      tracker.start();
      tracker.update({ percentage: 50 });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("Cleanup", () => {
    it("should cleanup completed trackers", () => {
      const t1 = aggregator.createTracker("task-1");
      t1.start();
      t1.complete();

      const t2 = aggregator.createTracker("task-2");
      t2.start();
      t2.update({ percentage: 50 });

      const cleaned = aggregator.cleanupCompleted();

      expect(cleaned).toBe(1);
      expect(aggregator.getAllTrackers()).toHaveLength(1);
    });

    it("should clear all trackers", () => {
      aggregator.createTracker("task-1");
      aggregator.createTracker("task-2");

      aggregator.clear();

      expect(aggregator.getAllTrackers()).toHaveLength(0);
    });
  });

  describe("Global History", () => {
    it("should record global history", () => {
      aggregator.recordGlobalHistory({
        taskId: "task-1",
        timestamp: new Date(),
        percentage: 50,
        status: "in_progress",
        metadata: {},
      });

      const history = aggregator.getGlobalHistory();
      expect(history).toHaveLength(1);
    });

    it("should filter global history", () => {
      aggregator.recordGlobalHistory({
        taskId: "task-1",
        timestamp: new Date(Date.now() - 2000),
        percentage: 50,
        status: "in_progress",
        metadata: {},
      });

      aggregator.recordGlobalHistory({
        taskId: "task-2",
        timestamp: new Date(),
        percentage: 100,
        status: "completed",
        metadata: {},
      });

      const filtered = aggregator.getGlobalHistory({ taskId: "task-1" });
      expect(filtered).toHaveLength(1);

      const completed = aggregator.getGlobalHistory({ status: "completed" });
      expect(completed).toHaveLength(1);
    });
  });
});

describe("Factory Functions", () => {
  it("should create progress tracker", () => {
    const tracker = createProgressTracker("test");
    expect(tracker).toBeInstanceOf(ProgressTracker);
  });

  it("should create progress aggregator", () => {
    const aggregator = createProgressAggregator();
    expect(aggregator).toBeInstanceOf(ProgressAggregator);
  });
});

describe("Format Functions", () => {
  describe("formatProgressStatus", () => {
    it("should format status in Chinese", () => {
      expect(formatProgressStatus("not_started")).toBe("未开始");
      expect(formatProgressStatus("in_progress")).toBe("进行中");
      expect(formatProgressStatus("paused")).toBe("已暂停");
      expect(formatProgressStatus("completed")).toBe("已完成");
      expect(formatProgressStatus("failed")).toBe("已失败");
      expect(formatProgressStatus("cancelled")).toBe("已取消");
    });
  });

  describe("formatDuration", () => {
    it("should format milliseconds", () => {
      expect(formatDuration(500)).toBe("500ms");
    });

    it("should format seconds", () => {
      expect(formatDuration(5000)).toBe("5.0s");
    });

    it("should format minutes and seconds", () => {
      const result = formatDuration(125000); // 2m 5s
      expect(result).toBe("2m 5s");
    });

    it("should format hours and minutes", () => {
      const result = formatDuration(3725000); // 1h 2m
      expect(result).toBe("1h 2m");
    });
  });

  describe("formatProgressBar", () => {
    it("should format 0%", () => {
      const bar = formatProgressBar(0, 10);
      expect(bar).toBe("░░░░░░░░░░");
    });

    it("should format 50%", () => {
      const bar = formatProgressBar(50, 10);
      expect(bar).toBe("█████░░░░░");
    });

    it("should format 100%", () => {
      const bar = formatProgressBar(100, 10);
      expect(bar).toBe("██████████");
    });

    it("should use custom characters", () => {
      const bar = formatProgressBar(50, 4, "=", "-");
      expect(bar).toBe("==--");
    });
  });

  describe("formatProgressReport", () => {
    it("should format complete report", () => {
      const report: ProgressReport = {
        taskId: "task-1",
        status: "in_progress",
        percentage: 50,
        message: "Processing",
        currentStep: "Step 2",
        stepProgress: { current: 2, total: 4 },
        timing: {
          startedAt: new Date(),
          updatedAt: new Date(),
          elapsedMs: 30000,
          etaMs: 30000,
        },
        milestones: [],
        resources: {
          tokensUsed: 5000,
          apiCalls: 10,
        },
        metadata: {},
      };

      const formatted = formatProgressReport(report);

      expect(formatted).toContain("Task: task-1");
      expect(formatted).toContain("进行中");
      expect(formatted).toContain("50.0%");
      expect(formatted).toContain("Processing");
      expect(formatted).toContain("Step 2");
      expect(formatted).toContain("Steps: 2/4");
      expect(formatted).toContain("30.0s");
      expect(formatted).toContain("5,000");
      expect(formatted).toContain("API Calls: 10");
    });
  });
});
