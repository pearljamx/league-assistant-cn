<script setup lang="ts">
import { computed } from "vue";
import { History, Search, X, Zap } from "@lucide/vue";
import {
  activeTab,
  closePlayerTab,
  page,
  playerTabs,
  save,
  settings,
  state,
} from "../../store";
import { modeName, phaseNames } from "../../format";
import { version as appVersion } from "../../../../../package.json";

defineEmits<{ search: [] }>();
const titles: Record<string, string> = {
  history: "战绩查询",
  live: "实时对局",
  data: "英雄数据",
  automation: "自动化",
  toolkit: "工具集",
};
const selectTab = (id: string) => (activeTab.value = id);
const live = computed(() =>
  ["ChampSelect", "GameStart", "InProgress", "Reconnect"].includes(
    state.value.phase,
  ),
);
</script>

<template>
  <header class="title-bar">
    <div
      v-if="page === 'history'"
      class="title-tabs"
      role="tablist"
      aria-label="玩家标签"
    >
      <button
        role="tab"
        :aria-selected="activeTab === 'self'"
        :class="['title-tab', { active: activeTab === 'self' }]"
        @click="selectTab('self')"
      >
        <History :size="13" />我的战绩
      </button>
      <div
        v-for="tab in playerTabs"
        :key="tab.puuid"
        :class="['title-tab', { active: activeTab === tab.puuid }]"
      >
        <button
          role="tab"
          class="title-tab-label"
          :aria-selected="activeTab === tab.puuid"
          :title="tab.name + '（中键关闭）'"
          @click="selectTab(tab.puuid)"
          @mousedown.middle.prevent="closePlayerTab(tab.puuid)"
        >
          {{ tab.name.split("#")[0] || "公开玩家" }}
        </button>
        <button
          class="title-tab-close"
          :aria-label="'关闭标签 ' + tab.name"
          @click.stop="closePlayerTab(tab.puuid)"
        >
          <X :size="12" />
        </button>
      </div>
    </div>
    <div v-else class="title-left">
      <strong>{{ titles[page] }}</strong>
      <span v-if="state.summoner" class="title-account"
        >{{ state.summoner.gameName
        }}<small v-if="state.summoner.tagLine"
          >#{{ state.summoner.tagLine }}</small
        ><i>·</i>{{ state.platform || "国服" }}</span
      >
    </div>
    <button
      class="title-search"
      aria-label="搜索召唤师"
      title="搜索召唤师（Ctrl+K）"
      @click="$emit('search')"
    >
      <Search :size="14" /><span>搜索召唤师 · 游戏名#标签</span
      ><kbd>Ctrl K</kbd>
    </button>
    <div class="title-right">
      <button
        :class="['title-chip', { on: settings.autoAccept }]"
        role="switch"
        :aria-checked="settings.autoAccept"
        aria-label="标题栏自动接受开关"
        :title="settings.autoAccept ? '自动接受已开启' : '自动接受已关闭'"
        @click="save({ autoAccept: !settings.autoAccept })"
      >
        <Zap :size="13" />自动接受{{ settings.autoAccept ? "开" : "关" }}
      </button>
      <span :class="['phase-badge', { live }]"
        ><span class="status-dot"></span
        >{{ phaseNames[state.phase] || state.phase
        }}<template v-if="live"> · {{ modeName(state.mode) }}</template></span
      >
      <span class="version">v{{ appVersion }}</span>
    </div>
  </header>
</template>
