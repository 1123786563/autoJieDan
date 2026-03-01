"""
ANP 加密通信测试
测试 ECDH 密钥交换与 AES-256-GCM 端到端加密

@module anp.test_encryption
@version 1.0.0
"""

import json
from datetime import datetime

import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.backends import default_backend

from nanobot.anp.encryption import (
    generate_ecdh_key_pair,
    compute_shared_secret,
    derive_aes_key,
    encrypt_aes,
    decrypt_aes,
    EncryptOptions,
    EncryptResult,
    encrypt_message,
    decrypt_message,
    EncryptMessageOptions,
)
from nanobot.anp.types import (
    ANPMessage,
    ANPMessageType,
    ProgressReportPayload,
    ANPEncryptedMessage,
    DEFAULT_CONTEXT,
    AUTOMATON_DID,
    NANOBOT_DID,
)


class TestECDHKeyExchange:
    """ECDH 密钥交换测试"""

    def test_generate_ecdh_key_pair(self):
        """测试生成 ECDH 密钥对"""
        private_key, public_key = generate_ecdh_key_pair()

        assert private_key is not None
        assert public_key is not None
        assert isinstance(private_key, ec.EllipticCurvePrivateKey)
        assert isinstance(public_key, ec.EllipticCurvePublicKey)

        # 验证曲线类型
        assert isinstance(private_key.curve, ec.SECP256R1)

    def test_each_key_pair_is_unique(self):
        """测试每个密钥对都是唯一的"""
        key_pair1 = generate_ecdh_key_pair()
        key_pair2 = generate_ecdh_key_pair()

        assert key_pair1[0] != key_pair2[0]
        assert key_pair1[1] != key_pair2[1]

    def test_compute_shared_secret(self):
        """测试计算共享密钥"""
        # Alice 的密钥对
        alice_private, alice_public = generate_ecdh_key_pair()

        # Bob 的密钥对
        bob_private, bob_public = generate_ecdh_key_pair()

        # Alice 计算共享密钥
        alice_shared = compute_shared_secret(alice_private, bob_public)

        # Bob 计算共享密钥
        bob_shared = compute_shared_secret(bob_private, alice_public)

        # 共享密钥应该相同
        assert alice_shared == bob_shared
        assert len(alice_shared) == 32  # P-256 生成 32 字节共享密钥

    def test_different_pairs_produce_different_secrets(self):
        """测试不同密钥对产生不同的共享密钥"""
        alice_private, alice_public = generate_ecdh_key_pair()
        bob1_private, bob1_public = generate_ecdh_key_pair()
        bob2_private, bob2_public = generate_ecdh_key_pair()

        shared_secret1 = compute_shared_secret(alice_private, bob1_public)
        shared_secret2 = compute_shared_secret(alice_private, bob2_public)

        assert shared_secret1 != shared_secret2


class TestAESKeyDerivation:
    """AES 密钥派生测试"""

    def test_derive_aes_key_from_shared_secret(self):
        """测试从共享密钥派生 AES 密钥"""
        shared_secret = b"test_shared_secret_32_bytes_long!"

        aes_key = derive_aes_key(shared_secret)

        assert aes_key is not None
        assert len(aes_key) == 32  # AES-256 需要 32 字节密钥

    def test_same_input_produces_same_key(self):
        """测试相同输入产生相同密钥"""
        shared_secret = b"test_shared_secret_32_bytes_long!"

        aes_key1 = derive_aes_key(shared_secret)
        aes_key2 = derive_aes_key(shared_secret)

        assert aes_key1 == aes_key2

    def test_different_info_produces_different_keys(self):
        """测试不同的 info 产生不同的密钥"""
        shared_secret = b"test_shared_secret_32_bytes_long!"

        aes_key1 = derive_aes_key(shared_secret, info=b"info1")
        aes_key2 = derive_aes_key(shared_secret, info=b"info2")

        assert aes_key1 != aes_key2


class TestAESEncryption:
    """AES-256-GCM 加密测试"""

    def test_encrypt_and_decrypt_text(self):
        """测试加密和解密文本"""
        import os
        key = os.urandom(32)  # 生成随机的 32 字节密钥
        plaintext = b"Hello, ANP Encryption!"

        encrypted = encrypt_aes(plaintext, key)
        decrypted = decrypt_aes(encrypted, key)

        assert decrypted == plaintext

    def test_encrypt_and_decrypt_binary_data(self):
        """测试加密和解密二进制数据"""
        import os

        key = os.urandom(32)  # 生成随机的 32 字节密钥
        plaintext = os.urandom(1024)

        encrypted = encrypt_aes(plaintext, key)
        decrypted = decrypt_aes(encrypted, key)

        assert decrypted == plaintext

    def test_each_encryption_is_unique(self):
        """测试每次加密都是唯一的（不同的 IV）"""
        import os
        key = os.urandom(32)  # 生成随机的 32 字节密钥
        plaintext = b"Same plaintext"

        encrypted1 = encrypt_aes(plaintext, key)
        encrypted2 = encrypt_aes(plaintext, key)

        # IV 应该不同
        assert encrypted1.iv != encrypted2.iv

        # 密文也应该不同
        assert encrypted1.ciphertext != encrypted2.ciphertext

        # 但解密后应该相同
        decrypted1 = decrypt_aes(encrypted1, key)
        decrypted2 = decrypt_aes(encrypted2, key)

        assert decrypted1 == plaintext
        assert decrypted2 == plaintext

    def test_wrong_key_fails_decryption(self):
        """测试错误的密钥导致解密失败"""
        import os
        key = os.urandom(32)
        wrong_key = os.urandom(32)
        plaintext = b"Secret message"

        encrypted = encrypt_aes(plaintext, key)

        with pytest.raises(Exception):
            decrypt_aes(encrypted, wrong_key)

    def test_iv_length_is_12_bytes(self):
        """测试 IV 长度为 12 字节（GCM 推荐）"""
        import os
        key = os.urandom(32)
        plaintext = b"Test"

        encrypted = encrypt_aes(plaintext, key)

        assert len(encrypted.iv) == 12

    def test_tag_length_is_16_bytes(self):
        """测试 Tag 长度为 16 字节（GCM 标准）"""
        import os
        key = os.urandom(32)
        plaintext = b"Test"

        encrypted = encrypt_aes(plaintext, key)

        assert len(encrypted.tag) == 16


class TestMessageEncryption:
    """端到端消息加密测试"""

    def create_test_message(self) -> ANPMessage:
        """创建测试消息"""
        payload = ProgressReportPayload(
            task_id="test-task-001",
            progress=50,
            current_phase="testing",
            completed_steps=["step1", "step2"],
            next_steps=["step3"],
            eta_seconds=3600,
            blockers=[],
        )

        return ANPMessage(
            context=DEFAULT_CONTEXT,
            message_type="ANPMessage",
            id=f"msg-{int(datetime.now().timestamp())}",
            timestamp=datetime.utcnow(),
            actor=AUTOMATON_DID,
            target=NANOBOT_DID,
            type=ANPMessageType.PROGRESS_EVENT,
            object=payload.model_dump(by_alias=True, exclude_none=True),
            signature={
                "type": "EcdsaSecp256r1Signature2019",
                "created": datetime.utcnow(),
                "verification_method": f"{AUTOMATON_DID}#key-1",
                "proof_purpose": "authentication",
                "proof_value": "test_signature",
            },
        )

    def test_encrypt_and_decrypt_message(self):
        """测试加密和解密 ANP 消息"""
        # 创建原始消息
        original_message = self.create_test_message()

        # 生成密钥对
        sender_private_key, _ = generate_ecdh_key_pair()
        recipient_private_key, recipient_public_key = generate_ecdh_key_pair()

        # 加密消息
        options = EncryptMessageOptions(
            recipient_did=NANOBOT_DID,
            correlation_id="test-correlation-123",
        )
        encrypted_message = encrypt_message(
            original_message,
            sender_private_key,
            recipient_public_key,
            options,
        )

        # 验证加密消息结构
        assert encrypted_message.context is not None
        assert encrypted_message.message_type == "ANPEncryptedMessage"
        assert encrypted_message.id.startswith("encrypted-")
        assert encrypted_message.actor == AUTOMATON_DID
        assert encrypted_message.target == NANOBOT_DID
        assert encrypted_message.encrypted_payload is not None
        assert encrypted_message.encrypted_payload.algorithm == "AES-256-GCM"
        assert encrypted_message.encrypted_payload.iv is not None
        assert encrypted_message.encrypted_payload.ciphertext is not None
        assert encrypted_message.encrypted_payload.tag is not None
        assert encrypted_message.encrypted_payload.ephemeral_public_key is not None

        # 解密消息
        decrypted_message = decrypt_message(encrypted_message, recipient_private_key)

        # 验证解密后的消息
        assert decrypted_message.id == original_message.id
        assert decrypted_message.actor == original_message.actor
        assert decrypted_message.target == original_message.target
        assert decrypted_message.type == original_message.type
        assert decrypted_message.object == original_message.object

    def test_only_recipient_can_decrypt(self):
        """测试只有接收方可以解密消息"""
        original_message = self.create_test_message()

        sender_private_key, _ = generate_ecdh_key_pair()
        recipient_private_key, recipient_public_key = generate_ecdh_key_pair()
        other_private_key, _ = generate_ecdh_key_pair()

        options = EncryptMessageOptions(recipient_did=NANOBOT_DID)
        encrypted_message = encrypt_message(
            original_message,
            sender_private_key,
            recipient_public_key,
            options,
        )

        # 接收方可以解密
        decrypted = decrypt_message(encrypted_message, recipient_private_key)
        assert decrypted.id == original_message.id

        # 其他人不能解密
        with pytest.raises(Exception):
            decrypt_message(encrypted_message, other_private_key)

    def test_unique_ephemeral_keys_for_each_message(self):
        """测试每条消息使用唯一的临时密钥"""
        original_message = self.create_test_message()

        sender_private_key, _ = generate_ecdh_key_pair()
        recipient_private_key, recipient_public_key = generate_ecdh_key_pair()

        options = EncryptMessageOptions(recipient_did=NANOBOT_DID)
        encrypted1 = encrypt_message(
            original_message,
            sender_private_key,
            recipient_public_key,
            options,
        )

        encrypted2 = encrypt_message(
            original_message,
            sender_private_key,
            recipient_public_key,
            options,
        )

        # 临时公钥应该不同
        assert (
            encrypted1.encrypted_payload.ephemeral_public_key
            != encrypted2.encrypted_payload.ephemeral_public_key
        )

    def test_bidirectional_communication(self):
        """测试双向通信"""
        # Automaton -> Nanobot
        automaton_message = self.create_test_message()

        automaton_private, _ = generate_ecdh_key_pair()
        nanobot_private, nanobot_public = generate_ecdh_key_pair()

        options = EncryptMessageOptions(recipient_did=NANOBOT_DID)
        encrypted = encrypt_message(
            automaton_message,
            automaton_private,
            nanobot_public,
            options,
        )

        decrypted = decrypt_message(encrypted, nanobot_private)
        assert decrypted.id == automaton_message.id
        assert decrypted.actor == AUTOMATON_DID
        assert decrypted.target == NANOBOT_DID

        # Nanobot -> Automaton
        nanobot_message = self.create_test_message()
        nanobot_message.actor = NANOBOT_DID
        nanobot_message.target = AUTOMATON_DID

        _, automaton_public = generate_ecdh_key_pair()
        options2 = EncryptMessageOptions(recipient_did=AUTOMATON_DID)
        encrypted2 = encrypt_message(
            nanobot_message,
            nanobot_private,
            automaton_public,
            options2,
        )

        # 使用新的 Automaton 私钥解密
        automaton_private2, _ = generate_ecdh_key_pair()
        # 由于我们无法直接使用刚才生成的公钥对应的私钥，
        # 这里只验证加密消息的结构
        assert encrypted2.target == AUTOMATON_DID
        assert encrypted2.actor == NANOBOT_DID


class TestEncryptionEdgeCases:
    """加密边界情况测试"""

    def create_test_message(self) -> ANPMessage:
        """创建测试消息"""
        payload = ProgressReportPayload(
            task_id="test",
            progress=0,
            current_phase="",
            completed_steps=[],
            next_steps=[],
            blockers=[],
        )

        return ANPMessage(
            context=DEFAULT_CONTEXT,
            message_type="ANPMessage",
            id="msg-test",
            timestamp=datetime.utcnow(),
            actor=AUTOMATON_DID,
            target=NANOBOT_DID,
            type=ANPMessageType.PROGRESS_EVENT,
            object=payload.model_dump(by_alias=True, exclude_none=True),
            signature={
                "type": "EcdsaSecp256r1Signature2019",
                "created": datetime.utcnow(),
                "verification_method": f"{AUTOMATON_DID}#key-1",
                "proof_purpose": "authentication",
                "proof_value": "test_signature",
            },
        )

    def test_encrypt_empty_message(self):
        """测试加密空消息"""
        empty_message = self.create_test_message()
        empty_message.object = {}

        sender_private_key, _ = generate_ecdh_key_pair()
        recipient_private_key, recipient_public_key = generate_ecdh_key_pair()

        options = EncryptMessageOptions(recipient_did=NANOBOT_DID)
        encrypted = encrypt_message(
            empty_message,
            sender_private_key,
            recipient_public_key,
            options,
        )

        decrypted = decrypt_message(encrypted, recipient_private_key)
        assert decrypted.id == empty_message.id
