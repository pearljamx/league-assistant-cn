import { createHash } from "node:crypto";
import type {
  AugmentRanking,
  Augment,
  Band,
  Overview,
  SourceInfo,
} from "../../shared/types";
import { bytesRequest, jsonRequest } from "../http";
import { AppError } from "../errors";
import { CachedProvider } from "./cache";
import type { Storage } from "../storage";

const raw = "https://raw.githubusercontent.com/czgreat/aramhex-data";
export function availableBands(meta: any): { id: Band; name: string }[] {
  const result: { id: Band; name: string }[] = [
    { id: "all", name: "全部样本" },
  ];
  const bands = meta.bands?.bands ?? {};
  for (const id of ["casual", "mid", "high"] as const)
    if (bands[id] && !bands[id].alias_of)
      result.push({
        id,
        name:
          bands[id].label || { casual: "娱乐", mid: "中分", high: "前 5%" }[id],
      });
  return result;
}
export function smoothedRate(wins: number, games: number, baseline: number) {
  return (wins + baseline * 300) / (games + 300);
}
export class AramHexProvider extends CachedProvider {
  constructor(storage: Storage) {
    super(storage);
  }
  private async snapshot() {
    return (
      await this.cached<any>("aramhex-manifest-v1", 6 * 3600000, () =>
        jsonRequest(`${raw}/main/latest.json`),
      )
    ).data;
  }
  private async file(manifest: any, name: string) {
    if (
      !/^patches\/[\w.-]+\/[\w-]+$/.test(manifest.path) ||
      !Number.isInteger(manifest.seq) ||
      manifest.seq < 1 ||
      !manifest.files?.[name]?.sha256
    )
      throw new AppError("海克斯数据目录或校验信息无效。", "DATA_MANIFEST");
    const { data, stale } = await this.cached<any>(
      `aramhex:${manifest.seq}:${name}`,
      365 * 86400000,
      async () => {
        const bytes = await bytesRequest(
          `${raw}/data-v${manifest.seq}/${manifest.path}/${name}`,
          { timeout: 25000 },
        );
        const sha = createHash("sha256").update(bytes).digest("hex");
        if (sha !== manifest.files[name].sha256)
          throw new AppError(
            "数据校验失败，已保留原有缓存。",
            "CHECKSUM_FAILED",
          );
        try {
          return JSON.parse(bytes.toString("utf8"));
        } catch {
          throw new AppError("海克斯数据无法解析。", "DATA_FORMAT");
        }
      },
    );
    return { data, stale };
  }
  private source(manifest: any, band: Band): SourceInfo {
    return {
      id: "aramhex",
      name: "AramHex · 国服对局样本",
      url: "https://github.com/czgreat/aramhex-data",
      mode: "hex",
      patch: manifest.patch,
      date: manifest.snapshot_at,
      band,
      license: "CC BY-NC 4.0（非商业）",
      stale:
        Date.now() - new Date(manifest.snapshot_at).getTime() > 7 * 86400000,
    };
  }
  private async metadata(band: Band) {
    const manifest = await this.snapshot();
    const { data: meta } = await this.file(manifest, "meta.json");
    const bands = availableBands(meta);
    if (!bands.some((item) => item.id === band))
      throw new AppError(
        "当前数据版本没有该分组，请选择全部样本。",
        "BAND_UNAVAILABLE",
      );
    return {
      manifest,
      meta,
      bands,
      prefix: band === "all" ? "" : `bands/${band}/`,
    };
  }
  async catalog(): Promise<Augment[]> {
    const manifest = await this.snapshot();
    const { data: names } = await this.file(manifest, "augments.json");
    return this.augmentNames(names);
  }
  private augmentNames(names: Record<string, any>): Augment[] {
    return Object.entries(names)
      .map(([id, row]) => ({
        id: Number(id),
        name: String(row.name),
        rarity: String(row.rarity),
      }))
      .filter((row) => Number.isInteger(row.id) && row.id > 0 && row.name)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }
  async overview(band: Band): Promise<Overview> {
    const { manifest, meta, bands, prefix } = await this.metadata(band);
    const { data: heroes } = await this.file(manifest, prefix + "heroes.json");
    return {
      source: this.source(manifest, band),
      bands,
      heroes: Object.entries(heroes).map(([id, hero]: [string, any]) => ({
        championId: Number(id),
        rank: Number(hero.rank) || null,
        games: Number(hero.games),
        winRate: hero.games > 0 ? hero.wins / hero.games : null,
        pickRate:
          typeof hero.pick_rate === "number" && hero.pick_rate <= 1
            ? hero.pick_rate
            : band === "all" && meta.hero_participations
              ? hero.games / meta.hero_participations
              : null,
      })),
    };
  }
  async augments(
    championId: number | null,
    band: Band,
  ): Promise<AugmentRanking> {
    const { manifest, meta, prefix } = await this.metadata(band);
    const [{ data: heroes }, { data: pairs }, { data: names }] =
      await Promise.all([
        this.file(manifest, prefix + "heroes.json"),
        this.file(manifest, prefix + "hero_augments.json"),
        this.file(manifest, "augments.json"),
      ]);
    if (championId !== null && !heroes[String(championId)])
      throw new AppError("当前版本没有该英雄的海克斯统计。", "NO_DATA");
    const baseline =
      championId === null
        ? 0.5
        : Number(heroes[String(championId)].wins) /
          Number(heroes[String(championId)].games);
    const rows: Record<
      string,
      { wins: number; games: number; low_sample?: boolean }
    > = {};
    if (championId !== null)
      Object.assign(rows, pairs[String(championId)] ?? {});
    else
      for (const entries of Object.values(pairs) as any[])
        for (const [id, row] of Object.entries(entries) as [string, any][]) {
          const total = rows[id] ?? { wins: 0, games: 0 };
          total.wins += Number(row.wins);
          total.games += Number(row.games);
          rows[id] = total;
        }
    const totalGames =
      championId === null
        ? Object.values(heroes).reduce(
            (sum: number, hero: any) => sum + Number(hero.games),
            0,
          )
        : Number(heroes[String(championId)].games);
    const augments = Object.entries(rows)
      .filter(
        ([id, row]) =>
          names[id] && !meta.excluded_augments?.[id] && row.games > 0,
      )
      .map(([id, row]) => {
        const smoothed = smoothedRate(row.wins, row.games, baseline);
        return {
          augment: {
            id: Number(id),
            name: names[id].name,
            rarity: names[id].rarity,
          },
          wins: row.wins,
          games: row.games,
          winRate: row.wins / row.games,
          pickRate: totalGames > 0 ? row.games / totalGames : null,
          smoothedWinRate: smoothed,
          delta: smoothed - baseline,
          lowSample: Boolean(
            row.low_sample ||
              row.games < Number(meta.low_sample_threshold ?? 3000),
          ),
        };
      })
      .sort(
        (a, b) =>
          b.smoothedWinRate - a.smoothedWinRate ||
          (b.games ?? 0) - (a.games ?? 0),
      );
    return {
      source: this.source(manifest, band),
      championId,
      baseline,
      augments,
      catalog: this.augmentNames(names),
      exposure:
        meta.augment_exposure ||
        "对局结束时持有；统计相关性，不代表选择后的因果胜率。",
    };
  }
}
