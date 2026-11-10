// 两个工具：atelier（单工具 action 枚举，写）+ atelier_query（只读检索）。
// 工具与页面 /api/ops 都调 pipeline.runAction，数据落在同一份 state.json。
import { ACTIONS, runAction, queryState, stateSummary } from './pipeline.js'

const ACTION_KEYS = Object.keys(ACTIONS)

function check(args, spec) {
  const problems = []
  for (const key of spec.required || []) if (args?.[key] === undefined) problems.push(`缺少必填参数 ${key}`)
  for (const [key, rule] of Object.entries(spec.properties || {})) {
    const value = args?.[key]
    if (value === undefined) continue
    if (rule.type === 'string' && typeof value !== 'string') problems.push(`${key} 要是字符串`)
    if (rule.type === 'boolean' && typeof value !== 'boolean') problems.push(`${key} 要是布尔值`)
    if (rule.type === 'number' && typeof value !== 'number') problems.push(`${key} 要是数字`)
    if (rule.enum && !rule.enum.includes(value)) problems.push(`${key} 只能是 ${rule.enum.join(' / ')} 之一`)
  }
  for (const key of Object.keys(args || {})) if (!(key in (spec.properties || {}))) problems.push(`未知参数 ${key}`)
  if (problems.length) throw new Error(`atelier 参数有误：${problems.join('；')}`)
}

export function createTools(ctx) {
  const atelierTool = {
    name: 'atelier',
    description:
      '母题工作台：跑创作链路。用 action 指定步骤，payload 传 JSON 字符串参数。' +
      '创作前可用 radar 从 TikHub 取热榜/搜索/对标/评论作为证据；发布后可用 feedback 按作品 ID 回查真实指标。' +
      '涉及真实数据的动作只使用插件取回的证据，禁止编造笔记、评论与互动量。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string', enum: ACTION_KEYS,
          description: `动作：${ACTION_KEYS.join(' / ')}。radar 采集 → evidence 补证据 → deconstruct 拆解 → angles 方向 → draft 出稿 → review 体检 → derive 派生 → predict 锁定判断 → feedback 回查 → retro 校准 → rule 规则建议/审核。spec 可查平台文案规格：payload 传 {"platform":"小红书"} 或 {"listPlatforms":true}；规格为第三方常量，仅供参考。`,
        },
        payload: { type: 'string', description: '该动作的参数，JSON 字符串（例如 {"endpointKey":"hot.search","params":{}}）。不传视为 {}。' },
        confirm: { type: 'boolean', description: '高成本动作（评论采集、生图）必须显式设为 true。' },
        dryRun: { type: 'boolean', description: '为 true 时只返回预览，不发外部请求、不写库。' },
      },
    },
    timeoutMs: 120_000,
    output: {
      schema: {
        type: 'object', additionalProperties: false, required: ['ok', 'summary', 'data'],
        properties: {
          ok: { type: 'boolean', description: '是否成功' },
          summary: { type: 'string', description: '给模型看的简短回执' },
          data: { type: 'string', description: '结构化结果的 JSON 字符串' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
      presentationMeta: (_args, value) => ({ kind: 'atelier:call', ok: value.ok }),
    },
    async execute(args, exec) {
      check(args, this.parameters)
      let payload = {}
      if (args.payload) {
        try { payload = JSON.parse(args.payload) } catch { throw new Error('payload 不是合法 JSON 字符串') }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload 必须是 JSON 对象')
      }
      if (args.confirm) payload.confirm = true
      if (args.dryRun) payload.dryRun = true
      const result = await runAction(ctx, args.action, payload, { signal: exec?.signal })
      return {
        ok: Boolean(result.ok),
        summary: result.summary || result.error || '完成',
        data: JSON.stringify({ ...result, ...(result.nextStep ? { nextStep: result.nextStep } : {}) }).slice(0, 30_000),
      }
    },
  }

  const queryTool = {
    name: 'atelier_query',
    description: '只读查询母题工作台的数据（信号/证据/稿件/版本/快照/规则/复盘/调用留痕等），不写库、不花额度。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['what'],
      properties: {
        what: {
          type: 'string',
          enum: ['state', 'health', 'signals', 'evidence', 'sources', 'campaigns', 'angles', 'deconstructs', 'drafts',
            'assessments', 'assets', 'predictions', 'publishedWorks', 'benchmarkWatch', 'snapshots', 'retros', 'rules', 'apiCalls'],
          description: '要查的集合；state 返回全量，health 返回接入状态与计数。',
        },
        id: { type: 'string', description: '按 id 精确过滤' },
        keyword: { type: 'string', description: '按关键词模糊过滤' },
        limit: { type: 'number', description: '最多返回条数，1-100，默认 20' },
      },
    },
    timeoutMs: 10_000,
    output: {
      schema: {
        type: 'object', additionalProperties: false, required: ['ok', 'summary', 'data'],
        properties: {
          ok: { type: 'boolean' },
          summary: { type: 'string' },
          data: { type: 'string', description: '结果 JSON 字符串' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
      presentationMeta: () => ({ kind: 'atelier:query' }),
    },
    async execute(args) {
      check(args, this.parameters)
      const result = queryState(args.what, { id: args.id, keyword: args.keyword, limit: args.limit })
      return { ok: Boolean(result.ok), summary: (result.summary || result.error || '').slice(0, 8000), data: JSON.stringify(result.data || {}).slice(0, 30_000) }
    },
  }

  return [atelierTool, queryTool]
}
