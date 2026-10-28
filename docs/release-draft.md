# v0.1.0 完整功能预览版 · Windows x64

国服独立 Windows 助手，包含客户端识别、默认关闭的自动接受、本人及同区战绩、选人信息、国服出装/加点/常规符文预览与专用页应用、分层海克斯统计、本地 OCR 和悬浮窗。

## 当前可确认的结果

- 56 项 Vitest、13 项 Python 测试及类型检查通过；覆盖换人、退出账号、乱序返回，以及 OCR 刷新/中断/移屏和旧进程退出的状态保护。
- 5 项隔离界面场景通过：手动比较保持、返回当前识别、分组切换、迟到结果保护及符文参数传递；模拟服务不写真实客户端。
- 真实国服只读查询通过：本人及同区公开玩家 Riot ID 搜索、本人连续两页各 20 场、本人和该玩家的单局 10 人详情。
- 完整 OCR、打包后桌面及便携启动器通过检查，模型随包提供。
- 安装版和便携版附 SHA256SUMS，完整运行不需要用户安装 Node.js / Python。
- 随包收录 Python、26 个锁定依赖和本机库的 68 份许可文本及摘要索引。

## 使用前查看

- 自动接受、符文写入和换人，以及真实当前版本 OCR 多屏/缩放仍待用户实战验收；不会主动排队替用户测试。
- 普通大乱斗缺少某些推荐数据时明确显示缺失；海克斯未提供常规符文方案时不使用峡谷数据补充。
- Hexdata 数值分待正式接入资料与许可，不生成替代分数。
- 外部 AramHex 数据为 CC BY-NC 4.0，仅非商业使用；原创代码 MIT。
- 构建未签名，不宣称经过微软或游戏运营方认证。

## 下载与校验

下载本 Release 附件中的 `LeagueAssistantCN-0.1.0-x64-Setup.exe` 或 `LeagueAssistantCN-0.1.0-x64-Portable.exe`，无需安装 Node.js / Python。`SHA256SUMS` 用于核对附件原始文件；源码由 GitHub 提供 ZIP / tar.gz。

Windows PowerShell 校验示例：

```powershell
Get-FileHash -LiteralPath '.\LeagueAssistantCN-0.1.0-x64-Setup.exe' -Algorithm SHA256
```

维护者已确认取得国服适用许可后决定发布；本项目仍为独立工具，不表示官方背书。外部数据非商业许可保持不变。

查看[验收细节](https://github.com/pearljamx/league-assistant-cn/blob/v0.1.0/docs/verification.md)、[使用与构建](https://github.com/pearljamx/league-assistant-cn/blob/v0.1.0/README.md)及[第三方声明](https://github.com/pearljamx/league-assistant-cn/blob/v0.1.0/THIRD_PARTY_NOTICES.md)。
