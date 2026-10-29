import type { PlayerTag } from "../../shared/types";
// 界面共用的显示格式。缺失值统一显示为“—”，不补造数字。
export const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : (value * 100).toFixed(1) + "%";
export const ratio = (wins: number, games: number) =>
  games ? `${((wins / games) * 100).toFixed(0)}%` : "—";
export const count = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "未提供"
    : n >= 10000
      ? (n / 10000).toFixed(1) + "万"
      : n.toLocaleString("zh-CN");
export const date = (raw: string | null | undefined) =>
  raw
    ? new Date(raw).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
export const duration = (seconds: number | null) =>
  seconds === null
    ? "—"
    : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export const rarityName = (raw: string) =>
  ({ silver: "白银", gold: "黄金", prismatic: "棱彩" })[raw] || raw;
export const tierName = (tier: string) =>
  ({
    IRON: "黑铁",
    BRONZE: "青铜",
    SILVER: "白银",
    GOLD: "黄金",
    PLATINUM: "铂金",
    EMERALD: "翡翠",
    DIAMOND: "钻石",
    MASTER: "大师",
    GRANDMASTER: "宗师",
    CHALLENGER: "最强王者",
  })[tier] || "未定级";
export const phaseNames: Record<string, string> = {
  None: "空闲",
  Lobby: "组队大厅",
  Matchmaking: "正在寻找对局",
  ReadyCheck: "确认对局",
  ChampSelect: "英雄选择",
  GameStart: "正在载入",
  InProgress: "对局进行中",
  EndOfGame: "对局结束",
  Reconnect: "等待重连",
  WaitingForStats: "等待结算",
};
export const modes = [
  { id: "rift", name: "召唤师峡谷" },
  { id: "aram", name: "极地大乱斗" },
  { id: "hex", name: "海克斯大乱斗" },
] as const;
export const modeName = (id: string) =>
  modes.find((mode) => mode.id === id)?.name ?? "对局";
export const positions = [
  { id: "ALL", name: "常见分路" },
  { id: "TOP", name: "上路" },
  { id: "JUNGLE", name: "打野" },
  { id: "MIDDLE", name: "中路" },
  { id: "BOTTOM", name: "下路" },
  { id: "SUPPORT", name: "辅助" },
] as const;
/** 先按队列号识别，未知的新队列再按游戏模式（国服新队列号会变化）。 */
export const matchMode = (match: { queueId: number; mode: string }) =>
  (
    ({
      2400: "海克斯大乱斗",
      450: "极地大乱斗",
      420: "单双排",
      440: "灵活排位",
      430: "匹配",
      400: "征召匹配",
    }) as Record<number, string>
  )[match.queueId] ||
  (
    {
      KIWI: "海克斯大乱斗",
      ARAM: "极地大乱斗",
      CLASSIC: "召唤师峡谷",
    } as Record<string, string>
  )[match.mode] ||
  "对局";
const rankedQueues = [420, 440];
export const queueGroups = [
  { id: "all", name: "全部", test: () => true },
  {
    id: "hex",
    name: "海克斯",
    test: (match: { mode: string }) => match.mode === "KIWI",
  },
  {
    id: "aram",
    name: "极地大乱斗",
    test: (match: { mode: string }) => match.mode === "ARAM",
  },
  {
    id: "ranked",
    name: "排位",
    test: (match: { queueId: number }) => rankedQueues.includes(match.queueId),
  },
  {
    id: "rift",
    name: "峡谷其他",
    test: (match: { queueId: number; mode: string }) =>
      ["CLASSIC", "SWIFTPLAY"].includes(match.mode) &&
      !rankedQueues.includes(match.queueId),
  },
] as const;
export const playerTagNames: Record<PlayerTag, string> = {
  good: "好队友",
  watch: "需留意",
  avoid: "不想再遇",
  friend: "朋友",
};
export const playerTagList = (Object.keys(playerTagNames) as PlayerTag[]).map(
  (id) => ({ id, name: playerTagNames[id] }),
);
