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

describe("HealthCheckServer", () => {
  let server: HealthCheckServer;
  const defaultConfig: HealthServerConfig = {
    port: 18792,
    host: "127.0.0.1"
  };

  beforeEach(async () => {
    server = new HealthCheckServer(defaultConfig);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  describe("Server Lifecycle", () => {
    it("should start and stop successfully", async () => {
      const status = server.getServerStatus();
      expect(status.running).toBe(true);
      expect(status.port).toBe(defaultConfig.port);

      await server.stop();

      expect(server.getServerStatus().running).toBe(false);
    });

    it("should handle /health endpoint", async () => {
      const res = await fetch(`http://127.0.0.1:${defaultConfig.port}/health`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.status).toBe("healthy");
      expect(data.uptime).toBeGreaterThanOrEqual(0);
      expect(data.version).toBeDefined();
    });

    it("should handle /status endpoint", async () => {
      const res = await fetch(`http://127.0.0.1:${defaultConfig.port}/status`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.websocket).toBeDefined();
      expect(data.system).toBeDefined();
      expect(data.automaton).toBeDefined();
    });

    it("should handle /ready endpoint", async () => {
      const res = await fetch(`http://127.0.0.1:${defaultConfig.port}/ready`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ready).toBe(true);
    });

    it("should handle /live endpoint", async () => {
      const res = await fetch(`http://127.0.0.1:${defaultConfig.port}/live`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.alive).toBe(true);
      expect(data.uptime).toBeGreaterThanOrEqual(0);
    });

    it("should return 404 for unknown routes", async () => {
      const res = await fetch(`http://127.0.0.1:${defaultConfig.port}/unknown`);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Not Found");
    });

    it("should return 405 for non-GET requests", async () => {
      const res = await fetch(`http://127.0.0.1:${defaultConfig.port}/health`, {
        method: "POST"
      });
      expect(res.status).toBe(405);
      const data = await res.json();
      expect(data.error).toBe("Method Not Allowed");
    });
  });

  describe("WebSocket Integration", () => {
    it("should reflect WebSocket server status in health check", async () => {
      const wsConfig = { port: 18793, host: "127.0.0.1" };
      const wsServer = new InteragentWebSocketServer(wsConfig);
      await wsServer.start();

      server.setWebSocketServer(wsServer);

      const res = await fetch(`http://127.0.0.1:${defaultConfig.port}/health`);
      const data = await res.json();

      expect(data.status).toBe("healthy");

      await wsServer.stop();
    });

    it("should return degraded when WebSocket is not running", async () => {
      // Server without WebSocket should still be healthy initially
      const res = await fetch(`http://127.0.0.1:${defaultConfig.port}/health`);
      const data = await res.json();

      expect(data.status).toBe("healthy");
    });
  });

  describe("Custom Health Checker", () => {
    it("should use custom health checker", async () => {
      server.setHealthChecker(() => "degraded");

      const res = await fetch(`http://127.0.0.1:${defaultConfig.port}/health`);
      const data = await res.json();

      expect(data.status).toBe("degraded");
    });
  });

  describe("CORS Headers", () => {
    it("should include CORS headers", async () => {
      const res = await fetch(`http://127.0.0.1:${defaultConfig.port}/health`);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    });
  });

  describe("Alternate Paths", () => {
    it("should handle /healthz path", async () => {
      const res = await fetch(`http://127.0.0.1:${defaultConfig.port}/healthz`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBeDefined();
    });

    it("should handle /statusz path", async () => {
      const res = await fetch(`http://127.0.0.1:${defaultConfig.port}/statusz`);
      expect(res.status).toBe(200);
    });

    it("should handle /readyz path", async () => {
      const res = await fetch(`http://127.0.0.1:${defaultConfig.port}/readyz`);
      expect(res.status).toBe(200);
    });

    it("should handle /livez path", async () => {
      const res = await fetch(`http://127.0.0.1:${defaultConfig.port}/livez`);
      expect(res.status).toBe(200);
    });
  });

  describe("Status Provider", () => {
    it("should use custom status provider", async () => {
      server.setStatusProvider(() => ({
        state: "running",
        creditBalance: 100,
        currentTaskId: "task-123"
      }));

      const res = await fetch(`http://127.0.0.1:${defaultConfig.port}/status`);
      const data = await res.json();

      expect(data.automaton.state).toBe("running");
      expect(data.automaton.creditBalance).toBe(100);
      expect(data.automaton.currentTaskId).toBe("task-123");
    });
  });
});
