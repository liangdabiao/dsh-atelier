// 把端点白名单里的技术参数（paramsMap / required / defaults）翻译成普通人能填的字段。
// 不新增端点、不猜测参数：一切来自 endpoints.json，UI 只负责渲染。
const LABELS = {
  keyword: '搜索关键词', workId: '作品 ID', itemId: '作品 ID', shareUrl: '作品分享链接',
  xsecToken: '小红书 xsec_token', secUserId: '账号 sec_user_id', secUid: 'TikTok secUid',
  chId: '话题 ID', cursor: '翻页游标', page: '页码', pageSize: '每页条数', count: '每页条数',
  type: '榜单类型', order: '排序方式', boardType: '榜单类型', boardSubType: '子榜类型',
  userId: '用户 ID',
}
const HINTS = {
  keyword: '想找什么就写什么，例如「内容创作」',
  workId: '平台作品 ID（一长串数字）。可从作品链接复制，或直接在下面的信号卡片上点「取详情」',
  shareUrl: '粘贴抖音分享链接，插件会自动解析出作品 ID',
  xsecToken: '小红书笔记详情必需，通常在搜索结果或笔记链接里',
  secUserId: '达人主页链接里的 sec_user_id',
  secUid: 'TikTok 达人主页的 secUid',
  chId: '话题/挑战的 ID',
}
const NUMERIC = new Set(['page', 'pageSize', 'cursor', 'count', 'type', 'boardType', 'boardSubType'])
const ADVANCED = new Set(['page', 'pageSize', 'cursor', 'count', 'type', 'order', 'boardType', 'boardSubType'])

/** 生成字段清单：主字段给人填，翻页/榜单参数收进「更多参数」。 */
export function fieldsFor(spec = {}) {
  const map = spec.paramsMap || {}
  const mappedSnakes = new Set(Object.values(map))
  const out = []
  for (const [camel, snake] of Object.entries(map)) {
    const def = spec.defaults?.[snake]
    out.push({
      key: camel,
      label: LABELS[camel] || snake,
      required: (spec.required || []).includes(snake),
      type: NUMERIC.has(camel) ? 'number' : 'text',
      defaultValue: def === undefined || def === null || def === '' ? '' : String(def),
      advanced: ADVANCED.has(camel),
      hint: HINTS[camel] || '',
      placeholder: HINTS[camel] || snake,
    })
  }
  // required 里有但没在 paramsMap 出现的，补一个同名输入框，不让用户卡住
  for (const snake of spec.required || []) {
    if (mappedSnakes.has(snake) || out.some((f) => f.key === snake)) continue
    out.push({
      key: snake, label: LABELS[snake] || snake, required: true,
      type: NUMERIC.has(snake) ? 'number' : 'text', defaultValue: '', advanced: false,
      hint: HINTS[snake] || '', placeholder: HINTS[snake] || snake,
    })
  }
  return out
}

/** 把表单值组装成 params（camelCase，交给 tikhub.buildFinalParams 映射成真实参数名）。 */
export function buildParams(values = {}, spec = {}) {
  const out = {}
  for (const field of fieldsFor(spec)) {
    const raw = values?.[field.key]
    if (raw === undefined || raw === null || String(raw).trim() === '') continue
    if (field.type === 'number') {
      const num = Number(raw)
      if (!Number.isFinite(num)) continue
      out[field.key] = num
    } else out[field.key] = String(raw).trim()
  }
  return out
}

/** 常见采集预设：页面一键带入，用户不必理解 endpointKey。 */
export const PRESETS = [
  { key: 'hot.search', label: '抖音热搜', desc: '看当下大家在搜什么', params: {} },
  { key: 'note.search', label: '搜小红书笔记', desc: '搜一个关键词的笔记', params: { keyword: '内容创作' } },
  { key: 'general.search', label: '搜抖音内容', desc: '抖音综合搜索', params: { keyword: '内容创作' } },
  { key: 'suggest.words', label: '小红书联想词', desc: '找标题里能用的词', params: { keyword: '内容创作' } },
  { key: 'trend.words', label: 'TikTok 趋势词', desc: '海外趋势词', params: {} },
  { key: 'hot.challenge', label: '抖音话题榜', desc: '热门话题', params: {} },
]
