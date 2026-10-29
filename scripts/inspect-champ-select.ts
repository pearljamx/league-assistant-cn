// 只读查看选人会话的结构，用于适配新模式。不发起任何写操作，不打印凭证、PUUID 或名字。
import { discover } from "../src/main/discovery";
import { jsonRequest } from "../src/main/http";

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /puuid|summonerId|gameName|tagLine|name|nickname|obfuscated|accountId|id$/i.test(
          key,
        ) && typeof item === "string"
          ? "<redacted>"
          : redact(item),
      ]),
    );
  return value;
};
const credentials = await discover();
if (!credentials) {
  console.log("未找到国服客户端");
  process.exit(0);
}
const get = (path: string) =>
  jsonRequest<any>(`https://127.0.0.1:${credentials.port}${path}`, {
    loopback: true,
    timeout: 6500,
    headers: {
      Authorization:
        "Basic " + Buffer.from("riot:" + credentials.token).toString("base64"),
    },
  }).catch((error) => ({ error: (error as Error).message }));
const phase = await get("/lol-gameflow/v1/gameflow-phase");
console.log("phase:", phase);
if (phase === "ChampSelect" || process.argv.includes("--force")) {
  const session = await get("/lol-champ-select/v1/session");
  const local = session.myTeam?.find(
    (member: any) => member.cellId === session.localPlayerCellId,
  );
  console.log(
    JSON.stringify(
      redact({
        keys: Object.keys(session ?? {}),
        benchEnabled: session.benchEnabled,
        benchChampions: session.benchChampions,
        actions: session.actions,
        localPlayerCellId: session.localPlayerCellId,
        local,
        timer: session.timer,
        rerollsRemaining: session.rerollsRemaining,
        extra: Object.fromEntries(
          Object.entries(session ?? {}).filter(
            ([key]) =>
              ![
                "myTeam",
                "theirTeam",
                "actions",
                "chatDetails",
                "bans",
              ].includes(key),
          ),
        ),
      }),
      null,
      1,
    ),
  );
  for (const path of [
    "/lol-champ-select/v1/pickable-champion-ids",
    "/lol-champ-select/v1/current-champion",
    "/lol-champ-select/v1/session/my-selection",
  ])
    console.log(path, JSON.stringify(await get(path)).slice(0, 600));
}
