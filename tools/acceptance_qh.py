#!/usr/bin/env python3
"""轻衡安装版点验辅助脚本：截图 / 点击 / 按键，并强制校验前台窗口。

为什么要有前台断言：0.6.1 点验的最后一次点击时用户切到了别的窗口，
坐标就落到了那一边（幸好那里没有写入入口）。键盘鼠标事件是发往"当前前台窗口"的，
脚本以为自己点在轻衡上，实际点在哪完全取决于谁在最前面。所以每次点击前都必须
确认前台句柄就是目标窗口，否则直接拒绝执行。

用法（Windows，需 pywin32 + Pillow）：
    python tools/acceptance_qh.py cap  out.png
    python tools/acceptance_qh.py click 640 320
    python tools/acceptance_qh.py key esc
    python tools/acceptance_qh.py find
    python tools/acceptance_qh.py foreground
    python tools/acceptance_qh.py activate

退出码：0 成功 / 2 参数错误 / 3 前台窗口不是轻衡（已拒绝执行）/ 4 环境缺失 / 5 找不到窗口
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wintypes
import json
import sys

WINDOW_TITLE = "轻衡"
TITLE_MATCH = "轻衡 · AI 减脂管理"

user32 = ctypes.WinDLL("user32", use_last_error=True)
try:
    from PIL import ImageGrab  # type: ignore
except ImportError:  # pragma: no cover - 环境缺依赖时给出可执行的提示
    print("缺少 Pillow：请用项目虚拟环境里的 python 运行本脚本。", file=sys.stderr)
    sys.exit(4)


class RECT(ctypes.Structure):
    _fields_ = [("left", wintypes.LONG), ("top", wintypes.LONG),
                ("right", wintypes.LONG), ("bottom", wintypes.LONG)]


def find_window() -> int:
    """按标题前缀找轻衡主窗口；找不到返回 0。"""
    handle = user32.FindWindowW(None, TITLE_MATCH)
    if handle:
        return handle
    found: list[int] = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def callback(hwnd, _lparam):
        length = user32.GetWindowTextLengthW(hwnd)
        if length:
            buffer = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buffer, length + 1)
            if buffer.value.startswith(WINDOW_TITLE):
                found.append(hwnd)
        return True

    user32.EnumWindows(callback, 0)
    return found[0] if found else 0


def window_rect(handle: int) -> RECT:
    rect = RECT()
    user32.GetWindowRect(handle, ctypes.byref(rect))
    return rect


def foreground() -> dict:
    handle = user32.GetForegroundWindow()
    length = user32.GetWindowTextLengthW(handle)
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(handle, buffer, length + 1)
    return {"hwnd": handle, "title": buffer.value}


def require_target() -> tuple[int, RECT]:
    """确认前台就是轻衡，返回窗口句柄与矩形；否则以退出码 3 结束。"""
    target = find_window()
    if not target:
        print(json.dumps({"error": "找不到轻衡窗口，请先打开应用。"}, ensure_ascii=False))
        sys.exit(5)
    front = foreground()
    if front["hwnd"] != target:
        print(json.dumps({
            "error": "前台窗口不是轻衡，已拒绝执行。请先切回轻衡再重试。",
            "foreground": front,
            "targetHwnd": target,
        }, ensure_ascii=False))
        sys.exit(3)
    return target, window_rect(target)


def do_cap(path: str) -> int:
    _, rect = require_target()
    image = ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom), all_screens=True)
    image.save(path)
    print(json.dumps({"saved": path, "size": [image.width, image.height],
                      "origin": [rect.left, rect.top]}, ensure_ascii=False))
    return 0


def do_click(x: int, y: int) -> int:
    target, rect = require_target()
    screen_x, screen_y = rect.left + x, rect.top + y
    # 再做一次范围校验：坐标必须落在窗口内，避免把点击发到窗口边缘之外。
    if not (rect.left <= screen_x < rect.right and rect.top <= screen_y < rect.bottom):
        print(json.dumps({"error": f"坐标 ({x},{y}) 不在窗口内。"}, ensure_ascii=False))
        return 2
    user32.SetForegroundWindow(target)
    user32.SetCursorPos(screen_x, screen_y)
    user32.mouse_event(0x0002, 0, 0, 0, 0)
    user32.mouse_event(0x0004, 0, 0, 0, 0)
    print(json.dumps({"clicked": [x, y], "screen": [screen_x, screen_y]}, ensure_ascii=False))
    return 0


def do_key(name: str) -> int:
    target, _ = require_target()
    codes = {"esc": 0x1B, "enter": 0x0D, "tab": 0x09, "space": 0x20}
    if name.lower() not in codes:
        print(json.dumps({"error": f"不支持发送热键：{name}"}, ensure_ascii=False))
        return 2
    user32.SetForegroundWindow(target)
    user32.keybd_event(codes[name.lower()], 0, 0, 0)
    user32.keybd_event(codes[name.lower()], 0, 0x0002, 0)
    print(json.dumps({"key": name}, ensure_ascii=False))
    return 0


def do_find() -> int:
    handle = find_window()
    if not handle:
        print(json.dumps({"found": False}, ensure_ascii=False))
        return 5
    rect = window_rect(handle)
    print(json.dumps({"found": True, "hwnd": handle,
                      "rect": [rect.left, rect.top, rect.right, rect.bottom],
                      "foreground": foreground()}, ensure_ascii=False))
    return 0


def do_activate() -> int:
    handle = find_window()
    if not handle:
        print(json.dumps({"found": False}, ensure_ascii=False))
        return 5
    user32.ShowWindow(handle, 9)  # SW_RESTORE
    user32.SetForegroundWindow(handle)
    print(json.dumps({"activated": handle, "foreground": foreground()}, ensure_ascii=False))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="轻衡安装版点验辅助（带前台窗口断言）")
    sub = parser.add_subparsers(dest="command", required=True)

    cap = sub.add_parser("cap", help="截图保存到指定路径")
    cap.add_argument("path")

    click = sub.add_parser("click", help="在窗口内坐标点击（坐标相对窗口左上角）")
    click.add_argument("x", type=int)
    click.add_argument("y", type=int)

    key = sub.add_parser("key", help="发送单个按键")
    key.add_argument("name")

    sub.add_parser("find", help="查找轻衡窗口")
    sub.add_parser("foreground", help="打印当前前台窗口")
    sub.add_parser("activate", help="把轻衡调到前台")

    args = parser.parse_args()
    if args.command == "cap":
        return do_cap(args.path)
    if args.command == "click":
        return do_click(args.x, args.y)
    if args.command == "key":
        return do_key(args.name)
    if args.command == "find":
        return do_find()
    if args.command == "foreground":
        print(json.dumps(foreground(), ensure_ascii=False))
        return 0
    if args.command == "activate":
        return do_activate()
    return 2


if __name__ == "__main__":
    sys.exit(main())
