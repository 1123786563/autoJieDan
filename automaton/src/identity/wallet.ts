/**
 * Automaton Wallet Management
 *
 * Creates and manages an EVM wallet for the automaton's identity and payments.
 * The private key is the automaton's sovereign identity.
 * Private keys are encrypted at rest using AES-256-GCM.
 * Adapted from conway-mcp/src/wallet.ts
 */

import type { PrivateKeyAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import fs from "fs";
import path from "path";
import type { WalletData, LegacyWalletData, EncryptedWalletData } from "../types.js";

const AUTOMATON_DIR = path.join(
  process.env.HOME || "/root",
  ".automaton",
);
const WALLET_FILE = path.join(AUTOMATON_DIR, "wallet.json");

// Encryption constants
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;
const MIN_PASSPHRASE_LENGTH = 12;

export function getAutomatonDir(): string {
  return AUTOMATON_DIR;
}

export function getWalletPath(): string {
  return WALLET_FILE;
}

/**
 * Derive a 256-bit key from passphrase using scrypt.
 */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32);
}

/**
 * Encrypt a private key using AES-256-GCM.
 */
function encryptPrivateKey(
  privateKey: string,
  passphrase: string,
): EncryptedWalletData {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(passphrase, salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(privateKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    createdAt: new Date().toISOString(),
    version: 1,
  };
}

/**
 * Decrypt a private key using AES-256-GCM.
 * @throws Error if decryption fails (wrong passphrase or tampered data)
 */
function decryptPrivateKey(
  data: EncryptedWalletData,
  passphrase: string,
): string {
  const salt = Buffer.from(data.salt, "hex");
  const key = deriveKey(passphrase, salt);
  const iv = Buffer.from(data.iv, "hex");
  const authTag = Buffer.from(data.authTag, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(data.encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Get the passphrase from environment variable.
 * @throws Error if passphrase is not set or too short
 */
function getPassphrase(): string {
  const passphrase = process.env.AUTOMATON_WALLET_PASSPHRASE;
  if (!passphrase) {
    throw new Error(
      "Wallet passphrase required. Set AUTOMATON_WALLET_PASSPHRASE environment variable.",
    );
  }
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(
      `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters for security`,
    );
  }
  return passphrase;
}

/**
 * Type guard to check if wallet data is encrypted.
 */
function isEncryptedWallet(data: unknown): data is EncryptedWalletData {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as EncryptedWalletData).version === 1 &&
    typeof (data as EncryptedWalletData).encrypted === "string" &&
    typeof (data as EncryptedWalletData).salt === "string" &&
    typeof (data as EncryptedWalletData).iv === "string" &&
    typeof (data as EncryptedWalletData).authTag === "string"
  );
}

/**
 * Type guard to check if wallet data is legacy (unencrypted).
 */
function isLegacyWallet(data: unknown): data is LegacyWalletData {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as Record<string, unknown>).privateKey === "string" &&
    typeof (data as Record<string, unknown>).createdAt === "string" &&
    !("version" in data)
  );
}

/**
 * Decrypt wallet data, handling both encrypted and legacy formats.
 * Legacy wallets are automatically migrated to encrypted format.
 */
function decryptWalletData(
  walletData: WalletData,
  passphrase: string,
): { privateKey: `0x${string}`; migrated: boolean } {
  if (isEncryptedWallet(walletData)) {
    const privateKey = decryptPrivateKey(walletData, passphrase);
    return { privateKey: privateKey as `0x${string}`, migrated: false };
  }

  if (isLegacyWallet(walletData)) {
    // Migrate legacy wallet to encrypted format
    const encryptedData = encryptPrivateKey(walletData.privateKey, passphrase);
    fs.writeFileSync(WALLET_FILE, JSON.stringify(encryptedData, null, 2), {
      mode: 0o600,
    });
    return { privateKey: walletData.privateKey, migrated: true };
  }

  throw new Error("Invalid wallet data format");
}

/**
 * Get or create the automaton's wallet.
 * The private key IS the automaton's identity -- protect it.
 * Private keys are encrypted at rest using AES-256-GCM.
 */
export async function getWallet(): Promise<{
  account: PrivateKeyAccount;
  isNew: boolean;
}> {
  if (!fs.existsSync(AUTOMATON_DIR)) {
    fs.mkdirSync(AUTOMATON_DIR, { recursive: true, mode: 0o700 });
  }

  const passphrase = getPassphrase();

  if (fs.existsSync(WALLET_FILE)) {
    const rawData = fs.readFileSync(WALLET_FILE, "utf-8");
    const walletData: WalletData = JSON.parse(rawData);
    const { privateKey } = decryptWalletData(walletData, passphrase);
    const account = privateKeyToAccount(privateKey);
    return { account, isNew: false };
  } else {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const encryptedData = encryptPrivateKey(privateKey, passphrase);

    fs.writeFileSync(WALLET_FILE, JSON.stringify(encryptedData, null, 2), {
      mode: 0o600,
    });

    return { account, isNew: true };
  }
}

/**
 * Get the wallet address without loading the full account.
 */
export function getWalletAddress(): string | null {
  if (!fs.existsSync(WALLET_FILE)) {
    return null;
  }

  const passphrase = getPassphrase();
  const rawData = fs.readFileSync(WALLET_FILE, "utf-8");
  const walletData: WalletData = JSON.parse(rawData);
  const { privateKey } = decryptWalletData(walletData, passphrase);
  const account = privateKeyToAccount(privateKey);
  return account.address;
}

/**
 * Load the full wallet account (needed for signing).
 */
export function loadWalletAccount(): PrivateKeyAccount | null {
  if (!fs.existsSync(WALLET_FILE)) {
    return null;
  }

  const passphrase = getPassphrase();
  const rawData = fs.readFileSync(WALLET_FILE, "utf-8");
  const walletData: WalletData = JSON.parse(rawData);
  const { privateKey } = decryptWalletData(walletData, passphrase);
  return privateKeyToAccount(privateKey);
}

export function walletExists(): boolean {
  return fs.existsSync(WALLET_FILE);
}
