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
          <option v-for="n in 10" :key="n" :value="n * 1000">
            {{ n }} 秒
          </option>
        </select>
      </div>
      <div class="setting-row">
        <div>
          <strong>自动匹配</strong>
          <p>
            你是房主且满足下方条件时，倒计时后开始匹配；条件暂不满足会等待，结算自动回房后同样生效。手动取消匹配或拒绝确认回到大厅后，本轮不再自动排队。默认关闭。
          </p>
        </div>
        <button
          class="switch"
          :class="{ on: settings.autoMatch }"
          role="switch"
          :aria-checked="!!settings.autoMatch"
          aria-label="自动匹配"
          @click="save({ autoMatch: !settings.autoMatch })"
        >
          <span></span>
        </button>
      </div>
      <div class="setting-row">
        <div>
          <strong>匹配延迟</strong>
          <p>条件满足后开始倒计时，期间可在 Mini 窗跳过本次。</p>
        </div>
        <select
          aria-label="匹配延迟"
          :value="settings.autoMatchDelayMs ?? 3000"
          @change="
            save({
              autoMatchDelayMs: Number(
                ($event.target as HTMLSelectElement).value,
              ),
            })
          "
        >
          <option v-for="n in 30" :key="n" :value="n * 1000">
            {{ n }} 秒
          </option>
        </select>
      </div>
      <div class="setting-row">
        <div>
          <strong>房间最少人数</strong>
          <p>房间人数达到后才自动匹配，例如等朋友进齐再排。</p>
        </div>
        <select
          aria-label="房间最少人数"
          :value="settings.autoMatchMinMembers ?? 1"
          @change="
            save({
              autoMatchMinMembers: Number(
                ($event.target as HTMLSelectElement).value,
              ),
            })
          "
        >
          <option v-for="n in 5" :key="n" :value="n">{{ n }} 人</option>
        </select>
      </div>
      <div class="setting-row">
        <div>
          <strong>等待被邀请者回应</strong>
          <p>有未回应的邀请时暂不自动匹配。</p>
        </div>
        <button
          class="switch"
          :class="{ on: settings.autoMatchWaitInvites !== false }"
          role="switch"
          :aria-checked="settings.autoMatchWaitInvites !== false"
          aria-label="等待被邀请者回应"
          @click="
            save({ autoMatchWaitInvites: settings.autoMatchWaitInvites === false })
          "
        >
          <span></span>
        </button>
      </div>
      <div class="setting-row">
        <div>
          <strong>结算时自动跳过点赞</strong>
          <p>点赞投票出现约 1 秒后直接跳过，不给任何人点赞。默认关闭。</p>
        </div>
        <button
          class="switch"
          :class="{ on: settings.autoSkipHonor }"
          role="switch"
          :aria-checked="!!settings.autoSkipHonor"
          aria-label="结算时自动跳过点赞"
          @click="save({ autoSkipHonor: !settings.autoSkipHonor })"
        >
          <span></span>
        </button>
      </div>
      <div class="setting-row">
        <div>
          <strong>结算后自动回到房间</strong>
          <p>对局结算页出现后约 2 秒回到原房间，可与自动匹配组成连续排队。默认关闭。</p>
        </div>
        <button
          class="switch"
          :class="{ on: settings.autoPlayAgain }"
          role="switch"
          :aria-checked="!!settings.autoPlayAgain"
          aria-label="结算后自动回到房间"
          @click="save({ autoPlayAgain: !settings.autoPlayAgain })"
        >
          <span></span>
        </button>
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
