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
  await expect(picker.locator(".quick-hero")).toHaveCount(3);
  for (const page of [picker, info]) {
    await expect(page.locator(".phase-banner")).toContainText("等待匹配");
    await expect(page.locator(".rating-card")).toContainText("数值分待接入");
    await expect(page.locator(".rating-heading strong")).toHaveText("—");
  }
  await expect(
    picker.getByRole("button", { name: "换用测试英雄二", exact: true }),
  ).toBeDisabled();
  report.checks.push("两个独立弹窗显示大厅状态及未接入海斗分，非选人禁用换用");
  await picker
    .getByRole("button", { name: "查看测试英雄一", exact: true })
    .click();
  await expect(info.locator(".companion-hero-heading h1")).toHaveText(
    "测试英雄一",
  );
  report.checks.push("快速选择通过真实桥接广播同步英雄信息窗");
  await picker.evaluate(() =>
    window.rendererFixture.state({ phase: "Matchmaking" }),
  );
  for (const page of [picker, info])
    await expect(page.locator(".phase-banner")).toContainText("正在匹配对局");
  await picker.evaluate(() =>
    window.rendererFixture.state({ phase: "ReadyCheck" }),
  );
  await expect(info.locator(".phase-banner")).toContainText(
    "请在客户端接受对局",
  );
  await picker.evaluate(() =>
    window.assistant.saveSettings({ autoAccept: true }),
  );
  await expect(info.locator(".phase-banner")).toContainText("自动接受已开启");
  report.checks.push("匹配与确认阶段跨窗同步，自动接受提示跟随设置");
  await picker.evaluate(async () => {
    await window.rendererFixture.selection({
      members: [
        {
          cellId: 0,
          puuid: "fixture-player",
          summonerId: 1,
          name: "测试账号#TEST",
          championId: 202,
          position: "",
        },
      ],
      bench: [22, 99],
      localCellId: 0,
      championId: 202,
    });
    await window.rendererFixture.state({
      phase: "ChampSelect",
      championId: 202,
    });
    await window.assistant.selectCompanionChampion(null);
  });
  await expect(
    picker.getByRole("button", { name: "换用测试英雄一", exact: true }),
  ).toBeDisabled();
  await expect(
    picker.getByRole("button", { name: "换用测试英雄二", exact: true }),
  ).toBeEnabled();
  await picker
    .getByRole("button", { name: "换用测试英雄二", exact: true })
    .click();
  await expect(info.locator(".companion-hero-heading h1")).toHaveText(
    "测试英雄二",
  );
  await expect
    .poll(() => picker.evaluate(() => window.rendererFixture.chooseCalls()))
    .toEqual([22]);
  await expect(
    picker.getByRole("button", { name: "换用测试英雄二", exact: true }),
  ).toBeDisabled();
  report.checks.push("手动换用仅调用一次模拟接口，当前英雄不可重复换用");
  await picker.getByRole("button", { name: "全部浏览", exact: true }).click();
  await info.evaluate(() => window.rendererFixture.delayRecommendation(700));
  await picker
    .getByRole("button", { name: "查看测试英雄一", exact: true })
    .click();
  await picker
    .getByRole("button", { name: "查看测试英雄二", exact: true })
    .click();
  await info.getByRole("button", { name: "符文", exact: true }).click();
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
  for (const page of [picker, info]) {
    await expect(page.locator(".rating-heading strong")).toHaveText("1,234");
    await expect(page.locator(".rating-card")).toContainText("前 8.2%");
  }
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
  await info.waitForTimeout(850);
  for (const page of [picker, info]) {
    await expect(page.locator(".rating-heading strong")).toHaveText("—");
    await expect(page.locator(".rating-card")).not.toContainText("9,999");
  }
  report.checks.push("账号切换清除评分，旧账号迟到结果不能恢复旧分数");
  await picker.getByRole("button", { name: "收起弹窗", exact: true }).click();
  await info.getByRole("button", { name: "打开工作台", exact: true }).click();
  await expect
    .poll(() => picker.evaluate(() => window.rendererFixture.windowActions()))
    .toEqual(["hide", "main"]);
  report.checks.push("收起与打开工作台按钮跨桥接参数正确");
  await picker.screenshot({
    path: "artifacts/screenshots/companion-picker-fixture.png",
  });
  await info.screenshot({
    path: "artifacts/screenshots/companion-info-fixture.png",
  });
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
