"""
DID (Decentralized Identifier) 管理

用于 ANP 协议的身份验证

@module anp.did
@version 1.0.0
"""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.backends import default_backend

from .types import (
    DidDocument,
    DidVerificationMethod,
    DidService,
    AgentCapabilityDescription,
    AUTOMATON_DID,
    NANOBOT_DID,
)


# ============================================================================
# 密钥对生成
# ============================================================================


def generate_key_pair() -> tuple[str, str]:
    """
    生成 ECDSA P-256 密钥对

    Returns:
        tuple[str, str]: (private_key_pem, public_key_pem)
    """
    private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())
    public_key = private_key.public_key()

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    ).decode("utf-8")

    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")

    return private_pem, public_pem


def import_private_key(pem: str) -> ec.EllipticCurvePrivateKey:
    """
    从 PEM 格式导入私钥

    Args:
        pem: PEM 格式私钥

    Returns:
        ECDSA 私钥对象
    """
    return serialization.load_pem_private_key(
        pem.encode("utf-8"),
        password=None,
        backend=default_backend()
    )


def import_public_key(pem: str) -> ec.EllipticCurvePublicKey:
    """
    从 PEM 格式导入公钥

    Args:
        pem: PEM 格式公钥

    Returns:
        ECDSA 公钥对象
    """
    return serialization.load_pem_public_key(
        pem.encode("utf-8"),
        backend=default_backend()
    )


# ============================================================================
# 公钥转换为 JWK 格式
# ============================================================================


def public_key_to_jwk(public_key: ec.EllipticCurvePublicKey) -> Dict[str, str]:
    """
    将公钥转换为 JWK 格式

    Args:
        public_key: ECDSA 公钥

    Returns:
        JWK 字典
    """
    # 获取公钥数字
    numbers = public_key.public_numbers()
    x_bytes = numbers.x.to_bytes(32, "big")
    y_bytes = numbers.y.to_bytes(32, "big")

    import base64
    def urlsafe_b64encode(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")

    return {
        "kty": "EC",
        "crv": "P-256",
        "x": urlsafe_b64encode(x_bytes),
        "y": urlsafe_b64encode(y_bytes),
    }


def jwk_to_public_key(jwk: Dict[str, str]) -> ec.EllipticCurvePublicKey:
    """
    从 JWK 导入公钥

    Args:
        jwk: JWK 字典

    Returns:
        ECDSA 公钥对象
    """
    import base64

    def urlsafe_b64decode(data: str) -> bytes:
        padding = 4 - len(data) % 4
        if padding != 4:
            data += "=" * padding
        return base64.urlsafe_b64decode(data)

    x = int.from_bytes(urlsafe_b64decode(jwk["x"]), "big")
    y = int.from_bytes(urlsafe_b64decode(jwk["y"]), "big")

    public_numbers = ec.EllipticCurvePublicNumbers(
        x=x,
        y=y,
        curve=ec.SECP256R1()
    )

    return public_numbers.public_key(default_backend())


# ============================================================================
# DID 文档生成
# ============================================================================


class DidDocumentOptions:
    """DID 文档生成选项"""

    def __init__(
        self,
        did: str,
        service_endpoint: str,
        agent_name: str,
        agent_description: str,
        capabilities: List[str],
        controller: Optional[str] = None,
    ):
        self.did = did
        self.service_endpoint = service_endpoint
        self.agent_name = agent_name
        self.agent_description = agent_description
        self.capabilities = capabilities
        self.controller = controller or did


        self.key_id = f"{did}#key-1"
        self.service_id = f"{did}#anp-service"


        self.capability_id = f"{did}#capability"


def generate_did_document(
    public_key: ec.EllipticCurvePublicKey,
    options: DidDocumentOptions,
) -> DidDocument:
    """
    生成 DID 文档

    Args:
        public_key: ECDSA 公钥
        options: 生成选项

    Returns:
        DidDocument
    """
    jwk = public_key_to_jwk(public_key)

    verification_method = DidVerificationMethod(
        id=options.key_id,
        type="JsonWebKey2020",
        controller=options.controller,
        public_key_jwk={
            "kty": jwk["kty"],
            "crv": jwk["crv"],
            "x": jwk["x"],
            "y": jwk["y"],
        }
    )

    service = DidService(
        id=options.service_id,
        type="ANPMessageService",
        service_endpoint=options.service_endpoint
    )

    capability_description = AgentCapabilityDescription(
        context="https://schema.org",
        type="SoftwareAgent",
        name=options.agent_name,
        description=options.agent_description,
        capabilities=options.capabilities
    )

    return DidDocument(
        context=[
            "https://www.w3.org/ns/did/v1",
            "https://w3id.org/anp/v1",
        ],
        id=options.did,
        controller=options.controller,
        verification_method=[verification_method],
        authentication=[options.key_id],
        key_agreement=[options.key_id],
        service=[service],
        capability_description=capability_description
    )


# ============================================================================
# DID 解析 (简化版 - 本地解析)
# ============================================================================

# DID 解析缓存
_did_cache: Dict[str, DidDocument] = {}


def register_did_document(document: DidDocument) -> None:
    """
    注册 DID 文档到缓存

    Args:
        document: DID 文档
    """
    global _did_cache
    _did_cache[document.id] = document


def resolve_did(did: str) -> Optional[DidDocument]:
    """
    解析 DID 文档

    Args:
        did: DID 标识符

    Returns:
        DidDocument 或 None
    """
    global _did_cache

    # 首先检查本地缓存
    if did in _did_cache:
        return _did_cache[did]

    # 对于已知的 DID，    raise NotImplementedError(f"DID not found: {did}")


def get_local_did(agent_type: str) -> str:
    """
    获取本地 DID

    Args:
        agent_type: 代理类型 ("automaton" 或 "nanobot")

    Returns:
        DID 标识符
    """
    if agent_type == "automaton":
        return AUTOMATON_DID
    if agent_type == "nanobot":
        return NANOBOT_DID
    raise ValueError(f"Unknown agent type: {agent_type}")


# ============================================================================
# 密钥存储
# ============================================================================


def get_key_store_path() -> Path:
    """获取密钥存储目录"""
    home = Path.home()
    return home / ".automaton" / "keys"


def ensure_key_store_path() -> None:
    """确保密钥存储目录存在"""
    path = get_key_store_path()
    path.mkdir(parents=True, exist_ok=True)


def get_private_key_path(did: str) -> Path:
    """
    获取私钥文件路径

    Args:
        did: DID 标识符

    Returns:
        私钥文件路径
    """
    safe_name = did.replace(":", "-").replace("/", "_")
    return get_key_store_path() / f"{safe_name}_private.pem"


def save_private_key(did: str, private_key: ec.EllipticCurvePrivateKey) -> None:
    """
    保存私钥到文件

    Args:
        did: DID 标识符
        private_key: ECDSA 私钥
    """
    ensure_key_store_path()
    path = get_private_key_path(did)

    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )

    path.write_bytes(pem)
    path.chmod(0o600)


def load_private_key(did: str) -> Optional[ec.EllipticCurvePrivateKey]:
    """
    从文件加载私钥

    Args:
        did: DID 标识符

    Returns:
        ECDSA 私钥或 None
    """
    path = get_private_key_path(did)

    if not path.exists():
        return None

    pem = path.read_text()
    return import_private_key(pem)


# ============================================================================
# 完整的代理身份初始化
# ============================================================================


def initialize_agent_identity(
    options: DidDocumentOptions,
) -> tuple[DidDocument, ec.EllipticCurvePrivateKey, ec.EllipticCurvePublicKey]:
    """
    初始化代理身份

    Args:
        options: DID 文档选项

    Returns:
        tuple: (did_document, private_key, public_key)
    """
    # 尝试加载现有私钥
    private_key = load_private_key(options.did)

    if private_key is None:
        # 生成新的密钥对
        private_pem, _ = generate_key_pair()
        private_key = import_private_key(private_pem)

        # 保存私钥
        save_private_key(options.did, private_key)

    public_key = private_key.public_key()

    # 生成 DID 文档
    did_document = generate_did_document(public_key, options)

    # 注册到缓存
    register_did_document(did_document)

    return did_document, private_key, public_key


# ============================================================================
# 密钥轮换机制
# ============================================================================

from dataclasses import dataclass, field
from datetime import datetime, timedelta


@dataclass
class KeyMetadata:
    """密钥元数据"""
    key_id: str
    did: str
    created_at: datetime
    expires_at: datetime
    is_current: bool = True
    private_key_path: Path = field(default_factory=lambda: Path())

    @property
    def age_days(self) -> int:
        """密钥年龄（天）"""
        return (datetime.now() - self.created_at).days

    @property
    def is_expired(self) -> bool:
        """是否已过期"""
        return datetime.now() >= self.expires_at

    def should_rotate(self, rotation_days: int = 30) -> bool:
        """是否应该轮换"""
        return self.age_days >= rotation_days


@dataclass
class KeyRotationConfig:
    """密钥轮换配置"""
    rotation_interval_days: int = 30
    """轮换间隔（天）"""

    key_lifetime_days: int = 90
    """密钥生命周期（天）"""

    grace_period_days: int = 7
    """宽限期（天），轮换后旧密钥仍可使用"""

    max_history_keys: int = 5
    """保留的历史密钥数量"""


# 密钥历史存储
_key_history: Dict[str, List[KeyMetadata]] = {}


def get_key_history_path() -> Path:
    """获取密钥历史存储路径"""
    return get_key_store_path() / "key_history.json"


def save_key_history() -> None:
    """保存密钥历史到文件"""
    import json

    history_data = {}
    for did, keys in _key_history.items():
        history_data[did] = [
            {
                "key_id": k.key_id,
                "did": k.did,
                "created_at": k.created_at.isoformat(),
                "expires_at": k.expires_at.isoformat(),
                "is_current": k.is_current,
                "private_key_path": str(k.private_key_path),
            }
            for k in keys
        ]

    get_key_store_path().mkdir(parents=True, exist_ok=True)
    get_key_history_path().write_text(json.dumps(history_data, indent=2))


def load_key_history() -> None:
    """从文件加载密钥历史"""
    import json

    global _key_history

    path = get_key_history_path()
    if not path.exists():
        return

    try:
        history_data = json.loads(path.read_text())
        for did, keys in history_data.items():
            _key_history[did] = [
                KeyMetadata(
                    key_id=k["key_id"],
                    did=k["did"],
                    created_at=datetime.fromisoformat(k["created_at"]),
                    expires_at=datetime.fromisoformat(k["expires_at"]),
                    is_current=k["is_current"],
                    private_key_path=Path(k["private_key_path"]),
                )
                for k in keys
            ]
    except Exception:
        # 如果加载失败，初始化空历史
        _key_history = {}


def get_key_metadata(did: str, key_id: Optional[str] = None) -> Optional[KeyMetadata]:
    """
    获取密钥元数据

    Args:
        did: DID 标识符
        key_id: 密钥 ID（可选，默认返回当前密钥）

    Returns:
        KeyMetadata 或 None
    """
    global _key_history

    if did not in _key_history:
        return None

    if key_id:
        for key in _key_history[did]:
            if key.key_id == key_id:
                return key
        return None

    # 返回当前密钥
    for key in _key_history[did]:
        if key.is_current:
            return key

    return None


def add_key_metadata(metadata: KeyMetadata) -> None:
    """
    添加密钥元数据到历史

    Args:
        metadata: 密钥元数据
    """
    global _key_history

    if metadata.did not in _key_history:
        _key_history[metadata.did] = []

    _key_history[metadata.did].append(metadata)
    save_key_history()


def should_rotate_key(did: str, config: KeyRotationConfig = KeyRotationConfig()) -> bool:
    """
    检查是否应该轮换密钥

    Args:
        did: DID 标识符
        config: 轮换配置

    Returns:
        是否应该轮换
    """
    metadata = get_key_metadata(did)
    if not metadata:
        return False

    return metadata.should_rotate(config.rotation_interval_days)


def rotate_key(
    did: str,
    options: DidDocumentOptions,
    config: KeyRotationConfig = KeyRotationConfig(),
) -> tuple[DidDocument, ec.EllipticCurvePrivateKey, ec.EllipticCurvePublicKey, KeyMetadata]:
    """
    轮换密钥

    Args:
        did: DID 标识符
        options: DID 文档选项
        config: 轮换配置

    Returns:
        tuple: (新密钥的 did_document, private_key, public_key, key_metadata)
    """
    # 获取当前密钥元数据
    current_metadata = get_key_metadata(did)

    # 生成新密钥对
    private_pem, public_pem = generate_key_pair()
    new_private_key = import_private_key(private_pem)
    new_public_key = new_private_key.public_key()

    # 计算新密钥 ID（递增版本号）
    if current_metadata:
        # 从当前密钥 ID 提取版本号
        version = int(current_metadata.key_id.split("-")[-1]) + 1
    else:
        version = 1

    new_key_id = f"{did}#key-{version}"

    # 更新 DID 文档选项中的密钥 ID
    options.key_id = new_key_id

    # 生成新的 DID 文档
    new_did_document = generate_did_document(new_public_key, options)

    # 保存新私钥
    new_private_key_path = get_private_key_path(f"{did}_key_{version}")
    new_private_key_path.write_bytes(
        new_private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        )
    )
    new_private_key_path.chmod(0o600)

    # 创建新密钥元数据
    now = datetime.now()
    new_metadata = KeyMetadata(
        key_id=new_key_id,
        did=did,
        created_at=now,
        expires_at=now + timedelta(days=config.key_lifetime_days),
        is_current=True,
        private_key_path=new_private_key_path,
    )

    # 标记旧密钥为非当前
    if current_metadata:
        current_metadata.is_current = False

    # 添加新密钥元数据
    add_key_metadata(new_metadata)

    # 清理过期的历史密钥
    cleanup_old_keys(did, config)

    # 更新缓存中的 DID 文档
    register_did_document(new_did_document)

    return new_did_document, new_private_key, new_public_key, new_metadata


def cleanup_old_keys(did: str, config: KeyRotationConfig) -> None:
    """
    清理旧密钥

    Args:
        did: DID 标识符
        config: 轮换配置
    """
    global _key_history

    if did not in _key_history:
        return

    now = datetime.now()
    keys_to_keep = []

    for key in _key_history[did]:
        # 保留当前密钥
        if key.is_current:
            keys_to_keep.append(key)
            continue

        # 保留在宽限期内的密钥
        grace_end = key.created_at + timedelta(days=config.rotation_interval_days + config.grace_period_days)
        if now < grace_end:
            keys_to_keep.append(key)
            continue

        # 删除过期的私钥文件
        if key.private_key_path.exists():
            try:
                key.private_key_path.unlink()
            except Exception:
                pass

    # 按创建时间排序，保留最新的 N 个密钥
    keys_to_keep.sort(key=lambda k: k.created_at, reverse=True)
    _key_history[did] = keys_to_keep[: config.max_history_keys]

    save_key_history()


def get_all_keys_for_did(did: str) -> List[KeyMetadata]:
    """
    获取 DID 的所有密钥

    Args:
        did: DID 标识符

    Returns:
        密钥元数据列表
    """
    global _key_history
    return _key_history.get(did, []).copy()


def is_key_valid_for_signature(did: str, key_id: str, config: KeyRotationConfig = KeyRotationConfig()) -> bool:
    """
    检查密钥是否可用于签名

    Args:
        did: DID 标识符
        key_id: 密钥 ID
        config: 轮换配置

    Returns:
        是否有效
    """
    metadata = get_key_metadata(did, key_id)
    if not metadata:
        return False

    # 当前密钥始终有效
    if metadata.is_current:
        return True

    # 非当前密钥需要在宽限期内
    now = datetime.now()
    grace_end = metadata.created_at + timedelta(
        days=config.rotation_interval_days + config.grace_period_days
    )

    return now < grace_end


def initialize_key_rotation(
    options: DidDocumentOptions,
    config: KeyRotationConfig = KeyRotationConfig(),
) -> tuple[DidDocument, ec.EllipticCurvePrivateKey, ec.EllipticCurvePublicKey]:
    """
    初始化密钥轮换

    Args:
        options: DID 文档选项
        config: 轮换配置

    Returns:
        tuple: (did_document, private_key, public_key)
    """
    # 加载密钥历史
    load_key_history()

    # 检查是否需要轮换
    if should_rotate_key(options.did, config):
        return rotate_key(options.did, options, config)[:3]

    # 使用现有初始化逻辑
    return initialize_agent_identity(options)


# 初始化时加载密钥历史
load_key_history()
