import { expect, it } from "vitest";
import {
  CompanionController,
  alignToClient,
  companionBounds,
} from "../src/main/companions";
import { initialState } from "../src/main/client";

const client = () => ({
  ...initialState(),
  status: "connected" as const,
  region: "TENCENT",
  phase: "Lobby",
});
it("客户端刚打开即显示 Mini 窗，英雄信息窗只在选人阶段出现", () => {
  const model = new CompanionController(),
    state = client();
  model.update({ ...state, phase: "None" });
  expect(model.visible("picker", true)).toBe(true);
  expect(model.visible("info", true)).toBe(false);
  for (const phase of ["Lobby", "Matchmaking", "ReadyCheck", "EndOfGame"]) {
    model.update({ ...state, phase });
    expect(model.visible("picker", true)).toBe(true);
    expect(model.visible("info", true)).toBe(false);
  }
  model.update({ ...state, phase: "ChampSelect" });
  expect(model.visible("picker", true)).toBe(true);
  expect(model.visible("info", true)).toBe(true);
});
it("单窗收起持续到下一阶段，进入游戏和断线隐藏", () => {
  const model = new CompanionController(),
    state = client();
  model.update(state);
  expect(model.visible("picker", true)).toBe(true);
  model.dismiss("picker");
  model.update(state);
  expect(model.visible("picker", true)).toBe(false);
  model.update({ ...state, phase: "Matchmaking" });
  expect(model.visible("picker", true)).toBe(true);
  for (const phase of [
    "GameStart",
    "InProgress",
    "Reconnect",
    "WaitingForStats",
  ]) {
    model.update({ ...state, phase });
    expect(model.visible("picker", true)).toBe(false);
    expect(model.visible("info", true)).toBe(false);
  }
  model.update({ ...state, status: "disconnected" });
  expect(model.visible("picker", true)).toBe(false);
  model.update({ ...state, region: "RIOT" });
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
    state = { ...client(), phase: "ChampSelect" };
  model.update(state);
  expect(model.visible("info", false)).toBe(false);
  expect(model.visible("picker", false)).toBe(false);
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
const area = { x: 0, y: 0, width: 2560, height: 1400 };
it("客户端右侧有空间时两个小窗贴在其右侧", () => {
  const result = alignToClient(
    { x: 200, y: 150, width: 1280, height: 720 },
    area,
  );
  expect(result.picker.x).toBe(1488);
  expect(result.picker.y).toBe(150);
  expect(result.info.x).toBe(result.picker.x + result.picker.width + 8);
});
it("右侧不够时贴在左侧，单侧只够一个窗时分放两侧，都不够时退回右上角", () => {
  const left = alignToClient(
    { x: 1200, y: 100, width: 1280, height: 720 },
    area,
  );
  expect(left.info.x + left.info.width).toBe(1192);
  // 2048 宽工作区居中的 1280 客户端：两侧各约 376，Mini 右、信息窗左。
  const split = alignToClient(
    { x: 384, y: 256, width: 1280, height: 720 },
    { x: 0, y: 0, width: 2048, height: 1232 },
  );
  expect(split.picker.x).toBe(1672);
  expect(split.info.x + split.info.width).toBe(376);
  expect(split.picker.y).toBe(256);
  const full = { x: 0, y: 0, width: 1920, height: 1040 };
  expect(
    alignToClient({ x: 0, y: 0, width: 1920, height: 1080 }, full),
  ).toEqual(companionBounds(full));
});
it.each([
  { x: -3000, y: -900, width: 1280, height: 720 },
  { x: 2400, y: 1300, width: 1280, height: 720 },
])("客户端在屏幕外或跨屏时结果仍在工作区内：%o", (rect) => {
  for (const bounds of Object.values(alignToClient(rect, area))) {
    expect(bounds.x).toBeGreaterThanOrEqual(area.x);
    expect(bounds.y).toBeGreaterThanOrEqual(area.y);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(area.x + area.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(area.y + area.height);
  }
});
