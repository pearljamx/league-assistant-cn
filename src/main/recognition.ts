import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Augment, Recognition } from "../shared/types";
import type { Client } from "./client";
import type { Storage } from "./storage";
import type { AramHexProvider } from "./providers/aramhex";
import { AppError } from "./errors";

export const idleRecognition = (): Recognition => ({
  status: "idle",
  message: "等待海克斯三选一",
  augmentIds: [],
  rawTexts: [],
  captureId: 0,
  monitor: 0,
  updatedAt: new Date().toISOString(),
});
export class RecognitionService extends EventEmitter {
  state = idleRecognition();
  private child: ChildProcessWithoutNullStreams | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private sequence = 0;
  private epoch = 0;
  private context = "";
  private busy = false;
  private dictionary: Augment[] = [];
  private stopped = false;
  private retryAt = 0;
  constructor(
    private client: Client,
    private storage: Storage,
    private data: AramHexProvider,
    private root: string,
    private resources: string,
    private packaged: boolean,
  ) {
    super();
    client.on("state", () => this.contextChanged());
  }
  start() {
    this.stopped = false;
    this.contextChanged();
    this.timer = setInterval(() => {
      if (
        (this.storage.getSettings().autoRecognize ||
          this.state.status === "recognized") &&
        this.active() &&
        !this.busy &&
        Date.now() > this.retryAt
      )
        void this.scan(false).catch(() => {});
    }, 900);
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.child?.kill();
    this.child = null;
    this.rejectPending();
  }
  private active() {
    return (
      this.client.state.status === "connected" &&
      this.client.state.phase === "InProgress" &&
      this.client.state.mode === "hex" &&
      Boolean(this.client.state.championId)
    );
  }
  private publish(patch: Partial<Recognition>) {
    this.state = {
      ...this.state,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.emit("recognition", structuredClone(this.state));
  }
  private contextChanged() {
    const context = `${this.client.state.status}:${this.client.state.summoner?.puuid}:${this.client.state.phase}:${this.client.state.mode}:${this.client.state.championId}:${this.storage.getSettings().monitor}:${this.storage.getSettings().band}`;
    if (context === this.context) return;
    this.context = context;
    this.epoch++;
    this.dictionary = [];
    this.publish({
      ...idleRecognition(),
      message: this.active()
        ? "海克斯对局中 · 等待三选一"
        : "仅在海克斯对局中识别；可在数据页手动比较强化",
    });
  }
  settingsChanged() {
    this.contextChanged();
    if (!this.storage.getSettings().autoRecognize) this.epoch++;
  }
  private rejectPending() {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new AppError("本地识别进程已停止。", "OCR_EXITED"));
    }
    this.pending.clear();
  }
  private launch() {
    if (this.child) return;
    const exe = join(this.resources, "ocr", "league-ocr.exe");
    const python = join(this.root, ".venv-ocr", "Scripts", "python.exe");
    if (this.packaged && !existsSync(exe))
      throw new AppError(
        "当前安装包未包含 OCR 组件，请使用包含识别组件的完整安装包。",
        "OCR_NOT_INSTALLED",
      );
    if (!this.packaged && !existsSync(python))
      throw new AppError(
        "OCR 开发环境未安装。请按 README 配置，或使用完整安装包。",
        "OCR_NOT_INSTALLED",
      );
    const child = spawn(
      this.packaged ? exe : python,
      this.packaged ? [] : [join(this.root, "worker", "recognizer.py")],
      {
        cwd: this.packaged ? this.resources : this.root,
        windowsHide: true,
        stdio: "pipe",
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUNBUFFERED: "1",
        },
      },
    );
    this.child = child;
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message.event === "changed") {
          this.publish({
            status: "scanning",
            message: "选项变化，正在重新识别",
            augmentIds: [],
            rawTexts: [],
          });
          return;
        }
        const pending = this.pending.get(message.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(message.requestId);
          pending.resolve(message);
        }
      } catch {
        /* Dependency diagnostics must never become UI data. */
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", () => {
      if (this.child === child) this.child = null;
      this.rejectPending();
      this.publish({
        status: "error",
        message: "识别组件启动失败，请检查安装是否完整。",
        augmentIds: [],
      });
      this.retryAt = Date.now() + 30000;
    });
    child.on("exit", () => {
      if (this.child === child) this.child = null;
      this.rejectPending();
      if (!this.stopped) this.retryAt = Date.now() + 30000;
    });
  }
  private request(command: string, body: any = {}): Promise<any> {
    this.launch();
    const requestId = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new AppError("识别超时，请重新尝试。", "OCR_TIMEOUT"));
        this.child?.kill();
        this.child = null;
      }, 18000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.child!.stdin.write(
        JSON.stringify({ command, requestId, ...body }) + "\n",
        (error) => {
          if (error) {
            clearTimeout(timer);
            this.pending.delete(requestId);
            reject(new AppError("无法请求识别组件。", "OCR_PIPE"));
          }
        },
      );
    });
  }
  async displays(): Promise<
    { id: number; name: string; width: number; height: number }[]
  > {
    const message = await this.request("displays");
    return message.displays;
  }
  async scan(force = true): Promise<Recognition> {
    if (!this.active())
      throw new AppError(
        "请在海克斯大乱斗对局中按 F6 识别；游戏需设为无边框或窗口模式。",
        "OCR_INVALID_PHASE",
      );
    if (this.busy) return this.state;
    this.busy = true;
    const epoch = this.epoch;
    try {
      if (!this.dictionary.length) {
        const catalog = await this.data.catalog();
        if (epoch !== this.epoch) return this.state;
        this.dictionary = catalog;
      }
      if (this.state.status !== "recognized")
        this.publish({ status: "scanning", message: "正在检查三选一画面" });
      const message = await this.request("scan", {
        context: force
          ? `${this.context}:manual:${++this.sequence}`
          : this.context,
        dictionary: this.dictionary.map(({ id, name }) => ({ id, name })),
        monitor: this.storage.getSettings().monitor,
      });
      if (epoch !== this.epoch) return this.state;
      const result = message.result;
      if (
        !result ||
        !["recognized", "uncertain", "idle", "error"].includes(result.status)
      )
        throw new AppError("识别组件返回格式无效。", "OCR_PROTOCOL");
      this.publish({
        status: result.status,
        message: result.message,
        augmentIds:
          result.status === "recognized"
            ? result.cards.map((card: any) => Number(card.id))
            : [],
        rawTexts: result.cards?.map((card: any) => String(card.text)) ?? [],
        captureId: message.requestId,
        monitor: result.monitor ?? 0,
        gameWindow: result.gameWindow,
      });
      return this.state;
    } catch (error) {
      if (epoch !== this.epoch) return this.state;
      this.retryAt = Date.now() + 15000;
      this.publish({
        status:
          error instanceof AppError && error.code === "OCR_NOT_INSTALLED"
            ? "unavailable"
            : "error",
        message:
          error instanceof AppError
            ? error.message
            : "识别未完成，请重试或手动选择强化。",
        augmentIds: [],
        rawTexts: [],
      });
      return this.state;
    } finally {
      this.busy = false;
    }
  }
  async manual(ids: number[]) {
    if (new Set(ids).size !== 3 || ids.length !== 3)
      throw new AppError("请选择三个不同的强化。", "INVALID_AUGMENTS");
    const epoch = this.epoch;
    const catalog = await this.data.catalog();
    if (epoch !== this.epoch)
      throw new AppError(
        "英雄或统计分组已变化，请重新选择。",
        "STALE_SELECTION",
      );
    if (ids.some((id) => !catalog.some((item) => item.id === id)))
      throw new AppError(
        "选项中存在当前数据未收录的强化。",
        "INVALID_AUGMENTS",
      );
    this.epoch++;
    this.publish({
      status: "recognized",
      message: "手动确认的三个强化",
      augmentIds: ids,
      rawTexts: [],
      captureId: ++this.sequence,
    });
    return this.state;
  }
}
