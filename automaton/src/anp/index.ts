/**
 * ANP (Agent Network Protocol) 模块
 * 用于 Automaton + Nanobot 双系统通信
 *
 * @module anp
 * @version 1.0.0
 */

// 类型导出
export * from "./types.js";

// 常量导出
export {
  ANP_CONTEXT,
  DEFAULT_CONTEXT,
  AUTOMATON_DID,
  NANOBOT_DID,
  GENESIS_PROMPT_PROTOCOL,
  ANP_ERROR_CODES,
  ANPError,
} from "./types.js";
