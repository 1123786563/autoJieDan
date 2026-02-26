"""
访问控制管理
提供基于角色的访问控制 (RBAC) 和访问控制列表 (ACL)

@module interagent/access_control
@version 1.0.0
"""

from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set, Tuple
from dataclasses import dataclass, field


# ============================================================================
# 枚举类型
# ============================================================================


class PermissionAction(str, Enum):
    """权限操作"""

    CREATE = "create"
    READ = "read"
    UPDATE = "update"
    DELETE = "delete"
    EXECUTE = "execute"
    ADMIN = "admin"


class ResourceType(str, Enum):
    """资源类型"""

    TASK = "task"
    MESSAGE = "message"
    FILE = "file"
    CONFIG = "config"
    KEY = "key"
    CERTIFICATE = "certificate"
    SYSTEM = "system"


class RoleType(str, Enum):
    """角色类型"""

    ADMIN = "admin"
    MANAGER = "manager"
    USER = "user"
    GUEST = "guest"
    SERVICE = "service"
    AGENT = "agent"


class SubjectType(str, Enum):
    """主体类型"""

    USER = "user"
    SERVICE = "service"
    AGENT = "agent"


# ============================================================================
# 数据类
# ============================================================================


@dataclass
class PermissionCondition:
    """权限条件"""

    type: str  # time, ip, attribute, custom
    value: Any
    operator: str = "eq"  # eq, ne, gt, lt, in, contains


@dataclass
class Permission:
    """权限"""

    id: str
    resource: ResourceType
    action: PermissionAction
    resource_pattern: Optional[str] = None
    conditions: List[PermissionCondition] = field(default_factory=list)
    description: Optional[str] = None


@dataclass
class Role:
    """角色"""

    id: str
    name: str
    type: RoleType
    permissions: List[str] = field(default_factory=list)
    inherits: List[str] = field(default_factory=list)
    description: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Subject:
    """主体"""

    id: str
    type: SubjectType
    roles: List[str] = field(default_factory=list)
    direct_permissions: List[str] = field(default_factory=list)
    attributes: Dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.now)


@dataclass
class AccessControlEntry:
    """访问控制条目"""

    id: str
    subject_id: str
    resource: ResourceType
    resource_id: str
    allowed_actions: List[PermissionAction] = field(default_factory=list)
    denied_actions: List[PermissionAction] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    expires_at: Optional[datetime] = None


@dataclass
class AccessRequest:
    """访问请求"""

    subject_id: str
    resource: ResourceType
    resource_id: str
    action: PermissionAction
    context: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AccessDecision:
    """访问决策"""

    allowed: bool
    reason: str
    matched_permissions: List[str] = field(default_factory=list)
    applied_roles: List[str] = field(default_factory=list)


@dataclass
class AccessControlConfig:
    """访问控制配置"""

    default_policy: str = "deny"  # allow or deny
    enable_inheritance: bool = True
    enable_conditions: bool = True
    cache_ttl: int = 60000  # 1 minute


# ============================================================================
# EventEmitter
# ============================================================================


class EventEmitter:
    """简单的事件发射器"""

    def __init__(self) -> None:
        self._listeners: Dict[str, List[Callable]] = {}
        self._once_listeners: Dict[str, List[Callable]] = {}

    def on(self, event: str, handler: Callable) -> None:
        """注册事件监听器"""
        if event not in self._listeners:
            self._listeners[event] = []
        self._listeners[event].append(handler)

    def once(self, event: str, handler: Callable) -> None:
        """注册一次性事件监听器"""
        if event not in self._once_listeners:
            self._once_listeners[event] = []
        self._once_listeners[event].append(handler)

    def off(self, event: str, handler: Callable) -> None:
        """移除事件监听器"""
        if event in self._listeners:
            self._listeners[event] = [h for h in self._listeners[event] if h != handler]
        if event in self._once_listeners:
            self._once_listeners[event] = [
                h for h in self._once_listeners[event] if h != handler
            ]

    def emit(self, event: str, *args: Any, **kwargs: Any) -> None:
        """发射事件"""
        if event in self._listeners:
            for handler in self._listeners[event]:
                try:
                    handler(*args, **kwargs)
                except Exception:
                    pass

        if event in self._once_listeners:
            for handler in self._once_listeners[event]:
                try:
                    handler(*args, **kwargs)
                except Exception:
                    pass
            self._once_listeners[event] = []

    def remove_all_listeners(self, event: Optional[str] = None) -> None:
        """移除所有监听器"""
        if event:
            self._listeners.pop(event, None)
            self._once_listeners.pop(event, None)
        else:
            self._listeners.clear()
            self._once_listeners.clear()

    def listener_count(self, event: str) -> int:
        """获取监听器数量"""
        count = len(self._listeners.get(event, []))
        count += len(self._once_listeners.get(event, []))
        return count


# ============================================================================
# 默认权限和角色
# ============================================================================

DEFAULT_PERMISSIONS: List[Permission] = [
    # Task permissions
    Permission(id="task:create", resource=ResourceType.TASK, action=PermissionAction.CREATE, description="创建任务"),
    Permission(id="task:read", resource=ResourceType.TASK, action=PermissionAction.READ, description="读取任务"),
    Permission(id="task:update", resource=ResourceType.TASK, action=PermissionAction.UPDATE, description="更新任务"),
    Permission(id="task:delete", resource=ResourceType.TASK, action=PermissionAction.DELETE, description="删除任务"),
    Permission(id="task:execute", resource=ResourceType.TASK, action=PermissionAction.EXECUTE, description="执行任务"),
    Permission(id="task:admin", resource=ResourceType.TASK, action=PermissionAction.ADMIN, description="任务管理"),
    # Message permissions
    Permission(id="message:create", resource=ResourceType.MESSAGE, action=PermissionAction.CREATE, description="创建消息"),
    Permission(id="message:read", resource=ResourceType.MESSAGE, action=PermissionAction.READ, description="读取消息"),
    Permission(id="message:delete", resource=ResourceType.MESSAGE, action=PermissionAction.DELETE, description="删除消息"),
    # File permissions
    Permission(id="file:create", resource=ResourceType.FILE, action=PermissionAction.CREATE, description="创建文件"),
    Permission(id="file:read", resource=ResourceType.FILE, action=PermissionAction.READ, description="读取文件"),
    Permission(id="file:update", resource=ResourceType.FILE, action=PermissionAction.UPDATE, description="更新文件"),
    Permission(id="file:delete", resource=ResourceType.FILE, action=PermissionAction.DELETE, description="删除文件"),
    # Config permissions
    Permission(id="config:read", resource=ResourceType.CONFIG, action=PermissionAction.READ, description="读取配置"),
    Permission(id="config:update", resource=ResourceType.CONFIG, action=PermissionAction.UPDATE, description="更新配置"),
    Permission(id="config:admin", resource=ResourceType.CONFIG, action=PermissionAction.ADMIN, description="配置管理"),
    # Key permissions
    Permission(id="key:create", resource=ResourceType.KEY, action=PermissionAction.CREATE, description="创建密钥"),
    Permission(id="key:read", resource=ResourceType.KEY, action=PermissionAction.READ, description="读取密钥"),
    Permission(id="key:delete", resource=ResourceType.KEY, action=PermissionAction.DELETE, description="删除密钥"),
    # Certificate permissions
    Permission(id="cert:create", resource=ResourceType.CERTIFICATE, action=PermissionAction.CREATE, description="创建证书"),
    Permission(id="cert:read", resource=ResourceType.CERTIFICATE, action=PermissionAction.READ, description="读取证书"),
    Permission(id="cert:delete", resource=ResourceType.CERTIFICATE, action=PermissionAction.DELETE, description="删除证书"),
    # System permissions
    Permission(id="system:admin", resource=ResourceType.SYSTEM, action=PermissionAction.ADMIN, description="系统管理"),
    Permission(id="system:execute", resource=ResourceType.SYSTEM, action=PermissionAction.EXECUTE, description="系统操作"),
]

DEFAULT_ROLES: List[Role] = [
    Role(
        id="admin",
        name="Administrator",
        type=RoleType.ADMIN,
        permissions=["system:admin", "task:admin", "config:admin", "cert:create", "cert:read", "cert:delete", "key:create", "key:read", "key:delete"],
        description="系统管理员",
    ),
    Role(
        id="manager",
        name="Manager",
        type=RoleType.MANAGER,
        permissions=["task:create", "task:read", "task:update", "task:delete", "message:create", "message:read", "file:create", "file:read", "file:update"],
        inherits=["user"],
        description="管理者",
    ),
    Role(
        id="user",
        name="User",
        type=RoleType.USER,
        permissions=["task:create", "task:read", "task:update", "message:create", "message:read", "file:read"],
        description="普通用户",
    ),
    Role(
        id="guest",
        name="Guest",
        type=RoleType.GUEST,
        permissions=["task:read", "message:read"],
        description="访客",
    ),
    Role(
        id="service",
        name="Service",
        type=RoleType.SERVICE,
        permissions=["task:create", "task:read", "task:execute", "message:create", "message:read", "key:read"],
        description="服务账户",
    ),
    Role(
        id="agent",
        name="Agent",
        type=RoleType.AGENT,
        permissions=["task:read", "task:execute", "message:create", "message:read", "file:read", "file:create"],
        description="代理账户",
    ),
]


# ============================================================================
# AccessControlManager 类
# ============================================================================


class AccessControlManager(EventEmitter):
    """访问控制管理器"""

    def __init__(self, config: Optional[AccessControlConfig] = None) -> None:
        super().__init__()
        self._config = config or AccessControlConfig()
        self._permissions: Dict[str, Permission] = {}
        self._roles: Dict[str, Role] = {}
        self._subjects: Dict[str, Subject] = {}
        self._acls: Dict[str, List[AccessControlEntry]] = {}
        self._decision_cache: Dict[str, Tuple[AccessDecision, float]] = {}

        self._initialize_defaults()

    def _initialize_defaults(self) -> None:
        """初始化默认权限和角色"""
        for perm in DEFAULT_PERMISSIONS:
            self._permissions[perm.id] = perm

        for role in DEFAULT_ROLES:
            self._roles[role.id] = role

    # =========================================================================
    # 权限管理
    # =========================================================================

    def add_permission(self, permission: Permission) -> None:
        """添加权限"""
        self._permissions[permission.id] = permission
        self._clear_cache()
        self.emit("permission:added", permission)

    def get_permission(self, permission_id: str) -> Optional[Permission]:
        """获取权限"""
        return self._permissions.get(permission_id)

    def list_permissions(self, resource: Optional[ResourceType] = None) -> List[Permission]:
        """列出所有权限"""
        perms = list(self._permissions.values())
        if resource:
            perms = [p for p in perms if p.resource == resource]
        return perms

    def remove_permission(self, permission_id: str) -> bool:
        """删除权限"""
        if permission_id in self._permissions:
            del self._permissions[permission_id]
            self._clear_cache()
            self.emit("permission:removed", permission_id)
            return True
        return False

    # =========================================================================
    # 角色管理
    # =========================================================================

    def add_role(self, role: Role) -> None:
        """添加角色"""
        self._roles[role.id] = role
        self._clear_cache()
        self.emit("role:added", role)

    def get_role(self, role_id: str) -> Optional[Role]:
        """获取角色"""
        return self._roles.get(role_id)

    def list_roles(self, role_type: Optional[RoleType] = None) -> List[Role]:
        """列出所有角色"""
        roles = list(self._roles.values())
        if role_type:
            roles = [r for r in roles if r.type == role_type]
        return roles

    def update_role(self, role_id: str, **updates: Any) -> Optional[Role]:
        """更新角色"""
        role = self._roles.get(role_id)
        if not role:
            return None

        for key, value in updates.items():
            if hasattr(role, key):
                setattr(role, key, value)

        self._clear_cache()
        self.emit("role:updated", role)
        return role

    def remove_role(self, role_id: str) -> bool:
        """删除角色"""
        if role_id in self._roles:
            del self._roles[role_id]
            self._clear_cache()
            self.emit("role:removed", role_id)
            return True
        return False

    def get_role_permissions(
        self, role_id: str, visited: Optional[Set[str]] = None
    ) -> List[Permission]:
        """获取角色的所有权限（包括继承）"""
        if visited is None:
            visited = set()

        role = self._roles.get(role_id)
        if not role or role_id in visited:
            return []

        visited.add(role_id)
        perms: List[Permission] = []

        # 添加直接权限
        for perm_id in role.permissions:
            perm = self._permissions.get(perm_id)
            if perm:
                perms.append(perm)

        # 添加继承的权限
        if self._config.enable_inheritance and role.inherits:
            for parent_role_id in role.inherits:
                perms.extend(self.get_role_permissions(parent_role_id, visited))

        return perms

    # =========================================================================
    # 主体管理
    # =========================================================================

    def register_subject(self, subject: Subject) -> None:
        """注册主体"""
        self._subjects[subject.id] = subject
        self.emit("subject:registered", subject)

    def get_subject(self, subject_id: str) -> Optional[Subject]:
        """获取主体"""
        return self._subjects.get(subject_id)

    def update_subject(self, subject_id: str, **updates: Any) -> Optional[Subject]:
        """更新主体"""
        subject = self._subjects.get(subject_id)
        if not subject:
            return None

        for key, value in updates.items():
            if hasattr(subject, key):
                setattr(subject, key, value)

        self._clear_subject_cache(subject_id)
        self.emit("subject:updated", subject)
        return subject

    def unregister_subject(self, subject_id: str) -> bool:
        """注销主体"""
        if subject_id in self._subjects:
            del self._subjects[subject_id]
            self._clear_subject_cache(subject_id)
            self.emit("subject:unregistered", subject_id)
            return True
        return False

    def assign_role(self, subject_id: str, role_id: str) -> bool:
        """给主体分配角色"""
        subject = self._subjects.get(subject_id)
        role = self._roles.get(role_id)

        if not subject or not role:
            return False

        if role_id not in subject.roles:
            subject.roles.append(role_id)
            self._clear_subject_cache(subject_id)
            self.emit("role:assigned", subject_id=subject_id, role_id=role_id)

        return True

    def revoke_role(self, subject_id: str, role_id: str) -> bool:
        """移除主体角色"""
        subject = self._subjects.get(subject_id)
        if not subject:
            return False

        if role_id in subject.roles:
            subject.roles.remove(role_id)
            self._clear_subject_cache(subject_id)
            self.emit("role:revoked", subject_id=subject_id, role_id=role_id)

        return True

    # =========================================================================
    # ACL 管理
    # =========================================================================

    def add_acl_entry(self, entry: AccessControlEntry) -> None:
        """添加 ACL 条目"""
        key = f"{entry.subject_id}:{entry.resource.value}"
        if key not in self._acls:
            self._acls[key] = []
        self._acls[key].append(entry)
        self._clear_subject_cache(entry.subject_id)
        self.emit("acl:added", entry)

    def get_acl_entries(
        self, subject_id: str, resource: ResourceType
    ) -> List[AccessControlEntry]:
        """获取 ACL 条目"""
        key = f"{subject_id}:{resource.value}"
        return self._acls.get(key, [])

    def remove_acl_entry(self, entry_id: str) -> bool:
        """移除 ACL 条目"""
        for key, entries in self._acls.items():
            for i, entry in enumerate(entries):
                if entry.id == entry_id:
                    entries.pop(i)
                    subject_id = key.split(":")[0]
                    self._clear_subject_cache(subject_id)
                    self.emit("acl:removed", entry_id)
                    return True
        return False

    # =========================================================================
    # 访问检查
    # =========================================================================

    def check_access(self, request: AccessRequest) -> AccessDecision:
        """检查访问权限"""
        # 检查缓存
        cache_key = f"{request.subject_id}:{request.resource.value}:{request.resource_id}:{request.action.value}"
        cached = self._decision_cache.get(cache_key)
        if cached and cached[1] > datetime.now().timestamp() * 1000:
            return cached[0]

        subject = self._subjects.get(request.subject_id)
        if not subject:
            return self._create_denied_decision("Subject not found")

        matched_permissions: List[str] = []
        applied_roles: List[str] = []

        # 1. 检查直接权限
        for perm_id in subject.direct_permissions:
            perm = self._permissions.get(perm_id)
            if perm and self._matches_permission(perm, request):
                matched_permissions.append(perm_id)

        # 2. 检查角色权限
        for role_id in subject.roles:
            role_perms = self.get_role_permissions(role_id)
            for perm in role_perms:
                if self._matches_permission(perm, request):
                    matched_permissions.append(perm.id)
                    if role_id not in applied_roles:
                        applied_roles.append(role_id)

        # 3. 检查 ACL
        acl_entries = self.get_acl_entries(request.subject_id, request.resource)
        for entry in acl_entries:
            # 检查过期
            if entry.expires_at and entry.expires_at < datetime.now():
                continue

            # 检查资源 ID 匹配
            if entry.resource_id != "*" and entry.resource_id != request.resource_id:
                continue

            # 检查允许的操作
            if request.action in entry.allowed_actions or PermissionAction.ADMIN in entry.allowed_actions:
                matched_permissions.append(f"acl:{entry.id}:allow")

            # 检查拒绝的操作
            if request.action in entry.denied_actions or PermissionAction.ADMIN in entry.denied_actions:
                decision = self._create_denied_decision(
                    f"Explicitly denied by ACL: {entry.id}",
                    matched_permissions,
                    applied_roles,
                )
                self._cache_decision(cache_key, decision)
                return decision

        # 4. 做出决策
        if matched_permissions:
            decision = AccessDecision(
                allowed=True,
                reason="Access granted",
                matched_permissions=matched_permissions,
                applied_roles=applied_roles,
            )
            self._cache_decision(cache_key, decision)
            return decision

        # 5. 应用默认策略
        if self._config.default_policy == "allow":
            decision = AccessDecision(
                allowed=True,
                reason="Allowed by default policy",
                matched_permissions=[],
                applied_roles=[],
            )
            self._cache_decision(cache_key, decision)
            return decision

        decision = self._create_denied_decision(
            "No matching permission found", matched_permissions, applied_roles
        )
        self._cache_decision(cache_key, decision)
        return decision

    def _matches_permission(self, permission: Permission, request: AccessRequest) -> bool:
        """检查权限是否匹配请求"""
        # 检查资源类型
        if permission.resource != request.resource:
            return False

        # 检查操作
        if permission.action != request.action and permission.action != PermissionAction.ADMIN:
            return False

        # 检查资源模式
        if permission.resource_pattern:
            import re

            pattern = "^" + permission.resource_pattern.replace("*", ".*") + "$"
            if not re.match(pattern, request.resource_id):
                return False

        # 检查条件
        if self._config.enable_conditions and permission.conditions:
            for condition in permission.conditions:
                if not self._evaluate_condition(condition, request):
                    return False

        return True

    def _evaluate_condition(
        self, condition: PermissionCondition, request: AccessRequest
    ) -> bool:
        """评估条件"""
        context = request.context

        if condition.type == "time":
            now = datetime.now()
            if condition.operator == "in":
                parts = str(condition.value).split("-")
                if len(parts) == 2:
                    start, end = int(parts[0]), int(parts[1])
                    return start <= now.hour < end
            return True

        elif condition.type == "ip":
            client_ip = context.get("ip")
            if not client_ip:
                return False
            if condition.operator == "in":
                allowed_ips = str(condition.value).split(",")
                return client_ip in allowed_ips
            return True

        elif condition.type == "attribute":
            if isinstance(condition.value, dict):
                attr_name = list(condition.value.keys())[0]
                expected = condition.value[attr_name]
                actual = context.get(attr_name)

                if condition.operator == "eq":
                    return actual == expected
                elif condition.operator == "ne":
                    return actual != expected
                elif condition.operator == "contains":
                    return isinstance(actual, list) and expected in actual
            return True

        elif condition.type == "custom":
            if isinstance(condition.value, dict) and "check" in condition.value:
                check_func = condition.value["check"]
                if callable(check_func):
                    return check_func(context)
            return True

        return True

    def _create_denied_decision(
        self,
        reason: str,
        matched_permissions: Optional[List[str]] = None,
        applied_roles: Optional[List[str]] = None,
    ) -> AccessDecision:
        """创建拒绝决策"""
        return AccessDecision(
            allowed=False,
            reason=reason,
            matched_permissions=matched_permissions or [],
            applied_roles=applied_roles or [],
        )

    def _cache_decision(self, key: str, decision: AccessDecision) -> None:
        """缓存决策"""
        expires = datetime.now().timestamp() * 1000 + self._config.cache_ttl
        self._decision_cache[key] = (decision, expires)

    def _clear_cache(self) -> None:
        """清除缓存"""
        self._decision_cache.clear()

    def _clear_subject_cache(self, subject_id: str) -> None:
        """清除主体缓存"""
        keys_to_remove = [k for k in self._decision_cache if k.startswith(f"{subject_id}:")]
        for key in keys_to_remove:
            del self._decision_cache[key]

    # =========================================================================
    # 辅助方法
    # =========================================================================

    def check_multiple_access(
        self, requests: List[AccessRequest]
    ) -> Dict[str, AccessDecision]:
        """批量检查权限"""
        results: Dict[str, AccessDecision] = {}
        for request in requests:
            key = f"{request.subject_id}:{request.resource.value}:{request.resource_id}"
            results[key] = self.check_access(request)
        return results

    def get_subject_permissions(self, subject_id: str) -> List[Permission]:
        """获取主体的所有权限"""
        subject = self._subjects.get(subject_id)
        if not subject:
            return []

        perms: List[Permission] = []

        # 添加直接权限
        for perm_id in subject.direct_permissions:
            perm = self._permissions.get(perm_id)
            if perm:
                perms.append(perm)

        # 添加角色权限
        for role_id in subject.roles:
            perms.extend(self.get_role_permissions(role_id))

        return perms

    def get_stats(self) -> Dict[str, int]:
        """获取统计信息"""
        acl_count = sum(len(entries) for entries in self._acls.values())

        return {
            "permissions": len(self._permissions),
            "roles": len(self._roles),
            "subjects": len(self._subjects),
            "acl_entries": acl_count,
        }

    # =========================================================================
    # 清理
    # =========================================================================

    def close(self) -> None:
        """关闭管理器"""
        self._clear_cache()
        self.remove_all_listeners()


# ============================================================================
# 工厂函数
# ============================================================================


def create_access_control_manager(
    config: Optional[AccessControlConfig] = None,
) -> AccessControlManager:
    """创建访问控制管理器"""
    return AccessControlManager(config)


# ============================================================================
# 格式化函数
# ============================================================================


def format_permission(permission: Permission) -> str:
    """格式化权限"""
    lines = [
        "=== 权限 ===",
        f"ID: {permission.id}",
        f"资源: {permission.resource.value}",
        f"操作: {permission.action.value}",
    ]

    if permission.description:
        lines.append(f"描述: {permission.description}")

    if permission.resource_pattern:
        lines.append(f"资源模式: {permission.resource_pattern}")

    return "\n".join(lines)


def format_role(role: Role) -> str:
    """格式化角色"""
    lines = [
        "=== 角色 ===",
        f"ID: {role.id}",
        f"名称: {role.name}",
        f"类型: {role.type.value}",
        f"权限: {', '.join(role.permissions) or '无'}",
    ]

    if role.inherits:
        lines.append(f"继承: {', '.join(role.inherits)}")

    if role.description:
        lines.append(f"描述: {role.description}")

    return "\n".join(lines)


def format_access_decision(decision: AccessDecision) -> str:
    """格式化访问决策"""
    lines = [
        "=== 访问决策 ===",
        f"结果: {'允许' if decision.allowed else '拒绝'}",
        f"原因: {decision.reason}",
    ]

    if decision.matched_permissions:
        lines.append(f"匹配权限: {', '.join(decision.matched_permissions)}")

    if decision.applied_roles:
        lines.append(f"应用角色: {', '.join(decision.applied_roles)}")

    return "\n".join(lines)


def format_acl_entry(entry: AccessControlEntry) -> str:
    """格式化 ACL 条目"""
    lines = [
        "=== ACL 条目 ===",
        f"ID: {entry.id}",
        f"主体: {entry.subject_id}",
        f"资源: {entry.resource.value}",
        f"资源 ID: {entry.resource_id}",
        f"允许操作: {', '.join([a.value for a in entry.allowed_actions]) or '无'}",
        f"拒绝操作: {', '.join([a.value for a in entry.denied_actions]) or '无'}",
        f"创建时间: {entry.created_at.isoformat()}",
    ]

    if entry.expires_at:
        lines.append(f"过期时间: {entry.expires_at.isoformat()}")

    return "\n".join(lines)
