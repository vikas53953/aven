"""Strict, read-only Nornir/Netmiko worker for IntentGraph.

The parent process sends one JSON request on stdin and receives one JSON object
on stdout. Credentials are accepted only in that request, kept in memory for
one task, and never included in a response. Every task uses an explicit
Nornir inventory containing one host and a single-worker runner. The command
catalog is deliberately finite so this worker cannot perform configuration
writes or arbitrary shell commands.
"""

import json
import os
import re
import stat
import sys
from pathlib import Path
from typing import Any

from nornir.core import Nornir
from nornir.core.inventory import Host, Inventory
from nornir.core.task import Result, Task
from nornir.plugins.runners import ThreadedRunner

try:
    from netmiko import ConnectHandler  # type: ignore
except Exception:  # pragma: no cover - exercised when the bundled runtime is incomplete
    ConnectHandler = None  # type: ignore[assignment]


MAX_OUTPUT = 200000
MAX_REQUEST = 1024 * 1024
TRANSPORT = "nornir-netmiko"
GENERIC_ERROR = "network runtime action failed"

# Both transports use this versioned literal-command catalog.
COMMANDS = {platform: set(commands) for platform, commands in json.loads(
    (Path(__file__).resolve().parent.parent / "network-commands.json").read_text(encoding="utf-8")
).items()}


def emit(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def fail(*, submitted: bool = False, status: str | None = None) -> None:
    """Emit a bounded failure without exception, path, or credential details."""

    response: dict[str, Any] = {"ok": False, "error": GENERIC_ERROR}
    if submitted:
        response["submitted"] = True
        response["status"] = "UNKNOWN"
        response["transport"] = TRANSPORT
    elif status:
        response["status"] = status
        response["transport"] = TRANSPORT
    emit(response)


def _valid_host(value: Any) -> bool:
    if not isinstance(value, str) or not value or len(value) > 253 or any(char.isspace() for char in value):
        return False
    candidate = value[1:-1] if value.startswith("[") and value.endswith("]") else value
    if not re.fullmatch(r"[A-Za-z0-9_.:-]+", candidate) or ".." in candidate:
        return False
    return True


def _known_hosts(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 4096:
        raise RuntimeError("known hosts unavailable")
    # A symlink can change its target between validation and the SSH call. The
    # JS facade already resolves paths inside the managed root; this worker
    # keeps its own strict regular-file check for direct invocation as well.
    if os.path.islink(value):
        raise RuntimeError("known hosts unavailable")
    try:
        mode = os.stat(value).st_mode
    except Exception:
        raise RuntimeError("known hosts unavailable") from None
    if not stat.S_ISREG(mode) or not os.path.isfile(value):
        raise RuntimeError("known hosts unavailable")
    return value


def _validate(request: dict[str, Any]) -> tuple[dict[str, Any], str, str, str]:
    if not isinstance(request, dict) or request.get("operation") != "read":
        raise RuntimeError("operation invalid")
    profile = request.get("profile")
    if not isinstance(profile, dict) or isinstance(profile, list):
        raise RuntimeError("profile invalid")

    platform = profile.get("platform")
    command = request.get("command")
    if not isinstance(platform, str) or platform not in COMMANDS:
        raise RuntimeError("command not allowed")
    if not isinstance(command, str) or command not in COMMANDS[platform]:
        raise RuntimeError("command not allowed")
    if "\n" in command or "\r" in command or any(token in command for token in ("|", ";", "&", "`", "$", "<", ">")):
        raise RuntimeError("command not allowed")

    password = request.get("password")
    if not isinstance(password, str) or not password:
        raise RuntimeError("credential unavailable")

    host = profile.get("host")
    if not _valid_host(host):
        raise RuntimeError("host invalid")
    try:
        port = int(profile.get("port", 22))
    except Exception:
        raise RuntimeError("port invalid") from None
    if port < 1 or port > 65535:
        raise RuntimeError("port invalid")

    username = profile.get("username")
    if not isinstance(username, str) or not username or len(username) > 200 or any(char in username for char in ("\r", "\n")):
        raise RuntimeError("username invalid")
    known_hosts = _known_hosts(profile.get("knownHosts"))

    connection_profile = {
        "host": host,
        "port": port,
        "platform": platform,
        "username": username,
        "knownHosts": known_hosts,
    }
    return connection_profile, command, password, platform


def _read_task(task: Task, *, command: str, password: str, known_hosts: str) -> Result:
    """Run exactly one read-only command through a real Netmiko connection."""

    connection = None
    submitted = False
    try:
        if ConnectHandler is None:
            raise RuntimeError("netmiko unavailable")

        connection = ConnectHandler(
            device_type=task.host.platform,
            host=task.host.hostname,
            port=task.host.port,
            username=task.host.username,
            password=task.host.password,
            ssh_strict=True,
            system_host_keys=False,
            alt_host_keys=True,
            alt_key_file=known_hosts,
            fast_cli=False,
            conn_timeout=10,
            auth_timeout=10,
            banner_timeout=10,
        )

        # A send attempt may have reached the device even when Netmiko raises
        # before returning output. Report that state as UNKNOWN to prevent a
        # caller from treating a post-submission error as a safe retry.
        submitted = True
        output = connection.send_command(command, read_timeout=20)
        if not isinstance(output, str) or len(output) > MAX_OUTPUT:
            raise RuntimeError("output invalid")
        # Do not let a device echo a credential back through the worker.
        if password and password in output:
            raise RuntimeError("output invalid")
        return Result(host=task.host, result=output, changed=False, failed=False, transport=TRANSPORT)
    except Exception:
        return Result(
            host=task.host,
            result=None,
            changed=False,
            failed=True,
            submitted=submitted,
            status="UNKNOWN" if submitted else "FAILED",
            transport=TRANSPORT,
        )
    finally:
        try:
            if connection is not None:
                connection.disconnect()
        except Exception:
            pass


def main(request: dict[str, Any]) -> dict[str, Any]:
    connection_profile, command, password, platform = _validate(request)
    host = Host(
        name="target",
        hostname=connection_profile["host"],
        port=connection_profile["port"],
        username=connection_profile["username"],
        password=password,
        platform=platform,
        data={"transport": TRANSPORT, "known_hosts": connection_profile["knownHosts"]},
    )
    inventory = Inventory(hosts={host.name: host})
    nornir = Nornir(inventory=inventory, runner=ThreadedRunner(num_workers=1))
    aggregate = nornir.run(task=_read_task, command=command, password=password, known_hosts=connection_profile["knownHosts"])
    results = aggregate.get(host.name)
    if not results or len(results) != 1 or not isinstance(results[0], Result):
        raise RuntimeError("network result invalid")
    result = results[0]
    if result.failed:
        submitted = bool(getattr(result, "submitted", False))
        return {
            "ok": False,
            "error": GENERIC_ERROR,
            "submitted": submitted,
            "status": "UNKNOWN" if submitted else "FAILED",
            "transport": TRANSPORT,
        }
    output = result.result
    if not isinstance(output, str) or len(output) > MAX_OUTPUT or (password and password in output):
        raise RuntimeError("network result invalid")
    return {"ok": True, "output": output, "transport": TRANSPORT}


def run() -> None:
    try:
        line = sys.stdin.readline(MAX_REQUEST + 1)
        if not line or len(line) > MAX_REQUEST:
            raise RuntimeError("request invalid")
        request = json.loads(line)
        emit(main(request))
    except Exception:
        fail()


if __name__ == "__main__":
    run()
