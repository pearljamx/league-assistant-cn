// 隔离测试：游戏内卡片标注的位置与内容。只用合成数据和隔离预加载，不连接客户端、不访问网络。
// 本机若有 artifacts/reference/nyx-demo.png（不入库的公开参考截图），会垫在背景上额外截图。
import { _electron as electron, expect } from "@playwright/test";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
mkdirSync("artifacts/screenshots", { recursive: true });
const report = {
  isolatedFixture: true,
  realClientWrites: false,
  checks: [],
  errors: [],
};
const application = await electron.launch({
  executablePath: resolve("node_modules/electron/dist/electron.exe"),
  args: [resolve("tests/fixtures/renderer-main.cjs")],
  env,
});
// 与真实 1440p 截图检测出的卡片位置一致（比例）。
const slots = [
  { slot: 0, augmentId: 3, centerX: 0.3148, top: 0.1591, bottom: 0.6631, width: 0.1715, badgeY: 0.5522 },
  { slot: 1, augmentId: 1, centerX: 0.5, top: 0.1591, bottom: 0.6631, width: 0.1696, badgeY: 0.5522 },
  { slot: 2, augmentId: 2, centerX: 0.6852, top: 0.1591, bottom: 0.6631, width: 0.1715, badgeY: 0.5522 },
];
const reference = resolve("artifacts/reference/nyx-demo.png");
try {
  await application.firstWindow();
  const created = application.waitForEvent("window", {
    predicate: (page) => page.url().includes("#overlay"),
    timeout: 20000,
  });
  await application.evaluate(
    ({ BrowserWindow }, { preload, page }) => {
      const window = new BrowserWindow({
        width: 1280,
        height: 720,
        useContentSize: true,
        show: true,
        webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      void window.loadFile(page, { hash: "overlay" });
    },
    {
      preload: resolve("tests/fixtures/renderer-preload.cjs"),
      page: resolve("out/renderer/index.html"),
    },
  );
  const overlay = await created;
  overlay.on("pageerror", (error) => report.errors.push(error.message));
  await overlay.waitForLoadState();
  const show = (value) =>
    overlay.evaluate(
      ({ value, background }) => {
        if (background)
          document.body.style.setProperty(
            "background",
            `url(${background}) center / 100% 100% no-repeat`,
            "important",
          );
        window.rendererFixture.recognition({
          status: "recognized",
          message: "隔离测试",
          gameWindow: { x: 0, y: 0, width: 2560, height: 1440 },
          ...value,
        });
      },
      { value, background: existsSync(reference) ? pathToFileURL(reference).href : null },
    );
  const capture = async (name) => {
    if (!existsSync(reference)) return;
    const session = await overlay.context().newCDPSession(overlay);
    const { data } = await session.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`artifacts/screenshots/${name}.png`, Buffer.from(data, "base64"));
  };

  await show({ augmentIds: [3, 1, 2], slots });
  await expect(overlay.locator(".hex-badge")).toHaveCount(3);
  const viewport = await overlay.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  for (const [index, slot] of slots.entries()) {
    const box = await overlay.locator(".hex-badge").nth(index).boundingBox();
    const centerX = (box.x + box.width / 2) / viewport.width;
    const centerY = (box.y + box.height / 2) / viewport.height;
    if (Math.abs(centerX - slot.centerX) > 0.01 || Math.abs(centerY - slot.badgeY) > 0.01)
      throw new Error(`第 ${index + 1} 张卡的标注位置偏离：${centerX.toFixed(3)}, ${centerY.toFixed(3)}`);
    if (box.y / viewport.height < slot.top || (box.y + box.height) / viewport.height > slot.bottom)
      throw new Error(`第 ${index + 1} 张卡的标注超出卡片范围`);
  }
  report.checks.push("三张卡的评级徽章落在各自卡片下部，与识别位置偏差小于 1%");
  // 隔离数据（AramHex）：强化 3 > 2 > 1，强化 4 低样本不定级。
  await expect(overlay.locator(".hex-grade")).toHaveText(["S", "D", "B"]);
  await expect(overlay.locator(".hex-pick")).toHaveCount(1);
  await expect(overlay.locator(".hex-mark").first().locator(".hex-pick")).toHaveText("推荐");
  await expect(overlay.locator(".cover-caption")).toContainText("国服 AramHex 样本");
  report.checks.push("按当前英雄的国服样本给出 S–D 评级，唯一最佳标“推荐”，并标明数据来源");
  await capture("overlay-badges-aramhex");

  await overlay.evaluate(() => window.assistant.saveSettings({ hexSource: "aramgg" }));
  await show({
    augmentIds: [],
    status: "uncertain",
    slots: [slots[0], { ...slots[1], augmentId: null }, { ...slots[2], augmentId: 4 }],
  });
  await expect(overlay.locator(".hex-badge.unknown")).toContainText("未识别");
  await expect(overlay.locator(".hex-badge").nth(2)).toContainText("—");
  await expect(overlay.locator(".hex-badge").nth(2)).toContainText("国服第 3 位");
  await expect(overlay.locator(".cover-caption")).toContainText("aramgg 全球样本（不足 255 场留空）");
  report.checks.push("未识别的卡显示“未识别”；aramgg 样本不足的胜率留空，评级标明来自腾讯国服顺序");
  await capture("overlay-badges-aramgg");

  await overlay.evaluate(() => window.assistant.saveSettings({ hexSource: "aramhex" }));
  await show({ augmentIds: [1, 2, 3], slots: [] });
  await expect(overlay.locator(".hex-badge")).toHaveCount(0);
  await expect(overlay.locator(".overlay-shell .overlay-card")).toHaveCount(3);
  report.checks.push("没有卡片位置时（F6 整块识别兜底）仍显示原来的列表面板");
} catch (error) {
  report.errors.push(error.message);
} finally {
  await application.close();
}
console.log(JSON.stringify(report));
if (report.errors.length) process.exitCode = 1;
