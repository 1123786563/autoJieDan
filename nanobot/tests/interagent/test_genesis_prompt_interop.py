"""
Genesis Prompt 类型互操作性测试
验证 TypeScript 和 Python 端的 JSON 序列化一致性
"""

import pytest
import json
from datetime import datetime
from nanobot.interagent.genesis_prompt import (
    GenesisPrompt,
    GenesisTaskType,
    GenesisPriority,
    GenesisInput,
    GenesisPromptParser,
)


class TestGenesisPromptInteroperability:
    """测试 Genesis Prompt 的跨系统互操作性"""

    def test_to_dict_uses_camelCase(self):
        """验证 to_dict 方法使用 camelCase 格式"""
        prompt = GenesisPrompt(
            version="1.0.0",
            id="test-prompt-001",
            task_type=GenesisTaskType.GENESIS,
            priority=GenesisPriority.NORMAL,
            source_did="did:anp:automaton:main",
            target_did="did:anp:nanobot:main",
            created_at=datetime.utcnow(),
            input=GenesisInput(
                description="测试任务",
            ),
            require_confirmation=False,
            timeout_ms=30000,
            tags=["test", "interop"],
        )

        result = prompt.to_dict()

        # 验证使用 camelCase
        assert "taskType" in result
        assert "sourceDid" in result
        assert "targetDid" in result
        assert "createdAt" in result
        assert "requireConfirmation" in result
        assert "timeoutMs" in result

        # 验证不使用 snake_case
        assert "task_type" not in result
        assert "source_did" not in result
        assert "target_did" not in result
        assert "created_at" not in result
        assert "require_confirmation" not in result
        assert "timeout_ms" not in result

    def test_serialization_consistency(self):
        """验证序列化后的一致性"""
        prompt = GenesisPrompt(
            version="1.0.0",
            id="test-prompt-002",
            task_type=GenesisTaskType.ANALYSIS,
            priority=GenesisPriority.HIGH,
            source_did="did:anp:automaton:main",
            target_did="did:anp:nanobot:main",
            created_at=datetime(2026, 2, 27, 12, 0, 0),
            input=GenesisInput(
                description="分析任务",
                specification="详细规格",
            ),
        )

        result = prompt.to_dict()
        json_str = json.dumps(result)

        # 验证 JSON 可以被正确解析
        parsed = json.loads(json_str)
        assert parsed["taskType"] == "analysis"
        assert parsed["priority"] == "high"
        assert parsed["sourceDid"] == "did:anp:automaton:main"
        assert parsed["targetDid"] == "did:anp:nanobot:main"
        assert parsed["requireConfirmation"] == False

    def test_parser_accepts_camelCase(self):
        """验证解析器可以接受 camelCase 格式的输入"""
        input_data = {
            "version": "1.0.0",
            "id": "test-prompt-003",
            "taskType": "execution",
            "priority": "critical",
            "sourceDid": "did:anp:automaton:main",
            "targetDid": "did:anp:nanobot:main",
            "createdAt": "2026-02-27T12:00:00",
            "input": {
                "description": "执行任务",
            },
            "requireConfirmation": True,
            "timeoutMs": 60000,
        }

        parser = GenesisPromptParser()
        prompt = parser.parse(input_data)

        # 验证解析结果
        assert prompt.task_type == GenesisTaskType.EXECUTION
        assert prompt.priority == GenesisPriority.CRITICAL
        assert prompt.source_did == "did:anp:automaton:main"
        assert prompt.target_did == "did:anp:nanobot:main"
        assert prompt.require_confirmation == True
        assert prompt.timeout_ms == 60000

    def test_round_trip_serialization(self):
        """验证序列化和反序列化的往返一致性"""
        original_data = {
            "version": "1.0.0",
            "id": "test-prompt-004",
            "taskType": "genesis",
            "priority": "normal",
            "sourceDid": "did:anp:automaton:main",
            "targetDid": "did:anp:nanobot:main",
            "createdAt": "2026-02-27T12:00:00",
            "input": {
                "description": "创世任务",
            },
            "requireConfirmation": False,
            "timeoutMs": 30000,
            "tags": ["roundtrip", "test"],
        }

        parser = GenesisPromptParser()

        # 解析
        prompt = parser.parse(original_data)

        # 序列化回去
        result = prompt.to_dict()

        # 验证关键字段保持一致
        assert result["taskType"] == original_data["taskType"]
        assert result["sourceDid"] == original_data["sourceDid"]
        assert result["targetDid"] == original_data["targetDid"]
        assert result["requireConfirmation"] == original_data["requireConfirmation"]
        assert result["timeoutMs"] == original_data["timeoutMs"]
        assert result["tags"] == original_data["tags"]

    def test_datetime_serialization(self):
        """验证日期时间序列化格式"""
        prompt = GenesisPrompt(
            version="1.0.0",
            id="test-prompt-005",
            task_type=GenesisTaskType.REPORT,
            priority=GenesisPriority.LOW,
            source_did="did:anp:automaton:main",
            target_did="did:anp:nanobot:main",
            created_at=datetime(2026, 2, 27, 14, 30, 45),
            input=GenesisInput(
                description="报告任务",
            ),
        )

        result = prompt.to_dict()

        # 验证时间序列化为 ISO 8601 格式
        assert result["createdAt"] == "2026-02-27T14:30:45"

    def test_complex_input_serialization(self):
        """验证复杂输入的序列化"""
        input_data = {
            "description": "复杂任务",
            "specification": "详细规格说明",
            "data": {"key1": "value1", "key2": 123},
            "files": ["file1.txt", "file2.py"],
            "environment": {"ENV": "test", "DEBUG": "false"},
            "dependencies": ["dep1", "dep2"],
        }

        prompt = GenesisPrompt(
            version="1.0.0",
            id="test-prompt-006",
            task_type=GenesisTaskType.MAINTENANCE,
            priority=GenesisPriority.NORMAL,
            source_did="did:anp:automaton:main",
            target_did="did:anp:nanobot:main",
            created_at=datetime.utcnow(),
            input=GenesisInput(**input_data),
        )

        result = prompt.to_dict()

        # 验证输入字段正确序列化
        assert result["input"]["description"] == input_data["description"]
        assert result["input"]["specification"] == input_data["specification"]
        assert result["input"]["data"] == input_data["data"]
        assert result["input"]["files"] == input_data["files"]
        assert result["input"]["environment"] == input_data["environment"]
        assert result["input"]["dependencies"] == input_data["dependencies"]
