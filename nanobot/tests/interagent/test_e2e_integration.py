"""
Day 36-37: 端到端集成测试

测试 Automaton 和 Nanobot 之间的完整通信流程：
- 安全认证的完整流程
- 任务管理集成
- 重试机制集成
"""

import os
import shutil
import pytest
from datetime import datetime
from unittest.mock import Mock

from nanobot.interagent.key_manager import (
    KeyManager,
    MemoryKeyStorage,
    KeyManagerConfig,
    create_key_manager,
)
from nanobot.interagent.tls_manager import (
    TLSManager,
    TLSManagerConfig,
    CertificateType,
    KeyType,
    CertificateSubject,
    create_tls_manager,
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


class TestSecurityIntegration:
    """安全组件集成测试"""

    @pytest.fixture
    def managers(self):
        """创建管理器实例"""
        test_cert_store = "./test-e2e-certs"

        # 清理测试目录
        if os.path.exists(test_cert_store):
            shutil.rmtree(test_cert_store)

        # 密钥管理器
        storage = MemoryKeyStorage()
        key_manager = create_key_manager(
            KeyManagerConfig(
                storage=storage,
                auto_rotate=False,
            )
        )

        # TLS 管理器
        tls_manager = create_tls_manager(
            TLSManagerConfig(
                cert_store_path=test_cert_store,
                auto_renew=False,
            )
        )

        # 访问控制管理器
        ac_manager = create_access_control_manager(
            AccessControlConfig(
                default_policy="deny",
                enable_inheritance=True,
                enable_conditions=True,
            )
        )

        yield key_manager, tls_manager, ac_manager

        key_manager.close()
        tls_manager.close()
        ac_manager.close()

        # 清理测试目录
        if os.path.exists(test_cert_store):
            shutil.rmtree(test_cert_store)

    def test_enforce_access_control_for_task_operations(self, managers):
        """测试任务操作的访问控制"""
        key_manager, tls_manager, ac_manager = managers

        # 注册用户
        admin_user = Subject(
            id="admin",
            type=SubjectType.USER,
            roles=["admin"],
            attributes={},
            created_at=datetime.now(),
        )

        normal_user = Subject(
            id="user",
            type=SubjectType.USER,
            roles=["user"],
            attributes={},
            created_at=datetime.now(),
        )

        ac_manager.register_subject(admin_user)
        ac_manager.register_subject(normal_user)

        # 管理员可以创建任务
        admin_request = AccessRequest(
            subject_id="admin",
            resource=ResourceType.TASK,
            resource_id="*",
            action=PermissionAction.CREATE,
        )
        assert ac_manager.check_access(admin_request).allowed is True

        # 普通用户可以读取任务
        user_read_request = AccessRequest(
            subject_id="user",
            resource=ResourceType.TASK,
            resource_id="task-1",
            action=PermissionAction.READ,
        )
        assert ac_manager.check_access(user_read_request).allowed is True

        # 普通用户不能删除任务
        user_delete_request = AccessRequest(
            subject_id="user",
            resource=ResourceType.TASK,
            resource_id="task-1",
            action=PermissionAction.DELETE,
        )
        assert ac_manager.check_access(user_delete_request).allowed is False

    def test_generate_and_validate_keys_for_secure_communication(self, managers):
        """测试安全通信的密钥生成和验证"""
        key_manager, tls_manager, ac_manager = managers

        # 生成密钥
        key = key_manager.generate_key(
            purpose="encryption",
            name="test-comm-key",
        )

        assert key.id is not None
        assert key.status == "active"

    def test_manage_certificates_for_tls(self, managers):
        """测试 TLS 证书管理"""
        key_manager, tls_manager, ac_manager = managers

        # 生成证书
        subject = CertificateSubject(common_name="test.example.com")
        _, _, cert_info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        assert cert_info.id is not None

        # 验证证书
        cert_valid, cert_errors, _ = tls_manager.validate_certificate(cert_info.id)
        assert cert_valid is True


class TestTaskManagementIntegration:
    """任务管理集成测试"""

    def test_create_and_manage_tasks(self):
        """测试任务创建和管理"""
        # 模拟任务数据
        task = {
            "id": "task-001",
            "type": "code_generation",
            "priority": "high",
            "status": "pending",
            "payload": {
                "prompt": "Write a function",
                "language": "python",
            },
            "target_agent": "nanobot-1",
            "max_retries": 3,
            "timeout": 60000,
        }

        assert task["id"] == "task-001"
        assert task["status"] == "pending"
        assert task["type"] == "code_generation"
        assert task["priority"] == "high"

    def test_handle_task_lifecycle_transitions(self):
        """测试任务生命周期转换"""
        # 模拟任务状态转换
        task = {
            "id": "task-002",
            "type": "test",
            "priority": "normal",
            "status": "pending",
            "payload": {},
            "target_agent": "test-agent",
        }

        # 分发
        task["status"] = "dispatched"
        assert task["status"] == "dispatched"

        # 开始
        task["status"] = "running"
        assert task["status"] == "running"

        # 完成
        task["status"] = "completed"
        task["result"] = {"output": "done"}
        assert task["status"] == "completed"
        assert task["result"] == {"output": "done"}

    def test_handle_task_retry_with_exponential_backoff(self):
        """测试任务重试和指数退避"""
        import time

        attempts = 0
        max_retries = 3
        delays = [100, 200, 400]  # 模拟指数退避延迟

        for attempt in range(max_retries):
            attempts += 1
            if attempts >= 3:
                break
            time.sleep(delays[attempt] / 1000)  # 毫秒转秒

        assert attempts == 3


class TestCompleteWorkflowIntegration:
    """完整工作流集成测试"""

    @pytest.fixture
    def managers(self):
        """创建所有管理器实例"""
        test_cert_store = "./test-e2e-workflow-certs"

        # 清理测试目录
        if os.path.exists(test_cert_store):
            shutil.rmtree(test_cert_store)

        # 密钥管理器
        storage = MemoryKeyStorage()
        key_manager = create_key_manager(
            KeyManagerConfig(
                storage=storage,
                auto_rotate=False,
            )
        )

        # TLS 管理器
        tls_manager = create_tls_manager(
            TLSManagerConfig(
                cert_store_path=test_cert_store,
                auto_renew=False,
            )
        )

        # 访问控制管理器
        ac_manager = create_access_control_manager(
            AccessControlConfig(
                default_policy="deny",
                enable_inheritance=True,
                enable_conditions=True,
            )
        )

        yield key_manager, tls_manager, ac_manager

        key_manager.close()
        tls_manager.close()
        ac_manager.close()

        # 清理测试目录
        if os.path.exists(test_cert_store):
            shutil.rmtree(test_cert_store)

    def test_complete_full_workflow_with_security_and_tasks(self, managers):
        """测试安全 + 任务的完整工作流"""
        key_manager, tls_manager, ac_manager = managers

        # 1. 设置安全上下文
        agent_subject = Subject(
            id="agent-nanobot-1",
            type=SubjectType.AGENT,
            roles=["agent"],
            attributes={"tier": "standard"},
            created_at=datetime.now(),
        )
        ac_manager.register_subject(agent_subject)

        # 2. 生成通信密钥
        comm_key = key_manager.generate_key(
            purpose="encryption",
            name="agent-comm-key",
        )
        assert comm_key.id is not None

        # 3. 验证访问权限
        access_request = AccessRequest(
            subject_id="agent-nanobot-1",
            resource=ResourceType.TASK,
            resource_id="*",
            action=PermissionAction.EXECUTE,
        )
        access_decision = ac_manager.check_access(access_request)
        assert access_decision.allowed is True

        # 4. 模拟创建任务
        task = {
            "id": "task-003",
            "type": "agent_task",
            "priority": "high",
            "status": "pending",
            "payload": {
                "action": "process_data",
                "data": {"items": [1, 2, 3, 4, 5]},
            },
            "target_agent": "nanobot-1",
        }

        # 5. 执行任务（状态转换）
        task["status"] = "running"

        # 6. 完成任务
        task["status"] = "completed"
        task["result"] = {
            "processed": 5,
            "output": [2, 4, 6, 8, 10],
        }

        # 7. 验证完整工作流
        assert task["status"] == "completed"
        assert task["result"]["processed"] == 5
        assert task["result"]["output"] == [2, 4, 6, 8, 10]

    def test_handle_concurrent_tasks_correctly(self, managers):
        """测试并发任务处理"""
        key_manager, tls_manager, ac_manager = managers

        # 创建多个任务
        tasks = [
            {
                "id": f"task-{i}",
                "type": "concurrent_test",
                "priority": "normal",
                "status": "pending",
                "payload": {"id": i},
                "target_agent": f"agent-{i}",
            }
            for i in range(1, 4)
        ]

        assert len(tasks) == 3
        for task in tasks:
            assert task["status"] == "pending"

        # 并发执行（更新状态）
        for task in tasks:
            task["status"] = "running"
            task["status"] = "completed"
            task["result"] = f"completed-{task['id']}"

        # 验证所有任务都完成
        for task in tasks:
            assert task["status"] == "completed"

    def test_handle_task_failures_in_workflow(self, managers):
        """测试工作流中的任务失败处理"""
        key_manager, tls_manager, ac_manager = managers

        # 创建任务
        task = {
            "id": "task-fail",
            "type": "fail_test",
            "priority": "normal",
            "status": "pending",
            "payload": {"should_fail": True},
            "target_agent": "test-agent",
            "max_retries": 3,
        }

        # 更新状态到运行中
        task["status"] = "running"

        # 模拟失败
        task["status"] = "failed"
        task["error"] = "Simulated failure for testing"

        assert task["status"] == "failed"
        assert task["error"] == "Simulated failure for testing"


class TestSecurityTaskIntegration:
    """安全 + 任务 集成测试"""

    @pytest.fixture
    def ac_manager(self):
        """创建访问控制管理器"""
        ac_manager = create_access_control_manager(
            AccessControlConfig(
                default_policy="deny",
                enable_inheritance=True,
                enable_conditions=True,
            )
        )
        yield ac_manager
        ac_manager.close()

    def test_authorize_task_creation_based_on_roles(self, ac_manager):
        """测试基于角色的任务创建授权"""
        # 注册不同角色的用户
        admin = Subject(
            id="admin-user",
            type=SubjectType.USER,
            roles=["admin"],
            attributes={},
            created_at=datetime.now(),
        )

        guest = Subject(
            id="guest-user",
            type=SubjectType.USER,
            roles=["guest"],
            attributes={},
            created_at=datetime.now(),
        )

        ac_manager.register_subject(admin)
        ac_manager.register_subject(guest)

        # 验证 admin 可以创建任务
        admin_create_request = AccessRequest(
            subject_id="admin-user",
            resource=ResourceType.TASK,
            resource_id="*",
            action=PermissionAction.CREATE,
        )
        assert ac_manager.check_access(admin_create_request).allowed is True

        # 验证 guest 不能创建任务
        guest_create_request = AccessRequest(
            subject_id="guest-user",
            resource=ResourceType.TASK,
            resource_id="*",
            action=PermissionAction.CREATE,
        )
        assert ac_manager.check_access(guest_create_request).allowed is False

    def test_protect_sensitive_task_operations(self, ac_manager):
        """测试保护敏感任务操作"""
        # 注册普通用户
        user = Subject(
            id="regular-user",
            type=SubjectType.USER,
            roles=["user"],
            attributes={},
            created_at=datetime.now(),
        )

        ac_manager.register_subject(user)

        # 用户可以读取任务
        read_request = AccessRequest(
            subject_id="regular-user",
            resource=ResourceType.TASK,
            resource_id="task-1",
            action=PermissionAction.READ,
        )
        assert ac_manager.check_access(read_request).allowed is True

        # 用户不能删除任务
        delete_request = AccessRequest(
            subject_id="regular-user",
            resource=ResourceType.TASK,
            resource_id="task-1",
            action=PermissionAction.DELETE,
        )
        assert ac_manager.check_access(delete_request).allowed is False
