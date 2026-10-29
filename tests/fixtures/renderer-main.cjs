// Isolated renderer harness. It never loads the real main process or LCU client.
const { app, BrowserWindow, session, ipcMain } = require("electron");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
app.setPath("userData", path.join(root, "artifacts/renderer-fixture-profile"));
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, done) =>
    done({ cancel: /^https?:/.test(details.url) }),
  );
  const companions = process.argv.includes("--companions");
  const windows = [];
  const clone = (value) => structuredClone(value);
  const state = {
    status: "connected",
    message: "隔离界面测试",
    phase: "Lobby",
    region: "TENCENT",
    platform: "FIXTURE",
    mode: "hex",
    queueId: 2400,
    championId: null,
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
    autoRecognize: false,
    monitor: 0,
    overlay: true,
    companionWindows: true,
    hexSource: "aramhex",
    managedRunePage: null,
  };
  const selection = {
    members: [],
    bench: [],
    localCellId: null,
    championId: null,
  };
  let companion = { championId: null, followingClient: true };
  let choices = {
    championIds: [22, 99],
    kind: "bench",
    reason: "隔离测试备选席",
  };
  let rating = {
    provider: "hexdata",
    status: "needs-authorization",
    score: null,
    percentile: null,
    date: null,
    message: "隔离测试：待接入",
    url: "https://hexdata.com.cn/matchmaking-position",
  };
  const chooseCalls = [],
    windowActions = [];
  let ratingDelay = 0,
    ratingDelayRemaining = 0;
  const emit = (key, value) =>
    windows.forEach((window) =>
      window.webContents.send("fixture:" + key, clone(value)),
    );
  const handle = (key, callback) =>
    ipcMain.handle("fixture:" + key, (event, ...args) => {
      if (!windows.some((window) => window.webContents.id === event.sender.id))
        throw new Error("Unexpected fixture sender");
      return callback(...args);
    });
  handle("state", () => clone(state));
  handle("settings", () => clone(settings));
  handle("settings-save", (patch) => {
    Object.assign(settings, patch);
    emit("settings", settings);
    return clone(settings);
  });
  handle("selection", () => clone(selection));
  handle("rating", async () => {
    const value = clone(rating),
      delay = ratingDelay;
    if (--ratingDelayRemaining <= 0) ratingDelay = 0;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    return value;
  });
  handle("companion", () => clone(companion));
  handle("select-companion", (id) => {
    companion = {
      championId: id ?? state.championId,
      followingClient: id === null,
    };
    emit("companion", companion);
    return clone(companion);
  });
  handle("choose", (id) => {
    if (state.phase !== "ChampSelect" || state.championId === id)
      return { ok: false, error: "测试：当前不能换用英雄" };
    if (!choices.championIds.includes(id))
      return { ok: false, error: "测试：该英雄当前不可换用" };
    chooseCalls.push(id);
    const previous = state.championId;
    choices =
      choices.kind === "subset"
        ? {
            ...choices,
            championIds: choices.championIds.filter((item) => item !== id),
            kind: "bench",
            reason: "测试：选卡后可换用其余卡片",
          }
        : {
            ...choices,
            championIds: choices.championIds
              .map((item) => (item === id ? previous : item))
              .filter(Boolean),
          };
    state.championId = id;
    selection.championId = id;
    const self = selection.members.find(
      (member) => member.cellId === selection.localCellId,
    );
    if (self) self.championId = id;
    companion = { championId: id, followingClient: true };
    emit("state", state);
    emit("selection", selection);
    emit("companion", companion);
    return { ok: true, data: undefined };
  });
  handle("window", (action) => {
    windowActions.push(action);
    return undefined;
  });
  handle("patch-state", (patch) => {
    const ownerChanged =
      patch.summoner && patch.summoner.puuid !== state.summoner?.puuid;
    Object.assign(state, patch);
    if (ownerChanged)
      companion = { championId: state.championId, followingClient: true };
    else if (companion.followingClient) companion.championId = state.championId;
    emit("state", state);
    emit("companion", companion);
  });
  handle("patch-selection", (patch) => {
    Object.assign(selection, patch);
    emit("state", state);
    emit("selection", selection);
  });
  handle("patch-rating", (patch) => {
    rating = { ...rating, ...patch };
  });
  handle("delay-rating", (delay) => {
    ratingDelay = delay;
    ratingDelayRemaining = 2;
  });
  handle("choose-calls", () => clone(chooseCalls));
  handle("choices", () => clone(choices));
  handle("patch-choices", (value) => {
    choices = value;
  });
  handle("window-actions", () => clone(windowActions));
  for (const role of companions ? ["champion-picker", "champion-info"] : [""]) {
    const window = new BrowserWindow({
      show: false,
      width: companions ? (role === "champion-picker" ? 340 : 360) : 1380,
      height: companions ? (role === "champion-picker" ? 420 : 600) : 900,
      x: companions ? (role === "champion-picker" ? 70 : 420) : undefined,
      y: companions ? 100 : undefined,
      webPreferences: {
        preload: path.join(__dirname, "renderer-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        additionalArguments: companions ? ["--fixture-companions"] : [],
      },
    });
    windows.push(window);
    await window.loadFile(path.join(root, "out/renderer/index.html"), {
      hash: role,
    });
    if (companions || process.argv.includes("--history")) window.showInactive();
  }
});
app.on("window-all-closed", () => app.quit());
