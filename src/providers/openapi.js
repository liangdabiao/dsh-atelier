// 线上 OpenAPI 为端点真源：运行时可刷新、离线用随包白名单兜底、404 时给相近路径建议。
// 借鉴 dsh-tikhub-api 的 indexSpec / suggestPaths 做法，垂直插件只保留路径索引。
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../settings.js'

export const SPEC_URLS = ['https://api.tikhub.io/openapi.json', 'https://api.tikhub.dev/openapi.json']

let live = null // { paths:string[], version, source, checkedAt }
let failedAt = 0

function cacheFile() { return join(dataDir(), 'openapi.live.json') }

export function readCachedSpec() {
  if (live) return live
  try {
    const parsed = JSON.parse(readFileSync(cacheFile(), 'utf8'))
    if (Array.isArray(parsed?.paths) && parsed.paths.length) { live = parsed; return live }
  } catch { /* 无缓存 */ }
  return null
}

export function indexSpec(spec) {
  const paths = Object.entries(spec?.paths || {})
    .filter(([, ops]) => ops && typeof ops === 'object')
    .map(([path]) => path)
  return { paths, version: spec?.info?.version || '' }
}

export async function fetchLiveSpec(options = {}) {
  if (Date.now() - failedAt < 60_000 && !options.force) return readCachedSpec()
  const fetchImpl = options.fetchImpl || fetch
  for (const url of (options.firstOnly ? SPEC_URLS.slice(0, 1) : SPEC_URLS)) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(options.timeoutMs || 12_000) })
      if (!response.ok) continue
      const json = await response.json()
      const indexed = indexSpec(json)
      if (!indexed.paths.length) continue
      live = { ...indexed, source: url, checkedAt: new Date().toISOString() }
      if (options.persist !== false) {
        mkdirSync(dataDir(), { recursive: true })
        const file = cacheFile()
        const tmp = `${file}.${process.pid}.tmp`
        writeFileSync(tmp, JSON.stringify(live), 'utf8')
        renameSync(tmp, file)
      }
      failedAt = 0
      return live
    } catch { /* 试下一个镜像 */ }
  }
  failedAt = Date.now()
  return readCachedSpec()
}

export function specPaths() { return readCachedSpec()?.paths || [] }

export function specStatus() {
  const record = readCachedSpec()
  return {
    checked: Boolean(record),
    version: record?.version || '',
    pathCount: record?.paths?.length || 0,
    source: record?.source || '',
    checkedAt: record?.checkedAt || '',
    note: record ? '' : '尚未同步线上 OpenAPI；白名单在构建时已按 V5.3.2 静态校验，可在设置页点「校验端点」。',
  }
}

const STOP = new Set(['api', 'v1', 'v2', 'v3', 'web', 'app', 'app_v2', 'app_v3', 'web_v2', 'web_v3', 'fetch', 'get', 'list', 'result', 'videos', 'video'])
function tokens(path) {
  return path.split('/').filter(Boolean).flatMap((seg) => seg.split('_')).filter((t) => t && !STOP.has(t)).map((t) => t.toLowerCase())
}
function platform(path) { return path.split('/')[3] || '' }

/** 404 自愈：版本段归一化 + token 覆盖率 + 同平台加权。 */
export function suggestPaths(paths, requested, limit = 3) {
  const want = new Set(tokens(requested))
  const samePlatform = platform(requested)
  const scored = (paths || [])
    .filter((p) => typeof p === 'string' && p.includes('/api/v1/'))
    .map((path) => {
      const set = new Set(tokens(path))
      let hit = 0
      for (const token of want) if (set.has(token)) hit += 1
      const coverage = want.size ? hit / want.size : 0
      const score = coverage * 4 + (path.split('/').pop() === requested.split('/').pop() ? 3 : 0) +
        (platform(path) === samePlatform ? 2 : -3)
      return { path, score, coverage, exact: coverage === 1 && platform(path) === samePlatform }
    })
    .filter((row) => row.coverage >= 0.4)
    .sort((a, b) => b.score - a.score)
  const exact = scored.filter((row) => row.exact).slice(0, limit)
  return (exact.length ? exact : scored.slice(0, limit)).map(({ path, score, exact: isExact }) => ({ path, score, exact: isExact }))
}

export function localWhitelistPaths(endpoints) { return endpoints.map((e) => e.path) }

export function resetForTest() {
  live = null
  failedAt = 0
  try { if (existsSync(cacheFile())) writeFileSync(cacheFile(), '{}') } catch { /* ignore */ }
}
