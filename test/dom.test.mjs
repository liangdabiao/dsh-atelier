// 无浏览器依赖的 DOM 冒烟：用最小 DOM 桩真实跑一遍 7 个页面的渲染，
// 抓「语法通过但一点就炸」的运行时错误（属性访问、参数形状、闭包引用等）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const code = readFileSync(join(root, 'gallery/app.js'), 'utf8')

function node(tag) {
  const n = {
    tagName: String(tag || 'div').toUpperCase(), children: [], attrs: {}, style: {}, dataset: {},
    className: '', value: '', checked: false, name: '', disabled: false, hidden: false,
    scrollTop: 0, listeners: {}, _text: '',
    setAttribute(k, v) { this.attrs[k] = String(v) },
    getAttribute(k) { return this.attrs[k] },
    appendChild(c) {
      if (c == null || c === false) return c
      if (Array.isArray(c)) { c.forEach((x) => this.appendChild(x)); return c }
      if (typeof c === 'string' || typeof c === 'number') { this.children.push({ textNode: String(c), children: [] }); return c }
      this.children.push(c)
      return c
    },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn) },
    querySelectorAll() { return [] },
    scrollIntoView() {},
    click() { (this.listeners.click || []).forEach((fn) => fn({})) },
    get firstChild() { return this.children[0] },
    get textContent() {
      return this.children.map((c) => c.textNode != null ? c.textNode : (c.textContent || '')).join('')
    },
    set textContent(v) { this.children = []; this._text = String(v == null ? '' : v) },
  }
  return n
}

function flatText(n) {
  if (!n) return ''
  return (n._text || '') + (n.textNode || '') + (n.children || []).map(flatText).join('')
}

const endpoints = [
  { key: 'hot.search', label: '抖音热搜词', group: 'info', platform: 'douyin', cost: 'low', path: '/api/v1/douyin/web/fetch_hot_search_result', required: [], defaults: {}, fields: [] },
  { key: 'note.search', label: '小红书笔记搜索', group: 'info', platform: 'xiaohongshu', cost: 'low', path: '/api/v1/xiaohongshu/app_v2/search_notes', required: ['keyword'], defaults: {}, fields: [
    { key: 'keyword', label: '搜索关键词', required: true, type: 'text', defaultValue: '', advanced: false, hint: '想找什么就写什么', placeholder: '想找什么就写什么' },
  ] },
  { key: 'hot.total', label: '抖音综合热榜', group: 'info', platform: 'douyin', cost: 'low', path: '/api/v1/douyin/billboard/fetch_hot_total_list', required: ['page', 'page_size', 'type'], defaults: { page: 1 }, fields: [
    { key: 'page', label: '页码', required: true, type: 'number', defaultValue: '1', advanced: true, hint: '', placeholder: 'page' },
  ] },
  { key: 'comments.douyin.app', label: '抖音评论', group: 'info', platform: 'douyin', cost: 'high', path: '/api/v1/douyin/app/v3/fetch_video_comments', required: ['aweme_id'], defaults: {}, fields: [
    { key: 'workId', label: '作品 ID', required: true, type: 'text', defaultValue: '', advanced: false, hint: '', placeholder: 'aweme_id' },
  ] },
]
const state = {
  signals: [{ id: 'sig_demo', platform: 'douyin', title: '一条热词', endpoint: 'hot.search', fetchedAt: new Date().toISOString(), baselineStats: { hot: 10 }, platformWorkId: '7345492945006595379' }],
  evidence: [{ id: 'evi_demo', kind: 'quote', text: '用户原话', endpoint: 'hot.search', fetchedAt: new Date().toISOString() }],
  sources: [], campaigns: [], deconstructions: [{ id: 'dec_1', hook: '先给数字', pattern: '对比', evidenceRefs: ['evi_demo'], structure: ['开头', '论证'], createdAt: new Date().toISOString() }],
  angles: [{ id: 'ang_1', kind: '反常识', title: '别再神话 AI', rationale: '因为门槛被忽略', createdAt: new Date().toISOString() }],
  drafts: [{ id: 'dra_1', title: '母稿示例', body: '正文内容', platform: '母稿', versionNo: 1, changeLog: '初稿', createdAt: new Date().toISOString(), topics: ['AI'], specCheck: { matched: true, ok: false, displayName: '抖音', issues: [{ message: '标题超长' }] } }],
  assessments: [{ draftId: 'dra_1', dimensions: { 结构: 8 }, note: '仅质量诊断', specCheck: { issues: [{ message: '标题超长' }] } }],
  assets: [], predictions: [], publishedWorks: [{ id: 'work_1', kind: 'published', platform: 'douyin', workId: '7000000000000000001', tnPlan: [1, 3, 7], followups: [], createdAt: new Date().toISOString() }],
  benchmarkWatch: [], snapshots: [{ id: 'snap_1', platform: 'douyin', workId: '7000000000000000001', day: 1, origin: 'api', metrics: { likes: 12 }, fetchedAt: new Date().toISOString() }],
  retros: [], rules: [{ id: 'rule_1', name: '开头给数字', text: '第一段放真实数字', status: 'proposed', evidenceIds: [] }],
  relations: [], contextRuns: [], apiCalls: [],
  automation: { schedules: [{ key: '7000000000000000001::1', day: 1, at: new Date().toISOString() }], runs: [{ key: 'x', day: 1, workId: 'w', ok: true, summary: 'ok', ts: new Date().toISOString() }], lastSweep: '' },
}
const health = {
  ok: true, summary: '信号 1 / 证据 1 / 稿件 1',
  counts: { signals: 1, evidence: 1, drafts: 1, snapshots: 1 },
  tikhub: { configured: true, tokenMasked: 'tk****1234', source: 'settings.json', rpm: 30, perEndpointRps: 5, cacheTtl: 1800, apizBin: '', defaultImageModel: '', maxImagesPerRun: 3, proxyUrl: '' },
  spec: { checked: true, version: 'V5.3.2', pathCount: 1067 }, platformSpecs: { count: 15, advisory: true, verified: false },
  actions: [{ key: 'capture', label: '记灵感', ai: false, needsConfirm: false }],
}
const payloads = {
  '/api/health': health, '/api/state': state, '/api/endpoints': endpoints,
  '/api/actions': health.actions, '/api/spec': { status: health.spec, validation: { checked: 31, total: 31, missing: [] } },
  '/api/automation': { serviceAvailable: true, sessionAvailable: true, reminderEnabled: true, autoEnabled: false, autoCostsCredits: true, schedules: state.automation.schedules, runs: state.automation.runs, lastSweep: '', due: [] },
}

function boot() {
  const ids = {}
  for (const id of ['nav', 'pageTitle', 'pageSub', 'view', 'toast', 'result', 'navStatus', 'btnRefresh', 'btnGuide', 'btnAgent', 'busy']) ids[id] = node('div')
  const document = {
    getElementById: (id) => ids[id] || (ids[id] = node('div')),
    createElement: (tag) => node(tag),
    createTextNode: (text) => ({ textNode: String(text), children: [] }),
    querySelectorAll: () => [],
    documentElement: node('html'), body: node('body'),
  }
  const sandbox = {
    document, console,
    window: { addEventListener() {}, confirm: () => false, matchMedia: () => ({ matches: false }) },
    location: { origin: 'http://localhost' },
    navigator: { clipboard: null },
    parent: { postMessage() {} },
    fetch: async (url) => {
      const path = String(url).replace('/atelier', '')
      if (!(path in payloads)) throw new Error('未预期的请求 ' + path)
      return { ok: true, status: 200, json: async () => payloads[path] }
    },
    setTimeout: (fn, ms) => (Number(ms) > 1000 ? 0 : setTimeout(fn, 0)),
    clearTimeout: (t) => clearTimeout(t),
    Blob: class {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  }
  vm.runInNewContext(code, sandbox, { filename: 'gallery/app.js' })
  return ids
}

test('7 个页面都能真实渲染，无「渲染出错」与接口失败', async () => {
  const ids = boot()
  await new Promise((r) => setTimeout(r, 60))
  assert.ok(ids.view.children.length > 0, '总台应渲染出内容')
  const labels = []
  for (const btn of ids.nav.children.slice()) {
    labels.push(flatText(btn).trim())
    assert.doesNotThrow(() => btn.click(), '切换页面不应抛异常：' + flatText(btn))
    const text = flatText(ids.view)
    assert.ok(!text.includes('渲染出错'), '页面出现渲染出错：' + flatText(btn) + ' → ' + text.slice(0, 200))
    assert.ok(ids.view.children.length > 0, '页面不能空白：' + flatText(btn))
  }
  assert.equal(labels.length, 7, '应有 7 个导航项')
  assert.ok(!flatText(ids.toast).includes('读取插件接口失败'), '接口读取不应失败')
})

test('页面里不再出现「参数（JSON）」这类要求用户手写 JSON 的文案', () => {
  assert.ok(!/参数（JSON）|手工补录指标（JSON/.test(code))
  assert.ok(code.includes('platformWorkId'), '信号卡片要用真实作品 ID')
  assert.ok(code.includes('使用说明'), '要有使用说明页')
  assert.ok(code.includes('runNow'), '要有自动化立即检查')
})
