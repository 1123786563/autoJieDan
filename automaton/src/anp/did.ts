/**
 * DID (Decentralized Identifier) 管理
 * 用于 ANP 协议的身份验证
 *
 * @module anp/did
 * @version 1.0.0
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { ulid } from "ulid";
import type {
  DidDocument,
  DidVerificationMethod,
  DidService,
  AgentCapabilityDescription,
} from "./types.js";
import { AUTOMATON_DID, NANOBOT_DID } from "./types.js";

// ============================================================================
// 密钥对生成
// ============================================================================

/**
 * 生成 ECDSA P-256 密钥对
 * @returns PEM 格式密钥对
 */
export function generateKeyPair(): { privateKey: string; publicKey: string } {
  const keyPair = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });

  return {
    privateKey: keyPair.privateKey.export({ type: "sec1", format: "pem" }) as string,
    publicKey: keyPair.publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

/**
 * 从 PEM 格式导入私钥
 * @param pem - PEM 格式私钥
 * @returns ECDSA 私钥对象
 */
export function importPrivateKey(pem: string): crypto.KeyObject {
  const privateKey = crypto.createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== "ec") {
    throw new Error("Invalid private key: expected ECDSA P-256");
  }
  return privateKey;
}

/**
 * 从 PEM 格式导入公钥
 * @param pem - PEM 格式公钥
 * @returns ECDSA 公钥对象
 */
export function importPublicKey(pem: string): crypto.KeyObject {
  const publicKey = crypto.createPublicKey(pem);
  if (publicKey.asymmetricKeyType !== "ec") {
    throw new Error("Invalid public key: expected ECDSA P-256");
  }
  return publicKey;
}

// ============================================================================
// 公钥转换为 JWK 格式
// ============================================================================

/** JWK 格式公钥 */
export interface JwkPublicKey {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

/**
 * 将公钥转换为 JWK 格式
 * @param publicKey - ECDSA 公钥
 * @returns JWK 对象
 */
export function publicKeyToJwk(publicKey: crypto.KeyObject): JwkPublicKey {
  const jwk = publicKey.export({ format: "jwk" }) as JwkPublicKey;
  return {
    kty: "EC",
    crv: "P-256",
    x: jwk.x,
    y: jwk.y,
  };
}

/**
 * 从 JWK 导入公钥
 * @param jwk - JWK 对象
 * @returns ECDSA 公钥
 */
export function jwkToPublicKey(jwk: JwkPublicKey): crypto.KeyObject {
  return crypto.createPublicKey({
    key: {
      kty: jwk.kty,
      crv: jwk.crv,
      x: jwk.x,
      y: jwk.y,
    },
    format: "jwk",
  });
}

// ============================================================================
// DID 文档生成
// ============================================================================

/**
 * DID 文档生成选项
 */
export interface DidDocumentOptions {
  /** DID 标识符 (如 did:anp:automaton:main) */
  did: string;
  /** 控制器 DID */
  controller?: string;
  /** 服务端点 URL */
  serviceEndpoint: string;
  /** 代理名称 */
  agentName: string;
  /** 代理描述 */
  agentDescription: string;
  /** 代理能力列表 */
  capabilities: string[];
}

/**
 * 生成 DID 文档
 * @param publicKey - ECDSA 公钥
 * @param options - 生成选项
 * @returns DID 文档
 */
export function generateDidDocument(
  publicKey: crypto.KeyObject,
  options: DidDocumentOptions
): DidDocument {
  const { did, serviceEndpoint, agentName, agentDescription, capabilities } = options;

  const keyId = `${did}#key-1`;
  const jwk = publicKeyToJwk(publicKey);

  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/anp/v1",
    ],
    id: did,
    controller: options.controller ?? did,
    verificationMethod: [
      {
        id: keyId,
        type: "JsonWebKey2020",
        controller: options.controller ?? did,
        publicKeyJwk: {
          kty: jwk.kty,
          crv: jwk.crv,
          x: jwk.x,
          y: jwk.y,
        },
      },
    ],
    authentication: [keyId],
    keyAgreement: [keyId],
    service: [
      {
        id: `${did}#anp-service`,
        type: "ANPMessageService",
        serviceEndpoint: serviceEndpoint,
      },
    ],
    capabilityDescription: {
      "@context": "https://schema.org",
      "@type": "SoftwareAgent",
      name: agentName,
      description: agentDescription,
      capabilities: capabilities,
    },
  };
}

// ============================================================================
// DID 解析 (简化版 - 本地解析)
// ============================================================================

/**
 * DID 解析缓存
 */
const didCache = new Map<string, DidDocument>();

/**
 * 注册 DID 文档到缓存
 * @param document - DID 文档
 */
export function registerDidDocument(document: DidDocument): void {
  didCache.set(document.id, document);
}

/**
 * 解析 DID 文档
 * @param did - DID 标识符
 * @returns DID 文档
 */
export function resolveDid(did: string): DidDocument | undefined {
  // 首先检查本地缓存
  const cached = didCache.get(did);
  if (cached) {
    return cached;
  }

  // 对于已知的 DID，返回预配置文档
  if (did === AUTOMATON_DID || did === NANOBOT_DID) {
    // 在实际应用中，这些会从配置或持久化存储加载
    throw new Error(`DID not found: ${did}`);
  }

  // TODO: 支持远程 DID 解析 (通过 DID 解析器)
  throw new Error(`DID not found: ${did}`);
}

/**
 * 获取本地 DID
 * @param agentType - 代理类型
 * @returns DID 标识符
 */
export function getLocalDid(agentType: "automaton" | "nanobot"): string {
  if (agentType === "automaton") {
    return AUTOMATON_DID;
  }
  if (agentType === "nanobot") {
    return NANOBOT_DID;
  }
  throw new Error(`Unknown agent type: ${agentType}`);
}

// ============================================================================
// 密钥存储路径
// ============================================================================

/**
 * 获取密钥存储目录
 * @returns 密钥存储目录
 */
export function getKeyStorePath(): string {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return path.join(homeDir, ".automaton", "keys");
}

/**
 * 确保密钥存储目录存在
 */
export function ensureKeyStorePath(): void {
  const keyStorePath = getKeyStorePath();
  if (!fs.existsSync(keyStorePath)) {
    fs.mkdirSync(keyStorePath, { recursive: true });
  }
}

/**
 * 获取私钥文件路径
 * @param did - DID 标识符
 * @returns 私钥文件路径
 */
export function getPrivateKeyPath(did: string): string {
  const keyStorePath = getKeyStorePath();
  // 将 DID 转换为安全的文件名
  const safeName = did.replace(/[:/]/g, "_");
  return path.join(keyStorePath, `${safeName}_private.pem`);
}

/**
 * 保存私钥到文件
 * @param did - DID 标识符
 * @param privateKey - ECDSA 私钥
 */
export function savePrivateKey(did: string, privateKey: crypto.KeyObject): void {
  ensureKeyStorePath();
  const privateKeyPath = getPrivateKeyPath(did);
  const pem = privateKey.export({ type: "sec1", format: "pem" });
  fs.writeFileSync(privateKeyPath, pem, { mode: 0o600 });
}

/**
 * 从文件加载私钥
 * @param did - DID 标识符
 * @returns ECDSA 私钥
 */
export function loadPrivateKey(did: string): crypto.KeyObject | undefined {
  const privateKeyPath = getPrivateKeyPath(did);

  if (!fs.existsSync(privateKeyPath)) {
    return undefined;
  }

  const pem = fs.readFileSync(privateKeyPath, "utf8");
  return importPrivateKey(pem);
}

// ============================================================================
// 完整的代理身份初始化
// ============================================================================

/**
 * 初始化代理身份
 * @param options - DID 文档选项
 * @returns { didDocument, privateKey, publicKey }
 */
export function initializeAgentIdentity(
  options: DidDocumentOptions
): {
  didDocument: DidDocument;
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
} {
  // 尝试加载现有私钥
  let privateKey = loadPrivateKey(options.did);

  if (!privateKey) {
    // 生成新的密钥对
    const keyPair = generateKeyPair();
    privateKey = importPrivateKey(keyPair.privateKey);

    // 保存私钥
    savePrivateKey(options.did, privateKey);
  }

  const publicKey = crypto.createPublicKey(privateKey);

  // 生成 DID 文档
  const didDocument = generateDidDocument(publicKey, options);

  // 注册到缓存
  registerDidDocument(didDocument);

  return {
    didDocument,
    privateKey,
    publicKey,
  };
}

// ============================================================================
// 密钥轮换机制
// ============================================================================

/**
 * 密钥元数据
 */
export interface KeyMetadata {
  /** 密钥 ID */
  keyId: string;
  /** DID 标识符 */
  did: string;
  /** 创建时间 */
  createdAt: Date;
  /** 过期时间 */
  expiresAt: Date;
  /** 是否为当前密钥 */
  isCurrent: boolean;
  /** 私钥文件路径 */
  privateKeyPath: string;
}

/**
 * 密钥轮换配置
 */
export interface KeyRotationConfig {
  /** 轮换间隔（天） */
  rotationIntervalDays: number;
  /** 密钥生命周期（天） */
  keyLifetimeDays: number;
  /** 宽限期（天） */
  gracePeriodDays: number;
  /** 保留的历史密钥数量 */
  maxHistoryKeys: number;
}

/**
 * 默认密钥轮换配置
 */
export const DEFAULT_KEY_ROTATION_CONFIG: KeyRotationConfig = {
  rotationIntervalDays: 30,
  keyLifetimeDays: 90,
  gracePeriodDays: 7,
  maxHistoryKeys: 5,
};

/**
 * 密钥历史存储
 */
const keyHistory = new Map<string, KeyMetadata[]>();

/**
 * 获取密钥历史存储路径
 */
function getKeyHistoryPath(): string {
  const keyStorePath = getKeyStorePath();
  return path.join(keyStorePath, "key_history.json");
}

/**
 * 保存密钥历史到文件
 */
export function saveKeyHistory(): void {
  const historyData: Record<string, KeyMetadata[]> = {};

  for (const [did, keys] of keyHistory.entries()) {
    historyData[did] = keys;
  }

  ensureKeyStorePath();
  fs.writeFileSync(
    getKeyHistoryPath(),
    JSON.stringify(historyData, null, 2),
    { mode: 0o600 }
  );
}

/**
 * 从文件加载密钥历史
 */
export function loadKeyHistory(): void {
  const keyHistoryPath = getKeyHistoryPath();

  if (!fs.existsSync(keyHistoryPath)) {
    return;
  }

  try {
    const historyData = JSON.parse(
      fs.readFileSync(keyHistoryPath, "utf8")
    ) as Record<string, KeyMetadata[]>;

    for (const [did, keys] of Object.entries(historyData)) {
      keyHistory.set(did, keys.map((k) => ({
        ...k,
        createdAt: new Date(k.createdAt),
        expiresAt: new Date(k.expiresAt),
      })));
    }
  } catch (error) {
    // 如果加载失败，初始化空历史
    keyHistory.clear();
  }
}

/**
 * 获取密钥元数据
 */
export function getKeyMetadata(
  did: string,
  keyId?: string
): KeyMetadata | undefined {
  const keys = keyHistory.get(did);
  if (!keys) {
    return undefined;
  }

  if (keyId) {
    return keys.find((k) => k.keyId === keyId);
  }

  // 返回当前密钥
  return keys.find((k) => k.isCurrent);
}

/**
 * 添加密钥元数据到历史
 */
function addKeyMetadata(metadata: KeyMetadata): void {
  const keys = keyHistory.get(metadata.did) ?? [];
  keys.push(metadata);
  keyHistory.set(metadata.did, keys);
  saveKeyHistory();
}

/**
 * 计算密钥年龄（天）
 */
function getKeyAgeDays(metadata: KeyMetadata): number {
  const now = Date.now();
  const created = metadata.createdAt.getTime();
  return Math.floor((now - created) / (1000 * 60 * 60 * 24));
}

/**
 * 检查密钥是否已过期
 */
function isKeyExpired(metadata: KeyMetadata): boolean {
  return Date.now() >= metadata.expiresAt.getTime();
}

/**
 * 检查是否应该轮换密钥
 */
export function shouldRotateKey(
  did: string,
  config: KeyRotationConfig = DEFAULT_KEY_ROTATION_CONFIG
): boolean {
  const metadata = getKeyMetadata(did);
  if (!metadata) {
    return false;
  }

  const age = getKeyAgeDays(metadata);
  return age >= config.rotationIntervalDays;
}

/**
 * 轮换密钥
 */
export function rotateKey(
  did: string,
  options: DidDocumentOptions,
  config: KeyRotationConfig = DEFAULT_KEY_ROTATION_CONFIG
): {
  didDocument: DidDocument;
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
  metadata: KeyMetadata;
} {
  // 获取当前密钥元数据
  const currentMetadata = getKeyMetadata(did);

  // 生成新密钥对
  const keyPair = generateKeyPair();
  const newPrivateKey = importPrivateKey(keyPair.privateKey);
  const newPublicKey = crypto.createPublicKey(newPrivateKey);

  // 计算新密钥 ID（递增版本号）
  let version = 1;
  if (currentMetadata) {
    const match = currentMetadata.keyId.match(/key-(\d+)$/);
    if (match) {
      version = parseInt(match[1], 10) + 1;
    }
  }

  const newKeyId = `${did}#key-${version}`;

  // 更新 DID 文档选项中的密钥 ID
  options.did = did;
  const newDidDocument = generateDidDocument(newPublicKey, options);

  // 保存新私钥
  const newPrivateKeyPath = getPrivateKeyPath(`${did}_key_${version}`);
  const privateKeyPem = newPrivateKey.export({
    type: "sec1",
    format: "pem",
  }) as string;
  fs.writeFileSync(newPrivateKeyPath, privateKeyPem, { mode: 0o600 });

  // 创建新密钥元数据
  const now = new Date();
  const newMetadata: KeyMetadata = {
    keyId: newKeyId,
    did: did,
    createdAt: now,
    expiresAt: new Date(
      now.getTime() + config.keyLifetimeDays * 24 * 60 * 60 * 1000
    ),
    isCurrent: true,
    privateKeyPath: newPrivateKeyPath,
  };

  // 标记旧密钥为非当前
  if (currentMetadata) {
    currentMetadata.isCurrent = false;
  }

  // 添加新密钥元数据
  addKeyMetadata(newMetadata);

  // 清理过期的历史密钥
  cleanupOldKeys(did, config);

  // 更新缓存中的 DID 文档
  registerDidDocument(newDidDocument);

  return {
    didDocument: newDidDocument,
    privateKey: newPrivateKey,
    publicKey: newPublicKey,
    metadata: newMetadata,
  };
}

/**
 * 清理旧密钥
 */
function cleanupOldKeys(did: string, config: KeyRotationConfig): void {
  const keys = keyHistory.get(did);
  if (!keys) {
    return;
  }

  const now = Date.now();
  const keysToKeep: KeyMetadata[] = [];

  for (const key of keys) {
    // 保留当前密钥
    if (key.isCurrent) {
      keysToKeep.push(key);
      continue;
    }

    // 保留在宽限期内的密钥
    const graceEnd =
      key.createdAt.getTime() +
      (config.rotationIntervalDays + config.gracePeriodDays) *
        24 *
        60 *
        60 *
        1000;

    if (now < graceEnd) {
      keysToKeep.push(key);
      continue;
    }

    // 删除过期的私钥文件
    try {
      if (fs.existsSync(key.privateKeyPath)) {
        fs.unlinkSync(key.privateKeyPath);
      }
    } catch (error) {
      // 忽略删除错误
    }
  }

  // 按创建时间排序，保留最新的 N 个密钥
  keysToKeep.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  keyHistory.set(did, keysToKeep.slice(0, config.maxHistoryKeys));

  saveKeyHistory();
}

/**
 * 获取 DID 的所有密钥
 */
export function getAllKeysForDid(did: string): KeyMetadata[] {
  return (keyHistory.get(did) ?? []).slice();
}

/**
 * 检查密钥是否可用于签名
 */
export function isKeyValidForSignature(
  did: string,
  keyId: string,
  config: KeyRotationConfig = DEFAULT_KEY_ROTATION_CONFIG
): boolean {
  const metadata = getKeyMetadata(did, keyId);
  if (!metadata) {
    return false;
  }

  // 当前密钥始终有效
  if (metadata.isCurrent) {
    return true;
  }

  // 非当前密钥需要在宽限期内
  const now = Date.now();
  const graceEnd =
    metadata.createdAt.getTime() +
    (config.rotationIntervalDays + config.gracePeriodDays) *
      24 *
      60 *
      60 *
      1000;

  return now < graceEnd;
}

/**
 * 初始化密钥轮换
 */
export function initializeKeyRotation(
  options: DidDocumentOptions,
  config: KeyRotationConfig = DEFAULT_KEY_ROTATION_CONFIG
): {
  didDocument: DidDocument;
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
} {
  // 加载密钥历史
  loadKeyHistory();

  // 检查是否需要轮换
  if (shouldRotateKey(options.did, config)) {
    const result = rotateKey(options.did, options, config);
    return {
      didDocument: result.didDocument,
      privateKey: result.privateKey,
      publicKey: result.publicKey,
    };
  }

  // 使用现有初始化逻辑
  return initializeAgentIdentity(options);
}

// 初始化时加载密钥历史
loadKeyHistory();
