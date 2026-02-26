"""
ANP 加密模块 - ECDH 密钥交换与端到端加密

@module anp.encryption
@version 1.0.0
"""

import base64
import json
import os
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.backends import default_backend

from .types import (
    EncryptedPayload,
    ANPEncryptedMessage,
    ANPMessage,
    DEFAULT_CONTEXT,
    AUTOMATON_DID,
)
from .signature import sign_payload
from .did import import_private_key, import_public_key

try:
    from ulid import ULID
except ImportError:
    import time
    import random

    def ULID() -> str:
        timestamp = int(time.time() * 1000)
        random_part = random.randint(0, 2**80 - 1)
        return f"{timestamp:013d}{random_part:020d}"


# ============================================================================
# ECDH 密钥交换
# ============================================================================


def generate_ecdh_key_pair() -> Tuple[ec.EllipticCurvePrivateKey, ec.EllipticCurvePublicKey]:
    """
    生成 ECDH 临时密钥对

    Returns:
        tuple: (private_key, public_key)
    """
    private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())
    return private_key, private_key.public_key()


def compute_shared_secret(
    my_private_key: ec.EllipticCurvePrivateKey,
    their_public_key: ec.EllipticCurvePublicKey,
) -> bytes:
    """
    使用 ECDH 计算共享密钥

    Args:
        my_private_key: 我的 ECDH 私钥
        their_public_key: 对方的 ECDH 公钥

    Returns:
        共享密钥 (bytes)
    """
    return my_private_key.exchange(ec.ECDH(), their_public_key)


def derive_aes_key(
    shared_secret: bytes,
    info: Optional[bytes] = None,
) -> bytes:
    """
    从共享密钥派生 AES 密钥

    Args:
        shared_secret: ECDH 共享密钥
        info: 密钥派生信息 (可选)

    Returns:
        AES-256 密钥 (32 字节)
    """
    salt = info or b"anp-encryption-v1"
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,  # AES-256 需要 32 字节密钥
        salt=salt,
        info=b"aes-key",
        backend=default_backend(),
    )
    return hkdf.derive(shared_secret)


# ============================================================================
# AES-256-GCM 加密
# ============================================================================


class EncryptOptions:
    """AES 加密选项"""

    def __init__(self, additional_data: Optional[bytes] = None):
        self.additional_data = additional_data


class EncryptResult:
    """AES 加密结果"""

    def __init__(self, ciphertext: bytes, iv: bytes, tag: bytes):
        self.ciphertext = ciphertext
        self.iv = iv
        self.tag = tag


def encrypt_aes(
    plaintext: bytes,
    key: bytes,
    options: Optional[EncryptOptions] = None,
) -> EncryptResult:
    """
    使用 AES-256-GCM 加密数据

    Args:
        plaintext: 明文数据
        key: AES 密钥 (32 字节)
        options: 加密选项

    Returns:
        EncryptResult
    """
    # 生成 96-bit IV for GCM
    iv = os.urandom(12)

    # 创建 AES-GCM 加密器
    aesgcm = AESGCM(key)

    # 加密
    associated_data = options.additional_data if options else None
    ciphertext = aesgcm.encrypt(iv, plaintext, associated_data)

    # GCM 的 tag 是最后 16 字节
    return EncryptResult(
        ciphertext=ciphertext[:-16],  # 实际密文
        iv=iv,
        tag=ciphertext[-16:],  # 认证标签
    )


def decrypt_aes(
    encrypted: EncryptResult,
    key: bytes,
    options: Optional[EncryptOptions] = None,
) -> bytes:
    """
    使用 AES-256-GCM 解密数据

    Args:
        encrypted: 加密结果
        key: AES 密钥 (32 字节)
        options: 解密选项

    Returns:
        解密后的明文
    """
    aesgcm = AESGCM(key)

    # 重新组合 ciphertext + tag
    full_ciphertext = encrypted.ciphertext + encrypted.tag

    # 解密
    associated_data = options.additional_data if options else None
    return aesgcm.decrypt(encrypted.iv, full_ciphertext, associated_data)


# ============================================================================
# 端到端加密消息
# ============================================================================


class EncryptMessageOptions:
    """加密消息选项"""

    def __init__(
        self,
        recipient_did: str,
        correlation_id: Optional[str] = None,
        ttl: Optional[int] = None,
        protocol_version: str = "1.0.0",
    ):
        self.recipient_did = recipient_did
        self.correlation_id = correlation_id
        self.ttl = ttl
        self.protocol_version = protocol_version


def encrypt_message(
    message: ANPMessage,
    sender_private_key: ec.EllipticCurvePrivateKey,
    recipient_public_key: ec.EllipticCurvePublicKey,
    options: EncryptMessageOptions,
) -> ANPEncryptedMessage:
    """
    加密 ANP 消息

    Args:
        message: 原始 ANP 消息
        sender_private_key: 发送方签名私钥
        recipient_public_key: 接收方加密公钥
        options: 加密选项

    Returns:
        加密的 ANP 消息
    """
    # 1. 生成 ECDH 临时密钥对
    ephemeral_private_key, ephemeral_public_key = generate_ecdh_key_pair()

    # 2. 计算共享密钥
    shared_secret = compute_shared_secret(
        ephemeral_private_key,
        recipient_public_key,
    )

    # 3. 派生 AES 密钥
    aes_key = derive_aes_key(
        shared_secret,
        options.recipient_did.encode("utf-8"),
    )

    # 4. 序列化消息
    message_json = message.model_dump_json()

    # 5. 加密消息
    encrypted = encrypt_aes(
        message_json.encode("utf-8"),
        aes_key,
    )

    # 6. 导出临时公钥
    from cryptography.hazmat.primitives import serialization
    ephemeral_public_key_bytes = ephemeral_public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )

    # 7. 创建加密负载
    encrypted_payload = EncryptedPayload(
        algorithm="AES-256-GCM",
        iv=base64.b64encode(encrypted.iv).decode("utf-8"),
        ciphertext=base64.b64encode(encrypted.ciphertext).decode("utf-8"),
        tag=base64.b64encode(encrypted.tag).decode("utf-8"),
        ephemeral_public_key=base64.b64encode(ephemeral_public_key_bytes).decode("utf-8"),
    )

    # 8. 签名加密负载
    from .types import ANPSignature, ProofPurpose

    key_id = f"{message.actor}#key-1"
    # 直接签名 encrypted_payload (它是 Pydantic 模型)
    signature = sign_payload(
        encrypted_payload,
        sender_private_key,
        key_id,
    )

    # 9. 构建加密消息
    return ANPEncryptedMessage(
        context=DEFAULT_CONTEXT[0],
        message_type="ANPEncryptedMessage",
        id=f"encrypted-{ULID()}",
        timestamp=datetime.utcnow(),
        actor=message.actor,
        target=options.recipient_did,
        encrypted_payload=encrypted_payload,
        signature=signature,
    )


def decrypt_message(
    encrypted_message: ANPEncryptedMessage,
    recipient_private_key: ec.EllipticCurvePrivateKey,
) -> ANPMessage:
    """
    解密 ANP 消息

    Args:
        encrypted_message: 加密的 ANP 消息
        recipient_private_key: 接收方私钥

    Returns:
        解密后的原始消息
    """
    from cryptography.hazmat.primitives import serialization

    # 1. 从加密负载中提取临时公钥
    ephemeral_public_key_bytes = base64.b64decode(
        encrypted_message.encrypted_payload.ephemeral_public_key
    )
    # 解析未压缩点格式: 0x04 || X (32 bytes) || Y (32 bytes)
    # 对于 SECP256R1，总共 65 字节
    if ephemeral_public_key_bytes[0] != 0x04:
        raise ValueError("Invalid point format: expected uncompressed point (0x04 prefix)")

    x = int.from_bytes(ephemeral_public_key_bytes[1:33], 'big')
    y = int.from_bytes(ephemeral_public_key_bytes[33:65], 'big')

    public_numbers = ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1())
    ephemeral_public_key = public_numbers.public_key(default_backend())

    # 2. 计算共享密钥
    shared_secret = compute_shared_secret(
        recipient_private_key,
        ephemeral_public_key,
    )

    # 3. 派生 AES 密钥
    aes_key = derive_aes_key(
        shared_secret,
        encrypted_message.target.encode("utf-8"),
    )

    # 4. 解密
    encrypted = EncryptResult(
        ciphertext=base64.b64decode(encrypted_message.encrypted_payload.ciphertext),
        iv=base64.b64decode(encrypted_message.encrypted_payload.iv),
        tag=base64.b64decode(encrypted_message.encrypted_payload.tag),
    )

    decrypted = decrypt_aes(encrypted, aes_key)

    # 5. 反序列化
    message_dict = json.loads(decrypted.decode("utf-8"))
    return ANPMessage(**message_dict)
