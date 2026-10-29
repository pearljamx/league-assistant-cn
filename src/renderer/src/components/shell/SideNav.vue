<script setup lang="ts">
import { computed } from "vue";
import {
  AppWindow,
  BarChart3,
  History,
  Radio,
  Settings2,
  Swords,
  Zap,
} from "@lucide/vue";
import { api } from "../../api";
import { notify, page, settings, state, type PageId } from "../../store";

defineEmits<{ settings: [] }>();
const items: { id: PageId; label: string; short: string; icon: unknown }[] = [
  { id: "history", label: "战绩查询", short: "战绩", icon: History },
  { id: "live", label: "实时对局", short: "对局", icon: Radio },
  { id: "data", label: "英雄数据", short: "数据", icon: BarChart3 },
  { id: "automation", label: "自动化", short: "自动化", icon: Zap },
];
const inGame = computed(() =>
  ["ChampSelect", "GameStart", "InProgress", "Reconnect"].includes(
    state.value.phase,
  ),
);
const connection = computed(() =>
  state.value.status === "connected"
    ? "国服客户端已连接"
    : state.value.status === "searching"
      ? "正在查找客户端"
      : "等待客户端连接",
);
async function openCompanions() {
  const result = await api.companionWindow("show");
  if (!result.ok) notify(result.error || "无法打开双弹窗");
}
</script>

<template>
  <aside class="side-nav">
    <div class="side-brand" title="英雄联盟助手">
      <Swords :size="21" :stroke-width="1.6" />
    </div>
    <nav aria-label="主导航">
      <button
        v-for="item in items"
        :key="item.id"
        :class="['nav-item', { active: page === item.id }]"
        :aria-label="item.label"
        :aria-current="page === item.id ? 'page' : undefined"
        :title="item.label"
        @click="page = item.id"
      >
        <component :is="item.icon" :size="20" :stroke-width="1.7" /><span>{{
          item.short
        }}</span>
        <i v-if="item.id === 'live' && inGame" class="nav-dot"></i>
        <i
          v-if="item.id === 'automation' && settings.autoAccept"
          class="nav-dot gold"
        ></i>
      </button>
    </nav>
    <div class="side-bottom">
      <button
        class="side-tool"
        aria-label="打开客户端双弹窗"
        title="打开客户端双弹窗"
        @click="openCompanions"
      >
        <AppWindow :size="18" :stroke-width="1.7" />
      </button>
      <button
        class="side-tool"
        aria-label="设置"
        title="设置"
        @click="$emit('settings')"
      >
        <Settings2 :size="18" :stroke-width="1.7" />
      </button>
      <div
        :class="['side-avatar', state.status]"
        :title="
          connection +
          (state.summoner
            ? ' · ' +
              state.summoner.gameName +
              (state.summoner.tagLine ? '#' + state.summoner.tagLine : '')
            : '')
        "
        role="status"
        :aria-label="connection"
      >
        {{ state.summoner?.gameName.slice(0, 1) || "?" }}
      </div>
    </div>
  </aside>
</template>
