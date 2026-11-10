import test from 'node:test'
import assert from 'node:assert/strict'

const { classifyModelError, modelInfo, callModel, extractJson, tryRepairJson, relaxReasoningEffort, escapeInnerQuotes, OUTPUT_RULE: OUTPUT_RULE_TEXT } = await import('../src/ai.js')

// 复现用户实际遇到的报错文案（来自 DeepSeek 官方 API，掩码 key 尾号 0734）
const AUTH_RAW = 'Authentication Fails, Your api key: ****0734 is invalid (request_id: 3c4f6a0f-e5e3-4013-ac74-1bea8d41b2df)'

test('宿主鉴权失败被分类成 host-model-auth，且不再回显英文原文', () => {
  const err = classifyModelError(new Error(AUTH_RAW), { provider: 'deepseek-official', model: 'deepseek-flash' })
  assert.equal(err.scope, 'host-model-auth')
  assert.match(err.message, /宿主模型鉴权失败/)
  assert.match(err.message, /deepseek-official/)
  assert.ok(err.nextStep && err.nextStep.length > 0, '必须给下一步')
  assert.ok(!err.message.includes('request_id'), '不该把 request_id 之类的原始噪音丢给用户')
  assert.ok(!err.message.includes('Authentication Fails'), '不该把英文原文丢给用户')
})

test('鉴权失败时明确说明不是插件的 TikHub Key', () => {
  const err = classifyModelError(new Error(AUTH_RAW), { provider: 'deepseek-official', model: 'deepseek-flash' })
  assert.match(err.message, /TikHub Key/)
  assert.match(err.nextStep, /dsh/)
})

test('额度不足与限流分类为 quota', () => {
  const a = classifyModelError(new Error('Insufficient Balance'), { provider: 'deepseek-account', model: 'x' })
  assert.equal(a.scope, 'host-model-quota')
  const b = classifyModelError(new Error('429 Too Many Requests'), { provider: 'deepseek-account', model: 'x' })
  assert.equal(b.scope, 'host-model-quota')
})

test('网络错误分类为 network', () => {
  const err = classifyModelError(new Error('fetch failed'), { provider: 'deepseek-account', model: 'x' })
  assert.equal(err.scope, 'host-model-network')
})

test('未知错误归为 other，仍保留原始信息但标注来源是宿主模型', () => {
  const err = classifyModelError(new Error('something odd happened'), { provider: 'deepseek-account', model: 'flash' })
  assert.equal(err.scope, 'host-model-other')
  assert.match(err.message, /something odd happened/)
  assert.match(err.message, /deepseek-account/)
})

test('没有可用模型时给出可执行指引而不是抛原始异常', async () => {
  const ctx = { get: (k) => (k === 'llm' ? {} : undefined) }
  assert.equal(modelInfo(ctx), null)
  await assert.rejects(() => callModel(ctx, { system: 's', user: 'u' }), (err) => {
    assert.equal(err.scope, 'host-model-missing')
    assert.match(err.message, /dsh 设置/)
    assert.ok(err.nextStep)
    return true
  })
})

test('模型调用抛错时自动分类，不会把英文原文直接透出', async () => {
  const ctx = {
    get: (k) => {
      if (k === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) }
      if (k === 'llm') return { prepareCall: async () => { throw new Error(AUTH_RAW) } }
      return undefined
    },
  }
  await assert.rejects(() => callModel(ctx, { system: 's', user: 'u' }), (err) => {
    assert.equal(err.scope, 'host-model-auth')
    assert.ok(!err.message.includes('request_id'))
    return true
  })
})

test('已经分类过的错误不会被二次包装丢掉 scope', async () => {
  const first = classifyModelError(new Error(AUTH_RAW), { provider: 'p', model: 'm' })
  const ctx = {
    get: (k) => {
      if (k === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
      if (k === 'llm') return { prepareCall: async () => { throw first } }
      return undefined
    },
  }
  await assert.rejects(() => callModel(ctx, { system: 's', user: 'u' }), (err) => {
    assert.equal(err.scope, 'host-model-auth')
    return true
  })
})

// ---- 输出截断与 JSON 容错（真机实测踩到：reasoning 模型偶发把 JSON 写不完）----

test('输出被长度截断时给出可读原因，不写库', async () => {
  const ctx = {
    get: (k) => {
      if (k === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
      if (k === 'llm') {
        return {
          prepareCall: async () => ({
            config: {},
            stream: async function* () {
              yield { type: 'text-delta', text: '{"hook":"半句' }
              yield { type: 'finish', reason: { kind: 'max-tokens' } }
            },
          }),
        }
      }
      return undefined
    },
  }
  await assert.rejects(() => callModel(ctx, { system: 's', user: 'u' }), (err) => {
    assert.equal(err.scope, 'model-truncated')
    assert.match(err.message, /截断/)
    assert.ok(err.nextStep)
    return true
  })
})

test('只有思考过程、正文为空时报可读错误', async () => {
  const ctx = {
    get: (k) => {
      if (k === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
      if (k === 'llm') {
        return {
          prepareCall: async () => ({
            config: {},
            stream: async function* () {
              yield { type: 'text-delta', text: '   ' }
              yield { type: 'finish', reason: { kind: 'stop' } }
            },
          }),
        }
      }
      return undefined
    },
  }
  await assert.rejects(() => callModel(ctx, { system: 's', user: 'u' }), (err) => {
    assert.equal(err.scope, 'model-empty-output')
    assert.ok(err.nextStep)
    return true
  })
})

// ---- 推理强度降级：thinking 与正文共享 max_tokens 预算，高 effort 会把正文挤空 ----

test('支持 low 时把推理强度降到 low，给正文留预算', () => {
  const out = relaxReasoningEffort({ maxTokens: 6000 }, { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } })
  assert.equal(out.reasoningEffort, 'low')
  assert.equal(out.maxTokens, 6000)
})

test('模型不支持 low 时保持原样，不强行覆盖', () => {
  const controls = { maxTokens: 6000 }
  const out = relaxReasoningEffort(controls, { reasoning: { efforts: [{ id: 'high' }] } })
  assert.equal(out.reasoningEffort, undefined)
  assert.equal(out, controls)
})

test('没有 reasoning 能力的模型保持原样', () => {
  const controls = { maxTokens: 6000 }
  const out = relaxReasoningEffort(controls, {})
  assert.equal(out.reasoningEffort, undefined)
})

test('用户显式设定过 effort 时不覆盖', () => {
  const controls = { maxTokens: 6000, reasoningEffort: 'max' }
  const out = relaxReasoningEffort(controls, { reasoning: { efforts: [{ id: 'low' }] } })
  assert.equal(out.reasoningEffort, 'max')
})

test('JSON 尾随逗号能被修复', () => {
  const fixed = tryRepairJson('{"a":1,"b":[1,2,],}')
  assert.deepEqual(fixed, { a: 1, b: [1, 2] })
})

test('JSON 缺少闭合括号能被修复', () => {
  const fixed = tryRepairJson('{"a":"x","b":[1,2')
  assert.deepEqual(fixed, { a: 'x', b: [1, 2] })
})

test('JSON 末尾字符串未闭合能被修复', () => {
  const fixed = tryRepairJson('{"a":"没说完')
  assert.deepEqual(fixed, { a: '没说完' })
})

test('extractJson 对轻微损坏的输出仍能解析出结果', () => {
  const value = extractJson('这是前言 {"hook":"钩子","structure":["a","b",],} 后记')
  assert.equal(value.hook, '钩子')
  assert.deepEqual(value.structure, ['a', 'b'])
})

test('extractJson 完全无法解析时给出可读错误而非解析器原文', () => {
  assert.throws(() => extractJson('完全不是 JSON'), (err) => {
    assert.equal(err.scope, 'model-bad-output')
    assert.match(err.message, /不写库/)
    return true
  })
})

// ---- 正文里的裸英文引号（真机实测：模型偶尔不转义就写出来）----

test('正文里的裸英文引号能被转义修复', () => {
  const broken = '{"title":"他说"你好"然后走了","body":"正文"}'
  const fixed = tryRepairJson(broken)
  assert.ok(fixed, '应能修复')
  assert.equal(fixed.title, '他说"你好"然后走了')
  assert.equal(fixed.body, '正文')
})

test('正常 JSON 的字符串结束引号不会被误转义', () => {
  const good = '{"title":"正常标题","body":"内容"}'
  assert.equal(escapeInnerQuotes(good), good)
  assert.deepEqual(tryRepairJson(good), { title: '正常标题', body: '内容' })
})

test('结构正确的 JSON 原样解析不受影响', () => {
  const value = extractJson('{"items":[{"platform":"小红书","title":"标题","topics":["a","b"]}]}')
  assert.equal(value.items[0].platform, '小红书')
  assert.deepEqual(value.items[0].topics, ['a', 'b'])
})

test('提示词要求 JSON 内不用英文双引号', () => {
  assert.match(OUTPUT_RULE_TEXT, /不要出现英文双引号/)
})
