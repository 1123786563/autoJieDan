"""
测试 Genesis Prompt 解析与处理模块
"""

import pytest
from datetime import datetime

from nanobot.interagent.genesis_prompt import (
    GenesisTaskType,
    GenesisPriority,
    TechnicalConstraints,
    BusinessTerms,
    GenesisInput,
    OutputExpectation,
    ExecutionContext,
    GenesisPrompt,
    GenesisPromptParser,
    ExecutionPlanGenerator,
    ExecutionPlan,
    ExecutionStep,
    TaskReceiver,
    create_task_receiver,
    parse_genesis_prompt,
    generate_execution_plan,
)


class TestEnums:
    """测试枚举类型"""

    def test_task_type_values(self):
        """测试任务类型"""
        assert GenesisTaskType.GENESIS.value == "genesis"
        assert GenesisTaskType.ANALYSIS.value == "analysis"
        assert GenesisTaskType.EXECUTION.value == "execution"

    def test_priority_values(self):
        """测试优先级"""
        assert GenesisPriority.CRITICAL.value == "critical"
        assert GenesisPriority.HIGH.value == "high"
        assert GenesisPriority.NORMAL.value == "normal"
        assert GenesisPriority.LOW.value == "low"
        assert GenesisPriority.BACKGROUND.value == "background"


class TestTechnicalConstraints:
    """测试技术约束"""

    def test_from_dict(self):
        """测试从字典创建"""
        data = {
            "allowedLanguages": ["python", "typescript"],
            "forbiddenLibraries": ["jquery"],
            "requiredLibraries": ["pytest"],
            "testCoverage": {"minimum": 80, "enforce": True},
        }

        constraints = TechnicalConstraints.from_dict(data)

        assert constraints.allowed_languages == ["python", "typescript"]
        assert constraints.forbidden_libraries == ["jquery"]
        assert constraints.required_libraries == ["pytest"]
        assert constraints.test_coverage == {"minimum": 80, "enforce": True}

    def test_from_dict_none(self):
        """测试空字典"""
        constraints = TechnicalConstraints.from_dict(None)
        assert constraints is None


class TestBusinessTerms:
    """测试商务条款"""

    def test_from_dict(self):
        """测试从字典创建"""
        data = {
            "budget": {"total": 100, "currency": "USD"},
            "quality": {"level": "premium"},
        }

        terms = BusinessTerms.from_dict(data)

        assert terms.budget == {"total": 100, "currency": "USD"}
        assert terms.quality == {"level": "premium"}

    def test_from_dict_none(self):
        """测试空字典"""
        terms = BusinessTerms.from_dict(None)
        assert terms is None


class TestGenesisInput:
    """测试任务输入"""

    def test_from_dict(self):
        """测试从字典创建"""
        data = {
            "description": "Create a feature",
            "specification": "Detailed specs",
            "data": {"key": "value"},
            "files": ["file1.py", "file2.py"],
        }

        input_data = GenesisInput.from_dict(data)

        assert input_data.description == "Create a feature"
        assert input_data.specification == "Detailed specs"
        assert input_data.data == {"key": "value"}
        assert input_data.files == ["file1.py", "file2.py"]


class TestGenesisPromptParser:
    """测试 Genesis Prompt 解析器"""

    @pytest.fixture
    def parser(self):
        return GenesisPromptParser()

    @pytest.fixture
    def valid_prompt_data(self):
        return {
            "id": "task-1",
            "taskType": "genesis",
            "priority": "high",
            "sourceDid": "did:anp:automaton:main",
            "targetDid": "did:anp:nanobot:worker1",
            "createdAt": "2024-01-01T00:00:00Z",
            "input": {
                "description": "Create a feature",
                "specification": "Details",
            },
            "technical": {
                "allowedLanguages": ["python"],
            },
            "business": {
                "budget": {"total": 10},
            },
        }

    def test_parse_valid_prompt(self, parser, valid_prompt_data):
        """测试解析有效的 Prompt"""
        prompt = parser.parse(valid_prompt_data)

        assert prompt.id == "task-1"
        assert prompt.task_type == GenesisTaskType.GENESIS
        assert prompt.priority == GenesisPriority.HIGH
        assert prompt.source_did == "did:anp:automaton:main"
        assert prompt.target_did == "did:anp:nanobot:worker1"
        assert prompt.input.description == "Create a feature"

    def test_parse_missing_required_field(self, parser, valid_prompt_data):
        """测试缺少必填字段"""
        del valid_prompt_data["id"]

        with pytest.raises(ValueError) as exc_info:
            parser.parse(valid_prompt_data)

        assert "id" in str(exc_info.value)

    def test_parse_missing_input_description(self, parser, valid_prompt_data):
        """测试缺少输入描述"""
        valid_prompt_data["input"] = {}

        with pytest.raises(ValueError) as exc_info:
            parser.parse(valid_prompt_data)

        assert "input.description" in str(exc_info.value)

    def test_parse_invalid_task_type(self, parser, valid_prompt_data):
        """测试无效的任务类型"""
        valid_prompt_data["taskType"] = "invalid"

        with pytest.raises(ValueError) as exc_info:
            parser.parse(valid_prompt_data)

        assert "Invalid task type" in str(exc_info.value)

    def test_parse_invalid_priority(self, parser, valid_prompt_data):
        """测试无效的优先级 - 应该使用默认值"""
        valid_prompt_data["priority"] = "invalid"

        prompt = parser.parse(valid_prompt_data)

        # 无效优先级应该回退到默认值
        assert prompt.priority == GenesisPriority.NORMAL

    def test_parse_json(self, parser, valid_prompt_data):
        """测试从 JSON 字符串解析"""
        import json
        json_str = json.dumps(valid_prompt_data)

        prompt = parser.parse_json(json_str)

        assert prompt.id == "task-1"

    def test_parse_invalid_json(self, parser):
        """测试无效的 JSON"""
        with pytest.raises(ValueError) as exc_info:
            parser.parse_json("not valid json")

        assert "Invalid JSON" in str(exc_info.value)

    def test_parse_with_custom_validator(self, parser, valid_prompt_data):
        """测试自定义验证器"""
        def validator(prompt):
            errors = []
            if not prompt.input.specification:
                errors.append("Specification required")
            return errors

        parser.add_validator(validator)

        valid_prompt_data["input"]["specification"] = None

        with pytest.raises(ValueError) as exc_info:
            parser.parse(valid_prompt_data)

        assert "Specification required" in str(exc_info.value)


class TestExecutionPlanGenerator:
    """测试执行计划生成器"""

    @pytest.fixture
    def generator(self):
        return ExecutionPlanGenerator()

    @pytest.fixture
    def sample_prompt(self):
        return GenesisPrompt(
            version="1.0.0",
            id="task-1",
            task_type=GenesisTaskType.GENESIS,
            priority=GenesisPriority.NORMAL,
            source_did="did:anp:automaton:main",
            target_did="did:anp:nanobot:worker1",
            created_at=datetime.now(),
            input=GenesisInput(description="Create feature"),
        )

    def test_generate_plan(self, generator, sample_prompt):
        """测试生成执行计划"""
        plan = generator.generate(sample_prompt)

        assert plan.prompt_id == "task-1"
        assert plan.total_steps > 0
        assert len(plan.steps) > 0
        assert plan.estimated_total_duration_ms > 0

    def test_genesis_task_has_multiple_steps(self, generator, sample_prompt):
        """测试创世任务有多个步骤"""
        plan = generator.generate(sample_prompt)

        # Genesis 任务应该有多个步骤
        assert plan.total_steps >= 3

    def test_steps_have_dependencies(self, generator, sample_prompt):
        """测试步骤有依赖关系"""
        plan = generator.generate(sample_prompt)

        # 检查步骤 ID 连续性
        for i, step in enumerate(plan.steps):
            assert step.id == f"step-{i + 1}"

        # 检查依赖关系
        for step in plan.steps:
            for dep in step.dependencies:
                assert dep.startswith("step-")

    def test_analysis_task_plan(self, generator):
        """测试分析任务计划"""
        prompt = GenesisPrompt(
            version="1.0.0",
            id="task-2",
            task_type=GenesisTaskType.ANALYSIS,
            priority=GenesisPriority.NORMAL,
            source_did="did:anp:automaton:main",
            target_did="did:anp:nanobot:worker1",
            created_at=datetime.now(),
            input=GenesisInput(description="Analyze code"),
        )

        plan = generator.generate(prompt)

        assert plan.total_steps >= 1
        # 分析任务步骤应该包含 "gather" 或 "analyze"
        step_names = [s.name.lower() for s in plan.steps]
        assert any("分析" in name or "收集" in name for name in step_names)

    def test_required_tools_collected(self, generator, sample_prompt):
        """测试收集所需工具"""
        plan = generator.generate(sample_prompt)

        assert isinstance(plan.required_tools, list)

    def test_risk_assessment(self, generator):
        """测试风险评估"""
        # 简单任务
        simple_prompt = GenesisPrompt(
            version="1.0.0",
            id="task-1",
            task_type=GenesisTaskType.REPORT,
            priority=GenesisPriority.NORMAL,
            source_did="did:anp:automaton:main",
            target_did="did:anp:nanobot:worker1",
            created_at=datetime.now(),
            input=GenesisInput(description="Generate report"),
        )

        plan = generator.generate(simple_prompt)
        assert plan.risk_assessment in ["low", "medium", "high"]

    def test_plan_to_dict(self, generator, sample_prompt):
        """测试计划转字典"""
        plan = generator.generate(sample_prompt)
        data = plan.to_dict()

        assert data["promptId"] == "task-1"
        assert data["totalSteps"] == plan.total_steps
        assert len(data["steps"]) == plan.total_steps


class TestTaskReceiver:
    """测试任务接收器"""

    @pytest.fixture
    def receiver(self):
        return TaskReceiver("did:anp:nanobot:worker1")

    @pytest.fixture
    def valid_prompt_data(self):
        return {
            "id": "task-1",
            "taskType": "genesis",
            "sourceDid": "did:anp:automaton:main",
            "targetDid": "did:anp:nanobot:worker1",
            "input": {
                "description": "Create a feature",
            },
        }

    @pytest.mark.asyncio
    async def test_receive_valid_prompt(self, receiver, valid_prompt_data):
        """测试接收有效 Prompt"""
        result = await receiver.receive(valid_prompt_data)

        assert result["accepted"] is True
        assert result["prompt_id"] == "task-1"
        assert "execution_plan" in result

    @pytest.mark.asyncio
    async def test_receive_wrong_target(self, receiver, valid_prompt_data):
        """测试接收错误目标的 Prompt"""
        valid_prompt_data["targetDid"] = "did:anp:nanobot:other"

        result = await receiver.receive(valid_prompt_data)

        assert result["accepted"] is False
        assert "Target mismatch" in result["reason"]

    @pytest.mark.asyncio
    async def test_receive_invalid_prompt(self, receiver, valid_prompt_data):
        """测试接收无效 Prompt"""
        del valid_prompt_data["id"]

        result = await receiver.receive(valid_prompt_data)

        assert result["accepted"] is False
        assert "reason" in result

    def test_receive_and_plan(self, receiver, valid_prompt_data):
        """测试同步接收并生成计划"""
        result = receiver.receive_and_plan(valid_prompt_data)

        assert result["success"] is True
        assert isinstance(result["prompt"], GenesisPrompt)
        assert isinstance(result["plan"], ExecutionPlan)

    def test_receive_and_plan_wrong_target(self, receiver, valid_prompt_data):
        """测试同步接收错误目标"""
        valid_prompt_data["targetDid"] = "did:anp:nanobot:other"

        result = receiver.receive_and_plan(valid_prompt_data)

        assert result["success"] is False
        assert "error" in result

    def test_register_handler(self, receiver):
        """测试注册处理器"""
        def handler(prompt, plan):
            return "handled"

        receiver.register_handler(GenesisTaskType.GENESIS, handler)

        assert GenesisTaskType.GENESIS in receiver._handlers


class TestFactoryFunctions:
    """测试工厂函数"""

    def test_create_task_receiver(self):
        """测试创建任务接收器"""
        receiver = create_task_receiver("did:anp:nanobot:test")

        assert isinstance(receiver, TaskReceiver)
        assert receiver.nanobot_did == "did:anp:nanobot:test"

    def test_parse_genesis_prompt(self):
        """测试解析 Genesis Prompt"""
        data = {
            "id": "task-1",
            "taskType": "genesis",
            "sourceDid": "did:anp:automaton:main",
            "targetDid": "did:anp:nanobot:worker1",
            "input": {"description": "Test"},
        }

        prompt = parse_genesis_prompt(data)

        assert isinstance(prompt, GenesisPrompt)
        assert prompt.id == "task-1"

    def test_generate_execution_plan(self):
        """测试生成执行计划"""
        prompt = GenesisPrompt(
            version="1.0.0",
            id="task-1",
            task_type=GenesisTaskType.GENESIS,
            priority=GenesisPriority.NORMAL,
            source_did="did:anp:automaton:main",
            target_did="did:anp:nanobot:worker1",
            created_at=datetime.now(),
            input=GenesisInput(description="Test"),
        )

        plan = generate_execution_plan(prompt)

        assert isinstance(plan, ExecutionPlan)
        assert plan.prompt_id == "task-1"


class TestGenesisPrompt:
    """测试 Genesis Prompt"""

    def test_to_dict(self):
        """测试转字典"""
        prompt = GenesisPrompt(
            version="1.0.0",
            id="task-1",
            task_type=GenesisTaskType.GENESIS,
            priority=GenesisPriority.HIGH,
            source_did="did:anp:automaton:main",
            target_did="did:anp:nanobot:worker1",
            created_at=datetime(2024, 1, 1, 0, 0, 0),
            input=GenesisInput(description="Test"),
            tags=["test", "unit"],
        )

        data = prompt.to_dict()

        assert data["id"] == "task-1"
        assert data["taskType"] == "genesis"
        assert data["priority"] == "high"
        assert data["tags"] == ["test", "unit"]
