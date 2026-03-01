"""
Genesis Receiver - Nanobot 端 Genesis Prompt 接收处理器

接收来自 Automaton 的 Genesis Prompt，验证并创建执行上下文

@module orchestration.genesis_receiver
@version 1.0.0
"""

import asyncio
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Literal, Optional, Union

from pydantic import ValidationError

from ..anp.types import (
    GenesisPromptPayload,
    ProgressReportPayload,
    ErrorReportPayload,
    TechnicalConstraints,
    ContractTerms,
    ResourceLimits,
    SpecialInstructions,
    ANPError,
    ANPErrorCode,
)


# ============================================================================
# 类型定义
# ============================================================================

class ProjectStatus(str, Enum):
    """项目执行状态"""
    PENDING = "pending"
    VALIDATING = "validating"
    SETUP = "setup"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class ProjectContext:
    """项目执行上下文"""
    project_id: str
    platform: str
    requirement_summary: str
    technical_constraints: TechnicalConstraints
    contract_terms: ContractTerms
    resource_limits: ResourceLimits
    special_instructions: Optional[SpecialInstructions] = None

    # 执行状态
    status: ProjectStatus = ProjectStatus.PENDING
    progress: int = 0
    current_phase: str = "init"
    completed_steps: List[str] = field(default_factory=list)
    next_steps: List[str] = field(default_factory=list)
    blockers: List[str] = field(default_factory=list)

    # 时间戳
    created_at: datetime = field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    # 资源使用
    tokens_used: int = 0
    cost_cents: int = 0

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "project_id": self.project_id,
            "platform": self.platform,
            "requirement_summary": self.requirement_summary,
            "status": self.status.value,
            "progress": self.progress,
            "current_phase": self.current_phase,
            "completed_steps": self.completed_steps,
            "next_steps": self.next_steps,
            "blockers": self.blockers,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "tokens_used": self.tokens_used,
            "cost_cents": self.cost_cents,
        }


@dataclass
class ExecutionContext:
    """任务执行上下文"""
    context_id: str
    project: ProjectContext
    working_directory: str
    environment: Dict[str, str] = field(default_factory=dict)
    tools_available: List[str] = field(default_factory=list)
    skills_enabled: List[str] = field(default_factory=list)

    # 执行配置
    max_retries: int = 3
    timeout_seconds: int = 3600
    checkpoint_interval: int = 300

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "context_id": self.context_id,
            "project": self.project.to_dict(),
            "working_directory": self.working_directory,
            "environment": self.environment,
            "tools_available": self.tools_available,
            "skills_enabled": self.skills_enabled,
            "max_retries": self.max_retries,
            "timeout_seconds": self.timeout_seconds,
            "checkpoint_interval": self.checkpoint_interval,
        }


# ============================================================================
# 验证错误
# ============================================================================

class GenesisValidationError(Exception):
    """Genesis Prompt 验证错误"""

    def __init__(
        self,
        code: str,
        message: str,
        field_path: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ):
        self.code = code
        self.message = message
        self.field_path = field_path
        self.details = details or {}
        super().__init__(message)


# ============================================================================
# Genesis Receiver 类
# ============================================================================

class GenesisReceiver:
    """
    Genesis Receiver - 接收和处理 Genesis Prompt

    负责验证、解析和创建执行上下文
    """

    def __init__(
        self,
        working_directory: str = "/tmp/nanobot/projects",
        progress_callback: Optional[Callable[[ProgressReportPayload], None]] = None,
        error_callback: Optional[Callable[[ErrorReportPayload], None]] = None,
    ):
        self.working_directory = working_directory
        self.progress_callback = progress_callback
        self.error_callback = error_callback

        # 项目存储
        self._projects: Dict[str, ProjectContext] = {}
        self._contexts: Dict[str, ExecutionContext] = {}

        # 事件处理器
        self._event_handlers: Dict[str, List[Callable]] = {
            "project_received": [],
            "project_validated": [],
            "project_started": [],
            "project_completed": [],
            "project_failed": [],
            "progress_updated": [],
        }

    # ========================================================================
    # 公共 API
    # ========================================================================

    async def receive_genesis_prompt(self, payload: Dict[str, Any]) -> ProjectContext:
        """
        接收并解析 Genesis Prompt

        Args:
            payload: 原始消息负载

        Returns:
            项目上下文

        Raises:
            GenesisValidationError: 验证失败
        """
        # 验证消息格式
        if not await self.validate_prompt(payload):
            raise GenesisValidationError(
                code="INVALID_FORMAT",
                message="Invalid Genesis Prompt format",
            )

        # 解析为 Pydantic 模型
        try:
            genesis = GenesisPromptPayload.model_validate(payload)
        except ValidationError as e:
            raise GenesisValidationError(
                code="PARSING_ERROR",
                message=f"Failed to parse Genesis Prompt: {e}",
                details={"validation_errors": e.errors()},
            )

        # 创建项目上下文
        context = await self.create_project_context(payload)

        # 存储项目
        self._projects[context.project_id] = context

        await self._emit("project_received", context)

        return context

    async def validate_prompt(self, payload: Dict[str, Any]) -> bool:
        """
        验证消息格式和约束

        Args:
            payload: 原始消息负载

        Returns:
            是否验证通过
        """
        # 检查必需字段
        required_fields = [
            "@type",
            "genesis:projectId",
            "genesis:platform",
            "genesis:requirementSummary",
            "genesis:technicalConstraints",
            "genesis:contractTerms",
            "genesis:resourceLimits",
        ]

        for field in required_fields:
            if field not in payload:
                return False

        # 检查类型标识
        if payload.get("@type") != "genesis:GenesisPrompt":
            return False

        # 验证技术约束
        tc = payload.get("genesis:technicalConstraints", {})
        if not isinstance(tc, dict):
            return False
        if tc.get("@type") != "genesis:TechnicalConstraints":
            return False

        # 验证合同条款
        ct = payload.get("genesis:contractTerms", {})
        if not isinstance(ct, dict):
            return False
        if ct.get("@type") != "genesis:ContractTerms":
            return False

        # 验证预算
        budget = ct.get("genesis:totalBudget", {})
        if not isinstance(budget, dict):
            return False
        if budget.get("@type") != "schema:MonetaryAmount":
            return False
        if not isinstance(budget.get("schema:value"), (int, float)):
            return False

        # 验证截止日期格式
        deadline = ct.get("genesis:deadline")
        if deadline:
            try:
                datetime.fromisoformat(deadline.replace("Z", "+00:00"))
            except ValueError:
                return False

        # 验证资源限制
        rl = payload.get("genesis:resourceLimits", {})
        if not isinstance(rl, dict):
            return False
        if rl.get("@type") != "genesis:ResourceLimits":
            return False

        # 验证资源限制值
        if not isinstance(rl.get("genesis:maxTokensPerTask"), (int, float)):
            return False
        if not isinstance(rl.get("genesis:maxCostCents"), (int, float)):
            return False
        if not isinstance(rl.get("genesis:maxDurationMs"), (int, float)):
            return False

        # 验证特殊指示 (可选)
        si = payload.get("genesis:specialInstructions")
        if si is not None:
            if not isinstance(si, dict):
                return False
            if si.get("@type") != "genesis:SpecialInstructions":
                return False
            if si.get("genesis:priorityLevel") not in ["low", "normal", "high"]:
                return False

        return True

    async def create_project_context(self, payload: Dict[str, Any]) -> ProjectContext:
        """
        创建项目执行上下文

        Args:
            payload: 已验证的消息负载

        Returns:
            项目上下文
        """
        genesis = GenesisPromptPayload.model_validate(payload)

        context = ProjectContext(
            project_id=genesis.project_id,
            platform=genesis.platform,
            requirement_summary=genesis.requirement_summary,
            technical_constraints=genesis.technical_constraints,
            contract_terms=genesis.contract_terms,
            resource_limits=genesis.resource_limits,
            special_instructions=genesis.special_instructions,
            status=ProjectStatus.PENDING,
            progress=0,
            current_phase="init",
            completed_steps=[],
            next_steps=["validate", "setup", "execute", "deliver"],
            blockers=[],
        )

        await self._emit("project_validated", context)

        return context

    async def start_execution(self, context: Union[ProjectContext, str]) -> ExecutionContext:
        """
        启动任务执行

        Args:
            context: 项目上下文或项目 ID

        Returns:
            执行上下文
        """
        # 获取项目上下文
        if isinstance(context, str):
            project = self._projects.get(context)
            if not project:
                raise ValueError(f"Project not found: {context}")
        else:
            project = context

        # 检查是否已在执行
        if project.status == ProjectStatus.IN_PROGRESS:
            raise ValueError(f"Project already in progress: {project.project_id}")

        # 生成执行上下文 ID
        context_id = self._generate_context_id()

        # 创建执行上下文
        exec_context = ExecutionContext(
            context_id=context_id,
            project=project,
            working_directory=f"{self.working_directory}/{project.project_id}",
            environment=self._create_environment(project),
            tools_available=self._get_available_tools(),
            skills_enabled=self._get_enabled_skills(project),
        )

        # 更新项目状态
        project.status = ProjectStatus.IN_PROGRESS
        project.started_at = datetime.utcnow()
        project.current_phase = "execution"

        # 存储执行上下文
        self._contexts[context_id] = exec_context

        await self._emit("project_started", exec_context)

        # 发送进度报告
        await self._report_progress(project)

        return exec_context

    def get_project(self, project_id: str) -> Optional[ProjectContext]:
        """
        获取项目上下文

        Args:
            project_id: 项目 ID

        Returns:
            项目上下文或 None
        """
        return self._projects.get(project_id)

    def get_execution_context(self, context_id: str) -> Optional[ExecutionContext]:
        """
        获取执行上下文

        Args:
            context_id: 上下文 ID

        Returns:
            执行上下文或 None
        """
        return self._contexts.get(context_id)

    def get_active_projects(self) -> List[ProjectContext]:
        """
        获取所有活跃项目

        Returns:
            活跃项目列表
        """
        return [
            p for p in self._projects.values()
            if p.status in (ProjectStatus.PENDING, ProjectStatus.IN_PROGRESS)
        ]

    async def update_progress(
        self,
        project_id: str,
        progress: int,
        current_phase: str,
        completed_steps: Optional[List[str]] = None,
        next_steps: Optional[List[str]] = None,
        blockers: Optional[List[str]] = None,
    ) -> None:
        """
        更新项目进度

        Args:
            project_id: 项目 ID
            progress: 进度百分比 (0-100)
            current_phase: 当前阶段
            completed_steps: 已完成步骤
            next_steps: 下一步骤
            blockers: 阻塞问题
        """
        project = self._projects.get(project_id)
        if not project:
            return

        project.progress = max(0, min(100, progress))
        project.current_phase = current_phase

        if completed_steps is not None:
            project.completed_steps = completed_steps
        if next_steps is not None:
            project.next_steps = next_steps
        if blockers is not None:
            project.blockers = blockers

        # 检查是否完成
        if progress >= 100:
            project.status = ProjectStatus.COMPLETED
            project.completed_at = datetime.utcnow()
            await self._emit("project_completed", project)
        else:
            await self._emit("progress_updated", project)

        await self._report_progress(project)

    async def report_error(
        self,
        project_id: str,
        severity: Literal["warning", "error", "critical"],
        error_code: str,
        message: str,
        context: Optional[Dict[str, Any]] = None,
        recoverable: bool = True,
        suggested_action: Optional[str] = None,
    ) -> None:
        """
        报告错误

        Args:
            project_id: 项目 ID
            severity: 严重程度
            error_code: 错误代码
            message: 错误消息
            context: 错误上下文
            recoverable: 是否可恢复
            suggested_action: 建议操作
        """
        project = self._projects.get(project_id)
        if not project:
            return

        # 创建错误报告
        error_report = ErrorReportPayload(
            task_id=project_id,
            severity=severity,
            error_code=error_code,
            message=message,
            context=context or {},
            recoverable=recoverable,
            suggested_action=suggested_action,
        )

        # 更新项目状态
        if not recoverable or severity == "critical":
            project.status = ProjectStatus.FAILED
            project.completed_at = datetime.utcnow()
            await self._emit("project_failed", project, error_report)

        # 发送错误报告
        if self.error_callback:
            self.error_callback(error_report)

    # ========================================================================
    # 事件处理
    # ========================================================================

    def on(self, event: str, handler: Callable) -> None:
        """注册事件处理器"""
        if event in self._event_handlers:
            self._event_handlers[event].append(handler)

    async def _emit(self, event: str, *args: Any) -> None:
        """触发事件"""
        handlers = self._event_handlers.get(event, [])
        for handler in handlers:
            try:
                if asyncio.iscoroutinefunction(handler):
                    await handler(*args)
                else:
                    handler(*args)
            except Exception as e:
                # 避免事件处理器异常影响主流程
                import logging
                logging.warning(f"Event handler error: {e}")

    # ========================================================================
    # 私有方法
    # ========================================================================

    async def _report_progress(self, project: ProjectContext) -> None:
        """发送进度报告"""
        if not self.progress_callback:
            return

        # 计算 ETA
        eta_seconds = None
        if project.started_at and project.progress > 0:
            elapsed = (datetime.utcnow() - project.started_at).total_seconds()
            total_estimated = elapsed / (project.progress / 100)
            eta_seconds = int(total_estimated - elapsed)

        report = ProgressReportPayload(
            task_id=project.project_id,
            progress=project.progress,
            current_phase=project.current_phase,
            completed_steps=project.completed_steps,
            next_steps=project.next_steps,
            eta_seconds=eta_seconds,
            blockers=project.blockers,
        )

        self.progress_callback(report)

    def _generate_context_id(self) -> str:
        """生成上下文 ID"""
        timestamp = int(time.time() * 1000)
        random_part = secrets.token_hex(8)
        return f"ctx-{timestamp}-{random_part}"

    def _create_environment(self, project: ProjectContext) -> Dict[str, str]:
        """创建执行环境变量"""
        env = {
            "NANOBOT_PROJECT_ID": project.project_id,
            "NANOBOT_PLATFORM": project.platform,
            "NANOBOT_MAX_TOKENS": str(project.resource_limits.max_tokens_per_task),
            "NANOBOT_MAX_COST_CENTS": str(project.resource_limits.max_cost_cents),
            "NANOBOT_DEADLINE": project.contract_terms.deadline.isoformat(),
        }

        # 添加技术栈信息
        if project.technical_constraints.required_stack:
            env["NANOBOT_REQUIRED_STACK"] = ",".join(
                project.technical_constraints.required_stack
            )
        if project.technical_constraints.target_platform:
            env["NANOBOT_TARGET_PLATFORM"] = project.technical_constraints.target_platform

        return env

    def _get_available_tools(self) -> List[str]:
        """获取可用工具列表"""
        return [
            "filesystem",
            "git",
            "npm",
            "pip",
            "docker",
            "curl",
            "jq",
        ]

    def _get_enabled_skills(self, project: ProjectContext) -> List[str]:
        """根据项目需求获取启用的技能"""
        skills = [
            "code_generation",
            "testing",
            "documentation",
        ]

        # 根据技术栈添加特定技能
        stack = project.technical_constraints.required_stack
        if stack:
            if any(s.lower() in ["react", "vue", "angular"] for s in stack):
                skills.append("frontend")
            if any(s.lower() in ["node", "python", "go"] for s in stack):
                skills.append("backend")
            if any(s.lower() in ["aws", "gcp", "azure", "vercel"] for s in stack):
                skills.append("deployment")

        return skills


# ============================================================================
# 工厂函数
# ============================================================================

def create_genesis_receiver(
    working_directory: str = "/tmp/nanobot/projects",
    progress_callback: Optional[Callable[[ProgressReportPayload], None]] = None,
    error_callback: Optional[Callable[[ErrorReportPayload], None]] = None,
) -> GenesisReceiver:
    """
    创建 Genesis Receiver 实例

    Args:
        working_directory: 工作目录
        progress_callback: 进度回调
        error_callback: 错误回调

    Returns:
        GenesisReceiver 实例
    """
    return GenesisReceiver(
        working_directory=working_directory,
        progress_callback=progress_callback,
        error_callback=error_callback,
    )
