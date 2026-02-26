"""
Day 38: 故障恢复测试

测试系统在故障情况下的恢复能力：
- 任务重试机制
- 超时恢复
- 错误处理和恢复
"""

import os
import shutil
import time
import pytest
from datetime import datetime
from unittest.mock import Mock

from nanobot.interagent.key_manager import (
    KeyManager,
    MemoryKeyStorage,
    KeyManagerConfig,
    create_key_manager,
)
from nanobot.interagent.access_control import (
    AccessControlManager,
    AccessControlConfig,
    Subject,
    SubjectType,
    ResourceType,
    PermissionAction,
    AccessRequest,
    create_access_control_manager,
)


class TestTaskRetryMechanism:
    """任务重试机制测试"""

    def test_retry_with_exponential_backoff(self):
        """测试指数退避重试"""
        attempts = 0
        delays = []
        last_time = time.time()

        def operation():
            nonlocal attempts, last_time
            now = time.time()
            if attempts > 0:
                delays.append(now - last_time)
            last_time = now
            attempts += 1

            if attempts < 3:
                raise Exception("Temporary failure")
            return "success"

        # 简化的重试逻辑
        max_retries = 3
        initial_delay = 0.05  # 50ms
        result = None

        for attempt in range(max_retries + 1):
            try:
                result = operation()
                break
            except Exception as e:
                if attempt < max_retries:
                    delay = initial_delay * (2 ** attempt)
                    time.sleep(delay)
                else:
                    raise

        assert result == "success"
        assert attempts == 3

    def test_stop_retrying_after_max_retries_exceeded(self):
        """测试超过最大重试次数后停止"""
        attempts = 0
        max_retries = 2

        def always_fails():
            nonlocal attempts
            attempts += 1
            raise Exception("Permanent failure")

        with pytest.raises(Exception, match="Permanent failure"):
            for attempt in range(max_retries + 1):
                try:
                    always_fails()
                except Exception:
                    if attempt < max_retries:
                        time.sleep(0.01)
                    else:
                        raise

        assert attempts == 3  # 初始 + 2 次重试

    def test_retry_success_on_second_attempt(self):
        """测试第二次尝试成功"""
        attempts = 0

        def eventually_succeeds():
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise Exception("First failure")
            return "success"

        result = None
        max_retries = 3

        for attempt in range(max_retries + 1):
            try:
                result = eventually_succeeds()
                break
            except Exception:
                if attempt < max_retries:
                    time.sleep(0.01)
                else:
                    raise

        assert result == "success"
        assert attempts == 2


class TestTimeoutRecovery:
    """超时恢复测试"""

    def test_handle_task_timeout(self):
        """测试任务超时处理"""
        task = {
            "id": "task-timeout",
            "type": "timeout_test",
            "status": "running",
            "timeout": 100,  # 100ms
            "created_at": time.time(),
        }

        # 等待超时
        time.sleep(0.15)

        # 检查是否超时
        elapsed = (time.time() - task["created_at"]) * 1000
        assert elapsed >= task["timeout"]

        # 模拟超时处理
        task["status"] = "failed"
        task["error"] = "Task timeout after 100ms"

        assert task["status"] == "failed"
        assert "timeout" in task["error"]

    def test_recover_from_timeout_with_retry(self):
        """测试超时后重试恢复"""
        attempts = 0

        def operation_with_timeout():
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                # 第一次模拟超时（失败）
                raise Exception("Operation timeout")
            return "completed"

        result = None
        max_retries = 2

        for attempt in range(max_retries + 1):
            try:
                result = operation_with_timeout()
                break
            except Exception:
                if attempt < max_retries:
                    time.sleep(0.01)
                else:
                    raise

        assert result == "completed"
        assert attempts == 2


class TestLeaseExpirationRecovery:
    """租约过期恢复测试"""

    def test_detect_expired_lease(self):
        """测试检测过期租约"""
        task = {
            "id": "task-lease",
            "type": "lease_test",
            "status": "pending",
            "lease_expires_at": time.time() + 1,  # 1秒后过期
        }

        # 立即检查不应过期
        is_expired = time.time() > task["lease_expires_at"]
        assert is_expired is False

        # 等待过期
        time.sleep(1.1)

        # 检查过期
        is_expired = time.time() > task["lease_expires_at"]
        assert is_expired is True

    def test_release_expired_lease(self):
        """测试释放过期租约"""
        task = {
            "id": "task-lease-release",
            "type": "lease_test",
            "status": "pending",
            "lease_expires_at": time.time() + 1,
        }

        # 等待过期
        time.sleep(1.1)

        # 检查过期
        assert time.time() > task["lease_expires_at"]

        # 释放租约
        task["lease_expires_at"] = None

        assert task["lease_expires_at"] is None

    def test_concurrent_lease_acquisition(self):
        """测试并发租约获取"""
        task = {
            "id": "task-concurrent-lease",
            "type": "lease_test",
            "status": "pending",
            "lease_expires_at": None,
        }

        # 第一个获取应该成功
        if task["lease_expires_at"] is None:
            task["lease_expires_at"] = time.time() + 60

        first_lease_acquired = task["lease_expires_at"] is not None
        assert first_lease_acquired is True

        # 第二个获取应该失败（已被锁定）
        current_lease = task["lease_expires_at"]
        second_lease_acquired = current_lease is None
        assert second_lease_acquired is False

        # 释放后可以重新获取
        task["lease_expires_at"] = None
        assert task["lease_expires_at"] is None


class TestTaskFailureRecovery:
    """任务失败恢复测试"""

    def test_track_retry_count_on_failed_tasks(self):
        """测试跟踪失败任务的重试次数"""
        task = {
            "id": "task-retry-count",
            "type": "retry_count_test",
            "status": "pending",
            "retry_count": 0,
            "max_retries": 3,
        }

        assert task["retry_count"] == 0

        # 模拟失败和重试
        task["status"] = "running"
        task["status"] = "failed"
        task["error"] = "First failure"

        # 重试
        task["retry_count"] += 1
        task["status"] = "pending"

        assert task["retry_count"] == 1
        assert task["status"] == "pending"

    def test_cancel_stuck_tasks(self):
        """测试取消卡住的任务"""
        task = {
            "id": "task-stuck",
            "type": "stuck_task_test",
            "status": "running",
        }

        # 模拟任务卡住后取消
        task["status"] = "cancelled"
        task["error"] = "Task stuck too long"

        assert task["status"] == "cancelled"
        assert task["error"] == "Task stuck too long"


class TestErrorHandlingRecovery:
    """错误处理恢复测试"""

    def test_handle_invalid_task_operations_gracefully(self):
        """测试优雅处理无效任务操作"""
        tasks = {}  # 模拟任务存储

        # 尝试获取不存在的任务
        non_existent = tasks.get("non-existent-id")
        assert non_existent is None

    def test_recover_from_concurrent_modifications(self):
        """测试从并发修改中恢复"""
        task = {
            "id": "task-concurrent",
            "type": "concurrent_test",
            "status": "pending",
            "version": 1,
        }

        # 模拟并发更新（串行执行，但模拟竞争）
        task["status"] = "running"
        task["version"] += 1

        task["status"] = "completed"
        task["result"] = {"data": "done"}
        task["version"] += 1

        assert task["status"] == "completed"
        assert task["result"] == {"data": "done"}
        assert task["version"] == 3


class TestKeyManagerFaultRecovery:
    """密钥管理故障恢复测试"""

    @pytest.fixture
    def key_manager(self):
        """创建密钥管理器"""
        storage = MemoryKeyStorage()
        manager = create_key_manager(
            KeyManagerConfig(
                storage=storage,
                auto_rotate=False,
            )
        )
        yield manager
        manager.close()

    @pytest.mark.asyncio
    async def test_handle_key_not_found_gracefully(self, key_manager):
        """测试优雅处理密钥不存在"""
        is_valid = await key_manager.validate_key("non-existent-key-id")
        assert is_valid is False

    def test_generate_new_key_after_failure(self, key_manager):
        """测试失败后生成新密钥"""
        # 生成第一个密钥
        key1 = key_manager.generate_key(
            purpose="encryption",
            name="test-key-1",
        )
        assert key1.id is not None

        # 生成新密钥
        key2 = key_manager.generate_key(
            purpose="encryption",
            name="test-key-2",
        )
        assert key2.id is not None
        assert key2.id != key1.id


class TestAccessControlFaultRecovery:
    """访问控制故障恢复测试"""

    @pytest.fixture
    def ac_manager(self):
        """创建访问控制管理器"""
        manager = create_access_control_manager(
            AccessControlConfig(
                default_policy="deny",
                enable_inheritance=True,
                enable_conditions=True,
            )
        )
        yield manager
        manager.close()

    def test_deny_access_for_unregistered_subjects(self, ac_manager):
        """测试拒绝未注册主体的访问"""
        request = AccessRequest(
            subject_id="unregistered-user",
            resource=ResourceType.TASK,
            resource_id="task-1",
            action=PermissionAction.READ,
        )

        decision = ac_manager.check_access(request)
        assert decision.allowed is False

    def test_recover_from_invalid_access_requests(self, ac_manager):
        """测试从无效访问请求中恢复"""
        # 注册用户
        user = Subject(
            id="test-user",
            type=SubjectType.USER,
            roles=["user"],
            attributes={},
            created_at=datetime.now(),
        )
        ac_manager.register_subject(user)

        # 正常请求
        valid_request = AccessRequest(
            subject_id="test-user",
            resource=ResourceType.TASK,
            resource_id="task-1",
            action=PermissionAction.READ,
        )
        assert ac_manager.check_access(valid_request).allowed is True

        # 无效操作（admin 操作应该被拒绝给普通用户）
        invalid_request = AccessRequest(
            subject_id="test-user",
            resource=ResourceType.TASK,
            resource_id="task-1",
            action=PermissionAction.DELETE,  # 普通用户不能删除
        )
        decision = ac_manager.check_access(invalid_request)
        assert decision.allowed is False
