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
  Tag,
  Trash2,
  X,
} from "@lucide/vue";
import { api } from "../api";
import BrandMark from "./BrandMark.vue";
import { notify, openPlayer, save, settings, state } from "../store";
import { date, playerTagNames } from "../format";
import type {
  AramggStatus,
  CloseAction,
  PlayerNote,
} from "../../../shared/types";
import { version as appVersion } from "../../../../package.json";

const emit = defineEmits<{ close: [] }>();
const sections = [
  { id: "general", name: "通用", icon: MonitorCog },
  { id: "windows", name: "多窗口", icon: AppWindow },
  { id: "recognition", name: "海克斯识别", icon: ScanLine },
  { id: "players", name: "玩家标记", icon: Tag },
  { id: "data", name: "数据与隐私", icon: ShieldCheck },
  { id: "about", name: "关于", icon: Info },
] as const;
const section = ref<(typeof sections)[number]["id"]>("general");
const displays = ref([
  { id: 0, name: "自动跟随游戏窗口", width: 0, height: 0 },
]);
async function openCompanions() {
  const result = await api.companionWindow("show");
  if (!result.ok) notify(result.error || "无法打开客户端小窗");
}
const notes = ref<PlayerNote[]>([]);
async function loadNotes() {
  const result = await api.listPlayerNotes();
  if (result.ok) notes.value = result.data ?? [];
}
async function removeNote(puuid: string) {
  const result = await api.deletePlayerNote(puuid);
  if (result.ok)
    notes.value = notes.value.filter((item) => item.puuid !== puuid);
  else notify(result.error || "删除失败");
}
async function clearEncounters() {
  const result = await api.clearEncounters();
  notify(result.ok ? "已清除本账号的遇到记录" : result.error || "清除失败");
}
function viewNote(note: PlayerNote) {
  openPlayer({ puuid: note.puuid, name: note.name, level: null });
  emit("close");
}
// aramgg API Key 只写不读：界面只发送新 Key，主进程加密保存，返回状态只含末 4 位。
const aramgg = ref<AramggStatus | null>(null),
  keyDraft = ref(""),
  keyBusy = ref(false),
  keyError = ref("");
async function loadAramgg() {
  const result = await api.getAramggStatus();
  if (result.ok) aramgg.value = result.data ?? null;
}
async function saveKey(clear = false) {
  keyBusy.value = true;
  keyError.value = "";
  const result = await api.saveAramggKey(clear ? null : keyDraft.value.trim());
  keyBusy.value = false;
  if (result.ok) {
    aramgg.value = result.data ?? null;
    keyDraft.value = "";
    notify(
      clear
        ? "已清除 aramgg API Key"
        : "已保存 aramgg API Key（加密保存在本机）",
    );
  } else keyError.value = result.error || "保存失败";
}
onMounted(async () => {
  void loadNotes();
  void loadAramgg();
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
              <p>最小化到托盘后，客户端小窗与自动接受仍会按设置工作。</p>
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
              <p>右键托盘图标可切换自动接受、客户端小窗或退出。</p>
            </div>
          </div>
        </template>
        <template v-if="section === 'windows'">
          <h3>多窗口</h3>
          <div class="setting-row">
            <div>
              <strong>自动显示客户端小窗</strong>
              <p>
                客户端打开即显示 Mini
                小窗；英雄信息窗只在英雄选择时出现，进入游戏自动收起。
              </p>
            </div>
            <button
              class="switch"
              :class="{ on: settings.companionWindows !== false }"
              role="switch"
              :aria-checked="settings.companionWindows !== false"
              aria-label="自动显示客户端小窗"
              @click="
                save({ companionWindows: settings.companionWindows === false })
              "
            >
              <span></span>
            </button>
          </div>
          <div class="setting-row">
            <div>
              <strong>重新打开小窗</strong>
              <p>
                默认贴在客户端旁边，拖动后保持位置。点头像只查看，点“换用”才替换英雄，不会自动锁定。
              </p>
            </div>
            <button class="button secondary" @click="openCompanions">
              打开小窗<ArrowUpRight :size="14" />
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
        <template v-if="section === 'players'">
          <h3>玩家标记</h3>
          <p class="settings-disclaimer">
            标记与备注只保存在本机，不上传；“遇到过”只来自你自己的战绩记录。
          </p>
          <div v-for="note in notes" :key="note.puuid" class="setting-row">
            <div>
              <strong
                >{{ note.name
                }}<span v-if="note.tag" :class="['note-tag', note.tag]">{{
                  playerTagNames[note.tag]
                }}</span></strong
              >
              <p>
                {{ note.note || "无备注" }} · {{ note.platform || "国服" }} ·
                {{ date(note.updatedAt) }}
              </p>
            </div>
            <div class="note-actions">
              <button
                class="text-button"
                :aria-label="'查看标记玩家 ' + note.name"
                @click="viewNote(note)"
              >
                查看
              </button>
              <button
                class="icon-button"
                :aria-label="'删除标记 ' + note.name"
                @click="removeNote(note.puuid)"
              >
                <Trash2 :size="15" />
              </button>
            </div>
          </div>
          <p v-if="!notes.length" class="empty-inline">
            还没有标记的玩家。在战绩页的玩家资料里可以添加。
          </p>
          <div class="setting-row">
            <div>
              <strong>清除遇到记录</strong>
              <p>只清除当前账号与大区的“遇到过的玩家”记录，不影响标记。</p>
            </div>
            <button
              class="button secondary"
              :disabled="state.status !== 'connected'"
              @click="clearEncounters"
            >
              清除
            </button>
          </div>
        </template>
        <template v-if="section === 'data'">
          <h3>数据与隐私</h3>
          <div class="setting-row">
            <div>
              <strong>海克斯数据来源</strong>
              <p>
                默认 aramgg：腾讯国服推荐顺序与分级 + aramgg
                全球胜率；也可改用国服 AramHex 样本。
              </p>
            </div>
            <select
              aria-label="海克斯数据来源"
              :value="settings.hexSource ?? 'aramgg'"
              @change="
                save({
                  hexSource: ($event.target as HTMLSelectElement).value as
                    | 'aramgg'
                    | 'aramhex',
                })
              "
            >
              <option value="aramgg">aramgg（默认）</option>
              <option value="aramhex">国服 AramHex 样本</option>
            </select>
          </div>
          <div class="aramgg-key">
            <div class="aramgg-key-head">
              <strong>aramgg 数据 API Key</strong>
              <button
                class="text-button"
                @click="api.openExternal('aramgg-developer')"
              >
                获取 Key<ArrowUpRight :size="13" />
              </button>
            </div>
            <p>
              Key 用 Windows
              加密存储保存在本机，只在主进程使用，不会上传、写入日志或显示完整内容。免费计划每天
              200 额度，同一数据版本内已读取的英雄不再消耗。
            </p>
            <form class="aramgg-key-form" @submit.prevent="saveKey()">
              <input
                v-model="keyDraft"
                type="password"
                autocomplete="off"
                spellcheck="false"
                aria-label="aramgg API Key"
                :placeholder="
                  aramgg?.configured
                    ? '已配置 ' + aramgg.masked + '，输入新 Key 可替换'
                    : '粘贴 hx_live_ 开头的 Key'
                "
              />
              <button
                class="button primary"
                type="submit"
                :disabled="keyBusy || !keyDraft.trim()"
              >
                保存
              </button>
              <button
                v-if="aramgg?.configured"
                class="button secondary"
                type="button"
                :disabled="keyBusy"
                @click="saveKey(true)"
              >
                清除
              </button>
            </form>
            <p class="aramgg-key-status">
              {{ aramgg?.configured ? "已配置 " + aramgg.masked : "未配置" }}
              <template v-if="aramgg?.dataVersion">
                · 数据版本 {{ aramgg.dataVersion }}</template
              ><template
                v-if="
                  aramgg?.creditsRemaining !== null &&
                  aramgg?.creditsRemaining !== undefined
                "
              >
                · 今日剩余 {{ aramgg.creditsRemaining }} /
                {{ aramgg.creditsDaily ?? "—" }}</template
              >
            </p>
            <p v-if="keyError || aramgg?.error" class="warning-text small">
              {{ keyError || aramgg?.error }}
            </p>
          </div>
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
          <div class="about-brand">
            <BrandMark :size="64" shimmer />
            <div>
              <strong
                ><span class="about-pearl">PEARLJAM</span> HEX
                <small>v{{ appVersion }}</small></strong
              >
              <p>把每一次三选一，磨成珍珠。</p>
              <small>由 PEARLJAM（pearljamx）制作的英雄联盟国服助手</small>
            </div>
          </div>
          <div class="setting-row">
            <div>
              <strong>项目主页</strong>
              <p>面向国服的独立社区项目，代码以 MIT 许可公开。</p>
            </div>
            <button class="text-button" @click="api.openExternal('github')">
              GitHub<ArrowUpRight :size="14" />
            </button>
          </div>
          <div class="setting-row">
            <div>
              <strong>致谢与数据来源</strong>
              <p>
                界面参考 LeagueAkari；国服统计来自腾讯 101 与 AramHex（CC BY-NC
                4.0）；海克斯全球样本来自
                aramgg.com，经太农海克斯助手数据包分发；强化图标来自本机客户端。
              </p>
            </div>
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
