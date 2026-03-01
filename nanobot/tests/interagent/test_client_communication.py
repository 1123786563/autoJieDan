"""
Tests for ClientCommunicationManager
@module tests.interagent.test_client_communication
"""

import asyncio
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from nanobot.interagent.client_communication import (
    ClientCommunicationManager,
    MessageTemplate,
    AutoReplyRule,
    ClientMessage,
    ConversationHistory,
    MessageTone,
    MessageDirection,
    MessageType,
    ToneAnalysis,
    create_client_communication_manager,
)


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def mock_llm_client():
    """Mock LLM client."""
    client = AsyncMock()
    client.chat = AsyncMock(
        return_value=MagicMock(
            content='{"tone": "professional", "confidence": 0.85, "formality_level": 0.7, "sentiment": "positive", "keywords": ["regards", "professionally"]}'
        )
    )
    return client


@pytest.fixture
def manager(mock_llm_client):
    """Create a client communication manager."""
    return ClientCommunicationManager(
        llm_client=mock_llm_client,
        enable_auto_reply=True,
        enable_tone_analysis=True,
    )


@pytest.fixture
def sample_project():
    """Sample Upwork project."""
    from nanobot.channels.upwork.models import UpworkProject, BudgetInfo, ClientInfo

    return UpworkProject(
        id="proj-123",
        title="Test Project",
        description="A test project for testing",
        budget=BudgetInfo(type="fixed", min_amount=500, max_amount=1000),
        skills=["python", "api"],
        category="Web Development",
        client=ClientInfo(
            id="client-456",
            name="Test Client",
            rating=5.0,
            verified=True,
        ),
    )


# ============================================================================
# Template Management Tests
# ============================================================================


class TestTemplateManagement:
    """Tests for template management."""

    def test_load_default_templates(self, manager):
        """Test that default templates are loaded."""
        templates = manager.list_templates()
        assert len(templates) >= 5
        template_names = [t.name for t in templates]
        assert "initial_proposal" in template_names
        assert "follow_up" in template_names
        assert "question_response" in template_names

    def test_register_template(self, manager):
        """Test registering a custom template."""
        custom_template = MessageTemplate(
            name="custom_template",
            message_type=MessageType.QUESTION_RESPONSE,
            subject="Custom",
            body="Hello {name}, this is a custom template.",
            variables=["name"],
            tone=MessageTone.FRIENDLY,
        )

        manager.register_template(custom_template)
        retrieved = manager.get_template("custom_template")

        assert retrieved is not None
        assert retrieved.name == "custom_template"
        assert retrieved.tone == MessageTone.FRIENDLY

    def test_render_template(self, manager):
        """Test rendering a template with variables."""
        variables = {
            "client_name": "John Doe",
            "project_title": "Test Project",
            "relevant_experience": "I have 5 years of experience",
            "deliverables": "- Feature 1\n- Feature 2",
            "approach": "Agile methodology",
            "timeline": "2 weeks",
            "bid_amount": "$800",
            "key_skills": "Python, API",
            "questions": "When can we start?",
            "your_name": "AI Assistant",
        }

        content = asyncio.run(manager.render_template("initial_proposal", variables))

        assert "John Doe" in content
        assert "Test Project" in content
        assert "$800" in content

    def test_list_templates_by_type(self, manager):
        """Test listing templates by message type."""
        proposal_templates = manager.list_templates(MessageType.INITIAL_PROPOSAL)
        assert all(t.message_type == MessageType.INITIAL_PROPOSAL for t in proposal_templates)


# ============================================================================
# Tone Analysis Tests
# ============================================================================


class TestToneAnalysis:
    """Tests for tone analysis."""

    def test_analyze_tone_with_rules(self, manager):
        """Test tone analysis using rules (no LLM)."""
        message = "Dear Sir, I would like to professionally discuss this matter."

        analysis = asyncio.run(manager.analyze_tone(message, use_llm=False))

        assert isinstance(analysis, ToneAnalysis)
        assert analysis.tone in MessageTone
        assert 0.0 <= analysis.confidence <= 1.0
        assert 0.0 <= analysis.formality_level <= 1.0
        assert analysis.sentiment in ["positive", "neutral", "negative"]

    def test_detect_professional_tone(self, manager):
        """Test detecting professional tone."""
        message = "I sincerely appreciate your consideration and look forward to professionally discussing this project."

        analysis = asyncio.run(manager.analyze_tone(message, use_llm=False))

        assert analysis.tone == MessageTone.PROFESSIONAL
        assert analysis.formality_level > 0.5

    def test_detect_friendly_tone(self, manager):
        """Test detecting friendly tone."""
        message = "Hi! Thanks for reaching out. This sounds great!"

        analysis = asyncio.run(manager.analyze_tone(message, use_llm=False))

        assert analysis.tone == MessageTone.FRIENDLY
        assert analysis.sentiment == "positive"

    def test_detect_enthusiastic_tone(self, manager):
        """Test detecting enthusiastic tone."""
        message = "I'm absolutely thrilled and excited about this amazing opportunity!"

        analysis = asyncio.run(manager.analyze_tone(message, use_llm=False))

        assert analysis.tone == MessageTone.ENTHUSIASTIC
        assert analysis.sentiment == "positive"

    def test_analyze_tone_with_llm(self, manager, mock_llm_client):
        """Test tone analysis using LLM."""
        message = "Test message for LLM analysis."

        analysis = asyncio.run(manager.analyze_tone(message, use_llm=True))

        assert mock_llm_client.chat.called
        assert isinstance(analysis, ToneAnalysis)


# ============================================================================
# Auto Reply Tests
# ============================================================================


class TestAutoReply:
    """Tests for auto-reply functionality."""

    def test_should_auto_reply_on_greeting(self, manager):
        """Test auto-reply trigger on greeting."""
        message = ClientMessage(
            id="msg-1",
            project_id="proj-123",
            conversation_id="conv-1",
            direction=MessageDirection.INBOUND,
            message_type=MessageType.QUESTION_RESPONSE,
            content="Hello there!",
            sender_id="client-456",
            sender_name="Test Client",
            timestamp=datetime.now(),
        )

        rule = asyncio.run(manager.should_auto_reply(message))

        assert rule is not None
        assert rule.name == "greeting"

    def test_should_auto_reply_on_timeline_question(self, manager):
        """Test auto-reply trigger on timeline question."""
        message = ClientMessage(
            id="msg-2",
            project_id="proj-123",
            conversation_id="conv-1",
            direction=MessageDirection.INBOUND,
            message_type=MessageType.QUESTION_RESPONSE,
            content="When can you deliver this project?",
            sender_id="client-456",
            sender_name="Test Client",
            timestamp=datetime.now(),
        )

        rule = asyncio.run(manager.should_auto_reply(message))

        assert rule is not None
        assert rule.name == "timeline"

    def test_should_not_auto_reply_outbound(self, manager):
        """Test that outbound messages don't trigger auto-reply."""
        message = ClientMessage(
            id="msg-3",
            project_id="proj-123",
            conversation_id="conv-1",
            direction=MessageDirection.OUTBOUND,
            message_type=MessageType.QUESTION_RESPONSE,
            content="Hello there!",
            sender_id="assistant",
            sender_name="AI Assistant",
            timestamp=datetime.now(),
        )

        rule = asyncio.run(manager.should_auto_reply(message))

        assert rule is None

    def test_send_auto_reply(self, manager):
        """Test sending an auto-reply."""
        message = ClientMessage(
            id="msg-4",
            project_id="proj-123",
            conversation_id="conv-1",
            direction=MessageDirection.INBOUND,
            message_type=MessageType.QUESTION_RESPONSE,
            content="Hello!",
            sender_id="client-456",
            sender_name="Test Client",
            timestamp=datetime.now(),
        )

        # Create conversation first
        asyncio.run(
            manager.get_or_create_conversation("proj-123", "client-456", "Test Client")
        )

        rule = AutoReplyRule(
            name="test_rule",
            template_name="question_response",
            delay_seconds=0,
        )

        variables = {
            "client_name": "Test Client",
            "project_title": "Test Project",
            "acknowledgment": "Thanks for your message.",
            "response_content": "This is an auto-reply.",
            "next_steps": "We'll be in touch.",
            "your_name": "AI Assistant",
        }

        reply = asyncio.run(manager.send_auto_reply(message, rule, variables))

        assert reply is not None
        assert "Test Client" in reply

    def test_auto_reply_disabled(self):
        """Test that auto-reply can be disabled."""
        manager = ClientCommunicationManager(enable_auto_reply=False)

        message = ClientMessage(
            id="msg-5",
            project_id="proj-123",
            conversation_id="conv-1",
            direction=MessageDirection.INBOUND,
            message_type=MessageType.QUESTION_RESPONSE,
            content="Hello!",
            sender_id="client-456",
            sender_name="Test Client",
            timestamp=datetime.now(),
        )

        rule = asyncio.run(manager.should_auto_reply(message))

        assert rule is None


# ============================================================================
# Conversation History Tests
# ============================================================================


class TestConversationHistory:
    """Tests for conversation history management."""

    def test_create_conversation(self, manager):
        """Test creating a new conversation."""
        conversation = asyncio.run(
            manager.get_or_create_conversation("proj-123", "client-456", "Test Client")
        )

        assert conversation.project_id == "proj-123"
        assert conversation.client_id == "client-456"
        assert conversation.client_name == "Test Client"
        assert conversation.status == "active"
        assert len(conversation.messages) == 0

    def test_reuse_existing_conversation(self, manager):
        """Test reusing an existing active conversation."""
        conv1 = asyncio.run(
            manager.get_or_create_conversation("proj-123", "client-456", "Test Client")
        )
        conv2 = asyncio.run(
            manager.get_or_create_conversation("proj-123", "client-456", "Test Client")
        )

        assert conv1.conversation_id == conv2.conversation_id

    def test_add_message_to_conversation(self, manager):
        """Test adding a message to a conversation."""
        conversation = asyncio.run(
            manager.get_or_create_conversation("proj-123", "client-456", "Test Client")
        )

        message = ClientMessage(
            id="msg-1",
            project_id="proj-123",
            conversation_id=conversation.conversation_id,
            direction=MessageDirection.INBOUND,
            message_type=MessageType.QUESTION_RESPONSE,
            content="Hello!",
            sender_id="client-456",
            sender_name="Test Client",
            timestamp=datetime.now(),
        )

        asyncio.run(manager.add_message_to_conversation(message))

        assert len(conversation.messages) == 1
        assert conversation.messages[0].content == "Hello!"

    def test_get_conversation_history(self, manager):
        """Test retrieving conversation history."""
        conversation = asyncio.run(
            manager.get_or_create_conversation("proj-123", "client-456", "Test Client")
        )

        # Add messages
        for i in range(5):
            message = ClientMessage(
                id=f"msg-{i}",
                project_id="proj-123",
                conversation_id=conversation.conversation_id,
                direction=MessageDirection.INBOUND,
                message_type=MessageType.QUESTION_RESPONSE,
                content=f"Message {i}",
                sender_id="client-456",
                sender_name="Test Client",
                timestamp=datetime.now(),
            )
            asyncio.run(manager.add_message_to_conversation(message))

        history = asyncio.run(manager.get_conversation_history(conversation.conversation_id))

        assert len(history) == 5

    def test_get_conversation_history_with_limit(self, manager):
        """Test retrieving conversation history with a limit."""
        conversation = asyncio.run(
            manager.get_or_create_conversation("proj-123", "client-456", "Test Client")
        )

        # Add messages
        for i in range(10):
            message = ClientMessage(
                id=f"msg-{i}",
                project_id="proj-123",
                conversation_id=conversation.conversation_id,
                direction=MessageDirection.INBOUND,
                message_type=MessageType.QUESTION_RESPONSE,
                content=f"Message {i}",
                sender_id="client-456",
                sender_name="Test Client",
                timestamp=datetime.now(),
            )
            asyncio.run(manager.add_message_to_conversation(message))

        history = asyncio.run(
            manager.get_conversation_history(conversation.conversation_id, limit=5)
        )

        assert len(history) == 5

    def test_get_recent_conversations(self, manager):
        """Test retrieving recent conversations."""
        # Create multiple conversations
        for i in range(5):
            asyncio.run(
                manager.get_or_create_conversation(f"proj-{i}", f"client-{i}", f"Client {i}")
            )

        recent = asyncio.run(manager.get_recent_conversations(hours=24, limit=3))

        assert len(recent) <= 3


# ============================================================================
# Message Sending Tests
# ============================================================================


class TestMessageSending:
    """Tests for message sending."""

    def test_send_message(self, manager):
        """Test sending a message."""
        # Create conversation first
        conversation = asyncio.run(
            manager.get_or_create_conversation("proj-123", "client-456", "Test Client")
        )

        content = "Thank you for your message. We'll review and get back to you soon."

        message = asyncio.run(
            manager.send_message(conversation.conversation_id, content)
        )

        assert message.direction == MessageDirection.OUTBOUND
        assert message.content == content
        assert message.sender_id == "assistant"

        # Check it was added to conversation
        assert len(conversation.messages) == 1


# ============================================================================
# WebSocket Integration Tests
# ============================================================================


class TestWebSocketIntegration:
    """Tests for WebSocket integration."""

    @pytest.mark.asyncio
    async def test_handle_inbound_message(self, manager):
        """Test handling inbound WebSocket message."""
        # Create conversation first
        await manager.get_or_create_conversation("proj-123", "client-456", "Test Client")

        data = {
            "type": "new_message",
            "message_id": "msg-1",
            "project_id": "proj-123",
            "conversation_id": "conv-1",
            "content": "Hello!",
            "sender_id": "client-456",
            "sender_name": "Test Client",
            "timestamp": datetime.now().isoformat(),
            "message_type": "question_response",
        }

        await manager.handle_websocket_message(data)

        # Check message was added
        conversation = manager.conversations.get("conv-1")
        # Note: This test assumes the conversation exists

    @pytest.mark.asyncio
    async def test_handle_conversation_update_close(self, manager):
        """Test handling conversation update (close)."""
        # Create conversation first
        conv = await manager.get_or_create_conversation("proj-123", "client-456", "Test Client")

        data = {
            "type": "conversation_update",
            "conversation_id": conv.conversation_id,
            "action": "close",
        }

        initial_count = manager.stats["conversations_active"]
        await manager.handle_websocket_message(data)

        assert conv.status == "closed"
        assert manager.stats["conversations_active"] == initial_count - 1


# ============================================================================
# Utility Tests
# ============================================================================


class TestUtilities:
    """Tests for utility methods."""

    def test_get_stats(self, manager):
        """Test getting statistics."""
        stats = manager.get_stats()

        assert "messages_sent" in stats
        assert "messages_received" in stats
        assert "auto_replies_sent" in stats
        assert "conversations_active" in stats
        assert "templates_count" in stats
        assert "auto_reply_rules" in stats

    def test_cleanup_old_conversations(self, manager):
        """Test cleaning up old conversations."""
        # This test would require mocking datetime or creating old conversations
        # For now, just test the method runs without error
        count = asyncio.run(manager.cleanup_old_conversations(days=30))

        assert isinstance(count, int)


# ============================================================================
# Factory Function Tests
# ============================================================================


class TestFactoryFunction:
    """Tests for factory function."""

    def test_create_client_communication_manager(self, mock_llm_client):
        """Test creating manager via factory function."""
        manager = create_client_communication_manager(
            llm_client=mock_llm_client,
            enable_auto_reply=True,
            enable_tone_analysis=True,
        )

        assert isinstance(manager, ClientCommunicationManager)
        assert manager.enable_auto_reply is True
        assert manager.enable_tone_analysis is True
