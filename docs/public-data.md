# PEARLJAM HEX 公共数据部署

让所有用户免 Key 使用 aramgg 海克斯数据：仓库定时任务用维护者的 Key 同步，发布成带 SHA-256 的数据包；软件只下载数据包。

```text
aramgg API ──(仓库 Secret 中的 Key)──> GitHub Actions（每 3 小时）
    ├─> aramgg-data 分支（GitHub，raw.githubusercontent.com）
    └─> 国内镜像（腾讯云 COS / 阿里云 OSS，可选）
软件：国内镜像 → GitHub → 本机缓存 → 个人 Key → 国服 AramHex
```

## 数据包格式

- `manifest.json`：`schema`、`dataVersion`、`gamePatch`、`generatedAt`、`championIds`，以及每个文件的 `sha256`、`bytes`、`dataVersion`、`fetchedAt`。最后写入，客户端不会读到指向缺失文件的清单。
- `augments.json`：强化编号 → 名称、品质、图标。
- `champions/{id}.json`：精简后的单英雄数据（推荐顺序、分级、全球胜率、三强化组合、出装），附本英雄的 `dataVersion` 与 `fetchedAt`。

软件拒绝不符合固定文件名、摘要格式或大小上限的条目；摘要不符时换下一个地址，全部失败时用上一份已校验的缓存并标明过期。

## 额度

免费计划每天 200 额度（北京时间 08:00 重置），每分钟 60 次。完整同步约 348 额度（英雄列表 1 + 强化 1 + 每个英雄 2）。

- `config.json` 免费：版本未变且已全部同步时，定时任务不消耗额度。
- 版本更新后按“未同步 → 旧版本中最早抓取”的顺序轮转，按响应头 `x-credits-remaining` 停在保留余量（默认 6）之前；免费额度约两天轮完。未更新的英雄在界面标明“旧版本数据（最新 X，轮转更新中）”。
- 遇到 429 立即停止，已同步的文件照常发布。
- 获得提额后无需改代码；如响应头缺失，可用仓库变量 `ARAMGG_DAILY_BUDGET` 指定每日额度。

## 一、开启 GitHub 同步

在项目根目录运行（会提示粘贴 Key，Key 不会出现在命令行或日志）：

```bash
gh secret set ARAMGG_API_KEY
```

开启公开发布（默认关闭）：

```bash
gh variable set ARAMGG_PUBLISH --body true
```

手动跑一次：

```bash
gh workflow run aramgg-sync.yml
```

成功后数据位于 `https://raw.githubusercontent.com/pearljamx/league-assistant-cn/aramgg-data/manifest.json`。`aramgg-data` 是只含数据的孤立分支，每次强制推送一个提交，不会让仓库历史膨胀。关闭发布：把 `ARAMGG_PUBLISH` 改为 `false` 或删除该变量。

本地试跑（输出到临时目录，不发布）：

```bash
ARAMGG_API_KEY=你的Key npx tsx scripts/sync-aramgg.ts --out .tmp-aramgg-data
```

## 二、国内镜像（可选）

工作流用 S3 兼容接口上传，腾讯云 COS 和阿里云 OSS 都支持。未配置时自动跳过。

1. 创建存储桶，访问权限设为“公有读、私有写”；为同步单独创建只允许写该桶的子账号密钥。
2. 在仓库添加 Secret：
   - `MIRROR_S3_BUCKET`：存储桶名（COS 为 `名称-APPID`）。
   - `MIRROR_S3_ENDPOINT`：COS 如 `https://cos.ap-guangzhou.myqcloud.com`；OSS 如 `https://oss-cn-hangzhou.aliyuncs.com`。
   - `MIRROR_ACCESS_KEY_ID`、`MIRROR_SECRET_ACCESS_KEY`：子账号密钥。
3. 可选仓库变量：`MIRROR_S3_PREFIX`（默认 `pearljam-hex/aramgg`）、`MIRROR_S3_REGION`（COS 如 `ap-guangzhou`，OSS 如 `oss-cn-hangzhou`）。
4. 跑一次工作流后，把公开访问地址填入 `src/main/providers/aramgg-public.ts` 的 `CHINA_MIRROR`，例如 `https://桶名.cos.ap-guangzhou.myqcloud.com/pearljam-hex/aramgg`（不带结尾斜杠），重新打包发布。

国内云的默认域名可下载 JSON；如需自定义域名或 CDN 加速，按云厂商要求完成备案。清单设为 `no-cache`，数据文件缓存一天（内容变化时摘要也会变，客户端会重新下载）。

## 开发与测试

- `PEARLJAM_DATA_BASES=https://a,https://b` 可临时替换读取地址（仅 HTTPS，逗号分隔）。
- `tests/aramgg-public.test.ts` 用合成数据覆盖轮转、额度、429、版本更新、镜像回退、摘要校验与缓存。
