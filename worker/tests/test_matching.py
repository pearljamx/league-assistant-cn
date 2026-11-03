import pathlib
import sys
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from matching import normalize, match_name, match_title, choose_cards

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

    def test_title_band_rows(self):
        # 标题行之外还有图标噪声和“伤害/功能”标签行。
        self.assertEqual(match_title(['总No.34', '钢化你心', '伤害', '功能'], DICTIONARY)['id'], 2)
        # 标题和其他字被识别成一行时，按完整包含的最长名字匹配。
        self.assertEqual(match_title(['【坦克引擎】伤害'], DICTIONARY)['id'], 1)
        # 长标题换行时拼起来再匹配。
        self.assertEqual(match_title(['秘术', '冲拳'], DICTIONARY)['id'], 3)
        self.assertIsNone(match_title(['伤害', '功能'], DICTIONARY))
        self.assertIsNone(match_title([], DICTIONARY))

    def test_title_containment_must_be_unique(self):
        names = DICTIONARY + [{'id': 9, 'name': '坦克引擎'}]
        self.assertIsNone(match_title(['【坦克引擎】伤害'], names))

    def test_vertical_alignment(self):
        self.assertEqual(choose_cards([row(20, '坦克引擎'), row(370, '钢化你心', y=400), row(720, '秘术冲拳')], DICTIONARY, 1000, 600)[0], 'uncertain')


if __name__ == '__main__':
    unittest.main()
