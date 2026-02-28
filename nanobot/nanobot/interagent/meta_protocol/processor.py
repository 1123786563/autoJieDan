"""
元协议处理器
处理元协议层的消息路由和协议集成

@module nanobot.interagent.meta_protocol.processor
@version 1.0.0
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

from nanobot.anp.types import (
    ANPMessage,
    ANPMessageType,
    Capability,
    NegotiatedProtocol,
)
from nanobot.interagent.protocol_negotiation import NegotiationStrategy
from nanobot.interagent.meta_protocol.negotiator import (
    MetaProtocolNegotiator,
    NegotiationConfig,
    NegotiationResult,
    NegotiationOutcome,
)


logger = logging.getLogger(__name__)


# ============================================================================
# 类型定义
# ============================================================================


class ProcessingState(str, Enum):
    """处理状态"""
    IDLE = "idle"
    PROCESSING = "processing"
    NEGOTIATING = "negotiating"
    ERROR = "error"


@dataclass
class ProcessingConfig:
    """处理配置"""
    enable_auto_negotiation: bool = True  # 启用自动协商
    enable_capability_cache: bool = True  # 启用能力缓存
    max_pending_negotiations: int = 10  # 最大待处理协商数
    negotiation_timeout_seconds: int = 300  # 协商超时


@dataclass
class ProcessingStats:
    """处理统计"""
    total_messages_processed: int = 0
    total_negotiations_initiated: int = 0
    total_negotiations_completed: int = 0
    total_negotiations_failed: int = 0
    total_capabilities_cached: int = 0
    last_message_time: Optional[datetime] = None
    last_error: Optional[str] = None


# ============================================================================
# 元协议处理器
# ============================================================================


class MetaProtocolProcessor:
    """
    元协议处理器

    负责消息路由、协议集成和能力协商协调
    """

    def __init__(
        self,
        local_did: str,
        supported_protocols: List[str],
        local_capabilities: List[Capability],
        config: Optional[ProcessingConfig] = None,
        message_sender: Optional[Callable[[ANPMessage], None]] = None,
    ):
        """
        初始化元协议处理器

        Args:
            local_did: 本地 DID
            supported_protocols: 支持的协议列表
            local_capabilities: 本地能力列表
            config: 处理配置
            message_sender: 消息发送回调
        """
        self.local_did = local_did
        self.config = config or ProcessingConfig()

        # 创建元协议协商器
        negotiation_config = NegotiationConfig(
            max_rounds=5,
            timeout_seconds=self.config.negotiation_timeout_seconds,
            strategy=NegotiationStrategy.ADAPTIVE,
            enable_natural_language=True,
        )

        self.negotiator = MetaProtocolNegotiator(
            local_did=local_did,
            supported_protocols=supported_protocols,
            local_capabilities=local_capabilities,
            config=negotiation_config,
            message_sender=message_sender,
        )

        # 处理状态
        self._state = ProcessingState.IDLE
        self._stats = ProcessingStats()

        # 消息处理器注册
        self._message_handlers: Dict[ANPMessageType, List[Callable]] = {}

        # 协议处理器注册
        self._protocol_handlers: Dict[str, Callable] = {}

        # 协商完成回调
        self.negotiator.on_negotiation_complete(self._on_negotiation_complete)

    # ========================================================================
    # 生命周期
    # ========================================================================

    async def start(self) -> None:
        """启动处理器"""
        await self.negotiator.start()
        self._state = ProcessingState.IDLE
        logger.info(f"MetaProtocolProcessor started for {self.local_did}")

    async def stop(self) -> None:
        """停止处理器"""
        await self.negotiator.stop()
        self._state = ProcessingState.IDLE
        logger.info("MetaProtocolProcessor stopped")

    # ========================================================================
    # 消息处理
    # ========================================================================

    async def process_message(self, message: ANPMessage) -> Optional[Any]:
        """
        处理 ANP 消息

        Args:
            message: ANP 消息

        Returns:
            处理结果
        """
        self._stats.total_messages_processed += 1
        self._stats.last_message_time = datetime.now()

        try:
            self._state = ProcessingState.PROCESSING

            # 路由到协商器处理
            result = await self.negotiator.handle_message(message)

            if result:
                # 协商完成
                logger.info(f"Negotiation completed: {result.session_id} - {result.outcome}")
                return result

            # 如果不是协商消息，路由到协议处理器
            if message.type.value in self._protocol_handlers:
                protocol = message.type.value
                handler = self._protocol_handlers[protocol]
                return await handler(message)

            # 调用注册的消息处理器
            handlers = self._message_handlers.get(message.type, [])
            for handler in handlers:
                if asyncio.iscoroutinefunction(handler):
                    await handler(message)
                else:
                    handler(message)

            return None

        except Exception as e:
            self._stats.last_error = str(e)
            logger.error(f"Error processing message: {e}", exc_info=True)
            self._state = ProcessingState.ERROR
            return None

        finally:
            if self._state != ProcessingState.ERROR:
                self._state = ProcessingState.IDLE

    # ========================================================================
    # 协商接口
    # ========================================================================

    async def negotiate_protocol(
        self,
        peer_did: str,
        protocol: str,
        capabilities: Optional[List[str]] = None,
    ) -> str:
        """
        发起协议协商

        Args:
            peer_did: 对等点 DID
            protocol: 协议
            capabilities: 需要的能力列表

        Returns:
            会话 ID
        """
        self._stats.total_negotiations_initiated += 1

        session_id = await self.negotiator.initiate_negotiation(
            peer_did=peer_did,
            protocol=protocol,
            capabilities=capabilities or [],
        )

        return session_id

    async def wait_for_negotiation(
        self,
        session_id: str,
        timeout_seconds: Optional[int] = None,
    ) -> Optional[NegotiationResult]:
        """
        等待协商完成

        Args:
            session_id: 会话 ID
            timeout_seconds: 超时时间

        Returns:
            协商结果
        """
        timeout = timeout_seconds or self.config.negotiation_timeout_seconds
        start_time = datetime.now()

        while (datetime.now() - start_time).total_seconds() < timeout:
            session = await self.negotiator.get_session(session_id)
            if session and session.completed_at:
                return session
            await asyncio.sleep(0.1)

        return None

    # ========================================================================
    # 协议处理
    # ========================================================================

    def register_protocol_handler(
        self,
        protocol: str,
        handler: Callable[[ANPMessage], Any],
    ) -> None:
        """
        注册协议处理器

        Args:
            protocol: 协议名称
            handler: 处理器函数
        """
        self._protocol_handlers[protocol] = handler
        logger.info(f"Registered handler for protocol: {protocol}")

    def unregister_protocol_handler(self, protocol: str) -> bool:
        """
        注销协议处理器

        Args:
            protocol: 协议名称

        Returns:
            是否成功
        """
        if protocol in self._protocol_handlers:
            del self._protocol_handlers[protocol]
            logger.info(f"Unregistered handler for protocol: {protocol}")
            return True
        return False

    # ========================================================================
    # 消息处理
    # ========================================================================

    def on_message(
        self,
        message_type: ANPMessageType,
        handler: Callable[[ANPMessage], Any],
    ) -> None:
        """
        注册消息处理器

        Args:
            message_type: 消息类型
            handler: 处理器函数
        """
        if message_type not in self._message_handlers:
            self._message_handlers[message_type] = []
        self._message_handlers[message_type].append(handler)

    def off_message(
        self,
        message_type: ANPMessageType,
        handler: Callable[[ANPMessage], Any],
    ) -> bool:
        """
        注销消息处理器

        Args:
            message_type: 消息类型
            handler: 处理器函数

        Returns:
            是否成功
        """
        if message_type in self._message_handlers:
            try:
                self._message_handlers[message_type].remove(handler)
                return True
            except ValueError:
                pass
        return False

    # ========================================================================
    # 能力查询
    # ========================================================================

    def get_local_capabilities(self) -> List[Capability]:
        """获取本地能力"""
        return self.negotiator.capability_discovery.get_local_capabilities()

    def get_cached_capabilities(self, peer_did: str) -> Optional[List[Capability]]:
        """获取缓存的远程能力"""
        return self.negotiator.capability_discovery.get_remote_capabilities(peer_did)

    async def query_capabilities(
        self,
        peer_did: str,
    ) -> Optional[List[Capability]]:
        """
        查询远程能力

        Args:
            peer_did: 对等点 DID

        Returns:
            能力列表
        """
        # 这里应该发送能力查询消息
        # 简化实现，返回缓存的能力
        return self.get_cached_capabilities(peer_did)

    # ========================================================================
    # 统计查询
    # ========================================================================

    def get_stats(self) -> ProcessingStats:
        """获取处理统计"""
        return self._stats

    def get_state(self) -> ProcessingState:
        """获取处理状态"""
        return self._state

    # ========================================================================
    # 回调处理
    # ========================================================================

    async def _on_negotiation_complete(self, result: NegotiationResult) -> None:
        """协商完成回调"""
        if result.outcome == NegotiationOutcome.ACCEPTED:
            self._stats.total_negotiations_completed += 1
            logger.info(f"Negotiation {result.session_id} completed successfully")
        else:
            self._stats.total_negotiations_failed += 1
            logger.info(f"Negotiation {result.session_id} failed: {result.rejection_reason}")
