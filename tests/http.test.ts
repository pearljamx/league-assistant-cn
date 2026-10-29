import { afterEach, expect, it } from "vitest";
import { jsonRequest, setPublicFetcher } from "../src/main/http";

afterEach(() => setPublicFetcher(null as unknown as typeof fetch));
it("成功的空响应（204）不是格式错误", async () => {
  setPublicFetcher((async () => new Response(null, { status: 204 })) as any);
  await expect(jsonRequest("https://example.invalid/empty")).resolves.toBe(
    undefined,
  );
});
it("非空但无法解析的响应仍明确报错", async () => {
  setPublicFetcher(
    (async () => new Response("<html>", { status: 200 })) as any,
  );
  await expect(
    jsonRequest("https://example.invalid/html"),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});
