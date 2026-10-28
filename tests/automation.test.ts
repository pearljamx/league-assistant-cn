import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoAccept } from "../src/main/automation";
afterEach(() => vi.useRealTimers());
describe("自动接受的时序与取消", () => {
  it("连续事件只执行一次，至少等待一秒", async () => {
    vi.useFakeTimers();
    const accept = vi.fn(async () => {});
    const auto = new AutoAccept(accept);
    auto.update(true, true, "ReadyCheck", "check1", 1000);
    auto.update(true, true, "ReadyCheck", "check1", 1000);
    await vi.advanceTimersByTimeAsync(999);
    expect(accept).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(accept).toHaveBeenCalledTimes(1);
    auto.update(true, true, "ReadyCheck", "check1", 1000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(accept).toHaveBeenCalledTimes(1);
  });
  it.each(["disabled", "disconnected", "phase-change"])(
    "取消尚未执行的确认：%s",
    async (reason) => {
      vi.useFakeTimers();
      const accept = vi.fn(async () => {});
      const auto = new AutoAccept(accept);
      auto.update(true, true, "ReadyCheck", "check1", 1000);
      auto.update(
        reason !== "disabled",
        reason !== "disconnected",
        reason === "phase-change" ? "ChampSelect" : "ReadyCheck",
        "check1",
        1000,
      );
      await vi.advanceTimersByTimeAsync(2000);
      expect(accept).not.toHaveBeenCalled();
    },
  );
  it("新的确认可执行，失败不自动重复轰炸接口", async () => {
    vi.useFakeTimers();
    const accept = vi.fn().mockRejectedValue(new Error("busy"));
    const auto = new AutoAccept(accept);
    auto.update(true, true, "ReadyCheck", "first", 1000);
    await vi.advanceTimersByTimeAsync(1100);
    auto.update(true, true, "Lobby", null, 1000);
    auto.update(true, true, "ReadyCheck", "first", 1000);
    await vi.advanceTimersByTimeAsync(1100);
    expect(accept).toHaveBeenCalledTimes(1);
    auto.update(true, true, "ReadyCheck", "second", 1000);
    await vi.advanceTimersByTimeAsync(1100);
    expect(accept).toHaveBeenCalledTimes(2);
  });
});
