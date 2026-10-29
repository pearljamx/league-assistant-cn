import type { Match, MatchPage, MatchPlayer } from "../../shared/types";
import { AppError } from "../errors";
import { jsonRequest } from "../http";
import type { Client } from "../client";
import type { Storage } from "../storage";

export const shardHosts: Record<string, string> = {
  HN1: "hn1-k8s-sgp",
  HN10: "hn10-k8s-sgp",
  TJ100: "tj100-sgp",
  TJ101: "tj101-sgp",
  NJ100: "nj100-sgp",
  GZ100: "gz100-sgp",
  CQ100: "cq100-sgp",
  BGP2: "bgp2-k8s-sgp",
};
export function normalizeMatch(raw: any): Match | null {
  const game = raw?.json ?? raw;
  if (!game || !Number(game.gameId) || !Array.isArray(game.participants))
    return null;
  const identities = new Map<number, any>(
    (game.participantIdentities ?? []).map((item: any) => [
      item.participantId,
      item.player,
    ]),
  );
  const players: MatchPlayer[] = game.participants.map((participant: any) => {
    const stats = participant.stats ?? participant;
    const identity = identities.get(participant.participantId) ?? participant;
    const name =
      identity.riotIdGameName ||
      identity.gameName ||
      identity.summonerName ||
      "";
    const tag = identity.riotIdTagline || identity.tagLine || "";
    return {
      puuid: String(identity.puuid || participant.puuid || ""),
      name: name + (tag ? "#" + tag : ""),
      championId: Number(participant.championId || 0),
      teamId: Number(participant.teamId || 0),
      win: stats.win === true || stats.win === "Win",
      kills: Number(stats.kills || 0),
      deaths: Number(stats.deaths || 0),
      assists: Number(stats.assists || 0),
      items: Array.from({ length: 7 }, (_, i) =>
        Number(stats["item" + i] || 0),
      ).filter(Boolean),
      damage: Number(stats.totalDamageDealtToChampions || 0),
      gold: Number(stats.goldEarned || 0),
      cs:
        Number(stats.totalMinionsKilled || 0) +
        Number(stats.neutralMinionsKilled || 0),
      level: Number(stats.champLevel || 0) || undefined,
      damageTaken: Number(stats.totalDamageTaken || 0),
      augments: [1, 2, 3, 4, 5, 6]
        .map((index) => Number(stats["playerAugment" + index] || 0))
        .filter((id) => Number.isInteger(id) && id > 0),
    };
  });
  const timestamp = Number(game.gameCreation ?? 0);
  return {
    id: String(game.gameId),
    queueId: Number(game.queueId || 0),
    mode: String(game.gameMode || ""),
    date:
      timestamp > 0 && Number.isFinite(timestamp)
        ? new Date(timestamp).toISOString()
        : "",
    duration: Number(game.gameDuration || 0),
    players,
    private: Boolean(
      raw.private ||
        game.gameType === "CUSTOM_GAME" ||
        game.gameType === "TUTORIAL_GAME",
    ),
    remake:
      players.length > 0 &&
      game.participants.some((player: any) =>
        Boolean((player.stats ?? player).gameEndedInEarlySurrender),
      ),
  };
}
export function uniqueMatches(matches: Match[]) {
  return [...new Map(matches.map((match) => [match.id, match])).values()];
}
export class HistoryProvider {
  private pending = new Map<string, Promise<MatchPage>>();
  constructor(
    private client: Client,
    private storage: Storage,
  ) {}
  private assertSession(owner: string, platform: string | null) {
    if (
      this.client.state.status !== "connected" ||
      this.client.state.summoner?.puuid !== owner ||
      this.client.state.platform !== platform
    )
      throw new AppError(
        "账号、大区或连接已变化，请重新查询。",
        "ACCOUNT_CHANGED",
      );
  }
  async history(puuid: string, start: number): Promise<MatchPage> {
    const owner = this.client.state.summoner?.puuid;
    const platform = this.client.state.platform;
    if (!owner || this.client.state.status !== "connected")
      throw new AppError("请先连接并登录客户端。", "CLIENT_OFFLINE");
    const key = `history-v2:${platform}:${owner}:${puuid}:${start}`;
    const cached = await this.storage.cache<MatchPage>(key);
    this.assertSession(owner, platform);
    if (cached && Date.now() - cached.at < 60000)
      return {
        ...cached.data,
        source: "cache",
        warning: "最近一分钟的本地缓存",
      };
    const running = this.pending.get(key);
    if (running) return running;
    const request = this.fetch(puuid, start, owner)
      .then(async (page) => {
        // A late reply from an old account must not enter the current session's cache.
        this.assertSession(owner, platform);
        await this.storage.put(key, page);
        await Promise.all(
          page.matches.map((match) =>
            this.storage.put(
              `match-v2:${platform}:${owner}:${match.id}`,
              match,
            ),
          ),
        );
        this.assertSession(owner, platform);
        return page;
      })
      .catch((error) => {
        this.assertSession(owner, platform);
        if (cached)
          return {
            ...cached.data,
            source: "cache" as const,
            warning: "服务暂不可用，显示上次成功查询的缓存；时间见下方。",
          };
        throw error;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
  private async fetch(
    puuid: string,
    start: number,
    owner: string,
  ): Promise<MatchPage> {
    const host = shardHosts[this.client.state.platform ?? ""];
    let lastError: unknown;
    if (host) {
      for (const count of [20, 2]) {
        try {
          const [token, version] = await Promise.all([
            this.client.request("/entitlements/v1/token"),
            this.client.request<string>("/lol-patch/v1/game-version"),
          ]);
          const versionNumber = version.match(/^[\d.]+/)?.[0] ?? "";
          const response = await jsonRequest<any>(
            `https://${host}.lol.qq.com:21019/match-history-query/v1/products/lol/player/${encodeURIComponent(puuid)}/SUMMARY?startIndex=${start}&count=${count}`,
            {
              timeout: 6500,
              headers: {
                Authorization: "Bearer " + token.accessToken,
                "User-Agent": `LeagueOfLegendsClient/${versionNumber} (rcp-be-lol-match-history)`,
              },
            },
          );
          if (!Array.isArray(response.games))
            throw new AppError("战绩服务的数据结构有变化。", "HISTORY_FORMAT");
          const matches = response.games
            .map(normalizeMatch)
            .filter((match: Match | null): match is Match =>
              Boolean(match && (!match.private || puuid === owner)),
            );
          return {
            matches: uniqueMatches(matches),
            nextIndex: start + response.games.length,
            hasMore: response.games.length === count,
            source: "sgp",
            warning: count === 2 ? "服务繁忙，暂以每页 2 场读取。" : null,
            fetchedAt: new Date().toISOString(),
          };
        } catch (error) {
          lastError = error;
          if (
            !(error instanceof AppError) ||
            ![503, 502, 504].includes(error.status ?? 0)
          )
            break;
        }
      }
    }
    // Tencent's LCU ignores page offsets. Only the first page is a truthful fallback.
    if (start === 0) {
      const paths = [
        `/lol-match-history/v1/products/lol/${encodeURIComponent(puuid)}/matches?begIndex=0&endIndex=19`,
      ];
      if (puuid === owner)
        paths.push(
          "/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=19",
        );
      for (const path of paths) {
        try {
          const response = await this.client.request(path);
          const raw = Array.isArray(response.games)
            ? response.games
            : response.games?.games;
          if (!Array.isArray(raw))
            throw new AppError("客户端没有返回可用战绩。", "HISTORY_FORMAT");
          const matches = raw
            .map(normalizeMatch)
            .filter((match: Match | null): match is Match =>
              Boolean(match && (!match.private || puuid === owner)),
            );
          return {
            matches: uniqueMatches(matches),
            nextIndex: raw.length,
            hasMore: false,
            source: "lcu",
            warning:
              "大区服务暂不可用，仅显示客户端最近窗口；此来源不支持可靠翻页。",
            fetchedAt: new Date().toISOString(),
          };
        } catch (error) {
          lastError = error;
        }
      }
    }
    throw (
      lastError ??
      new AppError("该大区尚无可用的完整战绩服务。", "HISTORY_UNAVAILABLE")
    );
  }
  async match(id: string): Promise<Match> {
    const owner = this.client.state.summoner?.puuid;
    const platform = this.client.state.platform;
    if (!owner || this.client.state.status !== "connected")
      throw new AppError("请先登录客户端。", "CLIENT_OFFLINE");
    const key = `match-v2:${platform}:${owner}:${id}`;
    const cached = await this.storage.cache<Match>(key);
    this.assertSession(owner, platform);
    if (cached?.data.players.length === 10) return cached.data;
    const match = normalizeMatch(
      await this.client.request(`/lol-match-history/v1/games/${id}`),
    );
    this.assertSession(owner, platform);
    if (!match) throw new AppError("单局详情尚未生成。", "NO_DATA");
    if (
      match.private &&
      !match.players.some((player) => player.puuid === owner)
    )
      throw new AppError("该自定义对局不属于当前账号。", "PRIVATE_MATCH");
    await this.storage.put(key, match);
    this.assertSession(owner, platform);
    return match;
  }
}
