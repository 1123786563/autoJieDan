/**
 * ANP 消息签名与验证
 *
 * @module anp/signature
 * @version 1.0.0
 */

import * as crypto from "crypto";
import { ulid } from "ulid";
import type { ANPMessage, ANPSignature, ANPPayload, ANPMessageType } from "./types.js";
import { DEFAULT_CONTEXT, AUTOMATON_DID } from "./types.js";

// ============================================================================
// 消息哈希
// ============================================================================

/**
 * 对消息内容进行规范哈希
 * @param message - ANP 消息对象
 * @returns SHA-256 哈希值 (hex)
 */
export function hashMessage(message: ANPMessage): string {
  const messageBytes = Buffer.from(JSON.stringify(message), "utf-8");

  return crypto
    .createHash("sha256")
    .update(messageBytes)
    .digest("hex");
}

/**
 * 对负载内容进行规范哈希
 * @param payload - ANP 负载对象
 * @returns SHA-256 哈希值 (Buffer)
 */
export function hashPayload(payload: ANPPayload): Buffer {
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf-8");
  return crypto.createHash("sha256").update(payloadBytes).digest();
}

// ============================================================================
// 消息签名
// ============================================================================

/**
 * 创建签名 (使用 KeyObject)
 * @param payload - 消息负载
 * @param privateKey - ECDSA 私钥 (KeyObject)
 * @param keyId - 密钥标识符
 * @returns ANP 签名
 */
export function signPayload(
  payload: ANPPayload | Record<string, unknown>,
  privateKey: crypto.KeyObject | Buffer,
  keyId: string
): ANPSignature {
  // 使用规范化JSON序列化确保跨系统一致性
  const payloadJson = canonicalJsonStringify(payload);
  const payloadBytes = Buffer.from(payloadJson, "utf-8");
  const timestamp = new Date().toISOString();

  let signatureBuffer: Buffer;

  if (Buffer.isBuffer(privateKey)) {
    // 使用 Buffer (DER 格式) 签名 - 需要先转换为 KeyObject
    const keyObject = crypto.createPrivateKey({
      key: privateKey,
      format: "der",
      type: "sec1",
    });
    signatureBuffer = crypto.sign(null, payloadBytes, keyObject);
  } else {
    // 使用 KeyObject 签名
    signatureBuffer = crypto.sign(null, payloadBytes, privateKey);
  }

  return {
    type: "EcdsaSecp256r1Signature2019",
    created: timestamp,
    verificationMethod: keyId,
    proofPurpose: "authentication",
    proofValue: signatureBuffer.toString("base64"),
  };
}

/**
 * 验证消息签名 (增强版 - 规范化JSON序列化)
 * @param message - ANP 消息对象
 * @param publicKey - ECDSA 公钥
 * @returns 签名是否有效
 */
export function verifySignature(
  message: ANPMessage,
  publicKey: crypto.KeyObject
): boolean {
  try {
    // 使用与签名时相同的规范化序列化方法
    // 确保 JSON 序列化的顺序和格式一致
    const payloadJson = canonicalJsonStringify(message.object);
    const payloadBytes = Buffer.from(payloadJson, "utf-8");
    const signatureBuffer = Buffer.from(message.signature.proofValue, "base64");

    // 使用 Node.js crypto.verify 验证签名
    const verified = crypto.verify(
      null,
      payloadBytes,
      publicKey,
      signatureBuffer
    );

    return verified;
  } catch (error) {
    // 记录详细错误信息用于调试
    if (error instanceof Error) {
      console.error("[DID验证] 签名验证失败:", {
        messageId: message.id,
        error: error.message,
        signatureType: message.signature.type,
        verificationMethod: message.signature.verificationMethod,
      });
    }
    return false;
  }
}

/**
 * 规范化JSON序列化 - 确保跨系统一致性
 * @param value - 要序列化的值
 * @returns 规范化的JSON字符串
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  // 处理数组
  if (Array.isArray(value)) {
    return `[${value.map(v => canonicalJsonStringify(v)).join(',')}]`;
  }

  // 处理对象
  if (typeof value === 'object') {
    const sortedObj = Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        const val = (value as Record<string, unknown>)[key];
        // 递归处理嵌套对象和数组
        acc[key] = typeof val === 'object' && val !== null
          ? JSON.parse(canonicalJsonStringify(val))
          : val;
        return acc;
      }, {} as Record<string, unknown>);
    return JSON.stringify(sortedObj);
  }

  // 处理基本类型
  return JSON.stringify(value);
}

/**
 * 获取消息签名
 * @param message - ANP 消息对象
 * @returns ANP 签名
 */
export function getSignature(message: ANPMessage): ANPSignature {
  return message.signature;
}

/**
 * 获取签名时间戳
 * @param message - ANP 消息对象
 * @returns ISO 8601 字符串
 */
export function getSignatureTimestamp(message: ANPMessage): string {
  return message.signature.created;
}

/**
 * 添加签名到消息
 * @param message - ANP 消息对象
 * @param signature - 签名对象
 * @returns 新的消息对象
 */
export function addSignature(
  message: Omit<ANPMessage, "signature">,
  signature: ANPSignature
): ANPMessage {
  return {
    ...message,
    signature,
  } as ANPMessage;
}

// ============================================================================
// 消息创建
// ============================================================================

/**
 * 创建 ANP 消息选项
 */
export interface CreateMessageOptions {
  /** 发送方 DID (默认为 AUTOMATON_DID) */
  actorDid?: string;
  /** 目标 DID */
  targetDid?: string;
  /** 关联 ID */
  correlationId?: string;
  /** TTL (秒) */
  ttl?: number;
  /** 消息类型 */
  type: ANPMessageType;
  /** 密钥标识符 */
  keyId?: string;
}

/**
 * 创建 ANP 消息
 * @param payload - 消息负载
 * @param privateKey - ECDSA 私钥
 * @param options - 创建选项
 * @returns ANP 消息
 */
export function createANPMessage(
  payload: ANPPayload,
  privateKey: crypto.KeyObject,
  options: CreateMessageOptions
): ANPMessage {
  const id = ulid();
  const timestamp = new Date().toISOString();
  const actorDid = options.actorDid ?? AUTOMATON_DID;
  const keyId = options.keyId ?? `${actorDid}#key-1`;

  // 创建未签名的消息
  const unsignedMessage: Omit<ANPMessage, "signature"> = {
    "@context": DEFAULT_CONTEXT,
    "@type": "ANPMessage",
    id,
    timestamp,
    actor: actorDid,
    target: options.targetDid ?? "",
    type: options.type,
    object: payload,
    correlationId: options.correlationId,
    ttl: options.ttl ?? 3600,
  };

  // 对负载签名
  const signature = signPayload(payload, privateKey, keyId);

  // 返回完整消息
  return addSignature(unsignedMessage, signature);
}

/**
 * 验证消息完整性 (包括时间戳和签名)
 * @param message - ANP 消息
 * @param publicKey - ECDSA 公钥
 * @param maxAgeMs - 最大消息年龄 (毫秒)
 * @returns 验证结果
 */
export function verifyMessage(
  message: ANPMessage,
  publicKey: crypto.KeyObject,
  maxAgeMs: number = 300000 // 默认 5 分钟
): { valid: boolean; error?: string } {
  // 检查时间戳
  const messageTime = new Date(message.timestamp).getTime();
  const now = Date.now();
  const age = now - messageTime;

  if (age > maxAgeMs) {
    return { valid: false, error: "Message expired" };
  }

  if (age < -60000) { // 允许 1 分钟的时钟偏差
    return { valid: false, error: "Message timestamp in future" };
  }

  // 检查 TTL
  if (message.ttl !== undefined) {
    const ttlMs = message.ttl * 1000;
    if (age > ttlMs) {
      return { valid: false, error: "Message TTL exceeded" };
    }
  }

  // 验证签名
  if (!verifySignature(message, publicKey)) {
    return { valid: false, error: "Invalid signature" };
  }

  return { valid: true };
}
