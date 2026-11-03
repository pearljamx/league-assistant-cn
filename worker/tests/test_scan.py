"""Frame freshness and capture-state tests. No screen access or model inference."""
import pathlib
import sys
import unittest
from unittest.mock import Mock, patch
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import recognizer
from cards import detect_cards

DICTIONARY = [{'id': i + 1, 'name': name} for i, name in enumerate(['坦克引擎', '钢化你心', '秘术冲拳', '小蜜蜂'])]
CENTERS = (.315, .5, .685)


def card_frame(width=1280, height=720):
    """Synthetic frame: bright scene with three dark card panels (BGRA like mss)."""
    frame = np.zeros((height, width, 4), dtype=np.uint8)
    frame[..., :3] = (150, 120, 100)
    for center in CENTERS:
        x0, x1 = int((center - .072) * width), int((center + .072) * width)
        frame[int(.17 * height):int(.65 * height), x0:x1, :3] = (28, 24, 18)
    return frame


def title_rows(names):
    """Fake OCR output for the stacked title canvas: one row per tile."""
    def run(canvas):
        tile = (canvas.shape[0] - 32) / 3
        rows = []
        for index, name in enumerate(names):
            y = index * (tile + 16) + tile / 2
            rows.append([[[10, y - 10], [90, y - 10], [90, y + 10], [10, y + 10]], name, .99])
        return rows, None
    return run


class ScanTest(unittest.TestCase):
    def setUp(self):
        recognizer.LAST_IMAGE = recognizer.LAST_RESULT = recognizer.LAST_CONTEXT = None
        self.frame = card_frame()
        self.bounds = {'left': 0, 'top': 0, 'width': 1280, 'height': 720}
        self.capture = Mock()
        self.capture.monitors = [
            {'left': -1920, 'top': 0, 'width': 3840, 'height': 1080},
            {'left': 0, 'top': 0, 'width': 1920, 'height': 1080},
        ]
        self.capture.grab.side_effect = lambda region: self.frame
        self.engine = Mock(side_effect=title_rows(['坦克引擎', '钢化你心', '秘术冲拳']))
        self.patches = [patch.object(recognizer, 'foreground_game', side_effect=lambda: self.bounds),
                        patch.object(recognizer, 'get_engine', return_value=self.engine),
                        patch.object(recognizer, 'emit')]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        self.command = {'context': 'hero-202', 'requestId': 1, 'dictionary': DICTIONARY, 'monitor': 0}

    def scan(self, **kwargs):
        return recognizer.scan({**self.command, **kwargs}, self.capture)

    def test_cards_are_recognized_with_positions(self):
        result = self.scan()
        self.assertEqual(result['status'], 'recognized')
        self.assertEqual([card['id'] for card in result['cards']], [1, 2, 3])
        self.assertEqual([slot['id'] for slot in result['slots']], [1, 2, 3])
        for slot, center in zip(result['slots'], CENTERS):
            self.assertAlmostEqual(slot['centerX'], center, delta=.01)
            self.assertTrue(slot['top'] < slot['badgeY'] < slot['bottom'])
        self.assertEqual(self.engine.call_count, 1)

    def test_no_cards_skips_ocr(self):
        self.frame[..., :3] = (150, 120, 100)
        result = self.scan()
        self.assertEqual(result['status'], 'idle')
        self.assertEqual(result['slots'], [])
        self.engine.assert_not_called()

    def test_identical_card_pixels_can_reuse_verified_result(self):
        self.scan()
        self.frame[5, 5, :3] = 200  # 背景动画不触发重新识别
        result = self.scan()
        self.assertEqual(result['status'], 'recognized')
        self.assertEqual(self.engine.call_count, 1)

    def test_one_pixel_card_change_forces_recognition(self):
        self.scan()
        self.frame[300, 400, :3] = 29
        self.engine.side_effect = title_rows(['小蜜蜂', '钢化你心', '秘术冲拳'])
        result = self.scan(requestId=2)
        self.assertEqual([card['id'] for card in result['cards']], [4, 2, 3])
        self.assertEqual(self.engine.call_count, 2)

    def test_unmatched_card_is_uncertain_but_keeps_positions(self):
        self.engine.side_effect = title_rows(['坦克引擎', '看不清', '秘术冲拳'])
        result = self.scan()
        self.assertEqual(result['status'], 'uncertain')
        self.assertEqual([slot['id'] for slot in result['slots']], [1, None, 3])
        # 第二张卡标题不匹配时会对整张卡再识别一次。
        self.assertEqual(self.engine.call_count, 2)

    def test_failed_recognition_cannot_pair_new_frame_with_old_cards(self):
        self.scan()
        self.frame[300, 400, :3] = 29
        self.engine.side_effect = RuntimeError('model interrupted')
        with self.assertRaises(RuntimeError):
            self.scan(requestId=2)
        self.assertIsNone(recognizer.LAST_RESULT)
        self.engine.side_effect = title_rows(['小蜜蜂', '钢化你心', '秘术冲拳'])
        result = self.scan(requestId=3)
        self.assertEqual([card['id'] for card in result['cards']], [4, 2, 3])

    def test_manual_scan_without_cards_falls_back_to_central_ocr(self):
        self.frame[..., :3] = (150, 120, 100)
        self.engine.side_effect = None
        self.engine.return_value = ([[[[x, 80], [x + 100, 80], [x + 100, 105], [x, 105]], name, .99]
                                     for x, name in zip([50, 350, 650], ['坦克引擎', '钢化你心', '秘术冲拳'])], None)
        self.assertEqual(self.scan()['status'], 'idle')
        result = self.scan(force=True)
        self.assertEqual(result['status'], 'recognized')
        self.assertEqual(result['slots'], [])

    def test_cached_cards_follow_window_moving_between_monitors(self):
        self.scan()
        self.bounds['left'] = -1920
        result = self.scan()
        self.assertEqual(result['gameWindow']['x'], -1920)
        self.assertEqual(self.engine.call_count, 1)

    def test_invalid_monitor_clears_previous_result(self):
        self.scan()
        self.assertEqual(self.scan(monitor=3)['status'], 'error')
        self.assertIsNone(recognizer.LAST_RESULT)

    def test_window_outside_selected_monitor_clears_previous_result(self):
        self.scan()
        self.bounds['left'] = -1920
        self.assertEqual(self.scan(monitor=1)['status'], 'idle')
        self.assertIsNone(recognizer.LAST_RESULT)

    def test_non_game_foreground_clears_previous_result(self):
        self.scan()
        self.bounds = None
        result = self.scan()
        self.assertEqual(result['status'], 'idle')
        self.assertEqual(result['cards'], [])
        self.assertIsNone(recognizer.LAST_RESULT)

    def test_context_change_forces_recognition(self):
        self.scan()
        self.scan(context='hero-22')
        self.assertEqual(self.engine.call_count, 2)


class CardDetectionTest(unittest.TestCase):
    def test_detects_three_cards_at_common_resolutions(self):
        for width, height in ((1280, 720), (1920, 1080), (3840, 2160)):
            regions = detect_cards(card_frame(width, height)[..., :3])
            self.assertEqual(len(regions), 3, (width, height))
            for region, center in zip(regions, CENTERS):
                self.assertAlmostEqual(region['centerX'], center, delta=.01)

    def test_uneven_or_misaligned_panels_are_not_cards(self):
        frame = card_frame()[..., :3].copy()
        frame[int(.17 * 720):int(.65 * 720), int(.613 * 1280):int(.757 * 1280)] = (150, 120, 100)
        frame[int(.30 * 720):int(.78 * 720), int(.62 * 1280):int(.76 * 1280)] = (28, 24, 18)
        self.assertLess(len(detect_cards(frame)), 3)

    def test_dark_full_frame_is_not_cards(self):
        self.assertEqual(detect_cards(np.full((720, 1280, 3), 20, dtype=np.uint8)), [])


if __name__ == '__main__':
    unittest.main()
