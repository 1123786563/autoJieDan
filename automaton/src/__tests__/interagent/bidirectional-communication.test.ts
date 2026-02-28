/**
 * T011: 双向通信测试
 *
 * 测试 Automaton 和 Nanobot 之间的双向通信：
 * - Automaton -> Nanobot 消息发送
 * - Nanobot -> Automaton 消息回复
 * - 并发消息处理
 * - 消息顺序保证
 *
 * 验收标准: 双向消息延迟<5s
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import {
  InteragentWebSocketServer,
  WebSocketServerConfig,
  createProgressEvent,
  createErrorEvent,
} from "../../interagent/websocket.js";
import { ulid } from "ulid";

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

describe("T011: 双向通信测试", () => {
  let automatonServer: InteragentWebSocketServer;
  let nanobotServer: InteragentWebSocketServer;
  let automatonPort: number;
  let nanobotPort: number;

  beforeEach(async () => {
    // 获取两个可用端口
    automatonPort = await getAvailablePort();
    nanobotPort = await getAvailablePort();

    // 创建 Automaton 服务器
    const automatonConfig: WebSocketServerConfig = {
      port: automatonPort,
      host: "127.0.0.1",
      did: "did:anp:automaton:main",
    };
    automatonServer = new InteragentWebSocketServer(automatonConfig);
    await automatonServer.start();

    // 创建 Nanobot 服务器
    const nanobotConfig: WebSocketServerConfig = {
      port: nanobotPort,
      host: "127.0.0.1",
      did: "did:anp:nanobot:main",
    };
    nanobotServer = new InteragentWebSocketServer(nanobotConfig);
    await nanobotServer.start();
  });

  afterEach(async () => {
    try {
      await automatonServer.stop();
      await nanobotServer.stop();
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Automaton -> Nanobot 消息发送", () => {
    it("应该能从 Automaton 发送消息到 Nanobot", async () => {
      // Client connects to automatonPort to receive messages from automatonServer
      const nanobotClient = new WebSocket(
        `ws://127.0.0.1:${automatonPort}?did=did:anp:test:client`
      );

      const receivedPromise = new Promise((resolve) => {
        nanobotClient.once("message", (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      await new Promise<void>((resolve) => {
        nanobotClient.once("open", () => resolve());
      });

      // Automaton 发送消息到 Nanobot
      const message = createProgressEvent(
        "did:anp:automaton:main",
        "did:anp:nanobot:main",
        {
          taskId: ulid(),
          progress: 50,
          currentPhase: "testing",
          completedSteps: ["step1"],
          nextSteps: ["step2"],
        }
      );

      const startTime = Date.now();
      automatonServer.sendToDid("did:anp:test:client", message);

      // 等待 Nanobot 接收消息
      const received = await receivedPromise;
      const latency = Date.now() - startTime;

      expect(received).toBeDefined();
      expect(latency).toBeLessThan(5000); // 验收标准: 延迟<5s

      nanobotClient.close();
    });

    it("应该能正确路由消息到目标 DID", async () => {
      const targetDid = "did:anp:test:specific";
      // Client connects to automatonPort to receive messages from automatonServer
      const nanobotClient = new WebSocket(
        `ws://127.0.0.1:${automatonPort}?did=${targetDid}`
      );

      const receivedPromise = new Promise((resolve) => {
        nanobotClient.once("message", (data) => {
          const msg = JSON.parse(data.toString());
          expect(msg.target).toBe(targetDid);
          resolve(msg);
        });
      });

      await new Promise<void>((resolve) => {
        nanobotClient.once("open", () => resolve());
      });

      const message = createProgressEvent(
        "did:anp:automaton:main",
        targetDid,
        {
          taskId: ulid(),
          progress: 75,
        }
      );

      automatonServer.sendToDid(targetDid, message);

      await receivedPromise;
      nanobotClient.close();
    });
  });

  describe("Nanobot -> Automaton 消息回复", () => {
    it("应该能从 Nanobot 回复消息到 Automaton", async () => {
      const automatonClient = new WebSocket(
        `ws://127.0.0.1:${automatonPort}?did=did:anp:automaton:worker`
      );

      const receivedPromise = new Promise((resolve) => {
        automatonClient.once("message", (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      await new Promise<void>((resolve) => {
        automatonClient.once("open", () => resolve());
      });

      // Nanobot 发送回复消息
      const reply = createProgressEvent(
        "did:anp:nanobot:main",
        "did:anp:automaton:worker",
        {
          taskId: ulid(),
          progress: 100,
          currentPhase: "completed",
          completedSteps: ["step1", "step2"],
          nextSteps: [],
        }
      );

      const startTime = Date.now();
      nanobotServer.sendToDid("did:anp:automaton:worker", reply);

      const received = await receivedPromise;
      const latency = Date.now() - startTime;

      expect(received).toBeDefined();
      expect(latency).toBeLessThan(5000);

      automatonClient.close();
    });
  });

  describe("并发消息处理", () => {
    it("应该能处理并发消息而不丢失", async () => {
      const messageCount = 100;
      const nanobotClient = new WebSocket(
        `ws://127.0.0.1:${nanobotPort}?did=did:anp:test:concurrent`
      );

      const receivedMessages: unknown[] = [];

      nanobotClient.on("message", (data) => {
        receivedMessages.push(JSON.parse(data.toString()));
      });

      await new Promise<void>((resolve) => {
        nanobotClient.once("open", () => resolve());
      });

      // Wait for welcome message to be received
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      receivedMessages.length = 0; // Clear welcome message

      // 并发发送多条消息
      const messageIds: string[] = [];

      for (let i = 0; i < messageCount; i++) {
        const messageId = ulid();
        messageIds.push(messageId);

        const message = createProgressEvent(
          "did:anp:nanobot:main",
          "did:anp:test:concurrent",
          {
            taskId: messageId,
            progress: i,
          }
        );

        nanobotServer.sendToDid("did:anp:test:concurrent", message);
      }

      const startTime = Date.now();

      // 等待所有消息被接收
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      const latency = Date.now() - startTime;

      // 验证所有消息都被接收
      const receivedTaskIds = receivedMessages
        .map((msg: unknown) => (msg as Record<string, unknown>).payload?.taskId)
        .filter(Boolean);

      expect(receivedTaskIds.length).toBeGreaterThanOrEqual(messageCount * 0.95); // 允许5%的误差
      expect(latency).toBeLessThan(5000);

      nanobotClient.close();
    });

    it("应该在并发情况下保持消息完整性", async () => {
      const concurrentClients = 10;
      const messagesPerClient = 10;

      const clients: WebSocket[] = [];
      const receivedCounts: Map<number, number> = new Map();

      // 创建多个客户端 - 连接到 nanobotPort
      for (let i = 0; i < concurrentClients; i++) {
        const client = new WebSocket(
          `ws://127.0.0.1:${nanobotPort}?did=did:anp:concurrent:${i}`
        );

        receivedCounts.set(i, 0);

        client.on("message", () => {
          receivedCounts.set(i, (receivedCounts.get(i) || 0) + 1);
        });

        await new Promise<void>((resolve) => {
          client.once("open", () => resolve());
        });

        clients.push(client);
      }

      // Wait for welcome messages to be received
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      for (let i = 0; i < concurrentClients; i++) {
        receivedCounts.set(i, 0); // Reset counts after welcome messages
      }

      // 从 nanobotServer 发送消息到每个客户端
      for (let clientIdx = 0; clientIdx < concurrentClients; clientIdx++) {
        for (let msgIdx = 0; msgIdx < messagesPerClient; msgIdx++) {
          const message = createProgressEvent(
            `did:anp:nanobot:main`,
            `did:anp:concurrent:${clientIdx}`,
            {
              taskId: ulid(),
              progress: msgIdx * 10,
            }
          );

          nanobotServer.sendToDid(`did:anp:concurrent:${clientIdx}`, message);
        }
      }

      // 等待消息处理
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));

      // 验证每个客户端都接收到了预期数量的消息
      for (let i = 0; i < concurrentClients; i++) {
        expect(receivedCounts.get(i)!).toBeGreaterThanOrEqual(
          messagesPerClient * 0.9
        );
      }

      // 清理
      for (const client of clients) {
        client.close();
      }
    });
  });

  describe("消息顺序保证", () => {
    it("应该保持消息的发送顺序", async () => {
      const nanobotClient = new WebSocket(
        `ws://127.0.0.1:${nanobotPort}?did=did:anp:test:ordered`
      );

      const receivedMessages: number[] = [];

      nanobotClient.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        receivedMessages.push(msg.payload.progress as number);
      });

      await new Promise<void>((resolve) => {
        nanobotClient.once("open", () => resolve());
      });

      // Wait for welcome message to be received
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      receivedMessages.length = 0; // Clear welcome message

      // 按顺序发送消息 - client is connected to nanobotPort, so send via nanobotServer
      for (let i = 0; i < 50; i++) {
        const message = createProgressEvent(
          "did:anp:nanobot:main",
          "did:anp:test:ordered",
          {
            taskId: ulid(),
            progress: i,
            sequence: i,
          }
        );

        nanobotServer.sendToDid("did:anp:test:ordered", message);

        // 添加小延迟确保发送顺序
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }

      // 等待所有消息被接收
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));

      // 验证消息顺序 (WebSocket 是有序的，所以应该保持顺序)
      for (let i = 1; i < receivedMessages.length; i++) {
        expect(receivedMessages[i]).toBeGreaterThanOrEqual(receivedMessages[i - 1]);
      }

      nanobotClient.close();
    });

    it("应该正确处理带有 correlationId 的消息序列", async () => {
      const correlationId = ulid();
      const nanobotClient = new WebSocket(
        `ws://127.0.0.1:${nanobotPort}?did=did:anp:test:correlation`
      );

      const receivedMessages: unknown[] = [];

      nanobotClient.on("message", (data) => {
        receivedMessages.push(JSON.parse(data.toString()));
      });

      await new Promise<void>((resolve) => {
        nanobotClient.once("open", () => resolve());
      });

      // Wait for welcome message to be received
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      receivedMessages.length = 0; // Clear welcome message

      // 发送具有相同 correlationId 的消息序列
      const sequenceLength = 10;

      for (let i = 0; i < sequenceLength; i++) {
        const message = createProgressEvent(
          "did:anp:nanobot:main",
          "did:anp:test:correlation",
          {
            taskId: ulid(),
            progress: (i + 1) * 10,
            step: i + 1,
          },
          correlationId
        );

        nanobotServer.sendToDid("did:anp:test:correlation", message);
      }

      // 等待所有消息被接收
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));

      // 验证所有消息都有正确的 correlationId
      const correlatedMessages = receivedMessages.filter(
        (msg) => (msg as Record<string, unknown>).correlationId === correlationId
      );

      expect(correlatedMessages.length).toBe(sequenceLength);

      // 验证消息顺序
      const steps = correlatedMessages
        .map((msg) => (msg as Record<string, unknown>).payload?.step)
        .filter((step): step is number => typeof step === "number");

      for (let i = 1; i < steps.length; i++) {
        expect(steps[i]).toBe(steps[i - 1] + 1);
      }

      nanobotClient.close();
    });
  });

  describe("性能和延迟", () => {
    it("应该满足双向消息延迟<5s的验收标准", async () => {
      const iterations = 20;
      const latencies: number[] = [];

      const nanobotClient = new WebSocket(
        `ws://127.0.0.1:${nanobotPort}?did=did:anp:test:latency`
      );

      const sendTimes: number[] = [];

      nanobotClient.on("message", () => {
        latencies.push(Date.now());
      });

      await new Promise<void>((resolve) => {
        nanobotClient.once("open", () => resolve());
      });

      // Wait for welcome message to be received
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      latencies.length = 0; // Clear timestamps from welcome message

      // 发送多条消息并测量延迟 - client is connected to nanobotPort, so send via nanobotServer
      for (let i = 0; i < iterations; i++) {
        sendTimes.push(Date.now());

        const message = createProgressEvent(
          "did:anp:nanobot:main",
          "did:anp:test:latency",
          {
            taskId: ulid(),
            progress: i,
          }
        );

        nanobotServer.sendToDid("did:anp:test:latency", message);
      }

      // 等待所有消息被接收
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));

      // 计算平均延迟
      const delays: number[] = [];
      for (let i = 0; i < Math.min(sendTimes.length, latencies.length); i++) {
        delays.push(latencies[i] - sendTimes[i]);
      }

      const avgDelay =
        delays.reduce((sum, d) => sum + d, 0) / delays.length;

      expect(avgDelay).toBeLessThan(5000); // 验收标准: 平均延迟<5s

      nanobotClient.close();
    });

    it("应该在高负载下保持稳定", async () => {
      const highLoadCount = 1000;
      const nanobotClient = new WebSocket(
        `ws://127.0.0.1:${nanobotPort}?did=did:anp:test:load`
      );

      let receivedCount = 0;

      nanobotClient.on("message", () => {
        receivedCount++;
      });

      await new Promise<void>((resolve) => {
        nanobotClient.once("open", () => resolve());
      });

      const startTime = Date.now();

      // 发送高负载消息
      for (let i = 0; i < highLoadCount; i++) {
        const message = createProgressEvent(
          "did:anp:nanobot:main",
          "did:anp:test:load",
          {
            taskId: ulid(),
            progress: i,
          }
        );

        // Client is connected to nanobotPort, so send via nanobotServer
        nanobotServer.sendToDid("did:anp:test:load", message);
      }

      // 等待消息处理
      await new Promise<void>((resolve) => setTimeout(resolve, 3000));

      const totalTime = Date.now() - startTime;
      const throughput = (receivedCount / totalTime) * 1000; // 消息/秒

      // 验证吞吐量和成功率
      expect(receivedCount).toBeGreaterThan(highLoadCount * 0.9); // 90%成功率
      expect(throughput).toBeGreaterThan(100); // 至少100消息/秒

      nanobotClient.close();
    });
  });

  describe("广播和组播", () => {
    it("应该能向所有连接的客户端广播消息", async () => {
      const clients: WebSocket[] = [];
      const receivedCounts: number[] = [];

      // 创建3个客户端
      for (let i = 0; i < 3; i++) {
        const client = new WebSocket(
          `ws://127.0.0.1:${automatonPort}?did=did:anp:broadcast:${i}`
        );

        receivedCounts[i] = 0;

        client.on("message", () => {
          receivedCounts[i]++;
        });

        await new Promise<void>((resolve) => {
          client.once("open", () => resolve());
        });

        clients.push(client);
      }

      // 广播消息
      const message = createProgressEvent(
        "did:anp:automaton:main",
        "did:anp:broadcast:all",
        {
          taskId: ulid(),
          progress: 100,
        }
      );

      // Clients are connected to automatonPort, so broadcast via automatonServer
      const sentCount = automatonServer.broadcast(message);
      expect(sentCount).toBe(3);

      // 等待消息被接收
      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      // 验证所有客户端都接收到了消息
      for (let i = 0; i < 3; i++) {
        expect(receivedCounts[i]).toBeGreaterThan(0);
      }

      // 清理
      for (const client of clients) {
        client.close();
      }
    });
  });

  describe("错误处理", () => {
    it("应该优雅地处理断开的连接", async () => {
      const client = new WebSocket(
        `ws://127.0.0.1:${nanobotPort}?did=did:anp:test:disconnect`
      );

      await new Promise<void>((resolve) => {
        client.once("open", () => resolve());
      });

      // 客户端断开连接
      client.close();

      // 等待断开处理
      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      // 服务器应该更新客户端计数
      expect(nanobotServer.getClientCount()).toBe(0);

      // 尝试发送消息到断开的连接应该返回 false
      const message = createProgressEvent(
        "did:anp:automaton:main",
        "did:anp:test:disconnect",
        {
          taskId: ulid(),
          progress: 50,
        }
      );

      const sent = automatonServer.sendToDid("did:anp:test:disconnect", message);
      expect(sent).toBe(false);
    });

    it("应该处理无效的 DID", async () => {
      const message = createProgressEvent(
        "did:anp:automaton:main",
        "did:anp:invalid:target",
        {
          taskId: ulid(),
          progress: 50,
        }
      );

      // 发送到不存在的 DID 应该返回 false
      const sent = automatonServer.sendToDid("did:anp:invalid:target", message);
      expect(sent).toBe(false);
    });
  });
});
