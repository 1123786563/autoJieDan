"""
需求分析技能
使用 LLM 分析项目需求，提取关键信息

@module nanobot.skills.freelance.requirement
@version 1.0.0
"""

import json
import logging
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


logger = logging.getLogger(__name__)


# ============================================================================
# 数据模型
# ============================================================================

class RequirementAnalysis(BaseModel):
    """需求分析结果"""
    scope: str = Field(description="项目范围概述")
    features: List[str] = Field(default_factory=list, description="功能特性列表")
    constraints: Dict[str, Any] = Field(default_factory=dict, description="技术约束")
    assumptions: List[str] = Field(default_factory=list, description="假设条件")
    questions: List[str] = Field(default_factory=list, description="需要澄清的问题")
    success_criteria: List[str] = Field(default_factory=list, description="成功标准")
    edge_cases: List[str] = Field(default_factory=list, description="边缘情况")
    tech_stack: List[str] = Field(default_factory=list, description="推荐技术栈")
    complexity_level: str = Field(default="medium", description="复杂度: low/medium/high")
    estimated_effort: str = Field(default="", description="工作量估算")


class ClarificationQuestion(BaseModel):
    """澄清问题"""
    question_id: str
    question: str
    context: str
    options: Optional[List[str]] = None


# ============================================================================
# 需求分析器
# ============================================================================

class RequirementAnalyzer:
    """
    需求分析器

    使用 LLM 分析项目需求，提取关键信息并生成结构化报告
    """

    # 需求分析系统提示
    SYSTEM_PROMPT = """你是一个专业的需求分析师，擅长理解客户需求并提取关键信息。

你的任务是：
1. 分析项目描述，理解项目范围和目标
2. 识别核心功能和特性
3. 提取技术约束和假设条件
4. 识别需要澄清的问题
5. 定义成功标准
6. 识别潜在的边缘情况
7. 推荐合适的技术栈
8. 评估项目复杂度

输出格式必须是有效的 JSON，符合以下 schema：
{
    "scope": "项目范围概述",
    "features": ["功能1", "功能2", ...],
    "constraints": {"技术约束名": "约束描述", ...},
    "assumptions": ["假设1", "假设2", ...],
    "questions": ["问题1", "问题2", ...],
    "success_criteria": ["标准1", "标准2", ...],
    "edge_cases": ["边缘情况1", "边缘情况2", ...],
    "tech_stack": ["技术1", "技术2", ...],
    "complexity_level": "low|medium|high",
    "estimated_effort": "工作量描述"
}

注意：
- 如果信息不足，在 questions 中列出需要澄清的问题
- constraints 应包括性能、安全、兼容性等方面
- edge_cases 应考虑异常输入、边界条件等
- tech_stack 应基于项目需求推荐合适的技术
"""

    def __init__(self, llm_client):
        """
        初始化需求分析器

        Args:
            llm_client: LLM 客户端 (LiteLLMProvider 或兼容接口)
        """
        self.llm = llm_client

    def _build_analysis_prompt(self, project_description: str) -> List[Dict[str, str]]:
        """
        构建分析提示词

        Args:
            project_description: 项目描述

        Returns:
            消息列表
        """
        return [
            {"role": "system", "content": self.SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"""请分析以下项目需求：

{project_description}

请以 JSON 格式输出需求分析结果。"""
            }
        ]

    def _build_clarification_prompt(
        self,
        original_description: str,
        previous_analysis: RequirementAnalysis,
        question: str
    ) -> List[Dict[str, str]]:
        """
        构建澄清提示词

        Args:
            original_description: 原始项目描述
            previous_analysis: 之前的分析结果
            question: 用户的问题

        Returns:
            消息列表
        """
        return [
            {"role": "system", "content": self.SYSTEM_PROMPT},
            {
                "role": "assistant",
                "content": json.dumps(previous_analysis.model_dump(), indent=2, ensure_ascii=False)
            },
            {
                "role": "user",
                "content": f"""基于之前的分析，请回答以下问题：

问题: {question}

请提供澄清信息，并在必要时更新需求分析。输出 JSON 格式的更新后分析结果。"""
            }
        ]

    async def analyze(self, project_description: str) -> RequirementAnalysis:
        """
        分析项目需求

        Args:
            project_description: 项目描述文本

        Returns:
            RequirementAnalysis: 需求分析结果
        """
        logger.info("Starting requirement analysis")

        messages = self._build_analysis_prompt(project_description)

        try:
            response = await self.llm.chat(
                messages=messages,
                temperature=0.3,  # 使用较低的温度以获得更确定性的结果
                max_tokens=4096,
            )

            if not response.content:
                raise ValueError("LLM returned empty response")

            # 解析 JSON 响应
            analysis_data = self._parse_response(response.content)

            logger.info(f"Requirement analysis completed: {len(analysis_data.get('features', []))} features identified")

            return RequirementAnalysis(**analysis_data)

        except Exception as e:
            logger.error(f"Requirement analysis failed: {e}")
            # 返回一个基本的分析结果
            return RequirementAnalysis(
                scope="分析失败",
                features=[],
                questions=[f"分析过程中出现错误: {str(e)}"]
            )

    async def clarify(
        self,
        original_description: str,
        previous_analysis: RequirementAnalysis,
        question: str
    ) -> RequirementAnalysis:
        """
        通过多轮对话澄清需求

        Args:
            original_description: 原始项目描述
            previous_analysis: 之前的分析结果
            question: 用户的澄清问题

        Returns:
            RequirementAnalysis: 更新后的分析结果
        """
        logger.info(f"Processing clarification question: {question[:50]}...")

        messages = self._build_clarification_prompt(
            original_description,
            previous_analysis,
            question
        )

        try:
            response = await self.llm.chat(
                messages=messages,
                temperature=0.3,
                max_tokens=4096,
            )

            if not response.content:
                return previous_analysis

            analysis_data = self._parse_response(response.content)

            logger.info("Clarification processed successfully")

            return RequirementAnalysis(**analysis_data)

        except Exception as e:
            logger.error(f"Clarification failed: {e}")
            return previous_analysis

    async def ask_questions(
        self,
        analysis: RequirementAnalysis,
        max_questions: int = 5
    ) -> List[ClarificationQuestion]:
        """
        生成需要澄清的问题

        Args:
            analysis: 需求分析结果
            max_questions: 最多返回的问题数量

        Returns:
            澄清问题列表
        """
        if not analysis.questions:
            return []

        questions = []
        for i, question_text in enumerate(analysis.questions[:max_questions]):
            question = ClarificationQuestion(
                question_id=f"q_{i+1}",
                question=question_text,
                context="需要更多信息以准确理解需求"
            )
            questions.append(question)

        return questions

    def _parse_response(self, response_text: str) -> Dict[str, Any]:
        """
        解析 LLM 响应，提取 JSON

        Args:
            response_text: LLM 响应文本

        Returns:
            解析后的字典
        """
        # 尝试直接解析
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            pass

        # 尝试提取 JSON 代码块
        import re
        json_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', response_text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass

        # 尝试提取花括号内的内容
        brace_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if brace_match:
            try:
                return json.loads(brace_match.group(0))
            except json.JSONDecodeError:
                pass

        # 返回基本结构
        logger.warning(f"Failed to parse JSON from response, using fallback structure")
        return {
            "scope": "解析失败",
            "features": [],
            "questions": ["无法解析 LLM 响应"],
            "constraints": {},
            "assumptions": [],
            "success_criteria": [],
            "edge_cases": [],
            "tech_stack": [],
            "complexity_level": "unknown",
            "estimated_effort": ""
        }


# ============================================================================
# 工厂函数
# ============================================================================

def create_requirement_analyzer(llm_client) -> RequirementAnalyzer:
    """
    创建需求分析器

    Args:
        llm_client: LLM 客户端

    Returns:
        RequirementAnalyzer 实例
    """
    return RequirementAnalyzer(llm_client)
