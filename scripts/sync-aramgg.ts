// 用维护者的 aramgg Key 同步 PEARLJAM HEX 公共数据包。
// 用法：ARAMGG_API_KEY=... [ARAMGG_API_KEY_2=...] npx tsx scripts/sync-aramgg.ts --out <目录>
// 也可用 ARAMGG_API_KEYS 传逗号或换行分隔的多个 Key；按顺序使用，前一个额度用完再用下一个。
// Key 只从环境变量读取，不打印、不写入输出目录。
import { mkdir, readFile, rm, writeFile, appendFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { runSync } from "../src/main/providers/aramgg-snapshot";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const out = resolve(outIndex >= 0 ? args[outIndex + 1] : "aramgg-data");
const keys = [
  process.env.ARAMGG_API_KEY,
  process.env.ARAMGG_API_KEY_2,
  ...(process.env.ARAMGG_API_KEYS ?? "").split(/[\s,]+/),
]
  .map((value) => value?.trim())
  .filter((value): value is string => Boolean(value));
if (!keys.length) {
  console.error("缺少环境变量 ARAMGG_API_KEY，跳过同步。");
  process.exit(1);
}
const inside = (file: string) => {
  const path = resolve(out, file);
  if (!path.startsWith(out + sep)) throw new Error("拒绝写出目录外的文件");
  return path;
};
const result = await runSync({
  keys,
  fetch,
  dailyBudget: Number(process.env.ARAMGG_DAILY_BUDGET) || 200,
  reserve: Number(process.env.ARAMGG_RESERVE) || 6,
  read: async (file) => readFile(inside(file)).catch(() => null),
  write: async (file, bytes) => {
    const path = inside(file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  },
  remove: async (file) => rm(inside(file), { force: true }),
  log: (message) => console.log(message),
});
console.log(
  `数据版本 ${result.dataVersion}：本次同步 ${result.synced.length} 个英雄，待同步 ${result.pending} 个，` +
    `${result.keys} 个 Key 剩余额度 ${result.creditsRemaining ?? "未知"}，结束原因 ${result.stopped}`,
);
if (process.env.GITHUB_OUTPUT)
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `changed=${result.changed}\ndata_version=${result.dataVersion}\npending=${result.pending}\n`,
  );
if (result.stopped === "error") process.exitCode = 1;
