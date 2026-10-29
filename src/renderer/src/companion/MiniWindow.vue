<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ArrowUpRight,
  Hexagon,
  Radio,
  RefreshCw,
  Search,
  Swords,
  X,
} from "@lucide/vue";
import { api, unwrap } from "../api";
import ChampionIcon from "../components/ChampionIcon.vue";
import {
  act,
  companion,
  error,
  heroes,
  loadOverview,
  message,
  modeName,
  percent,
  rating,
  save,
  sessionContext,
  settings,
  startCompanion,
  state,
  stats,
  view,
} from "./useCompanion";
import type { ChampionChoices } from "../../../shared/types";

const choices = ref<ChampionChoices>({
  championIds: [],
  kind: "none",
  reason: "等待进入英雄选择",
});
const search = ref("");
const choosing = ref(false);
const now = ref(Date.now());
const phaseSince = ref(Date.now());
let selectionEpoch = 0;
let poll: ReturnType<typeof setInterval> | undefined,
  clock: ReturnType<typeof setInterval> | undefined;
let stop = () => {};

const connected = computed(() => state.value.status === "connected");
const inRoom = computed(() =>
  ["Lobby", "Matchmaking", "ReadyCheck", "ChampSelect"].includes(
    state.value.phase,
  ),
);
const waited = computed(() => {
  const seconds = Math.max(
    0,
    Math.floor((now.value - phaseSince.value) / 1000),
  );
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
});
const status = computed(() => {
  if (!connected.value)
    return { title: "等待客户端", detail: "启动并登录国服客户端后自动同步" };
  switch (state.value.phase) {
    case "None":
      return { title: "客户端已连接", detail: "进入房间后显示模式与匹配状态" };
    case "Lobby":
      return {
        title: "组队大厅 · 等待匹配",
        detail: "进入队列后自动同步匹配与选人状态",
      };
    case "Matchmaking":
      return {
        title: "正在匹配对局",
        detail: `已等待 ${waited.value}（本机计时）`,
      };
    case "ReadyCheck":
      return {
        title: "对局已找到",
        detail: settings.value.autoAccept
          ? `自动接受已开启 · 约 ${settings.value.acceptDelayMs / 1000} 秒后接受`
          : "请在客户端接受对局",
      };
    case "EndOfGame":
    case "PreEndOfGame":
      return { title: "对局结束", detail: "返回大厅后继续同步" };
    default:
      return { title: "客户端已连接", detail: state.value.phase };
  }
});
const current = computed(() => heroes.value.get(state.value.championId || 0));
const available = computed(() => new Set(choices.value.championIds));
/** 备选席全部显示；普通选人按统计胜率排序后只列出前 15 个，可搜索。 */
const shown = computed(() => {
  const text = search.value.trim().toLowerCase();
  const ids = choices.value.championIds.filter((id) => {
    if (!text) return true;
    const item = heroes.value.get(id);
    return ((item?.name ?? "") + (item?.title ?? "") + (item?.alias ?? ""))
      .toLowerCase()
      .includes(text);
  });
  const sorted = [...ids].sort(
    (a, b) =>
      (stats.value.get(b)?.winRate ?? -1) - (stats.value.get(a)?.winRate ?? -1),
  );
  return choices.value.kind === "pick" ? sorted.slice(0, 15) : sorted;
});
const pending = ref<number | null>(null);
const canChoose = (id: number) =>
  state.value.phase === "ChampSelect" &&
  available.value.has(id) &&
  state.value.championId !== id &&
  !choosing.value;
const heading = computed(
  () =>
    ({
      subset: "选择英雄卡片",
      bench: "备选席",
      pick: "可选英雄",
      none: "换用英雄",
    })[choices.value.kind],
);
async function refreshChoices() {
  const version = ++selectionEpoch;
  if (state.value.phase !== "ChampSelect") {
    choices.value = {
      championIds: [],
      kind: "none",
      reason: "进入英雄选择后显示可换用英雄",
    };
    return;
  }
  try {
    const value = await unwrap(api.getChampionChoices());
    if (version === selectionEpoch) choices.value = value;
  } catch (e) {
    if (version === selectionEpoch)
      choices.value = {
        championIds: [],
        kind: "none",
        reason: (e as Error).message || "暂时无法读取可选英雄",
      };
  }
}
/**
 * 用户点击头像即写入客户端：卡片阶段选用该卡片（与客户端点卡一致），
 * 备选席直接交换，峡谷本人回合只预选不锁定。右键只在英雄信息窗查看。
 */
async function choose(id: number) {
  if (!canChoose(id)) return;
  choosing.value = true;
  pending.value = id;
  error.value = "";
  message.value = "";
  const context = sessionContext();
  const kind = choices.value.kind;
  try {
    await unwrap(api.chooseChampion(id));
    if (context !== sessionContext()) return;
    message.value =
      kind === "subset"
        ? `已选用 ${heroes.value.get(id)?.name || id} · 以客户端结果为准`
        : `已换用 ${heroes.value.get(id)?.name || id} · 以客户端结果为准`;
    await view(null);
    await refreshChoices();
  } catch (e) {
    if (context === sessionContext()) error.value = (e as Error).message;
  } finally {
    choosing.value = false;
    pending.value = null;
  }
}
const ratingText = computed(() =>
  rating.value?.status === "ready" && rating.value.score !== null
    ? rating.value.score.toLocaleString("zh-CN")
    : "待接入",
);
watch(
  () => `${state.value.mode}:${settings.value.band}:${settings.value.tier}`,
  () => void loadOverview(),
);
onMounted(() => {
  stop = startCompanion(
    (_account, previous) => {
      if (previous.phase !== state.value.phase) {
        phaseSince.value = Date.now();
        search.value = "";
        message.value = "";
        error.value = "";
      }
      void refreshChoices();
    },
    { rating: true },
  );
  // 卡片阶段只有十几秒：选人时每秒刷新，其他阶段不请求。
  poll = setInterval(() => {
    if (state.value.phase === "ChampSelect") void refreshChoices();
  }, 1000);
  clock = setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => {
  selectionEpoch++;
  clearInterval(poll);
  clearInterval(clock);
  stop();
});
</script>

<template>
  <div class="companion-shell mini">
    <header class="companion-titlebar">
      <div class="companion-brand">
        <Swords :size="15" />英雄联盟助手<span>Mini</span>
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

    <main class="mini-body">
      <section
        v-if="state.phase === 'ChampSelect' && connected"
        class="mini-select"
      >
        <div class="mini-current">
          <ChampionIcon :champion="current" :size="52" />
          <div>
            <small>{{ modeName }} · 英雄选择</small>
            <strong>{{ current?.name || "尚未选择英雄" }}</strong>
            <span
              >统计胜率
              {{ percent(stats.get(state.championId || 0)?.winRate) }}</span
            >
          </div>
        </div>
        <div class="mini-choices-head">
          <span>{{ heading }}</span>
          <small v-if="choices.kind !== 'none'">{{
            choices.kind === "subset"
              ? "点击头像直接选用 · 右键只查看"
              : choices.kind === "pick"
                ? "点击头像直接预选 · 不锁定"
                : "点击头像直接换用 · 右键只查看"
          }}</small>
        </div>
        <div v-if="choices.kind === 'pick'" class="mini-search">
          <Search :size="13" /><input
            v-model="search"
            aria-label="搜索可选英雄"
            placeholder="搜索英雄"
          />
        </div>
        <div
          v-if="shown.length"
          :class="['mini-choice-grid', { cards: choices.kind === 'subset' }]"
        >
          <button
            v-for="id in shown"
            :key="id"
            :class="[
              'quick-hero',
              {
                active:
                  companion.championId === id && !companion.followingClient,
                busy: pending === id,
              },
            ]"
            :disabled="choosing"
            :aria-disabled="!canChoose(id)"
            :aria-label="
              (choices.kind === 'subset' ? '选用' : '换用') +
              (heroes.get(id)?.name || id)
            "
            :title="
              (heroes.get(id)?.name || '') +
              (choices.kind === 'subset' ? ' · 点击选用' : ' · 点击换用')
            "
            @click="choose(id)"
            @contextmenu.prevent="view(id)"
          >
            <ChampionIcon
              :champion="heroes.get(id)"
              :size="choices.kind === 'subset' ? 58 : 40"
            /><b v-if="choices.kind === 'subset'">{{
              heroes.get(id)?.name || id
            }}</b
            ><small>{{ percent(stats.get(id)?.winRate) }}</small>
            <RefreshCw v-if="pending === id" :size="14" class="spinning" />
          </button>
        </div>
        <p v-else class="mini-reason">{{ choices.reason }}</p>
      </section>
      <section v-else class="mini-status">
        <div :class="['mini-emblem', { live: inRoom }]">
          <Hexagon v-if="state.mode === 'hex' && inRoom" :size="30" /><Radio
            v-else
            :size="28"
          />
        </div>
        <strong class="mini-mode">{{
          inRoom
            ? modeName
            : state.summoner
              ? state.summoner.gameName
              : "英雄联盟助手"
        }}</strong>
        <span :class="['mini-phase', state.phase]">{{ status.title }}</span>
        <small>{{ status.detail }}</small>
      </section>
      <p v-if="error" class="companion-notice" role="alert">{{ error }}</p>
      <p v-else-if="message" class="companion-success" role="status">
        {{ message }}
      </p>
    </main>

    <section class="mini-ops">
      <span
        >自动接受<small>（{{ settings.acceptDelayMs / 1000 }} 秒）</small></span
      >
      <button
        :class="['switch', { on: settings.autoAccept }]"
        role="switch"
        :aria-checked="settings.autoAccept"
        aria-label="自动接受对局"
        @click="save({ autoAccept: !settings.autoAccept })"
      >
        <span></span>
      </button>
    </section>
    <footer class="rating-line" aria-label="海斗分">
      <span>海斗分</span><strong>{{ ratingText }}</strong
      ><small
        v-if="
          rating?.aramhex?.status === 'ready' &&
          rating.aramhex.percentile !== null
        "
        >AramHex 区内前
        {{ (rating.aramhex.percentile * 100).toFixed(1) }}%</small
      ><small v-else>Hexdata</small>
      <button @click="api.openExternal('hexdata')">
        官方查分<ArrowUpRight :size="12" />
      </button>
    </footer>
  </div>
</template>
