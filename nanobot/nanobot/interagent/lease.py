"""
租约管理模块
管理任务租约的获取、释放和续期

@module nanobot.interagent.lease
@version 1.0.0
"""

import asyncio
import time
from typing import Optional, List, Callable
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime
import aiohttp


# ============================================================================
# 类型定义
# ============================================================================

class LeaseStatus(str, Enum):
    """租约状态"""
    ACTIVE = "active"      # 活跃中
    EXPIRED = "expired"    # 已过期
    RELEASED = "released"  # 已释放
    REVOKED = "revoked"    # 已撤销


@dataclass
class Lease:
    """租约"""
    id: str
    task_id: str
    holder_did: str
    acquired_at: datetime
    expires_at: datetime
    status: LeaseStatus
    renew_count: int = 0
    max_renews: int = 5
    duration_seconds: int = 60
    last_heartbeat: Optional[datetime] = None
    release_reason: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict) -> "Lease":
        """从字典创建租约"""
        return cls(
            id=data["id"],
            task_id=data["taskId"],
            holder_did=data["holderDid"],
            acquired_at=datetime.fromisoformat(data["acquiredAt"].replace("Z", "+00:00"))
                if isinstance(data.get("acquiredAt"), str) else data["acquiredAt"],
            expires_at=datetime.fromisoformat(data["expiresAt"].replace("Z", "+00:00"))
                if isinstance(data.get("expiresAt"), str) else data["expiresAt"],
            status=LeaseStatus(data["status"]),
            renew_count=data.get("renewCount", 0),
            max_renews=data.get("maxRenews", 5),
            duration_seconds=data.get("durationSeconds", 60),
            last_heartbeat=datetime.fromisoformat(data["lastHeartbeat"].replace("Z", "+00:00"))
                if data.get("lastHeartbeat") else None,
            release_reason=data.get("releaseReason"),
        )

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "taskId": self.task_id,
            "holderDid": self.holder_did,
            "acquiredAt": self.acquired_at.isoformat() if self.acquired_at else None,
            "expiresAt": self.expires_at.isoformat() if self.expires_at else None,
            "status": self.status.value,
            "renewCount": self.renew_count,
            "maxRenews": self.max_renews,
            "durationSeconds": self.duration_seconds,
            "lastHeartbeat": self.last_heartbeat.isoformat() if self.last_heartbeat else None,
            "releaseReason": self.release_reason,
        }

    def is_expired(self) -> bool:
        """检查是否过期"""
        if self.status != LeaseStatus.ACTIVE:
            return False
        return datetime.now() > self.expires_at

    def is_valid(self) -> bool:
        """检查是否有效"""
        return self.status == LeaseStatus.ACTIVE and not self.is_expired()

    def get_remaining_seconds(self) -> int:
        """获取剩余秒数"""
        if self.status != LeaseStatus.ACTIVE:
            return 0
        remaining = (self.expires_at - datetime.now()).total_seconds()
        return max(0, int(remaining))


@dataclass
class LeaseConfig:
    """租约客户端配置"""
    automaton_url: str
    default_duration: int = 60  # 默认持续时间 (秒)
    max_renews: int = 5         # 最大续期次数
    heartbeat_interval: int = 15  # 心跳间隔 (秒)
    renew_threshold: int = 30   # 续期阈值 (秒)
    timeout: float = 10.0       # HTTP 超时 (秒)


# ============================================================================
# 租约客户端
# ============================================================================

class LeaseClient:
    """
    租约客户端
    用于与 Automaton 租约管理器交互
    """

    def __init__(
        self,
        config: LeaseConfig,
        on_expired: Optional[Callable[[Lease], None]] = None,
    ):
        """
        初始化租约客户端

        Args:
            config: 配置
            on_expired: 租约过期回调
        """
        self.config = config
        self.on_expired = on_expired

        self._session: Optional[aiohttp.ClientSession] = None
        self._active_leases: dict[str, Lease] = {}
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self) -> None:
        """启动客户端"""
        self._running = True
        self._session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=self.config.timeout)
        )
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def stop(self) -> None:
        """停止客户端"""
        self._running = False

        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
            self._heartbeat_task = None

        # 释放所有活跃租约
        for lease_id in list(self._active_leases.keys()):
            await self.release(lease_id, "Client shutdown")

        if self._session:
            await self._session.close()
            self._session = None

    # =========================================================================
    # 租约操作
    # =========================================================================

    async def acquire(
        self,
        task_id: str,
        holder_did: str,
        duration_seconds: Optional[int] = None,
    ) -> Optional[Lease]:
        """
        获取租约

        Args:
            task_id: 任务 ID
            holder_did: 持有者 DID
            duration_seconds: 持续时间

        Returns:
            租约或 None
        """
        if not self._session:
            return None

        url = f"{self.config.automaton_url}/api/leases/acquire"
        duration = duration_seconds or self.config.default_duration

        try:
            async with self._session.post(url, json={
                "taskId": task_id,
                "holderDid": holder_did,
                "durationSeconds": duration,
                "maxRenews": self.config.max_renews,
            }) as response:
                if response.status == 200:
                    data = await response.json()
                    lease = Lease.from_dict(data)
                    self._active_leases[lease.id] = lease
                    return lease
                return None
        except Exception:
            return None

    async def release(self, lease_id: str, reason: Optional[str] = None) -> bool:
        """
        释放租约

        Args:
            lease_id: 租约 ID
            reason: 释放原因

        Returns:
            是否成功
        """
        if not self._session:
            return False

        url = f"{self.config.automaton_url}/api/leases/{lease_id}/release"

        try:
            async with self._session.post(url, json={"reason": reason}) as response:
                if response.status == 200:
                    self._active_leases.pop(lease_id, None)
                    return True
                return False
        except Exception:
            return False

    async def renew(
        self,
        lease_id: str,
        additional_seconds: Optional[int] = None,
    ) -> Optional[Lease]:
        """
        续期租约

        Args:
            lease_id: 租约 ID
            additional_seconds: 额外持续时间

        Returns:
            更新后的租约或 None
        """
        if not self._session:
            return None

        url = f"{self.config.automaton_url}/api/leases/{lease_id}/renew"
        additional = additional_seconds or self.config.default_duration

        try:
            async with self._session.post(url, json={
                "additionalSeconds": additional,
            }) as response:
                if response.status == 200:
                    data = await response.json()
                    lease = Lease.from_dict(data)
                    self._active_leases[lease.id] = lease
                    return lease
                return None
        except Exception:
            return None

    async def heartbeat(self, lease_id: str) -> bool:
        """
        发送心跳

        Args:
            lease_id: 租约 ID

        Returns:
            是否成功
        """
        if not self._session:
            return False

        url = f"{self.config.automaton_url}/api/leases/{lease_id}/heartbeat"

        try:
            async with self._session.post(url) as response:
                return response.status == 200
        except Exception:
            return False

    async def get(self, lease_id: str) -> Optional[Lease]:
        """
        获取租约信息

        Args:
            lease_id: 租约 ID

        Returns:
            租约或 None
        """
        if not self._session:
            return None

        url = f"{self.config.automaton_url}/api/leases/{lease_id}"

        try:
            async with self._session.get(url) as response:
                if response.status == 200:
                    data = await response.json()
                    return Lease.from_dict(data)
                return None
        except Exception:
            return None

    # =========================================================================
    # 本地操作
    # =========================================================================

    def get_active_leases(self) -> List[Lease]:
        """获取所有活跃租约"""
        return [
            lease for lease in self._active_leases.values()
            if lease.is_valid()
        ]

    def get_lease_for_task(self, task_id: str) -> Optional[Lease]:
        """获取指定任务的租约"""
        for lease in self._active_leases.values():
            if lease.task_id == task_id and lease.is_valid():
                return lease
        return None

    # =========================================================================
    # 内部方法
    # =========================================================================

    async def _heartbeat_loop(self) -> None:
        """心跳循环"""
        while self._running:
            try:
                for lease_id, lease in list(self._active_leases.items()):
                    if not lease.is_valid():
                        # 租约已过期
                        self._active_leases.pop(lease_id, None)
                        if self.on_expired:
                            self.on_expired(lease)
                        continue

                    # 检查是否需要续期
                    remaining = lease.get_remaining_seconds()
                    if remaining <= self.config.renew_threshold:
                        if lease.renew_count < lease.max_renews:
                            await self.renew(lease_id)
                        continue

                    # 发送心跳
                    await self.heartbeat(lease_id)

                await asyncio.sleep(self.config.heartbeat_interval)

            except asyncio.CancelledError:
                break
            except Exception:
                await asyncio.sleep(1)


# ============================================================================
# 工具函数
# ============================================================================

def format_remaining_time(seconds: int) -> str:
    """
    格式化剩余时间

    Args:
        seconds: 秒数

    Returns:
        格式化字符串
    """
    if seconds <= 0:
        return "0s"

    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60

    parts = []
    if hours > 0:
        parts.append(f"{hours}h")
    if minutes > 0:
        parts.append(f"{minutes}m")
    if secs > 0 or not parts:
        parts.append(f"{secs}s")

    return "".join(parts)


def is_expiring_soon(lease: Lease, threshold_seconds: int = 30) -> bool:
    """
    检查租约是否即将过期

    Args:
        lease: 租约
        threshold_seconds: 阈值 (秒)

    Returns:
        是否即将过期
    """
    if lease.status != LeaseStatus.ACTIVE:
        return False

    remaining = lease.get_remaining_seconds()
    return 0 < remaining <= threshold_seconds


# ============================================================================
# 上下文管理器
# ============================================================================

class LeaseContext:
    """
    租约上下文管理器
    自动管理租约的获取和释放
    """

    def __init__(
        self,
        client: LeaseClient,
        task_id: str,
        holder_did: str,
        duration_seconds: Optional[int] = None,
    ):
        self.client = client
        self.task_id = task_id
        self.holder_did = holder_did
        self.duration_seconds = duration_seconds
        self.lease: Optional[Lease] = None

    async def __aenter__(self) -> Optional[Lease]:
        self.lease = await self.client.acquire(
            self.task_id,
            self.holder_did,
            self.duration_seconds,
        )
        return self.lease

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        if self.lease:
            reason = f"Exception: {exc_val}" if exc_type else "Completed"
            await self.client.release(self.lease.id, reason)
