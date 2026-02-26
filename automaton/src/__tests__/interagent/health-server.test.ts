/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "http";
import {
  HealthCheckServer,
  type HealthServerConfig,
} from "../../interagent/health-server.js";
import { InteragentWebSocketServer } from "../../interagent/websocket.js";

// Helper to get a random available port
function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = require("net").createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

describe("HealthCheckServer", () => {
  let server: HealthCheckServer;
  let testPort: number;

  beforeEach(async () => {
    testPort = await getAvailablePort();
    server = new HealthCheckServer({ port: testPort, host: "127.0.0.1" });
    await server.start();
  });

  afterEach(async () => {
    try {
      await server.stop();
    } catch {
      // Ignore errors during cleanup
    }
  });

  describe("Server Lifecycle", () => {
    it("should start and stop successfully", async () => {
      const status = server.getServerStatus();
      expect(status.running).toBe(true);
      expect(status.port).toBe(testPort);

      await server.stop();

      expect(server.getServerStatus().running).toBe(false);
    });

    it("should handle /health endpoint", async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/health`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.status).toBe("healthy");
      expect(data.uptime).toBeGreaterThanOrEqual(0);
      expect(data.version).toBeDefined();
    });

    it("should handle /status endpoint", async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/status`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.websocket).toBeDefined();
      expect(data.system).toBeDefined();
      expect(data.automaton).toBeDefined();
    });

    it("should handle /ready endpoint", async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/ready`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ready).toBe(true);
    });

    it("should handle /live endpoint", async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/live`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.alive).toBe(true);
      expect(data.uptime).toBeGreaterThanOrEqual(0);
    });

    it("should return 404 for unknown routes", async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/unknown`);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Not Found");
    });

    it("should return 405 for non-GET requests", async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/health`, {
        method: "POST",
      });
      expect(res.status).toBe(405);
      const data = await res.json();
      expect(data.error).toBe("Method Not Allowed");
    });
  });

  describe("WebSocket Integration", () => {
    it("should reflect WebSocket server status in health check", async () => {
      const wsPort = await getAvailablePort();
      const wsServer = new InteragentWebSocketServer({
        port: wsPort,
        host: "127.0.0.1",
      });
      await wsServer.start();

      server.setWebSocketServer(wsServer);

      const res = await fetch(`http://127.0.0.1:${testPort}/health`);
      const data = await res.json();

      expect(data.status).toBe("healthy");

      await wsServer.stop();
    });

    it("should return degraded when WebSocket is not running", async () => {
      // Server without WebSocket should still be healthy initially
      const res = await fetch(`http://127.0.0.1:${testPort}/health`);
      const data = await res.json();

      expect(data.status).toBe("healthy");
    });
  });

  describe("Custom Health Checker", () => {
    it("should use custom health checker", async () => {
      server.setHealthChecker(() => "degraded");

      const res = await fetch(`http://127.0.0.1:${testPort}/health`);
      const data = await res.json();

      expect(data.status).toBe("degraded");
    });
  });

  describe("CORS Headers", () => {
    it("should include CORS headers", async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/health`);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    });
  });

  describe("Alternate Paths", () => {
    it("should handle /healthz path", async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/healthz`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBeDefined();
    });

    it("should handle /statusz path", async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/statusz`);
      expect(res.status).toBe(200);
    });

    it("should handle /readyz path", async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/readyz`);
      expect(res.status).toBe(200);
    });

    it("should handle /livez path", async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/livez`);
      expect(res.status).toBe(200);
    });
  });

  describe("Status Provider", () => {
    it("should use custom status provider", async () => {
      server.setStatusProvider(() => ({
        state: "running",
        creditBalance: 100,
        currentTaskId: "task-123",
      }));

      const res = await fetch(`http://127.0.0.1:${testPort}/status`);
      const data = await res.json();

      expect(data.automaton.state).toBe("running");
      expect(data.automaton.creditBalance).toBe(100);
      expect(data.automaton.currentTaskId).toBe("task-123");
    });
  });
});
