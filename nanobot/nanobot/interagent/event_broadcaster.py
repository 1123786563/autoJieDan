"""
WebSocket 事件广播增强
提供订阅/发布、事件过滤、主题路由等功能

@module interagent/event_broadcaster
@version 1.0.0
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set
from weakref import WeakMethod


class EventEmitter:
    """
    简单的事件发射器
    提供事件订阅/发布功能
    """

    def __init__(self):
        self._listeners: Dict[str, List[Callable]] = {}
        self._once_listeners: Dict[str, List[Callable]] = {}

    def on(self, event: str, handler: Callable) -> None:
        """订阅事件"""
        if event not in self._listeners:
            self._listeners[event] = []
        self._listeners[event].append(handler)

    def once(self, event: str, handler: Callable) -> None:
        """订阅一次性事件"""
        if event not in self._once_listeners:
            self._once_listeners[event] = []
        self._once_listeners[event].append(handler)

    def off(self, event: str, handler: Optional[Callable] = None) -> None:
        """取消订阅"""
        if handler is None:
            self._listeners.pop(event, None)
            self._once_listeners.pop(event, None)
        else:
            if event in self._listeners and handler in self._listeners[event]:
                self._listeners[event].remove(handler)
            if event in self._once_listeners and handler in self._once_listeners[event]:
                self._once_listeners[event].remove(handler)

    def emit(self, event: str, *args, **kwargs) -> None:
        """发射事件"""
        # 普通监听器
        for handler in self._listeners.get(event, []):
            try:
                handler(*args, **kwargs)
            except Exception:
                pass

        # 一次性监听器
        once_handlers = self._once_listeners.pop(event, [])
        for handler in once_handlers:
            try:
                handler(*args, **kwargs)
            except Exception:
                pass


class EventPriority(str, Enum):
    """事件优先级"""

    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class BroadcastEvent:
    """广播事件"""

    id: str
    type: str
    timestamp: datetime
    source: str
    priority: str
    payload: Dict[str, Any]
    metadata: Dict[str, Any] = field(default_factory=dict)
    require_ack: bool = False
    target: Optional[str] = None
    correlation_id: Optional[str] = None
    ttl: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        result = {
            "id": self.id,
            "type": self.type,
            "timestamp": self.timestamp.isoformat(),
            "source": self.source,
            "priority": self.priority,
            "payload": self.payload,
            "metadata": self.metadata,
            "requireAck": self.require_ack,
        }
        if self.target:
            result["target"] = self.target
        if self.correlation_id:
            result["correlationId"] = self.correlation_id
        if self.ttl:
            result["ttl"] = self.ttl
        return result


@dataclass
class SubscriptionFilter:
    """订阅过滤器"""

    types: Optional[List[str]] = None
    sources: Optional[List[str]] = None
    priorities: Optional[List[str]] = None
    custom: Optional[Callable[[BroadcastEvent], bool]] = None


@dataclass
class Subscription:
    """订阅信息"""

    id: str
    client_did: str
    filter: SubscriptionFilter
    created_at: datetime
    last_active_at: datetime
    event_count: int = 0
    active: bool = True

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "id": self.id,
            "clientDid": self.client_did,
            "filter": {
                "types": self.filter.types,
                "sources": self.filter.sources,
                "priorities": self.filter.priorities,
            },
            "createdAt": self.created_at.isoformat(),
            "lastActiveAt": self.last_active_at.isoformat(),
            "eventCount": self.event_count,
            "active": self.active,
        }


@dataclass
class BroadcastStats:
    """广播统计"""

    total_events_sent: int = 0
    total_events_received: int = 0
    active_subscriptions: int = 0
    by_type: Dict[str, int] = field(default_factory=dict)
    by_source: Dict[str, int] = field(default_factory=dict)
    failed_sends: int = 0
    avg_send_time_ms: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "totalEventsSent": self.total_events_sent,
            "totalEventsReceived": self.total_events_received,
            "activeSubscriptions": self.active_subscriptions,
            "byType": self.by_type,
            "bySource": self.by_source,
            "failedSends": self.failed_sends,
            "avgSendTimeMs": self.avg_send_time_ms,
        }


@dataclass
class ClientConnection:
    """客户端连接信息"""

    ws: Any  # WebSocket 连接
    did: str
    subscriptions: Set[str] = field(default_factory=set)
    connected_at: datetime = field(default_factory=datetime.now)
    last_activity: datetime = field(default_factory=datetime.now)
    queue_size: int = 0
    authenticated: bool = False


@dataclass
class EventBroadcasterConfig:
    """事件广播器配置"""

    max_queue_size: int = 1000
    event_history_size: int = 100
    batch_size: int = 50
    batch_interval_ms: int = 100
    enable_persistence: bool = False
    heartbeat_interval_ms: int = 30000
    connection_timeout_ms: int = 60000


@dataclass
class Topic:
    """主题定义"""

    name: str
    pattern: str
    subscriber_count: int
    description: Optional[str] = None


class EventBroadcaster(EventEmitter):
    """
    WebSocket 事件广播器
    管理事件订阅、过滤和广播
    """

    def __init__(self, config: Optional[EventBroadcasterConfig] = None):
        super().__init__()
        self.config = config or EventBroadcasterConfig()
        self._connections: Dict[str, ClientConnection] = {}
        self._subscriptions: Dict[str, Subscription] = {}
        self._event_history: List[BroadcastEvent] = []
        self._stats = BroadcastStats()
        self._id_counter = 0
        self._batch_queue: Dict[str, List[BroadcastEvent]] = {}
        self._batch_timer: Optional[float] = None
        self._heartbeat_timer: Optional[float] = None

    # ============================================================================
    # 连接管理
    # ============================================================================

    def register_client(self, ws: Any, did: str) -> ClientConnection:
        """注册客户端连接"""
        connection = ClientConnection(
            ws=ws,
            did=did,
            subscriptions=set(),
            connected_at=datetime.now(),
            last_activity=datetime.now(),
            queue_size=0,
            authenticated=False,
        )

        self._connections[did] = connection

        # 设置 WebSocket 事件处理
        # 注意: Python WebSocket 库的实现可能不同，这里使用通用接口
        if hasattr(ws, "on_close"):
            ws.on_close = lambda: self.unregister_client(did)
        if hasattr(ws, "on_message"):
            original_handler = ws.on_message
            ws.on_message = lambda data: (
                self._handle_client_message(did, data),
                original_handler(data) if original_handler else None,
            )

        self.emit("client:registered", {"did": did, "connection": connection})

        return connection

    def unregister_client(self, did: str) -> None:
        """注销客户端连接"""
        connection = self._connections.get(did)
        if not connection:
            return

        # 清理订阅
        for sub_id in connection.subscriptions:
            sub = self._subscriptions.get(sub_id)
            if sub:
                sub.active = False

        del self._connections[did]
        if did in self._batch_queue:
            del self._batch_queue[did]

        self.emit("client:unregistered", {"did": did})

    def get_client(self, did: str) -> Optional[ClientConnection]:
        """获取客户端连接"""
        return self._connections.get(did)

    def get_all_clients(self) -> List[ClientConnection]:
        """获取所有连接"""
        return list(self._connections.values())

    def get_connection_count(self) -> int:
        """获取连接数"""
        return len(self._connections)

    # ============================================================================
    # 订阅管理
    # ============================================================================

    def subscribe(self, client_did: str, filter_obj: SubscriptionFilter) -> Subscription:
        """创建订阅"""
        subscription = Subscription(
            id=self._generate_id("sub"),
            client_did=client_did,
            filter=filter_obj,
            created_at=datetime.now(),
            last_active_at=datetime.now(),
            event_count=0,
            active=True,
        )

        self._subscriptions[subscription.id] = subscription

        connection = self._connections.get(client_did)
        if connection:
            connection.subscriptions.add(subscription.id)

        self.emit("subscription:created", {"subscription": subscription})

        return subscription

    def unsubscribe(self, subscription_id: str) -> bool:
        """取消订阅"""
        subscription = self._subscriptions.get(subscription_id)
        if not subscription:
            return False

        subscription.active = False

        connection = self._connections.get(subscription.client_did)
        if connection:
            connection.subscriptions.discard(subscription_id)

        self.emit("subscription:cancelled", {"subscriptionId": subscription_id})

        return True

    def get_subscriptions(self, client_did: str) -> List[Subscription]:
        """获取客户端订阅"""
        connection = self._connections.get(client_did)
        if not connection:
            return []

        return [
            self._subscriptions[sub_id]
            for sub_id in connection.subscriptions
            if sub_id in self._subscriptions and self._subscriptions[sub_id].active
        ]

    def get_active_subscription_count(self) -> int:
        """获取活跃订阅数"""
        return sum(1 for s in self._subscriptions.values() if s.active)

    # ============================================================================
    # 事件发布
    # ============================================================================

    def publish(
        self,
        type: str,
        source: str,
        priority: str,
        payload: Dict[str, Any],
        require_ack: bool = False,
        target: Optional[str] = None,
        correlation_id: Optional[str] = None,
        ttl: Optional[int] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> BroadcastEvent:
        """发布事件"""
        full_event = BroadcastEvent(
            id=self._generate_id("evt"),
            type=type,
            timestamp=datetime.now(),
            source=source,
            priority=priority,
            payload=payload,
            metadata=metadata or {},
            require_ack=require_ack,
            target=target,
            correlation_id=correlation_id,
            ttl=ttl,
        )

        # 记录统计
        self._stats.total_events_received += 1
        self._stats.by_type[type] = self._stats.by_type.get(type, 0) + 1
        self._stats.by_source[source] = self._stats.by_source.get(source, 0) + 1

        # 保存历史
        self._event_history.append(full_event)
        if len(self._event_history) > self.config.event_history_size:
            self._event_history.pop(0)

        # 路由到订阅者
        self._route_event(full_event)

        # 发送事件
        self.emit("event:published", full_event)

        return full_event

    def broadcast(
        self,
        type: str,
        source: str,
        priority: str,
        payload: Dict[str, Any],
        require_ack: bool = False,
    ) -> int:
        """广播给所有客户端"""
        event = self.publish(
            type=type,
            source=source,
            priority=priority,
            payload=payload,
            require_ack=require_ack,
            target="*",
        )
        return event.metadata.get("sentCount", 0)

    def send_to(
        self,
        target_did: str,
        type: str,
        source: str,
        priority: str,
        payload: Dict[str, Any],
        require_ack: bool = False,
    ) -> bool:
        """发送给指定客户端"""
        event = self.publish(
            type=type,
            source=source,
            priority=priority,
            payload=payload,
            require_ack=require_ack,
            target=target_did,
        )
        return event.metadata.get("sentCount", 0) > 0

    # ============================================================================
    # 事件路由
    # ============================================================================

    def _route_event(self, event: BroadcastEvent) -> None:
        """路由事件到订阅者"""
        targets = self._get_event_targets(event)
        sent_count = 0

        for target in targets:
            connection = self._connections.get(target)
            if not connection:
                continue

            # 检查 WebSocket 状态
            if hasattr(connection.ws, "ready_state"):
                # 针对不同 WebSocket 库的状态检查
                if hasattr(connection.ws.ready_state, "value"):
                    # websockets 库
                    if connection.ws.ready_state.value != 1:  # OPEN
                        continue
                elif connection.ws.ready_state != 1:  # OPEN for websocket-client
                    continue

            # 直接目标的事件跳过订阅匹配
            is_direct_target = event.target and event.target != "*"
            if not is_direct_target and not self._matches_subscriptions(target, event):
                continue

            # 加入批量队列或直接发送
            if self.config.batch_size > 1:
                self._add_to_batch(target, event)
            else:
                if self._send_to_connection(connection, event):
                    sent_count += 1

        event.metadata["sentCount"] = sent_count

    def _get_event_targets(self, event: BroadcastEvent) -> List[str]:
        """获取事件目标"""
        if event.target and event.target != "*":
            return [event.target]

        # 广播给所有客户端
        return list(self._connections.keys())

    def _matches_subscriptions(self, client_did: str, event: BroadcastEvent) -> bool:
        """检查事件是否匹配客户端订阅"""
        connection = self._connections.get(client_did)
        if not connection:
            return False

        for sub_id in connection.subscriptions:
            subscription = self._subscriptions.get(sub_id)
            if not subscription or not subscription.active:
                continue

            if self._matches_filter(event, subscription.filter):
                subscription.last_active_at = datetime.now()
                subscription.event_count += 1
                return True

        return False

    def _matches_filter(self, event: BroadcastEvent, filter_obj: SubscriptionFilter) -> bool:
        """检查事件是否匹配过滤器"""
        # 类型过滤
        if filter_obj.types:
            if not any(self._match_pattern(event.type, pattern) for pattern in filter_obj.types):
                return False

        # 来源过滤
        if filter_obj.sources:
            if event.source not in filter_obj.sources:
                return False

        # 优先级过滤
        if filter_obj.priorities:
            if event.priority not in filter_obj.priorities:
                return False

        # 自定义过滤
        if filter_obj.custom:
            return filter_obj.custom(event)

        return True

    def _match_pattern(self, value: str, pattern: str) -> bool:
        """模式匹配 (支持 * 通配符)"""
        if pattern == "*":
            return True
        if "*" in pattern:
            regex_pattern = "^" + pattern.replace("*", ".*") + "$"
            return bool(re.match(regex_pattern, value))
        return value == pattern

    # ============================================================================
    # 发送逻辑
    # ============================================================================

    def _send_to_connection(self, connection: ClientConnection, event: BroadcastEvent) -> bool:
        """发送事件到连接"""
        start_time = time.time()

        try:
            message = json.dumps(event.to_dict())
            # 不同 WebSocket 库的发送方法
            if hasattr(connection.ws, "send"):
                if callable(connection.ws.send):
                    import asyncio

                    if asyncio.iscoroutinefunction(connection.ws.send):
                        # 异步发送 - 需要在事件循环中处理
                        pass
                    else:
                        connection.ws.send(message)
            elif hasattr(connection.ws, "send_str"):
                connection.ws.send_str(message)

            connection.last_activity = datetime.now()
            connection.queue_size = max(0, connection.queue_size - 1)

            self._stats.total_events_sent += 1
            self._update_send_time((time.time() - start_time) * 1000)

            return True
        except Exception as error:
            self._stats.failed_sends += 1
            self.emit("send:error", {"did": connection.did, "error": error, "event": event})
            return False

    def _add_to_batch(self, client_did: str, event: BroadcastEvent) -> None:
        """添加到批量队列"""
        if client_did not in self._batch_queue:
            self._batch_queue[client_did] = []

        queue = self._batch_queue[client_did]
        queue.append(event)

        # 限制队列大小
        if len(queue) > self.config.max_queue_size:
            queue.pop(0)

    def _flush_batches(self) -> None:
        """刷新所有批量队列"""
        for did, events in self._batch_queue.items():
            if not events:
                continue

            connection = self._connections.get(did)
            if not connection:
                continue

            # 批量发送
            batch = events[: self.config.batch_size]
            del events[: self.config.batch_size]

            batch_message = json.dumps({"type": "batch", "events": [e.to_dict() for e in batch]})

            try:
                if hasattr(connection.ws, "send"):
                    connection.ws.send(batch_message)
                connection.last_activity = datetime.now()
                connection.queue_size = len(events)
                self._stats.total_events_sent += len(batch)
            except Exception as error:
                self._stats.failed_sends += len(batch)
                self.emit("send:error", {"did": did, "error": error})

    # ============================================================================
    # 客户端消息处理
    # ============================================================================

    def _handle_client_message(self, did: str, data: Any) -> None:
        """处理客户端消息"""
        connection = self._connections.get(did)
        if not connection:
            return

        connection.last_activity = datetime.now()

        try:
            if isinstance(data, bytes):
                data = data.decode("utf-8")
            message = json.loads(data)

            msg_type = message.get("type")

            if msg_type == "subscribe":
                filter_data = message.get("filter", {})
                filter_obj = SubscriptionFilter(
                    types=filter_data.get("types"),
                    sources=filter_data.get("sources"),
                    priorities=filter_data.get("priorities"),
                )
                self.subscribe(did, filter_obj)

            elif msg_type == "unsubscribe":
                subscription_id = message.get("subscriptionId")
                if subscription_id:
                    self.unsubscribe(subscription_id)

            elif msg_type == "ack":
                event_id = message.get("eventId")
                if event_id:
                    self.emit(f"ack:{event_id}", did)

            elif msg_type == "event":
                # 客户端发布事件
                self.publish(
                    type=message.get("eventType", message.get("type")),
                    source=did,
                    priority=message.get("priority", "normal"),
                    payload=message.get("payload", {}),
                    require_ack=message.get("requireAck", False),
                )

            elif msg_type == "ping":
                self.send_to(
                    target_did=did,
                    type="pong",
                    source="broadcaster",
                    priority="high",
                    payload={},
                    require_ack=False,
                )

        except Exception as error:
            self.emit("message:error", {"did": did, "error": error})

    # ============================================================================
    # 主题管理
    # ============================================================================

    def get_topics(self) -> List[Topic]:
        """获取主题列表"""
        topic_map: Dict[str, int] = {}

        for subscription in self._subscriptions.values():
            if not subscription.active:
                continue

            types = subscription.filter.types or ["*"]
            for type_name in types:
                topic_map[type_name] = topic_map.get(type_name, 0) + 1

        return [
            Topic(name=name, pattern=name, subscriber_count=count)
            for name, count in topic_map.items()
        ]

    def get_topic_subscribers(self, topic: str) -> List[str]:
        """获取主题订阅者"""
        subscribers: List[str] = []

        for subscription in self._subscriptions.values():
            if not subscription.active:
                continue

            types = subscription.filter.types or []
            if any(self._match_pattern(topic, t) for t in types):
                subscribers.append(subscription.client_did)

        return subscribers

    # ============================================================================
    # 历史和重放
    # ============================================================================

    def get_event_history(
        self,
        types: Optional[List[str]] = None,
        sources: Optional[List[str]] = None,
        since: Optional[datetime] = None,
        limit: Optional[int] = None,
    ) -> List[BroadcastEvent]:
        """获取事件历史"""
        events = list(self._event_history)

        if types:
            events = [e for e in events if e.type in types]
        if sources:
            events = [e for e in events if e.source in sources]
        if since:
            events = [e for e in events if e.timestamp >= since]
        if limit:
            events = events[-limit:]

        return events

    def replay_history(self, client_did: str, filter_obj: Optional[SubscriptionFilter] = None) -> int:
        """重放历史事件给客户端"""
        connection = self._connections.get(client_did)
        if not connection:
            return 0

        history = self.get_event_history()
        sent = 0

        for event in history:
            if filter_obj and not self._matches_filter(event, filter_obj):
                continue

            if self._send_to_connection(connection, event):
                sent += 1

        return sent

    # ============================================================================
    # 统计
    # ============================================================================

    def get_stats(self) -> BroadcastStats:
        """获取统计"""
        self._stats.active_subscriptions = self.get_active_subscription_count()
        return self._stats

    def reset_stats(self) -> None:
        """重置统计"""
        self._stats = BroadcastStats()

    def _update_send_time(self, time_ms: float) -> None:
        """更新平均发送时间"""
        total = self._stats.total_events_sent
        if total > 0:
            self._stats.avg_send_time_ms = (
                (self._stats.avg_send_time_ms * (total - 1) + time_ms) / total
            )

    # ============================================================================
    # 辅助方法
    # ============================================================================

    def _generate_id(self, prefix: str) -> str:
        """生成 ID"""
        self._id_counter += 1
        return f"{prefix}_{int(time.time() * 1000)}_{self._id_counter}"

    def close_all(self) -> None:
        """关闭所有连接"""
        for did, connection in self._connections.items():
            try:
                if hasattr(connection.ws, "close"):
                    connection.ws.close(1001, "Server shutting down")
            except Exception:
                pass

        self._connections.clear()
        self._subscriptions.clear()
        self._batch_queue.clear()
        self._event_history.clear()

    def get_summary(self) -> Dict[str, Any]:
        """获取摘要"""
        return {
            "connections": len(self._connections),
            "subscriptions": self.get_active_subscription_count(),
            "topics": len(self.get_topics()),
            "eventHistory": len(self._event_history),
            "stats": self.get_stats().to_dict(),
        }


# ============================================================================
# 工厂函数
# ============================================================================


def create_event_broadcaster(config: Optional[EventBroadcasterConfig] = None) -> EventBroadcaster:
    """创建事件广播器"""
    return EventBroadcaster(config)


# ============================================================================
# 格式化函数
# ============================================================================


def format_event(event: BroadcastEvent) -> str:
    """格式化事件"""
    lines = [
        "=== 事件 ===",
        f"ID: {event.id}",
        f"类型: {event.type}",
        f"来源: {event.source}",
        f"目标: {event.target or '广播'}",
        f"优先级: {event.priority}",
        f"时间: {event.timestamp.isoformat()}",
    ]

    if event.correlation_id:
        lines.append(f"关联ID: {event.correlation_id}")

    lines.append(f"负载: {json.dumps(event.payload, ensure_ascii=False, indent=2)}")

    return "\n".join(lines)


def format_subscription(subscription: Subscription) -> str:
    """格式化订阅"""
    lines = [
        "=== 订阅 ===",
        f"ID: {subscription.id}",
        f"客户端: {subscription.client_did}",
        f"状态: {'活跃' if subscription.active else '已取消'}",
        f"事件数: {subscription.event_count}",
        f"创建时间: {subscription.created_at.isoformat()}",
    ]

    if subscription.filter.types:
        lines.append(f"类型: {', '.join(subscription.filter.types)}")
    if subscription.filter.sources:
        lines.append(f"来源: {', '.join(subscription.filter.sources)}")

    return "\n".join(lines)


def format_stats(stats: BroadcastStats) -> str:
    """格式化统计"""
    lines = [
        "=== 广播统计 ===",
        f"发送事件: {stats.total_events_sent}",
        f"接收事件: {stats.total_events_received}",
        f"活跃订阅: {stats.active_subscriptions}",
        f"失败发送: {stats.failed_sends}",
        f"平均发送时间: {stats.avg_send_time_ms:.2f}ms",
        "",
        "按类型:",
    ]

    for type_name, count in stats.by_type.items():
        lines.append(f"  {type_name}: {count}")

    lines.extend(["", "按来源:"])

    for source, count in stats.by_source.items():
        lines.append(f"  {source}: {count}")

    return "\n".join(lines)
