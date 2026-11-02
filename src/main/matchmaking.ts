import type { LobbyInfo, MatchSearch } from "../shared/types";

/** 从 /lol-lobby/v2/lobby 读出本人能否开始匹配；字段缺失时按不能开始处理。 */
export function lobbyInfo(raw: any): LobbyInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const local = raw.localMember ?? {};
  const members = Array.isArray(raw.members) ? raw.members.length : 0;
  const custom = raw.gameConfig?.isCustom === true;
  const leader = local.isLeader === true;
  const queueId = Number(raw.gameConfig?.queueId);
  let reason: string | null = null;
  if (custom) reason = "自定义房间请在客户端开始";
  else if (!leader) reason = "只有房主可以开始匹配";
  else if (raw.canStartActivity === false) reason = "房间暂不能开始（成员未就绪或有限制）";
  else if (!Number.isInteger(queueId) || queueId <= 0) reason = "未选择队列";
  return {
    leader,
    members: Math.max(1, members),
    custom,
    canStart: reason === null,
    reason,
  };
}

/** 从 /lol-matchmaking/v1/search 读出排队时间（秒）。 */
export function matchSearch(raw: any): MatchSearch | null {
  if (!raw || typeof raw !== "object") return null;
  const seconds = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.round(value)
      : null;
  const penalty = Array.isArray(raw.errors)
    ? raw.errors.find(
        (item: any) => typeof item?.penaltyTimeRemaining === "number",
      )
    : null;
  return {
    timeInQueue: seconds(raw.timeInQueue),
    estimated: seconds(raw.estimatedQueueTime),
    penalty: penalty ? seconds(penalty.penaltyTimeRemaining) : null,
  };
}

/**
 * 狂暴切换的下一个英雄：按首次出现的顺序循环，跳过当前英雄和暂不可换的。
 * order 会被追加新出现的英雄（原地修改）。
 */
export function nextBerserkChampion(
  order: number[],
  current: number | null,
  available: number[],
): number | null {
  for (const id of [current ?? 0, ...available])
    if (id > 0 && !order.includes(id)) order.push(id);
  const usable = new Set(available.filter((id) => id !== current));
  if (!usable.size) return null;
  const start = current ? order.indexOf(current) : -1;
  for (let step = 1; step <= order.length; step++) {
    const id = order[(start + step + order.length) % order.length];
    if (usable.has(id)) return id;
  }
  return null;
}
