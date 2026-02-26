"""
TLS 安全配置管理
提供证书管理、TLS 配置和安全连接验证

@module interagent/tls_manager
@version 1.0.0
"""

import os
import ssl
import hashlib
import secrets
import base64
import threading
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from pathlib import Path


# ============================================================================
# 枚举类型
# ============================================================================


class CertificateType(str, Enum):
    """证书类型"""

    ROOT = "root"
    INTERMEDIATE = "intermediate"
    SERVER = "server"
    CLIENT = "client"


class CertificateStatus(str, Enum):
    """证书状态"""

    VALID = "valid"
    EXPIRED = "expired"
    REVOKED = "revoked"
    PENDING = "pending"


class KeyType(str, Enum):
    """密钥类型"""

    RSA = "rsa"
    ECDSA = "ecdsa"
    ED25519 = "ed25519"


# ============================================================================
# 数据类
# ============================================================================


@dataclass
class CertificateSubject:
    """证书主题"""

    common_name: str
    country: Optional[str] = None
    state: Optional[str] = None
    locality: Optional[str] = None
    organization: Optional[str] = None
    organizational_unit: Optional[str] = None
    email_address: Optional[str] = None

    def format(self) -> str:
        """格式化主题字符串"""
        parts = []
        if self.country:
            parts.append(f"C={self.country}")
        if self.state:
            parts.append(f"ST={self.state}")
        if self.locality:
            parts.append(f"L={self.locality}")
        if self.organization:
            parts.append(f"O={self.organization}")
        if self.organizational_unit:
            parts.append(f"OU={self.organizational_unit}")
        parts.append(f"CN={self.common_name}")
        if self.email_address:
            parts.append(f"emailAddress={self.email_address}")
        return ", ".join(parts)


@dataclass
class CertificateExtension:
    """证书扩展"""

    name: str
    critical: bool
    value: str


@dataclass
class CertificateInfo:
    """证书信息"""

    id: str
    type: CertificateType
    subject: str
    issuer: str
    serial_number: str
    fingerprint: str
    not_before: datetime
    not_after: datetime
    status: CertificateStatus = CertificateStatus.VALID
    san: List[str] = field(default_factory=list)
    key_type: KeyType = KeyType.RSA
    key_size: int = 2048
    self_signed: bool = True
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TLSConfig:
    """TLS 配置"""

    ca_cert_path: Optional[str] = None
    cert_path: Optional[str] = None
    key_path: Optional[str] = None
    request_cert: bool = True
    reject_unauthorized: bool = True
    min_version: Optional[str] = None
    max_version: Optional[str] = None
    ciphers: Optional[str] = None
    enable_ocsp: bool = False
    crl_path: Optional[str] = None


@dataclass
class TLSConnectionInfo:
    """TLS 连接信息"""

    authorized: bool
    cipher: str
    version: str
    authorization_error: Optional[str] = None
    peer_certificate: Optional[CertificateInfo] = None
    local_address: Optional[str] = None
    remote_address: Optional[str] = None


@dataclass
class TLSManagerConfig:
    """TLS 管理器配置"""

    default_config: TLSConfig = field(default_factory=TLSConfig)
    cert_store_path: str = "./certs"
    auto_renew: bool = True
    renew_before_days: int = 30


# ============================================================================
# EventEmitter
# ============================================================================


class EventEmitter:
    """简单的事件发射器"""

    def __init__(self) -> None:
        self._listeners: Dict[str, List[Callable]] = {}
        self._once_listeners: Dict[str, List[Callable]] = {}

    def on(self, event: str, handler: Callable) -> None:
        """注册事件监听器"""
        if event not in self._listeners:
            self._listeners[event] = []
        self._listeners[event].append(handler)

    def once(self, event: str, handler: Callable) -> None:
        """注册一次性事件监听器"""
        if event not in self._once_listeners:
            self._once_listeners[event] = []
        self._once_listeners[event].append(handler)

    def off(self, event: str, handler: Callable) -> None:
        """移除事件监听器"""
        if event in self._listeners:
            self._listeners[event] = [h for h in self._listeners[event] if h != handler]
        if event in self._once_listeners:
            self._once_listeners[event] = [
                h for h in self._once_listeners[event] if h != handler
            ]

    def emit(self, event: str, *args: Any, **kwargs: Any) -> None:
        """发射事件"""
        if event in self._listeners:
            for handler in self._listeners[event]:
                try:
                    handler(*args, **kwargs)
                except Exception:
                    pass

        if event in self._once_listeners:
            for handler in self._once_listeners[event]:
                try:
                    handler(*args, **kwargs)
                except Exception:
                    pass
            self._once_listeners[event] = []

    def remove_all_listeners(self, event: Optional[str] = None) -> None:
        """移除所有监听器"""
        if event:
            self._listeners.pop(event, None)
            self._once_listeners.pop(event, None)
        else:
            self._listeners.clear()
            self._once_listeners.clear()

    def listener_count(self, event: str) -> int:
        """获取监听器数量"""
        count = len(self._listeners.get(event, []))
        count += len(self._once_listeners.get(event, []))
        return count


# ============================================================================
# 辅助函数
# ============================================================================


def _generate_serial_number() -> str:
    """生成证书序列号"""
    return secrets.token_hex(16)


def _generate_certificate_id() -> str:
    """生成证书 ID"""
    return f"cert-{int(datetime.now().timestamp() * 1000)}-{secrets.token_hex(8)}"


def _calculate_fingerprint(data: str) -> str:
    """计算指纹"""
    return hashlib.sha256(data.encode()).hexdigest().upper()


def _ensure_directory(path: str) -> None:
    """确保目录存在"""
    Path(path).mkdir(parents=True, exist_ok=True)


# ============================================================================
# TLSManager 类
# ============================================================================


class TLSManager(EventEmitter):
    """TLS 管理器"""

    def __init__(self, config: Optional[TLSManagerConfig] = None) -> None:
        super().__init__()
        self._config = config or TLSManagerConfig()
        self._certificates: Dict[str, CertificateInfo] = {}
        self._renewal_timers: Dict[str, threading.Timer] = {}
        self._ensure_cert_store()

    def _ensure_cert_store(self) -> None:
        """确保证书存储目录存在"""
        _ensure_directory(self._config.cert_store_path)

    # =========================================================================
    # 证书生成
    # =========================================================================

    def generate_self_signed_certificate(
        self,
        cert_type: CertificateType,
        subject: CertificateSubject,
        days: int = 365,
        key_type: KeyType = KeyType.RSA,
        key_size: Optional[int] = None,
        san: Optional[List[str]] = None,
        extensions: Optional[List[CertificateExtension]] = None,
    ) -> Tuple[str, str, CertificateInfo]:
        """
        生成自签名证书

        Args:
            cert_type: 证书类型
            subject: 证书主题
            days: 有效期（天）
            key_type: 密钥类型
            key_size: 密钥大小
            san: Subject Alternative Names
            extensions: 证书扩展

        Returns:
            (证书内容, 私钥内容, 证书信息)
        """
        actual_key_size = key_size or (2048 if key_type == KeyType.RSA else 256)

        # 生成证书信息
        cert_id = _generate_certificate_id()
        serial_number = _generate_serial_number()
        now = datetime.now()
        not_before = now
        not_after = now + timedelta(days=days)

        # 生成简化证书内容
        cert_content = self._create_certificate_pem(
            id=cert_id,
            serial_number=serial_number,
            subject=subject,
            issuer=subject,  # 自签名
            not_before=not_before,
            not_after=not_after,
            san=san or [],
            extensions=extensions or [],
        )

        # 生成模拟私钥
        key_content = self._create_private_key_pem(key_type, actual_key_size)

        # 计算指纹
        fingerprint = _calculate_fingerprint(cert_content)

        info = CertificateInfo(
            id=cert_id,
            type=cert_type,
            subject=subject.format(),
            issuer=subject.format(),  # 自签名
            serial_number=serial_number,
            fingerprint=fingerprint,
            not_before=not_before,
            not_after=not_after,
            status=CertificateStatus.VALID,
            san=san or [],
            key_type=key_type,
            key_size=actual_key_size,
            self_signed=True,
            metadata={},
        )

        # 存储证书信息
        self._certificates[cert_id] = info

        # 保存到文件
        self._save_certificate(cert_id, cert_content, key_content)

        # 设置自动续期
        if self._config.auto_renew:
            self._schedule_renewal(cert_id, info)

        self.emit("certificate:generated", info)

        return cert_content, key_content, info

    def _create_certificate_pem(
        self,
        id: str,
        serial_number: str,
        subject: CertificateSubject,
        issuer: CertificateSubject,
        not_before: datetime,
        not_after: datetime,
        san: List[str],
        extensions: List[CertificateExtension],
    ) -> str:
        """创建证书 PEM 内容"""
        lines = ["-----BEGIN CERTIFICATE-----"]

        cert_data = [
            f"Version: 3",
            f"Serial Number: {serial_number}",
            f"Subject: {subject.format()}",
            f"Issuer: {issuer.format()}",
            f"Not Before: {not_before.isoformat()}",
            f"Not After: {not_after.isoformat()}",
            f"SAN: {', '.join(san)}",
            f"ID: {id}",
        ]

        base64_content = base64.b64encode("\n".join(cert_data).encode()).decode()
        lines.append(base64_content)
        lines.append("-----END CERTIFICATE-----")

        return "\n".join(lines)

    def _create_private_key_pem(self, key_type: KeyType, key_size: int) -> str:
        """创建私钥 PEM 内容"""
        lines = ["-----BEGIN PRIVATE KEY-----"]

        # 模拟私钥数据
        key_data = f"{key_type.value}-{key_size}-{secrets.token_hex(32)}"
        base64_content = base64.b64encode(key_data.encode()).decode()

        # 分行
        chunk_size = 64
        for i in range(0, len(base64_content), chunk_size):
            lines.append(base64_content[i : i + chunk_size])

        lines.append("-----END PRIVATE KEY-----")

        return "\n".join(lines)

    def _save_certificate(
        self, cert_id: str, cert: str, key: str
    ) -> None:
        """保存证书到文件"""
        cert_path = os.path.join(self._config.cert_store_path, f"{cert_id}.crt")
        key_path = os.path.join(self._config.cert_store_path, f"{cert_id}.key")

        with open(cert_path, "w") as f:
            f.write(cert)

        # 私钥权限更严格
        with open(key_path, "w") as f:
            f.write(key)
        os.chmod(key_path, 0o600)

    # =========================================================================
    # 证书管理
    # =========================================================================

    def load_certificate(self, cert_id: str) -> Optional[Tuple[str, str]]:
        """加载证书"""
        cert_path = os.path.join(self._config.cert_store_path, f"{cert_id}.crt")
        key_path = os.path.join(self._config.cert_store_path, f"{cert_id}.key")

        if not os.path.exists(cert_path) or not os.path.exists(key_path):
            return None

        with open(cert_path, "r") as f:
            cert = f.read()

        with open(key_path, "r") as f:
            key = f.read()

        return cert, key

    def get_certificate_info(self, cert_id: str) -> Optional[CertificateInfo]:
        """获取证书信息"""
        return self._certificates.get(cert_id)

    def list_certificates(
        self,
        cert_type: Optional[CertificateType] = None,
        status: Optional[CertificateStatus] = None,
    ) -> List[CertificateInfo]:
        """列出证书"""
        result = list(self._certificates.values())

        if cert_type:
            result = [c for c in result if c.type == cert_type]
        if status:
            result = [c for c in result if c.status == status]

        return result

    def revoke_certificate(self, cert_id: str) -> bool:
        """撤销证书"""
        info = self._certificates.get(cert_id)
        if not info:
            return False

        info.status = CertificateStatus.REVOKED
        self._certificates[cert_id] = info
        self._clear_renewal_timer(cert_id)

        self.emit("certificate:revoked", info)

        return True

    def delete_certificate(self, cert_id: str) -> bool:
        """删除证书"""
        cert_path = os.path.join(self._config.cert_store_path, f"{cert_id}.crt")
        key_path = os.path.join(self._config.cert_store_path, f"{cert_id}.key")

        if os.path.exists(cert_path):
            os.unlink(cert_path)
        if os.path.exists(key_path):
            os.unlink(key_path)

        self._certificates.pop(cert_id, None)
        self._clear_renewal_timer(cert_id)

        self.emit("certificate:deleted", cert_id)

        return True

    # =========================================================================
    # 自动续期
    # =========================================================================

    def _schedule_renewal(self, cert_id: str, info: CertificateInfo) -> None:
        """安排证书续期"""
        now = datetime.now()
        renew_time = info.not_after - timedelta(days=self._config.renew_before_days)

        delay = max(0, (renew_time - now).total_seconds())

        def on_renewal_due() -> None:
            self.emit("certificate:renewal:due", info)

        timer = threading.Timer(delay, on_renewal_due)
        timer.start()

        self._renewal_timers[cert_id] = timer

    def _clear_renewal_timer(self, cert_id: str) -> None:
        """清理续期计时器"""
        timer = self._renewal_timers.pop(cert_id, None)
        if timer:
            timer.cancel()

    # =========================================================================
    # TLS 配置
    # =========================================================================

    def get_server_ssl_context(
        self, cert_id: str, custom_config: Optional[TLSConfig] = None
    ) -> ssl.SSLContext:
        """获取服务器 SSL 上下文"""
        cert_data = self.load_certificate(cert_id)
        if not cert_data:
            raise ValueError(f"Certificate not found: {cert_id}")

        cert, key = cert_data
        config = custom_config or self._config.default_config

        # 创建 SSL 上下文
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)

        # 加载证书
        context.load_cert_chain(
            certfile=self._get_cert_path(cert_id),
            keyfile=self._get_key_path(cert_id),
        )

        # 配置验证
        if config.request_cert:
            context.verify_mode = ssl.CERT_REQUIRED if config.reject_unauthorized else ssl.CERT_OPTIONAL

        # 配置协议版本
        if config.min_version:
            version_map = {
                "TLSv1.2": ssl.TLSVersion.TLSv1_2,
                "TLSv1.3": ssl.TLSVersion.TLSv1_3,
            }
            if config.min_version in version_map:
                context.minimum_version = version_map[config.min_version]

        # 配置密码套件
        if config.ciphers:
            context.set_ciphers(config.ciphers)

        # 加载 CA 证书
        if config.ca_cert_path and os.path.exists(config.ca_cert_path):
            context.load_verify_locations(config.ca_cert_path)

        return context

    def get_client_ssl_context(
        self, cert_id: Optional[str] = None, custom_config: Optional[TLSConfig] = None
    ) -> ssl.SSLContext:
        """获取客户端 SSL 上下文"""
        config = custom_config or self._config.default_config

        # 创建 SSL 上下文
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)

        # 配置验证
        context.verify_mode = ssl.CERT_REQUIRED if config.reject_unauthorized else ssl.CERT_NONE

        # 配置协议版本
        if config.min_version:
            version_map = {
                "TLSv1.2": ssl.TLSVersion.TLSv1_2,
                "TLSv1.3": ssl.TLSVersion.TLSv1_3,
            }
            if config.min_version in version_map:
                context.minimum_version = version_map[config.min_version]

        # 加载客户端证书
        if cert_id:
            cert_data = self.load_certificate(cert_id)
            if cert_data:
                context.load_cert_chain(
                    certfile=self._get_cert_path(cert_id),
                    keyfile=self._get_key_path(cert_id),
                )

        # 加载 CA 证书
        if config.ca_cert_path and os.path.exists(config.ca_cert_path):
            context.load_verify_locations(config.ca_cert_path)

        return context

    def _get_cert_path(self, cert_id: str) -> str:
        """获取证书文件路径"""
        return os.path.join(self._config.cert_store_path, f"{cert_id}.crt")

    def _get_key_path(self, cert_id: str) -> str:
        """获取私钥文件路径"""
        return os.path.join(self._config.cert_store_path, f"{cert_id}.key")

    # =========================================================================
    # 验证
    # =========================================================================

    def validate_certificate(
        self, cert_id: str
    ) -> Tuple[bool, List[str], List[str]]:
        """
        验证证书

        Returns:
            (是否有效, 错误列表, 警告列表)
        """
        errors: List[str] = []
        warnings: List[str] = []

        info = self._certificates.get(cert_id)
        if not info:
            return False, ["Certificate not found"], warnings

        # 检查状态
        if info.status == CertificateStatus.REVOKED:
            errors.append("Certificate has been revoked")

        if info.status == CertificateStatus.EXPIRED:
            errors.append("Certificate has expired")

        # 检查有效期
        now = datetime.now()
        if info.not_after < now:
            errors.append("Certificate has expired")
        elif info.not_after < now + timedelta(days=30):
            warnings.append("Certificate will expire within 30 days")

        if info.not_before > now:
            errors.append("Certificate is not yet valid")

        # 检查密钥强度
        if info.key_type == KeyType.RSA and info.key_size < 2048:
            warnings.append("RSA key size is less than 2048 bits")

        is_valid = len(errors) == 0
        return is_valid, errors, warnings

    def get_tls_connection_info(self, ssl_socket: ssl.SSLSocket) -> TLSConnectionInfo:
        """获取 TLS 连接信息"""
        peer_cert_der = ssl_socket.getpeercert(binary_form=True)
        peer_cert: Optional[CertificateInfo] = None

        if peer_cert_der:
            # 解析对端证书（简化）
            peer_cert = CertificateInfo(
                id=hashlib.sha256(peer_cert_der).hexdigest()[:32],
                type=CertificateType.SERVER,
                subject="Unknown",
                issuer="Unknown",
                serial_number="Unknown",
                fingerprint=hashlib.sha256(peer_cert_der).hexdigest().upper(),
                not_before=datetime.now(),
                not_after=datetime.now(),
                status=CertificateStatus.VALID,
            )

        cipher = ssl_socket.cipher()
        version = ssl_socket.version()

        return TLSConnectionInfo(
            authorized=ssl_socket.getpeercert() is not None,
            authorization_error=None,
            peer_certificate=peer_cert,
            cipher=cipher[0] if cipher else "Unknown",
            version=version or "Unknown",
            local_address=ssl_socket.getsockname()[0] if ssl_socket.getsockname() else None,
            remote_address=ssl_socket.getpeername()[0] if ssl_socket.getpeername() else None,
        )

    # =========================================================================
    # 统计
    # =========================================================================

    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        certs = list(self._certificates.values())
        now = datetime.now()
        thirty_days_from_now = now + timedelta(days=30)

        by_type: Dict[str, int] = {}
        by_status: Dict[str, int] = {}
        expiring_within_30_days = 0

        for cert in certs:
            by_type[cert.type.value] = by_type.get(cert.type.value, 0) + 1
            by_status[cert.status.value] = by_status.get(cert.status.value, 0) + 1

            if cert.not_after < thirty_days_from_now and cert.not_after > now:
                expiring_within_30_days += 1

        return {
            "totalCertificates": len(certs),
            "byType": by_type,
            "byStatus": by_status,
            "expiringWithin30Days": expiring_within_30_days,
        }

    # =========================================================================
    # 清理
    # =========================================================================

    def close(self) -> None:
        """关闭管理器"""
        for timer in self._renewal_timers.values():
            timer.cancel()
        self._renewal_timers.clear()

        self.remove_all_listeners()


# ============================================================================
# 工厂函数
# ============================================================================


def create_tls_manager(config: Optional[TLSManagerConfig] = None) -> TLSManager:
    """创建 TLS 管理器"""
    return TLSManager(config)


# ============================================================================
# 格式化函数
# ============================================================================


def format_certificate_info(info: CertificateInfo) -> str:
    """格式化证书信息"""
    lines = [
        "=== 证书信息 ===",
        f"ID: {info.id}",
        f"类型: {info.type.value}",
        f"主题: {info.subject}",
        f"颁发者: {info.issuer}",
        f"序列号: {info.serial_number}",
        f"指纹: {info.fingerprint}",
        f"生效时间: {info.not_before.isoformat()}",
        f"过期时间: {info.not_after.isoformat()}",
        f"状态: {info.status.value}",
        f"密钥类型: {info.key_type.value}",
        f"密钥大小: {info.key_size}",
        f"自签名: {'是' if info.self_signed else '否'}",
    ]

    if info.san:
        lines.append(f"SAN: {', '.join(info.san)}")

    return "\n".join(lines)


def format_tls_config(config: TLSConfig) -> str:
    """格式化 TLS 配置"""
    lines = [
        "=== TLS 配置 ===",
        f"请求客户端证书: {'是' if config.request_cert else '否'}",
        f"拒绝未授权: {'是' if config.reject_unauthorized else '否'}",
        f"最小版本: {config.min_version or '默认'}",
        f"密码套件: {(config.ciphers or '默认')[:50]}...",
    ]

    if config.ca_cert_path:
        lines.append(f"CA 证书: {config.ca_cert_path}")

    if config.cert_path:
        lines.append(f"服务器证书: {config.cert_path}")

    return "\n".join(lines)


def format_connection_info(info: TLSConnectionInfo) -> str:
    """格式化连接信息"""
    lines = [
        "=== TLS 连接 ===",
        f"已授权: {'是' if info.authorized else '否'}",
        f"TLS 版本: {info.version}",
        f"密码套件: {info.cipher}",
    ]

    if info.authorization_error:
        lines.append(f"授权错误: {info.authorization_error}")

    if info.peer_certificate:
        lines.append(f"对端主题: {info.peer_certificate.subject}")

    if info.remote_address:
        lines.append(f"远程地址: {info.remote_address}")

    return "\n".join(lines)
