<script setup lang="ts">
import MiniWindow from "./companion/MiniWindow.vue";
import HeroInfoWindow from "./companion/HeroInfoWindow.vue";
import "./companion.css";

// #champion-picker 为常驻 Mini 小窗；#champion-info 为选人阶段的英雄信息窗。
const mini = location.hash === "#champion-picker";
</script>

<template>
  <MiniWindow v-if="mini" />
  <HeroInfoWindow v-else />
</template>
