import { computed, ref } from "vue";
import { api, unwrap } from "./api";
import type {
  Catalog,
  ConnectionState,
  Settings,
  Summoner,
} from "../../shared/types";

// 主窗口共用状态。各页面只通过这里读写设置，避免多份副本互相覆盖。
export type PageId = "history" | "live" | "data" | "automation";
export interface PlayerTarget {
  puuid: string;
  name: string;
  level: number | null;
}
export const page = ref<PageId>("history");
export const state = ref<ConnectionState>({
  status: "searching",
  message: "正在连接",
  phase: "None",
  region: null,
  platform: null,
  mode: "rift",
  queueId: null,
  summoner: null,
  ranked: [],
  championId: null,
  updatedAt: "",
});
export const settings = ref<Settings>({
  autoAccept: false,
  acceptDelayMs: 1000,
  band: "all",
  mode: "rift",
  position: "ALL",
  tier: 255,
  autoRecognize: false,
  monitor: 0,
  overlay: true,
  managedRunePage: null,
});
export const catalog = ref<Catalog>({
  champions: [],
  items: {},
  perks: {},
  version: null,
});
export const catalogError = ref("");
export const champions = computed(
  () =>
    new Map(catalog.value.champions.map((champion) => [champion.id, champion])),
);
export const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function notify(message: string) {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ""), 5000);
}
export async function save(patch: Partial<Settings>) {
  const previous = { ...settings.value };
  settings.value = { ...settings.value, ...patch };
  try {
    settings.value = await unwrap(api.saveSettings(patch));
  } catch (error) {
    settings.value = previous;
    notify((error as Error).message);
  }
}
export async function refreshCatalog() {
  catalogError.value = "";
  try {
    catalog.value = await unwrap(api.getCatalog());
  } catch (error) {
    catalogError.value = (error as Error).message;
  }
}
/** 英雄数据页的当前英雄：默认跟随客户端，手动浏览后保持用户选择。 */
export const dataHero = ref<{ id: number | null; follow: boolean }>({
  id: null,
  follow: true,
});
export function browseHero(id: number, navigate = false) {
  dataHero.value = { id, follow: false };
  if (navigate) page.value = "data";
}
export function followClientHero() {
  dataHero.value = { id: state.value.championId, follow: true };
}
/** 战绩页的玩家标签：本人标签固定在最前（"self"），其他玩家按打开顺序排列。 */
export const playerTabs = ref<PlayerTarget[]>([]);
export const activeTab = ref<string>("self");
const maxTabs = 10;
export function openPlayer(target: PlayerTarget) {
  page.value = "history";
  if (target.puuid === state.value.summoner?.puuid) {
    activeTab.value = "self";
    return;
  }
  const existing = playerTabs.value.find((tab) => tab.puuid === target.puuid);
  if (existing) {
    if (target.name.includes("#") && !existing.name.includes("#"))
      existing.name = target.name;
    if (target.level !== null) existing.level = target.level;
  } else {
    playerTabs.value.push({ ...target });
    // 超出上限时关闭最早打开且不在前台的标签。
    if (playerTabs.value.length > maxTabs) playerTabs.value.shift();
  }
  activeTab.value = target.puuid;
}
export function closePlayerTab(puuid: string) {
  const index = playerTabs.value.findIndex((tab) => tab.puuid === puuid);
  if (index < 0) return;
  playerTabs.value.splice(index, 1);
  if (activeTab.value === puuid)
    activeTab.value =
      playerTabs.value[Math.min(index, playerTabs.value.length - 1)]?.puuid ??
      "self";
}
export const summonerTarget = (player: Summoner): PlayerTarget => ({
  puuid: player.puuid,
  name: player.gameName + (player.tagLine ? "#" + player.tagLine : ""),
  level: player.level,
});
/** 按完整 Riot ID 在当前大区查询并打开；失败时把错误交给调用方显示。 */
export async function openRiotId(riotId: string) {
  const player = await unwrap(api.findSummoner(riotId.trim()));
  openPlayer(summonerTarget(player));
  return player;
}
export function acceptState(value: ConnectionState) {
  const previous = state.value;
  state.value = value;
  // 换账号或大区后，其他玩家标签属于旧会话，全部关闭。
  if (
    previous.summoner?.puuid !== value.summoner?.puuid ||
    previous.platform !== value.platform
  ) {
    playerTabs.value = [];
    activeTab.value = "self";
  }
  if (dataHero.value.follow && value.championId !== dataHero.value.id)
    dataHero.value = { id: value.championId, follow: true };
}
/** 强化名称与品质（来自 AramHex 目录，只读一次；失败时下次再试）。 */
export const augmentNames = ref(
  new Map<number, { name: string; rarity: string }>(),
);
let augmentLoading: Promise<void> | null = null;
export function loadAugmentNames() {
  if (augmentNames.value.size || augmentLoading) return augmentLoading;
  augmentLoading = unwrap(api.getAugments(null, "all"))
    .then((ranking) => {
      augmentNames.value = new Map(
        ranking.catalog.map((item) => [
          item.id,
          { name: item.name, rarity: item.rarity },
        ]),
      );
    })
    .catch(() => {})
    .finally(() => {
      augmentLoading = null;
    });
  return augmentLoading;
}
