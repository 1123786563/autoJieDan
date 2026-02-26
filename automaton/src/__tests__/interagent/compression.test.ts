/**
 * 消息压缩测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  MessageCompressor,
  CompressionOptions,
  compressMessage,
  decompressMessage,
  isCompressedMessage,
} from "../../interagent/compression.js";

// 生成测试数据
function generateLargeText(size: number): string {
  const pattern = "Hello World! 这是一个测试消息。";
  const repeats = Math.ceil(size / pattern.length);
  return pattern.repeat(repeats).slice(0, size);
}

describe("MessageCompressor", () => {
  let compressor: MessageCompressor;

  beforeEach(() => {
    compressor = new MessageCompressor({ threshold: 100, level: 6 });
  });

  describe("constructor", () => {
    it("should create with default options", () => {
      const defaultCompressor = new MessageCompressor();
      expect(defaultCompressor).toBeDefined();
    });

    it("should create with custom options", () => {
      const customCompressor = new MessageCompressor({
        threshold: 512,
        level: 9,
      });
      expect(customCompressor).toBeDefined();
    });
  });

  describe("compress", () => {
    it("should not compress small data", async () => {
      const smallData = "small";
      const result = await compressor.compress(smallData);

      expect(result.compressed).toBe(false);
      expect(result.data.toString("utf-8")).toBe(smallData);
      expect(result.originalSize).toBe(smallData.length);
    });

    it("should compress large data", async () => {
      const largeData = generateLargeText(1000);
      const result = await compressor.compress(largeData);

      expect(result.compressed).toBe(true);
      expect(result.compressedSize).toBeLessThan(result.originalSize);
    });

    it("should track statistics", async () => {
      // 压缩大数据
      await compressor.compress(generateLargeText(1000));
      await compressor.compress(generateLargeText(1000));

      // 跳过小数据
      await compressor.compress("small");

      const stats = compressor.getStats();
      expect(stats.totalCompressions).toBe(2);
      expect(stats.skippedCompressions).toBe(1);
      expect(stats.totalOriginalBytes).toBeGreaterThan(0);
    });

    it("should handle empty string", async () => {
      const result = await compressor.compress("");
      expect(result.compressed).toBe(false);
      expect(result.originalSize).toBe(0);
    });
  });

  describe("decompress", () => {
    it("should decompress compressed data", async () => {
      const originalData = generateLargeText(1000);
      const compressed = await compressor.compress(originalData);

      expect(compressed.compressed).toBe(true);

      const decompressed = await compressor.decompress(
        compressed.data,
        compressed.compressed
      );

      expect(decompressed).toBe(originalData);
    });

    it("should handle uncompressed data", async () => {
      const originalData = "small data";
      const result = await compressor.compress(originalData);

      const decompressed = await compressor.decompress(
        result.data,
        result.compressed
      );

      expect(decompressed).toBe(originalData);
    });
  });

  describe("getStats", () => {
    it("should return initial stats", () => {
      const newCompressor = new MessageCompressor();
      const stats = newCompressor.getStats();

      expect(stats.totalCompressions).toBe(0);
      expect(stats.totalDecompressions).toBe(0);
      expect(stats.totalOriginalBytes).toBe(0);
    });

    it("should track decompression count", async () => {
      const compressed = await compressor.compress(generateLargeText(1000));
      await compressor.decompress(compressed.data, compressed.compressed);
      await compressor.decompress(compressed.data, compressed.compressed);

      const stats = compressor.getStats();
      expect(stats.totalDecompressions).toBe(2);
    });
  });

  describe("resetStats", () => {
    it("should reset all statistics", async () => {
      await compressor.compress(generateLargeText(1000));
      compressor.resetStats();

      const stats = compressor.getStats();
      expect(stats.totalCompressions).toBe(0);
    });
  });

  describe("getCompressionRatio", () => {
    it("should return 0 for no compressions", () => {
      const newCompressor = new MessageCompressor();
      expect(newCompressor.getCompressionRatio()).toBe(0);
    });

    it("should calculate ratio correctly", async () => {
      await compressor.compress(generateLargeText(1000));
      const ratio = compressor.getCompressionRatio();
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(1);
    });
  });
});

describe("compressMessage", () => {
  it("should compress large messages", async () => {
    const message = {
      type: "data",
      payload: generateLargeText(1000),
    };

    const result = await compressMessage(message);
    const parsed = JSON.parse(result);

    expect(parsed.__compressed).toBe(true);
    expect(parsed.payload).toBeDefined();
  });

  it("should not compress small messages", async () => {
    const message = { type: "ping" };
    const result = await compressMessage(message);

    const parsed = JSON.parse(result);
    expect(parsed.__compressed).toBeUndefined();
    expect(parsed.type).toBe("ping");
  });
});

describe("decompressMessage", () => {
  it("should decompress compressed messages", async () => {
    const original = { type: "data", payload: generateLargeText(1000) };
    const compressed = await compressMessage(original);
    const decompressed = (await decompressMessage(compressed)) as typeof original;

    expect(decompressed.type).toBe(original.type);
    expect(decompressed.payload).toBe(original.payload);
  });

  it("should handle uncompressed messages", async () => {
    const original = { type: "ping" };
    const decompressed = await decompressMessage(JSON.stringify(original));

    expect(decompressed).toEqual(original);
  });
});

describe("isCompressedMessage", () => {
  it("should detect compressed messages", async () => {
    const compressed = await compressMessage({
      payload: generateLargeText(1000),
    });
    expect(isCompressedMessage(compressed)).toBe(true);
  });

  it("should return false for uncompressed messages", () => {
    const json = JSON.stringify({ type: "ping" });
    expect(isCompressedMessage(json)).toBe(false);
  });

  it("should return false for invalid JSON", () => {
    expect(isCompressedMessage("not json")).toBe(false);
  });
});
