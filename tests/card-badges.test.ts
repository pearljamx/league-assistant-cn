import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSlots } from "../src/main/recognition";
import { Storage } from "../src/main/storage";

const slot = (patch: Record<string, unknown> = {}) => ({
  centerX: 0.5,
  top: 0.16,
  bottom: 0.66,
  width: 0.17,
  badgeY: 0.55,
  id: 1001,
  ...patch,
});

describe("卡片位置", () => {
  it("三张卡的位置按顺序编号，未识别的卡没有强化编号", () => {
    expect(
      parseSlots([
        slot({ centerX: 0.315 }),
        slot({ id: null }),
        slot({ centerX: 0.685, id: 1003 }),
      ]),
    ).toEqual([
      { slot: 0, augmentId: 1001, centerX: 0.315, top: 0.16, bottom: 0.66, width: 0.17, badgeY: 0.55 },
      { slot: 1, augmentId: null, centerX: 0.5, top: 0.16, bottom: 0.66, width: 0.17, badgeY: 0.55 },
      { slot: 2, augmentId: 1003, centerX: 0.685, top: 0.16, bottom: 0.66, width: 0.17, badgeY: 0.55 },
    ]);
  });
  it("数量不对、越界或格式异常时整体丢弃，不画错位的标注", () => {
    expect(parseSlots([slot(), slot()])).toEqual([]);
    expect(parseSlots([slot(), slot({ centerX: 1.4 }), slot()])).toEqual([]);
    expect(parseSlots([slot(), slot({ top: 0.7 }), slot()])).toEqual([]);
    expect(parseSlots([slot(), slot({ badgeY: "0.5" }), slot()])).toEqual([]);
    expect(parseSlots(null)).toEqual([]);
    expect(parseSlots([slot({ id: -3 }), slot(), slot()])[0].augmentId).toBeNull();
  });
});

describe("自动识别默认开启的迁移", () => {
  async function load(saved: Record<string, unknown> | null) {
    const directory = await mkdtemp(join(tmpdir(), "phex-settings-"));
    if (saved) await writeFile(join(directory, "settings.json"), JSON.stringify(saved), "utf8");
    const storage = new Storage(directory);
    await storage.initialize();
    return { storage, directory };
  }
  it("旧版保存的默认值 false 在新版首次启动时打开一次", async () => {
    const { storage, directory } = await load({ autoRecognize: false });
    try {
      expect(storage.getSettings().autoRecognize).toBe(true);
      // 用户随后关掉，重启后保持关闭。
      await storage.updateSettings({ autoRecognize: false });
      const saved = JSON.parse(await readFile(join(directory, "settings.json"), "utf8"));
      expect(saved).toMatchObject({ autoRecognize: false, autoRecognizeV2: true });
      const again = new Storage(directory);
      await again.initialize();
      expect(again.getSettings().autoRecognize).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("全新安装默认开启", async () => {
    const { storage, directory } = await load(null);
    try {
      expect(storage.getSettings().autoRecognize).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
