import { _electron as electron, expect } from "@playwright/test";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir("artifacts", { recursive: true });
const application = await electron.launch({
  executablePath: resolve("node_modules/electron/dist/electron.exe"),
  args: [resolve("tests/fixtures/renderer-main.cjs")],
  env,
});
const report = {
  isolatedFixture: true,
  realClientWrites: false,
  checks: [],
  errors: [],
};
let page;
try {
  page = await application.firstWindow();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.locator(".main-workspace").waitFor();
  await page.locator(".nav-item").filter({ hasText: "海克斯排行" }).click();
  await expect(page.locator(".augment-row")).toHaveCount(4);
  async function compare() {
    if (!(await page.locator(".manual-panel").isVisible()))
      await page
        .getByRole("button", { name: "手动比较三选一", exact: true })
        .click();
    for (let index = 0; index < 3; index++)
      await page
        .getByRole("combobox", { name: `第${index + 1}个强化`, exact: true })
        .selectOption(String(index + 1));
    await page.getByRole("button", { name: "比较", exact: true }).click();
    await expect(page.locator(".comparison-card")).toHaveCount(3);
  }
  await compare();
  await page.evaluate(() =>
    window.rendererFixture.recognition({ status: "idle" }),
  );
  await expect(page.locator(".comparison-card")).toHaveCount(3);
  await expect(page.locator(".recognition-status")).toContainText("手动比较");
  report.checks.push("手选在后台返回 idle 时保留");
  await page.evaluate(() =>
    window.rendererFixture.recognition({
      status: "recognized",
      augmentIds: [2, 3, 4],
      gameWindow: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  );
  await page.getByRole("button", { name: "显示识别结果", exact: true }).click();
  await expect(
    page.locator(".comparison-card h3").filter({ hasText: "测试强化丁" }),
  ).toHaveCount(1);
  await expect(
    page.locator(".comparison-card h3").filter({ hasText: "测试强化甲" }),
  ).toHaveCount(0);
  report.checks.push("可切回持续更新的识别结果");
  await compare();
  await page.evaluate(() => window.assistant.saveSettings({ band: "mid" }));
  await expect(
    page.locator(".recognition-status").filter({ hasText: "手动比较" }),
  ).toHaveCount(0);
  await expect(page.locator(".comparison-card")).toHaveCount(0);
  report.checks.push("分组改变清除旧手选");
  await compare();
  await page
    .getByRole("button", { name: "手动比较三选一", exact: true })
    .click();
  await page.evaluate(() => window.rendererFixture.delayManual(200));
  await page.getByRole("button", { name: "比较", exact: true }).click();
  await page.locator(".hero-picker > select").selectOption("22");
  await page.waitForTimeout(300);
  await expect(
    page.locator(".recognition-status").filter({ hasText: "手动比较" }),
  ).toHaveCount(0);
  await expect(page.locator(".comparison-card")).toHaveCount(0);
  report.checks.push("迟到手选响应不能覆盖新英雄");
  await page.evaluate(() => {
    window.rendererFixture.state({
      phase: "Lobby",
      championId: null,
      mode: "rift",
    });
    return window.assistant.saveSettings({ mode: "rift" });
  });
  await page.locator(".nav-item").filter({ hasText: "英雄推荐" }).click();
  await page.locator(".hero-picker > select").selectOption("202");
  await page.locator(".rune-option button").first().click();
  await expect(page.locator(".rune-preview-grid > div")).toHaveCount(9);
  await page.getByRole("button", { name: "确认应用符文", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "符文方案预览" })).toHaveCount(
    0,
  );
  const runeCalls = await page.evaluate(() =>
    window.rendererFixture.runeCalls(),
  );
  expect(runeCalls).toEqual([
    {
      championId: 202,
      query: { mode: "rift", band: "mid", tier: 255, position: "ALL" },
      index: 0,
      perks: [8005, 9111, 9104, 8014, 8139, 8140, 5008, 5008, 5011],
    },
  ]);
  report.checks.push("符文预览参数可跨桥接复制到模拟接口");
  expect(report.errors).toEqual([]);
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(
    JSON.stringify({
      fixtureFailureBody: await page
        ?.locator("body")
        .innerText()
        .catch(() => ""),
      errors: report.errors,
    }),
  );
  throw error;
} finally {
  await writeFile(
    "artifacts/renderer-smoke.json",
    JSON.stringify(report, null, 2),
    "utf8",
  );
  await application.close();
}
