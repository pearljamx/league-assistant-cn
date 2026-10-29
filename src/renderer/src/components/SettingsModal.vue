<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  AppWindow,
  ArrowUpRight,
  ExternalLink,
  Info,
  MonitorCog,
  ScanLine,
  ShieldCheck,
  X,
} from "@lucide/vue";
import { api } from "../api";
import { notify, save, settings, state } from "../store";
import type { CloseAction } from "../../../shared/types";
import { version as appVersion } from "../../../../package.json";

defineEmits<{ close: [] }>();
const sections = [
  { id: "general", name: "通用", icon: MonitorCog },
  { id: "windows", name: "多窗口", icon: AppWindow },
  { id: "recognition", name: "海克斯识别", icon: ScanLine },
  { id: "data", name: "数据与隐私", icon: ShieldCheck },
  { id: "about", name: "关于", icon: Info },
] as const;
const section = ref<(typeof sections)[number]["id"]>("general");
const displays = ref([
  { id: 0, name: "自动跟随游戏窗口", width: 0, height: 0 },
]);
async function openCompanions() {
  const result = await api.companionWindow("show");
  if (!result.ok) notify(result.error || "无法打开双弹窗");
}
onMounted(async () => {
  const result = await api.getDisplays();
  if (result.ok && result.data) displays.value = result.data;
});
</script>

<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <section
      class="modal settings-modal"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
    >
      <nav class="settings-nav" aria-label="设置分类">
        <h2>设置</h2>
        <button
          v-for="item in sections"
          :key="item.id"
          :class="{ active: section === item.id }"
          @click="section = item.id"
        >
          <component :is="item.icon" :size="16" />{{ item.name }}
        </button>
      </nav>
      <div class="settings-body">
        <button
          class="icon-button settings-close"
          aria-label="关闭设置"
          @click="$emit('close')"
        >
          <X :size="19" />
        </button>
        <template v-if="section === 'general'">
          <h3>通用</h3>
          <div class="setting-row">
            <div>
              <strong>关闭主窗口时</strong>
              <p>最小化到托盘后，双弹窗与自动接受仍会按设置工作。</p>
            </div>
            <select
              aria-label="关闭主窗口时"
              :value="settings.closeAction ?? 'ask'"
              @change="
                save({
                  closeAction: ($event.target as HTMLSelectElement)
                    .value as CloseAction,
                })
              "
            >
              <option value="ask">每次询问</option>
              <option value="tray">最小化到托盘</option>
              <option value="quit">退出助手</option>
            </select>
          </div>
          <div class="setting-row">
            <div>
              <strong>托盘菜单</strong>
              <p>右键托盘图标可切换自动接受、双弹窗或退出。</p>
            </div>
          </div>
        </template>
        <template v-if="section === 'windows'">
          <h3>多窗口</h3>
          <div class="setting-row">
            <div>
              <strong>自动显示选人弹窗</strong>
              <p>客户端连接后显示匹配状态，进入游戏自动收起。</p>
            </div>
            <button
              class="switch"
              :class="{ on: settings.companionWindows !== false }"
              role="switch"
              :aria-checked="settings.companionWindows !== false"
              aria-label="客户端双弹窗"
              @click="
                save({ companionWindows: settings.companionWindows === false })
              "
            >
              <span></span>
            </button>
          </div>
          <div class="setting-row">
            <div>
              <strong>重新打开两个小窗</strong>
              <p>支持拖动。备选席可直接换用，普通选人不会自动锁定。</p>
            </div>
            <button class="button secondary" @click="openCompanions">
              打开双弹窗<ArrowUpRight :size="14" />
            </button>
          </div>
          <div class="setting-row">
            <div>
              <strong>游戏内悬浮窗</strong>
              <p>识别成功时显示；穿透点击，不抢走游戏焦点。</p>
            </div>
            <button
              class="switch"
              :class="{ on: settings.overlay }"
              role="switch"
              :aria-checked="settings.overlay"
              aria-label="游戏内悬浮窗"
              @click="save({ overlay: !settings.overlay })"
            >
              <span></span>
            </button>
          </div>
        </template>
        <template v-if="section === 'recognition'">
          <h3>海克斯识别</h3>
          <div class="setting-row">
            <div>
              <strong>自动检测三选一</strong>
              <p>仅在海克斯对局中检测。也可按 F6 手动识别。</p>
            </div>
            <button
              class="switch"
              :class="{ on: settings.autoRecognize }"
              role="switch"
              :aria-checked="settings.autoRecognize"
              aria-label="自动检测三选一"
              @click="save({ autoRecognize: !settings.autoRecognize })"
            >
              <span></span>
            </button>
          </div>
          <div class="setting-row">
            <div>
              <strong>识别显示器</strong>
              <p>推荐自动跟随前台游戏窗口。游戏需使用无边框或窗口模式。</p>
            </div>
            <select
              aria-label="识别显示器"
              :value="settings.monitor"
              @change="
                save({
                  monitor: Number(($event.target as HTMLSelectElement).value),
                })
              "
            >
              <option
                v-for="display in displays"
                :key="display.id"
                :value="display.id"
              >
                {{ display.name }}
              </option>
            </select>
          </div>
        </template>
        <template v-if="section === 'data'">
          <h3>数据与隐私</h3>
          <div class="setting-row">
            <div>
              <strong>客户端连接</strong>
              <p>{{ state.message }}</p>
            </div>
            <span class="tiny-tag">{{ state.region || "等待连接" }}</span>
          </div>
          <div class="setting-row">
            <div>
              <strong>海斗数值分</strong>
              <p>
                优先接入 Hexdata，当前等待正式接入资料与授权，不生成替代评分。
              </p>
            </div>
            <button
              class="button secondary"
              @click="api.openExternal('hexdata')"
            >
              官方查分页<ExternalLink :size="14" />
            </button>
          </div>
          <div class="setting-row">
            <div>
              <strong>海克斯分层数据</strong>
              <p>
                AramHex · CC BY-NC 4.0。娱乐、中分和前 5%
                为推算分组，非官方段位。
              </p>
            </div>
            <button
              class="text-button"
              @click="api.openExternal('data-license')"
            >
              数据与许可<ArrowUpRight :size="14" />
            </button>
          </div>
          <div class="privacy-note">
            <ShieldCheck :size="16" /><span
              >客户端认证只在主进程内存中使用。用户配置和成功查询的缓存保存在本机，截图不保存到磁盘。</span
            >
          </div>
        </template>
        <template v-if="section === 'about'">
          <h3>关于</h3>
          <div class="setting-row">
            <div>
              <strong>英雄联盟助手 v{{ appVersion }}</strong>
              <p>面向国服的独立社区项目，代码以 MIT 许可公开。</p>
            </div>
            <button class="text-button" @click="api.openExternal('github')">
              项目主页<ArrowUpRight :size="14" />
            </button>
          </div>
          <p class="settings-disclaimer">
            本项目不隶属于腾讯或 Riot
            Games，不代表其观点。助手不读取游戏内存、不注入或修改游戏程序，不代为发起排队。
          </p>
        </template>
      </div>
    </section>
  </div>
</template>
