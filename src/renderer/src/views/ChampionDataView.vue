<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Hexagon,
  Radio,
  RefreshCw,
  ScanLine,
  Search,
  WandSparkles,
  X,
  Zap,
} from "@lucide/vue";
import { api, unwrap } from "../api";
import {
  catalog,
  catalogError,
  champions,
  dataHero,
  browseHero,
  followClientHero,
  notify,
  refreshCatalog,
  save,
  settings,
  state,
} from "../store";
import {
  count,
  modes,
  outdatedNote,
  percent,
  positions,
  rarityName,
} from "../format";
import SourceBadge from "../components/SourceBadge.vue";
import ChampionIcon from "../components/ChampionIcon.vue";
import EquipmentRow from "../components/EquipmentRow.vue";
import type {
  AramggAugment,
  AramggChampion,
  AugmentRanking,
  HeroStat,
  Overview,
  Recognition,
  Recommendation,
  RuneOption,
  Settings,
  StatsQuery,
} from "../../../shared/types";

const tab = ref<"build" | "hex">("build");
const overview = ref<Overview | null>(null),
  recommendation = ref<Recommendation | null>(null),
  ranking = ref<AugmentRanking | null>(null);
const errors = ref<Record<string, string>>({}),
  busy = ref<Record<string, boolean>>({});
const heroSearch = ref(""),
  augmentSearch = ref(""),
  rarity = ref("all"),
  globalRank = ref(false);
const runePreview = ref<{
  option: RuneOption;
  index: number;
  championId: number;
  query: StatsQuery;
} | null>(null);
const recognition = ref<Recognition>({
  status: "idle",
  message: "等待海克斯三选一",
  augmentIds: [],
  rawTexts: [],
  captureId: 0,
  monitor: 0,
  updatedAt: "",
});
const manualIds = ref([0, 0, 0]),
  manualOpen = ref(false),
  manualComparison = ref<number[] | null>(null);
let manualEpoch = 0,
  overviewEpoch = 0,
  recEpoch = 0,
  rankEpoch = 0;
let unsubscribe = () => {};

const selectedId = computed(() => dataHero.value.id);
const selectedHero = computed(() => champions.value.get(selectedId.value ?? 0));
const query = computed<StatsQuery>(() => ({
  mode: settings.value.mode,
  band: settings.value.band,
  tier: settings.value.tier,
  position: settings.value.position,
}));
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
const heroStat = (id: number | null) =>
  heroStats.value.find((stat) => stat.championId === id);
const matches = (id: number) => {
  const hero = champions.value.get(id);
  return (
    !heroSearch.value ||
    ((hero?.name ?? "") + (hero?.alias ?? "") + (hero?.title ?? ""))
      .toLowerCase()
      .includes(heroSearch.value.trim().toLowerCase())
  );
};
/** 有统计的英雄按胜率排序；搜索时补充当前来源没有统计的英雄，胜率显示为空。 */
const heroRows = computed(() => {
  const rows: { id: number; stat: HeroStat | null; rank: number | null }[] =
    heroStats.value
      .map((stat, index) => ({ id: stat.championId, stat, rank: index + 1 }))
      .filter((row) => matches(row.id));
  if (heroSearch.value.trim()) {
    const known = new Set(rows.map((row) => row.id));
    for (const hero of catalog.value.champions)
      if (!known.has(hero.id) && !heroStat(hero.id) && matches(hero.id))
        rows.push({ id: hero.id, stat: null, rank: null });
  }
  return rows;
});
const visibleAugments = computed(() =>
  (ranking.value?.augments ?? []).filter(
    (row) =>
      (rarity.value === "all" || row.augment.rarity === rarity.value) &&
      row.augment.name
        .toLowerCase()
        .includes(augmentSearch.value.toLowerCase()),
  ),
);
/** 海克斯数据来源：默认 aramgg，未选择时按 aramgg 处理。 */
const hexSource = computed(() => settings.value.hexSource ?? "aramgg");
const aramgg = ref<AramggChampion | null>(null);
let aramggEpoch = 0;
async function loadAramgg() {
  const epoch = ++aramggEpoch;
  aramgg.value = null;
  errors.value.aramgg = "";
  const id = selectedId.value;
  if (!id || hexSource.value !== "aramgg") return;
  busy.value.aramgg = true;
  try {
    const response = await unwrap(api.getAramggChampion(id));
    if (epoch === aramggEpoch) aramgg.value = response;
  } catch (error) {
    if (epoch === aramggEpoch) errors.value.aramgg = (error as Error).message;
  } finally {
    if (epoch === aramggEpoch) busy.value.aramgg = false;
  }
}
const aramggRows = computed(() =>
  (aramgg.value?.augments ?? []).filter(
    (row) =>
      (rarity.value === "all" || row.rarity === rarity.value) &&
      row.name.toLowerCase().includes(augmentSearch.value.toLowerCase()),
  ),
);
/** 识别或手动选择的三张强化，按 aramgg 的国服推荐顺序排序。 */
const aramggCards = computed(() => {
  const data = aramgg.value;
  if (!data) return [];
  const ids = manualComparison.value
    ? data.championId === selectedId.value
      ? manualComparison.value
      : []
    : state.value.championId && data.championId !== state.value.championId
      ? []
      : recognition.value.augmentIds;
  return ids
    .map(
      (id) =>
        data.augments.find((row) => row.id === id) ??
        ({
          id,
          name:
            ranking.value?.catalog.find((row) => row.id === id)?.name ??
            `强化 ${id}`,
          rarity:
            ranking.value?.catalog.find((row) => row.id === id)?.rarity ?? "",
          iconUrl: null,
          tier: null,
          rank: null,
          total: null,
          winRate: null,
          games: null,
          pickRate: null,
        } satisfies AramggAugment),
    )
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
});
const recognizedCards = computed(() =>
  (manualComparison.value
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
  const id = globalRank.value ? null : selectedId.value,
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
function refresh() {
  void loadOverview();
  if (tab.value === "hex") {
    void loadRanking();
    void loadAramgg();
  } else void loadRecommendation();
}
async function applyRunes() {
  const preview = runePreview.value;
  if (!preview) return;
  busy.value.runes = true;
  errors.value.runes = "";
  try {
    await unwrap(
      api.applyRunes(preview.championId, { ...preview.query }, preview.index, [
        ...preview.option.perks,
      ]),
    );
    runePreview.value = null;
    notify("符文已应用到助手专用页面");
  } catch (error) {
    errors.value.runes = (error as Error).message;
  } finally {
    busy.value.runes = false;
  }
}
async function scan() {
  clearManualComparison();
  busy.value.scan = true;
  errors.value.scan = "";
  try {
    recognition.value = await unwrap(api.scanAugments());
  } catch (error) {
    errors.value.scan = (error as Error).message;
    notify((error as Error).message);
  } finally {
    busy.value.scan = false;
  }
}
async function manual() {
  if (!selectedId.value) {
    notify("请先选择要比较的英雄");
    return;
  }
  const epoch = manualEpoch;
  busy.value.manual = true;
  errors.value.manual = "";
  try {
    const value = await unwrap(api.setManualAugments([...manualIds.value]));
    if (epoch === manualEpoch) {
      manualComparison.value = [...value.augmentIds];
      manualOpen.value = false;
      globalRank.value = false;
    }
  } catch (error) {
    errors.value.manual = (error as Error).message;
  } finally {
    busy.value.manual = false;
  }
}
function clearManualComparison() {
  manualComparison.value = null;
  manualEpoch++;
}
function toggleFollow() {
  if (dataHero.value.follow && selectedId.value) browseHero(selectedId.value);
  else followClientHero();
}
function saveSelect(key: "tier" | "position" | "band", event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  void save({
    [key]: key === "tier" ? Number(value) : value,
  } as Partial<Settings>);
}
watch(
  query,
  (next, previous) => {
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    clearManualComparison();
    void loadOverview();
    if (next.mode !== "hex" && tab.value === "hex") tab.value = "build";
    else if (tab.value === "hex") void loadRanking();
    if (tab.value === "build") void loadRecommendation();
  },
  { deep: true },
);
watch(selectedId, () => {
  clearManualComparison();
  if (tab.value === "hex") void loadAramgg();
  if (tab.value === "build") void loadRecommendation();
  else void loadRanking();
});
watch(globalRank, () => void loadRanking());
watch(hexSource, () => {
  if (tab.value === "hex") void loadAramgg();
});
watch(tab, (value) => {
  if (value === "hex") void loadAramgg();
  if (value === "build" && !recommendation.value) void loadRecommendation();
  if (value === "hex") void loadRanking();
});
watch(
  () =>
    `${state.value.summoner?.puuid}:${state.value.phase}:${state.value.mode}:${state.value.championId}`,
  (_, previous) => {
    clearManualComparison();
    if (previous?.split(":")[0] !== state.value.summoner?.puuid)
      runePreview.value = null;
  },
);
// 进入选人时，若仍在跟随客户端，统计模式切到当前对局模式。
watch(
  () => state.value.phase,
  (phase) => {
    if (
      phase === "ChampSelect" &&
      dataHero.value.follow &&
      state.value.status === "connected" &&
      settings.value.mode !== state.value.mode
    )
      void save({ mode: state.value.mode });
  },
);
onMounted(async () => {
  unsubscribe = api.onRecognition((value) => (recognition.value = value));
  const current = await api.getRecognition();
  if (current.ok && current.data) recognition.value = current.data;
  void loadOverview();
  if (selectedId.value) void loadRecommendation();
});
onUnmounted(() => unsubscribe());
defineExpose({ refresh });
</script>

<template>
  <section class="data-view">
    <div class="data-toolbar">
      <div class="compact-tabs mode-tabs">
        <button
          v-for="mode in modes"
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
          @change="saveSelect('tier', $event)"
        >
          <option :value="255">全部段位</option>
          <option :value="26">翡翠及以上</option>
          <option :value="27">钻石及以上</option>
          <option :value="28">大师及以上</option></select
        ><select
          v-if="settings.mode === 'rift'"
          aria-label="英雄分路"
          :value="settings.position"
          @change="saveSelect('position', $event)"
        >
          <option
            v-for="position in positions"
            :key="position.id"
            :value="position.id"
          >
            {{ position.name }}
          </option></select
        ><select
          v-if="settings.mode === 'hex'"
          aria-label="海克斯样本分组"
          :value="settings.band"
          @change="saveSelect('band', $event)"
        >
          <option v-for="band in bands" :key="band.id" :value="band.id">
            {{ band.name }}
          </option>
        </select>
      </div>
      <button
        class="button secondary"
        :disabled="busy.recommendation || busy.ranking || busy.overview"
        @click="refresh"
      >
        <RefreshCw :size="15" />刷新数据
      </button>
    </div>
    <div v-if="catalogError" class="notice warning">
      <CircleAlert :size="16" /><span>{{ catalogError }}</span
      ><button class="text-button" @click="refreshCatalog">重试英雄资料</button>
    </div>
    <div class="data-layout">
      <aside class="hero-rank-panel" aria-label="英雄榜">
        <div class="search-field">
          <Search :size="16" /><input
            v-model="heroSearch"
            placeholder="搜索英雄、称号或英文名"
            aria-label="搜索英雄"
          />
        </div>
        <div class="hero-rank-head">
          <span>英雄</span><span>胜率</span><span>选取率</span>
        </div>
        <div class="hero-rank-list">
          <div v-if="busy.overview" class="loading-state">
            <RefreshCw :size="18" class="spinning" />正在读取国服统计
          </div>
          <p v-else-if="errors.overview" class="empty-inline">
            {{ errors.overview }}
          </p>
          <button
            v-for="row in heroRows"
            :key="row.id"
            :class="[
              'hero-rank-row',
              {
                active: selectedId === row.id,
                current: state.championId === row.id,
              },
            ]"
            :aria-label="'选择英雄 ' + (champions.get(row.id)?.name || row.id)"
            @click="browseHero(row.id)"
          >
            <span class="list-rank">{{
              row.rank === null ? "—" : String(row.rank).padStart(2, "0")
            }}</span
            ><ChampionIcon :champion="champions.get(row.id)" :size="30" /><span
              class="hero-rank-name"
              ><b>{{ champions.get(row.id)?.name || "英雄 " + row.id }}</b
              ><small v-if="state.championId === row.id">当前英雄</small></span
            ><span class="tabular">{{ percent(row.stat?.winRate) }}</span
            ><span class="tabular muted">{{
              row.stat?.pickRate !== null && row.stat?.pickRate !== undefined
                ? percent(row.stat.pickRate)
                : row.stat?.games !== null && row.stat?.games !== undefined
                  ? count(row.stat.games) + "场"
                  : "—"
            }}</span>
          </button>
          <p
            v-if="!busy.overview && !errors.overview && !heroRows.length"
            class="empty-inline"
          >
            没有匹配的英雄
          </p>
        </div>
        <SourceBadge v-if="overview" :source="overview.source" />
      </aside>
      <div class="data-detail">
        <div class="champion-heading">
          <ChampionIcon :champion="selectedHero" :size="64" />
          <div>
            <span class="eyebrow">{{ selectedHero?.title || "英雄数据" }}</span>
            <h2>
              {{
                selectedHero?.name ||
                (selectedId ? "英雄 " + selectedId : "选择一个英雄")
              }}
            </h2>
            <p>
              {{ modes.find((mode) => mode.id === settings.mode)?.name }}
              <template v-if="settings.mode === 'rift'"
                >·
                {{
                  positions.find(
                    (position) =>
                      position.id ===
                      (recommendation?.position ?? settings.position),
                  )?.name
                }}</template
              >
            </p>
          </div>
          <div class="champion-rate">
            <strong>{{ percent(heroStat(selectedId)?.winRate) }}</strong
            ><span>英雄统计胜率</span>
          </div>
          <button
            :class="['button', dataHero.follow ? 'soft-accent' : 'secondary']"
            @click="toggleFollow"
          >
            <Radio :size="15" />{{
              dataHero.follow ? "跟随当前英雄" : "手动浏览中"
            }}
          </button>
        </div>
        <div class="detail-tabs" role="tablist" aria-label="英雄数据视图">
          <button
            role="tab"
            :aria-selected="tab === 'build'"
            :class="{ active: tab === 'build' }"
            @click="tab = 'build'"
          >
            <WandSparkles :size="15" />出装与符文
          </button>
          <button
            v-if="settings.mode === 'hex'"
            role="tab"
            :aria-selected="tab === 'hex'"
            :class="{ active: tab === 'hex' }"
            @click="tab = 'hex'"
          >
            <Hexagon :size="15" />海克斯强化
          </button>
        </div>

        <template v-if="tab === 'build'">
          <div v-if="!selectedId" class="empty-state tall">
            <WandSparkles :size="32" :stroke-width="1.2" />
            <h3>从左侧选择英雄</h3>
            <p>进入选人后会自动跟随你的英雄。</p>
          </div>
          <template v-else>
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
                    v-for="(option, index) in recommendation.runes.slice(0, 3)"
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
            </div>
          </template>
        </template>

        <template v-if="tab === 'hex'">
          <div class="hex-source" role="group" aria-label="海克斯数据来源">
            <span>数据来源</span>
            <div class="compact-tabs">
              <button
                :class="{ active: hexSource === 'aramgg' }"
                :aria-pressed="hexSource === 'aramgg'"
                @click="save({ hexSource: 'aramgg' })"
              >
                aramgg（默认）</button
              ><button
                :class="{ active: hexSource === 'aramhex' }"
                :aria-pressed="hexSource === 'aramhex'"
                @click="save({ hexSource: 'aramhex' })"
              >
                国服 AramHex 样本
              </button>
            </div>
          </div>
          <div class="notice">
            <Hexagon :size="17" /><span v-if="hexSource === 'aramgg'"
              >推荐顺序与分级来自腾讯国服（经 aramgg 整理）；胜率为 aramgg
              客户端上传的全球样本，满 255
              场才显示。高胜率不代表本局获胜概率。</span
            ><span v-else
              >海克斯榜使用独立的国服海斗样本。分组是推算水平，不是官方排位段位；与
              Hexdata 海斗分不直接互换。</span
            >
          </div>
          <div class="hex-toolbar">
            <div v-if="hexSource === 'aramhex'" class="compact-tabs">
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
            v-if="hexSource === 'aramgg' && aramggCards.length === 3"
            class="comparison-grid aramgg-cards"
          >
            <div
              v-for="(card, index) in aramggCards"
              :key="card.id"
              :class="[
                'comparison-card',
                { recommended: index === 0 && card.rank !== null },
              ]"
            >
              <span v-if="index === 0 && card.rank !== null" class="best-label"
                ><Check :size="12" />国服推荐优先</span
              ><span :class="['rarity-label', card.rarity]">{{
                rarityName(card.rarity)
              }}</span>
              <h3>
                <img v-if="card.iconUrl" :src="card.iconUrl" alt="" />{{
                  card.name
                }}
              </h3>
              <strong
                ><span :class="['tier-badge', 't' + (card.tier ?? 0)]">{{
                  card.tier ? "T" + card.tier : "—"
                }}</span>
                第 {{ card.rank ?? "—" }} / {{ card.total ?? "—" }}</strong
              >
              <p>
                全球胜率 {{ percent(card.winRate) }} ·
                {{
                  card.games === null
                    ? "样本不足 255 场"
                    : count(card.games) + " 场"
                }}
              </p>
            </div>
          </div>
          <div
            v-if="
              hexSource === 'aramhex' &&
              recognizedCards.length === 3 &&
              !globalRank
            "
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
          <div v-if="hexSource === 'aramgg'" class="rank-filters">
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
          <template v-if="hexSource === 'aramgg'">
            <div v-if="busy.aramgg" class="loading-state tall">
              <RefreshCw :size="22" class="spinning" />正在读取 aramgg
              海克斯数据
            </div>
            <div v-else-if="errors.aramgg" class="notice warning">
              <CircleAlert :size="17" /><span>{{ errors.aramgg }}</span
              ><button
                class="text-button"
                @click="save({ hexSource: 'aramhex' })"
              >
                暂用国服 AramHex
              </button>
            </div>
            <section v-else-if="aramgg" class="panel rank-panel aramgg-panel">
              <div class="table-header aramgg-columns">
                <span>国服推荐顺序 / 强化</span><span>品质</span
                ><span>分级</span><span>全球胜率</span><span>样本</span
                ><span>选取率</span>
              </div>
              <div
                v-for="row in aramggRows"
                :key="row.id"
                class="augment-row aramgg-row aramgg-columns"
              >
                <div class="augment-name">
                  <span class="list-rank">{{
                    row.rank === null ? "—" : String(row.rank).padStart(2, "0")
                  }}</span
                  ><img
                    v-if="row.iconUrl"
                    :src="row.iconUrl"
                    alt=""
                    class="aramgg-icon"
                  /><Hexagon v-else :size="21" :class="row.rarity" /><strong>{{
                    row.name
                  }}</strong>
                </div>
                <span :class="['rarity-label', row.rarity]">{{
                  rarityName(row.rarity)
                }}</span
                ><span :class="['tier-badge', 't' + (row.tier ?? 0)]">{{
                  row.tier ? "T" + row.tier : "—"
                }}</span
                ><strong class="accent-text tabular">{{
                  percent(row.winRate)
                }}</strong
                ><span class="tabular">{{
                  row.games === null ? "不足 255" : count(row.games)
                }}</span
                ><span class="tabular">{{ percent(row.pickRate) }}</span>
              </div>
              <div v-if="!aramggRows.length" class="empty-state">
                <p>没有符合筛选条件的强化</p>
              </div>
              <p class="source-note aramgg-source">
                {{ aramgg.source.name }} · 版本
                {{ aramgg.source.dataVersion || "未提供" }} · 统计日期
                {{ aramgg.source.date || "未提供" }} · 英雄整体胜率
                {{ percent(aramgg.winRate) }}（腾讯国服）<span
                  v-if="outdatedNote(aramgg.source)"
                  class="aramgg-outdated"
                >
                  · {{ outdatedNote(aramgg.source) }}</span
                ><span v-if="aramgg.source.stale">
                  · 网络不可用，显示上次缓存</span
                >
              </p>
            </section>
            <div
              v-if="aramgg && (aramgg.trios.length || aramgg.builds.length)"
              class="aramgg-extras"
            >
              <section v-if="aramgg.trios.length" class="panel">
                <div class="panel-heading">
                  <div>
                    <h2>三强化组合</h2>
                    <p>同一玩家选中的三个强化，至少 151 场</p>
                  </div>
                </div>
                <div
                  v-for="(trio, index) in aramgg.trios"
                  :key="index"
                  class="aramgg-trio"
                >
                  <span>{{
                    trio.names.join(" + ") || trio.ids.join(" + ")
                  }}</span
                  ><strong class="tabular">{{ percent(trio.winRate) }}</strong
                  ><small>{{ count(trio.games) }} 场</small>
                </div>
              </section>
              <section v-if="aramgg.builds.length" class="panel">
                <div class="panel-heading">
                  <div>
                    <h2>出装流派</h2>
                    <p>当前补丁的多流派出装与技能</p>
                  </div>
                </div>
                <div
                  v-for="(item, index) in aramgg.builds"
                  :key="index"
                  class="aramgg-build"
                >
                  <div class="aramgg-build-head">
                    <strong>{{ item.tags || "流派 " + (index + 1) }}</strong
                    ><span
                      >胜率 {{ percent(item.winRate) }} · 选取
                      {{ percent(item.pickRate) }} ·
                      {{ count(item.games) }} 场</span
                    >
                  </div>
                  <div v-if="item.core[0]" class="aramgg-items">
                    <small>核心</small
                    ><span
                      v-for="id in item.core[0].ids"
                      :key="id"
                      :title="catalog.items[id]?.name"
                      ><img
                        v-if="catalog.items[id]?.icon"
                        :src="catalog.items[id].icon"
                        alt=""
                    /></span>
                    <small class="muted">{{
                      percent(item.core[0].winRate)
                    }}</small>
                  </div>
                  <div v-if="item.spells[0]" class="aramgg-line">
                    <small>召唤师技能</small
                    >{{ item.spells[0].names.join(" + ") }}
                    <small class="muted">{{
                      percent(item.spells[0].winRate)
                    }}</small>
                  </div>
                  <div v-if="item.skills[0]" class="aramgg-line">
                    <small>加点</small
                    ><span class="aramgg-skills">{{
                      item.skills[0].keys.join(" ")
                    }}</span>
                  </div>
                </div>
              </section>
            </div>
          </template>
          <div v-if="hexSource === 'aramhex'" class="rank-filters">
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
          <template v-if="hexSource === 'aramhex'">
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
      </div>
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
  </section>
</template>
