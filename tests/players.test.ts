import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../src/main/storage";
import { PlayerStore } from "../src/main/players";
import type { Match } from "../src/shared/types";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "league-assistant-players-"));
});
afterEach(async () => {
  if (!dir.startsWith(join(tmpdir(), "league-assistant-players-")))
    throw new Error("Temporary cleanup path rejected");
  await rm(dir, { force: true, recursive: true });
});
const player = (
  puuid: string,
  teamId: number,
  win: boolean,
  championId = 1,
) => ({
  puuid,
  name: puuid + "#TEST",
  championId,
  teamId,
  win,
  kills: 0,
  deaths: 0,
  assists: 0,
  items: [],
  damage: 0,
  gold: 0,
  cs: 0,
});
const match = (
  id: string,
  date: string,
  extra: Partial<Match> = {},
): Match => ({
  id,
  queueId: 2400,
  mode: "KIWI",
  date,
  duration: 1200,
  private: false,
  remake: false,
  players: [
    player("self", 100, true, 202),
    player("ally", 100, true, 22),
    player("enemy", 200, false, 99),
    player("0000-0000", 200, false),
  ],
  ...extra,
});
async function setup() {
  const storage = new Storage(dir);
  await storage.initialize();
  return { storage, store: new PlayerStore(storage) };
}
it("只从本人对局记录同局公开玩家，区分队友与对手并去重", async () => {
  const { store } = await setup();
  await Promise.all([
    store.record("self", "HN1", [match("1", "2026-10-28T10:00:00Z")]),
    store.record("self", "HN1", [
      match("1", "2026-10-28T10:00:00Z"),
      match("2", "2026-10-29T10:00:00Z"),
      match("3", "2026-10-29T11:00:00Z", { private: true }),
      match("4", "2026-10-29T12:00:00Z", { remake: true }),
    ]),
  ]);
  const ally = await store.encounters("self", "HN1", "ally");
  expect(ally.total).toBe(2);
  expect(ally.games.map((game) => game.matchId)).toEqual(["2", "1"]);
  expect(ally.games[0]).toMatchObject({
    sameTeam: true,
    win: true,
    myChampionId: 202,
    theirChampionId: 22,
  });
  expect(
    (await store.encounters("self", "HN1", "enemy")).games[0].sameTeam,
  ).toBe(false);
  expect((await store.encounters("self", "HN1", "0000-0000")).total).toBe(0);
  expect((await store.encounters("self", "OTHER", "ally")).total).toBe(0);
  expect((await store.encounters("other-owner", "HN1", "ally")).total).toBe(0);
});
it("本人不在的对局不计入", async () => {
  const { store } = await setup();
  const foreign = match("9", "2026-10-29T10:00:00Z");
  foreign.players = foreign.players.filter((item) => item.puuid !== "self");
  await store.record("self", "HN1", [foreign]);
  expect((await store.encounters("self", "HN1", "ally")).total).toBe(0);
});
it("备注重启后保留，标签和备注都为空时删除", async () => {
  const { storage, store } = await setup();
  await store.saveNote({
    puuid: "ally",
    name: "队友#TEST",
    platform: "HN1",
    tag: "good",
    note: "  配合好  ",
  });
  const next = new PlayerStore(storage);
  expect(await next.note("ally")).toMatchObject({
    tag: "good",
    note: "配合好",
    name: "队友#TEST",
  });
  expect(
    await next.saveNote({
      puuid: "ally",
      name: "",
      platform: "HN1",
      tag: null,
      note: " ",
    }),
  ).toBeNull();
  expect(await next.listNotes()).toEqual([]);
});
it("清除遇到记录只影响当前账号与大区", async () => {
  const { store } = await setup();
  await store.record("self", "HN1", [match("1", "2026-10-28T10:00:00Z")]);
  await store.record("self", "HN2", [match("1", "2026-10-28T10:00:00Z")]);
  await store.clearEncounters("self", "HN1");
  expect((await store.encounters("self", "HN1", "ally")).total).toBe(0);
  expect((await store.encounters("self", "HN2", "ally")).total).toBe(1);
});
