<script setup lang="ts">
// PEARLJAM HEX 标志：取自用户原画（resources/brand/pearljam-art.jpg）的猫脸六边形徽章，由 scripts/build-brand.mjs 生成。
import mark from "../assets/brand-mark.png";
import markSmall from "../assets/brand-mark-small.png";

withDefaults(defineProps<{ size?: number; shimmer?: boolean }>(), {
  size: 24,
  shimmer: false,
});
</script>

<template>
  <img
    :class="['brand-mark', { shimmer }]"
    :src="size <= 32 ? markSmall : mark"
    :width="size"
    :height="size"
    alt="PEARLJAM HEX"
    draggable="false"
  />
</template>

<style scoped>
.brand-mark {
  display: block;
  flex-shrink: 0;
  user-select: none;
}
.shimmer {
  animation: jam-glow 2.6s ease-in-out infinite;
}
@keyframes jam-glow {
  50% {
    filter: drop-shadow(0 0 10px #f07ab866) drop-shadow(0 0 3px #f2c76655);
  }
}
@media (prefers-reduced-motion: reduce) {
  .shimmer {
    animation: none;
  }
}
</style>
