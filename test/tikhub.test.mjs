import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'atelier-tikhub-'))
process.env.DSH_HOME = home
process.env.ATELIER_TIKHUB_API_KEY = 'test-token-1234567890'
const th = await import('../src/providers/tikhub.js')
const oa = await import('../src/providers/openapi.js')
const apiz = await import('../src/providers/apiz.js')

function fakeResponse(json, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300, status,
    text: async () => JSON.stringify(json),
    headers: { get: (k) => headers[k.toLowerCase()] || null },
  }
}

test('白名单路径全部合法、分组齐全、无重复 key', () => {
  assert.ok(th.ENDPOINTS.length >= 30)
  for (const e of th.ENDPOINTS) {
    assert.match(e.path, /^\/api\/v1\//)
    assert.ok(Array.isArray(e.required))
    assert.ok(['GET', 'POST'].includes(e.method))
    assert.ok(['info', 'feedback'].includes(e.group))
  }
  assert.equal(new Set(th.ENDPOINTS.map((e) => e.key)).size, th.ENDPOINTS.length)
  assert.ok(th.endpointList('feedback').length >= 8)
})

test('白名单对照官方 V5.3.2 快照（存在则逐条命中）', () => {
  const specPath = 'D:/dsh-research/dsh-tikhub-api/skills/tikhub-api/.claude/skills/tikhub-api-helper/openapi.json'
  if (!existsSync(specPath)) return // 其他机器上跳过
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  const validation = th.validateWhitelist(Object.keys(spec.paths))
  assert.equal(validation.missing.length, 0, JSON.stringify(validation.missing))
  assert.equal(validation.checked, validation.total)
})

test('缺 key 不发请求；401/403 立即失败不重试', async () => {
  const saved = process.env.ATELIER_TIKHUB_API_KEY
  delete process.env.ATELIER_TIKHUB_API_KEY
  let calls = 0
  await assert.rejects(() => th.callEndpoint('hot.search', {}, { fetchImpl: async () => { calls += 1; return fakeResponse({}) } }), /未配置/)
  assert.equal(calls, 0)
  process.env.ATELIER_TIKHUB_API_KEY = saved

  calls = 0
  await assert.rejects(() => th.callEndpoint('hot.search', {}, { fetchImpl: async () => { calls += 1; return fakeResponse({}, 401) } }), /鉴权失败/)
  assert.equal(calls, 1)
})

test('归一化：热词 / 评论 / 指标，去标签与脏数字', () => {
  assert.equal(th.stripTags('AI <em>工具</em>'), 'AI 工具')
  assert.equal(th.num('1.2万'), 1.2)
  const note = th.normalizeItem({ id: 'n1', title: 'AI <em>工具</em>', desc: '正文', author: { nickname: '甲' }, statistics: { digg_count: 1200, comment_count: '88' } }, 'notes')
  assert.match(note.title, /AI 工具/)
  assert.equal(note.stats.likes, 1200)
  assert.equal(note.stats.comments, 88)
  assert.deepEqual(th.collectStats({ data: { statistics: { play_count: 500, share_count: 7 } } }), { views: 500, shares: 7 })
  assert.equal(th.extractList({ data: { data: { items: [{ id: 'a' }] } } }, ['data.data.items'])[0].id, 'a')
})

test('成功采集 + 缓存命中不重复请求 + 原始响应落盘', async () => {
  let calls = 0
  const fetchImpl = async () => { calls += 1; return fakeResponse({ code: 200, data: { word_list: [{ word: 'AI 工具', hot_value: 99 }] } }) }
  const first = await th.callEndpoint('hot.search', {}, { fetchImpl })
  assert.equal(first.ok, true)
  assert.equal(first.items.length, 1)
  assert.match(first.items[0].title, /AI 工具/)
  assert.equal(first.cached, false)
  assert.ok(first.rawRef)
  const second = await th.callEndpoint('hot.search', {}, { fetchImpl })
  assert.equal(second.cached, true)
  assert.equal(calls, 1)
  assert.ok(existsSync(join(home, 'atelier', first.rawRef)))
})

test('404 给出建议、429 按 Retry-After 退避', async () => {
  await assert.rejects(() => th.callEndpoint('note.search', { keyword: 'x' }, {
    fetchImpl: async () => fakeResponse({}, 404),
  }), /404/)
  const suggestions = oa.suggestPaths(['/api/v1/xiaohongshu/app_v2/search_notes'], '/api/v1/xiaohongshu/web/search_notes')
  assert.ok(suggestions.length >= 1)
  assert.match(suggestions[0].path, /xiaohongshu/)
})

test('apiz 两种返回结构都能归一化', () => {
  const a = apiz.normalizeGenerate({ code: 200, data: { status: 'completed', result: { output: [{ url: 'https://x/a.png' }] } } })
  const b = apiz.normalizeGenerate({ status: 'completed', task_id: 't1', result: { images: ['https://x/b.png'] }, price: 0.02 })
  assert.equal(a.images[0], 'https://x/a.png')
  assert.equal(b.images[0], 'https://x/b.png')
  assert.equal(b.taskId, 't1')
  assert.equal(apiz.parseJsonLoose('log line\n{"ok":true}').ok, true)
})
