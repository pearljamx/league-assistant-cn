import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { discover, type Credentials } from "./discovery";
import { jsonRequest } from "./http";
import { AppError, safeError } from "./errors";
import { AutoAccept, PhaseAction } from "./automation";
import {
  autoMatchBlocker,
  lobbyInfo,
  matchSearch,
  nextBerserkChampion,
} from "./matchmaking";
import { autoSelectDefaults, planAutoSelect } from "./auto-select";
import type {
  ConnectionState,
  ChampionChoices,
  Phase,
  RankedEntry,
  Selection,
  Summoner,
} from "../shared/types";
import type { Storage } from "./storage";

/** 狂暴切换每次换用之间的间隔；上一次请求未完成时跳过本轮。 */
export const BERSERK_INTERVAL_MS = 100;

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
  private connectionRevision = 0;
  private choosingChampion = false;
  private accept: AutoAccept;
  /** 自动选人：每一步只尝试一次；预选后记录时间，满足延时才锁定。 */
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private autoBusy = false;
  private autoDone = new Set<string>();
  private autoHoverAt = new Map<number, number>();
  /** 自动匹配：每次从其他阶段进入大厅算一轮，只尝试一次；取消匹配或拒绝确认回到大厅不自动再排。 */
  private autoMatch: PhaseAction;
  private playAgain: PhaseAction;
  /** 结算点赞投票阶段（PreEndOfGame）自动提交“跳过”，不给任何人点赞。 */
  private skipHonor: PhaseAction;
  private honorEpoch = 0;
  private lobbyEpoch = 0;
  private lobbyEligible = false;
  private autoMatchWasOn = false;
  /** 计时结束时房间条件已不满足则加一，使条件再次满足时重新倒计时。 */
  private autoMatchRetry = 0;
  private endEpoch = 0;
  /** 狂暴切换：仅本次选人有效，离开选人、断线或换号即停止。 */
  private berserkTimer: ReturnType<typeof setInterval> | null = null;
  private berserkOrder: number[] = [];
  private berserkFails = 0;
  private berserkBusy = false;
  private berserkOkAt = 0;
  /** 卡片阶段的本人卡片在一次选人中基本不变，缓存 3 秒以减少请求。 */
  private berserkCards: { at: number; ids: number[] } | null = null;
  constructor(private storage: Storage) {
    super();
    const report = (message: string) => {
      this.state.message = message;
      this.publish();
    };
    this.autoMatch = new PhaseAction(
      "Lobby",
      async () => {
        const settings = this.storage.getSettings();
        if (!settings.autoMatch || !this.tencentLobby()) return false;
        const epoch = this.lobbyEpoch;
        const owner = this.state.summoner?.puuid;
        const credentials = this.credentials;
        const lobby = lobbyInfo(await this.request("/lol-lobby/v2/lobby"));
        const same = () =>
          this.storage.getSettings().autoMatch === true &&
          this.lobbyEligible &&
          this.lobbyEpoch === epoch &&
          this.tencentLobby() &&
          this.state.summoner?.puuid === owner &&
          this.credentials === credentials;
        if (!same()) return false;
        const blocker = autoMatchBlocker(
          lobby,
          settings.autoMatchMinMembers ?? 1,
          settings.autoMatchWaitInvites !== false,
        );
        if (blocker) {
          // 刚回到房间时客户端状态可能尚未就绪：不放弃本轮，等条件满足后重新倒计时。
          this.state.lobby = lobby;
          this.autoMatchRetry++;
          queueMicrotask(() => {
            this.updateAutomation();
            this.publish();
          });
          return false;
        }
        await this.request("/lol-lobby/v2/lobby/matchmaking/search", "POST");
        return true;
      },
      report,
      { done: "已自动开始匹配", failed: "自动匹配未能开始，请在客户端操作。" },
      (at) => {
        this.state.autoMatchAt = at;
        this.publish();
      },
    );
    this.playAgain = new PhaseAction(
      "EndOfGame",
      async () => {
        const settings = this.storage.getSettings();
        if (
          !settings.autoPlayAgain ||
          this.state.phase !== "EndOfGame" ||
          this.state.status !== "connected" ||
          this.state.region !== "TENCENT"
        )
          return false;
        await this.request("/lol-lobby/v2/play-again", "POST");
        return true;
      },
      report,
      { done: "已回到房间", failed: "回到房间未完成，请在客户端操作。" },
    );
    this.skipHonor = new PhaseAction(
      "PreEndOfGame",
      async () => {
        if (
          !this.storage.getSettings().autoSkipHonor ||
          this.state.phase !== "PreEndOfGame" ||
          this.state.status !== "connected" ||
          this.state.region !== "TENCENT"
        )
          return false;
        await this.skipHonorBallot();
        return true;
      },
      report,
      { done: "已跳过点赞", failed: "跳过点赞未完成，请在客户端操作。" },
    );
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
  /** Opaque generation for services to invalidate in-flight work after reconnects. */
  get sessionGeneration() {
    return this.connectionRevision;
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.cancelAutomation();
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
    this.connectionRevision++;
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
    this.cancelAutomation();
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
        if (event?.uri === "/lol-lobby/v2/lobby") {
          if (this.state.phase !== "Lobby") return;
          this.state.lobby =
            event.eventType === "Delete" ? null : lobbyInfo(event.data);
          this.updateAutomation();
          this.publish();
          return;
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
          if (event.eventType !== "Delete") this.scheduleAutoSelect();
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
            this.cancelAutomation();
            this.connectionRevision++;
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
            this.cancelAutomation();
            this.connectionRevision++;
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
  private cancelAutomation() {
    this.accept.cancel();
    this.autoMatch.cancel();
    this.playAgain.cancel();
    this.skipHonor.cancel();
    this.stopBerserk();
  }
  private tencentLobby() {
    return (
      this.state.phase === "Lobby" &&
      this.state.status === "connected" &&
      this.state.region === "TENCENT"
    );
  }
  private setPhase(phase: Phase) {
    if (phase !== this.state.phase) {
      const previous = this.state.phase;
      this.selectionRevision++;
      if (phase === "ReadyCheck") this.readyEpoch++;
      if (phase === "EndOfGame") this.endEpoch++;
      if (phase === "PreEndOfGame") this.honorEpoch++;
      if (phase === "Lobby") {
        this.lobbyEpoch++;
        void this.refreshLobby();
        // 用户取消匹配或拒绝/错过确认回到大厅时尊重其选择，不再自动排队。
        this.lobbyEligible = !["Matchmaking", "ReadyCheck"].includes(previous);
      }
      if (phase !== "Lobby") this.state.lobby = null;
      if (phase !== "Matchmaking") this.state.search = null;
      if (phase !== "ChampSelect") {
        if (this.berserkTimer) this.state.message = "已离开选人，狂暴切换结束";
        this.stopBerserk();
        this.selection = emptySelection();
        this.autoDone.clear();
        this.autoHoverAt.clear();
        if (this.autoTimer) clearTimeout(this.autoTimer);
        this.autoTimer = null;
      }
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
    const connected =
      this.state.status === "connected" && this.state.region === "TENCENT";
    const identity = `${this.credentials?.pid}:${this.state.summoner?.puuid}`;
    // 在大厅里刚打开开关时，本轮视为可自动匹配。
    if (
      settings.autoMatch &&
      !this.autoMatchWasOn &&
      this.state.phase === "Lobby"
    ) {
      this.lobbyEpoch++;
      this.lobbyEligible = true;
      if (!this.state.lobby) void this.refreshLobby();
    }
    this.autoMatchWasOn = settings.autoMatch === true;
    // 条件（可开始、人数下限、无未回应邀请）满足才倒计时；不满足时等待并在界面说明原因。
    const wanted =
      settings.autoMatch === true &&
      this.lobbyEligible &&
      connected &&
      this.state.phase === "Lobby";
    const blocker = wanted
      ? autoMatchBlocker(
          this.state.lobby,
          settings.autoMatchMinMembers ?? 1,
          settings.autoMatchWaitInvites !== false,
        )
      : null;
    this.state.autoMatchWait = blocker;
    this.autoMatch.update(
      wanted && !blocker,
      connected,
      this.state.phase,
      `${identity}:${this.lobbyEpoch}:${this.autoMatchRetry}`,
      settings.autoMatchDelayMs ?? 3000,
    );
    this.playAgain.update(
      settings.autoPlayAgain === true,
      connected,
      this.state.phase,
      `${identity}:${this.endEpoch}`,
      2000,
    );
    this.skipHonor.update(
      settings.autoSkipHonor === true,
      connected,
      this.state.phase,
      `${identity}:${this.honorEpoch}`,
      1000,
    );
  }
  /**
   * 跳过点赞：先用点赞 v2 接口提交 OPT_OUT（参考 Akari 的“跳过”策略）；
   * 新版客户端不接受时改用 /lol-honor/v1/honor。两者都不给任何玩家点赞。
   */
  private async skipHonorBallot() {
    try {
      await this.request("/lol-honor-v2/v1/honor-player", "POST", {
        honorCategory: "OPT_OUT",
        summonerId: 0,
      });
    } catch {
      await this.request("/lol-honor/v1/honor", "POST", {
        honorType: "OPT_OUT",
        recipientPuuid: "",
      });
    }
  }
  /** 进入大厅时立即读取房间，自动匹配不必等下一次轮询。 */
  private lobbyReads = 0;
  private async refreshLobby() {
    const read = ++this.lobbyReads;
    const credentials = this.credentials;
    const lobby = lobbyInfo(
      await this.request("/lol-lobby/v2/lobby").catch(() => null),
    );
    if (
      read !== this.lobbyReads ||
      this.state.phase !== "Lobby" ||
      this.credentials !== credentials
    )
      return;
    this.state.lobby = lobby;
    this.updateAutomation();
    this.publish();
  }
  /** 用户点击的匹配操作；只在本人为房主的大厅开始，取消只在匹配中。 */
  async matchmaking(action: "start" | "cancel" | "skip") {
    if (action === "skip") {
      this.lobbyEligible = false;
      this.updateAutomation();
      this.publish();
      return;
    }
    if (this.state.status !== "connected" || this.state.region !== "TENCENT")
      throw new AppError("请先启动并登录国服客户端。", "CLIENT_OFFLINE");
    const owner = this.state.summoner?.puuid;
    const credentials = this.credentials;
    if (action === "start") {
      if (this.state.phase !== "Lobby")
        throw new AppError("请先在客户端进入组队大厅。", "MATCH_INVALID_PHASE");
      const lobby = lobbyInfo(await this.request("/lol-lobby/v2/lobby"));
      if (
        this.state.phase !== "Lobby" ||
        this.state.summoner?.puuid !== owner ||
        this.credentials !== credentials
      )
        throw new AppError("房间状态已变化，请重试。", "STALE_LOBBY");
      if (!lobby?.canStart)
        throw new AppError(
          lobby?.reason ?? "暂时无法开始匹配。",
          "MATCH_BLOCKED",
        );
      this.autoMatch.cancel();
      this.lobbyEligible = false;
      await this.request("/lol-lobby/v2/lobby/matchmaking/search", "POST");
      return;
    }
    if (this.state.phase !== "Matchmaking")
      throw new AppError("当前不在匹配中。", "MATCH_INVALID_PHASE");
    await this.request("/lol-lobby/v2/lobby/matchmaking/search", "DELETE");
  }
  /**
   * 用户点击后把多行文字发到选人聊天（只有本队可见）。每行一条，间隔发送，
   * 每条前都核对仍在同一次选人且账号未变。
   */
  async sendChampSelectChat(lines: string[]) {
    if (
      this.state.phase !== "ChampSelect" ||
      this.state.status !== "connected" ||
      this.state.region !== "TENCENT"
    )
      throw new AppError("请在选人阶段发送。", "CHAT_INVALID_PHASE");
    const owner = this.state.summoner?.puuid;
    const credentials = this.credentials;
    const conversations = await this.request<any[]>(
      "/lol-chat/v1/conversations",
    );
    const room = (Array.isArray(conversations) ? conversations : []).find(
      (item) =>
        item?.type === "championSelect" && typeof item.id === "string",
    );
    if (!room)
      throw new AppError("没有找到选人聊天，请稍后重试。", "CHAT_NOT_FOUND");
    for (const [index, line] of lines.slice(0, 10).entries()) {
      if (index) await new Promise((resolve) => setTimeout(resolve, 400));
      if (
        this.state.phase !== "ChampSelect" ||
        this.state.summoner?.puuid !== owner ||
        this.credentials !== credentials
      )
        throw new AppError("已离开选人，停止发送。", "CHAT_STALE");
      await this.request(
        `/lol-chat/v1/conversations/${encodeURIComponent(room.id)}/messages`,
        "POST",
        { body: line.slice(0, 200), type: "chat" },
      );
    }
  }
  /** 狂暴切换：开启后按顺序循环换用备选席英雄，直到关闭或离开选人。 */
  setBerserk(enabled: boolean) {
    if (!enabled) {
      if (this.berserkTimer) this.state.message = "已关闭狂暴切换";
      this.stopBerserk();
      this.publish();
      return false;
    }
    if (
      this.state.phase !== "ChampSelect" ||
      this.state.status !== "connected" ||
      this.state.region !== "TENCENT"
    )
      throw new AppError("请在选人阶段开启狂暴切换。", "BERSERK_INVALID_PHASE");
    if (this.state.mode === "rift")
      throw new AppError("狂暴切换只用于大乱斗的备选席。", "BERSERK_MODE");
    if (this.berserkTimer) return true;
    this.berserkOrder = [];
    this.berserkFails = 0;
    this.berserkOkAt = Date.now();
    this.berserkCards = null;
    this.state.berserk = true;
    this.state.message = "狂暴切换已开启";
    this.berserkTimer = setInterval(
      () => void this.berserkStep(),
      BERSERK_INTERVAL_MS,
    );
    this.publish();
    void this.berserkStep();
    return true;
  }
  private stopBerserk() {
    if (this.berserkTimer) clearInterval(this.berserkTimer);
    this.berserkTimer = null;
    this.state.berserk = false;
  }
  /**
   * 快速路径：每轮只读一次会话、发一次交换，不走 chooseChampion 的两次重读，
   * 才能做到约 0.1 秒一换。写入前仍核对阶段、账号、连接与开关。
   * 失败不立即停止（客户端可能短暂拒绝过快的交换），连续 5 秒没有成功才停。
   */
  private async berserkStep() {
    if (this.berserkBusy || this.choosingChampion || this.autoBusy) return;
    if (this.state.phase !== "ChampSelect") {
      this.stopBerserk();
      return this.publish();
    }
    this.berserkBusy = true;
    const owner = this.state.summoner?.puuid;
    const credentials = this.credentials;
    const same = () =>
      this.berserkTimer !== null &&
      this.state.phase === "ChampSelect" &&
      this.state.status === "connected" &&
      this.state.region === "TENCENT" &&
      this.state.summoner?.puuid === owner &&
      this.credentials === credentials;
    try {
      const session = await this.request("/lol-champ-select/v1/session");
      if (!same()) return;
      let subset: number[] = [];
      if (this.isSubsetPhase(session)) {
        if (!this.berserkCards || Date.now() - this.berserkCards.at > 3000) {
          const ids = await this.request<number[]>(
            "/lol-lobby-team-builder/champ-select/v1/subset-champion-list",
          ).catch(() => []);
          this.berserkCards = {
            at: Date.now(),
            ids: Array.isArray(ids) ? ids : [],
          };
        }
        subset = this.berserkCards.ids;
      }
      // 卡片还没选时不替用户做选择，只在已有英雄后循环交换。
      const choices = this.choicesFromSession(session, [], subset);
      if (choices.kind !== "bench") return;
      const current =
        Number(
          session.myTeam?.find(
            (member: any) => member.cellId === session.localPlayerCellId,
          )?.championId,
        ) || null;
      const next = nextBerserkChampion(
        this.berserkOrder,
        current,
        choices.championIds,
      );
      if (!next || !same()) return;
      await this.request(
        `/lol-champ-select/v1/session/bench/swap/${next}`,
        "POST",
      );
      this.berserkOkAt = Date.now();
      this.berserkFails = 0;
    } catch {
      this.berserkFails++;
      if (
        this.berserkTimer &&
        this.berserkFails >= 20 &&
        Date.now() - this.berserkOkAt > 5000
      ) {
        this.stopBerserk();
        this.state.message = "狂暴切换连续 5 秒失败，已自动停止";
        this.publish();
      }
    } finally {
      this.berserkBusy = false;
    }
  }
  private autoSettings() {
    return { ...autoSelectDefaults, ...this.storage.getSettings().autoSelect };
  }
  /** 会话变化后稍等片刻再计划，避免同一批事件重复触发。全部开关关闭时不做任何事。 */
  private scheduleAutoSelect(delay = 400) {
    const settings = this.autoSettings();
    if (!settings.pick && !settings.ban && !settings.bench) return;
    if (this.state.phase !== "ChampSelect") return;
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      void this.runAutoSelect();
    }, delay);
  }
  private async runAutoSelect() {
    const settings = this.autoSettings();
    if (!settings.pick && !settings.ban && !settings.bench) return;
    // 狂暴切换进行中由用户主导，自动抢备选席暂停。
    if (this.berserkTimer) return;
    if (this.autoBusy || this.choosingChampion || this.berserkBusy)
      return this.scheduleAutoSelect(800);
    let current: () => void;
    try {
      current = this.championChoiceGuard();
    } catch {
      return;
    }
    this.autoBusy = true;
    try {
      const { session, choices } = await this.readChoices(current);
      if (!this.ownsLocalCell(session)) return;
      const mode = this.state.mode;
      const list = async (path: string) => {
        const value = await this.request<number[]>(path).catch(() => null);
        current();
        return Array.isArray(value) ? value : null;
      };
      const rift = mode === "rift";
      const step = planAutoSelect({
        session,
        settings,
        mode,
        pickable:
          rift && settings.pick
            ? await list("/lol-champ-select/v1/pickable-champion-ids")
            : null,
        bannable:
          rift && settings.ban
            ? await list("/lol-champ-select/v1/bannable-champion-ids")
            : null,
        cards: choices.kind === "subset" ? (choices.cards ?? []) : [],
        swappable: choices.kind === "bench" ? choices.championIds : [],
        current:
          Number(
            session.myTeam?.find(
              (member: any) => member.cellId === session.localPlayerCellId,
            )?.championId,
          ) || 0,
      });
      if (!step) return;
      if ((step.kind === "pick" || step.kind === "ban") && step.complete) {
        // 锁定前至少等用户设置的延时；期间用户改选其他英雄时计划会变为 null。
        const since = this.autoHoverAt.get(step.actionId) ?? Date.now();
        this.autoHoverAt.set(step.actionId, since);
        const wait = since + settings.lockDelayMs - Date.now();
        if (wait > 0) return this.scheduleAutoSelect(wait + 50);
      }
      const key = `${session.gameId ?? ""}:${JSON.stringify(step)}`;
      if (this.autoDone.has(key)) return;
      this.autoDone.add(key);
      current();
      if (step.kind === "bench") {
        await this.request(
          `/lol-champ-select/v1/session/bench/swap/${step.championId}`,
          "POST",
        );
        this.reportAuto(`已自动换用备选席英雄`);
      } else {
        await this.request(
          `/lol-champ-select/v1/session/actions/${step.actionId}`,
          "PATCH",
          {
            championId: step.championId,
            completed: step.kind === "card" ? true : step.complete,
          },
        );
        if (step.kind !== "card" && !step.complete) {
          this.autoHoverAt.set(step.actionId, Date.now());
          if (settings.lock) this.scheduleAutoSelect(settings.lockDelayMs + 50);
        }
        this.reportAuto(
          step.kind === "ban"
            ? step.complete
              ? "已自动锁定禁用"
              : "已自动预禁英雄"
            : step.kind === "card" || step.complete
              ? "已自动锁定英雄"
              : "已自动预选英雄",
        );
      }
      await this.refreshSelection();
    } catch {
      /* 状态变化或客户端拒绝：不重试同一步，等待下一次会话变化。 */
    } finally {
      this.autoBusy = false;
    }
  }
  private reportAuto(message: string) {
    this.state.message = message;
    this.publish();
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
  private championChoiceGuard() {
    if (
      this.state.status !== "connected" ||
      this.state.region !== "TENCENT" ||
      this.state.phase !== "ChampSelect" ||
      !this.state.summoner?.puuid ||
      !this.credentials
    )
      throw new AppError(
        "请在国服客户端选人阶段操作。",
        "CHAMPION_INVALID_PHASE",
      );
    const owner = this.state.summoner.puuid;
    const credentials = this.credentials;
    const revision = this.selectionRevision;
    const mode = this.state.mode;
    return () => {
      if (
        this.state.status !== "connected" ||
        this.state.region !== "TENCENT" ||
        this.state.phase !== "ChampSelect" ||
        this.state.summoner?.puuid !== owner ||
        this.credentials !== credentials ||
        this.selectionRevision !== revision ||
        this.state.mode !== mode
      )
        throw new AppError(
          "选人或账号状态已变化，请刷新后重试。",
          "STALE_SELECTION",
        );
    };
  }
  private ownsLocalCell(session: any) {
    const local = session.myTeam?.find(
      (member: any) => member.cellId === session.localPlayerCellId,
    );
    const own = this.state.summoner;
    return Boolean(
      Number.isInteger(session.localPlayerCellId) &&
        local &&
        own &&
        (local.puuid === own.puuid ||
          (own.summonerId > 0 && local.summonerId === own.summonerId)),
    );
  }
  private pickAction(session: any) {
    return (session.actions ?? [])
      .flat()
      .find(
        (action: any) =>
          Number.isInteger(action.id) &&
          action.id >= 0 &&
          action.actorCellId === session.localPlayerCellId &&
          action.type === "pick" &&
          action.isInProgress === true &&
          action.completed === false,
      );
  }
  /** 卡片模式的本人选人动作：同时选人时可能没有 isInProgress，只要求本人且未完成。 */
  private subsetPickAction(session: any) {
    return (
      this.pickAction(session) ??
      (session.actions ?? [])
        .flat()
        .find(
          (action: any) =>
            Number.isInteger(action.id) &&
            action.id >= 0 &&
            action.actorCellId === session.localPlayerCellId &&
            action.type === "pick" &&
            action.completed === false,
        )
    );
  }
  /** 新版大乱斗在 BAN_PICK 阶段给每人几张英雄卡片（与客户端界面规则一致）。 */
  private isSubsetPhase(session: any) {
    return (
      (this.state.mode === "aram" || this.state.mode === "hex") &&
      session?.allowSubsetChampionPicks === true &&
      session?.timer?.phase === "BAN_PICK"
    );
  }
  private choicesFromSession(
    session: any,
    pickable: number[],
    subset: number[] = [],
  ): ChampionChoices {
    if (!this.ownsLocalCell(session))
      return {
        championIds: [],
        kind: "none",
        reason: "无法确认本人选人位置，请在客户端操作",
      };
    const valid = (id: unknown): id is number =>
      Number.isInteger(id) && (id as number) > 0;
    const current =
      Number(
        session.myTeam?.find(
          (member: any) => member.cellId === session.localPlayerCellId,
        )?.championId,
      ) || 0;
    const bench =
      session.benchEnabled === true
        ? (session.benchChampions ?? [])
            .map((item: any) => Number(item.championId))
            .filter((id: number) => valid(id) && id !== current)
        : [];
    if (this.isSubsetPhase(session)) {
      // 卡片与备选席合并展示；客户端规则：卡片阶段只能拿本人卡片，队友留下的需等选人结束。
      const cards = subset
        .filter(valid)
        .filter((id) => !pickable.length || pickable.includes(id));
      const waiting = bench.filter((id: number) => !cards.includes(id));
      if (!current) {
        const action = this.subsetPickAction(session);
        return action && cards.length
          ? {
              championIds: cards,
              kind: "subset",
              cards,
              waiting,
              reason: "点击卡片英雄直接选用",
            }
          : {
              championIds: [],
              kind: "none",
              waiting,
              reason: "等待英雄卡片出现",
            };
      }
      return session.benchEnabled === true
        ? {
            championIds: cards.filter((id) => id !== current),
            kind: "bench",
            cards,
            waiting,
            reason: "卡片英雄可立即换用，队友留下的需等选人结束",
          }
        : { championIds: [], kind: "none", reason: "已选用英雄卡片" };
    }
    if (this.state.mode === "aram" || this.state.mode === "hex") {
      return {
        championIds: bench,
        kind: session.benchEnabled === true ? "bench" : "none",
        reason:
          session.benchEnabled === true
            ? "点击头像直接换用备选席英雄"
            : "当前客户端未开放备选席换用",
      };
    }
    const active = this.pickAction(session);
    return {
      championIds: active
        ? pickable.filter((id) => Number.isInteger(id) && id > 0)
        : [],
      kind: active ? "pick" : "none",
      reason: active
        ? "选择英雄将同步客户端，不自动锁定"
        : "等待本人选人回合，不能修改队友或已锁定的英雄",
    };
  }
  /** 读取会话及所需列表后计算可选英雄；每一步都核对账号、阶段与连接。 */
  private async readChoices(current: () => void) {
    const session = await this.request("/lol-champ-select/v1/session");
    current();
    const list = async (path: string) => {
      const value = await this.request<number[]>(path).catch(() => []);
      current();
      return Array.isArray(value) ? value : [];
    };
    const subsetPhase = this.isSubsetPhase(session);
    const subset = subsetPhase
      ? await list(
          "/lol-lobby-team-builder/champ-select/v1/subset-champion-list",
        )
      : [];
    const pickable =
      subsetPhase || (this.state.mode === "rift" && this.pickAction(session))
        ? await list("/lol-champ-select/v1/pickable-champion-ids")
        : [];
    return {
      session,
      choices: this.choicesFromSession(session, pickable, subset),
    };
  }
  async getChampionChoices(): Promise<ChampionChoices> {
    if (this.state.phase !== "ChampSelect" || this.state.status !== "connected")
      return {
        championIds: [],
        kind: "none",
        reason: "进入选人后可换用英雄；现在可先查看推荐",
      };
    const current = this.championChoiceGuard();
    return (await this.readChoices(current)).choices;
  }
  async chooseChampion(championId: number): Promise<void> {
    if (!Number.isInteger(championId) || championId < 1 || championId > 100000)
      throw new AppError("请选择有效英雄。", "INVALID_CHAMPION");
    if (this.choosingChampion)
      throw new AppError("正在同步英雄，请稍候。", "CHAMPION_BUSY");
    const current = this.championChoiceGuard();
    this.choosingChampion = true;
    try {
      const { session, choices } = await this.readChoices(current);
      if (!choices.championIds.includes(championId))
        throw new AppError(
          "该英雄当前不可换用，请刷新或在客户端操作。",
          "CHAMPION_UNAVAILABLE",
        );
      const phase = await this.request<string>(
        "/lol-gameflow/v1/gameflow-phase",
      );
      current();
      if (phase !== "ChampSelect")
        throw new AppError("已离开选人阶段。", "CHAMPION_INVALID_PHASE");
      // Verify a second fresh session immediately before the only explicit user-triggered write.
      const { session: latest, choices: fresh } =
        await this.readChoices(current);
      if (
        latest.localPlayerCellId !== session.localPlayerCellId ||
        fresh.kind !== choices.kind ||
        !fresh.championIds.includes(championId)
      )
        throw new AppError(
          "备选席或选人状态已变化，请刷新后重试。",
          "STALE_SELECTION",
        );
      if (fresh.kind === "bench") {
        await this.request(
          `/lol-champ-select/v1/session/bench/swap/${championId}`,
          "POST",
        );
      } else if (fresh.kind === "subset") {
        // 选用卡片与在客户端点卡片一致：卡片本身就是确认，没有单独的锁定步骤。
        const action = this.subsetPickAction(latest);
        if (!action || action.id !== this.subsetPickAction(session)?.id)
          throw new AppError("英雄卡片已变化，请重新选择。", "STALE_SELECTION");
        await this.request(
          `/lol-champ-select/v1/session/actions/${action.id}`,
          "PATCH",
          { championId, completed: true },
        );
      } else {
        const action = this.pickAction(latest);
        if (!action || action.id !== this.pickAction(session)?.id)
          throw new AppError(
            "本人选人回合已变化，请重新选择。",
            "STALE_SELECTION",
          );
        await this.request(
          `/lol-champ-select/v1/session/actions/${action.id}`,
          "PATCH",
          { championId, completed: false },
        );
      }
      await this.refreshSelection();
    } finally {
      this.choosingChampion = false;
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
          this.cancelAutomation();
          this.connectionRevision++;
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
        this.state.queueName =
          typeof queue?.description === "string" && queue.description.trim()
            ? queue.description.trim().slice(0, 40)
            : null;
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
        this.state.queueName = null;
      }
      const lobby =
        phase === "Lobby"
          ? lobbyInfo(
              await this.request("/lol-lobby/v2/lobby").catch(() => null),
            )
          : null;
      if (this.state.phase === phase) {
        this.state.lobby = lobby;
        if (phase === "Lobby") this.updateAutomation();
      }
      this.state.search =
        phase === "Matchmaking"
          ? matchSearch(
              await this.request("/lol-matchmaking/v1/search").catch(
                () => null,
              ),
            )
          : null;
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
