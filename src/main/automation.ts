import type { Phase } from "../shared/types";

export class AutoAccept {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private key: string | null = null;
  private attempted = new Set<string>();
  private generation = 0;
  constructor(
    private accept: () => Promise<void | boolean>,
    private report: (message: string) => void = () => {},
  ) {}
  update(
    enabled: boolean,
    connected: boolean,
    phase: Phase,
    readyKey: string | null,
    delay: number,
  ) {
    const key =
      enabled && connected && phase === "ReadyCheck" ? readyKey : null;
    if (!key) {
      this.cancel();
      return;
    }
    if (key === this.key) return;
    this.cancel();
    this.key = key;
    if (this.attempted.has(key)) return;
    const generation = this.generation;
    this.timer = setTimeout(
      async () => {
        this.timer = null;
        if (generation !== this.generation || this.key !== key) return;
        this.attempted.add(key);
        if (this.attempted.size > 200)
          this.attempted.delete(this.attempted.values().next().value!);
        try {
          const accepted = await this.accept();
          if (accepted !== false && generation === this.generation)
            this.report("已接受对局");
        } catch {
          this.report("接受请求未完成，请在客户端手动确认。");
        }
      },
      Math.max(1000, delay),
    );
  }
  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.key = null;
    this.generation++;
  }
}
