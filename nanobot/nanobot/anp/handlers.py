"""
ANP 消息处理器
路由 ANP 消息到对应的处理器

@module nanobot.anp.handlers
@version 1.0.0
"""

import logging
from typing import Callable, Dict, Optional, Any

from nanobot.anp.types import (
    ANPMessage,
    ANPMessageType,
    GenesisPromptPayload,
    ProgressReportPayload,
    ErrorReportPayload,
    StatusRequestPayload,
    StatusResponsePayload,
)
from nanobot.bus.events import InboundMessage
from nanobot.interagent.progress_reporter import ProgressTracker


logger = logging.getLogger(__name__)


# ============================================================================
# ANP 消息处理器
# ============================================================================

class ANPMessageHandler:
    """
    ANP 消息处理器

    负责路由接收到的 ANP 消息到对应的处理器。
    支持消息类型：
    - GenesisPrompt: Genesis Prompt 消息
    - TaskUpdate: 任务更新消息
    - StatusRequest: 状态请求消息
    - ProgressEvent: 进度事件消息
    - ErrorEvent: 错误事件消息
    """

    def __init__(
        self,
        event_bus: Optional[Any] = None,
        progress_tracker: Optional[ProgressTracker] = None,
    ):
        """
        初始化 ANP 消息处理器

        Args:
            event_bus: 事件总线（用于发布处理后的消息）
            progress_tracker: 进度追踪器（用于处理进度相关消息）
        """
        self.event_bus = event_bus
        self.progress_tracker = progress_tracker

        # 默认处理器映射
        self._handlers: Dict[str, Callable[[ANPMessage], Any]] = {
            ANPMessageType.TASK_CREATE.value: self.handle_task_create,
            ANPMessageType.TASK_UPDATE.value: self.handle_task_update,
            ANPMessageType.TASK_COMPLETE.value: self.handle_task_complete,
            ANPMessageType.TASK_FAIL.value: self.handle_task_fail,
            ANPMessageType.STATUS_REQUEST.value: self.handle_status_request,
            ANPMessageType.STATUS_RESPONSE.value: self.handle_status_response,
            ANPMessageType.PROGRESS_EVENT.value: self.handle_progress_event,
            ANPMessageType.ERROR_EVENT.value: self.handle_error_event,
            ANPMessageType.HEARTBEAT_EVENT.value: self.handle_heartbeat,
            ANPMessageType.CAPABILITY_QUERY.value: self.handle_capability_query,
            ANPMessageType.CAPABILITY_RESPONSE.value: self.handle_capability_response,
        }

        # 自定义处理器覆盖
        self._custom_handlers: Dict[str, Callable[[ANPMessage], Any]] = {}

    async def handle_message(self, message: ANPMessage) -> None:
        """
        路由消息到对应处理器

        Args:
            message: ANP 消息
        """
        try:
            # 获取消息类型
            message_type = message.type.value if isinstance(message.type, ANPMessageType) else message.type

            # 查找处理器
            handler = self._get_handler(message_type)

            if handler:
                logger.debug(f"Routing message type {message_type} to handler")
                await handler(message)
            else:
                await self.handle_unknown(message)

        except Exception as e:
            logger.error(f"Error handling message: {e}", exc_info=True)
            await self.handle_error(message, e)

    def _get_handler(self, message_type: str) -> Optional[Callable[[ANPMessage], Any]]:
        """
        获取消息处理器

        优先使用自定义处理器，回退到默认处理器

        Args:
            message_type: 消息类型字符串

        Returns:
            处理器函数或 None
        """
        # 先检查自定义处理器
        if message_type in self._custom_handlers:
            return self._custom_handlers[message_type]

        # 检查默认处理器
        return self._handlers.get(message_type)

    def register_handler(
        self,
        message_type: str,
        handler: Callable[[ANPMessage], Any]
    ) -> None:
        """
        注册自定义消息处理器

        Args:
            message_type: 消息类型
            handler: 处理器函数
        """
        self._custom_handlers[message_type] = handler
        logger.debug(f"Registered custom handler for message type: {message_type}")

    def unregister_handler(self, message_type: str) -> None:
        """
        注销自定义消息处理器

        Args:
            message_type: 消息类型
        """
        if message_type in self._custom_handlers:
            del self._custom_handlers[message_type]
            logger.debug(f"Unregistered handler for message type: {message_type}")

    # ========================================================================
    # 默认处理器实现
    # ========================================================================

    async def handle_task_create(self, message: ANPMessage) -> None:
        """
        处理任务创建消息

        Args:
            message: ANP 消息
        """
        logger.info(f"TaskCreate message received from {message.actor}")

        # 如果负载是 GenesisPrompt，使用专门的处理器
        if isinstance(message.object, GenesisPromptPayload):
            await self.handle_genesis_prompt(message)
        else:
            # 通用任务创建处理
            payload = message.object
            logger.debug(f"Task payload: {payload}")

            # TODO: 实现任务创建逻辑
            # 这里需要与 Nanobot 的任务系统集成

    async def handle_task_update(self, message: ANPMessage) -> None:
        """
        处理任务更新消息

        Args:
            message: ANP 消息
        """
        logger.info(f"TaskUpdate message received: {message.id}")
        payload = message.object
        logger.debug(f"Update payload: {payload}")

        # TODO: 实现任务更新逻辑

    async def handle_task_complete(self, message: ANPMessage) -> None:
        """
        处理任务完成消息

        Args:
            message: ANP 消息
        """
        logger.info(f"TaskComplete message received: {message.id}")

        # TODO: 实现任务完成逻辑

    async def handle_task_fail(self, message: ANPMessage) -> None:
        """
        处理任务失败消息

        Args:
            message: ANP 消息
        """
        logger.warning(f"TaskFail message received: {message.id}")
        payload = message.object
        logger.warning(f"Failure details: {payload}")

        # TODO: 实现任务失败处理逻辑

    async def handle_status_request(self, message: ANPMessage) -> None:
        """
        处理状态请求消息

        Args:
            message: ANP 消息
        """
        logger.debug(f"StatusRequest message received from {message.actor}")

        if isinstance(message.object, StatusRequestPayload):
            payload: StatusRequestPayload = message.object
            detail_level = payload.detail_level
            logger.debug(f"Status detail level: {detail_level}")

        # TODO: 生成并发送状态响应
        # 需要收集当前 Nanobot 的状态信息

    async def handle_status_response(self, message: ANPMessage) -> None:
        """
        处理状态响应消息

        Args:
            message: ANP 消息
        """
        logger.debug(f"StatusResponse message received from {message.actor}")

        if isinstance(message.object, StatusResponsePayload):
            payload: StatusResponsePayload = message.object
            logger.debug(
                f"Status: {payload.status}, "
                f"Current tasks: {payload.current_tasks}, "
                f"Queued: {payload.queued_tasks}"
            )

    async def handle_progress_event(self, message: ANPMessage) -> None:
        """
        处理进度事件消息

        Args:
            message: ANP 消息
        """
        if isinstance(message.object, ProgressReportPayload):
            payload: ProgressReportPayload = message.object
            logger.info(
                f"Progress event for task {payload.task_id}: "
                f"{payload.progress}% - {payload.current_phase}"
            )

            # 如果有进度追踪器，更新进度
            if self.progress_tracker:
                from nanobot.interagent.progress_reporter import ProgressUpdate
                update = ProgressUpdate(
                    percentage=payload.progress,
                    message=f"Phase: {payload.current_phase}",
                    current_step=payload.current_phase,
                    eta_ms=payload.eta_seconds * 1000 if payload.eta_seconds else None,
                )
                self.progress_tracker.update(update)

    async def handle_error_event(self, message: ANPMessage) -> None:
        """
        处理错误事件消息

        Args:
            message: ANP 消息
        """
        if isinstance(message.object, ErrorReportPayload):
            payload: ErrorReportPayload = message.object
            logger.error(
                f"Error event for task {payload.task_id}: "
                f"[{payload.severity}] {payload.error_code} - {payload.message}"
            )

            if payload.context:
                logger.debug(f"Error context: {payload.context}")

            if payload.suggested_action:
                logger.info(f"Suggested action: {payload.suggested_action}")

    async def handle_heartbeat(self, message: ANPMessage) -> None:
        """
        处理心跳消息

        Args:
            message: ANP 消息
        """
        logger.debug(f"Heartbeat received from {message.actor}")

    async def handle_capability_query(self, message: ANPMessage) -> None:
        """
        处理能力查询消息

        Args:
            message: ANP 消息
        """
        logger.debug(f"CapabilityQuery received from {message.actor}")

    async def handle_capability_response(self, message: ANPMessage) -> None:
        """
        处理能力响应消息

        Args:
            message: ANP 消息
        """
        logger.debug(f"CapabilityResponse received from {message.actor}")

    async def handle_genesis_prompt(self, message: ANPMessage) -> None:
        """
        处理 Genesis Prompt 消息

        这是特殊的任务创建消息，包含完整的任务描述

        Args:
            message: ANP 消息
        """
        if isinstance(message.object, GenesisPromptPayload):
            payload: GenesisPromptPayload = message.object
            logger.info(
                f"GenesisPrompt received: "
                f"Project {payload.project_id} on {payload.platform}"
            )
            logger.info(f"Requirement: {payload.requirement_summary}")

            # TODO: 将 Genesis Prompt 转换为 Nanobot 可处理的任务
            # 这需要解析技术约束、合同条款、资源限制等

    async def handle_unknown(self, message: ANPMessage) -> None:
        """
        处理未知类型的消息

        Args:
            message: ANP 消息
        """
        logger.warning(
            f"Unknown message type received: {message.type.value} "
            f"from {message.actor}"
        )

    async def handle_error(self, message: ANPMessage, error: Exception) -> None:
        """
        处理消息处理错误

        Args:
            message: ANP 消息
            error: 异常
        """
        logger.error(
            f"Error processing message {message.id}: {error}",
            exc_info=True
        )

        # TODO: 可选地发送错误响应回发送方


# ============================================================================
# 辅助函数
# ============================================================================

def create_anp_message_handler(
    event_bus: Optional[Any] = None,
    progress_tracker: Optional[ProgressTracker] = None,
) -> ANPMessageHandler:
    """
    创建 ANP 消息处理器

    Args:
        event_bus: 事件总线
        progress_tracker: 进度追踪器

    Returns:
        ANP 消息处理器实例
    """
    return ANPMessageHandler(event_bus, progress_tracker)
