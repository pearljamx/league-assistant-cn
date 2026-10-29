<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { Hexagon } from "@lucide/vue";
import { api, unwrap } from "./api";
import { count, percent, rarityName } from "./format";
import type {
  AugmentRanking,
  ConnectionState,
  Recognition,
  Settings,
} from "../../shared/types";

// 游戏内穿透悬浮窗：始终跟随实时识别，不保留主窗口的手动比较。
const state = ref<ConnectionState | null>(null);
const band = ref<Settings["band"]>("all");
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
  const championId = state.value?.championId ?? null;
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
onMounted(async () => {
  unsubscribe = [
    api.onState((value) => (state.value = value)),
    api.onSettings((value) => (band.value = value.band)),
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
  if (currentSettings.ok && currentSettings.data)
    band.value = currentSettings.data.band;
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
      <Hexagon :size="18" /><strong>三选一参考</strong
      ><span>{{ heroName || "当前英雄" }}</span>
    </div>
    <div v-if="cards.length === 3" class="overlay-cards">
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
        <b>{{ percent(card.winRate) }}</b>
      </div>
    </div>
    <p v-else class="muted">
      {{
        recognition.status === "scanning"
          ? recognition.message
          : error || "正在读取当前英雄统计…"
      }}
    </p>
    <div class="overlay-footer">
      国服样本 · {{ ranking?.source.date?.slice(0, 10) || "日期未提供"
      }}<span>F6 重新识别</span>
    </div>
  </div>
</template>
