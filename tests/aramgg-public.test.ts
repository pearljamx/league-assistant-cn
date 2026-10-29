import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../src/main/storage";
import { setPublicFetcher } from "../src/main/http";
import {
  parseManifest,
  planChampions,
  runSync,
  sha256,
} from "../src/main/providers/aramgg-snapshot";
import {
  AramggSources,
  PublicAramggProvider,
  publicDataBases,
} from "../src/main/providers/aramgg-public";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "league-assistant-pjhex-"));
});
afterEach(async () => {
  setPublicFetcher(null as unknown as typeof fetch);
  if (!dir.startsWith(join(tmpdir(), "league-assistant-pjhex-")))
    throw new Error("Temporary cleanup path rejected");
  await rm(dir, { force: true, recursive: true });
});

const api = "https://data.dtodo.cn/api/v1/zh-CN";
const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers });
const detail = (id: number) => ({
  data: {
    champion: { id, stats: { tier: 2, winRate: 0.5, pickRate: 0.1 } },
    augments: [
      {
        id: 7,
        name: "测试强化",
        rarityName: "gold",
        iconUrl: "https://cdn.dtodo.cn/a.png",
        stats: { tier: 1, rank: 1, total: 1, winRate: 0.6, games: 300 },
      },
    ],
    augmentTrios: [],
    builds: [],
  },
});

/** 模拟 aramgg：按额度扣费并在响应头返回剩余额度。 */
function aramgg(options: { version: () => string; credits: { left: number } }) {
  const paid: string[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const path = String(url).replace(api, "");
    if (path === "/config.json")
      return json({ dataVersion: options.version(), gamePatch: "16.21" });
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe(
      "test-key",
    );
    const cost = path.startsWith("/champions/") ? 2 : 1;
    if (options.credits.left < cost) return new Response("{}", { status: 429 });
    options.credits.left -= cost;
    paid.push(path);
    const headers = { "x-credits-remaining": String(options.credits.left) };
    if (path === "/champions.json")
      return json({ data: [{ id: 1 }, { id: 2 }, { id: 3 }] }, headers);
    if (path === "/augments.json")
      return json({ data: [detail(1).data.augments[0]] }, headers);
    const id = Number(path.match(/\/champions\/(\d+)\.json/)![1]);
    return json(detail(id), headers);
  }) as typeof fetch;
  return { fetcher, paid };
}
function memoryFiles() {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    read: async (file: string) => files.get(file) ?? null,
    write: async (file: string, bytes: Uint8Array) =>
      void files.set(file, bytes),
    remove: async (file: string) => void files.delete(file),
  };
}

it("未同步的英雄优先，其次是旧版本中最早抓取的英雄", () => {
  const entry = (dataVersion: string, fetchedAt: string) => ({
    file: "",
    sha256: "",
    bytes: 1,
    dataVersion,
    fetchedAt,
  });
  const previous = {
    champions: {
      1: entry("v1", "2026-10-28T03:00:00Z"),
      2: entry("v2", "2026-10-28T01:00:00Z"),
      3: entry("v1", "2026-10-27T01:00:00Z"),
    },
  } as any;
  expect(planChampions([1, 2, 3, 4], previous, "v2")).toEqual([4, 3, 1]);
});

it("额度不足时轮转同步，次日补齐；版本未变且已全量时不再消耗额度", async () => {
  const storage = memoryFiles();
  const credits = { left: 6 };
  const remote = aramgg({ version: () => "16.21.3", credits });
  const deps = {
    key: "test-key",
    fetch: remote.fetcher,
    ...storage,
    log: () => {},
    reserve: 0,
    intervalMs: 0,
  };
  const first = await runSync(deps);
  // 6 额度：英雄列表 1 + 强化 1 + 两个英雄各 2。
  expect(first).toMatchObject({
    synced: [1, 2],
    pending: 1,
    stopped: "budget",
  });
  const manifest = parseManifest(
    JSON.parse(new TextDecoder().decode(storage.files.get("manifest.json")!)),
  );
  expect(Object.keys(manifest.champions)).toEqual(["1", "2"]);
  expect(manifest.champions[1].sha256).toBe(
    sha256(storage.files.get("champions/1.json")!),
  );

  credits.left = 200;
  const second = await runSync(deps);
  expect(second).toMatchObject({
    synced: [3],
    pending: 0,
    stopped: "complete",
  });

  remote.paid.length = 0;
  const third = await runSync(deps);
  expect(third).toMatchObject({ changed: false, synced: [] });
  expect(remote.paid).toEqual([]);
});

it("新数据版本发布后重新拉取列表和全部英雄，429 时保留已同步的部分", async () => {
  const storage = memoryFiles();
  let version = "16.21.3";
  const credits = { left: 200 };
  const remote = aramgg({ version: () => version, credits });
  const deps = {
    key: "test-key",
    fetch: remote.fetcher,
    ...storage,
    log: () => {},
    reserve: 0,
    intervalMs: 0,
  };
  await runSync(deps);
  version = "16.21.4";
  credits.left = 4;
  remote.paid.length = 0;
  const result = await runSync({ ...deps, dailyBudget: 999 });
  expect(remote.paid).toEqual([
    "/champions.json",
    "/augments.json",
    "/champions/1.json",
  ]);
  expect(result).toMatchObject({ stopped: "budget", synced: [1], pending: 2 });
  const manifest = parseManifest(
    JSON.parse(new TextDecoder().decode(storage.files.get("manifest.json")!)),
  );
  expect(manifest.dataVersion).toBe("16.21.4");
  expect(manifest.champions[1].dataVersion).toBe("16.21.4");
  expect(manifest.champions[2].dataVersion).toBe("16.21.3");
  // 响应头未知时按预设额度尝试，遇到 429 立即停止并保留旧文件。
  credits.left = 0;
  const quota = await runSync({ ...deps, dailyBudget: 999 });
  expect(quota).toMatchObject({ stopped: "quota", synced: [], pending: 2 });
  expect(storage.files.has("champions/2.json")).toBe(true);
});

it("多个 Key 按顺序使用：第一个额度用完或失效后换下一个，Key 不写进日志", async () => {
  const storage = memoryFiles();
  const credits: Record<string, number> = { "key-a": 5, "key-b": 200 };
  const used: string[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const path = String(url).replace(api, "");
    if (path === "/config.json") return json({ dataVersion: "16.21.3" });
    const key = (init?.headers as Record<string, string>)["x-api-key"];
    if (!(key in credits)) return new Response("{}", { status: 401 });
    const cost = path.startsWith("/champions/") ? 2 : 1;
    if (credits[key] < cost) return new Response("{}", { status: 429 });
    credits[key] -= cost;
    used.push(key + path);
    const headers = { "x-credits-remaining": String(credits[key]) };
    if (path === "/champions.json")
      return json({ data: [{ id: 1 }, { id: 2 }, { id: 3 }] }, headers);
    if (path === "/augments.json")
      return json({ data: [detail(1).data.augments[0]] }, headers);
    return json(detail(Number(path.match(/(\d+)\.json/)![1])), headers);
  }) as typeof fetch;
  const logs: string[] = [];
  const result = await runSync({
    keys: ["key-bad", "key-a", "key-b", "key-a"],
    fetch: fetcher,
    ...storage,
    log: (message) => logs.push(message),
    reserve: 0,
    intervalMs: 0,
  });
  expect(result).toMatchObject({ stopped: "complete", keys: 3, pending: 0 });
  expect(result.synced).toEqual([1, 2, 3]);
  // key-a 剩 5：列表 1 + 强化 1 + 英雄 2 后只剩 1，不够下一个英雄，自动换 key-b。
  expect(used).toEqual([
    "key-a/champions.json",
    "key-a/augments.json",
    "key-a/champions/1.json",
    "key-b/champions/2.json",
    "key-b/champions/3.json",
  ]);
  expect(result.creditsRemaining).toBe(1 + 196);
  expect(logs.join(" ")).toContain("第 1 个 Key 无效");
  expect(logs.join(" ")).not.toContain("key-");
});

it("所有 Key 都 429 时停止并标明额度用完", async () => {
  const storage = memoryFiles();
  const fetcher = (async (url: string) =>
    String(url).endsWith("/config.json")
      ? json({ dataVersion: "16.21.3" })
      : new Response("{}", { status: 429 })) as typeof fetch;
  const result = await runSync({
    keys: ["k1", "k2"],
    fetch: fetcher,
    ...storage,
    log: () => {},
    intervalMs: 0,
  });
  expect(result).toMatchObject({ stopped: "quota", synced: [] });
});

it("清单只接受固定文件名与合法摘要", () => {
  const good = {
    schema: 1,
    generatedAt: "2026-10-29T00:00:00Z",
    dataVersion: "16.21.3",
    championIds: [1],
    champions: {
      1: {
        file: "champions/1.json",
        sha256: "a".repeat(64),
        bytes: 10,
        dataVersion: "16.21.3",
        fetchedAt: "2026-10-29T00:00:00Z",
      },
      2: {
        file: "../../secret.json",
        sha256: "a".repeat(64),
        bytes: 10,
        dataVersion: "16.21.3",
        fetchedAt: "2026-10-29T00:00:00Z",
      },
    },
    augments: null,
  };
  expect(Object.keys(parseManifest(good).champions)).toEqual(["1"]);
  expect(() => parseManifest({ ...good, schema: 2 })).toThrow();
  expect(
    publicDataBases({ PEARLJAM_DATA_BASES: "http://x, https://a/b/" }),
  ).toEqual(["https://a/b"]);
});

/** 用 runSync 生成真实格式的数据包，再挂到模拟的镜像与 GitHub 上。 */
async function snapshot(latest = "16.21.3") {
  const storage = memoryFiles();
  const remote = aramgg({ version: () => latest, credits: { left: 200 } });
  await runSync({
    key: "test-key",
    fetch: remote.fetcher,
    ...storage,
    log: () => {},
    reserve: 0,
    intervalMs: 0,
  });
  return storage.files;
}

it("先读国内镜像，镜像失败或校验不符时换 GitHub，并按摘要复用缓存", async () => {
  const files = await snapshot();
  const requests: string[] = [];
  let mirrorTampered = false,
    mirrorDown = false;
  setPublicFetcher((async (url: string) => {
    requests.push(url);
    const [base, file] = String(url).split("/data/");
    if (base === "https://mirror.test" && mirrorDown)
      throw new Error("offline");
    let bytes = files.get(file);
    if (!bytes) return new Response("", { status: 404 });
    if (
      base === "https://mirror.test" &&
      mirrorTampered &&
      file !== "manifest.json"
    )
      bytes = new TextEncoder().encode("{}");
    return new Response(Buffer.from(bytes), { status: 200 });
  }) as any);
  const storage = new Storage(dir);
  await storage.initialize();
  const provider = new PublicAramggProvider(storage, [
    "https://mirror.test/data",
    "https://github.test/data",
  ]);
  mirrorTampered = true;
  const hero = await provider.champion(1);
  expect(hero.source).toMatchObject({
    via: "public",
    dataVersion: "16.21.3",
    latestVersion: "16.21.3",
    stale: false,
  });
  expect(hero.augments[0]).toMatchObject({ id: 7, rank: 1, winRate: 0.6 });
  expect(requests).toContain("https://github.test/data/champions/1.json");
  expect(provider.status()).toMatchObject({
    available: true,
    current: 3,
    total: 3,
    host: "mirror.test",
  });

  requests.length = 0;
  await provider.champion(1);
  expect(requests).toEqual([]);

  mirrorDown = true;
  const fresh = new PublicAramggProvider(storage, [
    "https://mirror.test/data",
    "https://github.test/data",
  ]);
  expect((await fresh.augments())[7].name).toBe("测试强化");
  expect(fresh.status().host).toBe("github.test");
});

it("全部地址不可用时用上次清单并标明过期；缺少英雄时改用个人 Key", async () => {
  const files = await snapshot();
  let online = true;
  setPublicFetcher((async (url: string) => {
    if (!online) throw new Error("offline");
    const file = String(url).split("/data/")[1];
    const bytes = files.get(file);
    return bytes
      ? new Response(Buffer.from(bytes), { status: 200 })
      : new Response("", { status: 404 });
  }) as any);
  const storage = new Storage(dir);
  await storage.initialize();
  await new PublicAramggProvider(storage, [
    "https://github.test/data",
  ]).champion(2);
  online = false;
  const offline = new PublicAramggProvider(storage, [
    "https://github.test/data",
  ]);
  expect((await offline.champion(2)).source.stale).toBe(true);

  const keyed = {
    hasKey: async () => true,
    champion: async (id: number) => ({
      championId: id,
      source: { name: "aramgg", dataVersion: "x", stale: false },
    }),
  };
  const sources = new AramggSources(offline, keyed as any);
  expect((await sources.champion(99)).source.via).toBe("key");
  const noKey = new AramggSources(offline, {
    ...keyed,
    hasKey: async () => false,
  } as any);
  await expect(noKey.champion(99)).rejects.toMatchObject({
    code: "PUBLIC_DATA_MISSING",
  });
});
