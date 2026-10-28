import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/main/http", () => ({ jsonRequest: vi.fn() }));
import {
  HistoryProvider,
  normalizeMatch,
  uniqueMatches,
} from "../src/main/providers/history";
import { jsonRequest } from "../src/main/http";
import { AppError } from "../src/main/errors";
import type { Client } from "../src/main/client";
import type { Storage } from "../src/main/storage";
beforeEach(() => {
  vi.mocked(jsonRequest).mockReset();
});
const raw = {
  gameId: 1,
  queueId: 2400,
  gameMode: "KIWI",
  gameCreation: 1000,
  gameDuration: 1200,
  participants: [
    {
      participantId: 1,
      championId: 202,
      teamId: 100,
      stats: {
        win: true,
        kills: 3,
        deaths: 2,
        assists: 5,
        totalDamageDealtToChampions: 2000,
      },
    },
  ],
  participantIdentities: [
    {
      participantId: 1,
      player: { puuid: "a", gameName: "示例", tagLine: "123" },
    },
  ],
};
const storage = () =>
  ({
    cache: vi.fn(async () => null),
    put: vi.fn(async () => {}),
  }) as unknown as Storage;
const client = (request: any) =>
  ({
    state: { status: "connected", summoner: { puuid: "a" }, platform: "HN1" },
    request,
  }) as unknown as Client;
describe("战绩与分页", () => {
  it("单局详情期间切换账号，不得回退到旧账号的部分缓存", async () => {
    const cached = storage();
    vi.mocked(cached.cache).mockResolvedValue({
      at: 1,
      data: normalizeMatch(raw),
    });
    const source = client(
      vi.fn(async () => {
        source.state.summoner = { ...source.state.summoner!, puuid: "b" };
        return raw;
      }),
    );
    await expect(
      new HistoryProvider(source, cached).match("1"),
    ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
    expect(cached.put).not.toHaveBeenCalled();
  });
  it("单局详情读取失败应向界面报告，不能把不完整缓存当成功", async () => {
    const cached = storage();
    vi.mocked(cached.cache).mockResolvedValue({
      at: 1,
      data: normalizeMatch(raw),
    });
    const source = client(
      vi.fn(async () => {
        throw new AppError("busy", "HTTP_503", 503);
      }),
    );
    await expect(
      new HistoryProvider(source, cached).match("1"),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("缓存异步读取期间切换账号，也不得返回旧账号完整详情", async () => {
    const cached = storage(),
      source = client(vi.fn());
    vi.mocked(cached.cache).mockImplementationOnce(async () => {
      source.state.summoner = { ...source.state.summoner!, puuid: "b" };
      const match = normalizeMatch(raw)!;
      return {
        at: Date.now(),
        data: { ...match, players: Array(10).fill(match.players[0]) },
      };
    });
    await expect(
      new HistoryProvider(source, cached).match("1"),
    ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
  });
  it("大区变化时不得返回前一个大区的战绩缓存", async () => {
    const cached = storage(),
      source = client(vi.fn());
    vi.mocked(cached.cache).mockImplementationOnce(async () => {
      source.state.platform = "HN10";
      return {
        at: Date.now(),
        data: {
          matches: [],
          nextIndex: 0,
          hasMore: false,
          source: "sgp",
          fetchedAt: "",
        },
      };
    });
    await expect(
      new HistoryProvider(source, cached).history("a", 0),
    ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
  });
  it("LCU 和 SGP 的同一场游戏归一到相同记录", () => {
    const one = normalizeMatch(raw)!;
    const two = normalizeMatch({
      json: {
        ...raw,
        participantIdentities: undefined,
        participants: [
          {
            puuid: "a",
            riotIdGameName: "示例",
            riotIdTagline: "123",
            championId: 202,
            teamId: 100,
            win: true,
            kills: 3,
            deaths: 2,
            assists: 5,
            totalDamageDealtToChampions: 2000,
          },
        ],
      },
    })!;
    expect(one).toEqual(two);
    expect(uniqueMatches([one, two])).toHaveLength(1);
    expect(normalizeMatch({ gameId: 0, participants: [] })).toBeNull();
  });
  it("大区成功时用服务器原始条目数推进偏移，跳过未生成的对局", async () => {
    vi.mocked(jsonRequest).mockResolvedValue({
      games: [{ json: raw }, { json: { gameId: 0, participants: [] } }],
    });
    const request = vi.fn(async (path: string) =>
      path.includes("entitlements")
        ? { accessToken: "test-only" }
        : "16.21.1234",
    );
    const result = await new HistoryProvider(
      client(request),
      storage(),
    ).history("a", 20);
    expect(result.matches).toHaveLength(1);
    expect(result.nextIndex).toBe(22);
    expect(result.source).toBe("sgp");
  });
  it("客户端忽略偏移的窗口不得冒充第二页", async () => {
    vi.mocked(jsonRequest).mockRejectedValue(
      new AppError("busy", "HTTP_503", 503),
    );
    const request = vi.fn(async (path: string) =>
      path.includes("entitlements")
        ? { accessToken: "test-only" }
        : "16.21.1234",
    );
    await expect(
      new HistoryProvider(client(request), storage()).history("a", 20),
    ).rejects.toMatchObject({ status: 503 });
    expect(
      request.mock.calls.every(
        ([path]: [string]) => !path.includes("/lol-match-history"),
      ),
    ).toBe(true);
    expect(jsonRequest).toHaveBeenCalledTimes(2);
  });
  it("失败时返回之前成功的缓存并明确标注来源", async () => {
    vi.mocked(jsonRequest).mockRejectedValue(
      new AppError("busy", "HTTP_503", 503),
    );
    const request = vi.fn(async (path: string) => {
      if (path.includes("entitlements")) return { accessToken: "test-only" };
      if (path.includes("version")) return "16.21.1234";
      throw new AppError("busy", "HTTP_503", 503);
    });
    const cached = storage();
    vi.mocked(cached.cache).mockResolvedValue({
      at: 1,
      data: {
        matches: [normalizeMatch(raw)],
        nextIndex: 20,
        hasMore: true,
        source: "sgp",
        fetchedAt: "2026-10-28",
      },
    });
    const provider = new HistoryProvider(client(request), cached);
    const result = await provider.history("a", 0);
    expect(result.source).toBe("cache");
    expect(result.warning).toContain("上次成功");
  });
  it("查询他人时过滤自定义私有对局", async () => {
    vi.mocked(jsonRequest).mockResolvedValue({
      games: [{ json: { ...raw, gameType: "CUSTOM_GAME" } }],
    });
    const request = vi.fn(async (path: string) =>
      path.includes("entitlements")
        ? { accessToken: "test-only" }
        : "16.21.1234",
    );
    const result = await new HistoryProvider(
      client(request),
      storage(),
    ).history("other", 0);
    expect(result.matches).toHaveLength(0);
  });
});
