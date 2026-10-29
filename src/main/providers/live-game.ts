import type { Client } from "../client";
import { jsonRequest } from "../http";
import { AppError } from "../errors";
import type { LiveGame, LivePlayer } from "../../shared/types";

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
const publicPuuid = (value: unknown): string | null =>
  typeof value === "string" &&
  /^[\w-]{1,128}$/.test(value) &&
  !/^0+$/.test(value.replace(/-/g, ""))
    ? value
    : null;
function riotId(player: any): string | null {
  const name = player?.riotIdGameName || player?.gameName;
  const tag = player?.riotIdTagLine || player?.tagLine;
  if (typeof name === "string" && name && typeof tag === "string" && tag)
    return `${name}#${tag}`;
  for (const value of [player?.riotId, player?.summonerName]) {
    if (typeof value === "string" && /^[^#]+#[^#]+$/.test(value)) return value;
  }
  return null;
}
function fromSelection(raw: any, selfPuuid: string | undefined): LivePlayer[] {
  const result: LivePlayer[] = [];
  for (const [teamId, players] of [
    [100, raw.myTeam],
    [200, raw.theirTeam],
  ] as const) {
    for (const player of Array.isArray(players) ? players : []) {
      const puuid = publicPuuid(player.puuid),
        id = riotId(player);
      result.push({
        key: `selection:${teamId}:${player.cellId}`,
        puuid,
        riotId: id,
        championId: Number(player.championId || player.championPickIntent) || 0,
        teamId,
        kills: null,
        deaths: null,
        assists: null,
        level: null,
        items: [],
        isSelf:
          Boolean(puuid && puuid === selfPuuid) ||
          (teamId === 100 && player.cellId === raw.localPlayerCellId),
        identityHidden: !puuid && !id,
      });
    }
  }
  return result;
}
function championId(player: any, champions: any[]): number {
  if (Number.isInteger(player.championId) && player.championId > 0)
    return player.championId;
  const alias = String(player.rawChampionName ?? "").replace(
    /^game_character_displayname_/,
    "",
  );
  return (
    champions.find(
      (champion: any) =>
        champion.id > 0 &&
        ((alias && champion.alias === alias) ||
          (player.championName &&
            [champion.alias, champion.name, champion.description].includes(
              player.championName,
            ))),
    )?.id ?? 0
  );
}
export class LiveGameProvider {
  private revision = 0;
  private context = "";
  private cache: { at: number; signature: string; value: LiveGame } | null =
    null;
  constructor(private client: Client) {
    this.context = this.signature();
    client.on("state", () => {
      const context = this.signature();
      if (context !== this.context) {
        this.context = context;
        this.revision++;
        this.cache = null;
      }
    });
  }
  private signature() {
    const state = this.client.state;
    const selection =
      state.phase === "ChampSelect"
        ? JSON.stringify(this.client.selection)
        : "";
    return `${state.status}:${state.region}:${state.platform}:${state.summoner?.puuid}:${state.phase}:${state.mode}:${state.championId}:${selection}`;
  }
  async get(): Promise<LiveGame> {
    const signature = this.signature(),
      revision = this.revision;
    const current = () => {
      if (signature !== this.signature() || revision !== this.revision)
        throw new AppError(
          "账号或对局阶段已变化，请重新读取。",
          "STALE_LIVE_GAME",
        );
    };
    const state = this.client.state;
    const base: LiveGame = {
      status: "idle",
      mode: state.mode,
      phase: state.phase,
      gameTime: null,
      players: [],
      message: "进入选人或对局后显示实时信息",
      updatedAt: new Date().toISOString(),
    };
    if (state.status !== "connected" || state.region !== "TENCENT")
      return { ...base, message: "请启动并登录国服客户端" };
    if (
      !["ChampSelect", "GameStart", "InProgress", "Reconnect"].includes(
        state.phase,
      )
    )
      return base;
    if (
      this.cache &&
      Date.now() - this.cache.at < 2000 &&
      this.cache.signature === signature
    )
      return structuredClone(this.cache.value);
    let value: LiveGame;
    try {
      if (state.phase === "ChampSelect") {
        const session = await this.client.request(
          "/lol-champ-select/v1/session",
        );
        current();
        value = {
          ...base,
          status: "selection",
          players: fromSelection(session, state.summoner?.puuid),
          message: "选人中 · 仅显示客户端公开身份",
        };
      } else {
        const [live, session, champions] = await Promise.all([
          jsonRequest<any>(
            "https://127.0.0.1:2999/liveclientdata/allgamedata",
            { loopback: true, timeout: 2200 },
          ),
          this.client.request("/lol-gameflow/v1/session").catch(() => null),
          this.client
            .request<any[]>("/lol-game-data/assets/v1/champion-summary.json")
            .catch(() => []),
        ]);
        current();
        if (!Array.isArray(live.allPlayers) || !live.allPlayers.length)
          throw new Error("No live players");
        const known = [
          ...(session?.gameData?.teamOne ?? []),
          ...(session?.gameData?.teamTwo ?? []),
        ];
        const own = state.summoner;
        const ownId =
          own?.gameName && own.tagLine
            ? `${own.gameName}#${own.tagLine}`
            : null;
        const players = live.allPlayers.map(
          (player: any, index: number): LivePlayer => {
            const id = riotId(player);
            // A complete public Riot ID is required to join sources. Never match by row order or champion.
            const same = id
              ? known.filter((person: any) => riotId(person) === id)
              : [];
            const puuid =
              publicPuuid(player.puuid) ??
              (same.length === 1 ? publicPuuid(same[0].puuid) : null);
            return {
              key: `live:${index}`,
              puuid,
              riotId: id,
              championId: championId(
                player,
                Array.isArray(champions) ? champions : [],
              ),
              teamId:
                player.team === "ORDER"
                  ? 100
                  : player.team === "CHAOS"
                    ? 200
                    : 0,
              kills: numberOrNull(player.scores?.kills),
              deaths: numberOrNull(player.scores?.deaths),
              assists: numberOrNull(player.scores?.assists),
              level: numberOrNull(player.level),
              items: (Array.isArray(player.items) ? player.items : [])
                .map((item: any) => Number(item.itemID))
                .filter((id: number) => Number.isInteger(id) && id > 0),
              isSelf: Boolean(
                (puuid && own?.puuid === puuid) || (id && ownId === id),
              ),
              identityHidden: !id && !puuid,
            };
          },
        );
        value = {
          ...base,
          status: "live",
          gameTime: numberOrNull(live.gameData?.gameTime),
          players,
          message: "实时对局 · 数据来自本机游戏",
        };
      }
      current();
      this.cache = { at: Date.now(), signature, value };
      return structuredClone(value);
    } catch (error) {
      current();
      if (error instanceof AppError && error.code === "STALE_LIVE_GAME")
        throw error;
      return {
        ...base,
        status: "unavailable",
        message: "实时对局暂不可读取，请确认游戏已开始后重试",
      };
    }
  }
}
