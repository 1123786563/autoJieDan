/**
 * Structured Logger
 *
 * JSON-formatted structured logging with levels, context, and child loggers.
 * Uses process.stdout.write to avoid console.log recursion.
 * Never throws — all errors are handled gracefully.
 *
 * SECURITY: Redacts sensitive information from logs:
 * - File paths containing wallet, .env, keys, secrets
 * - API keys and tokens in common formats
 * - Private keys and cryptographic secrets
 */

import type { LogLevel, LogEntry } from "../types.js";
import { LOG_LEVEL_PRIORITY } from "../types.js";

let globalLogLevel: LogLevel = "info";
let customSink: ((entry: LogEntry) => void) | null = null;

// ============================================================================
// Sensitive Data Redaction
// ============================================================================

// Patterns that indicate sensitive information
const SENSITIVE_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // API keys and tokens (various formats)
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: "sk-***REDACTED***" },
  { pattern: /sk-ant-[a-zA-Z0-9-]{20,}/g, replacement: "sk-ant-***REDACTED***" },
  { pattern: /Bearer\s+[a-zA-Z0-9_-]{20,}/gi, replacement: "Bearer ***REDACTED***" },
  { pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/g, replacement: "xox-***REDACTED***" },
  { pattern: /[0-9]{10,}:[a-zA-Z0-9_-]{30,}/g, replacement: "***REDACTED_TOKEN***" }, // Telegram
  // Private keys
  { pattern: /0x[a-fA-F0-9]{64}/g, replacement: "0x***REDACTED***" },
  { pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END/g, replacement: "***PRIVATE_KEY_REDACTED***" },
  // Sensitive file paths
  { pattern: /\/[^"\s]*wallet\.json/gi, replacement: "/***REDACTED***/wallet.json" },
  { pattern: /\/[^"\s]*\.env[_\w]*/gi, replacement: "/***REDACTED***/.env" },
  { pattern: /\/[^"\s]*\.ssh\/[^"\s]+/gi, replacement: "/***REDACTED***/.ssh/***" },
  { pattern: /\/[^"\s]*\.gnupg\/[^"\s]+/gi, replacement: "/***REDACTED***/.gnupg/***" },
  { pattern: /\/[^"\s]*secrets?\/[^"\s]+/gi, replacement: "/***REDACTED***/secrets/***" },
  { pattern: /\/[^"\s]*\.automaton\/[^"\s]*(?:wallet|key|secret)/gi, replacement: "/***REDACTED***/.automaton/***" },
  // Connection strings with passwords
  { pattern: /(?:mysql|postgres|mongodb|redis):\/\/[^:]+:[^@]+@/g, replacement: "***CONNECTION_STRING_REDACTED***" },
  // Environment variable assignments with secrets
  { pattern: /(?:API_KEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY|CREDENTIAL)\s*=\s*[^\s]+/gi, replacement: "***=***REDACTED***" },
  // Additional API key formats
  { pattern: /AIza[a-zA-Z0-9_-]{35}/g, replacement: "***REDACTED_GOOGLE_KEY***" }, // Google API
  { pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/g, replacement: "***REDACTED_GITHUB_TOKEN***" }, // GitHub
  { pattern: /glpat-[a-zA-Z0-9-]{20,}/g, replacement: "***REDACTED_GITLAB_TOKEN***" }, // GitLab
  { pattern: /dckr_pat_[a-zA-Z0-9_-]{20,}/g, replacement: "***REDACTED_DOCKER_TOKEN***" }, // Docker
  // Long tokens (catch-all for unknown formats)
  { pattern: /(?<![a-zA-Z0-9])[a-zA-Z0-9]{40,}(?![a-zA-Z0-9])/g, replacement: "***REDACTED_LONG_TOKEN***" },
  // Basic auth headers
  { pattern: /Basic\s+[A-Za-z0-9+/=]{20,}/g, replacement: "Basic ***REDACTED***" },
  // Base64 encoded data (potential secrets)
  { pattern: /\b[A-Za-z0-9+/]{50,}={0,2}\b/g, replacement: "***REDACTED_BASE64***" },
];

/**
 * Redact sensitive information from a string.
 * Used to sanitize log messages, error messages, and stack traces.
 */
function redactSensitive(text: string): string {
  if (!text) return text;
  let result = text;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function setGlobalLogLevel(level: LogLevel): void {
  globalLogLevel = level;
}

export function getGlobalLogLevel(): LogLevel {
  return globalLogLevel;
}

export class StructuredLogger {
  private module: string;
  private minLevel: LogLevel;

  constructor(module: string, minLevel?: LogLevel) {
    this.module = module;
    this.minLevel = minLevel ?? globalLogLevel;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.write("debug", message, undefined, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.write("info", message, undefined, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.write("warn", message, undefined, context);
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.write("error", message, error, context);
  }

  fatal(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.write("fatal", message, error, context);
  }

  child(subModule: string): StructuredLogger {
    return new StructuredLogger(`${this.module}.${subModule}`, this.minLevel);
  }

  static setSink(sink: (entry: LogEntry) => void): void {
    customSink = sink;
  }

  static resetSink(): void {
    customSink = null;
  }

  private write(
    level: LogLevel,
    message: string,
    error?: Error,
    context?: Record<string, unknown>,
  ): void {
    try {
      const effectiveLevel = this.minLevel ?? globalLogLevel;
      if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[effectiveLevel]) {
        return;
      }

      // SECURITY: Redact sensitive information from all log output
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        module: this.module,
        message: redactSensitive(message),
      };

      if (context && Object.keys(context).length > 0) {
        // Redact sensitive data in context object
        entry.context = this.redactContext(context);
      }

      if (error) {
        entry.error = {
          message: redactSensitive(error.message),
          // SECURITY: Redact sensitive paths from stack traces
          stack: error.stack ? redactSensitive(error.stack) : undefined,
        };
        if ((error as any).code) {
          entry.error.code = (error as any).code;
        }
      }

      if (customSink) {
        customSink(entry);
        return;
      }

      const json = JSON.stringify(entry);
      process.stdout.write(json + "\n");
    } catch {
      // Fallback if JSON serialization fails
      try {
        process.stderr.write(`[logger-fallback] ${redactSensitive(message)}\n`);
      } catch {
        // Completely silent — never throw from logger
      }
    }
  }

  /**
   * Recursively redact sensitive values in context objects.
   */
  private redactContext(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      // Check if key name indicates sensitive data
      if (
        lowerKey.includes("secret") ||
        lowerKey.includes("password") ||
        lowerKey.includes("token") ||
        lowerKey.includes("apikey") ||
        lowerKey.includes("api_key") ||
        lowerKey.includes("privatekey") ||
        lowerKey.includes("private_key") ||
        lowerKey.includes("credential")
      ) {
        result[key] = "***REDACTED***";
      } else if (typeof value === "string") {
        result[key] = redactSensitive(value);
      } else if (typeof value === "object" && value !== null) {
        result[key] = this.redactContext(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}

export function createLogger(module: string): StructuredLogger {
  return new StructuredLogger(module);
}
