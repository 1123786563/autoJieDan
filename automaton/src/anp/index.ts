/**
 * ANP (Agent Network Protocol) 模块
 * 用于 Automaton + Nanobot 双系统通信
 *
 * @module anp
 * @version 1.0.0
 */

// 类型导出
export * from "./types.js";

// 自由职业消息类型导出
export * from "./freelance-message-types.js";

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

// DID 解析器导出
export {
  HTTPDIDResolver,
  CompositeResolver,
  LocalResolver,
  getGlobalResolver,
  setGlobalResolver,
  resolveDID,
} from "./resolver.js";

export type {
  ResolverConfig,
  ResolutionResult,
  DIDResolver,
} from "./resolver.js";
