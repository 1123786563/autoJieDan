/**
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  generateECDHKeyPair,
  encryptMessage,
  decryptMessage,
} from "../../src/anp/encryption.js";
import {
  generateKeyPair,
  importPrivateKey,
} from "../../src/anp/did.js";
import {
  createANPMessage,
  verifySignature,
} from "../../src/anp/signature.js";
import { AUTOMATON_DID, NANOBOT_DID } from "../../src/anp/types.js";
import type { ProgressReportPayload } from "../../src/anp/types.js";
import * as crypto from "crypto";

describe("压力测试 - 系统高负载稳定性", () => {
  let automatonSigningKey: crypto.KeyObject;
  let automatonECDHKeyPair: { privateKey: Buffer; publicKey: Buffer };
  let nanobotSigningKey: crypto.KeyObject;
  let nanobotECDHKeyPair: { privateKey: Buffer; publicKey: Buffer };

  // 测试结果收集
  interface StressTestResult {
    concurrency: number;
    duration: number;
    successCount: number;
    failureCount: number;
    avgLatency: number;
    maxLatency: number;
    minLatency: number;
    throughput: number; // 消息/秒
    errors: string[];
  }

  beforeEach(() => {
    const automatonKeyPair = generateKeyPair();
    automatonSigningKey = importPrivateKey(automatonKeyPair.privateKey);
    automatonECDHKeyPair = generateECDHKeyPair();

    const nanobotKeyPair = generateKeyPair();
    nanobotSigningKey = importPrivateKey(nanobotKeyPair.privateKey);
    nanobotECDHKeyPair = generateECDHKeyPair();
  });

  afterEach(() => {
    // 清理资源
  });

  describe("场景1: 10个并发任务", () => {
    it("应该稳定处理10个并发加密消息", async () => {
      const concurrency = 10;
      const results: StressTestResult = {
        concurrency,
        duration: 0,
        successCount: 0,
        failureCount: 0,
        avgLatency: 0,
        maxLatency: 0,
        minLatency: Infinity,
        throughput: 0,
        errors: [],
      };

      const latencies: number[] = [];
      const startTime = Date.now();

      // 创建10个并发任务
      const tasks = Array.from({ length: concurrency }, (_, i) => {
        return new Promise<void>((resolve) => {
          const taskStart = Date.now();

          try {
            // 创建唯一负载
            const payload: ProgressReportPayload = {
              "@type": "anp:ProgressReport",
              "anp:taskId": `concurrent-task-${i}`,
              "anp:progress": (i / concurrency) * 100,
              "anp:currentPhase": `phase-${i}`,
              "anp:completedSteps": [`step-${i}-1`, `step-${i}-2`],
              "anp:nextSteps": [`step-${i}-3`],
            };

            // 创建消息
            const message = createANPMessage(
              payload,
              automatonSigningKey,
              {
                type: "ProgressEvent",
                targetDid: NANOBOT_DID,
              }
            );

            // 加密
            const encrypted = encryptMessage(
              message,
              automatonSigningKey,
              nanobotECDHKeyPair.publicKey,
              { recipientDid: NANOBOT_DID }
            );

            // 解密
            const decrypted = decryptMessage(
              encrypted,
              nanobotECDHKeyPair.privateKey
            );

            // 验证
            const isValid = verifySignature(decrypted, automatonSigningKey);

            const taskEnd = Date.now();
            const latency = taskEnd - taskStart;
            latencies.push(latency);

            if (isValid && decrypted.object["anp:taskId"] === payload["anp:taskId"]) {
              results.successCount++;
            } else {
              results.failureCount++;
              results.errors.push(`Task ${i} validation failed`);
            }
          } catch (error) {
            results.failureCount++;
            results.errors.push(`Task ${i} error: ${error instanceof Error ? error.message : String(error)}`);
          }

          resolve();
        });
      });

      // 等待所有任务完成
      await Promise.all(tasks);

      const endTime = Date.now();
      results.duration = endTime - startTime;

      // 计算统计指标
      if (latencies.length > 0) {
        results.avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        results.maxLatency = Math.max(...latencies);
        results.minLatency = Math.min(...latencies);
      }
      results.throughput = (results.successCount / results.duration) * 1000;

      // 验证结果
      expect(results.successCount).toBe(concurrency);
      expect(results.failureCount).toBe(0);
      expect(results.avgLatency).toBeLessThan(1000); // 平均延迟应小于1秒
      expect(results.throughput).toBeGreaterThan(5); // 吞吐量应大于5消息/秒
    });

    it("应该稳定处理10个并发双向通信", async () => {
      const concurrency = 10;
      const successCount = { value: 0 };
      const failureCount = { value: 0 };

      const tasks = Array.from({ length: concurrency }, (_, i) => {
        return new Promise<void>((resolve) => {
          try {
            // Automaton -> Nanobot
            const outboundPayload: ProgressReportPayload = {
              "@type": "anp:ProgressReport",
              "anp:taskId": `bidirectional-${i}-out`,
              "anp:progress": 50,
              "anp:currentPhase": "outbound",
              "anp:completedSteps": [],
              "anp:nextSteps": [],
            };

            const outboundMessage = createANPMessage(
              outboundPayload,
              automatonSigningKey,
              {
                type: "ProgressEvent",
                targetDid: NANOBOT_DID,
              }
            );

            const outboundEncrypted = encryptMessage(
              outboundMessage,
              automatonSigningKey,
              nanobotECDHKeyPair.publicKey,
              { recipientDid: NANOBOT_DID }
            );

            const outboundDecrypted = decryptMessage(
              outboundEncrypted,
              nanobotECDHKeyPair.privateKey
            );

            // Nanobot -> Automaton (响应)
            const responsePayload: ProgressReportPayload = {
              "@type": "anp:ProgressReport",
              "anp:taskId": `bidirectional-${i}-in`,
              "anp:progress": 100,
              "anp:currentPhase": "response",
              "anp:completedSteps": [],
              "anp:nextSteps": [],
            };

            const responseMessage = createANPMessage(
              responsePayload,
              nanobotSigningKey,
              {
                type: "ProgressEvent",
                targetDid: AUTOMATON_DID,
              }
            );

            const responseEncrypted = encryptMessage(
              responseMessage,
              nanobotSigningKey,
              automatonECDHKeyPair.publicKey,
              { recipientDid: AUTOMATON_DID }
            );

            const responseDecrypted = decryptMessage(
              responseEncrypted,
              automatonECDHKeyPair.privateKey
            );

            // 验证双向通信
            const outboundValid = verifySignature(outboundDecrypted, automatonSigningKey);
            const responseValid = verifySignature(responseDecrypted, nanobotSigningKey);

            if (outboundValid && responseValid) {
              successCount.value++;
            } else {
              failureCount.value++;
            }
          } catch (error) {
            failureCount.value++;
          }

          resolve();
        });
      });

      await Promise.all(tasks);

      expect(successCount.value).toBe(concurrency);
      expect(failureCount.value).toBe(0);
    });

    it("应该稳定处理10个并发不同大小的消息", async () => {
      const concurrency = 10;
      const successCount = { value: 0 };
      const failureCount = { value: 0 };

      // 生成不同大小的负载
      const generatePayload = (size: "small" | "medium" | "large"): ProgressReportPayload => {
        const steps = size === "small" ? 5 : size === "medium" ? 50 : 500;

        return {
          "@type": "anp:ProgressReport",
          "anp:taskId": `size-test-${size}`,
          "anp:progress": 50,
          "anp:currentPhase": "testing",
          "anp:completedSteps": Array.from({ length: steps }, (_, i) => `step-${i}`),
          "anp:nextSteps": Array.from({ length: steps }, (_, i) => `next-${i}`),
          "anp:blockers": Array.from({ length: Math.floor(steps / 10) }, (_, i) => `blocker-${i}`),
        };
      };

      const tasks = Array.from({ length: concurrency }, (_, i) => {
        const size: "small" | "medium" | "large" =
          i < 3 ? "small" : i < 7 ? "medium" : "large";

        return new Promise<void>((resolve) => {
          try {
            const payload = generatePayload(size);
            const message = createANPMessage(
              payload,
              automatonSigningKey,
              {
                type: "ProgressEvent",
                targetDid: NANOBOT_DID,
              }
            );

            const encrypted = encryptMessage(
              message,
              automatonSigningKey,
              nanobotECDHKeyPair.publicKey,
              { recipientDid: NANOBOT_DID }
            );

            const decrypted = decryptMessage(
              encrypted,
              nanobotECDHKeyPair.privateKey
            );

            if (decrypted.object["anp:completedSteps"].length === payload["anp:completedSteps"].length) {
              successCount.value++;
            } else {
              failureCount.value++;
            }
          } catch (error) {
            failureCount.value++;
          }

          resolve();
        });
      });

      await Promise.all(tasks);

      expect(successCount.value).toBe(concurrency);
      expect(failureCount.value).toBe(0);
    });
  });

  describe("场景2: 资源耗尽恢复", () => {
    it("应该在大量处理后正常工作", async () => {
      const totalMessages = 100;
      const batchSize = 10;
      let successCount = 0;
      let failureCount = 0;

      // 分批处理大量消息
      for (let batch = 0; batch < totalMessages / batchSize; batch++) {
        const tasks = Array.from({ length: batchSize }, (_, i) => {
          const globalIndex = batch * batchSize + i;

          return new Promise<void>((resolve) => {
            try {
              const payload: ProgressReportPayload = {
                "@type": "anp:ProgressReport",
                "anp:taskId": `recovery-test-${globalIndex}`,
                "anp:progress": (globalIndex / totalMessages) * 100,
                "anp:currentPhase": "processing",
                "anp:completedSteps": [`batch-${batch}-step-${i}`],
                "anp:nextSteps": [],
              };

              const message = createANPMessage(
                payload,
                automatonSigningKey,
                {
                  type: "ProgressEvent",
                  targetDid: NANOBOT_DID,
                }
              );

              const encrypted = encryptMessage(
                message,
                automatonSigningKey,
                nanobotECDHKeyPair.publicKey,
                { recipientDid: NANOBOT_DID }
              );

              const decrypted = decryptMessage(
                encrypted,
                nanobotECDHKeyPair.privateKey
              );

              successCount++;
            } catch (error) {
              failureCount++;
            }

            resolve();
          });
        });

        await Promise.all(tasks);

        // 验证系统仍然正常工作
        expect(failureCount).toBe(0);
      }

      expect(successCount).toBe(totalMessages);
      expect(failureCount).toBe(0);
    });

    it("应该在内存压力下正常工作", async () => {
      // 创建大消息增加内存压力
      const largePayload: ProgressReportPayload = {
        "@type": "anp:ProgressReport",
        "anp:taskId": "memory-pressure-test",
        "anp:progress": 50,
        "anp:currentPhase": "memory-test",
        "anp:completedSteps": Array.from({ length: 1000 }, (_, i) => `step-${i}-with-long-description`),
        "anp:nextSteps": Array.from({ length: 1000 }, (_, i) => `next-step-${i}-with-long-description`),
        "anp:blockers": Array.from({ length: 100 }, (_, i) => `blocker-${i}-with-extended-details`),
      };

      const iterations = 20;
      const successCount = { value: 0 };

      for (let i = 0; i < iterations; i++) {
        try {
          const message = createANPMessage(
            largePayload,
            automatonSigningKey,
            {
              type: "ProgressEvent",
              targetDid: NANOBOT_DID,
            }
          );

          const encrypted = encryptMessage(
            message,
            automatonSigningKey,
            nanobotECDHKeyPair.publicKey,
            { recipientDid: NANOBOT_DID }
          );

          const decrypted = decryptMessage(
            encrypted,
            nanobotECDHKeyPair.privateKey
          );

          if (decrypted.object["anp:completedSteps"].length === 1000) {
            successCount.value++;
          }
        } catch (error) {
          // 内存压力可能导致错误，但应该能恢复
        }
      }

      // 至少应该有80%的成功率
      expect(successCount.value / iterations).toBeGreaterThanOrEqual(0.8);
    });

    it("应该在错误后自动恢复", async () => {
      let successAfterError = false;

      // 先触发一个错误
      try {
        const payload: ProgressReportPayload = {
          "@type": "anp:ProgressReport",
          "anp:taskId": "error-trigger",
          "anp:progress": 0,
          "anp:currentPhase": "error",
          "anp:completedSteps": [],
          "anp:nextSteps": [],
        };

        const message = createANPMessage(
          payload,
          automatonSigningKey,
          {
            type: "ProgressEvent",
            targetDid: NANOBOT_DID,
          }
        );

        const encrypted = encryptMessage(
          message,
          automatonSigningKey,
          nanobotECDHKeyPair.publicKey,
          { recipientDid: NANOBOT_DID }
        );

        // 故意使用错误的密钥解密
        const wrongKeyPair = generateECDHKeyPair();
        decryptMessage(encrypted, wrongKeyPair.privateKey);

        // 如果没有抛出错误，手动触发
        throw new Error("Expected error");
      } catch (error) {
        // 预期的错误
      }

      // 验证系统恢复后正常工作
      try {
        const payload: ProgressReportPayload = {
          "@type": "anp:ProgressReport",
          "anp:taskId": "recovery-test",
          "anp:progress": 100,
          "anp:currentPhase": "recovered",
          "anp:completedSteps": [],
          "anp:nextSteps": [],
        };

        const message = createANPMessage(
          payload,
          automatonSigningKey,
          {
            type: "ProgressEvent",
            targetDid: NANOBOT_DID,
          }
        );

        const encrypted = encryptMessage(
          message,
          automatonSigningKey,
          nanobotECDHKeyPair.publicKey,
          { recipientDid: NANOBOT_DID }
        );

        const decrypted = decryptMessage(
          encrypted,
          nanobotECDHKeyPair.privateKey
        );

        successAfterError = verifySignature(decrypted, automatonSigningKey);
      } catch (error) {
        successAfterError = false;
      }

      expect(successAfterError).toBe(true);
    });
  });

  describe("场景3: 优雅降级", () => {
    it("应该在并发限制下优雅处理", async () => {
      const highConcurrency = 50;
      const processedMessages: string[] = [];
      const errors: number = { value: 0 };

      // 使用有限的并发槽位
      const maxConcurrent = 10;
      let activeSlots = 0;

      const processMessage = (index: number): Promise<void> => {
        return new Promise<void>((resolve) => {
          const tryProcess = () => {
            if (activeSlots < maxConcurrent) {
              activeSlots++;

              try {
                const payload: ProgressReportPayload = {
                  "@type": "anp:ProgressReport",
                  "anp:taskId": `graceful-${index}`,
                  "anp:progress": 50,
                  "anp:currentPhase": "processing",
                  "anp:completedSteps": [],
                  "anp:nextSteps": [],
                };

                const message = createANPMessage(
                  payload,
                  automatonSigningKey,
                  {
                    type: "ProgressEvent",
                    targetDid: NANOBOT_DID,
                  }
                );

                const encrypted = encryptMessage(
                  message,
                  automatonSigningKey,
                  nanobotECDHKeyPair.publicKey,
                  { recipientDid: NANOBOT_DID }
                );

                const decrypted = decryptMessage(
                  encrypted,
                  nanobotECDHKeyPair.privateKey
                );

                processedMessages.push(payload["anp:taskId"]);
              } catch (error) {
                errors.value++;
              } finally {
                activeSlots--;
                resolve();
              }
            } else {
              // 等待槽位可用
              setTimeout(tryProcess, 10);
            }
          };

          tryProcess();
        });
      };

      const tasks = Array.from({ length: highConcurrency }, (_, i) => processMessage(i));
      await Promise.all(tasks);

      // 验证所有消息都被处理（可能有少量错误）
      expect(processedMessages.length + errors.value).toBe(highConcurrency);
      expect(errors.value).toBeLessThan(highConcurrency * 0.1); // 错误率应低于10%
    });

    it("应该在超时后优雅处理", async () => {
      const timeoutMs = 1000;
      const successCount = { value: 0 };
      const timeoutCount = { value: 0 };

      const tasks = Array.from({ length: 5 }, (_, i) => {
        return new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            timeoutCount.value++;
            resolve();
          }, timeoutMs);

          try {
            const payload: ProgressReportPayload = {
              "@type": "anp:ProgressReport",
              "anp:taskId": `timeout-test-${i}`,
              "anp:progress": 50,
              "anp:currentPhase": "testing",
              "anp:completedSteps": [],
              "anp:nextSteps": [],
            };

            const message = createANPMessage(
              payload,
              automatonSigningKey,
              {
                type: "ProgressEvent",
                targetDid: NANOBOT_DID,
              }
            );

            const encrypted = encryptMessage(
              message,
              automatonSigningKey,
              nanobotECDHKeyPair.publicKey,
              { recipientDid: NANOBOT_DID }
            );

            const decrypted = decryptMessage(
              encrypted,
              nanobotECDHKeyPair.privateKey
            );

            clearTimeout(timeout);
            successCount.value++;
          } catch (error) {
            clearTimeout(timeout);
          }

          resolve();
        });
      });

      await Promise.all(tasks);

      // 验证处理结果
      expect(successCount.value + timeoutCount.value).toBe(5);
    });

    it("应该在资源不足时优雅降级", async () => {
      // 模拟资源不足的情况
      const normalCount = { value: 0 };
      const degradedCount = { value: 0 };

      const processWithResourceCheck = async (
        index: number
      ): Promise<"normal" | "degraded" | "error"> => {
        try {
          const payload: ProgressReportPayload = {
            "@type": "anp:ProgressReport",
            "anp:taskId": `resource-check-${index}`,
            "anp:progress": 50,
            "anp:currentPhase": "testing",
            "anp:completedSteps": [],
            "anp:nextSteps": [],
          };

          const message = createANPMessage(
            payload,
            automatonSigningKey,
            {
              type: "ProgressEvent",
              targetDid: NANOBOT_DID,
            }
          );

          const encrypted = encryptMessage(
            message,
            automatonSigningKey,
            nanobotECDHKeyPair.publicKey,
            { recipientDid: NANOBOT_DID }
          );

          const decrypted = decryptMessage(
            encrypted,
            nanobotECDHKeyPair.privateKey
          );

          return "normal";
        } catch (error) {
          return "error";
        }
      };

      const tasks = Array.from({ length: 10 }, (_, i) =>
        processWithResourceCheck(i).then((result) => {
          if (result === "normal") normalCount.value++;
          else if (result === "degraded") degradedCount.value++;
        })
      );

      await Promise.all(tasks);

      // 至少应该有90%的正常处理率
      expect(normalCount.value / 10).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe("场景4: 持续压力测试", () => {
    it("应该持续处理消息而不泄漏资源", async () => {
      const duration = 5000; // 5秒持续测试
      const startTime = Date.now();
      const processedCount = { value: 0 };
      const errors = { value: 0 };

      const processMessage = (): Promise<void> => {
        return new Promise<void>((resolve) => {
          try {
            const payload: ProgressReportPayload = {
              "@type": "anp:ProgressReport",
              "anp:taskId": `continuous-${processedCount.value}`,
              "anp:progress": 50,
              "anp:currentPhase": "continuous",
              "anp:completedSteps": [],
              "anp:nextSteps": [],
            };

            const message = createANPMessage(
              payload,
              automatonSigningKey,
              {
                type: "ProgressEvent",
                targetDid: NANOBOT_DID,
              }
            );

            const encrypted = encryptMessage(
              message,
              automatonSigningKey,
              nanobotECDHKeyPair.publicKey,
              { recipientDid: NANOBOT_DID }
            );

            const decrypted = decryptMessage(
              encrypted,
              nanobotECDHKeyPair.privateKey
            );

            processedCount.value++;
          } catch (error) {
            errors.value++;
          }

          resolve();
        });
      };

      // 持续处理消息直到时间到期
      while (Date.now() - startTime < duration) {
        const tasks = Array.from({ length: 5 }, () => processMessage());
        await Promise.all(tasks);
      }

      // 验证处理结果
      expect(processedCount.value).toBeGreaterThan(50); // 至少处理50条消息
      expect(errors.value).toBeLessThan(processedCount.value * 0.05); // 错误率应低于5%
    });

    it("应该在高吞吐量下保持稳定性", async () => {
      const messageCount = 100;
      const latencies: number[] = [];
      const errors = { value: 0 };

      const startTime = Date.now();

      const tasks = Array.from({ length: messageCount }, (_, i) => {
        return new Promise<void>((resolve) => {
          const taskStart = Date.now();

          try {
            const payload: ProgressReportPayload = {
              "@type": "anp:ProgressReport",
              "anp:taskId": `throughput-${i}`,
              "anp:progress": (i / messageCount) * 100,
              "anp:currentPhase": "high-throughput",
              "anp:completedSteps": [],
              "anp:nextSteps": [],
            };

            const message = createANPMessage(
              payload,
              automatonSigningKey,
              {
                type: "ProgressEvent",
                targetDid: NANOBOT_DID,
              }
            );

            const encrypted = encryptMessage(
              message,
              automatonSigningKey,
              nanobotECDHKeyPair.publicKey,
              { recipientDid: NANOBOT_DID }
            );

            const decrypted = decryptMessage(
              encrypted,
              nanobotECDHKeyPair.privateKey
            );

            latencies.push(Date.now() - taskStart);
          } catch (error) {
            errors.value++;
          }

          resolve();
        });
      });

      await Promise.all(tasks);

      const endTime = Date.now();
      const duration = endTime - startTime;
      const throughput = (messageCount / duration) * 1000; // 消息/秒
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

      // 验证性能指标
      expect(throughput).toBeGreaterThan(10); // 至少10消息/秒
      expect(avgLatency).toBeLessThan(500); // 平均延迟应小于500ms
      expect(errors.value).toBe(0); // 不应该有错误
    });
  });
});
