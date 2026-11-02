import { _electron as electron, expect } from "@playwright/test";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir("artifacts/screenshots", { recursive: true });
const application = await electron.launch({
  executablePath: resolve("node_modules/electron/dist/electron.exe"),
  args: [resolve("tests/fixtures/renderer-main.cjs"), "--companions"],
  env,
});
const report = {
  isolatedFixture: true,
  realClientWrites: false,
  checks: [],
  errors: [],
};
let picker, info;
try {
  await expect.poll(() => application.windows().length).toBe(2);
  picker = application
    .windows()
    .find((page) => page.url().endsWith("#champion-picker"));
  info = application
    .windows()
    .find((page) => page.url().endsWith("#champion-info"));
  for (const page of [picker, info]) {
    page.on("pageerror", (error) => report.errors.push(error.message));
    await page.locator(".companion-shell").waitFor();
  }
  await expect(picker.locator(".mini-status")).toContainText("等待匹配");
  await expect(picker.locator(".rating-line strong")).toHaveText("未记录");
  await expect(picker.locator(".quick-hero")).toHaveCount(0);
  await expect(picker.locator(".mini-swap")).toHaveCount(0);
  await expect(info.locator(".companion-empty")).toContainText("等待选择英雄");
  report.checks.push(
    "大厅阶段 Mini 窗只显示模式状态与自动接受，海斗分未接入，不出现换用",
  );
  await picker.getByRole("button", { name: "开始匹配", exact: true }).click();
  await expect(picker.locator(".mini-status")).toContainText("正在匹配对局");
  await expect(picker.locator(".mini-status")).toContainText("预计 01:35");
  await expect(picker.locator(".match-button.cancel")).toContainText("取消匹配");
  await picker.screenshot({
    path: "artifacts/screenshots/companion-matchmaking-fixture.png",
  });
  await picker.locator(".match-button.cancel").click();
  await expect(picker.locator(".mini-status")).toContainText("组队大厅");
  await expect
    .poll(() => picker.evaluate(() => window.rendererFixture.matchCalls()))
    .toEqual(["start", "cancel"]);
  await picker.getByRole("switch", { name: "自动匹配", exact: true }).click();
  await expect(
    picker.getByRole("switch", { name: "自动匹配", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await picker.getByRole("switch", { name: "自动匹配", exact: true }).click();
  report.checks.push("Mini 窗开始/取消匹配只在用户点击时调用，自动匹配开关可切换");
  await picker.getByRole("button", { name: "记录", exact: true }).click();
  await picker.getByLabel("官网查到的海斗分").fill("1580");
  await picker.getByLabel("官网查到的海斗分").press("Enter");
  await expect(picker.locator(".rating-line strong")).toHaveText("1,580");
  await expect(picker.locator(".rating-line small")).toContainText("手动记录");
  await picker.getByRole("button", { name: /查分/ }).click();
  await expect
    .poll(() => picker.evaluate(() => window.rendererFixture.toolCalls()))
    .toContain("open:hexdata-copy");
  report.checks.push("海斗分只显示手动记录并标注，查分复制 Riot ID 打开官方页");
  await picker.screenshot({
    path: "artifacts/screenshots/companion-lobby-fixture.png",
  });
  await picker.evaluate(() =>
    window.rendererFixture.state({ phase: "Matchmaking" }),
  );
  await expect(picker.locator(".mini-status")).toContainText("正在匹配对局");
  await picker.evaluate(() =>
    window.rendererFixture.state({ phase: "ReadyCheck" }),
  );
  await expect(picker.locator(".mini-status")).toContainText(
    "请在客户端接受对局",
  );
  await picker
    .getByRole("switch", { name: "自动接受对局", exact: true })
    .click();
  await expect(picker.locator(".mini-status")).toContainText("自动接受已开启");
  await expect(
    picker.getByRole("switch", { name: "自动接受对局", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  report.checks.push("匹配与确认阶段状态切换，Mini 窗开关可修改自动接受");
  await picker.evaluate(async () => {
    await window.rendererFixture.choices({
      championIds: [202, 22],
      kind: "subset",
      reason: "隔离测试英雄卡片",
      cards: [202, 22],
      waiting: [99],
    });
    await window.rendererFixture.selection({
      members: [
        {
          cellId: 0,
          puuid: "fixture-player",
          summonerId: 1,
          name: "测试账号#TEST",
          championId: 0,
          position: "",
        },
      ],
      bench: [],
      localCellId: 0,
      championId: null,
    });
    await window.rendererFixture.state({
      phase: "ChampSelect",
      championId: null,
    });
    await window.assistant.selectCompanionChampion(null);
  });
  await expect(picker.locator(".mini-current strong")).toHaveText(
    "尚未选择英雄",
  );
  await expect(picker.locator(".mini-choices-head span")).toHaveText("备选席");
  await expect(picker.locator(".quick-hero")).toHaveCount(3);
  await expect(picker.locator(".quick-hero.card")).toHaveCount(2);
  await expect(
    picker.getByRole("button", { name: "换用测试英雄三", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(picker.locator(".quick-hero.waiting")).toContainText("稍后可换");
  report.checks.push(
    "英雄卡片出现即与备选席合并显示，队友留下的英雄列出但标明稍后可换",
  );
  await expect(info.locator(".card-compare-row")).toHaveCount(2);
  await expect(info.locator(".card-compare-row").first()).toContainText(
    "测试强化丙",
  );
  report.checks.push("英雄推荐窗在拿到英雄前对比卡片英雄的海克斯推荐");
  await picker.screenshot({
    path: "artifacts/screenshots/companion-cards-fixture.png",
  });
  await info.screenshot({
    path: "artifacts/screenshots/companion-cards-info-fixture.png",
  });
  await picker
    .getByRole("button", { name: "换用测试英雄二", exact: true })
    .click({ button: "right" });
  await expect(info.locator(".companion-hero-heading h1")).toHaveText(
    "测试英雄二",
  );
  await expect
    .poll(() => picker.evaluate(() => window.rendererFixture.chooseCalls()))
    .toEqual([]);
  report.checks.push("右键头像只同步英雄推荐窗，不写入客户端");
  await picker
    .getByRole("button", { name: "换用测试英雄一", exact: true })
    .click();
  await expect
    .poll(() => picker.evaluate(() => window.rendererFixture.chooseCalls()))
    .toEqual([202]);
  await expect(picker.locator(".mini-current strong")).toHaveText("测试英雄一");
  await expect(
    picker.getByRole("button", { name: "换用测试英雄二", exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
  await expect(info.locator(".companion-hero-heading h1")).toHaveText(
    "测试英雄一",
  );
  await expect(
    info.getByRole("tab", { name: "海克斯", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(info.locator(".compact-augment")).toHaveCount(4);
  await expect(info.locator(".compact-augment .grade.S")).toHaveCount(1);
  await expect(
    info
      .locator(".compact-augment")
      .filter({ hasText: "低样本" })
      .locator(".grade"),
  ).toHaveText("—");
  report.checks.push(
    "点卡片头像一次即拿到英雄，英雄推荐窗默认显示带评级的海克斯推荐",
  );
  await expect(picker.locator(".mini-current .balance-chip")).toHaveText([
    "伤害 -5%",
    "承伤 +5%",
  ]);
  await expect(info.locator(".companion-hero-heading .balance-chip")).toHaveCount(2);
  await picker.locator(".stats-button").click();
  await expect
    .poll(() => picker.evaluate(() => window.rendererFixture.toolCalls()))
    .toContain("team-stats:send");
  await expect(picker.locator(".companion-success")).toContainText("已发送 1 名队友");
  report.checks.push("选人阶段显示大乱斗平衡调整，发战绩按钮只在点击时调用");
  await picker.locator(".berserk-button").click();
  await expect(picker.locator(".berserk-button")).toHaveText("狂暴中");
  await expect(picker.locator(".quick-hero").first()).toBeDisabled();
  await picker.screenshot({
    path: "artifacts/screenshots/companion-berserk-fixture.png",
  });
  await picker.locator(".berserk-button").click();
  await expect(picker.locator(".berserk-button")).toHaveText("狂暴");
  await expect
    .poll(() => picker.evaluate(() => window.rendererFixture.matchCalls()))
    .toEqual(["start", "cancel", "berserk:true", "berserk:false"]);
  report.checks.push("选人阶段狂暴按钮开关由主进程执行，进行中禁用手动点头像");
  await info.getByRole("button", { name: "aramgg", exact: true }).click();
  await expect(info.locator(".aramgg-augment")).toHaveCount(4);
  await expect(info.locator(".aramgg-augment").first()).toContainText(
    "测试强化丙",
  );
  await expect(info.locator(".info-source")).toContainText(
    "aramgg 隔离测试数据",
  );
  await info.getByRole("button", { name: "国服 AramHex", exact: true }).click();
  await expect(info.locator(".aramgg-augment")).toHaveCount(0);
  await expect(info.locator(".compact-augment .grade.S")).toHaveCount(1);
  report.checks.push("英雄推荐窗可切换 aramgg 与国服 AramHex");
  await picker
    .getByRole("button", { name: "换用测试英雄二", exact: true })
    .click();
  await expect
    .poll(() => picker.evaluate(() => window.rendererFixture.chooseCalls()))
    .toEqual([202, 22]);
  await expect(picker.locator(".mini-current strong")).toHaveText("测试英雄二");
  await picker.evaluate(() =>
    window.rendererFixture.choices({
      championIds: [202, 22],
      kind: "bench",
      reason: "隔离测试备选席",
    }),
  );
  await expect(
    picker.getByRole("button", { name: "换用测试英雄一", exact: true }),
  ).toBeVisible();
  await expect(
    picker.getByRole("button", { name: "换用测试英雄二", exact: true }),
  ).toHaveCount(0);
  await picker.waitForTimeout(300);
  expect(
    await picker.evaluate(() => window.rendererFixture.chooseCalls()),
  ).toEqual([202, 22]);
  report.checks.push("点击备选席头像一次即换用，当前英雄不可重复换用");
  await info.evaluate(() => window.rendererFixture.delayRecommendation(700));
  await picker
    .getByRole("button", { name: "换用测试英雄一", exact: true })
    .click({ button: "right" });
  await info.getByRole("button", { name: /回到当前英雄/ }).click();
  await info.getByRole("tab", { name: "符文", exact: true }).click();
  await expect(info.locator(".compact-rune")).toContainText("测试符文方案22");
  await info.waitForTimeout(800);
  await expect(info.locator(".compact-rune")).not.toContainText(
    "测试符文方案202",
  );
  report.checks.push("迟到的旧英雄推荐不能覆盖新英雄方案");
  await picker.evaluate(async () => {
    await window.rendererFixture.rating({
      status: "ready",
      score: 1234,
      percentile: 12.3,
      date: "2026-10-29",
      aramhex: {
        provider: "aramhex",
        status: "ready",
        percentile: 0.082,
        date: "2026-10-29",
        games: 42,
        message: "隔离测试位次",
        region: "FIXTURE",
      },
    });
    await window.rendererFixture.state({
      summoner: {
        puuid: "fixture-ready",
        summonerId: 2,
        gameName: "测试有分账号",
        tagLine: "TEST",
        level: 20,
        iconId: 0,
      },
    });
  });
  await expect(picker.locator(".rating-line strong")).toHaveText("1,234");
  await expect(picker.locator(".rating-line")).toContainText("前 8.2%");
  report.checks.push("提供方数字与 AramHex 区内位次分别展示且百分位单位正确");
  await picker.evaluate(async () => {
    await window.rendererFixture.rating({ status: "ready", score: 9999 });
    await window.rendererFixture.delayRating(700);
    await window.rendererFixture.state({
      summoner: {
        puuid: "fixture-stale",
        summonerId: 3,
        gameName: "测试旧账号",
        tagLine: "TEST",
        level: 20,
        iconId: 0,
      },
    });
  });
  await picker.waitForTimeout(60);
  await picker.evaluate(async () => {
    await window.rendererFixture.rating({
      status: "needs-authorization",
      score: null,
      percentile: null,
      date: null,
      aramhex: undefined,
      // 真实主进程按账号保存手动分数；新账号没有记录。
      manual: null,
    });
    await window.rendererFixture.state({
      summoner: {
        puuid: "fixture-new",
        summonerId: 4,
        gameName: "测试新账号",
        tagLine: "TEST",
        level: 20,
        iconId: 0,
      },
    });
  });
  await picker.waitForTimeout(850);
  await expect(picker.locator(".rating-line strong")).toHaveText("未记录");
  await expect(picker.locator(".rating-line")).not.toContainText("9,999");
  report.checks.push("账号切换清除评分，旧账号迟到结果不能恢复旧分数");
  await picker.screenshot({
    path: "artifacts/screenshots/companion-picker-fixture.png",
  });
  await info.screenshot({
    path: "artifacts/screenshots/companion-info-fixture.png",
  });
  await picker.evaluate(() =>
    window.rendererFixture.state({ phase: "Lobby", championId: null }),
  );
  await expect(picker.locator(".mini-status")).toContainText("等待匹配");
  await picker.screenshot({
    path: "artifacts/screenshots/companion-mini-lobby-fixture.png",
  });
  await picker.getByRole("button", { name: "收起弹窗", exact: true }).click();
  await info.getByRole("button", { name: "打开工作台", exact: true }).click();
  await expect
    .poll(() => picker.evaluate(() => window.rendererFixture.windowActions()))
    .toEqual(["hide", "main"]);
  report.checks.push("收起与打开工作台按钮跨桥接参数正确");
  expect(report.errors).toEqual([]);
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(
    JSON.stringify({
      errors: report.errors,
      picker: await picker
        ?.locator("body")
        .innerText()
        .catch(() => ""),
      info: await info
        ?.locator("body")
        .innerText()
        .catch(() => ""),
    }),
  );
  throw error;
} finally {
  await writeFile(
    "artifacts/companion-smoke.json",
    JSON.stringify(report, null, 2),
    "utf8",
  );
  await application.close();
}
