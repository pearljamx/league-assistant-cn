"""Locate the three augment cards in a game frame. Pure numpy/OpenCV; no screen access.

海克斯三选一的卡片是金框包住的深色面板。先按 4×4 网格标记深色像素，
再找连通区域，挑出大小、比例、间距和上下对齐都像三张卡的组合。
找不到三张卡时不做 OCR，自动识别因此几乎不占资源。
思路参考太农海克斯助手（经作者授权参考），此处为本项目独立实现。
"""
import cv2
import numpy as np

STEP = 4
# 每个 4×4 网格取 4 个采样点，半数以上是深色就算深色。
SAMPLES = ((2, 2), (1, 1), (2, 1), (1, 2))


def dark_cells(image):
    """Return a boolean grid (rows, cols) of dark 4×4 cells. image is BGR."""
    height, width = image.shape[:2]
    rows, cols = height // STEP, width // STEP
    count = np.zeros((rows, cols), dtype=np.uint8)
    for dx, dy in SAMPLES:
        sample = image[dy::STEP, dx::STEP][:rows, :cols].astype(np.int16)
        blue, green, red = sample[..., 0], sample[..., 1], sample[..., 2]
        luma = red * 0.299 + green * 0.587 + blue * 0.114
        count += ((luma < 62) & (red < 90) & (green < 95) & (blue < 105)).astype(np.uint8)
    return count >= 2


def _components(image):
    height, width = image.shape[:2]
    grid = dark_cells(image)
    rows, cols = grid.shape
    # 只在画面中部找：三选一卡片不会贴边，避免小地图、技能栏等深色区域。
    grid[:round(rows * .10), :] = False
    grid[round(rows * .88):, :] = False
    grid[:, :round(cols * .14)] = False
    grid[:, round(cols * .88):] = False
    count, _, stats, _ = cv2.connectedComponentsWithStats(grid.astype(np.uint8), connectivity=4)
    found = []
    for x, y, w, h, area in stats[1:count]:
        left, top = int(x) * STEP, int(y) * STEP
        right, bottom = min((int(x) + int(w)) * STEP, cols * STEP), min((int(y) + int(h)) * STEP, rows * STEP)
        found.append({'left': left, 'top': top, 'right': right, 'bottom': bottom,
                      'area': int(area) * STEP * STEP})
    return [c for c in found if _looks_like_card(c, width, height)]


def _looks_like_card(component, width, height):
    w = component['right'] - component['left']
    h = component['bottom'] - component['top']
    middle = (component['top'] + component['bottom']) / 2 / height
    return (component['area'] / (width * height) > .012
            and .075 < w / width < .24
            and .28 < h / height < .72
            and .25 < w / max(1, h) < .7
            and .24 < middle < .68)


def _best_three(components, width, height):
    """Pick three evenly spaced, aligned components; None when no combination fits."""
    pool = sorted(components, key=lambda c: c['area'], reverse=True)[:10]
    best, best_score = None, float('-inf')
    for i in range(len(pool)):
        for j in range(i + 1, len(pool)):
            for k in range(j + 1, len(pool)):
                trio = sorted((pool[i], pool[j], pool[k]), key=lambda c: c['left'])
                centers = [(c['left'] + c['right']) / 2 for c in trio]
                spread = (centers[2] - centers[0]) / width
                if not .28 <= spread <= .58:
                    continue
                uneven = abs((centers[1] - centers[0]) - (centers[2] - centers[1])) / width
                tops = (max(c['top'] for c in trio) - min(c['top'] for c in trio)) / height
                bottoms = (max(c['bottom'] for c in trio) - min(c['bottom'] for c in trio)) / height
                # 真实的三张卡等距且上下对齐；差太多的组合直接排除，不只是扣分。
                if uneven > .05 or tops > .05 or bottoms > .05:
                    continue
                score = sum(c['area'] for c in trio) / (width * height) - uneven * 3 - tops * 2 - bottoms * 2
                if score > best_score:
                    best, best_score = trio, score
    return best


def _clamp(value, low, high):
    return max(low, min(high, value))


def detect_cards(image):
    """Return card regions left to right as ratios of the frame.

    Three regions only when a fitting trio exists; otherwise the (at most two)
    card-like components so callers can report progress without running OCR.
    """
    height, width = image.shape[:2]
    if width // STEP < 60 or height // STEP < 40:
        return []
    components = _components(image)
    trio = _best_three(components, width, height) if len(components) >= 3 else None
    chosen = trio or sorted(components, key=lambda c: c['area'], reverse=True)[:2]
    regions = []
    for slot, c in enumerate(sorted(chosen, key=lambda c: c['left'])):
        w = _clamp((c['right'] - c['left']) / width * 1.18, .10, .24)
        h = _clamp((c['bottom'] - c['top']) / height * 1.12, .30, .72)
        center_x = (c['left'] + c['right']) / 2 / width
        center_y = (c['top'] + c['bottom']) / 2 / height
        top, bottom = _clamp(center_y - h / 2, 0, 1), _clamp(center_y + h / 2, 0, 1)
        regions.append({
            'slot': slot,
            'centerX': round(center_x, 4),
            'top': round(top, 4),
            'bottom': round(bottom, 4),
            'width': round(w, 4),
            # 评级徽章放在卡片下部的空白处（描述文字下方）。
            'badgeY': round(_clamp(top + h * .78, .10, .92), 4),
        })
    return regions


def crop(image, region, top_ratio=0.0, bottom_ratio=1.0, widen=1.0):
    """Crop part of a card region (ratios of the card height) in pixels."""
    height, width = image.shape[:2]
    card_h = (region['bottom'] - region['top']) * height
    half = region['width'] * width * widen / 2
    cx = region['centerX'] * width
    x0, x1 = int(_clamp(cx - half, 0, width)), int(_clamp(cx + half, 0, width))
    y0 = int(_clamp(region['top'] * height + card_h * top_ratio, 0, height))
    y1 = int(_clamp(region['top'] * height + card_h * bottom_ratio, 0, height))
    return image[y0:y1, x0:x1], (x0, y0)
