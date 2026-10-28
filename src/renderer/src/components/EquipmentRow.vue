<script setup lang="ts">
import type { Catalog, ItemOption } from "../../../shared/types";
defineProps<{ label: string; options: ItemOption[]; catalog: Catalog }>();
const percent = (n: number | null) =>
  n === null ? "—" : (n * 100).toFixed(1) + "%";
</script>
<template>
  <section class="equipment-section">
    <div class="section-line">
      <h3>{{ label }}</h3>
      <span class="muted small">{{
        options.length ? "国服统计方案" : "暂无可用数据"
      }}</span>
    </div>
    <div v-if="options.length" class="equipment-options">
      <div
        v-for="(option, index) in options.slice(0, 3)"
        :key="index"
        class="equipment-option"
      >
        <div class="item-icons">
          <span
            v-for="id in option.ids"
            :key="id"
            class="item-icon"
            :title="catalog.items[id]?.name || '装备 ' + id"
            ><img
              v-if="catalog.items[id]?.icon"
              :src="catalog.items[id].icon"
              alt=""
              loading="lazy"
            /><small v-else>{{ id }}</small></span
          >
        </div>
        <div class="option-detail">
          <strong>{{
            option.ids.map((id) => catalog.items[id]?.name || id).join(" / ")
          }}</strong
          ><span
            >胜率 {{ percent(option.winRate) }} <i>·</i> 选取率
            {{ percent(option.pickRate) }}</span
          >
        </div>
      </div>
    </div>
    <p v-else class="empty-inline">当前来源未提供这项推荐</p>
  </section>
</template>
