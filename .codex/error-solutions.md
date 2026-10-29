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

## OCR 刷新仍返回旧卡片 / 重试恢复后不再检查

- 新增测试复现：单像素变化被缩略图平均值吞掉；模型中断后新帧误配旧结果；窗口移动复用旧位置；无效显示器没有清缓存。
- 改为完整像素字节一致才复用，成功处理后才写入缓存，失败和显示器异常清空；缓存复用时也更新窗口坐标。
- changed 事件携带请求 ID 并校验 epoch，旧进程的退出事件不能取消新进程请求；手动重试成功后清除退避，继续检测弹窗消失。
- 验证：Python 13 项、Vitest 54 项与类型检查通过。多屏位置是模拟捕获测试，当前实际游戏准确率与延迟仍未验收。

## 手动比较被自动检测清空 / 跨桥接对象无法复制

- 主窗口手选原先修改共享 OCR 状态，下一次游戏非前台的 idle 会清除；改为主窗口独立快照，显式切回实时识别，换英雄/分组后作废，悬浮窗继续跟随真实检测。
- 隔离 Electron 界面复现 `An object could not be cloned`：Vue 响应式数组/对象直接传给 contextBridge 失败。手选 IDs、符文 query 和 perks 在调用前复制为普通数据。
- Vitest 56 项和 5 项隔离界面场景通过；符文测试使用模拟服务，只验证参数，不写真实客户端。

## OCR 包内本机库与许可来源不一致

- 收集许可时 bzip2 DLL 摘要不匹配：PyInstaller 从 PATH 取到了同名库。
- 在 Conda 环境下显式添加基环境 Library/bin 的 ffi.dll、libbz2.dll、liblzma.dll；收集阶段核对冻结 DLL 与生产者文件摘要，缺许可或版本不符就停止打包。
- 重建 OCR 后收集通过：Python 3.12.4、26 个锁定包、4 组本机库、68 份文本；构建自动附带索引，不下载许可证，不把数据许可视为运营方许可。

## 草稿 Release 的标签接口 404 / 源码 ZIP 换行差异

- 草稿已存在且 gh release view 可见时，REST releases/tags/v0.1.0 仍可能返回 404；不能据此误判凭证无效。按授权用户的 releases 列表筛选 tag_name 或使用 Release ID 核对草稿。
- GitHub 源码 ZIP 会遵守 .gitattributes 的 *.ps1 eol=crlf，不能把与 Git blob 的换行差异当成代码不一致。仅对明确声明的 PS1 归一化比较，其他文件保持逐字节比较。
- v0.1.0 校验通过：3 个附件服务端 SHA-256、公开校验文件、96 个源码文件；已公开，非草稿。

## 桌面烟测遇到已运行的旧版本

- 相同 userData 的单实例锁会让新测试进程直接退出；不要因此判定新包打不开，也不要杀用户程序。用项目 artifacts 下的独立 --user-data-dir 运行只读烟测，autoAccept保持默认false。
- 按英雄ID定位真实数据的按钮，不能把“戏命师”等称号当作所有资料源统一的英雄名称。修正定位后，实际双窗、跨窗浏览、收起重开和实时页大厅状态通过。
- 普通真实客户端写操作仅由用户点击；参数与切号边界采用模拟服务验证。

## CI 的桌面分辨率与战绩成员入口

- GitHub Windows runner会限制本机窗口尺寸，较窄布局有意收起卡片内成员，仍提供单局详情入口。烟测不能假设申请的原生宽度等于网页视口。
- History烟测显式设1440px宽验证卡片成员，再以1100px验证通过单局详情查询玩家；6项场景本地通过，运行代码没有为测试修改。
