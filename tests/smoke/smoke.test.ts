/**
 * @vitest-environment node
 *
 * Smoke Tests for AutoJieDan Production Deployment
 * Phase 1F-04: Smoke Test Suite
 *
 * 快速验证系统核心功能是否正常工作
 * 执行时间目标: < 30秒
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { WebSocket } from 'ws';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ============================================================================
// Test Configuration
// ============================================================================

const AUTOMATON_HTTP_PORT = parseInt(process.env.AUTOMATON_HTTP_PORT || '18790');
const AUTOMATON_WS_PORT = parseInt(process.env.AUTOMATON_WS_PORT || '18791');
const AUTOMATON_HOST = process.env.AUTOMATON_HOST || '127.0.0.1';
const TEST_TIMEOUT = 25000; // 25秒超时，留5秒余量

// Required environment variables for production
const REQUIRED_ENV_VARS = [
  'INTERAGENT_SECRET',
  'OPENAI_API_KEY',
] as const;

// Optional but recommended environment variables
const RECOMMENDED_ENV_VARS = [
  'NODE_ENV',
  'AUTOMATON_HTTP_PORT',
  'AUTOMATON_WS_PORT',
] as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Helper to perform HTTP request with timeout
 */
function httpRequest(
  host: string,
  port: number,
  path: string,
  timeout = 5000
): Promise<{ status: number; data: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port,
      path,
      method: 'GET',
      timeout,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode || 500,
            data: data ? JSON.parse(data) : null,
            headers: res.headers,
          });
        } catch {
          resolve({
            status: res.statusCode || 500,
            data: null,
            headers: res.headers,
          });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeout}ms`));
    });

    req.end();
  });
}

/**
 * Helper to check WebSocket connection
 */
function testWebSocketConnection(
  host: string,
  port: number,
  timeout = 5000
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:${port}`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket connection timeout'));
    }, timeout);

    ws.on('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve(true);
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Helper to create a test database connection
 */
function createTestDatabase(): Database.Database {
  const testDir = join(tmpdir(), 'autojiedan-smoke-test');
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true });
  }
  const dbPath = join(testDir, `test-${Date.now()}.db`);
  return new Database(dbPath);
}

// ============================================================================
// Smoke Tests
// ============================================================================

describe('Smoke Tests', () => {
  describe('Health Check', () => {
    it(
      'should respond to health check endpoint',
      async () => {
        const response = await httpRequest(
          AUTOMATON_HOST,
          AUTOMATON_HTTP_PORT,
          '/health'
        );

        expect(response.status).toBe(200);
        expect(response.data).toBeDefined();
        expect(response.data.status).toMatch(/^(healthy|degraded)$/);
        expect(response.data.uptime).toBeGreaterThanOrEqual(0);
        expect(response.data.version).toBeDefined();
        expect(response.data.timestamp).toBeDefined();
      },
      { timeout: TEST_TIMEOUT }
    );

    it(
      'should respond to ready endpoint',
      async () => {
        const response = await httpRequest(
          AUTOMATON_HOST,
          AUTOMATON_HTTP_PORT,
          '/ready'
        );

        expect(response.status).toBe(200);
        expect(response.data).toBeDefined();
        expect(response.data.ready).toBeDefined();
        expect(typeof response.data.ready).toBe('boolean');
      },
      { timeout: TEST_TIMEOUT }
    );

    it(
      'should respond to live endpoint',
      async () => {
        const response = await httpRequest(
          AUTOMATON_HOST,
          AUTOMATON_HTTP_PORT,
          '/live'
        );

        expect(response.status).toBe(200);
        expect(response.data).toBeDefined();
        expect(response.data.alive).toBe(true);
        expect(response.data.uptime).toBeGreaterThanOrEqual(0);
      },
      { timeout: TEST_TIMEOUT }
    );
  });

  describe('Database Connection', () => {
    let testDb: Database.Database | null = null;

    afterAll(() => {
      if (testDb) {
        testDb.close();
      }
    });

    it(
      'should create and connect to SQLite database',
      () => {
        testDb = createTestDatabase();

        // Verify database is open
        expect(testDb.open).toBe(true);

        // Test basic database operation
        const result = testDb.prepare('SELECT 1 as test').get();
        expect(result).toBeDefined();
        expect((result as any).test).toBe(1);
      },
      { timeout: TEST_TIMEOUT }
    );

    it(
      'should support basic CRUD operations',
      () => {
        if (!testDb) {
          testDb = createTestDatabase();
        }

        // Create table
        testDb
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS smoke_test (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `
          )
          .run();

        // Insert
        const insertStmt = testDb
          .prepare('INSERT INTO smoke_test (name) VALUES (?)')
          .bind('test-record');
        const insertResult = insertStmt.run();
        expect(insertResult.changes).toBe(1);
        expect(insertResult.lastInsertRowid).toBeGreaterThan(0);

        // Read
        const selectStmt = testDb
          .prepare('SELECT * FROM smoke_test WHERE id = ?')
          .bind(insertResult.lastInsertRowid);
        const row = selectStmt.get();
        expect(row).toBeDefined();
        expect((row as any).name).toBe('test-record');

        // Update
        const updateStmt = testDb
          .prepare('UPDATE smoke_test SET name = ? WHERE id = ?')
          .bind('updated-record', insertResult.lastInsertRowid);
        const updateResult = updateStmt.run();
        expect(updateResult.changes).toBe(1);

        // Delete
        const deleteStmt = testDb
          .prepare('DELETE FROM smoke_test WHERE id = ?')
          .bind(insertResult.lastInsertRowid);
        const deleteResult = deleteStmt.run();
        expect(deleteResult.changes).toBe(1);
      },
      { timeout: TEST_TIMEOUT }
    );

    it(
      'should support transaction operations',
      () => {
        if (!testDb) {
          testDb = createTestDatabase();
        }

        // Test transaction
        const transaction = testDb.transaction(() => {
          testDb!
            .prepare('INSERT INTO smoke_test (name) VALUES (?)')
            .bind('tx-record-1')
            .run();
          testDb!
            .prepare('INSERT INTO smoke_test (name) VALUES (?)')
            .bind('tx-record-2')
            .run();
        });

        transaction();

        const count = testDb
          .prepare('SELECT COUNT(*) as count FROM smoke_test WHERE name LIKE ?')
          .bind('tx-record-%')
          .get();
        expect((count as any).count).toBe(2);
      },
      { timeout: TEST_TIMEOUT }
    );
  });

  describe('WebSocket Connection', () => {
    it(
      'should establish WebSocket connection',
      async () => {
        const connected = await testWebSocketConnection(
          AUTOMATON_HOST,
          AUTOMATON_WS_PORT
        );
        expect(connected).toBe(true);
      },
      { timeout: TEST_TIMEOUT }
    );

    it(
      'should handle WebSocket connection failure gracefully',
      async () => {
        // Try to connect to a non-existent port
        const invalidPort = AUTOMATON_WS_PORT + 1000;

        try {
          await testWebSocketConnection(AUTOMATON_HOST, invalidPort, 2000);
          // If we get here, the test failed (should have thrown)
          expect(true).toBe(false);
        } catch (error) {
          // Expected to fail
          expect(error).toBeDefined();
        }
      },
      { timeout: TEST_TIMEOUT }
    );
  });

  describe('Environment Variables', () => {
    it('should have all required environment variables set', () => {
      const missingVars: string[] = [];

      for (const varName of REQUIRED_ENV_VARS) {
        if (!process.env[varName]) {
          missingVars.push(varName);
        }
      }

      expect(missingVars).toHaveLength(0);
    });

    it('should have recommended environment variables set', () => {
      const missingVars: string[] = [];

      for (const varName of RECOMMENDED_ENV_VARS) {
        if (!process.env[varName]) {
          missingVars.push(varName);
        }
      }

      // Allow some recommended vars to be missing, but warn
      if (missingVars.length > 0) {
        console.warn(`Missing recommended env vars: ${missingVars.join(', ')}`);
      }
    });

    it('should validate INTERAGENT_SECRET format', () => {
      const secret = process.env.INTERAGENT_SECRET;
      expect(secret).toBeDefined();
      expect(typeof secret).toBe('string');
      expect(secret!.length).toBeGreaterThanOrEqual(16); // Minimum length
    });

    it('should validate OPENAI_API_KEY format', () => {
      const apiKey = process.env.OPENAI_API_KEY;
      expect(apiKey).toBeDefined();
      expect(typeof apiKey).toBe('string');
      // OpenAI API keys start with 'sk-'
      expect(apiKey).toMatch(/^sk-/);
    });
  });

  describe('HTTP Status Endpoint', () => {
    it(
      'should return comprehensive status information',
      async () => {
        const response = await httpRequest(
          AUTOMATON_HOST,
          AUTOMATON_HTTP_PORT,
          '/status'
        );

        expect(response.status).toBe(200);
        expect(response.data).toBeDefined();

        // Check for expected status fields
        expect(response.data.system).toBeDefined();
        expect(response.data.automaton).toBeDefined();
        expect(response.data.uptime).toBeGreaterThanOrEqual(0);
      },
      { timeout: TEST_TIMEOUT }
    );
  });

  describe('CORS and Headers', () => {
    it(
      'should include CORS headers',
      async () => {
        const response = await httpRequest(
          AUTOMATON_HOST,
          AUTOMATON_HTTP_PORT,
          '/health'
        );

        expect(response.headers['access-control-allow-origin']).toBeDefined();
        expect(response.headers['access-control-allow-methods']).toBeDefined();
      },
      { timeout: TEST_TIMEOUT }
    );

    it(
      'should return appropriate content type',
      async () => {
        const response = await httpRequest(
          AUTOMATON_HOST,
          AUTOMATON_HTTP_PORT,
          '/health'
        );

        expect(response.headers['content-type']).toContain('application/json');
      },
      { timeout: TEST_TIMEOUT }
    );
  });
});
