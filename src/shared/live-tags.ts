/** 实时对局玩家标签：只基于公开 PUUID 的近期战绩、本机遇到记录与本机标记推导，不按英雄或位置猜身份。 */

export interface RecentGame {
  matchId: string;
  /** 该玩家在这局所在队伍。 */
  teamId: number;
  win: boolean;
  /** 是否与当前对局同模式，连胜连败只看同模式。 */
  sameMode: boolean;
}

/** 最近同模式对局的连胜/连败，至少 3 场才算。results 按时间从新到旧。 */
export function streakOf(
  games: RecentGame[],
  minimum = 3,
): { win: boolean; count: number } | null {
  const results = games.filter((game) => game.sameMode).map((game) => game.win);
  if (!results.length) return null;
  let count = 0;
  while (count < results.length && results[count] === results[0]) count++;
  return count >= minimum ? { win: results[0], count } : null;
}

/**
 * 预组队推断：同一支队伍的两名公开玩家在近期战绩中至少 minShared 局同队，视为一组。
 * 返回 puuid → 组号（从 1 开始，按队伍内首次出现顺序）；单人不出现在结果中。
 */
export function premadeGroups(
  players: { puuid: string | null; teamId: number }[],
  histories: Record<string, RecentGame[] | undefined>,
  minShared = 2,
): Record<string, number> {
  const known = players.filter(
    (player): player is { puuid: string; teamId: number } =>
      Boolean(player.puuid && histories[player.puuid]?.length),
  );
  const parent = new Map(known.map((player) => [player.puuid, player.puuid]));
  const root = (id: string): string => {
    const next = parent.get(id)!;
    if (next === id) return id;
    const top = root(next);
    parent.set(id, top);
    return top;
  };
  const teamsOf = (puuid: string) =>
    new Map(histories[puuid]!.map((game) => [game.matchId, game.teamId]));
  const maps = new Map(
    known.map((player) => [player.puuid, teamsOf(player.puuid)]),
  );
  for (let i = 0; i < known.length; i++)
    for (let j = i + 1; j < known.length; j++) {
      const a = known[i],
        b = known[j];
      if (a.teamId !== b.teamId) continue;
      const left = maps.get(a.puuid)!,
        right = maps.get(b.puuid)!;
      let shared = 0;
      for (const [matchId, team] of left)
        if (right.get(matchId) === team) shared++;
      if (shared >= minShared) parent.set(root(a.puuid), root(b.puuid));
    }
  const sizes = new Map<string, number>();
  for (const player of known)
    sizes.set(root(player.puuid), (sizes.get(root(player.puuid)) ?? 0) + 1);
  const numbers = new Map<string, number>();
  const result: Record<string, number> = {};
  for (const player of known) {
    const top = root(player.puuid);
    if ((sizes.get(top) ?? 0) < 2) continue;
    if (!numbers.has(top)) numbers.set(top, numbers.size + 1);
    result[player.puuid] = numbers.get(top)!;
  }
  return result;
}
