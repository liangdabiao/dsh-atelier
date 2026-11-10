// 宿主模型调用：用 dsh 当前默认模型，插件不配任何模型密钥。
// 模型不可用一律显式失败（不用模板稿冒充成功），并给出下一步。
export function modelInfo(ctx) {
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
    if (!ctx.get('llm') || !selection?.provider || !selection?.model) return null
    return { provider: selection.provider, model: selection.model }
  } catch { return null }
}

/**
 * 把宿主模型抛出的原始错误翻译成用户看得懂、能动手的中文提示。
 * 分类只依据实测到的错误文案与 HTTP 语义，不臆造宿主行为。
 */
export function classifyModelError(err, info) {
  const raw = String(err?.message || err || '')
  const provider = info?.provider || '宿主默认模型'
  const model = info?.model || ''
  const where = provider + (model ? ' / ' + model : '')

  // 宿主鉴权失败：dsh 侧的 API Key 或登录态失效，与插件无关
  if (/authentication fails|invalid.*api key|api key.*invalid|unauthorized|401/i.test(raw)) {
    const err2 = new Error(`宿主模型鉴权失败：${where} 的凭据已失效（不是插件的 TikHub Key）。请在 dsh 设置里换默认模型或重新登录该通道，再重试本步。`)
    err2.nextStep = '打开 dsh 设置 → 模型，选择可用通道（账号登录优先），确认后回到本插件重试。'
    err2.scope = 'host-model-auth'
    err2.raw = raw
    return err2
  }
  // 额度 / 配额耗尽
  if (/insufficient|quota|balance|rate.?limit|429|too many requests/i.test(raw)) {
    const err2 = new Error(`宿主模型额度不足或被限流：${where}。请在 dsh 设置里检查该通道余额或稍后再试。`)
    err2.nextStep = '确认 dsh 设置里该模型的额度与限流状态；也可换用其他通道。'
    err2.scope = 'host-model-quota'
    err2.raw = raw
    return err2
  }
  // 网络 / 连接
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|socket hang up/i.test(raw)) {
    const err2 = new Error(`连不上宿主模型服务（${where}）。请检查网络与代理设置后重试。`)
    err2.nextStep = '确认网络可访问模型服务；如需代理请在 dsh 设置里配置。'
    err2.scope = 'host-model-network'
    err2.raw = raw
    return err2
  }
  // 其它模型侧错误：保留原文但标注来源，避免用户误以为是插件或 TikHub 的问题
  const err2 = new Error(`宿主模型调用失败（${where}）：${raw}`)
  err2.nextStep = '这是 dsh 默认模型侧的报错，不是插件问题；可在 dsh 设置里换模型通道后重试。'
  err2.scope = 'host-model-other'
  err2.raw = raw
  return err2
}

/**
 * 结构化 JSON 任务不需要高强度推理。
 * 宿主默认 effort 是 'high'，thinking 与正文共享 max_tokens 预算：
 * 思考吃掉大部分额度后，正文可能为空或 JSON 写不完（真机实测约 1/3 概率）。
 * 这里把 effort 降到 'low' 给正文留预算；模型不支持则保持原样（不强行覆盖）。
 */
export function relaxReasoningEffort(controls, modelInfo) {
  const efforts = modelInfo?.reasoning?.efforts || []
  if (!efforts.length) return controls
  const ids = efforts.map((e) => (typeof e === 'string' ? e : e?.id)).filter(Boolean)
  if (!ids.includes('low')) return controls
  if (controls?.reasoningEffort !== undefined) return controls  // 用户显式设定过就不动
  return { ...controls, reasoningEffort: 'low' }
}

export async function callModel(ctx, { system, user, maxTokens = 6000, signal } = {}) {
  const info = modelInfo(ctx)
  if (!info) {
    const err = new Error('当前没有可用模型：请在 dsh 设置里选择默认模型并登录，再用 ai 类动作。')
    err.nextStep = '配置默认模型后重试；采集 / 证据 / 登记 / 反馈 / 复盘 / 规则审核不依赖模型，可照常使用。'
    err.scope = 'host-model-missing'
    throw err
  }
  const llm = ctx.get('llm')
  try {
    // configure 让我们在宿主组装请求前调整控制项（stream 会校验 config 未变，故必须走这里）。
    // 老版本宿主的 prepareCall 不接受第三个参数，这里先试再用，回退不影响功能。
    const base = { provider: info.provider, model: info.model, maxTokens }
    let call
    try {
      call = await llm.prepareCall(base, signal, (controls, modelInfo) => relaxReasoningEffort(controls, modelInfo))
    } catch (err) {
      if (err?.scope) throw err
      call = await llm.prepareCall(base, signal)
    }
    let text = ''
    let finishReason = ''
    for await (const chunk of call.stream({
      ...call.config,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }], source: { kind: 'dsh-atelier' } }],
      signal,
    })) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'finish') {
        finishReason = String(chunk.reason?.kind || '')
        if (['error', 'aborted'].includes(chunk.reason?.kind)) {
          throw new Error(chunk.reason?.failure?.message || '模型调用失败')
        }
      }
    }
    // 长度截断：JSON 必然不完整，直接给出可读原因，别让用户看到解析器的天书
    // 宿主实测的 finish kind 取值：'stop' / 'max-tokens' / 'tool-calls' / 'error' / 'aborted'
    if (finishReason === 'max-tokens' || finishReason === 'max_tokens' || finishReason === 'length') {
      const err = new Error('模型输出被长度上限截断，结果不完整，本次不写库。')
      err.nextStep = '请重试本步；若反复出现，把要处理的证据/稿件数量减少，或换一个输出更长的模型通道。'
      err.scope = 'model-truncated'
      err.raw = `finish=${finishReason} len=${text.length}`
      throw err
    }
    // reasoning 模型偶发只输出思考过程、正文为空；此时没有 JSON 可解析
    if (!text.trim()) {
      const err = new Error('模型这次只返回了思考过程、没有正文（空回复），本次不写库。')
      err.nextStep = '请直接重试本步；反复出现时换用非推理型模型通道，或在 dsh 设置里调低推理强度。'
      err.scope = 'model-empty-output'
      err.raw = `finish=${finishReason} len=0`
      throw err
    }
    return { text, model: info.model }
  } catch (err) {
    // 已经分类过的错误直接抛，避免二次包装丢掉 scope
    if (err?.scope) throw err
    throw classifyModelError(err, info)
  }
}

/** 容忍代码块 / 前后说明文字；只取第一组完整括号。 */
export function extractJson(text) {
  const raw = String(text ?? '')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  const body = fenced ? fenced[1] : raw
  const start = body.search(/[{[]/)
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  if (start < 0 || end < start) {
    const err = new Error('模型没有按要求返回 JSON（可能是空回复或被截断），本次不写库。')
    err.nextStep = '请重试本步；若反复出现，换一个模型通道，或减少一次处理的证据数量。'
    err.scope = 'model-bad-output'
    err.raw = raw.slice(0, 800)
    throw err
  }
  const slice = body.slice(start, end + 1)
  try {
    return JSON.parse(slice)
  } catch (err) {
    // 模型常在末尾多一个逗号，或字符串里混入未转义引号；先做保守修补再试一次
    const repaired = tryRepairJson(slice)
    if (repaired) return repaired
    const err2 = new Error(`模型返回的 JSON 无法解析：${String(err?.message || err).split('\n')[0]}（本次不写库）。`)
    err2.nextStep = '请重试本步；反复失败时换模型通道，或把一次处理的素材量调小。'
    err2.scope = 'model-bad-output'
    err2.raw = slice.slice(0, 800)
    throw err2
  }
}

/** 保守修补：去掉尾随逗号、补齐缺失的闭合括号。仅在原解析失败后尝试。 */
export function tryRepairJson(slice) {
  let s = slice
  // 补齐缺失的闭合括号
  const stack = []
  let inStr = false
  let esc = false
  for (const ch of s) {
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') stack.pop()
  }
  if (inStr) s += '"'
  while (stack.length) s += stack.pop() === '{' ? '}' : ']'
  // 去掉尾随逗号
  s = s.replace(/,\s*([}\]])/g, '$1')
  try { return JSON.parse(s) } catch { /* 继续尝试更进一步的修补 */ }

  // 模型偶尔在正文里写未转义的英文双引号：把「字符串内的裸引号」转义掉再试
  const escaped = escapeInnerQuotes(s)
  if (escaped !== s) {
    try { return JSON.parse(escaped) } catch { /* 仍不行则放弃 */ }
  }
  return null
}

/**
 * 转义「本该在字符串内部、却是裸的」英文双引号。
 * 判据：解析器认为自己在字符串里时遇到的下一个 "，若其后不是结构性字符（: , } ] 数字 字母 汉字 引号），就当作正文内容转义。
 */
export function escapeInnerQuotes(s) {
  let out = ''
  let inStr = false
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (esc) { out += ch; esc = false; continue }
    if (ch === '\\') { out += ch; esc = true; continue }
    if (ch === '"') {
      if (!inStr) { out += ch; inStr = true; continue }
      // 在字符串里遇到 "：看下一个非空字符
      let j = i + 1
      while (j < s.length && /\s/.test(s[j])) j++
      const next = s[j]
      const structural = next === ':' || next === ',' || next === '}' || next === ']' || next === undefined
      if (structural) { out += ch; inStr = false }        // 这是真正的字符串结束
      else { out += '\\"' }                                // 这是正文里的裸引号，转义它
      continue
    }
    out += ch
  }
  return out
}

export const OUTPUT_RULE = '只输出一个 JSON 对象，不要输出别的文字、不要代码块。\nJSON 字符串内部不要出现英文双引号（"）；需要引号时用中文引号「」或“”，避免转义出错。'

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
