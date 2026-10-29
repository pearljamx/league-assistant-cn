import type { Client } from "./client";
import { AppError } from "./errors";
import type {
  ChatAvailability,
  ChatStatus,
  FriendEntry,
  RerollState,
} from "../shared/types";

/** 工具集：全部由用户点击触发，每次写入前核对客户端连接与阶段，不自动重试。 */
export const chatAvailabilities: ChatAvailability[] = [
  "chat",
  "away",
  "mobile",
  "offline",
];

export function normalizeFriend(raw: any): FriendEntry | null {
  const puuid = typeof raw?.puuid === "string" ? raw.puuid : "";
  if (!/^[\w-]{1,128}$/.test(puuid)) return null;
  const name = String(raw.gameName || raw.name || "").slice(0, 64);
  const tag = String(raw.gameTag || raw.tagLine || "").slice(0, 32);
  const gameStatus = String(raw.lol?.gameStatus ?? "");
  const queue = String(raw.lol?.gameQueueType ?? "");
  return {
    puuid,
    name: name && tag ? `${name}#${tag}` : name || "好友",
    availability: String(raw.availability ?? "offline"),
    inGame: gameStatus === "inGame",
    gameStatus,
    queue,
    championId: Number(raw.lol?.championId) || null,
    statusMessage: String(raw.statusMessage ?? "").slice(0, 200),
    // 只有在 LoL 中游戏、且客户端标明可观战（或未声明）时才提供观战入口。
    spectatable:
      raw.productName !== undefined && raw.product !== "league_of_legends"
        ? false
        : gameStatus === "inGame",
  };
}

export class Toolkit {
  constructor(private client: Client) {}
  private connected() {
    const state = this.client.state;
    if (state.status !== "connected" || state.region !== "TENCENT")
      throw new AppError("请先启动并登录国服客户端。", "TOOLKIT_NOT_CONNECTED");
    return `${state.summoner?.puuid}:${state.platform}`;
  }
  private same(owner: string) {
    if (owner !== this.connected())
      throw new AppError("账号已变化，请重新操作。", "TOOLKIT_STALE");
  }

  // —— 选人台 ——
  async rerollState(): Promise<RerollState> {
    this.connected();
    if (this.client.state.phase !== "ChampSelect")
      return {
        available: false,
        remaining: null,
        current: null,
        reason: "进入选人后可用",
      };
    const session = await this.client.request<any>(
      "/lol-champ-select/v1/session",
    );
    const me = session?.myTeam?.find(
      (member: any) => member.cellId === session.localPlayerCellId,
    );
    const points = await this.client
      .request<any>("/lol-summoner/v1/current-summoner/rerollPoints")
      .catch(() => null);
    const remaining = Number.isInteger(points?.numberOfRolls)
      ? points.numberOfRolls
      : null;
    const rerollMode =
      session?.rerollsRemaining !== undefined || remaining !== null;
    const current = Number(me?.championId) || null;
    return {
      available: Boolean(rerollMode && current && remaining !== 0),
      remaining,
      current,
      reason: !current
        ? "拿到英雄后可重随"
        : remaining === 0
          ? "重随次数已用完"
          : rerollMode
            ? "可以重随"
            : "当前模式不支持重随",
    };
  }
  /** 重随当前英雄。返回重随前的英雄，便于之后从备选席拿回。 */
  async reroll(): Promise<{ previous: number | null }> {
    const owner = this.connected();
    const state = await this.rerollState();
    if (!state.available)
      throw new AppError(state.reason, "REROLL_UNAVAILABLE");
    this.same(owner);
    await this.client.request(
      "/lol-champ-select/v1/session/my-selection/reroll",
      "POST",
    );
    await this.client.refreshSelection();
    return { previous: state.current };
  }

  // —— 客户端修复 ——
  async restartUx() {
    this.connected();
    await this.client.request("/riotclient/kill-and-restart-ux", "POST");
  }
  /** 按客户端缩放比例返回应有的窗口尺寸（DIP 之外的物理像素由调用方换算）。 */
  async expectedWindowSize() {
    this.connected();
    const zoom = Number(
      await this.client
        .request<number>("/riotclient/zoom-scale")
        .catch(() => 1),
    );
    const scale = Number.isFinite(zoom) && zoom > 0 && zoom <= 4 ? zoom : 1;
    return {
      width: Math.round(1280 * scale),
      height: Math.round(720 * scale),
      scale,
    };
  }

  // —— 好友与观战 ——
  async friends(): Promise<FriendEntry[]> {
    this.connected();
    const list = await this.client.request<any[]>("/lol-chat/v1/friends");
    return (Array.isArray(list) ? list : [])
      .map(normalizeFriend)
      .filter((item): item is FriendEntry => Boolean(item))
      .sort(
        (a, b) =>
          Number(b.inGame) - Number(a.inGame) ||
          Number(b.availability !== "offline") -
            Number(a.availability !== "offline") ||
          a.name.localeCompare(b.name, "zh-CN"),
      );
  }
  async spectate(puuid: string) {
    const owner = this.connected();
    const friend = (await this.friends()).find((item) => item.puuid === puuid);
    if (!friend?.spectatable)
      throw new AppError(
        "该好友当前不在可观战的对局中。",
        "SPECTATE_UNAVAILABLE",
      );
    this.same(owner);
    await this.client.request("/lol-spectator/v1/spectate/launch", "POST", {
      allowObserveMode: "ALL",
      dropInSpectateGameId: "",
      gameQueueType: "",
      puuid,
    });
  }

  // —— 聊天状态与签名 ——
  async chat(): Promise<ChatStatus> {
    this.connected();
    const me = await this.client.request<any>("/lol-chat/v1/me");
    return {
      availability: chatAvailabilities.includes(me?.availability)
        ? me.availability
        : "chat",
      statusMessage: String(me?.statusMessage ?? "").slice(0, 200),
    };
  }
  async setChat(patch: Partial<ChatStatus>): Promise<ChatStatus> {
    const owner = this.connected();
    const body: Record<string, string> = {};
    if (patch.availability !== undefined) {
      if (!chatAvailabilities.includes(patch.availability))
        throw new AppError("不支持的在线状态。", "CHAT_INVALID");
      body.availability = patch.availability;
    }
    if (patch.statusMessage !== undefined)
      body.statusMessage = patch.statusMessage.slice(0, 200);
    this.same(owner);
    await this.client.request("/lol-chat/v1/me", "PUT", body);
    return this.chat();
  }
}
