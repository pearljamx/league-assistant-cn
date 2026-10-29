<script setup lang="ts">
import { Zap } from "@lucide/vue";
import { save, settings } from "../store";
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
      <p class="automation-note">
        助手不会代为发起排队，也不会自动购买装备或替你点击强化。
      </p>
    </section>
  </section>
</template>
