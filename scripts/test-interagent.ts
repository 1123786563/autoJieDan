#!/usr/bin/env npx tsx
/**
 * Interagent Communication Test Script
 * 
 * 启动 Automaton WebSocket 服务器并模拟 Nanobot 客户端通信
 * 输出详细的通信日志
 * 
 * Usage: npx tsx scripts/test-interagent.ts
 */

import { InteragentWebSocketServer, createProgressEvent, createHeartbeatEvent } from "../automaton/src/interagent/websocket.js";
import WebSocket from "ws";

// ============================================================================
// 日志工具
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

function log(emoji: string, color: string, tag: string, message: string, data?: unknown) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  console.log(`${color}[${timestamp}] ${emoji} [${tag}]${COLORS.reset} ${message}`);
  if (data !== undefined) {
    console.log(`${color}  └─ ${COLORS.reset}${JSON.stringify(data, null, 2).split('\n').join('\n    ')}`);
  }
}

// ============================================================================
// 模拟 Nanobot WebSocket 客户端
// ============================================================================

class MockNanobotClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly did: string;
  private messageLog: Array<{ direction: 'in' | 'out', timestamp: Date, data: unknown }> = [];

  constructor(url: string, did: string) {
    this.url = url;
    this.did = did;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.url}?did=${encodeURIComponent(this.did)}`;
      log('🔌', COLORS.cyan, 'NANOBOT', `正在连接到 ${wsUrl}`);

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        log('✅', COLORS.green, 'NANOBOT', 'WebSocket 连接已建立');
        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.messageLog.push({ direction: 'in', timestamp: new Date(), data: message });
          log('📥', COLORS.blue, 'NANOBOT←AUTOMATON', '收到消息', message);
          this.handleMessage(message);
        } catch (e) {
          log('❌', COLORS.red, 'NANOBOT', `解析消息失败: ${e}`);
        }
      });

      this.ws.on('close', (code, reason) => {
        log('🔌', COLORS.yellow, 'NANOBOT', `连接关闭: code=${code}, reason=${reason}`);
      });

      this.ws.on('error', (error) => {
        log('❌', COLORS.red, 'NANOBOT', `连接错误: ${error.message}`);
        reject(error);
      });
    });
  }

  private handleMessage(message: { type: string; [key: string]: unknown }): void {
    log('🔄', COLORS.magenta, 'NANOBOT', `处理消息类型: ${message.type}`);

    // 响应心跳
    if (message.type === 'status.heartbeat') {
      this.sendHeartbeatResponse();
    }
  }

  private sendHeartbeatResponse(): void {
    const response = createHeartbeatEvent(
      this.did,
      'did:anp:automaton:main',
      {
        status: 'healthy',
        uptime: process.uptime(),
        activeTasks: 0,
        queuedTasks: 0,
      }
    );
    this.send(response);
  }

  send(message: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log('⚠️', COLORS.yellow, 'NANOBOT', '无法发送: 连接未打开');
      return;
    }
    this.messageLog.push({ direction: 'out', timestamp: new Date(), data: message });
    log('📤', COLORS.green, 'NANOBOT→AUTOMATON', '发送消息', message);
    this.ws.send(JSON.stringify(message));
  }

  sendTaskProgress(taskId: string, progress: number, phase: string): void {
    const event = createProgressEvent(
      this.did,
      'did:anp:automaton:main',
      {
        taskId,
        progress,
        currentPhase: phase,
        completedSteps: ['初始化', '加载数据'],
        nextSteps: ['处理请求', '返回结果'],
        etaSeconds: 30,
      }
    );
    this.send(event);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getLog(): Array<{ direction: 'in' | 'out', timestamp: Date, data: unknown }> {
    return this.messageLog;
  }
}

// ============================================================================
// 主测试流程
// ============================================================================

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log(`${COLORS.cyan}🧪 Interagent Communication Test${COLORS.reset}`);
  console.log('='.repeat(80) + '\n');

  const PORT = 10791;
  const AUTOMATON_DID = 'did:anp:automaton:main';
  const NANOBOT_DID = 'did:anp:nanobot:test-001';

  // 1. 启动 Automaton WebSocket 服务器
  // -------------------------------------------------------------------------
  log('🚀', COLORS.cyan, 'AUTOMATON', '启动 WebSocket 服务器...');

  const server = new InteragentWebSocketServer({
    port: PORT,
    heartbeatInterval: 5000,
    connectionTimeout: 30000,
    maxConnections: 5,
    host: '127.0.0.1',
  });

  // 监听服务器事件
  server.on('started', ({ port }) => {
    log('✅', COLORS.green, 'AUTOMATON', `WebSocket 服务器已启动，监听端口 ${port}`);
  });

  server.on('client:connected', ({ clientInfo }) => {
    log('👋', COLORS.green, 'AUTOMATON', `客户端已连接`, { did: clientInfo.did });
  });

  server.on('client:disconnected', ({ did, code, reason }) => {
    log('👋', COLORS.yellow, 'AUTOMATON', `客户端已断开`, { did, code, reason });
  });

  server.on('message', ({ did, message }) => {
    log('📥', COLORS.blue, 'AUTOMATON←NANOBOT', `收到来自 ${did} 的消息`, message);
  });

  server.on('message:error', ({ did, error, raw }) => {
    log('❌', COLORS.red, 'AUTOMATON', `消息解析错误`, { did, error: String(error), raw });
  });

  await server.start();

  // 2. 启动模拟的 Nanobot 客户端
  // -------------------------------------------------------------------------
  await new Promise(resolve => setTimeout(resolve, 500)); // 等待服务器完全启动

  log('🚀', COLORS.cyan, 'NANOBOT', '启动模拟客户端...');
  const client = new MockNanobotClient(`ws://127.0.0.1:${PORT}`, NANOBOT_DID);

  await client.connect();

  // 3. 模拟通信流程
  // -------------------------------------------------------------------------
  console.log('\n' + '-'.repeat(80));
  console.log(`${COLORS.yellow}📡 开始模拟通信流程...${COLORS.reset}`);
  console.log('-'.repeat(80) + '\n');

  // 等待初始心跳
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 发送任务进度
  log('📤', COLORS.green, 'TEST', '发送任务进度 (1/3)...');
  client.sendTaskProgress('task-001', 0.3, '数据加载中');
  await new Promise(resolve => setTimeout(resolve, 1000));

  log('📤', COLORS.green, 'TEST', '发送任务进度 (2/3)...');
  client.sendTaskProgress('task-001', 0.6, '处理请求中');
  await new Promise(resolve => setTimeout(resolve, 1000));

  log('📤', COLORS.green, 'TEST', '发送任务进度 (3/3)...');
  client.sendTaskProgress('task-001', 1.0, '完成');

  // 4. 输出通信摘要
  // -------------------------------------------------------------------------
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n' + '='.repeat(80));
  console.log(`${COLORS.cyan}📊 通信摘要${COLORS.reset}`);
  console.log('='.repeat(80) + '\n');

  const serverStatus = server.getServerStatus();
  log('📈', COLORS.cyan, 'AUTOMATON', '服务器状态', {
    running: serverStatus.running,
    port: serverStatus.port,
    clientCount: serverStatus.clientCount,
  });

  const clientLog = client.getLog();
  log('📝', COLORS.cyan, 'NANOBOT', `通信日志 (${clientLog.length} 条消息)`);

  console.log('\n消息流:');
  clientLog.forEach((entry, i) => {
    const dir = entry.direction === 'in' ? '←' : '→';
    const color = entry.direction === 'in' ? COLORS.blue : COLORS.green;
    const type = (entry.data as { type?: string })?.type || 'unknown';
    console.log(`  ${color}${i + 1}. [${entry.timestamp.toISOString().split('T')[1].slice(0, 12)}] ${dir} ${type}${COLORS.reset}`);
  });

  // 5. 清理
  // -------------------------------------------------------------------------
  console.log('\n' + '-'.repeat(80));
  console.log(`${COLORS.yellow}🧹 清理资源...${COLORS.reset}`);
  console.log('-'.repeat(80) + '\n');

  client.disconnect();
  await server.stop();

  log('✅', COLORS.green, 'TEST', '测试完成！');
  console.log('\n' + '='.repeat(80) + '\n');

  process.exit(0);
}

// 运行测试
main().catch((error) => {
  console.error(`${COLORS.red}❌ 测试失败:${COLORS.reset}`, error);
  process.exit(1);
});
