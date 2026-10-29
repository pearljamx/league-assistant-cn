<script setup lang="ts">
import { ref } from "vue";
import { LogOut, Minimize2 } from "@lucide/vue";
import { api } from "../api";
import { notify, save } from "../store";

const emit = defineEmits<{ close: [] }>();
const remember = ref(false);
async function choose(action: "tray" | "quit") {
  if (remember.value) await save({ closeAction: action });
  const result = await api.mainWindow(action);
  if (!result.ok) notify(result.error || "操作未完成");
  emit("close");
}
</script>

<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <section
      class="modal close-modal"
      role="dialog"
      aria-modal="true"
      aria-label="关闭主窗口"
    >
      <h2>关闭主窗口</h2>
      <p>最小化到托盘后，客户端小窗和已开启的自动接受仍会工作。</p>
      <label class="close-remember"
        ><input
          v-model="remember"
          type="checkbox"
        />记住选择（可在设置中修改）</label
      >
      <div class="modal-actions">
        <button class="button secondary" @click="$emit('close')">取消</button>
        <button class="button secondary" @click="choose('quit')">
          <LogOut :size="15" />退出助手
        </button>
        <button class="button primary" @click="choose('tray')">
          <Minimize2 :size="15" />最小化到托盘
        </button>
      </div>
    </section>
  </div>
</template>
