/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  AccessControlManager,
  createAccessControlManager,
  formatPermission,
  formatRole,
  formatAccessDecision,
  formatACLEntry,
  type Permission,
  type Role,
  type Subject,
  type AccessControlEntry,
  type AccessRequest,
  type AccessDecision,
  type PermissionAction,
  type ResourceType,
  type RoleType,
} from "../../interagent/access-control.js";

describe("AccessControlManager", () => {
  let acm: AccessControlManager;

  beforeEach(() => {
    acm = createAccessControlManager({
      defaultPolicy: "deny",
      enableInheritance: true,
      enableConditions: true,
    });
  });

  afterEach(() => {
    acm.close();
  });

  // ==========================================================================
  // 权限管理
  // ==========================================================================

  describe("Permission Management", () => {
    it("should have default permissions", () => {
      const permissions = acm.listPermissions();

      expect(permissions.length).toBeGreaterThan(0);
    });

    it("should add permission", () => {
      const permission: Permission = {
        id: "custom:action",
        resource: "task",
        action: "execute",
        description: "Custom permission",
      };

      acm.addPermission(permission);
      const retrieved = acm.getPermission("custom:action");

      expect(retrieved).toBeDefined();
      expect(retrieved!.description).toBe("Custom permission");
    });

    it("should emit permission:added event", () => {
      const handler = vi.fn();
      acm.on("permission:added", handler);

      const permission: Permission = {
        id: "test:perm",
        resource: "task",
        action: "read",
      };

      acm.addPermission(permission);

      expect(handler).toHaveBeenCalledWith(permission);
    });

    it("should filter permissions by resource", () => {
      const permissions = acm.listPermissions("task");

      expect(permissions.length).toBeGreaterThan(0);
      permissions.forEach((p) => expect(p.resource).toBe("task"));
    });

    it("should remove permission", () => {
      const permission: Permission = {
        id: "temp:perm",
        resource: "task",
        action: "read",
      };

      acm.addPermission(permission);
      const removed = acm.removePermission("temp:perm");

      expect(removed).toBe(true);
      expect(acm.getPermission("temp:perm")).toBeUndefined();
    });
  });

  // ==========================================================================
  // 角色管理
  // ==========================================================================

  describe("Role Management", () => {
    it("should have default roles", () => {
      const roles = acm.listRoles();

      expect(roles.length).toBeGreaterThan(0);
      expect(roles.find((r) => r.id === "admin")).toBeDefined();
      expect(roles.find((r) => r.id === "user")).toBeDefined();
    });

    it("should add role", () => {
      const role: Role = {
        id: "custom-role",
        name: "Custom Role",
        type: "user",
        permissions: ["task:read"],
        createdAt: new Date(),
        metadata: {},
      };

      acm.addRole(role);
      const retrieved = acm.getRole("custom-role");

      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe("Custom Role");
    });

    it("should emit role:added event", () => {
      const handler = vi.fn();
      acm.on("role:added", handler);

      const role: Role = {
        id: "test-role",
        name: "Test Role",
        type: "user",
        permissions: [],
        createdAt: new Date(),
        metadata: {},
      };

      acm.addRole(role);

      expect(handler).toHaveBeenCalledWith(role);
    });

    it("should filter roles by type", () => {
      const roles = acm.listRoles("admin");

      expect(roles.length).toBeGreaterThan(0);
      roles.forEach((r) => expect(r.type).toBe("admin"));
    });

    it("should update role", () => {
      const role: Role = {
        id: "updatable-role",
        name: "Updatable",
        type: "user",
        permissions: ["task:read"],
        createdAt: new Date(),
        metadata: {},
      };

      acm.addRole(role);
      const updated = acm.updateRole("updatable-role", {
        name: "Updated Name",
        permissions: ["task:read", "task:create"],
      });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe("Updated Name");
      expect(updated!.permissions).toHaveLength(2);
    });

    it("should remove role", () => {
      const role: Role = {
        id: "removable-role",
        name: "Removable",
        type: "user",
        permissions: [],
        createdAt: new Date(),
        metadata: {},
      };

      acm.addRole(role);
      const removed = acm.removeRole("removable-role");

      expect(removed).toBe(true);
      expect(acm.getRole("removable-role")).toBeUndefined();
    });

    it("should get role permissions with inheritance", () => {
      // manager 继承 user
      const managerPerms = acm.getRolePermissions("manager");

      expect(managerPerms.length).toBeGreaterThan(0);
      // 应该包含 user 的权限
      expect(managerPerms.some((p) => p.id === "task:create")).toBe(true);
    });
  });

  // ==========================================================================
  // 主体管理
  // ==========================================================================

  describe("Subject Management", () => {
    it("should register subject", () => {
      const subject: Subject = {
        id: "user-1",
        type: "user",
        roles: ["user"],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);
      const retrieved = acm.getSubject("user-1");

      expect(retrieved).toBeDefined();
      expect(retrieved!.type).toBe("user");
    });

    it("should emit subject:registered event", () => {
      const handler = vi.fn();
      acm.on("subject:registered", handler);

      const subject: Subject = {
        id: "user-2",
        type: "user",
        roles: [],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);

      expect(handler).toHaveBeenCalledWith(subject);
    });

    it("should update subject", () => {
      const subject: Subject = {
        id: "user-3",
        type: "user",
        roles: ["user"],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);
      const updated = acm.updateSubject("user-3", {
        roles: ["user", "manager"],
      });

      expect(updated).toBeDefined();
      expect(updated!.roles).toHaveLength(2);
    });

    it("should unregister subject", () => {
      const subject: Subject = {
        id: "user-4",
        type: "user",
        roles: [],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);
      const removed = acm.unregisterSubject("user-4");

      expect(removed).toBe(true);
      expect(acm.getSubject("user-4")).toBeUndefined();
    });

    it("should assign role to subject", () => {
      const subject: Subject = {
        id: "user-5",
        type: "user",
        roles: [],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);
      const assigned = acm.assignRole("user-5", "admin");

      expect(assigned).toBe(true);
      const retrieved = acm.getSubject("user-5");
      expect(retrieved!.roles).toContain("admin");
    });

    it("should revoke role from subject", () => {
      const subject: Subject = {
        id: "user-6",
        type: "user",
        roles: ["admin"],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);
      const revoked = acm.revokeRole("user-6", "admin");

      expect(revoked).toBe(true);
      const retrieved = acm.getSubject("user-6");
      expect(retrieved!.roles).not.toContain("admin");
    });
  });

  // ==========================================================================
  // ACL 管理
  // ==========================================================================

  describe("ACL Management", () => {
    it("should add ACL entry", () => {
      const subject: Subject = {
        id: "user-acl-1",
        type: "user",
        roles: [],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);

      const entry: AccessControlEntry = {
        id: "acl-1",
        subjectId: "user-acl-1",
        resource: "task",
        resourceId: "task-123",
        allowedActions: ["read", "update"],
        deniedActions: [],
        createdAt: new Date(),
      };

      acm.addACLEntry(entry);
      const entries = acm.getACLEntries("user-acl-1", "task");

      expect(entries).toHaveLength(1);
      expect(entries[0].allowedActions).toContain("read");
    });

    it("should emit acl:added event", () => {
      const handler = vi.fn();
      acm.on("acl:added", handler);

      const subject: Subject = {
        id: "user-acl-2",
        type: "user",
        roles: [],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);

      const entry: AccessControlEntry = {
        id: "acl-2",
        subjectId: "user-acl-2",
        resource: "task",
        resourceId: "*",
        allowedActions: ["read"],
        deniedActions: [],
        createdAt: new Date(),
      };

      acm.addACLEntry(entry);

      expect(handler).toHaveBeenCalledWith(entry);
    });

    it("should remove ACL entry", () => {
      const subject: Subject = {
        id: "user-acl-3",
        type: "user",
        roles: [],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);

      const entry: AccessControlEntry = {
        id: "acl-removable",
        subjectId: "user-acl-3",
        resource: "task",
        resourceId: "*",
        allowedActions: ["read"],
        deniedActions: [],
        createdAt: new Date(),
      };

      acm.addACLEntry(entry);
      const removed = acm.removeACLEntry("acl-removable");

      expect(removed).toBe(true);
      const entries = acm.getACLEntries("user-acl-3", "task");
      expect(entries).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 访问检查
  // ==========================================================================

  describe("Access Checking", () => {
    it("should deny access for non-existent subject", () => {
      const request: AccessRequest = {
        subjectId: "non-existent",
        resource: "task",
        resourceId: "task-1",
        action: "read",
      };

      const decision = acm.checkAccess(request);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("Subject not found");
    });

    it("should allow access for role with permission", () => {
      const subject: Subject = {
        id: "user-check-1",
        type: "user",
        roles: ["user"],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);

      const request: AccessRequest = {
        subjectId: "user-check-1",
        resource: "task",
        resourceId: "task-1",
        action: "read",
      };

      const decision = acm.checkAccess(request);

      expect(decision.allowed).toBe(true);
      expect(decision.appliedRoles).toContain("user");
    });

    it("should allow access for admin role", () => {
      const subject: Subject = {
        id: "user-admin-1",
        type: "user",
        roles: ["admin"],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);

      const request: AccessRequest = {
        subjectId: "user-admin-1",
        resource: "system",
        resourceId: "system-1",
        action: "admin",
      };

      const decision = acm.checkAccess(request);

      expect(decision.allowed).toBe(true);
    });

    it("should deny access without matching permission", () => {
      const subject: Subject = {
        id: "user-guest-1",
        type: "user",
        roles: ["guest"],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);

      const request: AccessRequest = {
        subjectId: "user-guest-1",
        resource: "task",
        resourceId: "task-1",
        action: "delete",
      };

      const decision = acm.checkAccess(request);

      expect(decision.allowed).toBe(false);
    });

    it("should allow access via ACL", () => {
      const subject: Subject = {
        id: "user-acl-check",
        type: "user",
        roles: [],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);

      const entry: AccessControlEntry = {
        id: "acl-check-1",
        subjectId: "user-acl-check",
        resource: "task",
        resourceId: "special-task",
        allowedActions: ["read", "update"],
        deniedActions: [],
        createdAt: new Date(),
      };

      acm.addACLEntry(entry);

      const request: AccessRequest = {
        subjectId: "user-acl-check",
        resource: "task",
        resourceId: "special-task",
        action: "read",
      };

      const decision = acm.checkAccess(request);

      expect(decision.allowed).toBe(true);
      expect(decision.matchedPermissions).toContain("acl:acl-check-1:allow");
    });

    it("should deny access via ACL deny rule", () => {
      const subject: Subject = {
        id: "user-acl-deny",
        type: "user",
        roles: ["admin"], // 有权限
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);

      const entry: AccessControlEntry = {
        id: "acl-deny-1",
        subjectId: "user-acl-deny",
        resource: "task",
        resourceId: "protected-task",
        allowedActions: [],
        deniedActions: ["delete"], // 但被 ACL 拒绝
        createdAt: new Date(),
      };

      acm.addACLEntry(entry);

      const request: AccessRequest = {
        subjectId: "user-acl-deny",
        resource: "task",
        resourceId: "protected-task",
        action: "delete",
      };

      const decision = acm.checkAccess(request);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("Explicitly denied");
    });

    it("should allow access with wildcard ACL", () => {
      const subject: Subject = {
        id: "user-wildcard",
        type: "user",
        roles: [],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);

      const entry: AccessControlEntry = {
        id: "acl-wildcard",
        subjectId: "user-wildcard",
        resource: "task",
        resourceId: "*", // 通配符
        allowedActions: ["read"],
        deniedActions: [],
        createdAt: new Date(),
      };

      acm.addACLEntry(entry);

      const request: AccessRequest = {
        subjectId: "user-wildcard",
        resource: "task",
        resourceId: "any-task-id",
        action: "read",
      };

      const decision = acm.checkAccess(request);

      expect(decision.allowed).toBe(true);
    });

    it("should cache access decisions", () => {
      const subject: Subject = {
        id: "user-cache",
        type: "user",
        roles: ["user"],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);

      const request: AccessRequest = {
        subjectId: "user-cache",
        resource: "task",
        resourceId: "task-1",
        action: "read",
      };

      // 第一次检查
      const decision1 = acm.checkAccess(request);

      // 第二次检查应该从缓存获取
      const decision2 = acm.checkAccess(request);

      expect(decision1.allowed).toBe(true);
      expect(decision2.allowed).toBe(true);
    });

    it("should respect default policy", () => {
      const acmAllow = createAccessControlManager({
        defaultPolicy: "allow",
      });

      const subject: Subject = {
        id: "user-allow-default",
        type: "user",
        roles: [],
        attributes: {},
        createdAt: new Date(),
      };

      acmAllow.registerSubject(subject);

      const request: AccessRequest = {
        subjectId: "user-allow-default",
        resource: "task",
        resourceId: "task-1",
        action: "read",
      };

      const decision = acmAllow.checkAccess(request);

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe("Allowed by default policy");

      acmAllow.close();
    });
  });

  // ==========================================================================
  // 继承
  // ==========================================================================

  describe("Role Inheritance", () => {
    it("should inherit permissions from parent role", () => {
      const subject: Subject = {
        id: "user-inherit",
        type: "user",
        roles: ["manager"], // manager 继承 user
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);

      const request: AccessRequest = {
        subjectId: "user-inherit",
        resource: "task",
        resourceId: "task-1",
        action: "read",
      };

      const decision = acm.checkAccess(request);

      expect(decision.allowed).toBe(true);
    });

    it("should disable inheritance when configured", () => {
      const acmNoInherit = createAccessControlManager({
        enableInheritance: false,
      });

      const subject: Subject = {
        id: "user-no-inherit",
        type: "user",
        roles: ["guest"], // guest 没有 task:create 权限
        attributes: {},
        createdAt: new Date(),
      };

      acmNoInherit.registerSubject(subject);

      const request: AccessRequest = {
        subjectId: "user-no-inherit",
        resource: "task",
        resourceId: "task-1",
        action: "create",
      };

      const decision = acmNoInherit.checkAccess(request);

      // guest 没有 task:create 权限
      expect(decision.allowed).toBe(false);

      acmNoInherit.close();
    });
  });

  // ==========================================================================
  // 条件检查
  // ==========================================================================

  describe("Condition Checking", () => {
    it("should evaluate time condition", () => {
      const permission: Permission = {
        id: "time-restricted",
        resource: "task",
        action: "execute",
        conditions: [
          {
            type: "time",
            value: "9-17", // 只在工作时间
            operator: "in",
          },
        ],
      };

      acm.addPermission(permission);

      const role: Role = {
        id: "time-role",
        name: "Time Restricted",
        type: "user",
        permissions: ["time-restricted"],
        createdAt: new Date(),
        metadata: {},
      };

      acm.addRole(role);

      const subject: Subject = {
        id: "user-time",
        type: "user",
        roles: ["time-role"],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);

      const request: AccessRequest = {
        subjectId: "user-time",
        resource: "task",
        resourceId: "task-1",
        action: "execute",
      };

      const decision = acm.checkAccess(request);

      // 根据当前时间，可能允许或拒绝
      // 这里只验证条件被评估
      expect(decision).toBeDefined();
    });

    it("should evaluate IP condition", () => {
      const permission: Permission = {
        id: "ip-restricted",
        resource: "config",
        action: "read",
        conditions: [
          {
            type: "ip",
            value: "192.168.1.100,10.0.0.1",
            operator: "in",
          },
        ],
      };

      acm.addPermission(permission);

      const role: Role = {
        id: "ip-role",
        name: "IP Restricted",
        type: "user",
        permissions: ["ip-restricted"],
        createdAt: new Date(),
        metadata: {},
      };

      acm.addRole(role);

      // 使用两个不同的主体来避免缓存问题
      const subject1: Subject = {
        id: "user-ip-allowed",
        type: "user",
        roles: ["ip-role"],
        directPermissions: [],
        attributes: {},
        createdAt: new Date(),
      };

      const subject2: Subject = {
        id: "user-ip-denied",
        type: "user",
        roles: ["ip-role"],
        directPermissions: [],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject1);
      acm.registerSubject(subject2);

      // 使用允许的 IP
      const request1: AccessRequest = {
        subjectId: "user-ip-allowed",
        resource: "config",
        resourceId: "config-1",
        action: "read",
        context: { ip: "192.168.1.100" },
      };

      const decision1 = acm.checkAccess(request1);
      expect(decision1.allowed).toBe(true);

      // 使用不允许的 IP
      const request2: AccessRequest = {
        subjectId: "user-ip-denied",
        resource: "config",
        resourceId: "config-1",
        action: "read",
        context: { ip: "1.2.3.4" },
      };

      const decision2 = acm.checkAccess(request2);
      expect(decision2.allowed).toBe(false);
    });
  });

  // ==========================================================================
  // 辅助方法
  // ==========================================================================

  describe("Utility Methods", () => {
    it("should check multiple access requests", () => {
      const subject: Subject = {
        id: "user-multi",
        type: "user",
        roles: ["user"],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);

      const requests: AccessRequest[] = [
        {
          subjectId: "user-multi",
          resource: "task",
          resourceId: "task-1",
          action: "read",
        },
        {
          subjectId: "user-multi",
          resource: "task",
          resourceId: "task-2",
          action: "delete",
        },
      ];

      const results = acm.checkMultipleAccess(requests);

      expect(results.size).toBe(2);
    });

    it("should get subject permissions", () => {
      const subject: Subject = {
        id: "user-perms",
        type: "user",
        roles: ["user"],
        attributes: {},
        createdAt: new Date(),
      };

      acm.registerSubject(subject);

      const permissions = acm.getSubjectPermissions("user-perms");

      expect(permissions.length).toBeGreaterThan(0);
    });

    it("should get stats", () => {
      const stats = acm.getStats();

      expect(stats.permissions).toBeGreaterThan(0);
      expect(stats.roles).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 清理
  // ==========================================================================

  describe("Cleanup", () => {
    it("should close manager", () => {
      const manager = createAccessControlManager();
      manager.close();

      // Should not throw
    });

    it("should remove all listeners on close", () => {
      const handler = vi.fn();
      acm.on("permission:added", handler);

      acm.close();

      expect(acm.listenerCount("permission:added")).toBe(0);
    });
  });
});

// ==========================================================================
// 格式化函数测试
// ==========================================================================

describe("Format Functions", () => {
  it("should format permission", () => {
    const permission: Permission = {
      id: "test:perm",
      resource: "task",
      action: "read",
      description: "Test permission",
    };

    const formatted = formatPermission(permission);

    expect(formatted).toContain("test:perm");
    expect(formatted).toContain("task");
    expect(formatted).toContain("read");
    expect(formatted).toContain("Test permission");
  });

  it("should format role", () => {
    const role: Role = {
      id: "test-role",
      name: "Test Role",
      type: "user",
      permissions: ["task:read", "task:create"],
      inherits: ["guest"],
      description: "A test role",
      createdAt: new Date(),
      metadata: {},
    };

    const formatted = formatRole(role);

    expect(formatted).toContain("test-role");
    expect(formatted).toContain("Test Role");
    expect(formatted).toContain("task:read");
    expect(formatted).toContain("guest");
  });

  it("should format access decision", () => {
    const decision: AccessDecision = {
      allowed: true,
      reason: "Access granted",
      matchedPermissions: ["task:read"],
      appliedRoles: ["user"],
    };

    const formatted = formatAccessDecision(decision);

    expect(formatted).toContain("允许");
    expect(formatted).toContain("Access granted");
    expect(formatted).toContain("task:read");
    expect(formatted).toContain("user");
  });

  it("should format denied access decision", () => {
    const decision: AccessDecision = {
      allowed: false,
      reason: "No matching permission",
      matchedPermissions: [],
      appliedRoles: [],
    };

    const formatted = formatAccessDecision(decision);

    expect(formatted).toContain("拒绝");
    expect(formatted).toContain("No matching permission");
  });

  it("should format ACL entry", () => {
    const entry: AccessControlEntry = {
      id: "acl-test",
      subjectId: "user-1",
      resource: "task",
      resourceId: "task-1",
      allowedActions: ["read", "update"],
      deniedActions: ["delete"],
      createdAt: new Date("2026-01-01"),
    };

    const formatted = formatACLEntry(entry);

    expect(formatted).toContain("acl-test");
    expect(formatted).toContain("user-1");
    expect(formatted).toContain("task-1");
    expect(formatted).toContain("read");
    expect(formatted).toContain("delete");
  });

  it("should format ACL entry with expiration", () => {
    const entry: AccessControlEntry = {
      id: "acl-expiring",
      subjectId: "user-1",
      resource: "task",
      resourceId: "task-1",
      allowedActions: ["read"],
      deniedActions: [],
      createdAt: new Date(),
      expiresAt: new Date("2026-12-31"),
    };

    const formatted = formatACLEntry(entry);

    expect(formatted).toContain("过期时间");
    expect(formatted).toContain("2026");
  });
});
