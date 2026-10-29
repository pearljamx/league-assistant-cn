import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../src/main/storage";
import { setPublicFetcher } from "../src/main/http";
import {
  AramggProvider,
  normalizeChampion,
} from "../src/main/providers/aramgg";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "league-assistant-aramgg-"));
});
afterEach(async () => {
  setPublicFetcher(null as unknown as typeof fetch);
  if (!dir.startsWith(join(tmpdir(), "league-assistant-aramgg-")))
    throw new Error("Temporary cleanup path rejected");
  await rm(dir, { force: true, recursive: true });
});
const detail = (id = 202) => ({
  meta: { dataVersion: "16.21.3" },
  data: {
    champion: {
      id,
      stats: { tier: 3, winRate: 0.4847, pickRate: 0.1172, date: "2026-10-27" },
    },
    augments: [
      {
        id: 1002,
        name: "尖端发明家",
        rarityName: "gold",
        iconUrl:
          "https://cdn.dtodo.cn/hextech/augment-icons/apexinventor_large.png",
        stats: {
          tier: 4,
          rank: 2,
          total: 2,
          winRate: 0.4458,
          games: 563,
          pickRate: 0.0021,
        },
      },
      {
        id: 1038,
        name: "有始有终",
        rarityName: "gold",
        iconUrl: "javascript:alert(1)",
        stats: {
          tier: 1,
          rank: 1,
          total: 2,
          winRate: null,
          games: null,
          pickRate: 1.7,
        },
      },
    ],
    augmentTrios: [
      {
        augmentIds: [1007, 1071, 1134],
        augments: [
          { name: "大力" },
          { name: "更万用的瞄准镜" },
          { name: "亮出你的剑" },
        ],
        stats: { games: 151, winRate: 0.61 },
      },
    ],
    builds: [
      {
        tags: { primary: "AD, Crit" },
        stats: { games: 30000, winRate: 0.52, pickRate: 0.6 },
        coreItems: [
          {
            itemIds: [6676, 3009, 3031],
            items: [{ name: "收集者" }],
            games: 9000,
            winRate: 0.51,
          },
        ],
        startingItems: [],
        situationalItems: [
          { id: 3036, name: "多米尼克领主的致意", games: 100, winRate: 0.5 },
        ],
        summonerSpells: [
          {
            summonerSpellIds: [4, 6],
            spells: [{ name: "闪现" }, { name: "幽灵疾步" }],
            games: 19831,
            winRate: 0.517,
          },
        ],
        skillOrders: [
          { skillKeys: ["Q", "W", "E", "X"], games: 11903, winRate: 0.56 },
        ],
      },
    ],
  },
});
const secrets = (key: string | null = "hx_live_testkey_0000000000") => ({
  get: async () => key,
  masked: async () => (key ? "••••" + key.slice(-4) : null),
  set: async () => {},
});
function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const calls: string[] = [];
  setPublicFetcher((async (url: string, init?: RequestInit) => {
    calls.push(String(url).replace("https://data.dtodo.cn/api/v1/zh-CN", ""));
    return handler(String(url), init);
  }) as any);
  return calls;
}
const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers });

it("只保留合法数字与数据方 CDN 图标，并按国服推荐顺序排列", () => {
  const value = normalizeChampion(detail(), 202);
  expect(value.augments.map((row) => row.id)).toEqual([1038, 1002]);
  expect(value.augments[0]).toMatchObject({
    iconUrl: null,
    winRate: null,
    games: null,
    pickRate: null,
    tier: 1,
  });
  expect(value.augments[1].iconUrl).toBe(
    "https://cdn.dtodo.cn/hextech/augment-icons/apexinventor_large.png",
  );
  expect(value.trios[0]).toMatchObject({
    ids: [1007, 1071, 1134],
    games: 151,
    winRate: 0.61,
  });
  expect(value.builds[0].tags).toBe("AD, Crit");
  expect(value.builds[0].skills[0].keys).toEqual(["Q", "W", "E"]);
  expect(value.builds[0].spells[0].names).toEqual(["闪现", "幽灵疾步"]);
  expect(() => normalizeChampion(detail(99), 202)).toThrow();
});
it("同一数据版本只请求一次英雄详情，版本变化后才重新读取", async () => {
  const storage = new Storage(dir);
  await storage.initialize();
  let version = "16.21.3";
  const calls = mockFetch((url, init) => {
    if (url.endsWith("/config.json"))
      return json({ dataVersion: version, gamePatch: "16.21" });
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe(
      "hx_live_testkey_0000000000",
    );
    return json(detail(), {
      "x-credits-remaining": "196",
      "x-credits-daily": "200",
    });
  });
  const provider = new AramggProvider(storage, secrets() as any);
  const first = await provider.champion(202);
  expect(first.source).toMatchObject({
    dataVersion: "16.21.3",
    gamePatch: "16.21",
    stale: false,
  });
  await provider.champion(202);
  expect(calls.filter((path) => path.startsWith("/champions/"))).toHaveLength(
    1,
  );
  expect(await provider.status()).toMatchObject({
    creditsRemaining: 196,
    creditsDaily: 200,
    configured: true,
  });
  version = "16.21.4";
  (provider as any).version = null;
  await provider.champion(202);
  expect(calls.filter((path) => path.startsWith("/champions/"))).toHaveLength(
    2,
  );
});
it("网络失败时回退到上次缓存并标明过期；没有缓存时报错", async () => {
  const storage = new Storage(dir);
  await storage.initialize();
  let online = true;
  mockFetch((url) => {
    if (url.endsWith("/config.json"))
      return json({ dataVersion: online ? "16.21.3" : "16.21.9" });
    if (!online) throw new Error("offline");
    return json(detail());
  });
  const provider = new AramggProvider(storage, secrets() as any);
  await provider.champion(202);
  online = false;
  (provider as any).version = null;
  expect((await provider.champion(202)).source.stale).toBe(true);
  await expect(provider.champion(99)).rejects.toThrow();
});
it("Key 缺失、无效与额度不足给出明确提示", async () => {
  const storage = new Storage(dir);
  await storage.initialize();
  let status = 401;
  mockFetch((url) =>
    url.endsWith("/config.json")
      ? json({ dataVersion: "16.21.3" })
      : new Response("{}", { status }),
  );
  await expect(
    new AramggProvider(storage, secrets(null) as any).champion(202),
  ).rejects.toMatchObject({
    code: "ARAMGG_NO_KEY",
  });
  const provider = new AramggProvider(storage, secrets() as any);
  await expect(provider.champion(202)).rejects.toThrow("API Key 无效");
  status = 429;
  await expect(provider.champion(203)).rejects.toThrow("额度已用完");
  expect((await provider.status()).error).toContain("额度");
});
it("只发 HTTPS 请求", async () => {
  const fetcher = vi.fn();
  setPublicFetcher(fetcher as any);
  const { publicJson } = await import("../src/main/http");
  await expect(publicJson("http://data.dtodo.cn/x")).rejects.toMatchObject({
    code: "INVALID_REMOTE_URL",
  });
  expect(fetcher).not.toHaveBeenCalled();
});
