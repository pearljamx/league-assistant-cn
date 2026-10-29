import { AppError } from "../errors";
import { publicJson } from "../http";
import type { Storage } from "../storage";
import type { SecretStore } from "../secrets";
import type {
  AramggAugment,
  AramggBuild,
  AramggChampion,
  AramggOption,
  AramggStatus,
} from "../../shared/types";

// aramgg.com 官方第三方数据 API（data.dtodo.cn）。免费计划每天 200 credits、每分钟 60 次：
// 先免费读取 config.json 的 dataVersion，版本不变时只用本地缓存，避免重复消耗额度。
const base = "https://data.dtodo.cn/api/v1/zh-CN";
const iconPrefix = "https://cdn.dtodo.cn/";
const versionTtl = 30 * 60 * 1000;
export const sourceName = "aramgg.com 数据 API";

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const ratio = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && n >= 0 && n <= 1 ? n : null;
};
const count = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && n >= 0 && Number.isInteger(n) ? n : null;
};
const text = (value: unknown, max = 64) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
/** 只接受数据方 CDN 上的图标地址，其余一律丢弃。 */
const icon = (value: unknown): string | null =>
  typeof value === "string" &&
  value.startsWith(iconPrefix) &&
  !/[\s"'<>]/.test(value) &&
  value.length < 300
    ? value
    : null;
const ids = (value: unknown): number[] =>
  Array.isArray(value)
    ? value
        .filter((id): id is number => Number.isInteger(id) && id > 0)
        .slice(0, 8)
    : [];
const list = (value: unknown, limit: number): any[] =>
  Array.isArray(value) ? value.slice(0, limit) : [];

function option(raw: any): AramggOption {
  const entries = list(raw?.items ?? raw?.spells ?? raw?.augments, 8);
  return {
    ids: ids(
      raw?.itemIds ??
        raw?.summonerSpellIds ??
        raw?.augmentIds ??
        (raw?.id ? [raw.id] : []),
    ),
    names: entries.map((item) => text(item?.name)).filter(Boolean),
    games: count(raw?.games ?? raw?.stats?.games),
    winRate: ratio(raw?.winRate ?? raw?.stats?.winRate),
    pickRate: ratio(raw?.pickRate ?? raw?.stats?.pickRate),
  };
}
function build(raw: any): AramggBuild {
  const tags =
    raw?.tags && typeof raw.tags === "object"
      ? Object.values(raw.tags)
          .filter((value) => typeof value === "string")
          .join(" / ")
      : "";
  return {
    tags: text(tags, 48),
    games: count(raw?.stats?.games),
    winRate: ratio(raw?.stats?.winRate),
    pickRate: ratio(raw?.stats?.pickRate),
    core: list(raw?.coreItems, 3).map(option),
    starting: list(raw?.startingItems, 3).map(option),
    situational: list(raw?.situationalItems, 12).map((item) =>
      option({ ...item, itemIds: [item?.id], items: [item] }),
    ),
    spells: list(raw?.summonerSpells, 3).map(option),
    skills: list(raw?.skillOrders, 3).map((item) => ({
      keys: list(item?.skillKeys, 18).filter((key) =>
        ["Q", "W", "E", "R"].includes(key),
      ),
      games: count(item?.games),
      winRate: ratio(item?.winRate),
    })),
  };
}
export function normalizeAugment(raw: any): AramggAugment | null {
  const id = Number(raw?.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const stats = raw?.stats ?? {};
  return {
    id,
    name: text(raw?.name) || `强化 ${id}`,
    rarity: ["silver", "gold", "prismatic"].includes(raw?.rarityName)
      ? raw.rarityName
      : "",
    iconUrl: icon(raw?.iconUrl),
    tier: count(stats.tier),
    rank: count(stats.rank),
    total: count(stats.total),
    winRate: ratio(stats.winRate),
    games: count(stats.games),
    pickRate: ratio(stats.pickRate),
  };
}
/** 校验并精简单英雄详情；只保留数字与文字，不保留任何链接以外的富文本。 */
export function normalizeChampion(
  json: any,
  championId: number,
): Omit<AramggChampion, "source"> & { date: string | null } {
  const data = json?.data;
  if (
    !data ||
    typeof data !== "object" ||
    Number(data.champion?.id) !== championId
  )
    throw new AppError("aramgg 返回的英雄数据不完整。", "INVALID_RESPONSE");
  const augments = list(data.augments, 300)
    .map(normalizeAugment)
    .filter((row): row is AramggAugment => Boolean(row))
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  return {
    championId,
    date: text(data.champion?.stats?.date, 20) || null,
    tier: count(data.champion?.stats?.tier),
    winRate: ratio(data.champion?.stats?.winRate),
    pickRate: ratio(data.champion?.stats?.pickRate),
    augments,
    trios: list(data.augmentTrios, 5).map(option),
    builds: list(data.builds, 4).map(build),
  };
}

type Cached<T> = { dataVersion: string; gamePatch: string | null; data: T };

export class AramggProvider {
  private version: {
    dataVersion: string;
    gamePatch: string | null;
    at: number;
  } | null = null;
  private credits: { remaining: number | null; daily: number | null } = {
    remaining: null,
    daily: null,
  };
  private lastError: string | null = null;
  private pending = new Map<string, Promise<unknown>>();
  constructor(
    private storage: Storage,
    private secrets: SecretStore,
  ) {}

  async hasKey() {
    return Boolean(await this.secrets.get());
  }
  async status(): Promise<AramggStatus> {
    return {
      public: null,
      configured: Boolean(await this.secrets.get()),
      masked: await this.secrets.masked(),
      gamePatch: this.version?.gamePatch ?? null,
      dataVersion: this.version?.dataVersion ?? null,
      creditsRemaining: this.credits.remaining,
      creditsDaily: this.credits.daily,
      error: this.lastError,
    };
  }
  async setKey(key: string | null) {
    await this.secrets.set(key);
    this.lastError = null;
    this.credits = { remaining: null, daily: null };
    return this.status();
  }
  /** config.json 不消耗额度；失败时沿用上次成功读取的版本。 */
  private async currentVersion() {
    if (this.version && Date.now() - this.version.at < versionTtl)
      return this.version;
    try {
      const { data } = await publicJson<any>(`${base}/config.json`, {
        timeout: 8000,
        maxBytes: 64 * 1024,
      });
      const dataVersion = text(data?.dataVersion, 32);
      if (!dataVersion)
        throw new AppError("aramgg 版本信息不完整。", "INVALID_RESPONSE");
      this.version = {
        dataVersion,
        gamePatch: text(data?.gamePatch, 16) || null,
        at: Date.now(),
      };
      await this.storage.put("aramgg-v1:config", this.version);
    } catch (error) {
      const cached =
        await this.storage.cache<NonNullable<typeof this.version>>(
          "aramgg-v1:config",
        );
      if (!cached) throw error;
      this.version = { ...cached.data, at: Date.now() - versionTtl + 60_000 };
    }
    return this.version;
  }
  private async authed<T>(path: string, maxBytes: number): Promise<T> {
    const key = await this.secrets.get();
    if (!key)
      throw new AppError(
        "尚未填写 aramgg API Key，可在设置“数据与隐私”中配置。",
        "ARAMGG_NO_KEY",
      );
    try {
      const { data, headers } = await publicJson<T>(base + path, {
        headers: { "x-api-key": key },
        timeout: 15000,
        maxBytes,
      });
      const remaining = Number(headers.get("x-credits-remaining")),
        daily = Number(headers.get("x-credits-daily"));
      this.credits = {
        remaining: Number.isFinite(remaining)
          ? remaining
          : this.credits.remaining,
        daily: Number.isFinite(daily) ? daily : this.credits.daily,
      };
      this.lastError = null;
      return data;
    } catch (error) {
      const status = error instanceof AppError ? error.status : undefined;
      const message =
        status === 401
          ? "aramgg API Key 无效或已失效，请在设置中检查。"
          : status === 429
            ? "aramgg 今日额度已用完或请求过快，请稍后再试。"
            : (error as Error).message;
      this.lastError = message;
      throw new AppError(
        message,
        status ? `ARAMGG_${status}` : "ARAMGG_FAILED",
        status,
      );
    }
  }
  /** 同一 dataVersion 内只请求一次；网络失败时返回上次缓存并标明过期。 */
  private async cachedResource<T>(key: string, load: () => Promise<T>) {
    const running = this.pending.get(key) as
      | Promise<Cached<T> & { stale: boolean }>
      | undefined;
    if (running) return running;
    const task = (async () => {
      const cached = await this.storage.cache<Cached<T>>(key);
      let version: Awaited<
        ReturnType<AramggProvider["currentVersion"]>
      > | null = null;
      try {
        version = await this.currentVersion();
      } catch (error) {
        if (cached) return { ...cached.data, stale: true };
        throw error;
      }
      if (cached && cached.data.dataVersion === version.dataVersion)
        return { ...cached.data, stale: false };
      try {
        const data = await load();
        const value: Cached<T> = {
          dataVersion: version.dataVersion,
          gamePatch: version.gamePatch,
          data,
        };
        await this.storage.put(key, value);
        return { ...value, stale: false };
      } catch (error) {
        if (cached) return { ...cached.data, stale: true };
        throw error;
      }
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
  async champion(championId: number): Promise<AramggChampion> {
    const result = await this.cachedResource(
      `aramgg-v1:champion:${championId}`,
      async () =>
        normalizeChampion(
          await this.authed<any>(
            `/champions/${championId}.json`,
            4 * 1024 * 1024,
          ),
          championId,
        ),
    );
    const { date, ...data } = result.data;
    return {
      ...data,
      source: {
        name: sourceName,
        gamePatch: result.gamePatch,
        dataVersion: result.dataVersion,
        date,
        stale: result.stale,
      },
    };
  }
  /** 全部强化的名称、品质与图标，用于战绩卡片等只有强化编号的场景。 */
  async augments() {
    const result = await this.cachedResource("aramgg-v1:augments", async () => {
      const json = await this.authed<any>("/augments.json", 8 * 1024 * 1024);
      const map: Record<
        number,
        { name: string; rarity: string; iconUrl: string | null }
      > = {};
      for (const raw of list(json?.data, 600)) {
        const row = normalizeAugment(raw);
        if (row)
          map[row.id] = {
            name: row.name,
            rarity: row.rarity,
            iconUrl: row.iconUrl,
          };
      }
      return map;
    });
    return result.data;
  }
}
