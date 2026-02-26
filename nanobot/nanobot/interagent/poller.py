"""
任务轮询器
用于从 Automaton 获取任务

@module nanobot.interagent.poller
@version 1.0.0
"""

import asyncio
import time
from typing import Optional, List, Callable, Any
from dataclasses import dataclass, field
from enum import Enum
import aiohttp

from .filters import Task, TaskFilter, filter_tasks, sort_by_priority


# ============================================================================
# 类型定义
# ============================================================================

class PollerState(str, Enum):
    """轮询器状态"""
    IDLE = "idle"
    POLLING = "polling"
    STOPPED = "stopped"
    ERROR = "error"


@dataclass
class PollerConfig:
    """轮询器配置"""
    automaton_url: str  # Automaton HTTP API 地址
    poll_interval: float = 5.0  # 轮询间隔 (秒)
    long_poll_timeout: float = 30.0  # 长轮询超时 (秒)
    max_retries: int = 3  # 最大重试次数
    retry_delay: float = 1.0  # 重试延迟 (秒)
    batch_size: int = 10  # 批量获取大小
    timeout: float = 10.0  # HTTP 请求超时 (秒)


@dataclass
class PollerStats:
    """轮询统计"""
    total_polls: int = 0
    successful_polls: int = 0
    failed_polls: int = 0
    tasks_received: int = 0
    last_poll_time: Optional[float] = None
    last_error: Optional[str] = None


# ============================================================================
# 任务轮询器
# ============================================================================

class TaskPoller:
    """
    任务轮询器
    从 Automaton 获取待处理任务
    """

    def __init__(
        self,
        config: PollerConfig,
        on_task: Optional[Callable[[Task], None]] = None,
        on_batch: Optional[Callable[[List[Task]], None]] = None,
    ):
        """
        初始化轮询器

        Args:
            config: 轮询器配置
            on_task: 单任务回调
            on_batch: 批量任务回调
        """
        self.config = config
        self.on_task = on_task
        self.on_batch = on_batch

        self.state = PollerState.STOPPED
        self.stats = PollerStats()
        self._running = False
        self._poll_task: Optional[asyncio.Task] = None
        self._session: Optional[aiohttp.ClientSession] = None
        self._default_filter: Optional[TaskFilter] = None

    async def start(self) -> None:
        """启动轮询器"""
        if self._running:
            return

        self._running = True
        self.state = PollerState.IDLE

        # 创建 HTTP session
        self._session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=self.config.timeout)
        )

        # 启动轮询任务
        self._poll_task = asyncio.create_task(self._poll_loop())

    async def stop(self) -> None:
        """停止轮询器"""
        self._running = False
        self.state = PollerState.STOPPED

        if self._poll_task:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
            self._poll_task = None

        if self._session:
            await self._session.close()
            self._session = None

    def set_default_filter(self, task_filter: TaskFilter) -> None:
        """设置默认过滤器"""
        self._default_filter = task_filter

    # ========================================================================
    # 轮询方法
    # ========================================================================

    async def poll_once(self, task_filter: Optional[TaskFilter] = None) -> List[Task]:
        """
        执行一次轮询

        Args:
            task_filter: 任务过滤器

        Returns:
            获取到的任务列表
        """
        filter_to_use = task_filter or self._default_filter
        return await self._fetch_tasks(filter_to_use)

    async def poll_long(self, task_filter: Optional[TaskFilter] = None) -> List[Task]:
        """
        长轮询
        等待直到有任务或超时

        Args:
            task_filter: 任务过滤器

        Returns:
            获取到的任务列表
        """
        filter_to_use = task_filter or self._default_filter
        start_time = time.time()

        while time.time() - start_time < self.config.long_poll_timeout:
            tasks = await self._fetch_tasks(filter_to_use)
            if tasks:
                return tasks

            # 等待一段时间再重试
            await asyncio.sleep(min(self.config.poll_interval, 1.0))

        return []

    async def poll_batch(
        self,
        batch_size: Optional[int] = None,
        task_filter: Optional[TaskFilter] = None
    ) -> List[Task]:
        """
        批量获取任务

        Args:
            batch_size: 批量大小
            task_filter: 任务过滤器

        Returns:
            任务列表
        """
        size = batch_size or self.config.batch_size
        filter_to_use = task_filter or self._default_filter

        if filter_to_use:
            filter_to_use.limit = size
        else:
            filter_to_use = TaskFilter(limit=size)

        return await self._fetch_tasks(filter_to_use)

    # ========================================================================
    # 内部方法
    # ========================================================================

    async def _poll_loop(self) -> None:
        """轮询循环"""
        while self._running:
            try:
                self.state = PollerState.POLLING
                tasks = await self.poll_once()

                if tasks:
                    self.stats.tasks_received += len(tasks)

                    # 触发回调
                    if self.on_batch:
                        self.on_batch(tasks)

                    if self.on_task:
                        for task in tasks:
                            self.on_task(task)

                self.state = PollerState.IDLE

                # 等待下次轮询
                await asyncio.sleep(self.config.poll_interval)

            except asyncio.CancelledError:
                break
            except Exception as e:
                self.state = PollerState.ERROR
                self.stats.last_error = str(e)
                self.stats.failed_polls += 1

                # 等待后重试
                await asyncio.sleep(self.config.retry_delay)

    async def _fetch_tasks(self, task_filter: Optional[TaskFilter] = None) -> List[Task]:
        """
        从 Automaton 获取任务

        Args:
            task_filter: 任务过滤器

        Returns:
            任务列表
        """
        if not self._session:
            return []

        self.stats.total_polls += 1

        url = f"{self.config.automaton_url}/api/tasks/pending"

        params = {}
        if task_filter:
            params = task_filter.to_dict()

        for attempt in range(self.config.max_retries):
            try:
                async with self._session.get(url, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        tasks = [Task.from_dict(t) for t in data.get("tasks", [])]
                        tasks = sort_by_priority(tasks)
                        self.stats.successful_polls += 1
                        self.stats.last_poll_time = time.time()
                        return tasks
                    else:
                        raise Exception(f"HTTP {response.status}")

            except asyncio.CancelledError:
                raise
            except Exception as e:
                if attempt == self.config.max_retries - 1:
                    self.stats.last_error = str(e)
                    return []

                await asyncio.sleep(self.config.retry_delay * (attempt + 1))

        return []

    # ========================================================================
    # 任务操作
    # ========================================================================

    async def acknowledge_task(self, task_id: str) -> bool:
        """
        确认任务已接收

        Args:
            task_id: 任务 ID

        Returns:
            是否成功
        """
        if not self._session:
            return False

        url = f"{self.config.automaton_url}/api/tasks/{task_id}/ack"

        try:
            async with self._session.post(url) as response:
                return response.status == 200
        except Exception:
            return False

    async def get_task(self, task_id: str) -> Optional[Task]:
        """
        获取单个任务详情

        Args:
            task_id: 任务 ID

        Returns:
            任务对象或 None
        """
        if not self._session:
            return None

        url = f"{self.config.automaton_url}/api/tasks/{task_id}"

        try:
            async with self._session.get(url) as response:
                if response.status == 200:
                    data = await response.json()
                    return Task.from_dict(data)
                return None
        except Exception:
            return None

    def get_stats(self) -> PollerStats:
        """获取统计信息"""
        return self.stats

    def get_state(self) -> PollerState:
        """获取当前状态"""
        return self.state


# ============================================================================
# 辅助函数
# ============================================================================

def create_nanobot_poller(
    automaton_url: str,
    nanobot_did: str,
    on_task: Optional[Callable[[Task], None]] = None,
    poll_interval: float = 5.0,
) -> TaskPoller:
    """
    创建 Nanobot 专用轮询器

    Args:
        automaton_url: Automaton URL
        nanobot_did: Nanobot DID
        on_task: 任务回调
        poll_interval: 轮询间隔

    Returns:
        配置好的轮询器
    """
    config = PollerConfig(
        automaton_url=automaton_url,
        poll_interval=poll_interval,
    )

    poller = TaskPoller(config, on_task=on_task)
    poller.set_default_filter(TaskFilter(
        target_did=nanobot_did,
        status=None,  # 由服务端过滤
    ))

    return poller
