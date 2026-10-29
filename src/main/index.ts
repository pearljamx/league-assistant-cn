import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  shell,
  globalShortcut,
  screen,
} from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Storage } from "./storage";
import { Client } from "./client";
import { CatalogProvider } from "./providers/catalog";
import { TencentProvider } from "./providers/tencent";
import { AramHexProvider } from "./providers/aramhex";
import { HistoryProvider } from "./providers/history";
import { LiveGameProvider } from "./providers/live-game";
import { SkillRatingProvider } from "./providers/rating";
import { RuneService } from "./runes";
import { RecognitionService } from "./recognition";
import { AppError, safeError } from "./errors";
import {
  CompanionController,
  companionBounds,
  type CompanionRole,
} from "./companions";
import { setPublicFetcher } from "./http";
import { createTray } from "./tray";
import type { Result } from "../shared/types";

const current = dirname(fileURLToPath(import.meta.url));
const root = join(current, "../..");
let mainWindow: BrowserWindow | null = null,
  overlay: BrowserWindow | null = null,
  pickerWindow: BrowserWindow | null = null,
  infoWindow: BrowserWindow | null = null;
let quitting = false;
let tray: ReturnType<typeof createTray> | null = null;
const showMain = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
};
const ownedWindows = () =>
  [mainWindow, overlay, pickerWindow, infoWindow].filter(
    (window): window is BrowserWindow =>
      Boolean(window && !window.isDestroyed()),
  );
let client: Client, recognition: RecognitionService;
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on("second-instance", showMain);
  void app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId("cn.leagueassistant.desktop");
      setPublicFetcher(net.fetch.bind(net) as typeof fetch);
      const storage = new Storage(join(app.getPath("userData"), "local"));
      await storage.initialize();
      client = new Client(storage);
      const companions = new CompanionController();
      const readyCompanions = new Set<CompanionRole>();
      let companionSelectionRequest = 0;
      const catalog = new CatalogProvider(storage),
        tencent = new TencentProvider(storage, catalog),
        aramhex = new AramHexProvider(storage);
      const history = new HistoryProvider(client, storage),
        liveGame = new LiveGameProvider(client),
        rating = new SkillRatingProvider(),
        runes = new RuneService(client, storage, tencent);
      recognition = new RecognitionService(
        client,
        storage,
        aramhex,
        root,
        process.resourcesPath,
        app.isPackaged,
      );
      const query = z.object({
        mode: z.enum(["rift", "aram", "hex"]),
        band: z.enum(["all", "casual", "mid", "high"]),
        tier: z.number().int().min(1).max(255),
        position: z.enum([
          "ALL",
          "TOP",
          "JUNGLE",
          "MIDDLE",
          "BOTTOM",
          "SUPPORT",
        ]),
      });
      const hero = z.number().int().min(1).max(100000),
        band = z.enum(["all", "casual", "mid", "high"]);
      const id = z.string().regex(/^[\w-]{1,128}$/),
        matchId = z.string().regex(/^\d{1,20}$/);
      const settingsPatch = z
        .object({
          autoAccept: z.boolean().optional(),
          acceptDelayMs: z.number().int().min(1000).max(10000).optional(),
          band: band.optional(),
          mode: z.enum(["rift", "aram", "hex"]).optional(),
          position: z
            .enum(["ALL", "TOP", "JUNGLE", "MIDDLE", "BOTTOM", "SUPPORT"])
            .optional(),
          tier: z.number().int().optional(),
          autoRecognize: z.boolean().optional(),
          monitor: z.number().int().min(0).max(15).optional(),
          overlay: z.boolean().optional(),
          companionWindows: z.boolean().optional(),
          closeAction: z.enum(["ask", "tray", "quit"]).optional(),
        })
        .strict();
      function handle(
        name: string,
        handler: (...args: any[]) => unknown,
        withSender = false,
      ) {
        ipcMain.handle(
          "assistant:" + name,
          async (event, ...args): Promise<Result<any>> => {
            if (
              !ownedWindows().some(
                (window) => window.webContents.id === event.sender.id,
              )
            )
              return {
                ok: false,
                code: "INVALID_SENDER",
                error: "未知界面请求已拒绝。",
              };
            try {
              return {
                ok: true,
                data: await handler(
                  ...(withSender ? [args[0], event.sender.id] : args),
                ),
              };
            } catch (error) {
              const safe = safeError(error);
              return {
                ok: false,
                code: error instanceof z.ZodError ? "INVALID_INPUT" : safe.code,
                error:
                  error instanceof z.ZodError
                    ? "输入格式不正确，请检查后重试。"
                    : safe.message,
              };
            }
          },
        );
      }
      handle("state", () => client.state);
      handle("settings", () => storage.getSettings());
      handle("settings-save", async (patch) => {
        const settings = await storage.updateSettings(
          settingsPatch.parse(patch),
        );
        client.updateAutomation();
        recognition.settingsChanged();
        broadcast("assistant:settings", settings);
        tray?.update(settings);
        updateOverlay();
        updateCompanionWindows();
        return settings;
      });
      handle("catalog", () => catalog.get());
      handle("selection", () => client.selection);
      handle("live-game", () => liveGame.get());
      handle("champion-choices", () => client.getChampionChoices());
      handle("champion-choose", (value) =>
        client.chooseChampion(hero.parse(value)),
      );
      handle("companion-state", () => companions.snapshot());
      handle("companion-select", async (value) => {
        const request = ++companionSelectionRequest;
        const context = () =>
          `${client.sessionGeneration}:${client.state.status}:${client.state.summoner?.puuid}:${client.state.platform}:${client.state.phase}:${client.state.championId}`;
        const originalContext = context();
        const championId = value === null ? null : hero.parse(value);
        if (
          championId !== null &&
          !(await catalog.get()).champions.some(
            (champion) => champion.id === championId,
          )
        )
          throw new AppError(
            "当前资料未收录该英雄，请刷新后重试。",
            "INVALID_CHAMPION",
          );
        if (
          request !== companionSelectionRequest ||
          context() !== originalContext
        )
          throw new AppError(
            "英雄或账号状态已变化，请重新选择。",
            "STALE_SELECTION",
          );
        const state = companions.select(championId);
        broadcast("assistant:companion", state);
        return state;
      });
      handle(
        "companion-window",
        async (value, senderId) => {
          const action = z.enum(["hide", "show", "main"]).parse(value);
          if (action === "main") {
            showMain();
            return;
          }
          if (action === "show") {
            if (storage.getSettings().companionWindows === false) {
              const settings = await storage.updateSettings({
                companionWindows: true,
              });
              broadcast("assistant:settings", settings);
              tray?.update(settings);
            }
            companions.reopen();
          } else {
            if (pickerWindow?.webContents.id === senderId)
              companions.dismiss("picker");
            else if (infoWindow?.webContents.id === senderId)
              companions.dismiss("info");
            else throw new AppError("只能收起当前弹窗。", "INVALID_WINDOW");
          }
          updateCompanionWindows();
        },
        true,
      );
      handle("overview", (value) => {
        const parsed = query.parse(value);
        return parsed.mode === "hex"
          ? aramhex.overview(parsed.band)
          : tencent.overview(parsed);
      });
      handle("recommendation", (championId, value) =>
        tencent.recommendation(hero.parse(championId), query.parse(value)),
      );
      handle("augments", (championId, value) =>
        aramhex.augments(
          championId === null ? null : hero.parse(championId),
          band.parse(value),
        ),
      );
      handle("history", (puuid, start) =>
        history.history(
          id.parse(puuid),
          z.number().int().min(0).max(10000).parse(start),
        ),
      );
      handle("match", (value) => history.match(matchId.parse(value)));
      handle("summoner", (value) =>
        client.findSummoner(z.string().min(1).max(100).parse(value)),
      );
      handle("ranked", (value) => client.getRanked(id.parse(value)));
      handle("runes", (championId, value, index, expectedPerks) =>
        runes.apply(
          hero.parse(championId),
          query.parse(value),
          z.number().int().min(0).max(100).parse(index),
          z.array(z.number().int().positive()).length(9).parse(expectedPerks),
        ),
      );
      handle("rating", async (value) => {
        const owner = client.state.summoner?.puuid;
        const platform = client.state.platform;
        const generation = client.sessionGeneration;
        const status = client.state.status;
        const riotId =
          value === undefined
            ? client.state.summoner?.tagLine
              ? `${client.state.summoner.gameName}#${client.state.summoner.tagLine}`
              : undefined
            : z.string().min(1).max(100).parse(value);
        const result = await rating.query(riotId, platform);
        if (
          client.state.summoner?.puuid !== owner ||
          client.state.platform !== platform ||
          client.sessionGeneration !== generation ||
          client.state.status !== status
        )
          throw new AppError("账号或大区已变化，请重新查询。", "STALE_ACCOUNT");
        return result;
      });
      const urls = {
        hexdata: "https://hexdata.com.cn/matchmaking-position",
        github: "https://github.com/pearljamx/league-assistant-cn",
        "data-license": "https://github.com/czgreat/aramhex-data",
      };
      handle("open", (value) =>
        shell.openExternal(
          urls[z.enum(["hexdata", "github", "data-license"]).parse(value)],
        ),
      );
      handle("recognition", () => recognition.state);
      handle("scan", () => recognition.scan());
      handle("manual", (value) =>
        recognition.manual(z.array(hero).length(3).parse(value)),
      );
      handle("displays", () => recognition.displays());
      handle("main-window", (value) => {
        const action = z.enum(["tray", "quit"]).parse(value);
        if (action === "quit") {
          quitting = true;
          app.quit();
        } else mainWindow?.hide();
      });
      const preload = join(current, "../preload/index.cjs");
      const webPreferences = {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      };
      mainWindow = new BrowserWindow({
        width: 1380,
        height: 900,
        minWidth: 1040,
        minHeight: 700,
        backgroundColor: "#0d1215",
        title: "英雄联盟助手",
        icon: join(root, "resources/icon.png"),
        autoHideMenuBar: true,
        // 自定义标题栏：保留 Windows 原生最小化/最大化/关闭按钮与贴靠布局。
        titleBarStyle: "hidden",
        titleBarOverlay: {
          color: "#0f171a",
          symbolColor: "#a9b6b9",
          height: 40,
        },
        show: false,
        webPreferences,
      });
      mainWindow.on("ready-to-show", () => mainWindow?.show());
      mainWindow.on("close", (event) => {
        if (quitting) return;
        const action = storage.getSettings().closeAction ?? "ask";
        if (action === "quit") return;
        event.preventDefault();
        if (action === "tray") mainWindow?.hide();
        else {
          showMain();
          mainWindow?.webContents.send("assistant:close-request");
        }
      });
      // Windows 注销/关机时直接退出，不弹关闭询问。
      mainWindow.on("session-end", () => {
        quitting = true;
      });
      mainWindow.on("closed", () => {
        mainWindow = null;
        app.quit();
      });
      overlay = new BrowserWindow({
        width: 340,
        height: 365,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        focusable: false,
        show: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        webPreferences,
      });
      overlay.setIgnoreMouseEvents(true, { forward: true });
      overlay.setAlwaysOnTop(true, "screen-saver");
      const area = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
      const bounds = companionBounds(area);
      for (const role of ["picker", "info"] as const) {
        const window = new BrowserWindow({
          ...bounds[role],
          frame: false,
          resizable: false,
          movable: true,
          show: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          backgroundColor: "#10181b",
          title:
            role === "picker"
              ? "英雄快选 · 英雄联盟助手"
              : "英雄情报 · 英雄联盟助手",
          webPreferences,
        });
        if (role === "picker") pickerWindow = window;
        else infoWindow = window;
        window.on("ready-to-show", () => {
          readyCompanions.add(role);
          updateCompanionWindows();
        });
        window.on("close", (event) => {
          if (quitting) return;
          event.preventDefault();
          companions.dismiss(role);
          window.hide();
        });
      }
      for (const window of ownedWindows()) {
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.on("will-navigate", (event) =>
          event.preventDefault(),
        );
      }
      if (process.env.ELECTRON_RENDERER_URL) {
        await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
        await overlay.loadURL(process.env.ELECTRON_RENDERER_URL + "/#overlay");
        await pickerWindow!.loadURL(
          process.env.ELECTRON_RENDERER_URL + "/#champion-picker",
        );
        await infoWindow!.loadURL(
          process.env.ELECTRON_RENDERER_URL + "/#champion-info",
        );
      } else {
        await mainWindow.loadFile(join(current, "../renderer/index.html"));
        await overlay.loadFile(join(current, "../renderer/index.html"), {
          hash: "overlay",
        });
        await pickerWindow!.loadFile(join(current, "../renderer/index.html"), {
          hash: "champion-picker",
        });
        await infoWindow!.loadFile(join(current, "../renderer/index.html"), {
          hash: "champion-info",
        });
      }
      const toggleSetting = async (key: "autoAccept" | "companionWindows") => {
        const current = storage.getSettings();
        const settings = await storage.updateSettings({
          [key]:
            key === "companionWindows"
              ? current.companionWindows === false
              : !current.autoAccept,
        });
        client.updateAutomation();
        broadcast("assistant:settings", settings);
        tray?.update(settings);
        updateCompanionWindows();
      };
      tray = createTray(
        join(root, "resources/icon.png"),
        storage.getSettings(),
        {
          show: showMain,
          toggleAutoAccept: () =>
            void toggleSetting("autoAccept").catch(() => {}),
          toggleCompanions: () =>
            void toggleSetting("companionWindows").catch(() => {}),
          quit: () => {
            quitting = true;
            app.quit();
          },
        },
      );
      const broadcast = (event: string, data: unknown) => {
        for (const window of ownedWindows())
          window.webContents.send(event, data);
      };
      function updateCompanionWindows() {
        const enabled = storage.getSettings().companionWindows !== false;
        for (const [role, window] of [
          ["picker", pickerWindow],
          ["info", infoWindow],
        ] as const) {
          if (!window || window.isDestroyed()) continue;
          if (readyCompanions.has(role) && companions.visible(role, enabled)) {
            if (!window.isVisible()) window.showInactive();
          } else window.hide();
        }
      }
      const repositionCompanions = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const next = companionBounds(
          screen.getDisplayMatching(mainWindow.getBounds()).workArea,
        );
        pickerWindow?.setBounds(next.picker);
        infoWindow?.setBounds(next.info);
      };
      screen.on("display-removed", repositionCompanions);
      screen.on("display-metrics-changed", repositionCompanions);
      function updateOverlay() {
        if (!overlay || overlay.isDestroyed()) return;
        if (
          !storage.getSettings().overlay ||
          !(
            recognition.state.status === "recognized" ||
            (recognition.state.status === "scanning" &&
              recognition.state.gameWindow)
          ) ||
          client.state.phase !== "InProgress" ||
          client.state.mode !== "hex"
        ) {
          overlay.hide();
          return;
        }
        const bounds = recognition.state.gameWindow;
        const point = bounds
          ? screen.screenToDipPoint({
              x: Math.round(bounds.x + bounds.width / 2),
              y: Math.round(bounds.y + bounds.height / 2),
            })
          : screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(point),
          area = display.workArea;
        overlay.setPosition(area.x + area.width - 360, area.y + 28);
        overlay.showInactive();
      }
      client.on("state", (state) => {
        const previous = companions.snapshot();
        const selected = companions.update(state);
        if (
          previous.championId !== selected.championId ||
          previous.followingClient !== selected.followingClient
        )
          broadcast("assistant:companion", selected);
        broadcast("assistant:state", state);
        broadcast("assistant:selection", client.selection);
        updateOverlay();
        updateCompanionWindows();
      });
      recognition.on("recognition", (state) => {
        broadcast("assistant:recognition", state);
        updateOverlay();
      });
      globalShortcut.register("F6", () => {
        void recognition.scan().catch(() => {});
      });
      recognition.start();
      void client.start();
      app.on("activate", showMain);
    })
    .catch(() => {
      app.quit();
    });
}
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  quitting = true;
  tray?.destroy();
  client?.stop();
  recognition?.stop();
  globalShortcut.unregisterAll();
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
  if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.destroy();
  if (infoWindow && !infoWindow.isDestroyed()) infoWindow.destroy();
});
