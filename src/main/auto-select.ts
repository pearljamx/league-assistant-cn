import type { AutoSelectSettings } from "../shared/types";

/** 自动选人/禁用/抢备选席的单步计划。只看当前会话，不发请求；执行前由调用方再核对。 */
export type AutoStep =
  | {
      kind: "pick" | "ban";
      actionId: number;
      championId: number;
      /** true 表示提交锁定；false 只预选/预禁（亮出英雄但不确认）。 */
      complete: boolean;
    }
  | { kind: "card"; actionId: number; championId: number }
  | { kind: "bench"; championId: number };

export const autoSelectDefaults: AutoSelectSettings = {
  pick: false,
  pickChampions: [],
  ban: false,
  banChampions: [],
  lock: false,
  lockDelayMs: 3000,
  bench: false,
  benchChampions: [],
};

const valid = (id: unknown): id is number =>
  Number.isInteger(id) && (id as number) > 0;

/** 本人当前进行中的选人或禁用动作。 */
function activeAction(session: any, type: "pick" | "ban") {
  return (session?.actions ?? [])
    .flat()
    .find(
      (action: any) =>
        Number.isInteger(action?.id) &&
        action.actorCellId === session.localPlayerCellId &&
        action.type === type &&
        action.isInProgress === true &&
        action.completed === false,
    );
}

/** 已经禁用或已被其他人锁定/预选的英雄，以及我方队友想选的英雄（不禁队友想玩的）。 */
function taken(session: any) {
  const banned = new Set<number>(),
    picked = new Set<number>(),
    allyIntent = new Set<number>();
  for (const id of [
    ...(session?.bans?.myTeamBans ?? []),
    ...(session?.bans?.theirTeamBans ?? []),
  ])
    if (valid(id)) banned.add(id);
  for (const action of (session?.actions ?? []).flat())
    if (action?.type === "ban" && action.completed && valid(action.championId))
      banned.add(action.championId);
  for (const member of [
    ...(session?.myTeam ?? []),
    ...(session?.theirTeam ?? []),
  ]) {
    if (member?.cellId === session?.localPlayerCellId) continue;
    if (valid(member?.championId)) picked.add(member.championId);
  }
  for (const member of session?.myTeam ?? [])
    if (
      member?.cellId !== session?.localPlayerCellId &&
      valid(member?.championPickIntent)
    )
      allyIntent.add(member.championPickIntent);
  for (const action of (session?.actions ?? []).flat())
    if (
      action?.type === "pick" &&
      action.actorCellId !== session?.localPlayerCellId &&
      action.completed &&
      valid(action.championId)
    )
      picked.add(action.championId);
  return { banned, picked, allyIntent };
}

export interface PlanInput {
  session: any;
  settings: AutoSelectSettings;
  mode: "rift" | "aram" | "hex";
  /** 客户端返回的可选/可禁英雄，未知时传 null（不过滤）。 */
  pickable: number[] | null;
  bannable: number[] | null;
  /** 大乱斗英雄卡片（BAN_PICK 阶段本人卡片），非卡片阶段为空。 */
  cards: number[];
  /** 当前可以直接交换的备选席英雄（已排除需等待的队友英雄）。 */
  swappable: number[];
  /** 本人当前英雄，0 表示还没有。 */
  current: number;
}

/**
 * 计算下一步。规则：
 * - 峡谷：本人禁用回合按列表预禁第一个可禁英雄（不禁队友想选的）；选人回合预选第一个可选英雄。
 *   打开“自动锁定”时，已预选的同一英雄由调用方延时后提交锁定（complete=true）。
 * - 大乱斗卡片：卡片本身即确认，只有打开“自动锁定”才自动拿列表里的卡片。
 * - 备选席：列表里优先级高于当前英雄的可交换英雄才交换。
 */
export function planAutoSelect(input: PlanInput): AutoStep | null {
  const { session, settings, mode } = input;
  if (mode === "aram" || mode === "hex") {
    if (
      settings.pick &&
      settings.lock &&
      !input.current &&
      input.cards.length
    ) {
      const id = settings.pickChampions.find((champion) =>
        input.cards.includes(champion),
      );
      const action = (session?.actions ?? [])
        .flat()
        .find(
          (item: any) =>
            Number.isInteger(item?.id) &&
            item.actorCellId === session.localPlayerCellId &&
            item.type === "pick" &&
            item.completed === false,
        );
      if (id && action)
        return { kind: "card", actionId: action.id, championId: id };
    }
    if (settings.bench && input.current && input.swappable.length) {
      const rank = (id: number) => {
        const index = settings.benchChampions.indexOf(id);
        return index < 0 ? Infinity : index;
      };
      const best = input.swappable
        .filter((id) => rank(id) < rank(input.current))
        .sort((a, b) => rank(a) - rank(b))[0];
      if (best) return { kind: "bench", championId: best };
    }
    return null;
  }
  const { banned, picked, allyIntent } = taken(session);
  const ban = activeAction(session, "ban");
  if (ban && settings.ban) {
    if (valid(ban.championId) && settings.banChampions.includes(ban.championId))
      return settings.lock
        ? {
            kind: "ban",
            actionId: ban.id,
            championId: ban.championId,
            complete: true,
          }
        : null;
    const id = settings.banChampions.find(
      (champion) =>
        !banned.has(champion) &&
        !picked.has(champion) &&
        !allyIntent.has(champion) &&
        (!input.bannable || input.bannable.includes(champion)),
    );
    return id
      ? { kind: "ban", actionId: ban.id, championId: id, complete: false }
      : null;
  }
  const pick = activeAction(session, "pick");
  if (pick && settings.pick) {
    if (
      valid(pick.championId) &&
      settings.pickChampions.includes(pick.championId)
    )
      return settings.lock
        ? {
            kind: "pick",
            actionId: pick.id,
            championId: pick.championId,
            complete: true,
          }
        : null;
    if (valid(pick.championId)) return null; // 用户已自己预选其他英雄，不覆盖。
    const id = settings.pickChampions.find(
      (champion) =>
        !banned.has(champion) &&
        !picked.has(champion) &&
        (!input.pickable || input.pickable.includes(champion)),
    );
    return id
      ? { kind: "pick", actionId: pick.id, championId: id, complete: false }
      : null;
  }
  return null;
}
