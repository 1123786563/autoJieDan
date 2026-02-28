"""Configuration loading utilities."""

import json
import os
import sys
from pathlib import Path

from nanobot.config.schema import Config


def get_config_path() -> Path:
    """Get the default configuration file path."""
    return Path.home() / ".nanobot" / "config.json"


def get_data_dir() -> Path:
    """Get the nanobot data directory."""
    from nanobot.utils.helpers import get_data_path
    return get_data_path()


def validate_required_secrets() -> None:
    """
    Validate that required secrets are set via environment variables.

    Fails fast with clear error messages if secrets are missing or contain
    placeholder values.

    Security: This prevents accidental deployment with default/placeholder credentials.
    """
    required_secrets = {
        "INTERAGENT_SECRET": "Interagent communication secret (required for Automaton-Nanobot integration)",
    }

    # Only validate if INTERAGENT_SECRET is expected (check if automaton integration is enabled)
    interagent_enabled = os.environ.get("INTERAGENT_ENABLED", "").lower() == "true"

    for secret_name, description in required_secrets.items():
        value = os.environ.get(secret_name)

        # Check if secret is missing
        if not value:
            # Skip validation if interagent is not enabled and this is the interagent secret
            if secret_name == "INTERAGENT_SECRET" and not interagent_enabled:
                continue
            print("ERROR: " + secret_name + " is not set")
            print("  Description: " + description)
            print("  Generate with: openssl rand -hex 32")
            print("  Set via: export " + secret_name + "=$(openssl rand -hex 32)")
            sys.exit(1)

        # Check for placeholder values
        placeholder_patterns = [
            "sk-your-",
            "<GENERATE_WITH:",
            "your-",
            "xxx",
            "CHANGEME",
            "REPLACE_ME",
        ]

        if any(pattern in value.upper() for pattern in placeholder_patterns):
            print("ERROR: " + secret_name + " contains a placeholder value")
            print("  Current value: " + value[:20] + "...")
            print("  Description: " + description)
            print("  Generate with: openssl rand -hex 32")
            print("  Set via: export " + secret_name + "=$(openssl rand -hex 32)")
            sys.exit(1)


def load_config(config_path: Path | None = None) -> Config:
    """
    Load configuration from file or create default.

    Args:
        config_path: Optional path to config file. Uses default if not provided.

    Returns:
        Loaded configuration object.
    """
    path = config_path or get_config_path()

    if path.exists():
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            data = _migrate_config(data)
            return Config.model_validate(data)
        except (json.JSONDecodeError, ValueError) as e:
            print(f"Warning: Failed to load config from {path}: {e}")
            print("Using default configuration.")

    return Config()


def save_config(config: Config, config_path: Path | None = None) -> None:
    """
    Save configuration to file.

    Args:
        config: Configuration to save.
        config_path: Optional path to save to. Uses default if not provided.
    """
    path = config_path or get_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    data = config.model_dump(by_alias=True)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _migrate_config(data: dict) -> dict:
    """Migrate old config formats to current."""
    # Move tools.exec.restrictToWorkspace → tools.restrictToWorkspace
    tools = data.get("tools", {})
    exec_cfg = tools.get("exec", {})
    if "restrictToWorkspace" in exec_cfg and "restrictToWorkspace" not in tools:
        tools["restrictToWorkspace"] = exec_cfg.pop("restrictToWorkspace")
    return data
