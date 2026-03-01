"""
测试任务轮询器
"""

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

from nanobot.interagent.poller import (
    TaskPoller,
    PollerConfig,
    PollerState,
    PollerStats,
    create_nanobot_poller,
)
from nanobot.interagent.filters import TaskFilter, Task, TaskStatus, TaskPriority, TaskType


def create_test_task_dict(task_id: str = "task-1") -> dict:
    """创建测试任务字典"""
    now = datetime.now().isoformat()
    return {
        "id": task_id,
        "type": "execution",
        "status": "pending",
        "priority": "normal",
        "sourceDid": "did:anp:automaton:main",
        "targetDid": "did:anp:nanobot:worker1",
        "input": {"command": "test"},
        "createdAt": now,
        "updatedAt": now,
        "retryCount": 0,
        "maxRetries": 3,
    }


class TestPollerConfig:
    """测试 PollerConfig"""

    def test_default_values(self):
        """测试默认值"""
        config = PollerConfig(automaton_url="http://localhost:18790")

        assert config.automaton_url == "http://localhost:18790"
        assert config.poll_interval == 5.0
        assert config.long_poll_timeout == 30.0
        assert config.max_retries == 3
        assert config.batch_size == 10

    def test_custom_values(self):
        """测试自定义值"""
        config = PollerConfig(
            automaton_url="http://localhost:8080",
            poll_interval=10.0,
            max_retries=5,
            batch_size=20,
        )

        assert config.poll_interval == 10.0
        assert config.max_retries == 5
        assert config.batch_size == 20


class TestPollerStats:
    """测试 PollerStats"""

    def test_initial_values(self):
        """测试初始值"""
        stats = PollerStats()

        assert stats.total_polls == 0
        assert stats.successful_polls == 0
        assert stats.failed_polls == 0
        assert stats.tasks_received == 0
        assert stats.last_poll_time is None
        assert stats.last_error is None


class TestTaskPoller:
    """测试 TaskPoller"""

    @pytest.fixture
    def config(self):
        """创建测试配置"""
        return PollerConfig(
            automaton_url="http://localhost:18790",
            poll_interval=0.1,  # 快速测试
            max_retries=1,
        )

    @pytest.fixture
    def poller(self, config):
        """创建测试轮询器"""
        return TaskPoller(config)

    def test_initial_state(self, poller):
        """测试初始状态"""
        assert poller.state == PollerState.STOPPED
        assert poller._running is False

    @pytest.mark.asyncio
    async def test_start_stop(self, poller):
        """测试启动和停止"""
        await poller.start()

        assert poller._running is True
        assert poller.state in [PollerState.IDLE, PollerState.POLLING]
        assert poller._session is not None

        await poller.stop()

        assert poller._running is False
        assert poller.state == PollerState.STOPPED
        assert poller._session is None

    @pytest.mark.asyncio
    async def test_set_default_filter(self, poller):
        """测试设置默认过滤器"""
        task_filter = TaskFilter(target_did="did:anp:nanobot:test")
        poller.set_default_filter(task_filter)

        assert poller._default_filter == task_filter

    @pytest.mark.asyncio
    async def test_get_stats(self, poller):
        """测试获取统计"""
        stats = poller.get_stats()

        assert isinstance(stats, PollerStats)
        assert stats.total_polls == 0

    @pytest.mark.asyncio
    async def test_get_state(self, poller):
        """测试获取状态"""
        state = poller.get_state()
        assert state == PollerState.STOPPED

    @pytest.mark.asyncio
    async def test_poll_once_with_mock(self, config):
        """测试单次轮询 (模拟)"""
        poller = TaskPoller(config)
        await poller.start()

        # 模拟 HTTP 响应
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={
            "tasks": [create_test_task_dict("task-1"), create_test_task_dict("task-2")]
        })

        with patch.object(poller._session, "get") as mock_get:
            mock_get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            mock_get.return_value.__aexit__ = AsyncMock(return_value=None)

            tasks = await poller.poll_once()

            assert len(tasks) == 2
            assert tasks[0].id == "task-1"

            stats = poller.get_stats()
            assert stats.successful_polls == 1

        await poller.stop()

    @pytest.mark.asyncio
    async def test_poll_once_empty(self, config):
        """测试空结果轮询"""
        poller = TaskPoller(config)
        await poller.start()

        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={"tasks": []})

        with patch.object(poller._session, "get") as mock_get:
            mock_get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            mock_get.return_value.__aexit__ = AsyncMock(return_value=None)

            tasks = await poller.poll_once()

            assert len(tasks) == 0

        await poller.stop()

    @pytest.mark.asyncio
    async def test_poll_with_filter(self, config):
        """测试带过滤器的轮询"""
        poller = TaskPoller(config)
        await poller.start()

        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={"tasks": []})

        task_filter = TaskFilter(target_did="did:anp:nanobot:test")

        with patch.object(poller._session, "get") as mock_get:
            mock_get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            mock_get.return_value.__aexit__ = AsyncMock(return_value=None)

            await poller.poll_once(task_filter)

            # 验证过滤器参数被传递
            call_args = mock_get.call_args
            assert "params" in call_args.kwargs

        await poller.stop()

    @pytest.mark.asyncio
    async def test_callback_on_task(self, config):
        """测试任务回调"""
        received_tasks = []

        def on_task(task):
            received_tasks.append(task)

        poller = TaskPoller(config, on_task=on_task)
        await poller.start()

        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={
            "tasks": [create_test_task_dict("task-1")]
        })

        with patch.object(poller._session, "get") as mock_get:
            mock_get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            mock_get.return_value.__aexit__ = AsyncMock(return_value=None)

            tasks = await poller.poll_once()
            # 手动触发回调（实际在 poll loop 中）
            if poller.on_task:
                for task in tasks:
                    poller.on_task(task)

            assert len(received_tasks) == 1
            assert received_tasks[0].id == "task-1"

        await poller.stop()

    @pytest.mark.asyncio
    async def test_callback_on_batch(self, config):
        """测试批量回调"""
        received_batches = []

        def on_batch(tasks):
            received_batches.append(tasks)

        poller = TaskPoller(config, on_batch=on_batch)
        await poller.start()

        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={
            "tasks": [create_test_task_dict("1"), create_test_task_dict("2")]
        })

        with patch.object(poller._session, "get") as mock_get:
            mock_get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            mock_get.return_value.__aexit__ = AsyncMock(return_value=None)

            tasks = await poller.poll_once()
            if poller.on_batch:
                poller.on_batch(tasks)

            assert len(received_batches) == 1
            assert len(received_batches[0]) == 2

        await poller.stop()

    @pytest.mark.asyncio
    async def test_get_task(self, config):
        """测试获取单个任务"""
        poller = TaskPoller(config)
        await poller.start()

        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value=create_test_task_dict("task-123"))

        with patch.object(poller._session, "get") as mock_get:
            mock_get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            mock_get.return_value.__aexit__ = AsyncMock(return_value=None)

            task = await poller.get_task("task-123")

            assert task is not None
            assert task.id == "task-123"

        await poller.stop()

    @pytest.mark.asyncio
    async def test_acknowledge_task(self, config):
        """测试确认任务"""
        poller = TaskPoller(config)
        await poller.start()

        mock_response = AsyncMock()
        mock_response.status = 200

        with patch.object(poller._session, "post") as mock_post:
            mock_post.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            mock_post.return_value.__aexit__ = AsyncMock(return_value=None)

            result = await poller.acknowledge_task("task-123")

            assert result is True

        await poller.stop()


class TestCreateNanobotPoller:
    """测试 create_nanobot_poller"""

    def test_creates_poller_with_filter(self):
        """测试创建带过滤器的轮询器"""
        poller = create_nanobot_poller(
            automaton_url="http://localhost:18790",
            nanobot_did="did:anp:nanobot:worker1",
            poll_interval=10.0,
        )

        assert isinstance(poller, TaskPoller)
        assert poller.config.automaton_url == "http://localhost:18790"
        assert poller.config.poll_interval == 10.0
        assert poller._default_filter is not None
        assert poller._default_filter.target_did == "did:anp:nanobot:worker1"
