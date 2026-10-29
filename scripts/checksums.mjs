import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const files = ["Portable", "Setup"].map(
  (kind) => `LeagueAssistantCN-${version}-x64-${kind}.exe`,
);
const lines = [];
for (const name of files) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream("dist/" + name))
    hash.update(chunk);
  lines.push(`${hash.digest("hex")}  ${name}`);
}
await writeFile("dist/SHA256SUMS", lines.join("\n") + "\n", "utf8");
console.log(`已生成 ${files.length} 个发布文件的 SHA-256 校验值`);
