import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'atelier-pipeline-'))
process.env.DSH_HOME = home
process.env.ATELIER_TIKHUB_API_KEY = 'test-token-1234567890'
const store = await import('../src/store.js')
const pipeline = await import('../src/pipeline.js')
const { createTools } = await import('../src/tools.js')
const { createSkillProvider } = await import('../src/skills.js')

function fakeResponse(json, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(json), headers: { get: () => null } }
}
const mockFetch = async () => fakeResponse({ code: 200, data: { word_list: [{ word: 'AI 工具的真实门槛', hot_value: 100 }] } })

test('capture 写库，工具写入与接口写入共用同一条链路', async () => {
  const before = store.readState().sources.length
  const viaAction = await pipeline.runAction({}, 'capture', { content: '接口写入' })
  assert.equal(viaAction.ok, true)
  const [tool] = createTools({})
  const viaTool = await tool.execute({ action: 'capture', payload: JSON.stringify({ content: '工具写入' }) })
  assert.equal(viaTool.ok, true)
  const state = store.readState()
  assert.equal(state.sources.length, before + 2)
  assert.ok(state.sources.some((s) => s.content === '接口写入'))
  assert.ok(state.sources.some((s) => s.content === '工具写入'))
})

test('radar 采集生成 signals + evidence + 调用留痕，重复采集不重复入库', async () => {
  const first = await pipeline.runAction({}, 'radar', { endpointKey: 'hot.search', params: {}, limit: 10 }, { fetchImpl: mockFetch })
  assert.equal(first.ok, true)
  assert.equal(first.data.added, 1)
  const second = await pipeline.runAction({}, 'radar', { endpointKey: 'hot.search', params: {}, limit: 10 }, { fetchImpl: mockFetch })
  assert.equal(second.data.added, 0)
  const state = store.readState()
  assert.ok(state.signals.length >= 1)
  assert.ok(state.evidence.length >= 1)
  assert.equal(state.evidence[0].endpoint, 'hot.search')
  assert.ok(state.apiCalls.some((c) => c.endpoint === 'hot.search'))
})

test('高成本动作未确认时被拦住、dryRun 不写库', async () => {
  const before = store.readState().signals.length
  const blocked = await pipeline.runAction({}, 'radar', { endpointKey: 'comments.douyin.app', params: { workId: 'x' } }, { fetchImpl: mockFetch })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.needsConfirm, true)
  const preview = await pipeline.runAction({}, 'radar', { endpointKey: 'hot.search', params: {}, dryRun: true }, { fetchImpl: mockFetch })
  assert.equal(preview.ok, true)
  assert.ok(preview.data.endpoint)
  assert.equal(store.readState().signals.length, before)
})

test('feedback：manual 与 api_failed 分别标注 origin，复盘不混算', async () => {
  await pipeline.runAction({}, 'watch', { kind: 'published', platform: 'douyin', workId: '7000000000000000001' })
  const manual = await pipeline.runAction({}, 'feedback', { workId: '7000000000000000001', day: 1, manual: { views: 1000, likes: 30 } })
  assert.equal(manual.ok, true)
  assert.equal(manual.data.snapshot.origin, 'manual')

  await pipeline.runAction({}, 'watch', { kind: 'published', platform: 'wechat', workId: 'wx-1' })
  const failed = await pipeline.runAction({}, 'feedback', { workId: 'wx-1', day: 1 })
  assert.equal(failed.ok, true)
  assert.equal(failed.data.snapshot.origin, 'api_failed')

  const state = store.readState()
  assert.ok(state.snapshots.some((s) => s.origin === 'manual'))
  assert.ok(state.snapshots.some((s) => s.origin === 'api_failed'))
})

test('predict 锁定后不可覆盖；retro 按 origin 分组', async () => {
  await store.mutate((s) => { store.addRecord(s, 'drafts', { id: 'draft_test', title: '测试稿', platform: '母稿', versionNo: 1, body: '正文', campaignId: 'c1' }) })
  const first = await pipeline.runAction({}, 'predict', { draftId: 'draft_test', dimensions: { 传播预期: '中' }, hypothesis: '会有讨论' })
  assert.equal(first.ok, true)
  assert.ok(first.data.prediction.integrityHash)
  const second = await pipeline.runAction({}, 'predict', { draftId: 'draft_test', dimensions: { 传播预期: '高' }, hypothesis: '改口' })
  assert.equal(second.ok, false)
  assert.match(second.error, /不可覆盖/)
  const retro = await pipeline.runAction({}, 'retro', { predictionId: first.data.prediction.id })
  assert.equal(retro.ok, true)
  assert.equal(retro.data.retro.groups.manual, 1)
  assert.equal(retro.data.retro.groups.apiFailed, 1)
  assert.equal(retro.data.retro.groups.api, 0)
})

test('规则必须人工审核激活后才进 Skill addendum', async () => {
  const added = await pipeline.runAction({}, 'rule', { op: 'add', name: '开头先给反例', text: '前 3 句先摆一个反例' })
  const id = added.data.rule.id
  const provider = createSkillProvider()
  const before = await provider.get({ name: 'atelier-workflow' })
  assert.doesNotMatch(before.content, /开头先给反例：前 3 句/)
  const active = await pipeline.runAction({}, 'rule', { op: 'activate', id })
  assert.equal(active.ok, true)
  const after = await provider.get({ name: 'atelier-workflow' })
  assert.match(after.content, /开头先给反例/)
  assert.match(after.content, /已审核激活的写作规则/)
})

test('模型不可用时 ai 动作显式失败，不用模板稿冒充成功', async () => {
  await store.mutate((s) => { store.addRecord(s, 'angles', { id: 'angle_test', title: '同问题异观点', kind: '同问题异观点', selected: true }) })
  const result = await pipeline.runAction({}, 'draft', { angleId: 'angle_test' })
  assert.equal(result.ok, false)
  assert.match(result.error, /没有可用模型/)
  assert.ok(result.nextStep)
  assert.equal(store.readState().drafts.filter((d) => d.title === '假稿').length, 0)
})

test('spec 状态与只读查询可用', async () => {
  const spec = await pipeline.runAction({}, 'spec', {})
  assert.equal(spec.ok, true)
  assert.ok(spec.data.endpoints.length >= 30)
  const q = pipeline.queryState('snapshots', {})
  assert.equal(q.ok, true)
  assert.match(q.summary, /snapshots/)
  const bad = pipeline.queryState('不存在', {})
  assert.equal(bad.ok, false)
})
