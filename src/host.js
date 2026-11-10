// dsh-atelier Host 半边：apply(ctx) 注册工具 / 技能 / 系统提示 / HTTP 前缀 / 定时自动化。
// 纯 ESM 零构建，零 npm 依赖，所有服务都从 ctx 取（schedule 用运行时探测，缺席不影响加载）。
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTools } from './tools.js'
import { createSkillProvider } from './skills.js'
import { BASE, handle } from './api.js'
import { ensureDirs } from './settings.js'
import { installAutomation } from './schedule.js'

export const name = 'atelier'
export const inject = ['tools', 'skills', 'systemPrompt', 'webServer', 'connection']

const HERE = dirname(fileURLToPath(import.meta.url))
const GALLERY = join(HERE, '..', 'gallery')

const SYSTEM_TEXT = `## 母题工作台（dsh-atelier）
用户要跑创作链路、记灵感、查内容资料、做复盘或审核写作规则时，用 \`atelier\` 工具；只读查询用 \`atelier_query\`。
**\`payload\` 直接传参数对象**（例如 {"endpointKey":"hot.search"}），不要写成 JSON 字符串。不填 id 时多数动作自动使用最近一条记录。
推荐顺序：radar/evidence 取真实证据 → deconstruct 拆解 → angles 差异化方向 → draft 出稿 → review 体检 → derive 派生 → predict 锁定发布前判断 → watch 登记作品 → feedback 按 ID 回查指标 → retro 校准 → rule 规则建议（人工审核后才激活）。
登记作品时插件会自动创建 dsh 原生 T+1/3/7 定时提醒；到点先按设置决定是否自动回查，未开启自动回查时必须先问用户，不要擅自消耗额度。
铁律：
- 只能依据插件取回的真实证据与 <data> 里出现的内容，禁止编造笔记、评论、互动量或本人经历；资料不足写「待补充」。
- 采集/回查失败要如实说「未取到」，不要用 web 搜索结果冒充平台数据，也不要用模板稿冒充成稿成功。
- 评论采集、生图等高成本动作必须先向用户确认，再把 confirm 设为 true。
- 数据读写只走插件工具；模型沙箱写不到 $DSH_HOME 数据目录。
- 规则只有人工审核激活后才会进入 Skill addendum，未激活的规则不得当作必须遵守的要求。
- 采集与生图是可跳过的增强，外部服务不可用时纯文本链路仍要能走完。`

export function apply(ctx) {
  ensureDirs()
  for (const tool of createTools(ctx)) ctx.tools.register(tool)
  ctx.skills.registerProvider(() => createSkillProvider())
  ctx.systemPrompt.section({ name: 'atelier:workflow', order: 120, text: SYSTEM_TEXT, interpolate: false })
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    handler: (req, res) => handle(ctx, req, res, GALLERY),
  }), 'atelier:routes')
  installAutomation(ctx)
}
