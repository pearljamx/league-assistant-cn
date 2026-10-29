<script setup lang="ts">
import { computed } from "vue";
import PlayerTab from "../components/player/PlayerTab.vue";
import { activeTab, playerTabs, state, summonerTarget } from "../store";

// 每个打开的玩家各有一个标签实例，切换时只隐藏不卸载，关闭或换账号时才卸载。
const own = computed(() =>
  state.value.summoner ? summonerTarget(state.value.summoner) : null,
);
</script>

<template>
  <div class="player-tabs-view">
    <PlayerTab
      v-show="activeTab === 'self'"
      :key="'self:' + (own?.puuid ?? 'none') + ':' + state.platform"
      :target="own"
      :own="true"
      :active="activeTab === 'self'"
    />
    <PlayerTab
      v-for="tab in playerTabs"
      v-show="activeTab === tab.puuid"
      :key="tab.puuid"
      :target="tab"
      :own="false"
      :active="activeTab === tab.puuid"
    />
  </div>
</template>
