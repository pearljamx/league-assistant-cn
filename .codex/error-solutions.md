# Error Solutions

## 国服客户端 lockfile 为空且 WMI 启动参数为 null

- 现象：WeGame 启动的客户端 lockfile 为 0 字节，WMI 无法返回 CommandLine。
- 已验证方法：PROCESS_QUERY_LIMITED_INFORMATION 打开客户端，以 NtQueryInformationProcess 的 ProcessCommandLineInformation 查询启动元数据。
- 凭证仅在内存使用，必须精确区分 --app-port 与 --riotclient-app-port。

## 战绩接口 503

- 规划阶段本机 LCU 和大区 SGP 的只读查询均返回 503。
- 2026-10-29 重新验证已恢复：SGP 两页各 20 场且无重复，单局 10 人。没有确认服务故障根因，仍采用有界重试、缓存和清晰失败状态。

## Windows 终端下载与 GitHub 登录误报

- 浏览器可访问，但 Node / gh 直连超时或显示认证失败；Windows 已启用回环代理。
- 已验证：仅为当前进程设置 HTTPS_PROXY 后 gh auth status 成功；凭证本身有效。
- Electron 安装和构建用 scripts/network.mjs，公开数据用 Electron net.fetch；认证 LCU/SGP 不走公共代理，不记录凭证。

## Electron 45 安装后找不到运行库

- 该包没有原有自动安装流程；根 postinstall 通过官方 install.js 显式下载。
- Windows 动态 import 必须把绝对路径转成 file URL。npm ci 与打包程序启动均验证通过。

## PyInstaller 在 Anaconda Python 下缺少 ctypes DLL / 中文协议乱码

- Anaconda 的 ffi.dll 在基环境 Library/bin，脚本检测存在后显式打包。
- 冻结程序显式将 stdin/stdout/stderr 设为 UTF-8，不能只依赖 PYTHONIOENCODING。
- 打包 EXE 健康检查、合成三卡识别通过；RapidOCR / ORT 模型随包携带。

## npm 10 更新依赖 edgesOut

- npm 10.9.0 更新依赖触发 Arborist 错误时，通过 npm exec --yes --package=npm@11.6.2 -- npm install 临时升级执行。
- 最终 npm ci 使用锁文件已成功，无需永久修改用户全局 npm。

## OCR 旧截图名称不在当前词典

- 公开旧版本样本含当前 AramHex 名称目录未收录的“心灵净化”；正式词典下正确拒绝完整三卡结果。
- 仅在离线 QA 的 --allow-reference-names 参数下补充旧名称验证字体，绝不向生产数据加入伪造 ID 或胜率。

## 安装器测试的名称与用户目录不能猜测

- electron-builder 的卸载程序名来自 executableName：Uninstall LeagueAssistantCN.exe；显示名包含中文产品名及版本。
- Electron 的实际 userData 使用 productName：%APPDATA%\英雄联盟助手，不是 package.name。
- 修正烟测路径后，完整安装、OCR 健康检查、卸载及真实 settings.json 保留校验通过。

## 换人、离开选人或切号后被旧请求回滚

- 复现：旧选人查询晚于实时换人事件完成时把 22 回滚为 202；旧身份轮询能在退出账号后恢复旧账号。新增用例先复现失败，再验证修复。
- 解决：选人请求版本及阶段/账号/连接共同校验，实时事件使旧响应作废；身份事件递增版本，旧轮询不能覆盖。
- 战绩缓存的异步读也要校验账号/大区；详情网络失败不再把部分缓存返回为完整成功。
- 验证：Vitest 50 项通过、类型检查通过；真实国服本人及同区公开玩家查询、分页和 10 人详情通过。
