/**
 * Tests for Reconnection Handler
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import os from "os";
import {
  ReconnectionHandler,
  type ReconnectRequest,
  type SyncCompleteAck,
} from "../../interagent/reconnection-handler.js";
import { MessagePersistenceService } from "../../interagent/message-persistence.js";

describe("ReconnectionHandler", () => {
  let db: Database.Database;
  let persistenceService: MessagePersistenceService;
  let handler: ReconnectionHandler;
  let dbPath: string;

  beforeEach(() => {
    // Create a temporary database
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "automaton-test-"));
    dbPath = path.join(tmpDir, "test.db");
    db = new Database(dbPath);

    // Create message_buffer table
    db.exec(`
      CREATE TABLE IF NOT EXISTS message_buffer (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_message_buffer_connection
      ON message_buffer(connection_id, sequence)
    `);

    // Create services
    persistenceService = new MessagePersistenceService(db, 1000);
    handler = new ReconnectionHandler(persistenceService, { syncTimeout: 5000 });
  });

  afterEach(() => {
    handler.stopCleanupTimer();
    persistenceService.stopCleanupTimer();
    db.close();
    // Clean up temp directory
    const tmpDir = path.dirname(dbPath);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("handleReconnectRequest", () => {
    it("should return empty messages when no missed messages", () => {
      const request: ReconnectRequest = {
        type: "reconnect.request",
        connectionId: "conn-123",
        lastSeq: 0,
        timestamp: new Date().toISOString(),
      };

      const response = handler.handleReconnectRequest(request);

      expect(response.type).toBe("state.sync.response");
      expect(response.connectionId).toBe("conn-123");
      expect(response.messages).toHaveLength(0);
      expect(response.currentSeq).toBe(0);
    });

    it("should return missed messages after lastSeq", () => {
      // Persist some messages
      persistenceService.persistMessage("conn-123", 1, "type1", { data: 1 });
      persistenceService.persistMessage("conn-123", 2, "type2", { data: 2 });
      persistenceService.persistMessage("conn-123", 3, "type3", { data: 3 });

      const request: ReconnectRequest = {
        type: "reconnect.request",
        connectionId: "conn-123",
        lastSeq: 1,
        timestamp: new Date().toISOString(),
      };

      const response = handler.handleReconnectRequest(request);

      expect(response.messages).toHaveLength(2);
      expect(response.messages[0].sequence).toBe(2);
      expect(response.messages[1].sequence).toBe(3);
      expect(response.currentSeq).toBe(3);
    });

    it("should create session for reconnection", () => {
      persistenceService.persistMessage("conn-123", 1, "type1", { data: 1 });

      const request: ReconnectRequest = {
        type: "reconnect.request",
        connectionId: "conn-123",
        lastSeq: 0,
        timestamp: new Date().toISOString(),
      };

      handler.handleReconnectRequest(request);

      const session = handler.getSession("conn-123");
      expect(session).toBeDefined();
      expect(session?.syncState).toBe("syncing");
      expect(session?.expectedCount).toBe(1);
    });

    it("should emit sync:started event", () => {
      const listener = vi.fn();
      handler.on("sync:started", listener);

      persistenceService.persistMessage("conn-123", 1, "type1", { data: 1 });

      const request: ReconnectRequest = {
        type: "reconnect.request",
        connectionId: "conn-123",
        lastSeq: 0,
        timestamp: new Date().toISOString(),
      };

      handler.handleReconnectRequest(request);

      expect(listener).toHaveBeenCalledWith({
        connectionId: "conn-123",
        messageCount: 1,
      });
    });
  });

  describe("handleSyncCompleteAck", () => {
    it("should update session state to completed", () => {
      // Start a sync session
      persistenceService.persistMessage("conn-123", 1, "type1", { data: 1 });

      const request: ReconnectRequest = {
        type: "reconnect.request",
        connectionId: "conn-123",
        lastSeq: 0,
        timestamp: new Date().toISOString(),
      };

      handler.handleReconnectRequest(request);

      // Send ack
      const ack: SyncCompleteAck = {
        type: "sync.complete.ack",
        connectionId: "conn-123",
        completedAt: new Date().toISOString(),
        processedCount: 1,
      };

      handler.handleSyncCompleteAck(ack);

      // Session should be cleared
      expect(handler.getSession("conn-123")).toBeUndefined();
    });

    it("should emit sync:completed event", () => {
      const listener = vi.fn();
      handler.on("sync:completed", listener);

      // Start a sync session
      persistenceService.persistMessage("conn-123", 1, "type1", { data: 1 });

      handler.handleReconnectRequest({
        type: "reconnect.request",
        connectionId: "conn-123",
        lastSeq: 0,
        timestamp: new Date().toISOString(),
      });

      // Send ack
      handler.handleSyncCompleteAck({
        type: "sync.complete.ack",
        connectionId: "conn-123",
        completedAt: new Date().toISOString(),
        processedCount: 1,
      });

      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].connectionId).toBe("conn-123");
      expect(listener.mock.calls[0][0].processedCount).toBe(1);
    });
  });

  describe("getActiveSessions", () => {
    it("should return all active syncing sessions", () => {
      persistenceService.persistMessage("conn-1", 1, "type1", { data: 1 });
      persistenceService.persistMessage("conn-2", 1, "type1", { data: 1 });

      handler.handleReconnectRequest({
        type: "reconnect.request",
        connectionId: "conn-1",
        lastSeq: 0,
        timestamp: new Date().toISOString(),
      });

      handler.handleReconnectRequest({
        type: "reconnect.request",
        connectionId: "conn-2",
        lastSeq: 0,
        timestamp: new Date().toISOString(),
      });

      const sessions = handler.getActiveSessions();
      expect(sessions).toHaveLength(2);
    });

    it("should not return completed sessions", () => {
      persistenceService.persistMessage("conn-1", 1, "type1", { data: 1 });

      handler.handleReconnectRequest({
        type: "reconnect.request",
        connectionId: "conn-1",
        lastSeq: 0,
        timestamp: new Date().toISOString(),
      });

      handler.handleSyncCompleteAck({
        type: "sync.complete.ack",
        connectionId: "conn-1",
        completedAt: new Date().toISOString(),
        processedCount: 1,
      });

      const sessions = handler.getActiveSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  describe("static helpers", () => {
    it("should create reconnect request", () => {
      const request = ReconnectionHandler.createReconnectRequest("conn-123", 5);

      expect(request.type).toBe("reconnect.request");
      expect(request.connectionId).toBe("conn-123");
      expect(request.lastSeq).toBe(5);
      expect(request.timestamp).toBeDefined();
    });

    it("should create sync complete ack", () => {
      const ack = ReconnectionHandler.createSyncCompleteAck("conn-123", 3);

      expect(ack.type).toBe("sync.complete.ack");
      expect(ack.connectionId).toBe("conn-123");
      expect(ack.processedCount).toBe(3);
      expect(ack.completedAt).toBeDefined();
    });
  });

  describe("sync timeout", () => {
    it("should handle sync timeout", async () => {
      vi.useFakeTimers();

      // Create handler with fake timers active
      const timeoutHandler = new ReconnectionHandler(persistenceService, { syncTimeout: 5000 });

      const listener = vi.fn();
      timeoutHandler.on("sync:timeout", listener);

      persistenceService.persistMessage("conn-123", 1, "type1", { data: 1 });

      timeoutHandler.handleReconnectRequest({
        type: "reconnect.request",
        connectionId: "conn-123",
        lastSeq: 0,
        timestamp: new Date().toISOString(),
      });

      // Advance time past sync timeout (5 seconds) + cleanup interval (10 seconds)
      await vi.advanceTimersByTimeAsync(11000);

      expect(listener).toHaveBeenCalledWith({
        connectionId: "conn-123",
        expectedCount: 1,
        processedCount: 0,
      });

      timeoutHandler.stopCleanupTimer();
      vi.useRealTimers();
    });
  });
});
