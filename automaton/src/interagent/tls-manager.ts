/**
 * TLS 安全配置管理
 * 提供证书管理、TLS 配置和安全连接验证
 *
 * @module interagent/tls-manager
 * @version 1.0.0
 */

import { EventEmitter } from "events";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import tls from "tls";

// ============================================================================
// 类型定义
// ============================================================================

/** 证书类型 */
export type CertificateType = "root" | "intermediate" | "server" | "client";

/** 证书状态 */
export type CertificateStatus = "valid" | "expired" | "revoked" | "pending";

/** 密钥类型 */
export type KeyType = "rsa" | "ecdsa" | "ed25519";

/** 证书信息 */
export interface CertificateInfo {
  /** 证书 ID */
  id: string;
  /** 证书类型 */
  type: CertificateType;
  /** 主题名称 */
  subject: string;
  /** 颁发者 */
  issuer: string;
  /** 序列号 */
  serialNumber: string;
  /** 指纹 */
  fingerprint: string;
  /** 生效时间 */
  notBefore: Date;
  /** 过期时间 */
  notAfter: Date;
  /** 状态 */
  status: CertificateStatus;
  /** SAN (Subject Alternative Names) */
  san: string[];
  /** 密钥类型 */
  keyType: KeyType;
  /** 密钥大小 */
  keySize: number;
  /** 是否自签名 */
  selfSigned: boolean;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/** TLS 配置 */
export interface TLSConfig {
  /** CA 证书路径 */
  caCertPath?: string;
  /** 服务器证书路径 */
  certPath?: string;
  /** 服务器私钥路径 */
  keyPath?: string;
  /** 是否验证客户端证书 */
  requestCert: boolean;
  /** 是否拒绝无效客户端证书 */
  rejectUnauthorized: boolean;
  /** 最小 TLS 版本 */
  minVersion?: tls.SecureVersion;
  /** 最大 TLS 版本 */
  maxVersion?: tls.SecureVersion;
  /** 密码套件 */
  ciphers?: string;
  /** 是否启用 OCSP */
  enableOCSP?: boolean;
  /** 证书撤销列表路径 */
  crlPath?: string;
}

/** 证书生成选项 */
export interface CertificateOptions {
  /** 证书类型 */
  type: CertificateType;
  /** 主题 */
  subject: CertificateSubject;
  /** 颁发者 (用于签名) */
  issuer?: CertificateSubject;
  /** 颁发者私钥 */
  issuerKey?: string;
  /** 有效期 (天) */
  days: number;
  /** 密钥类型 */
  keyType: KeyType;
  /** 密钥大小 */
  keySize?: number;
  /** SAN */
  san?: string[];
  /** 是否自签名 */
  selfSigned?: boolean;
  /** 扩展 */
  extensions?: CertificateExtension[];
}

/** 证书主题 */
export interface CertificateSubject {
  /** 通用名称 */
  commonName: string;
  /** 国家 */
  country?: string;
  /** 州/省 */
  state?: string;
  /** 城市 */
  locality?: string;
  /** 组织 */
  organization?: string;
  /** 组织单位 */
  organizationalUnit?: string;
  /** 邮箱 */
  emailAddress?: string;
}

/** 证书扩展 */
export interface CertificateExtension {
  /** 扩展名称 */
  name: string;
  /** 是否关键 */
  critical: boolean;
  /** 扩展值 */
  value: string;
}

/** TLS 连接信息 */
export interface TLSConnectionInfo {
  /** 是否已授权 */
  authorized: boolean;
  /** 授权错误 */
  authorizationError?: string;
  /** 对端证书 */
  peerCertificate?: CertificateInfo;
  /** 使用的密码套件 */
  cipher: string;
  /** TLS 版本 */
  version: string;
  /** 本地地址 */
  localAddress?: string;
  /** 远程地址 */
  remoteAddress?: string;
}

/** TLS 管理器配置 */
export interface TLSManagerConfig {
  /** 默认 TLS 配置 */
  defaultConfig: TLSConfig;
  /** 证书存储目录 */
  certStorePath: string;
  /** 是否自动续期 */
  autoRenew: boolean;
  /** 续期提前天数 */
  renewBeforeDays: number;
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_TLS_CONFIG: TLSConfig = {
  requestCert: true,
  rejectUnauthorized: true,
  minVersion: "TLSv1.2",
  ciphers: "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384",
};

const DEFAULT_TLS_MANAGER_CONFIG: TLSManagerConfig = {
  defaultConfig: DEFAULT_TLS_CONFIG,
  certStorePath: "./certs",
  autoRenew: true,
  renewBeforeDays: 30,
};

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 生成证书主题字符串
 */
function formatSubject(subject: CertificateSubject): string {
  const parts: string[] = [];

  if (subject.country) parts.push(`C=${subject.country}`);
  if (subject.state) parts.push(`ST=${subject.state}`);
  if (subject.locality) parts.push(`L=${subject.locality}`);
  if (subject.organization) parts.push(`O=${subject.organization}`);
  if (subject.organizationalUnit) parts.push(`OU=${subject.organizationalUnit}`);
  parts.push(`CN=${subject.commonName}`);
  if (subject.emailAddress) parts.push(`emailAddress=${subject.emailAddress}`);

  return parts.join(", ");
}

/**
 * 生成密钥对
 */
function generateKeyPair(
  keyType: KeyType,
  keySize: number
): { publicKey: string; privateKey: string } {
  switch (keyType) {
    case "rsa":
      const rsaKeyPair = crypto.generateKeyPairSync("rsa", {
        modulusLength: keySize,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });
      return rsaKeyPair;

    case "ecdsa":
      const ecdsaCurve = keySize <= 256 ? "prime256v1" : "secp384r1";
      const ecdsaKeyPair = crypto.generateKeyPairSync("ec", {
        namedCurve: ecdsaCurve,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });
      return ecdsaKeyPair;

    case "ed25519":
      const edKeyPair = crypto.generateKeyPairSync("ed25519", {
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });
      return edKeyPair;

    default:
      throw new Error(`Unsupported key type: ${keyType}`);
  }
}

/**
 * 生成证书序列号
 */
function generateSerialNumber(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * 生成证书 ID
 */
function generateCertificateId(): string {
  return `cert-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
}

// ============================================================================
// TLSManager 类
// ============================================================================

/**
 * TLS 管理器
 */
export class TLSManager extends EventEmitter {
  private config: TLSManagerConfig;
  private certificates: Map<string, CertificateInfo> = new Map();
  private renewalTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(config: Partial<TLSManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_TLS_MANAGER_CONFIG, ...config };
    this.ensureCertStore();
  }

  // ============================================================================
  // 证书管理
  // ============================================================================

  /**
   * 确保证书存储目录存在
   */
  private ensureCertStore(): void {
    if (!fs.existsSync(this.config.certStorePath)) {
      fs.mkdirSync(this.config.certStorePath, { recursive: true });
    }
  }

  /**
   * 生成自签名证书
   */
  generateSelfSignedCertificate(options: CertificateOptions): {
    cert: string;
    key: string;
    info: CertificateInfo;
  } {
    const keyType = options.keyType;
    const keySize = options.keySize || (keyType === "rsa" ? 2048 : 256);

    // 生成密钥对
    const { publicKey, privateKey } = generateKeyPair(keyType, keySize);

    // 生成证书信息
    const id = generateCertificateId();
    const serialNumber = generateSerialNumber();
    const now = new Date();
    const notBefore = now;
    const notAfter = new Date(now.getTime() + options.days * 24 * 60 * 60 * 1000);

    // 创建证书内容 (简化的 PEM 格式)
    const certContent = this.createCertificatePEM({
      id,
      serialNumber,
      subject: options.subject,
      issuer: options.subject, // 自签名
      notBefore,
      notAfter,
      publicKey,
      san: options.san || [],
      extensions: options.extensions || [],
      selfSigned: true,
    });

    const info: CertificateInfo = {
      id,
      type: options.type,
      subject: formatSubject(options.subject),
      issuer: formatSubject(options.subject),
      serialNumber,
      fingerprint: this.calculateFingerprint(certContent),
      notBefore,
      notAfter,
      status: "valid",
      san: options.san || [],
      keyType,
      keySize,
      selfSigned: true,
      metadata: {},
    };

    // 存储证书信息
    this.certificates.set(id, info);

    // 保存到文件
    this.saveCertificate(id, certContent, privateKey);

    // 设置自动续期
    if (this.config.autoRenew) {
      this.scheduleRenewal(id, info);
    }

    this.emit("certificate:generated", info);

    return { cert: certContent, key: privateKey, info };
  }

  /**
   * 创建证书 PEM 内容
   */
  private createCertificatePEM(params: {
    id: string;
    serialNumber: string;
    subject: CertificateSubject;
    issuer: CertificateSubject;
    notBefore: Date;
    notAfter: Date;
    publicKey: string;
    san: string[];
    extensions: CertificateExtension[];
    selfSigned: boolean;
  }): string {
    const lines: string[] = [];

    // 证书头部
    lines.push("-----BEGIN CERTIFICATE-----");

    // 简化的证书内容 (实际应用中应使用正规 ASN.1 编码)
    const certData = [
      `Version: 3`,
      `Serial Number: ${params.serialNumber}`,
      `Subject: ${formatSubject(params.subject)}`,
      `Issuer: ${formatSubject(params.issuer)}`,
      `Not Before: ${params.notBefore.toISOString()}`,
      `Not After: ${params.notAfter.toISOString()}`,
      `Public Key: ${params.publicKey.split("\n")[0].substring(0, 50)}...`,
      `SAN: ${params.san.join(", ")}`,
      `Self-Signed: ${params.selfSigned}`,
      `ID: ${params.id}`,
    ];

    // Base64 编码
    const base64Content = Buffer.from(certData.join("\n")).toString("base64");
    lines.push(base64Content);

    lines.push("-----END CERTIFICATE-----");

    return lines.join("\n");
  }

  /**
   * 计算证书指纹
   */
  private calculateFingerprint(cert: string): string {
    const cleanCert = cert
      .replace(/-----BEGIN CERTIFICATE-----/g, "")
      .replace(/-----END CERTIFICATE-----/g, "")
      .replace(/\s/g, "");

    return crypto
      .createHash("sha256")
      .update(Buffer.from(cleanCert, "base64"))
      .digest("hex")
      .toUpperCase();
  }

  /**
   * 保存证书到文件
   */
  private saveCertificate(id: string, cert: string, key: string): void {
    const certPath = path.join(this.config.certStorePath, `${id}.crt`);
    const keyPath = path.join(this.config.certStorePath, `${id}.key`);

    fs.writeFileSync(certPath, cert, { mode: 0o644 });
    fs.writeFileSync(keyPath, key, { mode: 0o600 }); // 私钥权限更严格
  }

  /**
   * 加载证书
   */
  loadCertificate(certId: string): { cert: string; key: string } | null {
    const certPath = path.join(this.config.certStorePath, `${certId}.crt`);
    const keyPath = path.join(this.config.certStorePath, `${certId}.key`);

    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      return null;
    }

    return {
      cert: fs.readFileSync(certPath, "utf-8"),
      key: fs.readFileSync(keyPath, "utf-8"),
    };
  }

  /**
   * 获取证书信息
   */
  getCertificateInfo(certId: string): CertificateInfo | undefined {
    return this.certificates.get(certId);
  }

  /**
   * 列出所有证书
   */
  listCertificates(filter?: {
    type?: CertificateType;
    status?: CertificateStatus;
  }): CertificateInfo[] {
    let result = Array.from(this.certificates.values());

    if (filter) {
      if (filter.type) {
        result = result.filter((c) => c.type === filter.type);
      }
      if (filter.status) {
        result = result.filter((c) => c.status === filter.status);
      }
    }

    return result;
  }

  /**
   * 撤销证书
   */
  revokeCertificate(certId: string): boolean {
    const info = this.certificates.get(certId);
    if (!info) return false;

    info.status = "revoked";
    this.certificates.set(certId, info);
    this.clearRenewalTimer(certId);

    this.emit("certificate:revoked", info);

    return true;
  }

  /**
   * 删除证书
   */
  deleteCertificate(certId: string): boolean {
    const certPath = path.join(this.config.certStorePath, `${certId}.crt`);
    const keyPath = path.join(this.config.certStorePath, `${certId}.key`);

    if (fs.existsSync(certPath)) fs.unlinkSync(certPath);
    if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);

    this.certificates.delete(certId);
    this.clearRenewalTimer(certId);

    this.emit("certificate:deleted", certId);

    return true;
  }

  // ============================================================================
  // 自动续期
  // ============================================================================

  /**
   * 安排证书续期
   */
  private scheduleRenewal(certId: string, info: CertificateInfo): void {
    const now = new Date();
    const renewTime = new Date(
      info.notAfter.getTime() - this.config.renewBeforeDays * 24 * 60 * 60 * 1000
    );

    const delay = Math.max(0, renewTime.getTime() - now.getTime());

    const timer = setTimeout(() => {
      this.emit("certificate:renewal:due", info);
    }, delay);

    this.renewalTimers.set(certId, timer);
  }

  /**
   * 清理续期计时器
   */
  private clearRenewalTimer(certId: string): void {
    const timer = this.renewalTimers.get(certId);
    if (timer) {
      clearTimeout(timer);
      this.renewalTimers.delete(certId);
    }
  }

  // ============================================================================
  // TLS 配置
  // ============================================================================

  /**
   * 获取服务器 TLS 配置
   */
  getServerTLSOptions(certId: string, customConfig?: Partial<TLSConfig>): tls.TlsOptions {
    const certData = this.loadCertificate(certId);
    if (!certData) {
      throw new Error(`Certificate not found: ${certId}`);
    }

    const config = { ...this.config.defaultConfig, ...customConfig };

    const options: tls.TlsOptions = {
      cert: certData.cert,
      key: certData.key,
      requestCert: config.requestCert,
      rejectUnauthorized: config.rejectUnauthorized,
      minVersion: config.minVersion,
      maxVersion: config.maxVersion,
      ciphers: config.ciphers,
    };

    // 加载 CA 证书
    if (config.caCertPath && fs.existsSync(config.caCertPath)) {
      options.ca = [fs.readFileSync(config.caCertPath)];
    }

    // 加载 CRL
    if (config.crlPath && fs.existsSync(config.crlPath)) {
      options.crl = [fs.readFileSync(config.crlPath)];
    }

    return options;
  }

  /**
   * 获取客户端 TLS 配置
   */
  getClientTLSOptions(
    certId?: string,
    customConfig?: Partial<TLSConfig>
  ): tls.ConnectionOptions {
    const config = { ...this.config.defaultConfig, ...customConfig };

    const options: tls.ConnectionOptions = {
      rejectUnauthorized: config.rejectUnauthorized,
      minVersion: config.minVersion,
      maxVersion: config.maxVersion,
      ciphers: config.ciphers,
    };

    // 加载客户端证书
    if (certId) {
      const certData = this.loadCertificate(certId);
      if (certData) {
        options.cert = certData.cert;
        options.key = certData.key;
      }
    }

    // 加载 CA 证书
    if (config.caCertPath && fs.existsSync(config.caCertPath)) {
      options.ca = [fs.readFileSync(config.caCertPath)];
    }

    return options;
  }

  // ============================================================================
  // 验证
  // ============================================================================

  /**
   * 验证证书
   */
  validateCertificate(certId: string): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const result = { valid: true, errors: [] as string[], warnings: [] as string[] };

    const info = this.certificates.get(certId);
    if (!info) {
      result.valid = false;
      result.errors.push("Certificate not found");
      return result;
    }

    // 检查状态
    if (info.status === "revoked") {
      result.valid = false;
      result.errors.push("Certificate has been revoked");
    }

    if (info.status === "expired") {
      result.valid = false;
      result.errors.push("Certificate has expired");
    }

    // 检查有效期
    const now = new Date();
    if (info.notAfter < now) {
      result.valid = false;
      result.errors.push("Certificate has expired");
    } else if (info.notAfter < new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)) {
      result.warnings.push("Certificate will expire within 30 days");
    }

    if (info.notBefore > now) {
      result.valid = false;
      result.errors.push("Certificate is not yet valid");
    }

    // 检查密钥强度
    if (info.keyType === "rsa" && info.keySize < 2048) {
      result.warnings.push("RSA key size is less than 2048 bits");
    }

    return result;
  }

  /**
   * 获取 TLS 连接信息
   */
  getTLSConnectionInfo(socket: tls.TLSSocket): TLSConnectionInfo {
    const peerCert = socket.getPeerCertificate();

    return {
      authorized: socket.authorized,
      authorizationError: socket.authorizationError,
      peerCertificate: peerCert
        ? {
            id: peerCert.fingerprint,
            type: "server",
            subject: peerCert.subject?.CN || "",
            issuer: peerCert.issuer?.CN || "",
            serialNumber: peerCert.serialNumber,
            fingerprint: peerCert.fingerprint,
            notBefore: new Date(peerCert.valid_from),
            notAfter: new Date(peerCert.valid_to),
            status: "valid",
            san: peerCert.subjectaltname?.split(", ") || [],
            keyType: "rsa",
            keySize: 2048,
            selfSigned: peerCert.issuer?.CN === peerCert.subject?.CN,
            metadata: {},
          }
        : undefined,
      cipher: socket.getCipher()?.name || "",
      version: socket.getProtocol() || "",
      localAddress: socket.localAddress,
      remoteAddress: socket.remoteAddress,
    };
  }

  // ============================================================================
  // 统计
  // ============================================================================

  /**
   * 获取统计信息
   */
  getStats(): {
    totalCertificates: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    expiringWithin30Days: number;
  } {
    const certs = Array.from(this.certificates.values());
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const stats = {
      totalCertificates: certs.length,
      byType: {} as Record<string, number>,
      byStatus: {} as Record<string, number>,
      expiringWithin30Days: 0,
    };

    for (const cert of certs) {
      stats.byType[cert.type] = (stats.byType[cert.type] || 0) + 1;
      stats.byStatus[cert.status] = (stats.byStatus[cert.status] || 0) + 1;

      if (cert.notAfter < thirtyDaysFromNow && cert.notAfter > now) {
        stats.expiringWithin30Days++;
      }
    }

    return stats;
  }

  // ============================================================================
  // 清理
  // ============================================================================

  /**
   * 关闭管理器
   */
  close(): void {
    // 清理所有续期计时器
    for (const timer of this.renewalTimers.values()) {
      clearTimeout(timer);
    }
    this.renewalTimers.clear();

    this.removeAllListeners();
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 TLS 管理器
 */
export function createTLSManager(config?: Partial<TLSManagerConfig>): TLSManager {
  return new TLSManager(config);
}

// ============================================================================
// 格式化函数
// ============================================================================

/**
 * 格式化证书信息
 */
export function formatCertificateInfo(info: CertificateInfo): string {
  const lines = [
    "=== 证书信息 ===",
    `ID: ${info.id}`,
    `类型: ${info.type}`,
    `主题: ${info.subject}`,
    `颁发者: ${info.issuer}`,
    `序列号: ${info.serialNumber}`,
    `指纹: ${info.fingerprint}`,
    `生效时间: ${info.notBefore.toISOString()}`,
    `过期时间: ${info.notAfter.toISOString()}`,
    `状态: ${info.status}`,
    `密钥类型: ${info.keyType}`,
    `密钥大小: ${info.keySize}`,
    `自签名: ${info.selfSigned ? "是" : "否"}`,
  ];

  if (info.san.length > 0) {
    lines.push(`SAN: ${info.san.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * 格式化 TLS 配置
 */
export function formatTLSConfig(config: TLSConfig): string {
  const lines = [
    "=== TLS 配置 ===",
    `请求客户端证书: ${config.requestCert ? "是" : "否"}`,
    `拒绝未授权: ${config.rejectUnauthorized ? "是" : "否"}`,
    `最小版本: ${config.minVersion || "默认"}`,
    `密码套件: ${config.ciphers?.substring(0, 50) || "默认"}...`,
  ];

  if (config.caCertPath) {
    lines.push(`CA 证书: ${config.caCertPath}`);
  }

  if (config.certPath) {
    lines.push(`服务器证书: ${config.certPath}`);
  }

  return lines.join("\n");
}

/**
 * 格式化连接信息
 */
export function formatConnectionInfo(info: TLSConnectionInfo): string {
  const lines = [
    "=== TLS 连接 ===",
    `已授权: ${info.authorized ? "是" : "否"}`,
    `TLS 版本: ${info.version}`,
    `密码套件: ${info.cipher}`,
  ];

  if (info.authorizationError) {
    lines.push(`授权错误: ${info.authorizationError}`);
  }

  if (info.peerCertificate) {
    lines.push(`对端主题: ${info.peerCertificate.subject}`);
  }

  if (info.remoteAddress) {
    lines.push(`远程地址: ${info.remoteAddress}`);
  }

  return lines.join("\n");
}
