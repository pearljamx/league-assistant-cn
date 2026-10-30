# AGENTS.md

## 工作方式

- 默认用中文，结论在前，提供具体路径、命令和验证结果。
- 修改前阅读本文件、README.md、package.json 和 .codex 下的项目记忆；不存在的文件跳过。
- 只修改任务相关文件，不删除已有功能，不做无关重构；优先简单、稳定的实现。
- 文本文件采用 UTF-8；PowerShell 输出与读写须显式使用 UTF-8。
- 每次完成任务更新有变化的项目记忆；详细内容放在 .codex，本文件保留关键规则。

## 项目约定

- 产品名 PEARLJAM HEX（原「英雄联盟助手」，作者 PEARLJAM/pearljamx），Windows 10/11 x64 国服助手，Electron + Vue 3 + TypeScript + electron-vite，npm 管理依赖。
- 主进程负责本地客户端、网络、缓存和写操作；渲染进程只能调用 preload 中明确列出的接口。
- 客户端认证只驻留主进程内存，不写日志、缓存、命令行参数或 Git；不要读取游戏内存、注入或修改游戏程序。
- 国服 lockfile 可能为空；优先通过 PROCESS_QUERY_LIMITED_INFORMATION 和 ProcessCommandLineInformation 查询客户端启动元数据。
- 不在真实客户端自动发起排队或测试写操作；自动接受默认关闭；符文只更新助手管理的页面。
- 统计数据必须标明模式、来源、日期、分层与样本。缺失值为空，不伪造胜率、海斗分或查询成功。
- 实时换人/账号事件优先于在途轮询；异步读取缓存和网络返回后须再次核对账号与大区，不能用旧缓存掩盖会话变化或详情读取失败。
- OCR 新帧未完成前不得复用旧三卡；变化事件按请求和上下文核对，旧子进程退出不能影响新进程。Python 测试使用 `npm run ocr:test` 指向项目 3.12 环境。
- 主窗口手动比较与实时识别分开；跨 preload 只传普通数据，Vue 响应式对象须先复制。`npm run test:renderer` 仅用隔离模拟服务，无真实游戏写入。
- 客户端小窗：#champion-picker 为 Mini 窗（客户端连接即显示），#champion-info 为仅选人阶段的「英雄推荐」窗（海克斯模式默认显示带评级的强化推荐）；两窗可拖边缘调整大小，尺寸和拖动后的位置都会记住（位置不在任何屏幕内时退回贴靠，设置可恢复自动贴靠），自动出现不抢焦点，进入游戏/断线隐藏。备选席与本人英雄卡片合并显示，点头像即直接换：卡片阶段点卡片即完成选择，备选席直接交换，队友留下的英雄在卡片阶段只显示“稍后可换”；峡谷本人回合只预选不锁定；右键只查看。不在真实客户端做自动测试写。
- 自动选人/禁用/抢备选席与自动锁定全部默认关闭；只处理本人进行中的回合，不覆盖用户自己预选的英雄，写入前重读会话，每步只尝试一次。工具集操作只在用户点击时执行。不在真实客户端自动测试这些写操作，用 tests/auto-select、tests/toolkit 与隔离 fixture 验证。
- 实时/历史玩家详情仅按公开 PUUID 或完整 Riot ID 查询；不得按英雄或位置猜身份。实时列表、资料和评分的返回都核对账号/大区/阶段，旧请求不得回滚新选择。
- Hexdata 直连等待正式接入资料；目前只提供其官方查询入口，不用其他来源的分数替代。
- AramHex 数据 CC BY-NC 4.0，代码 MIT，许可分开；不将 Hexdata 分数直接映射到 AramHex 分组。
- 海克斯数据默认 aramgg 官方数据 API（hexSource 默认 aramgg，AramHex 为可选来源与回退）；顺序/分级标明来自腾讯国服，胜率标明为 aramgg 全球样本，不足 255 场留空。API Key 只经设置写入，safeStorage 加密存于 local/aramgg-key.bin，只在主进程使用；不得硬编码、写入日志、发给渲染进程、提交 Git 或打包。同一 dataVersion 每个资源只请求一次以节省额度。
- 默认读 PEARLJAM HEX 公共数据（无需 Key）：国内镜像 CHINA_MIRROR → GitHub aramgg-data 分支 → 本机缓存 → 个人 Key → AramHex；清单与文件按固定文件名和 SHA-256 校验。同步由 scripts/sync-aramgg.ts + .github/workflows/aramgg-sync.yml 完成（Secret ARAMGG_API_KEY，变量 ARAMGG_PUBLISH 默认关闭，镜像走 S3 兼容 Secret），额度不足按未同步/最旧优先轮转，旧版本英雄须标明。2026-10-29 用户表示 aramgg 授权由其自行判断，不再提醒。详见 docs/public-data.md。
- 2026-10-29 已通过国服 HN1 的本人查询、两页各 20 场及单局 10 人详情；此前出现过 503/500，回退和错误处理仍须保留。
- 2026-10-29 用户明确确认已取得国服适用许可，并授权公开发布完整版本；据此继续 GitHub 发布，不再重复询问发布范围。许可原文未入库，不宣称经独立核验或官方背书；数据许可、Hexdata 接入与实战验收仍分别处理。
- 公开仓库为 https://github.com/pearljamx/league-assistant-cn；v0.1.0 完整功能预发布已上线，Windows CI 通过。更新发布时保留版本标签与文件摘要记录，不将预发布成功替代实战验收。
- v0.2.0 双弹窗与实时玩家战绩预发布已上线，Windows CI 40815051966通过；对应最终标签e1fb30c。发布后不移动该标签，数值海斗分仍待数据方API。
- v0.3.0（PEARLJAM HEX Akari 式改版）预发布已上线，Windows CI 41045158378 通过，标签 84975d2，发布后不移动；安装/卸载烟测因本机已有正式安装未执行，新增写操作与实时新版面仍待实战验收。

## 命令与记忆

项目根目录：`E:\英雄联盟助手`。

- `npm ci` 安装锁定依赖。
- `npm run dev` 启动桌面开发环境。
- `npm run typecheck` 类型检查；`npm test` 单元与集成测试。
- `npm run test:companions`、`npm run test:history` 与 `npm run test:live` 使用断网合成服务验证跨窗、玩家详情和十人实时版面，不向真实客户端写入；它们加载 out/，改动界面后先 `npm run build`。
- `npm run build:win` 构建 Windows 安装版和便携版。
- OCR 的构建与测试见 README；运行用户无需单独安装 Python。
- Windows 打包前运行 `npm run ocr:build`；`build:win` 会验证 OCR 健康状态、收集软件许可，生成 Setup.exe、Portable.exe 和 SHA256SUMS。
- 打包验证：`npm run test:portable`；安装/卸载烟测用 `scripts/smoke-installer.ps1`，必须保留已有安装与快捷方式的拒绝覆盖检查。
- 实际用户目录为 `%APPDATA%\英雄联盟助手\local`（改名后由 index.ts 显式 setPath 保持），不要按 productName 或 package.name 猜测。
- Windows 终端不一定继承系统代理；开发下载通过 scripts/network.mjs 读取已启用的回环代理，不更改全局配置。

记忆入口：.codex/user-preferences.md、.codex/project-notes.md、.codex/error-solutions.md、.codex/todo.md、.codex/custom-instructions-draft.md。
