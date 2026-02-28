"""
心跳响应器
负责处理来自 Automaton 的心跳并响应
"""

import asyncio
import logging
import time
import uuid
from datetime import datetime
from typing import Dict, Optional, Callable, Awaitable, List, Any

from .types import (
    HeartbeatConfig,
    HeartbeatStatus,
    HeartbeatPayload,
    HeartbeatEvent,
    ConnectionState,
    HeartbeatStats,
    HeartbeatRecord,
    ReconnectRequest,
    HeartbeatEventType,
)

logger = logging.getLogger(__name__)


# 默认配置
DEFAULT_CONFIG = HeartbeatConfig()


class HeartbeatResponder:
    """
    心跳响应器

    功能：
    - 接收并处理来自 Automaton 的心跳
    - 发送心跳响应到 Automaton
    - 监控连接健康状态
    - 超时检测和自动恢复
    - 支持双向心跳
    """

    def __init__(
        self,
        own_did: str,
        config: Optional[HeartbeatConfig] = None,
    ):
        """
        初始化心跳响应器

        Args:
            own_did: 本端 DID
            config: 心跳配置
        """
        self.own_did = own_did
        self.config = config or DEFAULT_CONFIG
        self.start_time = time.time()

        # 连接状态管理
        self._connections: Dict[str, ConnectionState] = {}
        self._heartbeat_records: Dict[str, List[HeartbeatRecord]] = {}
        self._sequence_numbers: Dict[str, int] = {}

        # 定时器
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._timeout_tasks: Dict[str, asyncio.Task] = {}
        self._is_running = False

        # 事件回调
        self._on_heartbeat_sent: Optional[Callable[[str, int], Awaitable[None]]] = None
        self._on_heartbeat_received: Optional[
            Callable[[str, HeartbeatPayload], Awaitable[None]]
        ] = None
        self._on_heartbeat_timeout: Optional[
            Callable[[str, Optional[datetime]], Awaitable[None]]
        ] = None
        self._on_heartbeat_recovered: Optional[Callable[[str], Awaitable[None]]] = None
        self._on_heartbeat_failed: Optional[
            Callable[[str, str], Awaitable[None]]
        ] = None
        self._on_reconnect_requested: Optional[
            Callable[[ReconnectRequest], Awaitable[None]]
        ] = None

        # 心跳发送器回调
        self._sender_callback: Optional[Callable[[HeartbeatEvent], Awaitable[bool]]] = None

    async def start(
        self,
        sender_callback: Optional[Callable[[HeartbeatEvent], Awaitable[bool]]] = None,
    ) -> None:
        """
        启动心跳响应器

        Args:
            sender_callback: 心跳发送回调函数
        """
        if self._is_running:
            return

        self._sender_callback = sender_callback
        self._is_running = True

        # 启动心跳循环
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        logger.info("HeartbeatResponder started")

    async def stop(self) -> None:
        """停止心跳响应器"""
        if not self._is_running:
            return

        self._is_running = False

        # 取消心跳任务
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
            self._heartbeat_task = None

        # 取消所有超时检测任务
        for task in self._timeout_tasks.values():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._timeout_tasks.clear()

        logger.info("HeartbeatResponder stopped")

    def register_connection(self, connection_id: str, target_did: str) -> None:
        """
        注册连接

        Args:
            connection_id: 连接 ID
            target_did: 目标 DID
        """
        if connection_id in self._connections:
            return

        state = ConnectionState(
            connection_id=connection_id,
            target_did=target_did,
            connected=True,
            status=HeartbeatStatus.UNKNOWN,
        )

        self._connections[connection_id] = state
        self._heartbeat_records[connection_id] = []
        self._sequence_numbers[connection_id] = 0

        # 启动超时检测
        asyncio.create_task(self._timeout_check_loop(connection_id))

        logger.debug(f"Registered connection: {connection_id} -> {target_did}")

    def unregister_connection(self, connection_id: str) -> None:
        """
        注销连接

        Args:
            connection_id: 连接 ID
        """
        # 取消超时检测任务
        if connection_id in self._timeout_tasks:
            self._timeout_tasks[connection_id].cancel()
            del self._timeout_tasks[connection_id]

        # 清理记录
        self._heartbeat_records.pop(connection_id, None)
        self._sequence_numbers.pop(connection_id, None)

        # 删除连接状态
        self._connections.pop(connection_id, None)

        logger.debug(f"Unregistered connection: {connection_id}")

    async def handle_heartbeat(
        self, connection_id: str, payload: HeartbeatPayload
    ) -> None:
        """
        处理接收到的心跳

        Args:
            connection_id: 连接 ID
            payload: 心跳负载
        """
        state = self._connections.get(connection_id)
        if not state:
            logger.warning(f"Received heartbeat for unknown connection: {connection_id}")
            return

        now = datetime.now()
        state.last_received = now
        state.last_heartbeat = now
        state.total_received += 1

        # 如果之前状态不健康，现在恢复
        was_unhealthy = state.status != HeartbeatStatus.HEALTHY
        if was_unhealthy and state.consecutive_failures > 0:
            state.consecutive_failures = 0
            state.status = self._determine_status(state)
            if self._on_heartbeat_recovered:
                await self._on_heartbeat_recovered(connection_id)
            logger.info(f"Connection {connection_id} recovered")

        # 更新状态
        state.status = self._determine_status(state)

        # 更新心跳记录
        self._update_heartbeat_record(connection_id, payload.sequence, now)

        # 触发回调
        if self._on_heartbeat_received:
            await self._on_heartbeat_received(connection_id, payload)

        logger.debug(f"Received heartbeat from {connection_id}, seq={payload.sequence}")

    async def send_heartbeats(self) -> None:
        """向所有连接发送心跳"""
        if not self._is_running or not self.config.enabled:
            return

        tasks = []
        for connection_id, state in self._connections.items():
            if state.connected:
                tasks.append(self._send_heartbeat(connection_id))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _send_heartbeat(self, connection_id: str) -> bool:
        """
        发送心跳到指定连接

        Args:
            connection_id: 连接 ID

        Returns:
            是否发送成功
        """
        state = self._connections.get(connection_id)
        if not state or not state.connected:
            return False

        now = datetime.now()
        sequence = self._get_next_sequence(connection_id)

        payload = HeartbeatPayload(
            status=HeartbeatStatus.HEALTHY,
            uptime=int(time.time() - self.start_time),
            active_tasks=0,
            queued_tasks=0,
            timestamp=now.isoformat(),
            sequence=sequence,
            version="1.0.0",
        )

        event = HeartbeatEvent(
            id=str(uuid.uuid4()),
            type=HeartbeatEventType.HEARTBEAT_SENT,
            target_did=state.target_did,
            payload=payload,
            timestamp=now.isoformat(),
        )

        # 记录心跳
        self._record_heartbeat(connection_id, sequence, now)

        # 使用回调发送
        sent = False
        if self._sender_callback:
            try:
                sent = await self._sender_callback(event)
            except Exception as e:
                logger.error(f"Error sending heartbeat: {e}")
                await self._emit_error(connection_id, str(e))

        if sent:
            state.last_sent = now
            state.total_sent += 1
            if self._on_heartbeat_sent:
                await self._on_heartbeat_sent(connection_id, sequence)
            logger.debug(f"Sent heartbeat to {connection_id}, seq={sequence}")
        else:
            state.total_failures += 1
            state.consecutive_failures += 1
            await self._check_failure_threshold(connection_id, state)
            logger.warning(f"Failed to send heartbeat to {connection_id}")

        return sent

    async def _heartbeat_loop(self) -> None:
        """心跳循环"""
        try:
            while self._is_running:
                await self.send_heartbeats()
                await asyncio.sleep(self.config.interval)
        except asyncio.CancelledError:
            pass

    async def _timeout_check_loop(self, connection_id: str) -> None:
        """超时检测循环"""
        try:
            while self._is_running and connection_id in self._connections:
                await asyncio.sleep(self.config.interval)
                await self._check_timeout(connection_id)
        except asyncio.CancelledError:
            pass

    async def _check_timeout(self, connection_id: str) -> None:
        """
        检查连接超时

        Args:
            connection_id: 连接 ID
        """
        state = self._connections.get(connection_id)
        if not state:
            return

        now = datetime.now()
        last_received = state.last_received

        if not last_received:
            # 从未收到过心跳，检查最后发送时间
            if state.last_sent:
                time_since_last_sent = (now - state.last_sent).total_seconds()
                if time_since_last_sent > self.config.timeout:
                    await self._handle_timeout(connection_id, state)
            return

        # 检查是否超时
        time_since_last_received = (now - last_received).total_seconds()
        if time_since_last_received > self.config.timeout:
            await self._handle_timeout(connection_id, state)

    async def _handle_timeout(
        self, connection_id: str, state: ConnectionState
    ) -> None:
        """
        处理超时

        Args:
            connection_id: 连接 ID
            state: 连接状态
        """
        state.consecutive_failures += 1
        state.total_failures += 1
        state.status = HeartbeatStatus.UNHEALTHY

        if self._on_heartbeat_timeout:
            await self._on_heartbeat_timeout(connection_id, state.last_received)

        logger.warning(f"Connection {connection_id} timeout detected")

        await self._check_failure_threshold(connection_id, state)

    async def _check_failure_threshold(
        self, connection_id: str, state: ConnectionState
    ) -> None:
        """
        检查失败阈值

        Args:
            connection_id: 连接 ID
            state: 连接状态
        """
        if state.consecutive_failures >= self.config.failure_threshold:
            state.status = HeartbeatStatus.UNHEALTHY
            state.connected = False

            reason = (
                f"Failure threshold reached: {state.consecutive_failures} failures"
            )

            if self._on_heartbeat_failed:
                await self._on_heartbeat_failed(connection_id, reason)

            logger.error(f"Connection {connection_id} failed: {reason}")

            # 请求重连
            if state.reconnect_count < self.config.max_retries:
                state.reconnect_count += 1
                reconnect_request = ReconnectRequest(
                    connection_id=connection_id,
                    target_did=state.target_did,
                    reason=reason,
                    retry_count=state.reconnect_count,
                )

                if self._on_reconnect_requested:
                    await self._on_reconnect_requested(reconnect_request)

                logger.info(f"Requested reconnect for {connection_id}")
            else:
                logger.warning(
                    f"Abandoned reconnect for {connection_id}: max retries reached"
                )
        else:
            state.status = self._determine_status(state)

    def _determine_status(self, state: ConnectionState) -> HeartbeatStatus:
        """
        确定连接状态

        Args:
            state: 连接状态

        Returns:
            心跳状态
        """
        if not state.connected:
            return HeartbeatStatus.UNHEALTHY

        if state.consecutive_failures >= self.config.failure_threshold:
            return HeartbeatStatus.UNHEALTHY

        if state.consecutive_failures > 0:
            return HeartbeatStatus.DEGRADED

        if not state.last_received:
            return HeartbeatStatus.UNKNOWN

        now = datetime.now()
        time_since_last_received = (now - state.last_received).total_seconds()

        if time_since_last_received > self.config.timeout:
            return HeartbeatStatus.UNHEALTHY

        if time_since_last_received > self.config.interval * 2:
            return HeartbeatStatus.DEGRADED

        return HeartbeatStatus.HEALTHY

    def _record_heartbeat(
        self, connection_id: str, sequence: int, sent_at: datetime
    ) -> None:
        """
        记录心跳

        Args:
            connection_id: 连接 ID
            sequence: 序列号
            sent_at: 发送时间
        """
        records = self._heartbeat_records.get(connection_id)
        if not records:
            return

        records.append(HeartbeatRecord(sequence=sequence, sent_at=sent_at))

        # 只保留最近 100 条记录
        if len(records) > 100:
            records.pop(0)

    def _update_heartbeat_record(
        self, connection_id: str, sequence: int, received_at: datetime
    ) -> None:
        """
        更新心跳记录

        Args:
            connection_id: 连接 ID
            sequence: 序列号
            received_at: 接收时间
        """
        records = self._heartbeat_records.get(connection_id)
        if not records:
            return

        for record in records:
            if record.sequence == sequence:
                record.received_at = received_at
                record.rtt = (received_at - record.sent_at).total_seconds() * 1000
                break

    def _get_next_sequence(self, connection_id: str) -> int:
        """
        获取下一个序列号

        Args:
            connection_id: 连接 ID

        Returns:
            序列号
        """
        current = self._sequence_numbers.get(connection_id, 0)
        next_seq = current + 1
        self._sequence_numbers[connection_id] = next_seq
        return next_seq

    def get_connection_state(self, connection_id: str) -> Optional[ConnectionState]:
        """
        获取连接状态

        Args:
            connection_id: 连接 ID

        Returns:
            连接状态
        """
        return self._connections.get(connection_id)

    def get_all_connection_states(self) -> List[ConnectionState]:
        """
        获取所有连接状态

        Returns:
            连接状态列表
        """
        return list(self._connections.values())

    def get_stats(self) -> HeartbeatStats:
        """
        获取统计信息

        Returns:
            心跳统计
        """
        connections = list(self._connections.values())

        healthy = sum(1 for c in connections if c.status == HeartbeatStatus.HEALTHY)
        degraded = sum(1 for c in connections if c.status == HeartbeatStatus.DEGRADED)
        unhealthy = sum(
            1 for c in connections if c.status == HeartbeatStatus.UNHEALTHY
        )

        total_sent = sum(c.total_sent for c in connections)
        total_received = sum(c.total_received for c in connections)
        total_failures = sum(c.total_failures for c in connections)

        # 计算平均延迟
        all_rtts = []
        for records in self._heartbeat_records.values():
            for record in records:
                if record.rtt is not None:
                    all_rtts.append(record.rtt)

        average_latency = (
            sum(all_rtts) / len(all_rtts) if all_rtts else 0
        )

        # 计算丢失率
        loss_rate = (
            ((total_sent - total_received) / total_sent * 100) if total_sent > 0 else 0
        )

        return HeartbeatStats(
            total_connections=len(connections),
            healthy_connections=healthy,
            degraded_connections=degraded,
            unhealthy_connections=unhealthy,
            total_sent=total_sent,
            total_received=total_received,
            total_failures=total_failures,
            average_latency=average_latency,
            loss_rate=loss_rate,
        )

    def reset_connection(self, connection_id: str) -> None:
        """
        重置连接状态

        Args:
            connection_id: 连接 ID
        """
        state = self._connections.get(connection_id)
        if not state:
            return

        state.connected = True
        state.consecutive_failures = 0
        state.status = self._determine_status(state)

        logger.info(f"Reset connection {connection_id}")

    def update_config(self, config: Dict[str, Any]) -> None:
        """
        更新配置

        Args:
            config: 配置更新
        """
        for key, value in config.items():
            if hasattr(self.config, key):
                setattr(self.config, key, value)

    def is_active(self) -> bool:
        """
        检查是否运行中

        Returns:
            是否运行中
        """
        return self._is_running

    # 事件处理器设置
    def on_heartbeat_sent(
        self, callback: Callable[[str, int], Awaitable[None]]
    ) -> None:
        """设置心跳已发送事件处理器"""
        self._on_heartbeat_sent = callback

    def on_heartbeat_received(
        self, callback: Callable[[str, HeartbeatPayload], Awaitable[None]]
    ) -> None:
        """设置心跳已接收事件处理器"""
        self._on_heartbeat_received = callback

    def on_heartbeat_timeout(
        self, callback: Callable[[str, Optional[datetime]], Awaitable[None]]
    ) -> None:
        """设置心跳超时事件处理器"""
        self._on_heartbeat_timeout = callback

    def on_heartbeat_recovered(
        self, callback: Callable[[str], Awaitable[None]]
    ) -> None:
        """设置连接恢复事件处理器"""
        self._on_heartbeat_recovered = callback

    def on_heartbeat_failed(
        self, callback: Callable[[str, str], Awaitable[None]]
    ) -> None:
        """设置连接失败事件处理器"""
        self._on_heartbeat_failed = callback

    def on_reconnect_requested(
        self, callback: Callable[[ReconnectRequest], Awaitable[None]]
    ) -> None:
        """设置重连请求事件处理器"""
        self._on_reconnect_requested = callback

    async def _emit_error(self, connection_id: str, error: str) -> None:
        """发射错误事件"""
        logger.error(f"Connection {connection_id} error: {error}")
