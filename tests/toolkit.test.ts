import { expect, it } from "vitest";
import { Toolkit, normalizeFriend } from "../src/main/toolkit";

/** 模拟客户端：记录写请求，不连接真实客户端。 */
function fakeClient(responses: Record<string, unknown>, phase = "ChampSelect") {
  const calls: string[] = [];
  const client: any = {
    state: {
      status: "connected",
      region: "TENCENT",
      platform: "HN1",
      phase,
      summoner: { puuid: "me" },
    },
    async request(path: string, method = "GET", body?: unknown) {
      calls.push(`${method} ${path}${body ? " " + JSON.stringify(body) : ""}`);
      if (method !== "GET") return undefined;
      if (!(path in responses)) throw new Error("404 " + path);
      return structuredClone(responses[path]);
    },
    refreshSelection: async () => {},
  };
  return { client, calls, toolkit: new Toolkit(client) };
}
const session = {
  localPlayerCellId: 1,
  rerollsRemaining: 1,
  myTeam: [{ cellId: 1, championId: 202 }],
};

it("重随前确认有英雄与剩余次数，并返回原英雄以便拿回", async () => {
  const { toolkit, calls } = fakeClient({
    "/lol-champ-select/v1/session": session,
    "/lol-summoner/v1/current-summoner/rerollPoints": { numberOfRolls: 2 },
  });
  expect(await toolkit.reroll()).toEqual({ previous: 202 });
  expect(calls.filter((call) => !call.startsWith("GET"))).toEqual([
    "POST /lol-champ-select/v1/session/my-selection/reroll",
  ]);
  const empty = fakeClient({
    "/lol-champ-select/v1/session": session,
    "/lol-summoner/v1/current-summoner/rerollPoints": { numberOfRolls: 0 },
  });
  await expect(empty.toolkit.reroll()).rejects.toThrow("重随次数已用完");
  expect(empty.calls.some((call) => call.startsWith("POST"))).toBe(false);
});

it("未连接或不在选人阶段时不发写请求", async () => {
  const lobby = fakeClient({}, "Lobby");
  expect((await lobby.toolkit.rerollState()).available).toBe(false);
  const offline = fakeClient({});
  offline.client.state.status = "searching";
  await expect(offline.toolkit.restartUx()).rejects.toThrow("国服客户端");
  expect(offline.calls).toEqual([]);
});

it("好友只接受合法 PUUID，游戏中的排在前面，只有游戏中的可以观战", async () => {
  expect(normalizeFriend({ puuid: "../x" })).toBeNull();
  const { toolkit, calls } = fakeClient({
    "/lol-chat/v1/friends": [
      { puuid: "b", gameName: "乙", gameTag: "1", availability: "chat" },
      {
        puuid: "a",
        gameName: "甲",
        gameTag: "2",
        availability: "dnd",
        lol: { gameStatus: "inGame", championId: "202" },
      },
      { puuid: "c", gameName: "丙", availability: "offline" },
    ],
  });
  const friends = await toolkit.friends();
  expect(friends.map((friend) => friend.puuid)).toEqual(["a", "b", "c"]);
  expect(friends[0]).toMatchObject({
    name: "甲#2",
    inGame: true,
    spectatable: true,
    championId: 202,
  });
  await expect(toolkit.spectate("b")).rejects.toThrow("不在可观战");
  await toolkit.spectate("a");
  expect(calls.at(-1)).toContain("POST /lol-spectator/v1/spectate/launch");
  expect(calls.at(-1)).toContain('"puuid":"a"');
});

it("聊天状态只接受固定选项，签名截断到 200 字", async () => {
  const { toolkit, calls } = fakeClient({
    "/lol-chat/v1/me": { availability: "away", statusMessage: "旧签名" },
  });
  expect(await toolkit.chat()).toEqual({
    availability: "away",
    statusMessage: "旧签名",
  });
  await expect(
    toolkit.setChat({ availability: "dnd" as any }),
  ).rejects.toThrow();
  await toolkit.setChat({ statusMessage: "字".repeat(300) });
  const put = calls.find((call) => call.startsWith("PUT"))!;
  expect(put).toContain("/lol-chat/v1/me");
  expect(JSON.parse(put.slice(put.indexOf("{"))).statusMessage).toHaveLength(
    200,
  );
});
