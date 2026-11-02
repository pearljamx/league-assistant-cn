import type { WebContents } from "electron";
import type { HexdataManualScore } from "../../shared/types";
import { normalizeRatingRiotId } from "./rating";

/** 官网查分页向这个地址请求查询结果；助手只读取用户在官方窗口里自己发起的这类响应。 */
export const MATCH_REPORT_URL =
  "https://box.hexdata.com.cn/v1/public/match-report";

export interface HexdataCapture {
  riotId: string;
  region: string | null;
  score: HexdataManualScore;
}
const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() && value.length <= max
    ? value.trim()
    : null;

/**
 * 严格解析官网的查询结果（hexdata-public-match-report-v1）。只取被查询的游戏 ID、
 * 大区与预估海斗分；数据不足（collecting_data）、格式不符或分数异常都返回 null，不猜测。
 */
export function parseMatchReport(
  body: unknown,
  capturedAt = new Date(),
): HexdataCapture | null {
  const report = (body as any)?.report;
  if (!report || report.schemaVersion !== "hexdata-public-match-report-v1")
    return null;
  const estimate = report.targetEstimate;
  if (!estimate || estimate.status !== "ready") return null;
  const score = estimate.score;
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 10000)
    return null;
  const riotId = text(report.resolvedGameId, 160);
  if (!riotId || !/^[^#\r\n]+#[^#\r\n]+$/.test(normalizeRatingRiotId(riotId)))
    return null;
  const half = estimate.intervalHalfWidth;
  return {
    riotId: normalizeRatingRiotId(riotId),
    region: text(report.regionKey, 32)?.toUpperCase() ?? null,
    score: {
      score: Math.round(score),
      recordedAt: capturedAt.toISOString(),
      source: "official",
      interval:
        typeof half === "number" && Number.isFinite(half) && half >= 0 && half < 10000
          ? Math.round(half)
          : null,
      generatedAt: text(report.generatedAt, 40),
    },
  };
}
/** 游戏 ID 比较忽略大小写与空白差异。 */
export const sameRiotId = (a: string, b: string) =>
  normalizeRatingRiotId(a).toLowerCase() === normalizeRatingRiotId(b).toLowerCase();
/**
 * 只读监听官方页面收到的查分结果：不发起、不修改、不重放任何请求，
 * 不读取 Cookie 或登录令牌；只取 match-report 这一个响应的正文。
 */
export function watchHexdataReports(
  contents: WebContents,
  onReport: (body: unknown) => void,
) {
  const tool = contents.debugger;
  try {
    tool.attach("1.3");
  } catch {
    return;
  }
  const reports = new Set<string>();
  tool.on("message", (_event, method, params: any) => {
    if (method === "Network.responseReceived") {
      const url = String(params?.response?.url ?? "").split("?")[0];
      if (url === MATCH_REPORT_URL && params.response.status === 200)
        reports.add(params.requestId);
    } else if (
      method === "Network.loadingFinished" &&
      reports.delete(params?.requestId)
    ) {
      void tool
        .sendCommand("Network.getResponseBody", { requestId: params.requestId })
        .then((result: { body: string; base64Encoded: boolean }) => {
          if (result.body.length > 2_000_000) return;
          const text = result.base64Encoded
            ? Buffer.from(result.body, "base64").toString("utf8")
            : result.body;
          onReport(JSON.parse(text));
        })
        .catch(() => {});
    }
  });
  void tool.sendCommand("Network.enable").catch(() => {});
}
