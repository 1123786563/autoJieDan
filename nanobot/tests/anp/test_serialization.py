"""
ANP 消息序列化测试
验证 Python <-> TypeScript 类型互操作性

@module anp.test_serialization
@version 1.0.0
"""

import json
from datetime import datetime
from typing import Dict, Any

import pytest

from nanobot.anp.types import (
    # DID 相关
    DidDocument,
    DidVerificationMethod,
    DidService,
    AgentCapabilityDescription,
    # ANP 消息
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
    ANP_CONTEXT,
)


def create_test_signature() -> ANPSignature:
    """创建测试用签名"""
    return ANPSignature(
        type="EcdsaSecp256r1Signature2019",
        created=datetime.utcnow(),
        verification_method=f"{AUTOMATON_DID}#key-1",
        proof_purpose=ProofPurpose.AUTHENTICATION,
        proof_value="test_signature_value",
    )


def create_test_message(payload: Dict[str, Any]) -> ANPMessage:
    """创建测试用ANP消息"""
    return ANPMessage(
        context=DEFAULT_CONTEXT,
        message_type="ANPMessage",
        id=f"msg-{int(datetime.now().timestamp())}",
        timestamp=datetime.utcnow(),
        actor=AUTOMATON_DID,
        target=NANOBOT_DID,
        type=ANPMessageType.TASK_CREATE,
        object=payload,
        signature=create_test_signature(),
    )


class TestGenesisPromptSerialization:
    """Genesis Prompt 负载序列化测试"""

    def test_serializes_to_camelcase_format(self):
        """测试序列化为 camelCase 格式（使用别名）"""
        payload = GenesisPromptPayload(
            project_id="project-123",
            platform="upwork",
            requirement_summary="Build a REST API",
            technical_constraints=TechnicalConstraints(
                required_stack=["typescript", "nodejs"],
                prohibited_stack=["java"],
                target_platform="web",
            ),
            contract_terms=ContractTerms(
                total_budget=MonetaryAmount(value=1000, currency="USD"),
                deadline=datetime(2025, 12, 31, 23, 59, 59),
                milestones=[
                    Milestone(
                        name="MVP",
                        percentage=50,
                        due_date=datetime(2025, 11, 30, 23, 59, 59),
                    ),
                ],
            ),
            resource_limits=ResourceLimits(
                max_tokens_per_task=100000,
                max_cost_cents=500,
                max_duration_ms=3600000,
            ),
            special_instructions=SpecialInstructions(
                priority_level="high",
                risk_flags=["deadline-tight"],
                human_review_required=True,
            ),
        )

        # 序列化为 JSON
        json_str = payload.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        # 验证关键字段使用带命名空间的格式
        assert parsed["@type"] == "genesis:GenesisPrompt"
        assert "genesis:projectId" in parsed
        assert parsed["genesis:projectId"] == "project-123"
        assert "genesis:platform" in parsed
        assert parsed["genesis:platform"] == "upwork"
        assert "genesis:requirementSummary" in parsed
        assert parsed["genesis:requirementSummary"] == "Build a REST API"

        # 验证嵌套对象
        assert "genesis:technicalConstraints" in parsed
        assert parsed["genesis:technicalConstraints"]["@type"] == "genesis:TechnicalConstraints"
        assert "genesis:requiredStack" in parsed["genesis:technicalConstraints"]
        assert parsed["genesis:technicalConstraints"]["genesis:requiredStack"] == ["typescript", "nodejs"]

        # 验证预算对象
        assert "genesis:contractTerms" in parsed
        assert "genesis:totalBudget" in parsed["genesis:contractTerms"]
        assert parsed["genesis:contractTerms"]["genesis:totalBudget"]["@type"] == "schema:MonetaryAmount"
        assert "schema:value" in parsed["genesis:contractTerms"]["genesis:totalBudget"]
        assert parsed["genesis:contractTerms"]["genesis:totalBudget"]["schema:value"] == 1000
        assert "schema:currency" in parsed["genesis:contractTerms"]["genesis:totalBudget"]
        assert parsed["genesis:contractTerms"]["genesis:totalBudget"]["schema:currency"] == "USD"

    def test_full_message_serialization(self):
        """测试完整消息的序列化和反序列化"""
        payload = GenesisPromptPayload(
            project_id="project-456",
            platform="freelancer",
            requirement_summary="Mobile app development",
            technical_constraints=TechnicalConstraints(
                required_stack=["react-native", "typescript"],
            ),
            contract_terms=ContractTerms(
                total_budget=MonetaryAmount(value=5000, currency="USD"),
                deadline=datetime(2025, 12, 31, 23, 59, 59),
            ),
            resource_limits=ResourceLimits(
                max_tokens_per_task=200000,
                max_cost_cents=1000,
                max_duration_ms=7200000,
            ),
        )

        message = create_test_message(payload.model_dump(by_alias=True, exclude_none=True))
        json_str = message.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        # 验证消息头
        assert parsed["@context"] == DEFAULT_CONTEXT
        assert parsed["@type"] == "ANPMessage"
        assert parsed["id"] is not None
        assert parsed["timestamp"] is not None
        assert parsed["actor"] == AUTOMATON_DID
        assert parsed["target"] == NANOBOT_DID
        assert parsed["type"] == "TaskCreate"

        # 验证负载
        assert parsed["object"]["@type"] == "genesis:GenesisPrompt"
        assert parsed["object"]["genesis:projectId"] == "project-456"
        assert parsed["object"]["genesis:platform"] == "freelancer"

        # 验证签名
        assert "signature" in parsed
        assert parsed["signature"]["type"] == "EcdsaSecp256r1Signature2019"
        assert "verificationMethod" in parsed["signature"]
        assert "proofPurpose" in parsed["signature"]
        assert "proofValue" in parsed["signature"]

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
        deadline_str = parsed["genesis:contractTerms"]["genesis:deadline"]
        assert deadline_str == "2025-06-15T10:30:00"

        # 验证可以被 datetime.fromisoformat 解析
        parsed_datetime = datetime.fromisoformat(deadline_str)
        assert parsed_datetime == test_date


class TestProgressReportSerialization:
    """进度报告序列化测试"""

    def test_progress_report_serialization(self):
        """测试进度报告序列化"""
        payload = ProgressReportPayload(
            task_id="task-789",
            progress=75,
            current_phase="implementation",
            completed_steps=["setup", "design", "coding"],
            next_steps=["testing", "deployment"],
            eta_seconds=3600,
            blockers=[],
        )

        json_str = payload.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        # 验证字段使用带命名空间的格式
        assert parsed["@type"] == "anp:ProgressReport"
        assert "anp:taskId" in parsed
        assert parsed["anp:taskId"] == "task-789"
        assert "anp:progress" in parsed
        assert parsed["anp:progress"] == 75
        assert "anp:currentPhase" in parsed
        assert parsed["anp:currentPhase"] == "implementation"
        assert "anp:completedSteps" in parsed
        assert parsed["anp:completedSteps"] == ["setup", "design", "coding"]
        assert "anp:nextSteps" in parsed
        assert parsed["anp:nextSteps"] == ["testing", "deployment"]
        assert "anp:etaSeconds" in parsed
        assert parsed["anp:etaSeconds"] == 3600
        assert "anp:blockers" in parsed
        assert parsed["anp:blockers"] == []


class TestProtocolNegotiationSerialization:
    """协议协商序列化测试"""

    def test_protocol_negotiate_serialization(self):
        """测试协议协商请求序列化"""
        payload = ProtocolNegotiatePayload(
            proposed_protocol="ANP",
            protocol_version="1.0.0",
            capabilities=["encryption", "compression"],
            constraints=ProtocolConstraints(
                max_latency=1000,
                encryption_required=True,
                compression="gzip",
            ),
        )

        json_str = payload.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        # 验证协议协商字段
        assert parsed["@type"] == "anp:ProtocolNegotiation"
        assert "anp:proposedProtocol" in parsed
        assert parsed["anp:proposedProtocol"] == "ANP"
        assert "anp:protocolVersion" in parsed
        assert parsed["anp:protocolVersion"] == "1.0.0"
        assert "anp:capabilities" in parsed
        assert parsed["anp:capabilities"] == ["encryption", "compression"]
        assert "anp:constraints" in parsed
        assert "anp:maxLatency" in parsed["anp:constraints"]
        assert parsed["anp:constraints"]["anp:maxLatency"] == 1000
        assert "anp:encryptionRequired" in parsed["anp:constraints"]
        assert parsed["anp:constraints"]["anp:encryptionRequired"] is True
        assert "anp:compression" in parsed["anp:constraints"]
        assert parsed["anp:constraints"]["anp:compression"] == "gzip"


class TestJSONLDContextValidation:
    """JSON-LD 上下文验证"""

    def test_all_messages_contain_correct_context(self):
        """测试所有消息包含正确的 @context"""
        payload = GenesisPromptPayload(
            project_id="test",
            platform="test",
            requirement_summary="test",
            technical_constraints=TechnicalConstraints(),
            contract_terms=ContractTerms(
                total_budget=MonetaryAmount(value=100, currency="USD"),
                deadline=datetime(2025, 12, 31, 23, 59, 59),
            ),
            resource_limits=ResourceLimits(
                max_tokens_per_task=1000,
                max_cost_cents=100,
                max_duration_ms=1000,
            ),
        )

        message = create_test_message(payload.model_dump(by_alias=True, exclude_none=True))

        # 验证 @context 是数组且包含必需的上下文
        assert isinstance(message.context, list)
        assert "https://www.w3.org/ns/activitystreams/v1" in message.context
        assert "https://w3id.org/anp/v1" in message.context
        assert "https://w3id.org/security/v1" in message.context

    def test_all_payloads_contain_type_field(self):
        """测试所有负载包含 @type 字段"""
        payloads = [
            GenesisPromptPayload(
                project_id="test",
                platform="test",
                requirement_summary="test",
                technical_constraints=TechnicalConstraints(),
                contract_terms=ContractTerms(
                    total_budget=MonetaryAmount(value=100, currency="USD"),
                    deadline=datetime(2025, 12, 31, 23, 59, 59),
                ),
                resource_limits=ResourceLimits(
                    max_tokens_per_task=1000,
                    max_cost_cents=100,
                    max_duration_ms=1000,
                ),
            ),
            ProgressReportPayload(
                task_id="test",
                progress=50,
                current_phase="test",
                completed_steps=[],
                next_steps=[],
                blockers=[],
            ),
            ProtocolNegotiatePayload(
                proposed_protocol="ANP",
                protocol_version="1.0.0",
                capabilities=[],
                constraints=ProtocolConstraints(encryption_required=True),
            ),
        ]

        for payload in payloads:
            assert hasattr(payload, "type")
            assert payload.type is not None


class TestTypeInteroperability:
    """类型互操作性验证"""

    def test_generates_python_parsable_json(self):
        """测试生成 Python 可解析的 JSON 格式"""
        payload = GenesisPromptPayload(
            project_id="interop-test-123",
            platform="upwork",
            requirement_summary="Test serialization",
            technical_constraints=TechnicalConstraints(
                required_stack=["python", "fastapi"],
                prohibited_stack=[],
            ),
            contract_terms=ContractTerms(
                total_budget=MonetaryAmount(value=2000, currency="USD"),
                deadline=datetime(2025, 12, 31, 23, 59, 59),
                milestones=[],
            ),
            resource_limits=ResourceLimits(
                max_tokens_per_task=150000,
                max_cost_cents=750,
                max_duration_ms=5400000,
            ),
        )

        message = create_test_message(payload.model_dump(by_alias=True, exclude_none=True))
        json_str = message.model_dump_json(by_alias=True, exclude_none=True)

        # 验证 JSON 可以被正确解析
        parsed = json.loads(json_str)
        assert parsed is not None

        # 验证关键字段存在
        assert "@context" in parsed
        assert "@type" in parsed
        assert "id" in parsed
        assert "timestamp" in parsed
        assert "actor" in parsed
        assert "target" in parsed
        assert "type" in parsed
        assert "object" in parsed
        assert "signature" in parsed

        # 验证时间戳格式 (ISO 8601)
        assert "T" in parsed["timestamp"]

        # 验证负载格式与 TypeScript 接口兼容
        assert "@type" in parsed["object"]
        assert "genesis:projectId" in parsed["object"]
        assert "genesis:platform" in parsed["object"]
        assert "genesis:requirementSummary" in parsed["object"]
        assert "genesis:technicalConstraints" in parsed["object"]
        assert "genesis:contractTerms" in parsed["object"]
        assert "genesis:resourceLimits" in parsed["object"]

    def test_round_trip_serialization(self):
        """测试往返序列化一致性"""
        payload = GenesisPromptPayload(
            project_id="round-trip-test",
            platform="test",
            requirement_summary="Test round trip",
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
        )

        # 第一次序列化
        json1 = payload.model_dump_json(by_alias=True, exclude_none=True)
        parsed1 = json.loads(json1)

        # 第二次序列化（从第一次解析的结果）
        payload2 = GenesisPromptPayload(**parsed1)
        json2 = payload2.model_dump_json(by_alias=True, exclude_none=True)
        parsed2 = json.loads(json2)

        # 第三次序列化
        payload3 = GenesisPromptPayload(**parsed2)
        json3 = payload3.model_dump_json(by_alias=True, exclude_none=True)
        parsed3 = json.loads(json3)

        # 验证三次序列化结果一致
        assert parsed1 == parsed2
        assert parsed2 == parsed3


class TestFieldNamingConsistency:
    """字段命名一致性测试"""

    def test_genesis_fields_use_namespace_prefix(self):
        """测试 Genesis 字段使用命名空间前缀"""
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
            assert field in parsed, f"Missing field: {field}"

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

    def test_anp_fields_use_namespace_prefix(self):
        """测试 ANP 字段使用命名空间前缀"""
        payload = ProgressReportPayload(
            task_id="test",
            progress=50,
            current_phase="test",
            completed_steps=["step1"],
            next_steps=["step2"],
            eta_seconds=3600,
            blockers=["blocker1"],
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
            assert field in parsed, f"Missing field: {field}"

    def test_schema_fields_use_namespace_prefix(self):
        """测试 Schema 字段使用命名空间前缀"""
        amount = MonetaryAmount(value=1000, currency="USD")
        json_str = amount.model_dump_json(by_alias=True, exclude_none=True)
        parsed = json.loads(json_str)

        # 验证 Schema 字段使用 schema: 前缀
        assert "@type" in parsed
        assert parsed["@type"] == "schema:MonetaryAmount"
        assert "schema:value" in parsed
        assert "schema:currency" in parsed
