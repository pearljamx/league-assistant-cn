"""Read-only OCR validation for an explicitly supplied local gameplay reference.

Not used by the packaged app. Images stay local and are never included in the repo.
Runs the same pipeline as the app: locate the three cards, OCR the title bands,
and report where the rating badges would be drawn.
"""
import argparse
import json
import time
from unittest.mock import patch
import cv2
import recognizer
from cards import detect_cards

parser = argparse.ArgumentParser()
parser.add_argument('image')
parser.add_argument('dictionary')
parser.add_argument('--expected', nargs=3, required=True)
parser.add_argument('--allow-reference-names', action='store_true', help='Use reference-only names to test OCR of old patches, without adding production statistics')
args = parser.parse_args()
image = cv2.imread(args.image)
if image is None:
    raise SystemExit('Cannot read image')
with open(args.dictionary, encoding='utf-8') as stream:
    dictionary = json.load(stream)
supplemented = []
if args.allow_reference_names:
    for name in args.expected:
        if not any(row['name'] == name for row in dictionary):
            supplemented.append(name)
            dictionary.append({'id': -len(supplemented), 'name': name, 'rarity': 'reference'})
recognizer.get_engine()
for height in (720, 1080, 1440, 2160):
    width = round(image.shape[1] / image.shape[0] * height)
    scaled = cv2.resize(image, (width, height))
    recognizer.LAST_IMAGE = recognizer.LAST_RESULT = None
    started = time.perf_counter()
    regions = detect_cards(scaled)
    if len(regions) != 3:
        raise SystemExit(f'{height}p: located {len(regions)}/3 cards')
    with patch.object(recognizer, 'emit'):
        result = recognizer.scan_cards({'requestId': height, 'dictionary': dictionary}, scaled, regions, 0, {})
    names = [card['name'] for card in result['cards']]
    elapsed = round(time.perf_counter() - started, 3)
    badges = [(slot['centerX'], slot['badgeY']) for slot in result['slots']]
    print(json.dumps({'height': height, 'status': result['status'], 'names': names, 'badges': badges,
                      'seconds': elapsed, 'referenceOnlyNames': supplemented}, ensure_ascii=False))
    if result['status'] != 'recognized' or names != args.expected:
        raise SystemExit('Reference recognition did not match expected names')
