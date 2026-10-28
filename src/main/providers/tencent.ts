import type {
  HeroStat,
  ItemOption,
  Overview,
  Position,
  Recommendation,
  RuneOption,
  SkillOption,
  SourceInfo,
  StatsQuery,
} from "../../shared/types";
import { AppError } from "../errors";
import { jsonRequest } from "../http";
import { CachedProvider } from "./cache";
import { runeStyles, type CatalogProvider, type RuneStyle } from "./catalog";
import type { Storage } from "../storage";

const root = "https://mlol.qt.qq.com";
export function payload(envelope: any): Record<string, string> {
  if (envelope.code !== undefined && Number(envelope.code) !== 0)
    throw new AppError(
      "腾讯统计服务暂时不可用，请稍后重试。",
      "TENCENT_UNAVAILABLE",
    );
  const text = Object.values(envelope.data?._fieldValues ?? {}).find(
    (value) => typeof value === "string" && value.trim(),
  );
  if (!text) return {};
  try {
    return JSON.parse(String(text));
  } catch {
    throw new AppError("腾讯统计数据格式有变化。", "TENCENT_FORMAT");
  }
}
export function rate(value: unknown, divisor = 1): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value) / divisor;
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}
export const ids = (text: unknown): number[] =>
  String(text ?? "")
    .split(/[,;&|]/)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
export function itemRows(text = ""): ItemOption[] {
  return text
    .split("#")
    .map((row) => row.split("_"))
    .filter((row) => row.length >= 4 && ids(row[0]).length)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((row) => ({
      ids: ids(row[0]),
      pickRate: rate(row[2], 100),
      winRate: rate(row[3], 100),
      games: null,
    }));
}
export function runeRows(text: string, styles: RuneStyle[]): RuneOption[] {
  return text
    .split("#")
    .map((row) => row.split("_"))
    .filter((row) => row.length >= 7)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .flatMap((row) => {
      const perks = ids(row[3]),
        trees = runeStyles(perks, styles);
      return trees
        ? [
            {
              perks,
              ...trees,
              label: `方案 ${row[0]}`,
              pickRate: rate(row[4], 100),
              winRate: rate(row[5], 100),
              games: Number(row[6]) || null,
            },
          ]
        : [];
    });
}
export function skillRows(text: string): SkillOption[] {
  return text.split("$").flatMap((group) => {
    const [head, ...sequences] = group.split("@");
    const fields = head.split(":");
    if (fields.length < 3) return [];
    const mostPlayed = sequences
      .map((row) => row.split("_"))
      .sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    return [
      {
        priority: ids(fields[0]).filter((n) => n <= 4),
        order: ids(mostPlayed?.[0]).filter((n) => n <= 4),
        pickRate: rate(fields[1], 100),
        winRate: rate(fields[2], 100),
        games: null,
      },
    ];
  });
}
const source = (
  mode: StatsQuery["mode"],
  patch: string | null,
  date: string | null,
  position?: Position,
): SourceInfo => ({
  id: "tencent",
  name: "腾讯 101 · 国服统计",
  url: "https://101.qq.com/",
  mode,
  patch,
  date,
  position,
  band: null,
  license: null,
});
function day(raw: unknown) {
  const text = String(raw ?? "");
  return /^\d{8}$/.test(text)
    ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`
    : null;
}
export class TencentProvider extends CachedProvider {
  constructor(
    storage: Storage,
    private catalog: CatalogProvider,
  ) {
    super(storage);
  }
  private async api(
    name: string,
    params: Record<string, string | number> = {},
  ) {
    return payload(
      await jsonRequest(
        `${root}/go/battle_info/odp_proxy/${name}?${new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]))}`,
      ),
    );
  }
  async versions(): Promise<string[]> {
    const { data } = await this.cached<string[]>(
      "tencent-versions",
      3600000,
      async () => {
        const body = await jsonRequest(
          `${root}/go/database/versionlist?zone=lol&from=h5`,
        );
        const list = (body.data ?? [])
          .map((entry: any) => String(entry.name))
          .filter((version: string) => /^\d+\.\d+$/.test(version));
        if (!list.length)
          throw new AppError("暂时没有可用的国服统计版本。", "NO_DATA");
        return list;
      },
    );
    return data;
  }
  async overview(query: StatsQuery): Promise<Overview> {
    const { data, stale } = await this.cached<Overview>(
      `tencent-overview-v2:${JSON.stringify(query)}`,
      30 * 60000,
      async () => {
        if (query.mode === "rift") {
          const versions = await this.versions();
          for (const version of versions.slice(0, 2)) {
            const body = await this.api("lol_101strategy", {
              itier: query.tier,
              version_id: version,
              lane: query.position,
              sort_metric: 1,
              sort_order: 2,
            });
            const heroes: HeroStat[] = String(body.datadetails ?? "")
              .split("#")
              .map((row) => row.split("_"))
              .filter((row) => row.length >= 8)
              .map((row) => ({
                championId: Number(row[1]),
                position: row[3] as Position,
                rank: Number(row[0]) || null,
                winRate: rate(row[4], 100),
                pickRate: rate(row[5], 100),
                games: null,
              }));
            if (heroes.length)
              return {
                source: source(
                  "rift",
                  version,
                  day(body.dtstatdate),
                  query.position,
                ),
                heroes,
                bands: [],
              };
          }
          throw new AppError("所选段位和位置暂无统计，请调整筛选。", "NO_DATA");
        }
        if (query.mode === "aram") {
          for (let days = 1; days <= 3; days++) {
            const yesterday = new Date(Date.now() - days * 86400000);
            const date = new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Shanghai",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            })
              .format(yesterday)
              .replaceAll("-", "");
            const body = await this.api("aram_hero_overview", {
              dtstatdate: date,
            });
            const heroes = String(body.listcollect ?? "")
              .split("#")
              .map((row) => row.split("_"))
              .filter((row) => row.length >= 5)
              .map((row) => ({
                championId: Number(row[0]),
                rank: Number(row[1]) || null,
                winRate: rate(row[3]),
                pickRate: rate(row[4]),
                games: null,
              }));
            if (heroes.length)
              return {
                source: source("aram", null, day(date)),
                heroes,
                bands: [],
              };
          }
          throw new AppError(
            "最近三天的普通大乱斗统计尚未更新，请稍后刷新。",
            "NO_DATA",
          );
        }
        const body = await this.api("fuwen_hero_rank", { championid: 1 });
        const heroes = String(body.championid_json ?? "")
          .split("#")
          .map((row) => row.split("|"))
          .filter((row) => row.length >= 4)
          .map((row) => ({
            championId: Number(row[0]),
            winRate: rate(row[1]),
            pickRate: rate(row[2]),
            rank: Number(row[3]) || null,
            games: null,
          }));
        return {
          source: source("hex", null, day(body.dtstatdate)),
          heroes,
          bands: [],
        };
      },
    );
    data.source.stale = stale;
    return data;
  }
  async recommendation(
    championId: number,
    query: StatsQuery,
  ): Promise<Recommendation> {
    const { data, stale } = await this.cached<Recommendation>(
      `tencent-rec-v3:${championId}:${JSON.stringify(query)}`,
      3600000,
      async () => {
        await this.catalog.get();
        if (query.mode === "aram")
          return {
            source: source("aram", null, null),
            championId,
            position: "ALL",
            starting: [],
            boots: [],
            core: [],
            later: [],
            runes: [],
            skills: [],
            unavailable: [
              "当前国服普通大乱斗来源未提供可验证的出装、常规符文和加点统计；未混用峡谷或海克斯数据。",
            ],
          };
        if (query.mode === "hex")
          return parseHex(
            championId,
            await this.api("fuwen_hero_rank", { championid: championId }),
          );
        const versions = await this.versions();
        let position: Position = query.position;
        for (const version of versions.slice(0, 2)) {
          if (position === "ALL") {
            const overview = await this.api("lol_101strategy", {
              itier: query.tier,
              version_id: version,
              lane: "ALL",
              sort_metric: 1,
              sort_order: 2,
            });
            const positions = String(overview.datadetails ?? "")
              .split("#")
              .map((row) => row.split("_"))
              .filter((row) => Number(row[1]) === championId)
              .sort((a, b) => Number(b[5]) - Number(a[5]));
            position = (positions[0]?.[3] as Position) || "MIDDLE";
          }
          const params = {
            itier: query.tier,
            version_id: version,
            lane: position,
            championid: championId,
          };
          const results = await Promise.allSettled(
            ["build", "runeinfo", "skill_point"].map((kind) =>
              this.api("lol_101strategy_" + kind, params),
            ),
          );
          const [build, runeinfo, skill] = results.map((result) =>
            result.status === "fulfilled" ? result.value : {},
          );
          const runes = runeRows(
            runeinfo.rune_top_details ?? "",
            this.catalog.styles,
          );
          const rec: Recommendation = {
            source: source(
              "rift",
              version,
              day(build.dtstatdate || runeinfo.dtstatdate || skill.dtstatdate),
              position,
            ),
            championId,
            position,
            starting: itemRows(build.starting_details),
            boots: itemRows(build.shoes_details),
            core: itemRows(build.core_details),
            later: [
              ...itemRows(build.forth_details),
              ...itemRows(build.fifth_details),
              ...itemRows(build.sixth_details),
            ].filter(
              (option, index, all) =>
                all.findIndex(
                  (other) => other.ids.join() === option.ids.join(),
                ) === index,
            ),
            runes,
            skills: skillRows(skill.detaildetails ?? ""),
            unavailable: [],
          };
          if (!rec.core.length && !rec.runes.length && !rec.skills.length)
            continue;
          if (!rec.runes.length)
            rec.unavailable.push("所选筛选暂无可验证的完整符文方案。");
          if (!rec.skills.length)
            rec.unavailable.push("所选筛选暂无加点统计。");
          return rec;
        }
        throw new AppError("该英雄在所选段位和位置暂无推荐数据。", "NO_DATA");
      },
    );
    data.source.stale = stale;
    return data;
  }
}
export function parseHex(
  championId: number,
  body: Record<string, string>,
): Recommendation {
  const rows = (key: string): ItemOption[] =>
    String(body[key] ?? "")
      .split("#")
      .map((row) => row.split("$"))
      .filter((row) => row.length >= 3 && ids(row[0]).length)
      .map((row) => ({
        ids: ids(row[0]),
        pickRate: rate(row[1]),
        winRate: rate(row[2]),
        games: null,
      }))
      .sort((a, b) => (b.pickRate ?? 0) - (a.pickRate ?? 0));
  const ranked = (key: string): any[] => {
    try {
      return Object.entries(JSON.parse(body[key] || "{}"))
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, value]) => value);
    } catch {
      return [];
    }
  };
  const item = (row: any, field: string): ItemOption => ({
    ids: ids(row[field]),
    winRate: rate(row.winrate, 10000),
    pickRate: rate(row.showrate, 10000),
    games: null,
  });
  const skills = ranked("skill_json")
    .map((row) => {
      const sequences = Object.values(row.sks ?? {}) as any[];
      const best = sequences.sort(
        (a, b) => Number(b.sk_s ?? 0) - Number(a.sk_s ?? 0),
      )[0];
      return {
        priority: ids(row.qwe).filter((id) => id <= 4),
        order: ids(best?.sk ?? "").filter((id) => id <= 4),
        winRate: rate(row.qwe_w, 10000),
        pickRate: rate(row.qwe_s, 10000),
        games: null,
      };
    })
    .filter((row) => row.priority.length);
  return {
    source: source("hex", null, day(body.dtstatdate)),
    championId,
    position: "ALL",
    starting: rows("itemout"),
    boots: rows("itemshoes"),
    core: ranked("itemcore_json")
      .map((row) => item(row, "itemcore"))
      .filter((row) => row.ids.length),
    later: ranked("itemone_json")
      .map((row) => item(row, "itemone"))
      .filter((row) => row.ids.length),
    runes: [],
    skills,
    unavailable: ["此来源未提供海克斯大乱斗的常规符文页统计。"],
  };
}
