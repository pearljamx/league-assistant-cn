import { _electron as electron } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const directory = resolve("artifacts/screenshots");
await mkdir(directory, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({
  executablePath:
    process.env.ASSISTANT_SMOKE_EXE ||
    resolve("node_modules/electron/dist/electron.exe"),
  args: process.env.ASSISTANT_SMOKE_EXE ? [] : [resolve(".")],
  cwd: resolve("."),
  env,
  timeout: 30000,
});
const report = { checks: [], errors: [] };
let originalFilters;
try {
  await application.firstWindow();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const page =
    application.windows().find((window) => !new URL(window.url()).hash) ??
    (await application.firstWindow());
  console.log(
    "desktop-windows",
    application.windows().map((window) => window.url()),
  );
  page.on("pageerror", (error) => report.errors.push(error.message));
  originalFilters = await page.evaluate(async () => {
    const { data } = await window.assistant.getSettings();
    return data
      ? {
          mode: data.mode,
          band: data.band,
          position: data.position,
          tier: data.tier,
        }
      : undefined;
  });
  await page.evaluate(() =>
    window.assistant.saveSettings({
      mode: "rift",
      band: "all",
      position: "BOTTOM",
      tier: 255,
    }),
  );
  await page.locator(".main-workspace").waitFor({ timeout: 30000 });
  const connection = await page.evaluate(async () => {
    const r = await window.assistant.getState();
    return {
      status: r.data?.status,
      region: r.data?.region,
      phase: r.data?.phase,
    };
  });
  report.checks.push({ name: "桌面启动", connection });
  const catalog = await page.evaluate(async () => {
    const r = await window.assistant.getCatalog();
    return {
      ok: r.ok,
      heroes: r.data?.champions.length,
      items: Object.keys(r.data?.items ?? {}).length,
      error: r.error,
    };
  });
  report.checks.push({ name: "英雄与装备资料", ...catalog });
  await page.screenshot({ path: directory + "/dashboard.png", fullPage: true });
  await page.getByRole("button", { name: "英雄数据", exact: true }).click();
  if (catalog.ok && catalog.heroes > 0) {
    await page
      .getByRole("textbox", { name: "搜索英雄", exact: true })
      .fill("Jhin");
    await page.locator(".hero-rank-row").first().click();
    await page.locator(".champion-heading").waitFor();
    await page.waitForFunction(
      () => !document.querySelector(".loading-state.tall"),
      { timeout: 40000 },
    );
    report.checks.push({
      name: "英雄推荐界面",
      equipmentRows: await page.locator(".equipment-option").count(),
      runeOptions: await page.locator(".rune-option").count(),
    });
    if (await page.locator(".rune-option button").count()) {
      await page.locator(".rune-option button").first().click();
      assert.equal(await page.locator(".rune-preview-grid > div").count(), 9);
      await page.screenshot({ path: directory + "/rune-preview.png" });
      await page.getByRole("button", { name: "关闭符文预览" }).click();
      report.checks.push({
        name: "九项符文预览",
        passed: true,
        realClientWrite: false,
      });
    }
    await page.evaluate(() =>
      document.querySelector(".page-body")?.scrollTo(0, 0),
    );
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: directory + "/recommendation.png",
      fullPage: false,
    });
  }
  const invalid = await page.evaluate(async () => {
    const result = await window.assistant.saveSettings({
      managedRunePage: { id: 1, puuid: "forged" },
    });
    return { ok: result.ok, code: result.code };
  });
  assert.equal(invalid.ok, false);
  report.checks.push({ name: "拒绝越界设置", ...invalid });
  await page.getByRole("button", { name: "海克斯大乱斗", exact: true }).click();
  await page.getByRole("tab", { name: "海克斯强化", exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector(".loading-state.tall"),
    { timeout: 60000 },
  );
  report.checks.push({
    name: "海克斯排行",
    rows: await page.locator(".augment-row").count(),
    error: await page.locator(".notice.warning").allTextContents(),
  });
  await page.screenshot({
    path: directory + "/hex-ranking.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("dialog", { name: "设置" }).waitFor();
  await page.screenshot({ path: directory + "/settings.png", fullPage: true });
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await writeFile(
    "artifacts/desktop-smoke.json",
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.errors.length, 0);
} catch (error) {
  for (const [index, page] of application.windows().entries()) {
    console.log(
      "desktop-failure",
      JSON.stringify({
        index,
        url: page.url(),
        title: await page.title().catch(() => ""),
        body: (
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        ).slice(0, 1500),
      }),
    );
    await page
      .screenshot({ path: directory + `/failure-${index}.png` })
      .catch(() => {});
  }
  console.log(JSON.stringify(report));
  throw error;
} finally {
  const main = application
    .windows()
    .find((window) => !new URL(window.url()).hash);
  if (main && originalFilters)
    await main
      .evaluate(
        (filters) => window.assistant.saveSettings(filters),
        originalFilters,
      )
      .catch(() => {});
  await application.close();
}
