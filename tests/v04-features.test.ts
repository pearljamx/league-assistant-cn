import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAramBalance } from "../src/main/providers/aram-balance";
import { balanceChips, balanceTrend } from "../src/shared/aram-balance";
import { statsLine, summarize } from "../src/main/team-stats";
import {
  Updater,
  compareVersions,
  expectedHash,
  latestRelease,
} from "../src/main/updater";
import { Client } from "../src/main/client";
import { defaults, type Storage } from "../src/main/storage";
import type { Match, Settings } from "../src/shared/types";

afterEach(() => vi.useRealTimers());

describe("大乱斗平衡数据", () => {
  const champion = (name: string, id: number, aram = "") => `  ["${name}"] = {
    ["id"]         = ${id},
    ["stats"] = {
      ["hp_base"]  = 650,
      ${aram}
      ["urf"] = {
        ["dmg_dealt"] = 1.15,
      },
    },
  },
`;
  const sample = (extra: string) =>
    "-- <pre>\nreturn {\n" +
    extra +
    Array.from({ length: 120 }, (_, i) => champion(`C${i}`, 1000 + i)).join(
      "",
    ) +
    "}\n";
  it("只取 aram 表中的已知调整，忽略注释、urf 与无调整值", () => {
    const table = parseAramBalance(
      sample(
        champion(
          "Aatrox",
          266,
          `["aram"] = {
        ["dmg_dealt"] = 1.05,
        ["dmg_taken"] = 1,
        --["healing"] = 0.5,
        ["ability_haste"] = -10,
        ["unknown"] = 3,
      },`,
        ),
      ),
    );
    expect(table[266]).toEqual({ dmg_dealt: 1.05, ability_haste: -10 });
    expect(table[1000]).toBeUndefined();
  });
  it("英雄过少视为格式变化", () => {
    expect(() => parseAramBalance(champion("A", 1, ""))).toThrow("格式");
  });
  it("显示为百分比，承伤降低算增强", () => {
    const chips = balanceChips({
      dmg_taken: 0.9,
      dmg_dealt: 1.05,
      healing: 0.8,
      ability_haste: 10,
    });
    expect(chips.map((chip) => [chip.text, chip.buff])).toEqual([
      ["伤害 +5%", true],
      ["承伤 -10%", true],
      ["治疗 -20%", false],
      ["急速 +10", true],
    ]);
    expect(balanceTrend(chips)).toBe(1);
    expect(balanceChips(undefined)).toEqual([]);
  });
});

describe("近期战绩汇总", () => {
  const match = (patch: Partial<Match>, win: boolean, k = 5): Match => ({
    id: String(Math.random()),
    queueId: 2400,
    mode: "KIWI",
    date: "",
    duration: 900,
    private: false,
    remake: false,
    players: [
      {
        puuid: "p",
        name: "",
        championId: 1,
        teamId: 100,
        win,
        kills: k,
        deaths: 2,
        assists: 10,
        items: [],
        damage: 0,
        gold: 0,
        cs: 0,
      },
    ],
    ...patch,
  });
  it("只算同模式有效对局，并生成一行", () => {
    const summary = summarize(
      [
        match({}, true),
        match({}, false),
        match({ mode: "ARAM" }, true),
        match({ remake: true }, true),
        match({ duration: 100 }, true),
      ],
      "p",
      "hex",
    );
    expect(summary).toMatchObject({ games: 2, wins: 1 });
    expect(statsLine("阿狸 测试#1", summary, "hex")).toBe(
      "阿狸 测试#1：近2场海克斯 1胜1负 50% · KDA 7.5（5.0/2.0/10.0）",
    );
    expect(statsLine("x", { ...summary, games: 0 }, "aram")).toBe(
      "x：近期无大乱斗对局",
    );
    expect(statsLine("x", null, "aram")).toBe("x：战绩暂不可用");
  });
});

describe("在线更新", () => {
  const release = (tag: string, extra: Record<string, unknown> = {}) => ({
    tag_name: tag,
    draft: false,
    prerelease: true,
    html_url: `https://github.com/pearljamx/league-assistant-cn/releases/tag/${tag}`,
    published_at: "2026-11-02T00:00:00Z",
    body: "notes",
    assets: [
      {
        name: `PearljamHex-${tag.slice(1)}-x64-Setup.exe`,
        browser_download_url: `https://github.com/x/${tag}/setup.exe`,
        size: 10,
      },
      {
        name: "SHA256SUMS",
        browser_download_url: `https://github.com/x/${tag}/SHA256SUMS`,
        size: 1,
      },
    ],
    ...extra,
  });
  it("版本比较与选出最高非草稿发布", () => {
    expect(compareVersions("0.10.0", "v0.9.9")).toBe(1);
    expect(compareVersions("0.3.0", "0.3.0")).toBe(0);
    expect(compareVersions("bad", "0.1.0")).toBeNull();
    const best = latestRelease([
      release("v0.3.0"),
      release("v0.5.0", { draft: true }),
      release("v0.4.0"),
      release("v0.4.1", { html_url: "https://evil.example/x" }),
    ]);
    expect(best?.version).toBe("0.4.0");
    expect(best?.installer?.name).toBe("PearljamHex-0.4.0-x64-Setup.exe");
    expect(expectedHash(`${"a".repeat(64)}  ${best!.installer!.name}\n`, best!.installer!.name)).toBe("a".repeat(64));
  });
  function fakeFetch(installer: Buffer, sums: string) {
    return vi.fn(async (url: string) => {
      const body = url.includes("api.github.com")
        ? JSON.stringify([release("v0.4.0")])
        : url.endsWith("SHA256SUMS")
          ? sums
          : installer;
      return new Response(typeof body === "string" ? body : new Uint8Array(body), {
        status: 200,
        headers: { "content-length": String(Buffer.byteLength(body)) },
      }) as Response;
    }) as unknown as typeof fetch;
  }
  it("校验一致才可安装，不一致删除并保持可重试", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phex-update-"));
    try {
      const installer = Buffer.from("installer-bytes");
      const hash = createHash("sha256").update(installer).digest("hex");
      const name = "PearljamHex-0.4.0-x64-Setup.exe";
      const launch = vi.fn();
      const bad = new Updater("0.3.0", {
        fetch: fakeFetch(installer, `${"0".repeat(64)}  ${name}\n`),
        directory,
        installable: true,
        emit: () => {},
        launch,
      });
      await bad.check();
      expect(bad.state.status).toBe("available");
      await bad.download();
      expect(bad.state.status).toBe("available");
      expect(bad.state.message).toContain("校验不一致");
      expect(() => bad.install()).toThrow();
      const good = new Updater("0.3.0", {
        fetch: fakeFetch(installer, `${hash}  ${name}\n`),
        directory,
        installable: true,
        emit: () => {},
        launch,
      });
      await good.check();
      await good.download();
      expect(good.state.status).toBe("ready");
      expect(await readFile(join(directory, "updates", name), "utf8")).toBe(
        "installer-bytes",
      );
      good.install();
      expect(launch).toHaveBeenCalledWith(join(directory, "updates", name));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("便携版只提示，不下载；已是最新显示无更新", async () => {
    const portable = new Updater("0.4.0", {
      fetch: fakeFetch(Buffer.from(""), ""),
      directory: tmpdir(),
      installable: false,
      emit: () => {},
      launch: () => {},
    });
    await portable.check();
    expect(portable.state.status).toBe("none");
    await expect(portable.download()).rejects.toThrow("便携版");
  });
});

function makeClient(patch: Partial<Settings>) {
  const settings = { ...defaults, ...patch };
  const client = new Client({ getSettings: () => settings } as Storage);
  client.state.status = "connected";
  client.state.region = "TENCENT";
  client.state.summoner = {
    puuid: "p1",
    summonerId: 1,
    gameName: "a",
    tagLine: "b",
    level: 1,
    iconId: 0,
  };
  const calls: { path: string; method: string; body?: unknown }[] = [];
  client.request = vi.fn(async (path: string, method = "GET", body) => {
    calls.push({ path, method, body });
    if (path === "/lol-chat/v1/conversations")
      return [
        { id: "x@lol", type: "chat" },
        { id: "room@champ-select", type: "championSelect" },
      ];
  }) as typeof client.request;
  return { client, calls, phase: (value: string) => (client as any).setPhase(value) };
}

describe("跳过点赞与选人聊天", () => {
  it("默认不跳过；开启后在点赞阶段提交 OPT_OUT 一次", async () => {
    vi.useFakeTimers();
    const off = makeClient({});
    off.phase("PreEndOfGame");
    await vi.advanceTimersByTimeAsync(3000);
    expect(off.calls).toHaveLength(0);
    off.client.stop();
    const on = makeClient({ autoSkipHonor: true });
    on.phase("PreEndOfGame");
    await vi.advanceTimersByTimeAsync(1100);
    on.client.updateAutomation();
    await vi.advanceTimersByTimeAsync(3000);
    expect(on.calls).toEqual([
      {
        path: "/lol-honor-v2/v1/honor-player",
        method: "POST",
        body: { honorCategory: "OPT_OUT", summonerId: 0 },
      },
    ]);
    on.client.stop();
  });
  it("只发到选人聊天，逐行发送，离开选人即停", async () => {
    vi.useFakeTimers();
    const { client, calls, phase } = makeClient({});
    await expect(client.sendChampSelectChat(["a"])).rejects.toThrow("选人");
    phase("ChampSelect");
    // 立即挂上处理，避免计时推进期间的拒绝被当作未处理错误。
    const sending = client
      .sendChampSelectChat(["一", "二", "三"])
      .then(() => null, (error: Error) => error);
    await vi.advanceTimersByTimeAsync(450);
    phase("GameStart");
    await vi.advanceTimersByTimeAsync(1000);
    expect((await sending)?.message).toContain("离开选人");
    const sent = calls.filter((call) => call.method === "POST");
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({
      path: "/lol-chat/v1/conversations/room%40champ-select/messages",
      method: "POST",
      body: { body: "一", type: "chat" },
    });
    client.stop();
  });
});

describe("Hexdata 官方窗口查询结果", async () => {
  const { parseMatchReport, sameRiotId } = await import(
    "../src/main/providers/hexdata-capture"
  );
  const body = (estimate: Record<string, unknown>, id = "名字 # TAG") => ({
    report: {
      schemaVersion: "hexdata-public-match-report-v1",
      resolvedGameId: id,
      regionKey: "hn1",
      generatedAt: "2026-11-02T00:00:00Z",
      targetEstimate: estimate,
    },
  });
  it("只记录 ready 的分数，取整并标明来源", () => {
    const capture = parseMatchReport(
      body({ status: "ready", score: 1580.6, intervalHalfWidth: 40.4 }),
      new Date("2026-11-02T08:00:00Z"),
    );
    expect(capture).toEqual({
      riotId: "名字#TAG",
      region: "HN1",
      score: {
        score: 1581,
        recordedAt: "2026-11-02T08:00:00.000Z",
        source: "official",
        interval: 40,
        generatedAt: "2026-11-02T00:00:00Z",
      },
    });
    expect(sameRiotId("名字#tag", " 名字 # TAG ")).toBe(true);
  });
  it("数据不足、格式不符或分数异常都不记录", () => {
    expect(parseMatchReport(body({ status: "collecting_data" }))).toBeNull();
    expect(parseMatchReport(body({ status: "ready", score: -1 }))).toBeNull();
    expect(parseMatchReport(body({ status: "ready", score: 1500 }, "无标签"))).toBeNull();
    expect(parseMatchReport({ report: { schemaVersion: "v2" } })).toBeNull();
    expect(parseMatchReport(null)).toBeNull();
  });
});
