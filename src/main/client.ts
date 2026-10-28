import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { discover, type Credentials } from "./discovery";
import { jsonRequest } from "./http";
import { AppError, safeError } from "./errors";
import { AutoAccept } from "./automation";
import type {
  ConnectionState,
  Phase,
  RankedEntry,
  Selection,
  Summoner,
} from "../shared/types";
import type { Storage } from "./storage";

export const initialState = (): ConnectionState => ({
  status: "searching",
  message: "正在查找本机客户端",
  phase: "None",
  region: null,
  platform: null,
  mode: "rift",
  queueId: null,
  summoner: null,
  ranked: [],
  championId: null,
  updatedAt: new Date().toISOString(),
});
export const emptySelection = (): Selection => ({
  members: [],
  bench: [],
  localCellId: null,
  championId: null,
});
export function normalizeSummoner(raw: any): Summoner {
  return {
    puuid: String(raw.puuid ?? ""),
    summonerId: Number(raw.summonerId ?? 0),
    gameName: String(raw.gameName || raw.displayName || ""),
    tagLine: String(raw.tagLine || ""),
    level: Number(raw.summonerLevel ?? 0),
    iconId: Number(raw.profileIconId ?? 0),
  };
}
export function parseSelection(raw: any): Selection {
  const localCellId = Number.isInteger(raw.localPlayerCellId)
    ? raw.localPlayerCellId
    : null;
  const members = (raw.myTeam ?? []).map((member: any) => ({
    cellId: member.cellId,
    puuid:
      member.puuid && !/^0+$/.test(member.puuid.replace(/-/g, ""))
        ? String(member.puuid)
        : null,
    summonerId: member.summonerId > 0 ? member.summonerId : null,
    name: member.gameName
      ? `${member.gameName}${member.tagLine ? "#" + member.tagLine : ""}`
      : null,
    championId: Number(member.championId || member.championPickIntent || 0),
    position: String(member.assignedPosition || ""),
  }));
  return {
    members,
    bench: (raw.benchChampions ?? [])
      .map((item: any) => Number(item.championId))
      .filter((id: number) => id > 0),
    localCellId,
    championId:
      members.find((member: any) => member.cellId === localCellId)
        ?.championId || null,
  };
}
export function rankedEntries(raw: any): RankedEntry[] {
  return Object.entries(raw.queueMap ?? {})
    .filter(([name]) => ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"].includes(name))
    .map(([queue, value]: [string, any]) => ({
      queue,
      tier: String(value.tier ?? ""),
      division: value.division === "NA" ? "" : String(value.division ?? ""),
      wins: Number(value.wins ?? 0),
      losses: Number(value.losses ?? 0),
      lp: Number(value.leaguePoints ?? 0),
    }));
}
export function liveChampion(
  players: any[],
  summoner: Summoner,
  champions: any[],
): number | null {
  const own = players.find(
    (player) =>
      (player.riotIdGameName === summoner.gameName &&
        player.riotIdTagLine === summoner.tagLine) ||
      player.riotId === `${summoner.gameName}#${summoner.tagLine}` ||
      player.summonerName === `${summoner.gameName}#${summoner.tagLine}`,
  );
  if (!own) return null;
  const alias = String(own.rawChampionName ?? "").replace(
    /^game_character_displayname_/,
    "",
  );
  const champion = champions.find(
    (champion) =>
      champion.id > 0 &&
      ((alias && champion.alias === alias) ||
        (own.championName &&
          (champion.alias === own.championName ||
            champion.name === own.championName ||
            champion.description === own.championName))),
  );
  return champion?.id ?? null;
}
export class Client extends EventEmitter {
  state = initialState();
  selection = emptySelection();
  private credentials: Credentials | null = null;
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private stopped = false;
  private nextIdentity = 0;
  private readyEpoch = 0;
  private selectionRevision = 0;
  private identityRevision = 0;
  private accept: AutoAccept;
  constructor(private storage: Storage) {
    super();
    this.accept = new AutoAccept(
      async () => {
        // Recheck immediately before the only automated write.
        if (
          !this.storage.getSettings().autoAccept ||
          this.state.phase !== "ReadyCheck" ||
          this.state.status !== "connected" ||
          this.state.region !== "TENCENT"
        )
          return false;
        const epoch = this.readyEpoch;
        const owner = this.state.summoner?.puuid;
        const credentials = this.credentials;
        const ready = await this.request<any>(
          "/lol-matchmaking/v1/ready-check",
        );
        if (
          ready.state === "InProgress" &&
          ready.playerResponse === "None" &&
          this.storage.getSettings().autoAccept &&
          this.readyEpoch === epoch &&
          this.state.phase === "ReadyCheck" &&
          this.state.status === "connected" &&
          this.state.summoner?.puuid === owner &&
          this.credentials === credentials
        ) {
          await this.request("/lol-matchmaking/v1/ready-check/accept", "POST");
          return true;
        }
        return false;
      },
      (message) => {
        this.state.message = message;
        this.publish();
      },
    );
  }
  async start() {
    this.stopped = false;
    await this.tick();
    if (this.stopped) return;
    this.timer = setInterval(() => void this.tick(), 2500);
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.accept.cancel();
    this.disconnect();
  }
  private publish() {
    this.state.updatedAt = new Date().toISOString();
    this.emit("state", structuredClone(this.state));
  }
  async request<T = any>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    if (!this.credentials)
      throw new AppError("请先启动并登录国服客户端。", "CLIENT_OFFLINE");
    if (!path.startsWith("/") || path.startsWith("//") || path.includes(".."))
      throw new AppError("无效的客户端请求。", "INVALID_PATH");
    return jsonRequest<T>(`https://127.0.0.1:${this.credentials.port}${path}`, {
      loopback: true,
      method,
      body,
      timeout: 6500,
      headers: {
        Authorization:
          "Basic " +
          Buffer.from("riot:" + this.credentials.token).toString("base64"),
      },
    });
  }
  private disconnect() {
    this.selectionRevision++;
    this.identityRevision++;
    const socket = this.socket;
    this.socket = null;
    socket?.removeAllListeners();
    // Aborting an opening handshake can emit error after listeners are removed.
    socket?.on("error", () => {});
    socket?.terminate();
    this.credentials = null;
    this.nextIdentity = 0;
    this.selection = emptySelection();
    this.state.summoner = null;
    this.state.ranked = [];
    this.state.championId = null;
    this.state.phase = "None";
    this.state.platform = null;
    this.state.region = null;
    this.state.queueId = null;
    this.accept.cancel();
  }
  private connectSocket() {
    if (!this.credentials || this.socket) return;
    const socket = new WebSocket(`wss://127.0.0.1:${this.credentials.port}/`, {
      rejectUnauthorized: false,
      headers: {
        Authorization:
          "Basic " +
          Buffer.from("riot:" + this.credentials.token).toString("base64"),
      },
      handshakeTimeout: 5000,
    });
    this.socket = socket;
    socket.on("open", () => socket.send(JSON.stringify([5, "OnJsonApiEvent"])));
    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        const event = message[2];
        if (
          event?.uri === "/lol-gameflow/v1/gameflow-phase" &&
          typeof event.data === "string"
        ) {
          this.setPhase(event.data);
          void this.refreshSelection();
        }
        if (event?.uri === "/lol-champ-select/v1/session") {
          this.selectionRevision++;
          if (
            event.eventType !== "Delete" &&
            this.state.phase !== "ChampSelect"
          )
            return;
          this.selection =
            event.eventType === "Delete"
              ? emptySelection()
              : parseSelection(event.data);
          if (
            event.eventType !== "Delete" ||
            !["ChampSelect", "GameStart", "InProgress", "Reconnect"].includes(
              this.state.phase,
            )
          )
            this.state.championId = this.selection.championId;
          this.publish();
        }
        if (event?.uri === "/lol-summoner/v1/current-summoner") {
          this.identityRevision++;
          if (event.eventType === "Delete") {
            this.selectionRevision++;
            this.selection = emptySelection();
            this.state.summoner = null;
            this.state.platform = null;
            this.state.ranked = [];
            this.state.championId = null;
            this.nextIdentity = 0;
            this.accept.cancel();
            this.emit("account-changed");
            this.publish();
            return;
          }
          if (
            this.state.summoner &&
            this.state.summoner.puuid !== event.data?.puuid
          ) {
            this.selectionRevision++;
            this.state.championId = null;
            this.selection = emptySelection();
            this.state.ranked = [];
            this.accept.cancel();
            this.emit("account-changed");
          }
          this.state.summoner = normalizeSummoner(event.data);
          this.nextIdentity = 0;
          this.publish();
        }
      } catch {
        /* Ignore malformed or unrelated event frames. */
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
    });
  }
  private setPhase(phase: Phase) {
    if (phase !== this.state.phase) {
      this.selectionRevision++;
      if (phase === "ReadyCheck") this.readyEpoch++;
      if (phase !== "ChampSelect") this.selection = emptySelection();
      if (
        ["None", "Lobby", "Matchmaking", "ReadyCheck", "EndOfGame"].includes(
          phase,
        )
      )
        this.state.championId = null;
      this.state.phase = phase;
      this.emit("phase", phase);
    }
    this.updateAutomation();
    this.publish();
  }
  updateAutomation() {
    const settings = this.storage.getSettings();
    this.accept.update(
      settings.autoAccept,
      this.state.status === "connected" && this.state.region === "TENCENT",
      this.state.phase,
      `${this.credentials?.pid}:${this.state.summoner?.puuid}:${this.readyEpoch}`,
      settings.acceptDelayMs,
    );
  }
  async refreshSelection() {
    if (this.state.phase !== "ChampSelect") return;
    const revision = ++this.selectionRevision;
    const owner = this.state.summoner?.puuid;
    const credentials = this.credentials;
    const current = () =>
      revision === this.selectionRevision &&
      this.state.phase === "ChampSelect" &&
      this.state.status === "connected" &&
      this.state.summoner?.puuid === owner &&
      this.credentials === credentials;
    try {
      const selection = parseSelection(
        await this.request("/lol-champ-select/v1/session"),
      );
      if (!current()) return;
      this.selection = selection;
      this.state.championId = this.selection.championId;
      this.publish();
    } catch {
      if (current()) this.selection = emptySelection();
    }
  }
  private async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      const found = await discover();
      if (!found) {
        this.disconnect();
        this.state.status = "disconnected";
        this.state.message = "等待启动并登录国服客户端";
        this.publish();
        return;
      }
      if (
        !this.credentials ||
        found.port !== this.credentials.port ||
        found.token !== this.credentials.token
      ) {
        this.disconnect();
        this.credentials = found;
      }
      const phase = await this.request<string>(
        "/lol-gameflow/v1/gameflow-phase",
      );
      this.state.status = "connected";
      this.state.message = "已连接本机客户端";
      this.setPhase(phase);
      this.connectSocket();
      if (Date.now() >= this.nextIdentity) {
        const revision = this.identityRevision;
        const credentials = this.credentials;
        const [region, summoner, ranked, entitlements] = await Promise.all([
          this.request("/riotclient/region-locale"),
          this.request("/lol-summoner/v1/current-summoner"),
          this.request("/lol-ranked/v1/current-ranked-stats").catch(() => ({})),
          this.request("/entitlements/v1/token").catch(() => null),
        ]);
        if (
          this.stopped ||
          revision !== this.identityRevision ||
          credentials !== this.credentials
        )
          return;
        const normalized = normalizeSummoner(summoner);
        if (
          this.state.summoner &&
          this.state.summoner.puuid !== normalized.puuid
        ) {
          this.selectionRevision++;
          this.selection = emptySelection();
          this.state.championId = null;
          this.accept.cancel();
          this.emit("account-changed");
        }
        if (region.region !== "TENCENT")
          throw new AppError(
            "当前版本仅支持腾讯国服客户端。",
            "UNSUPPORTED_REGION",
          );
        this.state.region = region.region;
        this.state.summoner = normalized;
        this.state.ranked = rankedEntries(ranked);
        this.state.platform =
          String(entitlements?.issuer ?? "")
            .match(/https?:\/\/([a-z0-9]+)-/i)?.[1]
            ?.toUpperCase() ?? null;
        this.nextIdentity = Date.now() + 20000;
      }
      try {
        const session = await this.request("/lol-gameflow/v1/session");
        const queue = session.gameData?.queue;
        this.state.queueId = Number(queue?.id) || null;
        this.state.mode =
          queue?.gameMode === "KIWI" ||
          queue?.type === "KIWI" ||
          queue?.id === 2400
            ? "hex"
            : queue?.gameMode === "ARAM" || /ARAM/.test(queue?.type ?? "")
              ? "aram"
              : "rift";
        if (["GameStart", "InProgress", "Reconnect"].includes(phase)) {
          const selected = session.gameData?.playerChampionSelections?.find(
            (item: any) =>
              item.summonerId === this.state.summoner?.summonerId ||
              item.puuid === this.state.summoner?.puuid,
          );
          if (selected?.championId) this.state.championId = selected.championId;
        }
      } catch {
        this.state.queueId = null;
      }
      if (
        ["InProgress", "Reconnect"].includes(phase) &&
        !this.state.championId &&
        this.state.summoner
      ) {
        try {
          const [players, champions] = await Promise.all([
            jsonRequest<any[]>(
              "https://127.0.0.1:2999/liveclientdata/allplayers",
              { loopback: true, timeout: 1800 },
            ),
            this.request<any[]>(
              "/lol-game-data/assets/v1/champion-summary.json",
            ),
          ]);
          this.state.championId = liveChampion(
            players,
            this.state.summoner,
            champions,
          );
        } catch {
          /* The live API may not be ready yet; no champion is guessed. */
        }
      }
      await this.refreshSelection();
      this.updateAutomation();
      this.publish();
    } catch (error) {
      this.disconnect();
      this.state.status = "error";
      this.state.message = safeError(error).message;
      this.publish();
    } finally {
      this.busy = false;
    }
  }
  async findSummoner(riotId: string) {
    const normalized = riotId
      .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
      .replace(/＃/g, "#")
      .trim();
    if (!normalized || normalized.length > 100)
      throw new AppError("请输入有效的游戏名#标签。", "INVALID_RIOT_ID");
    const found = normalizeSummoner(
      await this.request(
        `/lol-summoner/v1/summoners?name=${encodeURIComponent(normalized)}`,
      ),
    );
    if (!found.puuid)
      throw new AppError(
        "没有找到该玩家，请核对当前大区、游戏名和标签。",
        "SUMMONER_NOT_FOUND",
      );
    return found;
  }
  async getRanked(puuid: string) {
    return rankedEntries(
      await this.request(
        `/lol-ranked/v1/ranked-stats/${encodeURIComponent(puuid)}`,
      ),
    );
  }
}
