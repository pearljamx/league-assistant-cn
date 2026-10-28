import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { RecognitionService } from "../src/main/recognition";
import { defaults } from "../src/main/storage";

function setup() {
  const settings = { ...defaults, autoRecognize: false };
  const client = Object.assign(new EventEmitter(), {
    state: {
      status: "connected",
      phase: "InProgress",
      mode: "hex",
      championId: 202,
      summoner: { puuid: "account-a" },
    },
  });
  const catalog = [1, 2, 3, 4].map((id) => ({
    id,
    name: `强化${id}`,
    rarity: "gold",
  }));
  const data = { catalog: vi.fn(async () => catalog) };
  const service = new RecognitionService(
    client as any,
    { getSettings: () => settings } as any,
    data as any,
    "",
    "",
    false,
  );
  return { service, settings, client, data };
}
afterEach(() => {
  vi.useRealTimers();
});

it("完整名称目录允许比较当前英雄没有统计的强化", async () => {
  const { service } = setup();
  const manual = await service.manual([1, 2, 4]);
  expect(manual.augmentIds).toEqual([1, 2, 4]);
  expect(service.state.augmentIds).toEqual([]);
  await expect(service.manual([1, 1, 2])).rejects.toThrow();
  await expect(service.manual([1, 2, 999])).rejects.toThrow();
});
it("分组变化立即清除旧三选一结果", async () => {
  const { service, settings } = setup();
  service.start();
  vi.spyOn(service as any, "request").mockResolvedValue({
    requestId: 1,
    result: {
      status: "recognized",
      cards: [1, 2, 3].map((id) => ({ id, text: String(id) })),
    },
  });
  await service.scan();
  settings.band = "mid";
  service.settingsChanged();
  expect(service.state.status).toBe("idle");
  expect(service.state.augmentIds).toEqual([]);
  service.stop();
});
it("断开后迟到的识别结果不能恢复旧卡片", async () => {
  const { service, client } = setup();
  service.start();
  let complete!: (value: any) => void;
  vi.spyOn(service as any, "request").mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const pending = service.scan();
  await Promise.resolve();
  client.state.status = "disconnected";
  client.emit("state");
  complete({
    requestId: 1,
    result: { status: "recognized", cards: [{ id: 1 }, { id: 2 }, { id: 3 }] },
  });
  await pending;
  expect(service.state.augmentIds).toEqual([]);
  expect(service.state.status).toBe("idle");
  service.stop();
});
it("F6 识别后即使未开自动扫描，也检查弹窗消失并清空结果", async () => {
  vi.useFakeTimers();
  const { service } = setup();
  service.start();
  vi.spyOn(service as any, "request")
    .mockResolvedValueOnce({
      requestId: 1,
      result: {
        status: "recognized",
        cards: [1, 2, 3].map((id) => ({ id, text: String(id) })),
      },
    })
    .mockResolvedValue({
      requestId: 1,
      result: { status: "idle", message: "等待弹窗", cards: [] },
    });
  await service.scan();
  await vi.advanceTimersByTimeAsync(950);
  expect(service.state.augmentIds).toEqual([]);
  expect(service.state.status).toBe("idle");
  service.stop();
});
it("手动比较不能替换已识别画面或打断自动识别", async () => {
  const { service } = setup();
  vi.spyOn(service as any, "request").mockResolvedValue({
    requestId: 1,
    result: {
      status: "recognized",
      cards: [1, 2, 3].map((id) => ({ id, text: String(id) })),
    },
  });
  await service.scan();
  const updates = vi.fn();
  service.on("recognition", updates);
  const manual = await service.manual([4, 2, 3]);
  expect(manual.augmentIds).toEqual([4, 2, 3]);
  expect(service.state.augmentIds).toEqual([1, 2, 3]);
  expect(updates).not.toHaveBeenCalled();
  service.stop();
});
it("英雄变化后迟到的手动请求不能发布结果", async () => {
  const { service, data, client } = setup();
  service.start();
  let complete!: (value: any) => void;
  data.catalog.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const pending = service.manual([1, 2, 3]);
  client.state.championId = 22;
  client.emit("state");
  complete([1, 2, 3].map((id) => ({ id, name: String(id), rarity: "gold" })));
  await expect(pending).rejects.toThrow("英雄或统计分组已变化");
  expect(service.state.augmentIds).toEqual([]);
  service.stop();
});
it("手动重试恢复成功后取消旧退避，继续检查弹窗是否消失", async () => {
  vi.useFakeTimers();
  const { service } = setup();
  service.start();
  vi.spyOn(service as any, "request")
    .mockRejectedValueOnce(new Error("interrupted"))
    .mockResolvedValueOnce({
      requestId: 2,
      result: {
        status: "recognized",
        cards: [1, 2, 3].map((id) => ({ id, text: `强化${id}` })),
      },
    })
    .mockResolvedValueOnce({
      requestId: 3,
      result: { status: "idle", cards: [] },
    });
  await service.scan();
  await service.scan();
  expect(service.state.status).toBe("recognized");
  await vi.advanceTimersByTimeAsync(950);
  expect(service.state.status).toBe("idle");
  expect(service.state.augmentIds).toEqual([]);
  service.stop();
});
