# dsh-atelier · 母题工作台

DeepSeek Harness 0.2.x 插件。把「一个内容母题 → 多平台成品 → 发布后校准 → 经验规则」做成 dsh 原生能力：
**对话里 Agent 用工具跑链路，侧栏页面做人工审核与查看**；TikHub 贯穿创作前的信息来源与发布后的数据反馈，apiz-cli 负责可选生图。

<img width="1505" height="1194" alt="image" src="https://github.com/user-attachments/assets/30468ed4-c99f-43ba-9100-5d1ac434fc26" />


- 目标宿主：`0.2.1-rc.5` 稳定线（`engines.dsh: >=0.2.1-rc.2 <0.3.0`）
- 零 npm 依赖：Host 纯 ESM 源码，`client` 用 `scripts/build.mjs` 拼成 ModuleLoader 单文件，装完即用
- 数据：`$DSH_HOME/atelier/`（state.json 原子写 + mtime 重读 + 串行队列；settings.json 0600；raw/ assets/ exports/）

## 安装

仓库：`https://github.com/liangdabiao/dsh-atelier`

```bash
git clone https://github.com/liangdabiao/dsh-atelier.git
cd dsh-atelier
npm run build                 # 生成 dist/client.js
npm test                      # 免额度，node --test
node scripts/selftest.mjs     # 文件树 / 产物 / 文档守卫
dsh plugin --profile web add link:D:/dsh-atelier
dsh --profile web --dump-config | grep atelier   # 看到 bundle 声明即装好
dsh --profile web --no-open --port 4399         # 浏览器打开侧栏「母题工作台」
```

也可 `scripts/dev-sandbox.sh 4399` 在隔离的 `DSH_HOME` 里跑，不碰 `~/.dsh`。
桌面版用户在插件页点「立即启用」；命令行 `desktop` profile 由 Electron 独占管理，请用 `web` profile 或新建 profile 验收。

**让 AI 助手代装**：把下面这段粘给支持本地命令的 AI 助手即可（任一步失败就停，不假装装好）：

```text
请把 https://github.com/liangdabiao/dsh-atelier 安装到本机 DeepSeek Harness：
1. 克隆/更新仓库，执行 npm run build、npm test、node scripts/selftest.mjs；
2. 用 dsh plugin --profile web add link:<仓库绝对路径> 挂载，确认
   dsh --profile web --dump-config 的输出里出现 id: atelier；
3. 启动 dsh --profile web --no-open --port 4399，从启动日志取带 token 的 URL 打开
   （0.2.x 会先换会话 cookie），确认侧栏出现「母题工作台」且 /atelier/api/health 返回 200；
4. 新开会话，让 Agent 执行 atelier_query(what="health")，回报 platformSpecs.count
   与 tikhub.configured。
任何一步失败就停止并如实说明缺什么，不要跳过或用别的命令冒充成功。
```

**验收句**：新会话里发「用 atelier_query 查一下工作台健康状态，告诉我平台规格数量和 TikHub 是否已配置」。
判据是**侧栏页面与对话工具两部分都通**；只看到页面、Agent 调不到工具，不算装完（0.2.x 装完需完全退出并重新打开客户端）。

## 配置

1. **TikHub key**：设置页填入，或设环境变量 `ATELIER_TIKHUB_API_KEY`。只存 `settings.json`（0600），接口只回掩码。
   Token 需要在 TikHub 后台勾选对应 Scopes。按次计费、每端点独立 RPS（多数 5/s）、429 自动按 Retry-After 退避。
2. **模型**：用 dsh 当前默认模型（`agentDefaultModel` + `llm`），插件不配密钥。未登录时 ai 类动作显式失败。
3. **apiz-cli**：`apiz auth login` 由 CLI 自管，插件不接触密钥；`APIZ_BIN` / `Config.apizBin` 可覆盖可执行路径。
4. **离线联调**：`node scripts/mock-tikhub.mjs` + `ATELIER_TIKHUB_BASE_URL=http://127.0.0.1:4398`，无需 key 与额度。

## 双入口

**对话（Agent）**：`atelier`（单工具 action 枚举）+ `atelier_query`（只读）。
action：`capture / radar / evidence / deconstruct / angles / draft / review / derive / watch / predict / feedback / retro / rule / image / spec / export`，
参数放 `payload` JSON 字符串；高成本动作把 `confirm` 设为 true。

```
atelier(action="radar", payload="{\"endpointKey\":\"note.search\",\"params\":{\"keyword\":\"内容创作\"}}")
atelier(action="deconstruct", payload="{}")
atelier_query(what="evidence")
```

查平台文案规格（不联网、不花额度）：
```
atelier(action="spec", payload="{\"platform\":\"小红书\"}")
atelier(action="spec", payload="{\"listPlatforms\":true}")
```

**侧栏页面**：总台 / 信源工作台 / 拆解与方向 / 稿件与体检 / 复盘与规则 / 设置。
页面与工具都调 `src/pipeline.js` 的 `runAction`，写同一份 `state.json`。
稿件卡片会显示 `specCheck` 结果与话题，体检记录会单列「规格提示」条数。

## 平台规格与指标字段对照

`src/providers/platform-specs.json` 收录 **15 个平台**的文案 / 媒体 / 话题规格，来自 yikart/AiToEarn v2.5 的 `PlatformStaticMetadata` 常量表；
有参考项目在本机时可用 `npm run extract:specs` 重新抽取，生成结果已随包提交，日常运行不需要该脚本。

**诚实边界**：这是第三方为自己的发布器写的静态常量，**不是平台官方公布的限制，也未用各平台真实样本验真**（表内 `advisory: true / verified: false`）。
只作写作阶段的合规提示，不拦截发布、不预测表现；发布前一律以平台实际限制为准。

- `draft` / `derive`：把规格压成一行约束注入派生提示词，稿件落库时附 `topics[]`（去 `#`、精确去重、不臆造）与 `specCheck`；
- `review`：模型只做质量诊断，规格合规另走**确定性检查**，issues 带 `path / code / limit / actual`，可定点改字段后重检；未收录平台跳过检查，不臆造限制；
- `feedback`：原有 `metrics`（短名）保持不变，额外写 `metricsNormalized` 对照统一指标字段（`viewCount / playCount / likeCount / commentCount / collectCount / shareCount / saveCount / watchTimeSeconds ...`）；未知字段进 `unmapped` 保留，不丢数、不补造，复盘 baseline 增量仍按原 `metrics` 计算。

数值示例：小红书 标题 ≤20 / 正文 ≤1000 / 9 图 / 5 话题；抖音 30 / 1000 / 12 图 / 5 话题；公众号 64 / 20000 / 20 图且不支持原生话题；B站 话题总长 ≤199。

## TikHub 双通道

| 通道 | 端点组 | 用途 |
|---|---|---|
| 创作前信息来源 | 热搜/热点榜、上升榜、话题榜、创作者热点、趋势词、搜索联想、笔记/综合/视频搜索、话题作品、达人检索、账号作品谱、作品详情、分享链解析、评论 | `signals` → `evidence`（带 endpoint/params/fetchedAt/rawRef）；拆解结论绑定 `evidence_id` |
| 发布后数据反馈 | TikTok analytics 4 条、抖音 billboard 趋势/画像/词云，以及按 ID 重拉详情里的公开 statistics | T+1/3/7 `snapshots`，`origin=api \| manual \| api_failed`；与锁定的 `predictions` 校准；规则建议引用真实指标 |

**一次采集两次使用**：拆解时给对标作品记 baseline，T+N 回查算增量，让规则建议锚在可回溯数据上。

端点白名单在 `src/providers/endpoints.json`（约 30 条，逐条对照官方 OpenAPI V5.3.2 校验）；
设置页可联网刷新 spec 并列出失效路径，404 时用 `suggestPaths` 给同平台相近建议，不静默换路径出数。

## 方法论要点

- 稿件版本**只追加**；发布前盲判断锁定后带 `integrity_hash`，**不可覆盖**。
- 稿件体检只做质量诊断，**不预测表现**。
- 复盘只做「锁定预测 vs 实际」对照，api/manual 分组不混算，不补造预测、不把相关性写成因果。
- 规则 `proposed → 人工审核 → active/rejected`；只有 active 规则会进 Skill addendum 影响后续生成。
- 数据纪律写在工作流 SKILL、系统提示与 addendum 三处，`selftest` 有文档一致性守卫。

## 诚实边界

TikTok 有专用 analytics；**抖音没有通用 analytics**，主要靠按 ID 重拉详情里的公开互动数，`Douyin-Billboard` 分析端点只覆盖上榜作品；
小红书 `fetch_note_detail` 需要 `xsec_token`；视频号/公众号基本拿不到发布后指标，页面会直接提示手工补录。
公开互动数 ≠ 平台后台的完播率/粉丝画像。端点字段映射未逐平台用真实样本验真时会标 `unverified`，原始响应一律落 `raw/` 可查。

## 与方案的两处工程取舍

1. 页面用 `iframe + gallery/` 原生 SPA（骨架已验证的路线），而不是方案建议的 slot 内 React 组件；主题用 `<head>` 同步脚本 + postMessage 跟随，数据一律 `textContent` 渲染。后续可替换成 slot 内组件。
2. 零 npm 依赖，因此没有 `Config`(schemastery) 导出；运行参数走 `settings.json` + `/api/settings`。功能等价，换来了「装完即可运行、不受 npm peer 冲突影响」。

## 测试

`npm test`（6 组 32 例：store / tikhub / api / pipeline / host / spec）+ `node scripts/selftest.mjs`，全部离线、不花额度。
测试覆盖：原子写与 mtime 重读、端点白名单对照官方 spec、401 不重试 / 404 建议 / 缓存命中不重复请求、
采集与回查的证据链、origin 不混算、锁定不可覆盖、规则未审核不进 addendum、模型不可用显式失败、鉴权与 SSRF 防护。
