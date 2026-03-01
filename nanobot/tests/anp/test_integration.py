"""
ANP 集成测试 - Day 37

测试内容：
- DID 文档生成与解析
- 签名/验证双向测试
- 加密/解密双向测试
- 完整消息流程

@module anp/test_integration
"""

import base64
import json
import os
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from pydantic import BaseModel
from cryptography.hazmat.primitives.asymmetric import ec

from nanobot.anp import (
    # 常量
    AUTOMATON_DID,
    NANOBOT_DID,
    DEFAULT_CONTEXT,
    GENESIS_PROMPT_PROTOCOL,
    ANPError,
    ANPErrorCode,
    # DID
    generate_key_pair,
    import_private_key,
    import_public_key,
    public_key_to_jwk,
    generate_did_document,
    DidDocumentOptions,
    # 签名
    sign_payload,
    verify_signature,
    create_anp_message,
    verify_message,
    hash_payload,
    CreateMessageOptions,
    # 加密
    generate_ecdh_key_pair,
    compute_shared_secret,
    derive_aes_key,
    encrypt_aes,
    decrypt_aes,
    encrypt_message,
    decrypt_message,
    EncryptOptions,
    EncryptResult,
    EncryptMessageOptions,
    # 类型
    ANPMessage,
    ANPSignature,
    ProgressReportPayload,
    GenesisPromptPayload,
    TechnicalConstraints,
    ContractTerms,
    ResourceLimits,
    MonetaryAmount,
    ANPMessageType,
    ProofPurpose,
)


# ============================================================================
# 测试辅助函数
# ============================================================================


def create_test_progress_payload() -> ProgressReportPayload:
    """创建测试用进度报告负载"""
    return ProgressReportPayload(
        task_id="task-001",
        progress=50,
        current_phase="testing",
        completed_steps=["setup", "implementation"],
        next_steps=["review", "deploy"],
        eta_seconds=3600,
        blockers=[],
    )


def create_test_genesis_payload() -> GenesisPromptPayload:
    """创建测试用 Genesis Prompt 负载"""
    return GenesisPromptPayload(
        project_id="test-project-001",
        platform="test-platform",
        requirement_summary="Test requirement for integration testing",
        technical_constraints=TechnicalConstraints(
            required_stack=["Python", "TypeScript"],
            prohibited_stack=[],
            target_platform="linux",
        ),
        contract_terms=ContractTerms(
            total_budget=MonetaryAmount(value=10000, currency="USD"),
            deadline=datetime.now() + timedelta(days=7),
            milestones=[],
        ),
        resource_limits=ResourceLimits(
            max_tokens_per_task=100000,
            max_cost_cents=500,
            max_duration_ms=3600000,
        ),
    )


# ============================================================================
# DID 文档生成测试
# ============================================================================


class TestDIDDocumentGeneration:
    """DID 文档生成测试"""

    def test_generate_valid_ecdsa_key_pair(self):
        """应生成有效的 ECDSA P-256 密钥对"""
        private_pem, public_pem = generate_key_pair()

        assert private_pem is not None
        assert public_pem is not None
        # Python 使用 PKCS#8 格式
        assert "-----BEGIN PRIVATE KEY-----" in private_pem
        assert "-----BEGIN PUBLIC KEY-----" in public_pem

    def test_import_pem_keys_correctly(self):
        """应正确导入 PEM 格式密钥"""
        private_pem, public_pem = generate_key_pair()

        private_key = import_private_key(private_pem)
        public_key = import_public_key(public_pem)

        # 验证是 EC 密钥
        assert private_key.curve.name == "secp256r1"
        assert public_key.curve.name == "secp256r1"

    def test_convert_public_key_to_jwk(self):
        """应将公钥转换为 JWK 格式"""
        _, public_pem = generate_key_pair()
        public_key = import_public_key(public_pem)
        jwk = public_key_to_jwk(public_key)

        assert jwk["kty"] == "EC"
        assert jwk["crv"] == "P-256"
        assert "x" in jwk
        assert "y" in jwk
        assert isinstance(jwk["x"], str)
        assert isinstance(jwk["y"], str)

    def test_generate_did_document(self):
        """应生成有效的 DID 文档"""
        _, public_pem = generate_key_pair()
        public_key = import_public_key(public_pem)

        options = DidDocumentOptions(
            did="did:anp:test:agent001",
            service_endpoint="https://test.example.com/anp",
            agent_name="Test Agent",
            agent_description="Agent for integration testing",
            capabilities=["testing", "integration"],
        )

        doc = generate_did_document(public_key, options)

        assert doc.id == "did:anp:test:agent001"
        assert len(doc.verification_method) == 1
        assert len(doc.service) == 1
        assert doc.verification_method[0].type == "JsonWebKey2020"
        assert doc.service[0].type == "ANPMessageService"

    def test_did_document_structure(self):
        """DID 文档结构应符合 W3C 标准"""
        _, public_pem = generate_key_pair()
        public_key = import_public_key(public_pem)

        options = DidDocumentOptions(
            did="did:anp:test:agent002",
            service_endpoint="https://test.example.com/anp",
            agent_name="Test Agent 2",
            agent_description="Another test agent",
            capabilities=["testing"],
        )

        doc = generate_did_document(public_key, options)

        # 验证 JSON-LD 上下文
        assert "https://www.w3.org/ns/did/v1" in doc.context

        # 验证验证方法
        vm = doc.verification_method[0]
        assert vm.type == "JsonWebKey2020"
        assert vm.public_key_jwk["kty"] == "EC"
        assert vm.public_key_jwk["crv"] == "P-256"


# ============================================================================
# 签名验证测试
# ============================================================================


class TestSignatureVerification:
    """签名验证测试"""

    @pytest.fixture
    def key_pair(self):
        """生成测试用密钥对"""
        return generate_key_pair()

    def test_sign_and_verify_payload(self, key_pair):
        """应使用相同密钥签名和验证负载"""
        private_pem, public_pem = key_pair
        private_key = import_private_key(private_pem)
        public_key = import_public_key(public_pem)

        payload = create_test_progress_payload()
        key_id = f"{AUTOMATON_DID}#key-1"

        signature = sign_payload(payload, private_key, key_id)

        assert signature.type == "EcdsaSecp256r1Signature2019"
        assert signature.verification_method == key_id
        assert signature.proof_value is not None

        # 创建完整消息用于验证
        message = ANPMessage(
            context=DEFAULT_CONTEXT,
            message_type="ANPMessage",
            id="test-msg-001",
            timestamp=datetime.utcnow(),
            actor=AUTOMATON_DID,
            target=NANOBOT_DID,
            type=ANPMessageType.TASK_UPDATE,
            object=payload,
            signature=signature,
        )

        # 验证签名
        is_valid = verify_signature(message, public_key)
        assert is_valid is True

    def test_reject_tampered_payload(self, key_pair):
        """应拒绝被篡改的负载"""
        private_pem, public_pem = key_pair
        private_key = import_private_key(private_pem)
        public_key = import_public_key(public_pem)

        payload = create_test_progress_payload()
        key_id = f"{AUTOMATON_DID}#key-1"

        signature = sign_payload(payload, private_key, key_id)

        # 篡改负载 - 创建新负载对象
        tampered_payload = create_test_progress_payload()
        tampered_payload.progress = 99  # 修改进度

        # 创建带篡改负载的消息
        message = ANPMessage(
            context=DEFAULT_CONTEXT,
            message_type="ANPMessage",
            id="test-msg-002",
            timestamp=datetime.utcnow(),
            actor=AUTOMATON_DID,
            target=NANOBOT_DID,
            type=ANPMessageType.TASK_UPDATE,
            object=tampered_payload,
            signature=signature,  # 使用原始负载的签名
        )

        # 验证应该失败
        is_valid = verify_signature(message, public_key)
        assert is_valid is False

    def test_reject_signature_from_different_key(self, key_pair):
        """应拒绝来自不同密钥的签名"""
        private_pem, public_pem = key_pair
        private_key = import_private_key(private_pem)

        # 生成另一个密钥对
        other_private_pem, other_public_pem = generate_key_pair()
        other_public_key = import_public_key(other_public_pem)

        payload = create_test_progress_payload()
        key_id = f"{AUTOMATON_DID}#key-1"

        signature = sign_payload(payload, private_key, key_id)

        message = ANPMessage(
            context=DEFAULT_CONTEXT,
            message_type="ANPMessage",
            id="test-msg-003",
            timestamp=datetime.utcnow(),
            actor=AUTOMATON_DID,
            target=NANOBOT_DID,
            type=ANPMessageType.TASK_UPDATE,
            object=payload,
            signature=signature,
        )

        # 使用不同的公钥验证
        is_valid = verify_signature(message, other_public_key)
        assert is_valid is False

    def test_create_and_verify_anp_message(self, key_pair):
        """应创建和验证完整的 ANP 消息"""
        private_pem, public_pem = key_pair
        private_key = import_private_key(private_pem)
        public_key = import_public_key(public_pem)

        payload = create_test_genesis_payload()

        options = CreateMessageOptions(
            type=ANPMessageType.TASK_CREATE,
            target_did=NANOBOT_DID,
        )

        message = create_anp_message(payload, private_key, options)

        assert message.actor == AUTOMATON_DID
        assert message.target == NANOBOT_DID
        assert message.type == ANPMessageType.TASK_CREATE
        assert message.signature is not None

        # 验证消息
        valid, error = verify_message(message, public_key)
        assert valid is True
        assert error is None

    def test_reject_expired_messages(self, key_pair):
        """应拒绝过期消息"""
        private_pem, public_pem = key_pair
        private_key = import_private_key(private_pem)
        public_key = import_public_key(public_pem)

        payload = create_test_progress_payload()
        key_id = f"{AUTOMATON_DID}#key-1"

        # 创建过期消息
        old_timestamp = datetime.utcnow() - timedelta(minutes=10)

        signature = sign_payload(payload, private_key, key_id)

        message = ANPMessage(
            context=DEFAULT_CONTEXT,
            message_type="ANPMessage",
            id="test-msg-004",
            timestamp=old_timestamp,
            actor=AUTOMATON_DID,
            target=NANOBOT_DID,
            type=ANPMessageType.TASK_UPDATE,
            object=payload,
            signature=signature,
            ttl=300,  # 5 分钟 TTL
        )

        valid, error = verify_message(message, public_key, max_age_ms=300000)
        assert valid is False
        assert error is not None
        assert "expired" in error.lower() or "ttl" in error.lower()


# ============================================================================
# 加密解密测试
# ============================================================================


class TestEncryption:
    """加密解密测试"""

    def test_generate_ecdh_key_pair(self):
        """应生成 ECDH 密钥对"""
        private_key, public_key = generate_ecdh_key_pair()

        assert private_key is not None
        assert public_key is not None
        # 返回的是 cryptography 库的密钥对象
        assert isinstance(private_key, ec.EllipticCurvePrivateKey)
        assert isinstance(public_key, ec.EllipticCurvePublicKey)

    def test_compute_shared_secret(self):
        """双方应计算相同的共享密钥"""
        # Alice 生成密钥对
        alice_private, alice_public = generate_ecdh_key_pair()
        # Bob 生成密钥对
        bob_private, bob_public = generate_ecdh_key_pair()

        # 双方计算共享密钥
        alice_shared = compute_shared_secret(alice_private, bob_public)
        bob_shared = compute_shared_secret(bob_private, alice_public)

        # 共享密钥应该相同
        assert alice_shared == bob_shared
        assert len(alice_shared) == 32  # P-256 产生 32 字节共享密钥

    def test_derive_aes_key(self):
        """应从共享密钥派生 AES 密钥"""
        shared_secret = os.urandom(32)
        aes_key = derive_aes_key(shared_secret)

        assert len(aes_key) == 32  # AES-256 需要 32 字节密钥

    def test_encrypt_and_decrypt_aes(self):
        """应使用 AES-256-GCM 加密和解密"""
        plaintext = b"Hello, ANP World!"
        key = os.urandom(32)

        encrypted = encrypt_aes(plaintext, key)

        # encrypt_aes 返回 EncryptResult 对象
        assert isinstance(encrypted, EncryptResult)
        assert len(encrypted.iv) == 12  # GCM 推荐 12 字节 IV
        assert len(encrypted.tag) == 16  # GCM 标签 16 字节
        assert encrypted.ciphertext is not None

        decrypted = decrypt_aes(encrypted, key)
        assert decrypted == plaintext

    def test_fail_decryption_with_wrong_key(self):
        """使用错误密钥解密应失败"""
        plaintext = b"Secret message"
        correct_key = os.urandom(32)
        wrong_key = os.urandom(32)

        encrypted = encrypt_aes(plaintext, correct_key)

        with pytest.raises(Exception):
            decrypt_aes(encrypted, wrong_key)

    def test_encrypt_and_decrypt_message(self):
        """应加密和解密完整的 ANP 消息"""
        # 生成密钥
        sender_sign_private_pem, sender_sign_public_pem = generate_key_pair()
        sender_sign_private = import_private_key(sender_sign_private_pem)

        recipient_ecdh_private, recipient_ecdh_public = generate_ecdh_key_pair()

        # 创建原始消息
        payload = create_test_genesis_payload()
        options = CreateMessageOptions(
            type=ANPMessageType.TASK_CREATE,
            target_did=NANOBOT_DID,
        )
        message = create_anp_message(payload, sender_sign_private, options)

        # 加密消息 - 使用 EncryptMessageOptions
        encrypt_options = EncryptMessageOptions(recipient_did=NANOBOT_DID)
        encrypted = encrypt_message(
            message,
            sender_sign_private,
            recipient_ecdh_public,
            encrypt_options,
        )

        assert encrypted.message_type == "ANPEncryptedMessage"
        assert encrypted.encrypted_payload is not None
        assert encrypted.encrypted_payload.algorithm == "AES-256-GCM"
        assert encrypted.encrypted_payload.ephemeral_public_key is not None

        # 解密消息
        decrypted = decrypt_message(encrypted, recipient_ecdh_private)

        assert decrypted.id == message.id
        assert decrypted.actor == message.actor

    def test_fail_decryption_with_wrong_recipient_key(self):
        """使用错误的接收方密钥解密应失败"""
        sender_sign_private_pem, _ = generate_key_pair()
        sender_sign_private = import_private_key(sender_sign_private_pem)

        recipient_ecdh_private, recipient_ecdh_public = generate_ecdh_key_pair()

        payload = create_test_progress_payload()
        options = CreateMessageOptions(
            type=ANPMessageType.TASK_UPDATE,
            target_did=NANOBOT_DID,
        )
        message = create_anp_message(payload, sender_sign_private, options)

        encrypt_options = EncryptMessageOptions(recipient_did=NANOBOT_DID)
        encrypted = encrypt_message(
            message,
            sender_sign_private,
            recipient_ecdh_public,
            encrypt_options,
        )

        # 使用错误的私钥
        wrong_private, _ = generate_ecdh_key_pair()

        with pytest.raises(Exception):
            decrypt_message(encrypted, wrong_private)


# ============================================================================
# 哈希一致性测试
# ============================================================================


class TestHashConsistency:
    """哈希一致性测试"""

    def test_consistent_hash_for_same_payload(self):
        """相同负载应产生一致的哈希"""
        payload = create_test_progress_payload()

        hash1 = hash_payload(payload)
        hash2 = hash_payload(payload)

        assert hash1 == hash2

    def test_different_hash_for_different_payload(self):
        """不同负载应产生不同的哈希"""
        payload1 = create_test_progress_payload()
        payload2 = create_test_progress_payload()
        payload2.progress = 99

        hash1 = hash_payload(payload1)
        hash2 = hash_payload(payload2)

        assert hash1 != hash2
