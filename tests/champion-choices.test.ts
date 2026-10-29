import { expect, it, vi } from "vitest";
import { Client } from "../src/main/client";
import { defaults, type Storage } from "../src/main/storage";

const session = () => ({
  localPlayerCellId: 0,
  benchEnabled: true,
  benchChampions: [{ championId: 22 }],
  myTeam: [
    { cellId: 0, puuid: "self", summonerId: 1, championId: 202 },
    { cellId: 1, puuid: "peer", championId: 99 },
  ],
  actions: [
    [
      {
        id: 7,
        actorCellId: 0,
        type: "pick",
        isInProgress: true,
        completed: false,
      },
    ],
  ],
});
function setup(mode: "hex" | "rift" = "hex") {
  const client = new Client({
    getSettings: () => ({ ...defaults }),
  } as Storage);
  Object.assign(client.state, {
    status: "connected",
    phase: "ChampSelect",
    region: "TENCENT",
    mode,
    summoner: { puuid: "self", summonerId: 1 },
  });
  (client as any).credentials = { pid: 1, port: 50001, token: "test-only" };
  const request = vi.fn(async (path: string, method = "GET"): Promise<any> => {
    if (method !== "GET") return undefined;
    if (path.endsWith("gameflow-phase")) return "ChampSelect";
    if (path.endsWith("pickable-champion-ids")) return [22, 202];
    return session();
  });
  client.request = request as typeof client.request;
  return { client, request };
}
const writes = (request: ReturnType<typeof vi.fn>) =>
  request.mock.calls.filter((args) => args[1] && args[1] !== "GET");
it("海克斯只允许当前备选席换用，不写队友英雄", async () => {
  const { client, request } = setup();
  expect(await client.getChampionChoices()).toMatchObject({
    kind: "bench",
    championIds: [22],
  });
  await expect(client.chooseChampion(99)).rejects.toMatchObject({
    code: "CHAMPION_UNAVAILABLE",
  });
  expect(writes(request)).toEqual([]);
  await client.chooseChampion(22);
  expect(writes(request)).toEqual([
    ["/lol-champ-select/v1/session/bench/swap/22", "POST"],
  ]);
  client.stop();
});
it("普通选人只修改本人进行中的选择，不自动锁定", async () => {
  const { client, request } = setup("rift");
  await client.chooseChampion(22);
  expect(writes(request)).toEqual([
    [
      "/lol-champ-select/v1/session/actions/7",
      "PATCH",
      { championId: 22, completed: false },
    ],
  ]);
  client.stop();
});
it.each(["not-owner", "locked", "disabled-bench", "other-pick"])(
  "拒绝无效状态 %s",
  async (reason) => {
    const { client, request } = setup(
      reason === "locked" || reason === "other-pick" ? "rift" : "hex",
    );
    const raw = session();
    if (reason === "not-owner")
      ((raw.myTeam[0].puuid = "other"), (raw.myTeam[0].summonerId = 2));
    if (reason === "locked") raw.actions[0][0].completed = true;
    if (reason === "other-pick") raw.actions[0][0].actorCellId = 1;
    if (reason === "disabled-bench") raw.benchEnabled = false;
    request.mockImplementation(async (path) =>
      path.endsWith("pickable-champion-ids") ? [22] : raw,
    );
    await expect(client.chooseChampion(22)).rejects.toBeInstanceOf(Error);
    expect(writes(request)).toEqual([]);
    client.stop();
  },
);
it.each(["phase", "account", "credentials", "revision"])(
  "在途读取后 %s 变化拒绝写入",
  async (change) => {
    const { client, request } = setup();
    let done!: (result: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    const pending = client.chooseChampion(22);
    if (change === "phase") client.state.phase = "InProgress";
    if (change === "account") client.state.summoner!.puuid = "new";
    if (change === "credentials") (client as any).credentials = { pid: 2 };
    if (change === "revision") (client as any).selectionRevision++;
    done(session());
    await expect(pending).rejects.toMatchObject({ code: "STALE_SELECTION" });
    expect(writes(request)).toEqual([]);
    client.stop();
  },
);
it("写前第二次读取发现备选席变化，拒绝旧选择", async () => {
  const { client, request } = setup();
  let reads = 0;
  request.mockImplementation(async (path) => {
    if (path.endsWith("gameflow-phase")) return "ChampSelect";
    const raw = session();
    if (++reads > 1) raw.benchChampions = [];
    return raw;
  });
  await expect(client.chooseChampion(22)).rejects.toMatchObject({
    code: "STALE_SELECTION",
  });
  expect(writes(request)).toEqual([]);
  client.stop();
});
it("相同按钮的并发点击不会重复换用", async () => {
  const { client, request } = setup();
  let done!: (value: any) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  const first = client.chooseChampion(22);
  await expect(client.chooseChampion(22)).rejects.toMatchObject({
    code: "CHAMPION_BUSY",
  });
  done(session());
  await first;
  expect(writes(request)).toHaveLength(1);
  client.stop();
});
it("服务端阶段已变化但本地事件未到达时，写前检查拒绝", async () => {
  const { client, request } = setup();
  request.mockImplementation(async (path) =>
    path.endsWith("gameflow-phase") ? "GameStart" : session(),
  );
  await expect(client.chooseChampion(22)).rejects.toMatchObject({
    code: "CHAMPION_INVALID_PHASE",
  });
  expect(writes(request)).toEqual([]);
  client.stop();
});
