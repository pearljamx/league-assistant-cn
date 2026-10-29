# Project Notes

## Project type

国服英雄联盟桌面助手；Electron、Vue 3、TypeScript、electron-vite；npm。

## Entry files

主进程 src/main/index.ts；预加载 src/preload/index.ts；界面 src/renderer/src/App.vue。

## Run / build / test

在 E:\英雄联盟助手 运行 npm ci、npm run dev、npm run typecheck、npm test、npm run build:win。

## Decisions

- 各模式基础版优先，后续海克斯统计及 OCR。
- 腾讯 101 作为国服统计来源，AramHex 为海克斯分层数据来源。
- Hexdata 海斗分直连依赖正式接入资料；本地状态不可假装成功。
- 用户配置、缓存和认证不要提交 GitHub。

## 入口与模块

- src/main/client.ts / discovery.ts：国服发现、WAMP 事件、轮询、选人及自动接受。
- src/main/providers：腾讯 101、AramHex 校验快照、SGP/LCU 战绩、Hexdata 待授权入口。
- src/main/recognition.ts + worker/recognizer.py：JSON-lines 本地子进程，前台游戏窗口截图，F6 / 自动识别。
- src/main/runes.ts：只写助手管理的符文页，满槽拒绝覆盖。
- scripts/network.mjs：开发用系统回环代理适配；生产公开网络使用 Electron net.fetch。

## Verification - 2026-10-29

- npm ci 成功，审计 0 漏洞；npm test 56 项（9 个文件），npm run ocr:test 13 项；类型检查通过。
- 国服 HN1 大厅、当前段位、本人 Riot ID、战绩两页各 20 场且无重复、单局 10 人详情通过只读实测。
- 腾讯目录 173 英雄、878 装备、5 符文树；峡谷与海克斯出装/加点通过；AramHex 四组、173 英雄及英雄 202 的 118 个强化组合通过。
- 开发和打包后程序桌面冒烟通过：连接、推荐、九项符文预览、118 行强化排行、拒绝越界设置，无页面异常。
- OCR 完整组件健康检查与 1080p/1440p/4K 合成样本通过；公开旧版本截图仅验证文字识别，详情见 docs/verification.md。
- dist 包含完整 Setup.exe、Portable.exe 与 SHA256SUMS，未配置代码签名。
- 便携启动器通过 npm run test:portable：真实国服连接、OCR 子进程与显示器列表成功。Playwright 的 Electron 启动入口不能直接跟踪 NSIS 启动器，改用临时本机调试端口连接其 Electron 子进程；发布的正常启动不开放调试端口。
- 自动接受读取确认状态后再次核对开关/账号/阶段/连接；符文应用同时核对已预览的 9 个 ID，数据更新时要求重新预览。
- scripts/smoke-installer.ps1 已验证完整安装、安装后 OCR、卸载及用户 settings.json 保留；有正式安装或同名快捷方式时拒绝覆盖测试。
- 实测 userData 为 %APPDATA%\英雄联盟助手，local 下保存设置/缓存；Electron 使用中文 productName，不能根据 package.name 推断路径。
- 本地 Git main 已初始化并保存实现；构建产物和截图被忽略，源码、测试与项目记忆进入 Git。
- 追加验证：同区公开玩家 Riot ID 搜索与原战绩 PUUID 匹配，读取 SGP 20 场、私有场次 0、单局详情 10 人；日志不输出名字与 PUUID。
- 追加修复：选人轮询按请求版本、阶段、账号和连接核对；实时换人事件使旧响应失效。退出账号立即清空身份，旧身份轮询不能覆盖新账号事件。
- 追加修复：战绩缓存读取后与返回前均核对账号/大区；不完整的单局缓存不能把详情查询错误变成成功。
- npm run dev 实际启动 localhost:5173 和“英雄联盟助手”桌面窗口，页面返回 200；测试后关闭开发服务。
- 全量需求证据见 docs/acceptance-matrix.md；实战与 Hexdata 保持未完成，公开发布已完成，见下节。
- OCR 追加修复：90×60 缩略平均差会漏掉细微刷新，改为完整 BGR 字节一致才复用；识别失败/无效屏幕清空缓存，移动窗口即使画面一致也更新位置。
- OCR 协议的 changed 事件携带 requestId 与 gameWindow；主进程按当前请求和 epoch 接受；旧进程迟到退出不再拒绝新请求。成功重试清除旧退避。
- 新帧处理中清掉旧数字，悬浮窗显示等待提示。合成 4K 缓存约 12 MB，像素转换/比较平均约 33 ms；不是游戏端到端延迟或识别准确率证明。
- 手动比较现为主窗口独立快照，不写共享识别状态；后台 idle 不清空，换英雄/分组清空，按钮返回最新识别，悬浮窗始终实时。迟到比较结果按上下文丢弃。
- npm run test:renderer 的 5 项隔离界面场景通过，包含九项符文参数传递；模拟服务无网络/LCU 写入，不能代替真实符文应用验收。Vue 响应式数组/对象先复制为普通数据再跨桥接。
- npm run licenses:collect 离线收录 Python 3.12.4、26 个锁定包、4 组本机库，共 68 份许可文件及 SHA-256 索引，build:win 自动附带。Conda 下显式固定 ffi/bzip2/xz DLL 并校验原始摘要。
- 本次重建后安装/卸载再次通过：已安装的 OCR 正常，68 份许可摘要全部一致，用户配置原文摘要保持；桌面包真实连接 TENCENT，大厅、推荐、九项符文预览、118 行榜单无页面异常。最终两个 EXE 摘要见 docs/verification.md。
- 最终便携启动器再次通过：真实 TENCENT 连接、OCR 就绪、显示器列表含自动项与实际显示器；测试实例已关闭。余下实战场景与 Hexdata 资料需要用户场景或外部条件变化，不能用重复通过的本地测试代替；公开范围已确认并完成发布。

## 发布状态

GitHub 登录有效，先前网络错误来自终端未使用系统代理。2026-10-29 用户回答已取得国服适用许可，明确授权继续发布完整版本；该确认覆盖此前发布范围问题，不再次询问。许可文件未提供，不宣称独立核验、官方背书或 Hexdata 已接入。

公开仓库 https://github.com/pearljamx/league-assistant-cn 已创建，main 已推送。完整 Windows 包基于 329e119 的构建输入重新生成，后续仅更新发布记录；CI 运行 40789468031。安装/卸载复验通过，安装后的 OCR 与 68 份许可验证成功、用户配置保持。

GitHub Windows CI 40789468031 已 success，冷环境完整执行 Node/Python 安装、类型/单元测试、OCR/Windows 双包构建和隔离界面场景。后续只改发布记录的提交使用 `[skip ci]`，不重复构建相同运行代码。

完整功能预发布已公开：https://github.com/pearljamx/league-assistant-cn/releases/tag/v0.1.0，Release ID 427313781，prerelease=true、draft=false，标签 d6e94b6。3 个附件服务端摘要与本地一致，匿名下载 SHA256SUMS 内容一致，两个 EXE 的公开 HEAD 为 200；未完整下载两个 EXE 重跑。源码 ZIP 96 文件与标签一致，仅 2 个 PS1 按声明 CRLF 转换。实际凭据/截图/缓存未上传。正式海斗分接入与实战验收保持待办，不能把公开发布当作整个方案验收完成。

## 当前实战验收条件 - 2026-10-29

只读观察实际 TENCENT 客户端 60 秒，始终为 Lobby；海克斯模式与 queueId=2400 读取成功，未出现选人、英雄或备选席。临时测试配置 autoAccept=false，全程没有客户端写入。观察进程已正常结束，不视为仍在后台等待。已异步询问用户是否方便自行进入海克斯对局，未获得回答前不代为排队；符文应用和当前弹窗/跨屏/缩放均未通过实战验收。Hexdata 正式接入资料仍未取得。

## v0.2.0 双弹窗与玩家资料

- 用户要求两个独立小窗，并明确快速选择要“直接替换”。main/companions.ts 管理生命周期，CompanionApp.vue 分 picker/info 路由；浏览和真实换用分开，游戏开始/断线收起。
- Client.getChampionChoices/chooseChampion 只允许当前备选席或本人进行中的 pick action；二次新会话与阶段/账号重核，不自动锁定。真实写操作仍未验收。
- HistoryWorkspace.vue 替换战绩页；历史/实时双视图、公开玩家点击、段位/常用英雄/近期表现。LiveGameProvider 读取本机 2999 与公开客户端数据，只按完整身份合并，隐藏玩家不查询。
- 查分适配：Hexdata 无公开第三方文档，AramHex config200但查分403“请在 AramHex 软件里查询”。保留独立 needs-authorization，不冒用官方标记、不造数值分；证据 docs/companion-reference.md。已询问用户具体 API 文档，尚待答复。
- 用户随后明确回复“目前只有国服使用许可”，无 Hexdata 第三方 API 接入资料；数值分保持待接入，不再重复询问同项已回答的问题。
- npm test 98 项通过；双窗8、战绩6、原界面5项隔离场景通过。实际桌面包验证双窗可见、浏览202跨窗同步、收起/重开、实时页大厅idle；0真实客户端写入。后来只读大厅的实际queueId=3270，mode仍hex；不要把固定queueId当所有版本唯一标识。
- 实际用户旧程序正在运行，自动测试使用单独 --user-data-dir，不能为测试终止用户实例。测试脚本按 package.version 选择便携包，校验文件只列当前版本双包，避免旧版混入。
- 最终运行代码8fa4121的GitHub Windows CI 40815051966全流程通过；前一轮小屏测试修正也已在40814448884通过。两个EXE的最终摘要见docs/verification.md，真实便携启动及OCR就绪通过；有已有正式安装，本轮不覆盖执行安装/卸载烟测。
- v0.2.0已公开：https://github.com/pearljamx/league-assistant-cn/releases/tag/v0.2.0，Release ID427438841，标签最终e1fb30c（后续不移动）。三附件服务端SHA-256一致，公开SHA256SUMS下载一致，两个EXE公开HEAD200，源码ZIP110文件与标签一致（PS1按声明CRLF）。旧v0.1.0保留，用户原有测试目录未改动。实际换英雄/十人对局/OCR实战与海斗分仍待验收/接入。

## v0.3.0 Akari 式改版进度

- ① 2026-10-29 完成：主窗 `titleBarStyle: hidden` + 原生 `titleBarOverlay`（右侧预留 150px 给系统按钮）；窄侧栏 SideNav（战绩/对局/数据/自动化，底部双弹窗、设置、连接头像）与 TitleBar（页面名、账号、Ctrl+K 召唤师搜索、自动接受开关、阶段）。
- App.vue 拆分：store.ts 为主窗共享状态（设置、目录、英雄跟随、打开玩家请求）；OverlayApp.vue 独立悬浮窗；views/ChampionDataView（英雄榜 + 出装符文 / 海克斯强化标签，合并原总览/推荐/排行）、LiveGameView（选人/对局双列卡片、近期同模式胜率、备选席）、AutomationView（自动接受）。页面用 KeepAlive 保持状态。
- 设置改为 SettingsModal 分类弹窗；关闭主窗口 closeAction（ask/tray/quit，默认 ask），CloseConfirm 可记住；tray.ts 托盘菜单（显示、自动接受、双弹窗、退出），Windows session-end 直接退出。
- 搜索历史仅存本窗口 localStorage（按大区过滤，可清空），失败忽略。
- 旧 style.css 的 `.app-shell{display:flex}` 会覆盖 shell.css 的 grid，导致主区只有内容宽；全局 CSS 新旧同名选择器需去重。
- 冒烟脚本主窗选择改为 URL 无 hash（原先只排除 #overlay，会误选 #champion-info）。验证：typecheck、98 单测、renderer 5 / history 6 / companions 8 隔离场景、真实客户端只读桌面冒烟（173 英雄、12 装备行、九项符文预览未应用、118 强化行）。
- 2026-10-29 用户追加：弹窗太多内容、要参考 Akari、客户端刚打开就要有弹窗。已改为 Mini 小窗（#champion-picker，340×420，None/Lobby/匹配/确认/选人/结束均显示，游戏中/断线隐藏）+ 英雄信息窗（#champion-info，360×600，仅 ChampSelect）。renderer/src/companion/ 下 useCompanion + MiniWindow + HeroInfoWindow；点头像只浏览，“换用”按钮才写入。
- 小窗贴靠：client-window.ts 用 user32 FindWindowW("RCLIENT")+GetWindowRect 只读取客户端窗口矩形，screenToDipRect 换算；alignToClient 右侧优先、一侧不够时 Mini 右/信息窗左，否则退回右上角；用户 will-move 拖动后不再自动贴靠。实测 2048×1232 DIP 工作区、居中 1280×720 客户端时 Mini 在 x=1672。
- 主进程 TDZ 教训：ready-to-show 可能在 await loadURL 期间触发，被提前调用的函数里不能引用后面才初始化的 const；真实桌面冒烟会因主进程 Error 对话框卡在 electron.launch 超时。
- 海斗分：Hexdata 官网仅登录后查询、无公开第三方 API（合作需经其 QQ 群）。“官方查分”改为助手内独立窗口（partition persist:hexdata、无 preload、拒绝权限、仅允许 *.hexdata.com.cn 导航，其他链接交系统浏览器），实测 window.assistant 为 undefined。不读取其 Cookie/页面数据，不生成替代分。
- 2026-10-29 实战反馈：海克斯新选人是“二选一英雄卡片”，Mini 窗原先读不到，并报“数据格式无法解析”。根因①：LCU 写接口（bench swap、PATCH action、ready-check accept）成功时返回 204 空体，jsonRequest 强行 JSON.parse 报错，现空体返回 undefined。根因②：卡片属于 subset pick（session.allowSubsetChampionPicks + timer.phase=BAN_PICK），列表来自 /lol-lobby-team-builder/champ-select/v1/subset-champion-list（参考 Akari，其注释称规则抄自客户端）。无英雄时点卡片 PATCH 本人未完成 pick action {completed:true}；已选后同阶段只可 bench swap 本次卡片中的英雄。
- 用户改为“点头像就直接换”：Mini 窗左键即写入（卡片选用/备选席交换/峡谷预选不锁定），右键只查看；不可用头像 aria-disabled 且 choose 内再核对。选人阶段每秒刷新可选项，阶段变化清除旧错误。
- 真实卡片阶段尚未用新代码实测（当时客户端在大厅）。scripts/inspect-champ-select.ts（npm run inspect:champ-select）只读打印脱敏会话结构。用户的 npm run dev 实例运行时桌面冒烟会因单实例锁直接退出，不得为测试关闭用户实例；主进程改动需用户重启 dev 才生效。
- 2026-10-29 用户反馈：卡片不要单独一步，要和备选席（含队友留下的）合并，点头像直接拿；小窗可拖边缘调大小；进入选人要有显示海克斯推荐的额外弹窗。实现：ChampionChoices 增加 cards/waiting；卡片阶段 waiting=备选席中不在本人卡片内的英雄（客户端规则：BAN_PICK 只能拿本人卡片，FINALIZATION 才能换队友留下的），Mini 列表 cards→可换→waiting，当前英雄不列出。
- 小窗 resizable + min/max；“resized”后把尺寸写入 settings.companionSize（validateSettings 限 280–1200×300–1400，渲染层 settings-save 的 strict schema 不接受该字段）。贴靠改为两窗同侧：并排放不下时上下叠放（Mini 上、推荐窗下），整体上移以完整显示；按窗当前尺寸计算。2048×1232 工作区、居中客户端时两窗叠放在右侧 x=1672。
- 英雄推荐窗（原英雄信息窗）：海克斯模式默认“海克斯”标签，前 10 个强化 + shared/augment-grade.ts 评级（非低样本按平滑胜率排名，位次 ≤10% S、≤30% A、≤60% B、≤85% C，其余 D，可定级少于 3 个时不定级）；无英雄时对比卡片英雄胜率与前 3 个可定级强化。
- 本轮真实客户端未复测：用户的 npm run dev（electron pid 30476）在运行，桌面冒烟会被单实例锁拦下。
- 2026-10-29 用户反馈“推荐窗未出现”，并要求去掉“点击头像直接换用 · 右键只查看”和“已选用 X · 以客户端结果为准”两句提示（已删）。只读枚举用户 dev 实例窗口：推荐窗仍是启动时矩形，说明选人阶段从未进入显示流程；隔离实例（--user-data-dir、ASSISTANT_TEST_HOOKS=1 模拟阶段，构建版与 dev 页面均试）无法复现。改为：updateCompanionWindows 先用上次已知客户端位置同步排布并立即 showInactive，再异步读取客户端位置微调，显示不再依赖异步结果；did-finish-load 作为备用就绪信号；尺寸取保存值/默认值（测量值在 125% 缩放下取整会越排越大）。开发版在 local/companion-trace.log 记录最近 120 条显示决策（只有阶段与可见性）。
- 真实选人阶段的推荐窗仍需用户复测；若仍不出现，请用户发送 %APPDATA%\英雄联盟助手\local\companion-trace.log。
- ② 2026-10-29 完成：store 的 playerTabs/activeTab（"self" 固定，最多 10 个，换账号或大区清空）；PlayerTabsView 用 v-show 保留各标签实例，关闭才卸载；PlayerTab（原 HistoryWorkspace，git mv）按标签各自加载战绩/段位/评分，筛选只作用于已加载对局（模式按 queueId 再按 mode 判定）。TitleBar 在战绩页显示标签条（中键或 × 关闭）。
- main/players.ts PlayerStore：备注 player-notes-v1（标签+备注均空即删除）；遇到记录 encounters-v1:{platform}:{owner}，只在 IPC history 返回本人战绩且账号/大区未变时记录，跳过私密/重开/无本人对局与匿名 PUUID，每人最多 30 场、最多 3000 人，读改写串行。IPC 用 zod 校验 PUUID、名字 ≤64、备注 ≤200、标签枚举。
- 测试：tests/players.test.ts；history 隔离场景 11 项（筛选、新标签与遇到记录、标记保存、复用标签、设置列出标记、关闭后台标签、切号清空且迟到响应无效）。真实客户端隔离实例只读：本人 20 场、144 名公开玩家，同局最多的玩家遇到记录 16 场（均为队友），新标签筛选与遇到行正常。多标签下冒烟断言需限定 .player-tab.active（隐藏标签仍在 DOM）。
- 2026-10-29 用户反馈战绩页不直观、看不到所有人信息，要求参考 Akari。参照其 MatchCardOverview（折叠卡：英雄+等级、KDA/参团、伤害占比、CS、装备、强化，右侧双方各 5 人始终可见）与 TeamTable（展开按队伍分表）。新增 components/player/MatchCard.vue；normalizeMatch 增读 champLevel、totalDamageTaken、playerAugment1-6（实测国服海克斯对局均有）；强化名称/品质来自 AramHex 目录（store.loadAugmentNames，只读一次，无图标）；召唤师技能暂无图标目录未显示。窄窗口隐藏装备列但始终显示 10 人。真实只读实例：展开后 2 张队伍表、10 行。
- 注意：父组件的 scoped 样式会作用到子组件根元素，迁移卡片后须删掉 PlayerTab 中旧的 .hw-match 规则。
- 2026-10-29 改名 PEARLJAM HEX：productName/窗口标题/托盘/安装包名 PearljamHex-*，appId 不变；index.ts 在未传 --user-data-dir 时把 userData 固定为 %APPDATA%\英雄联盟助手，保留旧设置。品牌：resources/brand/pearljam-hex.svg（原创六边形金框 + 虹彩珍珠），scripts/build-brand.mjs 用 Electron 离屏渲染（paint 事件，capturePage 会 UnknownVizError）生成 1024/512 PNG 与 16–256 ICO；BrandMark.vue（每实例独立渐变 id）、BrandSplash.vue（约 0.9 秒、不拦截点击）。smoke-installer.ps1 保持 ASCII，旧产品名用字符码拼出，已有安装/快捷方式拒绝覆盖检查覆盖新旧名称。
- 太农海克斯助手的数据是 douhunwiki.cn（HTTP）转抓的 aramgg/Lolalytics，已被 aramgg 官方 API 取代，未接入其数据或代码。
- aramgg 接入：providers/aramgg.ts，基址 https://data.dtodo.cn/api/v1/zh-CN，x-api-key 头；config.json 免费（30 分钟 TTL），champions/{id}.json 2 额度、augments.json 1 额度；额度来自 x-credits-remaining/x-credits-daily。缓存键 aramgg-v1:champion:{id}/augments 按 dataVersion 失效，进行中请求去重，失败回退 stale 缓存。只保留合法数值与 https://cdn.dtodo.cn/ 图标。401/429/无 Key 分别给出明确提示。secrets.ts 用 safeStorage 存 local/aramgg-key.bin，状态只返回末 4 位。http.ts 新增 publicJson（仅 HTTPS、系统代理）。实测 2026-10-29：config 16.21.3，英雄 202 有 108 个强化（106 个有胜率）、5 组三强化、3 个流派。
- 只改 hexSource/closeAction 的设置保存不再调用 recognition.settingsChanged()，切换来源保留当前三选一识别；隔离 fixture 同步该行为。
- 隔离测试：fixture 设 hexSource 为 aramhex 保留原 AramHex 断言，另有合成 aramgg 数据（明确标注“隔离测试数据”）验证排序、T 分级、不足 255 留空、来源切换。test:desktop 用真实用户目录且会被用户 dev 实例的单实例锁拦下，本轮未运行。
