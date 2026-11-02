import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { UpdateState } from "../shared/types";
import { AppError } from "./errors";

export const RELEASES_API =
  "https://api.github.com/repos/pearljamx/league-assistant-cn/releases?per_page=10";
/** 发布信息与附件只接受这些主机（GitHub 附件会跳转到对象存储）。 */
const ALLOWED_HOSTS = new Set([
  "api.github.com",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const MAX_INSTALLER = 600 * 1024 * 1024;

/** 比较 x.y.z（忽略前缀 v 与预发布后缀）；无法解析返回 null。 */
export function compareVersions(a: string, b: string): number | null {
  const parse = (value: string) => {
    const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
  };
  const left = parse(a),
    right = parse(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}
export interface ReleaseInfo {
  version: string;
  publishedAt: string | null;
  notes: string | null;
  pageUrl: string;
  installer: ReleaseAsset | null;
  sums: ReleaseAsset | null;
}
const https = (value: unknown) => {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
};
/** 从 GitHub 发布列表中选出版本号最高的非草稿发布（预发布也算）。 */
export function latestRelease(raw: unknown): ReleaseInfo | null {
  if (!Array.isArray(raw)) return null;
  let best: ReleaseInfo | null = null;
  for (const item of raw) {
    if (!item || typeof item !== "object" || item.draft) continue;
    const version = String(item.tag_name ?? "").replace(/^v/, "");
    const pageUrl = https(item.html_url);
    if (compareVersions(version, "0.0.0") === null || !pageUrl) continue;
    if (best && (compareVersions(version, best.version) ?? 0) <= 0) continue;
    const assets: ReleaseAsset[] = (Array.isArray(item.assets) ? item.assets : [])
      .map((asset: any) => ({
        name: String(asset?.name ?? ""),
        url: https(asset?.browser_download_url) ?? "",
        size: Number(asset?.size) || 0,
      }))
      .filter((asset: ReleaseAsset) => asset.url);
    best = {
      version,
      publishedAt:
        typeof item.published_at === "string" ? item.published_at : null,
      notes:
        typeof item.body === "string" ? item.body.slice(0, 4000) : null,
      pageUrl,
      installer:
        assets.find(
          (asset) => asset.name === `PearljamHex-${version}-x64-Setup.exe`,
        ) ?? null,
      sums: assets.find((asset) => asset.name === "SHA256SUMS") ?? null,
    };
  }
  return best;
}
/** 在 SHA256SUMS 中找到指定文件的摘要。 */
export function expectedHash(sums: string, name: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match && match[2].trim() === name) return match[1].toLowerCase();
  }
  return null;
}

export class Updater {
  state: UpdateState;
  private release: ReleaseInfo | null = null;
  private file: string | null = null;
  private busy = false;
  constructor(
    current: string,
    private options: {
      fetch: typeof fetch;
      directory: string;
      /** 安装版才能自动安装；便携版、开发版只提示手动下载。 */
      installable: boolean;
      emit: (state: UpdateState) => void;
      launch: (file: string) => void;
    },
  ) {
    this.state = {
      status: "idle",
      current,
      latest: null,
      publishedAt: null,
      notes: null,
      pageUrl: null,
      progress: null,
      installable: options.installable,
      message: options.installable
        ? "尚未检查更新"
        : "便携版或开发版请到发布页手动下载新版",
      checkedAt: null,
    };
  }
  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.options.emit(structuredClone(this.state));
  }
  private async get(url: string, accept: string) {
    const response = await this.options.fetch(url, {
      headers: {
        Accept: accept,
        "User-Agent": `PearljamHex/${this.state.current}`,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!https(response.url || url))
      throw new AppError("更新地址被重定向到未知主机。", "UPDATE_HOST");
    if (!response.ok)
      throw new AppError(
        response.status === 403
          ? "GitHub 查询过于频繁，请稍后再试。"
          : `更新服务返回 ${response.status}。`,
        `HTTP_${response.status}`,
        response.status,
      );
    return response;
  }
  async check() {
    if (this.busy) return this.state;
    if (this.state.status === "ready") return this.state;
    this.busy = true;
    this.set({ status: "checking", message: "正在检查更新" });
    try {
      const response = await this.get(
        RELEASES_API,
        "application/vnd.github+json",
      );
      const release = latestRelease(await response.json());
      const checkedAt = new Date().toISOString();
      if (!release) {
        this.set({ status: "none", message: "没有找到可用的发布", checkedAt });
        return this.state;
      }
      this.release = release;
      const newer = (compareVersions(release.version, this.state.current) ?? 0) > 0;
      this.set({
        status: newer ? "available" : "none",
        latest: release.version,
        publishedAt: release.publishedAt,
        notes: release.notes,
        pageUrl: release.pageUrl,
        progress: null,
        checkedAt,
        message: newer
          ? `发现新版本 v${release.version}`
          : `已是最新版本 v${this.state.current}`,
      });
    } catch (error) {
      this.set({
        status: "error",
        message:
          error instanceof AppError
            ? error.message
            : "检查更新失败，请检查网络或系统代理。",
      });
    } finally {
      this.busy = false;
    }
    return this.state;
  }
  /** 下载安装包并按同一发布的 SHA256SUMS 校验；校验不符即删除。 */
  async download() {
    if (!this.options.installable)
      throw new AppError("便携版请到发布页手动下载新版。", "UPDATE_PORTABLE");
    if (this.busy || this.state.status !== "available" || !this.release)
      return this.state;
    const release = this.release;
    if (!release.installer || !release.sums)
      throw new AppError("该发布缺少安装包或校验文件，请到发布页下载。", "UPDATE_ASSET");
    if (release.installer.size > MAX_INSTALLER)
      throw new AppError("安装包大小异常，已拒绝下载。", "UPDATE_SIZE");
    this.busy = true;
    this.set({ status: "downloading", progress: 0, message: "正在下载更新" });
    const folder = join(this.options.directory, "updates");
    const target = join(folder, release.installer.name);
    const part = target + ".part";
    try {
      const sums = await (await this.get(release.sums.url, "text/plain")).text();
      const expected = expectedHash(sums, release.installer.name);
      if (!expected)
        throw new AppError("校验文件中没有该安装包。", "UPDATE_HASH");
      await mkdir(folder, { recursive: true });
      const response = await this.get(
        release.installer.url,
        "application/octet-stream",
      );
      const total =
        Number(response.headers.get("content-length")) ||
        release.installer.size;
      if (!response.body) throw new AppError("下载失败。", "UPDATE_DOWNLOAD");
      const hash = createHash("sha256");
      const out = createWriteStream(part);
      let received = 0,
        reported = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.length;
          if (received > MAX_INSTALLER)
            throw new AppError("安装包大小异常。", "UPDATE_SIZE");
          hash.update(value);
          if (!out.write(value))
            await new Promise<void>((resolve) => out.once("drain", () => resolve()));
          if (total && received - reported > total / 100) {
            reported = received;
            this.set({ progress: Math.min(0.99, received / total) });
          }
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          out.end((error?: Error | null) => (error ? reject(error) : resolve())),
        );
      }
      if (hash.digest("hex") !== expected)
        throw new AppError("安装包校验不一致，已删除。", "UPDATE_HASH");
      await rename(part, target);
      this.file = target;
      this.set({
        status: "ready",
        progress: 1,
        message: `v${release.version} 已下载并校验，重启即可安装`,
      });
    } catch (error) {
      await rm(part, { force: true }).catch(() => {});
      this.set({
        status: "available",
        progress: null,
        message:
          error instanceof AppError
            ? error.message
            : "下载更新失败，请检查网络后重试。",
      });
    } finally {
      this.busy = false;
    }
    return this.state;
  }
  install() {
    if (this.state.status !== "ready" || !this.file)
      throw new AppError("更新尚未下载完成。", "UPDATE_NOT_READY");
    this.options.launch(this.file);
    return this.state;
  }
}
