import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import type { Client } from "../src/main/client";
import { initialState } from "../src/main/client";
import { LiveGameProvider } from "../src/main/providers/live-game";
import { jsonRequest } from "../src/main/http";
vi.mock("../src/main/http", () => ({ jsonRequest: vi.fn() }));

function setup(phase = "InProgress") {
  const client = Object.assign(new EventEmitter(), {
    state: {
      ...initialState(),
      status: "connected",
      region: "TENCENT",
      phase,
      mode: "hex",
      summoner: { puuid: "self", gameName: "自己", tagLine: "1" },
    },
    request: vi.fn(
      async (path: string): Promise<any> =>
        path.includes("champion-summary")
          ? [{ id: 202, alias: "Jhin", name: "戏命师" }]
          : {
              gameData: {
                teamOne: [
                  { gameName: "自己", tagLine: "1", puuid: "self" },
                  { gameName: "同名", tagLine: "1", puuid: "wrong" },
                ],
                teamTwo: [],
              },
            },
    ),
  });
  return {
    client,
    provider: new LiveGameProvider(client as unknown as Client),
  };
}
it("实时信息完整身份匹配PUUID，不按英雄或队伍顺序推断", async () => {
  const { provider } = setup();
  vi.mocked(jsonRequest).mockResolvedValue({
    gameData: { gameTime: 125 },
    allPlayers: [
      {
        riotId: "同名#2",
        rawChampionName: "game_character_displayname_Jhin",
        team: "ORDER",
        scores: { kills: 3, deaths: 1, assists: 2 },
        level: 7,
        items: [{ itemID: 1001 }],
      },
      {
        riotIdGameName: "自己",
        riotIdTagLine: "1",
        rawChampionName: "game_character_displayname_Jhin",
        team: "ORDER",
      },
    ],
  });
  const value = await provider.get();
  expect(value).toMatchObject({ status: "live", gameTime: 125 });
  expect(value.players[0]).toMatchObject({
    puuid: null,
    riotId: "同名#2",
    championId: 202,
    kills: 3,
    teamId: 100,
    items: [1001],
    isSelf: false,
  });
  expect(value.players[1]).toMatchObject({
    puuid: "self",
    isSelf: true,
    kills: null,
  });
  expect(jsonRequest).toHaveBeenCalledWith(
    "https://127.0.0.1:2999/liveclientdata/allgamedata",
    { loopback: true, timeout: 2200 },
  );
});
it("选人阶段隐藏身份保持为空，只展示公开双方英雄", async () => {
  const { client, provider } = setup("ChampSelect");
  client.request.mockResolvedValue({
    localPlayerCellId: 0,
    myTeam: [
      {
        cellId: 0,
        championId: 202,
        puuid: "self",
        gameName: "自己",
        tagLine: "1",
      },
    ],
    theirTeam: [
      { cellId: 5, championId: 22, puuid: "00000000-0000", summonerId: 888 },
    ],
  });
  const value = await provider.get();
  expect(value.players[1]).toMatchObject({
    riotId: null,
    puuid: null,
    identityHidden: true,
    championId: 22,
  });
  expect(value.players[0].isSelf).toBe(true);
});
it("Live API失败时返回unavailable，不制造实时数据", async () => {
  const { provider } = setup();
  vi.mocked(jsonRequest).mockRejectedValue(new Error("not ready"));
  expect(await provider.get()).toMatchObject({
    status: "unavailable",
    players: [],
    gameTime: null,
  });
});
it("退出或切换账号后旧响应不能恢复实时玩家", async () => {
  const { client, provider } = setup();
  let done!: (value: unknown) => void;
  vi.mocked(jsonRequest).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  const pending = provider.get();
  client.state.summoner.puuid = "new";
  client.emit("state", client.state);
  done({ allPlayers: [{ riotId: "自己#1" }] });
  await expect(pending).rejects.toMatchObject({ code: "STALE_LIVE_GAME" });
});
it("同阶段切号即使未收到事件也不能复用前账号缓存", async () => {
  const { client, provider } = setup();
  vi.mocked(jsonRequest).mockResolvedValue({
    allPlayers: [{ riotId: "自己#1" }],
  });
  await provider.get();
  client.state.summoner.puuid = "new";
  vi.mocked(jsonRequest).mockRejectedValue(
    new Error("new context unavailable"),
  );
  expect(await provider.get()).toMatchObject({
    status: "unavailable",
    players: [],
  });
});
it("选人实时换人事件使旧缓存失效", async () => {
  const { client, provider } = setup("ChampSelect");
  const session = {
    localPlayerCellId: 0,
    myTeam: [{ cellId: 0, championId: 202, puuid: "self" }],
  };
  Object.assign(client, {
    selection: { championId: 202, members: session.myTeam, bench: [] },
  });
  client.request.mockResolvedValue(session);
  expect((await provider.get()).players[0].championId).toBe(202);
  Object.assign(client, {
    selection: {
      championId: 22,
      members: [{ ...session.myTeam[0], championId: 22 }],
      bench: [],
    },
  });
  client.emit("state", client.state);
  client.request.mockResolvedValue({
    ...session,
    myTeam: [{ ...session.myTeam[0], championId: 22 }],
  });
  expect((await provider.get()).players[0].championId).toBe(22);
});
