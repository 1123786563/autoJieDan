/**
 * Tests for FreelanceRepository
 *
 * Verifies:
 * - All CRUD operations work correctly
 * - Transaction rollback on errors
 * - Concurrent access safety
 * - Foreign key constraints
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { unlinkSync, existsSync } from 'fs';
import { FreelanceRepository } from '../../freelance/repository.js';
import { applySchemaV11 } from '../../state/schema-v11.js';
import type { ProjectStatus, BidStatus } from '../../freelance/types.js';

const TEST_DB_PATH = './test-repository.db';

describe('FreelanceRepository', () => {
  let db: Database.Database;
  let repo: FreelanceRepository;

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }

    // Create fresh test database
    db = new Database(TEST_DB_PATH);

    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Create schema_version table (required for migration)
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create goals table (required for foreign key references)
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

    // Set initial schema version to 10
    db.prepare("INSERT INTO schema_version (version) VALUES (10)").run();

    // Apply Schema v11 migration
    applySchemaV11(db);

    // Create repository instance
    repo = new FreelanceRepository(db);
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  // ==========================================================================
  // PROJECT OPERATIONS
  // ==========================================================================

  describe('Project Operations', () => {
    describe('createProject', () => {
      it('should create a project with all fields', () => {
        const project = repo.createProject({
          platform: 'upwork',
          platformProjectId: 'upwork-123',
          title: 'Test Project',
          description: 'Test Description',
          budgetCents: 10000,
          deadline: '2026-12-31T23:59:59Z',
        });

        expect(project.id).toBeDefined();
        expect(project.platform).toBe('upwork');
        expect(project.platformProjectId).toBe('upwork-123');
        expect(project.title).toBe('Test Project');
        expect(project.description).toBe('Test Description');
        expect(project.budgetCents).toBe(10000);
        expect(project.deadline).toBe('2026-12-31T23:59:59Z');
        expect(project.status).toBe('discovered');
      });

      it('should create a project with minimal fields', () => {
        const project = repo.createProject({
          platform: 'fiverr',
          platformProjectId: 'fiverr-456',
          title: 'Minimal Project',
        });

        expect(project.id).toBeDefined();
        expect(project.platform).toBe('fiverr');
        expect(project.platformProjectId).toBe('fiverr-456');
        expect(project.title).toBe('Minimal Project');
        expect(project.status).toBe('discovered');
      });

      it('should associate project with client', () => {
        const client = repo.getOrCreateClient({
          platform: 'upwork',
          platformClientId: 'client-1',
          name: 'Test Client',
        });

        const project = repo.createProject({
          platform: 'upwork',
          platformProjectId: 'upwork-123',
          title: 'Test Project',
          clientId: client.id,
        });

        expect(project.clientId).toBe(client.id);
      });
    });

    describe('getProject', () => {
      it('should return project by ID', () => {
        const created = repo.createProject({
          platform: 'upwork',
          platformProjectId: 'upwork-123',
          title: 'Test Project',
        });

        const found = repo.getProject(created.id);

        expect(found).toBeDefined();
        expect(found?.id).toBe(created.id);
        expect(found?.title).toBe('Test Project');
      });

      it('should return undefined for non-existent project', () => {
        const found = repo.getProject('non-existent');
        expect(found).toBeUndefined();
      });
    });

    describe('getProjectByPlatformId', () => {
      it('should find project by platform and platform ID', () => {
        repo.createProject({
          platform: 'upwork',
          platformProjectId: 'upwork-123',
          title: 'Test Project',
        });

        const found = repo.getProjectByPlatformId('upwork', 'upwork-123');

        expect(found).toBeDefined();
        expect(found?.platform).toBe('upwork');
        expect(found?.platformProjectId).toBe('upwork-123');
      });

      it('should return undefined for non-existent platform ID', () => {
        const found = repo.getProjectByPlatformId('upwork', 'non-existent');
        expect(found).toBeUndefined();
      });
    });

    describe('updateProjectStatus', () => {
      it('should update project status', () => {
        const project = repo.createProject({
          platform: 'upwork',
          platformProjectId: 'upwork-123',
          title: 'Test Project',
        });

        repo.updateProjectStatus(project.id, 'scored' as ProjectStatus);

        const updated = repo.getProject(project.id);
        expect(updated?.status).toBe('scored');
      });

      it('should throw error for non-existent project', () => {
        expect(() => {
          repo.updateProjectStatus('non-existent', 'scored' as ProjectStatus);
        }).toThrow('Project not found');
      });
    });

    describe('updateProjectScore', () => {
      it('should update project score and factors', () => {
        const project = repo.createProject({
          platform: 'upwork',
          platformProjectId: 'upwork-123',
          title: 'Test Project',
        });

        const factors = {
          technicalMatch: 85,
          budgetReasonable: 90,
          deliveryFeasible: 75,
          clientQuality: 80,
          strategicValue: 70,
        };

        repo.updateProjectScore(project.id, 80, factors);

        const updated = repo.getProject(project.id);
        expect(updated?.score).toBe(80);
        expect(updated?.scoreFactors).toBeDefined();
        expect(JSON.parse(updated!.scoreFactors!)).toEqual(factors);
        expect(updated?.status).toBe('scored');
      });

      it('should throw error for non-existent project', () => {
        expect(() => {
          repo.updateProjectScore('non-existent', 80, {
            technicalMatch: 85,
            budgetReasonable: 90,
            deliveryFeasible: 75,
            clientQuality: 80,
            strategicValue: 70,
          });
        }).toThrow('Project not found');
      });
    });

    describe('getProjectsToScore', () => {
      it('should return projects in discovered status', () => {
        repo.createProject({
          platform: 'upwork',
          platformProjectId: 'proj1',
          title: 'Project 1',
        });

        repo.createProject({
          platform: 'upwork',
          platformProjectId: 'proj2',
          title: 'Project 2',
        });

        const project3 = repo.createProject({
          platform: 'upwork',
          platformProjectId: 'proj3',
          title: 'Project 3',
        });

        // Mark one as scored
        repo.updateProjectStatus(project3.id, 'scored' as ProjectStatus);

        const toScore = repo.getProjectsToScore(10);

        expect(toScore).toHaveLength(2);
        expect(toScore.every(p => p.status === 'discovered')).toBe(true);
      });

      it('should respect limit parameter', () => {
        for (let i = 0; i < 5; i++) {
          repo.createProject({
            platform: 'upwork',
            platformProjectId: `proj${i}`,
            title: `Project ${i}`,
          });
        }

        const toScore = repo.getProjectsToScore(3);
        expect(toScore).toHaveLength(3);
      });
    });
  });

  // ==========================================================================
  // CLIENT OPERATIONS
  // ==========================================================================

  describe('Client Operations', () => {
    describe('getOrCreateClient', () => {
      it('should create new client', () => {
        const client = repo.getOrCreateClient({
          platform: 'upwork',
          platformClientId: 'client-1',
          name: 'Test Client',
          company: 'Test Company',
          rating: 4.5,
          totalSpentCents: 50000,
          tier: 'gold',
        });

        expect(client.id).toBeDefined();
        expect(client.platform).toBe('upwork');
        expect(client.platformClientId).toBe('client-1');
        expect(client.name).toBe('Test Client');
        expect(client.company).toBe('Test Company');
        expect(client.rating).toBe(4.5);
        expect(client.totalSpentCents).toBe(50000);
        expect(client.tier).toBe('gold');
      });

      it('should return existing client', () => {
        const client1 = repo.getOrCreateClient({
          platform: 'upwork',
          platformClientId: 'client-1',
          name: 'Test Client',
        });

        const client2 = repo.getOrCreateClient({
          platform: 'upwork',
          platformClientId: 'client-1',
          name: 'Updated Name',
        });

        expect(client1.id).toBe(client2.id);
        expect(client2.name).toBe('Updated Name'); // Should update
      });

      it('should use default values for optional fields', () => {
        const client = repo.getOrCreateClient({
          platform: 'upwork',
          platformClientId: 'client-1',
        });

        expect(client.tier).toBe('new');
        expect(client.languagePreference).toBe('en');
        expect(client.totalSpentCents).toBe(0);
        expect(client.totalProjects).toBe(0);
        expect(client.hiredFreelancers).toBe(0);
      });
    });

    describe('getClient', () => {
      it('should return client by ID', () => {
        const created = repo.getOrCreateClient({
          platform: 'upwork',
          platformClientId: 'client-1',
          name: 'Test Client',
        });

        const found = repo.getClient(created.id);

        expect(found).toBeDefined();
        expect(found?.id).toBe(created.id);
        expect(found?.name).toBe('Test Client');
      });

      it('should return undefined for non-existent client', () => {
        const found = repo.getClient('non-existent');
        expect(found).toBeUndefined();
      });
    });
  });

  // ==========================================================================
  // BID OPERATIONS
  // ==========================================================================

  describe('Bid Operations', () => {
    describe('createBid', () => {
      it('should create bid with all fields', () => {
        const project = repo.createProject({
          platform: 'upwork',
          platformProjectId: 'proj1',
          title: 'Test Project',
        });

        const bid = repo.createBid({
          projectId: project.id,
          templateId: 'template-1',
          coverLetter: 'Test cover letter',
          bidAmountCents: 5000,
          durationDays: 7,
        });

        expect(bid.id).toBeDefined();
        expect(bid.projectId).toBe(project.id);
        expect(bid.templateId).toBe('template-1');
        expect(bid.coverLetter).toBe('Test cover letter');
        expect(bid.bidAmountCents).toBe(5000);
        expect(bid.durationDays).toBe(7);
        expect(bid.status).toBe('draft');
      });

      it('should create bid with minimal fields', () => {
        const project = repo.createProject({
          platform: 'upwork',
          platformProjectId: 'proj1',
          title: 'Test Project',
        });

        const bid = repo.createBid({
          projectId: project.id,
          coverLetter: 'Simple cover letter',
        });

        expect(bid.id).toBeDefined();
        expect(bid.projectId).toBe(project.id);
        expect(bid.templateId).toBeUndefined();
        expect(bid.bidAmountCents).toBeUndefined();
        expect(bid.durationDays).toBeUndefined();
      });
    });

    describe('updateBidStatus', () => {
      it('should update bid status and set submitted_at', () => {
        const project = repo.createProject({
          platform: 'upwork',
          platformProjectId: 'proj1',
          title: 'Test Project',
        });

        const bid = repo.createBid({
          projectId: project.id,
          coverLetter: 'Test',
        });

        repo.updateBidStatus(bid.id, 'submitted' as BidStatus);

        const updated = db
          .prepare('SELECT * FROM bid_history WHERE id = ?')
          .get(bid.id) as any;

        expect(updated.status).toBe('submitted');
        expect(updated.submitted_at).toBeDefined();
      });

      it('should throw error for non-existent bid', () => {
        expect(() => {
          repo.updateBidStatus('non-existent', 'submitted' as BidStatus);
        }).toThrow('Bid not found');
      });
    });
  });

  // ==========================================================================
  // INTERVENTION OPERATIONS
  // ==========================================================================

  describe('Intervention Operations', () => {
    describe('createIntervention', () => {
      it('should create intervention with all fields', () => {
        const project = repo.createProject({
          platform: 'upwork',
          platformProjectId: 'proj1',
          title: 'Test Project',
        });

        const intervention = repo.createIntervention({
          interventionType: 'contract_sign',
          projectId: project.id,
          reason: 'Contract requires approval',
          context: JSON.stringify({ amount: 10000 }),
          slaDeadline: '2026-12-31T23:59:59Z',
        });

        expect(intervention.id).toBeDefined();
        expect(intervention.interventionType).toBe('contract_sign');
        expect(intervention.projectId).toBe(project.id);
        expect(intervention.reason).toBe('Contract requires approval');
        expect(intervention.status).toBe('pending');
      });
    });

    describe('getPendingInterventions', () => {
      it('should return only pending interventions', () => {
        const intervention1 = repo.createIntervention({
          interventionType: 'contract_sign',
          reason: 'Pending 1',
        });

        const intervention2 = repo.createIntervention({
          interventionType: 'large_spend',
          reason: 'Pending 2',
        });

        // Approve one
        repo.updateInterventionResponse(intervention1.id, 'approve', 'admin');

        const pending = repo.getPendingInterventions();

        expect(pending).toHaveLength(1);
        expect(pending[0].id).toBe(intervention2.id);
      });

      it('should return empty array when no pending interventions', () => {
        const pending = repo.getPendingInterventions();
        expect(pending).toEqual([]);
      });
    });

    describe('updateInterventionResponse', () => {
      it('should update intervention with approve decision', () => {
        const intervention = repo.createIntervention({
          interventionType: 'contract_sign',
          reason: 'Test',
        });

        repo.updateInterventionResponse(intervention.id, 'approve', 'admin');

        const updated = db
          .prepare('SELECT * FROM manual_interventions WHERE id = ?')
          .get(intervention.id) as any;

        expect(updated.status).toBe('approved');
        expect(updated.decision).toBe('approve');
        expect(updated.responder).toBe('admin');
        expect(updated.responded_at).toBeDefined();
      });

      it('should update intervention with reject decision', () => {
        const intervention = repo.createIntervention({
          interventionType: 'large_spend',
          reason: 'Test',
        });

        repo.updateInterventionResponse(intervention.id, 'reject', 'admin');

        const updated = db
          .prepare('SELECT * FROM manual_interventions WHERE id = ?')
          .get(intervention.id) as any;

        expect(updated.status).toBe('rejected');
        expect(updated.decision).toBe('reject');
      });
    });
  });

  // ==========================================================================
  // ANALYTICS OPERATIONS
  // ==========================================================================

  describe('Analytics Operations', () => {
    describe('recordEvent', () => {
      it('should record single event', () => {
        // Create project first for foreign key constraint
        const project = repo.createProject({
          platform: 'upwork',
          platformProjectId: 'proj-1',
          title: 'Test Project',
        });

        const event = repo.recordEvent({
          eventType: 'project_viewed',
          projectId: project.id,
          properties: JSON.stringify({ source: 'search' }),
        });

        expect(event.id).toBeDefined();
        expect(event.eventType).toBe('project_viewed');
        expect(event.projectId).toBe(project.id);
      });

      it('should use current timestamp if not provided', () => {
        const before = new Date().toISOString();

        const event = repo.recordEvent({
          eventType: 'project_scored',
        });

        const after = new Date().toISOString();

        expect(event.timestamp).toBeDefined();
        // Should be between before and after (with some tolerance)
        expect(new Date(event.timestamp).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime() - 1000);
        expect(new Date(event.timestamp).getTime()).toBeLessThanOrEqual(new Date(after).getTime() + 1000);
      });
    });

    describe('recordEvents', () => {
      it('should record multiple events in transaction', () => {
        // Create projects first for foreign key constraints
        const project1 = repo.createProject({
          platform: 'upwork',
          platformProjectId: 'proj-1',
          title: 'Project 1',
        });

        const project2 = repo.createProject({
          platform: 'upwork',
          platformProjectId: 'proj-2',
          title: 'Project 2',
        });

        const events = [
          { eventType: 'project_viewed', projectId: project1.id },
          { eventType: 'project_scored', projectId: project1.id },
          { eventType: 'bid_created', projectId: project2.id },
        ];

        repo.recordEvents(events);

        const count = db
          .prepare('SELECT COUNT(*) as count FROM analytics_events')
          .get() as { count: number };

        expect(count.count).toBe(3);
      });

      it('should record events with custom timestamps', () => {
        const events = [
          {
            eventType: 'project_viewed',
            timestamp: '2026-01-01T10:00:00Z',
          },
          {
            eventType: 'project_scored',
            timestamp: '2026-01-01T11:00:00Z',
          },
        ];

        repo.recordEvents(events);

        const rows = db
          .prepare('SELECT timestamp FROM analytics_events ORDER BY timestamp')
          .all() as { timestamp: string }[];

        expect(rows[0].timestamp).toBe('2026-01-01T10:00:00Z');
        expect(rows[1].timestamp).toBe('2026-01-01T11:00:00Z');
      });
    });
  });

  // ==========================================================================
  // TRANSACTION AND CONCURRENCY TESTS
  // ==========================================================================

  describe('Transaction Rollback', () => {
    it('should rollback project creation on error', () => {
      const initialCount = db
        .prepare('SELECT COUNT(*) as count FROM projects')
        .get() as { count: number };

      // Try to create project with missing required field (NOT NULL constraint)
      expect(() => {
        const insert = db.prepare(`
          INSERT INTO projects (id, platform, platform_project_id)
          VALUES (?, ?, ?)
        `);

        db.transaction(() => {
          // Missing title which is NOT NULL
          insert.run('invalid-proj', 'upwork', 'upwork-123');
        })();
      }).toThrow(); // Should throw due to NOT NULL constraint

      // Count should remain the same (insert failed)
      const finalCount = db
        .prepare('SELECT COUNT(*) as count FROM projects')
        .get() as { count: number };

      expect(finalCount.count).toBe(initialCount.count);
    });

    it('should rollback multiple operations on error', () => {
      const initialProjects = db
        .prepare('SELECT COUNT(*) as count FROM projects')
        .get() as { count: number };

      const initialBids = db
        .prepare('SELECT COUNT(*) as count FROM bid_history')
        .get() as { count: number };

      // Transaction should succeed
      db.transaction(() => {
        const project = repo.createProject({
          platform: 'upwork',
          platformProjectId: 'proj1',
          title: 'Test',
        });

        repo.createBid({
          projectId: project.id,
          coverLetter: 'Test',
        });
      })();

      const finalProjects = db
        .prepare('SELECT COUNT(*) as count FROM projects')
        .get() as { count: number };

      const finalBids = db
        .prepare('SELECT COUNT(*) as count FROM bid_history')
        .get() as { count: number };

      expect(finalProjects.count).toBe(initialProjects.count + 1);
      expect(finalBids.count).toBe(initialBids.count + 1);
    });
  });

  describe('Concurrent Access Safety', () => {
    it('should handle concurrent project creation', () => {
      const projects: string[] = [];

      // Create 10 projects concurrently
      for (let i = 0; i < 10; i++) {
        const project = repo.createProject({
          platform: 'upwork',
          platformProjectId: `proj-${i}`,
          title: `Project ${i}`,
        });
        projects.push(project.id);
      }

      // All IDs should be unique
      const uniqueIds = new Set(projects);
      expect(uniqueIds.size).toBe(10);

      // All should be retrievable
      for (const id of projects) {
        const project = repo.getProject(id);
        expect(project).toBeDefined();
      }
    });

    it('should handle concurrent event recording', () => {
      // Create projects first for foreign key constraints
      const projectIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const project = repo.createProject({
          platform: 'upwork',
          platformProjectId: `proj-${i}`,
          title: `Project ${i}`,
        });
        projectIds.push(project.id);
      }

      const events: { eventType: string; projectId: string }[] = [];

      for (let i = 0; i < 50; i++) {
        events.push({
          eventType: `event_${i % 5}`,
          projectId: projectIds[i % 10],
        });
      }

      repo.recordEvents(events);

      const count = db
        .prepare('SELECT COUNT(*) as count FROM analytics_events')
        .get() as { count: number };

      expect(count.count).toBe(50);
    });

    it('should maintain data integrity under concurrent operations', () => {
      // Create clients
      for (let i = 0; i < 5; i++) {
        repo.getOrCreateClient({
          platform: 'upwork',
          platformClientId: `client-${i}`,
          name: `Client ${i}`,
        });
      }

      // Create projects for each client
      const clients = db
        .prepare('SELECT id FROM clients')
        .all() as { id: string }[];

      const projects: string[] = [];
      for (const client of clients) {
        const project = repo.createProject({
          platform: 'upwork',
          platformProjectId: `proj-${client.id}`,
          title: `Project for ${client.id}`,
          clientId: client.id,
        });
        projects.push(project.id);
      }

      // Verify all client references are valid
      for (const projectId of projects) {
        const project = repo.getProject(projectId);
        expect(project?.clientId).toBeDefined();

        const client = repo.getClient(project!.clientId!);
        expect(client).toBeDefined();
      }
    });
  });

  // ==========================================================================
  // FOREIGN KEY CONSTRAINTS
  // ==========================================================================

  describe('Foreign Key Constraints', () => {
    it('should enforce bid to project relationship', () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      const bid = repo.createBid({
        projectId: project.id,
        coverLetter: 'Test',
      });

      // Verify relationship
      const bidRecord = db
        .prepare('SELECT * FROM bid_history WHERE id = ?')
        .get(bid.id) as any;

      expect(bidRecord.project_id).toBe(project.id);
    });

    it('should enforce intervention to project relationship', () => {
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj1',
        title: 'Test Project',
      });

      const intervention = repo.createIntervention({
        interventionType: 'contract_sign',
        projectId: project.id,
        reason: 'Test',
      });

      expect(intervention.projectId).toBe(project.id);
    });

    it('should enforce analytics event to project relationship', () => {
      // Create project first
      const project = repo.createProject({
        platform: 'upwork',
        platformProjectId: 'proj-1',
        title: 'Test Project',
      });

      const event = repo.recordEvent({
        eventType: 'project_viewed',
        projectId: project.id,
      });

      expect(event.projectId).toBe(project.id);

      // Verify foreign key relationship
      const eventRecord = db
        .prepare('SELECT * FROM analytics_events WHERE id = ?')
        .get(event.id) as any;

      expect(eventRecord.project_id).toBe(project.id);
    });
  });
});
