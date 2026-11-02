import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../src/main/client";
import { defaults, type Storage } from "../src/main/storage";
import {
  lobbyInfo,
  matchSearch,
  nextBerserkChampion,
} from "../src/main/matchmaking";
import type { Settings } from "../src/shared/types";

afterEach(() => vi.useRealTimers());

const lobby = (patch: Record<string, unknown> = {}) => ({
  canStartActivity: true,
  gameConfig: { queueId: 2400, isCustom: false },
  localMember: { isLeader: true },
  members: [{}, {}],
  ...patch,
});

describe("房间与排队解析", () => {
  it("只有房主、非自定义、有队列时才能开始", () => {
    expect(lobbyInfo(lobby())).toMatchObject({
      canStart: true,
      leader: true,
      members: 2,
    });
    expect(lobbyInfo(lobby({ localMember: { isLeader: false } }))).toMatchObject(
      { canStart: false, reason: "只有房主可以开始匹配" },
    );
    expect(
      lobbyInfo(lobby({ gameConfig: { queueId: 0, isCustom: true } }))?.canStart,
    ).toBe(false);
    expect(lobbyInfo(lobby({ canStartActivity: false }))?.canStart).toBe(false);
    expect(lobbyInfo(null)).toBeNull();
  });
  it("排队时间取整，惩罚时间来自 errors", () => {
    expect(
      matchSearch({
        timeInQueue: 12.6,
        estimatedQueueTime: 90,
        errors: [{ penaltyTimeRemaining: 30 }],
      }),
    ).toEqual({ timeInQueue: 13, estimated: 90, penalty: 30 });
    expect(matchSearch({ timeInQueue: -1 })).toEqual({
      timeInQueue: null,
      estimated: null,
      penalty: null,
    });
  });
});

describe("狂暴切换顺序", () => {
  it("按首次出现顺序循环，换出去的英雄回到备选席后继续轮到", () => {
    const order: number[] = [];
    // 当前 1，备选 2、3 → 换 2
    expect(nextBerserkChampion(order, 1, [2, 3])).toBe(2);
    // 当前 2，备选 1、3 → 换 3
    expect(nextBerserkChampion(order, 2, [3, 1])).toBe(3);
    // 当前 3，备选 1、2 → 回到 1
    expect(nextBerserkChampion(order, 3, [1, 2])).toBe(1);
    expect(order).toEqual([1, 2, 3]);
  });
  it("跳过暂不可换的英雄，新出现的追加到末尾", () => {
    const order = [1, 2, 3];
    expect(nextBerserkChampion(order, 1, [3, 4])).toBe(3);
    expect(order).toEqual([1, 2, 3, 4]);
    expect(nextBerserkChampion(order, 1, [])).toBeNull();
  });
});

function makeClient(patch: Partial<Settings>) {
  const settings = { ...defaults, ...patch };
  const client = new Client({ getSettings: () => settings } as Storage);
  client.state.status = "connected";
  client.state.region = "TENCENT";
  client.state.summoner = {
    puuid: "p1",
    summonerId: 1,
    gameName: "a",
    tagLine: "b",
    level: 1,
    iconId: 0,
  };
  const calls: string[] = [];
  client.request = vi.fn(async (path: string, method = "GET") => {
    calls.push(`${method} ${path}`);
    if (path === "/lol-lobby/v2/lobby") return lobby();
    return undefined;
  }) as typeof client.request;
  const phase = (value: string) => (client as any).setPhase(value);
  return { client, settings, calls, phase };
}
const SEARCH = "POST /lol-lobby/v2/lobby/matchmaking/search";

describe("自动匹配", () => {
  it("从结算回到大厅时延时开始一次，并公布倒计时", async () => {
    vi.useFakeTimers();
    const { client, calls, phase } = makeClient({
      autoMatch: true,
      autoMatchDelayMs: 3000,
    });
    phase("EndOfGame");
    phase("Lobby");
    expect(client.state.autoMatchAt).toBeGreaterThan(Date.now());
    await vi.advanceTimersByTimeAsync(2900);
    expect(calls).not.toContain(SEARCH);
    await vi.advanceTimersByTimeAsync(200);
    expect(calls.filter((call) => call === SEARCH)).toHaveLength(1);
    expect(client.state.autoMatchAt).toBeNull();
    // 同一轮大厅里的后续刷新不再重复排队
    client.updateAutomation();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls.filter((call) => call === SEARCH)).toHaveLength(1);
    client.stop();
  });
  it("用户取消匹配回到大厅后本轮不自动再排", async () => {
    vi.useFakeTimers();
    const { client, calls, phase } = makeClient({ autoMatch: true });
    phase("Matchmaking");
    phase("Lobby");
    await vi.advanceTimersByTimeAsync(10000);
    expect(calls).not.toContain(SEARCH);
    client.stop();
  });
  it("跳过本次或关闭开关会取消倒计时", async () => {
    vi.useFakeTimers();
    const { client, calls, phase, settings } = makeClient({ autoMatch: true });
    phase("None");
    phase("Lobby");
    await client.matchmaking("skip");
    await vi.advanceTimersByTimeAsync(10000);
    expect(calls).not.toContain(SEARCH);
    expect(client.state.autoMatchAt).toBeNull();
    phase("None");
    phase("Lobby");
    settings.autoMatch = false;
    client.updateAutomation();
    await vi.advanceTimersByTimeAsync(10000);
    expect(calls).not.toContain(SEARCH);
    client.stop();
  });
  it("在大厅里打开开关即开始本轮倒计时；非房主不排队", async () => {
    vi.useFakeTimers();
    const { client, calls, phase, settings } = makeClient({});
    client.request = vi.fn(async (path: string, method = "GET") => {
      calls.push(`${method} ${path}`);
      if (path === "/lol-lobby/v2/lobby")
        return lobby({ localMember: { isLeader: false } });
    }) as typeof client.request;
    phase("Matchmaking");
    phase("Lobby");
    settings.autoMatch = true;
    client.updateAutomation();
    await vi.advanceTimersByTimeAsync(3100);
    expect(calls).toContain("GET /lol-lobby/v2/lobby");
    expect(calls).not.toContain(SEARCH);
    expect(client.state.message).toContain("只有房主");
    client.stop();
  });
  it("手动开始只在大厅，取消只在匹配中", async () => {
    const { client, calls, phase } = makeClient({});
    phase("None");
    await expect(client.matchmaking("start")).rejects.toThrow("组队大厅");
    phase("Lobby");
    await client.matchmaking("start");
    expect(calls).toContain(SEARCH);
    await expect(client.matchmaking("cancel")).rejects.toThrow("不在匹配");
    phase("Matchmaking");
    await client.matchmaking("cancel");
    expect(calls).toContain("DELETE /lol-lobby/v2/lobby/matchmaking/search");
    client.stop();
  });
  it("结算后自动回房默认关闭，打开后执行一次", async () => {
    vi.useFakeTimers();
    const off = makeClient({});
    off.phase("EndOfGame");
    await vi.advanceTimersByTimeAsync(5000);
    expect(off.calls).not.toContain("POST /lol-lobby/v2/play-again");
    off.client.stop();
    const on = makeClient({ autoPlayAgain: true });
    on.phase("EndOfGame");
    await vi.advanceTimersByTimeAsync(2100);
    on.client.updateAutomation();
    await vi.advanceTimersByTimeAsync(5000);
    expect(
      on.calls.filter((call) => call === "POST /lol-lobby/v2/play-again"),
    ).toHaveLength(1);
    on.client.stop();
  });
});

describe("狂暴切换", () => {
  it("只能在大乱斗选人阶段开启，离开选人自动停止", () => {
    const { client, phase } = makeClient({});
    phase("Lobby");
    expect(() => client.setBerserk(true)).toThrow("选人阶段");
    phase("ChampSelect");
    client.state.mode = "rift";
    expect(() => client.setBerserk(true)).toThrow("大乱斗");
    client.state.mode = "hex";
    vi.spyOn(client, "getChampionChoices").mockResolvedValue({
      championIds: [],
      kind: "none",
      reason: "",
    });
    expect(client.setBerserk(true)).toBe(true);
    expect(client.state.berserk).toBe(true);
    phase("GameStart");
    expect(client.state.berserk).toBe(false);
    client.stop();
  });
  /** 模拟客户端：会话里本人英雄与备选席，bench swap 交换两者。 */
  function benchClient(failSwap = false) {
    const ctx = makeClient({});
    ctx.phase("ChampSelect");
    ctx.client.state.mode = "aram";
    let current = 1;
    let bench = [2, 3];
    const swaps: number[] = [];
    ctx.client.request = vi.fn(async (path: string, method = "GET") => {
      if (path === "/lol-champ-select/v1/session")
        return {
          localPlayerCellId: 0,
          benchEnabled: true,
          benchChampions: bench.map((championId) => ({ championId })),
          myTeam: [{ cellId: 0, puuid: "p1", championId: current }],
        };
      const swap = path.match(/bench\/swap\/(\d+)$/);
      if (swap && method === "POST") {
        if (failSwap) throw new Error("rejected");
        const id = Number(swap[1]);
        swaps.push(id);
        bench = bench.map((item) => (item === id ? current : item));
        current = id;
      }
    }) as typeof ctx.client.request;
    return { ...ctx, swaps };
  }
  it("约 0.1 秒一换，按顺序循环，每次只读一次会话再交换", async () => {
    vi.useFakeTimers();
    const { client, swaps } = benchClient();
    client.setBerserk(true);
    await vi.advanceTimersByTimeAsync(100 * 3 + 10);
    expect(swaps.slice(0, 4)).toEqual([2, 3, 1, 2]);
    const requests = (client.request as any).mock.calls.length;
    expect(requests).toBe(swaps.length * 2);
    client.setBerserk(false);
    const count = swaps.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(swaps).toHaveLength(count);
    client.stop();
  });
  it("交换一直被拒绝时 5 秒后自动停止", async () => {
    vi.useFakeTimers();
    const { client } = benchClient(true);
    client.setBerserk(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.state.berserk).toBe(true);
    await vi.advanceTimersByTimeAsync(2500);
    expect(client.state.berserk).toBe(false);
    expect(client.state.message).toContain("5 秒");
    client.stop();
  });
});
