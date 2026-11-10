// 模型连通性自检与 health 暴露模型信息的回归测试。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'atelier-model-'))
process.env.DSH_HOME = home

const pipeline = await import('../src/pipeline.js')

const AUTH_RAW = 'Authentication Fails, Your api key: ****0734 is invalid (request_id: 3c4f6a0f)'

function ctxWith({ provider = 'deepseek-official', model = 'deepseek-flash', fail = null, chunks = [] } = {}) {
  return {
    get: (k) => {
      if (k === 'agentDefaultModel') return { currentSelection: () => ({ provider, model }) }
      if (k === 'llm') {
        return {
          prepareCall: async () => {
            if (fail) throw new Error(fail)
            return {
              config: {},
              stream: async function* () {
                for (const c of chunks) yield c
              },
            }
          },
        }
      }
      return undefined
    },
  }
}

test('modelcheck 成功时回报当前 provider / model', async () => {
  const res = await pipeline.runAction(ctxWith({ chunks: [{ type: 'text-delta', text: 'ok' }] }), 'modelcheck', {})
  assert.equal(res.ok, true)
  assert.equal(res.data.provider, 'deepseek-official')
  assert.equal(res.data.model, 'deepseek-flash')
  assert.match(res.summary, /连通正常/)
})

test('modelcheck 遇到鉴权失败时返回可执行的中文指引，并标明是宿主问题', async () => {
  const res = await pipeline.runAction(ctxWith({ fail: AUTH_RAW }), 'modelcheck', {})
  assert.equal(res.ok, false)
  assert.equal(res.scope, 'host-model-auth')
  assert.match(res.error, /宿主模型鉴权失败/)
  assert.ok(res.nextStep && res.nextStep.length > 0)
  assert.equal(res.data.provider, 'deepseek-official')
})

test('没有默认模型时 modelcheck 明确指向 dsh 设置', async () => {
  const ctx = { get: (k) => (k === 'llm' ? {} : undefined) }
  const res = await pipeline.runAction(ctx, 'modelcheck', {})
  assert.equal(res.ok, false)
  assert.equal(res.scope, 'host-model-missing')
  assert.match(res.nextStep, /dsh/)
})

test('health 暴露当前 provider / model 与可用性', () => {
  const h = pipeline.health(undefined, ctxWith({ provider: 'deepseek-account', model: 'deepseek-flash' }))
  assert.equal(h.model.available, true)
  assert.equal(h.model.provider, 'deepseek-account')
  assert.equal(h.model.model, 'deepseek-flash')
  assert.match(h.model.note, /不配置任何模型密钥/)
})

test('没有模型时 health 标为不可用并给出提示', () => {
  const h = pipeline.health(undefined, { get: () => undefined })
  assert.equal(h.model.available, false)
  assert.ok(h.model.hint && h.model.hint.length > 0)
})

test('AI 类动作失败时返回 scope，页面据此分流', async () => {
  const res = await pipeline.runAction(ctxWith({ fail: AUTH_RAW }), 'deconstruct', { evidenceIds: [] })
  assert.equal(res.ok, false)
  // 没有证据时是先在业务层失败，不该是宿主模型错误
  assert.notEqual(res.scope, 'host-model-auth')
})

test('modelcheck 已注册为可调用的动作', () => {
  assert.ok(pipeline.ACTIONS.modelcheck, 'modelcheck 必须在 ACTIONS 里')
  assert.equal(pipeline.ACTIONS.modelcheck.ai, false)
})
