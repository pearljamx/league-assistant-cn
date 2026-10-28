import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../src/main/storage";
import { Client } from "../src/main/client";
import { CatalogProvider } from "../src/main/providers/catalog";
import { TencentProvider } from "../src/main/providers/tencent";
import { HistoryProvider } from "../src/main/providers/history";
import { safeError } from "../src/main/errors";
const directory = await mkdtemp(join(tmpdir(), "league-assistant-live-"));
const storage = new Storage(directory);
await storage.initialize();
const client = new Client(storage);
try {
  await client.start();
  console.log(
    JSON.stringify({
      check: "国服只读连接",
      status: client.state.status,
      region: client.state.region,
      phase: client.state.phase,
      platform: client.state.platform,
      hasSummoner: Boolean(client.state.summoner),
      rankedQueues: client.state.ranked.length,
    }),
  );
  const catalog = new CatalogProvider(storage),
    tencent = new TencentProvider(storage, catalog);
  for (const mode of ["rift", "aram", "hex"] as const) {
    try {
      const value = await tencent.overview({
        mode,
        band: "all",
        tier: 255,
        position: "ALL",
      });
      console.log(
        JSON.stringify({
          check: "国服英雄统计",
          mode,
          heroes: value.heroes.length,
          date: value.source.date,
        }),
      );
    } catch (error) {
      console.log(
        JSON.stringify({ check: "国服英雄统计", mode, ...safeError(error) }),
      );
    }
  }
  if (client.state.summoner) {
    try {
      const own = client.state.summoner;
      const found = await client.findSummoner(
        own.gameName + (own.tagLine ? "#" + own.tagLine : ""),
      );
      console.log(
        JSON.stringify({
          check: "本人 Riot ID 查询（只读）",
          matched: found.puuid === own.puuid,
        }),
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          check: "本人 Riot ID 查询（只读）",
          ...safeError(error),
        }),
      );
    }
    const history = new HistoryProvider(client, storage);
    try {
      const page = await history.history(client.state.summoner.puuid, 0);
      console.log(
        JSON.stringify({
          check: "本人战绩（只读）",
          source: page.source,
          games: page.matches.length,
          warning: page.warning,
        }),
      );
      if (page.source === "sgp" && page.hasMore) {
        const next = await history.history(
          client.state.summoner.puuid,
          page.nextIndex,
        );
        const firstIds = new Set(page.matches.map((match) => match.id));
        const match = page.matches[0]
          ? await history.match(page.matches[0].id)
          : null;
        console.log(
          JSON.stringify({
            check: "战绩翻页与单局（只读）",
            nextGames: next.matches.length,
            pageOffset: page.nextIndex,
            pagesDistinct: next.matches.every(
              (match) => !firstIds.has(match.id),
            ),
            detailPlayers: match?.players.length ?? 0,
          }),
        );
      }
    } catch (error) {
      console.log(
        JSON.stringify({ check: "本人战绩（只读）", ...safeError(error) }),
      );
    }
  }
} finally {
  client.stop();
  if (!directory.startsWith(join(tmpdir(), "league-assistant-live-")))
    throw new Error("Temporary cleanup path rejected");
  await rm(directory, { recursive: true, force: true });
}
