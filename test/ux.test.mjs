// 用户体验改造的回归测试：不用写 JSON、不用填 id、自动化默认不花钱。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'atelier-ux-'))
process.env.DSH_HOME = home
process.env.ATELIER_TIKHUB_API_KEY = 'test-token-1234567890'

const { fieldsFor, buildParams, PRESETS } = await import('../src/providers/endpoint-fields.js')
const { endpointDetails, endpointList } = await import('../src/providers/tikhub.js')
const { normalizePayload, createTools } = await import('../src/tools.js')
const { readSettings, saveSettings, settingsFile } = await import('../src/settings.js')
const { dueTasks, sweep, createTnReminders, automationStatus, ensureReminders } = await import('../src/schedule.js')
const store = await import('../src/store.js')
const pipeline = await import('../src/pipeline.js')

const byKey = (key) => endpointDetails().find((e) => e.key === key)

test('端点参数自动生成中文主字段，搜索类必填不再需要写 JSON', () => {
  const fields = fieldsFor(byKey('note.search'))
  const keyword = fields.find((f) => f.key === 'keyword')
  assert.ok(keyword, '应有 keyword 字段')
  assert.equal(keyword.label, '搜索关键词')
  assert.equal(keyword.required, true)
  assert.equal(keyword.advanced, false)
  assert.equal(fields.some((f) => f.type === 'json'), false)
})

test('榜单类翻页参数收进「更多参数」并带默认值', () => {
  const fields = fieldsFor(byKey('hot.total'))
  for (const key of ['page', 'pageSize', 'type']) {
    const f = fields.find((x) => x.key === key)
    assert.ok(f, `缺少 ${key}`)
    assert.equal(f.required, true)
    assert.equal(f.advanced, true)
    assert.notEqual(f.defaultValue, '')
  }
})

test('buildParams 过滤空值、数字字段转数字', () => {
  const spec = byKey('note.search')
  assert.deepEqual(buildParams({ keyword: '  内容创作  ' }, spec), { keyword: '内容创作' })
  assert.deepEqual(buildParams({ keyword: '' }, spec), {})
  const hot = byKey('hot.total')
  assert.deepEqual(buildParams({ page: '2', pageSize: '10' }, hot), { page: 2, pageSize: 10 })
})

test('每个预设都能在白名单里找到，且参数键合法', () => {
  const keys = new Set(endpointList().map((e) => e.key))
  for (const p of PRESETS) {
    assert.ok(keys.has(p.key), `预设端点不存在：${p.key}`)
    const allowed = new Set(fieldsFor(byKey(p.key)).map((f) => f.key))
    for (const k of Object.keys(p.params)) assert.ok(allowed.has(k), `${p.key} 的参数 ${k} 不在字段表里`)
  }
})

test('工具 payload 直接传对象，旧的字符串写法仍兼容', async () => {
  assert.deepEqual(normalizePayload({ a: 1 }), { a: 1 })
  assert.deepEqual(normalizePayload('{"a":1}'), { a: 1 })
  assert.deepEqual(normalizePayload(''), {})
  assert.throws(() => normalizePayload('not json'))
  const [tool] = createTools({})
  const objectCall = await tool.execute({ action: 'capture', payload: { content: '对象写法' } })
  assert.equal(objectCall.ok, true)
  const stringCall = await tool.execute({ action: 'capture', payload: JSON.stringify({ content: '字符串写法' }) })
  assert.equal(stringCall.ok, true)
  assert.ok(store.readState().sources.some((s) => s.content === '对象写法'))
})

test('信号落库保留真实作品 ID，且绝不把 signal.id 当作品 ID', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200, headers: { get: () => null },
    text: async () => JSON.stringify({ code: 200, data: { word_list: [{ word: '一条热词', hot_value: 10 }] } }),
  })
  await pipeline.runAction({}, 'radar', { endpointKey: 'hot.search', params: {}, limit: 5 }, { fetchImpl })
  const signal = store.readState().signals.at(-1)
  assert.ok(signal)
  assert.equal(typeof signal.platformWorkId, 'string')
  assert.notEqual(signal.platformWorkId, signal.id, '作品 ID 不能是标题哈希')
  assert.equal(signal.platformWorkId, '', '热词不是具体作品，不能提供「取详情 / 设为对标」')
})

test('带平台作品 ID 的采集结果会存下真实 ID，供按 ID 回查', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200, headers: { get: () => null },
    text: async () => JSON.stringify({ code: 200, data: { data: [{ aweme_id: '7345492945006595379', desc: '一条真实作品' }] } }),
  })
  const res = await pipeline.runAction({}, 'radar', { endpointKey: 'hot.search', params: {}, limit: 5 }, { fetchImpl, noCache: true })
  assert.equal(res.ok, true)
  const signal = store.readState().signals.find((s) => s.title === '一条真实作品')
  assert.ok(signal, '应入库这条作品信号')
  assert.equal(signal.platformWorkId, '7345492945006595379')
})

test('从信号一键登记对标：用 platformWorkId，而不是 sig_ 哈希', async () => {
  await store.mutate((state) => {
    store.addRecord(state, 'signals', {
      id: 'sig_manual_fixture', platform: 'douyin', title: '某条作品', endpoint: 'video.search',
      platformWorkId: '7345492945006595379', fetchedAt: new Date().toISOString(),
    })
  })
  const res = await pipeline.runAction({}, 'watch', { kind: 'benchmark', platform: 'douyin', signalId: 'sig_manual_fixture' })
  assert.equal(res.ok, true)
  assert.equal(res.data.work.workId, '7345492945006595379')
  const noWork = await pipeline.runAction({}, 'watch', { kind: 'benchmark', platform: 'douyin', signalId: 'sig_not_exist' })
  assert.equal(noWork.ok, false)
})

test('导出同时返回可下载内容，不再只给本机路径', async () => {
  await store.mutate((state) => {
    store.addRecord(state, 'drafts', {
      campaignId: '', platform: '母稿', versionNo: 1, parentId: '', title: '可下载稿件',
      body: '正文内容', outline: [], changeLog: '', evidenceIds: [], status: 'draft',
    })
  })
  const draft = store.readState().drafts.find((d) => d.title === '可下载稿件')
  const res = await pipeline.runAction({}, 'export', { draftId: draft.id, format: 'md' })
  assert.equal(res.ok, true)
  assert.match(res.data.content, /可下载稿件/)
  assert.match(res.data.content, /正文内容/)
  assert.equal(res.data.filename, '可下载稿件.md')
})

test('设置里的布尔开关存成真布尔，自动回查默认关闭', () => {
  assert.equal(readSettings().feedbackAutoEnabled, false)
  saveSettings({ feedbackAutoEnabled: true, tnReminderEnabled: false })
  assert.equal(readSettings().feedbackAutoEnabled, true)
  assert.equal(readSettings().tnReminderEnabled, false)
  saveSettings({ feedbackAutoEnabled: 'false', tnReminderEnabled: 'true' })
  assert.equal(readSettings().feedbackAutoEnabled, false)
  assert.equal(readSettings().tnReminderEnabled, true)
})

test('0.1.x 旧配置残留不会让「自动回查」在升级后默认打开', () => {
  writeFileSync(settingsFile(), JSON.stringify({ tikhubKey: 'test-token-1234567890', feedbackAutoEnabled: true }))
  assert.equal(readSettings().feedbackAutoEnabled, false, '旧文件的 true 是无效残留，不能替用户花额度')
  saveSettings({ tnReminderEnabled: true })
  writeFileSync(settingsFile(), JSON.stringify({ tikhubKey: 'test-token-1234567890', tnReminderEnabled: true, feedbackAutoEnabled: true }))
  assert.equal(readSettings().feedbackAutoEnabled, true, '新配置里用户显式开的 true 要保留')
  saveSettings({ feedbackAutoEnabled: false })
})

test('没有活跃会话时补建提醒返回 0，不假装创建成功', async () => {
  assert.equal(await ensureReminders({}), 0)
})

test('到期任务按 T+N 计算，已有快照或重试用尽不再重复', async () => {
  const past = new Date(Date.now() - 4 * 86_400_000).toISOString()
  await store.mutate((state) => {
    state.publishedWorks = [{
      id: 'work_1', platform: 'wechat', workId: 'wx-auto-1', kind: 'published',
      publishedAt: past, createdAt: past, tnPlan: [1, 3, 7], watchEnabled: true, followups: [],
    }]
    state.snapshots = []
    state.automation = { schedules: [], runs: [], lastSweep: '' }
  })
  const tasks = dueTasks()
  assert.deepEqual(tasks.map((t) => t.day), [1, 3])
  assert.equal(tasks[0].workId, 'wx-auto-1')
  await store.mutate((state) => {
    state.automation.runs = [
      { key: 'wx-auto-1::1' }, { key: 'wx-auto-1::1' },
    ]
  })
  assert.deepEqual(dueTasks().map((t) => t.day), [3], '同一任务重试 2 次后不再排队')
})

test('自动回查未开启时 sweep 明确跳过，不偷偷花额度', async () => {
  const res = await sweep({})
  assert.equal(res.skipped, true)
  assert.equal(res.count, 0)
  assert.match(res.reason, /未开启/)
})

test('宿主没有 schedule 服务时如实返回原因，不假装创建成功', async () => {
  const res = await createTnReminders({}, { id: 'work_1', workId: 'wx-auto-1', platform: 'wechat', tnPlan: [1] })
  assert.equal(res.ok, false)
  assert.match(res.reason, /schedule|会话/)
  const status = automationStatus({})
  assert.equal(status.serviceAvailable, false)
  assert.equal(status.autoEnabled, false)
  assert.equal(status.autoCostsCredits, true)
})

test('queryState 能查自动化记录', () => {
  const res = pipeline.queryState('automation', {})
  assert.equal(res.ok, true)
  assert.ok(Array.isArray(res.data.schedules))
})
