"""
代码生成技能
使用 LLM 生成组件代码和测试代码

@module nanobot.skills.freelance.codegen
@version 1.0.0
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


logger = logging.getLogger(__name__)


# ============================================================================
# 数据模型
# ============================================================================

class ComponentSpec(BaseModel):
    """组件规格"""
    name: str = Field(description="组件名称")
    type: str = Field(description="组件类型: component, function, class, module")
    language: str = Field(description="编程语言")
    framework: str = Field(default="", description="使用的框架")
    description: str = Field(description="组件描述")
    props: Dict[str, Any] = Field(default_factory=dict, description="组件属性/参数")
    dependencies: List[str] = Field(default_factory=list, description="依赖项")
    requirements: List[str] = Field(default_factory=list, description="功能需求")


class CodeGenerationResult(BaseModel):
    """代码生成结果"""
    code: str
    language: str
    imports: List[str] = Field(default_factory=list)
    dependencies: List[str] = Field(default_factory=list)
    explanation: str = ""


class TestGenerationResult(BaseModel):
    """测试生成结果"""
    test_code: str
    test_framework: str
    coverage_target: float
    setup_code: str = ""


# ============================================================================
# 代码生成器
# ============================================================================

class CodeGenerator:
    """
    代码生成器

    使用 LLM 生成高质量代码和测试
    """

    # 代码生成系统提示
    CODEGEN_SYSTEM_PROMPT = """你是一个专业的软件工程师，擅长编写高质量、可维护的代码。

你的任务是根据规格说明生成代码。代码应该：
1. 遵循最佳实践和设计模式
2. 包含适当的类型注解
3. 有清晰的文档字符串
4. 处理错误情况
5. 易于测试和维护

输出格式必须是有效的 JSON，符合以下 schema：
{
    "code": "生成的代码",
    "language": "编程语言",
    "imports": ["import1", "import2", ...],
    "dependencies": ["依赖1", "依赖2", ...],
    "explanation": "代码说明"
}

注意：
- 只输出代码，不要输出 markdown 代码块标记
- imports 应该包含所有需要的外部导入
- dependencies 应该列出需要安装的包名
"""

    # 测试生成系统提示
    TEST_SYSTEM_PROMPT = """你是一个专业的测试工程师，擅长编写全面的测试用例。

你的任务是为给定的代码生成测试用例。测试应该：
1. 覆盖正常路径和边缘情况
2. 使用适当的断言
3. 包含测试夹具（fixtures）
4. 遵循测试框架的最佳实践
5. 达到指定的覆盖率目标

输出格式必须是有效的 JSON，符合以下 schema：
{
    "test_code": "测试代码",
    "test_framework": "测试框架名称",
    "coverage_target": 0.9,
    "setup_code": "测试设置代码（如果有）"
}

注意：
- 只输出代码，不要输出 markdown 代码块标记
- 使用描述性的测试名称
- 包含边界条件测试
- 包含错误处理测试
"""

    # 错误修复系统提示
    FIX_ERROR_SYSTEM_PROMPT = """你是一个专业的调试专家，擅长分析和修复代码错误。

你的任务是分析代码和错误信息，提供修复方案。

输出格式必须是有效的 JSON，符合以下 schema：
{
    "fixed_code": "修复后的代码",
    "error_analysis": "错误分析",
    "fix_explanation": "修复说明",
    "prevention_tips": ["预防建议1", "预防建议2", ...]
}

注意：
- 只输出代码，不要输出 markdown 代码块标记
- 解释错误原因
- 说明修复方案
- 提供预防类似错误的建议
"""

    def __init__(self, llm_client):
        """
        初始化代码生成器

        Args:
            llm_client: LLM 客户端
        """
        self.llm = llm_client

    def _build_generation_prompt(self, spec: ComponentSpec) -> List[Dict[str, str]]:
        """
        构建代码生成提示词

        Args:
            spec: 组件规格

        Returns:
            消息列表
        """
        spec_text = f"""组件规格：
- 名称: {spec.name}
- 类型: {spec.type}
- 语言: {spec.language}
- 框架: {spec.framework or '无'}
- 描述: {spec.description}
"""

        if spec.props:
            spec_text += f"- 属性/参数: {json.dumps(spec.props, ensure_ascii=False)}\n"

        if spec.dependencies:
            spec_text += f"- 已知依赖: {', '.join(spec.dependencies)}\n"

        if spec.requirements:
            spec_text += f"- 功能需求:\n" + "\n".join(f"  * {r}" for r in spec.requirements)

        return [
            {"role": "system", "content": self.CODEGEN_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"""请根据以下规格生成代码：

{spec_text}

请以 JSON 格式输出生成的代码。"""
            }
        ]

    def _build_test_prompt(
        self,
        code: str,
        coverage_target: float,
        test_framework: Optional[str] = None
    ) -> List[Dict[str, str]]:
        """
        构建测试生成提示词

        Args:
            code: 源代码
            coverage_target: 覆盖率目标
            test_framework: 测试框架（可选）

        Returns:
            消息列表
        """
        framework_hint = f"使用 {test_framework} 框架" if test_framework else "选择合适的测试框架"

        return [
            {"role": "system", "content": self.TEST_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"""请为以下代码生成测试用例：

代码：
```
{code}
```

要求：
- 覆盖率目标: {coverage_target * 100:.0f}%
- {framework_hint}
- 包含正常情况和边缘情况测试

请以 JSON 格式输出测试代码。"""
            }
        ]

    def _build_fix_prompt(self, code: str, error: str) -> List[Dict[str, str]]:
        """
        构建错误修复提示词

        Args:
            code: 有错误的代码
            error: 错误信息

        Returns:
            消息列表
        """
        return [
            {"role": "system", "content": self.FIX_ERROR_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"""请修复以下代码中的错误：

代码：
```
{code}
```

错误信息：
{error}

请以 JSON 格式输出修复后的代码和分析。"""
            }
        ]

    async def generate_component(self, spec: ComponentSpec) -> CodeGenerationResult:
        """
        生成组件代码

        Args:
            spec: 组件规格

        Returns:
            CodeGenerationResult: 生成结果
        """
        logger.info(f"Generating {spec.type}: {spec.name}")

        messages = self._build_generation_prompt(spec)

        try:
            response = await self.llm.chat(
                messages=messages,
                temperature=0.2,  # 低温度以获得一致的代码
                max_tokens=8192,  # 需要更多 token 来生成代码
            )

            if not response.content:
                raise ValueError("LLM returned empty response")

            result_data = self._parse_response(response.content)

            # 提取代码（去除可能的代码块标记）
            code = self._extract_code(result_data.get("code", ""))

            logger.info(f"Code generation completed for {spec.name}")

            return CodeGenerationResult(
                code=code,
                language=result_data.get("language", spec.language),
                imports=result_data.get("imports", []),
                dependencies=result_data.get("dependencies", []),
                explanation=result_data.get("explanation", "")
            )

        except Exception as e:
            logger.error(f"Code generation failed: {e}")
            raise

    async def generate_tests(
        self,
        code: str,
        coverage_target: float = 0.9,
        test_framework: Optional[str] = None
    ) -> TestGenerationResult:
        """
        生成测试代码

        Args:
            code: 源代码
            coverage_target: 覆盖率目标 (0-1)
            test_framework: 测试框架（可选）

        Returns:
            TestGenerationResult: 测试生成结果
        """
        logger.info(f"Generating tests with coverage target: {coverage_target * 100:.0f}%")

        messages = self._build_test_prompt(code, coverage_target, test_framework)

        try:
            response = await self.llm.chat(
                messages=messages,
                temperature=0.2,
                max_tokens=8192,
            )

            if not response.content:
                raise ValueError("LLM returned empty response")

            result_data = self._parse_response(response.content)

            # 提取测试代码
            test_code = self._extract_code(result_data.get("test_code", ""))

            logger.info("Test generation completed")

            return TestGenerationResult(
                test_code=test_code,
                test_framework=result_data.get("test_framework", test_framework or "pytest"),
                coverage_target=result_data.get("coverage_target", coverage_target),
                setup_code=result_data.get("setup_code", "")
            )

        except Exception as e:
            logger.error(f"Test generation failed: {e}")
            raise

    async def fix_error(self, code: str, error: str) -> Dict[str, Any]:
        """
        修复代码错误

        Args:
            code: 有错误的代码
            error: 错误信息

        Returns:
            包含修复后代码和分析的字典
        """
        logger.info(f"Attempting to fix error: {error[:100]}...")

        messages = self._build_fix_prompt(code, error)

        try:
            response = await self.llm.chat(
                messages=messages,
                temperature=0.2,
                max_tokens=8192,
            )

            if not response.content:
                raise ValueError("LLM returned empty response")

            result_data = self._parse_response(response.content)

            # 提取修复后的代码
            fixed_code = self._extract_code(result_data.get("fixed_code", ""))

            logger.info("Error fix completed")

            return {
                "fixed_code": fixed_code,
                "error_analysis": result_data.get("error_analysis", ""),
                "fix_explanation": result_data.get("fix_explanation", ""),
                "prevention_tips": result_data.get("prevention_tips", [])
            }

        except Exception as e:
            logger.error(f"Error fix failed: {e}")
            raise

    def _extract_code(self, text: str) -> str:
        """
        从文本中提取代码，去除 markdown 代码块标记

        Args:
            text: 可能包含代码块的文本

        Returns:
            纯代码
        """
        # 移除 markdown 代码块标记
        code_block_pattern = r'```(?:\w+)?\s*\n?(.*?)\n?```'
        match = re.search(code_block_pattern, text, re.DOTALL)
        if match:
            return match.group(1).strip()

        return text.strip()

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
        logger.warning("Failed to parse JSON from response, using fallback")
        return {"code": response_text}


# ============================================================================
# 工厂函数
# ============================================================================

def create_code_generator(llm_client) -> CodeGenerator:
    """
    创建代码生成器

    Args:
        llm_client: LLM 客户端

    Returns:
        CodeGenerator 实例
    """
    return CodeGenerator(llm_client)
