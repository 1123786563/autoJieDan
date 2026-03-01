"""
测试密钥轮换机制
"""

import pytest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch
import tempfile
import shutil

from nanobot.anp.did import (
    KeyMetadata,
    KeyRotationConfig,
    generate_key_pair,
    import_private_key,
    get_key_store_path,
    get_key_history_path,
    should_rotate_key,
    rotate_key,
    cleanup_old_keys,
    get_all_keys_for_did,
    is_key_valid_for_signature,
    initialize_key_rotation,
    DidDocumentOptions,
    register_did_document,
    _key_history,
)


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture
def temp_key_store():
    """临时密钥存储目录"""
    temp_dir = tempfile.mkdtemp()
    original_path = None

    # 保存并替换密钥存储路径
    import nanobot.anp.did as did_module
    original_get_key_store_path = did_module.get_key_store_path

    def mock_get_key_store_path():
        return Path(temp_dir)

    did_module.get_key_store_path = mock_get_key_store_path

    yield temp_dir

    # 清理
    shutil.rmtree(temp_dir, ignore_errors=True)
    did_module.get_key_store_path = original_get_key_store_path


@pytest.fixture
def sample_did_options():
    """示例 DID 选项"""
    return DidDocumentOptions(
        did="did:anp:nanobot:test",
        service_endpoint="ws://localhost:8080",
        agent_name="Test Nanobot",
        agent_description="Test agent",
        capabilities=["test"],
    )


@pytest.fixture
def sample_config():
    """示例轮换配置"""
    return KeyRotationConfig(
        rotation_interval_days=30,
        key_lifetime_days=90,
        grace_period_days=7,
        max_history_keys=5,
    )


# ============================================================================
# KeyMetadata Tests
# ============================================================================

class TestKeyMetadata:
    """测试密钥元数据"""

    def test_age_days_calculation(self):
        """测试密钥年龄计算"""
        now = datetime.now()
        metadata = KeyMetadata(
            key_id="did:anp:test#key-1",
            did="did:anp:test",
            created_at=now - timedelta(days=10),
            expires_at=now + timedelta(days=80),
            is_current=True,
        )

        assert metadata.age_days == 10

    def test_is_expired(self):
        """测试过期检查"""
        now = datetime.now()
        expired_metadata = KeyMetadata(
            key_id="did:anp:test#key-1",
            did="did:anp:test",
            created_at=now - timedelta(days=100),
            expires_at=now - timedelta(days=1),
            is_current=True,
        )

        valid_metadata = KeyMetadata(
            key_id="did:anp:test#key-2",
            did="did:anp:test",
            created_at=now,
            expires_at=now + timedelta(days=90),
            is_current=True,
        )

        assert expired_metadata.is_expired is True
        assert valid_metadata.is_expired is False

    def test_should_rotate(self):
        """测试是否应该轮换"""
        now = datetime.now()
        old_metadata = KeyMetadata(
            key_id="did:anp:test#key-1",
            did="did:anp:test",
            created_at=now - timedelta(days=35),
            expires_at=now + timedelta(days=55),
            is_current=True,
        )

        new_metadata = KeyMetadata(
            key_id="did:anp:test#key-2",
            did="did:anp:test",
            created_at=now - timedelta(days=10),
            expires_at=now + timedelta(days=80),
            is_current=True,
        )

        assert old_metadata.should_rotate(30) is True
        assert new_metadata.should_rotate(30) is False


# ============================================================================
# KeyRotationConfig Tests
# ============================================================================

class TestKeyRotationConfig:
    """测试密钥轮换配置"""

    def test_default_values(self):
        """测试默认值"""
        config = KeyRotationConfig()

        assert config.rotation_interval_days == 30
        assert config.key_lifetime_days == 90
        assert config.grace_period_days == 7
        assert config.max_history_keys == 5

    def test_custom_values(self):
        """测试自定义值"""
        config = KeyRotationConfig(
            rotation_interval_days=60,
            key_lifetime_days=180,
            grace_period_days=14,
            max_history_keys=10,
        )

        assert config.rotation_interval_days == 60
        assert config.key_lifetime_days == 180
        assert config.grace_period_days == 14
        assert config.max_history_keys == 10


# ============================================================================
# 密钥轮换功能测试
# ============================================================================

class TestKeyRotation:
    """测试密钥轮换功能"""

    def test_should_rotate_key_no_metadata(self):
        """测试没有元数据时不应轮换"""
        result = should_rotate_key("did:anp:unknown")
        assert result is False

    def test_should_rotate_key_old_key(self, temp_key_store):
        """测试旧密钥应该轮换"""
        # 清空全局历史
        _key_history.clear()

        now = datetime.now()
        metadata = KeyMetadata(
            key_id="did:anp:test#key-1",
            did="did:anp:test",
            created_at=now - timedelta(days=35),
            expires_at=now + timedelta(days=55),
            is_current=True,
        )

        _key_history["did:anp:test"] = [metadata]

        result = should_rotate_key("did:anp:test")
        assert result is True

    def test_should_rotate_key_new_key(self, temp_key_store):
        """测试新密钥不应轮换"""
        # 清空全局历史
        _key_history.clear()

        now = datetime.now()
        metadata = KeyMetadata(
            key_id="did:anp:test#key-1",
            did="did:anp:test",
            created_at=now - timedelta(days=10),
            expires_at=now + timedelta(days=80),
            is_current=True,
        )

        _key_history["did:anp:test"] = [metadata]

        result = should_rotate_key("did:anp:test")
        assert result is False

    @pytest.mark.asyncio
    async def test_rotate_key_creates_new_version(self, temp_key_store, sample_did_options, sample_config):
        """测试密钥轮换创建新版本"""
        # 清空全局历史
        _key_history.clear()

        # 创建初始密钥
        private_pem, _ = generate_key_pair()
        private_key = import_private_key(private_pem)

        from nanobot.anp.did import save_private_key, add_key_metadata
        save_private_key(sample_did_options.did, private_key)

        now = datetime.now()
        initial_metadata = KeyMetadata(
            key_id=f"{sample_did_options.did}#key-1",
            did=sample_did_options.did,
            created_at=now,
            expires_at=now + timedelta(days=90),
            is_current=True,
        )
        add_key_metadata(initial_metadata)

        # 执行轮换
        new_doc, new_private_key, new_public_key, new_metadata = rotate_key(
            sample_did_options.did,
            sample_did_options,
            sample_config
        )

        # 验证新密钥
        assert new_metadata.key_id == f"{sample_did_options.did}#key-2"
        assert new_metadata.is_current is True
        assert initial_metadata.is_current is False

        # 验证新密钥文件存在
        assert new_metadata.private_key_path.exists()

    def test_cleanup_old_keys(self, temp_key_store, sample_config):
        """测试清理旧密钥"""
        # 清空全局历史
        _key_history.clear()

        now = datetime.now()
        did = "did:anp:test"

        # 创建多个密钥元数据
        keys = [
            KeyMetadata(
                key_id=f"{did}#key-1",
                did=did,
                created_at=now - timedelta(days=100),
                expires_at=now - timedelta(days=10),
                is_current=False,
            ),
            KeyMetadata(
                key_id=f"{did}#key-2",
                did=did,
                created_at=now - timedelta(days=60),
                expires_at=now + timedelta(days=30),
                is_current=False,
            ),
            KeyMetadata(
                key_id=f"{did}#key-3",
                did=did,
                created_at=now - timedelta(days=10),
                expires_at=now + timedelta(days=80),
                is_current=True,
            ),
        ]

        _key_history[did] = keys

        # 执行清理
        cleanup_old_keys(did, sample_config)

        # 验证结果
        remaining_keys = get_all_keys_for_did(did)
        assert len(remaining_keys) <= 3  # 最多保留配置的数量

    def test_is_key_valid_for_signature_current_key(self, temp_key_store):
        """测试当前密钥可用于签名"""
        # 清空全局历史
        _key_history.clear()

        now = datetime.now()
        metadata = KeyMetadata(
            key_id="did:anp:test#key-1",
            did="did:anp:test",
            created_at=now,
            expires_at=now + timedelta(days=90),
            is_current=True,
        )

        _key_history["did:anp:test"] = [metadata]

        result = is_key_valid_for_signature("did:anp:test", metadata.key_id)
        assert result is True

    def test_is_key_valid_for_signature_old_key_in_grace_period(self, temp_key_store, sample_config):
        """测试宽限期内的旧密钥可用于签名"""
        # 清空全局历史
        _key_history.clear()

        now = datetime.now()
        metadata = KeyMetadata(
            key_id="did:anp:test#key-1",
            did="did:anp:test",
            created_at=now - timedelta(days=32),  # 32天前创建
            expires_at=now + timedelta(days=58),
            is_current=False,
        )

        _key_history["did:anp:test"] = [metadata]

        # 32天前创建，宽限期是 30+7=37天，所以仍在宽限期内
        result = is_key_valid_for_signature("did:anp:test", metadata.key_id, sample_config)
        assert result is True

    def test_is_key_valid_for_signature_old_key_outside_grace_period(self, temp_key_store, sample_config):
        """测试宽限期外的旧密钥不可用于签名"""
        # 清空全局历史
        _key_history.clear()

        now = datetime.now()
        metadata = KeyMetadata(
            key_id="did:anp:test#key-1",
            did="did:anp:test",
            created_at=now - timedelta(days=40),  # 40天前创建
            expires_at=now + timedelta(days=50),
            is_current=False,
        )

        _key_history["did:anp:test"] = [metadata]

        # 40天前创建，宽限期是 30+7=37天，所以已超出宽限期
        result = is_key_valid_for_signature("did:anp:test", metadata.key_id, sample_config)
        assert result is False


# ============================================================================
# 验收标准测试
# ============================================================================

class TestAcceptanceCriteria:
    """测试验收标准：30天自动轮换"""

    def test_30_day_rotation_interval(self):
        """测试30天轮换间隔"""
        config = KeyRotationConfig()
        assert config.rotation_interval_days == 30

    def test_key_rotation_triggered_after_30_days(self, temp_key_store):
        """测试密钥在30天后触发轮换"""
        # 清空全局历史
        _key_history.clear()

        now = datetime.now()

        # 29天的密钥不应轮换
        metadata_29_days = KeyMetadata(
            key_id="did:anp:test#key-1",
            did="did:anp:test",
            created_at=now - timedelta(days=29),
            expires_at=now + timedelta(days=61),
            is_current=True,
        )

        _key_history["did:anp:test"] = [metadata_29_days]
        assert should_rotate_key("did:anp:test") is False

        # 30天的密钥应该轮换
        _key_history.clear()
        metadata_30_days = KeyMetadata(
            key_id="did:anp:test#key-2",
            did="did:anp:test",
            created_at=now - timedelta(days=30),
            expires_at=now + timedelta(days=60),
            is_current=True,
        )

        _key_history["did:anp:test"] = [metadata_30_days]
        assert should_rotate_key("did:anp:test") is True

    def test_key_lifetime_90_days(self):
        """测试密钥生命周期为90天"""
        config = KeyRotationConfig()
        assert config.key_lifetime_days == 90

    def test_grace_period_7_days(self):
        """测试宽限期为7天"""
        config = KeyRotationConfig()
        assert config.grace_period_days == 7
