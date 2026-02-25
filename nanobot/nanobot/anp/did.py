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

    return did_document. private_key. public_key
