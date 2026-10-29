<script setup lang="ts">
import { computed } from "vue";
import { ChevronDown, ChevronRight } from "@lucide/vue";
import ChampionIcon from "../ChampionIcon.vue";
import { augmentNames, catalog, champions, state } from "../../store";
import { date, duration, matchMode } from "../../format";
import type { Match, MatchPlayer } from "../../../../shared/types";

// 参考 LeagueAkari 的战绩卡片：折叠时显示本人数据与双方 10 人，展开后按队伍分表显示每个人的完整数据。
const props = defineProps<{
  match: Match;
  /** 当前标签查看的玩家。 */
  puuid: string;
  expanded: boolean;
  detail: Match | null;
  loading: boolean;
  error: string;
}>();
const emit = defineEmits<{ toggle: []; view: [player: MatchPlayer] }>();

const self = computed(() =>
  props.match.players.find((player) => player.puuid === props.puuid),
);
const result = computed(() =>
  props.match.remake
    ? { text: "重开", tone: "neutral" }
    : props.match.private
      ? { text: "隐私对局", tone: "neutral" }
      : self.value
        ? self.value.win
          ? { text: "胜利", tone: "win" }
          : { text: "失败", tone: "loss" }
        : { text: "对局", tone: "neutral" },
);
/** 队伍汇总：总击杀用于参团率，总伤害用于伤害占比。 */
const teamTotals = (match: Match, teamId: number) => {
  const members = match.players.filter((player) => player.teamId === teamId);
  return {
    kills: members.reduce((sum, player) => sum + player.kills, 0),
    deaths: members.reduce((sum, player) => sum + player.deaths, 0),
    assists: members.reduce((sum, player) => sum + player.assists, 0),
    damage: members.reduce((sum, player) => sum + player.damage, 0),
    gold: members.reduce((sum, player) => sum + player.gold, 0),
  };
};
const share = (value: number, total: number) =>
  total > 0 ? `${Math.round((value / total) * 100)}%` : "—";
const kdaRatio = (player: MatchPlayer) =>
  player.deaths
    ? ((player.kills + player.assists) / player.deaths).toFixed(2)
    : player.kills + player.assists
      ? "完美"
      : "0.00";
const kilo = (value: number) =>
  value >= 10000
    ? `${(value / 1000).toFixed(1)}k`
    : value.toLocaleString("zh-CN");
const selfTeam = computed(() =>
  self.value ? teamTotals(props.match, self.value.teamId) : null,
);
const minutes = computed(() => Math.max(1, props.match.duration / 60));
/** 本人所在队伍排在前面；其余队伍按编号排序。 */
const teamIds = (match: Match) =>
  [...new Set(match.players.map((player) => player.teamId))].sort(
    (a, b) =>
      (a === self.value?.teamId ? -1 : 0) -
        (b === self.value?.teamId ? -1 : 0) || a - b,
  );
const overviewTeams = computed(() =>
  teamIds(props.match).map((id) =>
    props.match.players.filter((player) => player.teamId === id).slice(0, 5),
  ),
);
const detailTeams = computed(() => {
  const match = props.detail;
  if (!match) return [];
  const most = Math.max(1, ...match.players.map((player) => player.damage));
  return teamIds(match).map((id) => {
    const members = match.players.filter((player) => player.teamId === id);
    return {
      id,
      win: members[0]?.win ?? false,
      totals: teamTotals(match, id),
      most,
      members,
    };
  });
});
const sideName = (id: number) =>
  id === 100 ? "蓝色方" : id === 200 ? "红色方" : `队伍 ${id}`;
const augmentList = (player: MatchPlayer) =>
  (player.augments ?? []).map((id) => ({
    id,
    name: augmentNames.value.get(id)?.name ?? `强化 ${id}`,
    rarity: augmentNames.value.get(id)?.rarity ?? "",
    iconUrl: augmentNames.value.get(id)?.iconUrl ?? null,
  }));
const isMe = (player: MatchPlayer) =>
  player.puuid === state.value.summoner?.puuid;
</script>

<template>
  <article :class="['hw-match', result.tone, { expanded }]">
    <div class="mc-overview">
      <div class="mc-result">
        <strong>{{ result.text }}</strong
        ><span>{{ matchMode(match) }}</span
        ><small>{{ date(match.date) }}</small
        ><small>{{ duration(match.duration) }}</small>
      </div>
      <div class="mc-champion">
        <ChampionIcon
          :champion="champions.get(self?.championId ?? 0)"
          :size="46"
        /><b v-if="self?.level" class="mc-level">{{ self.level }}</b>
        <span>{{
          champions.get(self?.championId ?? 0)?.name || "未提供英雄"
        }}</span>
      </div>
      <div v-if="self" class="mc-stats">
        <div class="mc-kda">
          <strong
            >{{ self.kills }} <i>/</i> <em>{{ self.deaths }}</em> <i>/</i>
            {{ self.assists }}</strong
          >
          <small
            >{{ kdaRatio(self) }} KDA · 参团
            {{ share(self.kills + self.assists, selfTeam?.kills ?? 0) }}</small
          >
        </div>
        <div class="mc-figure">
          <strong>{{ share(self.damage, selfTeam?.damage ?? 0) }}</strong>
          <small>伤害 {{ kilo(self.damage) }}</small>
        </div>
        <div class="mc-figure mc-optional">
          <strong>{{ kilo(self.gold) }}</strong>
          <small>经济 · 补刀 {{ self.cs }}</small>
        </div>
      </div>
      <div v-else class="mc-stats muted">本局没有该玩家的公开数据</div>
      <div class="mc-build">
        <div class="mc-items">
          <span
            v-for="(id, index) in self?.items ?? []"
            :key="index"
            :title="catalog.items[id]?.name || '未提供装备'"
            ><img
              v-if="catalog.items[id]?.icon"
              :src="catalog.items[id].icon"
              alt="" /></span
          ><span
            v-for="index in Math.max(0, 7 - (self?.items.length ?? 0))"
            :key="'empty' + index"
          ></span>
        </div>
        <div v-if="self && augmentList(self).length" class="mc-augments">
          <span
            v-for="augment in augmentList(self)"
            :key="augment.id"
            :class="['mc-augment', augment.rarity]"
            :title="augment.name"
            ><img v-if="augment.iconUrl" :src="augment.iconUrl" alt="" />{{
              augment.name
            }}</span
          >
        </div>
      </div>
      <div class="hw-match-players mc-teams">
        <div
          v-for="(team, index) in overviewTeams"
          :key="index"
          class="mc-team"
        >
          <button
            v-for="player in team"
            :key="player.puuid || player.name + player.championId"
            :class="{ me: player.puuid === puuid }"
            :disabled="match.private || !player.puuid"
            :aria-label="'查看玩家 ' + player.name"
            :title="player.name || '身份未公开'"
            @click="emit('view', player)"
          >
            <ChampionIcon
              :champion="champions.get(player.championId)"
              :size="18"
            /><span>{{ player.name.split("#")[0] || "身份未公开" }}</span>
          </button>
        </div>
      </div>
      <button
        class="hw-match-toggle"
        :aria-label="expanded ? '收起单局详情' : '查看单局详情'"
        :aria-expanded="expanded"
        @click="emit('toggle')"
      >
        <ChevronDown v-if="expanded" :size="18" /><ChevronRight
          v-else
          :size="18"
        />
      </button>
    </div>
    <div v-if="expanded" class="hw-match-detail mc-detail">
      <p v-if="loading" class="mc-note">正在读取单局详情…</p>
      <p v-else-if="error" class="mc-note error">{{ error }}</p>
      <template v-else-if="detail">
        <p v-if="detail.players.length < 10" class="mc-note">
          当前只有 {{ detail.players.length }} 名玩家的可用记录。
        </p>
        <section
          v-for="team in detailTeams"
          :key="team.id"
          :class="['mc-table', team.win ? 'win' : 'loss']"
        >
          <header class="mc-table-head">
            <strong>{{ team.win ? "胜利" : "失败" }}</strong
            ><span>{{ sideName(team.id) }}</span
            ><span
              >{{ team.totals.kills }} / {{ team.totals.deaths }} /
              {{ team.totals.assists }}</span
            ><span>伤害 {{ kilo(team.totals.damage) }}</span
            ><span>经济 {{ kilo(team.totals.gold) }}</span>
          </header>
          <div class="mc-row mc-row-head">
            <span>玩家</span><span>KDA</span><span>伤害</span><span>承受</span
            ><span>经济</span><span>补刀</span><span>装备</span>
          </div>
          <button
            v-for="player in team.members"
            :key="player.puuid || player.name + player.championId"
            :class="[
              'mc-row',
              'hw-detail-player',
              { me: player.puuid === puuid },
            ]"
            :disabled="detail.private || !player.puuid"
            :aria-label="'查看详情玩家 ' + player.name"
            @click="emit('view', player)"
          >
            <span class="mc-player"
              ><span class="mc-avatar"
                ><ChampionIcon
                  :champion="champions.get(player.championId)"
                  :size="30"
                /><b v-if="player.level">{{ player.level }}</b></span
              ><span class="mc-name"
                ><b
                  >{{ player.name || "身份未公开"
                  }}<small v-if="isMe(player)">我</small></b
                ><span
                  v-if="augmentList(player).length"
                  class="mc-augments small"
                  ><i
                    v-for="augment in augmentList(player)"
                    :key="augment.id"
                    :class="['mc-augment', augment.rarity]"
                    :title="augment.name"
                    ><img
                      v-if="augment.iconUrl"
                      :src="augment.iconUrl"
                      alt=""
                    />{{ augment.name }}</i
                  ></span
                ><small v-else>{{
                  champions.get(player.championId)?.name || "未提供英雄"
                }}</small></span
              ></span
            ><span class="mc-cell"
              ><b
                >{{ player.kills }} / {{ player.deaths }} /
                {{ player.assists }}</b
              ><small
                >{{ kdaRatio(player) }} · 参团
                {{
                  share(player.kills + player.assists, team.totals.kills)
                }}</small
              ></span
            ><span class="mc-cell"
              ><b>{{ kilo(player.damage) }}</b
              ><i class="mc-bar"
                ><i
                  :style="{ width: (player.damage / team.most) * 100 + '%' }"
                ></i></i
              ><small
                >占队伍 {{ share(player.damage, team.totals.damage) }}</small
              ></span
            ><span class="mc-cell"
              ><b>{{
                player.damageTaken === undefined
                  ? "—"
                  : kilo(player.damageTaken)
              }}</b></span
            ><span class="mc-cell"
              ><b>{{ kilo(player.gold) }}</b
              ><small>{{ Math.round(player.gold / minutes) }}/分</small></span
            ><span class="mc-cell"
              ><b>{{ player.cs }}</b
              ><small>{{ (player.cs / minutes).toFixed(1) }}/分</small></span
            ><span class="mc-items small"
              ><span
                v-for="(id, index) in player.items"
                :key="index"
                :title="catalog.items[id]?.name || '未提供装备'"
                ><img
                  v-if="catalog.items[id]?.icon"
                  :src="catalog.items[id].icon"
                  alt="" /></span
            ></span>
          </button>
        </section>
      </template>
    </div>
  </article>
</template>

<style scoped>
.hw-match {
  position: relative;
  border: 1px solid var(--line);
  border-left: 3px solid #4c6067;
  border-radius: 8px;
  background: #131c20;
  margin-bottom: 8px;
  overflow: hidden;
}
.hw-match.win {
  border-left-color: #5b9fd6;
  background: linear-gradient(90deg, #5b9fd612, #131c20 38%);
}
.hw-match.loss {
  border-left-color: #d6787d;
  background: linear-gradient(90deg, #d6787d12, #131c20 38%);
}
.mc-overview {
  display: grid;
  grid-template-columns:
    78px 62px minmax(196px, 1fr) minmax(168px, 0.9fr)
    minmax(232px, 252px) 26px;
  align-items: center;
  gap: 12px;
  padding: 9px 8px 9px 12px;
  min-height: 108px;
}
.mc-result {
  display: flex;
  flex-direction: column;
  line-height: 1.45;
}
.mc-result strong {
  font-size: 14px;
}
.win .mc-result strong {
  color: #7fb8e6;
}
.loss .mc-result strong {
  color: #e29a9e;
}
.mc-result span {
  font-size: 11px;
  color: var(--secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mc-result small {
  font-size: 10px;
  color: var(--muted);
}
.mc-champion {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--secondary);
  text-align: center;
}
.mc-champion span {
  max-width: 62px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mc-level {
  position: absolute;
  top: 30px;
  right: 4px;
  min-width: 18px;
  padding: 0 3px;
  border-radius: 8px;
  font-size: 9px;
  line-height: 15px;
  text-align: center;
  background: #0b1114;
  border: 1px solid var(--line-strong);
}
.mc-stats {
  display: flex;
  gap: 14px;
  min-width: 0;
}
.mc-kda,
.mc-figure {
  display: flex;
  flex-direction: column;
  line-height: 1.35;
  white-space: nowrap;
}
.mc-kda strong,
.mc-figure strong {
  font-family: "Bahnschrift", "Microsoft YaHei UI", sans-serif;
  font-size: 15px;
}
.mc-kda i {
  margin: 0 1px;
  font-size: 11px;
}
.mc-kda em {
  font-style: normal;
  color: #e29a9e;
}
.mc-kda small,
.mc-figure small {
  font-size: 10px;
  color: var(--muted);
}
.mc-build {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.mc-items {
  display: flex;
  gap: 3px;
}
.mc-items > span {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: #0d1417;
  border: 1px solid var(--line);
  overflow: hidden;
  flex-shrink: 0;
}
.mc-items img {
  width: 100%;
  height: 100%;
}
.mc-items.small > span {
  width: 22px;
  height: 22px;
}
.mc-augments {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  min-width: 0;
}
.mc-augment {
  max-width: 88px;
  padding: 0 5px;
  border-radius: 3px;
  font-size: 10px;
  font-style: normal;
  line-height: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #c9d4d6;
  background: #2a353a;
}
.mc-augment {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.mc-augment img {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  flex-shrink: 0;
}
.mc-augment.gold {
  color: #f1dca8;
  background: #4a3d1e;
}
.mc-augment.prismatic {
  color: #ead7ff;
  background: #3e2d55;
}
.mc-augments.small .mc-augment {
  max-width: 70px;
  font-size: 9px;
  line-height: 14px;
}
.mc-teams {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.mc-team {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.mc-team button {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding: 0 2px;
  border-radius: 3px;
  font-size: 11px;
  line-height: 18px;
  color: var(--secondary);
  text-align: left;
}
.mc-team button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mc-team button:hover:not(:disabled) {
  color: var(--text);
  background: #ffffff0a;
}
.mc-team button.me {
  color: var(--gold-light);
  font-weight: 600;
}
.mc-team button:disabled {
  cursor: default;
  opacity: 0.6;
}
.hw-match-toggle {
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--muted);
}
.hw-match-toggle:hover {
  color: var(--text);
  background: #ffffff0a;
}
.mc-detail {
  border-top: 1px solid var(--line);
  padding: 10px 12px 12px;
  background: #0f171a;
}
.mc-note {
  font-size: 11px;
  color: var(--muted);
  margin: 0 0 8px;
}
.mc-note.error {
  color: #e0a3a6;
}
.mc-table {
  border: 1px solid var(--line);
  border-radius: 7px;
  overflow: hidden;
  margin-bottom: 8px;
}
.mc-table-head {
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 6px 10px;
  font-size: 11px;
  color: var(--muted);
}
.mc-table.win .mc-table-head {
  background: #5b9fd614;
}
.mc-table.loss .mc-table-head {
  background: #d6787d14;
}
.mc-table-head strong {
  font-size: 12px;
}
.mc-table.win .mc-table-head strong {
  color: #7fb8e6;
}
.mc-table.loss .mc-table-head strong {
  color: #e29a9e;
}
.mc-row {
  width: 100%;
  display: grid;
  grid-template-columns:
    minmax(190px, 2.2fr) minmax(96px, 1fr) minmax(104px, 1fr) 64px
    72px 58px minmax(166px, 1.4fr);
  align-items: center;
  gap: 10px;
  padding: 5px 10px;
  text-align: left;
  border-top: 1px solid var(--line);
  font-size: 11px;
}
.mc-row-head {
  padding-top: 4px;
  padding-bottom: 4px;
  font-size: 10px;
  color: var(--muted);
}
button.mc-row:hover:not(:disabled) {
  background: #ffffff06;
}
button.mc-row:disabled {
  cursor: default;
}
button.mc-row.me {
  background: #cfb47b0d;
}
.mc-player {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.mc-avatar {
  position: relative;
  flex-shrink: 0;
}
.mc-avatar b {
  position: absolute;
  right: -4px;
  bottom: -3px;
  min-width: 15px;
  padding: 0 2px;
  border-radius: 7px;
  font-size: 8px;
  line-height: 13px;
  text-align: center;
  background: #0b1114;
  border: 1px solid var(--line-strong);
}
.mc-name {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.mc-name > b {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mc-name > b small {
  margin-left: 5px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 9px;
  color: var(--green);
  background: #91c9b31a;
}
.mc-name > small {
  font-size: 10px;
  color: var(--muted);
}
.mc-cell {
  display: flex;
  flex-direction: column;
  line-height: 1.35;
  white-space: nowrap;
}
.mc-cell b {
  font-family: "Bahnschrift", "Microsoft YaHei UI", sans-serif;
  font-weight: 500;
}
.mc-cell small {
  font-size: 9px;
  color: var(--muted);
}
.mc-bar {
  display: block;
  height: 3px;
  margin: 2px 0 1px;
  border-radius: 2px;
  background: #ffffff10;
}
.mc-bar i {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: #d6a35b;
}
@media (max-width: 1280px) {
  .mc-overview {
    grid-template-columns:
      70px 56px minmax(150px, 1fr) minmax(150px, 0.9fr)
      216px 24px;
    gap: 9px;
  }
  .mc-optional {
    display: none;
  }
  .mc-row {
    grid-template-columns:
      minmax(160px, 2fr) minmax(90px, 1fr) minmax(96px, 1fr) 58px 64px 50px
      minmax(140px, 1.3fr);
    gap: 7px;
  }
}
@media (max-width: 1100px) {
  .mc-overview {
    grid-template-columns: 64px 52px minmax(140px, 1fr) 200px 22px;
  }
  .mc-build {
    display: none;
  }
  .mc-row {
    grid-template-columns:
      minmax(150px, 2fr) minmax(86px, 1fr) minmax(90px, 1fr)
      60px 48px;
  }
  .mc-row > :nth-child(4),
  .mc-row > :nth-child(7) {
    display: none;
  }
}
</style>
