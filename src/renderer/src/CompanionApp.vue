<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  Swords,
  X,
  Search,
  Radio,
  ArrowUpRight,
  RefreshCw,
  Check,
  CircleAlert,
  ChevronRight,
  Users,
  BookOpen,
} from "@lucide/vue";
import { api, unwrap } from "./api";
import ChampionIcon from "./components/ChampionIcon.vue";
import SourceBadge from "./components/SourceBadge.vue";
import type {
  AugmentRanking,
  Catalog,
  ChampionChoices,
  CompanionState,
  ConnectionState,
  Overview,
  Recommendation,
  Selection,
  Settings,
  SkillRating,
  StatsQuery,
} from "../../shared/types";
import "./companion.css";

const picker = location.hash === "#champion-picker";
const state = ref<ConnectionState>({
  status: "searching",
  message: "正在连接客户端",
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
const companion = ref<CompanionState>({
  championId: null,
  followingClient: true,
});
const selection = ref<Selection>({
  members: [],
  bench: [],
  localCellId: null,
  championId: null,
});
const choices = ref<ChampionChoices>({
  championIds: [],
  kind: "none",
  reason: "等待进入英雄选择",
});
const catalog = ref<Catalog>({
  champions: [],
  items: {},
  perks: {},
  version: null,
});
const overview = ref<Overview | null>(null),
  recommendation = ref<Recommendation | null>(null),
  ranking = ref<AugmentRanking | null>(null);
const rating = ref<SkillRating | null>(null);
const search = ref(""),
  tab = ref("build"),
  onlyAvailable = ref(true),
  error = ref(""),
  ratingError = ref(""),
  dataError = ref(""),
  loading = ref(false),
  choosing = ref(false),
  loadingCatalog = ref(false);
const runePreview = ref<number | null>(null),
  applying = ref(false),
  message = ref("");
let epoch = 0,
  overviewEpoch = 0,
  ratingEpoch = 0,
  selectionEpoch = 0,
  viewEpoch = 0;
const sessionContext = () =>
  `${state.value.status}:${state.value.platform}:${state.value.summoner?.puuid}:${state.value.phase}`;
let timer: ReturnType<typeof setInterval> | undefined;
const unsubscribers: (() => void)[] = [];
const heroes = computed(
  () => new Map(catalog.value.champions.map((hero) => [hero.id, hero])),
);
const hero = computed(() => heroes.value.get(companion.value.championId || 0));
const modeName = computed(
  () =>
    ({ rift: "召唤师峡谷", aram: "极地大乱斗", hex: "海克斯大乱斗" })[
      state.value.mode
    ],
);
const query = computed<StatsQuery>(() => ({
  mode: state.value.mode,
  band: settings.value.band,
  tier: settings.value.tier,
  position: settings.value.position,
}));
const stats = computed(
  () =>
    new Map((overview.value?.heroes || []).map((row) => [row.championId, row])),
);
const stat = computed(() => stats.value.get(companion.value.championId || 0));
const available = computed(() => new Set(choices.value.championIds));
const listedHeroes = computed(() =>
  catalog.value.champions
    .filter((hero) => {
      const text = (hero.name + hero.title + hero.alias).toLowerCase();
      return (
        text.includes(search.value.trim().toLowerCase()) &&
        (!onlyAvailable.value ||
          !available.value.size ||
          available.value.has(hero.id) ||
          state.value.championId === hero.id)
      );
    })
    .sort(
      (a, b) =>
        (stats.value.get(b.id)?.winRate ?? -1) -
        (stats.value.get(a.id)?.winRate ?? -1),
    ),
);
const phase = computed(() => {
  if (state.value.status !== "connected")
    return {
      title: "正在连接客户端",
      description: "启动并登录国服客户端后自动同步",
      kind: "waiting",
    };
  const phases: Record<
    string,
    { title: string; description: string; kind: string }
  > = {
    Lobby: {
      title: "客户端已连接 · 等待匹配",
      description: "进入队列后自动同步匹配与选人状态",
      kind: "waiting",
    },
    None: {
      title: "客户端已连接",
      description: "进入房间后自动跟随当前模式",
      kind: "waiting",
    },
    Matchmaking: {
      title: "正在匹配对局",
      description: "匹配成功后提示确认，进入选人自动同步",
      kind: "matching",
    },
    ReadyCheck: {
      title: "对局已找到",
      description: settings.value.autoAccept
        ? "自动接受已开启 · 正在等待确认"
        : "请在客户端接受对局",
      kind: "ready",
    },
    ChampSelect: {
      title: "英雄选择中",
      description:
        choices.value.kind === "bench"
          ? "点击换用备选席英雄，客户端同步更新"
          : "查看英雄方案，轮到你时可换用英雄",
      kind: "selecting",
    },
    InProgress: {
      title: "对局进行中",
      description: "选人窗已收起，海克斯识别跟随游戏",
      kind: "waiting",
    },
  };
  return (
    phases[state.value.phase] || {
      title: "客户端已连接",
      description: modeName.value,
      kind: "waiting",
    }
  );
});
const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const count = (value: number | null | undefined) =>
  value == null ? "未提供" : value.toLocaleString("zh-CN");
const canChoose = (id: number) =>
  state.value.phase === "ChampSelect" &&
  available.value.has(id) &&
  state.value.championId !== id &&
  !choosing.value;
async function act(action: "hide" | "show" | "main") {
  try {
    await unwrap(api.companionWindow(action));
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function view(id: number | null) {
  const version = ++viewEpoch,
    context = sessionContext();
  try {
    const response = await unwrap(api.selectCompanionChampion(id));
    if (version === viewEpoch && context === sessionContext())
      companion.value = response;
  } catch (e) {
    if (version === viewEpoch && context === sessionContext())
      error.value = (e as Error).message;
  }
}
async function choose(id: number) {
  if (!canChoose(id)) return;
  choosing.value = true;
  error.value = "";
  const context = sessionContext();
  try {
    await unwrap(api.chooseChampion(id));
    if (context !== sessionContext()) return;
    message.value = "已发送换用请求 · 以客户端结果为准";
    await view(null);
    await refreshSelection();
  } catch (e) {
    if (context === sessionContext()) error.value = (e as Error).message;
  } finally {
    choosing.value = false;
  }
}
async function save(patch: Partial<Settings>) {
  try {
    settings.value = await unwrap(api.saveSettings(patch));
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function loadCatalog() {
  loadingCatalog.value = true;
  try {
    catalog.value = await unwrap(api.getCatalog());
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loadingCatalog.value = false;
  }
}
async function loadOverview() {
  const version = ++overviewEpoch;
  overview.value = null;
  try {
    const response = await unwrap(api.getOverview({ ...query.value }));
    if (version === overviewEpoch) overview.value = response;
  } catch (e) {
    if (version === overviewEpoch) dataError.value = (e as Error).message;
  }
}
async function loadHero() {
  const version = ++epoch,
    id = companion.value.championId;
  recommendation.value = null;
  ranking.value = null;
  runePreview.value = null;
  dataError.value = "";
  loading.value = false;
  if (!id || picker) return;
  loading.value = true;
  const value = { ...query.value };
  const requests = [
    unwrap(api.getRecommendation(id, value)).then((result) => {
      if (version === epoch) recommendation.value = result;
    }),
  ];
  if (value.mode === "hex")
    requests.push(
      unwrap(api.getAugments(id, value.band)).then((result) => {
        if (version === epoch) ranking.value = result;
      }),
    );
  const results = await Promise.allSettled(requests);
  if (version !== epoch) return;
  const rejected = results.find((result) => result.status === "rejected");
  if (rejected?.status === "rejected")
    dataError.value =
      rejected.reason instanceof Error
        ? rejected.reason.message
        : "统计暂时无法读取";
  loading.value = false;
}
async function loadRating() {
  const version = ++ratingEpoch;
  rating.value = null;
  ratingError.value = "";
  if (!state.value.summoner || state.value.status !== "connected") return;
  try {
    const value = await unwrap(api.getRating());
    if (version === ratingEpoch) rating.value = value;
  } catch (e) {
    if (version === ratingEpoch) ratingError.value = (e as Error).message;
  }
}
async function refreshSelection() {
  const version = ++selectionEpoch;
  if (state.value.phase !== "ChampSelect") {
    selection.value = {
      members: [],
      bench: [],
      localCellId: null,
      championId: null,
    };
    choices.value = {
      championIds: [],
      kind: "none",
      reason: "进入英雄选择后显示可换用英雄",
    };
    return;
  }
  const results = await Promise.allSettled([
    unwrap(api.getSelection()),
    unwrap(api.getChampionChoices()),
  ]);
  if (version !== selectionEpoch) return;
  if (results[0].status === "fulfilled") selection.value = results[0].value;
  if (results[1].status === "fulfilled") choices.value = results[1].value;
  else
    choices.value = {
      championIds: [],
      kind: "none",
      reason: results[1].reason?.message || "暂时无法读取可选英雄",
    };
}
function acceptState(value: ConnectionState) {
  if (
    state.value.phase !== value.phase ||
    state.value.summoner?.puuid !== value.summoner?.puuid ||
    state.value.platform !== value.platform
  )
    viewEpoch++;
  const account =
    state.value.summoner?.puuid !== value.summoner?.puuid ||
    state.value.platform !== value.platform ||
    state.value.status !== value.status;
  state.value = value;
  if (account) {
    ratingEpoch++;
    rating.value = null;
    message.value = "";
    error.value = "";
    void loadHero();
    void loadRating();
  }
  void refreshSelection();
}
async function applyRunes() {
  const index = runePreview.value,
    id = companion.value.championId,
    rec = recommendation.value;
  if (index === null || !id || !rec) return;
  applying.value = true;
  try {
    await unwrap(
      api.applyRunes(id, { ...query.value }, index, [
        ...rec.runes[index].perks,
      ]),
    );
    message.value = "已应用到助手专用符文页";
    runePreview.value = null;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    applying.value = false;
  }
}
watch(
  () => JSON.stringify(query.value),
  () => {
    if (state.value.mode !== "hex" && tab.value === "augments")
      tab.value = "build";
    dataError.value = "";
    void loadOverview();
    void loadHero();
  },
);
watch(
  () => companion.value.championId,
  () => {
    message.value = "";
    void loadHero();
  },
);
onMounted(async () => {
  unsubscribers.push(
    api.onState(acceptState),
    api.onSettings((value) => (settings.value = value)),
    api.onCompanionState((value) => (companion.value = value)),
  );
  try {
    const [s, p, c] = await Promise.all([
      unwrap(api.getState()),
      unwrap(api.getSettings()),
      unwrap(api.getCompanionState()),
    ]);
    settings.value = p;
    state.value = s;
    companion.value = c;
  } catch (e) {
    error.value = (e as Error).message;
  }
  void loadCatalog();
  void loadOverview();
  void loadHero();
  void loadRating();
  void refreshSelection();
  timer = setInterval(() => void refreshSelection(), 2000);
});
onUnmounted(() => {
  epoch++;
  overviewEpoch++;
  ratingEpoch++;
  selectionEpoch++;
  unsubscribers.forEach((unsub) => unsub());
  clearInterval(timer);
});
</script>

<template>
  <div :class="['companion-shell', picker ? 'picker-window' : 'info-window']">
    <header class="companion-titlebar">
      <div class="companion-brand">
        <Swords :size="16" /><span>英雄联盟助手</span
        ><small>{{ picker ? "快速选择" : "英雄信息" }}</small>
      </div>
      <div class="window-actions">
        <button aria-label="打开工作台" title="打开工作台" @click="act('main')">
          <ArrowUpRight :size="15" /></button
        ><button
          aria-label="收起弹窗"
          title="收起至下一阶段"
          @click="act('hide')"
        >
          <X :size="15" />
        </button>
      </div>
    </header>
    <section :class="['phase-banner', phase.kind]">
      <i class="status-beacon" />
      <div>
        <strong>{{ phase.title }}</strong>
        <p>{{ phase.description }}</p>
      </div>
      <Radio :size="17" />
    </section>
    <section class="rating-card" aria-label="海斗分与位次">
      <div class="rating-heading">
        <span>我的海斗分 <small>Hexdata</small></span
        ><strong>{{
          rating?.provider === "hexdata" &&
          rating?.status === "ready" &&
          rating.score != null
            ? rating.score.toLocaleString("zh-CN")
            : "—"
        }}</strong>
      </div>
      <p>
        {{
          ratingError ||
          (!state.summoner
            ? "等待登录账号"
            : rating?.provider === "hexdata" && rating.status === "ready"
              ? "提供方原始分数"
              : "数值分待接入 · 不以其他评分代替")
        }}
      </p>
      <div
        v-if="rating?.aramhex?.status === 'ready'"
        class="rating-alternative"
      >
        <span>AramHex 区内位次</span
        ><b>{{
          rating.aramhex.percentile == null
            ? "未提供"
            : `前 ${(rating.aramhex.percentile * 100).toFixed(1)}%`
        }}</b>
      </div>
      <p v-if="rating?.aramhex">{{ rating.aramhex.message }}</p>
      <div
        v-else-if="
          rating?.provider === 'hexdata' &&
          rating.status === 'ready' &&
          rating.percentile != null
        "
        class="rating-alternative"
      >
        <span>区内百分位</span><b>{{ rating.percentile }}%</b>
      </div>
      <div class="rating-actions">
        <span
          >{{ state.summoner?.gameName || "未登录"
          }}<small v-if="rating?.date">
            · {{ rating.date.slice(0, 10) }}</small
          ></span
        ><button @click="api.openExternal('hexdata')">
          官方查分 <ArrowUpRight :size="12" />
        </button>
      </div>
    </section>
    <main class="companion-content">
      <template v-if="picker">
        <div class="companion-section-title">
          <h2>快速选择英雄</h2>
          <span>{{ modeName }}</span>
        </div>
        <div class="companion-search">
          <Search :size="15" /><input
            v-model="search"
            aria-label="搜索英雄"
            placeholder="英雄名 / 称号 / 英文名"
          /><button v-if="search" aria-label="清空搜索" @click="search = ''">
            <X :size="13" />
          </button>
        </div>
        <div class="companion-filter">
          <button
            :class="{ active: onlyAvailable }"
            @click="onlyAvailable = true"
          >
            {{ choices.kind === "bench" ? "备选席" : "可选英雄" }}</button
          ><button
            :class="{ active: !onlyAvailable }"
            @click="onlyAvailable = false"
          >
            全部浏览</button
          ><button
            class="follow-toggle"
            :class="{ active: companion.followingClient }"
            @click="view(null)"
          >
            <Radio :size="12" />跟随
          </button>
        </div>
        <p class="choice-help">
          {{
            state.phase === "ChampSelect"
              ? choices.reason
              : "选人后可直接换用 · 现在可提前查看方案"
          }}
        </p>
        <div v-if="loadingCatalog" class="companion-empty">
          <RefreshCw class="spinning" :size="20" /><span>正在读取英雄资料</span>
        </div>
        <div v-else class="champion-grid">
          <article
            v-for="champion in listedHeroes"
            :key="champion.id"
            :data-champion-id="champion.id"
            :class="[
              'quick-hero',
              {
                selected: companion.championId === champion.id,
                current: state.championId === champion.id,
              },
            ]"
          >
            <button
              class="hero-browse"
              :aria-label="`查看${champion.name}`"
              @click="view(champion.id)"
            >
              <ChampionIcon :champion="champion" :size="42" /><strong>{{
                champion.name
              }}</strong
              ><span>{{ percent(stats.get(champion.id)?.winRate) }}</span>
            </button>
            <button
              class="choice-action"
              :aria-label="`换用${champion.name}`"
              :disabled="!canChoose(champion.id)"
              @click="choose(champion.id)"
            >
              {{
                state.championId === champion.id
                  ? "已选用"
                  : canChoose(champion.id)
                    ? "换用"
                    : "查看方案"
              }}
            </button>
          </article>
        </div>
        <div
          v-if="!loadingCatalog && !listedHeroes.length"
          class="companion-empty"
        >
          <Search :size="20" /><span>没有找到匹配英雄</span
          ><button
            @click="
              search = '';
              onlyAvailable = false;
            "
          >
            浏览全部英雄
          </button>
        </div>
        <section v-if="selection.members.length" class="companion-team">
          <h3><Users :size="13" />当前队伍</h3>
          <button
            v-for="member in selection.members"
            :key="member.cellId"
            :title="heroes.get(member.championId)?.name || '待选择'"
            @click="member.championId && view(member.championId)"
          >
            <ChampionIcon
              :champion="heroes.get(member.championId)"
              :size="31"
            /><span>{{ percent(stats.get(member.championId)?.winRate) }}</span>
          </button>
        </section>
      </template>
      <template v-else>
        <div class="companion-section-title">
          <h2>英雄信息</h2>
          <button
            :class="['follow-toggle', { active: companion.followingClient }]"
            @click="view(null)"
          >
            <Radio :size="12" />{{
              companion.followingClient ? "跟随客户端" : "恢复跟随"
            }}
          </button>
        </div>
        <div v-if="!hero" class="companion-empty waiting-hero">
          <div class="hero-placeholder"><Swords :size="28" /></div>
          <h3>等待选择英雄</h3>
          <p>在快速选择窗点击头像查看方案<br />进入选人后自动识别当前英雄</p>
        </div>
        <section v-else class="hero-detail">
          <div class="companion-hero-heading">
            <ChampionIcon :champion="hero" :size="62" />
            <div>
              <small>{{ hero.title }}</small>
              <h1>{{ hero.name }}</h1>
              <span
                >{{ modeName }} ·
                {{ companion.followingClient ? "当前英雄" : "手动查看" }}</span
              >
            </div>
            <button
              v-if="canChoose(hero.id)"
              class="compact-primary choice-action"
              :aria-label="`换用${hero.name}`"
              @click="choose(hero.id)"
            >
              换用 <ChevronRight :size="13" />
            </button>
          </div>
          <div class="hero-stat">
            <div>
              <span>英雄统计胜率</span
              ><strong>{{ percent(stat?.winRate) }}</strong>
            </div>
            <div>
              <span>样本场次</span><b>{{ count(stat?.games) }}</b>
            </div>
            <div>
              <span>选取率</span><b>{{ percent(stat?.pickRate) }}</b>
            </div>
          </div>
          <div class="companion-detail-tabs">
            <button :class="{ active: tab === 'build' }" @click="tab = 'build'">
              装备与加点</button
            ><button
              v-if="state.mode === 'hex'"
              :class="{ active: tab === 'augments' }"
              @click="tab = 'augments'"
            >
              强化排行</button
            ><button
              :class="{ active: tab === 'runes' }"
              @click="tab = 'runes'"
            >
              符文
            </button>
          </div>
          <div v-if="loading" class="companion-empty">
            <RefreshCw class="spinning" :size="20" /><span
              >正在同步国服方案</span
            >
          </div>
          <template v-else-if="tab === 'build'">
            <section
              v-for="group in [
                { name: '出门装', rows: recommendation?.starting },
                { name: '核心装备', rows: recommendation?.core },
                { name: '鞋子', rows: recommendation?.boots },
              ]"
              :key="group.name"
              class="compact-build"
            >
              <h3>{{ group.name }}</h3>
              <div v-if="group.rows?.length" class="compact-item-row">
                <span
                  v-for="(id, index) in group.rows[0].ids"
                  :key="`${id}-${index}`"
                  :title="catalog.items[id]?.name || String(id)"
                  ><img
                    v-if="catalog.items[id]?.icon"
                    :src="catalog.items[id].icon"
                    alt=""
                  /><small v-else>{{ id }}</small
                  ><em>{{ catalog.items[id]?.name || id }}</em></span
                >
              </div>
              <p v-else class="compact-empty">当前模式来源未提供</p>
            </section>
            <section class="compact-build">
              <h3>技能加点</h3>
              <div v-if="recommendation?.skills.length" class="skill-priority">
                <b
                  v-for="(key, index) in recommendation.skills[0].priority"
                  :key="index"
                  >{{ ["", "Q", "W", "E", "R"][key] || key }}</b
                ><span>优先升级</span>
              </div>
              <p v-else class="compact-empty">当前模式来源未提供</p>
              <div
                v-if="recommendation?.skills[0]?.order.length"
                class="compact-skill-order"
              >
                <span
                  v-for="(key, index) in recommendation.skills[0].order"
                  :key="index"
                  ><small>{{ index + 1 }}</small
                  ><b>{{ ["", "Q", "W", "E", "R"][key] || key }}</b></span
                >
              </div>
            </section>
          </template>
          <template v-else-if="tab === 'augments'">
            <p class="compact-caption">当前英雄 · 按平滑胜率排序</p>
            <div
              v-for="(row, index) in ranking?.augments.slice(0, 8)"
              :key="row.augment.id"
              class="compact-augment"
            >
              <small>{{ String(index + 1).padStart(2, "0") }}</small>
              <div>
                <strong>{{ row.augment.name }}</strong>
                <p>
                  {{ count(row.games) }} 场{{
                    row.lowSample ? " · 低样本" : ""
                  }}
                </p>
              </div>
              <b>{{ percent(row.winRate) }}</b>
            </div>
            <p v-if="!ranking?.augments.length" class="compact-empty">
              该英雄暂时没有可用的强化样本
            </p>
          </template>
          <template v-else>
            <div
              v-for="(option, index) in recommendation?.runes.slice(0, 3)"
              :key="index"
              class="compact-rune"
            >
              <div>
                <strong>{{ option.label || "符文方案 " + (index + 1) }}</strong>
                <p>{{ percent(option.winRate) }} 胜率</p>
              </div>
              <button @click="runePreview = index">预览</button>
            </div>
            <p v-if="!recommendation?.runes.length" class="compact-empty">
              当前模式来源未提供常规符文
            </p>
          </template>
          <SourceBadge
            v-if="tab === 'augments' && ranking"
            :source="ranking.source"
          /><SourceBadge
            v-else-if="recommendation"
            :source="recommendation.source"
          />
        </section>
      </template>
      <p v-if="error || dataError" class="companion-notice" role="alert">
        <CircleAlert :size="14" />{{ error || dataError
        }}<button
          @click="
            error = '';
            loadCatalog();
            loadOverview();
            loadHero();
          "
        >
          重试
        </button>
      </p>
      <p v-if="message" class="companion-success" role="status">
        <Check :size="13" />{{ message }}
      </p>
    </main>
    <footer class="companion-footer">
      <span><i />客户端自动同步</span
      ><button @click="save({ autoAccept: !settings.autoAccept })">
        自动接受 <b>{{ settings.autoAccept ? "已开启" : "已关闭" }}</b></button
      ><button aria-label="打开完整工作台" @click="act('main')">
        <BookOpen :size="14" />
      </button>
    </footer>
    <div v-if="runePreview !== null && recommendation" class="companion-modal">
      <div role="dialog" aria-label="符文方案预览">
        <header>
          <h3>应用前确认符文</h3>
          <button aria-label="关闭预览" @click="runePreview = null">
            <X :size="15" />
          </button>
        </header>
        <p>只创建或更新助手专用页。</p>
        <div class="compact-perks">
          <span
            v-for="(id, index) in recommendation.runes[runePreview].perks"
            :key="index"
            >{{ catalog.perks[id]?.name || id }}</span
          >
        </div>
        <button
          class="compact-primary"
          :disabled="applying"
          @click="applyRunes"
        >
          {{ applying ? "正在应用" : "确认应用符文" }}
        </button>
      </div>
    </div>
  </div>
</template>
