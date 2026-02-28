"""Shell execution tool.

SECURITY MODEL:
By default, uses a restrictive allowlist that blocks most commands.
To enable more commands, either:
1. Pass explicit allow_patterns to allow specific commands
2. Set require_confirmation=False and use deny_patterns for a more permissive mode
3. Use mode="permissive" for legacy behavior (not recommended for production)

For production use, always use the default restrictive mode with explicit allowlist.
"""

import asyncio
import logging
import os
import re
import shlex
import shutil
import warnings
from enum import Enum
from pathlib import Path
from typing import Any, Callable

from nanobot.agent.tools.base import Tool

logger = logging.getLogger(__name__)


class ExecMode(str, Enum):
    """Execution mode for the shell tool.

    SECURITY WARNING: PERMISSIVE mode is deprecated and will be removed in a future version.
    It exposes the system to arbitrary command execution. Use RESTRICTIVE mode with
    explicit allow_patterns instead.
    """
    RESTRICTIVE = "restrictive"  # Default: deny all unless in allowlist
    PERMISSIVE = "permissive"    # DEPRECATED: allow all unless in denylist


# Default allowlist for restrictive mode - safe, read-only commands
DEFAULT_SAFE_COMMANDS = [
    r"^echo\s+",                    # echo (safe output)
    r"^pwd$",                       # print working directory
    r"^whoami$",                    # current user
    r"^date$",                      # current date
    r"^uname(\s+-a)?$",             # system info
    r"^ls(\s|$)",                   # list directory
    r"^cat\s+",                     # read file (no sudo)
    r"^head\s+",                    # read file head
    r"^tail\s+",                    # read file tail
    r"^wc(\s|$)",                   # word count
    r"^grep(\s|$)",                 # search text
    r"^find\s+",                    # find files (read-only)
    r"^git\s+status",               # git status
    r"^git\s+log",                  # git log
    r"^git\s+branch",               # git branch
    r"^git\s+diff",                 # git diff
    r"^git\s+show",                 # git show
    r"^python3?\s+--version$",      # python version
    r"^node\s+--version$",          # node version
    r"^npm\s+--version$",           # npm version
    r"^pip3?\s+--version$",         # pip version
]

# Dangerous patterns that are ALWAYS blocked, even in permissive mode
ALWAYS_BLOCKED_PATTERNS = [
    # System destruction
    r"\brm\s+-[rf]{1,2}\b",             # rm -rf, rm -fr
    r"\brm\s+/",                         # rm / (root deletion)
    r"\brm\s+\*",                        # rm * (wildcard deletion)
    r"\bdel\s+/[sqa]\b",                 # Windows delete
    r"\brmdir\s+/[sqa]\b",               # Windows rmdir
    r"(?:^|[;&|]\s*)format\b",           # format command
    r"\b(mkfs|diskpart)\b",              # disk operations
    r"\bdd\s+if=",                       # dd (disk dump)
    r">\s*/dev/sd",                      # write to disk device
    r">\s*/dev/hd",                      # write to IDE disk

    # System control
    r"\b(shutdown|reboot|poweroff|halt|init\s+[06])\b",  # system power

    # Privilege escalation
    r"\bsudo\b",                         # sudo
    r"\bsu\s",                           # su
    r"\bchmod\s+[0-7]*777",              # world-writable
    r"\bchown\b",                        # change ownership

    # Fork bombs and resource exhaustion
    r":\(\)\s*\{.*\};\s*:",             # fork bomb
    r"\bmkfifo\b",                       # named pipes

    # Network exfiltration (in permissive mode)
    r"\bcurl\s+.*[;&|]",                 # curl with command chaining
    r"\bwget\s+.*[;&|]",                 # wget with command chaining
    r"\bnc\s+.*-[el]",                   # netcat listen mode
    r"\bncat\s+.*--",                    # ncat with options

    # Shell injection patterns
    r"\$\(.*\)",                         # command substitution $()
    r"`[^`]+`",                          # backtick command substitution
    r"\|\s*sh\b",                        # pipe to shell
    r"\|\s*bash\b",                      # pipe to bash
    r"\|\s*python",                      # pipe to python
    r"\|\s*perl\b",                      # pipe to perl
    r"\|\s*ruby\b",                      # pipe to ruby

    # Encoded/obfuscated commands
    r"\\x[0-9a-fA-F]{2}",                # hex encoded
    r"\\[0-7]{3}",                       # octal encoded
    r"base64\s+-d",                      # base64 decode

    # Shell operators - BLOCK these entirely rather than falling back to shell mode
    # This prevents shell injection attacks via the create_subprocess_shell fallback
    r"\s*\|\s*",                         # pipe operator (blocks command chaining)
    r"&&",                               # AND operator
    r"\|\|",                             # OR operator
    r";\s*\S",                           # semicolon followed by another command
    r">\s*[^&]",                         # output redirect (not >>)
    r"^\s*&\s*$",                        # background process (& alone)
]


class ExecTool(Tool):
    """Tool to execute shell commands with security guardrails.

    SECURITY:
    - Default mode is RESTRICTIVE: only explicitly allowed commands can run
    - Always blocks dangerous patterns regardless of mode
    - Logs all command attempts for audit
    """

    def __init__(
        self,
        timeout: int = 60,
        working_dir: str | None = None,
        deny_patterns: list[str] | None = None,
        allow_patterns: list[str] | None = None,
        restrict_to_workspace: bool = False,
        mode: ExecMode = ExecMode.RESTRICTIVE,
        require_confirmation: bool = False,
        confirmation_callback: Callable[[str], bool] | None = None,
    ):
        self.timeout = timeout
        self.working_dir = working_dir
        self.mode = mode
        self.require_confirmation = require_confirmation
        self.confirmation_callback = confirmation_callback

        # SECURITY: Permissive mode is disabled for security reasons
        if mode == ExecMode.PERMISSIVE:
            raise ValueError(
                "PERMISSIVE mode has been DISABLED for security. "
                "It exposed the system to arbitrary command execution. "
                "Use RESTRICTIVE mode with explicit allow_patterns instead."
            )

        # Always blocked patterns (cannot be overridden)
        self.always_blocked = ALWAYS_BLOCKED_PATTERNS

        # Mode-specific patterns (only RESTRICTIVE mode is allowed now)
        # Restrictive: use allowlist (default to safe commands)
        self.allow_patterns = allow_patterns if allow_patterns is not None else DEFAULT_SAFE_COMMANDS
        self.deny_patterns = []  # Not used in restrictive mode

        self.restrict_to_workspace = restrict_to_workspace

    @property
    def name(self) -> str:
        return "exec"

    @property
    def description(self) -> str:
        return "Execute a shell command and return its output. Mode: restrictive. Use with caution."

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute"
                },
                "working_dir": {
                    "type": "string",
                    "description": "Optional working directory for the command"
                }
            },
            "required": ["command"]
        }

    async def execute(self, command: str, working_dir: str | None = None, **kwargs: Any) -> str:
        cwd = working_dir or self.working_dir or os.getcwd()

        # Log all command attempts for security audit
        logger.info(f"ExecTool command attempt: {command[:100]}... (cwd={cwd})")

        guard_error = self._guard_command(command, cwd)
        if guard_error:
            logger.warning(f"ExecTool blocked command: {guard_error}")
            return guard_error

        # Human-in-the-loop confirmation for dangerous operations
        if self.require_confirmation and self.confirmation_callback:
            if not self.confirmation_callback(command):
                logger.warning(f"ExecTool command rejected by user: {command[:50]}...")
                return "Error: Command rejected by user confirmation"

        try:
            # SECURITY: Use exec instead of shell when possible for better isolation
            # For simple commands, split and use exec to avoid shell injection vectors
            cmd_parts = shlex.split(command)

            # Check if we can safely use exec mode (single command, no shell operators)
            shell_operators = ['|', '&&', '||', ';', '>', '>>', '<', '&', '$(', '`']
            use_exec = not any(op in command for op in shell_operators)

            if use_exec and cmd_parts:
                # Resolve command to absolute path for additional safety
                cmd_name = cmd_parts[0]
                if not os.path.isabs(cmd_name):
                    resolved = shutil.which(cmd_name)
                    if resolved:
                        cmd_parts[0] = resolved

                process = await asyncio.create_subprocess_exec(
                    *cmd_parts,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=cwd,
                )
            else:
                # SECURITY: Shell operators detected - block command entirely
                # rather than falling back to shell mode which enables injection
                logger.warning(f"ExecTool blocked shell mode attempt: {command[:100]}...")
                return (
                    "Error: Shell operators (|, &&, ||, ;, >, <, &) are not allowed. "
                    "Execute simple commands only. Shell mode is disabled for security."
                )

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=self.timeout
                )
            except asyncio.TimeoutError:
                process.kill()
                # Wait for the process to fully terminate so pipes are
                # drained and file descriptors are released.
                try:
                    await asyncio.wait_for(process.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    pass
                return f"Error: Command timed out after {self.timeout} seconds"

            output_parts = []

            if stdout:
                output_parts.append(stdout.decode("utf-8", errors="replace"))

            if stderr:
                stderr_text = stderr.decode("utf-8", errors="replace")
                if stderr_text.strip():
                    output_parts.append(f"STDERR:\n{stderr_text}")

            if process.returncode != 0:
                output_parts.append(f"\nExit code: {process.returncode}")

            result = "\n".join(output_parts) if output_parts else "(no output)"

            # Truncate very long output
            max_len = 10000
            if len(result) > max_len:
                result = result[:max_len] + f"\n... (truncated, {len(result) - max_len} more chars)"

            logger.info(f"ExecTool command completed: exit_code={process.returncode}")
            return result

        except Exception as e:
            logger.error(f"ExecTool error: {e}")
            return f"Error executing command: {str(e)}"

    def _guard_command(self, command: str, cwd: str) -> str | None:
        """Security guard for shell commands.

        Returns error message if blocked, None if allowed.
        """
        cmd = command.strip()
        lower = cmd.lower()

        # Always check these patterns regardless of mode
        for pattern in self.always_blocked:
            if re.search(pattern, lower, re.IGNORECASE):
                return "Error: Command blocked by safety guard (dangerous pattern detected)"

        if self.mode == ExecMode.RESTRICTIVE:
            # Restrictive mode: only allow explicitly permitted commands
            if not any(re.search(p, cmd, re.IGNORECASE) for p in self.allow_patterns):
                return (
                    "Error: Command blocked by safety guard (not in allowlist). "
                    "Use mode='permissive' with caution if you need more flexibility."
                )
        else:
            # Permissive mode: block patterns in deny list
            for pattern in self.deny_patterns:
                if re.search(pattern, lower, re.IGNORECASE):
                    return "Error: Command blocked by safety guard (dangerous pattern detected)"

        if self.restrict_to_workspace:
            if "..\\" in cmd or "../" in cmd:
                return "Error: Command blocked by safety guard (path traversal detected)"

            cwd_path = Path(cwd).resolve()

            win_paths = re.findall(r"[A-Za-z]:\\[^\\\"']+", cmd)
            # Only match absolute paths — avoid false positives on relative
            # paths like ".venv/bin/python" where "/bin/python" would be
            # incorrectly extracted by the old pattern.
            posix_paths = re.findall(r"(?:^|[\s|>])(/[^\s\"'>]+)", cmd)

            for raw in win_paths + posix_paths:
                try:
                    p = Path(raw.strip()).resolve()
                except Exception:
                    continue
                if p.is_absolute() and cwd_path not in p.parents and p != cwd_path:
                    return "Error: Command blocked by safety guard (path outside working dir)"

        return None
