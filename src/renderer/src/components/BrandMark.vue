<script lang="ts">
// PEARLJAM HEX 原创标志：海克斯六边形金框中的一颗虹彩珍珠（与 resources/brand/pearljam-hex.svg 一致）。
let instances = 0;
</script>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number; shimmer?: boolean }>(), {
  size: 24,
  shimmer: false,
});
// 每个实例使用独立的渐变编号，避免同页多个标志互相引用。
const id = `pjh${++instances}`;
</script>

<template>
  <svg
    :class="['brand-mark', { shimmer }]"
    viewBox="0 0 256 256"
    :width="size"
    :height="size"
    role="img"
    aria-label="PEARLJAM HEX"
  >
    <defs>
      <radialGradient :id="id + 'bg'" cx="50%" cy="42%" r="62%">
        <stop offset="0" stop-color="#1b2a30" />
        <stop offset="1" stop-color="#0a1013" />
      </radialGradient>
      <linearGradient :id="id + 'gold'" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f1deac" />
        <stop offset="0.5" stop-color="#cfb47b" />
        <stop offset="1" stop-color="#9c7a45" />
      </linearGradient>
      <radialGradient :id="id + 'pearl'" cx="38%" cy="34%" r="70%">
        <stop offset="0" stop-color="#ffffff" />
        <stop offset="0.28" stop-color="#f6f2ea" />
        <stop offset="0.66" stop-color="#d8d1c6" />
        <stop offset="1" stop-color="#9d948a" />
      </radialGradient>
      <linearGradient :id="id + 'iris'" x1="0.1" y1="0.15" x2="0.9" y2="0.95">
        <stop offset="0" stop-color="#8fd3e8" stop-opacity="0.7" />
        <stop offset="0.45" stop-color="#ffffff" stop-opacity="0" />
        <stop offset="1" stop-color="#b9a3e8" stop-opacity="0.75" />
      </linearGradient>
    </defs>
    <polygon
      points="128,10 230,69 230,187 128,246 26,187 26,69"
      :fill="`url(#${id}bg)`"
    />
    <polygon
      points="128,10 230,69 230,187 128,246 26,187 26,69"
      fill="none"
      :stroke="`url(#${id}gold)`"
      stroke-width="12"
      stroke-linejoin="round"
    />
    <circle cx="128" cy="128" r="56" :fill="`url(#${id}pearl)`" />
    <circle
      class="brand-iris"
      cx="128"
      cy="128"
      r="56"
      :fill="`url(#${id}iris)`"
    />
    <ellipse
      cx="108"
      cy="105"
      rx="16"
      ry="10"
      transform="rotate(-32 108 105)"
      fill="#ffffff"
      fill-opacity="0.92"
    />
    <path
      d="M186 58 L191 73 L206 78 L191 83 L186 98 L181 83 L166 78 L181 73 Z"
      fill="#f1deac"
    />
  </svg>
</template>

<style scoped>
.brand-mark {
  display: block;
  flex-shrink: 0;
}
.shimmer .brand-iris {
  transform-origin: 128px 128px;
  animation: pearl-turn 6s linear infinite;
}
@keyframes pearl-turn {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .shimmer .brand-iris {
    animation: none;
  }
}
</style>
