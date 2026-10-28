"""Synthetic Chinese-card benchmark; never captures the user's screen."""
import contextlib
import json
import pathlib
import sys
import time
from PIL import Image, ImageDraw, ImageFont
import numpy as np
from matching import choose_cards


def benchmark(get_engine):
    names = ['坦克引擎', '钢化你心', '秘术冲拳']
    dictionary = [{'id': index + 1, 'name': name} for index, name in enumerate(names)]
    engine = get_engine()
    reports = []
    for width, height in [(1920, 1080), (2560, 1440), (3840, 2160)]:
        roi_w, roi_h = int(width * .72), int(height * .68)
        image = Image.new('RGB', (roi_w, roi_h), '#152328')
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', int(width / 1920 * 31))
        for index, name in enumerate(names):
            x = int((index + .5) * roi_w / 3)
            text_width = draw.textbbox((0, 0), name, font=font)[2]
            draw.rectangle((int(index * roi_w / 3 + 10), int(roi_h * .12), int((index + 1) * roi_w / 3 - 10), int(roi_h * .86)), fill='#1d3039', outline='#a08851', width=2)
            draw.text((x - text_width / 2, roi_h * .34), name, fill='#f1e9d2', font=font)
        started = time.perf_counter()
        with contextlib.redirect_stdout(sys.stderr):
            result, _ = engine(np.asarray(image)[:, :, ::-1].copy())
        status, cards = choose_cards(result, dictionary, roi_w, roi_h)
        elapsed = time.perf_counter() - started
        reports.append({'resolution': f'{width}x{height}', 'status': status, 'ids': [card['id'] for card in cards], 'seconds': round(elapsed, 3), 'synthetic': True})
    print(json.dumps({'ocr_benchmark': reports}, ensure_ascii=False), flush=True)
    if not all(row['status'] == 'recognized' and row['ids'] == [1, 2, 3] for row in reports):
        raise SystemExit(1)
