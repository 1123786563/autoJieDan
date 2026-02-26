"""
测试访问控制管理
"""

import pytest
from datetime import datetime
from unittest.mock import Mock

from nanobot.interagent.access_control import (
    PermissionAction,
    ResourceType,
    RoleType,
    SubjectType,
    Permission,
    PermissionCondition,
    Role,
    Subject,
    AccessControlEntry,
    AccessRequest,
    AccessDecision,
    AccessControlConfig,
    AccessControlManager,
    create_access_control_manager,
    format_permission,
    format_role,
    format_access_decision,
    format_acl_entry,
)


class TestAccessControlManager:
    """测试访问控制管理器"""

    @pytest.fixture
    def acm(self) -> AccessControlManager:
        return create_access_control_manager(
            AccessControlConfig(
                default_policy="deny",
                enable_inheritance=True,
                enable_conditions=True,
            )
        )

    def teardown_method(self) -> None:
        pass

    # ========================================================================
    # 权限管理
    # ========================================================================

    def test_has_default_permissions(self, acm: AccessControlManager):
        """测试有默认权限"""
        permissions = acm.list_permissions()

        assert len(permissions) > 0

    def test_add_permission(self, acm: AccessControlManager):
        """测试添加权限"""
        permission = Permission(
            id="custom:action",
            resource=ResourceType.TASK,
            action=PermissionAction.EXECUTE,
            description="Custom permission",
        )

        acm.add_permission(permission)
        retrieved = acm.get_permission("custom:action")

        assert retrieved is not None
        assert retrieved.description == "Custom permission"

    def test_emit_permission_added_event(self, acm: AccessControlManager):
        """测试发射 permission:added 事件"""
        handler = Mock()
        acm.on("permission:added", handler)

        permission = Permission(
            id="test:perm",
            resource=ResourceType.TASK,
            action=PermissionAction.READ,
        )

        acm.add_permission(permission)

        handler.assert_called_with(permission)

    def test_filter_permissions_by_resource(self, acm: AccessControlManager):
        """测试按资源过滤权限"""
        permissions = acm.list_permissions(ResourceType.TASK)

        assert len(permissions) > 0
        for p in permissions:
            assert p.resource == ResourceType.TASK

    def test_remove_permission(self, acm: AccessControlManager):
        """测试删除权限"""
        permission = Permission(
            id="temp:perm",
            resource=ResourceType.TASK,
            action=PermissionAction.READ,
        )

        acm.add_permission(permission)
        removed = acm.remove_permission("temp:perm")

        assert removed is True
        assert acm.get_permission("temp:perm") is None

    # ========================================================================
    # 角色管理
    # ========================================================================

    def test_has_default_roles(self, acm: AccessControlManager):
        """测试有默认角色"""
        roles = acm.list_roles()

        assert len(roles) > 0
        assert any(r.id == "admin" for r in roles)
        assert any(r.id == "user" for r in roles)

    def test_add_role(self, acm: AccessControlManager):
        """测试添加角色"""
        role = Role(
            id="custom-role",
            name="Custom Role",
            type=RoleType.USER,
            permissions=["task:read"],
        )

        acm.add_role(role)
        retrieved = acm.get_role("custom-role")

        assert retrieved is not None
        assert retrieved.name == "Custom Role"

    def test_emit_role_added_event(self, acm: AccessControlManager):
        """测试发射 role:added 事件"""
        handler = Mock()
        acm.on("role:added", handler)

        role = Role(
            id="test-role",
            name="Test Role",
            type=RoleType.USER,
            permissions=[],
        )

        acm.add_role(role)

        handler.assert_called_with(role)

    def test_filter_roles_by_type(self, acm: AccessControlManager):
        """测试按类型过滤角色"""
        roles = acm.list_roles(RoleType.ADMIN)

        assert len(roles) > 0
        for r in roles:
            assert r.type == RoleType.ADMIN

    def test_update_role(self, acm: AccessControlManager):
        """测试更新角色"""
        role = Role(
            id="updatable-role",
            name="Updatable",
            type=RoleType.USER,
            permissions=["task:read"],
        )

        acm.add_role(role)
        updated = acm.update_role("updatable-role", name="Updated Name")

        assert updated is not None
        assert updated.name == "Updated Name"

    def test_remove_role(self, acm: AccessControlManager):
        """测试删除角色"""
        role = Role(
            id="removable-role",
            name="Removable",
            type=RoleType.USER,
            permissions=[],
        )

        acm.add_role(role)
        removed = acm.remove_role("removable-role")

        assert removed is True
        assert acm.get_role("removable-role") is None

    def test_get_role_permissions_with_inheritance(self, acm: AccessControlManager):
        """测试获取角色权限（包括继承）"""
        # manager 继承 user
        manager_perms = acm.get_role_permissions("manager")

        assert len(manager_perms) > 0
        # 应该包含 user 的权限
        assert any(p.id == "task:create" for p in manager_perms)

    # ========================================================================
    # 主体管理
    # ========================================================================

    def test_register_subject(self, acm: AccessControlManager):
        """测试注册主体"""
        subject = Subject(
            id="user-1",
            type=SubjectType.USER,
            roles=["user"],
        )

        acm.register_subject(subject)
        retrieved = acm.get_subject("user-1")

        assert retrieved is not None
        assert retrieved.type == SubjectType.USER

    def test_emit_subject_registered_event(self, acm: AccessControlManager):
        """测试发射 subject:registered 事件"""
        handler = Mock()
        acm.on("subject:registered", handler)

        subject = Subject(
            id="user-2",
            type=SubjectType.USER,
            roles=[],
        )

        acm.register_subject(subject)

        handler.assert_called_with(subject)

    def test_update_subject(self, acm: AccessControlManager):
        """测试更新主体"""
        subject = Subject(
            id="user-3",
            type=SubjectType.USER,
            roles=["user"],
        )

        acm.register_subject(subject)
        updated = acm.update_subject("user-3", roles=["user", "manager"])

        assert updated is not None
        assert len(updated.roles) == 2

    def test_unregister_subject(self, acm: AccessControlManager):
        """测试注销主体"""
        subject = Subject(
            id="user-4",
            type=SubjectType.USER,
            roles=[],
        )

        acm.register_subject(subject)
        removed = acm.unregister_subject("user-4")

        assert removed is True
        assert acm.get_subject("user-4") is None

    def test_assign_role_to_subject(self, acm: AccessControlManager):
        """测试给主体分配角色"""
        subject = Subject(
            id="user-5",
            type=SubjectType.USER,
            roles=[],
        )

        acm.register_subject(subject)
        assigned = acm.assign_role("user-5", "admin")

        assert assigned is True
        retrieved = acm.get_subject("user-5")
        assert "admin" in retrieved.roles

    def test_revoke_role_from_subject(self, acm: AccessControlManager):
        """测试移除主体角色"""
        subject = Subject(
            id="user-6",
            type=SubjectType.USER,
            roles=["admin"],
        )

        acm.register_subject(subject)
        revoked = acm.revoke_role("user-6", "admin")

        assert revoked is True
        retrieved = acm.get_subject("user-6")
        assert "admin" not in retrieved.roles

    # ========================================================================
    # ACL 管理
    # ========================================================================

    def test_add_acl_entry(self, acm: AccessControlManager):
        """测试添加 ACL 条目"""
        subject = Subject(
            id="user-acl-1",
            type=SubjectType.USER,
            roles=[],
        )

        acm.register_subject(subject)

        entry = AccessControlEntry(
            id="acl-1",
            subject_id="user-acl-1",
            resource=ResourceType.TASK,
            resource_id="task-123",
            allowed_actions=[PermissionAction.READ, PermissionAction.UPDATE],
        )

        acm.add_acl_entry(entry)
        entries = acm.get_acl_entries("user-acl-1", ResourceType.TASK)

        assert len(entries) == 1
        assert PermissionAction.READ in entries[0].allowed_actions

    def test_emit_acl_added_event(self, acm: AccessControlManager):
        """测试发射 acl:added 事件"""
        handler = Mock()
        acm.on("acl:added", handler)

        subject = Subject(
            id="user-acl-2",
            type=SubjectType.USER,
            roles=[],
        )

        acm.register_subject(subject)

        entry = AccessControlEntry(
            id="acl-2",
            subject_id="user-acl-2",
            resource=ResourceType.TASK,
            resource_id="*",
            allowed_actions=[PermissionAction.READ],
        )

        acm.add_acl_entry(entry)

        handler.assert_called_with(entry)

    def test_remove_acl_entry(self, acm: AccessControlManager):
        """测试移除 ACL 条目"""
        subject = Subject(
            id="user-acl-3",
            type=SubjectType.USER,
            roles=[],
        )

        acm.register_subject(subject)

        entry = AccessControlEntry(
            id="acl-removable",
            subject_id="user-acl-3",
            resource=ResourceType.TASK,
            resource_id="*",
            allowed_actions=[PermissionAction.READ],
        )

        acm.add_acl_entry(entry)
        removed = acm.remove_acl_entry("acl-removable")

        assert removed is True
        entries = acm.get_acl_entries("user-acl-3", ResourceType.TASK)
        assert len(entries) == 0

    # ========================================================================
    # 访问检查
    # ========================================================================

    def test_deny_access_for_non_existent_subject(self, acm: AccessControlManager):
        """测试拒绝不存在的主体"""
        request = AccessRequest(
            subject_id="non-existent",
            resource=ResourceType.TASK,
            resource_id="task-1",
            action=PermissionAction.READ,
        )

        decision = acm.check_access(request)

        assert decision.allowed is False
        assert decision.reason == "Subject not found"

    def test_allow_access_for_role_with_permission(self, acm: AccessControlManager):
        """测试允许有权限的角色"""
        subject = Subject(
            id="user-check-1",
            type=SubjectType.USER,
            roles=["user"],
        )

        acm.register_subject(subject)

        request = AccessRequest(
            subject_id="user-check-1",
            resource=ResourceType.TASK,
            resource_id="task-1",
            action=PermissionAction.READ,
        )

        decision = acm.check_access(request)

        assert decision.allowed is True
        assert "user" in decision.applied_roles

    def test_allow_access_for_admin_role(self, acm: AccessControlManager):
        """测试允许管理员角色"""
        subject = Subject(
            id="user-admin-1",
            type=SubjectType.USER,
            roles=["admin"],
        )

        acm.register_subject(subject)

        request = AccessRequest(
            subject_id="user-admin-1",
            resource=ResourceType.SYSTEM,
            resource_id="system-1",
            action=PermissionAction.ADMIN,
        )

        decision = acm.check_access(request)

        assert decision.allowed is True

    def test_deny_access_without_matching_permission(self, acm: AccessControlManager):
        """测试拒绝无匹配权限"""
        subject = Subject(
            id="user-guest-1",
            type=SubjectType.USER,
            roles=["guest"],
        )

        acm.register_subject(subject)

        request = AccessRequest(
            subject_id="user-guest-1",
            resource=ResourceType.TASK,
            resource_id="task-1",
            action=PermissionAction.DELETE,
        )

        decision = acm.check_access(request)

        assert decision.allowed is False

    def test_allow_access_via_acl(self, acm: AccessControlManager):
        """测试通过 ACL 允许访问"""
        subject = Subject(
            id="user-acl-check",
            type=SubjectType.USER,
            roles=[],
        )

        acm.register_subject(subject)

        entry = AccessControlEntry(
            id="acl-check-1",
            subject_id="user-acl-check",
            resource=ResourceType.TASK,
            resource_id="special-task",
            allowed_actions=[PermissionAction.READ, PermissionAction.UPDATE],
        )

        acm.add_acl_entry(entry)

        request = AccessRequest(
            subject_id="user-acl-check",
            resource=ResourceType.TASK,
            resource_id="special-task",
            action=PermissionAction.READ,
        )

        decision = acm.check_access(request)

        assert decision.allowed is True
        assert "acl:acl-check-1:allow" in decision.matched_permissions

    def test_deny_access_via_acl_deny_rule(self, acm: AccessControlManager):
        """测试通过 ACL 拒绝规则拒绝访问"""
        subject = Subject(
            id="user-acl-deny",
            type=SubjectType.USER,
            roles=["admin"],  # 有权限
        )

        acm.register_subject(subject)

        entry = AccessControlEntry(
            id="acl-deny-1",
            subject_id="user-acl-deny",
            resource=ResourceType.TASK,
            resource_id="protected-task",
            denied_actions=[PermissionAction.DELETE],  # 但被 ACL 拒绝
        )

        acm.add_acl_entry(entry)

        request = AccessRequest(
            subject_id="user-acl-deny",
            resource=ResourceType.TASK,
            resource_id="protected-task",
            action=PermissionAction.DELETE,
        )

        decision = acm.check_access(request)

        assert decision.allowed is False
        assert "Explicitly denied" in decision.reason

    def test_allow_access_with_wildcard_acl(self, acm: AccessControlManager):
        """测试通过通配符 ACL 允许访问"""
        subject = Subject(
            id="user-wildcard",
            type=SubjectType.USER,
            roles=[],
        )

        acm.register_subject(subject)

        entry = AccessControlEntry(
            id="acl-wildcard",
            subject_id="user-wildcard",
            resource=ResourceType.TASK,
            resource_id="*",  # 通配符
            allowed_actions=[PermissionAction.READ],
        )

        acm.add_acl_entry(entry)

        request = AccessRequest(
            subject_id="user-wildcard",
            resource=ResourceType.TASK,
            resource_id="any-task-id",
            action=PermissionAction.READ,
        )

        decision = acm.check_access(request)

        assert decision.allowed is True

    def test_respect_default_policy(self, acm: AccessControlManager):
        """测试遵守默认策略"""
        acm_allow = create_access_control_manager(
            AccessControlConfig(default_policy="allow")
        )

        subject = Subject(
            id="user-allow-default",
            type=SubjectType.USER,
            roles=[],
        )

        acm_allow.register_subject(subject)

        request = AccessRequest(
            subject_id="user-allow-default",
            resource=ResourceType.TASK,
            resource_id="task-1",
            action=PermissionAction.READ,
        )

        decision = acm_allow.check_access(request)

        assert decision.allowed is True
        assert decision.reason == "Allowed by default policy"

        acm_allow.close()

    # ========================================================================
    # 继承
    # ========================================================================

    def test_inherit_permissions_from_parent_role(self, acm: AccessControlManager):
        """测试从父角色继承权限"""
        subject = Subject(
            id="user-inherit",
            type=SubjectType.USER,
            roles=["manager"],  # manager 继承 user
        )

        acm.register_subject(subject)

        request = AccessRequest(
            subject_id="user-inherit",
            resource=ResourceType.TASK,
            resource_id="task-1",
            action=PermissionAction.READ,
        )

        decision = acm.check_access(request)

        assert decision.allowed is True

    # ========================================================================
    # 辅助方法
    # ========================================================================

    def test_check_multiple_access_requests(self, acm: AccessControlManager):
        """测试批量检查权限"""
        subject = Subject(
            id="user-multi",
            type=SubjectType.USER,
            roles=["user"],
        )

        acm.register_subject(subject)

        requests = [
            AccessRequest(
                subject_id="user-multi",
                resource=ResourceType.TASK,
                resource_id="task-1",
                action=PermissionAction.READ,
            ),
            AccessRequest(
                subject_id="user-multi",
                resource=ResourceType.TASK,
                resource_id="task-2",
                action=PermissionAction.DELETE,
            ),
        ]

        results = acm.check_multiple_access(requests)

        assert len(results) == 2

    def test_get_subject_permissions(self, acm: AccessControlManager):
        """测试获取主体权限"""
        subject = Subject(
            id="user-perms",
            type=SubjectType.USER,
            roles=["user"],
        )

        acm.register_subject(subject)

        permissions = acm.get_subject_permissions("user-perms")

        assert len(permissions) > 0

    def test_get_stats(self, acm: AccessControlManager):
        """测试获取统计信息"""
        stats = acm.get_stats()

        assert stats["permissions"] > 0
        assert stats["roles"] > 0

    # ========================================================================
    # 清理
    # ========================================================================

    def test_close_manager(self, acm: AccessControlManager):
        """测试关闭管理器"""
        manager = create_access_control_manager()
        manager.close()

        # Should not throw

    def test_remove_all_listeners_on_close(self, acm: AccessControlManager):
        """测试关闭时移除所有监听器"""
        handler = Mock()
        acm.on("permission:added", handler)

        acm.close()

        assert acm.listener_count("permission:added") == 0


class TestFormatFunctions:
    """测试格式化函数"""

    def test_format_permission(self):
        """测试格式化权限"""
        permission = Permission(
            id="test:perm",
            resource=ResourceType.TASK,
            action=PermissionAction.READ,
            description="Test permission",
        )

        formatted = format_permission(permission)

        assert "test:perm" in formatted
        assert "task" in formatted
        assert "read" in formatted
        assert "Test permission" in formatted

    def test_format_role(self):
        """测试格式化角色"""
        role = Role(
            id="test-role",
            name="Test Role",
            type=RoleType.USER,
            permissions=["task:read", "task:create"],
            inherits=["guest"],
            description="A test role",
        )

        formatted = format_role(role)

        assert "test-role" in formatted
        assert "Test Role" in formatted
        assert "task:read" in formatted
        assert "guest" in formatted

    def test_format_access_decision(self):
        """测试格式化访问决策"""
        decision = AccessDecision(
            allowed=True,
            reason="Access granted",
            matched_permissions=["task:read"],
            applied_roles=["user"],
        )

        formatted = format_access_decision(decision)

        assert "允许" in formatted
        assert "Access granted" in formatted
        assert "task:read" in formatted
        assert "user" in formatted

    def test_format_denied_access_decision(self):
        """测试格式化拒绝访问决策"""
        decision = AccessDecision(
            allowed=False,
            reason="No matching permission",
        )

        formatted = format_access_decision(decision)

        assert "拒绝" in formatted
        assert "No matching permission" in formatted

    def test_format_acl_entry(self):
        """测试格式化 ACL 条目"""
        entry = AccessControlEntry(
            id="acl-test",
            subject_id="user-1",
            resource=ResourceType.TASK,
            resource_id="task-1",
            allowed_actions=[PermissionAction.READ, PermissionAction.UPDATE],
            denied_actions=[PermissionAction.DELETE],
        )

        formatted = format_acl_entry(entry)

        assert "acl-test" in formatted
        assert "user-1" in formatted
        assert "task-1" in formatted
        assert "read" in formatted
        assert "delete" in formatted

    def test_format_acl_entry_with_expiration(self):
        """测试格式化带过期时间的 ACL 条目"""
        entry = AccessControlEntry(
            id="acl-expiring",
            subject_id="user-1",
            resource=ResourceType.TASK,
            resource_id="task-1",
            allowed_actions=[PermissionAction.READ],
            expires_at=datetime(2026, 12, 31),
        )

        formatted = format_acl_entry(entry)

        assert "过期时间" in formatted
        assert "2026" in formatted


class TestFactoryFunction:
    """测试工厂函数"""

    def test_create_access_control_manager(self):
        """测试创建访问控制管理器"""
        manager = create_access_control_manager()

        assert isinstance(manager, AccessControlManager)

    def test_create_with_config(self):
        """测试使用配置创建访问控制管理器"""
        config = AccessControlConfig(
            default_policy="allow",
            enable_inheritance=False,
        )
        manager = create_access_control_manager(config)

        assert isinstance(manager, AccessControlManager)
        assert manager._config.default_policy == "allow"
