"""
Genesis Prompt ANP 接收器
接收并处理来自 Automaton 的 Genesis Prompt ANP 消息

@module interagent.genesis.genesis_prompt_receiver
@version 1.0.0
"""

import logging
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

import httpx
from pydantic import BaseModel, Field, field_validator

from nanobot.anp.types import (
    ANPMessage,
    ANPSignature,
    AUTOMATON_DID,
    DEFAULT_CONTEXT,
    GENESIS_PROMPT_PROTOCOL,
)
from nanobot.anp.signature import verify_signature
from nanobot.interagent.genesis_prompt import (
    GenesisPrompt,
    GenesisPromptParser,
    TaskReceiver,
    GenesisTaskType,
    GenesisPriority,
    GenesisInput,
    TechnicalConstraints,
    BusinessTerms,
)

logger = logging.getLogger(__name__)


# ============================================================================
# 类型定义
# ============================================================================

class ANPGenesisPromptPayload(BaseModel):
    """ANP Genesis Prompt 负载"""
    type: str = Field(default="genesis:GenesisPrompt", alias="@type")
    project_id: str = Field(alias="genesis:projectId")
    platform: str = Field(alias="genesis:platform")
    requirement_summary: str = Field(alias="genesis:requirementSummary")
    technical_constraints: Dict[str, Any] = Field(
        default_factory=dict, alias="genesis:technicalConstraints"
    )
    contract_terms: Dict[str, Any] = Field(
        default_factory=dict, alias="genesis:contractTerms"
    )
    resource_limits: Dict[str, Any] = Field(
        default_factory=dict, alias="genesis:resourceLimits"
    )
    special_instructions: Optional[Dict[str, Any]] = Field(
        default=None, alias="genesis:specialInstructions"
    )

    class Config:
        populate_by_name = True


class GenesisPromptReceiverConfig(BaseModel):
    """接收器配置"""
    nanobot_did: str
    private_key_pem: str
    service_endpoint: str
    automaton_did: str = AUTOMATON_DID
    timeout_seconds: int = 30
    verify_signature: bool = True


class ReceiveResult(BaseModel):
    """接收结果"""
    success: bool
    prompt_id: str
    message: str
    response_data: Optional[Dict[str, Any]] = None
    execution_plan: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


# ============================================================================
# GenesisPromptReceiver
# ============================================================================

class GenesisPromptReceiver:
    """
    Genesis Prompt ANP 接收器

    功能:
    - 接收来自 Automaton 的 ANP 消息
    - 验证消息签名
    - 转换为内部 Genesis Prompt 格式
    - 生成执行计划
    - 返回接受/拒绝响应
    """

    def __init__(self, config: GenesisPromptReceiverConfig):
        """
        初始化接收器

        Args:
            config: 接收器配置
        """
        self.config = config
        self.parser = GenesisPromptParser()
        self.task_receiver = TaskReceiver(config.nanobot_did)
        self.client = httpx.AsyncClient(timeout=config.timeout_seconds)

    async def shutdown(self):
        """关闭接收器"""
        await self.client.aclose()

    # ========================================================================
    # ANP 消息接收与验证
    # ========================================================================

    async def receive_anp_message(self, message_data: Dict[str, Any]) -> ReceiveResult:
        """
        接收并处理 ANP 消息

        Args:
            message_data: ANP 消息数据

        Returns:
            接收结果
        """
        try:
            # 1. 验证消息格式
            message = self._parse_anp_message(message_data)

            # 2. 验证签名
            if self.config.verify_signature:
                if not await self._verify_message_signature(message):
                    return ReceiveResult(
                        success=False,
                        prompt_id="",
                        message="签名验证失败",
                        error="Invalid signature"
                    )

            # 3. 验证来源 DID
            if message.actor != self.config.automaton_did:
                return ReceiveResult(
                    success=False,
                    prompt_id="",
                    message=f"无效的来源 DID: {message.actor}",
                    error="Invalid actor DID"
                )

            # 4. 验证目标 DID
            if message.target != self.config.nanobot_did:
                return ReceiveResult(
                    success=False,
                    prompt_id="",
                    message=f"目标 DID 不匹配: 期望 {self.config.nanobot_did}, 收到 {message.target}",
                    error="Target DID mismatch"
                )

            # 5. 解析 Genesis Prompt
            genesis_prompt = self._convert_to_genesis_prompt(message)

            # 6. 生成执行计划
            plan = self.task_receiver.plan_generator.generate(genesis_prompt)

            # 7. 构建响应
            response_data = self._build_acceptance_response(
                message.id,
                genesis_prompt.id,
                plan
            )

            return ReceiveResult(
                success=True,
                prompt_id=genesis_prompt.id,
                message="任务已接受",
                response_data=response_data,
                execution_plan=plan.to_dict()
            )

        except Exception as e:
            logger.exception(f"接收 ANP 消息时出错: {e}")
            return ReceiveResult(
                success=False,
                prompt_id="",
                message=f"处理消息失败: {str(e)}",
                error=str(e)
            )

    def _parse_anp_message(self, message_data: Dict[str, Any]) -> ANPMessage:
        """解析 ANP 消息"""
        return ANPMessage(**message_data)

    async def _verify_message_signature(self, message: ANPMessage) -> bool:
        """
        验证消息签名

        Args:
            message: ANP 消息

        Returns:
            签名是否有效
        """
        try:
            # 这里需要从 DID 文档中获取公钥
            # 简化实现: 假设我们已经缓存了公钥
            is_valid = await verify_signature(
                message.object,
                message.signature,
                self.config.private_key_pem  # 实际应该是对方的公钥
            )
            return is_valid
        except Exception as e:
            logger.error(f"签名验证出错: {e}")
            return False

    # ========================================================================
    # ANP 到 Genesis Prompt 转换
    # ========================================================================

    def _convert_to_genesis_prompt(self, message: ANPMessage) -> GenesisPrompt:
        """
        将 ANP 消息转换为内部 Genesis Prompt 格式

        Args:
            message: ANP 消息

        Returns:
            Genesis Prompt
        """
        # 将 Pydantic 模型转换为字典
        object_dict = message.object.model_dump() if hasattr(message.object, 'model_dump') else message.object
        payload = ANPGenesisPromptPayload(**object_dict)

        # 映射优先级
        priority = self._map_priority_from_anp(
            payload.special_instructions.get("priorityLevel", "normal")
            if payload.special_instructions else "normal"
        )

        # 映射任务类型
        task_type = self._map_task_type_from_anp(payload.platform)

        # 构建技术约束
        technical = self._convert_technical_constraints(
            payload.technical_constraints
        )

        # 构建商务条款
        business = self._convert_business_terms(payload.contract_terms)

        # 构建输入
        input_data = GenesisInput(
            description=payload.requirement_summary,
            specification=f"Project ID: {payload.project_id}",
        )

        # 构建 Genesis Prompt
        prompt = GenesisPrompt(
            version="1.0.0",
            id=payload.project_id,
            task_type=task_type,
            priority=priority,
            source_did=message.actor,
            target_did=message.target,
            created_at=message.timestamp if isinstance(message.timestamp, datetime) else datetime.fromisoformat(message.timestamp),
            input=input_data,
            technical=technical,
            business=business,
            timeout_ms=payload.resource_limits.get("maxDurationMs", 86400000),
            require_confirmation=payload.special_instructions.get(
                "humanReviewRequired", False
            ) if payload.special_instructions else False,
            tags=payload.special_instructions.get("riskFlags", [])
            if payload.special_instructions else [],
        )

        return prompt

    def _map_priority_from_anp(self, level: str) -> GenesisPriority:
        """映射 ANP 优先级到内部优先级"""
        mapping = {
            "high": GenesisPriority.HIGH,
            "normal": GenesisPriority.NORMAL,
            "low": GenesisPriority.LOW,
        }
        return mapping.get(level, GenesisPriority.NORMAL)

    def _map_task_type_from_anp(self, platform: str) -> GenesisTaskType:
        """映射平台到任务类型"""
        # 简化实现: 根据平台返回任务类型
        return GenesisTaskType.GENESIS

    def _convert_technical_constraints(
        self, constraints: Dict[str, Any]
    ) -> Optional[TechnicalConstraints]:
        """转换技术约束"""
        if not constraints:
            return None

        return TechnicalConstraints.from_dict({
            "allowedLanguages": constraints.get("requiredStack", []),
            "forbiddenLibraries": constraints.get("prohibitedStack", []),
            "performance": {
                "maxExecutionTimeMs": constraints.get("maxDurationMs"),
            },
        })

    def _convert_business_terms(self, terms: Dict[str, Any]) -> Optional[BusinessTerms]:
        """转换商务条款"""
        if not terms:
            return None

        budget = terms.get("totalBudget", {})
        deadline = terms.get("deadline")

        return BusinessTerms.from_dict({
            "budget": {
                "total": budget.get("value", 0),
                "currency": budget.get("currency", "USD"),
            },
            "timeline": {
                "deadline": deadline,
            } if deadline else None,
            "quality": {
                "level": "premium" if terms.get("milestones") else "standard",
            },
        })

    # ========================================================================
    # 响应构建
    # ========================================================================

    def _build_acceptance_response(
        self,
        message_id: str,
        prompt_id: str,
        plan
    ) -> Dict[str, Any]:
        """
        构建接受响应

        Args:
            message_id: 原始消息 ID
            prompt_id: Prompt ID
            plan: 执行计划

        Returns:
            响应数据
        """
        response_id = f"resp-{uuid.uuid4()}"

        return {
            "id": response_id,
            "promptId": prompt_id,
            "status": "accepted",
            "respondedAt": datetime.utcnow().isoformat(),
            "acceptance": {
                "estimatedStartTime": datetime.utcnow().isoformat(),
                "estimatedCompletionTime": datetime.fromtimestamp(
                    datetime.utcnow().timestamp() + plan.estimated_total_duration_ms / 1000
                ).isoformat(),
                "allocatedResources": ["cpu", "memory"],
            },
            "correlationId": message_id,
        }

    def _build_rejection_response(
        self,
        message_id: str,
        reason: str,
        code: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        构建拒绝响应

        Args:
            message_id: 原始消息 ID
            reason: 拒绝原因
            code: 错误代码

        Returns:
            响应数据
        """
        response_id = f"resp-{uuid.uuid4()}"

        response = {
            "id": response_id,
            "promptId": "",
            "status": "rejected",
            "respondedAt": datetime.utcnow().isoformat(),
            "rejection": {
                "reason": reason,
            },
            "correlationId": message_id,
        }

        if code:
            response["rejection"]["code"] = code

        return response

    # ========================================================================
    # HTTP 端点处理器
    # ========================================================================

    async def handle_http_request(
        self,
        message_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        处理 HTTP 请求

        Args:
            message_data: 请求体数据

        Returns:
            HTTP 响应
        """
        result = await self.receive_anp_message(message_data)

        if result.success:
            return result.response_data or {}
        else:
            return self._build_rejection_response(
                message_data.get("id", ""),
                result.error or result.message,
                "PROCESSING_ERROR"
            )

    # ========================================================================
    # 统计信息
    # ========================================================================

    def get_stats(self) -> Dict[str, Any]:
        """获取接收统计信息"""
        return {
            "received_count": 0,
            "accepted_count": 0,
            "rejected_count": 0,
            "error_count": 0,
        }


# ============================================================================
# 工厂函数
# ============================================================================

def create_genesis_prompt_receiver(
    nanobot_did: str,
    private_key_pem: str,
    service_endpoint: str,
    automaton_did: str = AUTOMATON_DID,
) -> GenesisPromptReceiver:
    """
    创建 Genesis Prompt 接收器

    Args:
        nanobot_did: Nanobot DID
        private_key_pem: 私钥 (PEM 格式)
        service_endpoint: 服务端点
        automaton_did: Automaton DID

    Returns:
        Genesis Prompt 接收器实例
    """
    config = GenesisPromptReceiverConfig(
        nanobot_did=nanobot_did,
        private_key_pem=private_key_pem,
        service_endpoint=service_endpoint,
        automaton_did=automaton_did,
    )

    return GenesisPromptReceiver(config)
