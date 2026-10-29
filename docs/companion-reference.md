# 客户端双弹窗与玩家详情参考

核对日期：2026-10-29。仅借鉴公开产品结构与接口行为，本项目独立实现界面和状态逻辑，不复制其他助手整段代码。

## 双窗与客户端阶段

LeagueAkari 当前源码将 Mini Akari 辅助窗与 Champion Data 英雄资料窗分开：

- [aux-window/window.ts](https://github.com/LeagueAkari/LeagueAkari/blob/main/src/main/shards/window-manager/aux-window/window.ts)：辅助窗基础尺寸 340×420，无边框；按 Lobby / Matchmaking / ReadyCheck / ChampSelect 决定显示，断线隐藏。其英雄资料窗启用时，选人阶段会隐藏 Mini 窗；本项目按用户要求同时保留快速选人与英雄信息两个窗。
- [opgg-window/window.ts](https://github.com/LeagueAkari/LeagueAkari/blob/main/src/main/shards/window-manager/opgg-window/window.ts)：独立英雄数据窗，选人阶段主动显示，保存尺寸和位置。
- [base-akari-window.ts](https://github.com/LeagueAkari/LeagueAkari/blob/main/src/main/shards/window-manager/base-akari-window.ts)：统一管理关闭/隐藏、位置恢复、置顶和 `showInactive`。**不能声称 Akari 自动展示始终不抢焦点**：它的 `showOrRestore` 默认参数为 false，是否不激活由调用方决定。本项目自动出现采用 `showInactive`，用户点击才获得焦点。
- [Indicator.vue](https://github.com/LeagueAkari/LeagueAkari/blob/main/src/renderer/src-aux-window/views/Indicator.vue)：辅助窗按阶段切换 lounge、champ-select、placeholder；大厅和匹配状态有各自内容。
- [SessionChampions.vue](https://github.com/LeagueAkari/LeagueAkari/blob/main/src/renderer/src-opgg-window/opgg/widgets/SessionChampions.vue)：选人阶段从队伍英雄/预选读取列表，进入游戏后从 gameflow 两队读取；点击英雄只切换资料标签，不等同于向客户端选英雄。

本项目由主进程创建两个独立小窗，阶段联动、账号切换与安全桥接统一管理；单窗关闭只隐藏，进入游戏关闭选人窗，原三选一悬浮窗继续独立处理。

## 用户点击快速选英雄

[Akari ChampSelectHttpApi](https://github.com/LeagueAkari/LeagueAkari/blob/main/src/shared/http-api-axios-helper/league-client/champ-select.ts)公开封装了以下 LCU 操作：

| 场景 | 操作 |
|---|---|
| 查询最新选人会话 | GET `/lol-champ-select/v1/session` |
| 查询当前可选英雄 | GET `/lol-champ-select/v1/pickable-champion-ids` |
| 查询禁用英雄 | GET `/lol-champ-select/v1/disabled-champion-ids` |
| 大乱斗备选席交换 | POST `/lol-champ-select/v1/session/bench/swap/{championId}` |
| 普通选人更新当前 pick action | PATCH `/lol-champ-select/v1/session/actions/{actionId}`，意向选择只传 `championId`，不自动锁定 |

这证明参考助手如何调用接口，不等于本机真实写操作已通过验收。每次用户点击后应重新读取会话，核对当前账号、阶段、本人的 cell/action、是否已完成及备选席仍可用；不代为排队，不自动连点，不用浏览资料行为触发选择。

## 实时对局与点击玩家详情

- [OngoingGamePlayerDataLoader](https://github.com/LeagueAkari/LeagueAkari/blob/main/src/main/shards/ongoing-game/player-data-loader.ts)：随队伍 PUUID 集合更新召唤师、排位、熟练度与历史，移除离开的玩家并取消过期任务。
- [PlayerInfoCardHeader.vue](https://github.com/LeagueAkari/LeagueAkari/blob/main/src/renderer-shared/components/ongoing-game-panel/widgets/player-info-card/PlayerInfoCardHeader.vue)：玩家头像和名称均点击跳转 `navigateToSummonerByPuuid(puuid)`；匿名/空 PUUID 不应反推出真实身份。
- [player-tabs/index.ts](https://github.com/LeagueAkari/LeagueAkari/blob/main/src/renderer/src-main-window/shards/player-tabs/index.ts)：详情以 `sgpServerId + PUUID` 标识，重复打开复用相同玩家页，保留可选英雄/位置筛选；空 PUUID 明确返回。
- [winer window.rs](https://github.com/sunerpy/winer/blob/main/app/src-tauri/src/window.rs)：已核对部分实现是主窗与托盘生命周期，并不能作为“双弹窗已实现”的证据。

## 海斗分与公开位次的接入结论

### Hexdata

[官方海斗查分页](https://hexdata.com.cn/matchmaking-position)明确说明登录后查询本人海斗分、最近战绩和同局玩家；这是 Hexdata 自己的估计值，并非游戏公开的官方匹配分。[方法文章](https://hexdata.com.cn/articles/matchmaking-position)公开理论思路，并明确未披露采集流程、求解实现、超参数及阈值。

本轮仍未找到可核对的公开第三方接入文档。国服功能适用许可与数据提供方 API 接入是两件事；不抓取用户 Cookie、不绕登录、不伪造 Hexdata 海斗分，也不把其他来源的值写入它的 score。继续提供官方查分页入口。

用户在本轮确认“目前只有国服使用许可”，尚不包含 Hexdata 第三方 API 接入，因而该数值分仍是明确的外部依赖。

### AramHex

[官方查分页](https://aramhex.com/rank/)说明这是近 30 天采集对局推算的**区内前百分位**，各区分开，不是官方段位。[公开 rank.py](https://github.com/czgreat/aramhex/blob/main/lolhex/rank.py)有 `GET https://aramhex.com/api/rank?id=名字%23编号` 客户端逻辑；[cloud.py](https://github.com/czgreat/aramhex/blob/main/lolhex/cloud.py)提供 enabled/api/as_of 配置；[测试](https://github.com/czgreat/aramhex/blob/main/tests/test_cloud_rank.py)描述 `as_of`、`results[].region/top/band/games` 等格式。源码注释明确只返回前百分比、分组、近 30 天场数和日期，**不返回数值分数**。

2026-10-29 本机只读真实请求（未打印名字、编号、PUUID 或客户端凭证）：

| 请求 | 结果 |
|---|---|
| `https://aramhex.com/config.json` | HTTP 200，rank.enabled=true，api 为上述固定地址，数据日期 2026-10-26 |
| rank API，以本项目真实 `LeagueAssistantCN/0.1` 身份查询当前国服账号 | HTTP 403，错误为“请在 AramHex 软件里查询” |

因此，开源客户端展示的调用方式不代表第三方已经获准调用。当前 `aramhex.status=needs-authorization`，percentile、场数和日期保持 null；不冒用官方软件 User-Agent / X-AramHex 标记重试。未来取得第三方接入方式后，位次需单独标明“AramHex 区内前 X%”，不能叫 Hexdata 海斗分、不能反推一个数值分，也不能擅自改变统计分组。

本项目 provider 现保留两种来源的独立状态；缓存、并发去重、限流退避、关闭开关、大区匹配和拒绝异常单位已有测试。**这属于协议适配与失败状态完成，不是查分服务接通成功。**

### 其他助手分数

[winer 评分说明](https://github.com/sunerpy/winer/blob/main/docs/site/rating.md)讲的是近期表现分和单局评分，不是 Hexdata 海斗分；不能为了弹窗有数字而将其替代海斗分。Akari 的玩家卡片和评分标签也不能证明它提供了 Hexdata 个人分的接口。
