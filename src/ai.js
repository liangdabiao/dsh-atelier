// 宿主模型调用：用 dsh 当前默认模型，插件不配任何模型密钥。
// 模型不可用一律显式失败（不用模板稿冒充成功），并给出下一步。
export function modelInfo(ctx) {
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
    if (!ctx.get('llm') || !selection?.provider || !selection?.model) return null
    return { provider: selection.provider, model: selection.model }
  } catch { return null }
}

export async function callModel(ctx, { system, user, maxTokens = 3000, signal } = {}) {
  const info = modelInfo(ctx)
  if (!info) {
    const err = new Error('当前没有可用模型：请在 dsh 设置里选择默认模型并登录，再用 ai 类动作。')
    err.nextStep = '配置默认模型后重试；采集 / 证据 / 登记 / 反馈 / 复盘 / 规则审核不依赖模型，可照常使用。'
    throw err
  }
  const llm = ctx.get('llm')
  const call = await llm.prepareCall({ provider: info.provider, model: info.model, maxTokens }, signal)
  let text = ''
  for await (const chunk of call.stream({
    ...call.config,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }], source: { kind: 'dsh-atelier' } }],
    signal,
  })) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'finish' && ['error', 'aborted'].includes(chunk.reason?.kind)) {
      throw new Error(chunk.reason?.failure?.message || '模型调用失败')
    }
  }
  return { text, model: info.model }
}

/** 容忍代码块 / 前后说明文字；只取第一组完整括号。 */
export function extractJson(text) {
  const raw = String(text ?? '')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  const body = fenced ? fenced[1] : raw
  const start = body.search(/[{[]/)
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  if (start < 0 || end < start) throw new Error('模型没有返回 JSON')
  return JSON.parse(body.slice(start, end + 1))
}

const OUTPUT_RULE = '只输出一个 JSON 对象，不要输出别的文字、不要代码块。'

const PROMPTS = {
  deconstruct: ({ evidence }) => ({
    system: `你是内容拆解助手。基于给定的真实证据，拆出这条内容的钩子、结构、证据与可复用模式。
${OUTPUT_RULE}
格式：{"hook":"...","structure":["..."],"evidenceRefs":["evidence_id"],"pattern":"...","quotes":["原文短句"]}
铁律：只能引用 <data> 里出现的 evidence_id 与原文；缺事实写「待补充」，禁止编造笔记、评论或互动量。`,
    user: `<data>${JSON.stringify(evidence)}</data>`,
  }),
  angles: ({ deconstruct, evidence, rules }) => ({
    system: `你是选题策划。基于拆解结果，给出 3 个真正不同的差异化方向。
${OUTPUT_RULE}
格式：{"angles":[{"kind":"同问题异观点|同结构异案例|相邻延伸","title":"...","rationale":"...","evidenceRefs":[]}]}
三个方向必须立场/案例/切口不同，禁止同义替换。${rules}`,
    user: `<data>${JSON.stringify({ deconstruct, evidence })}</data>`,
  }),
  draft: ({ campaign, angle, evidence, rules }) => ({
    system: `你是写作者。依据选定方向与真实证据写一篇中文稿件。
${OUTPUT_RULE}
格式：{"title":"...","outline":["..."],"body":"Markdown 正文"}
铁律：不虚构本人经历、数据、平台指标；引用事实时标注来源；资料不足处写「待补充」。${rules}`,
    user: `<data>${JSON.stringify({ campaign, angle, evidence })}</data>`,
  }),
  review: ({ draft }) => ({
    system: `你是稿件体检员。只做质量诊断，不预测发布表现。
${OUTPUT_RULE}
格式：{"dimensions":{"钩子":1,"结构":1,"证据":1,"可读性":1},"issues":[{"level":"high|mid|low","text":"..."}],"suggestions":["..."]}
每个维度 1-5 分，issues 必须指向正文里的具体问题。`,
    user: `<data>${JSON.stringify({ title: draft?.title, body: String(draft?.body || '').slice(0, 8000) })}</data>`,
  }),
  derive: ({ draft, platforms, specs }) => ({
    system: `你是多平台改写编辑。把母稿派生到指定平台，保持同一母题但适配各平台语态与长度。
${OUTPUT_RULE}
格式：{"items":[{"platform":"...","title":"...","body":"...","topics":["话题名（不带 #）"]}]}
不要只做同义替换或改标题；每个平台要有独立的开头与结构。
话题放进 topics 数组：不带 #、去重；证据或母稿里没出现的话题不要臆造。
各平台规格（第三方常量，仅供参考，以平台实际限制为准）：
${specs || '（未提供规格）'}`,
    user: `<data>${JSON.stringify({ title: draft?.title, body: String(draft?.body || '').slice(0, 8000), platforms })}</data>`,
  }),
  predict: ({ draft, platforms }) => ({
    system: `你是发布前判断记录员。在发布前写下对这条内容的预期（盲判断），用于日后校准，不是承诺。
${OUTPUT_RULE}
格式：{"dimensions":{"传播预期":"...","受众":"...","风险":"..."},"hypothesis":"..."}`,
    user: `<data>${JSON.stringify({ title: draft?.title, platforms })}</data>`,
  }),
  rule: ({ retro, snapshots }) => ({
    system: `你是复盘助手。从校准对照里提炼可复用的经验规则建议，供人工审核，不自动生效。
${OUTPUT_RULE}
格式：{"rules":[{"name":"...","text":"...","evidenceIds":["..."]}]}
铁律：每条规则必须引用真实存在的 snapshot / evidence id；不把相关性写成因果；没有数据支撑就不给规则。`,
    user: `<data>${JSON.stringify({ retro, snapshots })}</data>`,
  }),
}

export function buildPrompt(action, context) {
  const rules = context.rules || ''
  const make = PROMPTS[action]
  if (!make) throw new Error(`动作 ${action} 不需要模型`)
  return make({ ...context, rules })
}

export function sanitize(value, maxLen = 12000) {
  // 模型输出可能夹带 HTML/脚本；只做长度与标签剥离，页面渲染一律用 textContent。
  if (typeof value === 'string') return value.replace(/<script[\s\S]*?<\/script>/gi, '').slice(0, maxLen)
  if (Array.isArray(value)) return value.slice(0, 50).map((row) => sanitize(row, 2000))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, v] of Object.entries(value).slice(0, 40)) out[key] = sanitize(v, 3000)
    return out
  }
  return value
}
