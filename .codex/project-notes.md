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
- 2026-10-29 公共数据：aramgg-snapshot.ts（清单/文件格式、校验、planChampions、runSync，可注入 fetch 与读写）供 scripts/sync-aramgg.ts（tsx，Key 只读环境变量）与客户端共用；aramgg-public.ts 的 PublicAramggProvider（清单 30 分钟 TTL、按英雄缓存 {sha256, raw}、不接受比已知更旧的镜像清单）与 AramggSources（公共 → 个人 Key）；main 启动与每 30 分钟 refresh。工作流 ubuntu、npm ci --ignore-scripts，孤立分支 aramgg-data 每次强推单提交；镜像用 aws s3（S3 兼容、virtual 寻址、checksum when_required），先文件后清单。免费 200/天，全量约 348，按 x-credits-remaining 停在余量 6 前，429 立即停。aramgg 条款有“不得绕过访问控制、转售服务”，已告知用户，由其判断。
- 隔离测试：fixture 设 hexSource 为 aramhex 保留原 AramHex 断言，另有合成 aramgg 数据（明确标注“隔离测试数据”）验证排序、T 分级、不足 255 留空、来源切换。test:desktop 用真实用户目录且会被用户 dev 实例的单实例锁拦下，本轮未运行。
- 2026-10-29 用户提供原画（漫画风猫 + パール・ジャム 字样），要求以其为原型做图标和界面元素。原画存 resources/brand/pearljam-art.jpg；scripts/build-brand.mjs 改为在离屏页面用 canvas 从原画裁猫脸（大图裁 [450,300,560]，≤48px 裁 [500,400,420] 并加粗描边），生成 icon.png/ico、pearljam-hex-1024.png、src/renderer/src/assets/brand-mark(-small).png 与压缩原画 brand-art.jpg。BrandMark 改为图片；theme.css 品牌色改为原画的粉 #f07ab8 / 紫 #9a55e0 / 金 #f2c766 与 --screentone 网点；启动画面以原画为背景加原创“ゴゴゴ”拟声字；关于页横幅、侧栏与小窗标题栏用网点和紫色光晕。旧的 pearljam-hex.svg 已不再使用。截图验证：Playwright page.screenshot 会卡在等待字体，用 CDP Page.captureScreenshot；启动画面 1.1 秒后移除，需克隆节点再截。
- 2026-10-29 公共数据同步支持多个 Key：仓库 Secret ARAMGG_API_KEY 与 ARAMGG_API_KEY_2（或 ARAMGG_API_KEYS），按顺序使用，429/401 停用该 Key 换下一个，日志只写序号。用户已存两个 Key 并确认这样使用（曾提示可能违反 aramgg 关于绕过访问控制的条款，用户自行决定）。首次同步 173 个英雄全部完成（16.21.3）。
- ③ 2026-10-29：shared/live-tags.ts（streakOf 同模式 ≥3 连胜/连败；premadeGroups 同队且近期 ≥2 局同队，并查集传递合并）。LiveGameView 的近期战绩改存 history（全部有效对局），另读本机标记和遇到记录（本人不显示遇到过）。
- ④ 2026-10-29：main/auto-select.ts 纯计划函数 planAutoSelect + client.ts 执行器（会话事件后 400ms 去抖；锁定前按 autoHoverAt 计时满 lockDelayMs；每步按 gameId+步骤只尝试一次；离开选人清空）。Settings.autoSelect 全默认关，validateSettings 去重、最多 10 个、延时 1–20 秒。峡谷读 pickable/bannable-champion-ids；大乱斗卡片仅在 lock 打开时 PATCH completed:true；备选席只换优先级更高的。
- ⑤ 2026-10-29：main/toolkit.ts（重随 POST my-selection/reroll，次数来自 rerollPoints；kill-and-restart-ux；zoom-scale×1280×720 后 client-window.ts 的 SetWindowPos 调整窗口；/lol-chat/v1/friends 与 /lol-spectator/v1/spectate/launch；/lol-chat/v1/me 读写状态与签名）。ToolkitView 侧栏“工具”。悬浮窗用 augment-grade 的 gradeFromRank / shouldConsiderRefresh 显示评级与刷新提示。这些写接口参考 Akari，真实客户端尚未验收。
- Vue 模板里直接写 `() => unwrap(api.x())` 会被 vue-tsc 当作可能的 ref（报 api.value 不存在），把处理函数移到 script。
- 2026-10-29 实战反馈：极地大乱斗英雄推荐窗出装全空。原因是腾讯 101 没有普通大乱斗出装接口（有意不混用模式）。核实 aramgg 流派出装来自 iesdev HOWLING_ABYSS_ARAM，队列 450（普通极地大乱斗），因此 recommendation IPC 在 aram 模式默认用 aramgg（providers/aramgg-recommend.ts：第一套流派，鞋子单列，按先点满 5 级算主升，召唤师技能 spells；无符文并标明），失败再回退腾讯。海克斯模式里的 aramgg 流派同样是队列 450 数据，界面已标注。
- 版本号：客户端显示 26.21（2026 年命名）= 内部/Data Dragon 16.21；aramgg 的 16.21.3 即当前最新补丁的第 3 次数据发布，不是旧数据。
- 2026-10-29 实战反馈：英雄推荐窗没有符文、出装只有三件。aramgg 英雄详情没有符文，只有原始出装文件 /data/builds/HOWLING_ABYSS_ARAM/{id}.json（1 额度，队列 450）含每个符文位置的单项选取率；详情里的 itemExtensions 是按核心三件逐件累加的补装。现在：normalizeChampion 生成 builds[].full（核心 + 最深补装，最多 6 件）；同步每个英雄多读原始出装取 runeStats（每英雄 3 额度，manifest 条目 content=2，旧格式 content 缺省按 1 重新同步，parseManifest 必须保留 content）；aramgg-recommend.ts 的 runePageFromStats 用 catalog.styles 拼整页（基石→主系三行→副系两行合计最高→三碎片），winRate 为空，只显示基石选取率。极地大乱斗直接用；海克斯模式腾讯无符文时补 aramgg 页并在方案名标注“aramgg 极地大乱斗”。
- 2026-10-29 用户要求两个小窗记住上次位置。Settings.companionPosition（DIP，主进程在窗口 moved 且本次 will-move 过时写入）；applyLayout 优先用 savedPosition（左上角需在某屏工作区内，否则退回贴靠）；设置“恢复自动贴靠”发送 companionPosition:null（渲染层只允许 null）。repositionCompanions 改为函数声明避免 TDZ。隔离实例验证：拖到 (300,200) 后重启仍在 (300,200)。
- 2026-10-30 实时对局页按 LeagueAkari OngoingGamePanel 改版（对照其 OngoingGameTeam/PlayerInfoCard 源码）：两队上下排列，每队一行 5 张卡（窗口放不下时换行）；卡片为头像+等级、Riot ID、段位、英雄胜率、近期同模式胜率/KDA/本局 KDA、标签、常用英雄、独立滚动的近期战绩，预组队用彩色边框与角标。卡片改为 article，只有头部是打开玩家的按钮；战绩行暂不可点。每位公开玩家新增一次 getRanked，失败显示“段位暂不可用”，不当作未定级。隔离验证 npm run test:live（FIXTURE_LIVE_FULL=1 合成十人）；真实对局未复测。
- 2026-10-30 用户要求推送并发布：v0.3.0 预发布 https://github.com/pearljamx/league-assistant-cn/releases/tag/v0.3.0，Release ID 428939062，标签 84975d2，CI 41045158378 通过。附件构建自 615f67b（到标签仅多 smoke-portable 等待时间）。便携启动通过但当时客户端未运行（disconnected）；安装烟测因已有正式安装主动拒绝，未执行。便携版首启解压约 39 秒，超过脚本原 30 秒上限，已放宽到 2 分钟，打包程序本身无问题。

## 2026-11-02 Mini 窗匹配/狂暴/海斗分

- 用户要求参考 Akari 给 Mini 窗加自动匹配并改布局、接入海斗分、选人弹窗加“狂暴”循环换英雄。
- automation.ts 抽出通用 PhaseAction（阶段内延时执行一次，可回调计划时间），AutoAccept 继承；client.ts 用它实现 autoMatch（Lobby，key=pid:puuid:lobbyEpoch；从 Matchmaking/ReadyCheck 回大厅 lobbyEligible=false；在大厅里打开开关算新一轮）与 playAgain（EndOfGame 2 秒后 POST /lol-lobby/v2/play-again）。手动 matchmaking(start/cancel/skip)：start 先读 /lol-lobby/v2/lobby 校验房主/非自定义/canStartActivity，再 POST；cancel 为 DELETE /lol-lobby/v2/lobby/matchmaking/search。tick 中 Lobby 读 lobby → state.lobby，Matchmaking 读 /lol-matchmaking/v1/search → state.search；state.queueName 取 gameflow session 的 queue.description。
- 狂暴：client.setBerserk，每 1.5 秒 getChampionChoices，kind 为 bench 时按 matchmaking.ts 的 nextBerserkChampion（首次出现顺序循环）调用 chooseChampion（沿用两次读会话校验）；卡片未选时不替用户选；进行中暂停自动抢备选席，Mini 头像禁用。
- 海斗分调查：hexdata 前端调用 POST https://box.hexdata.com.cn/v1/public/match-report（登录 Bearer/Cookie），不带登录请求返回 403 web_lookup_only“仅支持在官网查询，不支持机器人或脚本调用”。据此不自动查询；open 新增 hexdata-copy（主进程剪贴板写本人 Riot ID 后打开官方窗），hexdata-score-save 把手动分数存 storage.cache 键 hexdata-manual-v1:{platform}:{puuid}，rating IPC 查询本人时附 manual。
- Mini 新布局：状态卡（横排徽标 + 队列名 + 阶段 + 人数/房主或排队计时/预计）、全宽开始/取消匹配按钮、自动匹配倒计时与“本次跳过”、三格开关（自动接受/自动匹配/自动回房）、海斗分行（记录/查分）。主窗自动化页同步加自动匹配、匹配延迟、自动回房。
- 注意：.berserk-button:hover 优先级高于 .on，需写 :not(.on):hover；fixture 的 updatedAt 为空，排队计时按收到 timeInQueue 的本机时间补齐。
- 验证：typecheck；vitest 161 项（新增 tests/matchmaking.test.ts 13 项）；test:companions 15 项、test:renderer、test:history、test:live 的 errors 均为空。未在真实客户端做写入测试；自动匹配/回房/狂暴待用户实战验收。

## 2026-11-02 跳过点赞/发战绩/平衡调整/在线更新

- 用户：结算后自动跳过、不要点赞；要选人发战绩、大乱斗平衡调整提示、在线更新。
- 跳过点赞：client.skipHonor（PhaseAction PreEndOfGame，1 秒，honorEpoch），先 POST /lol-honor-v2/v1/honor-player {honorCategory:"OPT_OUT",summonerId:0}，失败改 POST /lol-honor/v1/honor {honorType:"OPT_OUT"}；两个接口均参考 Akari/社区资料，未在真实客户端验证。
- 发战绩：main/team-stats.ts（summarize 同模式有效对局、statsLine）；IPC team-stats(send|copy)：选人取 client.selection 队友（去掉本人），对局取 liveGame 双方（友/敌），history.history(puuid,0) 汇总，返回前核对账号/大区/阶段/会话。client.sendChampSelectChat 找 type=championSelect 会话逐行 POST，行间 400ms，每行发送前（等待之后）核对阶段——测试抓到先核对后等待会在离开选人后多发一条。
- 平衡：providers/aram-balance.ts 拉 wiki 原始 Lua，先去注释，按两空格缩进的顶层条目取 id 与 ["aram"] 表；实测 134 个英雄有调整（202 为伤害 -5% 承伤 +5%）。shared/aram-balance.ts 转显示（承伤降低算增强、急速为加减值），BalanceChips.vue 用于 Mini 当前英雄、推荐窗标题；Mini 备选头像右上 ▲▼ 与 tooltip。
- 更新：main/updater.ts，GitHub API releases?per_page=10，latestRelease 取最高版本非草稿，主机白名单 api.github.com/github.com/objects.githubusercontent.com/release-assets.githubusercontent.com；下载流式写 .part 同时 SHA-256，与 SHA256SUMS 不一致删除。启动 20 秒后与每 6 小时自动检查（autoCheckUpdate 默认开），启动时删除 local/updates。设置 → 关于有检查/下载/重启安装/发布页。实测 v0.3.0 发布可解析出安装包与 SHA256SUMS。现有 v0.3.0 不含更新器，用户需手动装一次含此功能的版本。
- 验证：vitest 170 项（新增 tests/v04-features.test.ts 9 项）；test:companions（新增平衡标签、发战绩）、test:renderer、test:history、test:live 均无错误；设置页更新区截图 artifacts/screenshots/settings-update-fixture.png。真实客户端未做写入测试；静默安装流程未实测（需要真正的新版本发布）。

## 2026-11-02 v0.4.0 发布

- package.json/lock 升到 0.4.0，User-Agent 改 PearljamHex/0.4；npm run build:win 成功，Setup 504e136f…、Portable f2ebb8f1…（完整值见 dist/SHA256SUMS 与 Release）。
- 本机安装尝试：旧 0.3.0 装在 E:\英雄联盟助手\测试\LeagueAssistantCN\PearljamHex。关闭助手后以 `--updated /S --force-run /D=原目录` 和 `/S /D=原目录` 运行均退出码 2；Restart Manager 显示 resourcespp.asar 被 Claude 桌面应用（Electron 会把扫描到的 .asar 当压缩包打开）持有，改名也失败。教训：不要把测试安装放在 Claude 打开的项目目录内。用户决定推送后自行安装。
- 提交 da1a38a 推送 main，标签 v0.4.0，gh release create --prerelease 上传三个附件；服务端 digest 与本地一致，公开 SHA256SUMS 下载 diff 一致。附件构建自 da1a38a 之前的工作区（之后只改 README/记忆，不影响程序）。
- 首轮 Windows CI 41413265707 失败：v04 测试中 sendChampSelectChat 的拒绝在 expect 挂上前发生，被 vitest 判为未处理错误（本机未复现）；6505d1e 改为立即 .then 捕获，重跑 CI 41413804955 通过（success）。

## 2026-11-02 狂暴 0.1 秒 / 官方窗口记录海斗分

- 用户嫌狂暴太慢，要求 0.1 秒一换。原实现每轮 getChampionChoices + chooseChampion 共约 5 个请求，且 championChoiceGuard 的 selectionRevision 会被交换引发的会话事件打断。改为 BERSERK_INTERVAL_MS=100 的快速路径：读一次会话 → choicesFromSession（卡片列表缓存 3 秒）→ 核对阶段/账号/连接/开关 → POST bench/swap；忙时跳过本轮。失败累计 ≥20 且 5 秒无成功才停。测试断言每次交换只有 2 个请求。
- 海斗分：用户再次要求接入。Hexdata 服务端对非官网调用返回 403 web_lookup_only，并需登录与按账号限额，所以仍不代查。新增 providers/hexdata-capture.ts：watchHexdataReports 在官方窗口 webContents.debugger 上只监听 Network.responseReceived/loadingFinished，URL 等于 match-report 且 200 时 getResponseBody；parseMatchReport 严格校验 schema v1、targetEstimate.status=ready、0–10000 分、完整游戏 ID。按 hexdata-capture-v1:{riotId 小写} 保存；是本人时同时写 hexdata-manual-v1:{platform}:{puuid}；广播 assistant:hexdata-score，Mini 与玩家页即时刷新。source=official 显示“官网查询 月/日 · ±误差”。percentileBps 方向不明，未展示。open hexdata-copy 可传其他玩家游戏 ID；玩家页加“官网查分”。
- 用 esbuild 打包临时脚本在真实 Electron 中验证（session.protocol.handle 伪造 hexdata 页面与 match-report，断网）：页面 fetch 200，监听拿到正文并解析出 1623 ±48。
- 验证：vitest 173；test:companions/renderer/history/live 无错误。真实官网与真实客户端未测；用户需在助手内官方窗口登录 Hexdata 后查询一次确认。

## 2026-11-02 v0.4.1 发布

- 版本 0.4.1，build:win 成功：Setup 42b8bf80…、Portable 70e3500b…（完整值见 Release 的 SHA256SUMS）。提交 0b9dc36（功能）+ 4b553c7（版本号）推送，标签 v0.4.1 → 4b553c7，gh release --prerelease 上传三附件；服务端 digest 与本地一致，公开 SHA256SUMS diff 一致。
- 用 updater.latestRelease 解析线上 releases API：最新 0.4.1，安装包与 SHA256SUMS 均识别，compareVersions(0.4.1, 0.4.0)=1，即 0.4.0 用户可在线更新到此版本（真实下载安装流程仍待用户实测）。
- Windows CI 41417288572 success。

## 2026-11-02 v0.4.2 发布

- 修复 438737d + 版本 84f8658，标签 v0.4.2 → 84f8658；Setup e224d5ae…、Portable 94120678…，服务端 digest 与本地一致，公开 SHA256SUMS diff 一致；Windows CI 41465568411 success。
- 发布说明写明 0.4.0/0.4.1 的旧更新器无法在线升级到本版，需手动安装一次。

## 2026-11-03 移植太农的游戏内海克斯标注

- 用户要求查看“太农海斗助手”如何在对局中标注海克斯强度并移植。本机 C:\Users\1208481519\Downloads\太农海克斯助手1.0.zip（GBK 文件名）解压到 scratchpad 新目录静态查看，未运行。它是 .NET 8 WPF 单文件包：自写解析器取出“太农海克斯助手.dll”，用临时目录安装的 ilspycmd 8.2 反编译（README/THIRD_PARTY_NOTICES 已写明经作者授权参考思路、未复制代码或数据，本次保持一致）。
- 太农实现要点：识别默认开启，1 秒轮询（有卡 2 秒、失败 8 秒），只在海克斯模式、游戏内、已知英雄时；EnumWindows 找 League of Legends 进程最大可见窗口（GetWindowRect，不要求前台）CopyFromScreen；ScreenCardRecognizer：4×4 网格 4 采样点深色（亮度<62 且 R<90 G<95 B<105）→ 连通域 → 过滤（面积>1.2%、宽 7.5–24%、高 28–72%、宽高比 0.25–0.7、中心 y 24–68%）→ 前 10 大里挑间距 28–58%、等距、上下对齐的三块；标题区 OCR（Windows.Media.Ocr zh-Hans），失败整卡兜底；匹配=NFKC 归一化后包含即 1.0，否则 1-编辑距离/最长≥0.62。徽章在卡片 top+78% 高度，显示该英雄胜率，按 ≥55/52/50/48 分 S–D 配色；点击穿透工具窗 WS_EX 0x80800A0。InterfaceFirstCardRecognizer 的 LCU 探测默认关闭、未使用。
- 本项目实现：worker/cards.py（numpy + cv2.connectedComponentsWithStats，额外加等距/对齐硬上限 5%）；recognizer.scan 截整个客户区，定位到三张卡→scan_cards（三张卡像素字节签名缓存、changed 事件、标题带 34%–60% 拼图一次 OCR、不匹配整卡兜底且兜底结果与他卡重复则丢弃），否则非 force 直接 idle 不 OCR，force（F6）走 scan_legacy 原整块 OCR。matching.match_title（逐行模糊→≥3 字唯一最长包含→多行拼接）。recognition.ts parseSlots（必须 3 个、0–1 比例、top<bottom），publish slots；index.ts updateOverlay：有 slots 时 screen.screenToDipRect 盖住游戏画面，scanning 时沿用上次方式，否则原右上角面板（setBounds 恢复 340×365）。OverlayApp 徽章模式（hex-* 类名；.card-badge 与 Mini 窗全局样式冲突过）：三张统一数据源（识别出的强化都在 aramgg 数据里才用 aramgg），评级 gradeFromRank/augmentGrades，唯一最佳标“推荐”，卡片上方说明来源与版本/日期。autoRecognize 默认 true + autoRecognizeV2 一次性迁移。
- 性能：RapidOCR 1.4.4 检测把短边放大到 736（limit_type=min），横向长条 141×1038 检测要 1 秒；三条标题带竖向拼接后约 0.3 秒。ONNX 每遇新尺寸首帧慢约 1 秒。
- 验证：Nyx 公开截图 720p/1080p/1440p/4K 四档定位与识别正确（定位 10–53 ms）；反例不误判；ocr:test 22、vitest 180（新增 tests/card-badges.test.ts）、test:renderer/companions/history/live/overlay 全过。真实对局尚未验收（三种稀有度卡片、悬停高亮、刷新、多屏缩放）。
- 顺带更正“关于”页的数据来源：海克斯全球样本来自 aramgg 官方数据 API 经本项目公共数据包分发（原文误写“经太农海克斯助手数据包分发”）。
