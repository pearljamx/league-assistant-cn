<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  Swords,
  LayoutDashboard,
  History,
  Users,
  WandSparkles,
  Hexagon,
  Settings2,
  ChevronRight,
  ArrowUpRight,
  Search,
  RefreshCw,
  CircleAlert,
  X,
  ScanLine,
  ExternalLink,
  Zap,
  Check,
  Radio,
  BookOpen,
  ShieldCheck,
} from "@lucide/vue";
import { api, unwrap } from "./api";
import type {
  AugmentRanking,
  Catalog,
  ConnectionState,
  HeroStat,
  Match,
  MatchPage,
  Overview,
  Recognition,
  Recommendation,
  RuneOption,
  Selection,
  Settings,
  StatsQuery,
  Summoner,
} from "../../shared/types";
import SourceBadge from "./components/SourceBadge.vue";
import ChampionIcon from "./components/ChampionIcon.vue";
import EquipmentRow from "./components/EquipmentRow.vue";

const isOverlay = location.hash === "#overlay";
const page = ref("dashboard");
const navigation = [
  { id: "dashboard", title: "总览", icon: LayoutDashboard, label: "工作台" },
  { id: "selection", title: "选人助手", icon: Users, label: "对局准备" },
  { id: "history", title: "战绩查询", icon: History, label: "最近表现" },
  {
    id: "champion",
    title: "英雄推荐",
    icon: WandSparkles,
    label: "配装与符文",
  },
  { id: "hex", title: "海克斯排行", icon: Hexagon, label: "强化数据" },
  { id: "settings", title: "设置", icon: Settings2, label: "个人偏好" },
];
const state = ref<ConnectionState>({
  status: "searching",
  message: "正在连接",
  phase: "None",
  region: null,
  platform: null,
  mode: "rift",
  queueId: null,
  summoner: null,
  ranked: [],
  championId: null,
  updatedAt: "",
});
const settings = ref<Settings>({
  autoAccept: false,
  acceptDelayMs: 1000,
  band: "all",
  mode: "rift",
  position: "ALL",
  tier: 255,
  autoRecognize: false,
  monitor: 0,
  overlay: true,
  managedRunePage: null,
});
const catalog = ref<Catalog>({
  champions: [],
  items: {},
  perks: {},
  version: null,
});
const selection = ref<Selection>({
  members: [],
  bench: [],
  localCellId: null,
  championId: null,
});
const recognition = ref<Recognition>({
  status: "idle",
  message: "等待海克斯三选一",
  augmentIds: [],
  rawTexts: [],
  captureId: 0,
  monitor: 0,
  updatedAt: "",
});
const overview = ref<Overview | null>(null),
  recommendation = ref<Recommendation | null>(null),
  ranking = ref<AugmentRanking | null>(null);
const errors = ref<Record<string, string>>({}),
  busy = ref<Record<string, boolean>>({}),
  toast = ref("");
const selectedId = ref<number | null>(null),
  heroSearch = ref(""),
  augmentSearch = ref(""),
  rarity = ref("all"),
  globalRank = ref(false),
  followHero = ref(true);
const historyPage = ref<MatchPage | null>(null),
  historyTarget = ref<Summoner | null>(null),
  riotId = ref(""),
  detail = ref<Match | null>(null),
  runePreview = ref<{
    option: RuneOption;
    index: number;
    championId: number;
    query: StatsQuery;
  } | null>(null);
const displays = ref([
  { id: 0, name: "自动跟随游戏窗口", width: 0, height: 0 },
]);
const manualIds = ref([0, 0, 0]),
  manualOpen = ref(false),
  manualComparison = ref<number[] | null>(null);
let manualEpoch = 0;
const recentPlayers = ref<
  Record<
    string,
    { games: number; winRate: number | null; error: string | null }
  >
>({});
let unsubState = () => {},
  unsubSettings = () => {},
  unsubRecognition = () => {},
  selectionTimer: ReturnType<typeof setInterval> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined,
  overviewEpoch = 0,
  recEpoch = 0,
  rankEpoch = 0,
  historyEpoch = 0,
  detailEpoch = 0,
  teamEpoch = 0;
const phaseNames: Record<string, string> = {
  None: "空闲",
  Lobby: "组队大厅",
  Matchmaking: "正在寻找对局",
  ReadyCheck: "确认对局",
  ChampSelect: "英雄选择",
  GameStart: "正在载入",
  InProgress: "对局进行中",
  EndOfGame: "对局结束",
  Reconnect: "等待重连",
  WaitingForStats: "等待结算",
};
const modes = [
  { id: "rift", name: "召唤师峡谷" },
  { id: "aram", name: "极地大乱斗" },
  { id: "hex", name: "海克斯大乱斗" },
] as const;
const positions = [
  { id: "ALL", name: "常见分路" },
  { id: "TOP", name: "上路" },
  { id: "JUNGLE", name: "打野" },
  { id: "MIDDLE", name: "中路" },
  { id: "BOTTOM", name: "下路" },
  { id: "SUPPORT", name: "辅助" },
] as const;
const bands = computed(() =>
  overview.value?.bands.length
    ? overview.value.bands
    : [
        { id: "all", name: "全部样本" },
        { id: "casual", name: "娱乐" },
        { id: "mid", name: "中分" },
        { id: "high", name: "前 5%" },
      ],
);
const query = computed<StatsQuery>(() => ({
  mode: settings.value.mode,
  band: settings.value.band,
  tier: settings.value.tier,
  position: settings.value.position,
}));
const currentPage = computed(
  () => navigation.find((item) => item.id === page.value)!,
);
const champions = computed(
  () =>
    new Map(catalog.value.champions.map((champion) => [champion.id, champion])),
);
const selectedHero = computed(() => champions.value.get(selectedId.value ?? 0));
const visibleHeroes = computed(() =>
  catalog.value.champions.filter((hero) =>
    (hero.name + hero.title + hero.alias)
      .toLowerCase()
      .includes(heroSearch.value.toLowerCase()),
  ),
);
const heroStats = computed(() => {
  const unique = new Map<number, HeroStat>();
  for (const stat of overview.value?.heroes ?? [])
    if (
      !unique.has(stat.championId) ||
      (stat.pickRate ?? 0) > (unique.get(stat.championId)?.pickRate ?? 0)
    )
      unique.set(stat.championId, stat);
  return [...unique.values()].sort(
    (a, b) => (b.winRate ?? 0) - (a.winRate ?? 0),
  );
});
const filteredHeroStats = computed(() =>
  heroStats.value.filter(
    (stat) =>
      !heroSearch.value ||
      (
        (champions.value.get(stat.championId)?.name ?? "") +
        (champions.value.get(stat.championId)?.alias ?? "") +
        (champions.value.get(stat.championId)?.title ?? "")
      )
        .toLowerCase()
        .includes(heroSearch.value.toLowerCase()),
  ),
);
const visibleAugments = computed(() =>
  (ranking.value?.augments ?? []).filter(
    (row) =>
      (rarity.value === "all" || row.augment.rarity === rarity.value) &&
      row.augment.name
        .toLowerCase()
        .includes(augmentSearch.value.toLowerCase()),
  ),
);
const recognizedCards = computed(() =>
  (!isOverlay && manualComparison.value
    ? ranking.value?.championId === selectedId.value
      ? manualComparison.value
      : []
    : state.value.championId &&
        ranking.value?.championId !== state.value.championId
      ? []
      : recognition.value.augmentIds
  )
    .map(
      (id) =>
        ranking.value?.augments.find((row) => row.augment.id === id) ??
        (ranking.value?.catalog.find((row) => row.id === id)
          ? {
              augment: ranking.value.catalog.find((row) => row.id === id)!,
              wins: null,
              games: null,
              winRate: null,
              pickRate: null,
              smoothedWinRate: null,
              delta: null,
              lowSample: false,
            }
          : undefined),
    )
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => (b.smoothedWinRate ?? -1) - (a.smoothedWinRate ?? -1)),
);
const winSummary = computed(() => {
  if (!historyTarget.value || !historyPage.value) return null;
  const players = historyPage.value.matches
    .filter((match) => !match.remake && !match.private && match.duration >= 240)
    .map((match) =>
      match.players.find(
        (player) => player.puuid === historyTarget.value!.puuid,
      ),
    )
    .filter(Boolean);
  return {
    games: players.length,
    wins: players.filter((player) => player!.win).length,
  };
});
const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : (value * 100).toFixed(1) + "%";
const count = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "未提供"
    : n >= 10000
      ? (n / 10000).toFixed(1) + "万"
      : n.toLocaleString("zh-CN");
const date = (raw: string | null | undefined) =>
  raw
    ? new Date(raw).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const rarityName = (raw: string) =>
  ({ silver: "白银", gold: "黄金", prismatic: "棱彩" })[raw] || raw;
const playerFor = (match: Match) =>
  match.players.find((player) => player.puuid === historyTarget.value?.puuid) ??
  match.players[0];
const heroStat = (id: number) =>
  heroStats.value.find((stat) => stat.championId === id);
const rankName = (tier: string) =>
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
  })[tier] || "未定级";
function notify(message: string) {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ""), 5000);
}
async function run<T>(
  key: string,
  action: () => Promise<T>,
): Promise<T | undefined> {
  busy.value[key] = true;
  errors.value[key] = "";
  try {
    return await action();
  } catch (error) {
    errors.value[key] = error instanceof Error ? error.message : "请求未完成";
    return undefined;
  } finally {
    busy.value[key] = false;
  }
}
async function save(patch: Partial<Settings>) {
  const previous = { ...settings.value };
  settings.value = { ...settings.value, ...patch };
  try {
    settings.value = await unwrap(api.saveSettings(patch));
  } catch (error) {
    settings.value = previous;
    notify((error as Error).message);
  }
}
async function loadOverview() {
  const epoch = ++overviewEpoch,
    value = { ...query.value };
  busy.value.overview = true;
  errors.value.overview = "";
  overview.value = null;
  try {
    const response = await unwrap(api.getOverview(value));
    if (epoch === overviewEpoch) overview.value = response;
  } catch (error) {
    if (epoch === overviewEpoch)
      errors.value.overview = (error as Error).message;
  } finally {
    if (epoch === overviewEpoch) busy.value.overview = false;
  }
}
async function loadRecommendation() {
  const epoch = ++recEpoch;
  recommendation.value = null;
  errors.value.recommendation = "";
  if (!selectedId.value) return;
  const id = selectedId.value,
    value = { ...query.value };
  busy.value.recommendation = true;
  try {
    const response = await unwrap(api.getRecommendation(id, value));
    if (epoch === recEpoch) recommendation.value = response;
  } catch (error) {
    if (epoch === recEpoch)
      errors.value.recommendation = (error as Error).message;
  } finally {
    if (epoch === recEpoch) busy.value.recommendation = false;
  }
}
async function loadRanking() {
  const epoch = ++rankEpoch;
  errors.value.ranking = "";
  ranking.value = null;
  const id = globalRank.value && !isOverlay ? null : selectedId.value,
    band = settings.value.band;
  busy.value.ranking = true;
  try {
    const response = await unwrap(api.getAugments(id, band));
    if (epoch === rankEpoch) ranking.value = response;
  } catch (error) {
    if (epoch === rankEpoch) errors.value.ranking = (error as Error).message;
  } finally {
    if (epoch === rankEpoch) busy.value.ranking = false;
  }
}
async function loadHistory(more = false) {
  const target = historyTarget.value ?? state.value.summoner;
  if (!target) {
    errors.value.history = "请先登录客户端，或输入同区玩家的游戏名#标签。";
    return;
  }
  const epoch = ++historyEpoch;
  historyTarget.value = target;
  const start = more ? (historyPage.value?.nextIndex ?? 0) : 0;
  if (!more) historyPage.value = null;
  busy.value.history = true;
  errors.value.history = "";
  try {
    const response = await unwrap(api.getHistory(target.puuid, start));
    if (epoch === historyEpoch)
      historyPage.value =
        more && historyPage.value
          ? {
              ...response,
              matches: [
                ...new Map(
                  [...historyPage.value.matches, ...response.matches].map(
                    (match) => [match.id, match],
                  ),
                ).values(),
              ],
            }
          : response;
  } catch (error) {
    if (epoch === historyEpoch) errors.value.history = (error as Error).message;
  } finally {
    if (epoch === historyEpoch) busy.value.history = false;
  }
}
async function searchPlayer() {
  const target = await run("search", () =>
    unwrap(api.findSummoner(riotId.value)),
  );
  if (target) {
    historyTarget.value = target;
    void loadHistory();
  }
}
function showMyHistory() {
  historyTarget.value = state.value.summoner;
  page.value = "history";
  void loadHistory();
}
async function showMatch(match: Match) {
  detail.value = match;
  const epoch = ++detailEpoch;
  const full = await run("detail", () => unwrap(api.getMatch(match.id)));
  if (full && epoch === detailEpoch) detail.value = full;
}
function chooseHero(id: number, navigate = false) {
  followHero.value = false;
  selectedId.value = id;
  if (navigate) page.value = "champion";
}
async function applyRunes() {
  const preview = runePreview.value;
  if (!preview) return;
  const result = await run("runes", () =>
    unwrap(
      api.applyRunes(preview.championId, { ...preview.query }, preview.index, [
        ...preview.option.perks,
      ]),
    ),
  );
  if (result) {
    runePreview.value = null;
    notify("符文已应用到助手专用页面");
  }
}
async function scan() {
  clearManualComparison();
  const value = await run("scan", () => unwrap(api.scanAugments()));
  if (value) recognition.value = value;
}
async function manual() {
  if (!selectedId.value) {
    notify("请先选择要比较的英雄");
    return;
  }
  const epoch = manualEpoch;
  const value = await run("manual", () =>
    unwrap(api.setManualAugments([...manualIds.value])),
  );
  if (value && epoch === manualEpoch) {
    manualComparison.value = [...value.augmentIds];
    manualOpen.value = false;
    globalRank.value = false;
  }
}
function clearManualComparison() {
  manualComparison.value = null;
  manualEpoch++;
}
async function refreshSelection() {
  if (state.value.phase !== "ChampSelect") {
    selection.value = {
      members: [],
      bench: [],
      localCellId: null,
      championId: null,
    };
    return;
  }
  try {
    selection.value = await unwrap(api.getSelection());
  } catch {
    return;
  }
  const epoch = teamEpoch;
  for (const member of selection.value.members) {
    if (
      !member.puuid ||
      recentPlayers.value[member.puuid] ||
      busy.value["team:" + member.puuid]
    )
      continue;
    busy.value["team:" + member.puuid] = true;
    try {
      const response = await unwrap(api.getHistory(member.puuid, 0));
      const records = response.matches
        .filter(
          (match) =>
            !match.private &&
            !match.remake &&
            match.duration >= 240 &&
            (state.value.mode === "hex"
              ? match.mode === "KIWI"
              : state.value.mode === "aram"
                ? match.mode === "ARAM"
                : ["CLASSIC", "SWIFTPLAY"].includes(match.mode)),
        )
        .map((match) =>
          match.players.find((player) => player.puuid === member.puuid),
        )
        .filter(Boolean);
      if (epoch === teamEpoch)
        recentPlayers.value[member.puuid] = {
          games: records.length,
          winRate: records.length
            ? records.filter((player) => player!.win).length / records.length
            : null,
          error: null,
        };
    } catch (error) {
      if (epoch === teamEpoch)
        recentPlayers.value[member.puuid] = {
          games: 0,
          winRate: null,
          error: (error as Error).message,
        };
    } finally {
      busy.value["team:" + member.puuid] = false;
    }
  }
}
async function refreshCatalog() {
  const data = await run("catalog", () => unwrap(api.getCatalog()));
  if (data) catalog.value = data;
}
watch(
  query,
  (next, previous) => {
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    clearManualComparison();
    void loadOverview();
    if (page.value === "champion") void loadRecommendation();
    if (page.value === "hex" || isOverlay) void loadRanking();
  },
  { deep: true },
);
watch(selectedId, () => {
  clearManualComparison();
  if (page.value === "champion") void loadRecommendation();
  if (page.value === "hex" || isOverlay) void loadRanking();
});
watch(globalRank, () => void loadRanking());
watch(page, (value) => {
  if (value === "champion" && !recommendation.value) void loadRecommendation();
  if (value === "hex") {
    if (settings.value.mode !== "hex") void save({ mode: "hex" });
    void loadRanking();
  }
  if (value === "history" && !historyPage.value && state.value.summoner)
    void loadHistory();
  if (value === "selection") {
    if (
      state.value.status === "connected" &&
      settings.value.mode !== state.value.mode
    )
      void save({ mode: state.value.mode });
    void refreshSelection();
  }
  if (value === "settings")
    void api.getDisplays().then((result) => {
      if (result.ok && result.data) displays.value = result.data;
    });
});
function acceptState(value: ConnectionState) {
  const accountChanged = state.value.summoner?.puuid !== value.summoner?.puuid;
  const phaseChanged = state.value.phase !== value.phase;
  if (
    accountChanged ||
    phaseChanged ||
    state.value.mode !== value.mode ||
    state.value.championId !== value.championId
  )
    clearManualComparison();
  state.value = value;
  if (
    page.value === "selection" &&
    value.status === "connected" &&
    value.mode !== settings.value.mode
  )
    void save({ mode: value.mode });
  if (accountChanged) {
    historyEpoch++;
    detailEpoch++;
    teamEpoch++;
    historyPage.value = null;
    historyTarget.value = null;
    detail.value = null;
    recentPlayers.value = {};
    errors.value.history = "";
    runePreview.value = null;
  }
  if (followHero.value && value.championId !== selectedId.value)
    selectedId.value = value.championId;
  if (phaseChanged) {
    teamEpoch++;
    recentPlayers.value = {};
    void refreshSelection();
  }
}
onMounted(async () => {
  unsubState = api.onState(acceptState);
  unsubSettings = api.onSettings((value) => {
    settings.value = value;
  });
  unsubRecognition = api.onRecognition((value) => {
    recognition.value = value;
    if (isOverlay && value.status === "recognized" && !ranking.value)
      void loadRanking();
  });
  const [currentState, currentSettings, currentRecognition] = await Promise.all(
    [api.getState(), api.getSettings(), api.getRecognition()],
  );
  if (currentSettings.ok && currentSettings.data)
    settings.value = currentSettings.data;
  if (currentState.ok && currentState.data) acceptState(currentState.data);
  if (currentRecognition.ok && currentRecognition.data)
    recognition.value = currentRecognition.data;
  if (isOverlay) {
    void loadRanking();
    return;
  }
  void refreshCatalog();
  void loadOverview();
  void refreshSelection();
  selectionTimer = setInterval(() => {
    if (page.value === "selection" || state.value.phase === "ChampSelect")
      void refreshSelection();
  }, 4000);
});
onUnmounted(() => {
  unsubState();
  unsubSettings();
  unsubRecognition();
  clearInterval(selectionTimer);
  clearTimeout(toastTimer);
});
</script>

<template>
  <div v-if="isOverlay" class="overlay-shell">
    <div class="overlay-heading">
      <Hexagon :size="18" /><strong>三选一参考</strong
      ><span>{{ selectedHero?.name || "当前英雄" }}</span>
    </div>
    <div v-if="recognizedCards.length === 3" class="overlay-cards">
      <div
        v-for="(card, index) in recognizedCards"
        :key="card.augment.id"
        :class="[
          'overlay-card',
          { best: index === 0 && card.winRate !== null },
        ]"
      >
        <span class="rank-number">{{ index + 1 }}</span>
        <div>
          <strong>{{ card.augment.name }}</strong
          ><small
            >{{ rarityName(card.augment.rarity) }} ·
            {{
              card.games === null
                ? "暂无当前组统计"
                : count(card.games) + " 场"
            }}<span v-if="card.lowSample"> · 低样本</span></small
          >
        </div>
        <b>{{ percent(card.winRate) }}</b>
      </div>
    </div>
    <p v-else class="muted">
      {{
        recognition.status === "scanning"
          ? recognition.message
          : errors.ranking || "正在读取当前英雄统计…"
      }}
    </p>
    <div class="overlay-footer">
      国服样本 · {{ ranking?.source.date?.slice(0, 10) || "日期未提供"
      }}<span>F6 重新识别</span>
    </div>
  </div>
  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-symbol">
          <Swords :size="25" :stroke-width="1.5" />
        </div>
        <div><strong>英雄联盟助手</strong><small>LEAGUE COMPANION</small></div>
      </div>
      <div class="sidebar-caption">你的对局工作台 <span>CN</span></div>
      <nav aria-label="主导航">
        <button
          v-for="item in navigation"
          :key="item.id"
          :class="['nav-item', { active: page === item.id }]"
          @click="page = item.id"
        >
          <component :is="item.icon" :size="19" :stroke-width="1.65" /><span>{{
            item.title
          }}</span
          ><ChevronRight v-if="page === item.id" :size="15" class="nav-arrow" />
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="local-state">
          <span
            :class="['status-dot', { connected: state.status === 'connected' }]"
          ></span
          ><span>{{
            state.status === "connected"
              ? "国服客户端已连接"
              : state.status === "searching"
                ? "正在查找客户端"
                : "等待客户端连接"
          }}</span
          ><Radio :size="15" />
        </div>
        <div v-if="state.summoner" class="profile-mini">
          <div class="avatar-mini">
            {{ state.summoner.gameName.slice(0, 1) || "召" }}
          </div>
          <div>
            <strong
              >{{ state.summoner.gameName
              }}<span v-if="state.summoner.tagLine"
                >#{{ state.summoner.tagLine }}</span
              ></strong
            ><small
              >等级 {{ state.summoner.level }} ·
              {{ state.platform || "国服" }}</small
            >
          </div>
        </div>
        <div v-else class="profile-mini">
          <div class="avatar-mini"><Users :size="20" /></div>
          <div>
            <strong>等待召唤师登录</strong><small>启动 WeGame 与英雄联盟</small>
          </div>
        </div>
        <button
          class="reference-link"
          @click="api.openExternal('data-license')"
        >
          <BookOpen :size="14" />数据来源与许可<ArrowUpRight :size="14" />
        </button>
      </div>
    </aside>
    <main class="main-workspace">
      <header class="topbar">
        <div class="breadcrumb">
          工作台 <ChevronRight :size="13" /><span>{{ currentPage.title }}</span>
        </div>
        <div class="topbar-right">
          <span class="version">v0.1.0</span><span class="topbar-divider"></span
          ><span
            :class="['phase-badge', { live: state.phase === 'InProgress' }]"
            ><span class="status-dot"></span
            >{{ phaseNames[state.phase] || state.phase }}</span
          >
        </div>
      </header>
      <div class="page-content">
        <div class="page-heading">
          <div>
            <div class="eyebrow">{{ currentPage.label }}</div>
            <h1>
              {{
                page === "dashboard"
                  ? state.summoner
                    ? "准备好下一场对局。"
                    : "从这里，开始下一场。"
                  : currentPage.title
              }}
            </h1>
            <p>
              {{
                {
                  dashboard: "国服数据，清晰选择。让准备更从容一点。",
                  selection: "跟随选人变化，比较当前英雄与备选席。",
                  history: "查看近期对局与单局详情，了解自己的表现。",
                  champion: "从出门装到符文配置，找到适合你的方案。",
                  hex: "先看当前英雄，再看样本。每个选择都有依据。",
                  settings: "让助手按你的习惯工作。",
                }[page]
              }}
            </p>
          </div>
          <div class="heading-actions">
            <button
              v-if="page === 'dashboard'"
              class="button secondary"
              @click="page = 'settings'"
            >
              <Settings2 :size="16" />偏好设置</button
            ><button
              v-else-if="page === 'history'"
              class="button secondary"
              :disabled="busy.history"
              @click="loadHistory()"
            >
              <RefreshCw
                :size="15"
                :class="{ spinning: busy.history }"
              />刷新战绩</button
            ><button
              v-else-if="page === 'selection'"
              class="button secondary"
              @click="
                recentPlayers = {};
                refreshSelection();
              "
            >
              <RefreshCw :size="15" />刷新选人</button
            ><button
              v-else-if="page === 'champion' || page === 'hex'"
              class="button secondary"
              :disabled="busy.recommendation || busy.ranking"
              @click="page === 'hex' ? loadRanking() : loadRecommendation()"
            >
              <RefreshCw :size="15" />刷新数据
            </button>
          </div>
        </div>

        <div v-if="state.status === 'error'" class="notice warning">
          <CircleAlert :size="17" /><span>{{ state.message }}</span>
        </div>
        <template v-if="page === 'dashboard'">
          <section class="hero-banner">
            <div class="hero-banner-copy">
              <span class="banner-tag"><span></span>国服 · 本地桌面助手</span>
              <h2>了解你的英雄，<br />做出更好的选择。</h2>
              <p>
                出装、符文与海克斯数据，<br />在需要的时候，恰好出现在你身边。
              </p>
              <button class="button primary" @click="page = 'champion'">
                查看英雄推荐<ArrowUpRight :size="17" />
              </button>
            </div>
            <div class="hero-art" aria-hidden="true">
              <div class="orbit orbit-1"></div>
              <div class="orbit orbit-2"></div>
              <div class="art-cross horizontal"></div>
              <div class="art-cross vertical"></div>
              <div class="hex-crest">
                <Swords :size="105" :stroke-width="0.8" />
              </div>
              <div class="orbit-star star-a"></div>
              <div class="orbit-star star-b"></div>
              <div class="orbit-star star-c"></div>
              <span class="art-label">PREPARE. ADAPT. PLAY.</span>
            </div>
            <span class="banner-number">01 / 准备阶段</span>
          </section>
          <div class="metric-grid">
            <div class="metric-card">
              <span class="metric-label">当前英雄 <Users :size="15" /></span>
              <div class="metric-value">
                {{
                  state.championId
                    ? champions.get(state.championId)?.name || "读取中"
                    : "等待选人"
                }}
              </div>
              <small>{{
                state.championId
                  ? champions.get(state.championId)?.title
                  : "进入选人后自动识别"
              }}</small>
            </div>
            <div class="metric-card">
              <span class="metric-label"
                >排位段位 <ShieldCheck :size="15"
              /></span>
              <div class="metric-value">
                {{ rankName(state.ranked[0]?.tier || "") }}
                <span>{{ state.ranked[0]?.division }}</span>
              </div>
              <small>{{
                state.ranked[0]?.tier
                  ? state.ranked[0].lp + " 胜点 · 单双排"
                  : "连接客户端后读取"
              }}</small>
            </div>
            <div class="metric-card">
              <span class="metric-label">自动接受 <Check :size="15" /></span>
              <div class="metric-value">
                <span :class="settings.autoAccept ? 'accent-text' : ''">{{
                  settings.autoAccept ? "已开启" : "已关闭"
                }}</span
                ><button
                  :aria-label="
                    settings.autoAccept ? '关闭自动接受' : '开启自动接受'
                  "
                  :class="['switch', { on: settings.autoAccept }]"
                  role="switch"
                  :aria-checked="settings.autoAccept"
                  @click="save({ autoAccept: !settings.autoAccept })"
                >
                  <span></span>
                </button>
              </div>
              <small
                >确认对局后 {{ settings.acceptDelayMs / 1000 }} 秒接受</small
              >
            </div>
            <div class="metric-card">
              <span class="metric-label">海斗分 <Hexagon :size="15" /></span>
              <div class="metric-value">
                待接入 <span class="tiny-tag">Hexdata</span>
              </div>
              <small>正式接入前可前往官方查询</small>
            </div>
          </div>
          <div class="dashboard-columns">
            <section class="panel">
              <div class="panel-heading">
                <div>
                  <h2>
                    国服英雄数据
                    <span class="tiny-tag">{{
                      modes.find((mode) => mode.id === settings.mode)?.name
                    }}</span>
                  </h2>
                  <p>当前筛选下的英雄统计参考</p>
                </div>
                <button class="text-button" @click="page = 'champion'">
                  更多英雄<ChevronRight :size="14" />
                </button>
              </div>
              <div class="compact-tabs">
                <button
                  v-for="mode in modes"
                  :key="mode.id"
                  :class="{ active: settings.mode === mode.id }"
                  @click="save({ mode: mode.id })"
                >
                  {{ mode.name }}
                </button>
              </div>
              <div v-if="busy.overview" class="loading-state">
                <RefreshCw :size="19" class="spinning" />正在读取国服统计
              </div>
              <div v-else-if="errors.overview" class="empty-state">
                <CircleAlert :size="25" />
                <p>{{ errors.overview }}</p>
                <button class="text-button" @click="loadOverview()">
                  重新加载
                </button>
              </div>
              <div v-else class="hero-list">
                <button
                  v-for="(stat, index) in heroStats.slice(0, 5)"
                  :key="stat.championId"
                  class="hero-list-row"
                  @click="chooseHero(stat.championId, true)"
                >
                  <span class="list-rank">0{{ index + 1 }}</span
                  ><ChampionIcon
                    :champion="champions.get(stat.championId)"
                    :size="39"
                  />
                  <div class="hero-list-name">
                    <strong>{{
                      champions.get(stat.championId)?.name ||
                      "英雄 " + stat.championId
                    }}</strong
                    ><small>{{ champions.get(stat.championId)?.title }}</small>
                  </div>
                  <div class="list-win">
                    <strong>{{ percent(stat.winRate) }}</strong
                    ><small>统计胜率</small>
                  </div>
                  <ChevronRight :size="15" class="muted" />
                </button>
              </div>
              <SourceBadge v-if="overview" :source="overview.source" />
            </section>
            <div class="dashboard-side">
              <section class="panel hex-promo">
                <div class="promo-icon">
                  <Hexagon :size="23" :stroke-width="1.3" />
                </div>
                <span class="eyebrow">HEXTECH ARAM</span>
                <h2>三选一，也有据可循。</h2>
                <p>查看英雄专属强化胜率，<br />比较不同水平组的国服样本。</p>
                <button
                  class="button secondary"
                  @click="
                    save({ mode: 'hex' });
                    page = 'hex';
                  "
                >
                  查看海克斯排行<ArrowUpRight :size="16" />
                </button>
              </section>
              <section class="rating-callout">
                <div class="section-line">
                  <strong>你的海斗水平</strong><ExternalLink :size="15" />
                </div>
                <p>Hexdata 数值分直连等待正式授权，现阶段提供官方查分入口。</p>
                <button
                  class="text-button"
                  @click="api.openExternal('hexdata')"
                >
                  前往 Hexdata 查询<ArrowUpRight :size="14" />
                </button>
              </section>
            </div>
          </div>
        </template>

        <template v-if="page === 'selection'">
          <div class="notice">
            <Radio :size="17" /><span>{{
              state.phase === "ChampSelect"
                ? "已进入英雄选择，阵容和备选席会自动更新。"
                : "进入客户端选人阶段后，这里会自动出现队友与备选英雄。"
            }}</span>
          </div>
          <div class="section-line spaced">
            <h2>
              当前队伍
              <span class="muted small"
                >{{ selection.members.length }} / 5</span
              >
            </h2>
            <span class="tiny-tag">{{
              modes.find((mode) => mode.id === state.mode)?.name
            }}</span>
          </div>
          <section class="panel team-panel">
            <div class="table-header team-columns">
              <span>玩家 / 英雄</span><span>英雄统计胜率</span
              ><span>玩家近期胜率</span><span>有效样本</span>
            </div>
            <div
              v-for="member in selection.members"
              :key="member.cellId"
              class="team-row team-columns"
            >
              <div class="team-identity">
                <ChampionIcon :champion="champions.get(member.championId)" />
                <div>
                  <strong
                    >{{
                      member.name ||
                      (member.cellId === selection.localCellId
                        ? "我"
                        : "身份未公开")
                    }}<span
                      v-if="member.cellId === selection.localCellId"
                      class="self-tag"
                      >我</span
                    ></strong
                  ><small>{{
                    champions.get(member.championId)?.name || "尚未选择英雄"
                  }}</small>
                </div>
              </div>
              <span class="stat-number">{{
                percent(heroStat(member.championId)?.winRate)
              }}</span
              ><span class="stat-number">{{
                member.puuid
                  ? percent(recentPlayers[member.puuid]?.winRate)
                  : "—"
              }}</span
              ><span
                class="muted small"
                :title="
                  member.puuid ? recentPlayers[member.puuid]?.error || '' : ''
                "
                >{{
                  !member.puuid
                    ? "身份隐藏"
                    : recentPlayers[member.puuid]?.error
                      ? "战绩服务暂不可用"
                      : recentPlayers[member.puuid]
                        ? recentPlayers[member.puuid].games + " 场同模式对局"
                        : "正在读取"
                }}</span
              >
            </div>
            <div v-if="!selection.members.length" class="empty-state tall">
              <Users :size="35" :stroke-width="1.2" />
              <h3>等待英雄选择</h3>
              <p>助手已准备好，进入选人后自动同步。</p>
            </div>
            <SourceBadge v-if="overview" :source="overview.source" />
          </section>
          <div class="section-line spaced">
            <h2>备选英雄</h2>
            <span class="muted small">查看胜率 · 点击查看配装</span>
          </div>
          <div class="bench-grid">
            <button
              v-for="id in selection.bench"
              :key="id"
              class="bench-card"
              @click="chooseHero(id, true)"
            >
              <ChampionIcon :champion="champions.get(id)" :size="52" />
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

        <template v-if="page === 'history'">
          <div class="search-toolbar">
            <div class="search-field wide">
              <Search :size="17" /><input
                v-model="riotId"
                placeholder="游戏名#标签 · 查询当前大区"
                aria-label="玩家游戏名"
                @keyup.enter="searchPlayer"
              /><button
                class="text-button"
                :disabled="busy.search"
                @click="searchPlayer"
              >
                {{ busy.search ? "查询中" : "查询玩家" }}
              </button>
            </div>
            <button class="button secondary" @click="showMyHistory">
              我的战绩
            </button>
          </div>
          <div v-if="historyTarget" class="player-summary">
            <div class="avatar-large">
              {{ historyTarget.gameName.slice(0, 1) || "召" }}
            </div>
            <div>
              <h2>
                {{ historyTarget.gameName
                }}<span class="muted">#{{ historyTarget.tagLine }}</span>
              </h2>
              <p>
                等级 {{ historyTarget.level }} ·
                {{ state.platform || "当前大区"
                }}<span v-if="winSummary?.games">
                  · 已加载 {{ winSummary.games }} 场有效对局，胜率
                  {{ percent(winSummary.wins / winSummary.games) }}</span
                >
              </p>
            </div>
          </div>
          <div v-if="errors.search || errors.history" class="notice warning">
            <CircleAlert :size="17" /><span>{{
              errors.search || errors.history
            }}</span>
          </div>
          <div v-if="historyPage?.warning" class="notice">
            <CircleAlert :size="17" /><span
              >{{ historyPage.warning }} ·
              {{ date(historyPage.fetchedAt) }}</span
            >
          </div>
          <div v-if="busy.history && !historyPage" class="loading-state tall">
            <RefreshCw
              :size="23"
              class="spinning"
            />正在读取大区战绩，服务繁忙时需要稍候
          </div>
          <div v-if="historyPage" class="match-list">
            <button
              v-for="match in historyPage.matches"
              :key="match.id"
              :class="[
                'match-row',
                playerFor(match)?.win ? 'victory' : 'defeat',
                { remake: match.remake },
              ]"
              @click="showMatch(match)"
            >
              <div class="match-result">
                <strong>{{
                  match.remake
                    ? "重开"
                    : playerFor(match)?.win
                      ? "胜利"
                      : "失败"
                }}</strong
                ><small>{{
                  match.mode === "KIWI"
                    ? "海克斯大乱斗"
                    : match.mode === "ARAM"
                      ? "极地大乱斗"
                      : match.mode === "CLASSIC"
                        ? "召唤师峡谷"
                        : match.mode
                }}</small>
              </div>
              <ChampionIcon
                :champion="champions.get(playerFor(match)?.championId || 0)"
                :size="46"
              />
              <div class="match-kda">
                <strong
                  >{{ playerFor(match)?.kills }}
                  <span>/ {{ playerFor(match)?.deaths }} /</span>
                  {{ playerFor(match)?.assists }}</strong
                ><small>{{
                  champions.get(playerFor(match)?.championId || 0)?.name
                }}</small>
              </div>
              <div class="match-items">
                <span
                  v-for="id in playerFor(match)?.items.slice(0, 6)"
                  :key="id"
                  class="item-icon"
                  :title="catalog.items[id]?.name || String(id)"
                  ><img
                    v-if="catalog.items[id]?.icon"
                    :src="catalog.items[id].icon"
                    alt=""
                    loading="lazy"
                  /><small v-else>{{ id }}</small></span
                >
              </div>
              <div class="match-time">
                <strong
                  >{{ Math.floor(match.duration / 60) }}:{{
                    String(match.duration % 60).padStart(2, "0")
                  }}</strong
                ><small>{{ date(match.date) }}</small>
              </div>
              <ChevronRight :size="16" />
            </button>
            <div v-if="!historyPage.matches.length" class="empty-state tall">
              <History :size="30" />
              <h3>暂无可展示的战绩</h3>
              <p>该查询窗口没有公开对局记录。</p>
            </div>
            <button
              v-if="historyPage.hasMore"
              class="button secondary load-more"
              :disabled="busy.history"
              @click="loadHistory(true)"
            >
              {{ busy.history ? "正在读取…" : "加载更多对局" }}
            </button>
          </div>
          <div
            v-if="!historyPage && !busy.history && !errors.history"
            class="panel empty-state tall"
          >
            <History :size="35" :stroke-width="1.2" />
            <h3>从最近一场开始</h3>
            <p>查询自己或同区玩家，查看真实对局记录。</p>
            <button class="button primary" @click="showMyHistory">
              查看我的战绩
            </button>
          </div>
        </template>

        <template v-if="page === 'champion' || page === 'hex'">
          <div class="filters">
            <div class="compact-tabs mode-tabs">
              <button
                v-for="mode in page === 'hex'
                  ? modes.filter((item) => item.id === 'hex')
                  : modes"
                :key="mode.id"
                :class="{ active: settings.mode === mode.id }"
                @click="save({ mode: mode.id })"
              >
                {{ mode.name }}
              </button>
            </div>
            <div class="filter-selects">
              <select
                v-if="settings.mode === 'rift'"
                aria-label="统计段位"
                :value="settings.tier"
                @change="
                  save({
                    tier: Number(($event.target as HTMLSelectElement).value),
                  })
                "
              >
                <option :value="255">全部段位</option>
                <option :value="26">翡翠及以上</option>
                <option :value="27">钻石及以上</option>
                <option :value="28">大师及以上</option></select
              ><select
                v-if="settings.mode === 'rift'"
                aria-label="英雄分路"
                :value="settings.position"
                @change="
                  save({
                    position: ($event.target as HTMLSelectElement)
                      .value as Settings['position'],
                  })
                "
              >
                <option
                  v-for="position in positions"
                  :key="position.id"
                  :value="position.id"
                >
                  {{ position.name }}
                </option></select
              ><select
                v-if="settings.mode === 'hex' || page === 'hex'"
                aria-label="海克斯样本分组"
                :value="settings.band"
                @change="
                  save({
                    band: ($event.target as HTMLSelectElement)
                      .value as Settings['band'],
                  })
                "
              >
                <option v-for="band in bands" :key="band.id" :value="band.id">
                  {{ band.name }}
                </option>
              </select>
            </div>
          </div>
          <div class="hero-picker">
            <div class="search-field">
              <Search :size="17" /><input
                v-model="heroSearch"
                placeholder="搜索英雄、称号或英文名"
                aria-label="搜索英雄"
              />
            </div>
            <select
              aria-label="选择英雄"
              :value="selectedId || ''"
              @change="
                chooseHero(Number(($event.target as HTMLSelectElement).value))
              "
            >
              <option value="" disabled>选择一个英雄</option>
              <option
                v-for="hero in visibleHeroes"
                :key="hero.id"
                :value="hero.id"
              >
                {{ hero.name }} · {{ hero.title }}
              </option></select
            ><button
              :class="['button', followHero ? 'soft-accent' : 'secondary']"
              @click="
                followHero = !followHero;
                if (followHero) selectedId = state.championId;
              "
            >
              <Radio :size="15" />{{
                followHero ? "跟随当前英雄" : "手动浏览中"
              }}
            </button>
          </div>
          <div v-if="errors.catalog" class="notice warning">
            <CircleAlert :size="16" /><span>{{ errors.catalog }}</span
            ><button class="text-button" @click="refreshCatalog">
              重试英雄资料
            </button>
          </div>
          <template v-if="page === 'champion'">
            <div v-if="!selectedId" class="hero-browser">
              <div class="section-line">
                <h2>选择你的英雄</h2>
                <span class="muted small">进入选人时也会自动识别</span>
              </div>
              <div v-if="busy.overview" class="loading-state">
                <RefreshCw :size="20" class="spinning" />正在读取英雄数据
              </div>
              <div class="champion-browser-grid">
                <button
                  v-for="stat in filteredHeroStats.slice(0, 36)"
                  :key="stat.championId"
                  class="champion-tile"
                  @click="chooseHero(stat.championId)"
                >
                  <ChampionIcon
                    :champion="champions.get(stat.championId)"
                    :size="52"
                  /><strong>{{
                    champions.get(stat.championId)?.name || stat.championId
                  }}</strong
                  ><span>{{ percent(stat.winRate) }}</span>
                </button>
              </div>
              <p v-if="errors.overview" class="empty-inline">
                {{ errors.overview }}
              </p>
              <SourceBadge v-if="overview" :source="overview.source" />
            </div>
            <template v-else
              ><div class="champion-heading">
                <ChampionIcon :champion="selectedHero" :size="78" />
                <div>
                  <span class="eyebrow">{{ selectedHero?.title }}</span>
                  <h2>{{ selectedHero?.name || "英雄 " + selectedId }}</h2>
                  <p>
                    {{ modes.find((mode) => mode.id === settings.mode)?.name }}
                    ·
                    {{
                      positions.find(
                        (position) => position.id === recommendation?.position,
                      )?.name || "英雄推荐"
                    }}
                  </p>
                </div>
                <div class="champion-rate">
                  <strong>{{ percent(heroStat(selectedId)?.winRate) }}</strong
                  ><span>英雄统计胜率</span>
                </div>
              </div>
              <SourceBadge
                v-if="recommendation"
                :source="recommendation.source"
              />
              <div v-if="busy.recommendation" class="loading-state tall">
                <RefreshCw :size="22" class="spinning" />正在整理装备与符文方案
              </div>
              <div v-if="errors.recommendation" class="notice warning">
                <CircleAlert :size="17" />{{ errors.recommendation }}
              </div>
              <div
                v-if="recommendation && !busy.recommendation"
                class="recommendation-layout"
              >
                <section class="panel equipment-panel">
                  <div class="panel-heading">
                    <div>
                      <h2>装备推荐</h2>
                      <p>比较国服统计中的常见选择</p>
                    </div>
                    <WandSparkles :size="20" class="gold-icon" />
                  </div>
                  <EquipmentRow
                    label="出门装"
                    :options="recommendation.starting"
                    :catalog="catalog"
                  /><EquipmentRow
                    label="鞋子"
                    :options="recommendation.boots"
                    :catalog="catalog"
                  /><EquipmentRow
                    label="核心装备"
                    :options="recommendation.core"
                    :catalog="catalog"
                  /><EquipmentRow
                    label="后续选择"
                    :options="recommendation.later"
                    :catalog="catalog"
                  />
                </section>
                <div class="recommendation-side">
                  <section class="panel">
                    <div class="panel-heading">
                      <div>
                        <h2>技能加点</h2>
                        <p>技能优先级与逐级顺序</p>
                      </div>
                      <Zap :size="19" class="gold-icon" />
                    </div>
                    <div v-if="recommendation.skills.length">
                      <div class="skill-priority">
                        <template
                          v-for="(ability, index) in recommendation.skills[0]
                            .priority"
                          :key="index"
                          ><ChevronRight
                            v-if="index"
                            :size="14"
                            class="muted"
                          /><span class="skill-key">{{
                            ["", "Q", "W", "E", "R"][ability]
                          }}</span></template
                        >
                      </div>
                      <div class="skill-sequence">
                        <span
                          v-for="(ability, index) in recommendation.skills[0]
                            .order"
                          :key="index"
                          ><small>{{ index + 1 }}</small
                          ><b>{{ ["", "Q", "W", "E", "R"][ability] }}</b></span
                        >
                      </div>
                      <p class="small muted">
                        方案胜率
                        {{ percent(recommendation.skills[0].winRate) }} · 选取率
                        {{ percent(recommendation.skills[0].pickRate) }}
                      </p>
                    </div>
                    <p v-else class="empty-inline">当前来源暂无加点统计</p>
                  </section>
                  <section class="panel">
                    <div class="panel-heading">
                      <div>
                        <h2>符文方案</h2>
                        <p>预览后写入助手专用页</p>
                      </div>
                      <Hexagon :size="19" class="gold-icon" />
                    </div>
                    <div
                      v-for="(option, index) in recommendation.runes.slice(
                        0,
                        3,
                      )"
                      :key="index"
                      class="rune-option"
                    >
                      <div class="rune-option-head">
                        <strong>{{
                          catalog.perks[option.perks[0]]?.name || option.label
                        }}</strong
                        ><span>{{ percent(option.winRate) }}</span>
                      </div>
                      <div class="rune-icons">
                        <span
                          v-for="(perk, i) in option.perks.slice(0, 6)"
                          :key="i"
                          :title="catalog.perks[perk]?.name || String(perk)"
                          ><img
                            v-if="catalog.perks[perk]?.icon"
                            :src="catalog.perks[perk].icon"
                            alt=""
                          /><small v-else>{{ perk }}</small></span
                        >
                      </div>
                      <button
                        class="button secondary full-width"
                        @click="
                          runePreview = {
                            option,
                            index,
                            championId: selectedId!,
                            query: { ...query },
                          }
                        "
                      >
                        预览符文方案<ChevronRight :size="14" />
                      </button>
                    </div>
                    <p v-if="!recommendation.runes.length" class="empty-inline">
                      当前来源暂无完整符文方案
                    </p>
                  </section>
                </div>
              </div>
              <div
                v-if="recommendation?.unavailable.length"
                class="source-disclaimer"
              >
                <CircleAlert :size="15" /><span>{{
                  recommendation.unavailable.join(" ")
                }}</span>
              </div></template
            >
          </template>
          <template v-if="page === 'hex'">
            <div class="notice">
              <Hexagon :size="17" /><span
                >海克斯榜使用独立的国服海斗样本。分组是推算水平，不是官方排位段位；与
                Hexdata 海斗分不直接互换。</span
              >
            </div>
            <div class="hex-toolbar">
              <div class="compact-tabs">
                <button
                  :class="{ active: !globalRank }"
                  @click="globalRank = false"
                >
                  {{ selectedHero?.name || "当前英雄" }}专属</button
                ><button
                  :class="{ active: globalRank }"
                  @click="globalRank = true"
                >
                  全局参考
                </button>
              </div>
              <div class="hex-toolbar-actions">
                <button
                  class="button secondary"
                  @click="manualOpen = !manualOpen"
                >
                  手动比较三选一</button
                ><button
                  class="button soft-accent"
                  :disabled="busy.scan"
                  @click="scan"
                >
                  <ScanLine :size="16" />{{
                    busy.scan ? "识别中" : "F6 识别选项"
                  }}
                </button>
              </div>
            </div>
            <div v-if="manualOpen" class="panel manual-panel">
              <h3>选择画面中的三个强化</h3>
              <div class="manual-selects">
                <select
                  v-for="(_, index) in manualIds"
                  :key="index"
                  v-model.number="manualIds[index]"
                  :aria-label="'第' + (index + 1) + '个强化'"
                >
                  <option :value="0">选择强化 {{ index + 1 }}</option>
                  <option
                    v-for="row in ranking?.catalog"
                    :key="row.id"
                    :value="row.id"
                  >
                    {{ row.name }}
                  </option></select
                ><button class="button primary" @click="manual">比较</button>
              </div>
              <p v-if="errors.manual" class="warning-text small">
                {{ errors.manual }}
              </p>
            </div>
            <div v-if="manualComparison" class="recognition-status">
              <Check :size="16" /><span>手动比较 · 保留本次选择</span>
              <button class="text-button" @click="clearManualComparison">
                显示识别结果
              </button>
            </div>
            <div
              v-else-if="
                recognition.status !== 'idle' || recognition.augmentIds.length
              "
              class="recognition-status"
            >
              <ScanLine :size="16" /><span>{{ recognition.message }}</span>
            </div>
            <div
              v-if="recognizedCards.length === 3 && !globalRank"
              class="comparison-grid"
            >
              <div
                v-for="(card, index) in recognizedCards"
                :key="card.augment.id"
                :class="[
                  'comparison-card',
                  { recommended: index === 0 && card.winRate !== null },
                ]"
              >
                <span
                  v-if="index === 0 && card.winRate !== null"
                  class="best-label"
                  ><Check :size="12" />优先参考</span
                ><span :class="['rarity-label', card.augment.rarity]">{{
                  rarityName(card.augment.rarity)
                }}</span>
                <h3>{{ card.augment.name }}</h3>
                <strong>{{ percent(card.winRate) }}</strong>
                <p>
                  {{
                    card.games === null
                      ? "暂无当前组统计"
                      : count(card.games) + " 场"
                  }}
                  {{
                    card.games === null
                      ? ""
                      : card.lowSample
                        ? "· 低样本，仅供参考"
                        : "· 有统计样本支持"
                  }}
                </p>
                <small v-if="card.delta !== null"
                  >相对英雄基准 {{ card.delta >= 0 ? "+" : ""
                  }}{{ (card.delta * 100).toFixed(1) }} 个百分点</small
                >
              </div>
            </div>
            <div class="rank-filters">
              <div class="compact-tabs">
                <button
                  v-for="item in [
                    { id: 'all', name: '全部品质' },
                    { id: 'silver', name: '白银' },
                    { id: 'gold', name: '黄金' },
                    { id: 'prismatic', name: '棱彩' },
                  ]"
                  :key="item.id"
                  :class="{ active: rarity === item.id }"
                  @click="rarity = item.id"
                >
                  {{ item.name }}
                </button>
              </div>
              <div class="search-field">
                <Search :size="16" /><input
                  v-model="augmentSearch"
                  placeholder="搜索强化名称"
                  aria-label="搜索强化"
                />
              </div>
            </div>
            <div v-if="busy.ranking" class="loading-state tall">
              <RefreshCw
                :size="22"
                class="spinning"
              />正在读取并校验国服海克斯数据
            </div>
            <div v-if="errors.ranking" class="notice warning">
              <CircleAlert :size="17" />{{ errors.ranking }}
            </div>
            <section v-if="ranking && !busy.ranking" class="panel rank-panel">
              <div class="table-header augment-columns">
                <span>排名 / 强化</span><span>品质</span><span>原始胜率</span
                ><span>平滑胜率</span><span>样本场次</span>
              </div>
              <div
                v-for="(row, index) in visibleAugments"
                :key="row.augment.id"
                class="augment-row augment-columns"
              >
                <div class="augment-name">
                  <span class="list-rank">{{
                    String(index + 1).padStart(2, "0")
                  }}</span
                  ><Hexagon :size="21" :class="row.augment.rarity" /><strong>{{
                    row.augment.name
                  }}</strong>
                </div>
                <span :class="['rarity-label', row.augment.rarity]">{{
                  rarityName(row.augment.rarity)
                }}</span
                ><strong class="accent-text tabular">{{
                  percent(row.winRate)
                }}</strong
                ><span class="tabular">{{ percent(row.smoothedWinRate) }}</span
                ><span class="sample-count"
                  >{{ count(row.games)
                  }}<span v-if="row.lowSample" class="low-sample"
                    >低样本</span
                  ></span
                >
              </div>
              <div v-if="!visibleAugments.length" class="empty-state">
                <p>没有符合筛选条件的强化</p>
              </div>
              <SourceBadge :source="ranking.source" />
            </section>
            <p v-if="ranking" class="source-disclaimer">
              {{ ranking.exposure }} ·
              平滑仅用于排序；高胜率不代表本局获胜概率。
            </p>
          </template>
        </template>

        <template v-if="page === 'settings'">
          <section class="panel settings-panel">
            <div class="panel-heading">
              <div>
                <h2>对局自动化</h2>
                <p>由你决定何时启用</p>
              </div>
              <Zap :size="20" class="gold-icon" />
            </div>
            <div class="setting-row">
              <div>
                <strong>自动接受对局</strong>
                <p>客户端出现接受提示后执行，仅处理当前确认。</p>
              </div>
              <button
                class="switch"
                :class="{ on: settings.autoAccept }"
                role="switch"
                :aria-checked="settings.autoAccept"
                aria-label="自动接受对局"
                @click="save({ autoAccept: !settings.autoAccept })"
              >
                <span></span>
              </button>
            </div>
            <div class="setting-row">
              <div>
                <strong>接受延迟</strong>
                <p>确认阶段结束或连接断开时取消。</p>
              </div>
              <select
                aria-label="接受延迟"
                :value="settings.acceptDelayMs"
                @change="
                  save({
                    acceptDelayMs: Number(
                      ($event.target as HTMLSelectElement).value,
                    ),
                  })
                "
              >
                <option :value="1000">1 秒</option>
                <option :value="2000">2 秒</option>
                <option :value="3000">3 秒</option>
                <option :value="5000">5 秒</option>
              </select>
            </div>
          </section>
          <section class="panel settings-panel">
            <div class="panel-heading">
              <div>
                <h2>海克斯识别</h2>
                <p>强化画面在本机识别，不上传截图</p>
              </div>
              <ScanLine :size="20" class="gold-icon" />
            </div>
            <div class="setting-row">
              <div>
                <strong>自动检测三选一</strong>
                <p>仅在海克斯对局中检测。也可按 F6 手动识别。</p>
              </div>
              <button
                class="switch"
                :class="{ on: settings.autoRecognize }"
                role="switch"
                :aria-checked="settings.autoRecognize"
                aria-label="自动检测三选一"
                @click="save({ autoRecognize: !settings.autoRecognize })"
              >
                <span></span>
              </button>
            </div>
            <div class="setting-row">
              <div>
                <strong>游戏内悬浮窗</strong>
                <p>识别成功时显示；穿透点击，不抢走游戏焦点。</p>
              </div>
              <button
                class="switch"
                :class="{ on: settings.overlay }"
                role="switch"
                :aria-checked="settings.overlay"
                aria-label="游戏内悬浮窗"
                @click="save({ overlay: !settings.overlay })"
              >
                <span></span>
              </button>
            </div>
            <div class="setting-row">
              <div>
                <strong>识别显示器</strong>
                <p>推荐自动跟随前台游戏窗口。游戏需使用无边框或窗口模式。</p>
              </div>
              <select
                aria-label="识别显示器"
                :value="settings.monitor"
                @change="
                  save({
                    monitor: Number(($event.target as HTMLSelectElement).value),
                  })
                "
              >
                <option
                  v-for="display in displays"
                  :key="display.id"
                  :value="display.id"
                >
                  {{ display.name }}
                </option>
              </select>
            </div>
          </section>
          <section class="panel settings-panel">
            <div class="panel-heading">
              <div>
                <h2>数据与连接</h2>
                <p>每一个数字都应该有来源</p>
              </div>
              <ShieldCheck :size="20" class="gold-icon" />
            </div>
            <div class="setting-row">
              <div>
                <strong>客户端连接</strong>
                <p>{{ state.message }}</p>
              </div>
              <span class="tiny-tag">{{ state.region || "等待连接" }}</span>
            </div>
            <div class="setting-row">
              <div>
                <strong>海斗数值分</strong>
                <p>
                  优先接入 Hexdata，当前等待正式接入资料与授权，不生成替代评分。
                </p>
              </div>
              <button
                class="button secondary"
                @click="api.openExternal('hexdata')"
              >
                官方查分页<ExternalLink :size="14" />
              </button>
            </div>
            <div class="setting-row">
              <div>
                <strong>海克斯分层数据</strong>
                <p>
                  AramHex · CC BY-NC 4.0。娱乐、中分和前 5%
                  为推算分组，非官方段位。
                </p>
              </div>
              <button
                class="text-button"
                @click="api.openExternal('data-license')"
              >
                数据与许可<ArrowUpRight :size="14" />
              </button>
            </div>
            <div class="privacy-note">
              <ShieldCheck :size="16" /><span
                >客户端认证只在主进程内存中使用。用户配置和成功查询的缓存保存在本机，截图不保存到磁盘。</span
              >
            </div>
          </section>
        </template>
        <footer class="page-footer">
          <span>英雄联盟助手 <i>·</i> 独立社区项目</span
          ><span>国服数据 <span class="footer-dot"></span> 本机连接</span>
        </footer>
      </div>
    </main>
    <div v-if="toast" class="toast" role="status">
      <CircleAlert :size="16" />{{ toast
      }}<button aria-label="关闭提示" @click="toast = ''">
        <X :size="15" />
      </button>
    </div>
    <div
      v-if="runePreview"
      class="modal-backdrop"
      @click.self="runePreview = null"
    >
      <section
        class="modal rune-modal"
        role="dialog"
        aria-modal="true"
        aria-label="符文方案预览"
      >
        <div class="panel-heading">
          <div>
            <span class="eyebrow">应用前确认</span>
            <h2>
              {{ champions.get(runePreview.championId)?.name }} · 符文方案
            </h2>
          </div>
          <button
            class="icon-button"
            aria-label="关闭符文预览"
            @click="runePreview = null"
          >
            <X :size="20" />
          </button>
        </div>
        <div class="rune-preview-grid">
          <div v-for="(perk, index) in runePreview.option.perks" :key="index">
            <img
              v-if="catalog.perks[perk]?.icon"
              :src="catalog.perks[perk].icon"
              alt=""
            /><Hexagon v-else :size="26" /><span>{{
              catalog.perks[perk]?.name || perk
            }}</span>
          </div>
        </div>
        <p class="muted small">
          将写入助手专用页面。已有的其他符文页保持原样；没有空位时会提示。
        </p>
        <p v-if="errors.runes" class="notice warning">{{ errors.runes }}</p>
        <div class="modal-actions">
          <button class="button secondary" @click="runePreview = null">
            取消</button
          ><button
            class="button primary"
            :disabled="busy.runes || state.status !== 'connected'"
            @click="applyRunes"
          >
            {{ busy.runes ? "正在应用…" : "确认应用符文" }}
          </button>
        </div>
      </section>
    </div>
    <div
      v-if="detail"
      class="modal-backdrop"
      @click.self="
        detail = null;
        detailEpoch++;
      "
    >
      <section
        class="modal match-modal"
        role="dialog"
        aria-modal="true"
        aria-label="单局战绩详情"
      >
        <div class="panel-heading">
          <div>
            <span class="eyebrow">单局详情</span>
            <h2>
              {{
                detail.mode === "KIWI"
                  ? "海克斯大乱斗"
                  : detail.mode === "ARAM"
                    ? "极地大乱斗"
                    : "召唤师峡谷"
              }}<span class="muted small"> · {{ date(detail.date) }}</span>
            </h2>
          </div>
          <button
            class="icon-button"
            aria-label="关闭单局详情"
            @click="
              detail = null;
              detailEpoch++;
            "
          >
            <X :size="20" />
          </button>
        </div>
        <p v-if="busy.detail" class="muted small">正在补充完整记分板…</p>
        <p v-if="errors.detail" class="notice warning">{{ errors.detail }}</p>
        <p v-if="detail.players.length < 10" class="muted small">
          当前仅有
          {{ detail.players.length }} 名玩家的可用记录，暂无完整十人数据。
        </p>
        <div class="scoreboard-head scoreboard-columns">
          <span>玩家 / 英雄</span><span>K / D / A</span><span>英雄伤害</span
          ><span>金币</span>
        </div>
        <div
          v-for="(player, index) in detail.players"
          :key="player.puuid || index"
          class="scoreboard-row scoreboard-columns"
        >
          <div class="team-identity">
            <ChampionIcon
              :champion="champions.get(player.championId)"
              :size="34"
            />
            <div>
              <strong>{{ player.name || "名字未提供" }}</strong
              ><small :class="player.win ? 'accent-text' : 'loss-text'"
                >{{ player.win ? "胜利方" : "失败方" }} ·
                {{
                  champions.get(player.championId)?.name || player.championId
                }}</small
              >
            </div>
          </div>
          <strong class="tabular"
            >{{ player.kills }} / {{ player.deaths }} /
            {{ player.assists }}</strong
          ><span class="tabular">{{ player.damage.toLocaleString() }}</span
          ><span class="tabular">{{ player.gold.toLocaleString() }}</span>
        </div>
      </section>
    </div>
  </div>
</template>
