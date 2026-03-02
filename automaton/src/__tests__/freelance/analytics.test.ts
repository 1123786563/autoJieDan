/**
 * Tests for AnalyticsCollector
 *
 * Verifies:
 * - Batch processing logic (auto-flush at batchSize)
 * - Auto-flush on maxWaitMs timeout
 * - Convenience methods work correctly
 * - Manual flush works
 * - Stop flushes remaining events
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { unlinkSync, existsSync } from 'fs';
import { FreelanceRepository } from '../../freelance/repository.js';
import { AnalyticsCollector } from '../../freelance/analytics.js';
import { applySchemaV11 } from '../../state/schema-v11.js';

const TEST_DB_PATH = './test-analytics-collector.db';

describe('AnalyticsCollector', () => {
  let db: Database.Database;
  let repo: FreelanceRepository;
  let collector: AnalyticsCollector;

  // Track if we should skip global collector cleanup
  let skipGlobalCleanup = false;

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }

    // Create fresh test database
    db = new Database(TEST_DB_PATH);
    db.pragma('foreign_keys = ON');

    // Create schema_version table
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create goals table
    db.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        deadline TEXT,
        completed_at TEXT
      )
    `);

    // Set initial schema version
    db.prepare("INSERT INTO schema_version (version) VALUES (10)").run();

    // Apply Schema v11 migration
    applySchemaV11(db);

    // Create repository and collector
    repo = new FreelanceRepository(db);

    // Create collector with small batch size for faster testing
    collector = new AnalyticsCollector(repo, {
      batchSize: 5,
      maxWaitMs: 1000,
    });
  });

  afterEach(() => {
    // Only clean up global collector if we're using it
    if (!skipGlobalCleanup && collector) {
      collector.stop();
    }
    db.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    skipGlobalCleanup = false;
  });

  // ==========================================================================
  // BATCH PROCESSING TESTS
  // ==========================================================================

  describe('Batch Processing', () => {
    it('should accumulate events until batchSize is reached', () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      // Track 4 events (batch size is 5, so no flush yet)
      for (let i = 0; i < 4; i++) {
        collector.trackProjectViewed({ projectId: project.id });
      }

      expect(collector.getBufferSize()).toBe(4);

      // Count events in database (should be 0, not flushed yet)
      const count = db
        .prepare('SELECT COUNT(*) as count FROM analytics_events')
        .get() as { count: number };

      expect(count.count).toBe(0);
    });

    it('should auto-flush when batchSize is reached', () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      // Track 5 events (batch size)
      for (let i = 0; i < 5; i++) {
        collector.trackProjectViewed({ projectId: project.id });
      }

      // Buffer should be cleared after auto-flush
      expect(collector.getBufferSize()).toBe(0);

      // All events should be in database
      const count = db
        .prepare('SELECT COUNT(*) as count FROM analytics_events')
        .get() as { count: number };

      expect(count.count).toBe(5);
    });

    it('should handle multiple batches correctly', () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      // Track 12 events (should result in 3 batches: 5 + 5 + 2)
      for (let i = 0; i < 12; i++) {
        collector.trackProjectViewed({ projectId: project.id });
      }

      // Buffer should have remaining events (12 % 5 = 2)
      expect(collector.getBufferSize()).toBe(2);

      // 10 events should be in database (2 full batches)
      const count = db
        .prepare('SELECT COUNT(*) as count FROM analytics_events')
        .get() as { count: number };

      expect(count.count).toBe(10);
    });

    it('should track events with custom properties', () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      collector.trackProjectScored({
        projectId: project.id,
        score: 85,
        scoreRange: 'high',
      });

      // Flush manually
      collector.flush();

      const event = db
        .prepare('SELECT * FROM analytics_events LIMIT 1')
        .get() as any;

      expect(event.event_type).toBe('project_scored');
      expect(event.project_id).toBe(project.id);
      expect(event.properties).toBeDefined();

      const props = JSON.parse(event.properties);
      expect(props.score).toBe(85);
      expect(props.scoreRange).toBe('high');
    });
  });

  // ==========================================================================
  // AUTO-FLUSH TESTS
  // ==========================================================================

  // These tests need their own collector to avoid interference from beforeEach
  describe('Auto-Flush (Isolated)', () => {
    let isolatedCollector: AnalyticsCollector;

    beforeEach(() => {
      // Stop global collector to avoid interference
      if (collector && !collector.isStopped()) {
        collector.stop();
      }

      isolatedCollector = new AnalyticsCollector(repo, {
        batchSize: 5,
        maxWaitMs: 1000,
      });
    });

    afterEach(() => {
      if (isolatedCollector && !isolatedCollector.isStopped()) {
        isolatedCollector.stop();
      }
    });

    it('should auto-flush after maxWaitMs', async () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      // Track 2 events (less than batch size)
      isolatedCollector.trackProjectViewed({ projectId: project.id });
      isolatedCollector.trackProjectViewed({ projectId: project.id });

      expect(isolatedCollector.getBufferSize()).toBe(2);

      // Wait for auto-flush (maxWaitMs is 1000ms)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Buffer should be cleared
      expect(isolatedCollector.getBufferSize()).toBe(0);

      // Events should be in database
      const count = db
        .prepare('SELECT COUNT(*) as count FROM analytics_events WHERE event_type = ?')
        .get('project_viewed') as { count: number };

      expect(count.count).toBeGreaterThanOrEqual(2);
    });
    it('should auto-flush after maxWaitMs', async () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      // Track 2 events (less than batch size)
      isolatedCollector.trackProjectViewed({ projectId: project.id });
      isolatedCollector.trackProjectViewed({ projectId: project.id });

      expect(isolatedCollector.getBufferSize()).toBe(2);

      // Wait for auto-flush (maxWaitMs is 1000ms)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Buffer should be cleared
      expect(isolatedCollector.getBufferSize()).toBe(0);

      // Events should be in database
      const count = db
        .prepare('SELECT COUNT(*) as count FROM analytics_events')
        .get() as { count: number };

      expect(count.count).toBe(2);
    });

    it('should restart timer after auto-flush', async () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      // Track events and wait for auto-flush
      isolatedCollector.trackProjectViewed({ projectId: project.id });
      await new Promise(resolve => setTimeout(resolve, 1100));

      const count1 = db
        .prepare('SELECT COUNT(*) as count FROM analytics_events')
        .get() as { count: number };

      expect(count1.count).toBe(1);

      // Track more events and wait for another auto-flush
      isolatedCollector.trackProjectViewed({ projectId: project.id });
      await new Promise(resolve => setTimeout(resolve, 1100));

      const count2 = db
        .prepare('SELECT COUNT(*) as count FROM analytics_events')
        .get() as { count: number };

      expect(count2.count).toBe(2);
    });

    it('should not auto-flush after stop', async () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'stop-test-proj',
        title: 'Stop Test Project',
      });

      // Track 2 events
      isolatedCollector.trackProjectViewed({ projectId: project.id });
      isolatedCollector.trackProjectViewed({ projectId: project.id });

      // Stop collector (should flush remaining events)
      isolatedCollector.stop();

      // Wait longer than maxWaitMs to verify no auto-flush happens
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Events should be in database (flushed on stop)
      // Filter by this specific project to avoid test pollution
      const count = db
        .prepare('SELECT COUNT(*) as count FROM analytics_events WHERE project_id = ?')
        .get(project.id) as { count: number };

      expect(count.count).toBe(2);
    });
  });

  // ==========================================================================
  // MANUAL FLUSH TESTS
  // ==========================================================================

  describe('Manual Flush', () => {
    it('should flush events on manual flush()', () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      // Track 3 events (less than batch size)
      collector.trackProjectViewed({ projectId: project.id });
      collector.trackProjectViewed({ projectId: project.id });
      collector.trackProjectViewed({ projectId: project.id });

      expect(collector.getBufferSize()).toBe(3);

      // Manual flush
      collector.flush();

      expect(collector.getBufferSize()).toBe(0);

      const count = db
        .prepare('SELECT COUNT(*) as count FROM analytics_events')
        .get() as { count: number };

      expect(count.count).toBe(3);
    });

    it('should handle multiple flush() calls safely', () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      collector.trackProjectViewed({ projectId: project.id });

      // Multiple flush calls should be safe
      collector.flush();
      collector.flush();
      collector.flush();

      const count = db
        .prepare('SELECT COUNT(*) as count FROM analytics_events')
        .get() as { count: number };

      expect(count.count).toBe(1);
    });

    it('should flush on stop()', () => {
      // Stop global collector first
      if (collector && !collector.isStopped()) {
        collector.stop();
      }

      const testCollector = new AnalyticsCollector(repo, {
        batchSize: 5,
        maxWaitMs: 1000,
      });

      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'stop-test-proj2',
        title: 'Stop Test Project 2',
      });

      // Track 3 events (less than batch size)
      testCollector.trackProjectViewed({ projectId: project.id });
      testCollector.trackProjectViewed({ projectId: project.id });
      testCollector.trackProjectViewed({ projectId: project.id });

      // Stop should flush
      testCollector.stop();

      // Filter by this specific project to avoid test pollution
      const count = db
        .prepare('SELECT COUNT(*) as count FROM analytics_events WHERE project_id = ?')
        .get(project.id) as { count: number };

      expect(count.count).toBe(3);
    });
  });

  // ==========================================================================
  // CONVENIENCE METHODS TESTS
  // ==========================================================================

  describe('Convenience Methods', () => {
    it('should track project_viewed event', () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      collector.trackProjectViewed({ projectId: project.id });
      collector.flush();

      const event = db
        .prepare('SELECT * FROM analytics_events LIMIT 1')
        .get() as any;

      expect(event.event_type).toBe('project_viewed');
      expect(event.project_id).toBe(project.id);
    });

    it('should track project_scored event', () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      collector.trackProjectScored({
        projectId: project.id,
        score: 75,
        scoreRange: 'medium',
      });
      collector.flush();

      const event = db
        .prepare('SELECT * FROM analytics_events LIMIT 1')
        .get() as any;

      expect(event.event_type).toBe('project_scored');
      expect(event.project_id).toBe(project.id);

      const props = JSON.parse(event.properties);
      expect(props.score).toBe(75);
      expect(props.scoreRange).toBe('medium');
    });

    it('should track bid_created event', () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      collector.trackBidCreated({
        projectId: project.id,
        templateId: 'template-1',
      });
      collector.flush();

      const event = db
        .prepare('SELECT * FROM analytics_events LIMIT 1')
        .get() as any;

      expect(event.event_type).toBe('bid_created');
      expect(event.project_id).toBe(project.id);

      const props = JSON.parse(event.properties);
      expect(props.templateId).toBe('template-1');
    });

    it('should track bid_submitted event', () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      collector.trackBidSubmitted({
        projectId: project.id,
        bidId: 'bid-123',
        bidAmountCents: 5000,
      });
      collector.flush();

      const event = db
        .prepare('SELECT * FROM analytics_events LIMIT 1')
        .get() as any;

      expect(event.event_type).toBe('bid_submitted');
      expect(event.project_id).toBe(project.id);

      const props = JSON.parse(event.properties);
      expect(props.bidId).toBe('bid-123');
      expect(props.bidAmountCents).toBe(5000);
    });

    it('should track llm_call event', () => {
      collector.trackLLMCall({
        model: 'gpt-4',
        tokensUsed: 1500,
        costCents: 10,
        durationMs: 2500,
      });
      collector.flush();

      const event = db
        .prepare('SELECT * FROM analytics_events LIMIT 1')
        .get() as any;

      expect(event.event_type).toBe('llm_call');

      const props = JSON.parse(event.properties);
      expect(props.model).toBe('gpt-4');
      expect(props.tokensUsed).toBe(1500);
      expect(props.costCents).toBe(10);
      expect(props.durationMs).toBe(2500);
    });

    it('should track error_occurred event', () => {
      collector.trackError({
        errorCode: 'API_ERROR',
        errorMessage: 'Failed to connect to API',
        severity: 'high',
      });
      collector.flush();

      const event = db
        .prepare('SELECT * FROM analytics_events LIMIT 1')
        .get() as any;

      expect(event.event_type).toBe('error_occurred');

      const props = JSON.parse(event.properties);
      expect(props.errorCode).toBe('API_ERROR');
      expect(props.errorMessage).toBe('Failed to connect to API');
      expect(props.severity).toBe('high');
    });

    it('should track manual_intervention event', () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      collector.trackManualIntervention({
        interventionType: 'contract_sign',
        projectId: project.id,
        reason: 'Large contract amount requires approval',
      });
      collector.flush();

      const event = db
        .prepare('SELECT * FROM analytics_events LIMIT 1')
        .get() as any;

      expect(event.event_type).toBe('manual_intervention');
      expect(event.project_id).toBe(project.id);

      const props = JSON.parse(event.properties);
      expect(props.interventionType).toBe('contract_sign');
      expect(props.reason).toBe('Large contract amount requires approval');
    });
  });

  // ==========================================================================
  // STATE MANAGEMENT TESTS
  // ==========================================================================

  describe('State Management', () => {
    it('should throw error when tracking after stop', () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      collector.stop();

      expect(() => {
        collector.trackProjectViewed({ projectId: project.id });
      }).toThrow('AnalyticsCollector is stopped');
    });

    it('should report stopped status correctly', () => {
      expect(collector.isStopped()).toBe(false);

      collector.stop();

      expect(collector.isStopped()).toBe(true);
    });

    it('should handle stop() multiple times safely', () => {
      collector.stop();
      collector.stop();
      collector.stop();

      expect(collector.isStopped()).toBe(true);
    });
  });

  // ==========================================================================
  // CUSTOM PARAMETERS TESTS
  // ==========================================================================

  describe('Custom Parameters', () => {
    it('should track event with custom timestamp', () => {
      const customTime = '2026-01-01T12:00:00Z';

      collector.track({
        eventType: 'test_event',
        timestamp: customTime,
      });
      collector.flush();

      const event = db
        .prepare('SELECT * FROM analytics_events LIMIT 1')
        .get() as any;

      expect(event.timestamp).toBe(customTime);
    });

    it('should track event with custom session ID', () => {
      const sessionId = 'session-123';

      collector.track({
        eventType: 'test_event',
        sessionId,
      });
      collector.flush();

      const event = db
        .prepare('SELECT * FROM analytics_events LIMIT 1')
        .get() as any;

      expect(event.session_id).toBe(sessionId);
    });

    it('should track event with user ID', () => {
      const userId = 'user-456';

      collector.track({
        eventType: 'test_event',
        userId,
      });
      collector.flush();

      const event = db
        .prepare('SELECT * FROM analytics_events LIMIT 1')
        .get() as any;

      expect(event.user_id).toBe(userId);
    });

    it('should serialize properties to JSON', () => {
      collector.track({
        eventType: 'test_event',
        properties: {
          number: 42,
          string: 'test',
          boolean: true,
          nested: { key: 'value' },
        },
      });
      collector.flush();

      const event = db
        .prepare('SELECT * FROM analytics_events LIMIT 1')
        .get() as any;

      const props = JSON.parse(event.properties);
      expect(props.number).toBe(42);
      expect(props.string).toBe('test');
      expect(props.boolean).toBe(true);
      expect(props.nested.key).toBe('value');
    });
  });
});
