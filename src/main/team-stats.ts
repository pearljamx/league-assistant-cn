import type { Match, Mode } from "../shared/types";

export interface RecentSummary {
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
}
const modeLabel: Record<Mode, string> = {
  hex: "海克斯",
  aram: "大乱斗",
  rift: "峡谷",
};
export function sameMode(match: Match, mode: Mode) {
  return mode === "hex"
    ? match.mode === "KIWI"
    : mode === "aram"
      ? match.mode === "ARAM"
      : ["CLASSIC", "SWIFTPLAY"].includes(match.mode);
}
/** 只统计同模式、非私密、非重开且超过 4 分钟的对局。 */
export function summarize(
  matches: Match[],
  puuid: string,
  mode: Mode,
): RecentSummary {
  const summary = { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
  for (const match of matches) {
    if (match.private || match.remake || match.duration < 240) continue;
    if (!sameMode(match, mode)) continue;
    const self = match.players.find((player) => player.puuid === puuid);
    if (!self) continue;
    summary.games++;
    if (self.win) summary.wins++;
    summary.kills += self.kills;
    summary.deaths += self.deaths;
    summary.assists += self.assists;
  }
  return summary;
}
/** 一行一名玩家，控制在客户端聊天单条长度内。缺失数据写明，不估算。 */
export function statsLine(
  label: string,
  summary: RecentSummary | null,
  mode: Mode,
) {
  const name = label.slice(0, 40);
  if (!summary) return `${name}：战绩暂不可用`;
  if (!summary.games) return `${name}：近期无${modeLabel[mode]}对局`;
  const rate = Math.round((summary.wins / summary.games) * 100);
  const kda =
    (summary.kills + summary.assists) / Math.max(1, summary.deaths);
  const avg = (value: number) => (value / summary.games).toFixed(1);
  return `${name}：近${summary.games}场${modeLabel[mode]} ${summary.wins}胜${summary.games - summary.wins}负 ${rate}% · KDA ${kda.toFixed(1)}（${avg(summary.kills)}/${avg(summary.deaths)}/${avg(summary.assists)}）`;
}
