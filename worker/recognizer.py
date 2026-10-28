"""JSON-lines local OCR worker. Captures only a foreground League game window."""
import contextlib
import ctypes
from ctypes import wintypes as w
import json
import os
import sys

for _stream in (sys.stdin, sys.stdout, sys.stderr):
    if _stream is not None and hasattr(_stream, 'reconfigure'):
        _stream.reconfigure(encoding='utf-8', errors='replace')

from matching import choose_cards

ENGINE = None
LAST_IMAGE = None
LAST_RESULT = None
LAST_CONTEXT = None


def emit(message):
    print(json.dumps(message, ensure_ascii=False), flush=True)


def get_engine():
    global ENGINE
    if ENGINE is None:
        with contextlib.redirect_stdout(sys.stderr):
            from rapidocr_onnxruntime import RapidOCR
            ENGINE = RapidOCR(det_use_dml=False, rec_use_dml=False, cls_use_dml=False)
    return ENGINE


def foreground_game():
    if os.name != 'nt':
        return None
    user = ctypes.WinDLL('user32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    user.GetForegroundWindow.restype = w.HWND
    user.GetWindowThreadProcessId.argtypes = [w.HWND, ctypes.POINTER(w.DWORD)]
    user.GetClientRect.argtypes = [w.HWND, ctypes.POINTER(w.RECT)]
    user.ClientToScreen.argtypes = [w.HWND, ctypes.POINTER(w.POINT)]
    kernel.OpenProcess.restype = w.HANDLE
    kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    kernel.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR, ctypes.POINTER(w.DWORD)]
    kernel.CloseHandle.argtypes = [w.HANDLE]
    hwnd = user.GetForegroundWindow()
    if not hwnd:
        return None
    pid = w.DWORD()
    user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    handle = kernel.OpenProcess(0x1000, False, pid.value)
    if not handle:
        return None
    buf = ctypes.create_unicode_buffer(32768)
    size = w.DWORD(len(buf))
    try:
        if not kernel.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)) or os.path.basename(buf.value).lower() != 'league of legends.exe':
            return None
    finally:
        kernel.CloseHandle(handle)
    rect, origin = w.RECT(), w.POINT(0, 0)
    if not user.GetClientRect(hwnd, ctypes.byref(rect)) or not user.ClientToScreen(hwnd, ctypes.byref(origin)):
        return None
    width, height = rect.right - rect.left, rect.bottom - rect.top
    if width < 640 or height < 480:
        return None
    return {'left': origin.x, 'top': origin.y, 'width': width, 'height': height}


def scan(command, sct):
    global LAST_IMAGE, LAST_RESULT, LAST_CONTEXT
    import cv2
    import numpy as np
    if command.get('context') != LAST_CONTEXT:
        LAST_IMAGE = LAST_RESULT = None
        LAST_CONTEXT = command.get('context')
    bounds = foreground_game()
    if not bounds:
        LAST_IMAGE = LAST_RESULT = None
        return {'status': 'idle', 'message': '请将无边框或窗口模式的英雄联盟对局置于前台', 'cards': []}
    monitor_id = int(command.get('monitor', 0))
    if monitor_id and monitor_id >= len(sct.monitors):
        return {'status': 'error', 'message': '所选显示器已断开，请在设置中重新选择', 'cards': []}
    if monitor_id:
        monitor = sct.monitors[monitor_id]
        overlap = min(bounds['left'] + bounds['width'], monitor['left'] + monitor['width']) - max(bounds['left'], monitor['left'])
        overlap_y = min(bounds['top'] + bounds['height'], monitor['top'] + monitor['height']) - max(bounds['top'], monitor['top'])
        if overlap <= 0 or overlap_y <= 0:
            return {'status': 'idle', 'message': '对局窗口不在所选显示器上', 'cards': [], 'monitor': monitor_id}
    region = {'left': bounds['left'] + int(bounds['width'] * .14), 'top': bounds['top'] + int(bounds['height'] * .16), 'width': int(bounds['width'] * .72), 'height': int(bounds['height'] * .68)}
    image = np.asarray(sct.grab(region))[:, :, :3]
    if image.max() < 8:
        LAST_IMAGE = LAST_RESULT = None
        return {'status': 'error', 'message': '截屏为黑屏，请使用无边框或窗口模式', 'cards': []}
    small = cv2.resize(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), (90, 60))
    if LAST_IMAGE is not None and np.mean(cv2.absdiff(small, LAST_IMAGE)) < .8 and LAST_RESULT is not None:
        return LAST_RESULT
    LAST_IMAGE = small
    emit({'event': 'changed'})
    with contextlib.redirect_stdout(sys.stderr):
        result, _ = get_engine()(image)
    status, cards = choose_cards(result, command.get('dictionary', []), image.shape[1], image.shape[0])
    message = {'recognized': '已识别三选一 · 按当前英雄统计推荐', 'uncertain': '选项未可靠识别，请按 F6 重试或手动纠正', 'idle': '等待海克斯三选一画面'}[status]
    LAST_RESULT = {'status': status, 'message': message, 'cards': cards, 'monitor': monitor_id,
                   'gameWindow': {'x': bounds['left'], 'y': bounds['top'], 'width': bounds['width'], 'height': bounds['height']}}
    return LAST_RESULT


def main():
    if os.name == 'nt':
        try:
            ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        except Exception:
            pass
    import mss
    with mss.mss() as sct:
        for line in sys.stdin:
            request_id = None
            try:
                command = json.loads(line)
                request_id = command.get('requestId')
                if command.get('command') == 'displays':
                    displays = [{'id': 0, 'name': '自动跟随游戏窗口', 'width': 0, 'height': 0}]
                    displays += [{'id': i, 'name': f'显示器 {i} · {m["width"]} × {m["height"]} ({m["left"]}, {m["top"]})', 'width': m['width'], 'height': m['height']} for i, m in enumerate(sct.monitors) if i]
                    emit({'requestId': request_id, 'displays': displays})
                elif command.get('command') == 'scan':
                    emit({'requestId': request_id, 'result': scan(command, sct)})
                else:
                    emit({'requestId': request_id, 'result': {'status': 'error', 'message': '未知识别命令', 'cards': []}})
            except Exception:
                emit({'requestId': request_id, 'result': {'status': 'error', 'message': '本地识别未完成，请检查组件安装或重新尝试', 'cards': []}})


if __name__ == '__main__':
    if '--healthcheck' in sys.argv:
        get_engine()
        emit({'ocr_ready': True})
    elif '--selftest' in sys.argv:
        from selftest import benchmark
        benchmark(get_engine)
    else:
        main()
