import asyncio

import pytest

from nanobot.heartbeat.service import HeartbeatService


# Note: The new HeartbeatService uses virtual tool call approach
# instead of HEARTBEAT_OK_TOKEN parsing.
# See: service.py comment about "unreliable HEARTBEAT_OK token"


@pytest.mark.asyncio
async def test_start_is_idempotent(tmp_path) -> None:
    async def _on_execute(tasks: str) -> str:
        return "Tasks executed"

    service = HeartbeatService(
        workspace=tmp_path,
        provider=None,  # type: ignore
        model="test",
        on_execute=_on_execute,
        interval_s=9999,
        enabled=True,
    )

    await service.start()
    first_task = service._task
    await service.start()

    assert service._task is first_task

    service.stop()
    await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_trigger_now_no_content(tmp_path) -> None:
    async def _on_execute(tasks: str) -> str:
        return "Tasks executed"

    service = HeartbeatService(
        workspace=tmp_path,
        provider=None,  # type: ignore
        model="test",
        on_execute=_on_execute,
        interval_s=9999,
        enabled=True,
    )

    # No HEARTBEAT.md file, should return None
    result = await service.trigger_now()
    assert result is None


@pytest.mark.asyncio
async def test_heartbeat_file_property(tmp_path) -> None:
    service = HeartbeatService(
        workspace=tmp_path,
        provider=None,  # type: ignore
        model="test",
        interval_s=9999,
        enabled=True,
    )

    # Should point to HEARTBEAT.md in workspace
    assert service.heartbeat_file == tmp_path / "HEARTBEAT.md"


