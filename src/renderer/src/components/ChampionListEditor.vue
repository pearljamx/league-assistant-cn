<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowUp, Plus, X } from "@lucide/vue";
import { catalog, champions } from "../store";
import ChampionIcon from "./ChampionIcon.vue";

/** 有序英雄列表：按优先级从左到右，最多 10 个。 */
const props = defineProps<{ modelValue: number[]; label: string }>();
const emit = defineEmits<{ "update:modelValue": [value: number[]] }>();
const query = ref("");
const open = ref(false);
const matches = computed(() => {
  const text = query.value.trim().toLowerCase();
  if (!text) return [];
  return catalog.value.champions
    .filter(
      (champion) =>
        !props.modelValue.includes(champion.id) &&
        [champion.name, champion.title, champion.alias].some((value) =>
          value?.toLowerCase().includes(text),
        ),
    )
    .slice(0, 8);
});
function add(id: number) {
  if (props.modelValue.length >= 10) return;
  emit("update:modelValue", [...props.modelValue, id]);
  query.value = "";
  open.value = false;
}
const remove = (id: number) =>
  emit(
    "update:modelValue",
    props.modelValue.filter((item) => item !== id),
  );
function raise(index: number) {
  if (index < 1) return;
  const next = [...props.modelValue];
  [next[index - 1], next[index]] = [next[index], next[index - 1]];
  emit("update:modelValue", next);
}
</script>

<template>
  <div class="champion-list-editor">
    <ol>
      <li v-for="(id, index) in modelValue" :key="id">
        <ChampionIcon :champion="champions.get(id)" :size="30" />
        <span>{{ index + 1 }}. {{ champions.get(id)?.name || id }}</span>
        <button
          v-if="index"
          class="icon-button"
          :aria-label="`提前 ${champions.get(id)?.name || id}`"
          @click="raise(index)"
        >
          <ArrowUp :size="13" />
        </button>
        <button
          class="icon-button"
          :aria-label="`移除 ${champions.get(id)?.name || id}`"
          @click="remove(id)"
        >
          <X :size="13" />
        </button>
      </li>
      <li v-if="modelValue.length < 10" class="champion-list-add">
        <Plus :size="14" />
        <input
          v-model="query"
          :aria-label="label"
          placeholder="搜索英雄添加"
          @focus="open = true"
          @keydown.enter.prevent="matches[0] && add(matches[0].id)"
        />
        <div v-if="open && matches.length" class="champion-list-menu">
          <button
            v-for="champion in matches"
            :key="champion.id"
            :aria-label="`添加 ${champion.name}`"
            @mousedown.prevent="add(champion.id)"
          >
            <ChampionIcon :champion="champion" :size="22" />{{ champion.name
            }}<small>{{ champion.title }}</small>
          </button>
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.champion-list-editor ol {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}
.champion-list-editor li {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px 3px 3px;
  border-radius: 6px;
  background: #ffffff08;
  border: 1px solid var(--line);
  font-size: 12px;
}
.champion-list-add input {
  width: 120px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  outline: none;
}
.champion-list-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  width: 220px;
  padding: 4px;
  border-radius: 8px;
  background: var(--panel);
  border: 1px solid var(--line-strong);
  box-shadow: 0 8px 24px #0008;
}
.champion-list-menu button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 5px;
  text-align: left;
  font-size: 12px;
}
.champion-list-menu button:hover {
  background: #ffffff0d;
}
.champion-list-menu small {
  margin-left: auto;
  color: var(--muted);
}
.icon-button {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: var(--muted);
}
.icon-button:hover {
  color: var(--text);
  background: #ffffff10;
}
</style>
