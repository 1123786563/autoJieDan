"""
Genesis Prompt ANP 接收器测试
"""

import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from nanobot.interagent.genesis.genesis_prompt_receiver import (
    GenesisPromptReceiver,
    GenesisPromptReceiverConfig,
    ReceiveResult,
    create_genesis_prompt_receiver,
)


class TestGenesisPromptReceiverConfig:
    """测试接收器配置"""

    def test_valid_config(self):
        """测试有效配置"""
        config = GenesisPromptReceiverConfig(
            nanobot_did="did:anp:nanobot:worker1",
            private_key_pem="mock-key",
            service_endpoint="http://localhost:8080/anp",
        )

        assert config.nanobot_did == "did:anp:nanobot:worker1"
        assert config.private_key_pem == "mock-key"
        assert config.service_endpoint == "http://localhost:8080/anp"
        assert config.automaton_did == "did:anp:automaton:main"
        assert config.timeout_seconds == 30
        assert config.verify_signature is True

    def test_config_with_custom_automaton_did(self):
        """测试自定义 Automaton DID"""
        config = GenesisPromptReceiverConfig(
            nanobot_did="did:anp:nanobot:worker1",
            private_key_pem="mock-key",
            service_endpoint="http://localhost:8080/anp",
            automaton_did="did:anp:automaton:custom",
        )

        assert config.automaton_did == "did:anp:automaton:custom"


class TestGenesisPromptReceiver:
    """测试 Genesis Prompt 接收器"""

    @pytest.fixture
    def config(self):
        """测试配置"""
        return GenesisPromptReceiverConfig(
            nanobot_did="did:anp:nanobot:worker1",
            private_key_pem="mock-private-key",
            service_endpoint="http://localhost:8080/anp",
            verify_signature=False,  # 禁用签名验证以简化测试
        )

    @pytest.fixture
    def receiver(self, config):
        """接收器实例"""
        return GenesisPromptReceiver(config)

    @pytest.fixture
    def valid_anp_message(self):
        """有效的 ANP 消息"""
        return {
            "@context": [
                "https://www.w3.org/ns/activitystreams/v1",
                "https://w3id.org/anp/v1",
                "https://w3id.org/security/v1",
            ],
            "@type": "ANPMessage",
            "id": "msg-001",
            "timestamp": "2026-02-27T00:00:00.000Z",
            "actor": "did:anp:automaton:main",
            "target": "did:anp:nanobot:worker1",
            "type": "TaskCreate",
            "object": {
                "@type": "genesis:GenesisPrompt",
                "genesis:projectId": "task-001",
                "genesis:platform": "anp",
                "genesis:requirementSummary": "Create a new feature",
                "genesis:technicalConstraints": {
                    "@type": "genesis:TechnicalConstraints",
                    "genesis:requiredStack": ["typescript", "python"],
                    "genesis:prohibitedStack": ["jquery"],
                },
                "genesis:contractTerms": {
                    "@type": "genesis:ContractTerms",
                    "genesis:totalBudget": {
                        "@type": "schema:MonetaryAmount",
                        "schema:value": 1000,
                        "schema:currency": "USD",
                    },
                    "genesis:deadline": "2026-03-01T00:00:00.000Z",
                    "genesis:milestones": [],
                },
                "genesis:resourceLimits": {
                    "@type": "genesis:ResourceLimits",
                    "genesis:maxTokensPerTask": 1000000,
                    "genesis:maxCostCents": 15000,
                    "genesis:maxDurationMs": 86400000,
                },
            },
            "signature": {
                "type": "EcdsaSecp256r1Signature2019",
                "created": "2026-02-27T00:00:00.000Z",
                "verificationMethod": "did:anp:automaton:main#key-1",
                "proofPurpose": "authentication",
                "proofValue": "mock-signature",
            },
            "correlationId": "task-001",
            "ttl": 3600,
        }

    @pytest.mark.asyncio
    async def test_receive_valid_message(self, receiver, valid_anp_message):
        """测试接收有效消息"""
        result = await receiver.receive_anp_message(valid_anp_message)

        assert result.success is True
        assert result.prompt_id == "task-001"
        assert result.message == "任务已接受"
        assert result.response_data is not None
        assert result.execution_plan is not None
        assert result.response_data["status"] == "accepted"
        assert result.response_data["promptId"] == "task-001"

    @pytest.mark.asyncio
    async def test_receive_invalid_actor(self, receiver, valid_anp_message):
        """测试无效的发送方 DID"""
        valid_anp_message["actor"] = "did:anp:attacker:malicious"

        result = await receiver.receive_anp_message(valid_anp_message)

        assert result.success is False
        assert "无效的来源 DID" in result.message

    @pytest.mark.asyncio
    async def test_receive_wrong_target(self, receiver, valid_anp_message):
        """测试错误的目标 DID"""
        valid_anp_message["target"] = "did:anp:nanobot:other"

        result = await receiver.receive_anp_message(valid_anp_message)

        assert result.success is False
        assert "目标 DID 不匹配" in result.message
        assert result.error == "Target DID mismatch"

    @pytest.mark.asyncio
    async def test_convert_to_genesis_prompt(self, receiver, valid_anp_message):
        """测试转换为 Genesis Prompt"""
        from nanobot.anp.types import ANPMessage

        anp_message = ANPMessage(**valid_anp_message)
        genesis_prompt = receiver._convert_to_genesis_prompt(anp_message)

        assert genesis_prompt.id == "task-001"
        assert genesis_prompt.source_did == "did:anp:automaton:main"
        assert genesis_prompt.target_did == "did:anp:nanobot:worker1"
        assert genesis_prompt.input.description == "Create a new feature"

    @pytest.mark.asyncio
    async def test_convert_technical_constraints(self, receiver):
        """测试转换技术约束"""
        constraints = {
            "requiredStack": ["typescript", "python"],
            "prohibitedStack": ["jquery"],
        }

        result = receiver._convert_technical_constraints(constraints)

        assert result is not None
        assert result.allowed_languages == ["typescript", "python"]
        assert result.forbidden_libraries == ["jquery"]

    @pytest.mark.asyncio
    async def test_convert_business_terms(self, receiver):
        """测试转换商务条款"""
        terms = {
            "totalBudget": {
                "value": 1000,
                "currency": "USD",
            },
            "deadline": "2026-03-01T00:00:00.000Z",
        }

        result = receiver._convert_business_terms(terms)

        assert result is not None
        assert result.budget["total"] == 1000
        assert result.budget["currency"] == "USD"
        assert result.timeline["deadline"] == "2026-03-01T00:00:00.000Z"

    def test_map_priority_from_anp(self, receiver):
        """测试映射优先级"""
        from nanobot.interagent.genesis_prompt import GenesisPriority

        assert receiver._map_priority_from_anp("high") == GenesisPriority.HIGH
        assert receiver._map_priority_from_anp("normal") == GenesisPriority.NORMAL
        assert receiver._map_priority_from_anp("low") == GenesisPriority.LOW
        assert receiver._map_priority_from_anp("unknown") == GenesisPriority.NORMAL

    def test_build_acceptance_response(self, receiver):
        """测试构建接受响应"""
        from nanobot.interagent.genesis_prompt import ExecutionPlan

        plan = MagicMock(spec=ExecutionPlan)
        plan.estimated_total_duration_ms = 3600000
        plan.prompt_id = "task-001"

        response = receiver._build_acceptance_response("msg-001", "task-001", plan)

        assert response["status"] == "accepted"
        assert response["promptId"] == "task-001"
        assert response["correlationId"] == "msg-001"
        assert "acceptance" in response
        assert "estimatedStartTime" in response["acceptance"]
        assert "estimatedCompletionTime" in response["acceptance"]

    def test_build_rejection_response(self, receiver):
        """测试构建拒绝响应"""
        response = receiver._build_rejection_response("msg-001", "Not enough resources")

        assert response["status"] == "rejected"
        assert response["correlationId"] == "msg-001"
        assert "rejection" in response
        assert response["rejection"]["reason"] == "Not enough resources"

    def test_build_rejection_response_with_code(self, receiver):
        """测试构建带错误代码的拒绝响应"""
        response = receiver._build_rejection_response(
            "msg-001",
            "Invalid task",
            "INVALID_TASK"
        )

        assert response["status"] == "rejected"
        assert response["rejection"]["code"] == "INVALID_TASK"

    @pytest.mark.asyncio
    async def test_handle_http_request_success(self, receiver, valid_anp_message):
        """测试处理 HTTP 请求成功"""
        response = await receiver.handle_http_request(valid_anp_message)

        assert response["status"] == "accepted"
        assert response["promptId"] == "task-001"

    @pytest.mark.asyncio
    async def test_handle_http_request_failure(self, receiver, valid_anp_message):
        """测试处理 HTTP 请求失败"""
        valid_anp_message["actor"] = "did:anp:attacker:malicious"

        response = await receiver.handle_http_request(valid_anp_message)

        assert response["status"] == "rejected"
        assert "rejection" in response

    def test_get_stats(self, receiver):
        """测试获取统计信息"""
        stats = receiver.get_stats()

        assert "received_count" in stats
        assert "accepted_count" in stats
        assert "rejected_count" in stats
        assert "error_count" in stats

    @pytest.mark.asyncio
    async def test_shutdown(self, receiver):
        """测试关闭接收器"""
        await receiver.shutdown()
        # 应该没有错误


class TestCreateGenesisPromptReceiver:
    """测试工厂函数"""

    def test_create_receiver(self):
        """测试创建接收器"""
        receiver = create_genesis_prompt_receiver(
            nanobot_did="did:anp:nanobot:worker1",
            private_key_pem="mock-key",
            service_endpoint="http://localhost:8080/anp",
        )

        assert isinstance(receiver, GenesisPromptReceiver)
        assert receiver.config.nanobot_did == "did:anp:nanobot:worker1"

    def test_create_receiver_with_custom_automaton_did(self):
        """测试创建自定义 Automaton DID 的接收器"""
        receiver = create_genesis_prompt_receiver(
            nanobot_did="did:anp:nanobot:worker1",
            private_key_pem="mock-key",
            service_endpoint="http://localhost:8080/anp",
            automaton_did="did:anp:automaton:custom",
        )

        assert isinstance(receiver, GenesisPromptReceiver)
        assert receiver.config.automaton_did == "did:anp:automaton:custom"


class TestReceiveResult:
    """测试接收结果模型"""

    def test_success_result(self):
        """测试成功结果"""
        result = ReceiveResult(
            success=True,
            prompt_id="task-001",
            message="任务已接受",
            response_data={"status": "accepted"},
        )

        assert result.success is True
        assert result.prompt_id == "task-001"
        assert result.message == "任务已接受"
        assert result.response_data is not None
        assert result.error is None

    def test_failure_result(self):
        """测试失败结果"""
        result = ReceiveResult(
            success=False,
            prompt_id="",
            message="处理失败",
            error="Invalid message",
        )

        assert result.success is False
        assert result.message == "处理失败"
        assert result.error == "Invalid message"
