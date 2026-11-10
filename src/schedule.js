// T+1/3/7 自动化：优先用 dsh 宿主的持久化定时服务（到点把 prompt 投递回会话唤醒 Agent），
// 再用宿主 ctx.interval 做「补跑扫描」兜底（客户端关机/未开对话时不丢数据）。
// 默认只提醒、不自动花额度；真正自动回查需用户在设置里显式打开。
import { readSettings } from './settings.js'
import * as store from './store.js'
import { runAction } from './pipeline.js'

const DAY = 86_400_000
const MAX_ATTEMPTS = 2

let activeAgent = null
export function rememberAgent(agent) {
  if (agent?.session?.id) activeAgent = agent
}

export function scheduleService(ctx) {
  try { return ctx?.get?.('schedule') || null } catch { return null }
}

function automation(state) {
  if (!state.automation || typeof state.automation !== 'object') {
    state.automation = { schedules: [], runs: [], lastSweep: '' }
  }
  if (!Array.isArray(state.automation.schedules)) state.automation.schedules = []
  if (!Array.isArray(state.automation.runs)) state.automation.runs = []
  return state.automation
}

/** 已经到期、但还没有快照且重试次数未用尽的 (作品, T+N) 任务。 */
export function dueTasks(state = store.readState()) {
  const works = [...(state.publishedWorks || []), ...(state.benchmarkWatch || [])]
  const done = new Set((state.snapshots || []).map((s) => `${s.workId}::${s.day}`))
  const attempts = {}
  for (const r of state.automation?.runs || []) attempts[r.key] = (attempts[r.key] || 0) + 1
  const now = Date.now()
  const out = []
  for (const w of works) {
    if (w.watchEnabled === false || !w.workId) continue
    const base = Date.parse(w.publishedAt || w.createdAt || '') || now
    const plan = Array.isArray(w.tnPlan) && w.tnPlan.length ? w.tnPlan : [1, 3, 7]
    for (const day of plan) {
      const at = base + Number(day) * DAY
      if (now < at) continue
      const key = `${w.workId}::${day}`
      if (done.has(key) || (attempts[key] || 0) >= MAX_ATTEMPTS) continue
      out.push({
        key, workRef: w.id || w.workId, workId: w.workId, platform: w.platform,
        day: Number(day), dueAt: new Date(at).toISOString(),
      })
    }
  }
  return out.slice(0, 20)
}

function promptFor(work, day, auto) {
  const base = `母题工作台 T+${day} 提醒：作品 ${work.platform}:${work.workId}`
  if (!auto) {
    return `${base} 到了该记录数据的时间。请先询问用户是否要回查，得到同意后再调用 atelier(action="feedback", payload={"workId":"${work.id || work.workId}","day":${day}})。若用户不需要，直接说明已跳过，不要自行调用、不要编造数据。`
  }
  return `${base}。请依次执行：atelier(action="feedback", payload={"workId":"${work.id || work.workId}","day":${day}}) 回查真实指标；成功后 atelier(action="retro", payload={}) 做校准对照；再 atelier(action="rule", payload={"op":"propose"}) 生成规则建议。规则只生成建议，绝不自动激活。任何一步失败就如实说明，不要编造互动量。`
}

/** 登记作品时创建 dsh 原生定时任务。没有活跃会话/服务时如实返回原因，由补跑扫描兜底。 */
export async function createTnReminders(ctx, work) {
  const settings = readSettings()
  if (!settings.tnReminderEnabled) return { ok: false, reason: '定时提醒已在设置里关闭' }
  const svc = scheduleService(ctx)
  const sessionId = activeAgent?.session?.id
  if (!svc || typeof svc.create !== 'function') return { ok: false, reason: '宿主未提供 schedule 服务，已由插件内补跑扫描兜底' }
  if (!sessionId) return { ok: false, reason: '当前没有活跃会话，暂不能创建 dsh 提醒；开启自动回查后由补跑扫描兜底' }

  const base = Date.parse(work.publishedAt || work.createdAt || '') || Date.now()
  const plan = Array.isArray(work.tnPlan) && work.tnPlan.length ? work.tnPlan : [1, 3, 7]
  const created = []
  const errors = []
  const controller = new AbortController()
  const existing = new Set((store.readState().automation?.schedules || []).map((s) => s.key))
  for (const day of plan) {
    if (existing.has(`${work.workId}::${day}`)) continue
    const at = new Date(Math.max(base + Number(day) * DAY, Date.now() + 60_000)).toISOString()
    const key = `${work.workId}::${day}`
    try {
      const record = await svc.create(sessionId, {
        title: `母题工作台 T+${day} 回查 · ${work.workId}`,
        prompt: promptFor(work, day, Boolean(settings.feedbackAutoEnabled)),
        at,
      }, controller.signal)
      created.push({ key, day, at, scheduleId: String(record?.id || record?.schedule?.id || ''), sessionId: String(sessionId) })
    } catch (err) {
      errors.push(`T+${day}: ${err?.message || err}`)
    }
  }
  if (created.length) {
    await store.mutate((state) => {
      const a = automation(state)
      const seen = new Set(a.schedules.map((s) => s.key))
      for (const row of created) if (!seen.has(row.key)) a.schedules.push({ ...row, createdAt: new Date().toISOString() })
      a.schedules = a.schedules.slice(-100)
    })
  }
  return {
    ok: created.length > 0,
    created: created.length,
    errors,
    reason: created.length ? '' : (errors[0] || '没有创建任何提醒'),
    auto: Boolean(settings.feedbackAutoEnabled),
  }
}

/** 页面登记作品时可能还没有活跃会话，等 agent 出现后补建 dsh 提醒（只投递 prompt，不花钱）。 */
export async function ensureReminders(ctx) {
  if (!readSettings().tnReminderEnabled) return 0
  if (!activeAgent?.session?.id || !scheduleService(ctx)) return 0
  const state = store.readState()
  const works = [...(state.publishedWorks || []), ...(state.benchmarkWatch || [])]
  let made = 0
  for (const work of works) {
    if (!work.workId || made >= 3) break
    try {
      const res = await createTnReminders(ctx, work)
      if (res.ok) made += 1
      else if (!/没有创建任何提醒/.test(res.reason || '')) break
    } catch { break }
  }
  return made
}

/** 补跑扫描：只在用户显式开启时真正发请求（会消耗 TikHub 额度）。 */
export async function sweep(ctx, options = {}) {
  try { await ensureReminders(ctx) } catch { /* 提醒补建失败不影响回查 */ }
  const settings = readSettings()
  if (!settings.feedbackAutoEnabled && !options.force) {
    return { ok: true, skipped: true, count: 0, reason: '自动回查未开启（只提醒，不花额度）' }
  }
  const tasks = dueTasks()
  if (!tasks.length) return { ok: true, count: 0, reason: '没有到期待回查的任务' }
  const results = []
  for (const task of tasks.slice(0, 5)) {
    let result
    try { result = await runAction(ctx, 'feedback', { workId: task.workRef, day: task.day }) }
    catch (err) { result = { ok: false, error: err?.message || String(err) } }
    results.push({ key: task.key, day: task.day, workId: task.workId, ok: Boolean(result.ok), summary: result.summary || result.error || '' })
    await store.mutate((state) => {
      const a = automation(state)
      a.runs.unshift({ ...task, ok: Boolean(result.ok), summary: result.summary || result.error || '', ts: new Date().toISOString(), source: 'sweep' })
      a.runs = a.runs.slice(0, 100)
      a.lastSweep = new Date().toISOString()
    })
  }
  return { ok: true, count: results.length, results }
}

export function automationStatus(ctx) {
  const state = store.readState()
  const a = state.automation || { schedules: [], runs: [], lastSweep: '' }
  return {
    serviceAvailable: Boolean(scheduleService(ctx) && typeof scheduleService(ctx)?.create === 'function'),
    sessionAvailable: Boolean(activeAgent?.session?.id),
    reminderEnabled: Boolean(readSettings().tnReminderEnabled),
    autoEnabled: Boolean(readSettings().feedbackAutoEnabled),
    autoCostsCredits: true,
    schedules: a.schedules || [],
    runs: (a.runs || []).slice(0, 20),
    lastSweep: a.lastSweep || '',
    due: dueTasks(state),
  }
}

/** 在 apply(ctx) 里装：记住活跃 agent + 每小时扫描 + 启动 8 秒后补跑一次。 */
export function installAutomation(ctx) {
  try { ctx.on?.('agent/created', (agent) => rememberAgent(agent)) } catch { /* 事件不可用则靠工具 execute 记住 */ }
  const tick = () => { Promise.resolve(sweep(ctx)).catch(() => {}) }
  try {
    if (typeof ctx.interval === 'function') ctx.interval(tick, 60 * 60 * 1000)
    else {
      const timer = setInterval(tick, 60 * 60 * 1000)
      if (timer.unref) timer.unref()
      ctx.effect(() => () => clearInterval(timer), 'atelier:automation')
    }
  } catch { /* 定时器不可用不影响主链路 */ }
  const boot = setTimeout(tick, 8000)
  if (boot.unref) boot.unref()
}
