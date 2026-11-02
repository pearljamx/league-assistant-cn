<script setup lang="ts">
import type { BalanceChip } from "../../../shared/aram-balance";

defineProps<{ chips: BalanceChip[]; source?: string }>();
</script>

<template>
  <div
    v-if="chips.length"
    class="balance-chips"
    :title="
      '大乱斗平衡调整' + (source ? ' · 来源 ' + source : '') +
      '（海克斯大乱斗是否沿用以客户端为准）'
    "
  >
    <span
      v-for="chip in chips"
      :key="chip.key"
      :class="['balance-chip', chip.buff ? 'buff' : 'nerf']"
      >{{ chip.text }}</span
    >
  </div>
</template>

<style scoped>
.balance-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.balance-chip {
  font-size: 10px;
  line-height: 16px;
  padding: 0 5px;
  border-radius: 3px;
  white-space: nowrap;
}
.balance-chip.buff {
  color: #8fd6b4;
  background: #91c9b31a;
}
.balance-chip.nerf {
  color: #f0a0a6;
  background: #db93971a;
}
</style>
