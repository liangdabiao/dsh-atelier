# dsh-atelier · 母题工作台

DeepSeek Harness 0.2.x 插件。把「一个内容母题 → 多平台成品 → 发布后校准 → 经验规则」做成 dsh 原生能力：
**对话里 Agent 用工具跑链路，侧栏页面做人工审核与查看**；TikHub 贯穿创作前的信息来源与发布后的数据反馈，apiz-cli 负责可选生图。

<img width="1505" height="1194" alt="image" src="https://github.com/user-attachments/assets/30468ed4-c99f-43ba-9100-5d1ac434fc26" />

- 目标宿主：`0.2.1-rc.5` 稳定线（`engines.dsh: >=0.2.1-rc.2 <0.3.0`）
- 零 npm 依赖：Host 纯 ESM 源码，`client` 用 `scripts/build.mjs` 拼成 ModuleLoader 单文件，装完即用
- 数据：`$DSH_HOME/atelier/`（state.json 原子写 + mtime 重读 + 串行队列；settings.json 0600；raw/ assets/ exports/）

## 怎么用（普通用户版）

**不用记任何 id、不用写 JSON、不用理解参数名。** 页面共 7 页，按顺序点就行；每页顶部都有一句「这一步做什么 / 下一步去哪」。

| 步骤 | 在哪一页 | 做什么 |
|---|---|---|
| ① | 总台 | 点一个「一键采集」（或随手记一条灵感），看「接下来做什么」建议 |
| ② | 信源工作台 | 选数据源时会自动出现中文填空；信号卡片上直接「取详情 / 设为对标」 |
| ③ | 拆解与方向 | 点「基于证据拆解」→「生成方向」→ 在候选里点「选它 → 去出稿」 |
| ④ | 稿件与体检 | 点「出稿」，再「体检 / 派生 / 下载」，全部针对当前选中的稿件 |
| ⑤ | 复盘与规则 | 发布前锁定判断；发布后登记作品，T+1/3/7 记数据，最后人工审核规则 |
| — | 使用说明 | 三分钟上手、完整流程图、名词解释、常见问题，页面内随时可查 |

**也可以不动手，直接在 dsh 对话里说人话**：

```text
帮我采一下抖音热搜，基于素材做拆解并给 3 个方向；
用第二个方向写一篇小红书稿，再做一次体检
```

两个入口写的是同一份数据：对话里生成的，页面立刻能看到；页面上改的，Agent 也能查到。

**常见问题**：没填 TikHub key 也能写稿（只有采集/回查需要）；模型用 dsh 当前登录的默认模型，插件不带密钥；自动回查默认关闭，不会偷偷消耗额度；数据全在本机，没有云端后端。更完整的说明在插件「使用说明」页。

## 安装

仓库：`https://github.com/liangdabiao/dsh-atelier`

```bash
git clone https://github.com/liangdabiao/dsh-atelier.git
cd dsh-atelier
npm run build                 # 生成 dist/client.js
npm test                      # 免额度，node --test
node scripts/selftest.mjs     # 文件树 / 产物 / UX / 文档守卫
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
   - 若报 `Authentication Fails, Your api key: ****xxxx is invalid`，那是 **dsh 侧默认模型的凭据失效**，与本插件的 TikHub Key 无关。
     去 **dsh 设置 → 模型** 换一个可用通道（如账号登录 `deepseek-account`）或重新登录；也可在本插件「设置」页点「测试模型连通」先自检。
     插件设置页里没有模型开关——模型密钥归 dsh 管。插件会把这类错误翻译成中文并标注 `scope: host-model-auth`，不会把英文 API 报错原样丢给你。
3. **apiz-cli**：`apiz auth login` 由 CLI 自管，插件不接触密钥；`APIZ_BIN` / `Config.apizBin` 可覆盖可执行路径。
4. **离线联调**：`node scripts/mock-tikhub.mjs` + `ATELIER_TIKHUB_BASE_URL=http://127.0.0.1:4398`，无需 key 与额度。

> 宿主模型通道失效是 dsh 侧最常见的一次性故障。若你用 API Key 通道（`deepseek-official`），Key 过期后所有 profile 都会报同一条错；
> 改用账号登录通道（`deepseek-account`）可避免这一类问题。切换方式是在 profile 的 `cordis.patch.yml` 里覆盖 `agent-default-model`：
> ```yaml
> - id: agent-default-model
>   name: "@deepseek-ai/dsh-agent-default-model"
>   config:
>     provider: deepseek-account
>     model: deepseek-flash
> ```

### 模型输出不稳定怎么处理

宿主默认模型是 reasoning 模型时，**思考过程与正文共享同一个 `max_tokens` 预算**：思考吃掉大部分额度后，正文可能为空或 JSON 写不完。
插件已做的处理：

- 按动作给足上限（出稿/派生 12000、其余 6000），并在请求时把推理强度降到 `low`（模型不支持时保持原样，不强行覆盖）。
- 检测到输出被截断或正文为空时**明确报原因并放弃写库**，不会拿半截 JSON 充数。
- JSON 有轻微损坏时（尾随逗号、缺闭合括号、正文里的裸英文引号）会先尝试修补再解析。

若仍偶发失败，请重试该步；反复失败时在 dsh 设置里换一个非推理型模型通道，或把一次处理的素材量调小。

### 诊断脚本

`node scripts/check-host-key.mjs` 会检查 dsh 宿主的两条模型通道（API Key / 账号登录）是否还有效，并给出可直接粘贴的修复配置。
只在鉴权层检查，不产生推理费用，不回显密钥明文。

## 双入口

**对话（Agent）**：`atelier`（单工具 action 枚举）+ `atelier_query`（只读）。
action：`capture / radar / evidence / deconstruct / angles / draft / review / derive / watch / predict / feedback / retro / rule / image / spec / export / modelcheck`。
`modelcheck` 做模型连通性自检（AI 类动作报鉴权/额度问题时先跑它）。
`payload` **直接传参数对象**（不要写成 JSON 字符串）；旧的字符串写法仍兼容。高成本动作把 `confirm` 设为 true。不填 id 时多数动作自动使用最近一条记录。

```
atelier(action="radar", payload={"endpointKey": "hot.search", "limit": 10})
atelier(action="spec", payload={"platform": "小红书"})
atelier_query(what="automation")
```

**侧栏页面**：总台 / 信源工作台 / 拆解与方向 / 稿件与体检 / 复盘与规则 / 设置 / 使用说明。
页面与工具都调 `src/pipeline.js` 的 `runAction`，写同一份 `state.json`。稿件卡片会显示 `specCheck` 结果与话题，体检记录会单列「规格提示」条数。

## 定时自动化（T+1/3/7）

用 dsh 宿主自带的持久化定时服务 `ctx.schedule.create(sessionId, {prompt,title,at}, signal)`：登记作品时自动建三个一次性任务，到点把 prompt 投递回会话唤醒 Agent。另有 `ctx.interval` 每小时「补跑扫描」，客户端没开或重启后也能补回数据（同一任务最多重试 2 次，避免刷额度）。

- **默认只提醒、不花钱**：`tnReminderEnabled: true`（到点问一句「要不要回查」）；`feedbackAutoEnabled: false`（真正自动调 TikHub 写快照，会消耗额度，必须显式打开）。
- 两种模式都不会自动激活经验规则 —— 规则仍需人工审核。
- 宿主没有 schedule 服务或没有活跃会话时，页面会如实显示原因，由补跑扫描兜底，不假装已排好。
- 页面「复盘与规则 → 自动化」可改开关、看待回查与补跑记录、点「立即检查并补跑」。

## 平台规格与指标字段对照

`src/providers/platform-specs.json` 收录 **15 个平台**的文案 / 媒体 / 话题规格，来自 yikart/AiToEarn v2.5 的 `PlatformStaticMetadata` 常量表；
有参考项目在本机时可用 `npm run extract:specs` 重新抽取，生成结果已随包提交，日常运行不需要该脚本。

**诚实边界**：这是第三方为自己的发布器写的静态常量，**不是平台官方公布的限制，也未用各平台真实样本验真**（表内 `advisory: true / verified: false`）。
只作写作阶段的合规提示，不拦截发布、不预测表现；发布前一律以平台实际限制为准。

- `draft` / `derive`：把规格压成一行约束注入派生提示词，稿件落库时附 `topics[]`（去 `#`、精确去重、不臆造）与 `specCheck`；
- `review`：模型只做质量诊断，规格合规另走**确定性检查**，issues 带 `path / code / limit / actual`；未收录平台跳过检查，不臆造限制；
- `feedback`：原有 `metrics`（短名）保持不变，额外写 `metricsNormalized` 对照统一指标字段；未知字段进 `unmapped` 保留，不丢数、不补造。

数值示例：小红书 标题 ≤20 / 正文 ≤1000 / 9 图 / 5 话题；抖音 30 / 1000 / 12 图 / 5 话题；公众号 64 / 20000 / 20 图且不支持原生话题；B站 话题总长 ≤199。

## TikHub 双通道

| 通道 | 端点组 | 用途 |
|---|---|---|
| 创作前信息来源 | 热搜/热点榜、上升榜、话题榜、创作者热点、趋势词、搜索联想、笔记/综合/视频搜索、话题作品、达人检索、账号作品谱、作品详情、分享链解析、评论 | `signals` → `evidence`（带 endpoint/params/fetchedAt/rawRef）；拆解结论绑定 `evidence_id` |
| 发布后数据反馈 | TikTok analytics 4 条、抖音 billboard 趋势/画像/词云，以及按 ID 重拉详情里的公开 statistics | T+1/3/7 `snapshots`，`origin=api \| manual \| api_failed`；与锁定的 `predictions` 校准；规则建议引用真实指标 |

**一次采集两次使用**：拆解时给对标作品记 baseline，T+N 回查算增量，让规则建议锚在可回溯数据上。
信号落库同时保存 `platformWorkId`（真实平台作品 ID）；`signal.id` 只是标题哈希，**不能当作品 ID 用**（页面卡片按钮已改用前者）。

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

1. 页面用 `iframe + gallery/` 原生 SPA（骨架已验证的路线），而不是方案建议的 slot 内 React 组件；主题用 `<head>` 同步脚本 + postMessage 跟随，数据一律 `textContent` 渲染。
2. 零 npm 依赖，因此没有 `Config`(schemastery) 导出；运行参数走 `settings.json` + `/api/settings`。功能等价，换来了「装完即可运行、不受 npm peer 冲突影响」。

## 测试

`npm test`（全部离线、不花额度）+ `node scripts/selftest.mjs`。
测试覆盖：原子写与 mtime 重读、端点白名单对照官方 spec、401 不重试 / 404 建议 / 缓存命中不重复请求、
采集与回查的证据链、origin 不混算、锁定不可覆盖、规则未审核不进 addendum、模型不可用显式失败、鉴权与 SSRF 防护，
以及本轮的 UX 回归（端点字段自动生成、payload 对象化、真实作品 ID、导出可下载、布尔开关、定时任务到期与重试上限、自动回查默认不花钱）。
