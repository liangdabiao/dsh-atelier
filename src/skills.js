// Skill provider：随包 SKILL.md 快照 + 动态 addendum（已审核激活的规则会进后续生成）。
import { readFileSync } from 'node:fs'
import { readState, activeRules } from './store.js'
import { ACTIONS } from './pipeline.js'
import { endpointList } from './providers/tikhub.js'

let cachedBody = null
function skillBody() {
  if (cachedBody) return cachedBody
  try {
    cachedBody = readFileSync(new URL('../skills/atelier-workflow/SKILL.md', import.meta.url), 'utf8')
  } catch {
    cachedBody = '# 母题工作台工作流\n\n先取真实证据，再拆解、出稿、复盘。\n'
  }
  return cachedBody
}

export function addendum() {
  const state = readState()
  const active = activeRules(state)
  const rules = active.length
    ? `\n\n## 已审核激活的写作规则（必须遵守）\n${active.map((r) => `- ${r.name}：${r.text}`).join('\n')}`
    : '\n\n## 已审核激活的写作规则\n（暂无。规则必须人工审核后才会出现在这里。）'
  const keys = endpointList('info').slice(0, 12).map((e) => e.key).concat(endpointList('feedback').slice(0, 6).map((e) => e.key))
  return `${rules}\n\n## 插件环境说明\n` +
    `- 写/读数据只用 \`atelier\` 与 \`atelier_query\` 两个工具；不要用 bash 或文件工具直接改 \`$DSH_HOME/atelier/\`（沙箱写不进去）。\n` +
    `- \`atelier\` 的 action 有：${Object.keys(ACTIONS).join(' / ')}。payload 是 JSON 字符串。\n` +
    `- 信息来源端点键（示例）：${keys.join(' / ')}。端点由插件白名单管理，不要自己拼 URL。\n` +
    `- 高成本动作（评论采集、生图）必须显式 confirm。\n` +
    `- 平台数据只能来自插件取回的证据；失败时明确说「未取到」，不要用 web 搜索结果冒充平台数据。\n`
}

export function createSkillProvider() {
  return {
    name: 'atelier',
    list: () => [{
      name: 'atelier-workflow',
      description: '母题工作台工作流：创作前用 TikHub 取真实证据 → 拆解 → 差异化方向 → 出稿 → 体检 → 多渠道派生 → 发布前盲判断锁定 → 发布后按 ID 回查指标 → 复盘校准 → 规则人工审核。需要跑创作链路或处理内容母题时使用。',
      path: 'atelier-workflow',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled', provider: 'atelier', rank: 600, locator: 'atelier-workflow',
    }],
    async get(candidate) {
      return {
        name: candidate?.name || 'atelier-workflow',
        description: '母题工作台工作流',
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'bundled', provider: 'atelier',
        content: skillBody() + addendum(),
      }
    },
  }
}
