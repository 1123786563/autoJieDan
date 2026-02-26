/**
 * 访问控制管理
 * 提供基于角色的访问控制 (RBAC) 和访问控制列表 (ACL)
 *
 * @module interagent/access-control
 * @version 1.0.0
 */

import { EventEmitter } from "events";

// ============================================================================
// 类型定义
// ============================================================================

/** 权限操作 */
export type PermissionAction = "create" | "read" | "update" | "delete" | "execute" | "admin";

/** 资源类型 */
export type ResourceType = "task" | "message" | "file" | "config" | "key" | "certificate" | "system";

/** 角色类型 */
export type RoleType = "admin" | "manager" | "user" | "guest" | "service" | "agent";

/** 权限 */
export interface Permission {
  /** 权限 ID */
  id: string;
  /** 资源类型 */
  resource: ResourceType;
  /** 操作 */
  action: PermissionAction;
  /** 资源模式 (支持通配符) */
  resourcePattern?: string;
  /** 条件 */
  conditions?: PermissionCondition[];
  /** 描述 */
  description?: string;
}

/** 权限条件 */
export interface PermissionCondition {
  /** 条件类型 */
  type: "time" | "ip" | "attribute" | "custom";
  /** 条件值 */
  value: string | Record<string, unknown>;
  /** 运算符 */
  operator: "eq" | "ne" | "gt" | "lt" | "in" | "contains";
}

/** 角色 */
export interface Role {
  /** 角色 ID */
  id: string;
  /** 角色名称 */
  name: string;
  /** 角色类型 */
  type: RoleType;
  /** 权限列表 */
  permissions: string[];
  /** 父角色 (继承) */
  inherits?: string[];
  /** 描述 */
  description?: string;
  /** 创建时间 */
  createdAt: Date;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/** 用户/主体 */
export interface Subject {
  /** 主体 ID */
  id: string;
  /** 主体类型 */
  type: "user" | "service" | "agent";
  /** 角色列表 */
  roles: string[];
  /** 直接权限 */
  directPermissions?: string[];
  /** 属性 */
  attributes: Record<string, unknown>;
  /** 创建时间 */
  createdAt: Date;
}

/** 访问控制条目 */
export interface AccessControlEntry {
  /** 条目 ID */
  id: string;
  /** 主体 ID */
  subjectId: string;
  /** 资源类型 */
  resource: ResourceType;
  /** 资源 ID */
  resourceId: string;
  /** 允许的操作 */
  allowedActions: PermissionAction[];
  /** 拒绝的操作 */
  deniedActions: PermissionAction[];
  /** 创建时间 */
  createdAt: Date;
  /** 过期时间 */
  expiresAt?: Date;
}

/** 访问请求 */
export interface AccessRequest {
  /** 主体 ID */
  subjectId: string;
  /** 资源类型 */
  resource: ResourceType;
  /** 资源 ID */
  resourceId: string;
  /** 请求的操作 */
  action: PermissionAction;
  /** 上下文 */
  context?: Record<string, unknown>;
}

/** 访问决策 */
export interface AccessDecision {
  /** 是否允许 */
  allowed: boolean;
  /** 原因 */
  reason: string;
  /** 匹配的权限 */
  matchedPermissions: string[];
  /** 应用的角色 */
  appliedRoles: string[];
}

/** 访问控制配置 */
export interface AccessControlConfig {
  /** 默认策略: allow 或 deny */
  defaultPolicy: "allow" | "deny";
  /** 是否启用继承 */
  enableInheritance: boolean;
  /** 是否启用条件检查 */
  enableConditions: boolean;
  /** 缓存 TTL (毫秒) */
  cacheTtl: number;
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_ACCESS_CONTROL_CONFIG: AccessControlConfig = {
  defaultPolicy: "deny",
  enableInheritance: true,
  enableConditions: true,
  cacheTtl: 60000, // 1 minute
};

// ============================================================================
// 默认角色和权限
// ============================================================================

const DEFAULT_PERMISSIONS: Permission[] = [
  // Task permissions
  { id: "task:create", resource: "task", action: "create", description: "创建任务" },
  { id: "task:read", resource: "task", action: "read", description: "读取任务" },
  { id: "task:update", resource: "task", action: "update", description: "更新任务" },
  { id: "task:delete", resource: "task", action: "delete", description: "删除任务" },
  { id: "task:execute", resource: "task", action: "execute", description: "执行任务" },
  { id: "task:admin", resource: "task", action: "admin", description: "任务管理" },

  // Message permissions
  { id: "message:create", resource: "message", action: "create", description: "创建消息" },
  { id: "message:read", resource: "message", action: "read", description: "读取消息" },
  { id: "message:delete", resource: "message", action: "delete", description: "删除消息" },

  // File permissions
  { id: "file:create", resource: "file", action: "create", description: "创建文件" },
  { id: "file:read", resource: "file", action: "read", description: "读取文件" },
  { id: "file:update", resource: "file", action: "update", description: "更新文件" },
  { id: "file:delete", resource: "file", action: "delete", description: "删除文件" },

  // Config permissions
  { id: "config:read", resource: "config", action: "read", description: "读取配置" },
  { id: "config:update", resource: "config", action: "update", description: "更新配置" },
  { id: "config:admin", resource: "config", action: "admin", description: "配置管理" },

  // Key permissions
  { id: "key:create", resource: "key", action: "create", description: "创建密钥" },
  { id: "key:read", resource: "key", action: "read", description: "读取密钥" },
  { id: "key:delete", resource: "key", action: "delete", description: "删除密钥" },

  // Certificate permissions
  { id: "cert:create", resource: "certificate", action: "create", description: "创建证书" },
  { id: "cert:read", resource: "certificate", action: "read", description: "读取证书" },
  { id: "cert:delete", resource: "certificate", action: "delete", description: "删除证书" },

  // System permissions
  { id: "system:admin", resource: "system", action: "admin", description: "系统管理" },
  { id: "system:execute", resource: "system", action: "execute", description: "系统操作" },
];

const DEFAULT_ROLES: Role[] = [
  {
    id: "admin",
    name: "Administrator",
    type: "admin",
    permissions: ["system:admin", "task:admin", "config:admin", "cert:create", "cert:read", "cert:delete", "key:create", "key:read", "key:delete"],
    description: "系统管理员",
    createdAt: new Date(),
    metadata: {},
  },
  {
    id: "manager",
    name: "Manager",
    type: "manager",
    permissions: ["task:create", "task:read", "task:update", "task:delete", "message:create", "message:read", "file:create", "file:read", "file:update"],
    inherits: ["user"],
    description: "管理者",
    createdAt: new Date(),
    metadata: {},
  },
  {
    id: "user",
    name: "User",
    type: "user",
    permissions: ["task:create", "task:read", "task:update", "message:create", "message:read", "file:read"],
    description: "普通用户",
    createdAt: new Date(),
    metadata: {},
  },
  {
    id: "guest",
    name: "Guest",
    type: "guest",
    permissions: ["task:read", "message:read"],
    description: "访客",
    createdAt: new Date(),
    metadata: {},
  },
  {
    id: "service",
    name: "Service",
    type: "service",
    permissions: ["task:create", "task:read", "task:execute", "message:create", "message:read", "key:read"],
    description: "服务账户",
    createdAt: new Date(),
    metadata: {},
  },
  {
    id: "agent",
    name: "Agent",
    type: "agent",
    permissions: ["task:read", "task:execute", "message:create", "message:read", "file:read", "file:create"],
    description: "代理账户",
    createdAt: new Date(),
    metadata: {},
  },
];

// ============================================================================
// AccessControlManager 类
// ============================================================================

/**
 * 访问控制管理器
 */
export class AccessControlManager extends EventEmitter {
  private config: AccessControlConfig;
  private permissions: Map<string, Permission> = new Map();
  private roles: Map<string, Role> = new Map();
  private subjects: Map<string, Subject> = new Map();
  private acls: Map<string, AccessControlEntry[]> = new Map();
  private decisionCache: Map<string, { decision: AccessDecision; expires: number }> = new Map();

  constructor(config: Partial<AccessControlConfig> = {}) {
    super();
    this.config = { ...DEFAULT_ACCESS_CONTROL_CONFIG, ...config };
    this.initializeDefaults();
  }

  /**
   * 初始化默认权限和角色
   */
  private initializeDefaults(): void {
    for (const permission of DEFAULT_PERMISSIONS) {
      this.permissions.set(permission.id, permission);
    }

    for (const role of DEFAULT_ROLES) {
      this.roles.set(role.id, role);
    }
  }

  // ============================================================================
  // 权限管理
  // ============================================================================

  /**
   * 添加权限
   */
  addPermission(permission: Permission): void {
    this.permissions.set(permission.id, permission);
    this.clearCache();
    this.emit("permission:added", permission);
  }

  /**
   * 获取权限
   */
  getPermission(permissionId: string): Permission | undefined {
    return this.permissions.get(permissionId);
  }

  /**
   * 列出所有权限
   */
  listPermissions(resource?: ResourceType): Permission[] {
    const perms = Array.from(this.permissions.values());
    if (resource) {
      return perms.filter((p) => p.resource === resource);
    }
    return perms;
  }

  /**
   * 删除权限
   */
  removePermission(permissionId: string): boolean {
    const removed = this.permissions.delete(permissionId);
    if (removed) {
      this.clearCache();
      this.emit("permission:removed", permissionId);
    }
    return removed;
  }

  // ============================================================================
  // 角色管理
  // ============================================================================

  /**
   * 添加角色
   */
  addRole(role: Role): void {
    this.roles.set(role.id, role);
    this.clearCache();
    this.emit("role:added", role);
  }

  /**
   * 获取角色
   */
  getRole(roleId: string): Role | undefined {
    return this.roles.get(roleId);
  }

  /**
   * 列出所有角色
   */
  listRoles(type?: RoleType): Role[] {
    const roles = Array.from(this.roles.values());
    if (type) {
      return roles.filter((r) => r.type === type);
    }
    return roles;
  }

  /**
   * 更新角色
   */
  updateRole(roleId: string, updates: Partial<Role>): Role | undefined {
    const role = this.roles.get(roleId);
    if (!role) return undefined;

    const updated = { ...role, ...updates };
    this.roles.set(roleId, updated);
    this.clearCache();
    this.emit("role:updated", updated);

    return updated;
  }

  /**
   * 删除角色
   */
  removeRole(roleId: string): boolean {
    const removed = this.roles.delete(roleId);
    if (removed) {
      this.clearCache();
      this.emit("role:removed", roleId);
    }
    return removed;
  }

  /**
   * 获取角色的所有权限（包括继承）
   */
  getRolePermissions(roleId: string, visited: Set<string> = new Set()): Permission[] {
    const role = this.roles.get(roleId);
    if (!role || visited.has(roleId)) return [];

    visited.add(roleId);
    const perms: Permission[] = [];

    // 添加直接权限
    for (const permId of role.permissions) {
      const perm = this.permissions.get(permId);
      if (perm) perms.push(perm);
    }

    // 添加继承的权限
    if (this.config.enableInheritance && role.inherits) {
      for (const parentRoleId of role.inherits) {
        perms.push(...this.getRolePermissions(parentRoleId, visited));
      }
    }

    return perms;
  }

  // ============================================================================
  // 主体管理
  // ============================================================================

  /**
   * 注册主体
   */
  registerSubject(subject: Subject): void {
    this.subjects.set(subject.id, subject);
    this.emit("subject:registered", subject);
  }

  /**
   * 获取主体
   */
  getSubject(subjectId: string): Subject | undefined {
    return this.subjects.get(subjectId);
  }

  /**
   * 更新主体
   */
  updateSubject(subjectId: string, updates: Partial<Subject>): Subject | undefined {
    const subject = this.subjects.get(subjectId);
    if (!subject) return undefined;

    const updated = { ...subject, ...updates };
    this.subjects.set(subjectId, updated);
    this.clearSubjectCache(subjectId);
    this.emit("subject:updated", updated);

    return updated;
  }

  /**
   * 注销主体
   */
  unregisterSubject(subjectId: string): boolean {
    const removed = this.subjects.delete(subjectId);
    if (removed) {
      this.clearSubjectCache(subjectId);
      this.emit("subject:unregistered", subjectId);
    }
    return removed;
  }

  /**
   * 给主体分配角色
   */
  assignRole(subjectId: string, roleId: string): boolean {
    const subject = this.subjects.get(subjectId);
    const role = this.roles.get(roleId);

    if (!subject || !role) return false;

    if (!subject.roles.includes(roleId)) {
      subject.roles.push(roleId);
      this.clearSubjectCache(subjectId);
      this.emit("role:assigned", { subjectId, roleId });
    }

    return true;
  }

  /**
   * 移除主体角色
   */
  revokeRole(subjectId: string, roleId: string): boolean {
    const subject = this.subjects.get(subjectId);
    if (!subject) return false;

    const index = subject.roles.indexOf(roleId);
    if (index >= 0) {
      subject.roles.splice(index, 1);
      this.clearSubjectCache(subjectId);
      this.emit("role:revoked", { subjectId, roleId });
    }

    return true;
  }

  // ============================================================================
  // ACL 管理
  // ============================================================================

  /**
   * 添加 ACL 条目
   */
  addACLEntry(entry: AccessControlEntry): void {
    const key = `${entry.subjectId}:${entry.resource}`;
    const entries = this.acls.get(key) || [];
    entries.push(entry);
    this.acls.set(key, entries);
    this.clearSubjectCache(entry.subjectId);
    this.emit("acl:added", entry);
  }

  /**
   * 获取 ACL 条目
   */
  getACLEntries(subjectId: string, resource: ResourceType): AccessControlEntry[] {
    const key = `${subjectId}:${resource}`;
    return this.acls.get(key) || [];
  }

  /**
   * 移除 ACL 条目
   */
  removeACLEntry(entryId: string): boolean {
    for (const [key, entries] of this.acls.entries()) {
      const index = entries.findIndex((e) => e.id === entryId);
      if (index >= 0) {
        entries.splice(index, 1);
        this.clearSubjectCache(key.split(":")[0]);
        this.emit("acl:removed", entryId);
        return true;
      }
    }
    return false;
  }

  // ============================================================================
  // 访问检查
  // ============================================================================

  /**
   * 检查访问权限
   */
  checkAccess(request: AccessRequest): AccessDecision {
    // 检查缓存
    const cacheKey = `${request.subjectId}:${request.resource}:${request.resourceId}:${request.action}`;
    const cached = this.decisionCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.decision;
    }

    const subject = this.subjects.get(request.subjectId);
    if (!subject) {
      return this.createDeniedDecision("Subject not found");
    }

    const matchedPermissions: string[] = [];
    const appliedRoles: string[] = [];

    // 1. 检查直接权限
    if (subject.directPermissions) {
      for (const permId of subject.directPermissions) {
        const perm = this.permissions.get(permId);
        if (perm && this.matchesPermission(perm, request)) {
          matchedPermissions.push(permId);
        }
      }
    }

    // 2. 检查角色权限
    for (const roleId of subject.roles) {
      const rolePerms = this.getRolePermissions(roleId);
      for (const perm of rolePerms) {
        if (this.matchesPermission(perm, request)) {
          matchedPermissions.push(perm.id);
          if (!appliedRoles.includes(roleId)) {
            appliedRoles.push(roleId);
          }
        }
      }
    }

    // 3. 检查 ACL
    const aclEntries = this.getACLEntries(request.subjectId, request.resource);
    for (const entry of aclEntries) {
      // 检查过期
      if (entry.expiresAt && entry.expiresAt < new Date()) {
        continue;
      }

      // 检查资源 ID 匹配
      if (entry.resourceId !== "*" && entry.resourceId !== request.resourceId) {
        continue;
      }

      // 检查允许的操作
      if (entry.allowedActions.includes(request.action) || entry.allowedActions.includes("admin" as PermissionAction)) {
        matchedPermissions.push(`acl:${entry.id}:allow`);
      }

      // 检查拒绝的操作
      if (entry.deniedActions.includes(request.action) || entry.deniedActions.includes("admin" as PermissionAction)) {
        const decision = this.createDeniedDecision(
          `Explicitly denied by ACL: ${entry.id}`,
          matchedPermissions,
          appliedRoles
        );
        this.cacheDecision(cacheKey, decision);
        return decision;
      }
    }

    // 4. 做出决策
    if (matchedPermissions.length > 0) {
      const decision: AccessDecision = {
        allowed: true,
        reason: "Access granted",
        matchedPermissions,
        appliedRoles,
      };
      this.cacheDecision(cacheKey, decision);
      return decision;
    }

    // 5. 应用默认策略
    if (this.config.defaultPolicy === "allow") {
      const decision: AccessDecision = {
        allowed: true,
        reason: "Allowed by default policy",
        matchedPermissions: [],
        appliedRoles: [],
      };
      this.cacheDecision(cacheKey, decision);
      return decision;
    }

    const decision = this.createDeniedDecision("No matching permission found", matchedPermissions, appliedRoles);
    this.cacheDecision(cacheKey, decision);
    return decision;
  }

  /**
   * 检查权限是否匹配请求
   */
  private matchesPermission(permission: Permission, request: AccessRequest): boolean {
    // 检查资源类型
    if (permission.resource !== request.resource) {
      return false;
    }

    // 检查操作
    if (permission.action !== request.action && permission.action !== "admin") {
      return false;
    }

    // 检查资源模式
    if (permission.resourcePattern) {
      const regex = new RegExp(
        "^" + permission.resourcePattern.replace(/\*/g, ".*") + "$"
      );
      if (!regex.test(request.resourceId)) {
        return false;
      }
    }

    // 检查条件
    if (this.config.enableConditions && permission.conditions) {
      for (const condition of permission.conditions) {
        if (!this.evaluateCondition(condition, request)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 评估条件
   */
  private evaluateCondition(condition: PermissionCondition, request: AccessRequest): boolean {
    const context = request.context || {};

    switch (condition.type) {
      case "time":
        // 时间条件检查
        const now = new Date();
        const timeValue = condition.value as string;
        if (condition.operator === "in") {
          const [start, end] = timeValue.split("-");
          const currentHour = now.getHours();
          return currentHour >= parseInt(start) && currentHour < parseInt(end);
        }
        return true;

      case "ip":
        // IP 条件检查
        const clientIp = context.ip as string;
        if (!clientIp) return false;
        if (condition.operator === "in") {
          const allowedIps = (condition.value as string).split(",");
          return allowedIps.includes(clientIp);
        }
        return true;

      case "attribute":
        // 属性条件检查
        const attrValue = context[Object.keys(condition.value)[0]];
        const expectedValue = Object.values(condition.value)[0];
        switch (condition.operator) {
          case "eq":
            return attrValue === expectedValue;
          case "ne":
            return attrValue !== expectedValue;
          case "contains":
            return Array.isArray(attrValue) && attrValue.includes(expectedValue);
          default:
            return true;
        }

      case "custom":
        // 自定义条件
        const customFunc = condition.value as { check?: (ctx: Record<string, unknown>) => boolean };
        if (customFunc.check && typeof customFunc.check === "function") {
          return customFunc.check(context);
        }
        return true;

      default:
        return true;
    }
  }

  /**
   * 创建拒绝决策
   */
  private createDeniedDecision(
    reason: string,
    matchedPermissions: string[] = [],
    appliedRoles: string[] = []
  ): AccessDecision {
    return {
      allowed: false,
      reason,
      matchedPermissions,
      appliedRoles,
    };
  }

  /**
   * 缓存决策
   */
  private cacheDecision(key: string, decision: AccessDecision): void {
    this.decisionCache.set(key, {
      decision,
      expires: Date.now() + this.config.cacheTtl,
    });
  }

  /**
   * 清除缓存
   */
  private clearCache(): void {
    this.decisionCache.clear();
  }

  /**
   * 清除主体缓存
   */
  private clearSubjectCache(subjectId: string): void {
    for (const key of this.decisionCache.keys()) {
      if (key.startsWith(`${subjectId}:`)) {
        this.decisionCache.delete(key);
      }
    }
  }

  // ============================================================================
  // 辅助方法
  // ============================================================================

  /**
   * 批量检查权限
   */
  checkMultipleAccess(requests: AccessRequest[]): Map<string, AccessDecision> {
    const results = new Map<string, AccessDecision>();
    for (const request of requests) {
      const key = `${request.subjectId}:${request.resource}:${request.resourceId}`;
      results.set(key, this.checkAccess(request));
    }
    return results;
  }

  /**
   * 获取主体的所有权限
   */
  getSubjectPermissions(subjectId: string): Permission[] {
    const subject = this.subjects.get(subjectId);
    if (!subject) return [];

    const perms: Permission[] = [];

    // 添加直接权限
    if (subject.directPermissions) {
      for (const permId of subject.directPermissions) {
        const perm = this.permissions.get(permId);
        if (perm) perms.push(perm);
      }
    }

    // 添加角色权限
    for (const roleId of subject.roles) {
      perms.push(...this.getRolePermissions(roleId));
    }

    return perms;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    permissions: number;
    roles: number;
    subjects: number;
    aclEntries: number;
  } {
    let aclCount = 0;
    for (const entries of this.acls.values()) {
      aclCount += entries.length;
    }

    return {
      permissions: this.permissions.size,
      roles: this.roles.size,
      subjects: this.subjects.size,
      aclEntries: aclCount,
    };
  }

  // ============================================================================
  // 清理
  // ============================================================================

  /**
   * 关闭管理器
   */
  close(): void {
    this.clearCache();
    this.removeAllListeners();
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建访问控制管理器
 */
export function createAccessControlManager(config?: Partial<AccessControlConfig>): AccessControlManager {
  return new AccessControlManager(config);
}

// ============================================================================
// 格式化函数
// ============================================================================

/**
 * 格式化权限
 */
export function formatPermission(permission: Permission): string {
  const lines = [
    "=== 权限 ===",
    `ID: ${permission.id}`,
    `资源: ${permission.resource}`,
    `操作: ${permission.action}`,
  ];

  if (permission.description) {
    lines.push(`描述: ${permission.description}`);
  }

  if (permission.resourcePattern) {
    lines.push(`资源模式: ${permission.resourcePattern}`);
  }

  return lines.join("\n");
}

/**
 * 格式化角色
 */
export function formatRole(role: Role): string {
  const lines = [
    "=== 角色 ===",
    `ID: ${role.id}`,
    `名称: ${role.name}`,
    `类型: ${role.type}`,
    `权限: ${role.permissions.join(", ") || "无"}`,
  ];

  if (role.inherits && role.inherits.length > 0) {
    lines.push(`继承: ${role.inherits.join(", ")}`);
  }

  if (role.description) {
    lines.push(`描述: ${role.description}`);
  }

  return lines.join("\n");
}

/**
 * 格式化访问决策
 */
export function formatAccessDecision(decision: AccessDecision): string {
  const lines = [
    "=== 访问决策 ===",
    `结果: ${decision.allowed ? "允许" : "拒绝"}`,
    `原因: ${decision.reason}`,
  ];

  if (decision.matchedPermissions.length > 0) {
    lines.push(`匹配权限: ${decision.matchedPermissions.join(", ")}`);
  }

  if (decision.appliedRoles.length > 0) {
    lines.push(`应用角色: ${decision.appliedRoles.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * 格式化 ACL 条目
 */
export function formatACLEntry(entry: AccessControlEntry): string {
  const lines = [
    "=== ACL 条目 ===",
    `ID: ${entry.id}`,
    `主体: ${entry.subjectId}`,
    `资源: ${entry.resource}`,
    `资源 ID: ${entry.resourceId}`,
    `允许操作: ${entry.allowedActions.join(", ") || "无"}`,
    `拒绝操作: ${entry.deniedActions.join(", ") || "无"}`,
    `创建时间: ${entry.createdAt.toISOString()}`,
  ];

  if (entry.expiresAt) {
    lines.push(`过期时间: ${entry.expiresAt.toISOString()}`);
  }

  return lines.join("\n");
}
