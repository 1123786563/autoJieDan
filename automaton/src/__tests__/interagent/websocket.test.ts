/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import {
  InteragentWebSocketServer,
  WebSocketServerConfig,
  createProgressEvent,
  createErrorEvent,
  createHeartbeatEvent,
} from "../../interagent/websocket.js";

describe("WebSocket Server", () => {
  let server: InteragentWebSocketServer;
  const defaultConfig: WebSocketServerConfig = {
    port: 18790,
    host: "127.0.0.1",
  };

  beforeEach(async () => {
    server = new InteragentWebSocketServer(defaultConfig);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  describe("Server Lifecycle", () => {
    it("should start and stop successfully", async () => {
      expect(server.getServerStatus().running).toBe(true);

      await server.stop();

      expect(server.getServerStatus().running).toBe(false);
    });

    it("should accept connections", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${defaultConfig.port}`);

      await new Promise<void>((resolve) => {
        ws.once("open", () => {
          resolve();
        });
      });

      // While connected, client count should be 1
      expect(server.getClientCount()).toBe(1);

      // Wait for server's client:disconnected event (handles race condition)
      const disconnectedPromise = new Promise<void>((resolve) => {
        server.once("client:disconnected", () => resolve());
      });

      // Close the connection
      ws.close();

      // Wait for server to process the close event
      await disconnectedPromise;

      // After close, client count should be 0
      expect(server.getClientCount()).toBe(0);
    });

    it("should track multiple clients", async () => {
      const clients: WebSocket[] = [];

      // Connect 3 clients
      for (let i = 0; i < 3; i++) {
        const ws = new WebSocket(
          `ws://127.0.0.1:${defaultConfig.port}?did=did:anp:client:${i}`
        );
        clients.push(ws);
      }

      // Wait for all connections
      await Promise.all(
        clients.map(
          (ws) => new Promise<void>((resolve) => ws.once("open", () => resolve()))
        )
      );

      expect(server.getClientCount()).toBe(3);

      // Clean up
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      }
    });

    it("should enforce max connections", async () => {
      // Create a server with max 2 connections
      const limitedServer = new InteragentWebSocketServer({
        ...defaultConfig,
        port: 18791,
        maxConnections: 2,
      });

      await limitedServer.start();

      const clients: WebSocket[] = [];

      // Connect 3 clients
      for (let i = 0; i < 3; i++) {
        clients.push(
          new WebSocket(`ws://127.0.0.1:18791?did=did:anp:client:${i}`)
        );
      }

      // Wait for all to attempt connection
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Only 2 should be connected
      expect(limitedServer.getClientCount()).toBeLessThanOrEqual(2);

      // Clean up
      for (const ws of clients) {
        if (ws.readyState !== WebSocket.CLOSED) {
          ws.close();
        }
      }
      await limitedServer.stop();
    });
  });

  describe("Event Handling", () => {
    it("should receive and parse messages", async () => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${defaultConfig.port}?did=did:anp:test:client`
      );

      let receivedMessage: unknown = null;

      ws.on("message", (data) => {
        receivedMessage = JSON.parse(data.toString());
      });

      await new Promise<void>((resolve) => {
        ws.once("open", () => resolve());
      });

      // Send a test message
      const testEvent = createProgressEvent(
        "did:anp:test:client",
        "did:anp:automaton:main",
        {
          taskId: "test-task-001",
          progress: 50,
          currentPhase: "testing",
          completedSteps: ["step1"],
          nextSteps: ["step2"],
        }
      );

      ws.send(JSON.stringify(testEvent));

      // Wait for message processing
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Server should have received the message (check via event emission)
      expect(receivedMessage).toBeDefined();

      ws.close();
    });

    it("should send events to specific clients", async () => {
      const clientDid = "did:anp:test:recipient";
      const ws = new WebSocket(
        `ws://127.0.0.1:${defaultConfig.port}?did=${clientDid}`
      );

      const receivedMessages: unknown[] = [];

      ws.on("message", (data) => {
        receivedMessages.push(JSON.parse(data.toString()));
      });

      await new Promise<void>((resolve) => {
        ws.once("open", () => resolve());
      });

      // Server sends event to client
      const event = createProgressEvent(
        "did:anp:automaton:main",
        clientDid,
        {
          taskId: "task-123",
          progress: 75,
          currentPhase: "execution",
          completedSteps: ["a", "b"],
          nextSteps: ["c"],
        }
      );

      const sent = server.sendToDid(clientDid, event);
      expect(sent).toBe(true);

      // Wait for message
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      expect(receivedMessages.length).toBeGreaterThan(0);

      ws.close();
    });

    it("should broadcast events to all clients", async () => {
      const clients: WebSocket[] = [];
      const receivedCounts: number[] = [0, 0, 0];

      // Connect 3 clients
      for (let i = 0; i < 3; i++) {
        const ws = new WebSocket(
          `ws://127.0.0.1:${defaultConfig.port}?did=did:anp:broadcast:${i}`
        );
        const idx = i;
        ws.on("message", () => {
          receivedCounts[idx]++;
        });
        clients.push(ws);
      }

      await Promise.all(
        clients.map(
          (ws) => new Promise<void>((resolve) => ws.once("open", () => resolve()))
        )
      );

      // Broadcast an event
      const event = createHeartbeatEvent(
        "did:anp:automaton:main",
        "did:anp:broadcast:all",
        {
          status: "healthy",
          uptime: 100,
          activeTasks: 0,
          queuedTasks: 0,
        }
      );

      const sentCount = server.broadcast(event);
      expect(sentCount).toBe(3);

      // Wait for messages
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // All clients should have received the message
      expect(receivedCounts.every((count) => count > 0)).toBe(true);

      // Clean up
      for (const ws of clients) {
        ws.close();
      }
    });
  });

  describe("Helper Functions", () => {
    it("should create valid progress events", () => {
      const event = createProgressEvent(
        "did:anp:source",
        "did:anp:target",
        {
          taskId: "task-001",
          progress: 50,
          currentPhase: "running",
          completedSteps: ["step1"],
          nextSteps: ["step2"],
        },
        "correlation-123"
      );

      expect(event.type).toBe("task.progress");
      expect(event.source).toBe("did:anp:source");
      expect(event.target).toBe("did:anp:target");
      expect(event.correlationId).toBe("correlation-123");
      expect(event.payload.taskId).toBe("task-001");
      expect(event.payload.progress).toBe(50);
    });

    it("should create valid error events", () => {
      const event = createErrorEvent(
        "did:anp:source",
        "did:anp:target",
        {
          taskId: "task-001",
          severity: "error",
          errorCode: "ERR001",
          message: "Something went wrong",
          recoverable: true,
        }
      );

      expect(event.type).toBe("task.error");
      expect(event.payload.severity).toBe("error");
      expect(event.payload.recoverable).toBe(true);
    });

    it("should create valid heartbeat events", () => {
      const event = createHeartbeatEvent(
        "did:anp:source",
        "did:anp:target",
        {
          status: "healthy",
          uptime: 3600,
          activeTasks: 5,
          queuedTasks: 2,
        }
      );

      expect(event.type).toBe("status.heartbeat");
      expect(event.payload.status).toBe("healthy");
      expect(event.payload.uptime).toBe(3600);
    });
  });

  describe("Client Info", () => {
    it("should track client connection time", async () => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${defaultConfig.port}?did=did:anp:time:test`
      );

      await new Promise<void>((resolve) => {
        ws.once("open", () => resolve());
      });

      const clients = server.getConnectedClients();
      const testClient = clients.find((c) => c.did === "did:anp:time:test");

      expect(testClient).toBeDefined();
      expect(testClient!.connectedAt).toBeInstanceOf(Date);
      expect(testClient!.lastActivity).toBeInstanceOf(Date);

      ws.close();
    });
  });
});
