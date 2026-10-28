import { describe, expect, it } from "vitest";
import { parseCommandLine, parseLockfile } from "../src/main/discovery";
import {
  parseSelection,
  rankedEntries,
  liveChampion,
} from "../src/main/client";

describe("国服客户端身份与启动元数据", () => {
  it("中途启动时按本人 Riot ID 识别实时游戏英雄，不取第一个玩家", () => {
    const player = {
      puuid: "own",
      summonerId: 1,
      gameName: "测试玩家",
      tagLine: "123",
      level: 30,
      iconId: 1,
    };
    const players = [
      { riotId: "其他人#123", championName: "Annie" },
      {
        riotId: "测试玩家#123",
        rawChampionName: "game_character_displayname_Jhin",
      },
    ];
    expect(
      liveChampion(players, player, [
        { id: 1, alias: "Annie" },
        { id: 202, alias: "Jhin" },
      ]),
    ).toBe(202);
    expect(
      liveChampion(players, { ...player, tagLine: "999" }, [
        { id: 202, alias: "Jhin" },
      ]),
    ).toBeNull();
  });
  it("精确区分 Riot 启动器凭证和 League 客户端凭证", () => {
    expect(
      parseCommandLine(
        '"E:/英雄联盟/LeagueClientUx.exe" "--riotclient-app-port=50000" "--riotclient-auth-token=wrong" "--app-port=62000" "--remoting-auth-token=local-only"',
      ),
    ).toEqual({ port: 62000, token: "local-only" });
  });
  it("拒绝空锁文件、启动器锁文件和错误端口", () => {
    expect(parseLockfile("")).toBeNull();
    expect(parseLockfile("Riot Client:1:1234:wrong:https")).toBeNull();
    expect(
      parseCommandLine("--app-port=99999 --remoting-auth-token=example"),
    ).toBeNull();
    expect(parseLockfile("LeagueClient:1:60001:example:https")).toEqual({
      port: 60001,
      token: "example",
    });
  });
  it("隐藏身份保持为空，预选和备选仍可读取", () => {
    const selection = parseSelection({
      localPlayerCellId: 0,
      myTeam: [
        {
          cellId: 0,
          puuid: "00000000-0000-0000-0000-000000000000",
          summonerId: 0,
          championId: 0,
          championPickIntent: 202,
        },
      ],
      benchChampions: [{ championId: 1 }],
    });
    expect(selection.members[0].puuid).toBeNull();
    expect(selection.members[0].name).toBeNull();
    expect(selection.championId).toBe(202);
    expect(selection.bench).toEqual([1]);
  });
  it("未定级不把 NA 当作段位小级", () => {
    expect(
      rankedEntries({
        queueMap: {
          RANKED_SOLO_5x5: { tier: "", division: "NA" },
          RANKED_TFT: { tier: "GOLD" },
        },
      }),
    ).toEqual([
      {
        queue: "RANKED_SOLO_5x5",
        tier: "",
        division: "",
        wins: 0,
        losses: 0,
        lp: 0,
      },
    ]);
  });
});
