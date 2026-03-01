/**
 * Tests for Message Persistence Service
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import os from "os";
import {
  MessagePersistenceService,
  type PersistedMessage,
} from "../../interagent/message-persistence.js";

describe("MessagePersistenceService", () => {
  let db: Database.Database;
  let service: MessagePersistenceService;
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

    // Create service with short TTL for testing
    service = new MessagePersistenceService(db, 1000); // 1 second TTL
  });

  afterEach(() => {
    service.stopCleanupTimer();
    db.close();
    // Clean up temp directory
    const tmpDir = path.dirname(dbPath);
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("persistMessage", () => {
    it("should persist a message with correct fields", () => {
      const id = service.persistMessage(
        "conn-123",
        1,
        "test.message",
        { data: "hello world" }
      );

      expect(id).toBeDefined();

      // Verify message was stored
      const row = db.prepare("SELECT * FROM message_buffer WHERE id = ?").get(id) as any;
      expect(row).toBeDefined();
      expect(row.connection_id).toBe("conn-123");
      expect(row.sequence).toBe(1);
      expect(row.type).toBe("test.message");
      expect(JSON.parse(row.payload)).toEqual({ data: "hello world" });
    });

    it("should emit message:persisted event", () => {
      let emitted = false;
      service.on("message:persisted", () => {
        emitted = true;
      });

      service.persistMessage("conn-123", 1, "test.message", { data: "test" });

      expect(emitted).toBe(true);
    });

    it("should increment sequence numbers", () => {
      service.persistMessage("conn-123", 1, "type1", { data: 1 });
      service.persistMessage("conn-123", 2, "type2", { data: 2 });
      service.persistMessage("conn-123", 3, "type3", { data: 3 });

      const rows = db.prepare("SELECT * FROM message_buffer WHERE connection_id = ? ORDER BY sequence").all("conn-123") as any[];
      expect(rows).toHaveLength(3);
      expect(rows[0].sequence).toBe(1);
      expect(rows[1].sequence).toBe(2);
      expect(rows[2].sequence).toBe(3);
    });
  });

  describe("getMissedMessages", () => {
    it("should return messages after lastSeq", () => {
      service.persistMessage("conn-123", 1, "type1", { data: 1 });
      service.persistMessage("conn-123", 2, "type2", { data: 2 });
      service.persistMessage("conn-123", 3, "type3", { data: 3 });

      const missed = service.getMissedMessages("conn-123", 1);

      expect(missed).toHaveLength(2);
      expect(missed[0].sequence).toBe(2);
    });

    it("should return empty array if no missed messages", () => {
      service.persistMessage("conn-123", 1, "type1", { data: 1 });

      const missed = service.getMissedMessages("conn-123", 1);

      expect(missed).toHaveLength(0);
    });

    it("should not return expired messages", () => {
      service.persistMessage("conn-123", 1, "type1", { data: 1 });

      // Manually expire the message by connection_id
      db.prepare(
        "UPDATE message_buffer SET expires_at = ? WHERE connection_id = ?"
      ).run(new Date(Date.now() - 2000).toISOString(), "conn-123");

      const missed = service.getMissedMessages("conn-123", 0);

      expect(missed).toHaveLength(0);
    });
  });

  describe("getStateSyncResponse", () => {
    it("should return state sync response with correct fields", () => {
      service.persistMessage("conn-123", 1, "type1", { data: 1 });
      service.persistMessage("conn-123", 2, "type2", { data: 2 });

      const response = service.getStateSyncResponse("conn-123", 0);

      expect(response.messages).toHaveLength(2);
      expect(response.currentSeq).toBe(2);
      expect(response.syncedAt).toBeInstanceOf(Date);
    });
  });

  describe("cleanupExpired", () => {
    it("should delete expired messages", () => {
      service.persistMessage("conn-123", 1, "type1", { data: 1 });
      service.persistMessage("conn-123", 2, "type2", { data: 2 });

      // Expire the first message
      db.prepare(
        "UPDATE message_buffer SET expires_at = ? WHERE sequence = ?"
      ).run(new Date(Date.now() - 1000).toISOString(), 1);

      const deletedCount = service.cleanupExpired();

      expect(deletedCount).toBe(1);

      const remaining = db.prepare("SELECT COUNT(*) FROM message_buffer").get() as any;
      expect(remaining["COUNT(*)"]).toBe(1);
    });

    it("should not delete non-expired messages", () => {
      service.persistMessage("conn-123", 1, "type1", { data: 1 });
      service.persistMessage("conn-123", 2, "type2", { data: 2 });

      // Expire only first message
      db.prepare(
        "UPDATE message_buffer SET expires_at = ? WHERE sequence = ?"
      ).run(new Date(Date.now() - 1000).toISOString(), 1);

      const deletedCount = service.cleanupExpired();

      expect(deletedCount).toBe(1);

      const remaining = db.prepare("SELECT COUNT(*) FROM message_buffer").get() as any;
      expect(remaining["COUNT(*)"]).toBe(1);
    });
  });
});
