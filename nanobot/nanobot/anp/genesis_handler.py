"""
Genesis Prompt 处理器
处理来自 Automaton 的 Genesis Prompt 消息并启动 Nanobot 任务

@module nanobot.anp.genesis_handler
@version 1.0.0
"""

import logging
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from nanobot.anp.types import (
    ANPMessage,
    ANPMessageType,
    GenesisPromptPayload,
    TechnicalConstraints,
    ContractTerms,
    ResourceLimits,
    SpecialInstructions,
)
from nanobot.anp.signature import create_anp_message, CreateMessageOptions
from nanobot.skills.freelance.requirement import RequirementAnalyzer, RequirementAnalysis


logger = logging.getLogger(__name__)


# ============================================================================
# 数据模型
# ============================================================================

class TaskContext:
    """任务上下文"""

    def __init__(
        self,
        task_id: str,
        project_id: str,
        platform: str,
        requirement_summary: str,
        technical_constraints: TechnicalConstraints,
        contract_terms: ContractTerms,
        resource_limits: ResourceLimits,
        special_instructions: Optional[SpecialInstructions] = None,
    ):
        self.task_id = task_id
        self.project_id = project_id
        self.platform = platform
        self.requirement_summary = requirement_summary
        self.technical_constraints = technical_constraints
        self.contract_terms = contract_terms
        self.resource_limits = resource_limits
        self.special_instructions = special_instructions
        self.created_at = datetime.now()
        self.status = "pending"

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "task_id": self.task_id,
            "project_id": self.project_id,
            "platform": self.platform,
            "requirement_summary": self.requirement_summary,
            "technical_constraints": self.technical_constraints.model_dump(),
            "contract_terms": self.contract_terms.model_dump(),
            "resource_limits": self.resource_limits.model_dump(),
            "special_instructions": self.special_instructions.model_dump() if self.special_instructions else None,
            "created_at": self.created_at.isoformat(),
            "status": self.status,
        }


# ============================================================================
# Genesis Prompt 处理器
# ============================================================================

class GenesisPromptHandler:
    """
    Genesis Prompt 处理器

    接收来自 Automaton 的 Genesis Prompt 消息，
    验证并创建任务上下文，然后启动 Nanobot 任务处理
    """

    def __init__(
        self,
        agent_loop: Optional["AgentLoop"] = None,
        requirement_analyzer: Optional[RequirementAnalyzer] = None,
        private_key: Optional[Any] = None,
    ):
        """
        初始化 Genesis Prompt 处理器

        Args:
            agent_loop: AgentLoop 实例（可选）
            requirement_analyzer: 需求分析器（可选）
            private_key: 用于签名响应的私钥（可选）
        """
        self.agent_loop = agent_loop
        self.requirement_analyzer = requirement_analyzer
        self.private_key = private_key
        self.active_tasks: Dict[str, TaskContext] = {}

    async def handle(self, message: ANPMessage) -> None:
        """
        处理 Genesis Prompt 消息

        Args:
            message: ANP 消息
        """
        try:
            # 解析负载
            payload = message.object
            if not isinstance(payload, GenesisPromptPayload):
                logger.error(f"Invalid payload type: {type(payload)}")
                await self._send_error_response(
                    message.id,
                    "Invalid payload type",
                    "Expected GenesisPromptPayload"
                )
                return

            logger.info(
                f"Processing Genesis Prompt for project {payload.project_id} "
                f"on {payload.platform}"
            )

            # 验证消息
            validation_error = self._validate_payload(payload)
            if validation_error:
                await self._send_rejection(message.id, validation_error)
                return

            # 创建任务上下文
            task_context = self._create_task_context(payload)

            # 保存任务上下文
            self.active_tasks[task_context.task_id] = task_context

            # 启动任务处理
            await self._start_task_processing(task_context)

            # 发送接受确认
            await self._send_acceptance(message.id, task_context.task_id)

        except Exception as e:
            logger.error(f"Error handling Genesis Prompt: {e}", exc_info=True)
            await self._send_error_response(
                message.id,
                "Processing error",
                str(e)
            )

    def _validate_payload(self, payload: GenesisPromptPayload) -> Optional[str]:
        """
        验证 Genesis Prompt 负载

        Args:
            payload: Genesis Prompt 负载

        Returns:
            验证错误信息，None 表示验证通过
        """
        # 检查必需字段
        if not payload.project_id:
            return "Missing project_id"

        if not payload.platform:
            return "Missing platform"

        if not payload.requirement_summary:
            return "Missing requirement_summary"

        # 检查技术约束
        if not payload.technical_constraints:
            return "Missing technical_constraints"

        # 检查合同条款
        if not payload.contract_terms:
            return "Missing contract_terms"

        # 检查资源限制
        if not payload.resource_limits:
            return "Missing resource_limits"

        # 验证预算
        if payload.contract_terms.total_budget.value <= 0:
            return "Invalid budget amount"

        # 验证截止日期
        if payload.contract_terms.deadline < datetime.now():
            return "Deadline is in the past"

        # 验证里程碑
        total_percentage = sum(m.percentage for m in payload.contract_terms.milestones)
        if total_percentage != 100:
            logger.warning(f"Milestone percentages sum to {total_percentage}%, expected 100%")

        return None

    def _create_task_context(self, payload: GenesisPromptPayload) -> TaskContext:
        """
        创建任务上下文

        Args:
            payload: Genesis Prompt 负载

        Returns:
            TaskContext: 任务上下文
        """
        task_id = f"task-{payload.project_id}-{uuid.uuid4().hex[:8]}"

        return TaskContext(
            task_id=task_id,
            project_id=payload.project_id,
            platform=payload.platform,
            requirement_summary=payload.requirement_summary,
            technical_constraints=payload.technical_constraints,
            contract_terms=payload.contract_terms,
            resource_limits=payload.resource_limits,
            special_instructions=payload.special_instructions,
        )

    async def _start_task_processing(self, task_context: TaskContext) -> None:
        """
        启动任务处理

        Args:
            task_context: 任务上下文
        """
        logger.info(f"Starting task processing for {task_context.task_id}")

        # 更新任务状态
        task_context.status = "processing"

        # 如果有 AgentLoop，直接处理
        if self.agent_loop:
            try:
                # 构建任务描述
                task_description = self._build_task_description(task_context)

                # 使用 AgentLoop 处理任务
                # 这里创建一个系统消息来启动任务
                from nanobot.bus.events import InboundMessage
                msg = InboundMessage(
                    channel="system",
                    sender_id="genesis",
                    chat_id=f"genesis:{task_context.task_id}",
                    content=task_description,
                    metadata={
                        "task_id": task_context.task_id,
                        "project_id": task_context.project_id,
                        "platform": task_context.platform,
                    }
                )

                # 发送到消息总线
                await self.agent_loop.bus.publish_inbound(msg)

                logger.info(f"Task {task_context.task_id} submitted to AgentLoop")

            except Exception as e:
                logger.error(f"Failed to submit task to AgentLoop: {e}")
                task_context.status = "failed"
        else:
            logger.warning("No AgentLoop configured, task will be processed manually")
            # 如果没有 AgentLoop，可以在这里添加其他处理逻辑

    def _build_task_description(self, task_context: TaskContext) -> str:
        """
        构建任务描述

        Args:
            task_context: 任务上下文

        Returns:
            任务描述字符串
        """
        lines = [
            f"# Genesis Prompt Task: {task_context.task_id}",
            "",
            f"## Project: {task_context.project_id}",
            f"**Platform:** {task_context.platform}",
            "",
            "## Requirements",
            task_context.requirement_summary,
            "",
            "## Technical Constraints",
            f"- **Required Stack:** {', '.join(task_context.technical_constraints.required_stack)}",
        ]

        if task_context.technical_constraints.prohibited_stack:
            lines.append(f"- **Prohibited Stack:** {', '.join(task_context.technical_constraints.prohibited_stack)}")

        if task_context.technical_constraints.target_platform:
            lines.append(f"- **Target Platform:** {task_context.technical_constraints.target_platform}")

        lines.extend([
            "",
            "## Contract Terms",
            f"- **Total Budget:** ${task_context.contract_terms.total_budget.value} {task_context.contract_terms.total_budget.currency}",
            f"- **Deadline:** {task_context.contract_terms.deadline.strftime('%Y-%m-%d')}",
            f"- **Milestones:** {len(task_context.contract_terms.milestones)}",
            "",
            "## Resource Limits",
            f"- **Max Tokens per Task:** {task_context.resource_limits.max_tokens_per_task:,}",
            f"- **Max Cost:** ${task_context.resource_limits.max_cost_cents / 100:.2f}",
            f"- **Max Duration:** {task_context.resource_limits.max_duration_ms / 1000:.1f}s",
        ])

        if task_context.special_instructions:
            lines.extend([
                "",
                "## Special Instructions",
                f"- **Priority:** {task_context.special_instructions.priority_level}",
                f"- **Human Review Required:** {task_context.special_instructions.human_review_required}",
            ])

            if task_context.special_instructions.risk_flags:
                lines.append(f"- **Risk Flags:** {', '.join(task_context.special_instructions.risk_flags)}")

        lines.extend([
            "",
            "---",
            "",
            "Please process this Genesis Prompt and begin working on the task. "
            "Break down the work into clear steps and report progress regularly."
        ])

        return "\n".join(lines)

    async def _send_acceptance(self, message_id: str, task_id: str) -> None:
        """
        发送接受确认

        Args:
            message_id: 原始消息 ID
            task_id: 创建的任务 ID
        """
        logger.info(f"Sending acceptance for message {message_id}, task {task_id}")

        # TODO: 实现通过 WebSocket 发送接受确认
        # 这需要创建一个 ANP 响应消息并发送给 Automaton

    async def _send_rejection(self, message_id: str, reason: str) -> None:
        """
        发送拒绝响应

        Args:
            message_id: 原始消息 ID
            reason: 拒绝原因
        """
        logger.warning(f"Rejecting message {message_id}: {reason}")

        # TODO: 实现通过 WebSocket 发送拒绝响应

    async def _send_error_response(
        self,
        message_id: str,
        error_code: str,
        error_message: str
    ) -> None:
        """
        发送错误响应

        Args:
            message_id: 原始消息 ID
            error_code: 错误代码
            error_message: 错误消息
        """
        logger.error(f"Error response for {message_id}: {error_code} - {error_message}")

        # TODO: 实现通过 WebSocket 发送错误响应

    def get_task_context(self, task_id: str) -> Optional[TaskContext]:
        """
        获取任务上下文

        Args:
            task_id: 任务 ID

        Returns:
            任务上下文或 None
        """
        return self.active_tasks.get(task_id)

    def get_all_tasks(self) -> Dict[str, TaskContext]:
        """
        获取所有活动任务

        Returns:
            任务上下文字典
        """
        return dict(self.active_tasks)


# ============================================================================
# 工厂函数
# ============================================================================

def create_genesis_prompt_handler(
    agent_loop: Optional["AgentLoop"] = None,
    requirement_analyzer: Optional[RequirementAnalyzer] = None,
    private_key: Optional[Any] = None,
) -> GenesisPromptHandler:
    """
    创建 Genesis Prompt 处理器

    Args:
        agent_loop: AgentLoop 实例
        requirement_analyzer: 需求分析器
        private_key: 签名私钥

    Returns:
        GenesisPromptHandler 实例
    """
    return GenesisPromptHandler(agent_loop, requirement_analyzer, private_key)
