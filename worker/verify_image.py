"""Read-only OCR validation for an explicitly supplied local gameplay reference.

Not used by the packaged app. Images stay local and are never included in the repo.
"""
import argparse
import json
import time
import cv2
from recognizer import get_engine
from matching import choose_cards

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
get_engine()
for height in (1080, 1440, 2160):
    width = round(image.shape[1] / image.shape[0] * height)
    scaled = cv2.resize(image, (width, height))
    roi = scaled[int(height*.16):int(height*.16)+int(height*.68), int(width*.14):int(width*.14)+int(width*.72)]
    started = time.perf_counter()
    rows, _ = get_engine()(roi)
    status, cards = choose_cards(rows, dictionary, roi.shape[1], roi.shape[0])
    names = [card['name'] for card in cards]
    elapsed = round(time.perf_counter() - started, 3)
    print(json.dumps({'height': height, 'status': status, 'names': names, 'seconds': elapsed, 'referenceOnlyNames': supplemented}, ensure_ascii=False))
    if status != 'recognized' or names != args.expected:
        raise SystemExit('Reference recognition did not match expected names')
