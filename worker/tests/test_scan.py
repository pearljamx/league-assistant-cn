"""Frame freshness and capture-state tests. No screen access or model inference."""
import pathlib
import sys
import unittest
from unittest.mock import Mock, patch
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import recognizer

DICTIONARY = [{'id': i + 1, 'name': name} for i, name in enumerate(['坦克引擎', '钢化你心', '秘术冲拳', '小蜜蜂'])]


def rows(first=0):
    return [[[[x, 80], [x + 100, 80], [x + 100, 105], [x, 105]], DICTIONARY[index]['name'], .99]
            for x, index in zip([50, 350, 650], [first, 1, 2])]


class ScanTest(unittest.TestCase):
    def setUp(self):
        recognizer.LAST_IMAGE = recognizer.LAST_RESULT = recognizer.LAST_CONTEXT = None
        self.frame = np.full((480, 900, 4), 40, dtype=np.uint8)
        self.bounds = {'left': 0, 'top': 0, 'width': 1250, 'height': 706}
        self.capture = Mock()
        self.capture.monitors = [
            {'left': -1920, 'top': 0, 'width': 3840, 'height': 1080},
            {'left': 0, 'top': 0, 'width': 1920, 'height': 1080},
        ]
        self.capture.grab.side_effect = lambda region: self.frame
        self.engine = Mock(return_value=(rows(), None))
        self.patches = [patch.object(recognizer, 'foreground_game', side_effect=lambda: self.bounds),
                        patch.object(recognizer, 'get_engine', return_value=self.engine),
                        patch.object(recognizer, 'emit')]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        self.command = {'context': 'hero-202', 'requestId': 1, 'dictionary': DICTIONARY, 'monitor': 0}

    def scan(self, **kwargs):
        return recognizer.scan({**self.command, **kwargs}, self.capture)

    def test_identical_pixels_can_reuse_verified_result(self):
        self.scan()
        result = self.scan()
        self.assertEqual(result['status'], 'recognized')
        self.assertEqual(self.engine.call_count, 1)

    def test_one_pixel_card_change_forces_recognition(self):
        self.scan()
        self.frame[90, 50, :3] = 41
        self.engine.return_value = (rows(3), None)
        result = self.scan(requestId=2)
        self.assertEqual([card['id'] for card in result['cards']], [4, 2, 3])
        self.assertEqual(self.engine.call_count, 2)

    def test_failed_recognition_cannot_pair_new_frame_with_old_cards(self):
        self.scan()
        self.frame[:80, :, :3] = 200
        self.engine.side_effect = RuntimeError('model interrupted')
        with self.assertRaises(RuntimeError):
            self.scan(requestId=2)
        self.assertIsNone(recognizer.LAST_RESULT)
        self.engine.side_effect = None
        self.engine.return_value = (rows(3), None)
        result = self.scan(requestId=3)
        self.assertEqual([card['id'] for card in result['cards']], [4, 2, 3])

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


if __name__ == '__main__':
    unittest.main()
