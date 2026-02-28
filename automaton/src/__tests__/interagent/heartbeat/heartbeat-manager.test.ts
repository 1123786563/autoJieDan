/**
 * 心跳管理器测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HeartbeatManager } from "../../../interagent/heartbeat/heartbeat-manager";
import type { HeartbeatEvent, HeartbeatPayload } from "../../../interagent/heartbeat/types";

describe("HeartbeatManager", () => {
  let manager: HeartbeatManager;
  let senderCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    manager = new HeartbeatManager("did:anp:automaton:test", {
      interval: 1000, // 1秒间隔用于测试
      timeout: 3000, // 3秒超时
      failureThreshold: 3,
      enabled: true,
    });
    senderCallback = vi.fn().mockResolvedValue(true);
  });

  afterEach(async () => {
    await manager.stop();
  });

  describe("启动和停止", () => {
    it("应该成功启动", async () => {
      await manager.start(senderCallback);
      expect(manager.isActive()).toBe(true);
    });

    it("应该成功停止", async () => {
      await manager.start(senderCallback);
      await manager.stop();
      expect(manager.isActive()).toBe(false);
    });

    it("重复启动不应报错", async () => {
      await manager.start(senderCallback);
      await manager.start(senderCallback);
      expect(manager.isActive()).toBe(true);
    });
  });

  describe("连接管理", () => {
    it("应该注册连接", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const state = manager.getConnectionState("conn1");
      expect(state).toBeDefined();
      expect(state?.connectionId).toBe("conn1");
      expect(state?.targetDid).toBe("did:anp:nanobot:test1");
      expect(state?.connected).toBe(true);
    });

    it("应该注销连接", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");
      expect(manager.getConnectionState("conn1")).toBeDefined();

      manager.unregisterConnection("conn1");
      expect(manager.getConnectionState("conn1")).toBeUndefined();
    });

    it("不应重复注册相同连接", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");
      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const states = manager.getAllConnectionStates();
      const conn1States = states.filter((s) => s.connectionId === "conn1");
      expect(conn1States.length).toBe(1);
    });

    it("应该支持多个连接", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");
      manager.registerConnection("conn2", "did:anp:nanobot:test2");
      manager.registerConnection("conn3", "did:anp:nanobot:test3");

      const states = manager.getAllConnectionStates();
      expect(states.length).toBe(3);
    });
  });

  describe("心跳发送", () => {
    it("应该发送心跳到所有连接", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");
      manager.registerConnection("conn2", "did:anp:nanobot:test2");

      await manager.sendHeartbeats();

      expect(senderCallback).toHaveBeenCalledTimes(2);
    });

    it("心跳应包含正确的负载", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      await manager.sendHeartbeats();

      const calls = senderCallback.mock.calls;
      expect(calls.length).toBe(1);

      const event: HeartbeatEvent = calls[0][0];
      expect(event.type).toBe("heartbeat:sent");
      expect(event.targetDid).toBe("did:anp:nanobot:test1");
      expect(event.payload).toMatchObject({
        status: "healthy",
        sequence: expect.any(Number),
        timestamp: expect.any(String),
        version: "1.0.0",
      });
    });

    it("序列号应递增", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      await manager.sendHeartbeats();
      await manager.sendHeartbeats();

      const calls = senderCallback.mock.calls;
      const seq1 = calls[0][0].payload.sequence;
      const seq2 = calls[1][0].payload.sequence;

      expect(seq2).toBe(seq1 + 1);
    });

    it("应记录发送统计", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      await manager.sendHeartbeats();

      const state = manager.getConnectionState("conn1");
      expect(state?.totalSent).toBe(1);
      expect(state?.lastSent).toBeInstanceOf(Date);
    });
  });

  describe("心跳接收", () => {
    it("应该处理接收到的心跳", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const payload: HeartbeatPayload = {
        status: "healthy",
        uptime: 100,
        activeTasks: 5,
        queuedTasks: 2,
        timestamp: new Date().toISOString(),
        sequence: 1,
        version: "1.0.0",
      };

      manager.handleHeartbeat("conn1", payload);

      const state = manager.getConnectionState("conn1");
      expect(state?.totalReceived).toBe(1);
      expect(state?.lastReceived).toBeInstanceOf(Date);
      expect(state?.lastHeartbeat).toBeInstanceOf(Date);
    });

    it("应更新连接状态为健康", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const payload: HeartbeatPayload = {
        status: "healthy",
        uptime: 100,
        activeTasks: 0,
        queuedTasks: 0,
        timestamp: new Date().toISOString(),
        sequence: 1,
        version: "1.0.0",
      };

      manager.handleHeartbeat("conn1", payload);

      const state = manager.getConnectionState("conn1");
      expect(state?.status).toBe("healthy");
    });

    it("应触发恢复事件", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      // 先设置为降级状态
      const state = manager.getConnectionState("conn1");
      if (state) {
        state.consecutiveFailures = 1;
        state.status = "degraded";
      }

      const recoveredSpy = vi.fn();
      manager.on("heartbeat:recovered", recoveredSpy);

      const payload: HeartbeatPayload = {
        status: "healthy",
        uptime: 100,
        activeTasks: 0,
        queuedTasks: 0,
        timestamp: new Date().toISOString(),
        sequence: 1,
        version: "1.0.0",
      };

      manager.handleHeartbeat("conn1", payload);

      expect(recoveredSpy).toHaveBeenCalledWith({ connectionId: "conn1" });
    });
  });

  describe("超时检测", () => {
    it("应检测超时连接", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const timeoutSpy = vi.fn();
      manager.on("heartbeat:timeout", timeoutSpy);

      // 模拟超时：设置一个很旧的 lastReceived 时间
      const state = manager.getConnectionState("conn1");
      if (state) {
        state.lastReceived = new Date(Date.now() - 10000); // 10秒前
      }

      // 等待超时检查
      await new Promise((resolve) => setTimeout(resolve, 3500));

      expect(timeoutSpy).toHaveBeenCalled();
    }, 10000);

    it("应增加失败计数", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const state = manager.getConnectionState("conn1");
      const initialFailures = state?.totalFailures || 0;

      // 模拟超时
      if (state) {
        state.lastReceived = new Date(Date.now() - 10000);
      }

      await new Promise((resolve) => setTimeout(resolve, 3500));

      const updatedState = manager.getConnectionState("conn1");
      expect(updatedState?.totalFailures).toBeGreaterThan(initialFailures);
    }, 10000);
  });

  describe("失败阈值和重连", () => {
    it("应达到失败阈值时请求重连", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const reconnectSpy = vi.fn();
      manager.on("reconnect:requested", reconnectSpy);

      const state = manager.getConnectionState("conn1");
      if (state) {
        state.consecutiveFailures = 3;
      }

      await manager.sendHeartbeats();

      expect(reconnectSpy).toHaveBeenCalledWith({
        connectionId: "conn1",
        targetDid: "did:anp:nanobot:test1",
      });
    });

    it("应限制最大重试次数", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const abandonedSpy = vi.fn();
      manager.on("reconnect:abandoned", abandonedSpy);

      const state = manager.getConnectionState("conn1");
      if (state) {
        state.consecutiveFailures = 3;
        state.reconnectCount = 5; // 达到最大重试次数
      }

      await manager.sendHeartbeats();

      expect(abandonedSpy).toHaveBeenCalledWith({
        connectionId: "conn1",
        reason: "Max retries reached",
      });
    });

    it("重连后应重置失败计数", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const state = manager.getConnectionState("conn1");
      if (state) {
        state.consecutiveFailures = 2;
        state.status = "degraded";
      }

      manager.resetConnection("conn1");

      const updatedState = manager.getConnectionState("conn1");
      expect(updatedState?.consecutiveFailures).toBe(0);
      expect(updatedState?.connected).toBe(true);
    });
  });

  describe("状态确定", () => {
    it("未接收心跳时应为未知状态", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const state = manager.getConnectionState("conn1");
      expect(state?.status).toBe("unknown");
    });

    it("接收心跳后应为健康状态", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const payload: HeartbeatPayload = {
        status: "healthy",
        uptime: 100,
        activeTasks: 0,
        queuedTasks: 0,
        timestamp: new Date().toISOString(),
        sequence: 1,
        version: "1.0.0",
      };

      manager.handleHeartbeat("conn1", payload);

      const state = manager.getConnectionState("conn1");
      expect(state?.status).toBe("healthy");
    });

    it("有失败计数时应为降级状态", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const payload: HeartbeatPayload = {
        status: "healthy",
        uptime: 100,
        activeTasks: 0,
        queuedTasks: 0,
        timestamp: new Date().toISOString(),
        sequence: 1,
        version: "1.0.0",
      };

      manager.handleHeartbeat("conn1", payload);

      const state = manager.getConnectionState("conn1");
      if (state) {
        state.consecutiveFailures = 1;
        state.status = manager["determineStatus"](state);
      }

      expect(state?.status).toBe("degraded");
    });

    it("达到失败阈值时应为不健康状态", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const payload: HeartbeatPayload = {
        status: "healthy",
        uptime: 100,
        activeTasks: 0,
        queuedTasks: 0,
        timestamp: new Date().toISOString(),
        sequence: 1,
        version: "1.0.0",
      };

      manager.handleHeartbeat("conn1", payload);

      const state = manager.getConnectionState("conn1");
      if (state) {
        state.consecutiveFailures = 3;
        state.status = manager["determineStatus"](state);
      }

      expect(state?.status).toBe("unhealthy");
    });
  });

  describe("统计信息", () => {
    it("应正确计算统计信息", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");
      manager.registerConnection("conn2", "did:anp:nanobot:test2");

      const state1 = manager.getConnectionState("conn1");
      if (state1) {
        state1.totalSent = 10;
        state1.totalReceived = 8;
        state1.status = "healthy";
      }

      const state2 = manager.getConnectionState("conn2");
      if (state2) {
        state2.totalSent = 5;
        state2.totalReceived = 3;
        state2.status = "degraded";
      }

      const stats = manager.getStats();

      expect(stats.totalConnections).toBe(2);
      expect(stats.healthyConnections).toBe(1);
      expect(stats.degradedConnections).toBe(1);
      expect(stats.totalSent).toBe(15);
      expect(stats.totalReceived).toBe(11);
    });

    it("应计算丢失率", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const state = manager.getConnectionState("conn1");
      if (state) {
        state.totalSent = 10;
        state.totalReceived = 7;
      }

      const stats = manager.getStats();

      expect(stats.lossRate).toBeCloseTo(30); // 30% 丢失率
    });
  });

  describe("配置更新", () => {
    it("应该更新配置", async () => {
      manager.updateConfig({ interval: 5000 });

      const config = manager["config"];
      expect(config.interval).toBe(5000);
    });

    it("应保持未更新的配置值", async () => {
      const originalTimeout = manager["config"].timeout;

      manager.updateConfig({ interval: 5000 });

      expect(manager["config"].timeout).toBe(originalTimeout);
    });
  });

  describe("RTT 计算", () => {
    it("应计算往返时间", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      // 发送心跳
      await manager.sendHeartbeats();

      // 等待一下确保心跳记录已创建
      await new Promise(resolve => setTimeout(resolve, 100));

      // 获取连接状态来获取实际发送的序列号
      const state = manager.getConnectionState("conn1");
      const sentSequence = state?.totalSent || 1;

      // 模拟接收到心跳响应（使用实际发送的序列号）
      const payload: HeartbeatPayload = {
        status: "healthy",
        uptime: 100,
        activeTasks: 0,
        queuedTasks: 0,
        timestamp: new Date().toISOString(),
        sequence: sentSequence,
        version: "1.0.0",
      };

      manager.handleHeartbeat("conn1", payload);

      const stats = manager.getStats();
      expect(stats.averageLatency).toBeGreaterThan(0);
    });
  });

  describe("事件发射", () => {
    it("应发射心跳已发送事件", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const sentSpy = vi.fn();
      manager.on("heartbeat:sent", sentSpy);

      await manager.sendHeartbeats();

      expect(sentSpy).toHaveBeenCalledWith({
        connectionId: "conn1",
        sequence: 1,
      });
    });

    it("应发射心跳已接收事件", async () => {
      await manager.start(senderCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const receivedSpy = vi.fn();
      manager.on("heartbeat:received", receivedSpy);

      const payload: HeartbeatPayload = {
        status: "healthy",
        uptime: 100,
        activeTasks: 0,
        queuedTasks: 0,
        timestamp: new Date().toISOString(),
        sequence: 1,
        version: "1.0.0",
      };

      manager.handleHeartbeat("conn1", payload);

      expect(receivedSpy).toHaveBeenCalledWith({
        connectionId: "conn1",
        payload,
      });
    });

    it("应发射连接失败事件", async () => {
      const failingCallback = vi.fn().mockResolvedValue(false);

      await manager.start(failingCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      const failedSpy = vi.fn();
      manager.on("heartbeat:failed", failedSpy);

      // 发送3次失败心跳以触发失败阈值
      await manager.sendHeartbeats();
      await manager.sendHeartbeats();
      await manager.sendHeartbeats();

      expect(failedSpy).toHaveBeenCalled();

      await manager.stop();
    });
  });

  describe("边界情况", () => {
    it("不应发送心跳到未注册的连接", async () => {
      await manager.start(senderCallback);

      await manager.sendHeartbeat("nonexistent");

      expect(senderCallback).not.toHaveBeenCalled();
    });

    it("应处理未注册连接的心跳响应", async () => {
      await manager.start(senderCallback);

      const payload: HeartbeatPayload = {
        status: "healthy",
        uptime: 100,
        activeTasks: 0,
        queuedTasks: 0,
        timestamp: new Date().toISOString(),
        sequence: 1,
        version: "1.0.0",
      };

      // 不应抛出错误
      expect(() => {
        manager.handleHeartbeat("nonexistent", payload);
      }).not.toThrow();
    });

    it("应处理发送回调失败", async () => {
      const failingCallback = vi.fn().mockRejectedValue(new Error("Send failed"));

      // 添加错误监听器防止未处理错误
      manager.on("error", () => {});

      await manager.start(failingCallback);

      manager.registerConnection("conn1", "did:anp:nanobot:test1");

      // 不应抛出错误，发送应完成
      await manager.sendHeartbeats();

      const state = manager.getConnectionState("conn1");
      expect(state?.totalFailures).toBeGreaterThan(0);

      await manager.stop();
    });
  });
});
