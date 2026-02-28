"""
Nanobot 客户沟通模块
负责与 Upwork 客户的消息交互，支持消息模板、自动回复、沟通历史和语气分析

@module nanobot.interagent.client_communication
@version 1.0.0
"""

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Optional, Dict, List, Callable
from dataclasses import dataclass, field
from pathlib import Path

from pydantic import BaseModel

logger = logging.getLogger(__name__)

# 导入 Upwork 模型
import sys
sys.path.append(str(Path(__file__).parent.parent.parent))
from nanobot.channels.upwork.models import UpworkProject, BidProposal, ClientInfo


# ============================================================================
# 类型定义
# ============================================================================

class MessageTone(str, Enum):
    """消息语气类型"""
    PROFESSIONAL = "professional"
    FRIENDLY = "friendly"
    ENTHUSIASTIC = "enthusiastic"
    FORMAL = "formal"
    CASUAL = "casual"

    def __str__(self):
        return self.value


class MessageDirection(str, Enum):
    """消息方向"""
    INBOUND = "inbound"  # 来自客户
    OUTBOUND = "outbound"  # 发送给客户


class MessageType(str, Enum):
    """消息类型"""
    INITIAL_PROPOSAL = "initial_proposal"
    FOLLOW_UP = "follow_up"
    QUESTION_RESPONSE = "question_response"
    STATUS_UPDATE = "status_update"
    DELIVERY = "delivery"
    REVISION = "revision"
    CLOSING = "closing"


class ToneAnalysis(BaseModel):
    """语气分析结果"""
    tone: MessageTone
    confidence: float  # 0.0 - 1.0
    formality_level: float  # 0.0 - 1.0
    sentiment: str  # "positive", "neutral", "negative"
    keywords: List[str] = field(default_factory=list)


class ClientMessage(BaseModel):
    """客户消息"""
    id: str
    project_id: str
    conversation_id: str
    direction: MessageDirection
    message_type: MessageType
    content: str
    sender_id: str
    sender_name: str
    timestamp: datetime
    tone_analysis: Optional[ToneAnalysis] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    is_read: bool = False


class MessageTemplate(BaseModel):
    """消息模板"""
    name: str
    message_type: MessageType
    subject: str
    body: str
    variables: List[str] = field(default_factory=list)
    tone: MessageTone = MessageTone.PROFESSIONAL
    language: str = "en"


class ConversationHistory(BaseModel):
    """对话历史"""
    conversation_id: str
    project_id: str
    client_id: str
    client_name: str
    messages: List[ClientMessage] = field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    status: str = "active"  # active, closed, archived


class AutoReplyRule(BaseModel):
    """自动回复规则"""
    name: str
    enabled: bool = True
    priority: int = 0
    trigger_keywords: List[str] = field(default_factory=list)
    trigger_regex: Optional[str] = None
    template_name: str
    delay_seconds: int = 0
    max_per_day: int = 10


# ============================================================================
# 默认消息模板
# ============================================================================

DEFAULT_TEMPLATES: List[MessageTemplate] = [
    MessageTemplate(
        name="initial_proposal",
        message_type=MessageType.INITIAL_PROPOSAL,
        subject="Proposal for {project_title}",
        body="""Dear {client_name},

I came across your project "{project_title}" and was immediately interested.

{relevant_experience}

Based on my experience, I can help you with:
{deliverables}

**My Approach:**
{approach}

**Timeline:** {timeline}
**Budget:** {bid_amount}

I noticed that your project requires {key_skills}. I have extensive experience with these technologies and would love to discuss how I can contribute to your project.

{questions}

Best regards,
{your_name}""",
        variables=["client_name", "project_title", "relevant_experience", "deliverables", "approach", "timeline", "bid_amount", "key_skills", "questions", "your_name"],
        tone=MessageTone.PROFESSIONAL,
    ),
    MessageTemplate(
        name="follow_up",
        message_type=MessageType.FOLLOW_UP,
        subject="Following Up on {project_title}",
        body="""Dear {client_name},

I hope this message finds you well. I'm following up on my previous proposal for "{project_title}".

{follow_up_content}

I remain very interested in this project and confident I can deliver excellent results.

{additional_questions}

Best regards,
{your_name}""",
        variables=["client_name", "project_title", "follow_up_content", "additional_questions", "your_name"],
        tone=MessageTone.PROFESSIONAL,
    ),
    MessageTemplate(
        name="question_response",
        message_type=MessageType.QUESTION_RESPONSE,
        subject="Re: {project_title} - Your Questions",
        body="""Dear {client_name},

Thank you for your questions about "{project_title}".

{acknowledgment}

{response_content}

{next_steps}

Best regards,
{your_name}""",
        variables=["client_name", "project_title", "acknowledgment", "response_content", "next_steps", "your_name"],
        tone=MessageTone.PROFESSIONAL,
    ),
    MessageTemplate(
        name="status_update",
        message_type=MessageType.STATUS_UPDATE,
        subject="Status Update: {project_title}",
        body="""Dear {client_name},

I wanted to provide you with a quick status update on "{project_title}".

{status_summary}

**Completed:**
{completed_items}

**In Progress:**
{in_progress_items}

**Next Steps:**
{next_steps}

Thank you for your patience!

Best regards,
{your_name}""",
        variables=["client_name", "project_title", "status_summary", "completed_items", "in_progress_items", "next_steps", "your_name"],
        tone=MessageTone.PROFESSIONAL,
    ),
    MessageTemplate(
        name="delivery",
        message_type=MessageType.DELIVERY,
        subject="Project Delivery: {project_title}",
        body="""Dear {client_name},

I'm pleased to inform you that "{project_title}" has been completed!

{delivery_summary}

**What's Included:**
{deliverables}

**How to Review:**
{review_instructions}

Please let me know if you have any questions or need any revisions.

Best regards,
{your_name}""",
        variables=["client_name", "project_title", "delivery_summary", "deliverables", "review_instructions", "your_name"],
        tone=MessageTone.ENTHUSIASTIC,
    ),
]


# ============================================================================
# 客户沟通管理器
# ============================================================================

class ClientCommunicationManager:
    """
    客户沟通管理器

    功能：
    - 消息模板管理
    - 自动回复
    - 沟通历史记录
    - 语气分析
    - WebSocket 实时通信集成
    """

    def __init__(
        self,
        llm_client=None,
        templates_dir: Optional[Path] = None,
        enable_auto_reply: bool = True,
        enable_tone_analysis: bool = True,
    ):
        """
        初始化客户沟通管理器

        Args:
            llm_client: LLM 客户端（用于语气分析和智能回复）
            templates_dir: 模板目录路径
            enable_auto_reply: 是否启用自动回复
            enable_tone_analysis: 是否启用语气分析
        """
        self.llm = llm_client
        self.enable_auto_reply = enable_auto_reply
        self.enable_tone_analysis = enable_tone_analysis

        # 模板管理
        self.templates: Dict[str, MessageTemplate] = {}
        self._load_default_templates()
        if templates_dir:
            self._load_templates_from_dir(templates_dir)

        # 对话历史
        self.conversations: Dict[str, ConversationHistory] = {}

        # 自动回复规则
        self.auto_reply_rules: List[AutoReplyRule] = []
        self._load_default_rules()

        # WebSocket 连接
        self.websocket_client = None
        self._message_handlers: List[Callable] = []

        # 统计信息
        self.stats = {
            "messages_sent": 0,
            "messages_received": 0,
            "auto_replies_sent": 0,
            "conversations_active": 0,
        }

    # ========================================================================
    # 消息模板管理
    # ========================================================================

    def _load_default_templates(self) -> None:
        """加载默认模板"""
        for template in DEFAULT_TEMPLATES:
            self.templates[template.name] = template
        logger.info(f"Loaded {len(DEFAULT_TEMPLATES)} default templates")

    def _load_templates_from_dir(self, templates_dir: Path) -> None:
        """从目录加载模板"""
        templates_dir = Path(templates_dir)
        if not templates_dir.exists():
            logger.warning(f"Templates directory not found: {templates_dir}")
            return

        # 加载 JSON 模板配置
        config_file = templates_dir / "templates.json"
        if config_file.exists():
            with open(config_file, "r", encoding="utf-8") as f:
                config = json.load(f)
                for tmpl_data in config.get("templates", []):
                    template_file = templates_dir / tmpl_data["file"]
                    if template_file.exists():
                        with open(template_file, "r", encoding="utf-8") as tf:
                            body = tf.read()
                            template = MessageTemplate(
                                name=tmpl_data["name"],
                                message_type=MessageType(tmpl_data["type"]),
                                subject="",
                                body=body,
                                tone=MessageTone(tmpl_data.get("tone", "professional")),
                            )
                            self.templates[template.name] = template

    def register_template(self, template: MessageTemplate) -> None:
        """注册新模板"""
        self.templates[template.name] = template
        logger.info(f"Registered template: {template.name}")

    def get_template(self, name: str) -> Optional[MessageTemplate]:
        """获取模板"""
        return self.templates.get(name)

    def list_templates(self, message_type: Optional[MessageType] = None) -> List[MessageTemplate]:
        """列出模板"""
        templates = list(self.templates.values())
        if message_type:
            templates = [t for t in templates if t.message_type == message_type]
        return templates

    async def render_template(
        self,
        template_name: str,
        variables: Dict[str, Any],
    ) -> str:
        """
        渲染模板

        Args:
            template_name: 模板名称
            variables: 模板变量

        Returns:
            渲染后的消息内容
        """
        template = self.get_template(template_name)
        if not template:
            raise ValueError(f"Template not found: {template_name}")

        # 替换变量
        body = template.body
        for key, value in variables.items():
            placeholder = f"{{{key}}}"
            body = body.replace(placeholder, str(value))

        return body

    # ========================================================================
    # 语气分析
    # ========================================================================

    async def analyze_tone(self, message: str, use_llm: bool = True) -> ToneAnalysis:
        """
        分析消息语气

        Args:
            message: 消息内容
            use_llm: 是否使用 LLM 分析（否则使用规则）

        Returns:
            语气分析结果
        """
        if use_llm and self.llm:
            return await self._analyze_tone_with_llm(message)
        else:
            return self._analyze_tone_with_rules(message)

    async def _analyze_tone_with_llm(self, message: str) -> ToneAnalysis:
        """使用 LLM 分析语气"""
        prompt = f"""Analyze the tone and sentiment of this message:

Message: {message}

Provide a JSON response with:
- tone: one of "professional", "friendly", "enthusiastic", "formal", "casual"
- confidence: 0.0-1.0
- formality_level: 0.0-1.0
- sentiment: "positive", "neutral", or "negative"
- keywords: list of key tone-indicating words

Respond only with valid JSON."""

        try:
            response = await self.llm.chat(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=200,
                temperature=0.3,
            )

            result = json.loads(response.content)
            return ToneAnalysis(**result)
        except Exception as e:
            logger.warning(f"LLM tone analysis failed, using rules: {e}")
            return self._analyze_tone_with_rules(message)

    def _analyze_tone_with_rules(self, message: str) -> ToneAnalysis:
        """使用规则分析语气"""
        msg_lower = message.lower()

        # 检测关键词
        professional_keywords = ["regards", "sincerely", "professionally", "expertise"]
        friendly_keywords = ["hi", "hello", "thanks", "awesome", "great"]
        enthusiastic_keywords = ["excited", "love", "amazing", "thrilled", "fantastic"]
        formal_keywords = ["dear", "respectfully", "cordially"]
        casual_keywords = ["hey", "yeah", "cool", "ok", "sure"]

        keyword_score = {
            "professional": sum(1 for kw in professional_keywords if kw in msg_lower),
            "friendly": sum(1 for kw in friendly_keywords if kw in msg_lower),
            "enthusiastic": sum(1 for kw in enthusiastic_keywords if kw in msg_lower),
            "formal": sum(1 for kw in formal_keywords if kw in msg_lower),
            "casual": sum(1 for kw in casual_keywords if kw in msg_lower),
        }

        # 确定语气
        max_score = max(keyword_score.values())
        if max_score == 0:
            tone = MessageTone.PROFESSIONAL
            confidence = 0.5
        else:
            tone = MessageTone(max(keyword_score, key=keyword_score.get))
            confidence = min(1.0, max_score / 3.0)

        # 正式度
        formality_level = 0.5
        if tone == MessageTone.FORMAL:
            formality_level = 0.9
        elif tone == MessageTone.PROFESSIONAL:
            formality_level = 0.7
        elif tone == MessageTone.CASUAL:
            formality_level = 0.3

        # 情感
        positive_words = ["good", "great", "excellent", "thanks", "appreciate", "love", "amazing", "thrilled", "excited", "fantastic"]
        negative_words = ["bad", "terrible", "hate", "disappointed", "issue", "problem"]

        positive_count = sum(1 for word in positive_words if word in msg_lower)
        negative_count = sum(1 for word in negative_words if word in msg_lower)

        if positive_count > negative_count:
            sentiment = "positive"
        elif negative_count > positive_count:
            sentiment = "negative"
        else:
            sentiment = "neutral"

        # 关键词
        keywords = []
        tone_keywords_list = [
            ("professional", professional_keywords),
            ("friendly", friendly_keywords),
            ("enthusiastic", enthusiastic_keywords),
            ("formal", formal_keywords),
            ("casual", casual_keywords),
        ]
        for tone_name, kw_list in tone_keywords_list:
            for kw in kw_list:
                if kw in msg_lower:
                    keywords.append(kw)

        return ToneAnalysis(
            tone=tone,
            confidence=confidence,
            formality_level=formality_level,
            sentiment=sentiment,
            keywords=keywords[:5],
        )

    # ========================================================================
    # 自动回复
    # ========================================================================

    def _load_default_rules(self) -> None:
        """加载默认自动回复规则"""
        default_rules = [
            AutoReplyRule(
                name="timeline",
                enabled=True,
                priority=10,
                trigger_keywords=["when", "timeline", "deadline", "how long", "deliver"],
                template_name="question_response",
                delay_seconds=30,
            ),
            AutoReplyRule(
                name="price",
                enabled=True,
                priority=10,
                trigger_keywords=["price", "cost", "budget", "rate", "expensive", "charge"],
                template_name="question_response",
                delay_seconds=30,
            ),
            AutoReplyRule(
                name="greeting",
                enabled=True,
                priority=5,
                trigger_keywords=["hello", "hi", "hey", "greetings"],
                template_name="question_response",
                delay_seconds=0,
            ),
        ]
        self.auto_reply_rules.extend(default_rules)

    def add_auto_reply_rule(self, rule: AutoReplyRule) -> None:
        """添加自动回复规则"""
        self.auto_reply_rules.append(rule)
        # 按优先级排序
        self.auto_reply_rules.sort(key=lambda r: r.priority, reverse=True)

    async def should_auto_reply(self, message: ClientMessage) -> Optional[AutoReplyRule]:
        """
        检查是否应该自动回复

        Args:
            message: 收到的消息

        Returns:
            匹配的自动回复规则，如果没有则返回 None
        """
        if not self.enable_auto_reply:
            return None

        if message.direction != MessageDirection.INBOUND:
            return None

        msg_lower = message.content.lower()

        for rule in self.auto_reply_rules:
            if not rule.enabled:
                continue

            # 检查关键词
            if rule.trigger_keywords:
                if any(kw.lower() in msg_lower for kw in rule.trigger_keywords):
                    return rule

            # 检查正则表达式
            if rule.trigger_regex:
                if re.search(rule.trigger_regex, message.content, re.IGNORECASE):
                    return rule

        return None

    async def send_auto_reply(
        self,
        message: ClientMessage,
        rule: AutoReplyRule,
        variables: Dict[str, Any],
    ) -> Optional[str]:
        """
        发送自动回复

        Args:
            message: 原始消息
            rule: 自动回复规则
            variables: 模板变量

        Returns:
            发送的回复内容
        """
        # 延迟发送
        if rule.delay_seconds > 0:
            await asyncio.sleep(rule.delay_seconds)

        # 渲染模板
        reply_content = await self.render_template(rule.template_name, variables)

        # 创建回复消息
        reply = ClientMessage(
            id=f"auto_{message.id}_{datetime.now().timestamp()}",
            project_id=message.project_id,
            conversation_id=message.conversation_id,
            direction=MessageDirection.OUTBOUND,
            message_type=MessageType.QUESTION_RESPONSE,
            content=reply_content,
            sender_id="assistant",
            sender_name="AI Assistant",
            timestamp=datetime.now(),
        )

        # 添加到历史
        await self.add_message_to_conversation(reply)

        # 更新统计
        self.stats["auto_replies_sent"] += 1
        self.stats["messages_sent"] += 1

        logger.info(f"Auto-reply sent using rule: {rule.name}")
        return reply_content

    # ========================================================================
    # 对话历史管理
    # ========================================================================

    async def get_or_create_conversation(
        self,
        project_id: str,
        client_id: str,
        client_name: str,
    ) -> ConversationHistory:
        """获取或创建对话"""
        # 查找现有对话
        for conv in self.conversations.values():
            if conv.project_id == project_id and conv.client_id == client_id:
                if conv.status == "active":
                    conv.updated_at = datetime.now()
                    return conv

        # 创建新对话
        conv_id = f"conv_{project_id}_{client_id}_{datetime.now().timestamp()}"
        conversation = ConversationHistory(
            conversation_id=conv_id,
            project_id=project_id,
            client_id=client_id,
            client_name=client_name,
            created_at=datetime.now(),
            updated_at=datetime.now(),
            status="active",
        )

        self.conversations[conv_id] = conversation
        self.stats["conversations_active"] += 1

        logger.info(f"Created conversation: {conv_id}")
        return conversation

    async def add_message_to_conversation(self, message: ClientMessage) -> None:
        """添加消息到对话"""
        conversation = self.conversations.get(message.conversation_id)
        if not conversation:
            logger.warning(f"Conversation not found: {message.conversation_id}")
            return

        conversation.messages.append(message)
        conversation.updated_at = datetime.now()

        # 更新统计
        if message.direction == MessageDirection.INBOUND:
            self.stats["messages_received"] += 1
        else:
            self.stats["messages_sent"] += 1

    async def get_conversation_history(
        self,
        conversation_id: str,
        limit: Optional[int] = None,
    ) -> List[ClientMessage]:
        """获取对话历史"""
        conversation = self.conversations.get(conversation_id)
        if not conversation:
            return []

        messages = conversation.messages
        if limit:
            messages = messages[-limit:]

        return messages

    async def get_recent_conversations(
        self,
        hours: int = 24,
        limit: int = 10,
    ) -> List[ConversationHistory]:
        """获取最近的对话"""
        cutoff = datetime.now() - timedelta(hours=hours)

        recent = [
            conv for conv in self.conversations.values()
            if conv.updated_at >= cutoff and conv.status == "active"
        ]

        recent.sort(key=lambda c: c.updated_at, reverse=True)
        return recent[:limit]

    # ========================================================================
    # 消息发送
    # ========================================================================

    async def send_message(
        self,
        conversation_id: str,
        content: str,
        message_type: MessageType = MessageType.QUESTION_RESPONSE,
        tone: MessageTone = MessageTone.PROFESSIONAL,
    ) -> ClientMessage:
        """
        发送消息

        Args:
            conversation_id: 对话 ID
            content: 消息内容
            message_type: 消息类型
            tone: 消息语气

        Returns:
            发送的消息对象
        """
        conversation = self.conversations.get(conversation_id)
        if not conversation:
            raise ValueError(f"Conversation not found: {conversation_id}")

        message = ClientMessage(
            id=f"msg_{datetime.now().timestamp()}_{len(conversation.messages)}",
            project_id=conversation.project_id,
            conversation_id=conversation_id,
            direction=MessageDirection.OUTBOUND,
            message_type=message_type,
            content=content,
            sender_id="assistant",
            sender_name="AI Assistant",
            timestamp=datetime.now(),
        )

        await self.add_message_to_conversation(message)
        return message

    async def send_proposal(
        self,
        project: UpworkProject,
        proposal: BidProposal,
        variables: Dict[str, Any],
    ) -> ClientMessage:
        """
        发送项目提案

        Args:
            project: Upwork 项目
            proposal: 提案内容
            variables: 模板变量

        Returns:
            发送的消息对象
        """
        # 获取或创建对话
        client_id = project.client.id if project.client else "unknown"
        client_name = project.client.name if project.client else "Client"
        conversation = await self.get_or_create_conversation(
            project.id, client_id, client_name
        )

        # 渲染提案模板
        content = await self.render_template("initial_proposal", variables)

        # 发送消息
        return await self.send_message(
            conversation.conversation_id,
            content,
            MessageType.INITIAL_PROPOSAL,
        )

    # ========================================================================
    # WebSocket 集成
    # ========================================================================

    def register_websocket_handler(self, handler: Callable) -> None:
        """注册 WebSocket 消息处理器"""
        self._message_handlers.append(handler)

    async def handle_websocket_message(self, data: Dict[str, Any]) -> None:
        """
        处理 WebSocket 消息

        Args:
            data: 消息数据
        """
        try:
            msg_type = data.get("type")

            if msg_type == "new_message":
                await self._handle_inbound_message(data)
            elif msg_type == "conversation_update":
                await self._handle_conversation_update(data)
            elif msg_type == "tone_analysis_request":
                await self._handle_tone_analysis_request(data)

            # 调用注册的处理器
            for handler in self._message_handlers:
                await handler(data)

        except Exception as e:
            logger.error(f"Error handling WebSocket message: {e}")

    async def _handle_inbound_message(self, data: Dict[str, Any]) -> None:
        """处理入站消息"""
        # 解析消息
        message = ClientMessage(
            id=data["message_id"],
            project_id=data["project_id"],
            conversation_id=data["conversation_id"],
            direction=MessageDirection.INBOUND,
            message_type=MessageType(data.get("message_type", "question_response")),
            content=data["content"],
            sender_id=data["sender_id"],
            sender_name=data.get("sender_name", "Client"),
            timestamp=datetime.fromisoformat(data["timestamp"]),
        )

        # 语气分析
        if self.enable_tone_analysis:
            message.tone_analysis = await self.analyze_tone(message.content)

        # 添加到对话
        await self.add_message_to_conversation(message)

        # 检查自动回复
        rule = await self.should_auto_reply(message)
        if rule:
            variables = {
                "client_name": message.sender_name,
                "project_title": data.get("project_title", "the project"),
                "acknowledgment": "Thank you for your message.",
                "response_content": "I'll get back to you shortly with a detailed response.",
                "next_steps": "I'll review your message and respond as soon as possible.",
                "your_name": "AI Assistant",
            }
            await self.send_auto_reply(message, rule, variables)

    async def _handle_conversation_update(self, data: Dict[str, Any]) -> None:
        """处理对话更新"""
        conv_id = data["conversation_id"]
        action = data.get("action")

        if action == "close":
            conversation = self.conversations.get(conv_id)
            if conversation:
                conversation.status = "closed"
                self.stats["conversations_active"] -= 1
        elif action == "archive":
            conversation = self.conversations.get(conv_id)
            if conversation:
                conversation.status = "archived"
                self.stats["conversations_active"] -= 1

    async def _handle_tone_analysis_request(self, data: Dict[str, Any]) -> None:
        """处理语气分析请求"""
        content = data.get("content", "")
        analysis = await self.analyze_tone(content)

        # 这里可以通过 WebSocket 发送分析结果
        logger.info(f"Tone analysis: {analysis.tone} (confidence: {analysis.confidence})")

    # ========================================================================
    # 工具方法
    # ========================================================================

    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        return {
            **self.stats,
            "templates_count": len(self.templates),
            "conversations_total": len(self.conversations),
            "auto_reply_rules": len(self.auto_reply_rules),
        }

    async def cleanup_old_conversations(self, days: int = 30) -> int:
        """
        清理旧对话

        Args:
            days: 保留天数

        Returns:
            清理的对话数量
        """
        cutoff = datetime.now() - timedelta(days=days)
        to_remove = []

        for conv_id, conv in self.conversations.items():
            if conv.updated_at < cutoff and conv.status != "active":
                to_remove.append(conv_id)

        for conv_id in to_remove:
            del self.conversations[conv_id]

        logger.info(f"Cleaned up {len(to_remove)} old conversations")
        return len(to_remove)


# ============================================================================
# 工厂函数
# ============================================================================

def create_client_communication_manager(
    llm_client=None,
    templates_dir: Optional[Path] = None,
    enable_auto_reply: bool = True,
    enable_tone_analysis: bool = True,
) -> ClientCommunicationManager:
    """
    创建客户沟通管理器

    Args:
        llm_client: LLM 客户端
        templates_dir: 模板目录
        enable_auto_reply: 是否启用自动回复
        enable_tone_analysis: 是否启用语气分析

    Returns:
        客户沟通管理器实例
    """
    return ClientCommunicationManager(
        llm_client=llm_client,
        templates_dir=templates_dir,
        enable_auto_reply=enable_auto_reply,
        enable_tone_analysis=enable_tone_analysis,
    )
