<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import BrandMark from "./components/BrandMark.vue";
import { api, unwrap } from "./api";
import { count, outdatedNote, percent, rarityName } from "./format";
import {
  augmentGrades,
  gradeFromRank,
  shouldConsiderRefresh,
  type AugmentGrade,
} from "../../shared/augment-grade";
import type {
  AramggChampion,
  AugmentRanking,
  ConnectionState,
  Recognition,
  RecognitionSlot,
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

/**
 * 卡片标注（参考太农海克斯助手的游戏内标注方式）：识别进程给出三张卡在画面中的位置，
 * 悬浮窗盖住游戏画面，在每张卡下部画评级徽章。三张卡统一用同一个数据来源。
 */
interface CardBadge {
  slot: RecognitionSlot;
  kind: "rated" | "unknown" | "nodata";
  name: string;
  grade: AugmentGrade | null;
  winRate: number | null;
  detail: string;
  order: number;
  best: boolean;
}
const coverMode = ref(false);
/** 识别出的强化全部在 aramgg 数据里时用 aramgg，否则统一用国服 AramHex。 */
const badgeUsesAramgg = computed(() => {
  const data = aramgg.value;
  if (hexSource.value !== "aramgg" || !data) return false;
  if (data.championId !== state.value?.championId) return false;
  return (recognition.value.slots ?? []).every(
    (slot) =>
      slot.augmentId === null ||
      data.augments.some((row) => row.id === slot.augmentId),
  );
});
const badges = computed<CardBadge[]>(() => {
  const slots = recognition.value.slots ?? [];
  const championId = state.value?.championId ?? 0;
  if (slots.length !== 3 || !championId) return [];
  const data = aramgg.value;
  const rows = ranking.value?.championId === championId ? ranking.value : null;
  const useAramgg = badgeUsesAramgg.value;
  const list: CardBadge[] = slots.map((slot) => {
    const id = slot.augmentId;
    if (!id)
      return {
        slot,
        kind: "unknown",
        name: "未识别",
        grade: null,
        winRate: null,
        detail: "按 F6 重试",
        order: 9999,
        best: false,
      };
    if (useAramgg) {
      const row = data!.augments.find((item) => item.id === id)!;
      return {
        slot,
        kind: "rated",
        name: row.name,
        grade: gradeFromRank(row.rank, row.total),
        winRate: row.winRate,
        detail: row.rank ? `国服第 ${row.rank} 位` : "国服未排序",
        order: row.rank ?? 9999,
        best: false,
      };
    }
    const row = rows?.augments.find((item) => item.augment.id === id);
    if (row)
      return {
        slot,
        kind: "rated",
        name: row.augment.name,
        grade: hexGrades.value.get(id) ?? null,
        winRate: row.winRate,
        detail:
          row.games === null
            ? "暂无统计"
            : `${count(row.games)} 场${row.lowSample ? " · 低样本" : ""}`,
        order: row.smoothedWinRate === null ? 9999 : 1 - row.smoothedWinRate,
        best: false,
      };
    const name = rows?.catalog.find((item) => item.id === id)?.name ?? "";
    return {
      slot,
      kind: "nodata",
      name,
      grade: null,
      winRate: null,
      detail: "暂无该强化数据",
      order: 9999,
      best: false,
    };
  });
  // 至少两张有评级且第一名唯一时标“推荐”。
  const rated = list.filter((badge) => badge.grade && badge.order < 9999);
  if (rated.length >= 2) {
    const top = Math.min(...rated.map((badge) => badge.order));
    const leaders = rated.filter((badge) => badge.order === top);
    if (leaders.length === 1) leaders[0].best = true;
  }
  return list;
});
const badgeRefresh = computed(() =>
  shouldConsiderRefresh(badges.value.map((badge) => badge.grade)),
);
const badgeSource = computed(() => {
  const data = aramgg.value;
  if (badgeUsesAramgg.value && data)
    return `评级：腾讯国服推荐顺序 · 胜率：aramgg 全球样本（不足 255 场留空）${
      outdatedNote(data.source)
        ? " · " + outdatedNote(data.source)
        : data.source.dataVersion
          ? " · " + data.source.dataVersion
          : ""
    }`;
  return `评级与胜率：国服 AramHex 样本 · ${ranking.value?.source.date?.slice(0, 10) || "日期未提供"}`;
});
const captionTop = computed(() => {
  const tops = (recognition.value.slots ?? []).map((slot) => slot.top);
  return tops.length ? Math.max(0.02, Math.min(...tops) - 0.05) : 0.1;
});
watch(
  () => recognition.value,
  (value) => {
    if ((value.slots?.length ?? 0) === 3) coverMode.value = true;
    else if (value.status !== "scanning") coverMode.value = false;
  },
);
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
  <div v-if="badges.length === 3" class="overlay-cover">
    <div
      v-for="badge in badges"
      :key="badge.slot.slot"
      :class="['hex-mark', { best: badge.best }]"
      :style="{
        left: badge.slot.centerX * 100 + '%',
        top: badge.slot.badgeY * 100 + '%',
        width: badge.slot.width * 78 + 'vw',
      }"
    >
      <span v-if="badge.best" class="hex-pick">推荐</span>
      <div :class="['hex-badge', badge.kind, 'g-' + (badge.grade ?? 'none')]">
        <b class="hex-grade">{{
          badge.kind === "rated" ? (badge.grade ?? "—") : "?"
        }}</b>
        <span class="hex-body">
          <strong>{{
            badge.kind === "rated"
              ? percent(badge.winRate)
              : badge.name || "无数据"
          }}</strong>
          <small>{{ badge.detail }}</small>
        </span>
      </div>
    </div>
    <div class="cover-caption" :style="{ top: captionTop * 100 + '%' }">
      <span v-if="badgeRefresh" class="cover-refresh"
        >三张都在 C 档或以下，可考虑刷新</span
      >
      <span>{{ badgeSource }} · F6 重新识别</span>
    </div>
  </div>
  <div v-else-if="coverMode" class="overlay-cover">
    <div class="cover-caption" style="top: 12%">
      <span>{{ recognition.message || "正在识别三选一…" }}</span>
    </div>
  </div>
  <div v-else class="overlay-shell">
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

<style scoped>
/* 卡片标注：窗口与游戏画面同尺寸，vw/vh 即游戏画面的比例。 */
.overlay-cover {
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: "Bahnschrift", "Microsoft YaHei UI", sans-serif;
}
.hex-mark {
  position: absolute;
  transform: translate(-50%, -50%);
}
.hex-badge {
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 0.8vh;
  padding: 0.6vh 1vh;
  border-radius: 0.8vh;
  border: 2px solid #9aabc2;
  background: #0c121ced;
  color: #eef4fc;
  box-shadow: 0 0.4vh 1.4vh #000a;
}
.hex-grade {
  font-size: clamp(18px, 3.6vh, 64px);
  line-height: 1;
  min-width: 1.1em;
  text-align: center;
}
.hex-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.15;
}
.hex-body strong {
  font-size: clamp(13px, 2.2vh, 40px);
  white-space: nowrap;
}
.hex-body small {
  font-size: clamp(10px, 1.3vh, 24px);
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hex-badge.g-S {
  border-color: #ffd056;
  background: #46321eed;
  color: #fff5be;
}
.hex-badge.g-A {
  border-color: #67da8b;
  background: #123a24ed;
  color: #cbffdb;
}
.hex-badge.g-B {
  border-color: #67b2f8;
  background: #102a46ed;
  color: #cee8ff;
}
.hex-badge.g-C {
  border-color: #b08bec;
  background: #2c1e48ed;
  color: #e7daff;
}
.hex-badge.g-D {
  border-color: #e86f6f;
  background: #461c1ced;
  color: #ffd1d1;
}
.hex-badge.unknown,
.hex-badge.nodata {
  border-style: dashed;
}
.hex-mark.best .hex-badge {
  box-shadow:
    0 0 0 2px #ffd05666,
    0 0 2.4vh #ffd05688;
}
.hex-pick {
  /* 贴在徽章右上角，不遮挡卡片描述，三张卡的徽章保持同一高度。 */
  position: absolute;
  top: 0;
  right: 0.8vh;
  transform: translateY(-60%);
  padding: 0.1vh 0.7vh;
  border-radius: 0.5vh;
  font-size: clamp(10px, 1.4vh, 24px);
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #fff;
  background: #d8433a;
  box-shadow: 0 0.2vh 0.6vh #0009;
}

.cover-caption {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4vh;
  white-space: nowrap;
  font-size: clamp(10px, 1.3vh, 22px);
  color: #e6dcc3;
  text-shadow:
    0 0 0.5vh #000,
    0 0 1vh #000;
}
.cover-caption span {
  padding: 0.3vh 1vh;
  border-radius: 0.6vh;
  background: #0c121cb3;
}
.cover-refresh {
  color: #ffd056;
  font-weight: 600;
}
</style>
