import { expect, it } from "vitest";
import {
  premadeGroups,
  streakOf,
  type RecentGame,
} from "../src/shared/live-tags";

const game = (
  matchId: string,
  win: boolean,
  teamId = 100,
  sameMode = true,
): RecentGame => ({ matchId, win, teamId, sameMode });

it("连胜连败只看同模式，至少 3 场", () => {
  expect(
    streakOf([
      game("a", true),
      game("x", false, 100, false),
      game("b", true),
      game("c", true),
      game("d", false),
    ]),
  ).toEqual({ win: true, count: 3 });
  expect(
    streakOf([game("a", false), game("b", false), game("c", true)]),
  ).toBeNull();
  expect(
    streakOf([
      game("a", false),
      game("b", false),
      game("c", false),
      game("d", false),
    ]),
  ).toEqual({
    win: false,
    count: 4,
  });
  expect(streakOf([])).toBeNull();
});

it("同队且近期至少两局同队的玩家归为一组，跨队或只同一局不算", () => {
  const histories = {
    a: [game("m1", true, 100), game("m2", true, 200), game("m3", false, 100)],
    b: [game("m1", true, 100), game("m2", true, 200), game("m9", true, 100)],
    c: [game("m3", false, 100), game("m9", true, 100)],
    d: [game("m1", false, 200), game("m2", false, 100)],
    e: [game("m5", true, 100)],
  };
  const players = [
    { puuid: "a", teamId: 100 },
    { puuid: "b", teamId: 100 },
    { puuid: "c", teamId: 100 },
    { puuid: "d", teamId: 100 },
    { puuid: "e", teamId: 200 },
    { puuid: null, teamId: 100 },
  ];
  // a-b 同队 2 局（m1、m2）；c 与 a、b 各只同队 1 局；d 与 a 在 m1/m2 都是对手。
  expect(premadeGroups(players, histories)).toEqual({ a: 1, b: 1 });
  // 当前不同队伍的两人即使历史同队也不算预组队。
  expect(
    premadeGroups(
      [
        { puuid: "a", teamId: 100 },
        { puuid: "b", teamId: 200 },
      ],
      histories,
    ),
  ).toEqual({});
});

it("传递合并：a-b 与 b-c 各满足条件时三人同组", () => {
  const histories = {
    a: [game("1", true), game("2", true)],
    b: [game("1", true), game("2", true), game("3", true), game("4", true)],
    c: [game("3", true), game("4", true)],
    x: [game("7", true), game("8", true)],
    y: [game("7", true), game("8", true)],
  };
  const players = ["a", "b", "c", "x", "y"].map((puuid) => ({
    puuid,
    teamId: 100,
  }));
  expect(premadeGroups(players, histories)).toEqual({
    a: 1,
    b: 1,
    c: 1,
    x: 2,
    y: 2,
  });
});
