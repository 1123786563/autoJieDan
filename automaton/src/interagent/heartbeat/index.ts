/**
 * Interagent 心跳机制
 * 用于 Automaton 与 Nanobot 之间的双向心跳检测
 *
 * @module interagent/heartbeat
 * @version 1.0.0
 */

export { HeartbeatManager } from "./heartbeat-manager.js";
export { HeartbeatConfig, HeartbeatStatus, HeartbeatEvent, HeartbeatStats } from "./types.js";
export * from "./heartbeat-manager.js";
