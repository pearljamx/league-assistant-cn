import type {
  AramggChampion,
  ItemOption,
  Recommendation,
  SkillOption,
} from "../../shared/types";

/** 常见鞋子装备编号：用于把 aramgg 核心装里的鞋子单独列出。 */
const boots = new Set([
  1001, 2422, 3005, 3006, 3009, 3010, 3013, 3020, 3047, 3111, 3117, 3158,
]);

const keyNumber: Record<string, number> = { Q: 1, W: 2, E: 3, R: 4 };

/** 技能主升顺序：Q/W/E 谁先点满 5 级谁在前；没点满的按点数排在后面。 */
export function skillPriority(order: number[]): number[] {
  const points = new Map<number, number>(),
    maxed: number[] = [];
  for (const skill of order) {
    if (skill === 4) continue;
    const next = (points.get(skill) ?? 0) + 1;
    points.set(skill, next);
    if (next === 5) maxed.push(skill);
  }
  const rest = [1, 2, 3]
    .filter((skill) => !maxed.includes(skill))
    .sort((a, b) => (points.get(b) ?? 0) - (points.get(a) ?? 0));
  return [...maxed, ...rest];
}

/**
 * 极地大乱斗出装：aramgg 的流派数据来自 iesdev 的嚎哭深渊（队列 450）全球统计。
 * 只取第一套流派（场次最多），保留真实场次与胜率；aramgg 不提供符文，标明缺失。
 */
export function recommendationFromAramgg(
  data: AramggChampion,
): Recommendation | null {
  const build = data.builds[0];
  if (!build) return null;
  const option = (row: {
    ids: number[];
    games: number | null;
    winRate: number | null;
    pickRate: number | null;
  }): ItemOption => ({
    ids: row.ids,
    games: row.games,
    winRate: row.winRate,
    pickRate: row.pickRate,
  });
  const core = build.core.map(option);
  const shoes = [
    ...new Set(
      [...build.core, ...build.situational]
        .flatMap((row) => row.ids)
        .filter((id) => boots.has(id)),
    ),
  ];
  const skills: SkillOption[] = build.skills.map((row) => {
    const order = row.keys.map((key) => keyNumber[key]).filter(Boolean);
    return {
      order,
      priority: skillPriority(order),
      games: row.games,
      winRate: row.winRate,
      pickRate: null,
    };
  });
  return {
    source: {
      id: "aramgg",
      name: "aramgg · 极地大乱斗全球统计",
      url: "https://aramgg.com/",
      mode: "aram",
      patch: data.source.gamePatch,
      date: data.source.date,
      band: null,
      license: null,
      stale: data.source.stale,
    },
    championId: data.championId,
    position: "ALL",
    starting: build.starting.map(option),
    boots: shoes.length
      ? [{ ids: shoes.slice(0, 1), games: null, winRate: null, pickRate: null }]
      : [],
    core: core.map((row) => ({
      ...row,
      ids: row.ids.filter((id) => !boots.has(id)),
    })),
    later: build.situational
      .filter((row) => !row.ids.every((id) => boots.has(id)))
      .slice(0, 6)
      .map(option),
    runes: [],
    skills,
    spells: build.spells.map((row) => ({
      ids: row.ids,
      names: row.names,
      games: row.games,
      winRate: row.winRate,
      pickRate: row.pickRate,
    })),
    unavailable: ["aramgg 未提供极地大乱斗符文统计；未混用峡谷或海克斯数据。"],
  };
}
