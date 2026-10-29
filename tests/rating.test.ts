import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/main/http", () => ({ jsonRequest: vi.fn() }));
import { jsonRequest } from "../src/main/http";
import { AppError } from "../src/main/errors";
import {
  normalizeRatingRiotId,
  parseAramHexPosition,
  SkillRatingProvider,
} from "../src/main/providers/rating";

const config = { rank: { enabled: true, api: "https://aramhex.com/api/rank" } };
const raw = {
  as_of: "2026-10-26",
  results: [
    {
      region: "HN1",
      region_name: "艾欧尼亚",
      top: 0.031,
      band: "high",
      band_name: "高分",
      games: 120,
      solo_top: 0.04,
      solo_games: 9,
    },
    {
      region: "HN10",
      region_name: "黑色玫瑰",
      top: 0.81,
      band: "casual",
      band_name: "娱乐",
      games: 50,
    },
  ],
};
beforeEach(() => vi.mocked(jsonRequest).mockReset());

describe("AramHex 公开位次和 Hexdata 分数分开", () => {
  it("去除客户端复制的方向符和全角分隔，保留名字内部空格", () => {
    expect(normalizeRatingRiotId(" ⁦测试 名⁩ ＃ ⁦12345⁩​ ")).toBe(
      "测试 名#12345",
    );
  });
  it("读取同区原始 top 小数，保留来源字段，不制造海斗分", async () => {
    vi.mocked(jsonRequest)
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce(raw);
    const result = await new SkillRatingProvider().query("测试#12345", "HN1");
    expect(result).toMatchObject({
      provider: "hexdata",
      status: "needs-authorization",
      score: null,
      percentile: null,
    });
    expect(result.aramhex).toMatchObject({
      provider: "aramhex",
      status: "ready",
      percentile: 0.031,
      region: "HN1",
      regionName: "艾欧尼亚",
      date: "2026-10-26",
      games: 120,
      soloPercentile: 0.04,
      soloGames: 9,
    });
    const [url, options] = vi.mocked(jsonRequest).mock.calls[1];
    expect(new URL(url).searchParams.get("id")).toBe("测试#12345");
    expect(options?.headers).not.toHaveProperty("Authorization");
    expect(options?.headers?.["User-Agent"]).toContain("LeagueAssistantCN");
  });
  it("没有当前大区时不使用别区位次，多区且未指定也不任意选择", () => {
    expect(parseAramHexPosition(raw, "HN2")).toMatchObject({
      status: "unavailable",
      percentile: null,
    });
    expect(parseAramHexPosition(raw)).toMatchObject({
      status: "unavailable",
      percentile: null,
    });
  });
  it("缺少样本/单排/日期保持 null，不补零或从分组制造分数", () => {
    const value = parseAramHexPosition(
      { results: [{ region: "HN1", top: 0.2, band: "mid" }] },
      "HN1",
    );
    expect(value).toMatchObject({
      status: "ready",
      percentile: 0.2,
      games: null,
      soloGames: null,
      soloPercentile: null,
      date: null,
    });
  });
  it("拒绝百分数与 top 小数单位混用、字符串数值和非有限值", () => {
    for (const top of [3.1, "0.031", Infinity, NaN, -0.01]) {
      expect(
        parseAramHexPosition({ results: [{ region: "HN1", top }] }, "HN1"),
      ).toMatchObject({ status: "error", percentile: null });
    }
  });
  it("缺少完整 Riot ID 不联网", async () => {
    const provider = new SkillRatingProvider();
    for (const id of [
      undefined,
      "只有名字",
      "测试#",
      "测试#1#2",
      "测试\n名字#1",
    ])
      expect((await provider.query(id)).aramhex.status).toBe("unavailable");
    expect(jsonRequest).not.toHaveBeenCalled();
  });
  it("遵守官方关闭开关，不绕过到旧接口", async () => {
    vi.mocked(jsonRequest).mockResolvedValueOnce({ rank: { enabled: false } });
    expect(
      (await new SkillRatingProvider().query("测试#1", "HN1")).aramhex,
    ).toMatchObject({ status: "unavailable", percentile: null });
    expect(jsonRequest).toHaveBeenCalledTimes(1);
  });
  it("云端更改 API 主机时不把玩家 ID 发到未允许地址", async () => {
    vi.mocked(jsonRequest).mockResolvedValueOnce({
      rank: { enabled: true, api: "https://other.example/rank" },
    });
    expect(
      (await new SkillRatingProvider().query("测试#1", "HN1")).aramhex.status,
    ).toBe("unavailable");
    expect(jsonRequest).toHaveBeenCalledTimes(1);
  });
  it("同一玩家并发去重，缓存副本不被界面修改", async () => {
    vi.mocked(jsonRequest)
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce(raw);
    const provider = new SkillRatingProvider();
    const [first, second] = await Promise.all([
      provider.query("测试#1", "HN1"),
      provider.query("测试#1", "HN1"),
    ]);
    first.aramhex.percentile = 0.9;
    expect(second.aramhex.percentile).toBe(0.031);
    expect((await provider.query("测试#1", "HN1")).aramhex.percentile).toBe(
      0.031,
    );
    expect(jsonRequest).toHaveBeenCalledTimes(2);
  });
  it("429 阻止一分钟内其他玩家查询，无自动重试", async () => {
    vi.mocked(jsonRequest)
      .mockResolvedValueOnce(config)
      .mockRejectedValueOnce(new AppError("limited", "HTTP_429", 429));
    const provider = new SkillRatingProvider();
    expect((await provider.query("测试#1", "HN1")).aramhex.status).toBe(
      "rate-limited",
    );
    expect((await provider.query("其他#2", "HN1")).aramhex.status).toBe(
      "rate-limited",
    );
    expect(jsonRequest).toHaveBeenCalledTimes(2);
  });
  it("查无玩家和服务失败分开，均不伪造结果", async () => {
    vi.mocked(jsonRequest)
      .mockResolvedValueOnce(config)
      .mockRejectedValueOnce(new AppError("not found", "HTTP_404", 404));
    expect(
      (await new SkillRatingProvider().query("测试#1", "HN1")).aramhex,
    ).toMatchObject({ status: "unavailable", percentile: null });
    vi.mocked(jsonRequest)
      .mockResolvedValueOnce(config)
      .mockRejectedValueOnce(new AppError("offline", "HTTP_503", 503));
    expect(
      (await new SkillRatingProvider().query("测试#1", "HN1")).aramhex,
    ).toMatchObject({ status: "error", percentile: null });
  });
  it("配置服务失败时不猜测开关或另找私有入口", async () => {
    vi.mocked(jsonRequest).mockRejectedValueOnce(new Error("offline"));
    expect(
      (await new SkillRatingProvider().query("测试#1", "HN1")).aramhex.status,
    ).toBe("error");
    expect(jsonRequest).toHaveBeenCalledTimes(1);
  });
  it("服务要求官方软件时明确待授权，不冒用官方客户端标记重试", async () => {
    vi.mocked(jsonRequest)
      .mockResolvedValueOnce(config)
      .mockRejectedValueOnce(
        new AppError("official app only", "HTTP_403", 403),
      );
    const result = await new SkillRatingProvider().query("测试#1", "HN1");
    expect(result.aramhex).toMatchObject({
      status: "needs-authorization",
      percentile: null,
      games: null,
    });
    expect(jsonRequest).toHaveBeenCalledTimes(2);
    for (const [, options] of vi.mocked(jsonRequest).mock.calls)
      expect(options?.headers).not.toHaveProperty("X-AramHex");
  });
});
