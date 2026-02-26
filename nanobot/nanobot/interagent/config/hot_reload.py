"""
配置热更新模块
实现配置热更新，无需重启服务

@module interagent.config.hot_reload
@version 1.0.0
"""

import json
import os
import threading
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set
from collections import OrderedDict


# ============================================================================
# Types
# ============================================================================


ConfigValue = Any
ConfigObject = Dict[str, ConfigValue]


@dataclass
class ConfigChangeEvent:
    """配置变更事件"""

    key: str
    """变更的键"""

    old_value: ConfigValue
    """旧值"""

    new_value: ConfigValue
    """新值"""

    timestamp: datetime = field(default_factory=datetime.now)
    """变更时间"""


@dataclass
class ConfigReloadEvent:
    """配置重载事件"""

    old_config: ConfigObject
    """旧配置"""

    new_config: ConfigObject
    """新配置"""

    version: int
    """版本号"""

    changes: List[ConfigChangeEvent]
    """变更列表"""


@dataclass
class HotReloaderStats:
    """热加载器状态"""

    version: int
    """当前版本"""

    history_size: int
    """历史版本数"""

    total_reloads: int
    """总重载次数"""

    is_watching: bool
    """是否正在监听"""


# ============================================================================
# HotReloader Class
# ============================================================================


class HotReloader:
    """
    配置热加载器

    监听配置文件变更，自动重载配置，支持版本管理和回滚

    Example:
        reloader = HotReloader(
            config_path='./config.json',
            initial_config={'debug': False},
        )

        reloader.on('change', lambda e: print(f'Config changed: {e.key}'))
        reloader.start()

        # 回滚到上一版本
        reloader.rollback()
    """

    def __init__(
        self,
        config_path: str,
        initial_config: Optional[ConfigObject] = None,
        debounce_delay: float = 0.1,
        max_history_size: int = 10,
        parser: Optional[Callable[[str], ConfigObject]] = None,
    ):
        """
        初始化热加载器

        Args:
            config_path: 配置文件路径
            initial_config: 初始配置
            debounce_delay: 防抖延迟 (秒)
            max_history_size: 最大历史版本数
            parser: 配置解析器
        """
        self._config_path = config_path
        self._config: ConfigObject = dict(initial_config or {})
        self._debounce_delay = debounce_delay
        self._max_history_size = max_history_size
        self._parser = parser or self._default_parser

        self._version = 0
        self._history: OrderedDict[int, ConfigObject] = OrderedDict()
        self._total_reloads = 0
        self._watching = False
        self._watch_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._last_mtime: float = 0.0

        self._listeners: Dict[str, List[Callable]] = {
            "change": [],
            "reloaded": [],
            "rollback": [],
            "error": [],
            "started": [],
            "stopped": [],
        }

    def _default_parser(self, content: str) -> ConfigObject:
        """默认配置解析器"""
        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            raise ValueError(f"Failed to parse config as JSON: {e}")

    def on(self, event: str, callback: Callable) -> None:
        """注册事件监听器"""
        if event in self._listeners:
            self._listeners[event].append(callback)

    def off(self, event: str, callback: Callable) -> None:
        """移除事件监听器"""
        if event in self._listeners and callback in self._listeners[event]:
            self._listeners[event].remove(callback)

    def _emit(self, event: str, data: Any = None) -> None:
        """触发事件"""
        for callback in self._listeners.get(event, []):
            try:
                callback(data)
            except Exception:
                pass

    def start(self) -> None:
        """开始监听配置文件"""
        if self._watching:
            return

        # 获取初始 mtime
        try:
            self._last_mtime = os.path.getmtime(self._config_path)
        except OSError:
            self._last_mtime = 0.0

        self._watching = True
        self._stop_event.clear()
        self._watch_thread = threading.Thread(target=self._watch_loop, daemon=True)
        self._watch_thread.start()
        self._emit("started")

    def stop(self) -> None:
        """停止监听"""
        if not self._watching:
            return

        self._watching = False
        self._stop_event.set()

        if self._watch_thread:
            self._watch_thread.join(timeout=1.0)
            self._watch_thread = None

        self._emit("stopped")

    def _watch_loop(self) -> None:
        """监听循环"""
        while self._watching and not self._stop_event.is_set():
            try:
                current_mtime = os.path.getmtime(self._config_path)
                if current_mtime > self._last_mtime:
                    self._last_mtime = current_mtime
                    self.reload()
            except OSError:
                pass

            self._stop_event.wait(self._debounce_delay)

    def reload(self) -> bool:
        """
        手动重载配置

        Returns:
            是否有变更
        """
        try:
            with open(self._config_path, "r", encoding="utf-8") as f:
                content = f.read()

            new_config = self._parser(content)
            changes = self._diff_configs(self._config, new_config)

            if changes:
                # 保存当前配置到历史
                self._save_to_history()

                old_config = dict(self._config)
                self._config = new_config
                self._version += 1

                # 触发变更事件
                for change in changes:
                    self._emit("change", change)

                self._emit(
                    "reloaded",
                    ConfigReloadEvent(
                        old_config=old_config,
                        new_config=new_config,
                        version=self._version,
                        changes=changes,
                    ),
                )

                self._total_reloads += 1
                return True

            return False

        except Exception as e:
            self._emit("error", e)
            return False

    def _save_to_history(self) -> None:
        """保存配置到历史"""
        self._history[self._version] = dict(self._config)

        # 清理过旧的历史
        while len(self._history) > self._max_history_size:
            self._history.popitem(last=False)

    def _diff_configs(
        self, old: ConfigObject, new: ConfigObject
    ) -> List[ConfigChangeEvent]:
        """比较配置差异"""
        changes = []
        all_keys: Set[str] = set(old.keys()) | set(new.keys())
        timestamp = datetime.now()

        for key in all_keys:
            old_value = old.get(key)
            new_value = new.get(key)

            if json.dumps(old_value, sort_keys=True) != json.dumps(
                new_value, sort_keys=True
            ):
                changes.append(
                    ConfigChangeEvent(
                        key=key,
                        old_value=old_value,
                        new_value=new_value,
                        timestamp=timestamp,
                    )
                )

        return changes

    def rollback(self, target_version: Optional[int] = None) -> bool:
        """
        回滚到指定版本

        Args:
            target_version: 目标版本，默认为上一版本

        Returns:
            是否成功回滚
        """
        version = target_version if target_version is not None else self._version - 1
        config = self._history.get(version)

        if config is None:
            return False

        old_config = dict(self._config)
        self._config = dict(config)

        # 保存回滚前的配置
        self._save_to_history()
        self._version += 1

        self._emit(
            "rollback",
            {
                "from_version": version,
                "to_version": self._version,
                "old_config": old_config,
                "new_config": self._config,
            },
        )

        return True

    def get_config(self) -> ConfigObject:
        """获取当前配置"""
        return dict(self._config)

    def get(self, key: str, default: Any = None) -> Any:
        """获取配置值"""
        return self._config.get(key, default)

    def set(self, key: str, value: ConfigValue) -> None:
        """
        设置配置值（运行时，不持久化）

        Args:
            key: 配置键
            value: 配置值
        """
        old_value = self._config.get(key)
        self._config[key] = value

        self._emit(
            "change",
            ConfigChangeEvent(
                key=key,
                old_value=old_value,
                new_value=value,
            ),
        )

    def get_history(self) -> Dict[int, ConfigObject]:
        """获取版本历史"""
        return dict(self._history)

    def get_version(self) -> int:
        """获取当前版本"""
        return self._version

    def get_stats(self) -> HotReloaderStats:
        """获取统计信息"""
        return HotReloaderStats(
            version=self._version,
            history_size=len(self._history),
            total_reloads=self._total_reloads,
            is_watching=self._watching,
        )

    def is_watching(self) -> bool:
        """是否正在监听"""
        return self._watching

    def clear_history(self) -> None:
        """清空历史"""
        self._history.clear()


# ============================================================================
# Helper Functions
# ============================================================================


def create_hot_reloader(
    config_path: str,
    initial_config: Optional[ConfigObject] = None,
    **kwargs,
) -> HotReloader:
    """创建热加载器"""
    return HotReloader(
        config_path=config_path,
        initial_config=initial_config,
        **kwargs,
    )
