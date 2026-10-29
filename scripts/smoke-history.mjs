import { _electron as electron, expect } from "@playwright/test";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir("artifacts/screenshots", { recursive: true });
const application = await electron.launch({
  executablePath: resolve("node_modules/electron/dist/electron.exe"),
  args: [resolve("tests/fixtures/renderer-main.cjs"), "--history"],
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
  await page.locator(".nav-item").filter({ hasText: "战绩查询" }).click();
  await expect(page.locator(".history-workspace")).toBeVisible();
  await expect(page.locator(".hw-match")).toHaveCount(1);
  await expect(page.locator(".hw-profile h2")).toHaveText("测试账号");
  await expect(page.locator(".hw-profile-ranks")).toContainText("黄金 II");
  report.checks.push("战绩卡片、玩家资料、段位与近期统计展示");
  await page
    .getByRole("button", { name: "查看玩家 测试队友#TEST", exact: true })
    .click();
  await expect(page.locator(".hw-profile h2")).toHaveText("测试队友");
  await expect(page.locator(".hw-list-heading h2")).toHaveText("测试队友#TEST");
  await page.getByRole("button", { name: "查看单局详情", exact: true }).click();
  await expect(page.locator(".hw-detail-player")).toHaveCount(3);
  await page
    .getByRole("button", { name: "查看详情玩家 测试对手#TEST", exact: true })
    .click();
  await expect(page.locator(".hw-profile h2")).toHaveText("测试对手");
  report.checks.push("历史战绩参与者及单局详情参与者可打开玩家资料");
  await page.getByRole("tab", { name: "实时对局", exact: true }).click();
  await expect(page.locator(".hw-live-team")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "身份隐藏，无法查询", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "查看实时玩家 测试队友#TEST", exact: true })
    .click();
  await expect(page.locator(".hw-profile h2")).toHaveText("测试队友");
  report.checks.push("实时双队展示，公开玩家可查询，隐藏身份禁用查询");
  await page.screenshot({
    path: "artifacts/screenshots/history-live-fixture.png",
  });
  await page.getByRole("tab", { name: "对局记录", exact: true }).click();
  await page.getByRole("button", { name: "返回我的战绩", exact: true }).click();
  await expect(page.locator(".hw-profile h2")).toHaveText("测试账号");
  await page
    .getByRole("textbox", { name: "查询玩家 Riot ID", exact: true })
    .fill("测试对手#TEST");
  await page
    .locator(".hw-search")
    .getByRole("button", { name: "查询", exact: true })
    .click();
  await expect(page.locator(".hw-profile h2")).toHaveText("测试对手");
  await expect(page.locator(".hw-profile-tag")).toContainText("Lv.88");
  report.checks.push("搜索同区 Riot ID 与返回本人战绩");
  await page.evaluate(() => window.rendererFixture.delayHistory(700));
  await page
    .getByRole("button", { name: "查看玩家 测试队友#TEST", exact: true })
    .click();
  await page.evaluate(() =>
    window.rendererFixture.state({
      summoner: {
        puuid: "fixture-next-account",
        summonerId: 8,
        gameName: "测试新账号",
        tagLine: "TEST",
        level: 42,
        iconId: 0,
      },
    }),
  );
  await expect(page.locator(".hw-profile h2")).toHaveText("测试新账号");
  await page.waitForTimeout(800);
  await expect(page.locator(".hw-list-heading h2")).toHaveText("我的近期对局");
  await expect(page.locator(".hw-match-players")).toContainText(
    "测试新账号#TEST",
  );
  await expect(page.locator(".hw-match-players")).not.toContainText(
    "测试账号#TEST",
  );
  report.checks.push("切号清除玩家详情及战绩，迟到响应不能覆盖新账号");
  await page.screenshot({
    path: "artifacts/screenshots/history-records-fixture.png",
  });
  expect(report.errors).toEqual([]);
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(
    JSON.stringify({
      errors: report.errors,
      body: await page
        ?.locator("body")
        .innerText()
        .catch(() => ""),
    }),
  );
  throw error;
} finally {
  await writeFile(
    "artifacts/history-smoke.json",
    JSON.stringify(report, null, 2),
    "utf8",
  );
  await application.close();
}
