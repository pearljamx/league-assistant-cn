import https from "node:https";
import http from "node:http";
import { AppError } from "./errors";

export interface HttpOptions {
  headers?: Record<string, string>;
  method?: string;
  body?: unknown;
  timeout?: number;
  loopback?: boolean;
}
let publicFetcher: typeof fetch | null = null;
export function setPublicFetcher(fetcher: typeof fetch) {
  publicFetcher = fetcher;
}
export async function jsonRequest<T = any>(
  url: string,
  options: HttpOptions = {},
): Promise<T> {
  const bytes = await bytesRequest(url, options);
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch {
    throw new AppError("数据格式无法解析，请稍后刷新。", "INVALID_RESPONSE");
  }
}
export function bytesRequest(
  url: string,
  options: HttpOptions = {},
): Promise<Buffer> {
  const parsed = new URL(url);
  if (
    options.loopback &&
    (parsed.hostname !== "127.0.0.1" || parsed.protocol !== "https:")
  )
    throw new AppError("本机接口地址无效。", "INVALID_LOCAL_URL");
  if (!options.loopback && parsed.protocol !== "https:")
    throw new AppError("数据请求必须使用 HTTPS。", "INVALID_REMOTE_URL");
  const body =
    options.body === undefined ? undefined : JSON.stringify(options.body);
  // Electron's public transport uses the system proxy. Authenticated LCU/SGP calls stay direct.
  if (publicFetcher && !options.loopback && !options.headers?.Authorization)
    return (async () => {
      try {
        const response = await publicFetcher!(url, {
          method: options.method ?? "GET",
          headers: { Accept: "application/json", ...options.headers },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(options.timeout ?? 15000),
        });
        if (!response.ok)
          throw new AppError(
            `数据服务返回 ${response.status}。`,
            `HTTP_${response.status}`,
            response.status,
          );
        if (
          Number(response.headers.get("content-length") || 0) >
          32 * 1024 * 1024
        )
          throw new AppError("返回的数据超过限制。", "RESPONSE_TOO_LARGE");
        const data = Buffer.from(await response.arrayBuffer());
        if (data.length > 32 * 1024 * 1024)
          throw new AppError("返回的数据超过限制。", "RESPONSE_TOO_LARGE");
        return data;
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          "公开数据连接失败，请检查系统代理或稍后重试。",
          "NETWORK_ERROR",
        );
      }
    })();
  return new Promise((resolve, reject) => {
    const request = (parsed.protocol === "https:" ? https : http).request(
      parsed,
      {
        method: options.method ?? "GET",
        timeout: options.timeout ?? 9000,
        rejectUnauthorized: !options.loopback,
        headers: {
          Accept: "application/json",
          "User-Agent": "LeagueAssistantCN/0.1",
          ...(body
            ? {
                "Content-Type": "application/json",
                "Content-Length": String(Buffer.byteLength(body)),
              }
            : {}),
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > 32 * 1024 * 1024)
            request.destroy(
              new AppError("返回的数据超过限制。", "RESPONSE_TOO_LARGE"),
            );
          else chunks.push(chunk);
        });
        response.on("error", () =>
          reject(new AppError("连接中断，请稍后重试。", "NETWORK_ERROR")),
        );
        response.on("end", () => {
          const status = response.statusCode ?? 500;
          if (status < 200 || status >= 300)
            return reject(
              new AppError(
                status === 503
                  ? "战绩服务暂时不可用（503），请稍后重试。"
                  : status === 401
                    ? "连接凭证已过期，正在重新连接。"
                    : status === 404
                      ? "当前状态下暂无此项数据。"
                      : `服务返回 ${status}，请求未完成。`,
                `HTTP_${status}`,
                status,
              ),
            );
          resolve(Buffer.concat(chunks));
        });
      },
    );
    request.on("timeout", () =>
      request.destroy(
        new AppError("请求超时，请检查网络或稍后重试。", "TIMEOUT"),
      ),
    );
    request.on("error", (error) =>
      reject(
        error instanceof AppError
          ? error
          : new AppError("连接失败，请检查网络或客户端状态。", "NETWORK_ERROR"),
      ),
    );
    if (body) request.write(body);
    request.end();
  });
}
