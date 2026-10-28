import { afterEach, expect, it, vi } from "vitest";
import { Client } from "../src/main/client";
import { defaults, type Storage } from "../src/main/storage";
afterEach(() => {
  vi.useRealTimers();
});
it("确认读取过程中关闭开关，迟到的读取不得触发接受写入", async () => {
  vi.useFakeTimers();
  const settings = { ...defaults, autoAccept: true };
  const client = new Client({ getSettings: () => settings } as Storage);
  client.state.status = "connected";
  client.state.region = "TENCENT";
  client.state.phase = "ReadyCheck";
  let complete!: (result: any) => void;
  const request = vi.fn(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  client.request = request as typeof client.request;
  client.updateAutomation();
  await vi.advanceTimersByTimeAsync(1050);
  settings.autoAccept = false;
  client.updateAutomation();
  complete({ state: "InProgress", playerResponse: "None" });
  await vi.advanceTimersByTimeAsync(100);
  expect(request).toHaveBeenCalledTimes(1);
  client.stop();
});
it("非国服状态不能触发自动接受", async () => {
  vi.useFakeTimers();
  const storage = {
    getSettings: () => ({ ...defaults, autoAccept: true }),
  } as Storage;
  const client = new Client(storage);
  client.state.status = "connected";
  client.state.phase = "ReadyCheck";
  client.state.region = "NA";
  const request = vi.fn(async () => ({
    state: "InProgress",
    playerResponse: "None",
  }));
  client.request = request as typeof client.request;
  client.updateAutomation();
  await vi.advanceTimersByTimeAsync(1500);
  expect(request).not.toHaveBeenCalled();
  client.stop();
});
it("延迟到期再次读确认状态，已接受时不重复写", async () => {
  vi.useFakeTimers();
  const storage = {
    getSettings: () => ({ ...defaults, autoAccept: true }),
  } as Storage;
  const client = new Client(storage);
  client.state.status = "connected";
  client.state.phase = "ReadyCheck";
  client.state.region = "TENCENT";
  const request = vi.fn(async () => ({
    state: "InProgress",
    playerResponse: "Accepted",
  }));
  client.request = request as typeof client.request;
  client.updateAutomation();
  await vi.advanceTimersByTimeAsync(1500);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("/lol-matchmaking/v1/ready-check");
  client.stop();
});
