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
 * 创建签名
 * @param payload - 消息负载
 * @param privateKey - ECDSA 私钥
 * @param keyId - 密钥标识符
 * @returns ANP 签名
 */
export function signPayload(
  payload: ANPPayload,
  privateKey: crypto.KeyObject,
  keyId: string
): ANPSignature {
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf-8");
  const timestamp = new Date().toISOString();

  // 使用 Node.js crypto.sign 进行签名
  const signatureBuffer = crypto.sign(null, payloadBytes, privateKey);

  return {
    type: "EcdsaSecp256r1Signature2019",
    created: timestamp,
    verificationMethod: keyId,
    proofPurpose: "authentication",
    proofValue: signatureBuffer.toString("base64"),
  };
}

/**
 * 验证消息签名
 * @param message - ANP 消息对象
 * @param publicKey - ECDSA 公钥
 * @returns 签名是否有效
 */
export function verifySignature(
  message: ANPMessage,
  publicKey: crypto.KeyObject
): boolean {
  try {
    const payloadBytes = Buffer.from(JSON.stringify(message.object), "utf-8");
    const signatureBuffer = Buffer.from(message.signature.proofValue, "base64");

    // 使用 Node.js crypto.verify 验证签名
    const verified = crypto.verify(
      null,
      payloadBytes,
      publicKey,
      signatureBuffer
    );

    return verified;
  } catch {
    return false;
  }
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
  const keyId = options.keyId ?? `${AUTOMATON_DID}#key-1`;

  // 创建未签名的消息
  const unsignedMessage: Omit<ANPMessage, "signature"> = {
    "@context": DEFAULT_CONTEXT,
    "@type": "ANPMessage",
    id,
    timestamp,
    actor: AUTOMATON_DID,
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
