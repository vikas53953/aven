"""Bounded Windows UI Automation worker for IntentGraph.

The parent process sends one JSON request on stdin and receives one JSON
object on stdout.  This worker intentionally does not accept command-line
arguments, shell commands, coordinates, or global keyboard input.
"""

import json
import os
import sys
from typing import Any

MAX_TITLE = 500
MAX_CONTROLS = 100
MAX_TEXT = 2000


def emit(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def fail() -> None:
    # Keep all worker failures generic.  Details can contain process/window
    # data that should not be fed back into an LLM or written to a log.
    emit({"ok": False, "error": "desktop runtime action failed"})


def bounded(value: Any, limit: int) -> str:
    if value is None:
        return ""
    return str(value)[:limit]


def imports():
    if os.name != "nt":
        raise RuntimeError("windows only")
    from pywinauto import Desktop  # type: ignore
    import win32api  # type: ignore
    import win32con  # type: ignore
    import win32gui  # type: ignore
    import win32process  # type: ignore
    return Desktop, win32api, win32con, win32gui, win32process


def process_creation_time(pid: int, win32api: Any, win32con: Any, win32process: Any) -> str:
    handle = win32api.OpenProcess(win32con.PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    try:
        times = win32process.GetProcessTimes(handle)
        # pywin32 returns a mapping on current builds (older builds returned a
        # tuple).  Never use a mapping's keys as the identity value.
        creation = times.get("CreationTime") if isinstance(times, dict) else times[0]
        try:
            return creation.isoformat()
        except Exception:
            try:
                return str(int(creation))
            except Exception:
                return bounded(creation, 200)
    finally:
        try:
            win32api.CloseHandle(handle)
        except Exception:
            pass


def window_metadata(window: Any, win32api: Any, win32con: Any, win32gui: Any, win32process: Any) -> dict[str, Any]:
    hwnd = int(window.handle)
    _thread_id, pid = win32process.GetWindowThreadProcessId(hwnd)
    title = bounded(window.window_text(), MAX_TITLE)
    class_name = bounded(win32gui.GetClassName(hwnd), 300)
    return {
        "hwnd": hwnd,
        "pid": int(pid),
        "processCreationTime": process_creation_time(int(pid), win32api, win32con, win32process),
        "title": title,
        "className": class_name,
    }


def desktop_window(request: dict[str, Any], Desktop: Any, win32api: Any, win32con: Any, win32gui: Any, win32process: Any) -> tuple[Any, dict[str, Any]]:
    wanted = request.get("window")
    if not isinstance(wanted, dict):
        raise RuntimeError("window required")
    hwnd = int(wanted["hwnd"])
    pid = int(wanted["pid"])
    windows = Desktop(backend="uia").windows(top_level_only=True)
    candidate = next((item for item in windows if int(item.handle) == hwnd), None)
    if candidate is None or not win32gui.IsWindow(hwnd) or not win32gui.IsWindowVisible(hwnd):
        raise RuntimeError("window unavailable")
    actual = window_metadata(candidate, win32api, win32con, win32gui, win32process)
    if actual["pid"] != pid or str(actual["processCreationTime"]) != str(wanted.get("processCreationTime", "")):
        raise RuntimeError("window identity changed")
    if actual["title"] != bounded(wanted.get("title"), MAX_TITLE):
        raise RuntimeError("window title changed")
    return candidate, actual


def control_kind(control: Any) -> str:
    return bounded(getattr(control.element_info, "control_type", ""), 100)


def control_title(control: Any) -> str:
    try:
        return bounded(control.window_text(), MAX_TITLE)
    except Exception:
        return ""


def control_metadata(control: Any, depth: int) -> dict[str, Any]:
    info = control.element_info
    try:
        enabled = bool(control.is_enabled())
    except Exception:
        enabled = False
    try:
        visible = bool(control.is_visible())
    except Exception:
        visible = False
    return {
        "controlKind": control_kind(control),
        "title": control_title(control),
        "automationId": bounded(getattr(info, "automation_id", ""), 200),
        "className": bounded(getattr(info, "class_name", ""), 300),
        "enabled": enabled,
        "visible": visible,
        "depth": depth,
    }


def bounded_controls(window: Any) -> list[tuple[Any, int]]:
    # Breadth-first traversal is deliberately capped at each level.  It gives
    # the caller useful UIA metadata without dumping the selected app's full
    # contents into the service or the model.
    result: list[tuple[Any, int]] = []
    frontier: list[tuple[Any, int]] = [(window, 0)]
    while frontier and len(result) < MAX_CONTROLS:
        parent, depth = frontier.pop(0)
        if depth >= 3:
            continue
        try:
            children = parent.children()
        except Exception:
            children = []
        for child in children[:MAX_CONTROLS - len(result)]:
            result.append((child, depth + 1))
            frontier.append((child, depth + 1))
            if len(result) >= MAX_CONTROLS:
                break
    return result


def target_matches(control: Any, target: dict[str, Any]) -> bool:
    if control_kind(control) != bounded(target.get("controlKind"), 100):
        return False
    if control_title(control) != bounded(target.get("title"), MAX_TITLE):
        return False
    info = control.element_info
    wanted_automation_id = bounded(target.get("automationId"), 200)
    wanted_class_name = bounded(target.get("className"), 300)
    if wanted_automation_id and bounded(getattr(info, "automation_id", ""), 200) != wanted_automation_id:
        return False
    if wanted_class_name and bounded(getattr(info, "class_name", ""), 300) != wanted_class_name:
        return False
    return True


def target_control(window: Any, target: dict[str, Any]) -> Any:
    if not isinstance(target, dict) or not bounded(target.get("controlKind"), 100):
        raise RuntimeError("control required")
    matches = [control for control, _depth in bounded_controls(window) if target_matches(control, target)]
    if len(matches) != 1:
        raise RuntimeError("control must match exactly one element")
    return matches[0]


def artifact_path(value: Any, directory: Any) -> str:
    requested = os.path.realpath(os.path.abspath(str(value or "")))
    root = os.path.realpath(os.path.abspath(str(directory or "")))
    if not requested.startswith(root + os.sep) or not requested.lower().endswith(".png"):
        raise RuntimeError("artifact path is invalid")
    os.makedirs(root, exist_ok=True)
    return requested


def main(request: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise RuntimeError("request invalid")
    Desktop, win32api, win32con, win32gui, win32process = imports()
    operation = request.get("operation")
    if operation == "windows":
        windows = []
        for item in Desktop(backend="uia").windows(top_level_only=True):
            try:
                hwnd = int(item.handle)
                if not win32gui.IsWindow(hwnd) or not win32gui.IsWindowVisible(hwnd):
                    continue
                windows.append(window_metadata(item, win32api, win32con, win32gui, win32process))
            except Exception:
                continue
            if len(windows) >= MAX_CONTROLS:
                break
        return {"ok": True, "windows": windows}

    window, actual = desktop_window(request, Desktop, win32api, win32con, win32gui, win32process)
    if operation == "select":
        return {"ok": True, "window": actual}
    if operation == "inspect":
        output = artifact_path(request.get("screenshotPath"), request.get("artifactDirectory"))
        controls = [control_metadata(item, depth) for item, depth in bounded_controls(window)]
        window.capture_as_image().save(output)
        return {"ok": True, "window": actual, "controls": controls, "screenshotPath": output}
    if operation in ("preview", "execute"):
        kind = request.get("kind")
        if kind not in ("click", "fill"):
            raise RuntimeError("action kind invalid")
        if kind == "fill" and (not isinstance(request.get("text"), str) or len(request["text"]) > MAX_TEXT):
            raise RuntimeError("action text invalid")
        if kind == "click" and request.get("text") is not None:
            raise RuntimeError("click text invalid")
        control = target_control(window, request.get("control"))
        detail = control_metadata(control, 0)
        if operation == "preview":
            return {"ok": True, "detail": {"window": actual, "control": detail, "kind": kind}}
        if kind == "click":
            # Invoke uses the UIA control contract and never sends a global
            # key or an arbitrary coordinate click.
            invoke = getattr(control, "invoke", None)
            if not callable(invoke):
                raise RuntimeError("control cannot be invoked")
            invoke()
        else:
            set_edit_text = getattr(control, "set_edit_text", None)
            if not callable(set_edit_text):
                raise RuntimeError("control cannot receive bounded text")
            set_edit_text(request["text"])
        return {"ok": True, "result": {"kind": kind, "control": detail}}
    raise RuntimeError("operation invalid")


def run() -> None:
    try:
        line = sys.stdin.readline(1024 * 1024 + 1)
        if not line or len(line) > 1024 * 1024:
            raise RuntimeError("request invalid")
        request = json.loads(line)
        emit(main(request))
    except Exception:
        fail()


if __name__ == "__main__":
    run()
