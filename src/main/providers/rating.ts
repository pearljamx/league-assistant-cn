import type { SkillRating } from "../../shared/types";
import type { AramHexSkillPosition } from "../../shared/rating";
import { AppError } from "../errors";
import { jsonRequest } from "../http";

const RANK_API = "https://aramhex.com/api/rank";
const RANK_PAGE = "https://aramhex.com/rank/";
const CONFIG_API = "https://aramhex.com/config.json";
const HEADERS = { "User-Agent": "PearljamHex/0.3 (public rank lookup)" };

export function normalizeRatingRiotId(value: string) {
  return value
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
    .replace(/＃/g, "#")
    .replace(/\s*#\s*/g, "#")
    .trim();
}
function emptyPosition(
  message: string,
  status: AramHexSkillPosition["status"] = "unavailable",
): AramHexSkillPosition {
  return {
    provider: "aramhex",
    status,
    percentile: null,
    date: null,
    region: null,
    regionName: null,
    band: null,
    bandName: null,
    games: null,
    soloPercentile: null,
    soloGames: null,
    message,
    url: RANK_PAGE,
  };
}
function fraction(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : null;
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.slice(0, 120) : null;
}
export function parseAramHexPosition(
  body: unknown,
  platform?: string | null,
): AramHexSkillPosition {
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as any).results)
  )
    return emptyPosition("AramHex 位次返回格式无效，请稍后再试。", "error");
  const raw = body as Record<string, any>;
  const rows = raw.results.filter(
    (row: unknown) => row && typeof row === "object",
  );
  const region = platform?.toUpperCase();
  const row = region
    ? rows.find((item: any) => String(item.region).toUpperCase() === region)
    : rows.length === 1
      ? rows[0]
      : null;
  if (!row)
    return emptyPosition(
      region
        ? "AramHex 未收录当前大区的位次；不使用其他大区的结果。"
        : rows.length > 1
          ? "AramHex 返回多个大区，请连接客户端后按当前大区查询。"
          : "AramHex 暂未收录该玩家的海克斯位次。",
    );
  const top = fraction(row.top);
  if (top === null || !text(row.region))
    return emptyPosition("AramHex 位次字段无效，请稍后再试。", "error");
  return {
    provider: "aramhex",
    status: "ready",
    percentile: top,
    date:
      typeof raw.as_of === "string" &&
      /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw.as_of)
        ? raw.as_of
        : null,
    region: text(row.region),
    regionName: text(row.region_name),
    band: text(row.band),
    bandName: text(row.band_name),
    games: count(row.games),
    soloPercentile: fraction(row.solo_top),
    soloGames: count(row.solo_games),
    message:
      "AramHex 区内位次 · 近 30 天采集对局推算；不是 Hexdata 海斗分或官方隐藏分。",
    url: RANK_PAGE,
  };
}

export class SkillRatingProvider {
  private cache = new Map<
    string,
    { until: number; value: AramHexSkillPosition }
  >();
  private pending = new Map<string, Promise<AramHexSkillPosition>>();
  private config: {
    until: number;
    enabled: boolean;
    validApi: boolean;
  } | null = null;
  private configPending: Promise<{
    enabled: boolean;
    validApi: boolean;
  }> | null = null;
  private blockedUntil = 0;

  async query(
    riotId?: string,
    platform?: string | null,
  ): Promise<SkillRating & { aramhex: AramHexSkillPosition }> {
    return {
      provider: "hexdata",
      status: "needs-authorization",
      score: null,
      percentile: null,
      date: null,
      message:
        "Hexdata 海斗分直连待正式接入资料与授权。AramHex 区内位次单独展示，不替代海斗分。",
      url: "https://hexdata.com.cn/matchmaking-position",
      aramhex: await this.position(riotId, platform),
    };
  }
  private async configuration(): Promise<{
    enabled: boolean;
    validApi: boolean;
  }> {
    if (this.config && this.config.until > Date.now()) return this.config;
    if (this.configPending) return this.configPending;
    const request = (async () => {
      const raw = await jsonRequest<any>(CONFIG_API, {
        headers: HEADERS,
        timeout: 6000,
      });
      const rank = raw?.rank;
      if (!rank || typeof rank !== "object")
        throw new AppError("AramHex 查询配置无效。", "RANK_CONFIG_INVALID");
      const value = {
        enabled: rank.enabled !== false,
        validApi: !rank.api || rank.api === RANK_API,
      };
      this.config = { ...value, until: Date.now() + 10 * 60_000 };
      return value;
    })();
    this.configPending = request;
    try {
      return await request;
    } finally {
      if (this.configPending === request) this.configPending = null;
    }
  }
  private async position(
    riotId?: string,
    platform?: string | null,
  ): Promise<AramHexSkillPosition> {
    const normalized = normalizeRatingRiotId(riotId ?? "");
    if (
      !normalized ||
      normalized.length > 100 ||
      !/^[^#\r\n]+#[^#\r\n]+$/.test(normalized)
    )
      return emptyPosition(
        "请登录客户端或输入完整「名字#编号」查询 AramHex 区内位次。",
      );
    const key = `${platform ?? ""}:${normalized}`;
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now())
      return structuredClone(cached.value);
    const existing = this.pending.get(key);
    if (existing) return structuredClone(await existing);
    if (this.blockedUntil > Date.now())
      return emptyPosition(
        "AramHex 查询过于频繁，请一分钟后重试。",
        "rate-limited",
      );
    const request = this.fetchPosition(normalized, platform);
    this.pending.set(key, request);
    try {
      const value = await request;
      if (this.cache.size >= 100)
        this.cache.delete(this.cache.keys().next().value!);
      const ttl =
        value.status === "ready"
          ? 10 * 60_000
          : value.status === "error"
            ? 30_000
            : 60_000;
      this.cache.set(key, { value, until: Date.now() + ttl });
      return structuredClone(value);
    } finally {
      if (this.pending.get(key) === request) this.pending.delete(key);
    }
  }
  private async fetchPosition(
    riotId: string,
    platform?: string | null,
  ): Promise<AramHexSkillPosition> {
    try {
      const config = await this.configuration();
      if (!config.enabled)
        return emptyPosition("AramHex 官方已暂时关闭位次查询，请稍后再试。");
      if (!config.validApi)
        return emptyPosition("AramHex 公布的接口已变化，等待适配后再查询。");
      const url = new URL(RANK_API);
      url.searchParams.set("id", riotId);
      const raw = await jsonRequest<unknown>(url.href, {
        headers: HEADERS,
        timeout: 10000,
      });
      return parseAramHexPosition(raw, platform);
    } catch (error) {
      if (error instanceof AppError && error.status === 429) {
        this.blockedUntil = Date.now() + 60_000;
        return emptyPosition(
          "AramHex 查询过于频繁，请一分钟后重试。",
          "rate-limited",
        );
      }
      if (error instanceof AppError && error.status === 404)
        return emptyPosition("AramHex 暂未收录该玩家的海克斯位次。");
      if (error instanceof AppError && [401, 403].includes(error.status ?? 0))
        return emptyPosition(
          "AramHex 当前仅允许官方软件查分，第三方接入尚未获准；可前往官方查分页。",
          "needs-authorization",
        );
      return emptyPosition(
        "AramHex 位次查询失败，请检查网络或稍后重试。",
        "error",
      );
    }
  }
}
