"""
Genesis Prompt 解析与处理
处理 Nanobot 端的任务接收和解析

@module nanobot.interagent.genesis_prompt
@version 1.0.0
"""

import json
from typing import Optional, List, Dict, Any, Callable
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime


# ============================================================================
# 类型定义
# ============================================================================

class GenesisTaskType(str, Enum):
    """任务类型"""
    GENESIS = "genesis"          # 创世任务
    ANALYSIS = "analysis"        # 分析任务
    EXECUTION = "execution"      # 执行任务
    REPORT = "report"            # 报告任务
    MAINTENANCE = "maintenance"  # 维护任务
    EXPLORATION = "exploration"  # 探索任务
    CUSTOM = "custom"            # 自定义任务


class GenesisPriority(str, Enum):
    """任务优先级"""
    CRITICAL = "critical"
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"
    BACKGROUND = "background"


@dataclass
class TechnicalConstraints:
    """技术约束"""
    allowed_languages: Optional[List[str]] = None
    forbidden_libraries: Optional[List[str]] = None
    required_libraries: Optional[List[str]] = None
    code_style: Optional[Dict[str, Any]] = None
    test_coverage: Optional[Dict[str, Any]] = None
    performance: Optional[Dict[str, Any]] = None
    security: Optional[Dict[str, Any]] = None
    custom: Optional[Dict[str, Any]] = None

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> Optional["TechnicalConstraints"]:
        if not data:
            return None
        return cls(
            allowed_languages=data.get("allowedLanguages"),
            forbidden_libraries=data.get("forbiddenLibraries"),
            required_libraries=data.get("requiredLibraries"),
            code_style=data.get("codeStyle"),
            test_coverage=data.get("testCoverage"),
            performance=data.get("performance"),
            security=data.get("security"),
            custom=data.get("custom"),
        )


@dataclass
class BusinessTerms:
    """商务条款"""
    budget: Optional[Dict[str, Any]] = None
    timeline: Optional[Dict[str, Any]] = None
    quality: Optional[Dict[str, Any]] = None
    delivery: Optional[Dict[str, Any]] = None
    priority_boost: Optional[float] = None
    custom: Optional[Dict[str, Any]] = None

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> Optional["BusinessTerms"]:
        if not data:
            return None
        return cls(
            budget=data.get("budget"),
            timeline=data.get("timeline"),
            quality=data.get("quality"),
            delivery=data.get("delivery"),
            priority_boost=data.get("priorityBoost"),
            custom=data.get("custom"),
        )


@dataclass
class GenesisInput:
    """任务输入"""
    description: str
    specification: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    files: Optional[List[str]] = None
    environment: Optional[Dict[str, str]] = None
    dependencies: Optional[List[str]] = None
    references: Optional[List[Dict[str, Any]]] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "GenesisInput":
        return cls(
            description=data.get("description", ""),
            specification=data.get("specification"),
            data=data.get("data"),
            files=data.get("files"),
            environment=data.get("environment"),
            dependencies=data.get("dependencies"),
            references=data.get("references"),
        )


@dataclass
class OutputExpectation:
    """输出预期"""
    type: str
    format: Optional[str] = None
    files: Optional[List[Dict[str, Any]]] = None
    validation: Optional[List[Dict[str, Any]]] = None

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> Optional["OutputExpectation"]:
        if not data:
            return None
        return cls(
            type=data.get("type", "mixed"),
            format=data.get("format"),
            files=data.get("files"),
            validation=data.get("validation"),
        )


@dataclass
class ExecutionContext:
    """执行上下文"""
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    project_root: Optional[str] = None
    git: Optional[Dict[str, str]] = None
    environment: Optional[str] = None
    parent_task_id: Optional[str] = None
    related_tasks: Optional[List[str]] = None
    metadata: Optional[Dict[str, Any]] = None

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> Optional["ExecutionContext"]:
        if not data:
            return None
        return cls(
            project_id=data.get("projectId"),
            project_name=data.get("projectName"),
            project_root=data.get("projectRoot"),
            git=data.get("git"),
            environment=data.get("environment"),
            parent_task_id=data.get("parentTaskId"),
            related_tasks=data.get("relatedTasks"),
            metadata=data.get("metadata"),
        )


@dataclass
class GenesisPrompt:
    """Genesis Prompt 完整结构"""
    version: str
    id: str
    # 使用camelCase以与TypeScript端保持一致
    task_type: GenesisTaskType
    priority: GenesisPriority
    source_did: str
    target_did: str
    created_at: datetime
    input: GenesisInput
    technical: Optional[TechnicalConstraints] = None
    business: Optional[BusinessTerms] = None
    output_expectation: Optional[OutputExpectation] = None
    context: Optional[ExecutionContext] = None
    callback: Optional[Dict[str, Any]] = None
    require_confirmation: bool = False
    timeout_ms: Optional[int] = None
    retry_config: Optional[Dict[str, Any]] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    extensions: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典，使用camelCase格式以与TypeScript端保持一致"""
        return {
            "version": self.version,
            "id": self.id,
            "taskType": self.task_type.value,
            "priority": self.priority.value,
            "sourceDid": self.source_did,
            "targetDid": self.target_did,
            "createdAt": self.created_at.isoformat(),
            "input": {
                "description": self.input.description,
                "specification": self.input.specification,
                "data": self.input.data,
                "files": self.input.files,
                "environment": self.input.environment,
                "dependencies": self.input.dependencies,
                "references": self.input.references,
            },
            "requireConfirmation": self.require_confirmation,
            "timeoutMs": self.timeout_ms,
            "tags": self.tags,
            "notes": self.notes,
        }


# ============================================================================
# 解析器
# ============================================================================

class GenesisPromptParser:
    """Genesis Prompt 解析器"""

    def __init__(self):
        self._validators: List[Callable[[GenesisPrompt], List[str]]] = []

    def add_validator(self, validator: Callable[[GenesisPrompt], List[str]]) -> None:
        """添加验证器"""
        self._validators.append(validator)

    def parse(self, data: Dict[str, Any]) -> GenesisPrompt:
        """
        解析 Genesis Prompt

        Args:
            data: 原始数据

        Returns:
            GenesisPrompt 实例

        Raises:
            ValueError: 解析失败
        """
        # 验证必填字段
        errors = self._validate_required_fields(data)
        if errors:
            raise ValueError(f"Missing required fields: {', '.join(errors)}")

        # 解析任务类型
        try:
            task_type = GenesisTaskType(data["taskType"])
        except ValueError:
            raise ValueError(f"Invalid task type: {data.get('taskType')}")

        # 解析优先级
        try:
            priority = GenesisPriority(data.get("priority", "normal"))
        except ValueError:
            priority = GenesisPriority.NORMAL

        # 解析时间
        created_at = data.get("createdAt")
        if isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        elif not isinstance(created_at, datetime):
            created_at = datetime.now()

        # 构建 GenesisPrompt
        prompt = GenesisPrompt(
            version=data.get("version", "1.0.0"),
            id=data["id"],
            task_type=task_type,
            priority=priority,
            source_did=data["sourceDid"],
            target_did=data["targetDid"],
            created_at=created_at,
            input=GenesisInput.from_dict(data.get("input", {})),
            technical=TechnicalConstraints.from_dict(data.get("technical")),
            business=BusinessTerms.from_dict(data.get("business")),
            output_expectation=OutputExpectation.from_dict(data.get("outputExpectation")),
            context=ExecutionContext.from_dict(data.get("context")),
            callback=data.get("callback"),
            require_confirmation=data.get("requireConfirmation", False),
            timeout_ms=data.get("timeoutMs"),
            retry_config=data.get("retryConfig"),
            tags=data.get("tags"),
            notes=data.get("notes"),
            extensions=data.get("extensions"),
        )

        # 运行自定义验证器
        for validator in self._validators:
            validation_errors = validator(prompt)
            if validation_errors:
                raise ValueError(f"Validation failed: {', '.join(validation_errors)}")

        return prompt

    def parse_json(self, json_str: str) -> GenesisPrompt:
        """从 JSON 字符串解析"""
        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON: {e}")

        return self.parse(data)

    def _validate_required_fields(self, data: Dict[str, Any]) -> List[str]:
        """验证必填字段"""
        required = ["id", "taskType", "sourceDid", "targetDid", "input"]
        missing = []

        for field in required:
            if field not in data:
                missing.append(field)
            elif field == "input" and not data.get("input", {}).get("description"):
                missing.append("input.description")

        return missing


# ============================================================================
# 执行计划生成器
# ============================================================================

@dataclass
class ExecutionStep:
    """执行步骤"""
    id: str
    name: str
    description: str
    action: str
    dependencies: List[str] = field(default_factory=list)
    estimated_duration_ms: int = 0
    required_tools: List[str] = field(default_factory=list)
    validation_rules: List[str] = field(default_factory=list)
    retry_count: int = 0
    optional: bool = False


@dataclass
class ExecutionPlan:
    """执行计划"""
    prompt_id: str
    total_steps: int
    estimated_total_duration_ms: int
    steps: List[ExecutionStep]
    required_tools: List[str]
    risk_assessment: str
    notes: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "promptId": self.prompt_id,
            "totalSteps": self.total_steps,
            "estimatedTotalDurationMs": self.estimated_total_duration_ms,
            "steps": [
                {
                    "id": step.id,
                    "name": step.name,
                    "description": step.description,
                    "action": step.action,
                    "dependencies": step.dependencies,
                    "estimatedDurationMs": step.estimated_duration_ms,
                    "requiredTools": step.required_tools,
                    "optional": step.optional,
                }
                for step in self.steps
            ],
            "requiredTools": self.required_tools,
            "riskAssessment": self.risk_assessment,
            "notes": self.notes,
        }


class ExecutionPlanGenerator:
    """执行计划生成器"""

    def __init__(self):
        self._step_templates = self._load_step_templates()

    def generate(self, prompt: GenesisPrompt) -> ExecutionPlan:
        """
        生成执行计划

        Args:
            prompt: Genesis Prompt

        Returns:
            执行计划
        """
        # 根据任务类型获取步骤模板
        templates = self._get_templates_for_task_type(prompt.task_type)

        # 构建执行步骤
        steps = []
        required_tools = set()

        for i, template in enumerate(templates):
            step = ExecutionStep(
                id=f"step-{i + 1}",
                name=template["name"],
                description=template["description"].format(
                    description=prompt.input.description[:100]
                ),
                action=template["action"],
                dependencies=template.get("dependencies", []),
                estimated_duration_ms=template.get("estimatedDurationMs", 30000),
                required_tools=template.get("requiredTools", []),
                optional=template.get("optional", False),
            )
            steps.append(step)
            required_tools.update(step.required_tools)

        # 计算总预估时间
        total_duration = sum(step.estimated_duration_ms for step in steps)

        # 评估风险
        risk = self._assess_risk(prompt, steps)

        return ExecutionPlan(
            prompt_id=prompt.id,
            total_steps=len(steps),
            estimated_total_duration_ms=total_duration,
            steps=steps,
            required_tools=list(required_tools),
            risk_assessment=risk,
        )

    def _load_step_templates(self) -> Dict[str, List[Dict[str, Any]]]:
        """加载步骤模板"""
        return {
            "genesis": [
                {
                    "name": "理解需求",
                    "description": "分析任务需求: {description}",
                    "action": "analyze_requirements",
                    "estimatedDurationMs": 30000,
                    "requiredTools": ["read", "grep"],
                },
                {
                    "name": "设计方案",
                    "description": "设计实现方案",
                    "action": "design_solution",
                    "estimatedDurationMs": 60000,
                    "requiredTools": ["read", "write"],
                    "dependencies": ["step-1"],
                },
                {
                    "name": "实现代码",
                    "description": "编写代码实现",
                    "action": "implement_code",
                    "estimatedDurationMs": 300000,
                    "requiredTools": ["write", "edit"],
                    "dependencies": ["step-2"],
                },
                {
                    "name": "编写测试",
                    "description": "编写单元测试",
                    "action": "write_tests",
                    "estimatedDurationMs": 120000,
                    "requiredTools": ["write"],
                    "dependencies": ["step-3"],
                },
                {
                    "name": "验证完成",
                    "description": "运行测试验证",
                    "action": "verify_completion",
                    "estimatedDurationMs": 60000,
                    "requiredTools": ["bash"],
                    "dependencies": ["step-4"],
                },
            ],
            "analysis": [
                {
                    "name": "收集信息",
                    "description": "收集分析所需信息",
                    "action": "gather_information",
                    "estimatedDurationMs": 60000,
                    "requiredTools": ["read", "grep", "glob"],
                },
                {
                    "name": "分析数据",
                    "description": "执行分析",
                    "action": "analyze_data",
                    "estimatedDurationMs": 120000,
                    "requiredTools": ["read"],
                    "dependencies": ["step-1"],
                },
                {
                    "name": "生成报告",
                    "description": "生成分析报告",
                    "action": "generate_report",
                    "estimatedDurationMs": 60000,
                    "requiredTools": ["write"],
                    "dependencies": ["step-2"],
                },
            ],
            "execution": [
                {
                    "name": "准备工作",
                    "description": "准备执行环境",
                    "action": "prepare_environment",
                    "estimatedDurationMs": 30000,
                    "requiredTools": ["bash"],
                },
                {
                    "name": "执行操作",
                    "description": "执行主要操作",
                    "action": "execute_main",
                    "estimatedDurationMs": 120000,
                    "requiredTools": ["bash", "write"],
                    "dependencies": ["step-1"],
                },
                {
                    "name": "验证结果",
                    "description": "验证执行结果",
                    "action": "verify_results",
                    "estimatedDurationMs": 30000,
                    "requiredTools": ["bash"],
                    "dependencies": ["step-2"],
                },
            ],
            "report": [
                {
                    "name": "收集数据",
                    "description": "收集报告数据",
                    "action": "collect_data",
                    "estimatedDurationMs": 60000,
                    "requiredTools": ["read", "grep"],
                },
                {
                    "name": "生成报告",
                    "description": "生成报告文档",
                    "action": "generate_report",
                    "estimatedDurationMs": 60000,
                    "requiredTools": ["write"],
                    "dependencies": ["step-1"],
                },
            ],
            "maintenance": [
                {
                    "name": "诊断问题",
                    "description": "诊断需要维护的问题",
                    "action": "diagnose_issues",
                    "estimatedDurationMs": 60000,
                    "requiredTools": ["read", "grep", "bash"],
                },
                {
                    "name": "执行维护",
                    "description": "执行维护操作",
                    "action": "perform_maintenance",
                    "estimatedDurationMs": 120000,
                    "requiredTools": ["edit", "bash"],
                    "dependencies": ["step-1"],
                },
                {
                    "name": "验证修复",
                    "description": "验证维护结果",
                    "action": "verify_fix",
                    "estimatedDurationMs": 30000,
                    "requiredTools": ["bash"],
                    "dependencies": ["step-2"],
                },
            ],
            "exploration": [
                {
                    "name": "搜索资料",
                    "description": "搜索相关资料",
                    "action": "search_resources",
                    "estimatedDurationMs": 120000,
                    "requiredTools": ["web_search"],
                },
                {
                    "name": "分析发现",
                    "description": "分析搜索结果",
                    "action": "analyze_findings",
                    "estimatedDurationMs": 120000,
                    "requiredTools": ["read"],
                    "dependencies": ["step-1"],
                },
                {
                    "name": "总结报告",
                    "description": "编写探索报告",
                    "action": "summarize_findings",
                    "estimatedDurationMs": 60000,
                    "requiredTools": ["write"],
                    "dependencies": ["step-2"],
                },
            ],
            "custom": [
                {
                    "name": "执行自定义任务",
                    "description": "执行自定义任务",
                    "action": "execute_custom",
                    "estimatedDurationMs": 60000,
                    "requiredTools": [],
                },
            ],
        }

    def _get_templates_for_task_type(self, task_type: GenesisTaskType) -> List[Dict[str, Any]]:
        """获取任务类型对应的步骤模板"""
        return self._step_templates.get(task_type.value, self._step_templates["custom"])

    def _assess_risk(self, prompt: GenesisPrompt, steps: List[ExecutionStep]) -> str:
        """评估风险"""
        risk_factors = []

        # 检查约束
        if prompt.technical:
            if prompt.technical.forbidden_libraries:
                risk_factors.append("有库限制")
            if prompt.technical.security:
                risk_factors.append("有安全约束")

        # 检查时间约束
        if prompt.business and prompt.business.timeline:
            deadline = prompt.business.timeline.get("deadline")
            if deadline:
                risk_factors.append("有截止时间")

        # 检查步骤数
        if len(steps) > 5:
            risk_factors.append("步骤较多")

        if not risk_factors:
            return "low"
        elif len(risk_factors) <= 2:
            return "medium"
        else:
            return "high"


# ============================================================================
# 任务接收器
# ============================================================================

class TaskReceiver:
    """任务接收器"""

    def __init__(self, nanobot_did: str):
        self.nanobot_did = nanobot_did
        self.parser = GenesisPromptParser()
        self.plan_generator = ExecutionPlanGenerator()
        self._handlers: Dict[GenesisTaskType, Callable] = {}

    def register_handler(
        self,
        task_type: GenesisTaskType,
        handler: Callable[[GenesisPrompt, ExecutionPlan], Any]
    ) -> None:
        """注册任务处理器"""
        self._handlers[task_type] = handler

    async def receive(self, prompt_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        接收任务

        Args:
            prompt_data: Prompt 数据

        Returns:
            接收结果
        """
        try:
            # 解析 Prompt
            prompt = self.parser.parse(prompt_data)

            # 验证目标 DID
            if prompt.target_did != self.nanobot_did:
                return {
                    "accepted": False,
                    "reason": f"Target mismatch: expected {self.nanobot_did}, got {prompt.target_did}",
                }

            # 生成执行计划
            plan = self.plan_generator.generate(prompt)

            # 检查是否有处理器
            handler = self._handlers.get(prompt.task_type)

            return {
                "accepted": True,
                "prompt_id": prompt.id,
                "execution_plan": plan.to_dict(),
                "has_handler": handler is not None,
            }

        except ValueError as e:
            return {
                "accepted": False,
                "reason": str(e),
            }
        except Exception as e:
            return {
                "accepted": False,
                "reason": f"Internal error: {e}",
            }

    def receive_and_plan(self, prompt_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        同步接收并生成计划

        Args:
            prompt_data: Prompt 数据

        Returns:
            接收结果和执行计划
        """
        try:
            prompt = self.parser.parse(prompt_data)

            if prompt.target_did != self.nanobot_did:
                return {
                    "success": False,
                    "error": f"Target mismatch",
                }

            plan = self.plan_generator.generate(prompt)

            return {
                "success": True,
                "prompt": prompt,
                "plan": plan,
            }

        except ValueError as e:
            return {
                "success": False,
                "error": str(e),
            }


# ============================================================================
# 工厂函数
# ============================================================================

def create_task_receiver(nanobot_did: str) -> TaskReceiver:
    """创建任务接收器"""
    return TaskReceiver(nanobot_did)


def parse_genesis_prompt(data: Dict[str, Any]) -> GenesisPrompt:
    """解析 Genesis Prompt"""
    parser = GenesisPromptParser()
    return parser.parse(data)


def generate_execution_plan(prompt: GenesisPrompt) -> ExecutionPlan:
    """生成执行计划"""
    generator = ExecutionPlanGenerator()
    return generator.generate(prompt)
