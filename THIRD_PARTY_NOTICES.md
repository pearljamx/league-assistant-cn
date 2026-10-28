# 第三方组件与数据声明

本项目原创代码采用 MIT。游戏资产、外部统计数据、依赖及模型保持各自的许可；项目的 MIT 许可不重新授权这些内容。

## 数据与素材

- 腾讯 101：<https://101.qq.com/>。国服英雄、装备、常规符文和技能加点统计来自其公开网页使用的接口；界面保留模式和统计日期。名称、图标及游戏内容归腾讯、Riot Games 或相应权利人所有。
- Riot Data Dragon：<https://developer.riotgames.com/docs/lol#data-dragon>。静态装备、符文树及图标用于标识展示，不作为国服对局统计。
- 海克斯大乱斗统计数据（github.com/czgreat/aramhex-data），CC BY-NC 4.0：<https://github.com/czgreat/aramhex-data>；许可 <https://creativecommons.org/licenses/by-nc/4.0/>。使用需注明来源，禁止未经许可的商业使用。应用校验提供方的 SHA-256，并按发布快照和水平组分别缓存，不提供全服数据或官方段位的保证。
- Hexdata / HexBox：<https://hexdata.com.cn/matchmaking-position>。目前仅提供官方查询入口，没有复制其私有评分数据、模型或登录凭证；直连功能等待正式接入方式和许可。

## 软件与模型

- Electron、Vue、electron-vite、Vite、TypeScript、Koffi、ws、Zod：MIT 或各组件随附许可。
- Lucide：ISC；<https://lucide.dev/license>。图标由 Lucide 项目提供。
- RapidOCR / rapidocr-onnxruntime：Apache-2.0；<https://github.com/RapidAI/RapidOCR>。
- OCR ONNX 模型随 RapidOCR 官方软件包提供，源自 PaddleOCR（Apache-2.0）；<https://github.com/PaddlePaddle/PaddleOCR>。
- ONNX Runtime：MIT；<https://github.com/microsoft/onnxruntime>。
- OpenCV：Apache-2.0；<https://opencv.org/license/>。
- NumPy：BSD-3-Clause；Pillow：HPND；MSS：MIT。
- Python 运行库：PSF；FlatBuffers：Apache-2.0。OpenCV、NumPy 和 ONNX Runtime 附带的其他组件说明保留原文。
- Shapely：BSD-3-Clause，其 GEOS 库另受 LGPL 约束；libffi：MIT；bzip2、XZ/liblzma 采用其随附许可；OpenSSL 3.x：Apache-2.0。具体文本与来源以构建生成的清单为准。
- PyInstaller：GPL-2.0-or-later，包含允许分发打包程序的 bootloader exception；<https://pyinstaller.org/en/stable/license.html>。

实际安装版本见 package-lock.json、worker/requirements.txt、worker/requirements-lock.txt；原始依赖的许可文件保留在相应软件包中。

Windows 构建还会把 Python 解释器、锁定 OCR 依赖和可识别本机库随附的完整许可文本放入安装目录 `resources/third-party-licenses/`，`index.json` 记录版本、路径及 SHA-256。缺少许可文件的 RapidOCR/FlatBuffers wheel 使用仓库内保存的对应上游版本原文；该清单不构成游戏运营方或数据提供方的授权。

## 参考项目

设计与协议研究参考 LeagueAkari、sunerpy/winer、czgreat/aramhex、Nyx0ra/lol-aram-mayhem-hextech-helper。各项目的名称和原始源码许可归其作者；本项目不代表这些作者或其产品。

本项目为独立社区工具，与腾讯、Riot Games、Hexdata 没有隶属或赞助关系，不表示获得官方背书。

Riot 通用 Game Policy 对强化胜率展示有限制：<https://developer.riotgames.com/docs/lol#game-policy>。2026-10-29 维护者确认已取得国服适用许可，并授权发布完整功能预览版；许可原文未随源码公开，不将该确认描述为独立核验或官方背书。外部数据、软件与模型仍分别遵守各自许可，Hexdata 数值分直连仍待正式接入资料。
