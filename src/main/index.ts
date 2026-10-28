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
import { SkillRatingProvider } from "./providers/rating";
import { RuneService } from "./runes";
import { RecognitionService } from "./recognition";
import { safeError } from "./errors";
import { setPublicFetcher } from "./http";
import type { Result } from "../shared/types";

const current = dirname(fileURLToPath(import.meta.url));
const root = join(current, "../..");
let mainWindow: BrowserWindow | null = null,
  overlay: BrowserWindow | null = null;
let client: Client, recognition: RecognitionService;
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  void app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId("cn.leagueassistant.desktop");
      setPublicFetcher(net.fetch.bind(net) as typeof fetch);
      const storage = new Storage(join(app.getPath("userData"), "local"));
      await storage.initialize();
      client = new Client(storage);
      const catalog = new CatalogProvider(storage),
        tencent = new TencentProvider(storage, catalog),
        aramhex = new AramHexProvider(storage);
      const history = new HistoryProvider(client, storage),
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
        })
        .strict();
      function handle(name: string, handler: (...args: any[]) => unknown) {
        ipcMain.handle(
          "assistant:" + name,
          async (event, ...args): Promise<Result<any>> => {
            if (
              ![mainWindow?.webContents.id, overlay?.webContents.id].includes(
                event.sender.id,
              )
            )
              return {
                ok: false,
                code: "INVALID_SENDER",
                error: "未知界面请求已拒绝。",
              };
            try {
              return { ok: true, data: await handler(...args) };
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
        updateOverlay();
        return settings;
      });
      handle("catalog", () => catalog.get());
      handle("selection", () => client.selection);
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
      handle("rating", () => rating.query());
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
        show: false,
        webPreferences,
      });
      mainWindow.on("ready-to-show", () => mainWindow?.show());
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
      for (const window of [mainWindow, overlay]) {
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.on("will-navigate", (event) =>
          event.preventDefault(),
        );
      }
      if (process.env.ELECTRON_RENDERER_URL) {
        await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
        await overlay.loadURL(process.env.ELECTRON_RENDERER_URL + "/#overlay");
      } else {
        await mainWindow.loadFile(join(current, "../renderer/index.html"));
        await overlay.loadFile(join(current, "../renderer/index.html"), {
          hash: "overlay",
        });
      }
      const broadcast = (event: string, data: unknown) => {
        for (const window of [mainWindow, overlay])
          if (window && !window.isDestroyed())
            window.webContents.send(event, data);
      };
      function updateOverlay() {
        if (!overlay || overlay.isDestroyed()) return;
        if (
          !storage.getSettings().overlay ||
          recognition.state.status !== "recognized" ||
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
        broadcast("assistant:state", state);
        updateOverlay();
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
      app.on("activate", () => mainWindow?.show());
    })
    .catch(() => {
      app.quit();
    });
}
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  client?.stop();
  recognition?.stop();
  globalShortcut.unregisterAll();
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
});
