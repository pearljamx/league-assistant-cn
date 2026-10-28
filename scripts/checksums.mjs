import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
const files = (await readdir("dist"))
  .filter((name) => /\.(exe|zip)$/.test(name))
  .sort();
const lines = [];
for (const name of files) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream("dist/" + name))
    hash.update(chunk);
  lines.push(`${hash.digest("hex")}  ${name}`);
}
await writeFile("dist/SHA256SUMS", lines.join("\n") + "\n", "utf8");
console.log(`已生成 ${files.length} 个发布文件的 SHA-256 校验值`);
