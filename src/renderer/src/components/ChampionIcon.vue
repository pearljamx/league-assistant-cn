<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Champion } from "../../../shared/types";
const props = defineProps<{ champion?: Champion; size?: number }>();
const failed = ref(false);
watch(
  () => props.champion?.id,
  () => (failed.value = false),
);
const title = computed(() => (props.champion ? props.champion.name : "待选择"));
</script>
<template>
  <span
    class="champion-icon"
    :style="{ width: (size || 44) + 'px', height: (size || 44) + 'px' }"
    :title="title"
    ><img
      v-if="champion && !failed"
      :src="champion.icon"
      alt=""
      loading="lazy"
      @error="failed = true"
    /><span v-else>{{ champion?.name.slice(0, 1) || "?" }}</span></span
  >
</template>
