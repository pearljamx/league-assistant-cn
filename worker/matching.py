"""Pure matching logic; no screen access or model imports."""
import re
import unicodedata
from difflib import SequenceMatcher


def normalize(text):
    text = unicodedata.normalize('NFKC', str(text))
    return ''.join(c.lower() for c in text if c.isalnum() or '\u4e00' <= c <= '\u9fff')


def match_name(text, dictionary):
    key = normalize(text)
    if len(key) < 2:
        return None
    scored = []
    for entry in dictionary:
        name = normalize(entry['name'])
        score = 1.0 if key == name else SequenceMatcher(None, key, name).ratio()
        if score >= .84 and abs(len(key) - len(name)) <= 2:
            scored.append((score, entry))
    scored.sort(key=lambda item: item[0], reverse=True)
    if not scored or (len(scored) > 1 and scored[0][0] - scored[1][0] < .08):
        return None
    return {**scored[0][1], 'matchConfidence': scored[0][0]}


def match_title(texts, dictionary):
    """Match the OCR rows of one card's title band.

    逐行模糊匹配；不行再看某行是否完整包含某个强化名（只认 3 字以上、
    唯一最长的名字，避免标签行里的短词误配）；最后把多行拼起来再试一次，
    兼容换行的长标题。
    """
    for text in texts:
        found = match_name(text, dictionary)
        if found:
            return {**found, 'text': text}
    for text in texts + [''.join(texts)]:
        key = normalize(text)
        contained = [entry for entry in dictionary if len(normalize(entry['name'])) >= 3 and normalize(entry['name']) in key]
        if contained:
            longest = max(len(normalize(entry['name'])) for entry in contained)
            best = [entry for entry in contained if len(normalize(entry['name'])) == longest]
            if len({entry['id'] for entry in best}) == 1:
                return {**best[0], 'matchConfidence': 1.0, 'text': text}
    joined = ''.join(texts)
    if len(texts) > 1:
        found = match_name(joined, dictionary)
        if found:
            return {**found, 'text': joined}
    return None


def choose_cards(ocr_rows, dictionary, width, height):
    candidates = [[], [], []]
    for row in ocr_rows or []:
        box, text, confidence = row
        if confidence < .65:
            continue
        match = match_name(text, dictionary)
        if not match:
            continue
        x = sum(point[0] for point in box) / len(box)
        y = sum(point[1] for point in box) / len(box)
        column = min(2, max(0, int(x / width * 3)))
        candidates[column].append({**match, 'text': text, 'confidence': confidence, 'y': y})
    if not all(candidates):
        partial = [max(group, key=lambda c: c['confidence'] * c['matchConfidence']) for group in candidates if group]
        return 'uncertain' if partial else 'idle', partial
    cards = [max(group, key=lambda c: c['confidence'] * c['matchConfidence']) for group in candidates]
    if len({card['id'] for card in cards}) != 3 or max(c['y'] for c in cards) - min(c['y'] for c in cards) > height * .13:
        return 'uncertain', cards
    return 'recognized', cards
