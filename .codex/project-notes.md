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
- 全量需求证据见 docs/acceptance-matrix.md；实战、Hexdata 与公开发布仍保持未完成。
- OCR 追加修复：90×60 缩略平均差会漏掉细微刷新，改为完整 BGR 字节一致才复用；识别失败/无效屏幕清空缓存，移动窗口即使画面一致也更新位置。
- OCR 协议的 changed 事件携带 requestId 与 gameWindow；主进程按当前请求和 epoch 接受；旧进程迟到退出不再拒绝新请求。成功重试清除旧退避。
- 新帧处理中清掉旧数字，悬浮窗显示等待提示。合成 4K 缓存约 12 MB，像素转换/比较平均约 33 ms；不是游戏端到端延迟或识别准确率证明。
- 手动比较现为主窗口独立快照，不写共享识别状态；后台 idle 不清空，换英雄/分组清空，按钮返回最新识别，悬浮窗始终实时。迟到比较结果按上下文丢弃。
- npm run test:renderer 的 5 项隔离界面场景通过，包含九项符文参数传递；模拟服务无网络/LCU 写入，不能代替真实符文应用验收。Vue 响应式数组/对象先复制为普通数据再跨桥接。
- npm run licenses:collect 离线收录 Python 3.12.4、26 个锁定包、4 组本机库，共 68 份许可文件及 SHA-256 索引，build:win 自动附带。Conda 下显式固定 ffi/bzip2/xz DLL 并校验原始摘要。
- 本次重建后安装/卸载再次通过：已安装的 OCR 正常，68 份许可摘要全部一致，用户配置原文摘要保持；桌面包真实连接 TENCENT，大厅、推荐、九项符文预览、118 行榜单无页面异常。最终两个 EXE 摘要见 docs/verification.md。
- 最终便携启动器再次通过：真实 TENCENT 连接、OCR 就绪、显示器列表含自动项与实际显示器；测试实例已关闭。余下实战场景、Hexdata 资料与公开范围需要用户场景或外部条件变化，不能用重复通过的本地测试代替。

## 发布状态

GitHub 登录有效，先前网络错误来自终端未使用系统代理。2026-10-29 用户回答已取得国服适用许可，明确授权继续发布完整版本；该确认覆盖此前发布范围问题，不再次询问。许可文件未提供，不宣称独立核验、官方背书或 Hexdata 已接入。正在准备公开仓库 pearljamx/league-assistant-cn 与 v0.1.0 完整功能预发布；以远程 API 和附件摘要核对后的记录为准。
