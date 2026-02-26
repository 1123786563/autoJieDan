/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  LeaseManager,
  type Lease,
  type AcquireLeaseOptions,
  formatRemainingTime,
  isExpiringSoon,
} from "../../interagent/lease.js";

describe("LeaseManager", () => {
  let manager: LeaseManager;

  beforeEach(() => {
    manager = new LeaseManager({
      defaultDuration: 60,
      defaultMaxRenews: 3,
      cleanupInterval: 10,
    });
    manager.start();
  });

  afterEach(() => {
    manager.stop();
  });

  describe("Acquire Lease", () => {
    it("should acquire a lease", () => {
      const lease = manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      expect(lease).toBeDefined();
      expect(lease?.taskId).toBe("task-1");
      expect(lease?.holderDid).toBe("did:anp:nanobot:worker1");
      expect(lease?.status).toBe("active");
      expect(lease?.renewCount).toBe(0);
    });

    it("should not acquire lease if task already has active lease", () => {
      manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      const second = manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker2",
        durationSeconds: 60,
      });

      expect(second).toBeNull();
    });

    it("should acquire lease with custom max renews", () => {
      const lease = manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
        maxRenews: 10,
      });

      expect(lease?.maxRenews).toBe(10);
    });
  });

  describe("Release Lease", () => {
    it("should release a lease", () => {
      const lease = manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      const released = manager.release(lease!.id, "Completed");

      expect(released?.status).toBe("released");
      expect(released?.metadata.releaseReason).toBe("Completed");
    });

    it("should release lease by task id", () => {
      manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      const released = manager.releaseByTaskId("task-1", "Task done");

      expect(released?.status).toBe("released");
    });

    it("should return null for non-existent lease", () => {
      const released = manager.release("non-existent");
      expect(released).toBeNull();
    });
  });

  describe("Renew Lease", () => {
    it("should renew a lease", () => {
      const lease = manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      const originalExpires = lease!.expiresAt;
      const renewed = manager.renew(lease!.id, { additionalSeconds: 30 });

      expect(renewed?.renewCount).toBe(1);
      expect(renewed?.expiresAt.getTime()).toBeGreaterThan(originalExpires.getTime());
    });

    it("should not renew beyond max renews", () => {
      const lease = manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
        maxRenews: 2,
      });

      // Renew twice
      manager.renew(lease!.id, { additionalSeconds: 30 });
      manager.renew(lease!.id, { additionalSeconds: 30 });

      // Third renew should fail
      const result = manager.renew(lease!.id, { additionalSeconds: 30 });
      expect(result).toBeNull();
    });

    it("should not renew non-active lease", () => {
      const lease = manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      manager.release(lease!.id);

      const renewed = manager.renew(lease!.id, { additionalSeconds: 30 });
      expect(renewed).toBeNull();
    });
  });

  describe("Revoke Lease", () => {
    it("should revoke a lease", () => {
      const lease = manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      const revoked = manager.revoke(lease!.id, "Policy violation");

      expect(revoked?.status).toBe("revoked");
      expect(revoked?.metadata.releaseReason).toBe("Policy violation");
    });
  });

  describe("Heartbeat", () => {
    it("should record heartbeat", () => {
      const lease = manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      const result = manager.heartbeat(lease!.id);

      expect(result?.metadata.lastHeartbeat).toBeDefined();
    });

    it("should not heartbeat non-active lease", () => {
      const lease = manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      manager.release(lease!.id);

      const result = manager.heartbeat(lease!.id);
      expect(result).toBeNull();
    });
  });

  describe("Query Methods", () => {
    it("should get lease by id", () => {
      const lease = manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      const retrieved = manager.get(lease!.id);
      expect(retrieved).toEqual(lease);
    });

    it("should get lease by task id", () => {
      const lease = manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      const retrieved = manager.getByTaskId("task-1");
      expect(retrieved).toEqual(lease);
    });

    it("should get active leases by holder", () => {
      manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      manager.acquire({
        taskId: "task-2",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      manager.acquire({
        taskId: "task-3",
        holderDid: "did:anp:nanobot:worker2",
        durationSeconds: 60,
      });

      const leases = manager.getActiveByHolder("did:anp:nanobot:worker1");
      expect(leases.length).toBe(2);
    });
  });

  describe("Validation", () => {
    it("should check if lease is valid", () => {
      const lease = manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      expect(manager.isValid(lease!.id)).toBe(true);

      manager.release(lease!.id);

      expect(manager.isValid(lease!.id)).toBe(false);
    });

    it("should get remaining time", () => {
      const lease = manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      const remaining = manager.getRemainingTime(lease!);
      expect(remaining).toBeGreaterThan(55);
      expect(remaining).toBeLessThanOrEqual(60);
    });
  });

  describe("Statistics", () => {
    it("should return correct stats", () => {
      manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      manager.acquire({
        taskId: "task-2",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      const stats = manager.getStats();

      expect(stats.total).toBe(2);
      expect(stats.active).toBe(2);
    });
  });

  describe("Events", () => {
    it("should emit lease:acquired event", () => {
      const handler = vi.fn();
      manager.on("lease:acquired", handler);

      manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      expect(handler).toHaveBeenCalled();
    });

    it("should emit lease:released event", () => {
      const handler = vi.fn();
      manager.on("lease:released", handler);

      const lease = manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      manager.release(lease!.id);

      expect(handler).toHaveBeenCalled();
    });

    it("should emit lease:renewed event", () => {
      const handler = vi.fn();
      manager.on("lease:renewed", handler);

      const lease = manager.acquire({
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        durationSeconds: 60,
      });

      manager.renew(lease!.id, { additionalSeconds: 30 });

      expect(handler).toHaveBeenCalled();
    });
  });
});

describe("Helper Functions", () => {
  describe("formatRemainingTime", () => {
    it("should format seconds only", () => {
      expect(formatRemainingTime(30)).toBe("30s");
    });

    it("should format minutes and seconds", () => {
      expect(formatRemainingTime(90)).toBe("1m 30s");
    });

    it("should format hours, minutes and seconds", () => {
      expect(formatRemainingTime(3661)).toBe("1h 1m 1s");
    });

    it("should return 0s for zero or negative", () => {
      expect(formatRemainingTime(0)).toBe("0s");
      expect(formatRemainingTime(-10)).toBe("0s");
    });
  });

  describe("isExpiringSoon", () => {
    it("should return true for lease expiring soon", () => {
      const now = new Date();
      const lease: Lease = {
        id: "lease-1",
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        acquiredAt: now,
        expiresAt: new Date(now.getTime() + 15000), // 15 seconds
        status: "active",
        renewCount: 0,
        maxRenews: 5,
        metadata: {
          durationSeconds: 60,
          createdAt: now,
          updatedAt: now,
        },
      };

      expect(isExpiringSoon(lease, 30)).toBe(true);
    });

    it("should return false for lease not expiring soon", () => {
      const now = new Date();
      const lease: Lease = {
        id: "lease-1",
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        acquiredAt: now,
        expiresAt: new Date(now.getTime() + 60000), // 60 seconds
        status: "active",
        renewCount: 0,
        maxRenews: 5,
        metadata: {
          durationSeconds: 60,
          createdAt: now,
          updatedAt: now,
        },
      };

      expect(isExpiringSoon(lease, 30)).toBe(false);
    });

    it("should return false for non-active lease", () => {
      const now = new Date();
      const lease: Lease = {
        id: "lease-1",
        taskId: "task-1",
        holderDid: "did:anp:nanobot:worker1",
        acquiredAt: now,
        expiresAt: new Date(now.getTime() + 15000),
        status: "released",
        renewCount: 0,
        maxRenews: 5,
        metadata: {
          durationSeconds: 60,
          createdAt: now,
          updatedAt: now,
        },
      };

      expect(isExpiringSoon(lease, 30)).toBe(false);
    });
  });
});
