import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const path = resolve("worker/dist/league-ocr/league-ocr.exe");
if (!existsSync(path)) {
  console.error("缺少完整 OCR 组件，请先运行 npm run ocr:build。");
  process.exit(1);
}
const check = spawnSync(path, ["--healthcheck"], {
  windowsHide: true,
  encoding: "utf8",
  timeout: 30000,
});
if (check.status !== 0 || !check.stdout.includes('"ocr_ready": true')) {
  console.error("OCR 组件健康检查未通过；请检查打包依赖，尚不可发布完整包。");
  process.exit(1);
}
console.log("OCR 模型与运行库健康检查通过");
