/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import WebSocket from "ws";
import {
  EventBroadcaster,
  createEventBroadcaster,
  formatEvent,
  formatSubscription,
  formatStats,
  type BroadcastEvent,
  type Subscription,
  type BroadcastStats,
  type SubscriptionFilter,
} from "../../interagent/event-broadcaster.js";

// Mock WebSocket
class MockWebSocket {
  readyState = WebSocket.OPEN;
  sentMessages: any[] = [];
  handlers: Map<string, Function[]> = new Map();
  closed = false;

  on(event: string, handler: Function) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
  }

  send(data: string) {
    if (this.closed) throw new Error("WebSocket is closed");
    this.sentMessages.push(JSON.parse(data));
  }

  close() {
    this.closed = true;
    this.readyState = WebSocket.CLOSED;
    const handlers = this.handlers.get("close") || [];
    handlers.forEach((h) => h());
  }

  emit(event: string, data?: any) {
    const handlers = this.handlers.get(event) || [];
    handlers.forEach((h) => h(data));
  }

  getSentEvents() {
    return this.sentMessages;
  }

  clearSent() {
    this.sentMessages = [];
  }
}

describe("EventBroadcaster", () => {
  let broadcaster: EventBroadcaster;

  beforeEach(() => {
    broadcaster = createEventBroadcaster({
      batchSize: 1, // Disable batching for most tests
      eventHistorySize: 100,
    });
  });

  afterEach(() => {
    broadcaster.closeAll();
  });

  describe("Connection Management", () => {
    it("should register client", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const connection = broadcaster.registerClient(ws, "did:test:1");

      expect(connection.did).toBe("did:test:1");
      expect(connection.authenticated).toBe(false);
      expect(broadcaster.getConnectionCount()).toBe(1);
    });

    it("should unregister client", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");

      broadcaster.unregisterClient("did:test:1");

      expect(broadcaster.getConnectionCount()).toBe(0);
    });

    it("should get client", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");

      const client = broadcaster.getClient("did:test:1");
      expect(client).toBeDefined();
      expect(client?.did).toBe("did:test:1");
    });

    it("should get all clients", () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws1, "did:test:1");
      broadcaster.registerClient(ws2, "did:test:2");

      const clients = broadcaster.getAllClients();
      expect(clients).toHaveLength(2);
    });

    it("should emit client registered event", () => {
      const handler = vi.fn();
      broadcaster.on("client:registered", handler);

      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("Subscription Management", () => {
    it("should create subscription", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");

      const subscription = broadcaster.subscribe("did:test:1", {
        types: ["task.*"],
      });

      expect(subscription.id).toBeDefined();
      expect(subscription.clientDid).toBe("did:test:1");
      expect(subscription.active).toBe(true);
    });

    it("should cancel subscription", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");

      const subscription = broadcaster.subscribe("did:test:1", {});
      const removed = broadcaster.unsubscribe(subscription.id);

      expect(removed).toBe(true);
      expect(subscription.active).toBe(false);
    });

    it("should get client subscriptions", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");

      broadcaster.subscribe("did:test:1", { types: ["task.*"] });
      broadcaster.subscribe("did:test:1", { types: ["resource.*"] });

      const subs = broadcaster.getSubscriptions("did:test:1");
      expect(subs).toHaveLength(2);
    });

    it("should get active subscription count", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");

      broadcaster.subscribe("did:test:1", {});
      broadcaster.subscribe("did:test:1", {});

      expect(broadcaster.getActiveSubscriptionCount()).toBe(2);
    });

    it("should emit subscription created event", () => {
      const handler = vi.fn();
      broadcaster.on("subscription:created", handler);

      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");
      broadcaster.subscribe("did:test:1", {});

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("Event Publishing", () => {
    it("should publish event", () => {
      const event = broadcaster.publish({
        type: "task.created",
        source: "test",
        priority: "normal",
        payload: { taskId: "task-1" },
        requireAck: false,
      });

      expect(event.id).toBeDefined();
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.type).toBe("task.created");
    });

    it("should emit event published event", () => {
      const handler = vi.fn();
      broadcaster.on("event:published", handler);

      broadcaster.publish({
        type: "test.event",
        source: "test",
        priority: "normal",
        payload: {},
        requireAck: false,
      });

      expect(handler).toHaveBeenCalled();
    });

    it("should store event history", () => {
      broadcaster.publish({
        type: "test.event",
        source: "test",
        priority: "normal",
        payload: {},
        requireAck: false,
      });

      const history = broadcaster.getEventHistory();
      expect(history).toHaveLength(1);
    });

    it("should limit event history", () => {
      const smallBroadcaster = createEventBroadcaster({ eventHistorySize: 5 });

      for (let i = 0; i < 10; i++) {
        smallBroadcaster.publish({
          type: "test.event",
          source: "test",
          priority: "normal",
          payload: { index: i },
          requireAck: false,
        });
      }

      const history = smallBroadcaster.getEventHistory();
      expect(history.length).toBeLessThanOrEqual(5);

      smallBroadcaster.closeAll();
    });
  });

  describe("Event Routing", () => {
    it("should route event to matching subscription", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");
      broadcaster.subscribe("did:test:1", { types: ["task.*"] });

      broadcaster.publish({
        type: "task.created",
        source: "test",
        priority: "normal",
        payload: {},
        requireAck: false,
      });

      const mockWs = ws as unknown as MockWebSocket;
      expect(mockWs.getSentEvents().length).toBeGreaterThan(0);
    });

    it("should not route event to non-matching subscription", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");
      broadcaster.subscribe("did:test:1", { types: ["resource.*"] });

      broadcaster.publish({
        type: "task.created",
        source: "test",
        priority: "normal",
        payload: {},
        requireAck: false,
      });

      const mockWs = ws as unknown as MockWebSocket;
      expect(mockWs.getSentEvents().length).toBe(0);
    });

    it("should route to target client only", () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws1, "did:test:1");
      broadcaster.registerClient(ws2, "did:test:2");
      broadcaster.subscribe("did:test:1", {});
      broadcaster.subscribe("did:test:2", {});

      broadcaster.publish({
        type: "test.event",
        source: "test",
        target: "did:test:1",
        priority: "normal",
        payload: {},
        requireAck: false,
      });

      const mockWs1 = ws1 as unknown as MockWebSocket;
      const mockWs2 = ws2 as unknown as MockWebSocket;

      expect(mockWs1.getSentEvents().length).toBeGreaterThan(0);
      expect(mockWs2.getSentEvents().length).toBe(0);
    });

    it("should filter by source", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");
      broadcaster.subscribe("did:test:1", { sources: ["source-a"] });

      broadcaster.publish({
        type: "test.event",
        source: "source-b",
        priority: "normal",
        payload: {},
        requireAck: false,
      });

      const mockWs = ws as unknown as MockWebSocket;
      expect(mockWs.getSentEvents().length).toBe(0);
    });

    it("should filter by priority", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");
      broadcaster.subscribe("did:test:1", { priorities: ["high", "critical"] });

      broadcaster.publish({
        type: "test.event",
        source: "test",
        priority: "low",
        payload: {},
        requireAck: false,
      });

      const mockWs = ws as unknown as MockWebSocket;
      expect(mockWs.getSentEvents().length).toBe(0);
    });

    it("should use custom filter", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");
      broadcaster.subscribe("did:test:1", {
        custom: (e) => e.payload.important === true,
      });

      broadcaster.publish({
        type: "test.event",
        source: "test",
        priority: "normal",
        payload: { important: false },
        requireAck: false,
      });

      const mockWs = ws as unknown as MockWebSocket;
      expect(mockWs.getSentEvents().length).toBe(0);
    });

    it("should match wildcard patterns", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");
      broadcaster.subscribe("did:test:1", { types: ["task.*"] });

      broadcaster.publish({
        type: "task.progress",
        source: "test",
        priority: "normal",
        payload: {},
        requireAck: false,
      });

      const mockWs = ws as unknown as MockWebSocket;
      expect(mockWs.getSentEvents().length).toBeGreaterThan(0);
    });
  });

  describe("Broadcast and SendTo", () => {
    it("should broadcast to all clients", () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws1, "did:test:1");
      broadcaster.registerClient(ws2, "did:test:2");
      broadcaster.subscribe("did:test:1", {});
      broadcaster.subscribe("did:test:2", {});

      const sent = broadcaster.broadcast({
        type: "test.broadcast",
        source: "test",
        priority: "normal",
        payload: {},
        requireAck: false,
      });

      expect(sent).toBeGreaterThan(0);
    });

    it("should send to specific client", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");
      broadcaster.subscribe("did:test:1", {});

      const result = broadcaster.sendTo("did:test:1", {
        type: "test.direct",
        source: "test",
        priority: "normal",
        payload: {},
        requireAck: false,
      });

      expect(result).toBe(true);
    });
  });

  describe("Statistics", () => {
    it("should track event stats", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");
      broadcaster.subscribe("did:test:1", {});

      broadcaster.publish({
        type: "task.created",
        source: "source-a",
        priority: "normal",
        payload: {},
        requireAck: false,
      });

      const stats = broadcaster.getStats();

      expect(stats.totalEventsReceived).toBe(1);
      expect(stats.byType["task.created"]).toBe(1);
      expect(stats.bySource["source-a"]).toBe(1);
    });

    it("should reset stats", () => {
      broadcaster.publish({
        type: "test.event",
        source: "test",
        priority: "normal",
        payload: {},
        requireAck: false,
      });

      broadcaster.resetStats();
      const stats = broadcaster.getStats();

      expect(stats.totalEventsReceived).toBe(0);
    });
  });

  describe("Event History", () => {
    it("should filter history by type", () => {
      broadcaster.publish({
        type: "task.created",
        source: "test",
        priority: "normal",
        payload: {},
        requireAck: false,
      });
      broadcaster.publish({
        type: "resource.snapshot",
        source: "test",
        priority: "normal",
        payload: {},
        requireAck: false,
      });

      const history = broadcaster.getEventHistory({ types: ["task.created"] });

      expect(history).toHaveLength(1);
      expect(history[0].type).toBe("task.created");
    });

    it("should filter history by source", () => {
      broadcaster.publish({
        type: "test.event",
        source: "source-a",
        priority: "normal",
        payload: {},
        requireAck: false,
      });
      broadcaster.publish({
        type: "test.event",
        source: "source-b",
        priority: "normal",
        payload: {},
        requireAck: false,
      });

      const history = broadcaster.getEventHistory({ sources: ["source-a"] });

      expect(history).toHaveLength(1);
    });

    it("should filter history by time", () => {
      const oldDate = new Date(Date.now() - 10000);

      broadcaster.publish({
        type: "test.event",
        source: "test",
        priority: "normal",
        payload: {},
        requireAck: false,
      });

      const history = broadcaster.getEventHistory({ since: oldDate });

      expect(history.length).toBeGreaterThan(0);
    });

    it("should limit history results", () => {
      for (let i = 0; i < 10; i++) {
        broadcaster.publish({
          type: "test.event",
          source: "test",
          priority: "normal",
          payload: { index: i },
          requireAck: false,
        });
      }

      const history = broadcaster.getEventHistory({ limit: 3 });

      expect(history).toHaveLength(3);
    });
  });

  describe("Topics", () => {
    it("should get topics", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");
      broadcaster.subscribe("did:test:1", { types: ["task.*"] });
      broadcaster.subscribe("did:test:1", { types: ["resource.*"] });

      const topics = broadcaster.getTopics();

      expect(topics.length).toBeGreaterThan(0);
    });

    it("should get topic subscribers", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");
      broadcaster.subscribe("did:test:1", { types: ["task.*"] });

      const subscribers = broadcaster.getTopicSubscribers("task.created");

      expect(subscribers).toContain("did:test:1");
    });
  });

  describe("Summary", () => {
    it("should get summary", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");
      broadcaster.subscribe("did:test:1", {});

      const summary = broadcaster.getSummary();

      expect(summary.connections).toBe(1);
      expect(summary.subscriptions).toBe(1);
      expect(summary.stats).toBeDefined();
    });
  });

  describe("Events", () => {
    it("should handle client message - subscribe", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");

      ws.emit("message", Buffer.from(JSON.stringify({
        type: "subscribe",
        filter: { types: ["task.*"] },
      })));

      const subs = broadcaster.getSubscriptions("did:test:1");
      expect(subs.length).toBeGreaterThan(0);
    });

    it("should handle client message - unsubscribe", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");
      const sub = broadcaster.subscribe("did:test:1", {});

      ws.emit("message", Buffer.from(JSON.stringify({
        type: "unsubscribe",
        subscriptionId: sub.id,
      })));

      expect(sub.active).toBe(false);
    });

    it("should handle client message - event", () => {
      const handler = vi.fn();
      broadcaster.on("event:published", handler);

      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");

      ws.emit("message", Buffer.from(JSON.stringify({
        type: "event",
        eventType: "test.event",
        priority: "normal",
        payload: {},
        requireAck: false,
      })));

      expect(handler).toHaveBeenCalled();
    });

    it("should handle client message - ping", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      broadcaster.registerClient(ws, "did:test:1");
      (ws as unknown as MockWebSocket).clearSent();

      ws.emit("message", Buffer.from(JSON.stringify({
        type: "ping",
      })));

      const events = (ws as unknown as MockWebSocket).getSentEvents();
      expect(events.some((e: any) => e.type === "pong")).toBe(true);
    });
  });
});

describe("Factory Functions", () => {
  it("should create event broadcaster", () => {
    const broadcaster = createEventBroadcaster();
    expect(broadcaster).toBeInstanceOf(EventBroadcaster);
    broadcaster.closeAll();
  });

  it("should create with config", () => {
    const broadcaster = createEventBroadcaster({
      batchSize: 10,
      eventHistorySize: 50,
    });
    expect(broadcaster).toBeInstanceOf(EventBroadcaster);
    broadcaster.closeAll();
  });
});

describe("Format Functions", () => {
  describe("formatEvent", () => {
    it("should format event", () => {
      const event: BroadcastEvent = {
        id: "evt-1",
        type: "task.created",
        timestamp: new Date("2026-02-26T12:00:00Z"),
        source: "test-source",
        priority: "normal",
        payload: { taskId: "task-1" },
        metadata: {},
        requireAck: false,
      };

      const formatted = formatEvent(event);

      expect(formatted).toContain("evt-1");
      expect(formatted).toContain("task.created");
      expect(formatted).toContain("test-source");
      expect(formatted).toContain("normal");
    });

    it("should format event with target", () => {
      const event: BroadcastEvent = {
        id: "evt-2",
        type: "test.event",
        timestamp: new Date(),
        source: "source",
        target: "did:test:1",
        priority: "high",
        payload: {},
        metadata: {},
        requireAck: false,
      };

      const formatted = formatEvent(event);

      expect(formatted).toContain("did:test:1");
      expect(formatted).toContain("high");
    });

    it("should format event with correlation id", () => {
      const event: BroadcastEvent = {
        id: "evt-3",
        type: "test.event",
        timestamp: new Date(),
        source: "source",
        priority: "normal",
        payload: {},
        correlationId: "corr-123",
        metadata: {},
        requireAck: false,
      };

      const formatted = formatEvent(event);

      expect(formatted).toContain("corr-123");
    });
  });

  describe("formatSubscription", () => {
    it("should format subscription", () => {
      const subscription: Subscription = {
        id: "sub-1",
        clientDid: "did:test:1",
        filter: { types: ["task.*"] },
        createdAt: new Date("2026-02-26T12:00:00Z"),
        lastActiveAt: new Date(),
        eventCount: 10,
        active: true,
      };

      const formatted = formatSubscription(subscription);

      expect(formatted).toContain("sub-1");
      expect(formatted).toContain("did:test:1");
      expect(formatted).toContain("活跃");
      expect(formatted).toContain("task.*");
    });

    it("should format inactive subscription", () => {
      const subscription: Subscription = {
        id: "sub-2",
        clientDid: "did:test:1",
        filter: {},
        createdAt: new Date(),
        lastActiveAt: new Date(),
        eventCount: 0,
        active: false,
      };

      const formatted = formatSubscription(subscription);

      expect(formatted).toContain("已取消");
    });
  });

  describe("formatStats", () => {
    it("should format stats", () => {
      const stats: BroadcastStats = {
        totalEventsSent: 100,
        totalEventsReceived: 100,
        activeSubscriptions: 5,
        byType: { "task.created": 50, "task.completed": 50 },
        bySource: { "source-a": 60, "source-b": 40 },
        failedSends: 2,
        avgSendTimeMs: 1.5,
      };

      const formatted = formatStats(stats);

      expect(formatted).toContain("100");
      expect(formatted).toContain("5");
      expect(formatted).toContain("1.50ms");
      expect(formatted).toContain("task.created");
      expect(formatted).toContain("source-a");
    });
  });
});
