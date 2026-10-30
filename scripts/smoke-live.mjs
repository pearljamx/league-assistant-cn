// 实时对局十人版面的隔离冒烟：全部为合成数据，不连接真实客户端，无任何写入。
import { _electron as electron, expect } from "@playwright/test";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
const env = { ...process.env, FIXTURE_LIVE_FULL: "1" };
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
/** 按卡片的 y 坐标分行，返回每行卡片数。 */
const rowsOf = (team) =>
  team.locator(".live-card").evaluateAll((cards) => {
    const rows = new Map();
    for (const card of cards) {
      const y = Math.round(card.getBoundingClientRect().top);
      rows.set(y, (rows.get(y) ?? 0) + 1);
    }
    return [...rows.values()];
  });
try {
  const page = await application.firstWindow();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.setViewportSize({ width: 1380, height: 900 });
  await page.locator(".main-workspace").waitFor();
  await page.locator(".brand-splash-art").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "实时对局", exact: true }).click();
  const teams = page.locator(".live-team");
  await expect(teams).toHaveCount(2);
  await expect(page.locator(".live-rank").first()).toContainText("黄金");
  await expect(page.locator(".live-match").first()).toBeVisible();

  const [first, second] = await Promise.all([
    teams.nth(0).boundingBox(),
    teams.nth(1).boundingBox(),
  ]);
  if (first.y + first.height > second.y)
    throw new Error("两队没有上下排列");
  expect(await rowsOf(teams.nth(0))).toEqual([5]);
  expect(await rowsOf(teams.nth(1))).toEqual([5]);
  report.checks.push("1380×900：两队上下排列，每队一行 5 张卡片");

  const widest = await page.locator(".page-body").evaluate((body) => ({
    scroll: body.scrollWidth,
    client: body.clientWidth,
  }));
  if (widest.scroll > widest.client) throw new Error("页面出现横向滚动");
  report.checks.push("页面没有横向滚动");

  const list = page.locator(".live-matches").first();
  const before = await list.evaluate((node) => {
    node.scrollTop = 200;
    return { top: node.scrollTop, height: node.clientHeight };
  });
  if (before.top <= 0 || before.height < 72)
    throw new Error("卡片内战绩无法滚动：" + JSON.stringify(before));
  report.checks.push("卡片内近期战绩可独立滚动");

  await expect(page.locator(".live-card[class*=premade-]")).toHaveCount(2);
  report.checks.push("预组队玩家显示彩色边框");
  await expect(
    page.getByRole("button", { name: "身份隐藏，无法查询", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("身份隐藏，不查询战绩")).toBeVisible();
  report.checks.push("隐藏身份不可点击，也不显示战绩");
  await page.screenshot({ path: "artifacts/screenshots/live-full-1380.png" });

  await page.setViewportSize({ width: 1040, height: 700 });
  const narrow = await rowsOf(teams.nth(0));
  if (Math.max(...narrow) >= 5) throw new Error("窄窗口未换行");
  // 预组队角标是有意裁切的伪元素，会计入 scrollWidth，这里只量实际子元素。
  const clipped = await page.locator(".live-card").evaluateAll((cards) =>
    cards.filter((card) => {
      const right = card.getBoundingClientRect().right;
      return [...card.children].some(
        (child) => child.getBoundingClientRect().right > right + 1,
      );
    }).length,
  );
  if (clipped) throw new Error(clipped + " 张卡片内容横向溢出");
  report.checks.push("1040×700：卡片自动换行，内容不横向溢出");
  await page.screenshot({ path: "artifacts/screenshots/live-full-1040.png" });
} catch (error) {
  report.errors.push(error.message);
  process.exitCode = 1;
} finally {
  await application.close();
}
console.log(JSON.stringify(report));
if (report.errors.length) process.exitCode = 1;
