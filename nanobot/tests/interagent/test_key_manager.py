"""
测试密钥管理与轮换
"""

import asyncio
import pytest
from datetime import datetime, timedelta
from unittest.mock import Mock, MagicMock

from nanobot.interagent.key_manager import (
    KeyStatus,
    KeyAlgorithm,
    KeyPurpose,
    Key,
    RotationPolicy,
    KeyFilter,
    KeyStorage,
    MemoryKeyStorage,
    KeyManagerConfig,
    KeyManager,
    create_key_manager,
    format_key,
    format_rotation_policy,
)


class TestKeyManager:
    """测试密钥管理器"""

    @pytest.fixture
    def key_manager(self) -> KeyManager:
        return create_key_manager(
            KeyManagerConfig(
                storage=MemoryKeyStorage(),
                default_algorithm=KeyAlgorithm.AES_256_GCM,
                auto_rotate=False,
            )
        )

    def teardown_method(self) -> None:
        pass

    # ========================================================================
    # 密钥生成
    # ========================================================================

    def test_generate_key_with_default_options(self, key_manager: KeyManager):
        """测试使用默认选项生成密钥"""
        key = key_manager.generate_key(KeyPurpose.ENCRYPTION)

        assert key.id is not None
        assert key.id.startswith("key-")
        assert key.purpose == KeyPurpose.ENCRYPTION
        assert key.algorithm == KeyAlgorithm.AES_256_GCM
        assert key.status == KeyStatus.ACTIVE
        assert key.value is not None
        assert key.created_at is not None
        assert key.rotation_count == 0

    def test_generate_key_with_custom_name(self, key_manager: KeyManager):
        """测试使用自定义名称生成密钥"""
        key = key_manager.generate_key(KeyPurpose.SIGNING, name="custom-key")

        assert key.name == "custom-key"
        assert key.purpose == KeyPurpose.SIGNING

    def test_generate_key_with_custom_algorithm(self, key_manager: KeyManager):
        """测试使用自定义算法生成密钥"""
        key = key_manager.generate_key(
            KeyPurpose.ENCRYPTION, algorithm=KeyAlgorithm.AES_128_CBC
        )

        assert key.algorithm == KeyAlgorithm.AES_128_CBC

    def test_generate_key_with_expiration(self, key_manager: KeyManager):
        """测试生成带过期时间的密钥"""
        expires_in = 3600000  # 1 hour
        key = key_manager.generate_key(KeyPurpose.ENCRYPTION, expires_in=expires_in)

        assert key.expires_at is not None
        assert key.expires_at > datetime.now()

    def test_generate_key_with_metadata(self, key_manager: KeyManager):
        """测试生成带元数据的密钥"""
        metadata = {"owner": "test-user", "environment": "dev"}
        key = key_manager.generate_key(KeyPurpose.ENCRYPTION, metadata=metadata)

        assert key.metadata == metadata

    def test_generate_key_from_passphrase(self, key_manager: KeyManager):
        """测试从密码生成密钥"""
        key = key_manager.generate_key_from_passphrase(
            KeyPurpose.ENCRYPTION, "my-secret-passphrase"
        )

        assert key.id is not None
        assert key.purpose == KeyPurpose.ENCRYPTION
        assert key.value is not None
        assert "salt" in key.metadata

    def test_generate_same_key_from_same_passphrase_and_salt(self, key_manager: KeyManager):
        """测试相同密码和盐值生成相同密钥"""
        # Use a valid hex string for salt (32 hex chars = 16 bytes)
        salt = "deadbeef0123456789abcdef01234567"
        key1 = key_manager.generate_key_from_passphrase(
            KeyPurpose.ENCRYPTION, "passphrase", salt=salt
        )
        key2 = key_manager.generate_key_from_passphrase(
            KeyPurpose.ENCRYPTION, "passphrase", salt=salt
        )

        assert key1.value == key2.value

    def test_emit_key_generated_event(self, key_manager: KeyManager):
        """测试发射 key:generated 事件"""
        handler = Mock()
        key_manager.on("key:generated", handler)

        key_manager.generate_key(KeyPurpose.ENCRYPTION)

        handler.assert_called_once()
        call_args = handler.call_args
        assert call_args[0][0].purpose == KeyPurpose.ENCRYPTION

    # ========================================================================
    # 密钥获取
    # ========================================================================

    @pytest.mark.asyncio
    async def test_get_key_by_id(self, key_manager: KeyManager):
        """测试通过ID获取密钥"""
        generated_key = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        await key_manager._config.storage.set(generated_key)
        retrieved_key = await key_manager.get_key(generated_key.id)

        assert retrieved_key is not None
        assert retrieved_key.id == generated_key.id
        assert retrieved_key.value == generated_key.value

    @pytest.mark.asyncio
    async def test_get_non_existent_key(self, key_manager: KeyManager):
        """测试获取不存在的密钥"""
        key = await key_manager.get_key("non-existent-id")

        assert key is None

    @pytest.mark.asyncio
    async def test_get_inactive_key(self, key_manager: KeyManager):
        """测试获取非活跃密钥"""
        generated_key = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        await key_manager._config.storage.set(generated_key)
        await key_manager.delete_key(generated_key.id)
        retrieved_key = await key_manager.get_key(generated_key.id)

        assert retrieved_key is None

    @pytest.mark.asyncio
    async def test_update_last_used_at(self, key_manager: KeyManager):
        """测试更新最后使用时间"""
        generated_key = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        await key_manager._config.storage.set(generated_key)

        import time

        time.sleep(0.01)
        retrieved_key = await key_manager.get_key(generated_key.id)

        assert retrieved_key is not None
        assert retrieved_key.last_used_at is not None
        assert retrieved_key.last_used_at > generated_key.created_at

    @pytest.mark.asyncio
    async def test_get_active_key_by_purpose(self, key_manager: KeyManager):
        """测试按用途获取活跃密钥"""
        key1 = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        key2 = key_manager.generate_key(KeyPurpose.SIGNING)
        await key_manager._config.storage.set(key1)
        await key_manager._config.storage.set(key2)

        encryption_key = await key_manager.get_active_key(KeyPurpose.ENCRYPTION)

        assert encryption_key is not None
        assert encryption_key.purpose == KeyPurpose.ENCRYPTION

    @pytest.mark.asyncio
    async def test_get_most_recent_active_key(self, key_manager: KeyManager):
        """测试获取最新的活跃密钥"""
        old_key = key_manager.generate_key(KeyPurpose.ENCRYPTION, name="old-key")
        await key_manager._config.storage.set(old_key)

        import time

        time.sleep(0.01)

        new_key = key_manager.generate_key(KeyPurpose.ENCRYPTION, name="new-key")
        await key_manager._config.storage.set(new_key)

        active_key = await key_manager.get_active_key(KeyPurpose.ENCRYPTION)

        assert active_key is not None
        assert active_key.id == new_key.id

    @pytest.mark.asyncio
    async def test_no_active_key_for_purpose(self, key_manager: KeyManager):
        """测试没有活跃密钥"""
        key = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        await key_manager._config.storage.set(key)

        signing_key = await key_manager.get_active_key(KeyPurpose.SIGNING)

        assert signing_key is None

    @pytest.mark.asyncio
    async def test_get_all_keys(self, key_manager: KeyManager):
        """测试获取所有密钥"""
        key1 = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        key2 = key_manager.generate_key(KeyPurpose.SIGNING)
        key3 = key_manager.generate_key(KeyPurpose.AUTHENTICATION)
        await key_manager._config.storage.set(key1)
        await key_manager._config.storage.set(key2)
        await key_manager._config.storage.set(key3)

        keys = await key_manager.get_all_keys()

        assert len(keys) == 3

    @pytest.mark.asyncio
    async def test_filter_keys_by_purpose(self, key_manager: KeyManager):
        """测试按用途过滤密钥"""
        key1 = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        key2 = key_manager.generate_key(KeyPurpose.SIGNING)
        key3 = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        await key_manager._config.storage.set(key1)
        await key_manager._config.storage.set(key2)
        await key_manager._config.storage.set(key3)

        keys = await key_manager.get_all_keys(KeyFilter(purpose=KeyPurpose.ENCRYPTION))

        assert len(keys) == 2
        for k in keys:
            assert k.purpose == KeyPurpose.ENCRYPTION

    @pytest.mark.asyncio
    async def test_filter_keys_by_algorithm(self, key_manager: KeyManager):
        """测试按算法过滤密钥"""
        key1 = key_manager.generate_key(
            KeyPurpose.ENCRYPTION, algorithm=KeyAlgorithm.AES_256_GCM
        )
        key2 = key_manager.generate_key(
            KeyPurpose.ENCRYPTION, algorithm=KeyAlgorithm.AES_128_CBC
        )
        await key_manager._config.storage.set(key1)
        await key_manager._config.storage.set(key2)

        keys = await key_manager.get_all_keys(
            KeyFilter(algorithm=KeyAlgorithm.AES_128_CBC)
        )

        assert len(keys) == 1
        assert keys[0].algorithm == KeyAlgorithm.AES_128_CBC

    @pytest.mark.asyncio
    async def test_filter_keys_by_status(self, key_manager: KeyManager):
        """测试按状态过滤密钥"""
        key1 = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        key2 = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        await key_manager._config.storage.set(key1)
        await key_manager._config.storage.set(key2)
        await key_manager.delete_key(key2.id)

        keys = await key_manager.get_all_keys(KeyFilter(status=KeyStatus.ACTIVE))

        assert len(keys) == 1
        assert keys[0].id == key1.id

    @pytest.mark.asyncio
    async def test_filter_keys_by_name_pattern(self, key_manager: KeyManager):
        """测试按名称模式过滤密钥"""
        key1 = key_manager.generate_key(KeyPurpose.ENCRYPTION, name="test-key-1")
        key2 = key_manager.generate_key(KeyPurpose.ENCRYPTION, name="prod-key-2")
        key3 = key_manager.generate_key(KeyPurpose.ENCRYPTION, name="test-key-3")
        await key_manager._config.storage.set(key1)
        await key_manager._config.storage.set(key2)
        await key_manager._config.storage.set(key3)

        keys = await key_manager.get_all_keys(KeyFilter(name_pattern="^test-"))

        assert len(keys) == 2

    # ========================================================================
    # 密钥轮换
    # ========================================================================

    @pytest.mark.asyncio
    async def test_rotate_key(self, key_manager: KeyManager):
        """测试轮换密钥"""
        old_key = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        await key_manager._config.storage.set(old_key)

        new_key = await key_manager.rotate_key(old_key.id)

        assert new_key.id != old_key.id
        assert new_key.purpose == old_key.purpose
        assert new_key.algorithm == old_key.algorithm
        assert new_key.status == KeyStatus.ACTIVE
        assert new_key.rotation_count == 1
        assert new_key.metadata.get("previousKeyId") == old_key.id

    @pytest.mark.asyncio
    async def test_old_key_marked_as_rotating(self, key_manager: KeyManager):
        """测试旧密钥标记为轮换中"""
        old_key = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        await key_manager._config.storage.set(old_key)

        await key_manager.rotate_key(old_key.id)

        storage = key_manager._config.storage
        stored_old_key = await storage.get(old_key.id)
        assert stored_old_key is not None
        assert stored_old_key.status == KeyStatus.ROTATING

    @pytest.mark.asyncio
    async def test_rotate_non_existent_key(self, key_manager: KeyManager):
        """测试轮换不存在的密钥"""
        with pytest.raises(ValueError, match="Key not found"):
            await key_manager.rotate_key("non-existent")

    def test_emit_key_rotating_event(self, key_manager: KeyManager):
        """测试发射 key:rotating 事件"""
        handler = Mock()
        key_manager.on("key:rotating", handler)

        old_key = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        import asyncio

        asyncio.run(key_manager._config.storage.set(old_key))
        asyncio.run(key_manager.rotate_key(old_key.id))

        handler.assert_called_once()

    def test_emit_key_rotated_event(self, key_manager: KeyManager):
        """测试发射 key:rotated 事件"""
        handler = Mock()
        key_manager.on("key:rotated", handler)

        old_key = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        import asyncio

        asyncio.run(key_manager._config.storage.set(old_key))
        asyncio.run(key_manager.rotate_key(old_key.id))

        handler.assert_called_once()

    @pytest.mark.asyncio
    async def test_increment_rotation_count(self, key_manager: KeyManager):
        """测试递增轮换计数"""
        key = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        await key_manager._config.storage.set(key)

        rotated1 = await key_manager.rotate_key(key.id)
        rotated2 = await key_manager.rotate_key(rotated1.id)

        assert rotated2.rotation_count == 2

    # ========================================================================
    # 密钥验证
    # ========================================================================

    @pytest.mark.asyncio
    async def test_validate_active_key(self, key_manager: KeyManager):
        """测试验证活跃密钥"""
        key = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        await key_manager._config.storage.set(key)

        is_valid = await key_manager.validate_key(key.id)

        assert is_valid is True

    @pytest.mark.asyncio
    async def test_validate_non_existent_key(self, key_manager: KeyManager):
        """测试验证不存在的密钥"""
        is_valid = await key_manager.validate_key("non-existent")

        assert is_valid is False

    @pytest.mark.asyncio
    async def test_validate_inactive_key(self, key_manager: KeyManager):
        """测试验证非活跃密钥"""
        key = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        await key_manager._config.storage.set(key)
        await key_manager.delete_key(key.id)

        is_valid = await key_manager.validate_key(key.id)

        assert is_valid is False

    # ========================================================================
    # 密钥删除
    # ========================================================================

    @pytest.mark.asyncio
    async def test_soft_delete_key(self, key_manager: KeyManager):
        """测试软删除密钥"""
        key = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        await key_manager._config.storage.set(key)

        deleted = await key_manager.delete_key(key.id)
        storage = key_manager._config.storage
        stored_key = await storage.get(key.id)

        assert deleted is True
        assert stored_key is not None
        assert stored_key.status == KeyStatus.INACTIVE

    def test_emit_key_deleted_event(self, key_manager: KeyManager):
        """测试发射 key:deleted 事件"""
        handler = Mock()
        key_manager.on("key:deleted", handler)

        key = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        import asyncio

        asyncio.run(key_manager._config.storage.set(key))
        asyncio.run(key_manager.delete_key(key.id))

        handler.assert_called_once()

    @pytest.mark.asyncio
    async def test_delete_non_existent_key(self, key_manager: KeyManager):
        """测试删除不存在的密钥"""
        deleted = await key_manager.delete_key("non-existent")

        assert deleted is False

    @pytest.mark.asyncio
    async def test_destroy_key(self, key_manager: KeyManager):
        """测试彻底删除密钥"""
        key = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        await key_manager._config.storage.set(key)

        destroyed = await key_manager.destroy_key(key.id)
        storage = key_manager._config.storage
        stored_key = await storage.get(key.id)

        assert destroyed is True
        assert stored_key is None

    def test_emit_key_destroyed_event(self, key_manager: KeyManager):
        """测试发射 key:destroyed 事件"""
        handler = Mock()
        key_manager.on("key:destroyed", handler)

        key = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        import asyncio

        asyncio.run(key_manager._config.storage.set(key))
        asyncio.run(key_manager.destroy_key(key.id))

        handler.assert_called_with(key.id)

    # ========================================================================
    # 统计信息
    # ========================================================================

    @pytest.mark.asyncio
    async def test_get_key_stats(self, key_manager: KeyManager):
        """测试获取密钥统计"""
        key1 = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        key2 = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        key3 = key_manager.generate_key(KeyPurpose.SIGNING)
        await key_manager._config.storage.set(key1)
        await key_manager._config.storage.set(key2)
        await key_manager._config.storage.set(key3)

        stats = await key_manager.get_stats()

        assert stats["totalKeys"] == 3
        assert stats["activeKeys"] == 3
        assert stats["expiredKeys"] == 0
        assert stats["byPurpose"]["encryption"] == 2
        assert stats["byPurpose"]["signing"] == 1

    @pytest.mark.asyncio
    async def test_get_summary(self, key_manager: KeyManager):
        """测试获取摘要"""
        key1 = key_manager.generate_key(KeyPurpose.ENCRYPTION)
        key2 = key_manager.generate_key(KeyPurpose.SIGNING)
        await key_manager._config.storage.set(key1)
        await key_manager._config.storage.set(key2)

        await key_manager.rotate_key(key2.id)

        summary = await key_manager.get_summary()

        assert summary["keys"] == 3  # 2 original + 1 rotated
        assert summary["active"] >= 2
        assert summary["stats"] is not None

    # ========================================================================
    # 清理
    # ========================================================================

    def test_close_manager(self):
        """测试关闭管理器"""
        custom_storage = MemoryKeyStorage()
        manager = create_key_manager(
            KeyManagerConfig(storage=custom_storage, auto_rotate=True)
        )

        manager.start_auto_rotation()
        manager.close()

        # Should not throw

    def test_remove_all_listeners_on_close(self, key_manager: KeyManager):
        """测试关闭时移除所有监听器"""
        handler = Mock()
        key_manager.on("key:generated", handler)

        key_manager.close()

        assert key_manager.listener_count("key:generated") == 0


class TestMemoryKeyStorage:
    """测试内存密钥存储"""

    @pytest.fixture
    def storage(self) -> MemoryKeyStorage:
        return MemoryKeyStorage()

    @pytest.mark.asyncio
    async def test_store_and_retrieve_key(self, storage: MemoryKeyStorage):
        """测试存储和检索密钥"""
        key = Key(
            id="test-key-1",
            name="Test Key",
            purpose=KeyPurpose.ENCRYPTION,
            algorithm=KeyAlgorithm.AES_256_GCM,
            value="dGVzdC1rZXktdmFsdWU=",
            created_at=datetime.now(),
            status=KeyStatus.ACTIVE,
            metadata={},
            rotation_count=0,
        )

        await storage.set(key)
        retrieved = await storage.get(key.id)

        assert retrieved is not None
        assert retrieved.id == key.id
        assert retrieved.value == key.value

    @pytest.mark.asyncio
    async def test_get_non_existent_key(self, storage: MemoryKeyStorage):
        """测试获取不存在的密钥"""
        key = await storage.get("non-existent")

        assert key is None

    @pytest.mark.asyncio
    async def test_delete_key(self, storage: MemoryKeyStorage):
        """测试删除密钥"""
        key = Key(
            id="test-key-1",
            name="Test Key",
            purpose=KeyPurpose.ENCRYPTION,
            algorithm=KeyAlgorithm.AES_256_GCM,
            value="dGVzdC1rZXktdmFsdWU=",
            created_at=datetime.now(),
            status=KeyStatus.ACTIVE,
            metadata={},
            rotation_count=0,
        )

        await storage.set(key)
        await storage.delete(key.id)
        retrieved = await storage.get(key.id)

        assert retrieved is None

    @pytest.mark.asyncio
    async def test_list_all_keys(self, storage: MemoryKeyStorage):
        """测试列出所有密钥"""
        key1 = Key(
            id="key-1",
            name="Key 1",
            purpose=KeyPurpose.ENCRYPTION,
            algorithm=KeyAlgorithm.AES_256_GCM,
            value="dGVzdDE=",
            created_at=datetime.now(),
            status=KeyStatus.ACTIVE,
            metadata={},
            rotation_count=0,
        )
        key2 = Key(
            id="key-2",
            name="Key 2",
            purpose=KeyPurpose.SIGNING,
            algorithm=KeyAlgorithm.AES_256_GCM,
            value="dGVzdDI=",
            created_at=datetime.now(),
            status=KeyStatus.ACTIVE,
            metadata={},
            rotation_count=0,
        )

        await storage.set(key1)
        await storage.set(key2)

        keys = await storage.list()

        assert len(keys) == 2

    @pytest.mark.asyncio
    async def test_filter_keys_by_purpose(self, storage: MemoryKeyStorage):
        """测试按用途过滤密钥"""
        key1 = Key(
            id="key-1",
            name="Key 1",
            purpose=KeyPurpose.ENCRYPTION,
            algorithm=KeyAlgorithm.AES_256_GCM,
            value="dGVzdDE=",
            created_at=datetime.now(),
            status=KeyStatus.ACTIVE,
            metadata={},
            rotation_count=0,
        )
        key2 = Key(
            id="key-2",
            name="Key 2",
            purpose=KeyPurpose.SIGNING,
            algorithm=KeyAlgorithm.AES_256_GCM,
            value="dGVzdDI=",
            created_at=datetime.now(),
            status=KeyStatus.ACTIVE,
            metadata={},
            rotation_count=0,
        )

        await storage.set(key1)
        await storage.set(key2)

        keys = await storage.list(KeyFilter(purpose=KeyPurpose.ENCRYPTION))

        assert len(keys) == 1
        assert keys[0].purpose == KeyPurpose.ENCRYPTION

    @pytest.mark.asyncio
    async def test_return_copy_on_get(self, storage: MemoryKeyStorage):
        """测试获取时返回副本"""
        key = Key(
            id="test-key-1",
            name="Test Key",
            purpose=KeyPurpose.ENCRYPTION,
            algorithm=KeyAlgorithm.AES_256_GCM,
            value="dGVzdC1rZXktdmFsdWU=",
            created_at=datetime.now(),
            status=KeyStatus.ACTIVE,
            metadata={},
            rotation_count=0,
        )

        await storage.set(key)
        retrieved = await storage.get(key.id)
        assert retrieved is not None
        retrieved.name = "Modified"

        retrieved_again = await storage.get(key.id)

        assert retrieved_again is not None
        assert retrieved_again.name == "Test Key"


class TestFormatFunctions:
    """测试格式化函数"""

    def test_format_key(self):
        """测试格式化密钥"""
        key = Key(
            id="key-1",
            name="Test Key",
            purpose=KeyPurpose.ENCRYPTION,
            algorithm=KeyAlgorithm.AES_256_GCM,
            value="dGVzdA==",
            created_at=datetime(2026, 2, 26, 12, 0, 0),
            status=KeyStatus.ACTIVE,
            metadata={},
            rotation_count=5,
        )

        formatted = format_key(key)

        assert "key-1" in formatted
        assert "Test Key" in formatted
        assert "encryption" in formatted
        assert "aes-256-gcm" in formatted
        assert "active" in formatted
        assert "5" in formatted

    def test_format_key_with_expiration(self):
        """测试格式化带过期时间的密钥"""
        key = Key(
            id="key-2",
            name="Expiring Key",
            purpose=KeyPurpose.SIGNING,
            algorithm=KeyAlgorithm.AES_256_GCM,
            value="dGVzdA==",
            created_at=datetime.now(),
            expires_at=datetime.now() + timedelta(hours=1),
            status=KeyStatus.ACTIVE,
            metadata={},
            rotation_count=0,
        )

        formatted = format_key(key)

        assert "过期时间" in formatted

    def test_format_rotation_policy(self):
        """测试格式化轮换策略"""
        policy = RotationPolicy(
            interval_ms=24 * 60 * 60 * 1000,
            advance_ms=60 * 60 * 1000,
            min_length=32,
            max_length=64,
        )

        formatted = format_rotation_policy(policy)

        assert "轮换间隔" in formatted
        assert "提前轮换" in formatted
        assert "32" in formatted
        assert "64" in formatted


class TestFactoryFunction:
    """测试工厂函数"""

    def test_create_key_manager(self):
        """测试创建密钥管理器"""
        manager = create_key_manager()

        assert isinstance(manager, KeyManager)

    def test_create_with_config(self):
        """测试使用配置创建密钥管理器"""
        config = KeyManagerConfig(
            default_algorithm=KeyAlgorithm.AES_128_CBC,
            auto_rotate=False,
        )
        manager = create_key_manager(config)

        assert isinstance(manager, KeyManager)
