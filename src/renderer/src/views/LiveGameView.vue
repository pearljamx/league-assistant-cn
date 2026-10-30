<script setup lang="ts">
import {
  computed,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import { Radio, RefreshCw, Users } from "@lucide/vue";
import { api, unwrap } from "../api";
import {
  browseHero,
  champions,
  catalog,
  notify,
  openPlayer,
  openRiotId,
  settings,
  state,
} from "../store";
import {
  date,
  duration,
  matchMode,
  modeName,
  percent,
  playerTagNames,
  tierName,
} from "../format";
import {
  premadeGroups,
  streakOf,
  type RecentGame,
} from "../../../shared/live-tags";
import ChampionIcon from "../components/ChampionIcon.vue";
import type {
  EncounterSummary,
  HeroStat,
  LiveGame,
  LivePlayer,
  Match,
  PlayerNote,
  RankedEntry,
  Selection,
} from "../../../shared/types";

/** 卡片战绩列表的一行，只保留展示所需字段。 */
interface RecentRow {
  id: string;
  championId: number;
  queue: string;
  date: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  sameMode: boolean;
}
interface RecentRecord {
  games: number;
  wins: number;
  /** 近期全部有效对局（从新到旧），用于连胜连败与预组队推断。 */
  history: RecentGame[];
  rows: RecentRow[];
  error: string | null;
}
const live = ref<LiveGame | null>(null);
const selection = ref<Selection>({
  members: [],
  bench: [],
  localCellId: null,
  championId: null,
});
const heroStats = ref<HeroStat[]>([]);
const recent = ref<Record<string, RecentRecord>>({});
const loading = ref<Record<string, boolean>>({});
/** 段位：null 表示读取失败，与“未定级”（空数组）区分。 */
const ranked = ref<Record<string, RankedEntry[] | null>>({});
/** 本机标记与本人遇到记录，只按公开 PUUID 读取。 */
const notes = ref<Record<string, PlayerNote | null>>({});
const encounters = ref<Record<string, EncounterSummary | null>>({});
const error = ref("");
const busy = ref(false);
let liveEpoch = 0,
  teamEpoch = 0,
  statEpoch = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let unsubscribe = () => {};
let active = true;

const context = () =>
  `${state.value.status}:${state.value.platform}:${state.value.summoner?.puuid}`;
const teams = computed(() => {
  const players = live.value?.players ?? [];
  const self = players.find((player) => player.isSelf);
  const ids = [...new Set(players.map((player) => player.teamId))].sort(
    (a, b) =>
      (a === self?.teamId ? -1 : 0) - (b === self?.teamId ? -1 : 0) || a - b,
  );
  return ids.map((id) => ({
    id,
    ally: id === self?.teamId,
    players: players.filter((player) => player.teamId === id),
  }));
});
/** 每支队伍内的预组队编号：近期至少两局同队的公开玩家归为一组。 */
const premade = computed(() =>
  premadeGroups(
    live.value?.players ?? [],
    Object.fromEntries(
      Object.entries(recent.value).map(([id, record]) => [id, record.history]),
    ),
  ),
);
interface LiveTag {
  text: string;
  kind:
    | "premade"
    | "met"
    | "win"
    | "lose"
    | "good"
    | "watch"
    | "avoid"
    | "friend";
  title: string;
}
function tagsOf(player: LivePlayer): LiveTag[] {
  const puuid = player.puuid;
  if (!puuid) return [];
  const tags: LiveTag[] = [];
  const group = premade.value[puuid];
  if (group)
    tags.push({
      text: "预组队 " + String.fromCharCode(64 + group),
      kind: "premade",
      title: "近期战绩中与同队的另一位公开玩家至少两局同队",
    });
  const met = encounters.value[puuid];
  if (!player.isSelf && met?.total)
    tags.push({
      text: "遇到过 " + met.total + " 次",
      kind: "met",
      title: `在你的战绩中同局 ${met.total} 次（队友 ${met.games.filter((game) => game.sameTeam).length} 次）`,
    });
  const streak = streakOf(recent.value[puuid]?.history ?? []);
  if (streak)
    tags.push({
      text: streak.count + (streak.win ? " 连胜" : " 连败"),
      kind: streak.win ? "win" : "lose",
      title: "最近同模式对局",
    });
  const note = notes.value[puuid];
  if (note?.tag)
    tags.push({
      text: playerTagNames[note.tag],
      kind: note.tag,
      title: note.note || "本机玩家标记",
    });
  else if (note?.note)
    tags.push({ text: "已备注", kind: "watch", title: note.note });
  return tags;
}
/** 队伍近期同模式胜率：只合计已读到战绩的公开玩家，没有样本时留空。 */
function teamRecord(players: LivePlayer[]) {
  let games = 0,
    wins = 0;
  for (const player of players) {
    const record = player.puuid ? recent.value[player.puuid] : undefined;
    games += record?.games ?? 0;
    wins += record?.wins ?? 0;
  }
  return { games, wins };
}
const recordOf = (player: LivePlayer) =>
  player.puuid ? recent.value[player.puuid] : undefined;
/** 同模式场均 KDA，没有同模式对局时为空。 */
function kdaOf(player: LivePlayer) {
  const rows = recordOf(player)?.rows.filter((row) => row.sameMode) ?? [];
  if (!rows.length) return null;
  const sum = rows.reduce(
    (total, row) => ({
      kills: total.kills + row.kills,
      deaths: total.deaths + row.deaths,
      assists: total.assists + row.assists,
    }),
    { kills: 0, deaths: 0, assists: 0 },
  );
  return ((sum.kills + sum.assists) / Math.max(sum.deaths, 1)).toFixed(1);
}
/** 近期最常用的英雄（最多 6 个），按场次排序。 */
function usageOf(player: LivePlayer) {
  const usage = new Map<number, { id: number; games: number; wins: number }>();
  for (const row of recordOf(player)?.rows ?? []) {
    const item = usage.get(row.championId) ?? {
      id: row.championId,
      games: 0,
      wins: 0,
    };
    item.games++;
    if (row.win) item.wins++;
    usage.set(row.championId, item);
  }
  return [...usage.values()].sort((a, b) => b.games - a.games).slice(0, 6);
}
const apexTiers = ["MASTER", "GRANDMASTER", "CHALLENGER"];
function rankOf(player: LivePlayer) {
  if (!player.puuid) return "";
  const rows = ranked.value[player.puuid];
  if (rows === undefined) return "";
  if (rows === null) return "段位暂不可用";
  const row =
    rows.find((item) => item.queue === "RANKED_SOLO_5x5" && item.tier) ??
    rows.find((item) => item.tier);
  if (!row) return "未定级";
  return [
    row.queue === "RANKED_SOLO_5x5" ? "单双" : "灵活",
    tierName(row.tier),
    apexTiers.includes(row.tier) ? "" : row.division,
    row.lp + " 点",
  ]
    .filter(Boolean)
    .join(" ");
}
const nameOf = (player: LivePlayer) => {
  const [name, tag] = (player.riotId || "公开玩家").split("#");
  return { name, tag };
};
const isPublic = (player: LivePlayer) =>
  !player.identityHidden &&
  Boolean(player.puuid || player.riotId?.includes("#"));
const heroStat = (id: number) =>
  heroStats.value.find((stat) => stat.championId === id);
const positionOf = (player: LivePlayer) => {
  const cell = Number(player.key.split(":")[2]);
  if (!player.key.startsWith("selection:100:")) return "";
  const raw = selection.value.members.find(
    (member) => member.cellId === cell,
  )?.position;
  return (
    (
      {
        top: "上路",
        jungle: "打野",
        middle: "中路",
        bottom: "下路",
        utility: "辅助",
      } as Record<string, string>
    )[raw?.toLowerCase() ?? ""] ?? ""
  );
};
const sameMode = (match: Match) =>
  state.value.mode === "hex"
    ? match.mode === "KIWI"
    : state.value.mode === "aram"
      ? match.mode === "ARAM"
      : ["CLASSIC", "SWIFTPLAY"].includes(match.mode);

async function loadLive() {
  if (busy.value) return;
  const epoch = ++liveEpoch,
    current = context();
  busy.value = true;
  error.value = "";
  try {
    const result = await unwrap(api.getLiveGame());
    if (epoch !== liveEpoch || current !== context()) return;
    live.value = result;
    for (const player of result.players) {
      void loadRecent(player);
      void loadRank(player);
      void loadMarks(player);
    }
  } catch (reason) {
    if (epoch === liveEpoch && current === context()) {
      live.value = null;
      error.value = (reason as Error).message;
    }
  } finally {
    if (epoch === liveEpoch) busy.value = false;
  }
}
async function loadSelection() {
  if (state.value.phase !== "ChampSelect") {
    selection.value = {
      members: [],
      bench: [],
      localCellId: null,
      championId: null,
    };
    return;
  }
  const result = await api.getSelection();
  if (result.ok && result.data && state.value.phase === "ChampSelect")
    selection.value = result.data;
}
async function loadHeroStats() {
  const epoch = ++statEpoch;
  heroStats.value = [];
  if (state.value.status !== "connected") return;
  const result = await api
    .getOverview({
      mode: state.value.mode,
      band: settings.value.band,
      tier: settings.value.tier,
      position: "ALL",
    })
    .catch(() => null);
  if (epoch === statEpoch && result?.ok && result.data)
    heroStats.value = result.data.heroes;
}
/** 只按公开 PUUID 读取近期同模式战绩；隐藏身份不查询、不推断。 */
async function loadRecent(player: LivePlayer) {
  const puuid = player.puuid;
  if (
    !puuid ||
    player.identityHidden ||
    recent.value[puuid] ||
    loading.value[puuid]
  )
    return;
  const epoch = teamEpoch,
    current = context();
  loading.value[puuid] = true;
  try {
    const page = await unwrap(api.getHistory(puuid, 0));
    if (epoch !== teamEpoch || current !== context()) return;
    const history: RecentGame[] = [];
    const rows: RecentRow[] = [];
    for (const match of page.matches) {
      if (match.private || match.remake || match.duration < 240) continue;
      const self = match.players.find((item) => item.puuid === puuid);
      if (!self) continue;
      history.push({
        matchId: match.id,
        teamId: self.teamId,
        win: self.win,
        sameMode: sameMode(match),
      });
      rows.push({
        id: match.id,
        championId: self.championId,
        queue: matchMode(match),
        date: date(match.date),
        win: self.win,
        kills: self.kills,
        deaths: self.deaths,
        assists: self.assists,
        sameMode: sameMode(match),
      });
    }
    const records = history.filter((game) => game.sameMode);
    recent.value[puuid] = {
      games: records.length,
      wins: records.filter((game) => game.win).length,
      history,
      rows,
      error: null,
    };
  } catch (reason) {
    if (epoch === teamEpoch && current === context())
      recent.value[puuid] = {
        games: 0,
        wins: 0,
        history: [],
        rows: [],
        error: (reason as Error).message,
      };
  } finally {
    loading.value[puuid] = false;
  }
}
/** 读取段位；失败记为 null，不当作未定级。 */
async function loadRank(player: LivePlayer) {
  const puuid = player.puuid;
  if (!puuid || player.identityHidden || puuid in ranked.value) return;
  const epoch = teamEpoch,
    current = context();
  ranked.value[puuid] = null;
  const result = await api.getRanked(puuid).catch(() => null);
  if (epoch !== teamEpoch || current !== context()) return;
  ranked.value[puuid] = result?.ok ? (result.data ?? []) : null;
}
/** 读取本机标记和遇到记录；失败时不显示标签，不影响其他信息。 */
async function loadMarks(player: LivePlayer) {
  const puuid = player.puuid;
  if (!puuid || player.identityHidden || puuid in notes.value) return;
  const epoch = teamEpoch,
    current = context();
  notes.value[puuid] = null;
  const [note, met] = await Promise.all([
    api.getPlayerNote(puuid).catch(() => null),
    player.isSelf ? null : api.getEncounters(puuid).catch(() => null),
  ]);
  if (epoch !== teamEpoch || current !== context()) return;
  if (note?.ok) notes.value[puuid] = note.data ?? null;
  if (met?.ok) encounters.value[puuid] = met.data ?? null;
}
function resetTeam() {
  teamEpoch++;
  recent.value = {};
  loading.value = {};
  ranked.value = {};
  notes.value = {};
  encounters.value = {};
}
function refresh() {
  resetTeam();
  void loadLive();
  void loadSelection();
}
function viewPlayer(player: LivePlayer) {
  if (!isPublic(player)) return;
  if (player.puuid)
    openPlayer({
      puuid: player.puuid,
      name: player.riotId || "公开玩家",
      level: null,
    });
  else if (player.riotId)
    void openRiotId(player.riotId).catch((reason) =>
      notify((reason as Error).message),
    );
}
watch(
  () => [state.value.summoner?.puuid, state.value.platform, state.value.status],
  () => {
    liveEpoch++;
    live.value = null;
    busy.value = false;
    resetTeam();
    void loadHeroStats();
    void loadLive();
  },
);
watch(
  () => `${state.value.phase}:${state.value.mode}:${state.value.championId}`,
  (next, previous) => {
    liveEpoch++;
    busy.value = false;
    if (next.split(":")[0] !== previous?.split(":")[0]) resetTeam();
    if (next.split(":")[1] !== previous?.split(":")[1]) void loadHeroStats();
    void loadLive();
    void loadSelection();
  },
);
onMounted(() => {
  unsubscribe = api.onSelection((value) => {
    if (state.value.phase === "ChampSelect") selection.value = value;
  });
  void loadHeroStats();
  void loadLive();
  void loadSelection();
  timer = setInterval(() => {
    if (!active) return;
    void loadLive();
    if (state.value.phase === "ChampSelect") void loadSelection();
  }, 5000);
});
onActivated(() => {
  active = true;
  void loadLive();
});
onDeactivated(() => (active = false));
onUnmounted(() => {
  clearInterval(timer);
  unsubscribe();
  liveEpoch++;
  teamEpoch++;
});
defineExpose({ refresh });
</script>

<template>
  <section class="live-view">
    <div class="live-heading">
      <h2>
        {{ live?.status === "selection" ? "英雄选择" : "实时对局" }}
        <small v-if="live && live.status !== 'idle'"
          >{{ modeName(live.mode) }}<i>·</i>{{ duration(live.gameTime) }}</small
        >
      </h2>
      <div class="live-message">
        <Radio :size="14" /><span>{{
          error || live?.message || "正在读取当前对局…"
        }}</span
        ><small>每 5 秒更新</small>
      </div>
      <button
        class="button secondary"
        aria-label="刷新实时对局"
        @click="refresh"
      >
        <RefreshCw :size="15" :class="{ spinning: busy }" />刷新
      </button>
    </div>
    <div v-if="!live?.players.length" class="empty-state tall">
      <Users :size="34" :stroke-width="1.2" />
      <h3>
        {{
          state.phase === "ChampSelect" ? "正在同步选人信息" : "等待当前对局"
        }}
      </h3>
      <p>进入选人或游戏后，自动展示公开玩家信息。</p>
      <p>身份隐藏的玩家无法查询，不推断真实身份。</p>
    </div>
    <div v-else class="live-teams">
      <section
        v-for="team in teams"
        :key="team.id"
        :class="['live-team', team.ally ? 'ally' : 'enemy']"
      >
        <div class="live-team-heading">
          <i class="live-team-dot" />
          <h3>{{ team.ally ? "我方" : "敌方" }}</h3>
          <small>{{
            team.id === 100
              ? "蓝色方"
              : team.id === 200
                ? "红色方"
                : "队伍 " + team.id
          }}</small>
          <template v-if="teamRecord(team.players).games">
            <b
              :class="
                teamRecord(team.players).wins * 2 >=
                teamRecord(team.players).games
                  ? 'good'
                  : 'bad'
              "
              :title="`公开玩家近期同模式合计 ${teamRecord(team.players).games} 场`"
              >{{
                percent(
                  teamRecord(team.players).wins /
                    teamRecord(team.players).games,
                )
              }}</b
            ><small>近期同模式胜率</small>
          </template>
          <span>{{ team.players.length }} 位玩家</span>
        </div>
        <div class="live-cards">
          <article
            v-for="player in team.players"
            :key="player.key"
            :class="[
              'live-card',
              player.puuid && premade[player.puuid]
                ? 'premade-' + (((premade[player.puuid] - 1) % 4) + 1)
                : '',
              { self: player.isSelf },
            ]"
          >
            <button
              class="live-card-head"
              :disabled="!isPublic(player)"
              :aria-label="
                isPublic(player)
                  ? '查看实时玩家 ' + (player.riotId || '公开玩家')
                  : '身份隐藏，无法查询'
              "
              @click="viewPlayer(player)"
            >
              <span class="live-avatar">
                <ChampionIcon
                  :champion="champions.get(player.championId)"
                  :size="40"
                />
                <em v-if="player.level !== null" title="当前对局等级">{{
                  player.level
                }}</em>
              </span>
              <span class="live-card-identity">
                <b>
                  <template v-if="player.identityHidden">身份未公开</template>
                  <template v-else>
                    <span class="live-name">{{ nameOf(player).name }}</span>
                    <small v-if="nameOf(player).tag"
                      >#{{ nameOf(player).tag }}</small
                    >
                  </template>
                  <small v-if="player.isSelf" class="self-tag">我</small>
                </b>
                <span class="live-rank">{{
                  player.identityHidden
                    ? "不查询"
                    : rankOf(player) || "正在读取段位"
                }}</span>
              </span>
            </button>
            <div class="live-card-sub">
              <span>{{
                champions.get(player.championId)?.name || "尚未选择英雄"
              }}</span>
              <i v-if="positionOf(player)">{{ positionOf(player) }}</i>
              <span class="live-hero-rate"
                >英雄胜率 {{ percent(heroStat(player.championId)?.winRate) }}</span
              >
            </div>
            <div class="live-stats">
              <span>
                <b
                  v-if="recordOf(player)?.games"
                  :class="
                    recordOf(player)!.wins * 2 >= recordOf(player)!.games
                      ? 'good'
                      : 'bad'
                  "
                  >{{
                    percent(recordOf(player)!.wins / recordOf(player)!.games)
                  }}</b
                ><b v-else>—</b>
                <small>{{
                  !player.puuid
                    ? "身份隐藏"
                    : recordOf(player)?.error
                      ? "战绩暂不可用"
                      : recordOf(player)
                        ? recordOf(player)!.games + " 场同模式"
                        : "正在读取"
                }}</small>
              </span>
              <span>
                <b>{{ kdaOf(player) ?? "—" }}</b
                ><small>同模式 KDA</small>
              </span>
              <span v-if="live?.status === 'live'">
                <b>{{
                  [player.kills, player.deaths, player.assists]
                    .map((value) => (value === null ? "—" : value))
                    .join("/")
                }}</b
                ><small>本局 K/D/A</small>
              </span>
            </div>
            <div
              v-if="live?.status === 'live' && player.items.length"
              class="live-card-items"
            >
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
            <div v-if="tagsOf(player).length" class="live-tags">
              <em
                v-for="tag in tagsOf(player)"
                :key="tag.text"
                :class="['live-tag', tag.kind]"
                :title="tag.title"
                >{{ tag.text }}</em
              >
            </div>
            <div v-if="usageOf(player).length" class="live-usage">
              <span
                v-for="item in usageOf(player)"
                :key="item.id"
                :class="item.wins * 2 >= item.games ? 'good' : 'bad'"
                :title="`${champions.get(item.id)?.name || item.id}：近期 ${item.games} 场 ${item.wins} 胜`"
              >
                <ChampionIcon :champion="champions.get(item.id)" :size="20" />
              </span>
            </div>
            <div class="live-matches" tabindex="0" aria-label="近期战绩">
              <div
                v-for="row in recordOf(player)?.rows ?? []"
                :key="row.id"
                :class="['live-match', row.win ? 'win' : 'loss']"
              >
                <ChampionIcon
                  :champion="champions.get(row.championId)"
                  :size="24"
                />
                <span class="live-match-info">
                  <b>{{ row.queue }}</b>
                  <small
                    >{{ row.date }} <i>{{ row.win ? "胜" : "负" }}</i></small
                  >
                </span>
                <span class="live-match-kda"
                  >{{ row.kills }}/{{ row.deaths }}/{{ row.assists }}</span
                >
              </div>
              <p
                v-if="!recordOf(player)?.rows.length"
                class="live-matches-empty"
              >
                {{
                  !player.puuid
                    ? "身份隐藏，不查询战绩"
                    : recordOf(player)?.error
                      ? "战绩暂不可用"
                      : recordOf(player)
                        ? "暂无公开对局"
                        : "正在读取战绩…"
                }}
              </p>
            </div>
          </article>
        </div>
      </section>
    </div>
    <div v-if="state.phase === 'ChampSelect'" class="live-bench">
      <h3>备选英雄</h3>
      <button
        v-for="id in selection.bench"
        :key="id"
        class="live-bench-item"
        :aria-label="'查看备选英雄 ' + (champions.get(id)?.name || id)"
        :title="champions.get(id)?.name || String(id)"
        @click="browseHero(id, true)"
      >
        <ChampionIcon :champion="champions.get(id)" :size="28" />
        <span>{{ percent(heroStat(id)?.winRate) }}</span>
      </button>
      <span v-if="!selection.bench.length" class="muted small"
        >当前没有备选英雄</span
      >
      <span class="muted small live-bench-hint"
        >点击查看配装 · 换用请在快速选择窗操作</span
      >
    </div>
  </section>
</template>
