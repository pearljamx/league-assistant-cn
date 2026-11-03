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

from matching import choose_cards, match_title
from cards import crop, detect_cards

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


def ocr_rows(image):
    """Run OCR on a BGR image; returns [(box, text, confidence)]."""
    if image.size == 0:
        return []
    with contextlib.redirect_stdout(sys.stderr):
        result, _ = get_engine()(image)
    return result or []


# 标题在卡片高度约 34%–60% 的位置（图标在上、描述在下），只识别这一条带。
TITLE_BAND = (.34, .60)


def read_titles(image, regions):
    """OCR the three title bands in one call; returns each card's rows top to bottom.

    三条标题带上下拼成一张图再识别：OCR 检测会把短边放大到 736 像素，
    横向长条会被放大好几倍，拼成接近方形后耗时稳定在零点几秒。
    """
    import numpy as np
    tiles = [crop(image, region, *TITLE_BAND)[0] for region in regions]
    gap = 16
    width = max(tile.shape[1] for tile in tiles)
    height = sum(tile.shape[0] for tile in tiles) + gap * (len(tiles) - 1)
    canvas = np.zeros((height, width, 3), dtype=np.uint8)
    spans, y = [], 0
    for tile in tiles:
        canvas[y:y + tile.shape[0], :tile.shape[1]] = tile
        spans.append((y, y + tile.shape[0]))
        y += tile.shape[0] + gap
    groups = [[] for _ in regions]
    for box, text, confidence in ocr_rows(canvas):
        if confidence < .6:
            continue
        center = sum(point[1] for point in box) / len(box)
        for index, (top, bottom) in enumerate(spans):
            if top <= center < bottom:
                groups[index].append((center, text))
                break
    return [[text for _, text in sorted(group)] for group in groups]


def read_card(image, region):
    """Fallback: OCR the whole card when its title band did not match."""
    part, _ = crop(image, region, .05, .95)
    rows = [row for row in ocr_rows(part) if row[2] >= .6]
    return [text for _, text in sorted((sum(p[1] for p in box) / len(box), text) for box, text, _ in rows)]


def scan_cards(command, image, regions, monitor_id, game_window):
    """Recognize the three located cards; results keep each card's position."""
    global LAST_IMAGE, LAST_RESULT
    # 只比较三张卡自身的像素：背景里的地图动画不会触发重复识别，
    # 任何一张卡的标题、图标或刷新变化都会让字节不同而重新识别。
    signature = json.dumps(regions).encode() + b''.join(crop(image, region)[0].tobytes() for region in regions)
    if LAST_IMAGE == signature and LAST_RESULT is not None:
        LAST_RESULT = {**LAST_RESULT, 'gameWindow': game_window, 'monitor': monitor_id}
        return LAST_RESULT
    LAST_IMAGE = LAST_RESULT = None
    emit({'event': 'changed', 'requestId': command.get('requestId'), 'gameWindow': game_window})
    dictionary = command.get('dictionary', [])
    titles = read_titles(image, regions)
    matches = [match_title(texts, dictionary) for texts in titles]
    for index, region in enumerate(regions):
        if matches[index]:
            continue
        # 整卡兜底读到的名字若和其他卡重复，说明读到的不是本卡标题，宁可留空。
        found = match_title(read_card(image, region), dictionary)
        if found and all(not match or match['id'] != found['id'] for match in matches):
            matches[index] = found
    found = [match for match in matches if match]
    recognized = len(found) == 3 and len({match['id'] for match in found}) == 3
    status = 'recognized' if recognized else 'uncertain'
    message = '已识别三选一 · 已在卡片上标注' if recognized else '有卡片未可靠识别，请按 F6 重试或手动纠正'
    LAST_IMAGE = signature
    LAST_RESULT = {
        'status': status, 'message': message, 'monitor': monitor_id, 'gameWindow': game_window,
        'cards': [{**match, 'slot': index} for index, match in enumerate(matches) if match],
        'slots': [{**region, 'id': match['id'] if match else None} for region, match in zip(regions, matches)],
    }
    return LAST_RESULT


def scan_legacy(command, image, monitor_id, game_window):
    """Manual F6 fallback when no card panels were located: OCR the central area."""
    global LAST_IMAGE, LAST_RESULT
    height, width = image.shape[:2]
    roi = image[int(height * .16):int(height * .16) + int(height * .68), int(width * .14):int(width * .14) + int(width * .72)]
    pixels = roi.tobytes()
    if LAST_IMAGE == pixels and LAST_RESULT is not None:
        LAST_RESULT = {**LAST_RESULT, 'gameWindow': game_window, 'monitor': monitor_id}
        return LAST_RESULT
    LAST_IMAGE = LAST_RESULT = None
    emit({'event': 'changed', 'requestId': command.get('requestId'), 'gameWindow': game_window})
    status, cards = choose_cards(ocr_rows(roi), command.get('dictionary', []), roi.shape[1], roi.shape[0])
    message = {'recognized': '已识别三选一 · 按当前英雄统计推荐', 'uncertain': '选项未可靠识别，请按 F6 重试或手动纠正', 'idle': '等待海克斯三选一画面'}[status]
    LAST_IMAGE = pixels
    LAST_RESULT = {'status': status, 'message': message, 'cards': cards, 'slots': [], 'monitor': monitor_id,
                   'gameWindow': game_window}
    return LAST_RESULT


def scan(command, sct):
    global LAST_IMAGE, LAST_RESULT, LAST_CONTEXT
    import numpy as np
    if command.get('context') != LAST_CONTEXT:
        LAST_IMAGE = LAST_RESULT = None
        LAST_CONTEXT = command.get('context')
    bounds = foreground_game()
    if not bounds:
        LAST_IMAGE = LAST_RESULT = None
        return {'status': 'idle', 'message': '请将无边框或窗口模式的英雄联盟对局置于前台', 'cards': [], 'slots': []}
    monitor_id = int(command.get('monitor', 0))
    if monitor_id < 0 or monitor_id >= len(sct.monitors):
        LAST_IMAGE = LAST_RESULT = None
        return {'status': 'error', 'message': '所选显示器已断开，请在设置中重新选择', 'cards': [], 'slots': []}
    if monitor_id:
        monitor = sct.monitors[monitor_id]
        overlap = min(bounds['left'] + bounds['width'], monitor['left'] + monitor['width']) - max(bounds['left'], monitor['left'])
        overlap_y = min(bounds['top'] + bounds['height'], monitor['top'] + monitor['height']) - max(bounds['top'], monitor['top'])
        if overlap <= 0 or overlap_y <= 0:
            LAST_IMAGE = LAST_RESULT = None
            return {'status': 'idle', 'message': '对局窗口不在所选显示器上', 'cards': [], 'slots': [], 'monitor': monitor_id}
    # 截取整个游戏画面（只在内存中处理），卡片位置按画面比例返回给悬浮窗。
    image = np.asarray(sct.grab(dict(bounds)))[:, :, :3]
    if image.max() < 8:
        LAST_IMAGE = LAST_RESULT = None
        return {'status': 'error', 'message': '截屏为黑屏，请使用无边框或窗口模式', 'cards': [], 'slots': []}
    game_window = {'x': bounds['left'], 'y': bounds['top'], 'width': bounds['width'], 'height': bounds['height']}
    regions = detect_cards(image)
    if len(regions) == 3:
        return scan_cards(command, image, regions, monitor_id, game_window)
    if command.get('force'):
        return scan_legacy(command, image, monitor_id, game_window)
    # 没有三张卡就不做 OCR：自动检测平时只花一次截图和一次像素统计。
    LAST_IMAGE = LAST_RESULT = None
    return {'status': 'idle', 'message': '等待海克斯三选一画面', 'cards': [], 'slots': [],
            'monitor': monitor_id, 'gameWindow': game_window}


def main():
    global LAST_IMAGE, LAST_RESULT
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
                LAST_IMAGE = LAST_RESULT = None
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
