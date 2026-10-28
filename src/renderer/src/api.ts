import type {
  AssistantApi,
  ConnectionState,
  Result,
  Settings,
} from "../../shared/types";

// Browser preview is explicitly disconnected. It never invents accounts or game statistics.
const unavailable = async (): Promise<Result<any>> => ({
  ok: false,
  error: "此功能需要桌面版连接本机国服客户端。",
  code: "DESKTOP_REQUIRED",
});
const state: ConnectionState = {
  status: "disconnected",
  message: "浏览器预览 · 请启动桌面版连接客户端",
  phase: "None",
  region: null,
  platform: null,
  mode: "rift",
  queueId: null,
  summoner: null,
  ranked: [],
  championId: null,
  updatedAt: "",
};
const settings: Settings = {
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
};
const preview: AssistantApi = {
  getState: async () => ({ ok: true, data: state }),
  getSettings: async () => ({ ok: true, data: settings }),
  saveSettings: unavailable,
  getCatalog: async () => ({
    ok: true,
    data: { champions: [], items: {}, perks: {}, version: null },
  }),
  getSelection: async () => ({
    ok: true,
    data: { members: [], bench: [], localCellId: null, championId: null },
  }),
  getOverview: unavailable,
  getRecommendation: unavailable,
  getAugments: unavailable,
  getHistory: unavailable,
  getMatch: unavailable,
  findSummoner: unavailable,
  getRanked: unavailable,
  applyRunes: unavailable,
  getRating: async () => ({
    ok: true,
    data: {
      provider: "hexdata",
      status: "needs-authorization",
      score: null,
      percentile: null,
      date: null,
      message: "Hexdata 海斗分直连待正式接入资料与授权。",
      url: "https://hexdata.com.cn/matchmaking-position",
    },
  }),
  openExternal: unavailable,
  getRecognition: async () => ({
    ok: true,
    data: {
      status: "idle",
      message: "等待海克斯三选一",
      augmentIds: [],
      rawTexts: [],
      captureId: 0,
      monitor: 0,
      updatedAt: "",
    },
  }),
  scanAugments: unavailable,
  setManualAugments: unavailable,
  getDisplays: async () => ({
    ok: true,
    data: [{ id: 0, name: "自动跟随游戏窗口", width: 0, height: 0 }],
  }),
  onState: () => () => {},
  onSettings: () => () => {},
  onRecognition: () => () => {},
};
export const api = window.assistant ?? preview;
export async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const result = await request;
  if (!result.ok) throw new Error(result.error || "请求未完成");
  return result.data as T;
}
