<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  History,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Swords,
  Users,
  X,
} from "@lucide/vue";
import { api, unwrap } from "../api";
import ChampionIcon from "./ChampionIcon.vue";
import type {
  Catalog,
  ConnectionState,
  LiveGame,
  LivePlayer,
  Match,
  MatchPage,
  MatchPlayer,
  RankedEntry,
  SkillRating,
  Summoner,
} from "../../../shared/types";

const props = defineProps<{
  state: ConnectionState;
  catalog: Catalog;
  initialPlayer?: Summoner | null;
}>();
type PlayerTarget = { puuid: string; name: string; level: number | null };
const tab = ref<"history" | "live">("history");
const search = ref("");
const target = ref<PlayerTarget | null>(null);
const history = ref<MatchPage | null>(null);
const ranked = ref<RankedEntry[]>([]);
const rating = ref<SkillRating | null>(null);
const live = ref<LiveGame | null>(null);
const detail = ref<Match | null>(null);
const detailId = ref<string | null>(null);
const busy = ref({ history: false, search: false, live: false, detail: false });
const errors = ref({
  history: "",
  search: "",
  ranked: "",
  live: "",
  detail: "",
});
let playerEpoch = 0,
  liveEpoch = 0,
  detailEpoch = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const champions = computed(
  () => new Map(props.catalog.champions.map((hero) => [hero.id, hero])),
);
const ownName = () =>
  props.state.summoner
    ? props.state.summoner.gameName +
      (props.state.summoner.tagLine ? "#" + props.state.summoner.tagLine : "")
    : "";
const ownTarget = (): PlayerTarget | null =>
  props.state.summoner
    ? {
        puuid: props.state.summoner.puuid,
        name: ownName(),
        level: props.state.summoner.level,
      }
    : null;
const viewingOwn = computed(() =>
  Boolean(
    target.value?.puuid && target.value.puuid === props.state.summoner?.puuid,
  ),
);
const playerFor = (match: Match) =>
  match.players.find((player) => player.puuid === target.value?.puuid);
const summary = computed(() => {
  const players = (history.value?.matches ?? [])
    .filter((match) => !match.private && !match.remake && match.duration >= 240)
    .map(playerFor)
    .filter((player): player is MatchPlayer => Boolean(player));
  return {
    games: players.length,
    wins: players.filter((player) => player.win).length,
    kills: players.reduce((sum, player) => sum + player.kills, 0),
    deaths: players.reduce((sum, player) => sum + player.deaths, 0),
    assists: players.reduce((sum, player) => sum + player.assists, 0),
  };
});
const heroSummary = computed(() => {
  const rows = new Map<number, { id: number; games: number; wins: number }>();
  for (const match of history.value?.matches ?? []) {
    if (match.private || match.remake || match.duration < 240) continue;
    const player = playerFor(match);
    if (!player) continue;
    const value = rows.get(player.championId) ?? {
      id: player.championId,
      games: 0,
      wins: 0,
    };
    value.games++;
    if (player.win) value.wins++;
    rows.set(value.id, value);
  }
  return [...rows.values()].sort((a, b) => b.games - a.games).slice(0, 4);
});
const teams = computed(() =>
  [...new Set(live.value?.players.map((player) => player.teamId) ?? [])].map(
    (id) => ({
      id,
      players: live.value!.players.filter((player) => player.teamId === id),
    }),
  ),
);
const kda = (player: MatchPlayer | LivePlayer) =>
  [player.kills, player.deaths, player.assists]
    .map((value) => (value === null ? "—" : value))
    .join(" / ");
const percent = (wins: number, games: number) =>
  games ? `${((wins / games) * 100).toFixed(0)}%` : "—";
const duration = (seconds: number | null) =>
  seconds === null
    ? "—"
    : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const date = (raw: string) =>
  new Date(raw).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const mode = (raw: string | number, fallback?: string) =>
  ({
    2400: "海克斯大乱斗",
    450: "极地大乱斗",
    420: "单双排",
    440: "灵活排位",
    430: "匹配",
    400: "征召匹配",
    KIWI: "海克斯大乱斗",
    ARAM: "极地大乱斗",
    CLASSIC: "召唤师峡谷",
    hex: "海克斯大乱斗",
    aram: "极地大乱斗",
    rift: "召唤师峡谷",
  })[raw] ||
  { KIWI: "海克斯大乱斗", ARAM: "极地大乱斗", CLASSIC: "召唤师峡谷" }[
    fallback || ""
  ] ||
  String(raw || "对局");
const tier = (raw: string) =>
  ({
    IRON: "黑铁",
    BRONZE: "青铜",
    SILVER: "白银",
    GOLD: "黄金",
    PLATINUM: "铂金",
    EMERALD: "翡翠",
    DIAMOND: "钻石",
    MASTER: "大师",
    GRANDMASTER: "宗师",
    CHALLENGER: "最强王者",
  })[raw] || "未定级";
const currentContext = () =>
  `${props.state.status}:${props.state.platform}:${props.state.summoner?.puuid}`;
const isPublic = (player: LivePlayer) =>
  !player.identityHidden &&
  Boolean(player.puuid || player.riotId?.includes("#"));
function clearPlayer() {
  playerEpoch++;
  detailEpoch++;
  target.value = null;
  history.value = null;
  ranked.value = [];
  rating.value = null;
  detail.value = null;
  detailId.value = null;
  busy.value.history = false;
  busy.value.search = false;
  busy.value.detail = false;
  errors.value = {
    ...errors.value,
    history: "",
    search: "",
    ranked: "",
    detail: "",
  };
}
async function loadPlayer(value: PlayerTarget, more = false) {
  const epoch = ++playerEpoch,
    context = currentContext();
  target.value = value;
  busy.value.history = true;
  errors.value.history = "";
  errors.value.search = "";
  if (!more) {
    history.value = null;
    ranked.value = [];
    rating.value = null;
    detail.value = null;
    detailId.value = null;
    detailEpoch++;
  }
  const start = more ? (history.value?.nextIndex ?? 0) : 0;
  const valid = () =>
    epoch === playerEpoch &&
    context === currentContext() &&
    target.value?.puuid === value.puuid;
  const ranking = more
    ? Promise.resolve(null)
    : api
        .getRanked(value.puuid)
        .then((result) => {
          if (!valid()) return;
          if (result.ok) ranked.value = result.data ?? [];
          else errors.value.ranked = result.error ?? "段位读取失败";
        })
        .catch(() => {
          if (valid()) errors.value.ranked = "段位读取失败";
        });
  const position =
    more || !value.name.includes("#")
      ? Promise.resolve(null)
      : api
          .getRating(value.name)
          .then((result) => {
            if (valid() && result.ok) rating.value = result.data ?? null;
          })
          .catch(() => {});
  try {
    const result = await unwrap(api.getHistory(value.puuid, start));
    if (!valid()) return;
    const old = more ? (history.value?.matches ?? []) : [];
    history.value = {
      ...result,
      matches: [
        ...new Map(
          [...old, ...result.matches].map((match) => [match.id, match]),
        ).values(),
      ],
    };
  } catch (error) {
    if (valid()) errors.value.history = (error as Error).message;
  } finally {
    if (valid()) busy.value.history = false;
  }
  await Promise.all([ranking, position]);
}
async function showOwn() {
  const own = ownTarget();
  if (own) await loadPlayer(own);
  else {
    clearPlayer();
    errors.value.history = "请先连接并登录国服客户端。";
  }
}
async function searchPlayer() {
  if (!search.value.trim()) return;
  const epoch = ++playerEpoch,
    context = currentContext();
  busy.value.search = true;
  errors.value.search = "";
  try {
    const player = await unwrap(api.findSummoner(search.value.trim()));
    if (epoch !== playerEpoch || context !== currentContext()) return;
    await loadPlayer({
      puuid: player.puuid,
      name: player.gameName + (player.tagLine ? "#" + player.tagLine : ""),
      level: player.level,
    });
  } catch (error) {
    if (epoch === playerEpoch && context === currentContext())
      errors.value.search = (error as Error).message;
  } finally {
    if (context === currentContext()) busy.value.search = false;
  }
}
async function viewPlayer(player: MatchPlayer | LivePlayer) {
  if ("identityHidden" in player && player.identityHidden) return;
  const name = "riotId" in player ? player.riotId : player.name;
  if (player.puuid) {
    await loadPlayer({
      puuid: player.puuid,
      name: name || "公开玩家",
      level: null,
    });
    return;
  }
  if (!name?.includes("#")) return;
  search.value = name;
  await searchPlayer();
}
async function loadLive() {
  if (busy.value.live) return;
  const epoch = ++liveEpoch,
    context = currentContext();
  busy.value.live = true;
  errors.value.live = "";
  try {
    const result = await unwrap(api.getLiveGame());
    if (epoch === liveEpoch && context === currentContext())
      live.value = result;
  } catch (error) {
    if (epoch === liveEpoch && context === currentContext()) {
      live.value = null;
      errors.value.live = (error as Error).message;
    }
  } finally {
    if (epoch === liveEpoch) busy.value.live = false;
  }
}
async function openMatch(match: Match) {
  if (detailId.value === match.id) {
    detailId.value = null;
    detail.value = null;
    detailEpoch++;
    return;
  }
  const epoch = ++detailEpoch,
    context = currentContext();
  detailId.value = match.id;
  detail.value = null;
  busy.value.detail = true;
  errors.value.detail = "";
  try {
    const result = await unwrap(api.getMatch(match.id));
    if (epoch === detailEpoch && context === currentContext())
      detail.value = result;
  } catch (error) {
    if (epoch === detailEpoch && context === currentContext())
      errors.value.detail = (error as Error).message;
  } finally {
    if (epoch === detailEpoch) busy.value.detail = false;
  }
}
function refresh() {
  if (tab.value === "live") void loadLive();
  else if (target.value) void loadPlayer(target.value);
  else void showOwn();
}
defineExpose({ refresh, showOwn });
watch(
  () => [props.state.summoner?.puuid, props.state.platform, props.state.status],
  () => {
    clearPlayer();
    liveEpoch++;
    live.value = null;
    busy.value.live = false;
    if (props.state.status === "connected") {
      void showOwn();
      void loadLive();
    }
  },
);
watch(
  () => `${props.state.phase}:${props.state.mode}:${props.state.championId}`,
  () => {
    liveEpoch++;
    live.value = null;
    busy.value.live = false;
    void loadLive();
  },
);
watch(tab, (value) => {
  if (value === "live") void loadLive();
});
watch(
  () => props.initialPlayer,
  (player) => {
    if (player)
      void loadPlayer({
        puuid: player.puuid,
        name: player.gameName + (player.tagLine ? "#" + player.tagLine : ""),
        level: player.level,
      });
  },
);
onMounted(() => {
  if (props.initialPlayer) {
    const player = props.initialPlayer;
    void loadPlayer({
      puuid: player.puuid,
      name: player.gameName + (player.tagLine ? "#" + player.tagLine : ""),
      level: player.level,
    });
  } else void showOwn();
  void loadLive();
  timer = setInterval(() => {
    if (tab.value === "live") void loadLive();
  }, 5000);
});
onUnmounted(() => {
  clearInterval(timer);
  playerEpoch++;
  liveEpoch++;
  detailEpoch++;
});
</script>

<template>
  <section class="history-workspace">
    <div class="hw-toolbar">
      <div class="hw-tabs" role="tablist" aria-label="战绩视图">
        <button
          role="tab"
          :aria-selected="tab === 'history'"
          :class="{ active: tab === 'history' }"
          @click="tab = 'history'"
        >
          <History :size="16" />对局记录
        </button>
        <button
          role="tab"
          :aria-selected="tab === 'live'"
          :class="{ active: tab === 'live' }"
          @click="tab = 'live'"
        >
          <Radio :size="16" />实时对局<span
            v-if="live?.players.length"
            class="live-indicator"
          ></span>
        </button>
      </div>
      <form class="hw-search" @submit.prevent="searchPlayer">
        <Search :size="16" /><input
          v-model="search"
          aria-label="查询玩家 Riot ID"
          placeholder="游戏名#标签 · 当前大区"
        /><button type="submit" :disabled="busy.search">
          {{ busy.search ? "查询中" : "查询" }}
        </button>
      </form>
      <button class="hw-icon-button" aria-label="刷新战绩视图" @click="refresh">
        <RefreshCw
          :size="17"
          :class="{ spinning: busy.history || busy.live }"
        />
      </button>
    </div>
    <div v-if="errors.search" class="hw-notice error">
      <CircleAlert :size="16" />{{ errors.search }}
    </div>
    <div class="hw-layout">
      <main class="hw-content">
        <template v-if="tab === 'history'">
          <div class="hw-list-heading">
            <div>
              <span class="hw-kicker">MATCH HISTORY</span>
              <h2>
                {{ viewingOwn ? "我的近期对局" : target?.name || "近期对局" }}
              </h2>
            </div>
            <span>{{ history?.matches.length ?? 0 }} 场记录</span>
          </div>
          <div v-if="history?.warning" class="hw-notice">
            <CircleAlert :size="16" /><span
              >{{ history.warning }} · {{ date(history.fetchedAt) }}</span
            >
          </div>
          <div v-if="errors.history" class="hw-empty">
            <CircleAlert :size="26" />
            <h3>战绩暂未读取成功</h3>
            <p>{{ errors.history }}</p>
            <button @click="refresh">重新读取</button>
          </div>
          <div v-else-if="busy.history && !history" class="hw-empty">
            <RefreshCw class="spinning" :size="26" />
            <p>正在读取国服战绩…</p>
          </div>
          <div v-else-if="!history?.matches.length" class="hw-empty">
            <History :size="28" />
            <h3>暂无对局记录</h3>
            <p>登录客户端，或搜索同区公开玩家。</p>
          </div>
          <article
            v-for="match in history?.matches ?? []"
            :key="match.id"
            class="hw-match"
            :class="{
              win: playerFor(match)?.win,
              loss: playerFor(match) && !playerFor(match)?.win,
              expanded: detailId === match.id,
            }"
          >
            <div class="hw-match-overview">
              <div class="hw-match-result">
                <strong>{{
                  match.remake
                    ? "重开"
                    : match.private
                      ? "隐私对局"
                      : playerFor(match)
                        ? playerFor(match)?.win
                          ? "胜利"
                          : "失败"
                        : "对局"
                }}</strong
                ><span>{{ mode(match.queueId || match.mode, match.mode) }}</span
                ><small>{{ date(match.date) }}</small
                ><small>{{ duration(match.duration) }}</small>
              </div>
              <div class="hw-match-champion">
                <ChampionIcon
                  :champion="champions.get(playerFor(match)?.championId ?? 0)"
                  :size="50"
                /><span>{{
                  champions.get(playerFor(match)?.championId ?? 0)?.name ||
                  "未提供英雄"
                }}</span>
              </div>
              <div class="hw-match-kda">
                <strong>{{
                  playerFor(match) ? kda(playerFor(match)!) : "—"
                }}</strong
                ><small>K / D / A</small
                ><span v-if="playerFor(match)"
                  >{{
                    playerFor(match)!.deaths
                      ? (
                          (playerFor(match)!.kills +
                            playerFor(match)!.assists) /
                          playerFor(match)!.deaths
                        ).toFixed(2)
                      : "完美"
                  }}
                  KDA</span
                >
              </div>
              <div class="hw-match-items">
                <span
                  v-for="(id, index) in playerFor(match)?.items ?? []"
                  :key="index"
                  :title="catalog.items[id]?.name || '未提供装备'"
                  ><img
                    v-if="id && catalog.items[id]?.icon"
                    :src="catalog.items[id].icon"
                    alt=""
                  /><span v-else>{{ id ? "·" : "" }}</span></span
                >
              </div>
              <div class="hw-match-players">
                <button
                  v-for="player in match.players.slice(0, 10)"
                  :key="player.puuid || player.name + player.championId"
                  :disabled="match.private || !player.puuid"
                  :aria-label="'查看玩家 ' + player.name"
                  :title="player.name"
                  @click="viewPlayer(player)"
                >
                  <ChampionIcon
                    :champion="champions.get(player.championId)"
                    :size="22"
                  /><span>{{ player.name || "身份未公开" }}</span>
                </button>
              </div>
              <button
                class="hw-match-toggle"
                :aria-label="
                  detailId === match.id ? '收起单局详情' : '查看单局详情'
                "
                :aria-expanded="detailId === match.id"
                @click="openMatch(match)"
              >
                <ChevronDown
                  v-if="detailId === match.id"
                  :size="18"
                /><ChevronRight v-else :size="18" />
              </button>
            </div>
            <div v-if="detailId === match.id" class="hw-match-detail">
              <p v-if="busy.detail">正在读取单局详情…</p>
              <p v-else-if="errors.detail" class="error">{{ errors.detail }}</p>
              <template v-else-if="detail"
                ><div class="hw-detail-header">
                  <span>玩家 / 英雄</span><span>KDA</span><span>伤害</span
                  ><span>经济</span>
                </div>
                <button
                  v-for="player in detail.players"
                  :key="player.puuid || player.name + player.championId"
                  class="hw-detail-player"
                  :disabled="detail.private || !player.puuid"
                  :aria-label="'查看详情玩家 ' + player.name"
                  @click="viewPlayer(player)"
                >
                  <span
                    ><ChampionIcon
                      :champion="champions.get(player.championId)"
                      :size="28"
                    /><b>{{ player.name || "身份未公开" }}</b
                    ><small v-if="player.puuid === state.summoner?.puuid"
                      >我</small
                    ></span
                  ><span>{{ kda(player) }}</span
                  ><span>{{ player.damage.toLocaleString("zh-CN") }}</span
                  ><span>{{ player.gold.toLocaleString("zh-CN") }}</span>
                </button></template
              >
            </div>
          </article>
          <button
            v-if="history?.hasMore"
            class="hw-load-more"
            :disabled="busy.history"
            @click="target && loadPlayer(target, true)"
          >
            {{ busy.history ? "读取中…" : "加载更多对局"
            }}<ChevronDown :size="15" />
          </button>
        </template>
        <template v-else>
          <div class="hw-list-heading">
            <div>
              <span class="hw-kicker">LIVE GAME</span>
              <h2>实时对局</h2>
            </div>
            <span v-if="live"
              >{{ mode(live.mode) }}<i>·</i>{{ duration(live.gameTime) }}</span
            >
          </div>
          <div class="hw-live-message">
            <Radio :size="16" /><span>{{
              errors.live || live?.message || "正在读取当前对局…"
            }}</span
            ><small>每 5 秒更新</small>
          </div>
          <div v-if="!live?.players.length" class="hw-empty">
            <Users :size="30" />
            <h3>
              {{
                state.phase === "ChampSelect"
                  ? "正在同步选人信息"
                  : "等待当前对局"
              }}
            </h3>
            <p>进入选人或游戏后，自动展示公开玩家信息。</p>
            <p>身份隐藏的玩家无法查询，不推断真实身份。</p>
          </div>
          <section v-for="team in teams" :key="team.id" class="hw-live-team">
            <div class="hw-team-heading">
              <h3>
                {{
                  team.id === 100
                    ? "蓝色方"
                    : team.id === 200
                      ? "红色方"
                      : "队伍 " + team.id
                }}
              </h3>
              <span>{{ team.players.length }} 位玩家</span>
            </div>
            <button
              v-for="player in team.players"
              :key="player.key"
              class="hw-live-player"
              :disabled="!isPublic(player)"
              :aria-label="
                isPublic(player)
                  ? '查看实时玩家 ' + (player.riotId || '公开玩家')
                  : '身份隐藏，无法查询'
              "
              @click="viewPlayer(player)"
            >
              <ChampionIcon
                :champion="champions.get(player.championId)"
                :size="44"
              /><span class="hw-live-identity"
                ><b
                  >{{
                    player.identityHidden
                      ? "身份未公开"
                      : player.riotId || "公开玩家"
                  }}<small v-if="player.isSelf">我</small></b
                ><span
                  >{{ champions.get(player.championId)?.name || "尚未选择英雄"
                  }}<i v-if="player.level !== null"
                    >· Lv.{{ player.level }}</i
                  ></span
                ></span
              ><span class="hw-live-kda"
                >{{ kda(player) }}<small>K / D / A</small></span
              >
              <div class="hw-live-items">
                <img
                  v-for="(id, index) in player.items.filter(
                    (id) => id && catalog.items[id]?.icon,
                  )"
                  :key="index"
                  :src="catalog.items[id].icon"
                  :title="catalog.items[id].name"
                  alt=""
                />
              </div>
              <ChevronRight v-if="isPublic(player)" :size="16" />
            </button>
          </section>
        </template>
      </main>
      <aside class="hw-profile" aria-label="玩家详情">
        <div class="hw-profile-heading">
          <span>玩家详情</span
          ><button
            v-if="!viewingOwn"
            aria-label="返回我的战绩"
            @click="showOwn"
          >
            <ArrowLeft :size="14" />我的战绩
          </button>
        </div>
        <div class="hw-profile-avatar">
          {{ target?.name.slice(0, 1) || "?" }}
        </div>
        <h2>{{ target?.name.split("#")[0] || "等待查询" }}</h2>
        <p class="hw-profile-tag">
          {{
            target?.name.includes("#")
              ? "#" + target.name.split("#").slice(1).join("#")
              : "公开玩家信息"
          }}<span v-if="target?.level">Lv.{{ target.level }}</span>
        </p>
        <span class="hw-region"
          >{{ state.platform || "未连接大区" }} · 国服</span
        >
        <div class="hw-profile-ranks">
          <div v-for="row in ranked" :key="row.queue">
            <ShieldCheck :size="21" /><span
              ><strong>{{ tier(row.tier) }} {{ row.division }}</strong
              ><small
                >{{ row.queue === "RANKED_SOLO_5x5" ? "单双排" : "灵活排位" }} ·
                {{ row.lp }} 胜点</small
              ></span
            ><b>{{ percent(row.wins, row.wins + row.losses) }}</b>
          </div>
          <p v-if="!ranked.length">{{ errors.ranked || "暂无可显示的段位" }}</p>
        </div>
        <div class="hw-profile-position">
          <span>海斗分 <small>Hexdata</small></span
          ><strong>{{
            rating?.status === "ready" && rating.score !== null
              ? rating.score.toLocaleString("zh-CN")
              : "待接入"
          }}</strong>
          <p
            v-if="
              rating?.aramhex?.status === 'ready' &&
              rating.aramhex.percentile !== null
            "
          >
            AramHex 区内位次
            <b>前 {{ (rating.aramhex.percentile * 100).toFixed(1) }}%</b
            ><small
              >{{ rating.aramhex.games ?? "未提供" }} 场样本 ·
              {{ rating.aramhex.date?.slice(0, 10) || "日期未提供" }}</small
            >
          </p>
          <small v-else>{{
            rating?.aramhex?.message || "不同来源分别展示，不生成替代分数。"
          }}</small>
        </div>
        <div class="hw-recent-heading">
          <h3>近期表现</h3>
          <span>当前已加载有效对局</span>
        </div>
        <div class="hw-profile-stats">
          <div>
            <b>{{ percent(summary.wins, summary.games) }}</b
            ><span>近期胜率</span>
          </div>
          <div>
            <b>{{ summary.games }}</b
            ><span>有效场次</span>
          </div>
        </div>
        <div class="hw-result-track">
          <span
            v-for="match in (history?.matches ?? [])
              .filter(
                (match) => !match.private && !match.remake && playerFor(match),
              )
              .slice(0, 20)"
            :key="match.id"
            :class="playerFor(match)?.win ? 'win' : 'loss'"
            :title="playerFor(match)?.win ? '胜利' : '失败'"
          ></span>
        </div>
        <div class="hw-recent-heading">
          <h3>常用英雄</h3>
          <span>当前加载记录</span>
        </div>
        <div v-for="hero in heroSummary" :key="hero.id" class="hw-favorite">
          <ChampionIcon :champion="champions.get(hero.id)" :size="33" /><span
            ><b>{{ champions.get(hero.id)?.name || hero.id }}</b
            ><small>{{ hero.games }} 场</small></span
          ><strong>{{ percent(hero.wins, hero.games) }}</strong>
        </div>
        <p v-if="!heroSummary.length" class="hw-muted">读取战绩后展示。</p>
        <p class="hw-profile-note">
          点击历史或实时对局中的公开玩家，可在这里查看他的段位和近期战绩。
        </p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.history-workspace {
  color: var(--text);
  font-size: 13px;
}
.hw-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 22px;
}
.hw-tabs {
  display: flex;
  background: #10191d;
  border: 1px solid var(--line-strong);
  padding: 4px;
  border-radius: 8px;
  gap: 3px;
}
.hw-tabs button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  color: var(--muted);
  border-radius: 5px;
  white-space: nowrap;
}
.hw-tabs button.active {
  color: var(--gold-light);
  background: #cfb47b12;
}
.hw-search {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid var(--line-strong);
  padding: 0 12px;
  border-radius: 7px;
  background: #10191d;
  min-height: 42px;
  min-width: 250px;
}
.hw-search input {
  background: transparent;
  border: 0;
  min-width: 0;
  flex: 1;
  padding: 9px 0;
}
.hw-search button {
  color: var(--gold);
  font-size: 12px;
  white-space: nowrap;
}
.hw-icon-button {
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  padding: 10px;
  display: flex;
}
.hw-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 254px;
  gap: 20px;
  align-items: start;
}
.hw-content {
  min-width: 0;
}
.hw-list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 16px;
}
.hw-kicker {
  font-size: 9px;
  letter-spacing: 2px;
  color: var(--gold);
  font-weight: 600;
}
.hw-list-heading h2 {
  font-size: 20px;
  margin-top: 4px;
}
.hw-list-heading > span {
  font-size: 11px;
  color: var(--muted);
}
.hw-list-heading i {
  font-style: normal;
  margin: 0 8px;
}
.hw-match {
  border: 1px solid var(--line-strong);
  border-left: 3px solid #5b6970;
  border-radius: 7px;
  margin-bottom: 9px;
  background: #152027;
  overflow: hidden;
}
.hw-match.win {
  border-left-color: #72b9ad;
  background: linear-gradient(90deg, #233d3c66, #162126 50%);
}
.hw-match.loss {
  border-left-color: #b76f75;
  background: linear-gradient(90deg, #462a3266, #162126 50%);
}
.hw-match-overview {
  display: grid;
  grid-template-columns: 92px 65px 98px minmax(65px, 1fr) 132px 24px;
  gap: 10px;
  align-items: center;
  padding: 13px 9px 13px 13px;
}
.hw-match-result {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hw-match-result strong {
  font-size: 13px;
}
.win .hw-match-result strong {
  color: #8bd3c1;
}
.loss .hw-match-result strong {
  color: #df9398;
}
.hw-match-result span {
  font-size: 11px;
  color: var(--secondary);
}
.hw-match-result small {
  font-size: 10px;
  color: var(--muted);
}
.hw-match-champion {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 4px;
}
.hw-match-champion > span {
  font-size: 10px;
  color: var(--secondary);
}
.hw-match-kda {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.hw-match-kda strong {
  font-size: 15px;
  letter-spacing: 0.2px;
  white-space: nowrap;
}
.hw-match-kda small {
  font-size: 9px;
  color: var(--muted);
  letter-spacing: 1px;
}
.hw-match-kda > span {
  font-size: 11px;
  color: var(--secondary);
}
.hw-match-items {
  display: grid;
  grid-template-columns: repeat(4, 23px);
  gap: 3px;
}
.hw-match-items > span {
  display: flex;
  width: 23px;
  height: 23px;
  background: #07121777;
  border: 1px solid #c1d0ce10;
  border-radius: 3px;
  align-items: center;
  justify-content: center;
}
.hw-match-items img {
  width: 100%;
  border-radius: 2px;
}
.hw-match-players {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px 8px;
}
.hw-match-players button {
  display: flex;
  gap: 4px;
  align-items: center;
  min-width: 0;
  padding: 0;
  text-align: left;
}
.hw-match-players button > span:last-child {
  font-size: 9px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--secondary);
}
.hw-match-players button:hover > span:last-child {
  color: var(--gold-light);
}
.hw-match-players button:disabled {
  cursor: default;
  opacity: 0.7;
}
.hw-match-toggle {
  padding: 4px 0;
  color: var(--muted);
}
.hw-match-detail {
  border-top: 1px solid var(--line-strong);
  padding: 13px;
  background: #07121744;
}
.hw-match-detail > p {
  font-size: 12px;
  color: var(--muted);
}
.hw-detail-header,
.hw-detail-player {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 95px 65px 65px;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.hw-detail-header {
  font-size: 10px;
  color: var(--muted);
  padding-bottom: 8px;
}
.hw-detail-player {
  padding: 6px 0;
  border-top: 1px solid #ffffff06;
  text-align: left;
  font-size: 11px;
}
.hw-detail-player:hover {
  background: #cfb47b0a;
}
.hw-detail-player > span:first-child {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.hw-detail-player b {
  font-weight: 400;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hw-detail-player small,
.hw-live-identity b small {
  font-size: 9px;
  color: var(--green);
  background: #91c9b31a;
  border-radius: 3px;
  padding: 0 4px;
}
.hw-load-more {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  padding: 11px;
  color: var(--secondary);
  margin-top: 15px;
}
.hw-profile {
  background: #141e23;
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  padding: 17px;
  position: sticky;
  top: 18px;
  text-align: center;
}
.hw-profile-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 20px;
}
.hw-profile-heading button {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--gold);
  font-size: 10px;
}
.hw-profile-avatar {
  width: 63px;
  height: 63px;
  display: grid;
  place-content: center;
  background: radial-gradient(at 30% 20%, #385054, #14252d);
  border: 1px solid #cfb47b88;
  box-shadow: 0 0 0 4px #cfb47b08;
  border-radius: 50%;
  font-size: 26px;
  color: var(--gold-light);
  margin: 0 auto 13px;
}
.hw-profile h2 {
  font-size: 19px;
  overflow-wrap: anywhere;
}
.hw-profile-tag {
  font-size: 11px;
  color: var(--muted);
  margin-top: 3px;
}
.hw-profile-tag span {
  margin-left: 9px;
}
.hw-region {
  display: inline-block;
  margin-top: 10px;
  font-size: 10px;
  letter-spacing: 0.3px;
  color: var(--secondary);
  border: 1px solid var(--line-strong);
  padding: 1px 7px;
  border-radius: 3px;
}
.hw-profile-ranks {
  margin: 22px -4px;
  border-top: 1px solid var(--line-strong);
  border-bottom: 1px solid var(--line-strong);
  padding: 10px 0;
}
.hw-profile-ranks > div {
  display: flex;
  gap: 9px;
  align-items: center;
  text-align: left;
  padding: 7px 3px;
}
.hw-profile-ranks svg {
  color: var(--gold);
}
.hw-profile-ranks strong {
  font-size: 12px;
  font-weight: 500;
}
.hw-profile-ranks small {
  display: block;
  font-size: 10px;
  color: var(--muted);
  margin-top: 1px;
}
.hw-profile-ranks b {
  margin-left: auto;
  font-size: 11px;
  font-weight: 500;
  color: var(--secondary);
}
.hw-profile-ranks > p {
  font-size: 11px;
  color: var(--muted);
  padding: 6px;
}
.hw-recent-heading {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 17px 0 11px;
}
.hw-recent-heading h3 {
  font-size: 12px;
  font-weight: 500;
}
.hw-recent-heading > span {
  font-size: 9px;
  color: var(--muted);
}
.hw-profile-stats {
  display: flex;
  justify-content: space-around;
  gap: 10px;
}
.hw-profile-stats > div {
  display: flex;
  flex-direction: column;
}
.hw-profile-stats b {
  font-size: 25px;
  font-weight: 500;
  color: var(--gold-light);
  line-height: 1.4;
}
.hw-profile-stats span {
  font-size: 10px;
  color: var(--muted);
}
.hw-result-track {
  display: flex;
  gap: 3px;
  margin: 12px 0 22px;
}
.hw-result-track > span {
  height: 5px;
  flex: 1;
  border-radius: 1px;
  max-width: 15px;
}
.hw-result-track .win {
  background: #6eaf9f;
}
.hw-result-track .loss {
  background: #aa6870;
}
.hw-favorite {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 0;
  text-align: left;
}
.hw-favorite > span {
  display: flex;
  flex-direction: column;
}
.hw-favorite b {
  font-size: 11px;
  font-weight: 500;
}
.hw-favorite small {
  font-size: 10px;
  color: var(--muted);
}
.hw-favorite > strong {
  margin-left: auto;
  font-size: 12px;
  color: var(--secondary);
  font-weight: 500;
}
.hw-profile-note {
  font-size: 10px;
  color: var(--muted);
  text-align: left;
  line-height: 1.8;
  margin-top: 18px;
  border-top: 1px solid var(--line-strong);
  padding-top: 13px;
}
.hw-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--secondary);
  border: 1px solid var(--line-strong);
  background: #cfb47b08;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 12px;
  margin-bottom: 12px;
}
.error {
  color: #df9398;
}
.hw-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 275px;
  text-align: center;
  color: var(--muted);
  border: 1px dashed var(--line-strong);
  border-radius: 8px;
  padding: 25px;
}
.hw-empty h3 {
  font-weight: 500;
  font-size: 15px;
  color: var(--secondary);
}
.hw-empty p {
  font-size: 12px;
  max-width: 460px;
}
.hw-empty button {
  color: var(--gold);
  border: 1px solid #cfb47b33;
  border-radius: 5px;
  padding: 6px 12px;
}
.hw-live-message {
  display: flex;
  gap: 9px;
  align-items: center;
  color: var(--secondary);
  font-size: 12px;
  margin-bottom: 18px;
}
.hw-live-message svg,
.live-indicator {
  color: var(--green);
}
.hw-live-message small {
  margin-left: auto;
  font-size: 10px;
  color: var(--muted);
}
.live-indicator {
  width: 5px;
  height: 5px;
  background: var(--green);
  border-radius: 50%;
}
.hw-live-team {
  background: #141f24;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 16px;
}
.hw-team-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #cfb47b06;
  border-bottom: 1px solid var(--line-strong);
  padding: 11px 15px;
}
.hw-team-heading h3 {
  font-size: 12px;
  color: var(--gold-light);
  font-weight: 500;
}
.hw-team-heading span {
  font-size: 10px;
  color: var(--muted);
}
.hw-live-player {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 15px;
  width: 100%;
  text-align: left;
  border-bottom: 1px solid #ffffff06;
  min-height: 72px;
}
.hw-live-player:last-child {
  border-bottom: 0;
}
.hw-live-player:hover:not(:disabled) {
  background: #cfb47b09;
}
.hw-live-player:disabled {
  opacity: 0.68;
  cursor: default;
}
.hw-live-identity {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.hw-live-identity b {
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hw-live-identity b small {
  margin-left: 6px;
}
.hw-live-identity > span {
  font-size: 10px;
  color: var(--muted);
}
.hw-live-identity i {
  font-style: normal;
  margin-left: 4px;
}
.hw-live-kda {
  font-size: 13px;
  text-align: center;
  min-width: 90px;
}
.hw-live-kda small {
  display: block;
  font-size: 9px;
  letter-spacing: 1px;
  color: var(--muted);
  margin-top: 3px;
}
.hw-live-items {
  display: flex;
  gap: 3px;
  width: 125px;
  flex-wrap: wrap;
}
.hw-live-items img {
  width: 22px;
  height: 22px;
  border-radius: 3px;
}
.hw-muted {
  font-size: 11px;
  color: var(--muted);
}
.hw-profile-position {
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  padding: 10px;
  text-align: left;
  margin: 16px 0;
}
.hw-profile-position > span {
  font-size: 11px;
  color: var(--secondary);
}
.hw-profile-position > span small {
  font-size: 9px;
  color: var(--muted);
  margin-left: 4px;
}
.hw-profile-position > strong {
  float: right;
  font-size: 12px;
  color: var(--gold-light);
  font-weight: 500;
}
.hw-profile-position p {
  font-size: 10px;
  color: var(--secondary);
  margin-top: 10px;
}
.hw-profile-position p b {
  float: right;
  font-size: 12px;
  color: var(--green);
  font-weight: 500;
}
.hw-profile-position small {
  display: block;
  font-size: 9px;
  color: var(--muted);
  margin-top: 4px;
}
.hw-profile-position > span small {
  display: inline;
}
@media (max-width: 1200px) {
  .hw-layout {
    grid-template-columns: minmax(0, 1fr) 225px;
    gap: 14px;
  }
  .hw-match-overview {
    grid-template-columns: 81px 55px 88px minmax(60px, 1fr) 24px;
    gap: 8px;
  }
  .hw-match-players {
    display: none;
  }
  .hw-match-items {
    grid-template-columns: repeat(3, 22px);
  }
  .hw-live-items {
    width: 75px;
  }
  .hw-search {
    min-width: 200px;
  }
  .hw-tabs button {
    padding: 9px 10px;
  }
}
@media (max-width: 800px) {
  .hw-toolbar {
    flex-wrap: wrap;
  }
  .hw-search {
    order: 3;
    width: 100%;
  }
  .hw-layout {
    grid-template-columns: 1fr;
  }
  .hw-profile {
    position: static;
  }
  .hw-match-overview {
    grid-template-columns: 78px 52px 88px minmax(55px, 1fr) 22px;
  }
  .hw-match-items {
    grid-template-columns: repeat(3, 20px);
  }
  .hw-match-items > span {
    width: 20px;
    height: 20px;
  }
  .hw-live-items {
    display: none;
  }
}
</style>
