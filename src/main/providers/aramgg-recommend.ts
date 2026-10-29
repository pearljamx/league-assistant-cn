import type { RuneStyle } from "./catalog";
import type {
  AramggChampion,
  AramggRuneStat,
  AramggRuneStats,
  RuneOption,
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
 * 由单项选取率拼出一整页符文：选取率最高的基石定主系，主系三行各取最常选；
 * 副系取两行合计最常选的系别，两行各取最常选；三个碎片各取最常选。
 * 这是“单项最常选的组合”，没有整页胜率，不伪造。缺任何一格时返回 null。
 */
export function runePageFromStats(
  stats: AramggRuneStats | null | undefined,
  styles: RuneStyle[],
): RuneOption | null {
  if (!stats) return null;
  const pick = (rows: AramggRuneStat[], allowed: number[]) =>
    rows
      .filter((row) => allowed.includes(row.id))
      .sort((a, b) => (b.pickRate ?? 0) - (a.pickRate ?? 0))[0];
  const keystones = [...stats.keystones].sort(
    (a, b) => (b.pickRate ?? 0) - (a.pickRate ?? 0),
  );
  for (const keystone of keystones.slice(0, 3)) {
    const primary = styles.find((style) =>
      style.slots[0]?.includes(keystone.id),
    );
    if (!primary || primary.slots.length < 4) continue;
    const main = primary.slots
      .slice(1, 4)
      .map((slot) => pick(stats.runes, slot));
    if (main.some((row) => !row)) continue;
    let secondary: {
      style: RuneStyle;
      rows: AramggRuneStat[];
      score: number;
    } | null = null;
    for (const style of styles) {
      if (style.id === primary.id || style.slots.length < 4) continue;
      const rows = style.slots
        .slice(1, 4)
        .map((slot) => pick(stats.runes, slot))
        .filter((row): row is AramggRuneStat => Boolean(row))
        .sort((a, b) => (b.pickRate ?? 0) - (a.pickRate ?? 0))
        .slice(0, 2);
      if (rows.length < 2) continue;
      const score = rows.reduce((sum, row) => sum + (row.pickRate ?? 0), 0);
      if (!secondary || score > secondary.score)
        secondary = { style, rows, score };
    }
    if (!secondary) continue;
    // 副系两格按客户端的行顺序排列。
    const order = (row: AramggRuneStat) =>
      secondary!.style.slots.findIndex((slot) => slot.includes(row.id));
    const sub = [...secondary.rows].sort((a, b) => order(a) - order(b));
    const top = (rows: AramggRuneStat[]) =>
      [...rows].sort((a, b) => (b.pickRate ?? 0) - (a.pickRate ?? 0))[0]?.id;
    const shards = [
      top(stats.shards.offense),
      top(stats.shards.flex),
      top(stats.shards.defense),
    ];
    if (shards.some((id) => !id)) continue;
    return {
      perks: [
        keystone.id,
        ...main.map((row) => row!.id),
        ...sub.map((row) => row.id),
        ...(shards as number[]),
      ],
      primaryStyleId: primary.id,
      subStyleId: secondary.style.id,
      label: "aramgg · 单项最常选组合",
      winRate: null,
      pickRate: keystone.pickRate,
      games: stats.games,
    };
  }
  return null;
}

/**
 * 极地大乱斗出装：aramgg 的流派数据来自 iesdev 的嚎哭深渊（队列 450）全球统计。
 * 只取第一套流派（场次最多），保留真实场次与胜率；aramgg 不提供符文，标明缺失。
 */
export function recommendationFromAramgg(
  data: AramggChampion,
  styles: RuneStyle[] = [],
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
  // 有完整出装时用完整 6 件，否则退回核心三件。
  const core = (build.full?.length ? build.full : build.core).map(option);
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
    runes: [runePageFromStats(data.runeStats, styles)].filter(
      (rune): rune is RuneOption => Boolean(rune),
    ),
    skills,
    spells: build.spells.map((row) => ({
      ids: row.ids,
      names: row.names,
      games: row.games,
      winRate: row.winRate,
      pickRate: row.pickRate,
    })),
    unavailable: data.runeStats
      ? []
      : [
          "该英雄的 aramgg 符文统计尚未同步，稍后再试；未混用峡谷或海克斯数据。",
        ],
  };
}
