import { createHash } from "node:crypto";
import { AppError } from "../errors";
import { normalizeAugment, normalizeChampion } from "./aramgg";
import type {
  AramggBuild,
  AramggChampion,
  AramggOption,
} from "../../shared/types";

// PEARLJAM HEX 公共数据包：由仓库定时任务用维护者的 aramgg Key 同步，客户端无需 Key。
// 文件布局：manifest.json、augments.json、champions/{id}.json；manifest 最后写入。
export const SNAPSHOT_SCHEMA = 1;
export const aramggApi = "https://data.dtodo.cn/api/v1/zh-CN";

export type SnapshotChampion = Omit<AramggChampion, "source"> & {
  date: string | null;
  dataVersion: string;
  gamePatch: string | null;
  fetchedAt: string;
};
export type AugmentMap = Record<
  number,
  { name: string; rarity: string; iconUrl: string | null }
>;
export interface SnapshotFile {
  file: string;
  sha256: string;
  bytes: number;
  dataVersion: string;
  fetchedAt: string;
}
export interface SnapshotManifest {
  schema: typeof SNAPSHOT_SCHEMA;
  source: string;
  generatedAt: string;
  dataVersion: string;
  gamePatch: string | null;
  /** aramgg 英雄列表中的全部英雄；未必都已同步。 */
  championIds: number[];
  champions: Record<string, SnapshotFile>;
  augments: SnapshotFile | null;
}

export const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const iso = (value: unknown) =>
  typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
const version = (value: unknown) =>
  typeof value === "string" && /^[\w.-]{1,32}$/.test(value) ? value : null;

function snapshotFile(raw: any, file: string): SnapshotFile | null {
  if (
    !raw ||
    raw.file !== file ||
    typeof raw.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(raw.sha256) ||
    !Number.isInteger(raw.bytes) ||
    raw.bytes <= 0 ||
    raw.bytes > 4 * 1024 * 1024 ||
    !version(raw.dataVersion) ||
    !iso(raw.fetchedAt)
  )
    return null;
  return {
    file,
    sha256: raw.sha256,
    bytes: raw.bytes,
    dataVersion: raw.dataVersion,
    fetchedAt: raw.fetchedAt,
  };
}
/** 校验清单：文件名只能是固定格式，任何异常项都丢弃，不信任远端路径。 */
export function parseManifest(raw: any): SnapshotManifest {
  const dataVersion = version(raw?.dataVersion);
  const generatedAt = iso(raw?.generatedAt);
  if (raw?.schema !== SNAPSHOT_SCHEMA || !dataVersion || !generatedAt)
    throw new AppError("公共数据清单无效。", "DATA_MANIFEST");
  const champions: Record<string, SnapshotFile> = {};
  for (const [key, value] of Object.entries(raw.champions ?? {})) {
    const id = Number(key);
    if (!Number.isInteger(id) || id <= 0 || id > 99999) continue;
    const entry = snapshotFile(value, `champions/${id}.json`);
    if (entry) champions[id] = entry;
  }
  return {
    schema: SNAPSHOT_SCHEMA,
    source: typeof raw.source === "string" ? raw.source.slice(0, 64) : "",
    generatedAt,
    dataVersion,
    gamePatch: version(raw.gamePatch),
    championIds: Array.isArray(raw.championIds)
      ? raw.championIds
          .filter((id: unknown) => Number.isInteger(id) && (id as number) > 0)
          .slice(0, 400)
      : [],
    champions,
    augments: snapshotFile(raw.augments, "augments.json"),
  };
}
const arr = (value: unknown, limit: number): any[] =>
  Array.isArray(value) ? value.slice(0, limit) : [];
const rate = (value: unknown) =>
  typeof value === "number" && value >= 0 && value <= 1 ? value : null;
const whole = (value: unknown) =>
  Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null;
const label = (value: unknown, max = 64) =>
  typeof value === "string" ? value.slice(0, max) : "";
/** 已规整的组合/出装选项，再做一次形状校验，避免远端数据破坏界面。 */
function cleanOption(raw: any): AramggOption {
  return {
    ids: arr(raw?.ids, 8).filter((id) => Number.isInteger(id) && id > 0),
    names: arr(raw?.names, 8)
      .map((name) => label(name))
      .filter(Boolean),
    games: whole(raw?.games),
    winRate: rate(raw?.winRate),
    pickRate: rate(raw?.pickRate),
  };
}
function cleanBuild(raw: any): AramggBuild {
  return {
    tags: label(raw?.tags, 48),
    games: whole(raw?.games),
    winRate: rate(raw?.winRate),
    pickRate: rate(raw?.pickRate),
    core: arr(raw?.core, 3).map(cleanOption),
    starting: arr(raw?.starting, 3).map(cleanOption),
    situational: arr(raw?.situational, 12).map(cleanOption),
    spells: arr(raw?.spells, 3).map(cleanOption),
    skills: arr(raw?.skills, 3).map((item) => ({
      keys: arr(item?.keys, 18).filter((key) =>
        ["Q", "W", "E", "R"].includes(key),
      ),
      games: whole(item?.games),
      winRate: rate(item?.winRate),
    })),
  };
}
/** 公共数据中的单英雄文件，复用 aramgg 的字段校验。 */
export function parseSnapshotChampion(
  raw: any,
  championId: number,
): SnapshotChampion {
  const dataVersion = version(raw?.dataVersion);
  const fetchedAt = iso(raw?.fetchedAt);
  if (!dataVersion || !fetchedAt || raw?.championId !== championId)
    throw new AppError("公共数据英雄文件不完整。", "INVALID_RESPONSE");
  const normalized = normalizeChampion(
    {
      data: {
        champion: {
          id: championId,
          stats: {
            tier: raw.tier,
            winRate: raw.winRate,
            pickRate: raw.pickRate,
            date: raw.date,
          },
        },
        augments: (Array.isArray(raw.augments) ? raw.augments : []).map(
          (row: any) => ({ ...row, rarityName: row?.rarity, stats: row }),
        ),
      },
    },
    championId,
  );
  return {
    ...normalized,
    trios: arr(raw.trios, 5).map(cleanOption),
    builds: arr(raw.builds, 4).map(cleanBuild),
    dataVersion,
    gamePatch: version(raw.gamePatch),
    fetchedAt,
  };
}
export function parseAugmentMap(raw: any): AugmentMap {
  const map: AugmentMap = {};
  if (!raw || typeof raw !== "object") return map;
  for (const [key, value] of Object.entries(raw).slice(0, 800)) {
    const row = normalizeAugment({
      id: Number(key),
      ...(value as object),
      rarityName: (value as any)?.rarity,
    });
    if (row)
      map[row.id] = {
        name: row.name,
        rarity: row.rarity,
        iconUrl: row.iconUrl,
      };
  }
  return map;
}

/**
 * 同步顺序：未同步的英雄优先，其次是旧数据版本、抓取时间最早的英雄。
 * 已是当前版本的英雄不再消耗额度。
 */
export function planChampions(
  championIds: number[],
  previous: SnapshotManifest | null,
  dataVersion: string,
) {
  const entries = previous?.champions ?? {};
  return championIds
    .filter((id) => entries[id]?.dataVersion !== dataVersion)
    .sort((a, b) => {
      const left = entries[a],
        right = entries[b];
      if (!left !== !right) return left ? 1 : -1;
      return (left?.fetchedAt ?? "").localeCompare(right?.fetchedAt ?? "");
    });
}

export interface SyncDeps {
  key: string;
  fetch: typeof fetch;
  read(file: string): Promise<Uint8Array | null>;
  write(file: string, bytes: Uint8Array): Promise<void>;
  remove?(file: string): Promise<void>;
  log(message: string): void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** 无法从响应头得知剩余额度时假定的每日额度。 */
  dailyBudget?: number;
  /** 保留给手动排查的额度。 */
  reserve?: number;
  /** 两次付费请求的最小间隔，默认 1.1 秒（每分钟不超过 60 次）。 */
  intervalMs?: number;
}
export interface SyncResult {
  changed: boolean;
  dataVersion: string;
  synced: number[];
  pending: number;
  creditsRemaining: number | null;
  stopped: "complete" | "budget" | "quota" | "error";
}

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));

export async function runSync(deps: SyncDeps): Promise<SyncResult> {
  const now = deps.now ?? (() => new Date());
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const reserve = deps.reserve ?? 6;
  const interval = deps.intervalMs ?? 1100;
  let remaining: number | null = null;
  let lastPaid = 0;

  const configResponse = await deps.fetch(`${aramggApi}/config.json`, {
    headers: { Accept: "application/json" },
  });
  if (!configResponse.ok)
    throw new Error(`config.json HTTP ${configResponse.status}`);
  const config: any = await configResponse.json();
  const parsedVersion = version(config?.dataVersion);
  if (!parsedVersion) throw new Error("config.json 缺少 dataVersion");
  const dataVersion: string = parsedVersion;
  const gamePatch = version(config?.gamePatch);

  let previous: SnapshotManifest | null = null;
  const previousBytes = await deps.read("manifest.json");
  if (previousBytes)
    try {
      previous = parseManifest(
        JSON.parse(new TextDecoder().decode(previousBytes)),
      );
    } catch {
      deps.log("旧清单无效，重新开始同步");
    }

  const budgetLeft = (cost: number) =>
    (remaining ?? deps.dailyBudget ?? 200) - cost >= reserve;
  class Quota extends Error {}
  async function paid(path: string, cost: number) {
    if (!budgetLeft(cost)) return null;
    const wait = lastPaid + interval - Date.now();
    if (wait > 0) await sleep(wait);
    lastPaid = Date.now();
    const response = await deps.fetch(aramggApi + path, {
      headers: { Accept: "application/json", "x-api-key": deps.key },
    });
    const left = Number(response.headers.get("x-credits-remaining"));
    if (response.headers.has("x-credits-remaining") && Number.isFinite(left))
      remaining = left;
    else if (remaining !== null) remaining -= cost;
    else remaining = (deps.dailyBudget ?? 200) - cost;
    if (response.status === 429) throw new Quota();
    if (response.status === 401) throw new Error("aramgg API Key 无效 (401)");
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
    return response.json() as Promise<any>;
  }

  const manifest: SnapshotManifest = {
    schema: SNAPSHOT_SCHEMA,
    source: "aramgg.com 数据 API",
    generatedAt: previous?.generatedAt ?? now().toISOString(),
    dataVersion,
    gamePatch,
    championIds: previous?.championIds ?? [],
    champions: { ...(previous?.champions ?? {}) },
    augments: previous?.augments ?? null,
  };
  const synced: number[] = [];
  let changed = false,
    stopped: SyncResult["stopped"] = "complete";
  async function store(file: string, value: unknown) {
    const bytes = encode(value);
    await deps.write(file, bytes);
    changed = true;
    return {
      file,
      sha256: sha256(bytes),
      bytes: bytes.length,
      dataVersion,
      fetchedAt: now().toISOString(),
    };
  }

  try {
    const listStale =
      !previous ||
      previous.dataVersion !== dataVersion ||
      !manifest.championIds.length;
    if (listStale) {
      const json = await paid("/champions.json", 1);
      if (json) {
        const rows = Array.isArray(json?.data)
          ? json.data
          : Array.isArray(json?.data?.champions)
            ? json.data.champions
            : [];
        const ids = [
          ...new Set<number>(
            rows
              .map((row: any) => Number(row?.id ?? row?.championId))
              .filter((id: number) => Number.isInteger(id) && id > 0),
          ),
        ].sort((a, b) => a - b);
        if (ids.length) {
          manifest.championIds = ids;
          changed = true;
        }
      }
    }
    if (manifest.augments?.dataVersion !== dataVersion) {
      const json = await paid("/augments.json", 1);
      if (json) {
        const map: AugmentMap = {};
        for (const raw of Array.isArray(json?.data) ? json.data : []) {
          const row = normalizeAugment(raw);
          if (row)
            map[row.id] = {
              name: row.name,
              rarity: row.rarity,
              iconUrl: row.iconUrl,
            };
        }
        if (Object.keys(map).length)
          manifest.augments = await store("augments.json", map);
      }
    }
    for (const id of planChampions(
      manifest.championIds,
      manifest,
      dataVersion,
    )) {
      const json = await paid(`/champions/${id}.json`, 2);
      if (!json) {
        stopped = "budget";
        break;
      }
      let normalized;
      try {
        normalized = normalizeChampion(json, id);
      } catch {
        deps.log(`英雄 ${id} 数据不完整，跳过`);
        continue;
      }
      const value: SnapshotChampion = {
        ...normalized,
        dataVersion,
        gamePatch,
        fetchedAt: now().toISOString(),
      };
      manifest.champions[id] = await store(`champions/${id}.json`, value);
      synced.push(id);
    }
  } catch (error) {
    if (error instanceof Quota) stopped = "quota";
    else {
      stopped = "error";
      deps.log(`同步中断：${(error as Error).message}`);
    }
  }
  // 已不在英雄列表中的旧文件不再列出。
  if (manifest.championIds.length)
    for (const key of Object.keys(manifest.champions))
      if (!manifest.championIds.includes(Number(key))) {
        delete manifest.champions[key];
        await deps.remove?.(`champions/${key}.json`);
        changed = true;
      }
  if (previous?.dataVersion !== dataVersion) changed = true;
  if (changed) {
    manifest.generatedAt = now().toISOString();
    await deps.write("manifest.json", encode(manifest));
  }
  const pending = planChampions(
    manifest.championIds,
    manifest,
    dataVersion,
  ).length;
  if (stopped === "complete" && pending) stopped = "budget";
  return {
    changed,
    dataVersion,
    synced,
    pending,
    creditsRemaining: remaining,
    stopped,
  };
}
