"""
配置热更新测试
"""

import json
import os
import tempfile
import time
import pytest

from nanobot.interagent.config.hot_reload import (
    HotReloader,
    HotReloaderStats,
    ConfigChangeEvent,
    ConfigReloadEvent,
    create_hot_reloader,
)


class TestHotReloader:
    """HotReloader 测试"""

    @pytest.fixture
    def temp_config(self):
        """创建临时配置文件"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({"debug": False, "port": 3000}, f)
            config_path = f.name
        yield config_path
        # 清理
        if os.path.exists(config_path):
            os.unlink(config_path)

    def test_create_with_options(self, temp_config):
        """应该用选项创建"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False, "port": 3000},
        )
        assert reloader is not None
        assert reloader.get_version() == 0

    def test_get_config(self, temp_config):
        """应该返回当前配置"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False, "port": 3000},
        )

        config = reloader.get_config()
        assert config["debug"] is False
        assert config["port"] == 3000

    def test_get_value(self, temp_config):
        """应该返回配置值"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False, "port": 3000},
        )

        assert reloader.get("debug") is False
        assert reloader.get("port") == 3000
        assert reloader.get("nonexistent") is None

    def test_get_with_default(self, temp_config):
        """应该返回默认值"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False},
        )

        assert reloader.get("nonexistent", "default") == "default"

    def test_set_value(self, temp_config):
        """应该设置配置值"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False},
        )

        reloader.set("debug", True)
        assert reloader.get("debug") is True

    def test_set_emits_change(self, temp_config):
        """设置值应该触发 change 事件"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False},
        )

        changes = []
        reloader.on("change", lambda e: changes.append(e))

        reloader.set("debug", True)

        assert len(changes) == 1
        assert changes[0].key == "debug"
        assert changes[0].old_value is False
        assert changes[0].new_value is True

    def test_reload_config(self, temp_config):
        """应该重载配置"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False, "port": 3000},
        )

        # 修改配置文件
        with open(temp_config, "w") as f:
            json.dump({"debug": True, "port": 3000}, f)

        result = reloader.reload()
        assert result is True
        assert reloader.get("debug") is True

    def test_reload_no_changes(self, temp_config):
        """没有变更时不应触发事件"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False, "port": 3000},
        )

        changes = []
        reloader.on("change", lambda e: changes.append(e))

        # 不修改内容
        with open(temp_config, "w") as f:
            json.dump({"debug": False, "port": 3000}, f)

        result = reloader.reload()
        assert result is False
        assert len(changes) == 0

    def test_reload_updates_version(self, temp_config):
        """重载应该更新版本"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False},
        )

        with open(temp_config, "w") as f:
            json.dump({"debug": True}, f)

        reloader.reload()
        assert reloader.get_version() == 1

    def test_rollback(self, temp_config):
        """应该回滚到上一版本"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False},
        )

        # 先修改
        with open(temp_config, "w") as f:
            json.dump({"debug": True}, f)
        reloader.reload()

        assert reloader.get("debug") is True

        # 回滚
        result = reloader.rollback()
        assert result is True
        assert reloader.get("debug") is False

    def test_rollback_no_history(self, temp_config):
        """没有历史时应该返回 False"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False},
        )

        result = reloader.rollback()
        assert result is False

    def test_rollback_emits_event(self, temp_config):
        """回滚应该触发事件"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False},
        )

        with open(temp_config, "w") as f:
            json.dump({"debug": True}, f)
        reloader.reload()

        rollbacks = []
        reloader.on("rollback", lambda e: rollbacks.append(e))

        reloader.rollback()
        assert len(rollbacks) == 1

    def test_get_history(self, temp_config):
        """应该返回历史"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False},
        )

        assert len(reloader.get_history()) == 0

        with open(temp_config, "w") as f:
            json.dump({"debug": True}, f)
        reloader.reload()

        history = reloader.get_history()
        assert len(history) == 1

    def test_get_stats(self, temp_config):
        """应该返回统计信息"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False},
        )

        stats = reloader.get_stats()
        assert stats.version == 0
        assert stats.history_size == 0
        assert stats.total_reloads == 0
        assert stats.is_watching is False

    def test_start_stop(self, temp_config):
        """应该能启动和停止监听"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False},
        )

        reloader.start()
        assert reloader.is_watching() is True

        reloader.stop()
        assert reloader.is_watching() is False

    def test_start_emits_event(self, temp_config):
        """启动应该触发事件"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False},
        )

        started = []
        reloader.on("started", lambda _: started.append(True))

        reloader.start()
        assert len(started) == 1

        reloader.stop()

    def test_stop_emits_event(self, temp_config):
        """停止应该触发事件"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False},
        )

        stopped = []
        reloader.on("stopped", lambda _: stopped.append(True))

        reloader.start()
        reloader.stop()
        assert len(stopped) == 1

    def test_clear_history(self, temp_config):
        """应该清空历史"""
        reloader = HotReloader(
            config_path=temp_config,
            initial_config={"debug": False},
        )

        with open(temp_config, "w") as f:
            json.dump({"debug": True}, f)
        reloader.reload()

        reloader.clear_history()
        assert len(reloader.get_history()) == 0


class TestCreateHotReloader:
    """create_hot_reloader 测试"""

    def test_create(self):
        """应该创建热加载器"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({"debug": False}, f)
            config_path = f.name

        try:
            reloader = create_hot_reloader(config_path, {"debug": False})
            assert isinstance(reloader, HotReloader)
        finally:
            os.unlink(config_path)


class TestConfigChangeEvent:
    """ConfigChangeEvent 测试"""

    def test_create_event(self):
        """应该创建变更事件"""
        event = ConfigChangeEvent(
            key="debug",
            old_value=False,
            new_value=True,
        )

        assert event.key == "debug"
        assert event.old_value is False
        assert event.new_value is True
        assert event.timestamp is not None
