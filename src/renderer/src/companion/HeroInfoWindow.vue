<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ArrowUpRight, ChevronRight, RefreshCw, Swords, X } from "@lucide/vue";
import { api, unwrap } from "../api";
import ChampionIcon from "../components/ChampionIcon.vue";
import BrandMark from "../components/BrandMark.vue";
import {
  act,
  catalog,
  companion,
  error,
  hero,
  heroes,
  loadOverview,
  message,
  modeName,
  percent,
  query,
  save,
  settings,
  startCompanion,
  state,
  stats,
  view,
} from "./useCompanion";
import { augmentGrades } from "../../../shared/augment-grade";
import { outdatedNote } from "../format";
import type {
  AramggChampion,
  AugmentRanking,
  AugmentStat,
  ItemOption,
  Recommendation,
} from "../../../shared/types";

// 英雄推荐窗：仅在英雄选择阶段出现。海克斯模式默认展示该英雄的强化推荐。
type Tab = "augments" | "build" | "runes";
const recommendation = ref<Recommendation | null>(null),
  ranking = ref<AugmentRanking | null>(null);
const tab = ref<Tab>(state.value.mode === "hex" ? "augments" : "build");
const loading = ref(false),
  dataError = ref(""),
  applying = ref(false),
  runePreview = ref<number | null>(null);
/** 尚未拿到英雄时，对比本人卡片英雄的胜率与前几名强化。 */
const cardIds = ref<number[]>([]);
const cardRankings = ref<Record<string, AugmentRanking | null>>({});
/** aramgg（默认）与国服 AramHex 同时读取；aramgg 不可用时立即显示 AramHex。 */
const hexSource = computed(() => settings.value.hexSource ?? "aramgg");
const aramgg = ref<AramggChampion | null>(null),
  aramggError = ref("");
const cardAramgg = ref<Record<number, AramggChampion | null>>({});
const useAramgg = computed(
  () => hexSource.value === "aramgg" && Boolean(aramgg.value),
);
const aramggTop = computed(() => (aramgg.value?.augments ?? []).slice(0, 10));
const aramggBuild = computed(() => aramgg.value?.builds[0] ?? null);
let epoch = 0,
  cardEpoch = 0;
let stop = () => {},
  poll: ReturnType<typeof setInterval> | undefined;

const tabs = computed<{ id: Tab; name: string }[]>(() =>
  state.value.mode === "hex"
    ? [
        { id: "augments", name: "海克斯" },
        { id: "build", name: "出装" },
        { id: "runes", name: "符文" },
      ]
    : [
        { id: "build", name: "出装" },
        { id: "runes", name: "符文" },
      ],
);
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
const ranked = (data: AugmentRanking | null | undefined) =>
  [...(data?.augments ?? [])].sort(
    (a, b) => (b.smoothedWinRate ?? -1) - (a.smoothedWinRate ?? -1),
  );
const topAugments = computed(() => ranked(ranking.value).slice(0, 10));
const grades = computed(() => augmentGrades(ranking.value?.augments ?? []));
const cardTop = (id: number) => {
  const data = cardRankings.value[`${id}:${settings.value.band}`];
  const gradeMap = augmentGrades(data?.augments ?? []);
  return ranked(data)
    .filter((row) => gradeMap.has(row.augment.id))
    .slice(0, 3)
    .map((row) => ({ row, grade: gradeMap.get(row.augment.id)! }));
};
const gradeOf = (row: AugmentStat) => grades.value.get(row.augment.id) ?? "—";

async function loadHero() {
  const version = ++epoch,
    id = companion.value.championId;
  recommendation.value = null;
  ranking.value = null;
  aramgg.value = null;
  aramggError.value = "";
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
  if (value.mode === "hex") {
    requests.push(
      unwrap(api.getAugments(id, value.band)).then((result) => {
        if (version === epoch) ranking.value = result;
      }),
    );
    if (hexSource.value === "aramgg")
      void unwrap(api.getAramggChampion(id))
        .then((result) => {
          if (version === epoch) aramgg.value = result;
        })
        .catch((reason) => {
          if (version === epoch) aramggError.value = (reason as Error).message;
        });
  }
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
async function loadCards() {
  const version = ++cardEpoch;
  if (
    state.value.phase !== "ChampSelect" ||
    companion.value.championId ||
    state.value.mode !== "hex"
  ) {
    cardIds.value = [];
    return;
  }
  try {
    const choices = await unwrap(api.getChampionChoices());
    if (version !== cardEpoch) return;
    cardIds.value = (
      choices.cards?.length
        ? choices.cards
        : choices.kind === "subset"
          ? choices.championIds
          : []
    ).slice(0, 4);
  } catch {
    if (version === cardEpoch) cardIds.value = [];
    return;
  }
  if (hexSource.value === "aramgg")
    for (const id of cardIds.value) {
      if (id in cardAramgg.value) continue;
      cardAramgg.value[id] = null;
      void unwrap(api.getAramggChampion(id))
        .then((result) => {
          cardAramgg.value[id] = result;
        })
        .catch(() => {
          delete cardAramgg.value[id];
        });
    }
  const band = settings.value.band;
  for (const id of cardIds.value) {
    const key = `${id}:${band}`;
    if (key in cardRankings.value) continue;
    cardRankings.value[key] = null;
    void unwrap(api.getAugments(id, band))
      .then((result) => {
        cardRankings.value[key] = result;
      })
      .catch(() => {
        delete cardRankings.value[key];
      });
  }
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
watch(hexSource, () => {
  cardAramgg.value = {};
  void loadHero();
  void loadCards();
});
watch(
  () => state.value.mode,
  (mode) => {
    if (mode === "hex") tab.value = "augments";
  },
);
watch(
  () => companion.value.championId,
  () => {
    message.value = "";
    void loadHero();
    void loadCards();
  },
);
onMounted(() => {
  stop = startCompanion(
    (account, previous) => {
      if (account) void loadHero();
      if (previous.phase !== state.value.phase) {
        error.value = "";
        void loadCards();
      }
    },
    { rating: false },
  );
  void loadHero();
  poll = setInterval(() => {
    if (state.value.phase === "ChampSelect" && !companion.value.championId)
      void loadCards();
  }, 1500);
});
onUnmounted(() => {
  epoch++;
  cardEpoch++;
  clearInterval(poll);
  stop();
});
</script>

<template>
  <div class="companion-shell info">
    <header class="companion-titlebar">
      <div class="companion-brand">
        <BrandMark :size="16" />英雄推荐<span>PEARLJAM HEX</span>
      </div>
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
    <main v-if="!hero && cardIds.length" class="info-body card-compare">
      <h3>本次英雄卡片 · 海克斯推荐对比</h3>
      <button
        v-for="id in cardIds"
        :key="id"
        class="card-compare-row"
        :aria-label="'查看卡片英雄 ' + (heroes.get(id)?.name || id)"
        @click="view(id)"
      >
        <div class="card-compare-head">
          <ChampionIcon :champion="heroes.get(id)" :size="38" />
          <strong>{{ heroes.get(id)?.name || id }}</strong>
          <span>{{ percent(stats.get(id)?.winRate) }}</span>
        </div>
        <ol v-if="hexSource === 'aramgg' && cardAramgg[id]">
          <li v-for="row in cardAramgg[id]!.augments.slice(0, 3)" :key="row.id">
            <b :class="['tier-badge', 't' + (row.tier ?? 0)]">{{
              row.tier ? "T" + row.tier : "—"
            }}</b
            ><img
              v-if="row.iconUrl"
              :src="row.iconUrl"
              alt=""
              class="mini-icon"
            />{{ row.name }}<small>{{ percent(row.winRate) }}</small>
          </li>
        </ol>
        <ol v-else-if="cardTop(id).length">
          <li v-for="item in cardTop(id)" :key="item.row.augment.id">
            <b :class="['grade', item.grade]">{{ item.grade }}</b
            >{{ item.row.augment.name
            }}<small>{{ percent(item.row.winRate) }}</small>
          </li>
        </ol>
        <p v-else class="compact-empty">正在读取或暂无可定级的强化</p>
      </button>
      <p class="info-note">
        在 Mini 窗点击头像选用；评级为该英雄强化内的相对排名，不是获胜概率。
      </p>
    </main>
    <div v-else-if="!hero" class="companion-empty">
      <Swords :size="26" />
      <strong>等待选择英雄</strong>
      <small>拿到英雄后显示海克斯推荐、出装与符文</small>
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
      <nav class="info-tabs" role="tablist" aria-label="英雄推荐">
        <button
          v-for="item in tabs"
          :key="item.id"
          role="tab"
          :aria-selected="tab === item.id"
          :class="{ active: tab === item.id }"
          @click="tab = item.id"
        >
          {{ item.name }}
        </button>
      </nav>
      <main class="info-body">
        <div v-if="loading" class="companion-empty small">
          <RefreshCw class="spinning" :size="18" /><small
            >正在读取国服统计</small
          >
        </div>
        <template v-else-if="tab === 'augments'">
          <div
            class="info-source-switch"
            role="group"
            aria-label="海克斯数据来源"
          >
            <button
              :class="{ active: hexSource === 'aramgg' }"
              @click="save({ hexSource: 'aramgg' })"
            >
              aramgg
            </button>
            <button
              :class="{ active: hexSource === 'aramhex' }"
              @click="save({ hexSource: 'aramhex' })"
            >
              国服 AramHex
            </button>
          </div>
          <p
            v-if="hexSource === 'aramgg' && aramggError"
            class="info-note warn"
          >
            aramgg 暂不可用：{{ aramggError }} 现显示国服 AramHex。
          </p>
          <template v-if="useAramgg">
            <div
              v-for="row in aramggTop"
              :key="row.id"
              class="compact-augment aramgg-augment"
            >
              <b :class="['tier-badge', 't' + (row.tier ?? 0)]">{{
                row.tier ? "T" + row.tier : "—"
              }}</b
              ><strong
                ><img
                  v-if="row.iconUrl"
                  :src="row.iconUrl"
                  alt=""
                  class="mini-icon"
                /><i v-else :class="['augment-dot', row.rarity]"></i
                >{{ row.name }}</strong
              ><span>{{ percent(row.winRate) }}</span
              ><small>{{
                row.games === null ? "样本不足" : row.games + " 场"
              }}</small>
            </div>
            <p class="info-note">
              顺序与分级：腾讯国服推荐（经 aramgg）；胜率：aramgg
              全球上传样本，满 255 场才显示。
            </p>
          </template>
          <template v-else>
            <div
              v-for="row in topAugments"
              :key="row.augment.id"
              class="compact-augment"
            >
              <b :class="['grade', gradeOf(row)]">{{ gradeOf(row) }}</b
              ><strong
                ><i :class="['augment-dot', row.augment.rarity]"></i
                >{{ row.augment.name }}</strong
              ><span>{{ percent(row.winRate) }}</span
              ><small
                >{{ row.games ?? "—" }} 场{{
                  row.lowSample ? " · 低样本" : ""
                }}</small
              >
            </div>
            <p v-if="!topAugments.length" class="compact-empty">
              当前分组暂无强化统计
            </p>
            <p v-else class="info-note">
              评级为本英雄强化内按平滑胜率的相对排名，低样本不定级；不是获胜概率。
            </p>
          </template>
        </template>
        <template v-else-if="tab === 'build'">
          <section
            v-if="state.mode === 'hex' && useAramgg && aramggBuild"
            class="info-row"
          >
            <h3>
              aramgg 流派 · {{ aramggBuild.tags || "推荐" }}
              <small>极地大乱斗全球统计，仅供参考</small>
            </h3>
            <div v-if="aramggBuild.core[0]" class="info-items">
              <img
                v-for="id in aramggBuild.core[0].ids"
                :key="id"
                :src="catalog.items[id]?.icon"
                :title="catalog.items[id]?.name"
                alt=""
              /><span>{{ percent(aramggBuild.core[0].winRate) }}</span>
            </div>
            <p v-if="aramggBuild.spells[0]" class="compact-label">
              召唤师技能：{{ aramggBuild.spells[0].names.join(" + ") }}
            </p>
            <p v-if="aramggBuild.skills[0]" class="compact-label">
              加点：{{ aramggBuild.skills[0].keys.slice(0, 9).join(" ") }} …
            </p>
          </section>
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
          <section v-if="recommendation?.spells?.length" class="info-row">
            <h3>召唤师技能</h3>
            <p
              v-for="(row, index) in recommendation.spells.slice(0, 2)"
              :key="index"
              class="compact-label"
            >
              {{ row.names.join(" + ") }}
              <span>{{ percent(row.winRate) }}</span>
            </p>
          </section>
        </template>
        <template v-else>
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
      </main>
      <p class="info-source">
        {{
          tab === "augments"
            ? useAramgg
              ? aramgg?.source.name +
                " · " +
                (outdatedNote(aramgg!.source) ||
                  (aramgg?.source.dataVersion ?? ""))
              : ranking?.source.name
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
