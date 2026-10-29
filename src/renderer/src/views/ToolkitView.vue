<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from "vue";
import {
  Eye,
  MessageCircle,
  MonitorCog,
  RefreshCw,
  Shuffle,
  Users,
} from "@lucide/vue";
import { api, unwrap } from "../api";
import { champions, notify, state } from "../store";
import ChampionIcon from "../components/ChampionIcon.vue";
import type {
  ChatAvailability,
  ChatStatus,
  FriendEntry,
  RerollState,
} from "../../../shared/types";

// 工具集：每个按钮只在用户点击时调用一次客户端接口，失败时显示原因，不自动重试。
const busy = ref<Record<string, boolean>>({});
async function run<T>(key: string, task: () => Promise<T>, done?: string) {
  if (busy.value[key]) return;
  busy.value[key] = true;
  try {
    const value = await task();
    if (done) notify(done);
    return value;
  } catch (reason) {
    notify((reason as Error).message);
  } finally {
    busy.value[key] = false;
  }
}
const connected = computed(() => state.value.status === "connected");

// —— 选人台 ——
const reroll = ref<RerollState | null>(null);
const previous = ref<number | null>(null);
async function loadReroll() {
  if (!connected.value) return (reroll.value = null);
  const result = await api.getRerollState();
  reroll.value = result.ok ? (result.data ?? null) : null;
}
async function doReroll() {
  const result = await run("reroll", () => unwrap(api.reroll()), "已重随英雄");
  if (result) previous.value = result.previous;
  void loadReroll();
}
async function takeBack() {
  const id = previous.value;
  if (!id) return;
  const ok = await run(
    "takeback",
    () => unwrap(api.chooseChampion(id)),
    "已从备选席拿回 " + (champions.value.get(id)?.name ?? "英雄"),
  );
  if (ok !== undefined) previous.value = null;
}

// —— 好友与观战 ——
const friends = ref<FriendEntry[]>([]);
const friendError = ref("");
async function loadFriends() {
  friendError.value = "";
  if (!connected.value) return (friends.value = []);
  const result = await api.getFriends();
  if (result.ok) friends.value = result.data ?? [];
  else friendError.value = result.error || "好友列表暂不可用";
}
const statusName = (friend: FriendEntry) =>
  friend.inGame
    ? "游戏中"
    : (
        {
          chat: "在线",
          away: "离开",
          dnd: "忙碌",
          mobile: "手机在线",
          offline: "离线",
        } as Record<string, string>
      )[friend.availability] || friend.availability;

// —— 聊天状态与签名 ——
const chat = ref<ChatStatus | null>(null);
const signature = ref("");
const availabilities: { id: ChatAvailability; name: string }[] = [
  { id: "chat", name: "在线" },
  { id: "away", name: "离开" },
  { id: "mobile", name: "手机在线" },
  { id: "offline", name: "隐身（显示离线）" },
];
async function loadChat() {
  if (!connected.value) return (chat.value = null);
  const result = await api.getChatStatus();
  chat.value = result.ok ? (result.data ?? null) : null;
  signature.value = chat.value?.statusMessage ?? "";
}
async function saveChat(patch: Partial<ChatStatus>) {
  const result = await run(
    "chat",
    () => unwrap(api.setChatStatus({ ...patch })),
    "已更新聊天状态",
  );
  if (result) {
    chat.value = result;
    signature.value = result.statusMessage;
  }
}

const fixWindow = () =>
  run(
    "fix",
    () => unwrap(api.fixClientWindow()),
    "已按客户端缩放比例修复窗口尺寸",
  );
const restartUx = () =>
  run("ux", () => unwrap(api.restartClientUx()), "已请求重启客户端界面");
const spectate = (friend: FriendEntry) =>
  run(
    "spectate:" + friend.puuid,
    () => unwrap(api.spectateFriend(friend.puuid)),
    "正在启动观战",
  );
function refresh() {
  void loadReroll();
  void loadFriends();
  void loadChat();
}
onMounted(refresh);
onActivated(refresh);
watch(
  () =>
    `${state.value.status}:${state.value.summoner?.puuid}:${state.value.phase}`,
  refresh,
);
</script>

<template>
  <section class="toolkit-view">
    <div v-if="!connected" class="notice">
      <MonitorCog :size="17" /><span
        >工具集需要已登录的国服客户端。所有操作都只在你点击时执行。</span
      >
    </div>
    <div class="toolkit-grid">
      <section class="panel toolkit-panel">
        <div class="panel-heading">
          <div>
            <h2>选人台</h2>
            <p>大乱斗重随，以及重随后从备选席拿回原英雄</p>
          </div>
          <Shuffle :size="20" class="gold-icon" />
        </div>
        <p class="toolkit-state">
          {{
            state.phase !== "ChampSelect"
              ? "进入选人后可用"
              : reroll?.reason || "正在读取"
          }}<span
            v-if="reroll?.remaining !== null && reroll?.remaining !== undefined"
          >
            · 剩余 {{ reroll.remaining }} 次</span
          >
        </p>
        <div class="toolkit-actions">
          <button
            class="button primary"
            :disabled="
              state.phase !== 'ChampSelect' || !reroll?.available || busy.reroll
            "
            @click="doReroll"
          >
            <Shuffle :size="15" />重随英雄
          </button>
          <button
            class="button secondary"
            :disabled="
              !previous || busy.takeback || state.phase !== 'ChampSelect'
            "
            @click="takeBack"
          >
            <ChampionIcon
              v-if="previous"
              :champion="champions.get(previous)"
              :size="18"
            />拿回{{
              previous
                ? " " + (champions.get(previous)?.name ?? "")
                : "上一个英雄"
            }}
          </button>
        </div>
      </section>

      <section class="panel toolkit-panel">
        <div class="panel-heading">
          <div>
            <h2>客户端修复</h2>
            <p>客户端界面卡住、黑屏或窗口尺寸异常时使用</p>
          </div>
          <MonitorCog :size="20" class="gold-icon" />
        </div>
        <div class="toolkit-actions">
          <button
            class="button secondary"
            :disabled="!connected || busy.fix"
            @click="fixWindow"
          >
            修复窗口尺寸
          </button>
          <button
            class="button secondary"
            :disabled="!connected || busy.ux"
            @click="restartUx"
          >
            <RefreshCw :size="15" />重启客户端界面
          </button>
        </div>
        <p class="automation-note">
          重启界面只重新加载客户端外壳，不会退出对局、不会影响排队；对局中请勿使用。
        </p>
      </section>

      <section class="panel toolkit-panel">
        <div class="panel-heading">
          <div>
            <h2>好友与观战</h2>
            <p>游戏中的好友排在最前，可直接观战</p>
          </div>
          <button
            class="icon-button"
            aria-label="刷新好友列表"
            @click="loadFriends"
          >
            <RefreshCw :size="15" />
          </button>
        </div>
        <p v-if="friendError" class="warning-text small">{{ friendError }}</p>
        <div v-else-if="!friends.length" class="empty-inline">
          <Users :size="15" />{{
            connected ? "没有好友或列表为空" : "未连接客户端"
          }}
        </div>
        <ul class="friend-list">
          <li v-for="friend in friends" :key="friend.puuid">
            <ChampionIcon
              v-if="friend.championId"
              :champion="champions.get(friend.championId)"
              :size="26"
            /><span v-else :class="['friend-dot', friend.availability]"></span>
            <div>
              <strong>{{ friend.name }}</strong>
              <small
                >{{ statusName(friend)
                }}<template v-if="friend.statusMessage">
                  · {{ friend.statusMessage }}</template
                ></small
              >
            </div>
            <button
              v-if="friend.spectatable"
              class="text-button"
              :aria-label="'观战 ' + friend.name"
              :disabled="busy['spectate:' + friend.puuid]"
              @click="spectate(friend)"
            >
              <Eye :size="14" />观战
            </button>
          </li>
        </ul>
      </section>

      <section class="panel toolkit-panel">
        <div class="panel-heading">
          <div>
            <h2>聊天状态与签名</h2>
            <p>修改好友列表里显示的在线状态和个性签名</p>
          </div>
          <MessageCircle :size="20" class="gold-icon" />
        </div>
        <div class="setting-row">
          <div><strong>在线状态</strong></div>
          <select
            aria-label="在线状态"
            :disabled="!chat || busy.chat"
            :value="chat?.availability"
            @change="
              saveChat({
                availability: ($event.target as HTMLSelectElement)
                  .value as ChatAvailability,
              })
            "
          >
            <option
              v-for="item in availabilities"
              :key="item.id"
              :value="item.id"
            >
              {{ item.name }}
            </option>
          </select>
        </div>
        <form
          class="toolkit-signature"
          @submit.prevent="saveChat({ statusMessage: signature })"
        >
          <input
            v-model="signature"
            maxlength="200"
            aria-label="个性签名"
            placeholder="个性签名（最多 200 字）"
            :disabled="!chat"
          />
          <button
            class="button primary"
            type="submit"
            :disabled="!chat || busy.chat || signature === chat?.statusMessage"
          >
            保存签名
          </button>
        </form>
      </section>
    </div>
  </section>
</template>
