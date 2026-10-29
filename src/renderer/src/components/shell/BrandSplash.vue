<script setup lang="ts">
import { onMounted, ref } from "vue";
import BrandMark from "../BrandMark.vue";
import art from "../../assets/brand-art.jpg";
import { version as appVersion } from "../../../../../package.json";

// 启动画面：以原画为背景短暂显示后淡出，不拦截任何点击（pointer-events: none）。
const visible = ref(true),
  leaving = ref(false);
onMounted(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(
    () => {
      leaving.value = true;
      setTimeout(() => (visible.value = false), reduce ? 0 : 420);
    },
    reduce ? 200 : 1100,
  );
});
</script>

<template>
  <div v-if="visible" :class="['brand-splash', { leaving }]" aria-hidden="true">
    <img class="brand-splash-art" :src="art" alt="" />
    <span class="brand-sfx left">ゴゴゴ</span>
    <span class="brand-sfx right">ゴゴ</span>
    <div class="brand-splash-inner">
      <BrandMark :size="96" shimmer />
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
  overflow: hidden;
  pointer-events: none;
  background: var(--jam-ink);
  transition: opacity 0.42s ease;
}
.brand-splash::after {
  content: "";
  position: absolute;
  inset: 0;
  background:
    var(--screentone),
    radial-gradient(circle at 50% 50%, #1c102466 0, #1c1024cc 70%);
}
.brand-splash.leaving {
  opacity: 0;
}
.brand-splash-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 55% 40%;
  filter: saturate(1.1);
  animation: art-push 1.6s ease-out both;
}
.brand-sfx {
  position: absolute;
  z-index: 1;
  font:
    900 64px/1 "Yu Gothic UI",
    "Microsoft YaHei UI",
    sans-serif;
  letter-spacing: -4px;
  color: #9a55e0;
  -webkit-text-stroke: 2px #1c1024;
  text-shadow: 4px 4px 0 #f07ab866;
  transform: skewX(-12deg) rotate(-8deg);
  opacity: 0.85;
  animation: sfx-shake 0.5s steps(2) infinite;
}
.brand-sfx.left {
  left: 6%;
  bottom: 12%;
}
.brand-sfx.right {
  right: 7%;
  top: 14%;
  font-size: 48px;
}
.brand-splash-inner {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  animation: splash-rise 0.7s ease-out both;
}
.brand-wordmark {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-family: "Bahnschrift", "Microsoft YaHei UI", sans-serif;
  letter-spacing: 6px;
  transform: skewX(-8deg);
}
.brand-wordmark strong {
  font-size: 34px;
  font-weight: 800;
  color: var(--jam-pink);
  -webkit-text-stroke: 1px #1c1024;
  text-shadow:
    3px 3px 0 #1c1024,
    0 0 18px #f07ab855;
}
.brand-wordmark span {
  font-size: 22px;
  font-weight: 700;
  color: var(--jam-glow);
  text-shadow: 2px 2px 0 #1c1024;
}
.brand-splash p {
  font-size: 13px;
  color: var(--pearl);
  letter-spacing: 2px;
  text-shadow: 0 1px 4px #000;
}
.brand-splash small {
  font-size: 10px;
  color: #d8c8e8;
  letter-spacing: 1px;
}
@keyframes splash-rise {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
}
@keyframes art-push {
  from {
    transform: scale(1.08);
  }
}
@keyframes sfx-shake {
  50% {
    translate: 1px -1px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .brand-splash-inner,
  .brand-splash-art,
  .brand-sfx {
    animation: none;
  }
}
</style>
