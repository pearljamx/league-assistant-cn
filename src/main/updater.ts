import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
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
      /** 连接（收到响应头）超时，默认 30 秒。 */
      connectTimeout?: number;
      /** 下载中多久收不到数据算中断，默认 60 秒；不限制总时长。 */
      idleTimeout?: number;
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
  /**
   * 连接阶段有超时；拿到响应后切换为“空闲超时”：只有持续一段时间收不到数据才中断，
   * 网速慢但在下载时不会被掐断。调用方读完正文后须调用 done()。
   */
  private async get(
    url: string,
    accept: string,
    headers: Record<string, string> = {},
  ) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (ms: number, error: AppError) => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(error), ms);
    };
    const done = () => clearTimeout(timer);
    const touch = () =>
      arm(
        this.options.idleTimeout ?? 60_000,
        new AppError("下载中断：长时间没有收到数据。", "UPDATE_STALLED"),
      );
    arm(
      this.options.connectTimeout ?? 30_000,
      new AppError("连接更新服务器超时，请检查网络或系统代理。", "UPDATE_TIMEOUT"),
    );
    let response: Response;
    try {
      response = await this.options.fetch(url, {
        headers: {
          Accept: accept,
          "User-Agent": `PearljamHex/${this.state.current}`,
          ...headers,
        },
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (error) {
      done();
      throw controller.signal.reason instanceof AppError
        ? controller.signal.reason
        : error;
    }
    try {
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
    } catch (error) {
      done();
      throw error;
    }
    touch();
    return { response, touch, done, signal: controller.signal };
  }
  /** 启动时删除旧版本留下的安装包；保留更新版本未下完的 .part 以便续传。 */
  async cleanup() {
    const folder = join(this.options.directory, "updates");
    let names: string[] = [];
    try {
      names = await readdir(folder);
    } catch {
      return;
    }
    for (const name of names) {
      const version = name.match(/^PearljamHex-(\d+\.\d+\.\d+)-x64-Setup\.exe\.part$/)?.[1];
      if (version && (compareVersions(version, this.state.current) ?? 0) > 0)
        continue;
      await rm(join(folder, name), { force: true, recursive: true }).catch(
        () => {},
      );
    }
  }
  async check() {
    if (this.busy) return this.state;
    if (this.state.status === "ready") return this.state;
    this.busy = true;
    this.set({ status: "checking", message: "正在检查更新" });
    try {
      const request = await this.get(
        RELEASES_API,
        "application/vnd.github+json",
      );
      const release = latestRelease(
        await request.response.json().finally(request.done),
      );
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
  /**
   * 下载安装包并按同一发布的 SHA256SUMS 校验；校验不符即删除。
   * 中断时保留 .part，再次下载用 Range 从断点续传（先重算已下载部分的摘要）。
   */
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
    this.set({ status: "downloading", progress: 0, message: "正在连接下载服务器" });
    const folder = join(this.options.directory, "updates");
    const target = join(folder, release.installer.name);
    const part = target + ".part";
    const mb = (bytes: number) => (bytes / 1048576).toFixed(0);
    let keepPart = true;
    try {
      const sums = await this.get(release.sums.url, "text/plain");
      const expected = expectedHash(
        await sums.response.text().finally(sums.done),
        release.installer.name,
      );
      if (!expected)
        throw new AppError("校验文件中没有该安装包。", "UPDATE_HASH");
      await mkdir(folder, { recursive: true });
      let hash = createHash("sha256");
      let offset = 0;
      const size = release.installer.size;
      const existing = await stat(part).catch(() => null);
      if (existing && existing.size > 0 && (!size || existing.size < size)) {
        for await (const chunk of createReadStream(part)) hash.update(chunk);
        offset = existing.size;
      } else if (existing) await rm(part, { force: true });
      const request = await this.get(
        release.installer.url,
        "application/octet-stream",
        offset ? { Range: `bytes=${offset}-` } : {},
      );
      const { response } = request;
      // 服务器不支持续传时从头下载。
      if (offset && response.status !== 206) {
        offset = 0;
        hash = createHash("sha256");
      }
      const total =
        size || offset + (Number(response.headers.get("content-length")) || 0);
      if (!response.body) throw new AppError("下载失败。", "UPDATE_DOWNLOAD");
      const out = createWriteStream(part, { flags: offset ? "a" : "w" });
      let received = offset,
        reported = offset;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          request.touch();
          received += value.length;
          if (received > MAX_INSTALLER) {
            keepPart = false;
            throw new AppError("安装包大小异常。", "UPDATE_SIZE");
          }
          hash.update(value);
          if (!out.write(value))
            await new Promise<void>((resolve) => out.once("drain", () => resolve()));
          if (total && received - reported > total / 200) {
            reported = received;
            this.set({
              progress: Math.min(0.99, received / total),
              message: `正在下载 ${mb(received)} / ${mb(total)} MB`,
            });
          }
        }
      } catch (error) {
        throw request.signal.reason instanceof AppError
          ? request.signal.reason
          : error;
      } finally {
        request.done();
        await new Promise<void>((resolve, reject) =>
          out.end((error?: Error | null) => (error ? reject(error) : resolve())),
        );
      }
      if (hash.digest("hex") !== expected) {
        keepPart = false;
        throw new AppError("安装包校验不一致，已删除，请重新下载。", "UPDATE_HASH");
      }
      await rename(part, target);
      this.file = target;
      this.set({
        status: "ready",
        progress: 1,
        message: `v${release.version} 已下载并校验，重启即可安装`,
      });
    } catch (error) {
      if (!keepPart) await rm(part, { force: true }).catch(() => {});
      const saved = keepPart ? await stat(part).catch(() => null) : null;
      const reason =
        error instanceof AppError ? error.message : "网络连接中断。";
      this.set({
        status: "available",
        progress: null,
        message:
          saved && saved.size > 0
            ? `${reason}已保留 ${mb(saved.size)} MB，点「下载更新」从断点继续。`
            : error instanceof AppError
              ? reason
              : "下载更新失败，请检查网络或系统代理后重试。",
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
