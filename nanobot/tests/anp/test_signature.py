"""
ANP 签名模块测试
"""

import pytest
from datetime import datetime, timedelta
from cryptography.hazmat.primitives.asymmetric import ec

from nanobot.anp.did import generate_key_pair, import_private_key, import_public_key
from nanobot.anp.signature import (
    hash_payload,
    sign_payload,
    verify_signature,
    create_anp_message,
    verify_message,
    CreateMessageOptions,
)
from nanobot.anp.types import (
    ProgressReportPayload,
    ANPMessageType,
    AUTOMATON_DID,
)


@pytest.fixture
def key_pair():
    """生成测试密钥对"""
    private_pem, public_pem = generate_key_pair()
    private_key = import_private_key(private_pem)
    public_key = import_public_key(public_pem)
    return private_key, public_key


@pytest.fixture
def test_payload():
    """创建测试负载"""
    return ProgressReportPayload(
        task_id="test-task-001",
        progress=50,
        current_phase="testing",
        completed_steps=["step1", "step2"],
        next_steps=["step3"],
    )


class TestHashPayload:
    """测试 hash_payload 函数"""

    def test_consistent_hash(self, test_payload):
        """相同负载应产生相同哈希"""
        hash1 = hash_payload(test_payload)
        hash2 = hash_payload(test_payload)
        assert hash1 == hash2

    def test_different_payload_different_hash(self, test_payload):
        """不同负载应产生不同哈希"""
        hash1 = hash_payload(test_payload)
        different_payload = test_payload.model_copy(update={"progress": 100})
        hash2 = hash_payload(different_payload)
        assert hash1 != hash2


class TestSignPayload:
    """测试 sign_payload 函数"""

    def test_create_valid_signature(self, key_pair, test_payload):
        """创建有效签名"""
        private_key, _ = key_pair
        key_id = f"{AUTOMATON_DID}#key-1"
        signature = sign_payload(test_payload, private_key, key_id)

        assert signature.type == "EcdsaSecp256r1Signature2019"
        assert signature.verification_method == key_id
        assert signature.proof_value is not None
        assert len(signature.proof_value) > 0

    def test_unique_signatures(self, key_pair, test_payload):
        """不同负载应产生不同签名"""
        private_key, _ = key_pair
        key_id = f"{AUTOMATON_DID}#key-1"

        signature1 = sign_payload(test_payload, private_key, key_id)
        different_payload = test_payload.model_copy(update={"progress": 100})
        signature2 = sign_payload(different_payload, private_key, key_id)

        assert signature1.proof_value != signature2.proof_value


class TestVerifySignature:
    """测试 verify_signature 函数"""

    def test_verify_valid_signature(self, key_pair, test_payload):
        """验证有效签名"""
        private_key, public_key = key_pair
        key_id = f"{AUTOMATON_DID}#key-1"

        signature = sign_payload(test_payload, private_key, key_id)

        # 创建消息
        from nanobot.anp.types import ANPMessage, ANPSignature
        message = ANPMessage(
            id="test-id",
            timestamp=datetime.utcnow(),
            actor=AUTOMATON_DID,
            target="",
            type=ANPMessageType.PROGRESS_EVENT,
            object=test_payload,
            signature=signature,
        )

        assert verify_signature(message, public_key) is True

    def test_reject_invalid_signature(self, key_pair, test_payload):
        """拒绝无效签名 (负载被修改)"""
        private_key, public_key = key_pair
        key_id = f"{AUTOMATON_DID}#key-1"

        signature = sign_payload(test_payload, private_key, key_id)

        # 使用不同的负载
        different_payload = test_payload.model_copy(update={"progress": 100})
        from nanobot.anp.types import ANPMessage
        message = ANPMessage(
            id="test-id",
            timestamp=datetime.utcnow(),
            actor=AUTOMATON_DID,
            target="",
            type=ANPMessageType.PROGRESS_EVENT,
            object=different_payload,
            signature=signature,
        )

        assert verify_signature(message, public_key) is False

    def test_reject_different_key(self, test_payload):
        """拒绝来自不同密钥的签名"""
        # 使用第一对密钥签名
        private_pem1, _ = generate_key_pair()
        private_key1 = import_private_key(private_pem1)
        key_id = f"{AUTOMATON_DID}#key-1"
        signature = sign_payload(test_payload, private_key1, key_id)

        # 使用第二对密钥验证
        _, public_pem2 = generate_key_pair()
        public_key2 = import_public_key(public_pem2)

        from nanobot.anp.types import ANPMessage
        message = ANPMessage(
            id="test-id",
            timestamp=datetime.utcnow(),
            actor=AUTOMATON_DID,
            target="",
            type=ANPMessageType.PROGRESS_EVENT,
            object=test_payload,
            signature=signature,
        )

        assert verify_signature(message, public_key2) is False


class TestCreateANPMessage:
    """测试 create_anp_message 函数"""

    def test_create_valid_message(self, key_pair, test_payload):
        """创建有效的 ANP 消息"""
        private_key, _ = key_pair
        options = CreateMessageOptions(
            type=ANPMessageType.PROGRESS_EVENT,
            target_did="did:anp:nanobot:main",
            correlation_id="corr-001",
            ttl=1800,
        )

        message = create_anp_message(test_payload, private_key, options)

        assert message.id is not None
        assert message.timestamp is not None
        assert message.actor == AUTOMATON_DID
        assert message.target == "did:anp:nanobot:main"
        assert message.type == ANPMessageType.PROGRESS_EVENT
        assert message.object == test_payload
        assert message.signature is not None
        assert message.correlation_id == "corr-001"
        assert message.ttl == 1800

    def test_created_message_is_verifiable(self, key_pair, test_payload):
        """创建的消息应可验证"""
        private_key, public_key = key_pair
        options = CreateMessageOptions(
            type=ANPMessageType.PROGRESS_EVENT,
        )

        message = create_anp_message(test_payload, private_key, options)
        assert verify_signature(message, public_key) is True


class TestVerifyMessage:
    """测试 verify_message 函数"""

    def test_verify_valid_message(self, key_pair, test_payload):
        """验证有效消息"""
        private_key, public_key = key_pair
        options = CreateMessageOptions(
            type=ANPMessageType.PROGRESS_EVENT,
            ttl=3600,
        )

        message = create_anp_message(test_payload, private_key, options)
        valid, error = verify_message(message, public_key)

        assert valid is True
        assert error is None

    def test_reject_invalid_signature(self, key_pair, test_payload):
        """拒绝无效签名的消息"""
        private_key, _ = key_pair
        options = CreateMessageOptions(
            type=ANPMessageType.PROGRESS_EVENT,
        )

        message = create_anp_message(test_payload, private_key, options)

        # 使用不同的公钥
        _, public_pem2 = generate_key_pair()
        public_key2 = import_public_key(public_pem2)

        valid, error = verify_message(message, public_key2)
        assert valid is False
        assert error == "Invalid signature"

    def test_reject_expired_message(self, key_pair, test_payload):
        """拒绝过期消息"""
        private_key, public_key = key_pair
        options = CreateMessageOptions(
            type=ANPMessageType.PROGRESS_EVENT,
        )

        message = create_anp_message(test_payload, private_key, options)

        # 手动修改时间戳为很久以前
        expired_message = message.model_copy(
            update={"timestamp": datetime.utcnow() - timedelta(minutes=10)}
        )

        valid, error = verify_message(expired_message, public_key, max_age_ms=300000)
        assert valid is False
        assert error == "Message expired"
