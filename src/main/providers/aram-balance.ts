import type { AramBalanceTable } from "../../shared/types";
import { AppError } from "../errors";
import { publicBytes } from "../http";
import type { Storage } from "../storage";

/** League of Legends Wiki 的英雄数据模块（Lua 源码），内含大乱斗平衡调整倍率。 */
export const ARAM_BALANCE_URL =
  "https://wiki.leagueoflegends.com/en-us/Module:ChampionData/data?action=raw";
const SOURCE = "League of Legends Wiki · Module:ChampionData";
const LICENSE = "CC BY-SA 3.0";
const CACHE_KEY = "aram-balance-v1";
const TTL = 12 * 60 * 60_000;
/** 倍率项（1 为无调整）与加减项（技能急速，0 为无调整）。 */
export const ratioKeys = [
  "dmg_dealt",
  "dmg_taken",
  "healing",
  "shielding",
  "tenacity",
  "energyregen_mod",
  "total_as",
  "ms_mod",
] as const;
export const additiveKeys = ["ability_haste"] as const;

/**
 * 只解析每个英雄的 id 与 ["aram"] 表中的数字；先去掉 Lua 注释（被注释掉的旧调整不算）。
 * 解析出的英雄少于 100 个视为格式变化，拒绝使用。
 */
export function parseAramBalance(lua: string) {
  const text = lua.replace(/--[^\n]*/g, "");
  const starts = [...text.matchAll(/^ {2}\["[^"\n]+"\]\s*=\s*\{\s*$/gm)].map(
    (match) => match.index!,
  );
  const champions: Record<number, Record<string, number>> = {};
  let parsed = 0;
  starts.forEach((start, index) => {
    const block = text.slice(start, starts[index + 1] ?? text.length);
    const id = Number(block.match(/\["id"\]\s*=\s*(\d+)/)?.[1]);
    if (!Number.isInteger(id) || id <= 0 || id > 100000) return;
    parsed++;
    const aram = block.match(/\["aram"\]\s*=\s*\{([^{}]*)\}/)?.[1];
    if (!aram) return;
    const modifiers: Record<string, number> = {};
    for (const [, key, raw] of aram.matchAll(
      /\["(\w+)"\]\s*=\s*(-?\d+(?:\.\d+)?)/g,
    )) {
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      if ((ratioKeys as readonly string[]).includes(key)) {
        if (value > 0 && value < 5 && value !== 1) modifiers[key] = value;
      } else if ((additiveKeys as readonly string[]).includes(key)) {
        if (Math.abs(value) <= 100 && value !== 0) modifiers[key] = value;
      }
    }
    if (Object.keys(modifiers).length) champions[id] = modifiers;
  });
  if (parsed < 100)
    throw new AppError("大乱斗平衡数据格式已变化。", "BALANCE_FORMAT");
  return champions;
}

export class AramBalanceProvider {
  private value: AramBalanceTable | null = null;
  private until = 0;
  private pending: Promise<AramBalanceTable> | null = null;
  constructor(
    private storage: Storage,
    private fetchText: (url: string) => Promise<string> = async (url) =>
      (
        await publicBytes(url, {
          timeout: 20000,
          maxBytes: 4 * 1024 * 1024,
          headers: { Accept: "text/plain" },
        })
      ).body.toString("utf8"),
  ) {}
  async get(): Promise<AramBalanceTable> {
    if (this.value && this.until > Date.now()) return structuredClone(this.value);
    this.pending ??= this.load().finally(() => (this.pending = null));
    return structuredClone(await this.pending);
  }
  private async load(): Promise<AramBalanceTable> {
    const cached = await this.storage.cache<AramBalanceTable>(CACHE_KEY);
    if (cached && Date.now() - cached.at < TTL && cached.data?.champions) {
      this.remember(cached.data, cached.at + TTL);
      return cached.data;
    }
    try {
      const champions = parseAramBalance(await this.fetchText(ARAM_BALANCE_URL));
      const value: AramBalanceTable = {
        champions,
        source: SOURCE,
        license: LICENSE,
        fetchedAt: new Date().toISOString(),
        stale: false,
      };
      await this.storage.put(CACHE_KEY, value).catch(() => {});
      this.remember(value, Date.now() + TTL);
      return value;
    } catch (error) {
      // 网络失败时用旧缓存并标明，10 分钟后再试；没有缓存则报错，界面不显示调整。
      if (cached?.data?.champions) {
        const value = { ...cached.data, stale: true };
        this.remember(value, Date.now() + 10 * 60_000);
        return value;
      }
      throw error instanceof AppError
        ? error
        : new AppError("大乱斗平衡数据暂时无法读取。", "BALANCE_UNAVAILABLE");
    }
  }
  private remember(value: AramBalanceTable, until: number) {
    this.value = value;
    this.until = until;
  }
}
