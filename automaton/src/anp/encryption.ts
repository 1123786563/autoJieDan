/**
 * ANP 加密模块 - ECDH 密钥交换与端到端加密
 *
 * @module anp/encryption
 * @version 1.0.0
 */

import * as crypto from "crypto";
import type { EncryptedPayload, ANPEncryptedMessage, ANPMessage } from "./types.js";
import { DEFAULT_CONTEXT } from "./types.js";
import { signPayload } from "./signature.js";
import { ulid } from "ulid";

// ============================================================================
// ECDH 密钥交换
// ============================================================================

/** ECDH 密钥对 (原始 Buffer 格式) */
export interface ECDHKeyPair {
  privateKey: Buffer;
  publicKey: Buffer;
}

/**
 * 生成 ECDH 临时密钥对
 * @returns ECDH 密钥对 (Buffer 格式)
 */
export function generateECDHKeyPair(): ECDHKeyPair {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();

  return {
    privateKey: ecdh.getPrivateKey(),
    publicKey: ecdh.getPublicKey(),
  };
}

/**
 * 使用 ECDH 计算共享密钥
 * @param myPrivateKey - 我的 ECDH 私钥 (Buffer)
 * @param theirPublicKey - 对方的 ECDH 公钥 (Buffer)
 * @returns 共享密钥 (32 字节)
 */
export function computeSharedSecret(
  myPrivateKey: Buffer,
  theirPublicKey: Buffer
): Buffer {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(myPrivateKey);

  return ecdh.computeSecret(theirPublicKey);
}

/**
 * 从共享密钥派生 AES 密钥
 * @param sharedSecret - ECDH 共享密钥
 * @param info - 密钥派生信息 (可选)
 * @returns AES-256 密钥 (32 字节)
 */
export function deriveAESKey(
  sharedSecret: Buffer,
  info?: Buffer
): Buffer {
  const salt = info || Buffer.from("anp-encryption-v1", "utf-8");
  const derivedKey = crypto.hkdfSync(
    "sha256",
    sharedSecret,
    salt,
    Buffer.from("aes-key", "utf-8"),
    32
  );
  // 确保 Buffer.from 包装，因为 hkdfSync 在某些 Node 版本中可能返回 ArrayBuffer
  return Buffer.from(derivedKey);
}

// ============================================================================
// AES-256-GCM 加密
// ============================================================================

/**
 * AES-256-GCM 加密选项
 */
export interface EncryptOptions {
  additionalData?: Buffer | string;
}

/**
 * AES-256-GCM 加密结果
 */
export interface EncryptResult {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

/**
 * 使用 AES-256-GCM 加密数据
 * @param plaintext - 明文数据
 * @param key - AES 密钥 (32 字节)
 * @param options - 加密选项
 * @returns 加密结果
 */
export function encryptAES(
  plaintext: Buffer | string,
  key: Buffer,
  options?: EncryptOptions
): EncryptResult {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const data = Buffer.isBuffer(plaintext)
    ? plaintext
    : Buffer.from(plaintext, "utf-8");

  if (options?.additionalData) {
    const aad = Buffer.isBuffer(options.additionalData)
      ? options.additionalData
      : Buffer.from(options.additionalData, "utf-8");
    cipher.setAAD(aad);
  }

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  return { ciphertext: encrypted, iv, tag };
}

/**
 * 使用 AES-256-GCM 解密数据
 * @param encrypted - 加密结果
 * @param key - AES 密钥 (32 字节)
 * @param options - 解密选项
 * @returns 解密后的明文
 */
export function decryptAES(
  encrypted: EncryptResult,
  key: Buffer,
  options?: EncryptOptions
): Buffer {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, encrypted.iv);

  if (options?.additionalData) {
    const aad = Buffer.isBuffer(options.additionalData)
      ? options.additionalData
      : Buffer.from(options.additionalData, "utf-8");
    decipher.setAAD(aad);
  }

  decipher.setAuthTag(encrypted.tag);

  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]);
}

// ============================================================================
// 綈息加密
// ============================================================================

/**
 * 加密消息选项
 */
export interface EncryptMessageOptions {
  recipientDid: string;
  correlationId?: string;
  ttl?: number;
}

/**
 * 加密 ANP 消息
 * @param message - 原始 ANP 消息
 * @param senderPrivateKey - 发送方签名私钥 (KeyObject 或 Buffer)
 * @param recipientPublicKey - 接收方加密公钥 (Buffer)
 * @param options - 加密选项
 * @returns 加密的 ANP 消息
 */
export function encryptMessage(
  message: ANPMessage,
  senderPrivateKey: crypto.KeyObject | Buffer,
  recipientPublicKey: Buffer,
  options: EncryptMessageOptions
): ANPEncryptedMessage {
  // 1. 生成 ECDH 临时密钥对
  const ephemeralKeyPair = generateECDHKeyPair();

  // 2. 计算共享密钥
  const sharedSecret = computeSharedSecret(
    ephemeralKeyPair.privateKey,
    recipientPublicKey
  );

  // 3. 派生 AES 密钥
  const aesKey = deriveAESKey(
    sharedSecret,
    Buffer.from(options.recipientDid, "utf-8")
  );

  // 4. 序列化消息
  const messageJson = JSON.stringify(message);

  const { ciphertext, iv, tag } = encryptAES(messageJson, aesKey);

  // 5. 独创建加密负载
  const encryptedPayload: EncryptedPayload = {
    algorithm: "AES-256-GCM",
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
    ephemeralPublicKey: ephemeralKeyPair.publicKey.toString("base64"),
  };

  // 6. 綈息签名需要转换为 Buffer 格式
  const messageForSigning = {
    type: "EncryptedPayload",
    payload: encryptedPayload,
  };

  const keyId = `${message.actor}#key-1`;
  const signature = signPayload(
    messageForSigning,
    senderPrivateKey,
    keyId
  );

  // 7. 构建加密消息
  return {
    "@context": DEFAULT_CONTEXT[0],
    "@type": "ANPEncryptedMessage",
    id: `encrypted-${ulid()}`,
    timestamp: new Date().toISOString(),
    actor: message.actor,
    target: options.recipientDid,
    encryptedPayload,
    signature,
  };
}

/**
 * 解密 ANP 消息
 * @param encryptedMessage - 加密的 ANP 消息
 * @param recipientPrivateKey - 接收方私钥 (Buffer)
 * @returns 解密后的原始消息
 */
export function decryptMessage(
  encryptedMessage: ANPEncryptedMessage,
  recipientPrivateKey: Buffer
): ANPMessage {
  // 1. 从加密负载中提取临时公钥
  const ephemeralPublicKey = Buffer.from(
    encryptedMessage.encryptedPayload.ephemeralPublicKey!,
    "base64"
  );

  // 2. 计算共享密钥
  const sharedSecret = computeSharedSecret(
    recipientPrivateKey,
    ephemeralPublicKey
  );

  // 3. 派生 AES 密钥
  const aesKey = deriveAESKey(
    sharedSecret,
    Buffer.from(encryptedMessage.target, "utf-8")
  );

  // 4. 解密
  const encrypted: EncryptResult = {
    ciphertext: Buffer.from(
      encryptedMessage.encryptedPayload.ciphertext,
      "base64"
    ),
    iv: Buffer.from(encryptedMessage.encryptedPayload.iv, "base64"),
    tag: Buffer.from(encryptedMessage.encryptedPayload.tag, "base64"),
  };

  const decrypted = decryptAES(encrypted, aesKey);

  // 5. 反序列化
  return JSON.parse(decrypted.toString("utf-8")) as ANPMessage;
}
