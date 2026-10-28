# AGENTS.md

## 工作方式

- 默认用中文，结论在前，提供具体路径、命令和验证结果。
- 修改前阅读本文件、README.md、package.json 和 .codex 下的项目记忆；不存在的文件跳过。
- 只修改任务相关文件，不删除已有功能，不做无关重构；优先简单、稳定的实现。
- 文本文件采用 UTF-8；PowerShell 输出与读写须显式使用 UTF-8。
- 每次完成任务更新有变化的项目记忆；详细内容放在 .codex，本文件保留关键规则。

## 项目约定

- Windows 10/11 x64 国服助手，Electron + Vue 3 + TypeScript + electron-vite，npm 管理依赖。
- 主进程负责本地客户端、网络、缓存和写操作；渲染进程只能调用 preload 中明确列出的接口。
- 客户端认证只驻留主进程内存，不写日志、缓存、命令行参数或 Git；不要读取游戏内存、注入或修改游戏程序。
- 国服 lockfile 可能为空；优先通过 PROCESS_QUERY_LIMITED_INFORMATION 和 ProcessCommandLineInformation 查询客户端启动元数据。
- 不在真实客户端自动发起排队或测试写操作；自动接受默认关闭；符文只更新助手管理的页面。
- 统计数据必须标明模式、来源、日期、分层与样本。缺失值为空，不伪造胜率、海斗分或查询成功。
- 实时换人/账号事件优先于在途轮询；异步读取缓存和网络返回后须再次核对账号与大区，不能用旧缓存掩盖会话变化或详情读取失败。
- Hexdata 直连等待正式接入资料；目前只提供其官方查询入口，不用其他来源的分数替代。
- AramHex 数据 CC BY-NC 4.0，代码 MIT，许可分开；不将 Hexdata 分数直接映射到 AramHex 分组。
- 2026-10-29 已通过国服 HN1 的本人查询、两页各 20 场及单局 10 人详情；此前出现过 503/500，回退和错误处理仍须保留。
- 当前 Riot 政策明确不批准展示强化胜率，尚未确认国服例外；完整版本先本地交付，公开发布范围等待用户决定，不能把开源数据许可等同于运营方许可。

## 命令与记忆

项目根目录：`E:\英雄联盟助手`。

- `npm ci` 安装锁定依赖。
- `npm run dev` 启动桌面开发环境。
- `npm run typecheck` 类型检查；`npm test` 单元与集成测试。
- `npm run build:win` 构建 Windows 安装版和便携版。
- OCR 的构建与测试见 README；运行用户无需单独安装 Python。
- Windows 打包前运行 `npm run ocr:build`；`build:win` 会验证 OCR 健康状态，生成 Setup.exe、Portable.exe 和 SHA256SUMS。
- 打包验证：`npm run test:portable`；安装/卸载烟测用 `scripts/smoke-installer.ps1`，必须保留已有安装与快捷方式的拒绝覆盖检查。
- 实际用户目录为 `%APPDATA%\英雄联盟助手\local`，不要按 package.name 猜测。
- Windows 终端不一定继承系统代理；开发下载通过 scripts/network.mjs 读取已启用的回环代理，不更改全局配置。

记忆入口：.codex/user-preferences.md、.codex/project-notes.md、.codex/error-solutions.md、.codex/todo.md、.codex/custom-instructions-draft.md。
