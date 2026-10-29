<script setup lang="ts">
import { computed } from "vue";
import { Swords, Zap } from "@lucide/vue";
import { save, settings } from "../store";
import ChampionListEditor from "../components/ChampionListEditor.vue";
import type { AutoSelectSettings } from "../../../shared/types";

const auto = computed<AutoSelectSettings>(() => ({
  pick: false,
  pickChampions: [],
  ban: false,
  banChampions: [],
  lock: false,
  lockDelayMs: 3000,
  bench: false,
  benchChampions: [],
  ...settings.value.autoSelect,
}));
/** 合并后整体复制成普通数据再跨 preload 传递（响应式数组不能直接克隆）。 */
const patch = (value: Partial<AutoSelectSettings>) =>
  save({
    autoSelect: JSON.parse(JSON.stringify({ ...auto.value, ...value })),
  });
const toggles = [
  {
    key: "pick",
    name: "自动选择英雄",
    hint: "召唤师峡谷轮到你时按列表预选第一个可选英雄；不会覆盖你自己预选的英雄。",
  },
  {
    key: "ban",
    name: "自动禁用英雄",
    hint: "轮到你禁用时按列表预禁，跳过已被禁用、已被选走或队友想选的英雄。",
  },
  {
    key: "bench",
    name: "大乱斗自动抢备选席",
    hint: "备选席出现列表中比当前英雄更靠前的英雄时立即交换；队友留下的英雄要等卡片阶段结束。",
  },
] as const;
</script>

<template>
  <section class="automation-view">
    <section class="panel settings-panel">
      <div class="panel-heading">
        <div>
          <h2>游戏流程</h2>
          <p>由你决定何时启用；阶段变化或断开连接时取消待执行操作</p>
        </div>
        <Zap :size="20" class="gold-icon" />
      </div>
      <div class="setting-row">
        <div>
          <strong>自动接受对局</strong>
          <p>客户端出现接受提示后执行，仅处理当前确认。默认关闭。</p>
        </div>
        <button
          class="switch"
          :class="{ on: settings.autoAccept }"
          role="switch"
          :aria-checked="settings.autoAccept"
          aria-label="自动接受对局"
          @click="save({ autoAccept: !settings.autoAccept })"
        >
          <span></span>
        </button>
      </div>
      <div class="setting-row">
        <div>
          <strong>接受延迟</strong>
          <p>确认阶段结束或连接断开时取消。</p>
        </div>
        <select
          aria-label="接受延迟"
          :value="settings.acceptDelayMs"
          @change="
            save({
              acceptDelayMs: Number(($event.target as HTMLSelectElement).value),
            })
          "
        >
          <option :value="1000">1 秒</option>
          <option :value="2000">2 秒</option>
          <option :value="3000">3 秒</option>
          <option :value="5000">5 秒</option>
        </select>
      </div>
    </section>
    <section class="panel settings-panel">
      <div class="panel-heading">
        <div>
          <h2>自动选人与禁用</h2>
          <p>
            全部默认关闭。未打开“自动锁定”时只预选/预禁，最终确认仍由你在客户端完成
          </p>
        </div>
        <Swords :size="20" class="gold-icon" />
      </div>
      <div v-for="item in toggles" :key="item.key" class="setting-row stacked">
        <div class="setting-row-head">
          <div>
            <strong>{{ item.name }}</strong>
            <p>{{ item.hint }}</p>
          </div>
          <button
            class="switch"
            :class="{ on: auto[item.key] }"
            role="switch"
            :aria-checked="auto[item.key]"
            :aria-label="item.name"
            @click="patch({ [item.key]: !auto[item.key] })"
          >
            <span></span>
          </button>
        </div>
        <ChampionListEditor
          :model-value="auto[(item.key + 'Champions') as 'pickChampions']"
          :label="item.name + '列表'"
          @update:model-value="patch({ [item.key + 'Champions']: $event })"
        />
      </div>
      <div class="setting-row">
        <div>
          <strong>自动锁定</strong>
          <p>
            预选/预禁后等待设定时间再锁定；期间你改选其他英雄就不会锁定。大乱斗英雄卡片没有单独确认步骤，只有打开此项才会自动拿卡片。默认关闭。
          </p>
        </div>
        <div class="setting-inline">
          <select
            aria-label="锁定延迟"
            :value="auto.lockDelayMs"
            :disabled="!auto.lock"
            @change="
              patch({
                lockDelayMs: Number(($event.target as HTMLSelectElement).value),
              })
            "
          >
            <option :value="1000">1 秒</option>
            <option :value="3000">3 秒</option>
            <option :value="5000">5 秒</option>
            <option :value="10000">10 秒</option>
          </select>
          <button
            class="switch"
            :class="{ on: auto.lock }"
            role="switch"
            :aria-checked="auto.lock"
            aria-label="自动锁定"
            @click="patch({ lock: !auto.lock })"
          >
            <span></span>
          </button>
        </div>
      </div>
      <p class="automation-note">
        助手不会代为发起排队，也不会自动购买装备或替你点击强化。
      </p>
    </section>
  </section>
</template>
