// 平台文案规格 / 话题 / 指标字段对照。纯函数，零依赖，不联网。
// 规格来自 scripts/extract-platform-specs.mjs 从 AiToEarn v2.5 常量表抽取，
// advisory=true / verified=false：只作写作阶段的合规提示，不冒充平台官方限制。
import { readFileSync } from 'node:fs'

const DOC = JSON.parse(readFileSync(new URL('./platform-specs.json', import.meta.url), 'utf8'))

export const platformSpecDoc = DOC
export const METRIC_FIELDS = DOC.metricFields
export function allPlatformSpecs() { return DOC.platforms }

const norm = (x) => String(x ?? '').trim().toLowerCase()

/** 平台名有可能是中文名、TikHub 的英文 key 或 AiToEarn 的 slug，统一按别名表匹配。 */
export function platformSpec(name) {
  const key = norm(name)
  if (!key) return null
  return DOC.platforms.find((p) => norm(p.key) === key || p.aliases.some((a) => norm(a) === key)) || null
}

/** 话题归一化：与 AiToEarn publish.schema.ts 同规则（# + 字母数字下划线汉字，精确去重）。 */
export function normalizeTopics(input, spec = null) {
  const TOPIC_RE = /#([\w\p{Script=Han}]+)/gu
  const found = []
  if (Array.isArray(input)) {
    for (const row of input) {
      const text = String(row ?? '').trim().replace(/^#+/, '').trim()
      if (text) found.push(text)
    }
  } else if (typeof input === 'string') {
    for (const m of input.matchAll(TOPIC_RE)) found.push(m[1])
  }
  const topics = [...new Set(found)]
  const maxCount = spec?.topic?.maxCount ?? null
  const maxTotalLength = spec?.topic?.maxTotalLength ?? null
  const issues = []
  const kept = maxCount === null ? topics : topics.slice(0, maxCount)
  const overflow = maxCount === null ? [] : topics.slice(maxCount)
  if (overflow.length) issues.push({ path: 'topics', code: 'too_many', message: `话题 ${topics.length} 个，超过 ${maxCount} 个上限：${overflow.map((t) => '#' + t).join(' ')}`, limit: maxCount, actual: topics.length })
  const total = kept.reduce((n, t) => n + t.length, 0)
  if (maxTotalLength !== null && total > maxTotalLength) {
    issues.push({ path: 'topics', code: 'too_long', message: `话题总长 ${total} 字，超过 ${maxTotalLength} 字上限`, limit: maxTotalLength, actual: total })
  }
  return {
    topics: kept, overflow, count: topics.length, maxCount, maxTotalLength,
    supported: spec ? spec.topic.supported : null,
    issues,
  }
}

/** 把规格压成给模型看的一行约束，避免把整份 JSON 倒进提示词。 */
export function specSummary(spec) {
  if (!spec) return '（未收录该平台规格，按通用写法处理，不要臆造平台限制）'
  const c = spec.contentLimits
  const bits = []
  if (c.maxTitleLength !== null) bits.push(`标题 ≤ ${c.maxTitleLength} 字${c.maxTitleLength === 0 ? '（该平台无标题字段）' : ''}`)
  if (c.maxBodyLength !== null) bits.push(`正文 ≤ ${c.maxBodyLength} 字`)
  if (c.maxTotalTextLength !== null) bits.push(`标题+正文 ≤ ${c.maxTotalTextLength} 字`)
  if (c.maxImages !== null) bits.push(`图片 ≤ ${c.maxImages} 张`)
  if (c.maxVideos !== null) bits.push(`视频 ≤ ${c.maxVideos} 个`)
  if (spec.topic.maxCount !== null) bits.push(`话题 ≤ ${spec.topic.maxCount} 个`)
  if (spec.topic.maxTotalLength !== null) bits.push(`话题总长 ≤ ${spec.topic.maxTotalLength} 字`)
  if (spec.topic.supported === false) bits.push('该平台不支持原生话题字段')
  return `${spec.displayName}：${bits.join('、') || '无明确字数限制'}（仅供参考，以平台实际限制为准）`
}

/** 多个平台的规格约束，注入 derive 提示词。 */
export function specsForPrompt(platforms = []) {
  return platforms.map((p) => {
    const spec = platformSpec(p)
    return `- ${spec ? specSummary(spec) : `${p}：未收录规格，按通用写法处理，不要臆造平台限制`}`
  }).join('\n')
}

/**
 * 确定性合规体检（不调用模型、不预测表现）。
 * issues 带 path/code/limit/actual，便于定点修改某个字段后重检。
 */
export function checkDraftAgainstSpec(draft = {}, name = null) {
  const spec = platformSpec(name || draft.platform)
  if (!spec) {
    return { matched: false, ok: true, issues: [], checks: {}, advisory: true, verified: false,
      note: '未收录该平台规格，已跳过合规检查（不臆造平台限制）。' }
  }
  const c = spec.contentLimits
  const title = String(draft.title || '')
  const body = String(draft.body || '')
  const images = Array.isArray(draft.images) ? draft.images.length : null
  const videos = Array.isArray(draft.videos) ? draft.videos.length : null
  const topics = normalizeTopics(draft.topics || body, spec)
  const issues = [...topics.issues]
  const checks = {}
  const limit = (path, label, value, max) => {
    if (max === null || max === undefined) return
    checks[path] = { limit: max, actual: value, ok: value <= max }
    if (value > max) issues.push({ path, code: 'too_long', message: `${label} ${value} 字，超过 ${max} 字上限`, limit: max, actual: value })
  }
  limit('title', '标题', title.length, c.maxTitleLength)
  limit('body', '正文', body.length, c.maxBodyLength)
  limit('total', '标题+正文', title.length + body.length, c.maxTotalTextLength)
  for (const [path, label, value, max] of [['images', '图片', images, c.maxImages], ['videos', '视频', videos, c.maxVideos]]) {
    if (value === null || max === null || max === undefined) continue
    checks[path] = { limit: max, actual: value, ok: value <= max }
    if (value > max) issues.push({ path, code: 'too_big', message: `${label} ${value} 个，超过 ${max} 个上限`, limit: max, actual: value })
  }
  checks.topics = { limit: topics.maxCount, actual: topics.count, ok: topics.issues.length === 0 }
  return {
    matched: true, key: spec.key, displayName: spec.displayName,
    ok: issues.length === 0, issues, checks,
    advisory: DOC.advisory, verified: DOC.verified,
    note: DOC.note,
  }
}

// 平台原始字段名 → 统一字段名。只做对照，不替换原有 metrics。
const RAW_TO_CANONICAL = {
  ...Object.fromEntries(Object.entries(DOC.metricMap).map(([short, canonical]) => [short, canonical])),
  view_count: 'viewCount', play_count: 'playCount', vv: 'viewCount', read_count: 'readCount',
  impression_count: 'impressionCount', reach: 'reachCount', reach_count: 'reachCount',
  digg_count: 'likeCount', like_count: 'likeCount', liked_count: 'likeCount', praise_count: 'likeCount',
  favorite_count: 'collectCount', collect_count: 'collectCount', collected_count: 'collectCount', bookmark_count: 'saveCount',
  reply_count: 'commentCount', comment_count: 'commentCount',
  retweet_count: 'shareCount', forward_count: 'shareCount', share_count: 'shareCount',
  click_count: 'clickCount', engagement_count: 'engagementCount', watch_time: 'watchTimeSeconds',
  subscriberCount: 'fansCount', videoCount: 'workCount', fans_count: 'fansCount',
}
const CANONICAL = new Set([...METRIC_FIELDS.works, ...METRIC_FIELDS.accounts])

/**
 * 把 TikHub collectStats 的短名 / 平台原始字段，对照成 AiToEarn 统一指标字段名。
 * 未知字段一律进 unmapped 保留，不丢数、不补造；返回值只做「额外一层」，原 metrics 不变。
 */
export function normalizeMetrics(raw = {}) {
  const normalized = {}
  const unmapped = {}
  if (!raw || typeof raw !== 'object') return { normalized, unmapped, fieldCount: 0, unknownFields: [] }
  for (const [key, value] of Object.entries(raw)) {
    const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : null)
    if (n === null || !Number.isFinite(n)) { unmapped[key] = value; continue }
    const canonical = CANONICAL.has(key) ? key : RAW_TO_CANONICAL[norm(key)]
    if (canonical) normalized[canonical] = Math.max(normalized[canonical] || 0, n)
    else unmapped[key] = value
  }
  return { normalized, unmapped, fieldCount: Object.keys(normalized).length, unknownFields: Object.keys(unmapped) }
}
