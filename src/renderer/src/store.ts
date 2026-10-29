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
/** 打开玩家详情的请求；nonce 让重复打开同一玩家也能刷新。 */
export const playerRequest = ref<(PlayerTarget & { nonce: number }) | null>(
  null,
);
let playerNonce = 0;
export function openPlayer(target: PlayerTarget) {
  playerRequest.value = { ...target, nonce: ++playerNonce };
  page.value = "history";
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
  state.value = value;
  if (dataHero.value.follow && value.championId !== dataHero.value.id)
    dataHero.value = { id: value.championId, follow: true };
}
