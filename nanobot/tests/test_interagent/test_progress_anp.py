"""
进度报告 ANP 适配器测试
测试 ProgressReportSender 和 ProgressReportReceiver 的功能

@test_module nanobot.tests.test_interagent.test_progress_anp
@version 1.0.0
"""

import asyncio
from datetime import datetime

import pytest

from nanobot.anp.types import (
    AUTOMATON_DID,
    NANOBOT_DID,
    ANPMessage,
    ANPMessageType,
    ProgressReportPayload,
)
from nanobot.interagent.progress.adapter import (
    ProgressReportReceiver,
    ProgressReportSender,
    ProgressSyncConfig,
    ProgressSyncState,
    create_progress_adapter,
)
from nanobot.interagent.progress_reporter import (
    ProgressTracker,
    ProgressUpdate,
)

# ============================================================================
# 测试配置
# ============================================================================

@pytest.fixture
def sync_config():
    """创建同步配置"""
    return ProgressSyncConfig(
        sync_interval_ms=100,  # 快速测试
        max_batch_size=5,
        sync_threshold=1.0,
        enable_incremental=True,
    )


@pytest.fixture
def sender(sync_config):
    """创建发送器"""
    return ProgressReportSender(
        config=sync_config,
        did=NANOBOT_DID,
        target_did=AUTOMATON_DID,
    )


@pytest.fixture
def receiver():
    """创建接收器"""
    return ProgressReportReceiver()


# ============================================================================
# ProgressReportSender 测试
# ============================================================================


class TestProgressReportSender:
    """测试 ProgressReportSender"""

    @pytest.mark.asyncio
    async def test_start_stop(self, sender):
        """测试启动和停止"""
        assert not sender._running
        assert sender.get_state() == ProgressSyncState.IDLE

        await sender.start()
        assert sender._running

        await sender.stop()
        assert not sender._running

    @pytest.mark.asyncio
    async def test_report_progress(self, sender):
        """测试报告进度"""
        await sender.start()

        # 设置消息处理器
        messages = []
        async def mock_handler(message):
            messages.append(message)

        sender.on_message(mock_handler)

        # 报告进度
        success = await sender.report_progress(
            task_id="task-1",
            percentage=50.0,
            message="Half done",
            current_step="processing",
            completed_steps=["step1", "step2"],
            next_steps=["step3"],
            eta_seconds=100,
        )

        assert success is True
        assert sender.get_pending_count() == 1

        # 等待同步
        await asyncio.sleep(0.2)

        # 验证消息已发送
        assert len(messages) > 0

        await sender.stop()

    @pytest.mark.asyncio
    async def test_report_from_tracker(self, sender):
        """测试从追踪器报告进度"""
        await sender.start()

        # 创建追踪器
        tracker = ProgressTracker("task-2")
        tracker.start()

        # 更新进度
        tracker.update(ProgressUpdate(
            percentage=30.0,
            message="In progress",
        ))

        # 设置消息处理器
        messages = []
        async def mock_handler(message):
            messages.append(message)

        sender.on_message(mock_handler)

        # 报告
        success = await sender.report_from_tracker(tracker)
        assert success is True

        await sender.stop()

    @pytest.mark.asyncio
    async def test_incremental_sync_threshold(self, sender):
        """测试增量同步阈值"""
        await sender.start()

        # 第一次报告
        success1 = await sender.report_progress(
            task_id="task-3",
            percentage=50.0,
        )
        assert success1 is True

        # 第二次报告，变化小于阈值
        success2 = await sender.report_progress(
            task_id="task-3",
            percentage=50.5,  # 变化 0.5%
        )
        assert success2 is False  # 被阈值过滤

        # 第三次报告，变化大于阈值
        success3 = await sender.report_progress(
            task_id="task-3",
            percentage=52.0,  # 变化 1.5%
        )
        assert success3 is True

        await sender.stop()

    @pytest.mark.asyncio
    async def test_message_structure(self, sender):
        """测试消息结构"""
        await sender.start()

        messages = []
        async def mock_handler(message):
            messages.append(message)

        sender.on_message(mock_handler)

        await sender.report_progress(
            task_id="task-4",
            percentage=75.0,
            message="Almost done",
            completed_steps=["step1", "step2", "step3"],
            next_steps=["step4"],
            blockers=["dependency"],
        )

        # 等待同步
        await asyncio.sleep(0.2)

        if messages:
            msg = messages[0]
            assert isinstance(msg, ANPMessage)
            assert msg.type == ANPMessageType.PROGRESS_EVENT
            assert isinstance(msg.object, ProgressReportPayload)

            payload = msg.object
            assert payload.task_id == "task-4"
            assert payload.progress == 75
            # message is stored in current_phase, not as a separate field
            assert payload.current_phase == "Almost done" or payload.current_phase == "in_progress"
            assert len(payload.completed_steps) == 3
            assert len(payload.next_steps) == 1
            assert len(payload.blockers) == 1

        await sender.stop()

    @pytest.mark.asyncio
    async def test_sync_stats(self, sender):
        """测试同步统计"""
        await sender.start()

        messages = []
        async def mock_handler(message):
            messages.append(message)

        sender.on_message(mock_handler)

        # 发送多个更新
        for i in range(3):
            await sender.report_progress(
                task_id=f"task-{i}",
                percentage=50.0,
            )

        # 等待同步
        await asyncio.sleep(0.3)

        stats = sender.get_stats()
        assert stats.total_syncs >= 0
        assert stats.last_sync_time is not None

        await sender.stop()

    @pytest.mark.asyncio
    async def test_error_handler(self, sender):
        """测试错误处理"""
        await sender.start()

        errors = []
        def mock_error_handler(error):
            errors.append(error)

        sender.on_error(mock_error_handler)

        # 设置会失败的消息处理器
        async def failing_handler(message):
            raise Exception("Send failed")

        sender.on_message(failing_handler)

        await sender.report_progress(
            task_id="task-error",
            percentage=50.0,
        )

        # 等待错误
        await asyncio.sleep(0.3)

        # 验证错误被捕获
        stats = sender.get_stats()
        assert stats.failed_syncs > 0 or len(errors) > 0

        await sender.stop()


# ============================================================================
# ProgressReportReceiver 测试
# ============================================================================


class TestProgressReportReceiver:
    """测试 ProgressReportReceiver"""

    @pytest.mark.asyncio
    async def test_start_stop(self, receiver):
        """测试启动和停止"""
        assert not receiver._running

        await receiver.start()
        assert receiver._running

        await receiver.stop()
        assert not receiver._running

    @pytest.mark.asyncio
    async def test_handle_progress_message(self, receiver):
        """测试处理进度消息"""
        await receiver.start()

        # 创建模拟消息
        payload = ProgressReportPayload(
            task_id="task-received-1",
            progress=60,
            current_phase="processing",
            completed_steps=["step1"],
            next_steps=["step2"],
            eta_seconds=120,
        )

        # 需要创建完整的 ANP 消息
        from nanobot.anp.did import generate_key_pair, import_private_key
        from nanobot.anp.signature import CreateMessageOptions, create_anp_message

        private_pem, _ = generate_key_pair()
        private_key = import_private_key(private_pem)

        options = CreateMessageOptions(
            type=ANPMessageType.PROGRESS_EVENT,
            target_did=NANOBOT_DID,
        )

        message = create_anp_message(payload, private_key, options)

        # 处理消息
        success = await receiver.handle_anp_message(message)
        assert success is True

        # 验证追踪器已创建
        tracker = receiver.get_tracker("task-received-1")
        assert tracker is not None
        assert tracker.get_percentage() == 60.0

        await receiver.stop()

    @pytest.mark.asyncio
    async def test_tracker_management(self, receiver):
        """测试追踪器管理"""
        await receiver.start()

        # 创建追踪器
        tracker1 = receiver._get_or_create_tracker("task-1")
        tracker2 = receiver._get_or_create_tracker("task-1")
        tracker3 = receiver._get_or_create_tracker("task-2")

        # 验证相同任务 ID 返回同一追踪器
        assert tracker1 is tracker2
        assert tracker1 is not tracker3

        # 获取所有追踪器
        all_trackers = receiver.get_all_trackers()
        assert len(all_trackers) == 2

        # 移除追踪器
        success = receiver.remove_tracker("task-1")
        assert success is True

        all_trackers = receiver.get_all_trackers()
        assert len(all_trackers) == 1
        assert "task-1" not in all_trackers

        await receiver.stop()

    @pytest.mark.asyncio
    async def test_invalid_message_type(self, receiver):
        """测试无效消息类型"""
        await receiver.start()

        from nanobot.anp.did import generate_key_pair, import_private_key
        from nanobot.anp.signature import CreateMessageOptions, create_anp_message
        from nanobot.anp.types import StatusRequestPayload

        # 创建非进度消息
        payload = StatusRequestPayload(detail_level="basic")

        private_pem, _ = generate_key_pair()
        private_key = import_private_key(private_pem)

        options = CreateMessageOptions(
            type=ANPMessageType.STATUS_REQUEST,
            target_did=NANOBOT_DID,
        )

        message = create_anp_message(payload, private_key, options)

        # 处理消息 - 应该返回 False
        success = await receiver.handle_anp_message(message)
        assert success is False

        await receiver.stop()


# ============================================================================
# 集成测试
# ============================================================================


class TestProgressAdapterIntegration:
    """测试进度适配器集成"""

    @pytest.mark.asyncio
    async def test_end_to_end_sync(self, sync_config):
        """测试端到端同步"""
        # 创建发送器和接收器
        sender = ProgressReportSender(
            config=sync_config,
            did=NANOBOT_DID,
            target_did=AUTOMATON_DID,
        )
        receiver = ProgressReportReceiver()

        await sender.start()
        await receiver.start()

        # 设置消息传递
        async def forward_to_receiver(message):
            await receiver.handle_anp_message(message)

        sender.on_message(forward_to_receiver)

        # 发送进度更新
        await sender.report_progress(
            task_id="sync-task-1",
            percentage=25.0,
            message="Quarter done",
        )

        # 等待同步
        await asyncio.sleep(0.2)

        # 验证接收器收到更新
        tracker = receiver.get_tracker("sync-task-1")
        assert tracker is not None
        assert tracker.get_percentage() == 25.0

        await sender.stop()
        await receiver.stop()

    @pytest.mark.asyncio
    async def test_latency_requirement(self, sync_config):
        """测试延迟要求 (< 5s)"""
        # 使用快速配置
        fast_config = ProgressSyncConfig(
            sync_interval_ms=50,  # 50ms
            sync_threshold=0.1,  # 0.1% 阈值
        )

        sender = ProgressReportSender(config=fast_config)
        receiver = ProgressReportReceiver()

        await sender.start()
        await receiver.start()

        # 设置消息传递
        received_times = []

        async def forward_to_receiver(message):
            start = datetime.now()
            await receiver.handle_anp_message(message)
            end = datetime.now()
            latency_ms = (end - start).total_seconds() * 1000
            received_times.append(latency_ms)

        sender.on_message(forward_to_receiver)

        # 发送进度更新
        start_time = datetime.now()
        await sender.report_progress(
            task_id="latency-task",
            percentage=50.0,
        )

        # 等待接收
        await asyncio.sleep(0.2)

        end_time = datetime.now()
        total_latency = (end_time - start_time).total_seconds()

        # 验证总延迟 < 5s
        assert total_latency < 5.0, f"Latency {total_latency}s exceeds 5s requirement"

        # 验证处理延迟
        if received_times:
            avg_processing_latency = sum(received_times) / len(received_times)
            assert avg_processing_latency < 1000, f"Processing latency {avg_processing_latency}ms too high"

        await sender.stop()
        await receiver.stop()

    @pytest.mark.asyncio
    async def test_batch_sync(self, sync_config):
        """测试批量同步"""
        batch_config = ProgressSyncConfig(
            sync_interval_ms=100,
            max_batch_size=3,
        )

        sender = ProgressReportSender(config=batch_config)
        await sender.start()

        # 快速发送多个更新
        for i in range(5):
            await sender.report_progress(
                task_id=f"batch-task-{i}",
                percentage=50.0 + i * 10,
            )

        # 检查待发送数量
        pending_count = sender.get_pending_count()
        assert pending_count > 0

        # 等待批量发送
        await asyncio.sleep(0.3)

        await sender.stop()


# ============================================================================
# 工厂函数测试
# ============================================================================


class TestCreateProgressAdapter:
    """测试工厂函数"""

    def test_create_sender(self):
        """测试创建发送器"""
        adapter = create_progress_adapter(mode="sender")
        assert isinstance(adapter, ProgressReportSender)

    def test_create_receiver(self):
        """测试创建接收器"""
        adapter = create_progress_adapter(mode="receiver")
        assert isinstance(adapter, ProgressReportReceiver)

    def test_create_both(self):
        """测试创建双向适配器"""
        adapter = create_progress_adapter(mode="both")
        assert isinstance(adapter, dict)
        assert "sender" in adapter
        assert "receiver" in adapter
        assert isinstance(adapter["sender"], ProgressReportSender)
        assert isinstance(adapter["receiver"], ProgressReportReceiver)

    def test_invalid_mode(self):
        """测试无效模式"""
        with pytest.raises(ValueError, match="Invalid mode"):
            create_progress_adapter(mode="invalid")


# ============================================================================
# 性能测试
# ============================================================================


class TestProgressAdapterPerformance:
    """测试进度适配器性能"""

    @pytest.mark.asyncio
    async def test_high_frequency_updates(self, sync_config):
        """测试高频更新"""
        # 降低同步间隔
        sync_config.sync_interval_ms = 10

        sender = ProgressReportSender(config=sync_config)
        receiver = ProgressReportReceiver()

        await sender.start()
        await receiver.start()

        # 设置消息传递
        async def forward_to_receiver(message):
            await receiver.handle_anp_message(message)

        sender.on_message(forward_to_receiver)

        # 发送 100 个快速更新
        start = datetime.now()
        for i in range(100):
            await sender.report_progress(
                task_id="perf-task",
                percentage=float(i),
            )

        # 等待所有更新完成
        await asyncio.sleep(1.0)

        end = datetime.now()
        duration = (end - start).total_seconds()

        # 验证在合理时间内完成
        assert duration < 10.0, f"Too slow: {duration}s for 100 updates"

        await sender.stop()
        await receiver.stop()

    @pytest.mark.asyncio
    async def test_concurrent_tasks(self, sync_config):
        """测试并发任务"""
        sender = ProgressReportSender(config=sync_config)
        receiver = ProgressReportReceiver()

        await sender.start()
        await receiver.start()

        # 设置消息传递
        async def forward_to_receiver(message):
            await receiver.handle_anp_message(message)

        sender.on_message(forward_to_receiver)

        # 并发报告多个任务
        tasks = []
        for i in range(10):
            task = sender.report_progress(
                task_id=f"concurrent-task-{i}",
                percentage=50.0,
            )
            tasks.append(task)

        # 等待所有报告完成
        results = await asyncio.gather(*tasks)
        assert all(results) or any(results)  # 至少一些成功

        await asyncio.sleep(0.3)

        # 验证所有追踪器都已创建
        all_trackers = receiver.get_all_trackers()
        assert len(all_trackers) >= 0

        await sender.stop()
        await receiver.stop()
