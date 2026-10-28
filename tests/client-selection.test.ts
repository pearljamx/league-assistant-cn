import { expect, it, vi } from "vitest";
import { Client } from "../src/main/client";
import { defaults, type Storage } from "../src/main/storage";

vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    default: class extends EventEmitter {
      send() {}
      terminate() {}
    },
  };
});
vi.mock("../src/main/discovery", () => ({
  discover: vi.fn(async () => ({ pid: 1, port: 50001, token: "test-only" })),
}));
const session = (championId: number) => ({
  localPlayerCellId: 0,
  myTeam: [{ cellId: 0, puuid: "a", summonerId: 1, championId }],
  benchChampions: [{ championId: 22 }],
});
function setup() {
  const client = new Client({
    getSettings: () => ({ ...defaults }),
  } as Storage);
  Object.assign(client.state, {
    status: "connected",
    phase: "ChampSelect",
    region: "TENCENT",
    summoner: { puuid: "a" },
  });
  return client;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
it.each(["Delete", "Update"])(
  "身份轮询途中发生 %s 事件，迟到的旧身份不得覆盖实时身份",
  async (eventType) => {
    const client = setup(),
      old = deferred<any>(),
      started = deferred<void>();
    (client as any).credentials = { pid: 1, port: 50001, token: "test-only" };
    client.request = vi.fn(async (path: string) => {
      if (path.endsWith("gameflow-phase")) return "ChampSelect";
      if (path.endsWith("region-locale")) return { region: "TENCENT" };
      if (path.endsWith("current-summoner")) {
        started.resolve();
        return old.promise;
      }
      if (path.endsWith("token"))
        return { issuer: "https://hn1-k8s-sgp.lol.qq.com" };
      return {};
    }) as typeof client.request;
    const pending = (client as any).tick();
    await started.promise;
    (client as any).socket.emit(
      "message",
      Buffer.from(
        JSON.stringify([
          8,
          "OnJsonApiEvent",
          {
            uri: "/lol-summoner/v1/current-summoner",
            eventType,
            data:
              eventType === "Delete"
                ? null
                : { puuid: "b", summonerId: 2, gameName: "新账号" },
          },
        ]),
      ),
    );
    old.resolve({ puuid: "a", summonerId: 1, gameName: "旧账号" });
    await pending;
    expect(client.state.summoner?.puuid ?? null).toBe(
      eventType === "Delete" ? null : "b",
    );
    client.stop();
  },
);
it("退出账号事件立即清空身份并取消旧选人响应", async () => {
  const client = setup(),
    old = deferred<any>();
  (client as any).credentials = { pid: 1, port: 50001, token: "test-only" };
  (client as any).connectSocket();
  client.request = vi.fn(() => old.promise) as typeof client.request;
  const pending = client.refreshSelection();
  (client as any).socket.emit(
    "message",
    Buffer.from(
      JSON.stringify([
        8,
        "OnJsonApiEvent",
        {
          uri: "/lol-summoner/v1/current-summoner",
          eventType: "Delete",
          data: null,
        },
      ]),
    ),
  );
  old.resolve(session(202));
  await pending;
  expect(client.state.summoner).toBeNull();
  expect(client.state.championId).toBeNull();
  expect(client.selection.members).toEqual([]);
  client.stop();
});
it("离开选人后迟到响应不得恢复队伍或覆盖已进入游戏的英雄", async () => {
  const client = setup(),
    old = deferred<any>();
  client.request = vi.fn(() => old.promise) as typeof client.request;
  const pending = client.refreshSelection();
  (client as any).setPhase("GameStart");
  client.state.championId = 22;
  old.resolve(session(202));
  await pending;
  expect(client.selection.members).toEqual([]);
  expect(client.state.championId).toBe(22);
  client.stop();
});
it("较早的选人查询晚于换人查询完成时不得回滚英雄", async () => {
  const client = setup(),
    old = deferred<any>();
  client.request = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(session(22));
  const pending = client.refreshSelection();
  await client.refreshSelection();
  old.resolve(session(202));
  await pending;
  expect(client.state.championId).toBe(22);
  expect(client.selection.championId).toBe(22);
  client.stop();
});
it("较早的查询失败不得清除后来成功的备选席", async () => {
  const client = setup(),
    old = deferred<any>();
  client.request = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(session(22));
  const pending = client.refreshSelection();
  await client.refreshSelection();
  old.reject(new Error("late timeout"));
  await pending;
  expect(client.selection.bench).toEqual([22]);
  client.stop();
});
it("客户端账号切换后丢弃旧选人响应", async () => {
  const client = setup(),
    old = deferred<any>();
  client.request = vi.fn(() => old.promise) as typeof client.request;
  const pending = client.refreshSelection();
  client.state.summoner = { ...client.state.summoner!, puuid: "b" };
  old.resolve(session(202));
  await pending;
  expect(client.selection.members).toEqual([]);
  expect(client.state.championId).toBeNull();
  client.stop();
});
it("实时换人事件优先于已经在途的旧查询", async () => {
  const client = setup(),
    old = deferred<any>();
  (client as any).credentials = { pid: 1, port: 50001, token: "test-only" };
  (client as any).connectSocket();
  client.request = vi.fn(() => old.promise) as typeof client.request;
  const pending = client.refreshSelection();
  (client as any).socket.emit(
    "message",
    Buffer.from(
      JSON.stringify([
        8,
        "OnJsonApiEvent",
        {
          uri: "/lol-champ-select/v1/session",
          eventType: "Update",
          data: session(22),
        },
      ]),
    ),
  );
  old.resolve(session(202));
  await pending;
  expect(client.state.championId).toBe(22);
  client.stop();
});
