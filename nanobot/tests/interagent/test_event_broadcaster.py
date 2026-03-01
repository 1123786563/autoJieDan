"""
测试 WebSocket 事件广播增强
"""

import json
import pytest
from datetime import datetime
from unittest.mock import Mock, MagicMock
from typing import Any, Dict, List

from nanobot.interagent.event_broadcaster import (
    EventPriority,
    BroadcastEvent,
    SubscriptionFilter,
    Subscription,
    BroadcastStats,
    ClientConnection,
    EventBroadcasterConfig,
    EventBroadcaster,
    Topic,
    create_event_broadcaster,
    format_event,
    format_subscription,
    format_stats,
)


class MockWebSocket:
    """模拟 WebSocket"""

    def __init__(self):
        self.ready_state = 1  # OPEN
        self.sent_messages: List[Any] = []
        self.handlers: Dict[str, List[Any]] = {}
        self.closed = False

    def on(self, event: str, handler: Any) -> None:
        if event not in self.handlers:
            self.handlers[event] = []
        self.handlers[event].append(handler)

    def send(self, data: str) -> None:
        if self.closed:
            raise Exception("WebSocket is closed")
        self.sent_messages.append(json.loads(data))

    def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed = True
        self.ready_state = 3  # CLOSED
        for handler in self.handlers.get("close", []):
            if callable(handler):
                handler()

    def emit(self, event: str, data: Any = None) -> None:
        for handler in self.handlers.get(event, []):
            if callable(handler):
                handler(data)

    def get_sent_events(self) -> List[Dict]:
        return self.sent_messages

    def clear_sent(self) -> None:
        self.sent_messages = []


class TestEventBroadcaster:
    """测试事件广播器"""

    @pytest.fixture
    def broadcaster(self) -> EventBroadcaster:
        return create_event_broadcaster(
            EventBroadcasterConfig(
                batch_size=1,  # 禁用批处理
                event_history_size=100,
            )
        )

    def teardown_method(self) -> None:
        pass

    # ========================================================================
    # 连接管理
    # ========================================================================

    def test_register_client(self, broadcaster: EventBroadcaster):
        """测试注册客户端"""
        ws = MockWebSocket()
        connection = broadcaster.register_client(ws, "did:test:1")

        assert connection.did == "did:test:1"
        assert connection.authenticated is False
        assert broadcaster.get_connection_count() == 1

    def test_unregister_client(self, broadcaster: EventBroadcaster):
        """测试注销客户端"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")

        broadcaster.unregister_client("did:test:1")

        assert broadcaster.get_connection_count() == 0

    def test_get_client(self, broadcaster: EventBroadcaster):
        """测试获取客户端"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")

        client = broadcaster.get_client("did:test:1")
        assert client is not None
        assert client.did == "did:test:1"

    def test_get_all_clients(self, broadcaster: EventBroadcaster):
        """测试获取所有客户端"""
        ws1 = MockWebSocket()
        ws2 = MockWebSocket()
        broadcaster.register_client(ws1, "did:test:1")
        broadcaster.register_client(ws2, "did:test:2")

        clients = broadcaster.get_all_clients()
        assert len(clients) == 2

    def test_client_registered_event(self, broadcaster: EventBroadcaster):
        """测试客户端注册事件"""
        handler = Mock()
        broadcaster.on("client:registered", handler)

        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")

        handler.assert_called_once()

    # ========================================================================
    # 订阅管理
    # ========================================================================

    def test_create_subscription(self, broadcaster: EventBroadcaster):
        """测试创建订阅"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")

        subscription = broadcaster.subscribe(
            "did:test:1", SubscriptionFilter(types=["task.*"])
        )

        assert subscription.id is not None
        assert subscription.client_did == "did:test:1"
        assert subscription.active is True

    def test_cancel_subscription(self, broadcaster: EventBroadcaster):
        """测试取消订阅"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")

        subscription = broadcaster.subscribe("did:test:1", SubscriptionFilter())
        removed = broadcaster.unsubscribe(subscription.id)

        assert removed is True
        assert subscription.active is False

    def test_get_client_subscriptions(self, broadcaster: EventBroadcaster):
        """测试获取客户端订阅"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")

        broadcaster.subscribe("did:test:1", SubscriptionFilter(types=["task.*"]))
        broadcaster.subscribe("did:test:1", SubscriptionFilter(types=["resource.*"]))

        subs = broadcaster.get_subscriptions("did:test:1")
        assert len(subs) == 2

    def test_get_active_subscription_count(self, broadcaster: EventBroadcaster):
        """测试获取活跃订阅数"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")

        broadcaster.subscribe("did:test:1", SubscriptionFilter())
        broadcaster.subscribe("did:test:1", SubscriptionFilter())

        assert broadcaster.get_active_subscription_count() == 2

    def test_subscription_created_event(self, broadcaster: EventBroadcaster):
        """测试订阅创建事件"""
        handler = Mock()
        broadcaster.on("subscription:created", handler)

        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")
        broadcaster.subscribe("did:test:1", SubscriptionFilter())

        handler.assert_called_once()

    # ========================================================================
    # 事件发布
    # ========================================================================

    def test_publish_event(self, broadcaster: EventBroadcaster):
        """测试发布事件"""
        event = broadcaster.publish(
            type="task.created",
            source="test",
            priority="normal",
            payload={"taskId": "task-1"},
            require_ack=False,
        )

        assert event.id is not None
        assert isinstance(event.timestamp, datetime)
        assert event.type == "task.created"

    def test_event_published_event(self, broadcaster: EventBroadcaster):
        """测试事件发布事件"""
        handler = Mock()
        broadcaster.on("event:published", handler)

        broadcaster.publish(
            type="test.event",
            source="test",
            priority="normal",
            payload={},
            require_ack=False,
        )

        handler.assert_called_once()

    def test_store_event_history(self, broadcaster: EventBroadcaster):
        """测试存储事件历史"""
        broadcaster.publish(
            type="test.event",
            source="test",
            priority="normal",
            payload={},
            require_ack=False,
        )

        history = broadcaster.get_event_history()
        assert len(history) == 1

    def test_limit_event_history(self, broadcaster: EventBroadcaster):
        """测试限制事件历史"""
        small_broadcaster = create_event_broadcaster(
            EventBroadcasterConfig(event_history_size=5)
        )

        for i in range(10):
            small_broadcaster.publish(
                type="test.event",
                source="test",
                priority="normal",
                payload={"index": i},
                require_ack=False,
            )

        history = small_broadcaster.get_event_history()
        assert len(history) <= 5

        small_broadcaster.close_all()

    # ========================================================================
    # 事件路由
    # ========================================================================

    def test_route_event_to_matching_subscription(self, broadcaster: EventBroadcaster):
        """测试路由事件到匹配订阅"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")
        broadcaster.subscribe("did:test:1", SubscriptionFilter(types=["task.*"]))

        broadcaster.publish(
            type="task.created",
            source="test",
            priority="normal",
            payload={},
            require_ack=False,
        )

        assert len(ws.get_sent_events()) > 0

    def test_not_route_event_to_non_matching_subscription(
        self, broadcaster: EventBroadcaster
    ):
        """测试不路由到不匹配订阅"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")
        broadcaster.subscribe("did:test:1", SubscriptionFilter(types=["resource.*"]))

        broadcaster.publish(
            type="task.created",
            source="test",
            priority="normal",
            payload={},
            require_ack=False,
        )

        assert len(ws.get_sent_events()) == 0

    def test_route_to_target_client_only(self, broadcaster: EventBroadcaster):
        """测试只路由到目标客户端"""
        ws1 = MockWebSocket()
        ws2 = MockWebSocket()
        broadcaster.register_client(ws1, "did:test:1")
        broadcaster.register_client(ws2, "did:test:2")
        broadcaster.subscribe("did:test:1", SubscriptionFilter())
        broadcaster.subscribe("did:test:2", SubscriptionFilter())

        broadcaster.publish(
            type="test.event",
            source="test",
            priority="normal",
            payload={},
            require_ack=False,
            target="did:test:1",
        )

        assert len(ws1.get_sent_events()) > 0
        assert len(ws2.get_sent_events()) == 0

    def test_filter_by_source(self, broadcaster: EventBroadcaster):
        """测试按来源过滤"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")
        broadcaster.subscribe("did:test:1", SubscriptionFilter(sources=["source-a"]))

        broadcaster.publish(
            type="test.event",
            source="source-b",
            priority="normal",
            payload={},
            require_ack=False,
        )

        assert len(ws.get_sent_events()) == 0

    def test_filter_by_priority(self, broadcaster: EventBroadcaster):
        """测试按优先级过滤"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")
        broadcaster.subscribe(
            "did:test:1", SubscriptionFilter(priorities=["high", "critical"])
        )

        broadcaster.publish(
            type="test.event",
            source="test",
            priority="low",
            payload={},
            require_ack=False,
        )

        assert len(ws.get_sent_events()) == 0

    def test_use_custom_filter(self, broadcaster: EventBroadcaster):
        """测试使用自定义过滤"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")
        broadcaster.subscribe(
            "did:test:1",
            SubscriptionFilter(custom=lambda e: e.payload.get("important") is True),
        )

        broadcaster.publish(
            type="test.event",
            source="test",
            priority="normal",
            payload={"important": False},
            require_ack=False,
        )

        assert len(ws.get_sent_events()) == 0

    def test_match_wildcard_patterns(self, broadcaster: EventBroadcaster):
        """测试匹配通配符模式"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")
        broadcaster.subscribe("did:test:1", SubscriptionFilter(types=["task.*"]))

        broadcaster.publish(
            type="task.progress",
            source="test",
            priority="normal",
            payload={},
            require_ack=False,
        )

        assert len(ws.get_sent_events()) > 0

    # ========================================================================
    # 广播和发送
    # ========================================================================

    def test_broadcast_to_all_clients(self, broadcaster: EventBroadcaster):
        """测试广播给所有客户端"""
        ws1 = MockWebSocket()
        ws2 = MockWebSocket()
        broadcaster.register_client(ws1, "did:test:1")
        broadcaster.register_client(ws2, "did:test:2")
        broadcaster.subscribe("did:test:1", SubscriptionFilter())
        broadcaster.subscribe("did:test:2", SubscriptionFilter())

        sent = broadcaster.broadcast(
            type="test.broadcast",
            source="test",
            priority="normal",
            payload={},
            require_ack=False,
        )

        assert sent > 0

    def test_send_to_specific_client(self, broadcaster: EventBroadcaster):
        """测试发送给特定客户端"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")
        broadcaster.subscribe("did:test:1", SubscriptionFilter())

        result = broadcaster.send_to(
            target_did="did:test:1",
            type="test.direct",
            source="test",
            priority="normal",
            payload={},
            require_ack=False,
        )

        assert result is True

    # ========================================================================
    # 统计
    # ========================================================================

    def test_track_event_stats(self, broadcaster: EventBroadcaster):
        """测试跟踪事件统计"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")
        broadcaster.subscribe("did:test:1", SubscriptionFilter())

        broadcaster.publish(
            type="task.created",
            source="source-a",
            priority="normal",
            payload={},
            require_ack=False,
        )

        stats = broadcaster.get_stats()

        assert stats.total_events_received == 1
        assert stats.by_type.get("task.created") == 1
        assert stats.by_source.get("source-a") == 1

    def test_reset_stats(self, broadcaster: EventBroadcaster):
        """测试重置统计"""
        broadcaster.publish(
            type="test.event",
            source="test",
            priority="normal",
            payload={},
            require_ack=False,
        )

        broadcaster.reset_stats()
        stats = broadcaster.get_stats()

        assert stats.total_events_received == 0

    # ========================================================================
    # 事件历史
    # ========================================================================

    def test_filter_history_by_type(self, broadcaster: EventBroadcaster):
        """测试按类型过滤历史"""
        broadcaster.publish(
            type="task.created",
            source="test",
            priority="normal",
            payload={},
            require_ack=False,
        )
        broadcaster.publish(
            type="resource.snapshot",
            source="test",
            priority="normal",
            payload={},
            require_ack=False,
        )

        history = broadcaster.get_event_history(types=["task.created"])

        assert len(history) == 1
        assert history[0].type == "task.created"

    def test_filter_history_by_source(self, broadcaster: EventBroadcaster):
        """测试按来源过滤历史"""
        broadcaster.publish(
            type="test.event",
            source="source-a",
            priority="normal",
            payload={},
            require_ack=False,
        )
        broadcaster.publish(
            type="test.event",
            source="source-b",
            priority="normal",
            payload={},
            require_ack=False,
        )

        history = broadcaster.get_event_history(sources=["source-a"])

        assert len(history) == 1

    def test_filter_history_by_time(self, broadcaster: EventBroadcaster):
        """测试按时间过滤历史"""
        old_date = datetime.fromtimestamp(datetime.now().timestamp() - 10000)

        broadcaster.publish(
            type="test.event",
            source="test",
            priority="normal",
            payload={},
            require_ack=False,
        )

        history = broadcaster.get_event_history(since=old_date)

        assert len(history) > 0

    def test_limit_history_results(self, broadcaster: EventBroadcaster):
        """测试限制历史结果"""
        for i in range(10):
            broadcaster.publish(
                type="test.event",
                source="test",
                priority="normal",
                payload={"index": i},
                require_ack=False,
            )

        history = broadcaster.get_event_history(limit=3)

        assert len(history) == 3

    # ========================================================================
    # 主题
    # ========================================================================

    def test_get_topics(self, broadcaster: EventBroadcaster):
        """测试获取主题"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")
        broadcaster.subscribe("did:test:1", SubscriptionFilter(types=["task.*"]))
        broadcaster.subscribe("did:test:1", SubscriptionFilter(types=["resource.*"]))

        topics = broadcaster.get_topics()

        assert len(topics) > 0

    def test_get_topic_subscribers(self, broadcaster: EventBroadcaster):
        """测试获取主题订阅者"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")
        broadcaster.subscribe("did:test:1", SubscriptionFilter(types=["task.*"]))

        subscribers = broadcaster.get_topic_subscribers("task.created")

        assert "did:test:1" in subscribers

    # ========================================================================
    # 摘要
    # ========================================================================

    def test_get_summary(self, broadcaster: EventBroadcaster):
        """测试获取摘要"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")
        broadcaster.subscribe("did:test:1", SubscriptionFilter())

        summary = broadcaster.get_summary()

        assert summary["connections"] == 1
        assert summary["subscriptions"] == 1
        assert summary["stats"] is not None

    # ========================================================================
    # 消息处理
    # ========================================================================

    def test_handle_client_message_subscribe(self, broadcaster: EventBroadcaster):
        """测试处理客户端消息 - 订阅"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")

        broadcaster._handle_client_message(
            "did:test:1", json.dumps({"type": "subscribe", "filter": {"types": ["task.*"]}})
        )

        subs = broadcaster.get_subscriptions("did:test:1")
        assert len(subs) > 0

    def test_handle_client_message_unsubscribe(self, broadcaster: EventBroadcaster):
        """测试处理客户端消息 - 取消订阅"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")
        sub = broadcaster.subscribe("did:test:1", SubscriptionFilter())

        broadcaster._handle_client_message(
            "did:test:1", json.dumps({"type": "unsubscribe", "subscriptionId": sub.id})
        )

        assert sub.active is False

    def test_handle_client_message_event(self, broadcaster: EventBroadcaster):
        """测试处理客户端消息 - 事件"""
        handler = Mock()
        broadcaster.on("event:published", handler)

        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")

        broadcaster._handle_client_message(
            "did:test:1",
            json.dumps(
                {
                    "type": "event",
                    "eventType": "test.event",
                    "priority": "normal",
                    "payload": {},
                    "requireAck": False,
                }
            ),
        )

        handler.assert_called_once()

    def test_handle_client_message_ping(self, broadcaster: EventBroadcaster):
        """测试处理客户端消息 - ping"""
        ws = MockWebSocket()
        broadcaster.register_client(ws, "did:test:1")
        ws.clear_sent()

        broadcaster._handle_client_message("did:test:1", json.dumps({"type": "ping"}))

        events = ws.get_sent_events()
        assert any(e.get("type") == "pong" for e in events)


class TestFactoryFunctions:
    """测试工厂函数"""

    def test_create_event_broadcaster(self):
        """测试创建事件广播器"""
        broadcaster = create_event_broadcaster()
        assert isinstance(broadcaster, EventBroadcaster)

    def test_create_with_config(self):
        """测试使用配置创建"""
        config = EventBroadcasterConfig(
            batch_size=10,
            event_history_size=50,
        )
        broadcaster = create_event_broadcaster(config)
        assert isinstance(broadcaster, EventBroadcaster)


class TestFormatFunctions:
    """测试格式化函数"""

    def test_format_event(self):
        """测试格式化事件"""
        event = BroadcastEvent(
            id="evt-1",
            type="task.created",
            timestamp=datetime(2026, 2, 26, 12, 0, 0),
            source="test-source",
            priority="normal",
            payload={"taskId": "task-1"},
            metadata={},
            require_ack=False,
        )

        formatted = format_event(event)

        assert "evt-1" in formatted
        assert "task.created" in formatted
        assert "test-source" in formatted
        assert "normal" in formatted

    def test_format_event_with_target(self):
        """测试格式化带目标的事件"""
        event = BroadcastEvent(
            id="evt-2",
            type="test.event",
            timestamp=datetime.now(),
            source="source",
            target="did:test:1",
            priority="high",
            payload={},
            metadata={},
            require_ack=False,
        )

        formatted = format_event(event)

        assert "did:test:1" in formatted
        assert "high" in formatted

    def test_format_event_with_correlation_id(self):
        """测试格式化带关联 ID 的事件"""
        event = BroadcastEvent(
            id="evt-3",
            type="test.event",
            timestamp=datetime.now(),
            source="source",
            priority="normal",
            payload={},
            correlation_id="corr-123",
            metadata={},
            require_ack=False,
        )

        formatted = format_event(event)

        assert "corr-123" in formatted

    def test_format_subscription(self):
        """测试格式化订阅"""
        subscription = Subscription(
            id="sub-1",
            client_did="did:test:1",
            filter=SubscriptionFilter(types=["task.*"]),
            created_at=datetime(2026, 2, 26, 12, 0, 0),
            last_active_at=datetime.now(),
            event_count=10,
            active=True,
        )

        formatted = format_subscription(subscription)

        assert "sub-1" in formatted
        assert "did:test:1" in formatted
        assert "活跃" in formatted
        assert "task.*" in formatted

    def test_format_inactive_subscription(self):
        """测试格式化非活跃订阅"""
        subscription = Subscription(
            id="sub-2",
            client_did="did:test:1",
            filter=SubscriptionFilter(),
            created_at=datetime.now(),
            last_active_at=datetime.now(),
            event_count=0,
            active=False,
        )

        formatted = format_subscription(subscription)

        assert "已取消" in formatted

    def test_format_stats(self):
        """测试格式化统计"""
        stats = BroadcastStats(
            total_events_sent=100,
            total_events_received=100,
            active_subscriptions=5,
            by_type={"task.created": 50, "task.completed": 50},
            by_source={"source-a": 60, "source-b": 40},
            failed_sends=2,
            avg_send_time_ms=1.5,
        )

        formatted = format_stats(stats)

        assert "100" in formatted
        assert "5" in formatted
        assert "1.50ms" in formatted
        assert "task.created" in formatted
        assert "source-a" in formatted
