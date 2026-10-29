import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Settings } from "../shared/types";

export const defaults: Settings = {
  autoAccept: false,
  acceptDelayMs: 1000,
  band: "all",
  mode: "rift",
  position: "ALL",
  tier: 255,
  autoRecognize: false,
  monitor: 0,
  overlay: true,
  companionWindows: true,
  closeAction: "ask",
  managedRunePage: null,
};
export class Storage {
  private settings: Settings = structuredClone(defaults);
  private writes = Promise.resolve();
  constructor(private directory: string) {}
  async initialize() {
    await mkdir(this.directory, { recursive: true });
    try {
      const value = JSON.parse(
        await readFile(join(this.directory, "settings.json"), "utf8"),
      );
      this.settings = validateSettings(value, defaults);
      const page = value.managedRunePage;
      if (
        Number.isInteger(page?.id) &&
        page.id > 0 &&
        typeof page.puuid === "string" &&
        /^[\w-]{1,128}$/.test(page.puuid)
      )
        this.settings.managedRunePage = { id: page.id, puuid: page.puuid };
    } catch {
      /* First run or a damaged settings file: keep safe defaults. */
    }
  }
  getSettings() {
    return structuredClone(this.settings);
  }
  async updateSettings(patch: Partial<Settings>) {
    this.settings = validateSettings(patch, this.settings);
    const snapshot = JSON.stringify(this.settings, null, 2);
    this.writes = this.writes
      .catch(() => {})
      .then(() => this.atomic("settings.json", snapshot));
    await this.writes;
    return this.getSettings();
  }
  async rememberRunePage(page: Settings["managedRunePage"]) {
    this.settings.managedRunePage = page;
    return this.updateSettings({});
  }
  private async atomic(name: string, data: string) {
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, name);
    await writeFile(target + ".tmp", data, "utf8");
    await rename(target + ".tmp", target);
  }
  async cache<T>(key: string): Promise<{ data: T; at: number } | null> {
    try {
      return JSON.parse(
        await readFile(join(this.directory, hash(key) + ".json"), "utf8"),
      );
    } catch {
      return null;
    }
  }
  private cacheWrites = new Map<string, Promise<void>>();
  async put<T>(key: string, data: T) {
    const name = hash(key) + ".json";
    const write = (this.cacheWrites.get(name) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.atomic(name, JSON.stringify({ at: Date.now(), data })));
    this.cacheWrites.set(name, write);
    try {
      await write;
    } finally {
      if (this.cacheWrites.get(name) === write) this.cacheWrites.delete(name);
    }
  }
}
function hash(key: string) {
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}
export function validateSettings(
  patch: Partial<Settings>,
  base: Settings,
): Settings {
  const next = { ...base };
  for (const key of [
    "autoAccept",
    "autoRecognize",
    "overlay",
    "companionWindows",
  ] as const)
    if (typeof patch[key] === "boolean") next[key] = patch[key]!;
  if (
    typeof patch.acceptDelayMs === "number" &&
    Number.isFinite(patch.acceptDelayMs)
  )
    next.acceptDelayMs = Math.max(
      1000,
      Math.min(10000, Math.round(patch.acceptDelayMs)),
    );
  if (["all", "casual", "mid", "high"].includes(patch.band ?? ""))
    next.band = patch.band!;
  if (patch.companionSize && typeof patch.companionSize === "object") {
    const size = { ...(base.companionSize ?? {}) };
    for (const role of ["picker", "info"] as const) {
      const value = (patch.companionSize as Record<string, any>)[role];
      if (
        Number.isInteger(value?.width) &&
        Number.isInteger(value?.height) &&
        value.width >= 280 &&
        value.width <= 1200 &&
        value.height >= 300 &&
        value.height <= 1400
      )
        size[role] = { width: value.width, height: value.height };
    }
    next.companionSize = size;
  }
  if (["ask", "tray", "quit"].includes(patch.closeAction ?? ""))
    next.closeAction = patch.closeAction!;
  if (["rift", "aram", "hex"].includes(patch.mode ?? ""))
    next.mode = patch.mode!;
  if (
    ["ALL", "TOP", "JUNGLE", "MIDDLE", "BOTTOM", "SUPPORT"].includes(
      patch.position ?? "",
    )
  )
    next.position = patch.position!;
  if (
    [255, 24, 25, 26, 27, 28, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 88].includes(
      patch.tier ?? -1,
    )
  )
    next.tier = patch.tier!;
  if (
    Number.isInteger(patch.monitor) &&
    patch.monitor! >= 0 &&
    patch.monitor! < 16
  )
    next.monitor = patch.monitor!;
  return next;
}
