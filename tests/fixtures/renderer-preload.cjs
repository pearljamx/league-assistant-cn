// Synthetic fixtures are labelled and excluded from production packaging.
const { contextBridge } = require("electron");
const listeners = { state: [], settings: [], recognition: [] };
const ok = (data) => Promise.resolve({ ok: true, data });
const unavailable = () =>
  Promise.resolve({ ok: false, error: "本地界面测试未启用此接口" });
const subscribe = (key) => (callback) => {
  listeners[key].push(callback);
  return () => {
    listeners[key] = listeners[key].filter((item) => item !== callback);
  };
};
const emit = (key, data) =>
  listeners[key].forEach((callback) => callback(data));
const state = {
  status: "connected",
  message: "隔离界面测试",
  phase: "InProgress",
  region: "TENCENT",
  platform: "FIXTURE",
  mode: "hex",
  queueId: 2400,
  championId: 202,
  summoner: {
    puuid: "fixture-player",
    summonerId: 1,
    gameName: "测试账号",
    tagLine: "TEST",
    level: 1,
    iconId: 0,
  },
  ranked: [],
  updatedAt: "",
};
const settings = {
  autoAccept: false,
  acceptDelayMs: 1000,
  band: "all",
  mode: "hex",
  position: "ALL",
  tier: 255,
  autoRecognize: true,
  monitor: 0,
  overlay: true,
  managedRunePage: null,
};
const idle = () => ({
  status: "idle",
  message: "测试：游戏不在前台",
  augmentIds: [],
  rawTexts: [],
  captureId: 0,
  monitor: 0,
  updatedAt: "",
});
let recognition = idle(),
  delay = 0;
const names = ["测试强化甲", "测试强化乙", "测试强化丙", "测试强化丁"];
const catalog = names.map((name, index) => ({
  id: index + 1,
  name,
  rarity: "gold",
}));
const perks = [8005, 9111, 9104, 8014, 8139, 8140, 5008, 5008, 5011];
const runeCalls = [];
const source = (band) => ({
  id: "fixture",
  name: "本地测试数据",
  url: "https://example.invalid/fixture",
  mode: "hex",
  date: null,
  patch: "fixture",
  band,
  license: "仅测试",
});
const api = {
  getState: () => ok(state),
  getSettings: () => ok(settings),
  saveSettings: (patch) => {
    Object.assign(settings, patch);
    emit("settings", settings);
    recognition = idle();
    emit("recognition", recognition);
    return ok(settings);
  },
  getCatalog: () =>
    ok({
      champions: [
        { id: 202, name: "测试英雄一", alias: "Jhin", title: "测试", icon: "" },
        { id: 22, name: "测试英雄二", alias: "Ashe", title: "测试", icon: "" },
      ],
      items: {},
      perks: Object.fromEntries(
        perks.map((id) => [id, { name: `测试符文${id}`, icon: "" }]),
      ),
      version: "fixture",
    }),
  getSelection: () =>
    ok({ members: [], bench: [], localCellId: null, championId: 202 }),
  getOverview: (query) =>
    ok({
      source: source(query.band),
      bands: [
        { id: "all", name: "全部样本" },
        { id: "mid", name: "中分" },
      ],
      heroes: [202, 22].map((championId, index) => ({
        championId,
        games: 100,
        winRate: 0.5,
        pickRate: 0.1,
        rank: index + 1,
      })),
    }),
  getAugments: (championId, band) =>
    ok({
      source: source(band),
      championId,
      baseline: 0.5,
      catalog,
      exposure: "隔离测试数据",
      augments: catalog.map((augment) => ({
        augment,
        wins: 50 + augment.id,
        games: 100,
        winRate: 0.5 + augment.id / 100,
        pickRate: 0.1,
        smoothedWinRate: 0.5 + augment.id / 400,
        delta: augment.id / 400,
        lowSample: true,
      })),
    }),
  getRecognition: () => ok(recognition),
  setManualAugments: async (ids) => {
    const waiting = delay;
    delay = 0;
    if (waiting) await new Promise((resolve) => setTimeout(resolve, waiting));
    return {
      ok: true,
      data: {
        ...idle(),
        status: "recognized",
        message: "手动比较",
        augmentIds: ids,
      },
    };
  },
  getDisplays: () =>
    ok([{ id: 0, name: "测试显示器", width: 1920, height: 1080 }]),
  getRating: () =>
    ok({
      provider: "hexdata",
      status: "needs-authorization",
      score: null,
      percentile: null,
      date: null,
      message: "隔离测试不查询评分",
      url: "https://hexdata.com.cn/matchmaking-position",
    }),
  getRecommendation: (championId, query) =>
    ok({
      source: { ...source(query.band), mode: query.mode },
      championId,
      position: query.position,
      starting: [],
      boots: [],
      core: [],
      later: [],
      skills: [],
      unavailable: [],
      runes: [
        {
          label: "测试符文方案",
          perks,
          primaryStyleId: 8000,
          subStyleId: 8100,
          games: 100,
          winRate: 0.5,
          pickRate: 0.1,
        },
      ],
    }),
  getHistory: unavailable,
  getMatch: unavailable,
  findSummoner: unavailable,
  getRanked: unavailable,
  applyRunes: (championId, query, index, expectedPerks) => {
    runeCalls.push({ championId, query, index, perks: expectedPerks });
    return ok({ pageId: 7 });
  },
  openExternal: unavailable,
  scanAugments: unavailable,
  onState: subscribe("state"),
  onSettings: subscribe("settings"),
  onRecognition: subscribe("recognition"),
};
contextBridge.exposeInMainWorld("assistant", api);
contextBridge.exposeInMainWorld("rendererFixture", {
  runeCalls: () => runeCalls,
  recognition: (patch) => {
    recognition = { ...idle(), ...patch };
    emit("recognition", recognition);
  },
  state: (patch) => {
    Object.assign(state, patch);
    emit("state", state);
  },
  delayManual: (milliseconds) => {
    delay = milliseconds;
  },
});
