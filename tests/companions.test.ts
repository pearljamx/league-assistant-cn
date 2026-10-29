import { expect, it } from "vitest";
import { CompanionController, companionBounds } from "../src/main/companions";
import { initialState } from "../src/main/client";

const client = () => ({
  ...initialState(),
  status: "connected" as const,
  region: "TENCENT",
  phase: "Lobby",
});
it("大厅显示两窗，单窗收起持续到下一阶段，进入游戏和断线隐藏", () => {
  const model = new CompanionController(),
    state = client();
  model.update(state);
  expect(model.visible("picker", true)).toBe(true);
  model.dismiss("picker");
  model.update(state);
  expect(model.visible("picker", true)).toBe(false);
  expect(model.visible("info", true)).toBe(true);
  model.update({ ...state, phase: "Matchmaking" });
  expect(model.visible("picker", true)).toBe(true);
  for (const phase of ["GameStart", "InProgress", "Reconnect"])
    expect(
      (model.update({ ...state, phase }), model.visible("info", true)),
    ).toBe(false);
  model.update({ ...state, status: "disconnected" });
  expect(model.visible("picker", true)).toBe(false);
});
it("手动浏览不会被相同轮询覆盖，客户端换英雄后恢复跟随", () => {
  const model = new CompanionController(),
    state = { ...client(), phase: "ChampSelect", championId: 202 };
  model.update(state);
  model.select(22);
  model.update(state);
  expect(model.snapshot()).toEqual({ championId: 22, followingClient: false });
  model.update({ ...state, championId: 99 });
  expect(model.snapshot()).toEqual({ championId: 99, followingClient: true });
  model.select(22);
  expect(model.select(null)).toEqual({ championId: 99, followingClient: true });
});
it("设置关闭隐藏两窗，重开解除收起，切账号清空手选", () => {
  const model = new CompanionController(),
    state = client();
  model.update(state);
  expect(model.visible("info", false)).toBe(false);
  model.dismiss("info");
  model.reopen();
  expect(model.visible("info", true)).toBe(true);
  model.select(22);
  model.update({ ...state, summoner: { puuid: "new" } as any });
  expect(model.snapshot()).toEqual({ championId: null, followingClient: true });
});
it.each([
  { x: 0, y: 0, width: 1920, height: 1040 },
  { x: -1280, y: -200, width: 1280, height: 720 },
  { x: 2000, y: 0, width: 800, height: 540 },
])("两个窗口坐标在工作区内：%o", (area) => {
  for (const bounds of Object.values(companionBounds(area))) {
    expect(bounds.x).toBeGreaterThanOrEqual(area.x);
    expect(bounds.y).toBeGreaterThanOrEqual(area.y);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(area.x + area.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(area.y + area.height);
  }
});
