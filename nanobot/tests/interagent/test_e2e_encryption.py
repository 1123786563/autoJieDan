"""
ANP 端到端加密测试

测试 ECDH 密钥交换、AES-GCM 加密/解密、签名验证流程

@module tests.interagent.test_e2e_encryption
@version 1.0.0
"""

import base64
import pytest
from datetime import datetime

from cryptography.hazmat.primitives.asymmetric import ec

from nanobot.anp.did import (
    generate_key_pair,
    public_key_to_jwk,
    generate_did_document,
    DidDocumentOptions,
    import_private_key,
    import_public_key,
)
from nanobot.anp.encryption import (
    generate_ecdh_key_pair,
    compute_shared_secret,
    derive_aes_key,
    encrypt_aes,
    decrypt_aes,
    EncryptResult,
)
from nanobot.anp.signature import (
    sign_payload,
    verify_signature as verify_anp_signature,
)
from nanobot.anp.types import (
    ANPMessage,
    ANPMessageType,
    DidDocument,
    ProtocolConstraints,
    ProtocolNegotiatePayload,
)


def sign_message(data: bytes, private_key) -> bytes:
    """辅助函数：直接签名原始数据"""
    from cryptography.hazmat.primitives import hashes
    return private_key.sign(data, ec.ECDSA(hashes.SHA256()))


def verify_signature(data: bytes, signature: bytes, public_key) -> bool:
    """辅助函数：验证原始数据签名"""
    from cryptography.hazmat.primitives import hashes
    from cryptography.exceptions import InvalidSignature
    try:
        public_key.verify(signature, data, ec.ECDSA(hashes.SHA256()))
        return True
    except InvalidSignature:
        return False


class TestECDHKeyExchange:
    """ECDH 密钥交换测试"""

    def test_generate_ecdh_key_pair(self):
        """测试生成 ECDH 密钥对"""
        private_key, public_key = generate_ecdh_key_pair()

        assert private_key is not None
        assert public_key is not None
        assert isinstance(private_key, ec.EllipticCurvePrivateKey)
        assert isinstance(public_key, ec.EllipticCurvePublicKey)

    def test_compute_shared_secret(self):
        """测试计算共享密钥"""
        # Alice 生成密钥对
        alice_private, alice_public = generate_ecdh_key_pair()

        # Bob 生成密钥对
        bob_private, bob_public = generate_ecdh_key_pair()

        # 计算共享密钥（应该相同）
        alice_shared = compute_shared_secret(alice_private, bob_public)
        bob_shared = compute_shared_secret(bob_private, alice_public)

        assert alice_shared == bob_shared
        assert len(alice_shared) == 32  # 256 位

    def test_derive_aes_key(self):
        """测试从共享密钥派生 AES 密钥"""
        shared_secret = b"0" * 32  # 模拟 32 字节共享密钥
        aes_key = derive_aes_key(shared_secret)

        assert aes_key is not None
        assert len(aes_key) == 32  # AES-256

    def test_full_key_exchange_flow(self):
        """测试完整的密钥交换流程"""
        # 1. Alice 和 Bob 各自生成 ECDH 密钥对
        alice_private, alice_public = generate_ecdh_key_pair()
        bob_private, bob_public = generate_ecdh_key_pair()

        # 2. 交换公钥
        # 3. 各自计算共享密钥
        alice_shared = compute_shared_secret(alice_private, bob_public)
        bob_shared = compute_shared_secret(bob_private, alice_public)

        assert alice_shared == bob_shared

        # 4. 派生 AES 密钥
        alice_aes_key = derive_aes_key(alice_shared)
        bob_aes_key = derive_aes_key(bob_shared)

        # 5. 验证密钥相同
        assert alice_aes_key == bob_aes_key


class TestAESGCMEncryption:
    """AES-GCM 加密/解密测试"""

    def _encrypt_payload(self, plaintext: bytes, aes_key: bytes) -> tuple[bytes, bytes, bytes]:
        """辅助函数：加密并返回 (ciphertext, iv, tag)"""
        result = encrypt_aes(plaintext, aes_key)
        return result.ciphertext, result.iv, result.tag

    def _decrypt_payload(self, ciphertext: bytes, iv: bytes, tag: bytes, aes_key: bytes) -> bytes:
        """辅助函数：解密"""
        encrypted = EncryptResult(ciphertext=ciphertext, iv=iv, tag=tag)
        return decrypt_aes(encrypted, aes_key)

    def test_encrypt_decrypt_round_trip(self):
        """测试加密/解密往返"""
        # 生成密钥
        shared_secret = b"1" * 32
        aes_key = derive_aes_key(shared_secret)

        # 原始数据
        plaintext = b"Hello, ANP Protocol!"

        # 加密
        ciphertext, iv, tag = self._encrypt_payload(plaintext, aes_key)

        assert ciphertext is not None
        assert iv is not None
        assert tag is not None

        # 解密
        decrypted = self._decrypt_payload(ciphertext, iv, tag, aes_key)

        assert decrypted == plaintext

    def test_decrypt_with_wrong_key(self):
        """测试使用错误的密钥解密"""
        # 生成两个不同的密钥
        aes_key_1 = derive_aes_key(b"1" * 32)
        aes_key_2 = derive_aes_key(b"2" * 32)

        plaintext = b"Secret message"
        ciphertext, iv, tag = self._encrypt_payload(plaintext, aes_key_1)

        # 用密钥 2 解密应该失败
        with pytest.raises(Exception):
            self._decrypt_payload(ciphertext, iv, tag, aes_key_2)

    def test_decrypt_with_tampered_ciphertext(self):
        """测试解密被篡改的密文"""
        aes_key = derive_aes_key(b"3" * 32)
        plaintext = b"Important data"

        ciphertext, iv, tag = self._encrypt_payload(plaintext, aes_key)

        # 篡改密文
        tampered_ciphertext = ciphertext[:-1] + b"0"

        # 解密应该失败
        with pytest.raises(Exception):
            self._decrypt_payload(tampered_ciphertext, iv, tag, aes_key)

    def test_decrypt_with_tampered_tag(self):
        """测试解密被篡改的认证标签"""
        aes_key = derive_aes_key(b"4" * 32)
        plaintext = b"Critical info"

        ciphertext, iv, tag = self._encrypt_payload(plaintext, aes_key)

        # 篡改认证标签
        tampered_tag = tag[:-1] + b"X"

        # 解密应该失败
        with pytest.raises(Exception):
            self._decrypt_payload(ciphertext, iv, tampered_tag, aes_key)

    def test_encrypt_empty_payload(self):
        """测试加密空负载"""
        aes_key = derive_aes_key(b"5" * 32)
        plaintext = b""

        ciphertext, iv, tag = self._encrypt_payload(plaintext, aes_key)
        decrypted = self._decrypt_payload(ciphertext, iv, tag, aes_key)

        assert decrypted == plaintext

    def test_encrypt_large_payload(self):
        """测试加密大负载"""
        aes_key = derive_aes_key(b"6" * 32)
        plaintext = b"X" * 10000  # 10KB 数据

        ciphertext, iv, tag = self._encrypt_payload(plaintext, aes_key)
        decrypted = self._decrypt_payload(ciphertext, iv, tag, aes_key)

        assert decrypted == plaintext

    def test_iv_uniqueness(self):
        """测试每次加密生成不同的 IV"""
        aes_key = derive_aes_key(b"7" * 32)
        plaintext = b"Same message"

        # 加密两次
        ciphertext1, iv1, tag1 = self._encrypt_payload(plaintext, aes_key)
        ciphertext2, iv2, tag2 = self._encrypt_payload(plaintext, aes_key)

        # IV 应该不同
        assert iv1 != iv2
        # 密文也应该不同（因为 IV 不同）
        assert ciphertext1 != ciphertext2


class TestECDSASignature:
    """ECDSA 签名验证测试"""

    def test_sign_verify_round_trip(self):
        """测试签名/验证往返"""
        # 生成密钥对
        private_key_pem, public_key_pem = generate_key_pair()
        private_key = import_private_key(private_key_pem)
        public_key = import_public_key(public_key_pem)

        # 消息
        message = b"Sign this message"

        # 签名
        signature = sign_message(message, private_key)

        assert signature is not None

        # 验证
        is_valid = verify_signature(message, signature, public_key)

        assert is_valid is True

    def test_verify_with_wrong_public_key(self):
        """测试使用错误的公钥验证"""
        # 生成两对密钥
        private_key_pem_1, public_key_pem_1 = generate_key_pair()
        private_key_pem_2, public_key_pem_2 = generate_key_pair()

        private_key_1 = import_private_key(private_key_pem_1)
        public_key_2 = import_public_key(public_key_pem_2)

        message = b"Test message"
        signature = sign_message(message, private_key_1)

        # 用密钥对 2 的公钥验证应该失败
        is_valid = verify_signature(message, signature, public_key_2)

        assert is_valid is False

    def test_verify_with_tampered_message(self):
        """测试验证被篡改的消息"""
        private_key_pem, public_key_pem = generate_key_pair()
        private_key = import_private_key(private_key_pem)
        public_key = import_public_key(public_key_pem)

        original_message = b"Original message"
        tampered_message = b"Tampered message"

        signature = sign_message(original_message, private_key)

        # 验证篡改的消息应该失败
        is_valid = verify_signature(tampered_message, signature, public_key)

        assert is_valid is False

    def test_sign_empty_message(self):
        """测试签名空消息"""
        private_key_pem, public_key_pem = generate_key_pair()
        private_key = import_private_key(private_key_pem)
        public_key = import_public_key(public_key_pem)

        message = b""
        signature = sign_message(message, private_key)
        is_valid = verify_signature(message, signature, public_key)

        assert is_valid is True


class TestFullE2EFlow:
    """完整的端到端加密通信流程测试"""

    def test_full_secure_communication_flow(self):
        """测试完整的加密通信流程"""
        # 1. Alice 和 Bob 生成 DID 密钥对（用于签名）
        alice_did_private_pem, alice_did_public_pem = generate_key_pair()
        bob_did_private_pem, bob_did_public_pem = generate_key_pair()

        # 2. 生成 DID 文档
        alice_did = "did:anp:alice:main"
        bob_did = "did:anp:bob:main"

        alice_options = DidDocumentOptions(
            did=alice_did,
            service_endpoint="https://alice.example.com/anp",
            agent_name="Alice",
            agent_description="Test agent Alice",
            capabilities=["testing"],
        )
        bob_options = DidDocumentOptions(
            did=bob_did,
            service_endpoint="https://bob.example.com/anp",
            agent_name="Bob",
            agent_description="Test agent Bob",
            capabilities=["testing"],
        )

        # 导入公钥对象
        alice_public_key = import_public_key(alice_did_public_pem)
        bob_public_key = import_public_key(bob_did_public_pem)

        alice_did_doc = generate_did_document(alice_public_key, alice_options)
        bob_did_doc = generate_did_document(bob_public_key, bob_options)

        assert isinstance(alice_did_doc, DidDocument)
        assert isinstance(bob_did_doc, DidDocument)

        # 3. Alice 和 Bob 生成 ECDH 密钥对（用于加密）
        alice_ecdh_private, alice_ecdh_public = generate_ecdh_key_pair()
        bob_ecdh_private, bob_ecdh_public = generate_ecdh_key_pair()

        # 4. 交换 ECDH 公钥
        # 5. 计算共享密钥
        alice_shared = compute_shared_secret(alice_ecdh_private, bob_ecdh_public)
        bob_shared = compute_shared_secret(bob_ecdh_private, alice_ecdh_public)

        assert alice_shared == bob_shared

        # 6. 派生 AES 密钥
        aes_key = derive_aes_key(alice_shared)

        # 7. Alice 发送加密消息给 Bob
        payload = ProtocolNegotiatePayload(
            proposed_protocol="https://w3id.org/anp/protocols/genesis-prompt/v1",
            protocol_version="1.0.0",
            capabilities=["code-generation", "testing"],
            constraints=ProtocolConstraints(
                max_latency=500,
                encryption_required=True,
                compression="gzip",
            ),
        )

        payload_bytes = payload.model_dump_json(by_alias=True).encode("utf-8")

        # 8. Alice 加密负载
        encrypted = encrypt_aes(payload_bytes, aes_key)

        # 9. Alice 签名消息
        message_to_sign = encrypted.ciphertext + encrypted.tag
        alice_private_key = import_private_key(alice_did_private_pem)
        signature = sign_message(message_to_sign, alice_private_key)

        # 10. Bob 收到消息，先验证签名
        alice_public_key = import_public_key(alice_did_public_pem)
        is_valid = verify_signature(
            message_to_sign,
            signature,
            alice_public_key,
        )
        assert is_valid is True

        # 11. Bob 解密负载
        decrypted_bytes = decrypt_aes(encrypted, aes_key)
        decrypted_payload = ProtocolNegotiatePayload.model_validate_json(
            decrypted_bytes.decode("utf-8")
        )

        # 12. 验证消息内容
        assert decrypted_payload.proposed_protocol == payload.proposed_protocol
        assert decrypted_payload.protocol_version == payload.protocol_version
        assert decrypted_payload.constraints.encryption_required == payload.constraints.encryption_required


# 性能基准测试
class TestEncryptionPerformance:
    """加密性能测试"""

    def _encrypt_payload(self, plaintext: bytes, aes_key: bytes) -> tuple[bytes, bytes, bytes]:
        """辅助函数：加密并返回 (ciphertext, iv, tag)"""
        result = encrypt_aes(plaintext, aes_key)
        return result.ciphertext, result.iv, result.tag

    def _decrypt_payload(self, ciphertext: bytes, iv: bytes, tag: bytes, aes_key: bytes) -> bytes:
        """辅助函数：解密"""
        encrypted = EncryptResult(ciphertext=ciphertext, iv=iv, tag=tag)
        return decrypt_aes(encrypted, aes_key)

    def test_encryption_throughput(self):
        """测试加密吞吐量"""
        import time

        aes_key = derive_aes_key(b"perf" * 8)
        plaintext = b"X" * 1024  # 1KB 数据

        iterations = 1000
        start = time.time()

        for _ in range(iterations):
            self._encrypt_payload(plaintext, aes_key)

        elapsed = time.time() - start
        throughput = iterations / elapsed

        # 每秒应该能加密至少 100 次
        assert throughput > 100, f"Encryption throughput too low: {throughput}/s"

    def test_decryption_throughput(self):
        """测试解密吞吐量"""
        import time

        aes_key = derive_aes_key(b"perf" * 8)
        plaintext = b"Y" * 1024
        ciphertext, iv, tag = self._encrypt_payload(plaintext, aes_key)

        iterations = 1000
        start = time.time()

        for _ in range(iterations):
            self._decrypt_payload(ciphertext, iv, tag, aes_key)

        elapsed = time.time() - start
        throughput = iterations / elapsed

        # 每秒应该能解密至少 100 次
        assert throughput > 100, f"Decryption throughput too low: {throughput}/s"

    def test_latency_single_operation(self):
        """测试单次操作延迟"""
        import time

        aes_key = derive_aes_key(b"latency" * 4)
        plaintext = b"Latency test"

        # 加密延迟
        start = time.time()
        self._encrypt_payload(plaintext, aes_key)
        encrypt_latency = (time.time() - start) * 1000  # ms

        # 解密延迟
        ciphertext, iv, tag = self._encrypt_payload(plaintext, aes_key)
        start = time.time()
        self._decrypt_payload(ciphertext, iv, tag, aes_key)
        decrypt_latency = (time.time() - start) * 1000  # ms

        # 单次操作应该小于 10ms
        assert encrypt_latency < 10, f"Encrypt latency too high: {encrypt_latency}ms"
        assert decrypt_latency < 10, f"Decrypt latency too high: {decrypt_latency}ms"
