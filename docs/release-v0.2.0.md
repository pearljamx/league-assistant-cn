# v0.2.0 · 双弹窗与实时对局（Windows x64 预览版）

客户端连接后会出现两个独立小窗：快速选择英雄与英雄信息。它们显示当前匹配/接受状态，跟随客户端英雄，进入游戏后自动收起。可拖动、单独收起，也可在设置重新打开。

- 点击英雄头像查看胜率、装备、技能、符文和强化推荐；点击“换用”直接更换当前备选席英雄，普通选人仅更新本人的可操作英雄，不自动锁定。
- 战绩页加入“对局记录 / 实时对局”，对局中展示双方公开阵容、等级、KDA 与装备。点击当前或历史对局的公开玩家，查看段位、近期表现和英雄记录。
- 海斗分区域保留真实提供方状态。Hexdata 仍需正式接入资料；AramHex 位次适配已实现，但服务实测拒绝第三方查询（403），不会生成替代分数或冒用官方软件身份。
- 补强切号、退出阶段和迟到查询保护，符文备份完成后也重新核对账号与连接。

安装版和便携版自带 Python/OCR，无需另装 Node.js 或 Python。下载同页 SHA256SUMS 核对文件，软件未签名。

真实客户端的换英雄、符文写入、实时十人数据及多屏 OCR 仍待用户实战验收；模拟测试不代表上述场景已通过。自动接受默认关闭，助手不会自行开始匹配。

[使用说明](https://github.com/pearljamx/league-assistant-cn/blob/main/README.md) · [验证记录](https://github.com/pearljamx/league-assistant-cn/blob/main/docs/verification.md) · [参考与查分接口证据](https://github.com/pearljamx/league-assistant-cn/blob/main/docs/companion-reference.md)
