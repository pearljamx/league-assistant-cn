import { expect, it } from "vitest";
import {
  recommendationFromAramgg,
  skillPriority,
} from "../src/main/providers/aramgg-recommend";

it("技能主升按先点满 5 级的顺序", () => {
  // Q E W Q Q R Q E Q E R E E W W R W W
  const order = [1, 3, 2, 1, 1, 4, 1, 3, 1, 3, 4, 3, 3, 2, 2, 4, 2, 2];
  expect(skillPriority(order)).toEqual([1, 3, 2]);
  expect(skillPriority([1, 2, 3])).toEqual([1, 2, 3]);
});

it("极地大乱斗出装来自 aramgg 第一套流派，鞋子单列，标明来源与缺失的符文", () => {
  const rec = recommendationFromAramgg({
    source: {
      name: "aramgg",
      gamePatch: "16.21",
      dataVersion: "16.21.3",
      date: "2026-10-29",
      stale: false,
    },
    championId: 68,
    tier: 1,
    winRate: 0.52,
    pickRate: 0.1,
    augments: [],
    trios: [],
    builds: [
      {
        tags: "AP",
        games: 14239,
        winRate: 0.52,
        pickRate: 0.9,
        core: [
          {
            ids: [6653, 3020, 4645],
            names: [],
            games: 900,
            winRate: 0.55,
            pickRate: 0.2,
          },
        ],
        starting: [
          {
            ids: [1056, 2003],
            names: [],
            games: 5000,
            winRate: 0.5,
            pickRate: 0.4,
          },
        ],
        situational: [
          { ids: [3165], names: [], games: 300, winRate: 0.53, pickRate: 0.1 },
          { ids: [3006], names: [], games: 50, winRate: 0.4, pickRate: 0.01 },
        ],
        spells: [
          {
            ids: [4, 32],
            names: ["闪现", "雪球"],
            games: 9000,
            winRate: 0.52,
            pickRate: 0.7,
          },
        ],
        skills: [
          {
            keys: ["Q", "E", "W", "Q", "Q", "R", "Q", "E", "Q"],
            games: 3000,
            winRate: 0.54,
          },
        ],
      },
    ],
  } as any)!;
  expect(rec.source).toMatchObject({
    id: "aramgg",
    mode: "aram",
    patch: "16.21",
  });
  expect(rec.core[0].ids).toEqual([6653, 4645]);
  expect(rec.boots[0].ids).toEqual([3020]);
  expect(rec.later.map((row) => row.ids)).toEqual([[3165]]);
  expect(rec.starting[0]).toMatchObject({ ids: [1056, 2003], games: 5000 });
  expect(rec.skills[0].priority).toEqual([1, 3, 2]);
  expect(rec.spells![0].names).toEqual(["闪现", "雪球"]);
  expect(rec.runes).toEqual([]);
  expect(rec.unavailable[0]).toContain("符文");
  expect(recommendationFromAramgg({ builds: [] } as any)).toBeNull();
});

it("符文按基石定主系、副系取两行最常选，缺格时不拼", async () => {
  const { runePageFromStats } = await import(
    "../src/main/providers/aramgg-recommend"
  );
  const styles = [
    {
      id: 8000,
      slots: [
        [8005, 8008],
        [9101, 9111],
        [9104, 9103],
        [8014, 8017],
      ],
    },
    { id: 8100, slots: [[8112], [8126, 8139], [8136, 8120], [8135, 8105]] },
    { id: 8200, slots: [[8214], [8224, 8226], [8210, 8234], [8237, 8236]] },
  ];
  const r = (id: number, pickRate: number) => ({
    id,
    tree: null,
    games: 10,
    pickRate,
    winRate: 0.5,
  });
  const stats = {
    games: 1000,
    keystones: [r(8005, 0.2), r(8008, 0.7)],
    runes: [
      r(9111, 0.8),
      r(9103, 0.6),
      r(8014, 0.9),
      r(8139, 0.5),
      r(8135, 0.4),
      r(8226, 0.3),
      r(8236, 0.1),
    ],
    shards: {
      offense: [r(5005, 0.6)],
      flex: [r(5008, 0.9)],
      defense: [r(5001, 0.7), r(5011, 0.2)],
    },
  };
  const page = runePageFromStats(stats, styles)!;
  expect(page).toMatchObject({
    primaryStyleId: 8000,
    subStyleId: 8100,
    winRate: null,
    pickRate: 0.7,
    games: 1000,
  });
  expect(page.perks).toEqual([
    8008, 9111, 9103, 8014, 8139, 8135, 5005, 5008, 5001,
  ]);
  expect(
    runePageFromStats(
      { ...stats, shards: { ...stats.shards, flex: [] } },
      styles,
    ),
  ).toBeNull();
  expect(runePageFromStats(null, styles)).toBeNull();
});
