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
  await page.getByRole("button", { name: "英雄数据", exact: true }).click();
  await page.getByRole("tab", { name: "海克斯强化", exact: true }).click();
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
  await page
    .getByRole("button", { name: "选择英雄 测试英雄二", exact: true })
    .click();
  await page.waitForTimeout(300);
  await expect(
    page.locator(".recognition-status").filter({ hasText: "手动比较" }),
  ).toHaveCount(0);
  await expect(page.locator(".comparison-card")).toHaveCount(0);
  report.checks.push("迟到手选响应不能覆盖新英雄");
  await page
    .getByRole("button", { name: "选择英雄 测试英雄一", exact: true })
    .click();
  await page
    .getByRole("button", { name: "aramgg（默认）", exact: true })
    .click();
  const aramggRows = page.locator(".aramgg-row");
  await expect(aramggRows).toHaveCount(4);
  await expect(aramggRows.first()).toContainText("测试强化丙");
  await expect(aramggRows.first().locator(".tier-badge")).toHaveText("T1");
  await expect(aramggRows.filter({ hasText: "测试强化丁" })).toContainText(
    "不足 255",
  );
  await page.evaluate(() =>
    window.rendererFixture.recognition({
      status: "recognized",
      augmentIds: [2, 3, 4],
      gameWindow: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  );
  await expect(page.locator(".aramgg-cards .comparison-card")).toHaveCount(3);
  await expect(
    page.locator(".aramgg-cards .comparison-card").first(),
  ).toContainText("测试强化丙");
  await expect(page.locator(".aramgg-source")).toContainText(
    "aramgg 隔离测试数据",
  );
  await expect(page.locator(".aramgg-outdated")).toContainText(
    "旧版本 fixture.1 数据（最新 fixture.2",
  );
  await page
    .getByRole("button", { name: "国服 AramHex 样本", exact: true })
    .click();
  await expect(aramggRows).toHaveCount(0);
  await expect(page.locator(".augment-row")).toHaveCount(4);
  await expect(page.locator(".comparison-card")).toHaveCount(3);
  report.checks.push(
    "aramgg 按国服推荐顺序排序，样本不足不显示胜率，标明旧版本数据；切换来源保留识别结果",
  );
  await page.evaluate(() => {
    window.rendererFixture.state({
      phase: "Lobby",
      championId: null,
      mode: "rift",
    });
    return window.assistant.saveSettings({ mode: "rift" });
  });
  await page.getByRole("button", { name: "英雄数据", exact: true }).click();
  await page
    .getByRole("button", { name: "选择英雄 测试英雄一", exact: true })
    .click();
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
  await page.getByRole("button", { name: "自动化", exact: true }).click();
  for (const name of [
    "自动选择英雄",
    "自动禁用英雄",
    "大乱斗自动抢备选席",
    "自动锁定",
  ])
    await expect(
      page.getByRole("switch", { name, exact: true }),
    ).toHaveAttribute("aria-checked", "false");
  await page.getByRole("switch", { name: "自动选择英雄", exact: true }).click();
  await page
    .getByRole("textbox", { name: "自动选择英雄列表", exact: true })
    .fill("测试英雄一");
  await page
    .getByRole("button", { name: "添加 测试英雄一", exact: true })
    .click();
  await expect(page.locator(".champion-list-editor").first()).toContainText(
    "1. 测试英雄一",
  );
  const autoSelect = await page.evaluate(
    async () => (await window.assistant.getSettings()).data.autoSelect,
  );
  expect(autoSelect).toMatchObject({
    pick: true,
    pickChampions: [202],
    ban: false,
    lock: false,
    bench: false,
  });
  report.checks.push("自动选人与禁用默认全关，开启并添加英雄后按优先级保存");
  await page.getByRole("button", { name: "工具集", exact: true }).click();
  await expect(page.locator(".friend-list li")).toHaveCount(2);
  await expect(page.locator(".friend-list li").first()).toContainText("游戏中");
  await expect(
    page.getByRole("button", { name: "观战 离线好友#TEST", exact: true }),
  ).toHaveCount(0);
  // 大厅阶段不能重随，按钮保持禁用。
  await expect(page.getByRole("button", { name: /重随英雄/ })).toBeDisabled();
  await page
    .getByRole("button", { name: "观战 测试好友#TEST", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "个性签名", exact: true })
    .fill("新签名");
  await page.getByRole("button", { name: "保存签名", exact: true }).click();
  await page
    .getByRole("combobox", { name: "在线状态", exact: true })
    .selectOption("away");
  await expect
    .poll(() => page.evaluate(() => window.rendererFixture.toolCalls()))
    .toEqual([
      "spectate:fixture-friend",
      'chat:{"statusMessage":"新签名"}',
      'chat:{"availability":"away"}',
    ]);
  report.checks.push(
    "工具集只在点击时观战与修改签名/状态，离线好友无观战入口，大厅不能重随",
  );
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
