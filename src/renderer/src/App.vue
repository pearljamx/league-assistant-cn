<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { CircleAlert, X } from "@lucide/vue";
import { api } from "./api";
import {
  acceptState,
  page,
  refreshCatalog,
  settings,
  state,
  toast,
} from "./store";
import SideNav from "./components/shell/SideNav.vue";
import TitleBar from "./components/shell/TitleBar.vue";
import SettingsModal from "./components/SettingsModal.vue";
import SearchPane from "./components/SearchPane.vue";
import CloseConfirm from "./components/CloseConfirm.vue";
import BrandSplash from "./components/shell/BrandSplash.vue";
import PlayerTabsView from "./views/PlayerTabsView.vue";
import LiveGameView from "./views/LiveGameView.vue";
import ChampionDataView from "./views/ChampionDataView.vue";
import AutomationView from "./views/AutomationView.vue";

const settingsOpen = ref(false),
  searchOpen = ref(false),
  closeOpen = ref(false);
let unsubscribe: (() => void)[] = [];
function shortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchOpen.value = true;
  }
}
onMounted(async () => {
  unsubscribe = [
    api.onState(acceptState),
    api.onSettings((value) => (settings.value = value)),
    api.onCloseRequest(() => (closeOpen.value = true)),
  ];
  window.addEventListener("keydown", shortcut);
  const [currentState, currentSettings] = await Promise.all([
    api.getState(),
    api.getSettings(),
  ]);
  if (currentSettings.ok && currentSettings.data)
    settings.value = currentSettings.data;
  if (currentState.ok && currentState.data) acceptState(currentState.data);
  void refreshCatalog();
});
onUnmounted(() => {
  unsubscribe.forEach((stop) => stop());
  window.removeEventListener("keydown", shortcut);
});
</script>

<template>
  <div class="app-shell">
    <SideNav @settings="settingsOpen = true" />
    <div class="main-workspace">
      <TitleBar @search="searchOpen = true" />
      <div v-if="state.status === 'error'" class="notice warning shell-notice">
        <CircleAlert :size="17" /><span>{{ state.message }}</span>
      </div>
      <main class="page-body">
        <KeepAlive>
          <PlayerTabsView v-if="page === 'history'" />
          <LiveGameView v-else-if="page === 'live'" />
          <ChampionDataView v-else-if="page === 'data'" />
          <AutomationView v-else-if="page === 'automation'" />
        </KeepAlive>
      </main>
    </div>
    <div v-if="toast" class="toast" role="status">
      <CircleAlert :size="16" />{{ toast
      }}<button aria-label="关闭提示" @click="toast = ''">
        <X :size="15" />
      </button>
    </div>
    <SettingsModal v-if="settingsOpen" @close="settingsOpen = false" />
    <SearchPane v-if="searchOpen" @close="searchOpen = false" />
    <CloseConfirm v-if="closeOpen" @close="closeOpen = false" />
    <BrandSplash />
  </div>
</template>
