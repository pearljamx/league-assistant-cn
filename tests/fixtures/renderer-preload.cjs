// Synthetic fixtures are labelled and excluded from production packaging.
const { contextBridge, ipcRenderer } = require("electron");
const companionMode = process.argv.includes("--fixture-companions");
const invoke = (name, ...args) =>
  ipcRenderer.invoke("fixture:" + name, ...args);
const remote = (name, ...args) =>
  invoke(name, ...args).then((data) => ({ ok: true, data }));
const remoteSubscribe = (name, callback) => {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on("fixture:" + name, handler);
  return () => ipcRenderer.removeListener("fixture:" + name, handler);
};
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
let recommendationDelay = 0;
let historyDelay = 0;
const fixturePlayers = () => [
  {
    puuid: state.summoner?.puuid || "fixture-player",
    name: (state.summoner?.gameName || "测试账号") + "#TEST",
    championId: 202,
    teamId: 100,
    win: true,
    kills: 8,
    deaths: 2,
    assists: 12,
    items: [],
    damage: 25000,
    gold: 13000,
    cs: 100,
  },
  {
    puuid: "fixture-peer",
    name: "测试队友#TEST",
    championId: 22,
    teamId: 100,
    win: true,
    kills: 5,
    deaths: 3,
    assists: 14,
    items: [],
    damage: 21000,
    gold: 11000,
    cs: 90,
  },
  {
    puuid: "fixture-opponent",
    name: "测试对手#TEST",
    championId: 99,
    teamId: 200,
    win: false,
    kills: 3,
    deaths: 8,
    assists: 9,
    items: [],
    damage: 15000,
    gold: 9000,
    cs: 80,
  },
];
const fixtureMatch = () => ({
  id: "100001",
  queueId: 3270,
  mode: "KIWI",
  date: "2026-10-29T00:00:00Z",
  duration: 1200,
  players: fixturePlayers(),
  private: false,
  remake: false,
});
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
        { id: 99, name: "测试英雄三", alias: "Lux", title: "测试", icon: "" },
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
  getRecommendation: async (championId, query) => {
    const wait = recommendationDelay;
    recommendationDelay = 0;
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    return ok({
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
          label: "测试符文方案" + championId,
          perks,
          primaryStyleId: 8000,
          subStyleId: 8100,
          games: 100,
          winRate: 0.5,
          pickRate: 0.1,
        },
      ],
    });
  },
  getHistory: async () => {
    const delay = historyDelay;
    historyDelay = 0;
    const result = {
      matches: [fixtureMatch()],
      nextIndex: 20,
      hasMore: false,
      source: "sgp",
      warning: null,
      fetchedAt: "2026-10-29T00:00:00Z",
    };
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    return ok(result);
  },
  getMatch: () => ok(fixtureMatch()),
  findSummoner: (name) =>
    ok({
      puuid: name.startsWith("测试队友") ? "fixture-peer" : "fixture-opponent",
      summonerId: 2,
      gameName: name.split("#")[0],
      tagLine: name.split("#")[1] || "TEST",
      level: 88,
      iconId: 0,
    }),
  getRanked: () =>
    ok([
      {
        queue: "RANKED_SOLO_5x5",
        tier: "GOLD",
        division: "II",
        wins: 12,
        losses: 8,
        lp: 35,
      },
    ]),
  getLiveGame: () =>
    ok({
      status: state.phase === "InProgress" ? "live" : "idle",
      mode: state.mode,
      phase: state.phase,
      gameTime: state.phase === "InProgress" ? 600 : null,
      message: "隔离实时对局数据",
      updatedAt: "",
      players:
        state.phase === "InProgress"
          ? fixturePlayers().map((player, index) => ({
              key: String(index),
              puuid: index === 2 ? null : player.puuid,
              riotId: index === 2 ? null : player.name,
              championId: player.championId,
              teamId: player.teamId,
              kills: player.kills,
              deaths: player.deaths,
              assists: player.assists,
              level: 10,
              items: player.items,
              isSelf: index === 0,
              identityHidden: index === 2,
            }))
          : [],
    }),
  applyRunes: (championId, query, index, expectedPerks) => {
    runeCalls.push({ championId, query, index, perks: expectedPerks });
    return ok({ pageId: 7 });
  },
  openExternal: unavailable,
  scanAugments: unavailable,
  mainWindow: (action) => remote("window", "main:" + action),
  onCloseRequest: () => () => {},
  onState: subscribe("state"),
  onSettings: subscribe("settings"),
  onRecognition: subscribe("recognition"),
  getCompanionState: () => remote("companion"),
  getChampionChoices: () =>
    ok({ championIds: [22, 99], kind: "bench", reason: "隔离测试备选席" }),
  selectCompanionChampion: (id) => remote("select-companion", id),
  companionWindow: (action) => remote("window", action),
  chooseChampion: (id) => invoke("choose", id),
  onCompanionState: (callback) => remoteSubscribe("companion", callback),
  onSelection: (callback) => remoteSubscribe("selection", callback),
};
if (companionMode)
  Object.assign(api, {
    getState: () => remote("state"),
    getSettings: () => remote("settings"),
    saveSettings: (patch) => remote("settings-save", patch),
    getSelection: () => remote("selection"),
    getRating: () => remote("rating"),
    onState: (callback) => remoteSubscribe("state", callback),
    onSettings: (callback) => remoteSubscribe("settings", callback),
  });
contextBridge.exposeInMainWorld("assistant", api);
contextBridge.exposeInMainWorld("rendererFixture", {
  runeCalls: () => runeCalls,
  recognition: (patch) => {
    recognition = { ...idle(), ...patch };
    emit("recognition", recognition);
  },
  state: (patch) => {
    if (companionMode) return invoke("patch-state", patch);
    Object.assign(state, patch);
    emit("state", state);
  },
  delayManual: (milliseconds) => {
    delay = milliseconds;
  },
  selection: (patch) => invoke("patch-selection", patch),
  rating: (patch) => invoke("patch-rating", patch),
  delayRating: (milliseconds) => invoke("delay-rating", milliseconds),
  delayRecommendation: (milliseconds) => {
    recommendationDelay = milliseconds;
  },
  delayHistory: (milliseconds) => {
    historyDelay = milliseconds;
  },
  chooseCalls: () => invoke("choose-calls"),
  windowActions: () => invoke("window-actions"),
});
