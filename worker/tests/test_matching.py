import pathlib
import sys
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from matching import normalize, match_name, choose_cards

DICTIONARY = [{'id': 1, 'name': '坦克引擎'}, {'id': 2, 'name': '钢化你心'}, {'id': 3, 'name': '秘术冲拳'}]


def row(x, text, confidence=.99, y=100):
    return [[[x, y], [x + 70, y], [x + 70, y + 25], [x, y + 25]], text, confidence]


class MatchingTest(unittest.TestCase):
    def test_normalization(self):
        self.assertEqual(normalize(' 小蜜蜂！！！ '), '小蜜蜂')

    def test_unknown_or_ambiguous_is_not_guessed(self):
        self.assertIsNone(match_name('完全不同', DICTIONARY))
        self.assertIsNone(match_name('钢化你心', DICTIONARY + [{'id': 4, 'name': '钢化你心！'}]))

    def test_distinct_cards_and_refresh(self):
        status, cards = choose_cards([row(20, '坦克引擎'), row(370, '钢化你心'), row(720, '秘术冲拳')], DICTIONARY, 1000, 600)
        self.assertEqual(status, 'recognized')
        self.assertEqual([c['id'] for c in cards], [1, 2, 3])
        self.assertEqual(choose_cards([], DICTIONARY, 1000, 600)[0], 'idle')

    def test_duplicate_and_low_confidence(self):
        self.assertEqual(choose_cards([row(20, '坦克引擎'), row(370, '坦克引擎'), row(720, '秘术冲拳')], DICTIONARY, 1000, 600)[0], 'uncertain')
        self.assertEqual(choose_cards([row(20, '坦克引擎', .3)], DICTIONARY, 1000, 600)[0], 'idle')

    def test_vertical_alignment(self):
        self.assertEqual(choose_cards([row(20, '坦克引擎'), row(370, '钢化你心', y=400), row(720, '秘术冲拳')], DICTIONARY, 1000, 600)[0], 'uncertain')


if __name__ == '__main__':
    unittest.main()
