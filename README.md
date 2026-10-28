# 英雄联盟助手 · League Assistant CN

面向 Windows 10/11 x64 和英雄联盟国服的独立桌面工作台。使用 Electron、Vue 3、TypeScript；海克斯三选一在本机用 RapidOCR 识别。

## 功能

- 识别 WeGame 启动的国服客户端；展示账号、段位和对局阶段。
- 自动接受对局，**默认关闭**；阶段变化或断开连接后取消待执行操作。
- 查询本人或同区玩家战绩，查看详情；大区服务优先、客户端窗口补充，失败时明确提示或显示已标注的本地缓存。
- 选人阶段同步队友和备选英雄，分别展示英雄统计胜率与玩家近期同模式胜率。
- 腾讯 101 国服出装、常规符文、技能优先级和逐级加点；符文预览后仅写入助手专用页面。
- AramHex 海克斯英雄及强化排行，支持娱乐、中分、前 5% 分组；展示日期、样本与低样本标记。
- 海克斯三选一识别、F6 快捷键、手动纠正与穿透点击的悬浮窗。
- Hexdata 数值分目前**待正式接入资料与授权**；当前提供其官方查分页，不生成其他分数替代。

完整验收状态见 [docs/verification.md](docs/verification.md)。有实现并不等于已经在真实对局中通过验收。

## 直接使用

本地 `dist/` 已生成安装版（Setup.exe）与便携版（Portable.exe）。完整包自带 OCR，不需要安装 Node.js 或 Python。公开发布范围尚待决定，目前没有可用的 GitHub Release；请勿把预定仓库地址当作已发布下载。

1. 启动 WeGame，登录英雄联盟。
2. 启动助手，等待左下角出现“国服客户端已连接”。
3. 在“设置”按需开启自动接受；进入选人后查看队伍和备选席。
4. 在“英雄推荐”选择英雄、模式、分路与统计段位，预览符文后再确认应用。
5. 海克斯对局使用无边框或窗口模式；在设置开启自动检测，或在三选一出现时按 F6。认不准时重试或手动选择。

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
npm run verify:live
npm run verify:statistics
npm run test:desktop
npm run test:portable
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-installer.ps1
```

`verify:live` 是只读检查，认证不打印；真实自动接受和符文写入要由使用者在客户端场景中主动验收。桌面冒烟测试会启动并关闭助手，只打开符文预览，不点击应用，不修改游戏配置。`test:portable` 在构建后运行，验证便携启动器、连接与 OCR 进程，结束时关闭测试实例。

安装器测试只在没有同名正式安装和快捷方式时执行，使用项目内测试目录，验证后卸载并核对用户配置保持不变。

浏览器布局预览：`npm run dev:web`。该预览明确显示未连接，不伪造账号、战绩或胜率，游戏功能请使用桌面版。

## OCR 开发与打包

先安装 Python 3.12。在项目根目录创建隔离环境：

```powershell
py -3.12 -m venv .venv-ocr
.\.venv-ocr\Scripts\python.exe -m pip install -r worker\requirements.txt
.\.venv-ocr\Scripts\python.exe -m unittest discover -s worker\tests -v
.\.venv-ocr\Scripts\python.exe worker\recognizer.py --selftest
npm run ocr:build
npm run build:win
```

下载超时可以只为当前命令使用镜像：

```powershell
.\.venv-ocr\Scripts\python.exe -m pip install --timeout 120 --index-url https://pypi.tuna.tsinghua.edu.cn/simple -r worker\requirements.txt
```

`build:win` 输出安装版、便携版和 `dist/SHA256SUMS`。发布完整包前必须先成功执行 `ocr:build` 并验收 OCR 可执行文件。安装版只安装到当前用户，保留用户配置与缓存。

## 数据口径

- 召唤师峡谷统计来自腾讯 101，按版本、分路、来源段位筛选。选择“常见分路”时按该英雄在来源中的常见位置查询，不能当作所有分路的合并胜率。
- 普通大乱斗与海克斯大乱斗的数据分开。缺少某类出装或常规符文时会明确显示缺失，绝不用其他模式补出数字。
- AramHex 是采集到的国服对局样本，不是全服全部对局。水平组是模型推算结果，不能当官方段位，也不能直接套用 Hexdata 的数值分阈值。
- 强化按结算持有统计，受任务替换、选取偏差等影响；高胜率不是因果，也不是本局获胜概率。
- 排序使用 `(胜场 + 英雄基准胜率 × 300) / (场次 + 300)`。原始胜率、平滑值、样本分别展示，保留来源的低样本标记。
- 分组别名不重复显示；版本和活动规则不混用。更新按提供方的 manifest 与 SHA-256 校验，失败保留已成功的缓存。
- 外部数据保持其原许可。AramHex 为 **CC BY-NC 4.0，禁止未经授权的商业使用**。

## 隐私与发布边界

客户端 token 只在主进程内存中使用，绝不发给统计站点、渲染进程或日志。窗口只暴露白名单操作；普通符文页和游戏程序文件不由助手修改。

用户配置、战绩缓存、符文备份位于 Electron 用户数据目录（本机实测为 `%APPDATA%\英雄联盟助手\local`），不上传、不提交仓库。可在关闭助手后删除缓存文件清理本地查询记录；保留 `settings.json` 可保留偏好与专用符文页归属。

项目不隶属于腾讯或 Riot Games，不宣称官方授权。2026-10-29 核对的 [Riot 开发者政策](https://developer.riotgames.com/docs/lol#game-policy)明确将展示强化胜率的网站、应用和悬浮窗列为不批准的用途；页面未说明国服例外。数据的开源许可不能代替运营方许可。目前完整版本仅在本地交付，公开发布需先确定国服适用要求或改为基础版。详见 [第三方声明](THIRD_PARTY_NOTICES.md)。

英雄联盟助手 is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

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

架构与国服协议研究参考 [LeagueAkari](https://github.com/LeagueAkari/LeagueAkari)、[winer](https://github.com/sunerpy/winer)、[AramHex](https://github.com/czgreat/aramhex) 与 [Nyx0ra 海克斯助手](https://github.com/Nyx0ra/lol-aram-mayhem-hextech-helper)。

原创代码 MIT；游戏素材、模型和统计数据保留各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
