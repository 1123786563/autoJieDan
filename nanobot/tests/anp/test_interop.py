"""
TypeScript <-> Python 类型互操作性测试
验证双向序列化/反序列化一致性

@module anp.test_interop
@version 1.0.0
"""

import json
from datetime import datetime

import pytest

from nanobot.anp.types import (
    # DID 相关
    DidDocument,
    DidVerificationMethod,
    DidService,
    # 消息类型
    ANPMessage,
    ANPMessageType,
    ANPSignature,
    ProofPurpose,
    # 负载类型
    GenesisPromptPayload,
    TechnicalConstraints,
    Milestone,
    MonetaryAmount,
    ContractTerms,
    ResourceLimits,
    SpecialInstructions,
    ProgressReportPayload,
    ErrorReportPayload,
    ProtocolNegotiatePayload,
    ProtocolConstraints,
    ProtocolAcceptPayload,
    ProtocolRejectPayload,
    # 常量
    DEFAULT_CONTEXT,
    AUTOMATON_DID,
    NANOBOT_DID,
    GENESIS_PROMPT_PROTOCOL,
)


class TestGenesisPromptInteroperability:
    """Genesis Prompt 互操作性测试"""

    def create_genesis_payload(self) -> GenesisPromptPayload:
        """创建测试用 Genesis Prompt 负载"""
        return GenesisPromptPayload(
            project_id="interop-test-project",
            platform="upwork",
            requirement_summary="Test TypeScript/Python interoperability",
            technical_constraints=TechnicalConstraints(
                required_stack=["typescript", "python"],
                prohibited_stack=["java"],
                target_platform="linux",
            ),
            contract_terms=ContractTerms(
                total_budget=MonetaryAmount(value=5000, currency="USD"),
                deadline=datetime(2025, 12, 31, 23, 59, 59),
                milestones=[
                    Milestone(
                        name="Phase 1",
                        percentage=30,
                        due_date=datetime(2025, 11, 15, 23, 59, 59),
                    ),
                    Milestone(
                        name="Phase 2",
                        percentage=70,
                        due_date=datetime(2025, 12, 15, 23, 59, 59),
                    ),
                ],
            ),
            resource_limits=ResourceLimits(
                max_tokens_per_task=200000,
                max_cost_cents=1000,
                max_duration_ms=7200000,
            ),
            special_instructions=SpecialInstructions(
                priority_level="high",
                risk_flags=["deadline-tight", "complex-integration"],
                human_review_required=True,
            ),
        )

    def test_serializes_to_typescript_compatible_format(self):
        """测试序列化为 TypeScript 兼容格式"""
        payload = self.create_genesis_payload()

        # 序列化为 JSON（使用别名）
        json_str = payload.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        # 验证关键字段使用带命名空间的格式
        assert parsed["@type"] == "genesis:GenesisPrompt"
        assert "genesis:projectId" in parsed
        assert parsed["genesis:projectId"] == "interop-test-project"
        assert "genesis:platform" in parsed
        assert parsed["genesis:platform"] == "upwork"
        assert "genesis:requirementSummary" in parsed
        assert parsed["genesis:requirementSummary"] == "Test TypeScript/Python interoperability"

        # 验证嵌套对象
        assert "genesis:technicalConstraints" in parsed
        assert parsed["genesis:technicalConstraints"]["@type"] == "genesis:TechnicalConstraints"
        assert parsed["genesis:technicalConstraints"]["genesis:requiredStack"] == [
            "typescript",
            "python",
        ]
        assert parsed["genesis:technicalConstraints"]["genesis:prohibitedStack"] == ["java"]

        # 验证预算对象
        assert "genesis:contractTerms" in parsed
        assert parsed["genesis:contractTerms"]["@type"] == "genesis:ContractTerms"
        assert "genesis:totalBudget" in parsed["genesis:contractTerms"]
        assert parsed["genesis:contractTerms"]["genesis:totalBudget"]["@type"] == "schema:MonetaryAmount"
        assert parsed["genesis:contractTerms"]["genesis:totalBudget"]["schema:value"] == 5000
        assert parsed["genesis:contractTerms"]["genesis:totalBudget"]["schema:currency"] == "USD"

        # 验证里程碑
        assert "genesis:milestones" in parsed["genesis:contractTerms"]
        milestones = parsed["genesis:contractTerms"]["genesis:milestones"]
        assert len(milestones) == 2
        assert milestones[0]["genesis:name"] == "Phase 1"
        assert milestones[0]["genesis:percentage"] == 30

        # 验证资源限制
        assert "genesis:resourceLimits" in parsed
        assert parsed["genesis:resourceLimits"]["@type"] == "genesis:ResourceLimits"
        assert parsed["genesis:resourceLimits"]["genesis:maxTokensPerTask"] == 200000

        # 验证特殊指示
        assert "genesis:specialInstructions" in parsed
        assert parsed["genesis:specialInstructions"]["@type"] == "genesis:SpecialInstructions"
        assert parsed["genesis:specialInstructions"]["genesis:priorityLevel"] == "high"
        assert parsed["genesis:specialInstructions"]["genesis:riskFlags"] == [
            "deadline-tight",
            "complex-integration",
        ]

    def test_round_trip_serialization(self):
        """测试往返序列化一致性"""
        original_payload = self.create_genesis_payload()

        # 第一次序列化
        json1 = original_payload.model_dump_json(by_alias=True, exclude_none=True)
        parsed1 = json.loads(json1)

        # 第二次序列化（从第一次解析的结果）
        payload2 = GenesisPromptPayload(**parsed1)
        json2 = payload2.model_dump_json(by_alias=True, exclude_none=True)
        parsed2 = json.loads(json2)

        # 验证三次序列化结果一致
        assert parsed1 == parsed2

        # 验证所有关键字段保持不变
        assert parsed2["genesis:projectId"] == original_payload.project_id
        assert parsed2["genesis:platform"] == original_payload.platform
        assert parsed2["genesis:technicalConstraints"]["genesis:requiredStack"] == (
            original_payload.technical_constraints.required_stack
        )
        assert (
            parsed2["genesis:contractTerms"]["genesis:totalBudget"]["schema:value"]
            == original_payload.contract_terms.total_budget.value
        )

    def test_datetime_serialization(self):
        """测试日期时间序列化"""
        test_date = datetime(2025, 6, 15, 10, 30, 0)
        payload = GenesisPromptPayload(
            project_id="date-test",
            platform="test",
            requirement_summary="Test date serialization",
            technical_constraints=TechnicalConstraints(),
            contract_terms=ContractTerms(
                total_budget=MonetaryAmount(value=1000, currency="USD"),
                deadline=test_date,
                milestones=[],
            ),
            resource_limits=ResourceLimits(
                max_tokens_per_task=1000,
                max_cost_cents=100,
                max_duration_ms=1000,
            ),
        )

        json_str = payload.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        # 验证日期时间格式（ISO 8601）
        deadline = parsed["genesis:contractTerms"]["genesis:deadline"]
        assert deadline == "2025-06-15T10:30:00"

        # Python datetime.fromisoformat() 应该能够解析
        parsed_datetime = datetime.fromisoformat(deadline)
        assert parsed_datetime == test_date


class TestProgressReportInteroperability:
    """Progress Report 互操作性测试"""

    def create_progress_payload(self) -> ProgressReportPayload:
        """创建测试用 Progress Report 负载"""
        return ProgressReportPayload(
            task_id="interop-task-123",
            progress=65,
            current_phase="integration-testing",
            completed_steps=[
                "typescript-setup",
                "python-setup",
                "serialization-validation",
            ],
            next_steps=["bidirectional-testing", "documentation"],
            eta_seconds=7200,
            blockers=["cross-platform-timezone-handling"],
        )

    def test_serializes_to_typescript_compatible_format(self):
        """测试序列化为 TypeScript 兼容格式"""
        payload = self.create_progress_payload()

        json_str = payload.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        # 验证字段使用带命名空间的格式
        assert parsed["@type"] == "anp:ProgressReport"
        assert "anp:taskId" in parsed
        assert parsed["anp:taskId"] == "interop-task-123"
        assert "anp:progress" in parsed
        assert parsed["anp:progress"] == 65
        assert "anp:currentPhase" in parsed
        assert parsed["anp:currentPhase"] == "integration-testing"
        assert "anp:completedSteps" in parsed
        assert parsed["anp:completedSteps"] == [
            "typescript-setup",
            "python-setup",
            "serialization-validation",
        ]
        assert "anp:nextSteps" in parsed
        assert parsed["anp:nextSteps"] == ["bidirectional-testing", "documentation"]
        assert "anp:etaSeconds" in parsed
        assert parsed["anp:etaSeconds"] == 7200
        assert "anp:blockers" in parsed
        assert parsed["anp:blockers"] == ["cross-platform-timezone-handling"]

    def test_round_trip_serialization(self):
        """测试往返序列化一致性"""
        original_payload = self.create_progress_payload()

        json_str = original_payload.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        # 验证所有字段保持不变
        assert parsed["anp:taskId"] == original_payload.task_id
        assert parsed["anp:progress"] == original_payload.progress
        assert parsed["anp:currentPhase"] == original_payload.current_phase
        assert parsed["anp:completedSteps"] == original_payload.completed_steps
        assert parsed["anp:nextSteps"] == original_payload.next_steps
        assert parsed["anp:etaSeconds"] == original_payload.eta_seconds
        assert parsed["anp:blockers"] == original_payload.blockers


class TestProtocolNegotiationInteroperability:
    """Protocol Negotiation 互操作性测试"""

    def create_protocol_negotiate_payload(self) -> ProtocolNegotiatePayload:
        """创建测试用 Protocol Negotiate 负载"""
        return ProtocolNegotiatePayload(
            proposed_protocol="ANP",
            protocol_version="1.0.0",
            capabilities=["encryption", "compression", "streaming"],
            constraints=ProtocolConstraints(
                max_latency=500,
                encryption_required=True,
                compression="gzip",
            ),
        )

    def test_serializes_to_typescript_compatible_format(self):
        """测试序列化为 TypeScript 兼容格式"""
        payload = self.create_protocol_negotiate_payload()

        json_str = payload.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        # 验证字段使用带命名空间的格式
        assert parsed["@type"] == "anp:ProtocolNegotiation"
        assert "anp:proposedProtocol" in parsed
        assert parsed["anp:proposedProtocol"] == "ANP"
        assert "anp:protocolVersion" in parsed
        assert parsed["anp:protocolVersion"] == "1.0.0"
        assert "anp:capabilities" in parsed
        assert parsed["anp:capabilities"] == ["encryption", "compression", "streaming"]
        assert "anp:constraints" in parsed
        assert "anp:maxLatency" in parsed["anp:constraints"]
        assert parsed["anp:constraints"]["anp:maxLatency"] == 500
        assert "anp:encryptionRequired" in parsed["anp:constraints"]
        assert parsed["anp:constraints"]["anp:encryptionRequired"] is True
        assert "anp:compression" in parsed["anp:constraints"]
        assert parsed["anp:constraints"]["anp:compression"] == "gzip"


class TestDataTypeConsistency:
    """数据类型一致性测试"""

    def test_string_type_serialization(self):
        """测试字符串类型序列化"""
        payload = ProgressReportPayload(
            task_id="test-with-unicode-🚀",
            progress=50,
            current_phase="测试中文",
            completed_steps=[],
            next_steps=[],
            blockers=[],
        )

        json_str = payload.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        assert parsed["anp:taskId"] == "test-with-unicode-🚀"
        assert parsed["anp:currentPhase"] == "测试中文"

    def test_numeric_type_serialization(self):
        """测试数字类型序列化"""
        payload = GenesisPromptPayload(
            project_id="test",
            platform="test",
            requirement_summary="test",
            technical_constraints=TechnicalConstraints(),
            contract_terms=ContractTerms(
                total_budget=MonetaryAmount(value=5000, currency="USD"),
                deadline=datetime(2025, 12, 31, 23, 59, 59),
                milestones=[
                    Milestone(
                        name="M1",
                        percentage=30,
                        due_date=datetime(2025, 11, 15, 23, 59, 59),
                    ),
                    Milestone(
                        name="M2",
                        percentage=70,
                        due_date=datetime(2025, 12, 15, 23, 59, 59),
                    ),
                ],
            ),
            resource_limits=ResourceLimits(
                max_tokens_per_task=200000,
                max_cost_cents=1000,
                max_duration_ms=7200000,
            ),
        )

        json_str = payload.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        # 验证数字类型
        assert isinstance(parsed["genesis:contractTerms"]["genesis:totalBudget"]["schema:value"], int)
        assert parsed["genesis:contractTerms"]["genesis:totalBudget"]["schema:value"] == 5000

        # 验证里程碑百分比
        milestones = parsed["genesis:contractTerms"]["genesis:milestones"]
        for milestone in milestones:
            assert isinstance(milestone["genesis:percentage"], int)

    def test_array_type_serialization(self):
        """测试数组类型序列化"""
        payload = ProgressReportPayload(
            task_id="test",
            progress=50,
            current_phase="test",
            completed_steps=["step1", "step2", "step3"],
            next_steps=["step4", "step5"],
            blockers=["blocker1"],
        )

        json_str = payload.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        assert isinstance(parsed["anp:completedSteps"], list)
        assert isinstance(parsed["anp:nextSteps"], list)
        assert isinstance(parsed["anp:blockers"], list)

        assert len(parsed["anp:completedSteps"]) == 3
        assert len(parsed["anp:nextSteps"]) == 2
        assert len(parsed["anp:blockers"]) == 1

    def test_boolean_type_serialization(self):
        """测试布尔类型序列化"""
        payload = GenesisPromptPayload(
            project_id="test",
            platform="test",
            requirement_summary="test",
            technical_constraints=TechnicalConstraints(),
            contract_terms=ContractTerms(
                total_budget=MonetaryAmount(value=1000, currency="USD"),
                deadline=datetime(2025, 12, 31, 23, 59, 59),
            ),
            resource_limits=ResourceLimits(
                max_tokens_per_task=1000,
                max_cost_cents=100,
                max_duration_ms=1000,
            ),
            special_instructions=SpecialInstructions(
                priority_level="high",
                risk_flags=[],
                human_review_required=True,
            ),
        )

        json_str = payload.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        # 验证布尔类型
        assert isinstance(parsed["genesis:specialInstructions"]["genesis:humanReviewRequired"], bool)
        assert parsed["genesis:specialInstructions"]["genesis:humanReviewRequired"] is True

        # 验证货币值不是布尔类型
        assert not isinstance(
            parsed["genesis:contractTerms"]["genesis:totalBudget"]["schema:value"], bool
        )


class TestNamespaceConsistency:
    """命名空间一致性测试"""

    def test_genesis_namespace_prefix(self):
        """测试 Genesis 字段使用 genesis: 命名空间"""
        payload = GenesisPromptPayload(
            project_id="test",
            platform="test",
            requirement_summary="test",
            technical_constraints=TechnicalConstraints(
                required_stack=["ts"],
                prohibited_stack=[],
                target_platform="web",
            ),
            contract_terms=ContractTerms(
                total_budget=MonetaryAmount(value=100, currency="USD"),
                deadline=datetime(2025, 12, 31, 23, 59, 59),
                milestones=[
                    Milestone(
                        name="milestone1",
                        percentage=50,
                        due_date=datetime(2025, 11, 30, 23, 59, 59),
                    ),
                ],
            ),
            resource_limits=ResourceLimits(
                max_tokens_per_task=1000,
                max_cost_cents=100,
                max_duration_ms=1000,
            ),
            special_instructions=SpecialInstructions(
                priority_level="high",
                risk_flags=["flag1"],
                human_review_required=False,
            ),
        )

        json_str = payload.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        # 验证所有 Genesis 字段使用 genesis: 前缀
        genesis_fields = [
            "genesis:projectId",
            "genesis:platform",
            "genesis:requirementSummary",
            "genesis:technicalConstraints",
            "genesis:contractTerms",
            "genesis:resourceLimits",
            "genesis:specialInstructions",
        ]

        for field in genesis_fields:
            assert field in parsed

        # 验证嵌套的 Genesis 字段
        tc = parsed["genesis:technicalConstraints"]
        assert "genesis:requiredStack" in tc
        assert "genesis:prohibitedStack" in tc
        assert "genesis:targetPlatform" in tc

        ct = parsed["genesis:contractTerms"]
        assert "genesis:totalBudget" in ct
        assert "genesis:deadline" in ct
        assert "genesis:milestones" in ct

        rl = parsed["genesis:resourceLimits"]
        assert "genesis:maxTokensPerTask" in rl
        assert "genesis:maxCostCents" in rl
        assert "genesis:maxDurationMs" in rl

        si = parsed["genesis:specialInstructions"]
        assert "genesis:priorityLevel" in si
        assert "genesis:riskFlags" in si
        assert "genesis:humanReviewRequired" in si

    def test_anp_namespace_prefix(self):
        """测试 ANP 字段使用 anp: 命名空间"""
        payload = ProgressReportPayload(
            task_id="test",
            progress=50,
            current_phase="test",
            completed_steps=["step1"],
            next_steps=["step2"],
            eta_seconds=3600,
            blockers=[],
        )

        json_str = payload.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        # 验证所有 ANP 字段使用 anp: 前缀
        anp_fields = [
            "anp:taskId",
            "anp:progress",
            "anp:currentPhase",
            "anp:completedSteps",
            "anp:nextSteps",
            "anp:etaSeconds",
            "anp:blockers",
        ]

        for field in anp_fields:
            assert field in parsed

    def test_schema_namespace_prefix(self):
        """测试 Schema 字段使用 schema: 命名空间"""
        amount = MonetaryAmount(value=1000, currency="USD")

        json_str = amount.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        # 验证 Schema 字段使用 schema: 前缀
        assert "@type" in parsed
        assert parsed["@type"] == "schema:MonetaryAmount"
        assert "schema:value" in parsed
        assert "schema:currency" in parsed
