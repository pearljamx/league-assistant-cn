import { expect, it } from "vitest";
import { autoSelectDefaults, planAutoSelect } from "../src/main/auto-select";

const settings = (patch = {}) => ({
  ...autoSelectDefaults,
  pick: true,
  pickChampions: [11, 22, 33],
  ban: true,
  banChampions: [91, 92, 93],
  ...patch,
});
const session = (actions: any[], extra: any = {}) => ({
  localPlayerCellId: 2,
  myTeam: [
    { cellId: 1, championId: 0, championPickIntent: 92 },
    { cellId: 2, championId: 0 },
  ],
  theirTeam: [{ cellId: 6, championId: 22 }],
  bans: { myTeamBans: [], theirTeamBans: [91] },
  actions: [actions],
  ...extra,
});
const base = {
  pickable: null,
  bannable: null,
  cards: [],
  swappable: [],
  current: 0,
};

it("全部默认关闭时不做任何事", () => {
  const s = session([
    {
      id: 5,
      actorCellId: 2,
      type: "pick",
      isInProgress: true,
      completed: false,
      championId: 0,
    },
  ]);
  expect(
    planAutoSelect({
      ...base,
      session: s,
      settings: autoSelectDefaults,
      mode: "rift",
    }),
  ).toBeNull();
});

it("禁用：跳过已禁用和队友想选的英雄，只预禁不锁定", () => {
  const s = session([
    {
      id: 3,
      actorCellId: 2,
      type: "ban",
      isInProgress: true,
      completed: false,
      championId: 0,
    },
  ]);
  expect(
    planAutoSelect({ ...base, session: s, settings: settings(), mode: "rift" }),
  ).toEqual({
    kind: "ban",
    actionId: 3,
    championId: 93,
    complete: false,
  });
});

it("选人：跳过对面已选和不可选的英雄；锁定开关打开后对已预选的英雄提交锁定", () => {
  const s = session([
    {
      id: 5,
      actorCellId: 2,
      type: "pick",
      isInProgress: true,
      completed: false,
      championId: 0,
    },
  ]);
  expect(
    planAutoSelect({
      ...base,
      session: s,
      settings: settings(),
      mode: "rift",
      pickable: [22, 33],
    }),
  ).toEqual({ kind: "pick", actionId: 5, championId: 33, complete: false });
  const hovered = session([
    {
      id: 5,
      actorCellId: 2,
      type: "pick",
      isInProgress: true,
      completed: false,
      championId: 33,
    },
  ]);
  expect(
    planAutoSelect({
      ...base,
      session: hovered,
      settings: settings(),
      mode: "rift",
    }),
  ).toBeNull();
  expect(
    planAutoSelect({
      ...base,
      session: hovered,
      settings: settings({ lock: true }),
      mode: "rift",
    }),
  ).toEqual({ kind: "pick", actionId: 5, championId: 33, complete: true });
});

it("不覆盖用户自己预选的其他英雄，也不动别人的回合", () => {
  const own = session([
    {
      id: 5,
      actorCellId: 2,
      type: "pick",
      isInProgress: true,
      completed: false,
      championId: 77,
    },
  ]);
  expect(
    planAutoSelect({
      ...base,
      session: own,
      settings: settings({ lock: true }),
      mode: "rift",
    }),
  ).toBeNull();
  const other = session([
    {
      id: 6,
      actorCellId: 1,
      type: "pick",
      isInProgress: true,
      completed: false,
      championId: 0,
    },
  ]);
  expect(
    planAutoSelect({
      ...base,
      session: other,
      settings: settings(),
      mode: "rift",
    }),
  ).toBeNull();
});

it("大乱斗卡片只在打开锁定时自动拿；备选席只换优先级更高的英雄", () => {
  const s = session([
    { id: 9, actorCellId: 2, type: "pick", completed: false, championId: 0 },
  ]);
  const cards = { ...base, session: s, mode: "hex" as const, cards: [40, 22] };
  expect(planAutoSelect({ ...cards, settings: settings() })).toBeNull();
  expect(
    planAutoSelect({ ...cards, settings: settings({ lock: true }) }),
  ).toEqual({
    kind: "card",
    actionId: 9,
    championId: 22,
  });
  const bench = {
    ...base,
    session: s,
    mode: "aram" as const,
    settings: settings({ bench: true, benchChampions: [50, 60, 70] }),
  };
  expect(
    planAutoSelect({ ...bench, current: 60, swappable: [70, 50] }),
  ).toEqual({ kind: "bench", championId: 50 });
  expect(
    planAutoSelect({ ...bench, current: 50, swappable: [60, 70] }),
  ).toBeNull();
  expect(planAutoSelect({ ...bench, current: 99, swappable: [70] })).toEqual({
    kind: "bench",
    championId: 70,
  });
});

it("设置校验：默认全关，过滤非法英雄、去重、最多 10 个并限制延迟", async () => {
  const { defaults, validateSettings } = await import("../src/main/storage");
  expect(defaults.autoSelect).toMatchObject({
    pick: false,
    ban: false,
    lock: false,
    bench: false,
  });
  const next = validateSettings(
    {
      autoSelect: {
        pick: true,
        pickChampions: [
          1,
          1,
          -2,
          3.5,
          4,
          ...Array.from({ length: 12 }, (_, i) => 10 + i),
        ],
        lockDelayMs: 99999,
      } as any,
    },
    defaults,
  );
  expect(next.autoSelect!.pick).toBe(true);
  expect(next.autoSelect!.lock).toBe(false);
  expect(next.autoSelect!.pickChampions).toEqual([
    1, 4, 10, 11, 12, 13, 14, 15, 16, 17,
  ]);
  expect(next.autoSelect!.lockDelayMs).toBe(20000);
});
