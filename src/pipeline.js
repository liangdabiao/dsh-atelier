// 业务动作总入口：对话工具与页面 /api/ops 共用这一份逻辑，保证「工具写入 = 接口写入」。
// 需要模型的动作一律显式失败，不用模板稿冒充成功；需要计费的动作必须显式 confirm。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as store from './store.js'
import { callEndpoint, endpoint, endpointList, feedbackEndpointFor, validateWhitelist, collectStats, BASE_URL } from './providers/tikhub.js'
import { specStatus, fetchLiveSpec, specPaths, suggestPaths } from './providers/openapi.js'
import { platformSpec, platformSpecDoc, allPlatformSpecs, normalizeTopics, checkDraftAgainstSpec, normalizeMetrics, specsForPrompt } from './providers/platform-specs.js'
import * as apiz from './providers/apiz.js'
import { callModel, buildPrompt, extractJson, sanitize, modelInfo } from './ai.js'
import { publicSettings, saveSettings, clearSettings, ensureDirs, dataDir } from './settings.js'

export const ACTIONS = {
  capture: { label: '记灵感 / 贴素材', ai: false, needsConfirm: false },
  radar: { label: 'TikHub 多源采集', ai: false, needsConfirm: false },
  evidence: { label: '拉详情 / 评论做证据', ai: false, needsConfirm: false },
  deconstruct: { label: '内容拆解', ai: true, needsConfirm: false },
  angles: { label: '差异化方向', ai: true, needsConfirm: false },
  draft: { label: '出稿', ai: true, needsConfirm: false },
  review: { label: '稿件体检', ai: true, needsConfirm: false },
  derive: { label: '多渠道派生', ai: true, needsConfirm: false },
  watch: { label: '登记作品 / 对标', ai: false, needsConfirm: false },
  predict: { label: '发布前盲判断（锁定）', ai: true, needsConfirm: false },
  feedback: { label: 'T+N 指标回查', ai: false, needsConfirm: false },
  retro: { label: '复盘校准', ai: false, needsConfirm: false },
  rule: { label: '规则建议 / 审核', ai: false, needsConfirm: false },
  image: { label: 'apiz 生图', ai: false, needsConfirm: true },
  spec: { label: '端点校验 / 平台规格', ai: false, needsConfirm: false },
  export: { label: '导出稿件', ai: false, needsConfirm: false },
}

const AI_ACTIONS = new Set(['deconstruct', 'angles', 'draft', 'review', 'derive', 'predict', 'retro'])

function ok(summary, data = {}) { return { ok: true, summary, data } }
function fail(error, nextStep = '') {
  const err = new Error(error)
  err.nextStep = nextStep
  throw err
}
function need(value, name) {
  if (value === undefined || value === null || value === '') fail(`缺少参数 ${name}`)
  return value
}
function clampInt(value, min, max, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback
}

function evidenceBrief(state, ids = []) {
  const set = new Set(ids)
  return state.evidence
    .filter((e) => !ids.length || set.has(e.id))
    .slice(-60)
    .map((e) => ({ id: e.id, kind: e.kind, text: String(e.text || '').slice(0, 400), sourceUrl: e.url, platform: e.platform }))
}

function activeRuleBlock(state) {
  const rules = store.activeRules(state)
  if (!rules.length) return ''
  return `\n必须遵守作者已审核激活的写作规则：\n${rules.map((r) => `- ${r.name}：${r.text}`).join('\n')}`
}

/** 把模型输出收敛到白名单字段，防注入与超长。 */
async function modelJson(ctx, action, context) {
  const { system, user } = buildPrompt(action, context)
  const { text, model } = await callModel(ctx, { system, user })
  const parsed = extractJson(text)
  return { value: sanitize(parsed), model }
}

function pushCall(state, record) {
  if (!record) return
  state.apiCalls.unshift({ id: store.uid('call'), ...record })
  state.apiCalls = state.apiCalls.slice(0, 200)
}

function itemsToEvidence(state, result, signalId, extra = {}) {
  const made = []
  for (const item of result.items.slice(0, 30)) {
    const kind = result.group === 'feedback' || item.kind === 'metrics' ? 'stat' : item.kind === 'comments' ? 'comment' : 'quote'
    made.push(store.addRecord(state, 'evidence', {
      signalId: signalId || '',
      kind,
      text: (item.text || item.title || '').slice(0, 1200),
      title: item.title,
      author: item.author,
      url: item.url || '',
      platform: result.platform,
      endpoint: result.key,
      params: result.params,
      rawRef: result.rawRef,
      fetchedAt: result.fetchedAt,
      stats: item.stats || {},
      unverified: Boolean(result.unverified),
      ...extra,
    }))
  }
  return made
}

// ---------------------------------------------------------------------------
// 各动作实现（每个返回 {ok, summary, data}；写库统一走 store.mutate）
// ---------------------------------------------------------------------------

async function doCapture(payload) {
  const content = String(need(payload.content, 'content')).slice(0, 8000)
  return store.mutate((state) => {
    const source = store.addRecord(state, 'sources', {
      kind: payload.kind || 'note', content, url: payload.url || '', platform: payload.platform || '',
    })
    return ok(`已记下 1 条${payload.kind === 'link' ? '链接' : '灵感'}（${source.id}）。`, { source })
  }).then(({ result }) => result)
}

async function doRadar(payload, options) {
  const key = String(need(payload.endpointKey, 'endpointKey'))
  const spec = endpoint(key)
  if (spec.cost === 'high' && !payload.confirm) {
    return { ok: false, needsConfirm: true, summary: `${spec.label} 属于高成本动作（评论/翻页会消耗额度），请显式确认。`, data: { endpointKey: key, cost: spec.cost } }
  }
  if (payload.dryRun) {
    return ok('预览（未发请求、未写库）', { endpoint: spec.path, method: spec.method, params: payload.params || {}, cost: spec.cost })
  }
  const result = await callEndpoint(key, payload.params || {}, options)
  const limit = clampInt(payload.limit, 1, 50, 20)
  const out = await store.mutate((state) => {
    let added = 0
    const evidence = []
    for (const item of result.items.slice(0, limit)) {
      const id = store.signalId(result.platform, item.title)
      if (state.signals.some((s) => s.id === id)) continue
      const signal = store.addRecord(state, 'signals', {
        id, platform: result.platform, title: item.title, text: item.text, url: item.url,
        sourceType: key, endpoint: result.key, params: result.params, fetchedAt: result.fetchedAt,
        baselineStats: item.stats || {}, rawRef: result.rawRef, cost: spec.cost, status: 'new',
        unverified: Boolean(result.unverified),
      })
      added += 1
      for (const ev of itemsToEvidence(state, { ...result, items: [item] }, signal.id)) evidence.push(ev)
    }
    pushCall(state, result.callRecord)
    return ok(`采集 ${key}：新增 ${added} 条信号 / ${evidence.length} 条证据（返回 ${result.items.length} 条${result.cached ? '，命中缓存' : ''}）。`,
      { added, evidence: evidence.length, items: result.items.slice(0, limit), rawRef: result.rawRef, unverified: result.unverified, callRecord: result.callRecord })
  })
  return out.result
}

async function doEvidence(payload, options) {
  const key = String(need(payload.endpointKey, 'endpointKey'))
  const spec = endpoint(key)
  if (spec.cost === 'high' && !payload.confirm) {
    return { ok: false, needsConfirm: true, summary: `${spec.label} 属于高成本动作，请显式确认。`, data: { endpointKey: key } }
  }
  const signalId = payload.signalId || ''
  const result = await callEndpoint(key, payload.params || {}, options)
  const out = await store.mutate((state) => {
    const evidence = itemsToEvidence(state, result, signalId)
    if (signalId && result.items[0]?.stats && Object.keys(result.items[0].stats).length) {
      const signal = store.byId(state, 'signals', signalId)
      if (signal) signal.baselineStats = result.items[0].stats
      const watch = state.benchmarkWatch.find((w) => w.signalId === signalId)
      if (watch) watch.baselineStats = result.items[0].stats
    }
    pushCall(state, result.callRecord)
    return ok(`取到 ${evidence.length} 条证据（${spec.label}）。`, { evidence, rawRef: result.rawRef, unverified: result.unverified })
  })
  return out.result
}

async function doDeconstruct(ctx, payload) {
  const state = store.readState()
  const ids = Array.isArray(payload.evidenceIds) ? payload.evidenceIds : []
  const evidence = evidenceBrief(state, ids)
  if (!evidence.length) fail('没有可用证据：先用 radar / evidence 取真实素材，或 capture 手动贴素材。', '先跑 radar 或 evidence')
  const { value, model } = await modelJson(ctx, 'deconstruct', { evidence })
  return store.mutate((state) => {
    const row = store.addRecord(state, 'deconstructions', {
      campaignId: payload.campaignId || '', evidenceIds: ids,
      hook: String(value.hook || ''), structure: Array.isArray(value.structure) ? value.structure : [],
      evidenceRefs: Array.isArray(value.evidenceRefs) ? value.evidenceRefs : [],
      pattern: String(value.pattern || ''), quotes: Array.isArray(value.quotes) ? value.quotes : [],
      engine: model,
    })
    for (const id of row.evidenceRefs) {
      const ev = store.byId(state, 'evidence', id)
      if (ev) ev.usedIn = [...(ev.usedIn || []), row.id]
    }
    return ok(`完成拆解（${row.id}），引用 ${row.evidenceRefs.length} 条证据。`, { deconstruct: row })
  }).then(({ result }) => result)
}

async function doAngles(ctx, payload) {
  const state = store.readState()
  const dec = store.byId(state, 'deconstructions', payload.deconstructId || '') || state.deconstructions.at(-1)
  if (!dec) fail('找不到拆解结果，请先做 deconstruct。')
  const { value, model } = await modelJson(ctx, 'angles', {
    deconstruct: { hook: dec.hook, structure: dec.structure, pattern: dec.pattern },
    evidence: evidenceBrief(state, dec.evidenceIds), rules: activeRuleBlock(state),
  })
  const list = (Array.isArray(value.angles) ? value.angles : []).slice(0, 6)
  if (list.length < 3) fail('模型给出的差异化方向不足 3 个，本次不写库（避免同义替换凑数）。')
  return store.mutate((state) => {
    const created = list.map((a) => store.addRecord(state, 'angles', {
      campaignId: payload.campaignId || dec.campaignId || '', deconstructId: dec.id,
      kind: String(a.kind || '相邻延伸'), title: String(a.title || ''), rationale: String(a.rationale || ''),
      evidenceRefs: Array.isArray(a.evidenceRefs) ? a.evidenceRefs : [], selected: false, engine: model,
    }))
    return ok(`生成 ${created.length} 个差异化方向，等待人工选一。`, { angles: created })
  }).then(({ result }) => result)
}

async function doDraft(ctx, payload) {
  const state = store.readState()
  const angle = store.byId(state, 'angles', payload.angleId || '') || state.angles.find((a) => a.selected) || state.angles.at(-1)
  if (!angle) fail('找不到差异化方向，请先做 angles。', '先跑 angles 并用 angle.select 选一个方向')
  const evidence = evidenceBrief(state, payload.evidenceIds || [])
  const { value, model } = await modelJson(ctx, 'draft', {
    campaign: payload.campaignTopic || payload.topic || '', angle: { kind: angle.kind, title: angle.title, rationale: angle.rationale },
    evidence, rules: activeRuleBlock(state),
  })
  const platform = payload.platform || '母稿'
  const topics = normalizeTopics(Array.isArray(value.topics) ? value.topics : String(value.body || ''), platformSpec(platform))
  return store.mutate((state) => {
    const parentId = payload.parentId || ''
    const previous = state.drafts.filter((d) => d.campaignId === (payload.campaignId || '') || d.id === parentId)
    const versionNo = previous.length ? Math.max(...previous.map((d) => d.versionNo || 1)) + 1 : 1
    const row = store.addRecord(state, 'drafts', {
      campaignId: payload.campaignId || '', platform, versionNo,
      parentId, title: String(value.title || angle.title || '未命名'),
      outline: Array.isArray(value.outline) ? value.outline : [],
      body: String(value.body || ''), changeLog: payload.changeLog || (parentId ? '迭代版本' : '初稿'),
      topics: topics.topics, angleId: angle.id, evidenceIds: evidence.map((e) => e.id), engine: model, status: 'draft',
    })
    row.specCheck = checkDraftAgainstSpec({ ...row, topics: topics.topics }, platform)
    if (parentId) store.relation(state, parentId, row.id, 'derived')
    for (const id of row.evidenceIds) {
      const ev = store.byId(state, 'evidence', id)
      if (ev) ev.usedIn = [...(ev.usedIn || []), row.id]
    }
    return ok(`已写入稿件 ${row.title}（v${versionNo}，追加不可变）。`, { draft: row })
  }).then(({ result }) => result)
}

async function doReview(ctx, payload) {
  const state = store.readState()
  const draft = store.byId(state, 'drafts', payload.draftId || '') || state.drafts.at(-1)
  if (!draft) fail('找不到稿件。')
  const { value, model } = await modelJson(ctx, 'review', { draft })
  // 规格合规是确定性检查，不交给模型，也不与质量诊断混为一谈。
  const specCheck = checkDraftAgainstSpec(draft, draft.platform)
  const specIssues = specCheck.issues.map((i) => ({
    level: 'mid', path: i.path, code: i.code, text: `[规格·${i.path}] ${i.message}（仅供参考，以平台实际限制为准）`,
  }))
  return store.mutate((state) => {
    const row = store.addRecord(state, 'assessments', {
      draftId: draft.id, dimensions: value.dimensions && typeof value.dimensions === 'object' ? value.dimensions : {},
      issues: [...(Array.isArray(value.issues) ? value.issues : []), ...specIssues],
      suggestions: Array.isArray(value.suggestions) ? value.suggestions : [],
      specCheck, note: '质量诊断 + 平台规格合规提示（第三方常量，仅供参考）；不预测发布表现', engine: model,
    })
    return ok(`完成稿件体检（${row.issues.length} 个问题，其中规格 ${specIssues.length} 个）。`, { assessment: row })
  }).then(({ result }) => result)
}

async function doDerive(ctx, payload) {
  const state = store.readState()
  const draft = store.byId(state, 'drafts', payload.draftId || '') || state.drafts.at(-1)
  if (!draft) fail('找不到母稿。')
  const platforms = Array.isArray(payload.platforms) && payload.platforms.length ? payload.platforms : ['小红书', '抖音', '公众号']
  const specs = specsForPrompt(platforms)
  const { value, model } = await modelJson(ctx, 'derive', { draft, platforms, specs })
  const items = (Array.isArray(value.items) ? value.items : []).filter((x) => x && x.platform)
  if (!items.length) fail('模型没有返回任何派生稿，本次不写库。')
  return store.mutate((state) => {
    const created = items.slice(0, 8).map((x) => {
      const platform = String(x.platform)
      const topics = normalizeTopics(Array.isArray(x.topics) ? x.topics : String(x.body || ''), platformSpec(platform))
      const row = store.addRecord(state, 'drafts', {
        campaignId: draft.campaignId, platform, versionNo: 1, parentId: draft.id,
        title: String(x.title || draft.title), body: String(x.body || ''), outline: [], changeLog: '多渠道派生',
        topics: topics.topics, evidenceIds: draft.evidenceIds || [], engine: model, status: 'derived',
      })
      row.specCheck = checkDraftAgainstSpec({ ...row, topics: topics.topics }, platform)
      store.relation(state, draft.id, row.id, 'repurposed_as')
      return row
    })
    const flagged = created.filter((r) => r.specCheck?.matched && !r.specCheck.ok).length
    return ok(`派生出 ${created.length} 个平台稿件${flagged ? `（${flagged} 篇有规格提示）` : ''}，各自可回溯到母稿。`, { drafts: created })
  }).then(({ result }) => result)
}

async function doWatch(payload, options) {
  const platform = String(need(payload.platform, 'platform'))
  const kind = payload.kind === 'benchmark' ? 'benchmark' : 'published'
  let workId = String(payload.workId || '')
  let resolved = ''
  if (!workId && payload.shareUrl && platform === 'douyin') {
    try {
      const res = await callEndpoint('work.byurl', { shareUrl: payload.shareUrl }, options)
      workId = res.items[0]?.id || ''
      resolved = res.rawRef
      if (!workId) fail('分享链解析成功但没拿到作品 ID，请直接填 workId。')
    } catch (err) {
      fail(`分享链解析失败：${err.message}`, '可直接填写 workId')
    }
  }
  if (!workId) fail('缺少 workId（或可解析的 shareUrl）')
  return store.mutate((state) => {
    const coll = kind === 'benchmark' ? 'benchmarkWatch' : 'publishedWorks'
    const existing = state[coll].find((w) => w.platform === platform && w.workId === workId)
    if (existing) return ok('该作品已登记，不重复创建。', { work: existing })
    const row = store.addRecord(state, coll, {
      platform, workId, url: payload.url || payload.shareUrl || '', kind,
      publishedAt: payload.publishedAt || '', tnPlan: Array.isArray(payload.tnPlan) ? payload.tnPlan : [1, 3, 7],
      watchEnabled: payload.watchEnabled !== false, signalId: payload.signalId || '',
      baselineStats: payload.baselineStats || {}, rawRef: resolved,
      note: kind === 'benchmark' ? '对标作品：拆解时记 baseline，T+N 回查看增量' : '',
    })
    if (kind === 'benchmark' && payload.signalId) {
      const signal = store.byId(state, 'signals', payload.signalId)
      if (signal) row.baselineStats = signal.baselineStats || row.baselineStats
    }
    return ok(`已登记${kind === 'benchmark' ? '对标作品' : '发布作品'} ${platform}:${workId}。`, { work: row })
  }).then(({ result }) => result)
}

async function doPredict(ctx, payload) {
  const state = store.readState()
  const draft = store.byId(state, 'drafts', payload.draftId || '') || state.drafts.at(-1)
  if (!draft) fail('找不到稿件。')
  if (state.predictions.some((p) => p.draftId === draft.id && p.lockedAt)) {
    fail('该稿件已有锁定的发布前判断，不可覆盖（盲判断一旦锁定就必须保持原样以便校准）。')
  }
  let value = payload.dimensions ? { dimensions: payload.dimensions, hypothesis: payload.hypothesis || '' } : null
  let model = 'manual'
  if (!value) {
    const result = await modelJson(ctx, 'predict', { draft, platforms: payload.platforms || [draft.platform] })
    value = result.value
    model = result.model
  }
  return store.mutate((state) => {
    const row = store.addRecord(state, 'predictions', {
      draftId: draft.id, campaignId: draft.campaignId,
      dimensions: value.dimensions && typeof value.dimensions === 'object' ? value.dimensions : {},
      hypothesis: String(value.hypothesis || ''), lockedAt: new Date().toISOString(), engine: model,
    })
    row.integrityHash = store.integrityHash({ draftId: row.draftId, dimensions: row.dimensions, hypothesis: row.hypothesis, lockedAt: row.lockedAt })
    return ok('发布前判断已锁定（integrity_hash 已生成，之后不可覆盖）。', { prediction: row })
  }).then(({ result }) => result)
}

async function doFeedback(payload, options) {
  const state0 = store.readState()
  // 既接受登记记录的内部 id（页面下拉），也接受平台作品 ID（对话里直接给）
  const matches = (w) => w.id === payload.workId || w.workId === payload.workId || w.workId === payload.platformWorkId
  const work = state0.publishedWorks.find(matches) || state0.benchmarkWatch.find(matches) ||
    (payload.platform ? { platform: payload.platform, workId: payload.workId || payload.id, id: '' } : null)
  if (!work) fail('找不到作品登记：先用 watch 登记，或传 platform + workId。')
  const platform = String(work.platform)
  const workKey = String(work.workId || payload.workId || '')
  const day = payload.day === undefined ? null : clampInt(payload.day, 0, 365, null)

  // 手工补录通道：不联网，origin=manual，绝不与 api 数混算
  if (payload.manual) {
    const metrics = payload.manual
    return store.mutate((state) => {
      const snap = store.addRecord(state, 'snapshots', {
        workRef: work.id || workKey, platform, workId: workKey, day, origin: 'manual',
        metrics, metricsNormalized: normalizeMetrics(metrics), metricsRaw: metrics, endpoint: 'manual', fetchedAt: new Date().toISOString(),
        note: payload.note || '手工补录',
      })
      return ok('已记录手工补录快照（origin=manual，复盘时与 API 数据分组展示）。', { snapshot: snap })
    }).then(({ result }) => result)
  }

  const key = payload.endpointKey || feedbackEndpointFor(platform, workKey)
  if (!key) {
    return store.mutate((state) => {
      const snap = store.addRecord(state, 'snapshots', {
        workRef: work.id || workKey, platform, workId: workKey, day, origin: 'api_failed',
        metrics: {}, metricsNormalized: normalizeMetrics({}), endpoint: 'unsupported', fetchedAt: new Date().toISOString(),
        note: '该平台暂无可用公开指标端点，请手工补录（视频号/公众号等）。',
      })
      return ok('该平台无自动回查端点，已标记需手工补录。', { snapshot: snap })
    }).then(({ result }) => result)
  }
  const spec = endpoint(key)
  const params = { ...(payload.params || {}) }
  if (!params.workId) params.workId = workKey
  if (!params.xsecToken && payload.xsecToken) params.xsecToken = payload.xsecToken
  if (spec.required.includes('xsec_token') && !params.xsecToken) {
    fail('小红书笔记详情需要 xsec_token（通常从搜索结果取得），请传入 xsecToken 或改用手工补录。')
  }
  let result
  try {
    result = await callEndpoint(key, params, { ...options, noCache: true })
  } catch (err) {
    return store.mutate((state) => {
      const snap = store.addRecord(state, 'snapshots', {
        workRef: work.id || workKey, platform, workId: workKey, day, origin: 'api_failed',
        metrics: {}, metricsNormalized: normalizeMetrics({}), endpoint: key, error: err.message, fetchedAt: new Date().toISOString(),
        note: '自动回查失败，未补造数据；请手工补录或稍后重试。',
      })
      pushCall(state, { ts: snap.fetchedAt, endpoint: key, status: 'error', error: err.message })
      return ok(`自动回查失败（${err.message}），已标记需手工补录。`, { snapshot: snap })
    }).then(({ result }) => result)
  }
  const metrics = { ...(result.stats || {}), ...(result.items?.[0]?.stats || {}) }
  return store.mutate((state) => {
    const snap = store.addRecord(state, 'snapshots', {
      workRef: work.id || workKey, platform, workId: workKey, day, origin: 'api',
      metrics, metricsNormalized: normalizeMetrics(metrics), metricsRaw: result.rawSample, endpoint: key, rawRef: result.rawRef,
      httpStatus: result.httpStatus, fetchedAt: result.fetchedAt,
      limited: result.limited || (key.startsWith('work.detail') || key.startsWith('note.detail') ? '公开互动数，非后台指标' : ''),
      note: Object.keys(metrics).length ? '' : '端点已返回，但未解析出标准指标字段；原始响应已留存，可人工核对。',
    })
    const watch = state.benchmarkWatch.find((w) => w.id === work.id)
    if (watch) {
      watch.followups = [...(watch.followups || []), { day, at: snap.fetchedAt, metrics }]
      if (watch.baselineStats && Object.keys(watch.baselineStats).length) {
        watch.delta = Object.fromEntries(Object.keys(metrics).map((k) => [k, (metrics[k] || 0) - (watch.baselineStats[k] || 0)]))
      }
    }
    pushCall(state, result.callRecord)
    return ok(`回查成功（${spec.label}），写入 T${day === null ? '' : '+' + day} 快照；origin=api。`, { snapshot: snap })
  }).then(({ result }) => result)
}

async function doRetro(payload) {
  return store.mutate((state) => {
    const prediction = store.byId(state, 'predictions', payload.predictionId || '') || state.predictions.at(-1)
    if (!prediction) fail('没有锁定的发布前判断可对照：先做 predict。')
    const draft = store.byId(state, 'drafts', prediction.draftId)
    const all = state.snapshots.filter((s) => !payload.workId || s.workId === payload.workId)
    const groups = { api: all.filter((s) => s.origin === 'api'), manual: all.filter((s) => s.origin === 'manual'), api_failed: all.filter((s) => s.origin === 'api_failed') }
    const calibration = groups.api.concat(groups.manual).map((s) => ({
      snapshotId: s.id, origin: s.origin, day: s.day, metrics: s.metrics, limited: s.limited || '',
    }))
    const row = store.addRecord(state, 'retros', {
      predictionId: prediction.id, draftId: prediction.draftId,
      hypothesis: prediction.hypothesis, dimensions: prediction.dimensions,
      calibration, groups: { api: groups.api.length, manual: groups.manual.length, apiFailed: groups.api_failed.length },
      note: '只做锁定预测与实际指标的对照；不补造预测，不把相关性写成因果，api/manual 分组不混算。',
      draftTitle: draft?.title || '',
    })
    return ok(`完成校准对照：API 快照 ${groups.api.length} 条 / 手工 ${groups.manual.length} 条 / 待补录 ${groups.api_failed.length} 条。`,
      { retro: row })
  }).then(({ result }) => result)
}

async function doRule(ctx, payload) {
  const op = payload.op || 'propose'
  if (op === 'activate' || op === 'reject') {
    const id = String(need(payload.id, 'id'))
    return store.mutate((state) => {
      const rule = store.byId(state, 'rules', id)
      if (!rule) fail(`找不到规则 ${id}`)
      if (rule.status !== 'proposed') fail('只有 proposed 状态的规则可以被审核。')
      rule.status = op === 'activate' ? 'active' : 'rejected'
      rule.reviewedAt = new Date().toISOString()
      rule.reviewNote = payload.note || ''
      return ok(`规则「${rule.name}」已${op === 'activate' ? '激活（将进入 Skill addendum 影响后续生成）' : '驳回'}。`, { rule })
    }).then(({ result }) => result)
  }
  if (op === 'add') {
    const name = String(need(payload.name, 'name'))
    return store.mutate((state) => {
      const row = store.addRecord(state, 'rules', {
        name, text: String(payload.text || ''), status: 'proposed',
        evidenceIds: Array.isArray(payload.evidenceIds) ? payload.evidenceIds : [],
        sourceRetroId: payload.retroId || '', engine: 'manual',
      })
      return ok(`已提交规则建议「${name}」，等待人工审核。`, { rule: row })
    }).then(({ result }) => result)
  }
  // propose：由模型从复盘里提炼，但必须引用真实 id
  const state = store.readState()
  const retro = store.byId(state, 'retros', payload.retroId || '') || state.retros.at(-1)
  if (!retro) fail('没有复盘记录可提炼规则：先做 retro。')
  const { value, model } = await modelJson(ctx, 'rule', { retro, snapshots: retro.calibration })
  const validIds = new Set(state.snapshots.map((s) => s.id).concat(state.evidence.map((e) => e.id)))
  const list = (Array.isArray(value.rules) ? value.rules : []).filter((r) => r?.name)
  return store.mutate((state) => {
    const created = list.slice(0, 8).map((r) => {
      const evidenceIds = (Array.isArray(r.evidenceIds) ? r.evidenceIds : []).filter((id) => validIds.has(id))
      return store.addRecord(state, 'rules', {
        name: String(r.name), text: String(r.text || ''), status: 'proposed',
        evidenceIds, sourceRetroId: retro.id, engine: model,
        note: evidenceIds.length ? '' : '未引用到有效证据 id，审核时请重点核对',
      })
    })
    return ok(`生成 ${created.length} 条规则建议（proposed，未审核不生效）。`, { rules: created })
  }).then(({ result }) => result)
}

async function doImage(payload) {
  if (!payload.confirm) {
    return { ok: false, needsConfirm: true, summary: '生图会消耗 apiz 额度，请显式确认。', data: { cost: 'apiz' } }
  }
  const probe = await apiz.probe()
  if (!probe.installed) return ok('apiz CLI 未安装/未登录，已跳过生图（文字链路不受影响）。', { skipped: true, probe })
  const model = payload.model || probe.models?.[0]?.id || probe.models?.[0]?.model || ''
  if (!model) return ok('apiz 没有可用图片模型，已跳过（可先跑 models 探活）。', { skipped: true, probe })
  const params = { ...(payload.params || {}) }
  if (payload.referenceImage) {
    const url = await apiz.uploadReference(payload.referenceImage)
    params.reference_image_urls = [url]
  }
  const result = await apiz.generate({ prompt: need(payload.prompt, 'prompt'), model, aspectRatio: payload.aspectRatio || '3:4', params, dryRun: Boolean(payload.dryRun) })
  if (result.dryRun) return ok('生图预览（未下单）', { result })
  if (!result.ok) return ok(`生图未成功：${result.error || result.status}${result.taskId ? `（taskId=${result.taskId}，请用 tasks get 查询，不要重复下单）` : ''}`, { result, images: [] })
  const assets = []
  for (const url of result.images.slice(0, 3)) {
    const id = store.uid('img')
    let file = ''
    try { file = (await apiz.downloadAsset(url, id)).file } catch { /* 保留 URL */ }
    assets.push({ id, url, file, model, prompt: payload.prompt })
  }
  return store.mutate((state) => {
    const rows = assets.map((a) => store.addRecord(state, 'assets', {
      draftId: payload.draftId || '', ...a, ratio: payload.aspectRatio || '3:4', price: result.price, taskId: result.taskId, status: 'done',
    }))
    for (const row of rows) if (row.draftId) store.relation(state, row.draftId, row.id, 'used_for_creation')
    return ok(`生成 ${rows.length} 张图并落盘。`, { assets: rows })
  }).then(({ result }) => result)
}

async function doSpec(payload, options) {
  if (payload.platform || payload.listPlatforms) {
    const list = payload.listPlatforms ? allPlatformSpecs() : [platformSpec(payload.platform)].filter(Boolean)
    return ok(list.length ?
      `平台规格表：${list.length} 个平台（第三方常量，仅供参考，未用平台真实样本验真）。` :
      '未收录该平台规格，不臆造限制。',
    { platformSpecs: list, advisory: platformSpecDoc.advisory, verified: platformSpecDoc.verified, note: platformSpecDoc.note })
  }
  if (payload.refresh) {
    const record = await fetchLiveSpec({ ...options, force: true })
    if (!record) return ok('线上 OpenAPI 同步失败，已保留上次缓存/白名单（60 秒内不重试）。', { status: specStatus() })
  }
  const paths = specPaths()
  const validation = validateWhitelist(paths)
  return ok(paths.length ? `已对照线上 spec（${validation.checked}/${validation.total} 条命中）。` :
    '尚未同步线上 OpenAPI；白名单构建时已按 V5.3.2 静态校验，可点「校验端点」联网核对。',
  { status: specStatus(), validation, endpoints: endpointList(payload.group) })
}

async function doExport(payload) {
  const state = store.readState()
  const draft = store.byId(state, 'drafts', payload.draftId || '') || state.drafts.at(-1)
  if (!draft) fail('找不到稿件。')
  const format = payload.format === 'html' ? 'html' : 'md'
  const body = `# ${draft.title}\n\n平台：${draft.platform} · 版本 v${draft.versionNo}\n\n${draft.body}\n`
  const content = format === 'html' ? `<!doctype html><meta charset="utf-8"><h1>${draft.title}</h1><pre>${body.replace(/[<>&]/g, '')}</pre>` : body
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const dir = join(dataDir(), 'exports')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${draft.id}.${format}`)
  writeFileSync(file, content, 'utf8')
  return ok(`已导出到 ${file}`, { file })
}

// ---------------------------------------------------------------------------
export async function runAction(ctx, action, payload = {}, options = {}) {
  if (!ACTIONS[action]) return { ok: false, error: `未知动作 ${action}。可用：${Object.keys(ACTIONS).join(', ')}` }
  ensureDirs()
  try {
    const p = payload && typeof payload === 'object' ? payload : {}
    switch (action) {
      case 'capture': return await doCapture(p)
      case 'radar': return await doRadar(p, options)
      case 'evidence': return await doEvidence(p, options)
      case 'deconstruct': return await doDeconstruct(ctx, p)
      case 'angles': return await doAngles(ctx, p)
      case 'draft': return await doDraft(ctx, p)
      case 'review': return await doReview(ctx, p)
      case 'derive': return await doDerive(ctx, p)
      case 'watch': return await doWatch(p, options)
      case 'predict': return await doPredict(ctx, p)
      case 'feedback': return await doFeedback(p, options)
      case 'retro': return await doRetro(p)
      case 'rule': return await doRule(ctx, p)
      case 'image': return await doImage(p)
      case 'spec': return await doSpec(p, options)
      case 'export': return await doExport(p)
      default: return { ok: false, error: `动作 ${action} 未实现` }
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err), nextStep: err?.nextStep || '' }
  }
}

/** 只读检索，供 atelier_query 工具与页面使用。 */
export function queryState(what, params = {}) {
  const state = store.readState()
  const limit = clampInt(params.limit, 1, 100, 20)
  const filterKeyword = (rows, fields) => {
    const keyword = String(params.keyword || '').toLowerCase()
    if (!keyword) return rows
    return rows.filter((r) => fields.some((f) => String(r[f] || '').toLowerCase().includes(keyword)))
  }
  const collections = {
    signals: ['title', 'platform', 'sourceType'], evidence: ['text', 'title', 'endpoint'],
    drafts: ['title', 'body', 'platform'], rules: ['name', 'text', 'status'],
    snapshots: ['platform', 'workId', 'origin'], campaigns: ['coreTopic'],
    sources: ['content', 'url'], publishedWorks: ['platform', 'workId'], benchmarkWatch: ['platform', 'workId'],
    apiCalls: ['endpoint', 'status'], assessments: ['draftId'], predictions: ['hypothesis'],
    retros: ['note'], assets: ['prompt'], angles: ['title'], deconstructs: ['pattern'],
  }
  if (what === 'state' || what === 'all') {
    return { ok: true, summary: stateSummary(state), data: state }
  }
  if (what === 'health' || what === 'status') {
    return { ok: true, summary: stateSummary(state), data: health(state) }
  }
  const map = { deconstructs: 'deconstructions', deconstruct: 'deconstructions' }
  const collection = map[what] || what
  if (!store.COLLECTIONS.includes(collection)) {
    return { ok: false, error: `未知查询 ${what}。可用：state, health, ${Object.keys(collections).join(', ')}` }
  }
  let rows = state[collection]
  if (params.id) rows = rows.filter((r) => r.id === params.id)
  rows = filterKeyword(rows, collections[what] || ['id'])
  const data = rows.slice(-limit).reverse()
  const lines = data.map((r) => {
    if (collection === 'signals') return `- [${r.platform}] ${r.title} (${r.id})`
    if (collection === 'evidence') return `- [${r.kind}] ${String(r.text).slice(0, 90)} (${r.id})`
    if (collection === 'drafts') return `- ${r.title} / ${r.platform} v${r.versionNo} (${r.id})`
    if (collection === 'rules') return `- [${r.status}] ${r.name}：${String(r.text).slice(0, 80)} (${r.id})`
    if (collection === 'snapshots') return `- [${r.origin}] ${r.platform}:${r.workId} T+${r.day ?? '-'} ${JSON.stringify(r.metrics || {})} (${r.id})`
    return `- ${r.title || r.name || r.platform || r.endpoint || r.id} (${r.id})`
  })
  return { ok: true, summary: `${what} 共 ${rows.length} 条，返回 ${data.length} 条：\n${lines.join('\n') || '（空）'}`, data }
}

export function stateSummary(state) {
  return `信号 ${state.signals.length} / 证据 ${state.evidence.length} / 稿件 ${state.drafts.length} / ` +
    `快照 ${state.snapshots.length} / 规则 ${state.rules.filter((r) => r.status === 'active').length} 条已激活`
}

export function health(state = store.readState()) {
  return {
    ok: true, version: 1, summary: stateSummary(state),
    counts: Object.fromEntries(store.COLLECTIONS.map((c) => [c, state[c].length])),
    tikhub: publicSettings(), spec: specStatus(),
    platformSpecs: { count: allPlatformSpecs().length, advisory: platformSpecDoc.advisory, verified: platformSpecDoc.verified },
    model: { note: '由 dsh 宿主提供，未单独配置密钥' },
    apiz: { note: '认证由 apiz CLI 自管，插件不接触密钥' },
    actions: Object.entries(ACTIONS).map(([key, v]) => ({ key, ...v })),
  }
}
