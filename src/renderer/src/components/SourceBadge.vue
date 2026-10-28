<script setup lang="ts">
import type { SourceInfo } from "../../../shared/types";
defineProps<{ source: SourceInfo }>();
const bands: Record<string, string> = {
  all: "全部样本",
  casual: "娱乐组",
  mid: "中分组",
  high: "高分组",
};
const positions: Record<string, string> = {
  ALL: "常见分路样本",
  TOP: "上路",
  JUNGLE: "打野",
  MIDDLE: "中路",
  BOTTOM: "下路",
  SUPPORT: "辅助",
};
</script>
<template>
  <div class="source-note">
    <span class="source-dot"></span>{{ source.name
    }}<span v-if="source.patch">{{ source.patch }}</span
    ><span v-if="source.band">{{ bands[source.band] }}</span
    ><span v-if="source.position">{{ positions[source.position] }}</span
    ><span>{{
      source.date ? "统计于 " + source.date.slice(0, 10) : "统计日期未提供"
    }}</span
    ><span v-if="source.stale" class="warning-text">缓存数据 · 请核对版本</span
    ><span v-if="source.license" class="muted">{{ source.license }}</span>
  </div>
</template>
