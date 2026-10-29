<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import BrandMark from "./components/BrandMark.vue";
import { api, unwrap } from "./api";
import { count, outdatedNote, percent, rarityName } from "./format";
import {
  augmentGrades,
  gradeFromRank,
  shouldConsiderRefresh,
} from "../../shared/augment-grade";
import type {
  AramggChampion,
  AugmentRanking,
  ConnectionState,
  Recognition,
  Settings,
} from "../../shared/types";

// 游戏内穿透悬浮窗：始终跟随实时识别，不保留主窗口的手动比较。
const state = ref<ConnectionState | null>(null);
const band = ref<Settings["band"]>("all");
const hexSource = ref<NonNullable<Settings["hexSource"]>>("aramgg");
const aramgg = ref<AramggChampion | null>(null);
const recognition = ref<Recognition>({
  status: "idle",
  message: "等待海克斯三选一",
  augmentIds: [],
  rawTexts: [],
  captureId: 0,
  monitor: 0,
  updatedAt: "",
});
const ranking = ref<AugmentRanking | null>(null);
const error = ref("");
const names = ref(new Map<number, string>());
const heroName = computed(
  () => names.value.get(state.value?.championId ?? 0) ?? "",
);
let epoch = 0;
let unsubscribe: (() => void)[] = [];
async function loadRanking() {
  const current = ++epoch;
  error.value = "";
  ranking.value = null;
  aramgg.value = null;
  const championId = state.value?.championId ?? null;
  // 默认使用 aramgg；读取失败时仍显示国服 AramHex 样本。
  if (hexSource.value === "aramgg" && championId)
    void unwrap(api.getAramggChampion(championId))
      .then((response) => {
        if (current === epoch) aramgg.value = response;
      })
      .catch(() => {});
  try {
    const response = await unwrap(api.getAugments(championId, band.value));
    if (current === epoch) ranking.value = response;
  } catch (reason) {
    if (current === epoch) error.value = (reason as Error).message;
  }
}
const cards = computed(() =>
  (state.value?.championId &&
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
watch(
  () => state.value?.championId,
  () => void loadRanking(),
);
watch(band, () => void loadRanking());
watch(hexSource, () => void loadRanking());
/** aramgg 三张卡：按腾讯国服推荐顺序排序，显示分级、位次与全球胜率。 */
const aramggCards = computed(() => {
  const data = aramgg.value;
  if (!data || data.championId !== state.value?.championId) return [];
  const rows = recognition.value.augmentIds.map((id) =>
    data.augments.find((row) => row.id === id),
  );
  if (rows.some((row) => !row)) return [];
  return (rows as NonNullable<(typeof rows)[number]>[]).sort(
    (a, b) => (a.rank ?? 9999) - (b.rank ?? 9999),
  );
});
/** 本英雄强化内的相对评级：AramHex 按平滑胜率分位，aramgg 按国服推荐顺序分位。 */
const hexGrades = computed(
  () => new Map(augmentGrades(ranking.value?.augments ?? [])),
);
const cardGrades = computed(() =>
  aramggCards.value.length === 3
    ? aramggCards.value.map((card) => gradeFromRank(card.rank, card.total))
    : cards.value.length === 3
      ? cards.value.map((card) => hexGrades.value.get(card.augment.id) ?? null)
      : [],
);
const refreshHint = computed(() => shouldConsiderRefresh(cardGrades.value));
onMounted(async () => {
  unsubscribe = [
    api.onState((value) => (state.value = value)),
    api.onSettings((value) => {
      band.value = value.band;
      hexSource.value = value.hexSource ?? "aramgg";
    }),
    api.onRecognition((value) => {
      recognition.value = value;
      if (value.status === "recognized" && !ranking.value) void loadRanking();
    }),
  ];
  const [currentState, currentSettings, currentRecognition, currentCatalog] =
    await Promise.all([
      api.getState(),
      api.getSettings(),
      api.getRecognition(),
      api.getCatalog(),
    ]);
  if (currentSettings.ok && currentSettings.data) {
    band.value = currentSettings.data.band;
    hexSource.value = currentSettings.data.hexSource ?? "aramgg";
  }
  if (currentState.ok && currentState.data) state.value = currentState.data;
  if (currentRecognition.ok && currentRecognition.data)
    recognition.value = currentRecognition.data;
  if (currentCatalog.ok && currentCatalog.data)
    names.value = new Map(
      currentCatalog.data.champions.map((hero) => [hero.id, hero.name]),
    );
  void loadRanking();
});
onUnmounted(() => unsubscribe.forEach((stop) => stop()));
</script>

<template>
  <div class="overlay-shell">
    <div class="overlay-heading">
      <BrandMark :size="18" /><strong>三选一参考</strong
      ><span>{{ heroName || "当前英雄" }}</span>
    </div>
    <div v-if="aramggCards.length === 3" class="overlay-cards">
      <div
        v-for="(card, index) in aramggCards"
        :key="card.id"
        :class="['overlay-card', { best: index === 0 && card.rank !== null }]"
      >
        <span :class="['tier-badge', 't' + (card.tier ?? 0)]">{{
          card.tier ? "T" + card.tier : "—"
        }}</span>
        <div>
          <strong>{{ card.name }}</strong
          ><small
            >国服推荐第 {{ card.rank ?? "—" }} 位 ·
            {{
              card.games === null ? "全球样本不足" : count(card.games) + " 场"
            }}</small
          >
        </div>
        <b
          >{{ percent(card.winRate)
          }}<i :class="['grade', cardGrades[index] ?? 'none']">{{
            cardGrades[index] ?? "—"
          }}</i></b
        >
      </div>
    </div>
    <div v-else-if="cards.length === 3" class="overlay-cards">
      <div
        v-for="(card, index) in cards"
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
        <b
          >{{ percent(card.winRate)
          }}<i :class="['grade', cardGrades[index] ?? 'none']">{{
            cardGrades[index] ?? "—"
          }}</i></b
        >
      </div>
    </div>
    <p v-else class="muted">
      {{
        recognition.status === "scanning"
          ? recognition.message
          : error || "正在读取当前英雄统计…"
      }}
    </p>
    <p v-if="refreshHint" class="overlay-refresh">
      三张都在 C 档或以下，可考虑刷新
    </p>
    <div class="overlay-footer">
      <template v-if="aramggCards.length === 3"
        >aramgg ·
        {{
          (aramgg && outdatedNote(aramgg.source)) ||
          aramgg?.source.dataVersion ||
          "版本未提供"
        }}</template
      ><template v-else
        >国服样本 ·
        {{ ranking?.source.date?.slice(0, 10) || "日期未提供" }}</template
      ><span>F6 重新识别</span>
    </div>
  </div>
</template>
