<script setup lang="ts">
import { onMounted, ref } from "vue";
import BrandMark from "../BrandMark.vue";
import { version as appVersion } from "../../../../../package.json";

// 启动画面：短暂显示后淡出，不拦截任何点击（pointer-events: none）。
const visible = ref(true),
  leaving = ref(false);
onMounted(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(
    () => {
      leaving.value = true;
      setTimeout(() => (visible.value = false), reduce ? 0 : 420);
    },
    reduce ? 200 : 900,
  );
});
</script>

<template>
  <div v-if="visible" :class="['brand-splash', { leaving }]" aria-hidden="true">
    <div class="brand-splash-inner">
      <BrandMark :size="104" shimmer />
      <div class="brand-wordmark">
        <strong>PEARLJAM</strong><span>HEX</span>
      </div>
      <p>把每一次三选一，磨成珍珠。</p>
      <small>英雄联盟国服助手 · v{{ appVersion }}</small>
    </div>
  </div>
</template>

<style scoped>
.brand-splash {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background:
    radial-gradient(circle at 50% 42%, #18262b 0, transparent 46%),
    radial-gradient(circle at 62% 30%, #8fd3e814 0, transparent 30%),
    radial-gradient(circle at 38% 62%, #b9a3e812 0, transparent 30%), var(--bg);
  transition: opacity 0.42s ease;
}
.brand-splash.leaving {
  opacity: 0;
}
.brand-splash-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  animation: splash-rise 0.7s ease-out both;
}
.brand-wordmark {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-family: "Bahnschrift", "Microsoft YaHei UI", sans-serif;
  letter-spacing: 6px;
}
.brand-wordmark strong {
  font-size: 30px;
  font-weight: 600;
  background: linear-gradient(
    100deg,
    var(--pearl),
    var(--iris-a) 55%,
    var(--iris-b)
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.brand-wordmark span {
  font-size: 20px;
  color: var(--gold);
}
.brand-splash p {
  font-size: 13px;
  color: var(--secondary);
  letter-spacing: 2px;
}
.brand-splash small {
  font-size: 10px;
  color: var(--muted);
  letter-spacing: 1px;
}
@keyframes splash-rise {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  .brand-splash-inner {
    animation: none;
  }
}
</style>
