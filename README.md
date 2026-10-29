# PEARLJAM HEX · 英雄联盟国服助手

由 PEARLJAM（pearljamx）制作，面向 Windows 10/11 x64 和英雄联盟国服的独立桌面工作台（原名「英雄联盟助手」）。使用 Electron、Vue 3、TypeScript；海克斯三选一在本机用 RapidOCR 识别。

## 功能

- 识别 WeGame 启动的国服客户端；展示账号、段位和对局阶段。
- 自动接受对局，**默认关闭**；阶段变化或断开连接后取消待执行操作。
- 查询本人或同区玩家战绩，查看详情；大区服务优先、客户端窗口补充，失败时明确提示或显示已标注的本地缓存。
- 选人阶段同步队友和备选英雄，分别展示英雄统计胜率与玩家近期同模式胜率。
- 主窗口参考 LeagueAkari 的紧凑布局：窄侧栏（战绩 / 对局 / 数据 / 自动化）、自定义标题栏（Ctrl+K 召唤师搜索、自动接受开关、对局阶段），设置为分类弹窗，关闭时可最小化到托盘。
- 客户端小窗参考 Mini Akari：客户端一打开就出现 Mini 小窗，按阶段只显示模式、匹配/确认状态和自动接受开关；英雄选择时显示当前英雄与备选席，英雄信息窗（出装、符文、强化）只在选人阶段出现。默认贴在客户端旁边，进入游戏自动收起。英雄卡片与备选席（含队友留下的英雄）合并成一个列表：卡片一出现就能点头像直接拿（与在客户端点卡片相同），之后点备选席头像直接换；队友留下的英雄要等所有人选完卡片才能换，期间显示“稍后可换”。峡谷本人回合点头像只预选、不自动锁定；右键头像只在英雄推荐窗查看。英雄推荐窗在海克斯模式默认显示该英雄的强化推荐与 S～D 评级（本英雄强化内的相对排名，低样本不定级，不是获胜概率），拿到英雄前对比各张卡片。两个小窗都可拖动边缘调整大小，尺寸会记住。
- 战绩页参考 LeagueAkari 的玩家标签：“我的战绩”固定在标题栏最前，打开的其他玩家各占一个标签（最多 10 个，可关闭，换账号时清空），各自保留战绩、筛选与展开状态。战绩卡片参考 Akari：折叠时显示本人英雄与等级、KDA 与参团率、伤害占比、经济补刀、装备、海克斯强化，以及双方 10 人；展开后按队伍分表列出每名玩家的等级、强化、KDA、伤害（含占比条）、承受伤害、经济、补刀和装备。战绩可按模式（海克斯 / 极地大乱斗 / 排位 / 峡谷其他）、胜负和英雄筛选，并显示筛选后的场次、胜率与场均 KDA；侧栏显示段位、常用英雄、常一起玩的玩家。“对局”页展示选人与游戏中的双方玩家。只按公开 PUUID 或完整 Riot ID 查询，隐藏身份不推断。
- 遇到过的玩家与玩家标记：读取本人战绩时在本机记录同局的公开玩家，查看他人时显示与你同局的次数、队友/对手及当时胜负；可给玩家打“好队友 / 需留意 / 不想再遇 / 朋友”标签并写备注。两者只保存在本机，可在设置的“玩家标记”中查看、删除或清除本账号的遇到记录。
- 腾讯 101 国服出装、常规符文、技能优先级和逐级加点；符文预览后仅写入助手专用页面。
- 海克斯强化排行默认使用 aramgg 官方数据 API：顺序与 T1～T5 分级来自腾讯国服推荐（经 aramgg 整理），胜率来自 aramgg 客户端上传的全球样本，满 255 场才显示；另有三强化组合与多流派出装。默认读取 PEARLJAM HEX 公共数据（维护者定时从 aramgg 同步，用户无需 Key），先读国内镜像、再读 GitHub，按 SHA-256 校验，启动和每 30 分钟检查更新；部署见 [docs/public-data.md](docs/public-data.md)。可在设置、英雄数据页或英雄推荐窗切换为国服 AramHex 样本（娱乐、中分、前 5% 分组，展示日期、样本与低样本标记）。
- 品牌：以 PEARLJAM 提供的原画（resources/brand/pearljam-art.jpg，猫与漫画效果）为原型——图标是六边形紫粉边框中的猫脸，界面使用原画的紫/粉/金配色与漫画网点，启动画面和“关于”页展示原画。素材由 scripts/build-brand.mjs 从原画生成（应用与托盘图标、界面标志）。
- 海克斯三选一识别、F6 快捷键、手动纠正与穿透点击的悬浮窗。
- Hexdata 数值分目前**没有第三方接口**；Mini 小窗的“官方查分”在助手内打开 Hexdata 官方查分页（独立会话，需自行登录 Hexdata 账号），助手不读取其登录信息或页面数据，也不生成其他分数替代。

完整验收状态见 [docs/verification.md](docs/verification.md)。有实现并不等于已经在真实对局中通过验收。

逐项需求、证据和未完成条件见 [验收对照表](docs/acceptance-matrix.md)。

## 直接使用

从 [GitHub Releases](https://github.com/pearljamx/league-assistant-cn/releases) 下载 Windows x64 安装版（Setup.exe）或便携版（Portable.exe），同时提供 `SHA256SUMS`。完整包自带 OCR，不需要安装 Node.js 或 Python。预览版真实对局尚待验收的项目见[验收记录](docs/verification.md)。

1. 启动 WeGame，登录英雄联盟。
2. 启动助手，等待左下角出现“国服客户端已连接”。
3. 在“自动化”页、标题栏或 Mini 小窗按需开启自动接受；进入选人后在“对局”页查看双方玩家和备选席。
4. 在“英雄数据”选择模式、分路与统计段位，从左侧英雄榜选择英雄，预览符文后再确认应用；海克斯模式可切到“海克斯强化”。
   aramgg 数据默认来自 PEARLJAM HEX 公共数据，无需配置。公共数据不可用或缺少某个英雄时，可在“设置 → 数据与隐私”填写个人 aramgg API Key（[开发者页](https://data.dtodo.cn/developer.html)免费申请）作为后备；都不可用时悬浮窗和英雄推荐窗自动改用国服 AramHex，英雄数据页会提示并可一键切换。
5. 海克斯对局使用无边框或窗口模式；在设置开启自动检测，或在三选一出现时按 F6。认不准时重试或手动选择。

客户端连接后自动出现 Mini 小窗，英雄选择时再出现英雄信息窗；两者默认贴靠客户端窗口（一侧放不下时分放两侧），拖动后保持位置。Mini 窗点击头像直接选用/换用，右键头像只同步英雄信息窗；仅本人的英雄卡片、当前备选席或本人尚未锁定的选人回合可以换。关闭按钮只收起至下一阶段，可在侧栏或设置的“多窗口”重新打开或关闭自动显示。助手不会因此自动发起匹配。

升级时先退出旧版助手，再安装或运行新版；同一用户目录只运行一个助手实例，否则仍可能看到旧界面。

在侧栏“对局”页，选人阶段展示公开阵容，对局开始后展示本机实时 KDA、装备和等级，每 5 秒更新。点击公开玩家后右侧资料和历史列表一起切换，点击“我的战绩”返回。当前没有游戏或接口不可读时显示等待/失败状态。

助手不会发起排队、替你点击强化、自动购买装备或执行技能。识别只检查前台的英雄联盟游戏窗口；截图不上传、不保存。

## 开发运行

在项目根目录运行（本机为 `E:\英雄联盟助手`）：

```powershell
cd 'E:\英雄联盟助手'
npm ci
npm run dev
```

要求 **Node.js 22.12+**。依赖按 `package-lock.json` 锁定；推荐 npm 11.6.2+。若旧 npm 更新依赖时报 `edgesOut`，可临时使用：

```powershell
npm exec --yes --package=npm@11.6.2 -- npm ci
```

Electron 45 需要显式安装运行库，本项目的 `postinstall` 会执行官方安装脚本。Windows 开发下载会读取已启用的本机回环代理，或尊重 `HTTPS_PROXY`；不会更改全局 npm、Git 或系统代理配置。生产应用的公开数据请求使用系统代理，认证的本机与腾讯大区请求走直接连接。

```powershell
npm run typecheck
npm test
npm run build
npm run test:renderer
npm run test:companions
npm run test:history
npm run verify:live
npm run verify:statistics
npm run test:desktop
npm run test:portable
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-installer.ps1
```

`npm run inspect:champ-select` 只读打印当前选人会话结构（已脱敏），用于适配新模式。`verify:live` 是只读检查，认证不打印；真实自动接受和符文写入要由使用者在客户端场景中主动验收。桌面冒烟测试会启动并关闭助手，只打开符文预览，不点击应用，不修改游戏配置。`test:portable` 在构建后运行，验证便携启动器、连接与 OCR 进程，结束时关闭测试实例。

`test:renderer` 使用独立账户目录和明确标记的模拟数据，验证手动比较保持、识别切换、过期响应及符文参数传递；它不加载真实客户端服务，不进行游戏写入。

`test:companions` 验证双窗同步、阶段提示、换用参数和评分状态；`test:history` 验证战绩、实时成员及玩家跳转。两者同样使用隔离模拟服务，不操作真实客户端。

安装器测试只在没有同名正式安装和快捷方式时执行，使用项目内测试目录，验证后卸载并核对用户配置保持不变。

浏览器布局预览：`npm run dev:web`。该预览明确显示未连接，不伪造账号、战绩或胜率，游戏功能请使用桌面版。

## OCR 开发与打包

先安装 Python 3.12。在项目根目录创建隔离环境：

```powershell
py -3.12 -m venv .venv-ocr
.\.venv-ocr\Scripts\python.exe -m pip install -r worker\requirements.txt
npm run ocr:test
.\.venv-ocr\Scripts\python.exe worker\recognizer.py --selftest
npm run ocr:build
npm run build:win
```

下载超时可以只为当前命令使用镜像：

```powershell
.\.venv-ocr\Scripts\python.exe -m pip install --timeout 120 --index-url https://pypi.tuna.tsinghua.edu.cn/simple -r worker\requirements.txt
```

`build:win` 输出安装版、便携版和 `dist/SHA256SUMS`。发布完整包前必须先成功执行 `ocr:build` 并验收 OCR 可执行文件。构建自动运行 `licenses:collect`，将 Python、锁定依赖和随包本机库的许可文本及 SHA-256 索引放入程序的 `resources/third-party-licenses/`。安装版只安装到当前用户，保留用户配置与缓存。

OCR 只在截取区域像素完全一致时复用结果；新画面或识别失败会先清空旧三卡，重新识别期间显示提示。窗口移动时重新计算悬浮位置。主窗口的手动比较独立保留，点击“显示识别结果”可返回当前识别；换英雄或分组后清除旧比较。悬浮窗始终跟随实时识别。上述状态切换已通过隔离界面验证，当前实战验收状态见验收记录。

## 数据口径

- 召唤师峡谷统计来自腾讯 101，按版本、分路、来源段位筛选。选择“常见分路”时按该英雄在来源中的常见位置查询，不能当作所有分路的合并胜率。
- 普通大乱斗与海克斯大乱斗的数据分开。缺少某类出装或常规符文时会明确显示缺失，绝不用其他模式补出数字。
- AramHex 是采集到的国服对局样本，不是全服全部对局。水平组是模型推算结果，不能当官方段位，也不能直接套用 Hexdata 的数值分阈值。
- 强化按结算持有统计，受任务替换、选取偏差等影响；高胜率不是因果，也不是本局获胜概率。
- 排序使用 `(胜场 + 英雄基准胜率 × 300) / (场次 + 300)`。原始胜率、平滑值、样本分别展示，保留来源的低样本标记。
- 分组别名不重复显示；版本和活动规则不混用。更新按提供方的 manifest 与 SHA-256 校验，失败保留已成功的缓存。
- aramgg：推荐顺序、分级与英雄整体胜率来自腾讯国服；强化与组合胜率来自 aramgg 客户端上传的全球样本，不是国服全部对局，样本不足 255 场的胜率留空。页面标明数据版本与统计日期。免费计划每天 200 额度、每分钟 60 次；同一数据版本内已读取的英雄只请求一次，网络失败时显示已标注“上次缓存”的数据。公共数据按英雄轮转更新，尚未更新的英雄标明“旧版本数据（最新 X，轮转更新中）”。
- 外部数据保持其原许可。AramHex 为 **CC BY-NC 4.0，禁止未经授权的商业使用**；aramgg 数据按其开发者条款使用。

海斗分不会由战绩临时估算。Hexdata 没有公开第三方接入文档；本次核对的 AramHex 查分接口返回 HTTP 403“请在 AramHex 软件里查询”。已适配其状态、分区、百分位与限流协议，但真实查分尚未接通；弹窗和玩家资料显示提供方状态。AramHex 若获准返回的是区内位次，不能当作 Hexdata 数值分。实现参考与接口证据见 [companion-reference.md](docs/companion-reference.md)。

## 隐私与发布边界

客户端 token 只在主进程内存中使用，绝不发给统计站点、渲染进程或日志。窗口只暴露白名单操作；普通符文页和游戏程序文件不由助手修改。

公共数据由仓库工作流 `.github/workflows/aramgg-sync.yml` 用仓库 Secret `ARAMGG_API_KEY`（可加 `ARAMGG_API_KEY_2`，前一个额度用完或失效时自动换下一个）同步，Key 不进入数据包、仓库或安装包；公开发布由仓库变量 `ARAMGG_PUBLISH` 控制，默认关闭。个人 aramgg API Key 只能在设置里写入，用 Windows 加密存储（Electron safeStorage）保存在 `local/aramgg-key.bin`，只在主进程请求时使用；界面只显示末 4 位，不写入日志、缓存、仓库或安装包。

用户配置、战绩缓存、符文备份、玩家标记与遇到记录位于 Electron 用户数据目录（本机实测为 `%APPDATA%\英雄联盟助手\local`；改名为 PEARLJAM HEX 后仍沿用该目录，升级不丢设置），不上传、不提交仓库。可在关闭助手后删除缓存文件清理本地查询记录；保留 `settings.json` 可保留偏好与专用符文页归属。

项目不隶属于腾讯或 Riot Games，不表示获得官方背书。维护者已确认取得国服适用许可，并决定发布完整功能预览版；许可适用范围与持续有效性由维护者管理。[Riot 通用开发者政策](https://developer.riotgames.com/docs/lol#game-policy)对强化胜率展示有限制，数据开源许可不能代替运营方许可。具体第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

PEARLJAM HEX is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

## 项目结构

```text
src/main/             客户端、统计来源、战绩、配置、符文和识别服务
src/preload/          类型化白名单桥接
src/renderer/         Vue 工作台与悬浮窗
src/shared/           主进程与界面的数据约定
worker/               本地 OCR、匹配与合成样本基准
tests/                自动化边界与回退测试
scripts/              构建、校验和只读实机检查
.codex/               项目经验、验收待办和偏好
```

## 参考与许可

架构与国服协议研究参考 [LeagueAkari](https://github.com/LeagueAkari/LeagueAkari)、[winer](https://github.com/sunerpy/winer)、[AramHex](https://github.com/czgreat/aramhex)、[Nyx0ra 海克斯助手](https://github.com/Nyx0ra/lol-aram-mayhem-hextech-helper) 与太农海克斯助手（经作者授权参考，未复制其代码或数据）；海克斯数据接入 [aramgg](https://aramgg.com/) 官方数据 API。

原创代码 MIT；游戏素材、模型和统计数据保留各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
