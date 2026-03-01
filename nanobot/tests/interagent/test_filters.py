"""
测试任务过滤逻辑
"""

import pytest
from datetime import datetime

from nanobot.interagent.filters import (
    TaskStatus,
    TaskPriority,
    TaskType,
    TaskFilter,
    Task,
    TaskMatcher,
    matches_filter,
    filter_tasks,
    sort_by_priority,
    create_pending_filter,
    create_high_priority_filter,
    create_for_nanobot_filter,
)


def create_test_task(
    task_id: str = "task-1",
    status: TaskStatus = TaskStatus.PENDING,
    priority: TaskPriority = TaskPriority.NORMAL,
    task_type: TaskType = TaskType.EXECUTION,
    target_did: str = "did:anp:nanobot:worker1",
    tags: list = None,
) -> Task:
    """创建测试任务"""
    now = datetime.now()
    return Task(
        id=task_id,
        type=task_type,
        status=status,
        priority=priority,
        source_did="did:anp:automaton:main",
        target_did=target_did,
        input={"command": "test"},
        created_at=now,
        updated_at=now,
        metadata={"tags": tags or []},
    )


class TestTaskFilter:
    """测试 TaskFilter"""

    def test_to_dict_with_all_fields(self):
        """测试转换为字典"""
        task_filter = TaskFilter(
            status=[TaskStatus.PENDING, TaskStatus.QUEUED],
            priority=[TaskPriority.HIGH],
            task_type=[TaskType.EXECUTION],
            target_did="did:anp:nanobot:worker1",
            limit=10,
        )

        result = task_filter.to_dict()

        assert "status" in result
        assert "pending" in result["status"]
        assert "priority" in result
        assert "high" in result["priority"]
        assert result["targetDid"] == "did:anp:nanobot:worker1"
        assert result["limit"] == 10

    def test_to_dict_with_empty_filter(self):
        """测试空过滤器"""
        task_filter = TaskFilter()
        result = task_filter.to_dict()
        assert result == {}

    def test_from_dict(self):
        """测试从字典创建"""
        data = {
            "status": ["pending", "queued"],
            "priority": ["critical"],
            "targetDid": "did:anp:nanobot:test",
        }

        task_filter = TaskFilter.from_dict(data)

        assert len(task_filter.status) == 2
        assert TaskStatus.PENDING in task_filter.status
        assert len(task_filter.priority) == 1
        assert TaskPriority.CRITICAL in task_filter.priority
        assert task_filter.target_did == "did:anp:nanobot:test"


class TestTask:
    """测试 Task"""

    def test_from_dict(self):
        """测试从字典创建任务"""
        data = {
            "id": "task-123",
            "type": "execution",
            "status": "running",
            "priority": "high",
            "sourceDid": "did:anp:automaton:main",
            "targetDid": "did:anp:nanobot:worker1",
            "input": {"command": "test"},
            "createdAt": "2024-01-01T00:00:00Z",
            "updatedAt": "2024-01-01T00:00:00Z",
            "retryCount": 1,
            "maxRetries": 3,
        }

        task = Task.from_dict(data)

        assert task.id == "task-123"
        assert task.type == TaskType.EXECUTION
        assert task.status == TaskStatus.RUNNING
        assert task.priority == TaskPriority.HIGH
        assert task.retry_count == 1


class TestMatchesFilter:
    """测试 matches_filter"""

    def test_matches_status(self):
        """测试状态匹配"""
        task = create_test_task(status=TaskStatus.PENDING)
        task_filter = TaskFilter(status=[TaskStatus.PENDING])

        assert matches_filter(task, task_filter) is True

        task_filter = TaskFilter(status=[TaskStatus.RUNNING])
        assert matches_filter(task, task_filter) is False

    def test_matches_priority(self):
        """测试优先级匹配"""
        task = create_test_task(priority=TaskPriority.HIGH)
        task_filter = TaskFilter(priority=[TaskPriority.HIGH, TaskPriority.CRITICAL])

        assert matches_filter(task, task_filter) is True

    def test_matches_target_did(self):
        """测试目标 DID 匹配"""
        task = create_test_task(target_did="did:anp:nanobot:worker1")
        task_filter = TaskFilter(target_did="did:anp:nanobot:worker1")

        assert matches_filter(task, task_filter) is True

        task_filter = TaskFilter(target_did="did:anp:nanobot:worker2")
        assert matches_filter(task, task_filter) is False

    def test_matches_tags(self):
        """测试标签匹配"""
        task = create_test_task(tags=["urgent", "backend"])
        task_filter = TaskFilter(tags=["urgent"])

        assert matches_filter(task, task_filter) is True

        task_filter = TaskFilter(tags=["frontend"])
        assert matches_filter(task, task_filter) is False

    def test_matches_combined_filters(self):
        """测试组合过滤"""
        task = create_test_task(
            status=TaskStatus.PENDING,
            priority=TaskPriority.HIGH,
            task_type=TaskType.EXECUTION,
        )

        task_filter = TaskFilter(
            status=[TaskStatus.PENDING],
            priority=[TaskPriority.HIGH],
            task_type=[TaskType.EXECUTION],
        )

        assert matches_filter(task, task_filter) is True


class TestFilterTasks:
    """测试 filter_tasks"""

    def test_filter_by_status(self):
        """测试按状态过滤"""
        tasks = [
            create_test_task("1", status=TaskStatus.PENDING),
            create_test_task("2", status=TaskStatus.RUNNING),
            create_test_task("3", status=TaskStatus.COMPLETED),
        ]

        task_filter = TaskFilter(status=[TaskStatus.PENDING])
        result = filter_tasks(tasks, task_filter)

        assert len(result) == 1
        assert result[0].id == "1"

    def test_filter_with_limit(self):
        """测试限制数量"""
        tasks = [
            create_test_task("1"),
            create_test_task("2"),
            create_test_task("3"),
        ]

        task_filter = TaskFilter(limit=2)
        result = filter_tasks(tasks, task_filter)

        assert len(result) == 2

    def test_filter_with_offset(self):
        """测试偏移"""
        tasks = [
            create_test_task("1"),
            create_test_task("2"),
            create_test_task("3"),
        ]

        task_filter = TaskFilter(offset=1)
        result = filter_tasks(tasks, task_filter)

        assert len(result) == 2
        assert result[0].id == "2"


class TestSortByPriority:
    """测试 sort_by_priority"""

    def test_sort_order(self):
        """测试排序顺序"""
        tasks = [
            create_test_task("1", priority=TaskPriority.LOW),
            create_test_task("2", priority=TaskPriority.CRITICAL),
            create_test_task("3", priority=TaskPriority.NORMAL),
            create_test_task("4", priority=TaskPriority.HIGH),
        ]

        sorted_tasks = sort_by_priority(tasks)

        assert sorted_tasks[0].priority == TaskPriority.CRITICAL
        assert sorted_tasks[1].priority == TaskPriority.HIGH
        assert sorted_tasks[2].priority == TaskPriority.NORMAL
        assert sorted_tasks[3].priority == TaskPriority.LOW


class TestTaskMatcher:
    """测试 TaskMatcher"""

    def test_with_status(self):
        """测试状态匹配"""
        task = create_test_task(status=TaskStatus.PENDING)

        matcher = TaskMatcher().with_status(TaskStatus.PENDING)
        assert matcher.matches(task) is True

        matcher = TaskMatcher().with_status(TaskStatus.RUNNING)
        assert matcher.matches(task) is False

    def test_with_priority(self):
        """测试优先级匹配"""
        task = create_test_task(priority=TaskPriority.HIGH)

        matcher = TaskMatcher().with_priority(TaskPriority.HIGH, TaskPriority.CRITICAL)
        assert matcher.matches(task) is True

    def test_combined_rules(self):
        """测试组合规则"""
        task = create_test_task(
            status=TaskStatus.PENDING,
            priority=TaskPriority.HIGH,
        )

        matcher = (
            TaskMatcher()
            .with_status(TaskStatus.PENDING)
            .with_priority(TaskPriority.HIGH, TaskPriority.CRITICAL)
        )

        assert matcher.matches(task) is True

    def test_filter(self):
        """测试过滤"""
        tasks = [
            create_test_task("1", status=TaskStatus.PENDING, priority=TaskPriority.HIGH),
            create_test_task("2", status=TaskStatus.RUNNING),
            create_test_task("3", status=TaskStatus.PENDING, priority=TaskPriority.LOW),
        ]

        matcher = (
            TaskMatcher()
            .with_status(TaskStatus.PENDING)
            .with_priority(TaskPriority.HIGH, TaskPriority.CRITICAL)
        )

        result = matcher.filter(tasks)

        assert len(result) == 1
        assert result[0].id == "1"


class TestPredefinedFilters:
    """测试预定义过滤器"""

    def test_create_pending_filter(self):
        """测试待处理过滤器"""
        task_filter = create_pending_filter()

        assert TaskStatus.PENDING in task_filter.status
        assert TaskStatus.QUEUED in task_filter.status

    def test_create_high_priority_filter(self):
        """测试高优先级过滤器"""
        task_filter = create_high_priority_filter()

        assert TaskPriority.CRITICAL in task_filter.priority
        assert TaskPriority.HIGH in task_filter.priority

    def test_create_for_nanobot_filter(self):
        """测试 Nanobot 专用过滤器"""
        task_filter = create_for_nanobot_filter("did:anp:nanobot:test")

        assert task_filter.target_did == "did:anp:nanobot:test"
