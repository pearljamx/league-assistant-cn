import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage, defaults, validateSettings } from "../src/main/storage";
import { managedPage, RuneService } from "../src/main/runes";
import type { Client } from "../src/main/client";
import type { TencentProvider } from "../src/main/providers/tencent";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "league-assistant-test-"));
});
afterEach(async () => {
  if (!dir.startsWith(join(tmpdir(), "league-assistant-test-")))
    throw new Error("Temporary cleanup path rejected");
  await rm(dir, { force: true, recursive: true });
});
const option = {
  perks: [8005, 9111, 9104, 8014, 8139, 8140, 5008, 5008, 5011],
  primaryStyleId: 8000,
  subStyleId: 8100,
};
describe("持久化与符文页面归属", () => {
  it("重启后保留助手管理页面的账号归属", async () => {
    const store = new Storage(dir);
    await store.initialize();
    await store.rememberRunePage({ id: 123, puuid: "player-1" });
    const next = new Storage(dir);
    await next.initialize();
    expect(next.getSettings().managedRunePage).toEqual({
      id: 123,
      puuid: "player-1",
    });
  });
  it("界面提供的伪造管理页不能进入设置", () => {
    expect(
      validateSettings(
        { managedRunePage: { id: 1, puuid: "forged" }, acceptDelayMs: -3 },
        defaults,
      ).managedRunePage,
    ).toBeNull();
    expect(
      validateSettings({ acceptDelayMs: -3 }, defaults).acceptDelayMs,
    ).toBe(1000);
  });
  it("并行设置写入保持最后的完整状态", async () => {
    const store = new Storage(dir);
    await store.initialize();
    await Promise.all([
      store.updateSettings({ mode: "hex" }),
      store.updateSettings({ band: "mid" }),
    ]);
    const next = new Storage(dir);
    await next.initialize();
    expect(next.getSettings()).toMatchObject({
      mode: "hex",
      band: "mid",
      autoAccept: false,
    });
  });
  it("记住的编号、账号和名称必须同时匹配", () => {
    const pages = [
      { id: 1, isEditable: true, name: "用户自己创建" },
      { id: 2, isEditable: true, name: "联盟助手 · 202" },
    ];
    expect(managedPage(pages, { id: 1, puuid: "a" }, "a")).toBeNull();
    expect(managedPage(pages, { id: 2, puuid: "a" }, "b")).toBeNull();
    expect(managedPage(pages, { id: 2, puuid: "a" }, "a")?.id).toBe(2);
  });
  it("槽位已满时不发出任何写操作", async () => {
    const storage = new Storage(dir);
    await storage.initialize();
    const request = vi.fn(async (path: string) =>
      path.endsWith("/pages")
        ? [{ id: 1, isEditable: true, name: "用户页面" }]
        : { ownedPageCount: 1 },
    );
    const client = {
      state: { status: "connected", summoner: { puuid: "a" }, phase: "Lobby" },
      request,
    } as unknown as Client;
    const service = new RuneService(client, storage, {
      recommendation: async () => ({ runes: [option] }),
    } as unknown as TencentProvider);
    await expect(
      service.apply(
        202,
        { mode: "rift", band: "all", tier: 255, position: "BOTTOM" },
        0,
        option.perks,
      ),
    ).rejects.toMatchObject({ code: "RUNE_SLOTS_FULL" });
    expect(
      request.mock.calls.every((call: unknown[]) => call.length === 1),
    ).toBe(true);
  });
  it("英雄在预览期间改变时拒绝写入", async () => {
    const storage = new Storage(dir);
    await storage.initialize();
    await storage.rememberRunePage({ id: 2, puuid: "a" });
    const request = vi.fn(async () => [
      { id: 2, isEditable: true, name: "联盟助手 · 202" },
    ]);
    const client = {
      state: {
        status: "connected",
        summoner: { puuid: "a" },
        phase: "ChampSelect",
        championId: 1,
      },
      request,
    } as unknown as Client;
    const service = new RuneService(client, storage, {
      recommendation: async () => ({ runes: [option] }),
    } as unknown as TencentProvider);
    await expect(
      service.apply(
        202,
        { mode: "rift", band: "all", tier: 255, position: "BOTTOM" },
        0,
        option.perks,
      ),
    ).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("数据更新后不得应用与预览不同的符文", async () => {
    const storage = new Storage(dir);
    await storage.initialize();
    const request = vi.fn();
    const service = new RuneService(
      {
        state: {
          status: "connected",
          summoner: { puuid: "a" },
          phase: "Lobby",
        },
        request,
      } as unknown as Client,
      storage,
      {
        recommendation: async () => ({ runes: [option] }),
      } as unknown as TencentProvider,
    );
    await expect(
      service.apply(
        202,
        { mode: "rift", band: "all", tier: 255, position: "BOTTOM" },
        0,
        [...option.perks.slice(0, 8), 5001],
      ),
    ).rejects.toMatchObject({ code: "RUNES_PREVIEW_CHANGED" });
    expect(request).not.toHaveBeenCalled();
  });
  it.each(["account", "platform", "generation", "disconnect"])(
    "备份期间 %s 变化时拒绝符文写入",
    async (change) => {
      const storage = new Storage(dir);
      await storage.initialize();
      await storage.rememberRunePage({ id: 2, puuid: "a" });
      const request = vi.fn(async () => [
        { id: 2, isEditable: true, name: "联盟助手 · 202" },
      ]);
      const state = {
        status: "connected",
        summoner: { puuid: "a" },
        phase: "Lobby",
        platform: "HN1",
      };
      const client = { state, sessionGeneration: 1, request };
      vi.spyOn(storage, "put").mockImplementationOnce(async () => {
        if (change === "account") state.summoner.puuid = "b";
        if (change === "platform") state.platform = "HN2";
        if (change === "generation") client.sessionGeneration++;
        if (change === "disconnect") state.status = "disconnected";
      });
      const service = new RuneService(client as unknown as Client, storage, {
        recommendation: async () => ({ runes: [option] }),
      } as unknown as TencentProvider);
      await expect(
        service.apply(
          202,
          { mode: "rift", band: "all", tier: 255, position: "BOTTOM" },
          0,
          option.perks,
        ),
      ).rejects.toMatchObject({ code: "SESSION_CHANGED" });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
});
it("小窗尺寸只接受合理范围内的整数，并保留另一个窗的尺寸", () => {
  const base = validateSettings(
    { companionSize: { picker: { width: 360, height: 480 } } },
    defaults,
  );
  expect(base.companionSize).toEqual({ picker: { width: 360, height: 480 } });
  const next = validateSettings(
    {
      companionSize: {
        info: { width: 400, height: 700 },
        picker: { width: 10, height: 99999 },
      } as any,
    },
    base,
  );
  expect(next.companionSize).toEqual({
    picker: { width: 360, height: 480 },
    info: { width: 400, height: 700 },
  });
});
