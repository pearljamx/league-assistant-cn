<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Filter,
  History,
  RefreshCw,
  ShieldCheck,
  Tag,
  Users,
} from "@lucide/vue";
import { api, unwrap } from "../../api";
import ChampionIcon from "../ChampionIcon.vue";
import {
  activeTab,
  catalog,
  notify,
  openPlayer,
  state,
  type PlayerTarget,
} from "../../store";
import {
  date,
  duration,
  matchMode,
  playerTagList,
  playerTagNames,
  queueGroups,
  ratio as percent,
  tierName as tier,
} from "../../format";
import type {
  EncounterSummary,
  Match,
  MatchPage,
  MatchPlayer,
  PlayerNote,
  PlayerTag,
  RankedEntry,
  SkillRating,
} from "../../../../shared/types";

// 一个玩家标签：各自保存战绩、筛选、展开和资料；标签关闭或换账号时整体卸载。
const props = defineProps<{
  target: PlayerTarget | null;
  own: boolean;
  active: boolean;
}>();
const history = ref<MatchPage | null>(null);
const ranked = ref<RankedEntry[]>([]);
const rating = ref<SkillRating | null>(null);
const detail = ref<Match | null>(null);
const detailId = ref<string | null>(null);
const busy = ref({ history: false, detail: false, note: false });
const errors = ref({ history: "", ranked: "", detail: "", note: "" });
const note = ref<PlayerNote | null>(null);
const draft = ref<{ tag: PlayerTag | null; note: string }>({
  tag: null,
  note: "",
});
const encounters = ref<EncounterSummary | null>(null);
const filter = ref<{
  queue: (typeof queueGroups)[number]["id"];
  result: "all" | "win" | "loss";
  champion: number;
}>({ queue: "all", result: "all", champion: 0 });
let playerEpoch = 0,
  detailEpoch = 0;
const champions = computed(
  () => new Map(catalog.value.champions.map((hero) => [hero.id, hero])),
);
const playerFor = (match: Match) =>
  match.players.find((player) => player.puuid === props.target?.puuid);
const counted = (match: Match) =>
  !match.private && !match.remake && match.duration >= 240;
const filtering = computed(
  () =>
    filter.value.queue !== "all" ||
    filter.value.result !== "all" ||
    filter.value.champion !== 0,
);
/** 只在已加载的对局里筛选；要看更早的对局请继续“加载更多”。 */
const shown = computed(() =>
  (history.value?.matches ?? []).filter((match) => {
    const group = queueGroups.find((item) => item.id === filter.value.queue);
    if (group && !group.test(match)) return false;
    const player = playerFor(match);
    if (filter.value.result !== "all") {
      if (!player || match.remake || match.private) return false;
      if (player.win !== (filter.value.result === "win")) return false;
    }
    if (filter.value.champion && player?.championId !== filter.value.champion)
      return false;
    return true;
  }),
);
const summary = computed(() => {
  const players = shown.value
    .filter(counted)
    .map(playerFor)
    .filter((player): player is MatchPlayer => Boolean(player));
  const kills = players.reduce((sum, player) => sum + player.kills, 0),
    deaths = players.reduce((sum, player) => sum + player.deaths, 0),
    assists = players.reduce((sum, player) => sum + player.assists, 0);
  return {
    games: players.length,
    wins: players.filter((player) => player.win).length,
    kda: players.length
      ? deaths
        ? ((kills + assists) / deaths).toFixed(2)
        : "完美"
      : "—",
  };
});
const championOptions = computed(() => {
  const ids = new Set<number>();
  for (const match of history.value?.matches ?? []) {
    const id = playerFor(match)?.championId;
    if (id) ids.add(id);
  }
  return [...ids].sort((a, b) =>
    (champions.value.get(a)?.name ?? "").localeCompare(
      champions.value.get(b)?.name ?? "",
      "zh-CN",
    ),
  );
});
const heroSummary = computed(() => {
  const rows = new Map<number, { id: number; games: number; wins: number }>();
  for (const match of history.value?.matches ?? []) {
    if (!counted(match)) continue;
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
/** 已加载对局里与该玩家同队至少两次的公开玩家（可能是常一起玩的朋友）。 */
const teammates = computed(() => {
  const rows = new Map<
    string,
    { puuid: string; name: string; games: number; wins: number }
  >();
  for (const match of history.value?.matches ?? []) {
    if (!counted(match)) continue;
    const self = playerFor(match);
    if (!self) continue;
    for (const player of match.players) {
      if (
        player.puuid === self.puuid ||
        !player.puuid ||
        player.teamId !== self.teamId
      )
        continue;
      const row = rows.get(player.puuid) ?? {
        puuid: player.puuid,
        name: player.name,
        games: 0,
        wins: 0,
      };
      row.games++;
      if (self.win) row.wins++;
      rows.set(player.puuid, row);
    }
  }
  return [...rows.values()]
    .filter((row) => row.games >= 2)
    .sort((a, b) => b.games - a.games)
    .slice(0, 5);
});
const encounterStats = computed(() => {
  const games = encounters.value?.games ?? [];
  const together = games.filter((game) => game.sameTeam),
    against = games.filter((game) => !game.sameTeam);
  return {
    together: together.length,
    togetherWins: together.filter((game) => game.win).length,
    against: against.length,
    againstWins: against.filter((game) => game.win).length,
  };
});
const resultOptions = [
  { id: "all", name: "全部" },
  { id: "win", name: "胜" },
  { id: "loss", name: "负" },
] as const;
function resetFilter() {
  filter.value = { queue: "all", result: "all", champion: 0 };
}
function showOwnTab() {
  activeTab.value = "self";
}
const kda = (player: MatchPlayer) =>
  [player.kills, player.deaths, player.assists].join(" / ");
const currentContext = () =>
  `${state.value.status}:${state.value.platform}:${state.value.summoner?.puuid}`;

async function loadPlayer(more = false) {
  const value = props.target;
  if (!value) {
    errors.value.history = "请先连接并登录国服客户端。";
    return;
  }
  const epoch = ++playerEpoch,
    context = currentContext();
  busy.value.history = true;
  errors.value.history = "";
  if (!more) {
    history.value = null;
    ranked.value = [];
    rating.value = null;
    detail.value = null;
    detailId.value = null;
    detailEpoch++;
  }
  const start = more ? (history.value?.nextIndex ?? 0) : 0;
  const valid = () => epoch === playerEpoch && context === currentContext();
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
async function loadExtras() {
  const value = props.target;
  if (!value || props.own) return;
  const epoch = playerEpoch,
    context = currentContext();
  const [noteResult, encounterResult] = await Promise.all([
    api.getPlayerNote(value.puuid),
    api.getEncounters(value.puuid),
  ]);
  if (epoch !== playerEpoch || context !== currentContext()) return;
  if (noteResult.ok) {
    note.value = noteResult.data ?? null;
    draft.value = {
      tag: note.value?.tag ?? null,
      note: note.value?.note ?? "",
    };
  }
  if (encounterResult.ok) encounters.value = encounterResult.data ?? null;
}
async function saveNote(clear = false) {
  const value = props.target;
  if (!value) return;
  busy.value.note = true;
  errors.value.note = "";
  try {
    note.value = await unwrap(
      api.savePlayerNote({
        puuid: value.puuid,
        name: value.name.slice(0, 64),
        tag: clear ? null : draft.value.tag,
        note: clear ? "" : draft.value.note.slice(0, 200),
      }),
    );
    if (clear) draft.value = { tag: null, note: "" };
    notify(clear ? "已清除玩家标记" : "已保存玩家标记（仅本机）");
  } catch (error) {
    errors.value.note = (error as Error).message;
  } finally {
    busy.value.note = false;
  }
}
function viewPlayer(player: MatchPlayer) {
  if (!player.puuid) return;
  openPlayer({
    puuid: player.puuid,
    name: player.name || "公开玩家",
    level: null,
  });
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
  void loadPlayer();
  void loadExtras();
}
watch(
  () => filter.value.champion,
  (id) => {
    if (id && !championOptions.value.includes(id)) filter.value.champion = 0;
  },
);
onMounted(() => {
  void loadPlayer();
  void loadExtras();
});
onUnmounted(() => {
  playerEpoch++;
  detailEpoch++;
});
</script>

<template>
  <section :class="['history-workspace', 'player-tab', { active }]">
    <div class="hw-layout">
      <main class="hw-content">
        <div class="hw-list-heading">
          <div>
            <span class="hw-kicker">MATCH HISTORY</span>
            <h2>
              {{ own ? "我的近期对局" : target?.name || "近期对局" }}
            </h2>
          </div>
          <span class="hw-list-count"
            >{{ history?.matches.length ?? 0 }} 场记录<button
              class="hw-icon-button"
              aria-label="刷新战绩视图"
              @click="refresh"
            >
              <RefreshCw
                :size="16"
                :class="{ spinning: busy.history }"
              /></button
          ></span>
        </div>
        <div
          v-if="history?.matches.length"
          class="hw-filters"
          aria-label="战绩筛选"
        >
          <Filter :size="14" />
          <div class="hw-chip-group" role="group" aria-label="模式筛选">
            <button
              v-for="group in queueGroups"
              :key="group.id"
              :class="{ active: filter.queue === group.id }"
              :aria-pressed="filter.queue === group.id"
              @click="filter.queue = group.id"
            >
              {{ group.name }}
            </button>
          </div>
          <div class="hw-chip-group" role="group" aria-label="胜负筛选">
            <button
              v-for="item in resultOptions"
              :key="item.id"
              :class="{ active: filter.result === item.id }"
              :aria-pressed="filter.result === item.id"
              @click="filter.result = item.id"
            >
              {{ item.name }}
            </button>
          </div>
          <select v-model.number="filter.champion" aria-label="英雄筛选">
            <option :value="0">全部英雄</option>
            <option v-for="id in championOptions" :key="id" :value="id">
              {{ champions.get(id)?.name || id }}
            </option>
          </select>
          <span class="hw-filter-summary"
            >{{ filtering ? "筛选后" : "已加载" }} {{ summary.games }} 场有效 ·
            胜率 {{ percent(summary.wins, summary.games) }} · 场均 KDA
            {{ summary.kda }}</span
          >
          <button v-if="filtering" class="hw-filter-reset" @click="resetFilter">
            清除筛选
          </button>
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
          <p>登录客户端，或在顶部搜索同区公开玩家。</p>
        </div>
        <div v-else-if="!shown.length" class="hw-empty">
          <Filter :size="26" />
          <h3>已加载的对局里没有符合筛选的记录</h3>
          <p>可以清除筛选，或继续加载更早的对局。</p>
        </div>
        <article
          v-for="match in shown"
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
              ><span>{{ matchMode(match) }}</span
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
                        (playerFor(match)!.kills + playerFor(match)!.assists) /
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
          @click="loadPlayer(true)"
        >
          {{ busy.history ? "读取中…" : "加载更多对局"
          }}<ChevronDown :size="15" />
        </button>
      </main>
      <aside class="hw-profile" aria-label="玩家详情">
        <div class="hw-profile-heading">
          <span>玩家详情</span
          ><button v-if="!own" aria-label="返回我的战绩" @click="showOwnTab">
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
        <span v-if="note?.tag" :class="['hw-player-tag', note.tag]">{{
          playerTagNames[note.tag]
        }}</span>
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
        <template v-if="!own && target">
          <div class="hw-recent-heading">
            <h3><Tag :size="13" />玩家标记</h3>
            <span>仅保存在本机</span>
          </div>
          <div class="hw-note">
            <div class="hw-chip-group" role="group" aria-label="玩家标签">
              <button
                v-for="item in playerTagList"
                :key="item.id"
                :class="[item.id, { active: draft.tag === item.id }]"
                :aria-pressed="draft.tag === item.id"
                @click="draft.tag = draft.tag === item.id ? null : item.id"
              >
                {{ item.name }}
              </button>
            </div>
            <textarea
              v-model="draft.note"
              maxlength="200"
              rows="2"
              aria-label="玩家备注"
              placeholder="备注，例如：喜欢玩辅助、沟通友好"
            ></textarea>
            <div class="hw-note-actions">
              <button
                class="hw-note-save"
                :disabled="busy.note"
                @click="saveNote()"
              >
                保存标记
              </button>
              <button v-if="note" :disabled="busy.note" @click="saveNote(true)">
                清除
              </button>
            </div>
            <p v-if="errors.note" class="error">{{ errors.note }}</p>
          </div>
          <div class="hw-recent-heading">
            <h3>遇到过</h3>
            <span>来自你的战绩记录</span>
          </div>
          <div v-if="encounters?.total" class="hw-encounters">
            <p>
              同局 <b>{{ encounters.total }}</b> 场 · 队友
              {{ encounterStats.together }} 场（你胜
              {{ encounterStats.togetherWins }}）· 对手
              {{ encounterStats.against }} 场（你胜
              {{ encounterStats.againstWins }}）
            </p>
            <div
              v-for="game in encounters.games.slice(0, 5)"
              :key="game.matchId"
              :class="['hw-encounter', game.win ? 'win' : 'loss']"
            >
              <ChampionIcon
                :champion="champions.get(game.theirChampionId)"
                :size="24"
              /><span class="hw-encounter-text"
                ><b>{{ game.sameTeam ? "队友" : "对手" }}</b
                >{{ matchMode(game) }} · {{ date(game.date) }}</span
              ><small>{{ game.win ? "你胜" : "你负" }}</small>
            </div>
          </div>
          <p v-else class="hw-muted">
            你已加载的战绩里没有与该玩家同局的记录。
          </p>
        </template>
        <div class="hw-recent-heading">
          <h3>近期表现</h3>
          <span>当前已加载有效对局</span>
        </div>
        <div class="hw-profile-stats">
          <div>
            <b>{{ percent(summary.wins, summary.games) }}</b
            ><span>{{ filtering ? "筛选胜率" : "近期胜率" }}</span>
          </div>
          <div>
            <b>{{ summary.games }}</b
            ><span>有效场次</span>
          </div>
        </div>
        <div class="hw-result-track">
          <span
            v-for="match in shown
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
        <template v-if="teammates.length">
          <div class="hw-recent-heading">
            <h3><Users :size="13" />常一起玩</h3>
            <span>已加载对局里同队 ≥2 场</span>
          </div>
          <button
            v-for="mate in teammates"
            :key="mate.puuid"
            class="hw-teammate"
            :aria-label="'查看常一起玩的玩家 ' + mate.name"
            @click="
              openPlayer({ puuid: mate.puuid, name: mate.name, level: null })
            "
          >
            <span>{{ mate.name || "公开玩家" }}</span
            ><small
              >{{ mate.games }} 场 · 胜率
              {{ percent(mate.wins, mate.games) }}</small
            >
          </button>
        </template>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.history-workspace {
  color: var(--text);
  font-size: 13px;
}
.hw-icon-button {
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  padding: 6px;
  display: flex;
  color: var(--secondary);
}
.hw-icon-button:hover {
  color: var(--text);
  background: #ffffff08;
}
.hw-list-count {
  display: flex;
  align-items: center;
  gap: 10px;
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
.hw-detail-player small {
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
}
@media (max-width: 800px) {
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
}
.hw-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: -4px 0 14px;
  padding: 9px 11px;
  border-radius: 8px;
  background: #141e22;
  border: 1px solid var(--line);
  color: var(--muted);
}
.hw-chip-group {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 6px;
  background: #0f171a;
}
.hw-chip-group button {
  padding: 3px 9px;
  border-radius: 4px;
  font-size: 11px;
  color: var(--muted);
}
.hw-chip-group button:hover {
  color: var(--text);
}
.hw-chip-group button.active {
  color: var(--gold-light);
  background: #cfb47b1c;
}
.hw-filters select {
  min-height: 28px;
  padding: 3px 26px 3px 9px;
  font-size: 11px;
}
.hw-filter-summary {
  margin-left: auto;
  font-size: 11px;
  color: var(--secondary);
}
.hw-filter-reset {
  font-size: 11px;
  color: var(--gold);
}
.hw-player-tag {
  display: inline-block;
  margin-top: 8px;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 11px;
}
.hw-player-tag.good,
.hw-note .hw-chip-group button.good.active {
  color: #10201a;
  background: #91c9b3;
}
.hw-player-tag.friend,
.hw-note .hw-chip-group button.friend.active {
  color: #1b1408;
  background: #e8c06a;
}
.hw-player-tag.watch,
.hw-note .hw-chip-group button.watch.active {
  color: #1d1a10;
  background: #d9b36a;
}
.hw-player-tag.avoid,
.hw-note .hw-chip-group button.avoid.active {
  color: #2a1112;
  background: #db9397;
}
.hw-recent-heading h3 {
  display: flex;
  align-items: center;
  gap: 5px;
}
.hw-note {
  display: flex;
  flex-direction: column;
  gap: 7px;
  text-align: left;
}
.hw-note .hw-chip-group {
  flex-wrap: wrap;
}
.hw-note textarea {
  resize: vertical;
  min-height: 46px;
  padding: 6px 8px;
  font: inherit;
  font-size: 11px;
  color: var(--text);
  background: #0f171a;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
}
.hw-note-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.hw-note-actions button {
  padding: 3px 10px;
  border-radius: 5px;
  font-size: 11px;
  color: var(--secondary);
}
.hw-note-actions .hw-note-save {
  color: #172020;
  background: var(--gold);
}
.hw-note .error {
  font-size: 11px;
  color: #e0a3a6;
}
.hw-encounters {
  text-align: left;
}
.hw-encounters > p {
  font-size: 11px;
  color: var(--secondary);
  margin-bottom: 6px;
}
.hw-encounter {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 0 4px 6px;
  border-left: 2px solid #4c6067;
  margin-bottom: 4px;
  font-size: 11px;
}
.hw-encounter.win {
  border-left-color: var(--green);
}
.hw-encounter.loss {
  border-left-color: #db9397;
}
.hw-encounter-text {
  flex: 1;
  min-width: 0;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hw-encounter b {
  font-weight: 500;
  color: var(--text);
  margin-right: 5px;
}
.hw-teammate {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 4px;
  border-radius: 5px;
  font-size: 11px;
  text-align: left;
}
.hw-teammate:hover {
  background: #ffffff08;
}
.hw-teammate span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hw-teammate small {
  color: var(--muted);
  white-space: nowrap;
}
</style>
