/**
 * 水平扩展支持测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  InstanceRegistry,
  LoadBalancer,
  InstanceStatus,
  LoadBalanceStrategy,
  InstanceInfo,
} from "../../../interagent/scaling/index.js";

describe("InstanceRegistry", () => {
  let registry: InstanceRegistry;

  beforeEach(() => {
    registry = new InstanceRegistry();
  });

  describe("register", () => {
    it("should register a new instance", () => {
      registry.register({
        id: "instance-1",
        url: "http://localhost:3001",
        status: "healthy",
        load: 0.5,
      });

      expect(registry.size).toBe(1);
      expect(registry.getInstance("instance-1")).toBeDefined();
    });

    it("should emit registered event", () => {
      let registered = false;
      registry.on("registered", () => {
        registered = true;
      });

      registry.register({
        id: "instance-1",
        url: "http://localhost:3001",
        status: "healthy",
        load: 0.5,
      });

      expect(registered).toBe(true);
    });

    it("should update existing instance", () => {
      registry.register({
        id: "instance-1",
        url: "http://localhost:3001",
        status: "healthy",
        load: 0.5,
      });

      registry.register({
        id: "instance-1",
        url: "http://localhost:3002",
        status: "healthy",
        load: 0.3,
      });

      const instance = registry.getInstance("instance-1");
      expect(instance?.url).toBe("http://localhost:3002");
      expect(registry.size).toBe(1);
    });
  });

  describe("deregister", () => {
    it("should deregister an instance", () => {
      registry.register({
        id: "instance-1",
        url: "http://localhost:3001",
        status: "healthy",
        load: 0.5,
      });

      const result = registry.deregister("instance-1");
      expect(result).toBe(true);
      expect(registry.size).toBe(0);
    });

    it("should return false for non-existent instance", () => {
      const result = registry.deregister("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("heartbeat", () => {
    it("should update instance heartbeat", () => {
      registry.register({
        id: "instance-1",
        url: "http://localhost:3001",
        status: "healthy",
        load: 0.5,
      });

      const before = registry.getInstance("instance-1")?.lastHeartbeat;

      // Wait a bit
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          registry.heartbeat("instance-1", 0.8);
          const after = registry.getInstance("instance-1")?.lastHeartbeat;
          expect(after?.getTime()).toBeGreaterThanOrEqual(before?.getTime() || 0);
          expect(registry.getInstance("instance-1")?.load).toBe(0.8);
          resolve();
        }, 10);
      });
    });

    it("should update status on heartbeat", () => {
      registry.register({
        id: "instance-1",
        url: "http://localhost:3001",
        status: "healthy",
        load: 0.5,
      });

      registry.heartbeat("instance-1", 0.5, "degraded");
      expect(registry.getInstance("instance-1")?.status).toBe("degraded");
    });
  });

  describe("getHealthyInstances", () => {
    it("should return only healthy instances", () => {
      registry.register({
        id: "instance-1",
        url: "http://localhost:3001",
        status: "healthy",
        load: 0.5,
      });
      registry.register({
        id: "instance-2",
        url: "http://localhost:3002",
        status: "unhealthy",
        load: 0.5,
      });
      registry.register({
        id: "instance-3",
        url: "http://localhost:3003",
        status: "degraded",
        load: 0.5,
      });

      const healthy = registry.getHealthyInstances();
      expect(healthy.length).toBe(2);
    });
  });

  describe("selectInstance", () => {
    beforeEach(() => {
      registry.register({
        id: "instance-1",
        url: "http://localhost:3001",
        status: "healthy",
        load: 0.8,
      });
      registry.register({
        id: "instance-2",
        url: "http://localhost:3002",
        status: "healthy",
        load: 0.3,
      });
      registry.register({
        id: "instance-3",
        url: "http://localhost:3003",
        status: "healthy",
        load: 0.5,
      });
    });

    it("should select least loaded instance", () => {
      const selected = registry.selectInstance("least-load");
      expect(selected?.id).toBe("instance-2");
    });

    it("should rotate instances with round-robin", () => {
      const first = registry.selectInstance("round-robin");
      const second = registry.selectInstance("round-robin");
      const third = registry.selectInstance("round-robin");

      // Should rotate through instances
      expect([first?.id, second?.id, third?.id]).toContain("instance-1");
      expect([first?.id, second?.id, third?.id]).toContain("instance-2");
      expect([first?.id, second?.id, third?.id]).toContain("instance-3");
    });

    it("should return null when no healthy instances", () => {
      registry.clear();
      const selected = registry.selectInstance("least-load");
      expect(selected).toBeNull();
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", () => {
      registry.register({
        id: "instance-1",
        url: "http://localhost:3001",
        status: "healthy",
        load: 0.5,
      });
      registry.register({
        id: "instance-2",
        url: "http://localhost:3002",
        status: "unhealthy",
        load: 0.3,
      });

      const stats = registry.getStats();
      expect(stats.totalInstances).toBe(2);
      expect(stats.healthyInstances).toBe(1);
      expect(stats.unhealthyInstances).toBe(1);
      expect(stats.averageLoad).toBe(0.4);
    });
  });
});

describe("LoadBalancer", () => {
  let registry: InstanceRegistry;
  let loadBalancer: LoadBalancer;

  beforeEach(() => {
    registry = new InstanceRegistry();
    loadBalancer = new LoadBalancer(registry, "least-load");

    registry.register({
      id: "instance-1",
      url: "http://localhost:3001",
      status: "healthy",
      load: 0.5,
    });
    registry.register({
      id: "instance-2",
      url: "http://localhost:3002",
      status: "healthy",
      load: 0.3,
    });
  });

  describe("selectInstance", () => {
    it("should select instance based on strategy", () => {
      const result = loadBalancer.selectInstance();
      expect(result).toBeDefined();
      expect(result?.instance.id).toBe("instance-2"); // least load
    });

    it("should use session affinity", () => {
      // First request with session
      const first = loadBalancer.selectInstance("session-1");
      const firstId = first?.instance.id;

      // Second request with same session should get same instance
      const second = loadBalancer.selectInstance("session-1");
      expect(second?.instance.id).toBe(firstId);
    });

    it("should clear session affinity", () => {
      loadBalancer.selectInstance("session-1");
      loadBalancer.clearSessionAffinity("session-1");

      // After clearing, might get different instance
      const selected = loadBalancer.selectInstance("session-1");
      expect(selected).toBeDefined();
    });
  });

  describe("setStrategy", () => {
    it("should change load balance strategy", () => {
      loadBalancer.setStrategy("round-robin");
      // Just verify it doesn't throw
      const result = loadBalancer.selectInstance();
      expect(result).toBeDefined();
    });
  });

  describe("routeRequest", () => {
    it("should route request to selected instance", async () => {
      const executor = async (instance: InstanceInfo, request: unknown) => {
        return { status: "ok", instanceId: instance.id };
      };

      const result = await loadBalancer.routeRequest({ data: "test" }, executor);
      expect(result.response.status).toBe("ok");
      expect(result.instance.id).toBe("instance-2");
    });

    it("should throw when no healthy instances", async () => {
      registry.deregister("instance-1");
      registry.deregister("instance-2");

      await expect(
        loadBalancer.routeRequest({ data: "test" }, async () => ({}))
      ).rejects.toThrow("No healthy instances available");
    });
  });
});
