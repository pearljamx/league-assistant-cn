import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  shell,
  globalShortcut,
  screen,
  session,
} from "electron";
import { join, dirname } from "node:path";
import { writeFile } from "node:fs/promises";
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
  alignToClient,
  companionBounds,
  companionLimits,
  companionSizes,
  type CompanionSizes,
  type CompanionRole,
  type WindowBounds,
} from "./companions";
import { clientWindowRect, resizeClientWindow } from "./client-window";
import { Toolkit } from "./toolkit";
import { recommendationFromAramgg } from "./providers/aramgg-recommend";
import { setPublicFetcher } from "./http";
import { createTray } from "./tray";
import { PlayerStore, playerTags } from "./players";
import { SecretStore } from "./secrets";
import { AramggProvider } from "./providers/aramgg";
import { AramggSources, PublicAramggProvider } from "./providers/aramgg-public";
import type { Result, Settings } from "../shared/types";

const current = dirname(fileURLToPath(import.meta.url));
const root = join(current, "../..");
let mainWindow: BrowserWindow | null = null,
  overlay: BrowserWindow | null = null,
  pickerWindow: BrowserWindow | null = null,
  infoWindow: BrowserWindow | null = null,
  hexdataWindow: BrowserWindow | null = null;
let quitting = false;
let tray: ReturnType<typeof createTray> | null = null;
const showMain = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
};
/** Hexdata 官方页面只允许在其自有域名内导航；其他链接交给系统浏览器。 */
const hexdataPage = (raw: string) => {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      (url.hostname === "hexdata.com.cn" ||
        url.hostname.endsWith(".hexdata.com.cn"))
    );
  } catch {
    return false;
  }
};
const openOutside = (raw: string) => {
  if (/^https:\/\//.test(raw)) void shell.openExternal(raw);
};
// 该窗口不在 ownedWindows 中、没有 preload，因此无法调用助手的任何接口。
function openHexdata(url: string) {
  if (hexdataWindow && !hexdataWindow.isDestroyed()) {
    if (hexdataWindow.isMinimized()) hexdataWindow.restore();
    hexdataWindow.show();
    hexdataWindow.focus();
    return;
  }
  const partition = "persist:hexdata";
  session
    .fromPartition(partition)
    .setPermissionRequestHandler((_contents, _permission, done) => done(false));
  hexdataWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 720,
    minHeight: 520,
    title: "Hexdata 海斗查分（官方页面，需登录 Hexdata 账号）",
    icon: join(root, "resources/icon.png"),
    autoHideMenuBar: true,
    backgroundColor: "#0d1215",
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  const contents = hexdataWindow.webContents;
  contents.setWindowOpenHandler(({ url: next }) => {
    if (hexdataPage(next)) void contents.loadURL(next);
    else openOutside(next);
    return { action: "deny" };
  });
  const guard = (event: { preventDefault(): void }, next: string) => {
    if (hexdataPage(next)) return;
    event.preventDefault();
    openOutside(next);
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
  hexdataWindow.on("page-title-updated", (event) => event.preventDefault());
  hexdataWindow.on("closed", () => {
    hexdataWindow = null;
  });
  void hexdataWindow.loadURL(url).catch(() => {});
}
const ownedWindows = () =>
  [mainWindow, overlay, pickerWindow, infoWindow].filter(
    (window): window is BrowserWindow =>
      Boolean(window && !window.isDestroyed()),
  );
let client: Client, recognition: RecognitionService;
// 改名为 PEARLJAM HEX 后仍沿用原用户目录，保留设置、玩家标记与缓存；
// 显式传入 --user-data-dir（隔离测试）时以其为准。
if (!app.commandLine.hasSwitch("user-data-dir"))
  app.setPath("userData", join(app.getPath("appData"), "英雄联盟助手"));
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
      const userMoved = new Set<CompanionRole>();
      let lastClientRect: WindowBounds | null = null;
      // 开发版记录小窗显示决策（仅阶段与可见性，无账号信息），便于排查“窗口未出现”。
      const trace: string[] = [];
      const traceFile = join(
        app.getPath("userData"),
        "local",
        "companion-trace.log",
      );
      const note = (line: string) => {
        if (app.isPackaged) return;
        trace.push(`${new Date().toISOString()} ${line}`);
        if (trace.length > 120) trace.splice(0, trace.length - 120);
        void writeFile(traceFile, trace.join("\n") + "\n", "utf8").catch(
          () => {},
        );
      };
      let companionSelectionRequest = 0;
      const catalog = new CatalogProvider(storage),
        tencent = new TencentProvider(storage, catalog),
        aramhex = new AramHexProvider(storage);
      const history = new HistoryProvider(client, storage),
        liveGame = new LiveGameProvider(client),
        rating = new SkillRatingProvider(),
        runes = new RuneService(client, storage, tencent),
        players = new PlayerStore(storage),
        toolkit = new Toolkit(client),
        aramgg = new AramggSources(
          new PublicAramggProvider(storage),
          new AramggProvider(
            storage,
            new SecretStore(join(app.getPath("userData"), "local")),
          ),
        );
      // 公共数据：启动时与每 30 分钟检查一次清单。
      void aramgg.refresh();
      setInterval(() => void aramgg.refresh(), 30 * 60 * 1000).unref();
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
          hexSource: z.enum(["aramgg", "aramhex"]).optional(),
          autoSelect: z
            .object({
              pick: z.boolean().optional(),
              pickChampions: z.array(hero).max(10).optional(),
              ban: z.boolean().optional(),
              banChampions: z.array(hero).max(10).optional(),
              lock: z.boolean().optional(),
              lockDelayMs: z.number().int().min(1000).max(20000).optional(),
              bench: z.boolean().optional(),
              benchChampions: z.array(hero).max(10).optional(),
            })
            .strict()
            .optional(),
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
        const parsed = settingsPatch.parse(patch);
        // autoSelect 可只传部分字段，由 validateSettings 与现有值合并。
        const settings = await storage.updateSettings(
          parsed as Partial<Settings>,
        );
        client.updateAutomation();
        // 只改显示来源或关闭方式时保留当前三选一识别结果。
        if (
          !Object.keys(parsed).every((key) =>
            ["hexSource", "closeAction"].includes(key),
          )
        )
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
      handle("recommendation", async (championId, value) => {
        const id = hero.parse(championId),
          stats = query.parse(value);
        // 极地大乱斗：腾讯 101 没有出装统计，默认用 aramgg（队列 450 全球统计，公共数据包免 Key）。
        if (stats.mode === "aram") {
          const fromAramgg = await aramgg
            .champion(id)
            .then(recommendationFromAramgg)
            .catch(() => null);
          if (fromAramgg) return fromAramgg;
        }
        return tencent.recommendation(id, stats);
      });
      handle("augments", (championId, value) =>
        aramhex.augments(
          championId === null ? null : hero.parse(championId),
          band.parse(value),
        ),
      );
      handle("history", async (puuid, start) => {
        const target = id.parse(puuid);
        const owner = client.state.summoner?.puuid,
          platform = client.state.platform;
        const page = await history.history(
          target,
          z.number().int().min(0).max(10000).parse(start),
        );
        // 只用本人战绩记录“遇到过的玩家”，且账号与大区在请求期间未变化。
        if (
          owner &&
          target === owner &&
          client.state.summoner?.puuid === owner &&
          client.state.platform === platform
        )
          void players.record(owner, platform, page.matches).catch(() => {});
        return page;
      });
      const currentOwner = () => {
        const owner = client.state.summoner?.puuid;
        if (!owner || client.state.status !== "connected")
          throw new AppError("请先连接并登录客户端。", "CLIENT_OFFLINE");
        return { owner, platform: client.state.platform };
      };
      const noteInput = z
        .object({
          puuid: id,
          name: z.string().max(64),
          tag: z.enum(playerTags as [string, ...string[]]).nullable(),
          note: z.string().max(200),
        })
        .strict();
      handle("player-note", (value) => players.note(id.parse(value)));
      handle("player-note-save", (value) => {
        const input = noteInput.parse(value);
        return players.saveNote({
          ...input,
          tag: input.tag as (typeof playerTags)[number] | null,
          platform: client.state.platform,
        });
      });
      handle("player-notes", () => players.listNotes());
      handle("player-note-delete", (value) =>
        players.deleteNote(id.parse(value)),
      );
      handle("encounters", (value) => {
        const { owner, platform } = currentOwner();
        return players.encounters(owner, platform, id.parse(value));
      });
      // API Key 只进不出：界面只能写入或清除，状态里只返回末 4 位。
      handle("aramgg-status", () => aramgg.status());
      handle("aramgg-key-save", (value) =>
        aramgg.setKey(
          value === null
            ? null
            : z
                .string()
                .trim()
                .regex(/^[\w-]{16,200}$/, "API Key 格式不正确")
                .parse(value),
        ),
      );
      handle("aramgg-champion", (value) => aramgg.champion(hero.parse(value)));
      handle("aramgg-augments", () => aramgg.augments());
      handle("encounters-clear", () => {
        const { owner, platform } = currentOwner();
        return players.clearEncounters(owner, platform);
      });
      handle("match", (value) => history.match(matchId.parse(value)));
      // 工具集：全部由用户点击触发。
      handle("toolkit-reroll-state", () => toolkit.rerollState());
      handle("toolkit-reroll", () => toolkit.reroll());
      handle("toolkit-restart-ux", () => toolkit.restartUx());
      handle("toolkit-fix-window", async () => {
        const size = await toolkit.expectedWindowSize();
        if (!(await resizeClientWindow(size.width, size.height)))
          throw new AppError(
            "没有找到可调整的客户端窗口（最小化时请先还原）。",
            "CLIENT_WINDOW_MISSING",
          );
        return { width: size.width, height: size.height };
      });
      handle("toolkit-friends", () => toolkit.friends());
      handle("toolkit-spectate", (value) => toolkit.spectate(id.parse(value)));
      handle("toolkit-chat", () => toolkit.chat());
      handle("toolkit-chat-save", (value) =>
        toolkit.setChat(
          z
            .object({
              availability: z
                .enum(["chat", "away", "mobile", "offline"])
                .optional(),
              statusMessage: z.string().max(200).optional(),
            })
            .strict()
            .parse(value),
        ),
      );
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
        "aramgg-developer": "https://data.dtodo.cn/developer.html",
      };
      handle("open", (value) => {
        const target = z
          .enum(["hexdata", "github", "data-license", "aramgg-developer"])
          .parse(value);
        if (target === "hexdata") openHexdata(urls.hexdata);
        else return shell.openExternal(urls[target]);
      });
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
        title: "PEARLJAM HEX",
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
      const saved = storage.getSettings().companionSize ?? {};
      const bounds = companionBounds(area, {
        picker: saved.picker ?? companionSizes.picker,
        info: saved.info ?? companionSizes.info,
      });
      for (const role of ["picker", "info"] as const) {
        const window = new BrowserWindow({
          ...bounds[role],
          frame: false,
          // 无边框窗口仍可从边缘拖动调整大小；尺寸会记住到下次启动。
          resizable: true,
          ...companionLimits[role],
          maxWidth: companionLimits.maxWidth,
          maxHeight: companionLimits.maxHeight,
          maximizable: false,
          fullscreenable: false,
          movable: true,
          show: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          backgroundColor: "#10181b",
          title:
            role === "picker"
              ? "Mini · PEARLJAM HEX"
              : "英雄推荐 · PEARLJAM HEX",
          webPreferences,
        });
        if (role === "picker") pickerWindow = window;
        else infoWindow = window;
        // 用户拖动过的小窗保持其位置，不再自动贴靠客户端。
        window.on("will-move", () => userMoved.add(role));
        window.on("resized", () => {
          if (window.isDestroyed()) return;
          const { width, height } = window.getBounds();
          const current = storage.getSettings().companionSize ?? {};
          void storage
            .updateSettings({
              companionSize: { ...current, [role]: { width, height } },
            })
            .catch(() => {});
        });
        // ready-to-show 之外以页面加载完成作为备用就绪信号。
        const markReady = (source: string) => {
          if (readyCompanions.has(role)) return;
          readyCompanions.add(role);
          note(`${role} ready via ${source}`);
          updateCompanionWindows();
        };
        window.on("ready-to-show", () => markReady("ready-to-show"));
        window.webContents.on("did-finish-load", () =>
          setTimeout(() => markReady("did-finish-load"), 300),
        );
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
      // 函数声明会提升：小窗 ready-to-show 可能早于这里执行。
      function companionWindow(role: CompanionRole) {
        return role === "picker" ? pickerWindow : infoWindow;
      }
      /** 两个小窗的尺寸取自用户保存的尺寸或默认值，不用测量值，避免缩放取整导致越调越大。 */
      const companionSizesNow = (): CompanionSizes => {
        const saved = storage.getSettings().companionSize ?? {};
        return {
          picker: saved.picker ?? companionSizes.picker,
          info: saved.info ?? companionSizes.info,
        };
      };
      /** 贴在客户端窗口旁边；不知道客户端位置时放在主窗口所在屏幕右上角。 */
      function layoutCompanions(rect: WindowBounds | null) {
        const sizes = companionSizesNow();
        if (rect) {
          const dip = screen.screenToDipRect(null, rect);
          return alignToClient(
            dip,
            screen.getDisplayMatching(dip).workArea,
            sizes,
          );
        }
        const anchor =
          mainWindow && !mainWindow.isDestroyed()
            ? mainWindow.getBounds()
            : screen.getPrimaryDisplay().workArea;
        return companionBounds(
          screen.getDisplayMatching(anchor).workArea,
          sizes,
        );
      }
      function applyLayout(
        roles: CompanionRole[],
        next: ReturnType<typeof layoutCompanions>,
      ) {
        for (const role of roles) {
          const window = companionWindow(role);
          if (window && !window.isDestroyed() && !userMoved.has(role))
            window.setBounds(next[role]);
        }
      }
      async function placeCompanions(roles: CompanionRole[]) {
        const rect = await clientWindowRect();
        if (rect) lastClientRect = rect;
        applyLayout(roles, layoutCompanions(rect ?? lastClientRect));
      }
      function updateCompanionWindows() {
        const enabled = storage.getSettings().companionWindows !== false;
        const appearing: CompanionRole[] = [];
        for (const role of ["picker", "info"] as const) {
          const window = companionWindow(role);
          if (!window || window.isDestroyed()) continue;
          if (readyCompanions.has(role) && companions.visible(role, enabled)) {
            if (!window.isVisible()) appearing.push(role);
          } else if (window.isVisible()) {
            window.hide();
            note(`${role} hide phase=${client.state.phase}`);
          }
        }
        if (!appearing.length) return;
        // 先按上次已知的客户端位置同步排好并立即显示，再异步读取最新位置微调；
        // 显示不依赖任何异步结果，避免窗口因事件密集或读取失败而不出现。
        try {
          applyLayout(appearing, layoutCompanions(lastClientRect));
        } catch (error) {
          note(`layout failed ${(error as Error).message}`);
        }
        for (const role of appearing) companionWindow(role)?.showInactive();
        note(
          `show ${appearing.join("+")} phase=${client.state.phase} ready=${[...readyCompanions].join("+")}`,
        );
        void placeCompanions(appearing).catch((error) =>
          note(`place failed ${(error as Error).message}`),
        );
      }
      const repositionCompanions = () => {
        userMoved.clear();
        lastClientRect = null;
        void placeCompanions(["picker", "info"]).catch(() => {});
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
      // 仅隔离测试使用：环境变量开启时暴露窗口编排状态，可模拟阶段（不向客户端写入）。
      if (process.env.ASSISTANT_TEST_HOOKS === "1")
        Object.assign(globalThis, {
          __assistantTest: {
            companions: () => ({
              trace: [...trace],
              ready: [...readyCompanions],
              moved: [...userMoved],
              visible: (["picker", "info"] as const).map((role) =>
                companions.visible(role, true),
              ),
            }),
            emitState: (patch: Partial<typeof client.state>) =>
              client.emit("state", { ...client.state, ...patch }),
          },
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
  if (hexdataWindow && !hexdataWindow.isDestroyed()) hexdataWindow.destroy();
});
