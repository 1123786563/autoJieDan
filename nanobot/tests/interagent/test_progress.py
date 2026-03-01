"""
测试进度追踪模块
"""

import pytest
import time
from datetime import datetime

from nanobot.interagent.progress import (
    Milestone,
    MilestoneStatus,
    ProgressTracker,
    ProgressSnapshot,
    format_progress,
    create_progress_bar,
    estimate_completion_time,
)


class TestMilestone:
    """测试 Milestone"""

    def test_to_dict(self):
        """测试转换为字典"""
        milestone = Milestone(
            id="m1",
            name="Test Milestone",
            weight=2.0,
            status=MilestoneStatus.COMPLETED,
        )

        data = milestone.to_dict()

        assert data["id"] == "m1"
        assert data["name"] == "Test Milestone"
        assert data["weight"] == 2.0
        assert data["status"] == "completed"

    def test_default_values(self):
        """测试默认值"""
        milestone = Milestone(id="m1", name="Test")

        assert milestone.weight == 1.0
        assert milestone.status == MilestoneStatus.PENDING
        assert milestone.started_at is None
        assert milestone.completed_at is None


class TestProgressSnapshot:
    """测试 ProgressSnapshot"""

    def test_to_dict(self):
        """测试转换为字典"""
        snapshot = ProgressSnapshot(
            percentage=50.0,
            current_step="Processing",
            completed_milestones=2,
            total_milestones=5,
            elapsed_seconds=60.0,
            estimated_remaining_seconds=60.0,
        )

        data = snapshot.to_dict()

        assert data["percentage"] == 50.0
        assert data["currentStep"] == "Processing"
        assert data["completedMilestones"] == 2
        assert data["totalMilestones"] == 5


class TestProgressTracker:
    """测试 ProgressTracker"""

    def test_initial_state(self):
        """测试初始状态"""
        tracker = ProgressTracker("task-1", total_steps=100)

        assert tracker.task_id == "task-1"
        assert tracker.total_steps == 100
        assert tracker.current_step == 0
        assert tracker.started_at is None

    def test_start(self):
        """测试开始"""
        tracker = ProgressTracker("task-1")

        tracker.start("Starting task")

        assert tracker.started_at is not None
        assert tracker.current_message == "Starting task"
        assert len(tracker.get_step_history()) > 0

    def test_complete(self):
        """测试完成"""
        tracker = ProgressTracker("task-1")
        tracker.start()

        tracker.complete("Done")

        assert tracker.current_step == tracker.total_steps
        assert tracker.completed_at is not None

    def test_set_progress(self):
        """测试设置进度"""
        tracker = ProgressTracker("task-1", total_steps=100)
        tracker.start()

        tracker.set_progress(50, "Halfway")

        assert tracker.current_step == 50
        assert tracker.current_message == "Halfway"
        assert tracker.get_percentage() == 50.0

    def test_advance(self):
        """测试前进"""
        tracker = ProgressTracker("task-1", total_steps=100)
        tracker.start()

        tracker.advance(10, "Step 10")
        assert tracker.current_step == 10

        tracker.advance(5)
        assert tracker.current_step == 15

    def test_set_percentage(self):
        """测试设置百分比"""
        tracker = ProgressTracker("task-1", total_steps=100)
        tracker.start()

        tracker.set_percentage(75.0, "75% done")

        assert tracker.get_percentage() == 75.0

    def test_progress_clamping(self):
        """测试进度限制"""
        tracker = ProgressTracker("task-1", total_steps=100)
        tracker.start()

        tracker.set_progress(150)
        assert tracker.current_step == 100

        tracker.set_progress(-10)
        assert tracker.current_step == 0

    def test_milestone_add(self):
        """测试添加里程碑"""
        tracker = ProgressTracker("task-1")
        tracker.add_milestone("m1", "First Milestone", weight=2.0)

        assert "m1" in tracker.milestones
        assert tracker.milestones["m1"].weight == 2.0

    def test_milestone_start(self):
        """测试开始里程碑"""
        tracker = ProgressTracker("task-1")
        tracker.add_milestone("m1", "First")
        tracker.start()

        milestone = tracker.start_milestone("m1")

        assert milestone is not None
        assert milestone.status == MilestoneStatus.IN_PROGRESS
        assert milestone.started_at is not None

    def test_milestone_complete(self):
        """测试完成里程碑"""
        tracker = ProgressTracker("task-1")
        tracker.add_milestone("m1", "First")
        tracker.start()
        tracker.start_milestone("m1")

        milestone = tracker.complete_milestone("m1")

        assert milestone is not None
        assert milestone.status == MilestoneStatus.COMPLETED
        assert milestone.completed_at is not None

    def test_milestone_skip(self):
        """测试跳过里程碑"""
        tracker = ProgressTracker("task-1")
        tracker.add_milestone("m1", "First")
        tracker.start()

        milestone = tracker.skip_milestone("m1", "Not needed")

        assert milestone is not None
        assert milestone.status == MilestoneStatus.SKIPPED

    def test_milestone_fail(self):
        """测试失败里程碑"""
        tracker = ProgressTracker("task-1")
        tracker.add_milestone("m1", "First")
        tracker.start()
        tracker.start_milestone("m1")

        milestone = tracker.fail_milestone("m1", "Error occurred")

        assert milestone is not None
        assert milestone.status == MilestoneStatus.FAILED
        assert milestone.error == "Error occurred"

    def test_get_snapshot(self):
        """测试获取快照"""
        tracker = ProgressTracker("task-1", total_steps=100)
        tracker.start()
        tracker.set_progress(50)

        snapshot = tracker.get_snapshot()

        assert snapshot.percentage == 50.0
        assert snapshot.elapsed_seconds >= 0

    def test_get_milestone_progress(self):
        """测试获取里程碑进度"""
        tracker = ProgressTracker("task-1")
        tracker.add_milestone("m1", "First", weight=1.0)
        tracker.add_milestone("m2", "Second", weight=1.0)
        tracker.start()

        tracker.start_milestone("m1")
        tracker.complete_milestone("m1")

        progress = tracker.get_milestone_progress()

        assert progress["completed"] == 1
        assert progress["total"] == 2
        assert progress["percentage"] == 50.0

    def test_get_elapsed_seconds(self):
        """测试获取已用时间"""
        tracker = ProgressTracker("task-1")
        tracker.start()

        time.sleep(0.1)

        elapsed = tracker.get_elapsed_seconds()
        assert elapsed >= 0.1

    def test_get_estimated_remaining(self):
        """测试估算剩余时间"""
        tracker = ProgressTracker("task-1", total_steps=100)
        tracker.start()
        tracker.set_progress(50)

        remaining = tracker.get_estimated_remaining_seconds()
        # 剩余时间应该存在
        assert remaining is not None

    def test_on_update_callback(self):
        """测试更新回调"""
        snapshots = []

        def on_update(snapshot):
            snapshots.append(snapshot)

        tracker = ProgressTracker("task-1", on_update=on_update)
        tracker.start()
        tracker.set_progress(50)

        assert len(snapshots) > 0

    def test_to_dict(self):
        """测试转换为字典"""
        tracker = ProgressTracker("task-1", total_steps=100)
        tracker.start()
        tracker.set_progress(50)

        data = tracker.to_dict()

        assert data["taskId"] == "task-1"
        assert data["totalSteps"] == 100
        assert data["currentStep"] == 50
        assert data["percentage"] == 50.0


class TestHelperFunctions:
    """测试辅助函数"""

    def test_format_progress(self):
        """测试格式化进度"""
        assert format_progress(50.0) == "50.0%"
        assert format_progress(33.333) == "33.3%"

    def test_create_progress_bar(self):
        """测试创建进度条"""
        bar = create_progress_bar(50, width=10)
        assert bar == "[=====     ]"

        bar = create_progress_bar(100, width=10)
        assert bar == "[==========]"

        bar = create_progress_bar(0, width=10)
        assert bar == "[          ]"

    def test_estimate_completion_time(self):
        """测试估算完成时间"""
        # 50% 完成，已用 60 秒
        remaining = estimate_completion_time(60.0, 50.0)

        # 剩余 50% 应该约 60 秒
        assert remaining is not None
        assert 55 <= remaining <= 65

    def test_estimate_completion_time_zero_progress(self):
        """测试零进度估算"""
        remaining = estimate_completion_time(60.0, 0.0)
        assert remaining is None

    def test_estimate_completion_time_completed(self):
        """测试已完成估算"""
        remaining = estimate_completion_time(60.0, 100.0)
        assert remaining == 0
