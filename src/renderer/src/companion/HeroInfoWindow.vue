<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ArrowUpRight, ChevronRight, RefreshCw, Swords, X } from "@lucide/vue";
import { api, unwrap } from "../api";
import ChampionIcon from "../components/ChampionIcon.vue";
import {
  act,
  catalog,
  companion,
  error,
  hero,
  loadOverview,
  message,
  modeName,
  percent,
  query,
  startCompanion,
  state,
  stats,
  view,
} from "./useCompanion";
import type {
  AugmentRanking,
  ItemOption,
  Recommendation,
} from "../../../shared/types";

const recommendation = ref<Recommendation | null>(null),
  ranking = ref<AugmentRanking | null>(null);
const tab = ref<"build" | "runes" | "augments">("build");
const loading = ref(false),
  dataError = ref(""),
  applying = ref(false),
  runePreview = ref<number | null>(null);
let epoch = 0;
let stop = () => {};

const itemRows = computed(() => {
  const rec = recommendation.value;
  if (!rec) return [];
  return [
    { name: "出门装", rows: rec.starting.slice(0, 1) },
    { name: "鞋子", rows: rec.boots.slice(0, 1) },
    { name: "核心装备", rows: rec.core.slice(0, 2) },
  ];
});
const items = (row: ItemOption) =>
  row.ids.map((id) => catalog.value.items[id]).filter(Boolean);
async function loadHero() {
  const version = ++epoch,
    id = companion.value.championId;
  recommendation.value = null;
  ranking.value = null;
  runePreview.value = null;
  dataError.value = "";
  loading.value = false;
  if (!id) return;
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
onMounted(() => {
  stop = startCompanion(
    (account) => {
      if (account) void loadHero();
    },
    { rating: false },
  );
  void loadHero();
});
onUnmounted(() => {
  epoch++;
  stop();
});
</script>

<template>
  <div class="companion-shell info">
    <header class="companion-titlebar">
      <div class="companion-brand"><Swords :size="15" />英雄信息</div>
      <div class="window-actions">
        <button aria-label="打开工作台" title="打开主窗口" @click="act('main')">
          <ArrowUpRight :size="15" />
        </button>
        <button
          aria-label="收起弹窗"
          title="收起，下一阶段再出现"
          @click="act('hide')"
        >
          <X :size="15" />
        </button>
      </div>
    </header>
    <div v-if="!hero" class="companion-empty">
      <Swords :size="26" />
      <strong>等待选择英雄</strong>
      <small>在 Mini 窗点击头像查看方案</small>
    </div>
    <template v-else>
      <section class="companion-hero-heading">
        <ChampionIcon :champion="hero" :size="46" />
        <div>
          <h1>{{ hero.name }}</h1>
          <small>{{ hero.title }} · {{ modeName }}</small>
        </div>
        <div class="info-rate">
          <strong>{{ percent(stats.get(hero.id)?.winRate) }}</strong
          ><small>统计胜率</small>
        </div>
      </section>
      <button
        v-if="!companion.followingClient"
        class="info-follow"
        @click="view(null)"
      >
        正在查看其他英雄 · 回到当前英雄
      </button>
      <nav class="info-tabs" role="tablist" aria-label="英雄信息">
        <button
          role="tab"
          :aria-selected="tab === 'build'"
          :class="{ active: tab === 'build' }"
          @click="tab = 'build'"
        >
          出装
        </button>
        <button
          role="tab"
          :aria-selected="tab === 'runes'"
          :class="{ active: tab === 'runes' }"
          @click="tab = 'runes'"
        >
          符文
        </button>
        <button
          v-if="state.mode === 'hex'"
          role="tab"
          :aria-selected="tab === 'augments'"
          :class="{ active: tab === 'augments' }"
          @click="tab = 'augments'"
        >
          强化
        </button>
      </nav>
      <main class="info-body">
        <div v-if="loading" class="companion-empty small">
          <RefreshCw class="spinning" :size="18" /><small
            >正在读取国服统计</small
          >
        </div>
        <template v-else-if="tab === 'build'">
          <section v-for="group in itemRows" :key="group.name" class="info-row">
            <h3>{{ group.name }}</h3>
            <div
              v-for="(row, index) in group.rows"
              :key="index"
              class="info-items"
            >
              <img
                v-for="(item, i) in items(row)"
                :key="i"
                :src="item.icon"
                :title="item.name"
                alt=""
              /><span>{{ percent(row.winRate) }}</span>
            </div>
            <p v-if="!group.rows.length" class="compact-empty">
              当前来源未提供
            </p>
          </section>
          <section class="info-row">
            <h3>技能加点</h3>
            <div v-if="recommendation?.skills.length" class="info-skills">
              <template
                v-for="(key, index) in recommendation.skills[0].priority"
                :key="index"
                ><ChevronRight v-if="index" :size="12" /><b>{{
                  ["", "Q", "W", "E", "R"][key]
                }}</b></template
              >
            </div>
            <p v-else class="compact-empty">当前来源未提供</p>
          </section>
        </template>
        <template v-else-if="tab === 'runes'">
          <div
            v-for="(rune, index) in recommendation?.runes.slice(0, 2) ?? []"
            :key="index"
            class="compact-rune"
          >
            <div class="compact-rune-head">
              <strong>{{
                catalog.perks[rune.perks[0]]?.name || rune.label
              }}</strong
              ><span>{{ percent(rune.winRate) }}</span>
            </div>
            <div class="compact-perks">
              <span
                v-for="(perk, i) in rune.perks.slice(0, 6)"
                :key="i"
                :title="catalog.perks[perk]?.name || String(perk)"
                ><img
                  v-if="catalog.perks[perk]?.icon"
                  :src="catalog.perks[perk].icon"
                  alt=""
                /><small v-else>{{ perk }}</small></span
              >
              <button
                class="compact-apply"
                :disabled="state.status !== 'connected'"
                @click="runePreview = index"
              >
                应用
              </button>
            </div>
            <small class="compact-label">{{ rune.label }}</small>
          </div>
          <p v-if="!recommendation?.runes.length" class="compact-empty">
            当前来源暂无完整符文方案
          </p>
        </template>
        <template v-else>
          <div
            v-for="row in ranking?.augments.slice(0, 8) ?? []"
            :key="row.augment.id"
            class="compact-augment"
          >
            <span :class="['augment-dot', row.augment.rarity]"></span
            ><strong>{{ row.augment.name }}</strong
            ><b>{{ percent(row.winRate) }}</b
            ><small
              >{{ row.games ?? "—" }} 场{{
                row.lowSample ? " · 低样本" : ""
              }}</small
            >
          </div>
          <p v-if="!ranking?.augments.length" class="compact-empty">
            当前分组暂无强化统计
          </p>
        </template>
      </main>
      <p class="info-source">
        {{
          tab === "augments"
            ? ranking?.source.name
            : recommendation?.source.name
        }}
        ·
        {{
          (tab === "augments"
            ? ranking?.source.date
            : recommendation?.source.date
          )?.slice(0, 10) || "日期未提供"
        }}
      </p>
    </template>
    <p v-if="dataError || error" class="companion-notice" role="alert">
      {{ dataError || error }}
    </p>
    <p v-else-if="message" class="companion-success" role="status">
      {{ message }}
    </p>
    <div
      v-if="runePreview !== null && recommendation"
      class="companion-modal"
      role="dialog"
      aria-label="应用前确认符文"
    >
      <section>
        <h3>应用前确认符文</h3>
        <div class="compact-perks">
          <span
            v-for="(perk, i) in recommendation.runes[runePreview].perks"
            :key="i"
            :title="catalog.perks[perk]?.name || String(perk)"
            ><img
              v-if="catalog.perks[perk]?.icon"
              :src="catalog.perks[perk].icon"
              alt=""
            /><small v-else>{{ perk }}</small></span
          >
        </div>
        <p>只写入助手专用符文页，其他符文页保持原样。</p>
        <div class="companion-modal-actions">
          <button @click="runePreview = null">取消</button
          ><button
            class="compact-primary"
            :disabled="applying || state.status !== 'connected'"
            @click="applyRunes"
          >
            {{ applying ? "正在应用…" : "确认应用" }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
