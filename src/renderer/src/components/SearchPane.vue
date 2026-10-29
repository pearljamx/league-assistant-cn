<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { Clock, History, Search, Trash2, X } from "@lucide/vue";
import { openPlayer, openRiotId, state, summonerTarget } from "../store";

const emit = defineEmits<{ close: [] }>();
// 搜索历史只是本机便捷记录：保存在本窗口存储，可随时清空，读写失败时忽略。
const key = "league-assistant:search-history";
interface Entry {
  riotId: string;
  platform: string | null;
  at: number;
}
const input = ref<HTMLInputElement | null>(null);
const text = ref("");
const busy = ref(false);
const error = ref("");
const entries = ref<Entry[]>([]);
const visible = computed(() =>
  entries.value.filter(
    (entry) => !state.value.platform || entry.platform === state.value.platform,
  ),
);
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    entries.value = Array.isArray(raw)
      ? raw
          .filter(
            (entry) =>
              typeof entry?.riotId === "string" && entry.riotId.includes("#"),
          )
          .slice(0, 20)
      : [];
  } catch {
    entries.value = [];
  }
}
function persist() {
  try {
    localStorage.setItem(key, JSON.stringify(entries.value));
  } catch {
    /* 存储不可用时只保留本次会话 */
  }
}
function remember(riotId: string) {
  entries.value = [
    { riotId, platform: state.value.platform, at: Date.now() },
    ...entries.value.filter(
      (entry) =>
        !(entry.riotId === riotId && entry.platform === state.value.platform),
    ),
  ].slice(0, 20);
  persist();
}
function forget(entry: Entry) {
  entries.value = entries.value.filter((item) => item !== entry);
  persist();
}
function clearAll() {
  entries.value = entries.value.filter(
    (entry) => state.value.platform && entry.platform !== state.value.platform,
  );
  persist();
}
async function submit(value = text.value) {
  const riotId = value.trim();
  if (!riotId) return;
  if (!/^[^#]+#[^#]+$/.test(riotId)) {
    error.value = "请输入完整的 游戏名#标签。";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const player = await openRiotId(riotId);
    remember(player.gameName + (player.tagLine ? "#" + player.tagLine : ""));
    emit("close");
  } catch (reason) {
    error.value = (reason as Error).message;
  } finally {
    busy.value = false;
  }
}
function openOwn() {
  if (!state.value.summoner) return;
  openPlayer(summonerTarget(state.value.summoner));
  emit("close");
}
onMounted(async () => {
  load();
  await nextTick();
  input.value?.focus();
});
</script>

<template>
  <div class="modal-backdrop search-backdrop" @click.self="$emit('close')">
    <section
      class="modal search-pane"
      role="dialog"
      aria-modal="true"
      aria-label="搜索召唤师"
      @keydown.esc="$emit('close')"
    >
      <form class="search-pane-input" @submit.prevent="submit()">
        <Search :size="18" /><input
          ref="input"
          v-model="text"
          aria-label="查询玩家 Riot ID"
          placeholder="游戏名#标签 · 仅查询当前大区公开玩家"
          autocomplete="off"
        /><button type="submit" class="button primary" :disabled="busy">
          {{ busy ? "查询中" : "查询" }}
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="关闭搜索"
          @click="$emit('close')"
        >
          <X :size="18" />
        </button>
      </form>
      <p v-if="error" class="search-error">{{ error }}</p>
      <div class="search-pane-body">
        <button v-if="state.summoner" class="search-entry own" @click="openOwn">
          <History :size="15" /><span
            >我的战绩<small
              >{{ state.summoner.gameName }}#{{ state.summoner.tagLine }}</small
            ></span
          >
        </button>
        <div class="search-history-head">
          <span>最近搜索</span
          ><button v-if="visible.length" class="text-button" @click="clearAll">
            <Trash2 :size="13" />清空
          </button>
        </div>
        <div
          v-for="entry in visible"
          :key="entry.riotId + entry.platform"
          class="search-entry-row"
        >
          <button
            class="search-entry"
            :aria-label="'再次查询 ' + entry.riotId"
            @click="submit(entry.riotId)"
          >
            <Clock :size="14" /><span>{{ entry.riotId }}</span>
          </button>
          <button
            class="icon-button"
            :aria-label="'删除搜索记录 ' + entry.riotId"
            @click="forget(entry)"
          >
            <X :size="14" />
          </button>
        </div>
        <p v-if="!visible.length" class="empty-inline">
          暂无搜索记录。记录只保存在本机。
        </p>
      </div>
    </section>
  </div>
</template>
