/**
 * 消息压缩模块
 * 实现大消息的 gzip 压缩，减少网络传输量
 *
 * @module interagent.compression
 * @version 1.0.0
 */

import { gzip, gunzip } from "zlib";
import { promisify } from "util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// ============================================================================
// Types
// ============================================================================

/**
 * 压缩选项
 */
export interface CompressionOptions {
  /** 压缩阈值 (字节)，小于此值不压缩 */
  threshold: number;
  /** 压缩级别 (1-9)，1 最快，9 最佳压缩 */
  level: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

/**
 * 压缩结果
 */
export interface CompressionResult {
  /** 压缩后的数据 */
  data: Buffer;
  /** 是否被压缩 */
  compressed: boolean;
  /** 原始大小 (字节) */
  originalSize: number;
  /** 压缩后大小 (字节) */
  compressedSize: number;
}

/**
 * 压缩统计
 */
export interface CompressionStats {
  /** 总压缩次数 */
  totalCompressions: number;
  /** 总解压次数 */
  totalDecompressions: number;
  /** 总原始字节数 */
  totalOriginalBytes: number;
  /** 总压缩字节数 */
  totalCompressedBytes: number;
  /** 跳过压缩次数（数据太小） */
  skippedCompressions: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTIONS: CompressionOptions = {
  threshold: 1024, // 1KB
  level: 6,
};

// ============================================================================
// MessageCompressor Class
// ============================================================================

/**
 * 消息压缩器
 *
 * 使用 gzip 算法压缩数据，支持配置压缩阈值和级别
 *
 * @example
 * ```typescript
 * const compressor = new MessageCompressor({ threshold: 512, level: 6 });
 *
 * // 压缩数据
 * const result = await compressor.compress("large text data...");
 * console.log(`Compressed: ${result.compressed}, Ratio: ${result.compressedSize / result.originalSize}`);
 *
 * // 解压数据
 * const original = await compressor.decompress(result.data, result.compressed);
 * ```
 */
export class MessageCompressor {
  private options: CompressionOptions;
  private stats: CompressionStats;

  constructor(options: Partial<CompressionOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.stats = {
      totalCompressions: 0,
      totalDecompressions: 0,
      totalOriginalBytes: 0,
      totalCompressedBytes: 0,
      skippedCompressions: 0,
    };
  }

  /**
   * 压缩数据
   *
   * @param data - 要压缩的字符串数据
   * @returns 压缩结果
   */
  async compress(data: string): Promise<CompressionResult> {
    const buffer = Buffer.from(data, "utf-8");
    const originalSize = buffer.length;

    // 小于阈值不压缩
    if (originalSize < this.options.threshold) {
      this.stats.skippedCompressions++;
      return {
        data: buffer,
        compressed: false,
        originalSize,
        compressedSize: originalSize,
      };
    }

    // 执行压缩
    const compressed = await gzipAsync(buffer, { level: this.options.level });
    const compressedSize = compressed.length;

    // 如果压缩后反而更大，则不使用压缩
    if (compressedSize >= originalSize) {
      this.stats.skippedCompressions++;
      return {
        data: buffer,
        compressed: false,
        originalSize,
        compressedSize: originalSize,
      };
    }

    // 更新统计
    this.stats.totalCompressions++;
    this.stats.totalOriginalBytes += originalSize;
    this.stats.totalCompressedBytes += compressedSize;

    return {
      data: compressed,
      compressed: true,
      originalSize,
      compressedSize,
    };
  }

  /**
   * 解压数据
   *
   * @param data - 要解压的数据
   * @param compressed - 数据是否被压缩
   * @returns 解压后的字符串
   */
  async decompress(data: Buffer, compressed: boolean): Promise<string> {
    if (!compressed) {
      return data.toString("utf-8");
    }

    this.stats.totalDecompressions++;
    const decompressed = await gunzipAsync(data);
    return decompressed.toString("utf-8");
  }

  /**
   * 获取压缩统计
   */
  getStats(): Readonly<CompressionStats> {
    return { ...this.stats };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalCompressions: 0,
      totalDecompressions: 0,
      totalOriginalBytes: 0,
      totalCompressedBytes: 0,
      skippedCompressions: 0,
    };
  }

  /**
   * 获取压缩率
   */
  getCompressionRatio(): number {
    if (this.stats.totalOriginalBytes === 0) {
      return 0;
    }
    return this.stats.totalCompressedBytes / this.stats.totalOriginalBytes;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 压缩消息对象
 *
 * 将消息对象序列化为 JSON，如果压缩后更小则使用压缩
 *
 * @param message - 要压缩的消息对象
 * @param compressor - 压缩器实例
 * @returns 序列化后的字符串（可能包含压缩标记）
 */
export async function compressMessage(
  message: unknown,
  compressor?: MessageCompressor
): Promise<string> {
  const compressorInstance = compressor || new MessageCompressor();
  const json = JSON.stringify(message);
  const result = await compressorInstance.compress(json);

  if (result.compressed) {
    return JSON.stringify({
      __compressed: true,
      payload: result.data.toString("base64"),
      originalSize: result.originalSize,
    });
  }

  return json;
}

/**
 * 解压消息对象
 *
 * 检测消息是否被压缩，如果是则解压后返回原始对象
 *
 * @param raw - 原始消息字符串
 * @param compressor - 压缩器实例
 * @returns 解析后的消息对象
 */
export async function decompressMessage(
  raw: string,
  compressor?: MessageCompressor
): Promise<unknown> {
  const compressorInstance = compressor || new MessageCompressor();
  const parsed = JSON.parse(raw);

  // 检查是否是压缩格式
  if (parsed && typeof parsed === "object" && parsed.__compressed === true) {
    const payload = Buffer.from(parsed.payload as string, "base64");
    const decompressed = await compressorInstance.decompress(payload, true);
    return JSON.parse(decompressed);
  }

  return parsed;
}

/**
 * 检查字符串是否是压缩消息格式
 */
export function isCompressedMessage(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    return (
      parsed &&
      typeof parsed === "object" &&
      parsed.__compressed === true &&
      typeof parsed.payload === "string"
    );
  } catch {
    return false;
  }
}

// ============================================================================
// Default Export
// ============================================================================

export default MessageCompressor;
