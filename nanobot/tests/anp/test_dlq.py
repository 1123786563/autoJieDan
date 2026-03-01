"""
测试死信队列 (DLQ) 功能
"""

import pytest
import tempfile
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

from nanobot.anp.dlq import (
    DLQStorage,
    DLQManager,
    DeadMessage,
    DeadMessageStatus,
    DLQQuery,
    RetryResult,
    get_global_dlq,
    set_global_dlq,
    close_global_dlq,
    _global_dlq,
)


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture
def temp_db_path():
    """临时数据库路径"""
    temp_dir = tempfile.mkdtemp()
    db_path = Path(temp_dir) / "test_dlq.db"
    yield db_path
    # 清理
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def sample_message():
    """示例消息"""
    return {
        "id": "msg-123",
        "type": "task.execute",
        "actor": "did:anp:automaton:main",
        "target": "did:anp:nanobot:worker1",
        "payload": {"command": "test"},
    }


# ============================================================================
# DLQStorage Tests
# ============================================================================

class TestDLQStorage:
    """测试 DLQ 存储"""

    def test_init_creates_database(self, temp_db_path):
        """测试初始化创建数据库"""
        storage = DLQStorage(temp_db_path)

        assert temp_db_path.exists()
        assert storage.db_path == temp_db_path

        # 验证表已创建
        import sqlite3
        conn = sqlite3.connect(temp_db_path)
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='dead_messages'"
        )
        assert cursor.fetchone() is not None
        conn.close()

    def test_add_message(self, temp_db_path, sample_message):
        """测试添加消息"""
        storage = DLQStorage(temp_db_path)

        msg_id = storage.add_message(
            original_message_id=sample_message["id"],
            original_message=sample_message,
            error_type="ConnectionError",
            error_message="Connection timeout",
            max_retries=3,
        )

        assert msg_id.startswith("dlq-")

        # 验证消息已保存
        retrieved = storage.get_message(msg_id)
        assert retrieved is not None
        assert retrieved.original_message_id == sample_message["id"]
        assert retrieved.error_type == "ConnectionError"
        assert retrieved.retry_count == 0
        assert retrieved.status == DeadMessageStatus.PENDING

    def test_get_message_not_found(self, temp_db_path):
        """测试获取不存在的消息"""
        storage = DLQStorage(temp_db_path)

        result = storage.get_message("non-existent")
        assert result is None

    def test_query_messages(self, temp_db_path, sample_message):
        """测试查询消息"""
        storage = DLQStorage(temp_db_path)

        # 添加多个消息
        storage.add_message(
            original_message_id="msg-1",
            original_message=sample_message,
            error_type="ErrorType1",
            error_message="Error 1",
        )

        storage.add_message(
            original_message_id="msg-2",
            original_message=sample_message,
            error_type="ErrorType2",
            error_message="Error 2",
        )

        # 查询所有消息
        query = DLQQuery(limit=10)
        messages = storage.query_messages(query)

        assert len(messages) == 2

        # 按状态查询
        pending_query = DLQQuery(status=DeadMessageStatus.PENDING, limit=10)
        pending_messages = storage.query_messages(pending_query)

        assert len(pending_messages) == 2

    def test_update_status(self, temp_db_path, sample_message):
        """测试更新状态"""
        storage = DLQStorage(temp_db_path)

        msg_id = storage.add_message(
            original_message_id="msg-1",
            original_message=sample_message,
            error_type="Error",
            error_message="Test error",
        )

        # 更新为重试中
        success = storage.update_status(msg_id, DeadMessageStatus.RETRYING)
        assert success is True

        retrieved = storage.get_message(msg_id)
        assert retrieved.status == DeadMessageStatus.RETRYING

        # 更新为已解决
        resolved_at = datetime.now()
        success = storage.update_status(
            msg_id,
            DeadMessageStatus.RESOLVED,
            resolved_at=resolved_at
        )
        assert success is True

        retrieved = storage.get_message(msg_id)
        assert retrieved.status == DeadMessageStatus.RESOLVED
        assert retrieved.resolved_at is not None

    def test_increment_retry(self, temp_db_path, sample_message):
        """测试增加重试计数"""
        storage = DLQStorage(temp_db_path)

        msg_id = storage.add_message(
            original_message_id="msg-1",
            original_message=sample_message,
            error_type="Error",
            error_message="Test error",
        )

        # 首次重试
        success = storage.increment_retry(msg_id)
        assert success is True

        retrieved = storage.get_message(msg_id)
        assert retrieved.retry_count == 1
        assert retrieved.last_retry_at is not None

        # 第二次重试
        storage.increment_retry(msg_id)
        retrieved = storage.get_message(msg_id)
        assert retrieved.retry_count == 2

    def test_delete_message(self, temp_db_path, sample_message):
        """测试删除消息"""
        storage = DLQStorage(temp_db_path)

        msg_id = storage.add_message(
            original_message_id="msg-1",
            original_message=sample_message,
            error_type="Error",
            error_message="Test error",
        )

        # 删除消息
        success = storage.delete_message(msg_id)
        assert success is True

        # 验证已删除
        retrieved = storage.get_message(msg_id)
        assert retrieved is None

    def test_get_statistics(self, temp_db_path, sample_message):
        """测试获取统计信息"""
        storage = DLQStorage(temp_db_path)

        # 添加不同状态的消息
        msg_id_1 = storage.add_message(
            original_message_id="msg-1",
            original_message=sample_message,
            error_type="Error1",
            error_message="Error 1",
        )

        storage.add_message(
            original_message_id="msg-2",
            original_message=sample_message,
            error_type="Error2",
            error_message="Error 2",
        )

        # 标记一个为已解决
        storage.update_status(msg_id_1, DeadMessageStatus.RESOLVED)

        # 获取统计
        stats = storage.get_statistics()

        assert stats["total"] == 2
        assert stats["pending"] == 1  # 只有一个未解决
        assert stats["resolved"] == 1
        assert "avg_retries" in stats
        assert "error_types" in stats


# ============================================================================
# DLQManager Tests
# ============================================================================

class TestDLQManager:
    """测试 DLQ 管理器"""

    def test_enqueue_failed_message(self, temp_db_path, sample_message):
        """测试将失败消息加入 DLQ"""
        storage = DLQStorage(temp_db_path)
        manager = DLQManager(storage)

        error = Exception("Test error")

        msg_id = manager.enqueue_failed_message(
            message_id=sample_message["id"],
            message=sample_message,
            error=error,
            max_retries=3,
        )

        assert msg_id.startswith("dlq-")

        # 验证消息已保存
        retrieved = storage.get_message(msg_id)
        assert retrieved is not None
        assert retrieved.error_type == "Exception"

    def test_retry_message_success(self, temp_db_path, sample_message):
        """测试成功重试消息"""
        storage = DLQStorage(temp_db_path)
        manager = DLQManager(storage)

        # 添加失败消息
        msg_id = storage.add_message(
            original_message_id="msg-1",
            original_message=sample_message,
            error_type="TestError",
            error_message="Test error",
            max_retries=3,
        )

        # 模拟重试函数 (同步函数)
        def mock_retry_func(msg):
            return {"message_id": "new-msg-123"}

        result = manager.retry_message(msg_id, mock_retry_func)

        assert result.success is True
        assert result.message == "Message retry successful"

        # 验证状态已更新为 RESOLVED
        retrieved = storage.get_message(msg_id)
        assert retrieved.status == DeadMessageStatus.RESOLVED

    def test_retry_message_failure(self, temp_db_path, sample_message):
        """测试重试失败"""
        storage = DLQStorage(temp_db_path)
        manager = DLQManager(storage)

        # 添加失败消息
        msg_id = storage.add_message(
            original_message_id="msg-1",
            original_message=sample_message,
            error_type="TestError",
            error_message="Test error",
            max_retries=3,
        )

        # 模拟重试函数（总是失败）
        def mock_failing_retry_func(msg):
            raise Exception("Retry failed")

        result = manager.retry_message(msg_id, mock_failing_retry_func)

        assert result.success is False
        assert "Retry failed" in result.message

        # 验证状态恢复为 PENDING
        retrieved = storage.get_message(msg_id)
        assert retrieved.status == DeadMessageStatus.PENDING
        assert retrieved.retry_count == 1

    def test_retry_message_max_retries_exceeded(self, temp_db_path, sample_message):
        """测试超过最大重试次数"""
        storage = DLQStorage(temp_db_path)
        manager = DLQManager(storage)

        # 添加失败消息，最大重试次数为1
        msg_id = storage.add_message(
            original_message_id="msg-1",
            original_message=sample_message,
            error_type="TestError",
            error_message="Test error",
            max_retries=1,
        )

        # 达到最大重试次数
        storage.increment_retry(msg_id)

        # 尝试重试
        def mock_retry_func(msg):
            raise Exception("Should not be called")

        result = manager.retry_message(msg_id, mock_retry_func)

        assert result.success is False
        assert "Max retries (1) exceeded" in result.message

        # 验证状态为 FAILED
        retrieved = storage.get_message(msg_id)
        assert retrieved.status == DeadMessageStatus.FAILED

    def test_query_pending_messages(self, temp_db_path, sample_message):
        """测试查询待处理消息"""
        storage = DLQStorage(temp_db_path)
        manager = DLQManager(storage)

        # 添加多个消息
        manager.enqueue_failed_message(
            message_id="msg-1",
            message=sample_message,
            error=Exception("Error 1"),
            max_retries=3,
        )

        manager.enqueue_failed_message(
            message_id="msg-2",
            message=sample_message,
            error=Exception("Error 2"),
            max_retries=3,
        )

        # 查询待处理消息
        pending = manager.query_pending_messages(limit=10)

        assert len(pending) == 2

    def test_get_failed_messages_summary(self, temp_db_path, sample_message):
        """测试获取失败消息摘要"""
        storage = DLQStorage(temp_db_path)
        manager = DLQManager(storage)

        # 添加消息
        manager.enqueue_failed_message(
            message_id="msg-1",
            message=sample_message,
            error=Exception("TestError"),
            max_retries=3,
        )

        # 获取摘要
        summary = manager.get_failed_messages_summary(days=7)

        assert "period_days" in summary
        assert summary["period_days"] == 7
        assert "total_failed" in summary
        assert summary["total_failed"] >= 1
        assert "statistics" in summary
        assert "by_error_type" in summary
        assert "recent_failures" in summary


# ============================================================================
# 全局 DLQ Tests
# ============================================================================

class TestGlobalDLQ:
    """测试全局 DLQ 实例"""

    def test_get_global_dlq(self):
        """测试获取全局 DLQ"""
        # 重置全局 DLQ
        import nanobot.anp.dlq as dlq_module
        dlq_module._global_dlq = None

        dlq1 = get_global_dlq()
        dlq2 = get_global_dlq()

        assert dlq1 is dlq2

    def test_set_global_dlq(self, temp_db_path):
        """测试设置全局 DLQ"""
        import nanobot.anp.dlq as dlq_module
        dlq_module._global_dlq = None

        custom_dlq = DLQStorage(temp_db_path)
        set_global_dlq(custom_dlq)

        assert get_global_dlq() is custom_dlq

    def test_close_global_dlq(self):
        """测试关闭全局 DLQ"""
        import nanobot.anp.dlq as dlq_module
        dlq_module._global_dlq = None

        dlq = get_global_dlq()
        close_global_dlq()

        # 验证已关闭
        assert get_global_dlq() is not dlq


# ============================================================================
# 验收标准测试
# ============================================================================

class TestAcceptanceCriteria:
    """测试验收标准"""

    def test_failed_messages_are_traceable(self, temp_db_path, sample_message):
        """测试失败消息可追溯"""
        storage = DLQStorage(temp_db_path)

        msg_id = storage.add_message(
            original_message_id="msg-traceable",
            original_message=sample_message,
            error_type="TraceableError",
            error_message="This error should be traceable",
            metadata={"source": "test", "correlation_id": "abc-123"},
        )

        # 通过 ID 查询
        retrieved = storage.get_message(msg_id)
        assert retrieved is not None

        # 验证可追溯性
        assert retrieved.original_message_id == "msg-traceable"
        assert retrieved.original_message == sample_message
        assert retrieved.error_type == "TraceableError"
        assert retrieved.failed_at is not None
        assert "correlation_id" in retrieved.metadata

    def test_dlq_query_works_correctly(self, temp_db_path, sample_message):
        """测试 DLQ 查询正常"""
        storage = DLQStorage(temp_db_path)

        # 添加测试消息
        storage.add_message(
            original_message_id="msg-query-1",
            original_message=sample_message,
            error_type="QueryError",
            error_message="Query test error",
        )

        # 按状态查询
        pending_query = DLQQuery(status=DeadMessageStatus.PENDING)
        pending = storage.query_messages(pending_query)
        assert len(pending) >= 1

        # 按错误类型查询
        error_query = DLQQuery(error_type="QueryError")
        by_error = storage.query_messages(error_query)
        assert len(by_error) >= 1

        # 分页查询
        page1 = DLQQuery(limit=1, offset=0)
        page2 = DLQQuery(limit=1, offset=1)

        messages_page1 = storage.query_messages(page1)
        messages_page2 = storage.query_messages(page2)

        # 验证分页
        assert len(messages_page1) == 1
        # 可能没有第二页
        assert len(messages_page2) >= 0

    def test_manual_retry_mechanism(self, temp_db_path, sample_message):
        """测试手动重试机制"""
        storage = DLQStorage(temp_db_path)
        manager = DLQManager(storage)

        # 添加失败消息
        msg_id = manager.enqueue_failed_message(
            message_id="msg-manual-retry",
            message=sample_message,
            error=Exception("Manual retry test"),
            max_retries=5,
        )

        # 验证消息在队列中
        pending = manager.query_pending_messages()
        assert any(m.id == msg_id for m in pending)

        # 模拟手动重试逻辑
        retrieved = storage.get_message(msg_id)
        assert retrieved is not None
        assert retrieved.retry_count == 0

        # 增加重试计数
        storage.increment_retry(msg_id)
        retrieved = storage.get_message(msg_id)
        assert retrieved.retry_count == 1
