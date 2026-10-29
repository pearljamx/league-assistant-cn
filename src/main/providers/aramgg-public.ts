import { AppError } from "../errors";
import { publicBytes } from "../http";
import type { Storage } from "../storage";
import type {
  AramggChampion,
  AramggStatus,
  PublicDataStatus,
} from "../../shared/types";
import {
  parseAugmentMap,
  parseManifest,
  parseSnapshotChampion,
  sha256,
  type AugmentMap,
  type SnapshotFile,
  type SnapshotManifest,
} from "./aramgg-snapshot";
import type { AramggProvider } from "./aramgg";

/**
 * 国内镜像的公开地址（腾讯云 COS / 阿里云 OSS），部署后填写，例如
 * "https://example-1250000000.cos.ap-guangzhou.myqcloud.com/pearljam-hex/aramgg"。
 */
export const CHINA_MIRROR: string | null = null;
export const GITHUB_DATA =
  "https://raw.githubusercontent.com/pearljamx/league-assistant-cn/aramgg-data";
export const publicSourceName = "PEARLJAM HEX 公共数据 · aramgg";
const manifestTtl = 30 * 60 * 1000;

/** 读取顺序：国内镜像 → GitHub。PEARLJAM_DATA_BASES 仅用于开发与测试。 */
export function publicDataBases(env = process.env): string[] {
  const override = env.PEARLJAM_DATA_BASES?.split(",")
    .map((item) => item.trim().replace(/\/+$/, ""))
    .filter((item) => item.startsWith("https://"));
  if (override?.length) return override;
  return [CHINA_MIRROR, GITHUB_DATA].filter((item): item is string =>
    Boolean(item),
  );
}

type ManifestState = {
  manifest: SnapshotManifest;
  base: string;
  at: number;
  stale: boolean;
};

export class PublicAramggProvider {
  private state: ManifestState | null = null;
  private loading: Promise<ManifestState> | null = null;
  private lastError: string | null = null;
  constructor(
    private storage: Storage,
    private bases = publicDataBases(),
  ) {}

  /** 启动时与每 30 分钟检查一次清单；版本相同的文件按 SHA-256 复用本地缓存。 */
  async manifest(force = false): Promise<ManifestState> {
    if (!force && this.state && Date.now() - this.state.at < manifestTtl)
      return this.state;
    this.loading ??= this.loadManifest().finally(() => (this.loading = null));
    return this.loading;
  }
  private async loadManifest(): Promise<ManifestState> {
    let failure: unknown = null;
    for (const base of this.bases)
      try {
        const { body } = await publicBytes(`${base}/manifest.json`, {
          timeout: 8000,
          maxBytes: 1024 * 1024,
        });
        const manifest = parseManifest(JSON.parse(body.toString("utf8")));
        // 镜像可能落后：不接受比已知清单更旧的版本。
        if (
          this.state &&
          manifest.generatedAt < this.state.manifest.generatedAt
        )
          continue;
        this.state = { manifest, base, at: Date.now(), stale: false };
        this.lastError = null;
        await this.storage.put("pjhex-v1:manifest", { manifest, base });
        return this.state;
      } catch (error) {
        failure = error;
      }
    if (this.state) {
      this.state = { ...this.state, at: Date.now(), stale: true };
      return this.state;
    }
    const cached = await this.storage.cache<{
      manifest: SnapshotManifest;
      base: string;
    }>("pjhex-v1:manifest");
    if (cached)
      try {
        this.state = {
          manifest: parseManifest(cached.data.manifest),
          base: cached.data.base,
          // 一分钟后再尝试联网。
          at: Date.now() - manifestTtl + 60_000,
          stale: true,
        };
        return this.state;
      } catch {
        /* 缓存损坏时按无缓存处理 */
      }
    this.lastError =
      failure instanceof AppError && failure.code === "NETWORK_ERROR"
        ? "公共数据暂时无法连接，请检查网络或系统代理。"
        : "公共数据暂不可用。";
    throw new AppError(this.lastError, "PUBLIC_DATA_UNAVAILABLE");
  }
  /** 下载并校验单个文件；本地缓存的 SHA-256 相同时不联网。 */
  private async file(
    cacheKey: string,
    entry: SnapshotFile,
    preferred: string,
  ): Promise<{ raw: unknown; fresh: boolean }> {
    const cached = await this.storage.cache<{ sha256: string; raw: unknown }>(
      cacheKey,
    );
    if (cached?.data.sha256 === entry.sha256)
      return { raw: cached.data.raw, fresh: true };
    const order = [
      preferred,
      ...this.bases.filter((base) => base !== preferred),
    ];
    for (const base of order)
      try {
        const { body } = await publicBytes(`${base}/${entry.file}`, {
          timeout: 15000,
          maxBytes: entry.bytes + 1024,
        });
        if (sha256(body) !== entry.sha256) continue;
        const raw = JSON.parse(body.toString("utf8"));
        await this.storage.put(cacheKey, { sha256: entry.sha256, raw });
        return { raw, fresh: true };
      } catch {
        /* 换下一个地址 */
      }
    // 全部地址失败或校验不通过：用上一份已校验的缓存，并标明过期。
    if (cached) return { raw: cached.data.raw, fresh: false };
    throw new AppError(
      "公共数据下载或校验失败，已保留原有缓存。",
      "CHECKSUM_FAILED",
    );
  }
  async champion(championId: number): Promise<AramggChampion> {
    const state = await this.manifest();
    const entry = state.manifest.champions[championId];
    if (!entry)
      throw new AppError(
        "公共数据尚未同步该英雄，稍后会自动补齐。",
        "PUBLIC_DATA_MISSING",
      );
    const { raw, fresh } = await this.file(
      `pjhex-v1:champion:${championId}`,
      entry,
      state.base,
    );
    const { dataVersion, gamePatch, fetchedAt, date, ...data } =
      parseSnapshotChampion(raw, championId);
    return {
      ...data,
      source: {
        name: publicSourceName,
        gamePatch,
        dataVersion,
        date,
        stale: state.stale || !fresh,
        latestVersion: state.manifest.dataVersion,
        fetchedAt,
        via: "public",
      },
    };
  }
  async augments(): Promise<AugmentMap> {
    const state = await this.manifest();
    if (!state.manifest.augments)
      throw new AppError("公共数据尚未包含强化目录。", "PUBLIC_DATA_MISSING");
    const { raw } = await this.file(
      "pjhex-v1:augments",
      state.manifest.augments,
      state.base,
    );
    return parseAugmentMap(raw);
  }
  status(): PublicDataStatus {
    const manifest = this.state?.manifest;
    const entries = Object.values(manifest?.champions ?? {});
    return {
      available: Boolean(manifest),
      dataVersion: manifest?.dataVersion ?? null,
      generatedAt: manifest?.generatedAt ?? null,
      current: entries.filter(
        (entry) => entry.dataVersion === manifest?.dataVersion,
      ).length,
      synced: entries.length,
      total: manifest?.championIds.length ?? 0,
      host: this.state ? new URL(this.state.base).host : null,
      stale: this.state?.stale ?? false,
      error: manifest ? null : this.lastError,
    };
  }
}

/** 先用公共数据；不可用或缺少该英雄时，若用户配置了个人 Key 再直连 aramgg。 */
export class AramggSources {
  constructor(
    private publicData: PublicAramggProvider,
    private keyed: AramggProvider,
  ) {}
  async champion(championId: number): Promise<AramggChampion> {
    try {
      return await this.publicData.champion(championId);
    } catch (error) {
      if (!(await this.keyed.hasKey())) throw error;
      const result = await this.keyed.champion(championId);
      return { ...result, source: { ...result.source, via: "key" } };
    }
  }
  async augments(): Promise<AugmentMap> {
    try {
      return await this.publicData.augments();
    } catch (error) {
      if (!(await this.keyed.hasKey())) throw error;
      return this.keyed.augments();
    }
  }
  async status(): Promise<AramggStatus> {
    await this.publicData.manifest().catch(() => {});
    return { ...(await this.keyed.status()), public: this.publicData.status() };
  }
  async setKey(key: string | null) {
    await this.keyed.setKey(key);
    return this.status();
  }
  /** 后台刷新清单并预取强化目录，失败静默。 */
  async refresh() {
    await this.publicData.manifest(true).catch(() => {});
    await this.publicData.augments().catch(() => {});
  }
}
