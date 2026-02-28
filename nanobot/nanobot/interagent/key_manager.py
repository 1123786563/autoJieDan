"""
密钥管理与轮换
提供密钥存储、轮换和过期处理

@module interagent/key_manager
@version 1.0.0
"""

from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Callable, Dict, List, Optional
from dataclasses import dataclass, field
import hashlib
import os
import secrets
import base64
import threading
import time


# ============================================================================
# 枚举类型
# ============================================================================


class KeyStatus(str, Enum):
    """密钥状态"""

    ACTIVE = "active"
    EXPIRED = "expired"
    ROTATING = "rotating"
    INACTIVE = "inactive"


class KeyAlgorithm(str, Enum):
    """密钥算法"""

    AES_256_GCM = "aes-256-gcm"
    AES_128_CBC = "aes-128-cbc"
    CHACHA20_POLY1305 = "chacha20-poly1305"


class KeyPurpose(str, Enum):
    """密钥用途"""

    ENCRYPTION = "encryption"
    SIGNING = "signing"
    AUTHENTICATION = "authentication"


# ============================================================================
# 数据类
# ============================================================================


@dataclass
class Key:
    """密钥"""

    id: str
    name: str
    purpose: KeyPurpose
    algorithm: KeyAlgorithm
    value: str  # Base64 encoded
    created_at: datetime
    status: KeyStatus = KeyStatus.ACTIVE
    expires_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    rotation_count: int = 0


@dataclass
class RotationPolicy:
    """轮换策略"""

    interval_ms: int = 24 * 60 * 60 * 1000  # 24 hours
    advance_ms: int = 60 * 60 * 1000  # 1 hour before expiration
    min_length: int = 32
    max_length: int = 64


@dataclass
class KeyFilter:
    """密钥过滤条件"""

    purpose: Optional[KeyPurpose] = None
    algorithm: Optional[KeyAlgorithm] = None
    status: Optional[KeyStatus] = None
    name_pattern: Optional[str] = None


# ============================================================================
# 存储接口
# ============================================================================


class KeyStorage:
    """密钥存储接口"""

    async def get(self, key_id: str) -> Optional[Key]:
        """获取密钥"""
        raise NotImplementedError

    async def set(self, key: Key) -> None:
        """存储密钥"""
        raise NotImplementedError

    async def delete(self, key_id: str) -> None:
        """删除密钥"""
        raise NotImplementedError

    async def list(self, key_filter: Optional[KeyFilter] = None) -> List[Key]:
        """列出密钥"""
        raise NotImplementedError


# ============================================================================
# 内存存储实现
# ============================================================================


class MemoryKeyStorage(KeyStorage):
    """内存密钥存储"""

    def __init__(self) -> None:
        self._keys: Dict[str, Key] = {}

    async def get(self, key_id: str) -> Optional[Key]:
        """获取密钥"""
        key = self._keys.get(key_id)
        if key:
            # Return a copy to maintain immutability
            return Key(
                id=key.id,
                name=key.name,
                purpose=key.purpose,
                algorithm=key.algorithm,
                value=key.value,
                created_at=key.created_at,
                status=key.status,
                expires_at=key.expires_at,
                last_used_at=key.last_used_at,
                metadata=dict(key.metadata),
                rotation_count=key.rotation_count,
            )
        return None

    async def set(self, key: Key) -> None:
        """存储密钥"""
        # Store a copy
        self._keys[key.id] = Key(
            id=key.id,
            name=key.name,
            purpose=key.purpose,
            algorithm=key.algorithm,
            value=key.value,
            created_at=key.created_at,
            status=key.status,
            expires_at=key.expires_at,
            last_used_at=key.last_used_at,
            metadata=dict(key.metadata),
            rotation_count=key.rotation_count,
        )

    async def delete(self, key_id: str) -> None:
        """删除密钥"""
        self._keys.pop(key_id, None)

    async def list(self, key_filter: Optional[KeyFilter] = None) -> List[Key]:
        """列出密钥"""
        result = list(self._keys.values())

        if key_filter:
            if key_filter.purpose:
                result = [k for k in result if k.purpose == key_filter.purpose]
            if key_filter.algorithm:
                result = [k for k in result if k.algorithm == key_filter.algorithm]
            if key_filter.status:
                result = [k for k in result if k.status == key_filter.status]
            if key_filter.name_pattern:
                import re

                regex = re.compile(key_filter.name_pattern)
                result = [k for k in result if regex.search(k.name)]

        return result


# ============================================================================
# EventEmitter
# ============================================================================


class EventEmitter:
    """简单的事件发射器"""

    def __init__(self) -> None:
        self._listeners: Dict[str, List[Callable]] = {}
        self._once_listeners: Dict[str, List[Callable]] = {}

    def on(self, event: str, handler: Callable) -> None:
        """注册事件监听器"""
        if event not in self._listeners:
            self._listeners[event] = []
        self._listeners[event].append(handler)

    def once(self, event: str, handler: Callable) -> None:
        """注册一次性事件监听器"""
        if event not in self._once_listeners:
            self._once_listeners[event] = []
        self._once_listeners[event].append(handler)

    def off(self, event: str, handler: Callable) -> None:
        """移除事件监听器"""
        if event in self._listeners:
            self._listeners[event] = [h for h in self._listeners[event] if h != handler]
        if event in self._once_listeners:
            self._once_listeners[event] = [
                h for h in self._once_listeners[event] if h != handler
            ]

    def emit(self, event: str, *args: Any, **kwargs: Any) -> None:
        """发射事件"""
        # Regular listeners
        if event in self._listeners:
            for handler in self._listeners[event]:
                try:
                    handler(*args, **kwargs)
                except Exception:
                    pass

        # Once listeners
        if event in self._once_listeners:
            for handler in self._once_listeners[event]:
                try:
                    handler(*args, **kwargs)
                except Exception:
                    pass
            self._once_listeners[event] = []

    def remove_all_listeners(self, event: Optional[str] = None) -> None:
        """移除所有监听器"""
        if event:
            self._listeners.pop(event, None)
            self._once_listeners.pop(event, None)
        else:
            self._listeners.clear()
            self._once_listeners.clear()

    def listener_count(self, event: str) -> int:
        """获取监听器数量"""
        count = len(self._listeners.get(event, []))
        count += len(self._once_listeners.get(event, []))
        return count


# ============================================================================
# KeyManager 配置
# ============================================================================


@dataclass
class KeyManagerConfig:
    """密钥管理器配置"""

    default_algorithm: KeyAlgorithm = KeyAlgorithm.AES_256_GCM
    rotation_policy: RotationPolicy = field(default_factory=RotationPolicy)
    storage: KeyStorage = field(default_factory=MemoryKeyStorage)
    auto_rotate: bool = True


# ============================================================================
# KeyManager 类
# ============================================================================


class KeyManager(EventEmitter):
    """密钥管理器"""

    def __init__(self, config: Optional[KeyManagerConfig] = None) -> None:
        super().__init__()
        self._config = config or KeyManagerConfig()
        self._rotation_timers: Dict[str, threading.Timer] = {}
        self._auto_rotation_timer: Optional[threading.Timer] = None
        self._running = False

    # =========================================================================
    # 密钥生成
    # =========================================================================

    def generate_key(
        self,
        purpose: KeyPurpose,
        algorithm: Optional[KeyAlgorithm] = None,
        name: Optional[str] = None,
        expires_in: Optional[int] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Key:
        """
        生成密钥

        Args:
            purpose: 密钥用途
            algorithm: 密钥算法
            name: 密钥名称
            expires_in: 过期时间（毫秒）
            metadata: 元数据

        Returns:
            生成的密钥
        """
        algo = algorithm or self._config.default_algorithm
        key_bytes = self._get_key_length(algo)
        raw_key = secrets.token_bytes(key_bytes)
        key_id = self._generate_key_id()
        now = datetime.now()

        expires_at = None
        if expires_in:
            expires_at = now + timedelta(milliseconds=expires_in)

        key = Key(
            id=key_id,
            name=name or f"key-{purpose.value}-{int(now.timestamp() * 1000)}",
            purpose=purpose,
            algorithm=algo,
            value=base64.b64encode(raw_key).decode("utf-8"),
            created_at=now,
            expires_at=expires_at,
            status=KeyStatus.ACTIVE,
            metadata=metadata or {},
            rotation_count=0,
        )

        # Store synchronously (we'll await in async context)
        import asyncio

        try:
            loop = asyncio.get_event_loop()
            loop.create_task(self._config.storage.set(key))
        except RuntimeError:
            # No event loop, schedule for later
            pass

        self.emit("key:generated", key)
        return key

    # PBKDF2 默认迭代次数
    # OWASP 2023 推荐 >= 600,000 for SHA256
    # NIST 2023 推荐 >= 2,048,000 for higher security
    # We use NIST recommendation for stronger security posture
    PBKDF2_ITERATIONS = 2048000

    def generate_key_from_passphrase(
        self,
        purpose: KeyPurpose,
        passphrase: str,
        algorithm: Optional[KeyAlgorithm] = None,
        name: Optional[str] = None,
        expires_in: Optional[int] = None,
        salt: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        iterations: Optional[int] = None,
    ) -> Key:
        """
        从密码生成密钥（使用 PBKDF2 安全派生）

        Args:
            purpose: 密钥用途
            passphrase: 密码
            algorithm: 密钥算法
            name: 密钥名称
            expires_in: 过期时间（毫秒）
            salt: 盐值（十六进制字符串，如未提供则生成随机盐）
            metadata: 元数据
            iterations: PBKDF2 迭代次数（默认 600,000）

        Returns:
            生成的密钥
        """
        algo = algorithm or self._config.default_algorithm
        key_bytes = self._get_key_length(algo)

        # 生成或使用提供的盐值（使用字节形式）
        if salt:
            salt_bytes = bytes.fromhex(salt)
        else:
            salt_bytes = secrets.token_bytes(16)
            salt = salt_bytes.hex()

        # 使用 PBKDF2-HMAC-SHA256 安全派生密钥
        actual_iterations = iterations or self.PBKDF2_ITERATIONS
        derived_key = hashlib.pbkdf2_hmac(
            "sha256",
            passphrase.encode("utf-8"),
            salt_bytes,
            actual_iterations,
            dklen=key_bytes,
        )

        key_id = self._generate_key_id()
        now = datetime.now()

        expires_at = None
        if expires_in:
            expires_at = now + timedelta(milliseconds=expires_in)

        key = Key(
            id=key_id,
            name=name or f"key-{purpose.value}-{int(now.timestamp() * 1000)}",
            purpose=purpose,
            algorithm=algo,
            value=base64.b64encode(derived_key).decode("utf-8"),
            created_at=now,
            expires_at=expires_at,
            status=KeyStatus.ACTIVE,
            metadata={
                **(metadata or {}),
                "salt": salt,
                "kdf": "pbkdf2-hmac-sha256",
                "iterations": actual_iterations,
            },
            rotation_count=0,
        )

        self.emit("key:generated", key)
        return key

    # =========================================================================
    # 密钥轮换
    # =========================================================================

    async def rotate_key(self, key_id: str) -> Key:
        """
        轮换密钥

        Args:
            key_id: 要轮换的密钥ID

        Returns:
            新密钥
        """
        old_key = await self._config.storage.get(key_id)
        if not old_key:
            raise ValueError(f"Key not found: {key_id}")

        # 生成新密钥
        new_key = self.generate_key(
            purpose=old_key.purpose,
            algorithm=old_key.algorithm,
            name=f"{old_key.name}-rotated",
            metadata={
                **old_key.metadata,
                "previousKeyId": old_key.id,
                "rotationNumber": old_key.rotation_count + 1,
            },
        )

        # 标记旧密钥为轮换中
        old_key.status = KeyStatus.ROTATING
        await self._config.storage.set(old_key)

        self.emit("key:rotating", old_key=old_key, new_key=new_key)

        # 激活新密钥
        new_key.status = KeyStatus.ACTIVE
        new_key.rotation_count = old_key.rotation_count + 1
        await self._config.storage.set(new_key)

        # 清理轮换计时器
        self._clear_rotation_timer(key_id)

        # 设置过渡期
        def deactivate_old_key() -> None:
            old_key.status = KeyStatus.INACTIVE
            import asyncio

            try:
                loop = asyncio.get_event_loop()
                loop.create_task(self._config.storage.set(old_key))
            except RuntimeError:
                pass
            self.emit("key:deactivated", old_key)

        timer = threading.Timer(60.0, deactivate_old_key)
        timer.start()

        self.emit("key:rotated", old_key=old_key, new_key=new_key)
        return new_key

    async def check_and_rotate(self) -> None:
        """检查并轮换即将过期的密钥"""
        keys = await self._config.storage.list(KeyFilter(status=KeyStatus.ACTIVE))
        now = datetime.now()

        for key in keys:
            if not key.expires_at:
                continue

            time_until_expiry = (key.expires_at - now).total_seconds() * 1000
            time_until_rotation = (
                time_until_expiry - self._config.rotation_policy.advance_ms
            )

            if time_until_rotation <= 0:
                await self.rotate_key(key.id)

    def start_auto_rotation(self) -> None:
        """启动自动轮换"""
        if not self._config.auto_rotate:
            return

        self._running = True

        def check_rotation() -> None:
            if not self._running:
                return
            import asyncio

            try:
                loop = asyncio.get_event_loop()
                loop.create_task(self._check_and_rotate_safe())
            except RuntimeError:
                pass
            finally:
                if self._running:
                    self._schedule_auto_rotation()

        self._auto_rotation_timer = threading.Timer(60.0, check_rotation)
        self._auto_rotation_timer.start()

    async def _check_and_rotate_safe(self) -> None:
        """安全地检查并轮换"""
        try:
            await self.check_and_rotate()
        except Exception as e:
            self.emit("rotation:error", e)

    def _schedule_auto_rotation(self) -> None:
        """调度下一次自动轮换检查"""
        if not self._running:
            return

        def check_rotation() -> None:
            if not self._running:
                return
            import asyncio

            try:
                loop = asyncio.get_event_loop()
                loop.create_task(self._check_and_rotate_safe())
            except RuntimeError:
                pass
            finally:
                if self._running:
                    self._schedule_auto_rotation()

        self._auto_rotation_timer = threading.Timer(60.0, check_rotation)
        self._auto_rotation_timer.start()

    def stop_auto_rotation(self) -> None:
        """停止自动轮换"""
        self._running = False

        if self._auto_rotation_timer:
            self._auto_rotation_timer.cancel()
            self._auto_rotation_timer = None

        for timer in self._rotation_timers.values():
            timer.cancel()
        self._rotation_timers.clear()

    # =========================================================================
    # 密钥获取
    # =========================================================================

    async def get_key(self, key_id: str) -> Optional[Key]:
        """
        获取密钥

        Args:
            key_id: 密钥ID

        Returns:
            密钥或None
        """
        key = await self._config.storage.get(key_id)

        if key and key.status == KeyStatus.ACTIVE:
            key.last_used_at = datetime.now()
            await self._config.storage.set(key)
            return key

        return None

    async def get_active_key(self, purpose: KeyPurpose) -> Optional[Key]:
        """
        按用途获取活跃密钥

        Args:
            purpose: 密钥用途

        Returns:
            最新的活跃密钥或None
        """
        keys = await self._config.storage.list(
            KeyFilter(purpose=purpose, status=KeyStatus.ACTIVE)
        )

        if not keys:
            return None

        # 按创建时间排序，返回最新的密钥
        keys.sort(key=lambda k: k.created_at, reverse=True)
        return keys[0]

    async def get_all_keys(self, key_filter: Optional[KeyFilter] = None) -> List[Key]:
        """
        获取所有密钥

        Args:
            key_filter: 过滤条件

        Returns:
            密钥列表
        """
        return await self._config.storage.list(key_filter)

    # =========================================================================
    # 密钥验证
    # =========================================================================

    async def validate_key(self, key_id: str) -> bool:
        """
        验证密钥是否有效

        Args:
            key_id: 密钥ID

        Returns:
            是否有效
        """
        key = await self._config.storage.get(key_id)

        if not key:
            return False
        if key.status != KeyStatus.ACTIVE:
            return False
        if key.expires_at and key.expires_at < datetime.now():
            return False

        return True

    # =========================================================================
    # 密钥删除
    # =========================================================================

    async def delete_key(self, key_id: str) -> bool:
        """
        删除密钥（软删除）

        Args:
            key_id: 密钥ID

        Returns:
            是否成功
        """
        key = await self._config.storage.get(key_id)

        if not key:
            return False

        key.status = KeyStatus.INACTIVE
        await self._config.storage.set(key)
        self.emit("key:deleted", key)

        return True

    async def destroy_key(self, key_id: str) -> bool:
        """
        彻底删除密钥

        Args:
            key_id: 密钥ID

        Returns:
            是否成功
        """
        await self._config.storage.delete(key_id)
        self._clear_rotation_timer(key_id)
        self.emit("key:destroyed", key_id)

        return True

    # =========================================================================
    # 统计
    # =========================================================================

    async def get_stats(self) -> Dict[str, Any]:
        """
        获取统计信息

        Returns:
            统计信息字典
        """
        keys = await self._config.storage.list()

        stats = {
            "totalKeys": len(keys),
            "activeKeys": 0,
            "expiredKeys": 0,
            "byPurpose": {},
            "byAlgorithm": {},
        }

        for key in keys:
            if key.status == KeyStatus.ACTIVE:
                stats["activeKeys"] += 1
            if key.status == KeyStatus.EXPIRED:
                stats["expiredKeys"] += 1

            purpose_key = key.purpose.value
            stats["byPurpose"][purpose_key] = stats["byPurpose"].get(purpose_key, 0) + 1

            algo_key = key.algorithm.value
            stats["byAlgorithm"][algo_key] = (
                stats["byAlgorithm"].get(algo_key, 0) + 1
            )

        return stats

    async def get_summary(self) -> Dict[str, Any]:
        """
        获取摘要

        Returns:
            摘要字典
        """
        keys = await self._config.storage.list()
        stats = await self.get_stats()

        return {
            "keys": len(keys),
            "active": len([k for k in keys if k.status == KeyStatus.ACTIVE]),
            "rotating": len([k for k in keys if k.status == KeyStatus.ROTATING]),
            "expired": len([k for k in keys if k.status == KeyStatus.EXPIRED]),
            "stats": stats,
        }

    # =========================================================================
    # 清理
    # =========================================================================

    def close(self) -> None:
        """关闭管理器"""
        self.stop_auto_rotation()
        self.remove_all_listeners()

    # =========================================================================
    # 辅助方法
    # =========================================================================

    def _generate_key_id(self) -> str:
        """生成密钥ID"""
        return f"key-{int(time.time() * 1000)}-{secrets.token_hex(8)}"

    def _get_key_length(self, algorithm: KeyAlgorithm) -> int:
        """获取密钥长度"""
        lengths = {
            KeyAlgorithm.AES_256_GCM: 32,
            KeyAlgorithm.AES_128_CBC: 16,
            KeyAlgorithm.CHACHA20_POLY1305: 32,
        }
        return lengths.get(algorithm, 32)

    def _clear_rotation_timer(self, key_id: str) -> None:
        """清理轮换计时器"""
        timer = self._rotation_timers.pop(key_id, None)
        if timer:
            timer.cancel()


# ============================================================================
# 工厂函数
# ============================================================================


def create_key_manager(config: Optional[KeyManagerConfig] = None) -> KeyManager:
    """创建密钥管理器"""
    return KeyManager(config)


# ============================================================================
# 格式化函数
# ============================================================================


def format_key(key: Key) -> str:
    """格式化密钥"""
    lines = [
        "=== 密钥 ===",
        f"ID: {key.id}",
        f"名称: {key.name}",
        f"用途: {key.purpose.value}",
        f"算法: {key.algorithm.value}",
        f"状态: {key.status.value}",
        f"创建时间: {key.created_at.isoformat()}",
    ]

    if key.expires_at:
        lines.append(f"过期时间: {key.expires_at.isoformat()}")

    if key.last_used_at:
        lines.append(f"最后使用: {key.last_used_at.isoformat()}")

    lines.append(f"轮换次数: {key.rotation_count}")

    return "\n".join(lines)


def format_rotation_policy(policy: RotationPolicy) -> str:
    """格式化轮换策略"""
    lines = [
        "=== 轮换策略 ===",
        f"轮换间隔: {policy.interval_ms / 1000 / 60} 分钟",
        f"提前轮换: {policy.advance_ms / 1000 / 60} 分钟",
        f"最小长度: {policy.min_length} 字节",
        f"最大长度: {policy.max_length} 字节",
    ]

    return "\n".join(lines)
