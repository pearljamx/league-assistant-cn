import type { Phase } from "../shared/types";

/**
 * 进入指定阶段后延时执行一次的写操作（自动接受、自动匹配、自动回房）。
 * 同一 key 只尝试一次；关闭开关、断线或离开阶段立即取消尚未执行的计时。
 */
export class PhaseAction {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private key: string | null = null;
  private attempted = new Set<string>();
  private generation = 0;
  constructor(
    private phase: Phase,
    private action: () => Promise<void | boolean>,
    private report: (message: string) => void = () => {},
    private messages = { done: "已完成", failed: "操作未完成" },
    /** 计划执行的时间（毫秒时间戳），取消时为 null；用于界面倒计时。 */
    private onSchedule: (at: number | null) => void = () => {},
  ) {}
  update(
    enabled: boolean,
    connected: boolean,
    phase: Phase,
    key: string | null,
    delay: number,
  ) {
    const next = enabled && connected && phase === this.phase ? key : null;
    if (!next) {
      this.cancel();
      return;
    }
    if (next === this.key) return;
    this.cancel();
    this.key = next;
    if (this.attempted.has(next)) return;
    const generation = this.generation;
    const wait = Math.max(1000, delay);
    this.onSchedule(Date.now() + wait);
    this.timer = setTimeout(async () => {
      this.timer = null;
      this.onSchedule(null);
      if (generation !== this.generation || this.key !== next) return;
      this.attempted.add(next);
      if (this.attempted.size > 200)
        this.attempted.delete(this.attempted.values().next().value!);
      try {
        const done = await this.action();
        if (done !== false && generation === this.generation)
          this.report(this.messages.done);
      } catch {
        this.report(this.messages.failed);
      }
    }, wait);
  }
  cancel() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.onSchedule(null);
    }
    this.timer = null;
    this.key = null;
    this.generation++;
  }
}

export class AutoAccept extends PhaseAction {
  constructor(
    accept: () => Promise<void | boolean>,
    report: (message: string) => void = () => {},
  ) {
    super("ReadyCheck", accept, report, {
      done: "已接受对局",
      failed: "接受请求未完成，请在客户端手动确认。",
    });
  }
}
