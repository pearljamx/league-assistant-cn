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
  // Hosted Windows screens can clamp native window sizes; use an explicit layout viewport.
  await page.setViewportSize({ width: 1440, height: 1000 });
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.locator(".main-workspace").waitFor();
  // 多个玩家标签同时存在（隐藏的用 display:none），断言只针对前台标签。
  const tab = () => page.locator(".player-tab.active");
  const tabs = page.locator(".title-tabs [role=tab]");
  await page.getByRole("button", { name: "战绩查询", exact: true }).click();
  await expect(tab()).toBeVisible();
  await expect(tab().locator(".hw-match")).toHaveCount(1);
  await expect(tab().locator(".hw-match")).toContainText("海克斯大乱斗");
  await expect(tab().locator(".hw-match")).not.toContainText("3270");
  await expect(tab().locator(".hw-profile h2")).toHaveText("测试账号");
  await expect(tab().locator(".hw-profile-ranks")).toContainText("黄金 II");
  await expect(tabs).toHaveCount(1);
  report.checks.push("战绩卡片、玩家资料、段位与近期统计展示");
  await tab().getByRole("button", { name: "极地大乱斗", exact: true }).click();
  await expect(tab().locator(".hw-match")).toHaveCount(0);
  await expect(tab().locator(".hw-filter-summary")).toContainText(
    "筛选后 0 场",
  );
  await tab().getByRole("button", { name: "海克斯", exact: true }).click();
  await tab().getByRole("button", { name: "胜", exact: true }).click();
  await expect(tab().locator(".hw-match")).toHaveCount(1);
  await expect(tab().locator(".hw-filter-summary")).toContainText(
    "筛选后 1 场有效 · 胜率 100%",
  );
  await tab().getByRole("button", { name: "负", exact: true }).click();
  await expect(tab().locator(".hw-match")).toHaveCount(0);
  await tab().getByRole("button", { name: "清除筛选", exact: true }).click();
  await expect(tab().locator(".hw-match")).toHaveCount(1);
  report.checks.push("战绩按模式与胜负筛选，并显示筛选后的胜率与场次");
  await tab()
    .getByRole("button", { name: "查看玩家 测试队友#TEST", exact: true })
    .click();
  await expect(tab().locator(".hw-profile h2")).toHaveText("测试队友");
  await expect(tab().locator(".hw-list-heading h2")).toHaveText(
    "测试队友#TEST",
  );
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveText("测试队友");
  await expect(tab().locator(".hw-encounters")).toContainText(
    "同局 1 场 · 队友 1 场",
  );
  report.checks.push("打开玩家新建标签，显示与本人同局的遇到记录");
  await tab().getByRole("button", { name: "好队友", exact: true }).click();
  await tab()
    .getByRole("textbox", { name: "玩家备注", exact: true })
    .fill("沟通友好");
  await tab().getByRole("button", { name: "保存标记", exact: true }).click();
  await expect(tab().locator(".hw-player-tag")).toHaveText("好队友");
  report.checks.push("玩家标签与备注可保存并显示");
  await tab()
    .getByRole("button", { name: "查看单局详情", exact: true })
    .click();
  await expect(tab().locator(".hw-detail-player")).toHaveCount(3);
  await expect(tab().locator(".mc-table")).toHaveCount(2);
  await expect(tab().locator(".mc-table").first()).toContainText("胜利");
  await expect(tab().locator(".mc-table").first()).toContainText(
    "测试队友#TEST",
  );
  await expect(tab().locator(".mc-table").last()).toContainText("失败");
  await expect(tab().locator(".mc-table").last()).toContainText(
    "测试对手#TEST",
  );
  report.checks.push(
    "单局详情按队伍分表，显示每名玩家的 KDA、伤害、经济与补刀",
  );
  await tab()
    .getByRole("button", { name: "查看详情玩家 测试对手#TEST", exact: true })
    .click();
  await expect(tab().locator(".hw-profile h2")).toHaveText("测试对手");
  await expect(tabs).toHaveCount(3);
  await page.setViewportSize({ width: 1100, height: 850 });
  // 参考 Akari：窄窗口也始终显示双方 10 人，不再隐藏参与者列。
  await expect(tab().locator(".hw-match-players")).toBeVisible();
  await tab()
    .getByRole("button", { name: "查看单局详情", exact: true })
    .click();
  await expect(tab().locator(".hw-detail-player")).toHaveCount(3);
  await tab()
    .getByRole("button", { name: "查看详情玩家 测试队友#TEST", exact: true })
    .click();
  await expect(tab().locator(".hw-profile h2")).toHaveText("测试队友");
  await expect(tabs).toHaveCount(3);
  await expect(tab().locator(".hw-player-tag")).toHaveText("好队友");
  await page.setViewportSize({ width: 1440, height: 1000 });
  report.checks.push("窄窗口仍显示双方玩家，并可从单局详情查询玩家");
  report.checks.push("重复打开同一玩家复用已有标签并保留其状态");
  await page.getByRole("button", { name: "实时对局", exact: true }).click();
  await expect(page.locator(".live-team")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "身份隐藏，无法查询", exact: true }),
  ).toBeDisabled();
  const mate = page.getByRole("button", {
    name: "查看实时玩家 测试队友#TEST",
    exact: true,
  });
  const liveCard = (button) =>
    page.locator(".live-card").filter({ has: button });
  await expect(liveCard(mate).locator(".live-tag.met")).toHaveText(
    "遇到过 1 次",
  );
  await expect(liveCard(mate).locator(".live-tag.good")).toHaveText("好队友");
  await expect(liveCard(mate).locator(".live-rank")).toHaveText(
    "单双 黄金 II 35 点",
  );
  await expect(liveCard(mate).locator(".live-match").first()).toBeVisible();
  await expect(
    liveCard(
      page.getByRole("button", { name: /查看实时玩家 测试账号/ }),
    ).locator(".live-tag.met"),
  ).toHaveCount(0);
  report.checks.push("实时玩家卡片显示段位与可滚动近期战绩");
  report.checks.push("实时玩家卡片显示遇到过次数与本机标记，本人不显示遇到过");
  await mate.click();
  await expect(tab().locator(".hw-profile h2")).toHaveText("测试队友");
  await expect(tabs).toHaveCount(3);
  report.checks.push("实时双队展示，公开玩家可查询，隐藏身份禁用查询");
  await page.getByRole("button", { name: "实时对局", exact: true }).click();
  await page.screenshot({
    path: "artifacts/screenshots/history-live-fixture.png",
  });
  await page.getByRole("button", { name: "战绩查询", exact: true }).click();
  await page.screenshot({
    path: "artifacts/screenshots/history-tabs-fixture.png",
  });
  await tab()
    .getByRole("button", { name: "返回我的战绩", exact: true })
    .click();
  await expect(tab().locator(".hw-profile h2")).toHaveText("测试账号");
  await page.getByRole("button", { name: "搜索召唤师", exact: true }).click();
  await page
    .getByRole("textbox", { name: "查询玩家 Riot ID", exact: true })
    .fill("测试对手#TEST");
  await page
    .locator(".search-pane")
    .getByRole("button", { name: "查询", exact: true })
    .click();
  await expect(page.locator(".search-pane")).toHaveCount(0);
  await expect(tab().locator(".hw-profile h2")).toHaveText("测试对手");
  await expect(tab().locator(".hw-profile-tag")).toContainText("Lv.88");
  await expect(tabs).toHaveCount(3);
  report.checks.push("搜索同区 Riot ID 与返回本人战绩");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "玩家标记", exact: true }).click();
  await expect(page.locator(".settings-modal")).toContainText("测试队友#TEST");
  await expect(page.locator(".settings-modal")).toContainText("沟通友好");
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  report.checks.push("设置中列出已标记的玩家");
  await page
    .getByRole("button", { name: "关闭标签 测试队友#TEST", exact: true })
    .click();
  await expect(tabs).toHaveCount(2);
  await expect(tab().locator(".hw-profile h2")).toHaveText("测试对手");
  report.checks.push("关闭后台标签不影响当前标签");
  await page.evaluate(() => window.rendererFixture.delayHistory(700));
  await tab()
    .getByRole("button", { name: "查看玩家 测试队友#TEST", exact: true })
    .click();
  await expect(tabs).toHaveCount(3);
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
  await expect(tabs).toHaveCount(1);
  await expect(tab().locator(".hw-profile h2")).toHaveText("测试新账号");
  await page.waitForTimeout(800);
  await expect(tab().locator(".hw-list-heading h2")).toHaveText("我的近期对局");
  await expect(
    tab().getByRole("button", {
      name: "查看玩家 测试新账号#TEST",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    tab().getByRole("button", { name: "查看玩家 测试账号#TEST", exact: true }),
  ).toHaveCount(0);
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
