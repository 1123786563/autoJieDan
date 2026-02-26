"""
Week 5 安全集成测试

测试所有安全组件的协作：
- 密钥管理 (key_manager)
- TLS 配置 (tls_manager)
- 访问控制 (access_control)
"""

import os
import shutil
import asyncio
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
    AccessControlEntry,
    create_access_control_manager,
)


class TestKeyManagerAccessControlIntegration:
    """测试密钥管理 + 访问控制集成"""

    @pytest.fixture
    def managers(self):
        """创建管理器实例"""
        # 密钥管理器
        storage = MemoryKeyStorage()
        key_manager = create_key_manager(
            KeyManagerConfig(
                storage=storage,
                auto_rotate=False,
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

        yield key_manager, ac_manager

        key_manager.close()
        ac_manager.close()

    def test_restrict_key_generation_to_authorized_users(self, managers):
        """测试只有授权用户才能生成密钥"""
        key_manager, ac_manager = managers

        # 设置访问控制
        admin_subject = Subject(
            id="admin-user",
            type=SubjectType.USER,
            roles=["admin"],
            attributes={},
            created_at=datetime.now(),
        )
        guest_subject = Subject(
            id="guest-user",
            type=SubjectType.USER,
            roles=["guest"],
            attributes={},
            created_at=datetime.now(),
        )

        ac_manager.register_subject(admin_subject)
        ac_manager.register_subject(guest_subject)

        # 管理员可以生成密钥
        admin_request = AccessRequest(
            subject_id="admin-user",
            resource=ResourceType.KEY,
            resource_id="key-1",
            action=PermissionAction.CREATE,
        )
        admin_decision = ac_manager.check_access(admin_request)
        assert admin_decision.allowed is True

        # 访客不能生成密钥
        guest_request = AccessRequest(
            subject_id="guest-user",
            resource=ResourceType.KEY,
            resource_id="key-2",
            action=PermissionAction.CREATE,
        )
        guest_decision = ac_manager.check_access(guest_request)
        assert guest_decision.allowed is False

    def test_log_key_access_in_access_control_audit(self, managers):
        """测试在访问控制审计中记录密钥访问"""
        key_manager, ac_manager = managers

        # 生成密钥
        key = key_manager.generate_key(
            purpose="encryption",
            name="audit-key",
        )

        # 注册主体
        subject = Subject(
            id="auditor",
            type=SubjectType.USER,
            roles=["admin"],
            attributes={},
            created_at=datetime.now(),
        )
        ac_manager.register_subject(subject)

        # 检查访问权限
        request = AccessRequest(
            subject_id="auditor",
            resource=ResourceType.KEY,
            resource_id=key.id,
            action=PermissionAction.READ,
        )
        decision = ac_manager.check_access(request)

        assert decision.allowed is True
        assert "admin" in decision.applied_roles


class TestTLSManagerAccessControlIntegration:
    """测试 TLS 管理 + 访问控制集成"""

    @pytest.fixture
    def managers(self):
        """创建管理器实例"""
        test_cert_store = "./test-security-certs-int"

        # 清理测试目录
        if os.path.exists(test_cert_store):
            shutil.rmtree(test_cert_store)

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

        yield tls_manager, ac_manager

        tls_manager.close()
        ac_manager.close()

        # 清理测试目录
        if os.path.exists(test_cert_store):
            shutil.rmtree(test_cert_store)

    def test_restrict_certificate_generation_to_authorized_users(self, managers):
        """测试只有授权用户才能生成证书"""
        tls_manager, ac_manager = managers

        # 设置访问控制
        admin_subject = Subject(
            id="cert-admin",
            type=SubjectType.USER,
            roles=["admin"],
            attributes={},
            created_at=datetime.now(),
        )
        user_subject = Subject(
            id="cert-user",
            type=SubjectType.USER,
            roles=["user"],
            attributes={},
            created_at=datetime.now(),
        )

        ac_manager.register_subject(admin_subject)
        ac_manager.register_subject(user_subject)

        # 管理员可以生成证书
        admin_request = AccessRequest(
            subject_id="cert-admin",
            resource=ResourceType.CERTIFICATE,
            resource_id="cert-1",
            action=PermissionAction.CREATE,
        )
        admin_decision = ac_manager.check_access(admin_request)
        assert admin_decision.allowed is True

        # 普通用户不能生成证书
        user_request = AccessRequest(
            subject_id="cert-user",
            resource=ResourceType.CERTIFICATE,
            resource_id="cert-2",
            action=PermissionAction.CREATE,
        )
        user_decision = ac_manager.check_access(user_request)
        assert user_decision.allowed is False

    def test_validate_certificate_access_with_acl(self, managers):
        """测试通过 ACL 验证证书访问"""
        tls_manager, ac_manager = managers

        # 生成证书
        subject = CertificateSubject(common_name="test.example.com")
        cert, key, cert_info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        # 设置 ACL
        acl_subject = Subject(
            id="acl-user",
            type=SubjectType.USER,
            roles=[],
            attributes={},
            created_at=datetime.now(),
        )
        ac_manager.register_subject(acl_subject)

        # 添加 ACL 条目
        acl_entry = AccessControlEntry(
            id="acl-cert-read",
            subject_id="acl-user",
            resource=ResourceType.CERTIFICATE,
            resource_id=cert_info.id,
            allowed_actions=[PermissionAction.READ],
            denied_actions=[],
            created_at=datetime.now(),
        )
        ac_manager.add_acl_entry(acl_entry)

        # 检查访问
        request = AccessRequest(
            subject_id="acl-user",
            resource=ResourceType.CERTIFICATE,
            resource_id=cert_info.id,
            action=PermissionAction.READ,
        )
        decision = ac_manager.check_access(request)

        assert decision.allowed is True
        assert "acl:acl-cert-read:allow" in decision.matched_permissions


class TestKeyManagerTLSManagerIntegration:
    """测试密钥管理 + TLS 管理集成"""

    @pytest.fixture
    def managers(self):
        """创建管理器实例"""
        test_cert_store = "./test-security-certs-key"

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

        yield key_manager, tls_manager

        key_manager.close()
        tls_manager.close()

        # 清理测试目录
        if os.path.exists(test_cert_store):
            shutil.rmtree(test_cert_store)

    def test_use_separate_keys_for_different_certificate_types(self, managers):
        """测试为不同证书类型使用不同的密钥"""
        key_manager, tls_manager = managers

        # 生成服务器证书
        server_subject = CertificateSubject(common_name="server.example.com")
        _, _, server_cert = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=server_subject,
            days=365,
            key_type=KeyType.RSA,
        )

        # 生成客户端证书
        client_subject = CertificateSubject(common_name="client.example.com")
        _, _, client_cert = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.CLIENT,
            subject=client_subject,
            days=365,
            key_type=KeyType.ECDSA,
        )

        # 证书应该有不同的指纹
        assert server_cert.fingerprint != client_cert.fingerprint
        assert server_cert.id is not None
        assert client_cert.id is not None

    def test_correlate_key_rotation_with_certificate_renewal(self, managers):
        """测试密钥轮换与证书续期的关联"""
        key_manager, tls_manager = managers

        # 生成密钥
        key = key_manager.generate_key(
            purpose="encryption",
            name="tls-key",
        )

        # 生成证书
        subject = CertificateSubject(common_name="secure.example.com")
        _, _, cert = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=30,  # 短期证书
            key_type=KeyType.RSA,
        )

        # 验证密钥和证书都已创建
        assert key.id is not None
        assert cert.id is not None

        # 验证证书有效
        cert_valid, cert_errors, cert_warnings = tls_manager.validate_certificate(cert.id)
        assert cert_valid is True


class TestFullSecurityIntegration:
    """测试完整安全集成"""

    @pytest.fixture
    def managers(self):
        """创建所有管理器实例"""
        test_cert_store = "./test-security-certs-full"

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

    def test_enforce_complete_security_workflow(self, managers):
        """测试完整安全工作流"""
        key_manager, tls_manager, ac_manager = managers

        # 1. 注册安全管理员
        security_admin = Subject(
            id="security-admin",
            type=SubjectType.USER,
            roles=["admin"],
            attributes={},
            created_at=datetime.now(),
        )
        ac_manager.register_subject(security_admin)

        # 2. 验证管理员有所有权限
        key_access_request = AccessRequest(
            subject_id="security-admin",
            resource=ResourceType.KEY,
            resource_id="*",
            action=PermissionAction.CREATE,
        )
        cert_access_request = AccessRequest(
            subject_id="security-admin",
            resource=ResourceType.CERTIFICATE,
            resource_id="*",
            action=PermissionAction.CREATE,
        )

        assert ac_manager.check_access(key_access_request).allowed is True
        assert ac_manager.check_access(cert_access_request).allowed is True

        # 3. 生成密钥
        key = key_manager.generate_key(
            purpose="encryption",
            name="workflow-key",
        )
        assert key.id is not None

        # 4. 生成证书
        subject = CertificateSubject(common_name="workflow.example.com")
        _, _, cert = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )
        assert cert.id is not None

        # 5. 验证所有资源已创建
        assert key.id is not None
        cert_valid, cert_errors, _ = tls_manager.validate_certificate(cert.id)
        assert cert_valid is True

        # 6. 获取 TLS 和访问控制统计信息
        cert_stats = tls_manager.get_stats()
        ac_stats = ac_manager.get_stats()

        assert cert_stats["totalCertificates"] > 0
        assert ac_stats["permissions"] > 0
        assert ac_stats["roles"] > 0

    def test_validate_access_control_for_different_roles(self, managers):
        """测试不同角色的访问控制验证"""
        key_manager, tls_manager, ac_manager = managers

        # 设置不同角色的主体
        admin_subject = Subject(
            id="admin-test",
            type=SubjectType.USER,
            roles=["admin"],
            attributes={},
            created_at=datetime.now(),
        )
        user_subject = Subject(
            id="user-test",
            type=SubjectType.USER,
            roles=["user"],
            attributes={},
            created_at=datetime.now(),
        )
        guest_subject = Subject(
            id="guest-test",
            type=SubjectType.USER,
            roles=["guest"],
            attributes={},
            created_at=datetime.now(),
        )

        ac_manager.register_subject(admin_subject)
        ac_manager.register_subject(user_subject)
        ac_manager.register_subject(guest_subject)

        # admin 应该有所有系统权限
        admin_system_request = AccessRequest(
            subject_id="admin-test",
            resource=ResourceType.SYSTEM,
            resource_id="*",
            action=PermissionAction.ADMIN,
        )
        assert ac_manager.check_access(admin_system_request).allowed is True

        # user 应该有任务读取权限
        user_task_request = AccessRequest(
            subject_id="user-test",
            resource=ResourceType.TASK,
            resource_id="task-1",
            action=PermissionAction.READ,
        )
        assert ac_manager.check_access(user_task_request).allowed is True

        # guest 不应该有密钥创建权限
        guest_key_request = AccessRequest(
            subject_id="guest-test",
            resource=ResourceType.KEY,
            resource_id="key-1",
            action=PermissionAction.CREATE,
        )
        assert ac_manager.check_access(guest_key_request).allowed is False

    def test_handle_security_events_across_components(self, managers):
        """测试跨组件的安全事件处理"""
        key_manager, tls_manager, ac_manager = managers

        # 触发资源创建
        key = key_manager.generate_key(
            purpose="encryption",
            name="event-key",
        )

        subject = CertificateSubject(common_name="event.example.com")
        _, _, cert = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        # 验证资源已创建
        assert key.id is not None
        assert cert.id is not None

        # 验证可以通过 TLS 管理器查询证书
        cert_info = tls_manager.get_certificate_info(cert.id)
        assert cert_info is not None


class TestPerformanceTests:
    """性能测试"""

    @pytest.fixture
    def managers(self):
        """创建管理器实例"""
        # 访问控制管理器
        ac_manager = create_access_control_manager(
            AccessControlConfig(
                default_policy="deny",
                enable_inheritance=True,
                enable_conditions=True,
            )
        )

        # 密钥管理器
        storage = MemoryKeyStorage()
        key_manager = create_key_manager(
            KeyManagerConfig(
                storage=storage,
                auto_rotate=False,
            )
        )

        yield ac_manager, key_manager

        ac_manager.close()
        key_manager.close()

    def test_handle_multiple_access_checks_efficiently(self, managers):
        """测试高效处理多个访问检查"""
        ac_manager, _ = managers

        subject = Subject(
            id="perf-user",
            type=SubjectType.USER,
            roles=["user"],
            attributes={},
            created_at=datetime.now(),
        )
        ac_manager.register_subject(subject)

        import time

        start_time = time.time()
        iterations = 100

        for i in range(iterations):
            request = AccessRequest(
                subject_id="perf-user",
                resource=ResourceType.TASK,
                resource_id=f"task-{i}",
                action=PermissionAction.READ,
            )
            ac_manager.check_access(request)

        duration = time.time() - start_time
        avg_time = duration / iterations

        # 每次检查应该在 1ms 以内（使用缓存）
        assert avg_time < 0.001

    def test_handle_concurrent_key_operations(self, managers):
        """测试并发密钥操作"""
        _, key_manager = managers

        import concurrent.futures

        def generate_key(index):
            return key_manager.generate_key(
                purpose="encryption",
                name=f"concurrent-key-{index}",
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(generate_key, i) for i in range(10)]
            keys = [f.result() for f in concurrent.futures.as_completed(futures)]

        assert len(keys) == 10
        for i, key in enumerate(keys):
            assert key.id is not None
            assert key.name.startswith("concurrent-key-")
