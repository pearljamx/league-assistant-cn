import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  resolve("dist/LeagueAssistantCN-0.1.0-x64-Portable.exe"),
  [`--remote-debugging-port=${port}`],
  { env, windowsHide: true, stdio: "ignore" },
);
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(ready, "Portable app did not expose its local test port");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => !page.url().includes("#overlay"));
  assert(page, "Portable main window missing");
  await page.locator(".main-workspace").waitFor();
  const status = await page.evaluate(async () => {
    const result = await window.assistant.getState();
    const displays = await window.assistant.getDisplays();
    return {
      ok: result.ok,
      status: result.data?.status,
      region: result.data?.region,
      ocrReady: displays.ok,
      displayCount: displays.data?.length,
    };
  });
  assert(status.ok);
  assert(status.ocrReady);
  console.log(JSON.stringify({ portableLaunch: "passed", ...status }));
  await page.close();
} finally {
  await browser?.close().catch(() => {});
  child.kill();
}
