<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ArrowUpRight,
  Check,
  Copy,
  Flame,
  Hexagon,
  MessageSquareText,
  Minus,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Square,
  X,
} from "@lucide/vue";
import { api, unwrap } from "../api";
import ChampionIcon from "../components/ChampionIcon.vue";
import BrandMark from "../components/BrandMark.vue";
import BalanceChips from "../components/BalanceChips.vue";
import { balanceTrend } from "../../../shared/aram-balance";
import {
  act,
  balance,
  chipsFor,
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
import type { ChampionChoices, Settings } from "../../../shared/types";

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
const clock2 = (total: number) =>
  `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
const inRoom = computed(() =>
  ["Lobby", "Matchmaking", "ReadyCheck", "ChampSelect"].includes(
    state.value.phase,
  ),
);
/** 排队时间优先用客户端的 timeInQueue，两次刷新之间按收到它的本机时间补齐。 */
const searchAt = ref(Date.now());
watch(
  () => state.value.search?.timeInQueue,
  () => (searchAt.value = Date.now()),
);
const waited = computed(() => {
  const queued = state.value.search?.timeInQueue;
  const base =
    queued != null
      ? queued + Math.max(0, (now.value - searchAt.value) / 1000)
      : (now.value - phaseSince.value) / 1000;
  return clock2(Math.max(0, Math.floor(base)));
});
const estimated = computed(() => {
  const value = state.value.search?.estimated;
  return value ? clock2(value) : null;
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
        detail: state.value.lobby
          ? `${state.value.lobby.members} 人房间 · ${state.value.lobby.leader ? "你是房主" : "等待房主开始"}`
          : "可以开始匹配",
      };
    case "Matchmaking":
      return {
        title: "正在匹配对局",
        detail: estimated.value
          ? `已等待 ${waited.value} · 预计 ${estimated.value}`
          : `已等待 ${waited.value}`,
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
const cards = computed(() => new Set(choices.value.cards ?? []));
const waiting = computed(() => new Set(choices.value.waiting ?? []));
/**
 * 大乱斗：本人卡片在前，其余备选席（含队友留下的）在后，统一按备选席展示。
 * 峡谷：按统计胜率排序后列出前 15 个，可搜索。
 */
const shown = computed(() => {
  if (choices.value.kind !== "pick")
    return [
      ...new Set([
        ...(choices.value.cards ?? []),
        ...choices.value.championIds,
        ...(choices.value.waiting ?? []),
      ]),
    ].filter((id) => id !== state.value.championId);
  const text = search.value.trim().toLowerCase();
  const ids = choices.value.championIds.filter((id) => {
    if (!text) return true;
    const item = heroes.value.get(id);
    return ((item?.name ?? "") + (item?.title ?? "") + (item?.alias ?? ""))
      .toLowerCase()
      .includes(text);
  });
  return [...ids]
    .sort(
      (a, b) =>
        (stats.value.get(b)?.winRate ?? -1) -
        (stats.value.get(a)?.winRate ?? -1),
    )
    .slice(0, 15);
});
const pending = ref<number | null>(null);
const canChoose = (id: number) =>
  state.value.phase === "ChampSelect" &&
  available.value.has(id) &&
  state.value.championId !== id &&
  !choosing.value;
const heading = computed(() =>
  choices.value.kind === "pick" ? "可选英雄" : "备选席",
);
const tip = (id: number) =>
  (heroes.value.get(id)?.name || "") +
  (canChoose(id)
    ? " · 点击换用"
    : waiting.value.has(id)
      ? " · 选人结束后可换"
      : " · 暂不可换") +
  (chipsFor(id).length
    ? "\n大乱斗调整：" + chipsFor(id).map((chip) => chip.text).join("，")
    : "");
const trend = (id: number) => balanceTrend(chipsFor(id));
/** 把队友近期同模式战绩发到选人聊天（只有本队可见）。 */
const statsBusy = ref(false);
async function sendStats() {
  if (statsBusy.value) return;
  statsBusy.value = true;
  error.value = "";
  message.value = "";
  const context = sessionContext();
  try {
    const result = await unwrap(api.teamStats("send"));
    if (context === sessionContext())
      message.value = `已发送 ${result.lines.length} 名队友的近期战绩到选人聊天`;
  } catch (e) {
    if (context === sessionContext()) error.value = (e as Error).message;
  } finally {
    statsBusy.value = false;
  }
}
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
  try {
    await unwrap(api.chooseChampion(id));
    if (context !== sessionContext()) return;
    await view(null);
    await refreshChoices();
  } catch (e) {
    if (context === sessionContext()) error.value = (e as Error).message;
  } finally {
    choosing.value = false;
    pending.value = null;
  }
}
/** 匹配按钮：大厅里开始（仅房主），匹配中取消；其余阶段不可用。 */
const matchBusy = ref(false);
const matchButton = computed(() => {
  const phase = state.value.phase;
  if (!connected.value)
    return { action: null, label: "等待客户端", hint: "" } as const;
  if (phase === "Lobby") {
    const lobby = state.value.lobby;
    return {
      action: lobby && !lobby.canStart ? null : ("start" as const),
      label: "开始匹配",
      hint: lobby?.reason ?? "",
    };
  }
  if (phase === "Matchmaking")
    return {
      action: "cancel" as const,
      label: `取消匹配 · ${waited.value}`,
      hint: state.value.search?.penalty
        ? `排队惩罚剩余 ${clock2(state.value.search.penalty)}`
        : "",
    };
  if (phase === "ReadyCheck")
    return { action: null, label: "对局已找到", hint: "" } as const;
  return { action: null, label: "进入房间后可匹配", hint: "" } as const;
});
const autoMatchIn = computed(() => {
  const at = state.value.autoMatchAt;
  return at && state.value.phase === "Lobby"
    ? Math.max(0, Math.ceil((at - now.value) / 1000))
    : null;
});
async function runMatch(action: "start" | "cancel" | "skip") {
  if (matchBusy.value) return;
  matchBusy.value = true;
  error.value = "";
  try {
    await unwrap(api.matchmaking(action));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    matchBusy.value = false;
  }
}
/** 弹窗内直接调整开关与秒数/人数：先本地更新以便连续点击，再由主进程校验保存。 */
function adjust(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
  void save(patch);
}
const clampStep = (value: number, delta: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value + delta));
const acceptSeconds = computed(() => Math.round(settings.value.acceptDelayMs / 1000));
const matchSeconds = computed(() =>
  Math.round((settings.value.autoMatchDelayMs ?? 3000) / 1000),
);
const minMembers = computed(() => settings.value.autoMatchMinMembers ?? 1);
const stepAccept = (delta: number) =>
  adjust({ acceptDelayMs: clampStep(acceptSeconds.value, delta, 1, 10) * 1000 });
const stepMatch = (delta: number) =>
  adjust({
    autoMatchDelayMs: clampStep(matchSeconds.value, delta, 1, 30) * 1000,
  });
const stepMembers = (delta: number) =>
  adjust({ autoMatchMinMembers: clampStep(minMembers.value, delta, 1, 5) });
/** 狂暴切换只在大乱斗备选席可用；主进程负责循环与停止。 */
const berserkBusy = ref(false);
const canBerserk = computed(
  () => state.value.phase === "ChampSelect" && state.value.mode !== "rift",
);
async function toggleBerserk() {
  if (berserkBusy.value) return;
  berserkBusy.value = true;
  error.value = "";
  try {
    await unwrap(api.setBerserk(!state.value.berserk));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    berserkBusy.value = false;
  }
}
/** 海斗分：Hexdata 不允许脚本查询，只显示用户在官网查到后手动记录的分数。 */
const manual = computed(() => rating.value?.manual ?? null);
const ratingText = computed(() =>
  rating.value?.status === "ready" && rating.value.score !== null
    ? rating.value.score.toLocaleString("zh-CN")
    : manual.value
      ? manual.value.score.toLocaleString("zh-CN")
      : "未记录",
);
const ratingNote = computed(() => {
  const ready = rating.value?.status === "ready" && rating.value.score !== null;
  const position = rating.value?.aramhex;
  if (!ready && manual.value) {
    const date = new Date(manual.value.recordedAt);
    const day = `${date.getMonth() + 1}/${date.getDate()}`;
    return manual.value.source === "official"
      ? `官网查询 ${day}${manual.value.interval ? ` · ±${manual.value.interval}` : ""}`
      : `手动记录 ${day}`;
  }
  if (position?.status === "ready" && position.percentile !== null)
    return `AramHex 区内前 ${(position.percentile * 100).toFixed(1)}%`;
  return ready ? "Hexdata" : "Hexdata 官网查询";
});
const editing = ref(false);
const draft = ref("");
function startEdit() {
  draft.value = manual.value ? String(manual.value.score) : "";
  editing.value = true;
}
async function saveScore(clear = false) {
  const text = draft.value.trim();
  const score = clear || !text ? null : Number(text);
  if (score !== null && (!Number.isInteger(score) || score < 0 || score > 10000)) {
    error.value = "请输入 0–10000 的整数海斗分";
    return;
  }
  const context = sessionContext();
  try {
    const saved = await unwrap(api.saveHexdataScore(score));
    if (context === sessionContext() && rating.value)
      rating.value = { ...rating.value, manual: saved };
    editing.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
watch(
  () => `${state.value.mode}:${settings.value.band}:${settings.value.tier}`,
  () => void loadOverview(),
);
onMounted(() => {
  stop = startCompanion(
    (_account, previous) => {
      if (_account) editing.value = false;
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
        <BrandMark :size="16" />PEARLJAM HEX<span>Mini</span>
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
            <small>{{ state.queueName || modeName }} · 英雄选择</small>
            <strong>{{ current?.name || "尚未选择英雄" }}</strong>
            <span
              >统计胜率
              {{ percent(stats.get(state.championId || 0)?.winRate) }}</span
            >
            <BalanceChips
              :chips="chipsFor(state.championId)"
              :source="balance?.source"
            />
          </div>
        </div>
        <div class="mini-choices-head">
          <span>{{ heading }}</span>
          <button
            class="stats-button"
            :disabled="statsBusy"
            title="把队友近期同模式战绩发到选人聊天（只有本队可见）"
            @click="sendStats"
          >
            <MessageSquareText :size="13" />{{
              statsBusy ? "汇总中" : "发战绩"
            }}
          </button>
          <button
            v-if="canBerserk"
            :class="['berserk-button', { on: state.berserk }]"
            :disabled="berserkBusy"
            :aria-pressed="!!state.berserk"
            title="开启后约每 0.1 秒按顺序换一次备选席英雄，再点一次停止"
            @click="toggleBerserk"
          >
            <Flame :size="13" />{{ state.berserk ? "狂暴中" : "狂暴" }}
          </button>
        </div>
        <div v-if="choices.kind === 'pick'" class="mini-search">
          <Search :size="13" /><input
            v-model="search"
            aria-label="搜索可选英雄"
            placeholder="搜索英雄"
          />
        </div>
        <div v-if="shown.length" class="mini-choice-grid">
          <button
            v-for="id in shown"
            :key="id"
            :class="[
              'quick-hero',
              {
                active:
                  companion.championId === id && !companion.followingClient,
                busy: pending === id,
                card: cards.has(id),
                waiting: !canChoose(id) && waiting.has(id),
              },
            ]"
            :disabled="choosing || !!state.berserk"
            :aria-disabled="!canChoose(id)"
            :aria-label="'换用' + (heroes.get(id)?.name || id)"
            :title="tip(id)"
            @click="choose(id)"
            @contextmenu.prevent="view(id)"
          >
            <ChampionIcon :champion="heroes.get(id)" :size="42" /><i
              v-if="cards.has(id)"
              class="card-badge"
              >卡片</i
            ><i
              v-if="trend(id)"
              :class="['trend-badge', trend(id) > 0 ? 'buff' : 'nerf']"
              >{{ trend(id) > 0 ? "▲" : "▼" }}</i
            ><small>{{
              !canChoose(id) && waiting.has(id)
                ? "稍后可换"
                : percent(stats.get(id)?.winRate)
            }}</small>
            <RefreshCw v-if="pending === id" :size="14" class="spinning" />
          </button>
        </div>
        <p v-else class="mini-reason">{{ choices.reason }}</p>
      </section>
      <template v-else>
        <section class="mini-status">
          <div :class="['mini-emblem', state.phase, { live: inRoom }]">
            <Hexagon v-if="state.mode === 'hex' && inRoom" :size="24" /><Radio
              v-else
              :size="22"
            />
          </div>
          <div class="mini-status-text">
            <strong class="mini-mode">{{
              inRoom
                ? state.queueName || modeName
                : state.summoner
                  ? state.summoner.gameName
                  : "PEARLJAM HEX"
            }}</strong>
            <span :class="['mini-phase', state.phase]">{{ status.title }}</span>
            <small>{{ status.detail }}</small>
          </div>
        </section>
        <section class="mini-match">
          <button
            :class="[
              'match-button',
              { cancel: matchButton.action === 'cancel' },
            ]"
            :disabled="!matchButton.action || matchBusy"
            @click="matchButton.action && runMatch(matchButton.action)"
          >
            <Square v-if="matchButton.action === 'cancel'" :size="14" /><Play
              v-else
              :size="14"
            />{{ matchButton.label }}
          </button>
          <p v-if="autoMatchIn !== null" class="match-hint auto">
            {{ autoMatchIn }} 秒后自动开始匹配
            <button @click="runMatch('skip')">本次跳过</button>
          </p>
          <p
            v-else-if="state.autoMatchWait && state.phase === 'Lobby'"
            class="match-hint wait"
          >
            自动匹配等待：{{ state.autoMatchWait }}
            <button @click="runMatch('skip')">本次跳过</button>
          </p>
          <p v-else-if="matchButton.hint" class="match-hint">
            {{ matchButton.hint }}
          </p>
        </section>
      </template>
      <p v-if="error" class="companion-notice" role="alert">{{ error }}</p>
      <p v-else-if="message" class="companion-success" role="status">
        {{ message }}
      </p>
    </main>

    <section class="mini-ops" aria-label="自动操作">
      <div :class="['op-row', { on: settings.autoAccept }]">
        <button
          class="op-name"
          role="switch"
          :aria-checked="settings.autoAccept"
          aria-label="自动接受对局"
          @click="adjust({ autoAccept: !settings.autoAccept })"
        >
          <i class="switch" :class="{ on: settings.autoAccept }"><span></span></i
          >自动接受
        </button>
        <span class="op-note">找到对局后</span>
        <div class="stepper" aria-label="接受延迟">
          <button
            aria-label="接受延迟减少 1 秒"
            :disabled="acceptSeconds <= 1"
            @click="stepAccept(-1)"
          >
            <Minus :size="11" />
          </button>
          <b>{{ acceptSeconds }}<small>秒</small></b>
          <button
            aria-label="接受延迟增加 1 秒"
            :disabled="acceptSeconds >= 10"
            @click="stepAccept(1)"
          >
            <Plus :size="11" />
          </button>
        </div>
      </div>
      <div :class="['op-row', { on: settings.autoMatch }]">
        <button
          class="op-name"
          role="switch"
          :aria-checked="!!settings.autoMatch"
          aria-label="自动匹配"
          title="本人为房主、满足下方条件后倒计时开始匹配；手动取消后本轮不再自动排队"
          @click="adjust({ autoMatch: !settings.autoMatch })"
        >
          <i class="switch" :class="{ on: settings.autoMatch }"><span></span></i
          >自动匹配
        </button>
        <span class="op-note">条件满足后</span>
        <div class="stepper" aria-label="匹配延迟">
          <button
            aria-label="匹配延迟减少 1 秒"
            :disabled="matchSeconds <= 1"
            @click="stepMatch(-1)"
          >
            <Minus :size="11" />
          </button>
          <b>{{ matchSeconds }}<small>秒</small></b>
          <button
            aria-label="匹配延迟增加 1 秒"
            :disabled="matchSeconds >= 30"
            @click="stepMatch(1)"
          >
            <Plus :size="11" />
          </button>
        </div>
      </div>
      <div v-if="settings.autoMatch" class="op-sub">
        <span>房间至少</span>
        <div class="stepper" aria-label="自动匹配最少人数">
          <button
            aria-label="最少人数减 1"
            :disabled="minMembers <= 1"
            @click="stepMembers(-1)"
          >
            <Minus :size="11" />
          </button>
          <b>{{ minMembers }}<small>人</small></b>
          <button
            aria-label="最少人数加 1"
            :disabled="minMembers >= 5"
            @click="stepMembers(1)"
          >
            <Plus :size="11" />
          </button>
        </div>
        <label class="op-check">
          <input
            type="checkbox"
            :checked="settings.autoMatchWaitInvites !== false"
            @change="
              adjust({
                autoMatchWaitInvites: ($event.target as HTMLInputElement)
                  .checked,
              })
            "
          />等待被邀请者回应
        </label>
      </div>
      <div :class="['op-row', { on: settings.autoPlayAgain }]">
        <button
          class="op-name"
          role="switch"
          :aria-checked="!!settings.autoPlayAgain"
          aria-label="结算后自动回到房间"
          @click="adjust({ autoPlayAgain: !settings.autoPlayAgain })"
        >
          <i class="switch" :class="{ on: settings.autoPlayAgain }"
            ><span></span></i
          >自动回房
        </button>
        <span class="op-note">{{
          settings.autoPlayAgain && settings.autoMatch
            ? "结算后回房并继续自动匹配"
            : "结算后约 2 秒"
        }}</span>
      </div>
    </section>
    <footer class="rating-line" aria-label="海斗分">
      <template v-if="editing">
        <span>海斗分</span>
        <input
          v-model="draft"
          class="rating-input"
          inputmode="numeric"
          maxlength="5"
          aria-label="官网查到的海斗分"
          placeholder="官网查到的分数"
          @keydown.enter="saveScore()"
          @keydown.esc="editing = false"
        />
        <button aria-label="保存海斗分" @click="saveScore()">
          <Check :size="12" />保存
        </button>
        <button v-if="manual" @click="saveScore(true)">清除</button>
        <button aria-label="取消记录" @click="editing = false">
          <X :size="12" />
        </button>
      </template>
      <template v-else>
        <span>海斗分</span><strong>{{ ratingText }}</strong
        ><small :title="rating?.message">{{ ratingNote }}</small>
        <button
          v-if="state.summoner"
          title="记录在官网查到的分数（只存本机）"
          @click="startEdit"
        >
          <Pencil :size="11" />记录
        </button>
        <button
          title="复制本人 Riot ID 并打开 Hexdata 官方查分页；在该窗口查询后自动记录结果"
          @click="api.openExternal(state.summoner ? 'hexdata-copy' : 'hexdata')"
        >
          <Copy v-if="state.summoner" :size="11" />查分<ArrowUpRight
            :size="12"
          />
        </button>
      </template>
    </footer>
  </div>
</template>
