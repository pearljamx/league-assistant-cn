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
import { ChevronRight, Radio, RefreshCw, Users } from "@lucide/vue";
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
import { duration, modeName, percent, playerTagNames } from "../format";
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
  Selection,
} from "../../../shared/types";

interface RecentRecord {
  games: number;
  wins: number;
  /** 近期全部有效对局（从新到旧），用于连胜连败与预组队推断。 */
  history: RecentGame[];
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
    for (const match of page.matches) {
      if (match.private || match.remake || match.duration < 240) continue;
      const self = match.players.find((item) => item.puuid === puuid);
      if (self)
        history.push({
          matchId: match.id,
          teamId: self.teamId,
          win: self.win,
          sameMode: sameMode(match),
        });
    }
    const records = history.filter((game) => game.sameMode);
    recent.value[puuid] = {
      games: records.length,
      wins: records.filter((game) => game.win).length,
      history,
      error: null,
    };
  } catch (reason) {
    if (epoch === teamEpoch && current === context())
      recent.value[puuid] = {
        games: 0,
        wins: 0,
        history: [],
        error: (reason as Error).message,
      };
  } finally {
    loading.value[puuid] = false;
  }
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
      <div>
        <span class="hw-kicker">LIVE GAME</span>
        <h2>
          {{ live?.status === "selection" ? "英雄选择" : "实时对局" }}
          <small v-if="live && live.status !== 'idle'"
            >{{ modeName(live.mode) }}<i>·</i
            >{{ duration(live.gameTime) }}</small
          >
        </h2>
      </div>
      <div class="live-message">
        <Radio :size="15" /><span>{{
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
          <h3>
            {{ team.ally ? "我方" : "敌方" }}
            <small>{{
              team.id === 100
                ? "蓝色方"
                : team.id === 200
                  ? "红色方"
                  : "队伍 " + team.id
            }}</small>
          </h3>
          <span>{{ team.players.length }} 位玩家</span>
        </div>
        <button
          v-for="player in team.players"
          :key="player.key"
          class="live-card"
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
            :size="46"
          />
          <span class="live-card-identity">
            <b
              >{{
                player.identityHidden
                  ? "身份未公开"
                  : player.riotId || "公开玩家"
              }}<small v-if="player.isSelf" class="self-tag">我</small></b
            >
            <span
              >{{ champions.get(player.championId)?.name || "尚未选择英雄"
              }}<i v-if="positionOf(player)">· {{ positionOf(player) }}</i
              ><i v-if="player.level !== null">· Lv.{{ player.level }}</i></span
            >
            <span v-if="tagsOf(player).length" class="live-tags">
              <em
                v-for="tag in tagsOf(player)"
                :key="tag.text"
                :class="['live-tag', tag.kind]"
                :title="tag.title"
                >{{ tag.text }}</em
              >
            </span>
          </span>
          <span class="live-card-stat">
            <b>{{ percent(heroStat(player.championId)?.winRate) }}</b
            ><small>英雄胜率</small>
          </span>
          <span class="live-card-stat">
            <b>{{
              player.puuid && recent[player.puuid]?.games
                ? percent(
                    recent[player.puuid].wins / recent[player.puuid].games,
                  )
                : "—"
            }}</b
            ><small>{{
              !player.puuid
                ? "身份隐藏"
                : recent[player.puuid]?.error
                  ? "战绩暂不可用"
                  : recent[player.puuid]
                    ? recent[player.puuid].games + " 场同模式"
                    : "正在读取"
            }}</small>
          </span>
          <span v-if="live?.status === 'live'" class="live-card-stat">
            <b>{{
              [player.kills, player.deaths, player.assists]
                .map((value) => (value === null ? "—" : value))
                .join(" / ")
            }}</b
            ><small>K / D / A</small>
          </span>
          <span v-if="live?.status === 'live'" class="live-card-items">
            <img
              v-for="(id, index) in player.items.filter(
                (id) => id && catalog.items[id]?.icon,
              )"
              :key="index"
              :src="catalog.items[id].icon"
              :title="catalog.items[id].name"
              alt=""
            />
          </span>
          <ChevronRight v-if="isPublic(player)" :size="15" class="muted" />
        </button>
      </section>
    </div>
    <template v-if="state.phase === 'ChampSelect'">
      <div class="section-line spaced">
        <h2>备选英雄</h2>
        <span class="muted small">点击查看配装 · 换用请在快速选择窗操作</span>
      </div>
      <div class="bench-grid">
        <button
          v-for="id in selection.bench"
          :key="id"
          class="bench-card"
          @click="browseHero(id, true)"
        >
          <ChampionIcon :champion="champions.get(id)" :size="46" />
          <div>
            <strong>{{ champions.get(id)?.name || id }}</strong
            ><span
              >{{ percent(heroStat(id)?.winRate) }}
              <small>统计胜率</small></span
            >
          </div>
          <ChevronRight :size="15" />
        </button>
      </div>
      <p v-if="!selection.bench.length" class="empty-inline">
        当前没有备选英雄
      </p>
    </template>
  </section>
</template>
