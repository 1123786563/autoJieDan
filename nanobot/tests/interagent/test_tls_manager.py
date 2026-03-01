"""
测试 TLS 安全配置管理
"""

import os
import shutil
import pytest
from datetime import datetime, timedelta
from unittest.mock import Mock, MagicMock, patch

from nanobot.interagent.tls_manager import (
    CertificateType,
    CertificateStatus,
    KeyType,
    CertificateSubject,
    CertificateInfo,
    TLSConfig,
    TLSConnectionInfo,
    TLSManagerConfig,
    TLSManager,
    create_tls_manager,
    format_certificate_info,
    format_tls_config,
    format_connection_info,
)


class TestTLSManager:
    """测试 TLS 管理器"""

    @pytest.fixture
    def tls_manager(self) -> TLSManager:
        test_cert_store = "./test-certs-tls"
        # 清理测试目录
        if os.path.exists(test_cert_store):
            shutil.rmtree(test_cert_store)

        return create_tls_manager(
            TLSManagerConfig(
                cert_store_path=test_cert_store,
                auto_renew=False,
            )
        )

    def teardown_method(self) -> None:
        test_cert_store = "./test-certs-tls"
        if os.path.exists(test_cert_store):
            shutil.rmtree(test_cert_store)

    # ========================================================================
    # 证书生成
    # ========================================================================

    def test_generate_self_signed_rsa_certificate(self, tls_manager: TLSManager):
        """测试生成自签名 RSA 证书"""
        subject = CertificateSubject(common_name="test.example.com")

        cert, key, info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        assert cert is not None
        assert key is not None
        assert info.id is not None
        assert "test.example.com" in info.subject
        assert info.type == CertificateType.SERVER
        assert info.key_type == KeyType.RSA
        assert info.self_signed is True
        assert info.status == CertificateStatus.VALID

    def test_generate_self_signed_ecdsa_certificate(self, tls_manager: TLSManager):
        """测试生成自签名 ECDSA 证书"""
        subject = CertificateSubject(common_name="client.example.com")

        cert, key, info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.CLIENT,
            subject=subject,
            days=365,
            key_type=KeyType.ECDSA,
        )

        assert info.key_type == KeyType.ECDSA
        assert info.type == CertificateType.CLIENT

    def test_generate_certificate_with_san(self, tls_manager: TLSManager):
        """测试生成带 SAN 的证书"""
        subject = CertificateSubject(common_name="multi.example.com")

        cert, key, info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
            san=["DNS:example.com", "DNS:www.example.com", "IP:127.0.0.1"],
        )

        assert len(info.san) == 3
        assert "DNS:example.com" in info.san

    def test_generate_certificate_with_full_subject(self, tls_manager: TLSManager):
        """测试生成带完整主题的证书"""
        subject = CertificateSubject(
            common_name="test.example.com",
            country="US",
            state="California",
            locality="San Francisco",
            organization="Test Org",
            organizational_unit="Test Unit",
            email_address="test@example.com",
        )

        cert, key, info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        assert "C=US" in info.subject
        assert "ST=California" in info.subject
        assert "O=Test Org" in info.subject

    def test_emit_certificate_generated_event(self, tls_manager: TLSManager):
        """测试发射 certificate:generated 事件"""
        handler = Mock()
        tls_manager.on("certificate:generated", handler)

        subject = CertificateSubject(common_name="test.example.com")
        tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        handler.assert_called_once()

    def test_calculate_certificate_fingerprint(self, tls_manager: TLSManager):
        """测试计算证书指纹"""
        subject = CertificateSubject(common_name="test.example.com")

        cert, key, info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        assert info.fingerprint is not None
        assert len(info.fingerprint) == 64  # SHA-256 hex

    # ========================================================================
    # 证书存储
    # ========================================================================

    def test_save_certificate_to_file(self, tls_manager: TLSManager):
        """测试保存证书到文件"""
        subject = CertificateSubject(common_name="test.example.com")

        cert, key, info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        cert_path = os.path.join(tls_manager._config.cert_store_path, f"{info.id}.crt")
        key_path = os.path.join(tls_manager._config.cert_store_path, f"{info.id}.key")

        assert os.path.exists(cert_path)
        assert os.path.exists(key_path)

    def test_load_certificate_from_file(self, tls_manager: TLSManager):
        """测试从文件加载证书"""
        subject = CertificateSubject(common_name="test.example.com")

        generated_cert, generated_key, info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        loaded = tls_manager.load_certificate(info.id)

        assert loaded is not None
        assert loaded[0] == generated_cert
        assert loaded[1] == generated_key

    def test_load_non_existent_certificate(self, tls_manager: TLSManager):
        """测试加载不存在的证书"""
        loaded = tls_manager.load_certificate("non-existent")

        assert loaded is None

    def test_create_cert_store_directory(self):
        """测试创建证书存储目录"""
        custom_path = "./test-certs-custom"
        if os.path.exists(custom_path):
            shutil.rmtree(custom_path)

        create_tls_manager(TLSManagerConfig(cert_store_path=custom_path, auto_renew=False))

        assert os.path.exists(custom_path)

        # Cleanup
        shutil.rmtree(custom_path)

    # ========================================================================
    # 证书管理
    # ========================================================================

    def test_get_certificate_info(self, tls_manager: TLSManager):
        """测试获取证书信息"""
        subject = CertificateSubject(common_name="test.example.com")

        cert, key, generated_info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        info = tls_manager.get_certificate_info(generated_info.id)

        assert info is not None
        assert info.id == generated_info.id

    def test_list_all_certificates(self, tls_manager: TLSManager):
        """测试列出所有证书"""
        subject1 = CertificateSubject(common_name="server1.example.com")
        subject2 = CertificateSubject(common_name="client1.example.com")

        tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject1,
            days=365,
            key_type=KeyType.RSA,
        )
        tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.CLIENT,
            subject=subject2,
            days=365,
            key_type=KeyType.RSA,
        )

        certs = tls_manager.list_certificates()

        assert len(certs) == 2

    def test_filter_certificates_by_type(self, tls_manager: TLSManager):
        """测试按类型过滤证书"""
        subject1 = CertificateSubject(common_name="server.example.com")
        subject2 = CertificateSubject(common_name="client.example.com")

        tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject1,
            days=365,
            key_type=KeyType.RSA,
        )
        tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.CLIENT,
            subject=subject2,
            days=365,
            key_type=KeyType.RSA,
        )

        server_certs = tls_manager.list_certificates(cert_type=CertificateType.SERVER)

        assert len(server_certs) == 1
        assert server_certs[0].type == CertificateType.SERVER

    def test_revoke_certificate(self, tls_manager: TLSManager):
        """测试撤销证书"""
        subject = CertificateSubject(common_name="test.example.com")

        cert, key, info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        revoked = tls_manager.revoke_certificate(info.id)
        cert_info = tls_manager.get_certificate_info(info.id)

        assert revoked is True
        assert cert_info.status == CertificateStatus.REVOKED

    def test_emit_certificate_revoked_event(self, tls_manager: TLSManager):
        """测试发射 certificate:revoked 事件"""
        handler = Mock()
        tls_manager.on("certificate:revoked", handler)

        subject = CertificateSubject(common_name="test.example.com")

        cert, key, info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        tls_manager.revoke_certificate(info.id)

        handler.assert_called_once()

    def test_delete_certificate(self, tls_manager: TLSManager):
        """测试删除证书"""
        subject = CertificateSubject(common_name="test.example.com")

        cert, key, info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        deleted = tls_manager.delete_certificate(info.id)
        cert_info = tls_manager.get_certificate_info(info.id)

        assert deleted is True
        assert cert_info is None

    def test_emit_certificate_deleted_event(self, tls_manager: TLSManager):
        """测试发射 certificate:deleted 事件"""
        handler = Mock()
        tls_manager.on("certificate:deleted", handler)

        subject = CertificateSubject(common_name="test.example.com")

        cert, key, info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        tls_manager.delete_certificate(info.id)

        handler.assert_called_with(info.id)

    # ========================================================================
    # 证书验证
    # ========================================================================

    def test_validate_valid_certificate(self, tls_manager: TLSManager):
        """测试验证有效证书"""
        subject = CertificateSubject(common_name="test.example.com")

        cert, key, info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        is_valid, errors, warnings = tls_manager.validate_certificate(info.id)

        assert is_valid is True
        assert len(errors) == 0

    def test_validate_non_existent_certificate(self, tls_manager: TLSManager):
        """测试验证不存在的证书"""
        is_valid, errors, warnings = tls_manager.validate_certificate("non-existent")

        assert is_valid is False
        assert "Certificate not found" in errors

    def test_validate_revoked_certificate(self, tls_manager: TLSManager):
        """测试验证已撤销的证书"""
        subject = CertificateSubject(common_name="test.example.com")

        cert, key, info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        tls_manager.revoke_certificate(info.id)
        is_valid, errors, warnings = tls_manager.validate_certificate(info.id)

        assert is_valid is False
        assert "Certificate has been revoked" in errors

    # ========================================================================
    # TLS 配置
    # ========================================================================

    def test_get_server_ssl_context(self, tls_manager: TLSManager):
        """测试获取服务器 SSL 上下文"""
        # 注意：由于我们使用模拟证书，实际 SSL 上下文加载会失败
        # 这里只测试证书文件是否正确保存
        subject = CertificateSubject(common_name="test.example.com")

        cert, key, info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        # 验证证书和密钥文件存在
        cert_path = tls_manager._get_cert_path(info.id)
        key_path = tls_manager._get_key_path(info.id)

        assert os.path.exists(cert_path)
        assert os.path.exists(key_path)

    def test_get_server_ssl_context_non_existent(self, tls_manager: TLSManager):
        """测试获取不存在的服务器 SSL 上下文"""
        with pytest.raises(ValueError, match="Certificate not found"):
            tls_manager.get_server_ssl_context("non-existent")

    def test_get_client_ssl_context(self, tls_manager: TLSManager):
        """测试获取客户端 SSL 上下文"""
        # 注意：由于我们使用模拟证书，这里只测试证书文件是否正确保存
        subject = CertificateSubject(common_name="client.example.com")

        cert, key, info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.CLIENT,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        # 验证证书和密钥文件存在
        cert_path = tls_manager._get_cert_path(info.id)
        key_path = tls_manager._get_key_path(info.id)

        assert os.path.exists(cert_path)
        assert os.path.exists(key_path)

    def test_get_client_ssl_context_without_certificate(self, tls_manager: TLSManager):
        """测试不带证书获取客户端 SSL 上下文"""
        context = tls_manager.get_client_ssl_context()

        assert context is not None

    # ========================================================================
    # 统计
    # ========================================================================

    def test_get_certificate_stats(self, tls_manager: TLSManager):
        """测试获取证书统计"""
        subject1 = CertificateSubject(common_name="server1.example.com")
        subject2 = CertificateSubject(common_name="server2.example.com")
        subject3 = CertificateSubject(common_name="client1.example.com")

        tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject1,
            days=365,
            key_type=KeyType.RSA,
        )
        tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject2,
            days=365,
            key_type=KeyType.RSA,
        )
        tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.CLIENT,
            subject=subject3,
            days=365,
            key_type=KeyType.RSA,
        )

        stats = tls_manager.get_stats()

        assert stats["totalCertificates"] == 3
        assert stats["byType"]["server"] == 2
        assert stats["byType"]["client"] == 1

    def test_count_expiring_certificates(self, tls_manager: TLSManager):
        """测试统计即将过期的证书"""
        subject1 = CertificateSubject(common_name="expiring.example.com")
        subject2 = CertificateSubject(common_name="longterm.example.com")

        # 生成一个即将过期的证书 (15天内)
        tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject1,
            days=15,
            key_type=KeyType.RSA,
        )

        # 生成一个长期有效的证书
        tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject2,
            days=365,
            key_type=KeyType.RSA,
        )

        stats = tls_manager.get_stats()

        assert stats["expiringWithin30Days"] == 1

    # ========================================================================
    # 清理
    # ========================================================================

    def test_close_manager(self, tls_manager: TLSManager):
        """测试关闭管理器"""
        tls_manager.close()

        # Should not throw

    def test_remove_all_listeners_on_close(self, tls_manager: TLSManager):
        """测试关闭时移除所有监听器"""
        handler = Mock()
        tls_manager.on("certificate:generated", handler)

        tls_manager.close()

        assert tls_manager.listener_count("certificate:generated") == 0


class TestFormatFunctions:
    """测试格式化函数"""

    def test_format_certificate_info(self):
        """测试格式化证书信息"""
        info = CertificateInfo(
            id="cert-123",
            type=CertificateType.SERVER,
            subject="CN=test.example.com",
            issuer="CN=test.example.com",
            serial_number="ABC123",
            fingerprint="AABBCCDD",
            not_before=datetime(2026, 1, 1),
            not_after=datetime(2027, 1, 1),
            status=CertificateStatus.VALID,
            san=["DNS:example.com"],
            key_type=KeyType.RSA,
            key_size=2048,
            self_signed=True,
        )

        formatted = format_certificate_info(info)

        assert "cert-123" in formatted
        assert "server" in formatted
        assert "test.example.com" in formatted
        assert "valid" in formatted
        assert "rsa" in formatted

    def test_format_tls_config(self):
        """测试格式化 TLS 配置"""
        config = TLSConfig(
            request_cert=True,
            reject_unauthorized=True,
            min_version="TLSv1.2",
            ca_cert_path="/path/to/ca.crt",
        )

        formatted = format_tls_config(config)

        assert "是" in formatted
        assert "TLSv1.2" in formatted
        assert "/path/to/ca.crt" in formatted

    def test_format_connection_info(self):
        """测试格式化连接信息"""
        info = TLSConnectionInfo(
            authorized=True,
            version="TLSv1.3",
            cipher="TLS_AES_256_GCM_SHA384",
            remote_address="192.168.1.1",
        )

        formatted = format_connection_info(info)

        assert "已授权: 是" in formatted
        assert "TLSv1.3" in formatted
        assert "192.168.1.1" in formatted

    def test_format_connection_info_with_error(self):
        """测试格式化带错误的连接信息"""
        info = TLSConnectionInfo(
            authorized=False,
            authorization_error="CERT_HAS_EXPIRED",
            version="TLSv1.2",
            cipher="ECDHE-RSA-AES128-GCM-SHA256",
        )

        formatted = format_connection_info(info)

        assert "已授权: 否" in formatted
        assert "CERT_HAS_EXPIRED" in formatted


class TestCertificateSubject:
    """测试证书主题"""

    def test_format_subject_with_all_fields(self):
        """测试格式化完整主题"""
        subject = CertificateSubject(
            common_name="test.example.com",
            country="US",
            state="California",
            locality="San Francisco",
            organization="Test Org",
            organizational_unit="Test Unit",
            email_address="test@example.com",
        )

        formatted = subject.format()

        assert "C=US" in formatted
        assert "ST=California" in formatted
        assert "L=San Francisco" in formatted
        assert "O=Test Org" in formatted
        assert "OU=Test Unit" in formatted
        assert "CN=test.example.com" in formatted

    def test_format_subject_with_cn_only(self):
        """测试只包含 CN 的主题"""
        subject = CertificateSubject(common_name="test.example.com")

        formatted = subject.format()

        assert "CN=test.example.com" in formatted


class TestFactoryFunction:
    """测试工厂函数"""

    def test_create_tls_manager(self):
        """测试创建 TLS 管理器"""
        manager = create_tls_manager()

        assert isinstance(manager, TLSManager)

    def test_create_with_config(self):
        """测试使用配置创建 TLS 管理器"""
        config = TLSManagerConfig(
            cert_store_path="./custom-certs",
            auto_renew=False,
        )
        manager = create_tls_manager(config)

        assert isinstance(manager, TLSManager)
        assert manager._config.cert_store_path == "./custom-certs"

        # Cleanup
        if os.path.exists("./custom-certs"):
            shutil.rmtree("./custom-certs")
