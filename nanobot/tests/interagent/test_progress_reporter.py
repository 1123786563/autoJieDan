"""
测试进度报告系统
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import Mock

from nanobot.interagent.progress_reporter import (
    ProgressStatus,
    MilestoneStatus,
    ProgressEventType,
    ResourceUsage,
    ProgressMilestone,
    ProgressUpdate,
    ProgressEvent,
    ProgressHistoryEntry,
    ProgressReport,
    ProgressTrackerConfig,
    ProgressTracker,
    ProgressAggregator,
    create_progress_tracker,
    create_progress_aggregator,
    format_progress_status,
    format_duration,
    format_progress_bar,
    format_progress_report,
)


class TestEnums:
    """测试枚举类型"""

    def test_progress_status_values(self):
        """测试进度状态值"""
        assert ProgressStatus.NOT_STARTED.value == "not_started"
        assert ProgressStatus.IN_PROGRESS.value == "in_progress"
        assert ProgressStatus.PAUSED.value == "paused"
        assert ProgressStatus.COMPLETED.value == "completed"
        assert ProgressStatus.FAILED.value == "failed"
        assert ProgressStatus.CANCELLED.value == "cancelled"

    def test_milestone_status_values(self):
        """测试里程碑状态值"""
        assert MilestoneStatus.PENDING.value == "pending"
        assert MilestoneStatus.IN_PROGRESS.value == "in_progress"
        assert MilestoneStatus.COMPLETED.value == "completed"
        assert MilestoneStatus.SKIPPED.value == "skipped"

    def test_progress_event_type_values(self):
        """测试事件类型值"""
        assert ProgressEventType.STARTED.value == "started"
        assert ProgressEventType.PROGRESS_UPDATE.value == "progress_update"
        assert ProgressEventType.MILESTONE_REACHED.value == "milestone_reached"
        assert ProgressEventType.COMPLETED.value == "completed"
        assert ProgressEventType.FAILED.value == "failed"


class TestResourceUsage:
    """测试资源使用"""

    def test_to_dict(self):
        """测试转换为字典"""
        usage = ResourceUsage(
            cpu_percent=45.5,
            memory_mb=1024.0,
            tokens_used=5000,
            api_calls=10,
        )

        data = usage.to_dict()

        assert data["cpuPercent"] == 45.5
        assert data["memoryMb"] == 1024.0
        assert data["tokensUsed"] == 5000
        assert data["apiCalls"] == 10

    def test_to_dict_with_custom(self):
        """测试带自定义字段的转换"""
        usage = ResourceUsage(
            tokens_used=1000,
            custom={"cache_hits": 50, "cache_misses": 10},
        )

        data = usage.to_dict()

        assert data["tokensUsed"] == 1000
        assert data["custom"]["cache_hits"] == 50

    def test_from_dict(self):
        """测试从字典创建"""
        data = {
            "cpuPercent": 30.0,
            "memoryMb": 512.0,
            "tokensUsed": 2000,
        }

        usage = ResourceUsage.from_dict(data)

        assert usage.cpu_percent == 30.0
        assert usage.memory_mb == 512.0
        assert usage.tokens_used == 2000


class TestProgressMilestone:
    """测试里程碑"""

    def test_to_dict(self):
        """测试转换为字典"""
        milestone = ProgressMilestone(
            id="milestone-1",
            name="Phase 1",
            target_percentage=25.0,
            description="First phase",
            status=MilestoneStatus.COMPLETED,
        )

        data = milestone.to_dict()

        assert data["id"] == "milestone-1"
        assert data["name"] == "Phase 1"
        assert data["targetPercentage"] == 25.0
        assert data["status"] == "completed"


class TestProgressTracker:
    """测试进度追踪器"""

    @pytest.fixture
    def tracker(self):
        return create_progress_tracker("task-1")

    def test_initial_state(self, tracker):
        """测试初始状态"""
        assert tracker.get_status() == ProgressStatus.NOT_STARTED
        assert tracker.get_percentage() == 0

    def test_start_task(self, tracker):
        """测试开始任务"""
        tracker.start("Starting")

        assert tracker.get_status() == ProgressStatus.IN_PROGRESS
        report = tracker.get_report()
        assert report.message == "Starting"
        assert report.started_at is not None

    def test_update_progress(self, tracker):
        """测试更新进度"""
        tracker.start()
        tracker.update(ProgressUpdate(percentage=50, message="Halfway"))

        assert tracker.get_percentage() == 50
        report = tracker.get_report()
        assert report.message == "Halfway"

    def test_update_clamps_percentage(self, tracker):
        """测试更新时钳制百分比"""
        tracker.start()

        tracker.update(ProgressUpdate(percentage=-10))
        assert tracker.get_percentage() == 0

        tracker.update(ProgressUpdate(percentage=150))
        assert tracker.get_percentage() == 100

    def test_complete_task(self, tracker):
        """测试完成任务"""
        tracker.start()
        tracker.complete("Done")

        assert tracker.get_status() == ProgressStatus.COMPLETED
        assert tracker.get_percentage() == 100
        assert tracker.is_completed() is True
        assert tracker.is_terminal() is True

    def test_fail_task(self, tracker):
        """测试失败任务"""
        tracker.start()
        tracker.fail("Error occurred")

        assert tracker.get_status() == ProgressStatus.FAILED
        assert tracker.is_failed() is True
        assert tracker.is_terminal() is True

    def test_cancel_task(self, tracker):
        """测试取消任务"""
        tracker.start()
        tracker.cancel("User cancelled")

        assert tracker.get_status() == ProgressStatus.CANCELLED
        assert tracker.is_terminal() is True

    def test_pause_resume(self, tracker):
        """测试暂停恢复"""
        tracker.start()
        tracker.update(ProgressUpdate(percentage=30))

        tracker.pause("Taking a break")
        assert tracker.get_status() == ProgressStatus.PAUSED

        tracker.resume()
        assert tracker.get_status() == ProgressStatus.IN_PROGRESS

    def test_step_progress(self, tracker):
        """测试步骤进度"""
        tracker.start()
        tracker.update(ProgressUpdate(
            percentage=50,
            current_step="Step 2",
            total_steps=4,
            completed_steps=2,
        ))

        report = tracker.get_report()
        assert report.current_step == "Step 2"
        assert report.step_progress == {"current": 2, "total": 4}

    def test_item_progress(self, tracker):
        """测试项目进度"""
        tracker.start()
        tracker.update(ProgressUpdate(
            percentage=30,
            items_processed=30,
            total_items=100,
        ))

        report = tracker.get_report()
        assert report.item_progress == {"processed": 30, "total": 100}

    def test_resource_tracking(self, tracker):
        """测试资源追踪"""
        tracker.start()
        tracker.update(ProgressUpdate(
            percentage=50,
            resources=ResourceUsage(
                tokens_used=5000,
                api_calls=10,
            ),
        ))

        report = tracker.get_report()
        assert report.resources.tokens_used == 5000
        assert report.resources.api_calls == 10

    def test_milestones(self, tracker):
        """测试里程碑"""
        tracker.start()
        tracker.set_milestones([
            {"name": "Phase 1", "targetPercentage": 25},
            {"name": "Phase 2", "targetPercentage": 50},
            {"name": "Phase 3", "targetPercentage": 75},
        ])

        report = tracker.get_report()
        assert len(report.milestones) == 3
        assert report.milestones[0].name == "Phase 1"

    def test_complete_milestone(self, tracker):
        """测试手动完成里程碑"""
        tracker.start()
        tracker.set_milestones([
            {"id": "m1", "name": "Phase 1", "targetPercentage": 25},
        ])

        result = tracker.complete_milestone("m1")
        assert result is True

        report = tracker.get_report()
        assert report.milestones[0].status == MilestoneStatus.COMPLETED

    def test_no_update_when_not_in_progress(self, tracker):
        """测试非进行中状态不更新"""
        tracker.start()
        tracker.complete()
        tracker.update(ProgressUpdate(percentage=50))

        assert tracker.get_percentage() == 100

    def test_events(self, tracker):
        """测试事件发射"""
        events = []
        tracker.on(lambda e: events.append(e))

        tracker.start("Starting")
        tracker.update(ProgressUpdate(percentage=50))
        tracker.complete("Done")

        assert len(events) >= 3
        assert events[0].type == ProgressEventType.STARTED

    def test_history(self, tracker):
        """测试历史记录"""
        tracker.start()
        tracker.update(ProgressUpdate(percentage=25))
        tracker.update(ProgressUpdate(percentage=50))
        tracker.complete()

        history = tracker.get_history()
        assert len(history) >= 4

    def test_get_report(self, tracker):
        """测试获取报告"""
        tracker.start()
        tracker.update(ProgressUpdate(
            percentage=50,
            message="Processing",
            current_step="Step 2",
            total_steps=4,
            completed_steps=2,
            resources=ResourceUsage(tokens_used=1000, api_calls=5),
        ))

        report = tracker.get_report()

        assert report.task_id == "task-1"
        assert report.status == ProgressStatus.IN_PROGRESS
        assert report.percentage == 50
        assert report.message == "Processing"
        assert report.current_step == "Step 2"
        assert len(report.milestones) == 0
        assert report.resources.tokens_used == 1000


class TestProgressAggregator:
    """测试进度聚合器"""

    @pytest.fixture
    def aggregator(self):
        return create_progress_aggregator()

    def test_create_tracker(self, aggregator):
        """测试创建追踪器"""
        tracker = aggregator.create_tracker("task-1")

        assert tracker is not None
        assert aggregator.get_tracker("task-1") == tracker

    def test_create_tracker_same_id(self, aggregator):
        """测试创建相同 ID 的追踪器"""
        tracker1 = aggregator.create_tracker("task-1")
        tracker2 = aggregator.create_tracker("task-1")

        assert tracker1 == tracker2

    def test_remove_tracker(self, aggregator):
        """测试移除追踪器"""
        aggregator.create_tracker("task-1")
        result = aggregator.remove_tracker("task-1")

        assert result is True
        assert aggregator.get_tracker("task-1") is None

    def test_get_all_trackers(self, aggregator):
        """测试获取所有追踪器"""
        aggregator.create_tracker("task-1")
        aggregator.create_tracker("task-2")

        trackers = aggregator.get_all_trackers()
        assert len(trackers) == 2

    def test_get_task_report(self, aggregator):
        """测试获取单个任务报告"""
        tracker = aggregator.create_tracker("task-1")
        tracker.start()
        tracker.update(ProgressUpdate(percentage=50))

        report = aggregator.get_task_report("task-1")
        assert report is not None
        assert report.percentage == 50

    def test_get_all_reports(self, aggregator):
        """测试获取所有报告"""
        t1 = aggregator.create_tracker("task-1")
        t1.start()
        t1.update(ProgressUpdate(percentage=25))

        t2 = aggregator.create_tracker("task-2")
        t2.start()
        t2.update(ProgressUpdate(percentage=50))

        reports = aggregator.get_all_reports()
        assert len(reports) == 2

    def test_get_aggregated_report(self, aggregator):
        """测试获取聚合报告"""
        t1 = aggregator.create_tracker("task-1")
        t1.start()
        t1.update(ProgressUpdate(percentage=25))

        t2 = aggregator.create_tracker("task-2")
        t2.start()
        t2.update(ProgressUpdate(percentage=50))

        t3 = aggregator.create_tracker("task-3")
        t3.start()
        t3.complete()

        aggregated = aggregator.get_aggregated_report()

        assert aggregated["totalTasks"] == 3
        assert aggregated["byStatus"]["in_progress"] == 2
        assert aggregated["byStatus"]["completed"] == 1
        assert aggregated["averageCompletion"] > 0

    def test_filter_by_status(self, aggregator):
        """测试按状态过滤"""
        t1 = aggregator.create_tracker("task-1")
        t1.start()

        t2 = aggregator.create_tracker("task-2")
        t2.start()
        t2.complete()

        aggregated = aggregator.get_aggregated_report(
            filter_status=[ProgressStatus.IN_PROGRESS]
        )

        assert aggregated["totalTasks"] == 1

    def test_get_in_progress_tasks(self, aggregator):
        """测试获取进行中的任务"""
        t1 = aggregator.create_tracker("task-1")
        t1.start()

        t2 = aggregator.create_tracker("task-2")
        t2.start()
        t2.complete()

        in_progress = aggregator.get_in_progress_tasks()
        assert len(in_progress) == 1

    def test_get_recently_completed(self, aggregator):
        """测试获取最近完成的任务"""
        t1 = aggregator.create_tracker("task-1")
        t1.start()
        t1.complete()

        t2 = aggregator.create_tracker("task-2")
        t2.start()
        t2.complete()

        completed = aggregator.get_recently_completed(limit=1)
        assert len(completed) == 1

    def test_get_failed_tasks(self, aggregator):
        """测试获取失败的任务"""
        t1 = aggregator.create_tracker("task-1")
        t1.start()
        t1.fail("Error")

        t2 = aggregator.create_tracker("task-2")
        t2.start()

        failed = aggregator.get_failed_tasks()
        assert len(failed) == 1

    def test_cleanup_completed(self, aggregator):
        """测试清理已完成的追踪器"""
        t1 = aggregator.create_tracker("task-1")
        t1.start()
        t1.complete()

        t2 = aggregator.create_tracker("task-2")
        t2.start()

        cleaned = aggregator.cleanup_completed()
        assert cleaned == 1
        assert len(aggregator.get_all_trackers()) == 1

    def test_event_forwarding(self, aggregator):
        """测试事件转发"""
        events = []
        aggregator.on(lambda e: events.append(e))

        tracker = aggregator.create_tracker("task-1")
        tracker.start()

        assert len(events) >= 1


class TestFactoryFunctions:
    """测试工厂函数"""

    def test_create_progress_tracker(self):
        """测试创建进度追踪器"""
        tracker = create_progress_tracker("test")
        assert isinstance(tracker, ProgressTracker)

    def test_create_progress_aggregator(self):
        """测试创建进度聚合器"""
        aggregator = create_progress_aggregator()
        assert isinstance(aggregator, ProgressAggregator)


class TestFormatFunctions:
    """测试格式化函数"""

    def test_format_progress_status(self):
        """测试格式化状态"""
        assert format_progress_status(ProgressStatus.NOT_STARTED) == "未开始"
        assert format_progress_status(ProgressStatus.IN_PROGRESS) == "进行中"
        assert format_progress_status(ProgressStatus.PAUSED) == "已暂停"
        assert format_progress_status(ProgressStatus.COMPLETED) == "已完成"
        assert format_progress_status(ProgressStatus.FAILED) == "已失败"
        assert format_progress_status(ProgressStatus.CANCELLED) == "已取消"

    def test_format_duration(self):
        """测试格式化持续时间"""
        assert format_duration(500) == "500ms"
        assert format_duration(5000) == "5.0s"
        assert format_duration(125000) == "2m 5s"
        assert format_duration(3725000) == "1h 2m"

    def test_format_progress_bar(self):
        """测试格式化进度条"""
        bar = format_progress_bar(0, 10)
        assert bar == "░░░░░░░░░░"

        bar = format_progress_bar(50, 10)
        assert bar == "█████░░░░░"

        bar = format_progress_bar(100, 10)
        assert bar == "██████████"

    def test_format_progress_bar_custom_chars(self):
        """测试自定义字符进度条"""
        bar = format_progress_bar(50, 4, filled="=", empty="-")
        assert bar == "==--"

    def test_format_progress_report(self):
        """测试格式化完整报告"""
        report = ProgressReport(
            task_id="task-1",
            status=ProgressStatus.IN_PROGRESS,
            percentage=50,
            message="Processing",
            current_step="Step 2",
            step_progress={"current": 2, "total": 4},
            elapsed_ms=30000,
            eta_ms=30000,
            resources=ResourceUsage(tokens_used=5000, api_calls=10),
        )

        formatted = format_progress_report(report)

        assert "Task: task-1" in formatted
        assert "进行中" in formatted
        assert "50.0%" in formatted
        assert "Processing" in formatted
        assert "Step 2" in formatted
        assert "Steps: 2/4" in formatted
        assert "30.0s" in formatted
        assert "5,000" in formatted
        assert "API Calls: 10" in formatted
