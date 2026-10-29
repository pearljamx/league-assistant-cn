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
