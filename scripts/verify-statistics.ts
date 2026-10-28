import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../src/main/storage";
import { CatalogProvider } from "../src/main/providers/catalog";
import { TencentProvider } from "../src/main/providers/tencent";
import { AramHexProvider } from "../src/main/providers/aramhex";
import { safeError } from "../src/main/errors";
import { configureDevelopmentProxy } from "./network.mjs";
import { setPublicFetcher } from "../src/main/http";
configureDevelopmentProxy();
setPublicFetcher(fetch);
const directory = await mkdtemp(join(tmpdir(), "league-statistics-"));
try {
  const storage = new Storage(directory);
  await storage.initialize();
  const catalog = new CatalogProvider(storage),
    tencent = new TencentProvider(storage, catalog),
    aramhex = new AramHexProvider(storage);
  const result = await catalog.get();
  console.log(
    JSON.stringify({
      check: "静态目录",
      heroes: result.champions.length,
      items: Object.keys(result.items).length,
      runeTrees: catalog.styles.length,
    }),
  );
  for (const mode of ["rift", "hex"] as const) {
    try {
      const rec = await tencent.recommendation(202, {
        mode,
        band: "all",
        tier: 255,
        position: "BOTTOM",
      });
      console.log(
        JSON.stringify({
          check: "国服推荐",
          mode,
          starting: rec.starting.length,
          core: rec.core.length,
          runes: rec.runes.length,
          skillOrders: rec.skills.length,
          date: rec.source.date,
        }),
      );
    } catch (error) {
      console.log(
        JSON.stringify({ check: "国服推荐", mode, ...safeError(error) }),
      );
    }
  }
  try {
    const overview = await aramhex.overview("all");
    const ranks = await aramhex.augments(202, "all");
    if (process.argv.includes("--write-ocr-dictionary")) {
      await mkdir("artifacts", { recursive: true });
      await writeFile(
        "artifacts/augment-dictionary.json",
        JSON.stringify(ranks.catalog),
        "utf8",
      );
    }
    console.log(
      JSON.stringify({
        check: "海克斯校验数据",
        heroes: overview.heroes.length,
        groups: overview.bands.map((item) => item.name),
        augmentRows: ranks.augments.length,
        date: overview.source.date,
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({ check: "海克斯校验数据", ...safeError(error) }),
    );
  }
} finally {
  if (!directory.startsWith(join(tmpdir(), "league-statistics-")))
    throw new Error("Temporary cleanup path rejected");
  await rm(directory, { recursive: true, force: true });
}
