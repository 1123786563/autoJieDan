"""
ANP 消息签名与验证

用于 ANP 协议的消息认证

@module anp.signature
@version 1.0.0
"""

import base64
import hashlib
import json
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import (
    decode_dss_signature,
    encode_dss_signature,
)
from cryptography.exceptions import InvalidSignature

from .types import (
    ANPMessage,
    ANPSignature,
    ANPPayload,
    ANPMessageType,
    DEFAULT_CONTEXT,
    AUTOMATON_DID,
    ProofPurpose,
)

try:
    from ulid import ULID
except ImportError:
    # ULID 回退实现
    import time
    import random

    def ULID() -> str:
        """简单的 ULID 生成"""
        timestamp = int(time.time() * 1000)
        random_part = random.randint(0, 2**80 - 1)
        return f"{timestamp:013d}{random_part:020d}"


# ============================================================================
# 消息哈希
# ============================================================================


def hash_message(message: ANPMessage) -> str:
    """
    对消息内容进行规范哈希

    Args:
        message: ANP 消息对象

    Returns:
        SHA-256 哈希值 (hex)
    """
    message_bytes = message.model_dump_json().encode("utf-8")
    return hashlib.sha256(message_bytes).hexdigest()


def hash_payload(payload: ANPPayload) -> bytes:
    """
    对负载内容进行规范哈希

    Args:
        payload: ANP 负载对象

    Returns:
        SHA-256 哈希值 (bytes)
    """
    payload_bytes = payload.model_dump_json().encode("utf-8")
    return hashlib.sha256(payload_bytes).digest()


# ============================================================================
# 消息签名
# ============================================================================


def sign_payload(
    payload: ANPPayload,
    private_key: ec.EllipticCurvePrivateKey,
    key_id: str,
) -> ANPSignature:
    """
    创建签名

    Args:
        payload: 消息负载
        private_key: ECDSA 私钥
        key_id: 密钥标识符

    Returns:
        ANP 签名
    """
    payload_bytes = payload.model_dump_json().encode("utf-8")
    timestamp = datetime.utcnow()

    # 使用 ECDSA 签名
    signature_bytes = private_key.sign(
        payload_bytes,
        ec.ECDSA(hashes.SHA256()),
    )

    # 将 DER 编码的签名转换为 base64
    signature_b64 = base64.b64encode(signature_bytes).decode("utf-8")

    return ANPSignature(
        type="EcdsaSecp256r1Signature2019",
        created=timestamp,
        verification_method=key_id,
        proof_purpose=ProofPurpose.AUTHENTICATION,
        proof_value=signature_b64,
    )


def verify_signature(
    message: ANPMessage,
    public_key: ec.EllipticCurvePublicKey,
) -> bool:
    """
    验证消息签名

    Args:
        message: ANP 消息对象
        public_key: ECDSA 公钥

    Returns:
        签名是否有效
    """
    try:
        payload_bytes = message.object.model_dump_json().encode("utf-8")
        signature_bytes = base64.b64decode(message.signature.proof_value)

        # 验证签名
        public_key.verify(
            signature_bytes,
            payload_bytes,
            ec.ECDSA(hashes.SHA256()),
        )
        return True
    except InvalidSignature:
        return False
    except Exception:
        return False


def get_signature(message: ANPMessage) -> ANPSignature:
    """
    获取消息签名

    Args:
        message: ANP 消息对象

    Returns:
        ANP 签名
    """
    return message.signature


def get_signature_timestamp(message: ANPMessage) -> datetime:
    """
    获取签名时间戳

    Args:
        message: ANP 消息对象

    Returns:
        datetime 对象
    """
    return message.signature.created


# ============================================================================
# 消息创建
# ============================================================================


class CreateMessageOptions:
    """创建 ANP 消息选项"""

    def __init__(
        self,
        type: ANPMessageType,
        target_did: Optional[str] = None,
        correlation_id: Optional[str] = None,
        ttl: Optional[int] = None,
        key_id: Optional[str] = None,
    ):
        self.type = type
        self.target_did = target_did
        self.correlation_id = correlation_id
        self.ttl = ttl
        self.key_id = key_id


def create_anp_message(
    payload: ANPPayload,
    private_key: ec.EllipticCurvePrivateKey,
    options: CreateMessageOptions,
) -> ANPMessage:
    """
    创建 ANP 消息

    Args:
        payload: 消息负载
        private_key: ECDSA 私钥
        options: 创建选项

    Returns:
        ANP 消息
    """
    message_id = str(ULID())
    timestamp = datetime.utcnow()
    key_id = options.key_id or f"{AUTOMATON_DID}#key-1"

    # 对负载签名
    signature = sign_payload(payload, private_key, key_id)

    # 创建消息
    return ANPMessage(
        context=DEFAULT_CONTEXT,
        message_type="ANPMessage",
        id=message_id,
        timestamp=timestamp,
        actor=AUTOMATON_DID,
        target=options.target_did or "",
        type=options.type,
        object=payload,
        signature=signature,
        correlation_id=options.correlation_id,
        ttl=options.ttl or 3600,
    )


def verify_message(
    message: ANPMessage,
    public_key: ec.EllipticCurvePublicKey,
    max_age_ms: int = 300000,  # 默认 5 分钟
) -> Tuple[bool, Optional[str]]:
    """
    验证消息完整性 (包括时间戳和签名)

    Args:
        message: ANP 消息
        public_key: ECDSA 公钥
        max_age_ms: 最大消息年龄 (毫秒)

    Returns:
        tuple: (valid, error_message)
    """
    # 检查时间戳
    message_time = message.timestamp.timestamp() if isinstance(message.timestamp, datetime) else message.time
    now = datetime.utcnow().timestamp()
    age_ms = (now - message_time) * 1000

    if age_ms > max_age_ms:
        return False, "Message expired"

    if age_ms < -60000:  # 允许 1 分钟的时钟偏差
        return False, "Message timestamp in future"

    # 检查 TTL
    if message.ttl is not None:
        ttl_ms = message.ttl * 1000
        if age_ms > ttl_ms:
            return False, "Message TTL exceeded"

    # 验证签名
    if not verify_signature(message, public_key):
        return False, "Invalid signature"

    return True, None
