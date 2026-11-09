// TikHub Provider：白名单端点 + 分级重试 + 每端点限流 + 缓存留痕 + 容错归一化。
// 端点路径以官方 OpenAPI 为准（见 openapi.js 的运行时校验）；不把裸 path 暴露给模型。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { resolveToken, readSettings, dataDir, redact } from '../settings.js'
import { suggestPaths, specPaths } from './openapi.js'

export const BASE_URL = 'https://api.tikhub.io'
const CATALOG = JSON.parse(readFileSync(new URL('./endpoints.json', import.meta.url), 'utf8'))
export const ENDPOINTS = CATALOG.endpoints

export class TikHubError extends Error {
  constructor(message, extra = {}) {
    super(redact(message))
    this.name = 'TikHubError'
    Object.assign(this, extra)
  }
}

export function endpoint(key) {
  const found = ENDPOINTS.find((e) => e.key === key)
  if (!found) throw new TikHubError(`未知端点 ${key}。可用：${ENDPOINTS.map((e) => e.key).join(', ')}`, { status: 400 })
  return found
}

export function endpointList(group) {
  return ENDPOINTS.filter((e) => !group || e.group === group)
    .map(({ key, label, group: g, platform, cost, limited, path }) => ({ key, label, group: g, platform, cost, limited: limited || '', path }))
}

// ---------------------------------------------------------------------------
// 归一化：不同端点返回结构差异极大，先按候选路径取数组，再 DFS 兜底，最后统一字段。
// 未经真实样本验真的端点会带 unverified 标记，原始响应一律落盘可查。
// ---------------------------------------------------------------------------
export function dig(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj)
}

export function stripTags(text) {
  return String(text ?? '').replace(/<[^>]*>/g, '').trim()
}

export function num(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const n = Number(String(value ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

const CONTENT_KEYS = /(^|_)(id|title|desc|description|word|content|text|name|aweme|note|comment|nickname|statistics|create_time)(_|$)/i
export function anyObjectArray(node, depth = 0, guard = { n: 0 }) {
  if (!node || typeof node !== 'object' || depth > 8 || guard.n > 600) return null
  guard.n += 1
  if (Array.isArray(node)) {
    if (node.length && node.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      const keys = Object.keys(node[0]).join(' ')
      if (CONTENT_KEYS.test(keys)) return node
    }
    for (const item of node.slice(0, 30)) {
      const found = anyObjectArray(item, depth + 1, guard)
      if (found) return found
    }
    return null
  }
  for (const value of Object.values(node)) {
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value) && value.length && value[0] && typeof value[0] === 'object' && CONTENT_KEYS.test(Object.keys(value[0]).join(' '))) return value
    const found = anyObjectArray(value, depth + 1, guard)
    if (found) return found
  }
  return null
}

export function extractList(json, candidates = []) {
  for (const path of candidates) {
    const value = dig(json, path)
    if (Array.isArray(value) && value.length) return value
    if (value && typeof value === 'object') {
      const nested = anyObjectArray(value)
      if (nested) return nested
    }
  }
  return anyObjectArray(json) || []
}

const STAT_ALIASES = {
  views: ['play_count', 'view_count', 'views', 'vv', 'read_count', 'viewCount'],
  likes: ['digg_count', 'like_count', 'liked_count', 'likes', 'praise_count'],
  comments: ['comment_count', 'comments', 'reply_count'],
  collects: ['collect_count', 'collected_count', 'favorite_count', 'collects'],
  shares: ['share_count', 'shares', 'forward_count'],
}

export function collectStats(raw, depth = 0, out = {}) {
  if (!raw || typeof raw !== 'object' || depth > 6) return out
  for (const [key, value] of Object.entries(raw)) {
    for (const [name, aliases] of Object.entries(STAT_ALIASES)) {
      if (aliases.some((a) => a.toLowerCase() === key.toLowerCase()) && (typeof value === 'number' || typeof value === 'string')) {
        out[name] = Math.max(out[name] || 0, num(value))
      }
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && depth < 5) collectStats(value, depth + 1, out)
  }
  return out
}

function firstString(obj, keys) {
  for (const key of keys) {
    const value = dig(obj, key)
    if (typeof value === 'string' && value.trim()) return stripTags(value)
  }
  return ''
}

export function normalizeItem(raw, kind) {
  const item = raw && typeof raw === 'object' ? raw : { value: raw }
  const nested = item.aweme_info || item.note || item.note_card || item.video || item.item || item
  const base = nested && typeof nested === 'object' ? nested : item
  const title = firstString(item, ['title', 'word', 'name', 'content']) || firstString(base, ['desc', 'title', 'description', 'content', 'word'])
  const text = firstString(item, ['content', 'text', 'desc', 'description']) || firstString(base, ['desc', 'content', 'text'])
  const author = firstString(item, ['author', 'nickname', 'user.nickname', 'author.nickname']) ||
    firstString(base, ['author.nickname', 'user.nickname', 'nickname'])
  const id = String(firstString(item, ['id', 'note_id', 'aweme_id', 'item_id', 'word']) ||
    firstString(base, ['aweme_id', 'note_id', 'id', 'itemId']) || createHash('sha1').update(title + text).digest('hex').slice(0, 16))
  const url = firstString(item, ['url', 'share_url', 'link']) || firstString(base, ['share_url', 'url'])
  return {
    id,
    title: (title || text || '(无标题)').slice(0, 300),
    text: text.slice(0, 3000),
    author,
    url,
    stats: collectStats(item),
    publishedAt: firstString(item, ['create_time', 'published_at', 'time']) || firstString(base, ['create_time']),
    kind,
    rawKeys: Object.keys(item).slice(0, 30),
  }
}

// ---------------------------------------------------------------------------
// 限流：每端点独立令牌间隔（官方：多数端点 5 req/s），全局 rpm 软限制。
// ---------------------------------------------------------------------------
const lastCall = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function throttle(key) {
  const settings = readSettings()
  const interval = 1000 / Math.max(1, Math.min(10, settings.perEndpointRps || 5))
  const prev = lastCall.get(key) || 0
  const wait = Math.max(0, prev + interval - Date.now())
  if (wait) await sleep(wait)
  lastCall.set(key, Date.now())
}

const responseCache = new Map()
function cacheKey(spec, finalParams) {
  return createHash('sha1').update(spec.key + JSON.stringify(finalParams)).digest('hex')
}

function persistRaw(hash, json) {
  try {
    const dir = join(dataDir(), 'raw')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${hash.slice(0, 24)}.json`), JSON.stringify(json).slice(0, 300_000), 'utf8')
    return join('raw', `${hash.slice(0, 24)}.json`)
  } catch { return '' }
}

function buildFinalParams(spec, params) {
  const final = { ...(spec.defaults || {}) }
  for (const [business, actual] of Object.entries(spec.paramsMap || {})) {
    if (params?.[business] !== undefined && params[business] !== '') final[actual] = params[business]
  }
  for (const required of spec.required || []) {
    if (final[required] === undefined || final[required] === '') {
      throw new TikHubError(`端点 ${spec.key} 缺少必填参数 ${required}（业务参数名：${Object.entries(spec.paramsMap).find(([, v]) => v === required)?.[0] || required}）`, { status: 400 })
    }
  }
  return final
}

/**
 * 调一次白名单端点。
 * @returns {{ok:boolean, key:string, path:string, items:object[], rawRef:string, cached:boolean, unverified:boolean, httpStatus:number, callRecord:object}}
 */
export async function callEndpoint(key, params = {}, options = {}) {
  const spec = endpoint(key)
  const token = resolveToken()
  if (!token && !options.tokenOverride) throw new TikHubError('TikHub key 未配置：请在「设置」页填写，或设置环境变量 ATELIER_TIKHUB_API_KEY。', { status: 401 })
  const final = buildFinalParams(spec, params)
  const hash = cacheKey(spec, final)
  const ttl = (options.noCache || spec.ttl === 0) ? 0 : (spec.ttl || 1800) * 1000
  const cached = responseCache.get(hash)
  if (ttl && cached && Date.now() - cached.at < ttl) {
    return { ...cached.value, cached: true, callRecord: { ts: new Date().toISOString(), endpoint: spec.key, status: 'cache', ms: 0 } }
  }

  const fetchImpl = options.fetchImpl || fetch
  // 允许离线 mock（ATELIER_TIKHUB_BASE_URL）联调；非官方地址只允许本机，防 SSRF。
  const baseUrl = options.baseUrl || process.env.ATELIER_TIKHUB_BASE_URL || BASE_URL
  const parsedBase = new URL(baseUrl)
  const official = ['api.tikhub.io', 'api.tikhub.dev'].includes(parsedBase.hostname)
  const local = ['127.0.0.1', 'localhost', '::1'].includes(parsedBase.hostname)
  if (!official && !local) throw new TikHubError(`拒绝非授信 TikHub 地址：${parsedBase.hostname}`, { status: 400 })
  const url = new URL(spec.path, baseUrl)
  const body = { ...(spec.bodyDefaults || {}) }
  if (spec.method === 'GET') for (const [k, v] of Object.entries(final)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  else Object.assign(body, final)

  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await throttle(spec.key)
    const started = Date.now()
    let response
    try {
      response = await fetchImpl(url.toString(), {
        method: spec.method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${options.tokenOverride || token}`,
          ...(spec.method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        ...(spec.method === 'POST' ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(options.timeoutMs || 30_000),
      })
    } catch (err) {
      lastError = new TikHubError(`网络请求失败：${err?.message || err}`, { retryable: true })
      if (attempt < 2) { await sleep(2 ** attempt * 300); continue }
      throw lastError
    }
    const text = await response.text().catch(() => '')
    let json
    try { json = JSON.parse(text) } catch { json = null }
    const ms = Date.now() - started
    if (response.status === 429) {
      const retryAfter = Number(response.headers?.get?.('retry-after')) || 1
      if (attempt < 2) { await sleep((retryAfter + 1) * 1000); continue }
      throw new TikHubError('TikHub 限流 (429)：请稍后重试或降低刷新频率。', { status: 429, ms })
    }
    if (response.status === 401 || response.status === 403) {
      throw new TikHubError('TikHub 鉴权失败：检查 key 是否正确、是否勾选了对应 Scopes。', { status: response.status, ms })
    }
    if (response.status === 404) {
      const suggestions = suggestPaths(specPaths(), spec.path).map((s) => s.path)
      throw new TikHubError(`端点 404，可能已下线。线上 spec 的相近路径：${suggestions.join(' / ') || '无'}`, { status: 404, suggestions, ms })
    }
    if (!response.ok) throw new TikHubError(`TikHub HTTP ${response.status}: ${text.slice(0, 200)}`, { status: response.status, ms })
    if (json && typeof json.code !== 'undefined' && ![200, 0, '200', '0'].includes(json.code)) {
      throw new TikHubError(`TikHub 返回 code ${json.code}：${json.message || ''}`.slice(0, 300), { status: 200, code: json.code, ms })
    }
    const list = extractList(json ?? {}, spec.list)
    const items = list.slice(0, 50).map((row) => normalizeItem(row, spec.map))
    const rawRef = persistRaw(hash, json ?? { text: text.slice(0, 3000) })
    const value = {
      ok: true,
      key: spec.key,
      path: spec.path,
      platform: spec.platform,
      label: spec.label,
      group: spec.group,
      limited: spec.limited || '',
      params: final,
      items,
      stats: collectStats(json ?? {}),
      rawRef,
      rawSample: json ? JSON.stringify(json).slice(0, 1200) : text.slice(0, 1200),
      unverified: items.length === 0,
      httpStatus: response.status,
      fetchedAt: new Date().toISOString(),
      cached: false,
    }
    if (ttl) responseCache.set(hash, { at: Date.now(), value })
    value.callRecord = { ts: new Date().toISOString(), endpoint: spec.key, path: spec.path, status: 'ok', httpStatus: response.status, ms, cached: false, items: items.length }
    return value
  }
  throw lastError || new TikHubError('TikHub 调用失败')
}

/** 反馈端点按作品 ID 回查：优先专用 analytics，否则回退到详情里的公开 statistics。 */
export function feedbackEndpointFor(platform, workId) {
  if (platform === 'tiktok') return 'metrics.tiktok'
  if (platform === 'douyin') return 'work.detail'
  if (platform === 'xiaohongshu') return 'note.detail'
  return null
}

export function validateWhitelist(paths) {
  const set = new Set(paths || [])
  const missing = ENDPOINTS.filter((e) => !set.has(e.path)).map((e) => ({ key: e.key, path: e.path }))
  return { total: ENDPOINTS.length, checked: ENDPOINTS.length - missing.length, missing }
}
