#!/usr/bin/env npx tsx
/**
 * Interagent Communication Logger
 * 
 * 记录 Automaton ↔ Nanobot 通信的完整日志
 * 输出到控制台 + 文件
 * 
 * Usage: npx tsx scripts/interagent-logger.ts
 */

import { InteragentWebSocketServer, createProgressEvent, createHeartbeatEvent, createErrorEvent } from "../src/interagent/websocket.js";
import WebSocket from "ws";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import WebSocket from "ws";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// 日志配置
// ============================================================================

const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, `interagent-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 日志缓冲区
const logBuffer: string[] = [];

function log(emoji: string, tag: string, message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  const dataStr = data ? `\n    ${JSON.stringify(data, null, 2).split('\n').join('\n    ')}` : '';
  const logLine = `[${timestamp}] ${emoji} [${tag}] ${message}${dataStr}`;
  
  // 写入缓冲区
  logBuffer.push(logLine);
  
  // 控制台输出 (带颜色)
  const colors: Record<string, string> = {
    'AUTOMATON': '\x1b[36m',   // cyan
    'NANOBOT': '\x1b[35m',     // magenta
    'MESSAGE': '\x1b[33m',     // yellow
    'SYSTEM': '\x1b[32m',      // green
    'ERROR': '\x1b[31m',       // red
  };
  const color = colors[tag] || '\x1b[0m';
  console.log(`${color}${logLine}\x1b[0m`);
}

function saveLog() {
  const header = `
================================================================================
Interagent Communication Log
================================================================================
Generated: ${new Date().toISOString()}
Log File: ${LOG_FILE}

Legend:
  [AUTOMATON] - Server-side events (TypeScript)
  [NANOBOT]   - Client-side events (Python simulation)
  [MESSAGE]   - Message traffic (direction indicated by arrow)
  [SYSTEM]    - System events (start, stop, etc.)
  [ERROR]     - Error events

================================================================================

`;
  fs.writeFileSync(LOG_FILE, header + logBuffer.join('\n') + '\n');
  log('SYSTEM', 'SYSTEM', `Log saved to: ${LOG_FILE}`);
}

// ============================================================================
// 消息统计
// ============================================================================

interface MessageStats {
  total: number;
  byType: Record<string, number>;
  byDirection: { in: number; out: number };
  timeline: Array<{ time: Date; type: string; direction: 'in' | 'out'; size: number }>;
}

const stats: MessageStats = {
  total: 0,
  byType: {},
  byDirection: { in: 0, out: 0 },
  timeline: [],
};

function recordMessage(direction: 'in' | 'out', message: unknown) {
  const msg = message as { type?: string };
  const type = msg.type || 'unknown';
  const size = JSON.stringify(message).length;
  
  stats.total++;
  stats.byDirection[direction]++;
  stats.byType[type] = (stats.byType[type] || 0) + 1;
  stats.timeline.push({ time: new Date(), type, direction, size });
  
  const arrow = direction === 'in' ? '◄───' : '───►';
  log(arrow, 'MESSAGE', `${direction.toUpperCase()}: ${type}`, message);
}

// ============================================================================
// 模拟 Nanobot 客户端 (增强版)
// ============================================================================

class MockNanobotClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly did: string;
  private taskId = 0;

  constructor(url: string, did: string) {
    this.url = url;
    this.did = did;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.url}?did=${encodeURIComponent(this.did)}`;
      log('🔌', 'NANOBOT', `Connecting to ${wsUrl}`);

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        log('✅', 'NANOBOT', 'WebSocket connection established');
        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          recordMessage('in', message);
          this.handleMessage(message);
        } catch (e) {
          log('❌', 'ERROR', `Failed to parse message: ${e}`);
        }
      });

      this.ws.on('close', (code, reason) => {
        log('🔌', 'NANOBOT', `Connection closed: code=${code}, reason=${reason || 'none'}`);
      });

      this.ws.on('error', (error) => {
        log('❌', 'ERROR', `Connection error: ${error.message}`);
        reject(error);
      });

      this.ws.on('ping', () => {
        log('💓', 'NANOBOT', 'Received PING from server');
      });

      this.ws.on('pong', () => {
        log('💓', 'NANOBOT', 'Received PONG confirmation');
      });
    });
  }

  private handleMessage(message: { type: string; source?: string; [key: string]: unknown }): void {
    log('🔄', 'NANOBOT', `Processing message: ${message.type} (from: ${message.source || 'unknown'})`);

    // 响应心跳
    if (message.type === 'status.heartbeat') {
      this.sendHeartbeatResponse();
    }
    // 响应状态请求
    else if (message.type === 'status.request') {
      this.sendStatusResponse();
    }
  }

  private sendHeartbeatResponse(): void {
    const response = createHeartbeatEvent(
      this.did,
      'did:anp:automaton:main',
      {
        status: 'healthy',
        uptime: process.uptime(),
        activeTasks: Math.floor(Math.random() * 3),
        queuedTasks: Math.floor(Math.random() * 5),
      }
    );
    this.send(response);
  }

  private sendStatusResponse(): void {
    const response = {
      id: `resp-${Date.now()}`,
      type: 'status.response',
      timestamp: new Date().toISOString(),
      source: this.did,
      target: 'did:anp:automaton:main',
      payload: {
        status: 'idle',
        currentTasks: 0,
        queuedTasks: 2,
        resources: {
          cpuUsage: Math.random() * 30,
          memoryUsage: Math.random() * 50,
          tokensUsed: Math.floor(Math.random() * 10000),
        }
      }
    };
    this.send(response);
  }

  send(message: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log('⚠️', 'ERROR', 'Cannot send: connection not open');
      return;
    }
    recordMessage('out', message);
    this.ws.send(JSON.stringify(message));
  }

  // 模拟任务进度
  simulateTaskProgress(taskName: string): void {
    this.taskId++;
    const taskId = `task-${this.taskId}`;
    
    log('📋', 'NANOBOT', `Starting task: ${taskName} (${taskId})`);
    
    const phases = [
      { progress: 0.1, phase: '初始化' },
      { progress: 0.3, phase: '加载数据' },
      { progress: 0.5, phase: '处理中' },
      { progress: 0.7, phase: '验证结果' },
      { progress: 0.9, phase: '收尾' },
      { progress: 1.0, phase: '完成' },
    ];

    let delay = 500;
    for (const { progress, phase } of phases) {
      setTimeout(() => {
        const event = createProgressEvent(
          this.did,
          'did:anp:automaton:main',
          {
            taskId,
            progress,
            currentPhase: phase,
            completedSteps: phases.filter(p => p.progress < progress).map(p => p.phase),
            nextSteps: phases.filter(p => p.progress > progress).map(p => p.phase),
            etaSeconds: Math.round((1 - progress) * 30),
          }
        );
        this.send(event);
      }, delay);
      delay += 800 + Math.random() * 400;
    }
  }

  // 模拟错误
  simulateError(taskId: string, errorMessage: string): void {
    const event = createErrorEvent(
      this.did,
      'did:anp:automaton:main',
      {
        taskId,
        severity: 'error',
        errorCode: 'TASK_FAILED',
        message: errorMessage,
        recoverable: true,
        context: { retryCount: 1, maxRetries: 3 }
      }
    );
    this.send(event);
  }

  disconnect(): void {
    if (this.ws) {
      log('🔌', 'NANOBOT', 'Initiating disconnect...');
      this.ws.close(1000, 'Normal shutdown');
      this.ws = null;
    }
  }
}

// ============================================================================
// 主测试流程
// ============================================================================

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('📋 Interagent Communication Logger');
  console.log('═'.repeat(80) + '\n');

  const PORT = 10791;
  const AUTOMATON_DID = 'did:anp:automaton:main';
  const NANOBOT_DID = 'did:anp:nanobot:logger-001';

  // 1. 启动 Automaton WebSocket 服务器
  // -------------------------------------------------------------------------
  log('🚀', 'AUTOMATON', `Starting WebSocket server on port ${PORT}...`);

  const server = new InteragentWebSocketServer({
    port: PORT,
    heartbeatInterval: 5000,    // 5秒心跳 (测试用，生产环境30秒)
    connectionTimeout: 30000,
    maxConnections: 5,
    host: '127.0.0.1',
  });

  // 记录服务器事件
  server.on('started', ({ port }) => {
    log('✅', 'AUTOMATON', `Server started, listening on port ${port}`);
  });

  server.on('client:connected', ({ clientInfo }) => {
    log('👋', 'AUTOMATON', `Client connected`, {
      did: clientInfo.did,
      connectedAt: clientInfo.connectedAt.toISOString(),
    });
  });

  server.on('client:disconnected', ({ did, code, reason }) => {
    log('👋', 'AUTOMATON', `Client disconnected`, { did, code, reason });
  });

  server.on('message', ({ did, message }) => {
    // 消息已在客户端记录，这里只记录服务器收到确认
    log('✔️', 'AUTOMATON', `Message received from ${did}, type: ${(message as { type?: string }).type}`);
  });

  server.on('message:error', ({ did, error, raw }) => {
    log('❌', 'ERROR', `Message parse error from ${did}`, { error: String(error), raw: raw.substring(0, 100) });
  });

  server.on('send:error', ({ error, message }) => {
    log('❌', 'ERROR', `Send error`, { error: String(error), messageType: (message as { type?: string }).type });
  });

  await server.start();

  // 2. 启动模拟的 Nanobot 客户端
  // -------------------------------------------------------------------------
  await new Promise(resolve => setTimeout(resolve, 500));

  log('🚀', 'NANOBOT', 'Starting client...');
  const client = new MockNanobotClient(`ws://127.0.0.1:${PORT}`, NANOBOT_DID);

  await client.connect();

  // 3. 等待初始握手完成
  // -------------------------------------------------------------------------
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 4. 模拟通信场景
  // -------------------------------------------------------------------------
  console.log('\n' + '─'.repeat(80));
  console.log('📡 Starting Communication Scenarios...');
  console.log('─'.repeat(80) + '\n');

  // 场景 1: 任务进度
  log('📝', 'SYSTEM', 'Scenario 1: Task Progress Reporting');
  client.simulateTaskProgress('数据分析任务');
  await new Promise(resolve => setTimeout(resolve, 6000));

  // 场景 2: 另一个任务
  log('📝', 'SYSTEM', 'Scenario 2: Another Task');
  client.simulateTaskProgress('模型推理任务');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 场景 3: 模拟错误
  log('📝', 'SYSTEM', 'Scenario 3: Error Reporting');
  client.simulateError('task-2', '模型加载失败: 内存不足');
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 场景 4: 等待心跳周期
  log('📝', 'SYSTEM', 'Scenario 4: Waiting for heartbeat cycle (5 seconds)...');
  await new Promise(resolve => setTimeout(resolve, 6000));

  // 5. 输出统计信息
  // -------------------------------------------------------------------------
  console.log('\n' + '═'.repeat(80));
  console.log('📊 Communication Statistics');
  console.log('═'.repeat(80) + '\n');

  const serverStatus = server.getServerStatus();
  log('📈', 'SYSTEM', 'Server Status', {
    running: serverStatus.running,
    port: serverStatus.port,
    clientCount: serverStatus.clientCount,
    clients: serverStatus.clients.map(c => ({
      did: c.did,
      connectedAt: c.connectedAt.toISOString(),
      heartbeatCount: c.heartbeatCount,
    })),
  });

  log('📈', 'SYSTEM', 'Message Statistics', {
    total: stats.total,
    byDirection: stats.byDirection,
    byType: stats.byType,
  });

  console.log('\n📜 Message Timeline:');
  stats.timeline.forEach((entry, i) => {
    const arrow = entry.direction === 'in' ? '◄' : '►';
    const time = entry.time.toISOString().split('T')[1].slice(0, 12);
    console.log(`  ${i + 1}. [${time}] ${arrow} ${entry.type} (${entry.size} bytes)`);
  });

  // 6. 清理
  // -------------------------------------------------------------------------
  console.log('\n' + '─'.repeat(80));
  console.log('🧹 Cleaning up...');
  console.log('─'.repeat(80) + '\n');

  client.disconnect();
  await new Promise(resolve => setTimeout(resolve, 500));
  await server.stop();

  log('✅', 'SYSTEM', 'Test completed successfully!');

  // 7. 保存日志
  // -------------------------------------------------------------------------
  saveLog();

  console.log('\n' + '═'.repeat(80));
  console.log(`📁 Full log saved to: ${LOG_FILE}`);
  console.log('═'.repeat(80) + '\n');

  process.exit(0);
}

// 运行
main().catch((error) => {
  log('❌', 'ERROR', `Test failed: ${error.message}`, error);
  saveLog();
  process.exit(1);
});
