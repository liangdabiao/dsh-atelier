(function () {
  'use strict'
  var BASE = '/atelier'
  var S = { page: 'home', health: null, state: null, endpoints: [], actions: [], spec: null }
  var PAGES = [
    ['home', '总台', '接入状态、链路进度与最近数据'],
    ['radar', '信源工作台', 'TikHub 多源采集 → 信号 → 可回溯证据'],
    ['deconstruct', '拆解与方向', '基于真实证据拆结构、给差异化方向'],
    ['drafts', '稿件与体检', '出稿 / 版本 / 派生 / 导出'],
    ['retro', '复盘与规则', '作品登记 / 指标回查 / 校准 / 规则审核'],
    ['settings', '设置', '密钥、限流、端点校验'],
  ]
  function el(tag, props) {
    var node = document.createElement(tag)
    props = props || {}
    for (var k in props) {
      if (k === 'class') node.className = props[k]
      else if (k === 'text') node.textContent = props[k] == null ? '' : String(props[k])
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2).toLowerCase(), props[k])
      else if (props[k] !== null && props[k] !== undefined && props[k] !== false) node.setAttribute(k, props[k] === true ? '' : props[k])
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i]
      if (child == null || child === false) continue
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c) })
      else node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child)
    }
    return node
  }
  function badge(text, cls) { return el('span', { class: 'badge ' + (cls || '') }, String(text == null ? '' : text)) }
  function card(title, sub) {
    var c = el('div', { class: 'card' }, el('h2', {}, title))
    if (sub) c.appendChild(el('p', { class: 'muted' }, sub))
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i]
      if (!child) continue
      if (Array.isArray(child)) child.forEach(function (x) { if (x) c.appendChild(x) })
      else c.appendChild(child)
    }
    return c
  }
  function item(title, meta, body) {
    var box = el('div', { class: 'item' }, el('div', { class: 't' }, title || '(无标题)'))
    if (meta) box.appendChild(el('div', { class: 'm' }, meta))
    if (body) box.appendChild(body)
    return box
  }
  function kv(obj) { return Object.keys(obj || {}).map(function (k) { return k + '=' + (typeof obj[k] === 'object' ? JSON.stringify(obj[k]) : obj[k]) }).join(' · ') }
  function ts(v) { return v ? String(v).slice(0, 16).replace('T', ' ') : '—' }
  function list(rows, empty) {
    var box = el('div', { class: 'list' })
    if (!rows || !rows.length) box.appendChild(el('div', { class: 'muted' }, empty || '（暂无数据）'))
    else rows.forEach(function (r) { box.appendChild(r) })
    return box
  }

  function toast(message, isError) {
    var box = document.getElementById('toast')
    box.textContent = String(message || '')
    box.className = 'toast' + (isError ? ' error' : '')
    box.hidden = false
    clearTimeout(toast.timer)
    toast.timer = setTimeout(function () { box.hidden = true }, 6000)
  }
  async function api(path, options) {
    var res = await fetch(BASE + path, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {}))
    var body
    try { body = await res.json() } catch (e) { throw new Error('返回不是 JSON (HTTP ' + res.status + ')') }
    if (!res.ok && !body.error) throw new Error('HTTP ' + res.status)
    return body
  }
  async function op(action, args, quiet) {
    try {
      var result = await api('/api/ops', { method: 'POST', body: JSON.stringify({ op: action, args: args || {} }) })
      if (!quiet) {
        if (result.ok) toast(result.summary || '完成')
        else toast((result.error || result.summary || '失败') + (result.nextStep ? ' ｜ ' + result.nextStep : ''), true)
      }
      await refresh()
      return result
    } catch (err) { toast(err.message, true); return { ok: false, error: err.message } }
  }
  function parseJsonField(value, name) {
    if (!value || !String(value).trim()) return {}
    try { return JSON.parse(value) } catch (e) { throw new Error(name + ' 不是合法 JSON：' + e.message) }
  }
  function form(specs, buttons, onSubmit) {
    var f = el('form', { class: 'form' })
    var controls = {}
    specs.forEach(function (s) {
      var input
      if (s.type === 'textarea' || s.type === 'json') {
        input = el('textarea', { placeholder: s.placeholder || '', rows: s.rows || 2 })
        input.value = s.value == null ? (s.type === 'json' ? '{}' : '') : String(s.value)
      } else if (s.type === 'select') {
        input = el('select')
        ;(s.options || []).forEach(function (o) {
          var opt = el('option', { value: o.value }, o.label)
          if (String(o.value) === String(s.value)) opt.selected = true
          input.appendChild(opt)
        })
      } else {
        input = el('input', { type: s.type === 'checkbox' ? 'checkbox' : (s.type || 'text'), placeholder: s.placeholder || '' })
        if (s.type === 'checkbox') input.checked = Boolean(s.value)
        else input.value = s.value == null ? '' : String(s.value)
      }
      input.name = s.key
      controls[s.key] = input
      var label = el('label', { class: 'f' }, s.label)
      if (s.type === 'checkbox') {
        label.appendChild(el('span', { class: 'row' }, input, document.createTextNode(' ' + (s.hint || '我已确认'))))
      } else { label.appendChild(input) }
      if (s.hint && s.type !== 'checkbox') label.appendChild(el('span', { class: 'muted' }, s.hint))
      f.appendChild(label)
    })
    var row = el('div', { class: 'row' })
    buttons.forEach(function (b) {
      row.appendChild(el('button', { type: 'submit', class: 'btn ' + (b.cls || ''), 'data-act': b.value }, b.label))
    })
    f.appendChild(row)
    f.addEventListener('submit', function (event) {
      event.preventDefault()
      var act = (event.submitter && event.submitter.getAttribute('data-act')) || buttons[0].value
      var values = {}
      try {
        specs.forEach(function (s) {
          var input = controls[s.key]
          if (s.type === 'checkbox') values[s.key] = input.checked
          else if (s.type === 'json') values[s.key] = parseJsonField(input.value, s.label)
          else values[s.key] = input.value.trim()
        })
        Promise.resolve(onSubmit(values, act)).catch(function (e) { toast(e.message, true) })
      } catch (e) { toast(e.message, true) }
    })
    return f
  }
  function selectFrom(rows, valueKey, labelFn, emptyLabel) {
    return [{ value: '', label: emptyLabel || '（不选 / 用最近一条）' }].concat(rows.map(function (r) {
      return { value: r[valueKey], label: labelFn(r) }
    }))
  }

  // -------------------------------------------------------------------------
  function renderNav() {
    var nav = document.getElementById('nav')
    nav.textContent = ''
    PAGES.forEach(function (p) {
      nav.appendChild(el('button', {
        class: S.page === p[0] ? 'active' : '', title: p[1],
        onclick: function () { S.page = p[0]; render() },
      }, el('span', {}, p[1])))
    })
    var page = PAGES.filter(function (p) { return p[0] === S.page })[0] || PAGES[0]
    document.getElementById('pageTitle').textContent = page[1]
    document.getElementById('pageSub').textContent = page[2]
  }
  function statCard(label, value, note) {
    return el('div', { class: 'card' }, el('h3', {}, label), el('div', { class: 'stat' }, String(value)), el('div', { class: 'muted' }, note || ''))
  }

  function pageHome(st) {
    var h = S.health || {}
    var t = h.tikhub || {}
    var cards = el('div', { class: 'grid' },
      statCard('信号 / 证据', (h.counts ? h.counts.signals : 0) + ' / ' + (h.counts ? h.counts.evidence : 0), '创作前信息来源'),
      statCard('稿件 / 版本', h.counts ? h.counts.drafts : 0, '追加不可变'),
      statCard('指标快照', h.counts ? h.counts.snapshots : 0, 'API 与手工分组'),
      statCard('已激活规则', (st.rules || []).filter(function (r) { return r.status === 'active' }).length, '人工审核后生效'))
    var status = card('接入状态', h.summary || '',
      el('div', { class: 'row' },
        badge(t.configured ? 'TikHub 已配置' : 'TikHub 未配置', t.configured ? 'ok' : 'warn'),
        badge(t.tokenMasked || '—', ''),
        badge((h.spec && h.spec.checked) ? '线上 spec 已校验 ' + h.spec.version : '端点静态校验 V5.3.2', (h.spec && h.spec.checked) ? 'ok' : ''),
        badge('模型：宿主默认', 'brand'),
        badge('apiz：CLI 自管', 'brand')),
      el('div', { class: 'hr' }),
      el('div', { class: 'muted' }, '信息来源：热榜 / 搜索联想 / 话题 / 对标账号 / 作品详情 / 评论原话；数据反馈：按作品 ID 回查 T+1/3/7。外部服务不可用时纯文本链路仍完整。'))
    var quick = card('快捷动作', '',
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: function () { op('radar', { endpointKey: 'hot.search', params: {}, limit: 20 }) } }, '采集抖音热搜'),
        el('button', { class: 'btn soft', onclick: function () { op('radar', { endpointKey: 'note.search', params: { keyword: '内容创作' }, limit: 10 }) } }, '搜小红书笔记'),
        el('button', { class: 'btn ghost', onclick: function () { S.page = 'settings'; render() } }, '去设置填 Key')),
      form([{ key: 'content', label: '随手记一条灵感 / 贴素材', placeholder: '一句话…' }],
        [{ value: 'capture', label: '记下来' }],
        function (v) { return v.content ? op('capture', { content: v.content }) : toast('先写点内容', true) }))
    var recentSignals = list((st.signals || []).slice(-8).reverse().map(function (s) {
      return item(s.title, '[' + s.platform + '] ' + s.sourceType + ' · ' + ts(s.fetchedAt) + ' · ' + kv(s.baselineStats), null)
    }), '还没有信号，先去「信源工作台」采集。')
    var recentDrafts = list((st.drafts || []).slice(-5).reverse().map(function (d) {
      return item(d.title, d.platform + ' · v' + d.versionNo + ' · ' + ts(d.createdAt),
        el('details', {}, el('summary', {}, '展开正文'), el('pre', {}, (d.body || '').slice(0, 1500))))
    }), '还没有稿件。')
    return [cards, status, quick, el('div', { class: 'split' },
      card('最近信号', '', recentSignals), card('最近稿件', '', recentDrafts))]
  }

  function pageRadar(st) {
    var info = S.endpoints.filter(function (e) { return e.group === 'info' })
    var epOptions = info.map(function (e) { return { value: e.key, label: e.label + ' · ' + e.key + (e.cost === 'high' ? ' (高成本)' : '') } })
    var radarForm = card('采集 → 信号 → 证据', '端点来自白名单，路径由插件管理；高成本动作（评论）需勾选确认。',
      form([
        { key: 'endpointKey', label: '端点', type: 'select', options: epOptions, value: 'hot.search' },
        { key: 'params', label: '参数（JSON）', type: 'json', value: '{}', hint: '例：{"keyword":"内容创作"} / {"workId":"7xxx"}' },
        { key: 'limit', label: '入库上限', value: '20' },
        { key: 'confirm', label: '高成本确认', type: 'checkbox', value: false, hint: '评论采集会消耗额度，确认后执行' },
      ],
        [{ value: 'radar', label: '执行采集' }, { value: 'preview', label: '仅预览', cls: 'ghost' }],
        function (v, act) {
          var args = { endpointKey: v.endpointKey, params: v.params, limit: Number(v.limit) || 20, confirm: v.confirm }
          if (act === 'preview') args.dryRun = true
          return op('radar', args)
        }))
    var sigRows = (st.signals || []).slice(-20).reverse().map(function (s) {
      return item(s.title, '[' + s.platform + '] ' + s.endpoint + ' · ' + ts(s.fetchedAt) + (s.unverified ? ' · 未解析出标准字段' : '') + ' · ' + kv(s.baselineStats),
        el('div', { class: 'row' },
          el('button', { class: 'btn sm soft', onclick: function () { op('evidence', { endpointKey: 'work.detail', params: { workId: s.id }, signalId: s.id, confirm: false }) } }, '试取详情'),
          el('button', { class: 'btn sm ghost', onclick: function () { op('watch', { kind: 'benchmark', platform: s.platform, workId: s.id, signalId: s.id }) } }, '设为对标')))
    })
    var evForm = card('补证据：详情 / 评论原话', '每条证据都记 endpoint、参数、抓取时间与原始响应位置。',
      form([
        { key: 'endpointKey', label: '端点', type: 'select', options: epOptions, value: 'comments.douyin.app' },
        { key: 'params', label: '参数（JSON）', type: 'json', value: '{}' },
        { key: 'signalId', label: '关联信号 id（可空）', placeholder: 'sig_...' },
        { key: 'confirm', label: '高成本确认', type: 'checkbox', value: false },
      ], [{ value: 'evidence', label: '取证据' }],
        function (v) { return op('evidence', { endpointKey: v.endpointKey, params: v.params, signalId: v.signalId, confirm: v.confirm }) }))
    var evRows = (st.evidence || []).slice(-30).reverse().map(function (e) {
      return item(String(e.text || '').slice(0, 140),
        '[' + e.kind + '] ' + e.endpoint + ' · ' + ts(e.fetchedAt) + (e.unverified ? ' · 未验真' : '') + ' · ' + (e.rawRef || ''),
        el('div', { class: 'row' }, badge(e.id, 'brand'), e.url ? el('a', { class: 'muted', href: e.url, target: '_blank', rel: 'noreferrer' }, '原文 ↗') : null))
    })
    return [el('div', { class: 'split' }, radarForm, evForm),
      el('div', { class: 'split' }, card('信号', (st.signals || []).length + ' 条', list(sigRows)), card('证据', (st.evidence || []).length + ' 条', list(evRows)))]
  }

  function pageDeconstruct(st) {
    var decs = st.deconstructions || []
    var angles = st.angles || []
    var formBox = card('拆解与差异化方向', '模型只依据已取回的真实证据；没有证据时不会编造。',
      form([
        { key: 'evidenceIds', label: '证据 id（逗号分隔，留空=全部最近 60 条）', placeholder: 'evi_..., evi_...' },
        { key: 'campaignId', label: '母题 id（可空）' },
        { key: 'deconstructId', label: '拆解 id（生成方向时用，留空=最近一条）' },
      ],
        [{ value: 'deconstruct', label: '① 基于证据拆解' }, { value: 'angles', label: '② 生成 ≥3 个方向', cls: 'soft' }],
        function (v, act) {
          var ids = v.evidenceIds ? v.evidenceIds.split(',').map(function (x) { return x.trim() }).filter(Boolean) : []
          if (act === 'deconstruct') return op('deconstruct', { evidenceIds: ids, campaignId: v.campaignId })
          return op('angles', { deconstructId: v.deconstructId, campaignId: v.campaignId })
        }))
    var decRows = decs.slice(-8).reverse().map(function (d) {
      return item('钩子：' + (d.hook || '—'), '模式：' + (d.pattern || '—') + ' · 引用 ' + (d.evidenceRefs || []).length + ' 条证据 · ' + ts(d.createdAt),
        el('div', {}, (d.structure || []).map(function (s) { return el('div', { class: 'muted' }, '· ' + s) })))
    })
    var angleRows = angles.slice(-12).reverse().map(function (a) {
      return item('[' + a.kind + '] ' + a.title, a.rationale || '', el('div', { class: 'row' }, badge(a.id, 'brand'),
        el('button', { class: 'btn sm ghost', onclick: function () { S.page = 'drafts'; render(); toast('已在稿件页选用方向 ' + a.id + '，请填入「方向 id」') } }, '去出稿')))
    })
    return [formBox, el('div', { class: 'split' },
      card('拆解结果', decs.length + ' 条', list(decRows)),
      card('差异化方向', angles.length + ' 个 · 人工选一后到稿件页出稿', list(angleRows)))]
  }

  function pageDrafts(st) {
    var drafts = st.drafts || []
    var angleOpts = selectFrom(st.angles || [], 'id', function (a) { return a.kind + ' · ' + a.title }, '（不选 = 用最近一个方向）')
    var draftOpts = selectFrom(drafts, 'id', function (d) { return d.title + ' / ' + d.platform + ' v' + d.versionNo }, '（不选 = 用最近一篇稿件）')
    var formBox = card('出稿 / 体检 / 派生 / 导出', '稿件版本只追加、不可覆盖；派生稿各自回溯到母稿。',
      form([
        { key: 'angleId', label: '方向 id', type: 'select', options: angleOpts },
        { key: 'topic', label: '母题 / 补充要求', placeholder: '例：AI 工具的真实使用门槛' },
        { key: 'draftId', label: '稿件 id（体检 / 派生 / 导出用）', type: 'select', options: draftOpts },
        { key: 'platforms', label: '派生平台（逗号分隔）', value: '小红书,抖音,公众号' },
        { key: 'format', label: '导出格式', type: 'select', options: [{ value: 'md', label: 'Markdown' }, { value: 'html', label: 'HTML' }] },
      ],
        [{ value: 'draft', label: '① 出稿' }, { value: 'review', label: '体检', cls: 'soft' }, { value: 'derive', label: '派生', cls: 'soft' }, { value: 'export', label: '导出', cls: 'ghost' }],
        function (v, act) {
          if (act === 'draft') return op('draft', { angleId: v.angleId, campaignTopic: v.topic, platform: '母稿' })
          if (act === 'review') return op('review', { draftId: v.draftId })
          if (act === 'derive') return op('derive', { draftId: v.draftId, platforms: v.platforms.split(/[,，]/).map(function (x) { return x.trim() }).filter(Boolean) })
          return op('export', { draftId: v.draftId, format: v.format })
        }))
    var rows = drafts.slice(-20).reverse().map(function (d) {
      return item(d.title, d.platform + ' · v' + d.versionNo + ' · ' + (d.changeLog || '') + ' · ' + ts(d.createdAt) + (d.parentId ? ' · 父稿 ' + d.parentId : ''),
        el('details', {}, el('summary', {}, '展开正文 / 提纲'), el('pre', {}, (d.body || '').slice(0, 3000))))
    })
    var assessments = (st.assessments || []).slice(-8).reverse().map(function (a) {
      return item('体检 ' + a.draftId, kv(a.dimensions) + ' · 仅质量诊断，非表现预测', null)
    })
    return [formBox, el('div', { class: 'split' }, card('稿件', drafts.length + ' 篇', list(rows)), card('体检记录', '', list(assessments)))]
  }

  function pageRetro(st) {
    var works = (st.publishedWorks || []).concat(st.benchmarkWatch || [])
    var workOpts = selectFrom(works, 'id', function (w) { return (w.kind === 'benchmark' ? '对标 ' : '发布 ') + w.platform + ':' + w.workId }, '（手动填平台与作品 ID）')
    var draftOpts = selectFrom(st.drafts || [], 'id', function (d) { return d.title }, '（不选 = 最近一篇）')
    var watchForm = card('① 登记作品 / 对标', '抖音分享链接可自动解析作品 ID；对标作品会记录 baseline 指标用于算增量。',
      form([
        { key: 'kind', label: '类型', type: 'select', options: [{ value: 'published', label: '我发布的作品' }, { value: 'benchmark', label: '对标作品' }] },
        { key: 'platform', label: '平台', type: 'select', options: ['douyin', 'xiaohongshu', 'tiktok', 'wechat', 'bilibili'].map(function (x) { return { value: x, label: x } }) },
        { key: 'workId', label: '作品 ID', placeholder: 'aweme_id / note_id / itemId' },
        { key: 'shareUrl', label: '或填分享链接（抖音）', placeholder: 'https://...' },
        { key: 'publishedAt', label: '发布时间（可空）', placeholder: '2026-11-09' },
      ], [{ value: 'watch', label: '登记' }],
        function (v) { return op('watch', v) }))
    var feedbackForm = card('② T+N 指标回查', '自动回查成功记 origin=api；失败或未覆盖的平台记 api_failed / 手工补录 manual，复盘时不混算。',
      form([
        { key: 'workId', label: '已登记作品', type: 'select', options: workOpts },
        { key: 'day', label: 'T+N（1 / 3 / 7）', value: '1' },
        { key: 'endpointKey', label: '覆盖端点（可空，按平台自动选）', placeholder: 'metrics.tiktok / work.detail ...' },
        { key: 'xsecToken', label: '小红书 xsec_token（可空）' },
        { key: 'manual', label: '手工补录指标（JSON，填了就走 manual 通道）', type: 'json', value: '' },
      ],
        [{ value: 'auto', label: '自动回查' }, { value: 'manual', label: '手工补录', cls: 'soft' }],
        function (v, act) {
          var args = { workId: v.workId, day: Number(v.day) || 1 }
          if (v.endpointKey) args.endpointKey = v.endpointKey
          if (v.xsecToken) args.xsecToken = v.xsecToken
          if (act === 'manual') args.manual = v.manual
          return op('feedback', args)
        }))
    var predictForm = card('③ 发布前判断 / 复盘 / 规则', '判断锁定后不可覆盖；规则必须人工审核才会影响后续生成。',
      form([
        { key: 'draftId', label: '稿件', type: 'select', options: draftOpts },
        { key: 'predictionId', label: '复盘用的判断 id（可空=最近一条）' },
        { key: 'ruleName', label: '手动新增规则：名称' },
        { key: 'ruleText', label: '手动新增规则：内容' },
      ],
        [{ value: 'predict', label: '锁定判断' }, { value: 'retro', label: '复盘校准', cls: 'soft' },
          { value: 'propose', label: '生成规则建议', cls: 'soft' }, { value: 'add', label: '手动加规则', cls: 'ghost' }],
        function (v, act) {
          if (act === 'predict') return op('predict', { draftId: v.draftId })
          if (act === 'retro') return op('retro', { predictionId: v.predictionId })
          if (act === 'propose') return op('rule', { op: 'propose' })
          if (!v.ruleName) { toast('请填规则名称', true); return null }
          return op('rule', { op: 'add', name: v.ruleName, text: v.ruleText })
        }))
    var snapRows = (st.snapshots || []).slice(-20).reverse().map(function (s) {
      var cls = s.origin === 'api' ? 'ok' : (s.origin === 'manual' ? 'warn' : 'err')
      return item(badge(s.origin, cls) + ' ' + s.platform + ':' + s.workId + ' T+' + (s.day == null ? '—' : s.day),
        kv(s.metrics) + ' · ' + (s.endpoint || '') + ' · ' + ts(s.fetchedAt) + (s.limited ? ' · ' + s.limited : ''), null)
    })
    var ruleRows = (st.rules || []).slice(-20).reverse().map(function (r) {
      return item('[' + r.status + '] ' + r.name, r.text + ' · 证据 ' + (r.evidenceIds || []).length + ' 条 · ' + r.id,
        r.status === 'proposed' ? el('div', { class: 'row' },
          el('button', { class: 'btn sm', onclick: function () { op('rule', { op: 'activate', id: r.id }) } }, '审核激活'),
          el('button', { class: 'btn sm ghost', onclick: function () { op('rule', { op: 'reject', id: r.id }) } }, '驳回')) : null)
    })
    var workRows = works.slice(-12).reverse().map(function (w) {
      return item((w.kind === 'benchmark' ? '对标 ' : '发布 ') + w.platform + ':' + w.workId,
        'baseline ' + kv(w.baselineStats) + ' · 回查 ' + (w.followups || []).length + ' 次' + (w.delta ? ' · 增量 ' + kv(w.delta) : ''), null)
    })
    return [el('div', { class: 'split' }, watchForm, feedbackForm), predictForm,
      el('div', { class: 'split' }, card('作品与对标', '', list(workRows)), card('指标快照', (st.snapshots || []).length + ' 条', list(snapRows))),
      el('div', { class: 'split' }, card('经验规则', '未审核不生效', list(ruleRows)),
        card('校准记录', '', list((st.retros || []).slice(-8).reverse().map(function (r) {
          return item('复盘 ' + r.id, '假设：' + (r.hypothesis || '—') + ' · API ' + (r.groups ? r.groups.api : 0) + ' / 手工 ' + (r.groups ? r.groups.manual : 0), null)
        }))))]
  }

  function pageSettings() {
    var t = (S.health && S.health.tikhub) || {}
    var spec = S.spec || {}
    var validation = spec.validation || {}
    var settingsForm = card('密钥与运行参数', 'TikHub key 只存在本机的 settings.json（0600），接口只回掩码；apiz 认证由 CLI 自管，插件不接触。',
      form([
        { key: 'tikhubKey', label: 'TikHub API Key', type: 'password', value: '', placeholder: '留空表示不修改' },
        { key: 'rpm', label: '全局 rpm', value: String(t.rpm || 30) },
        { key: 'perEndpointRps', label: '每端点 RPS（官方多数 5）', value: String(t.perEndpointRps || 5) },
        { key: 'cacheTtl', label: '缓存 TTL（秒）', value: String(t.cacheTtl || 1800) },
        { key: 'apizBin', label: 'apiz 可执行路径（可空=用 PATH）', value: t.apizBin || '' },
        { key: 'defaultImageModel', label: '默认生图模型（可空=实时发现）', value: t.defaultImageModel || '' },
        { key: 'maxImagesPerRun', label: '单次生图上限', value: String(t.maxImagesPerRun || 3) },
        { key: 'proxyUrl', label: '代理 URL（可空）', value: '' },
      ],
        [{ value: 'save', label: '保存设置' }, { value: 'clear', label: '清除密钥', cls: 'ghost' }, { value: 'spec', label: '联网校验端点', cls: 'soft' }],
        async function (v, act) {
          if (act === 'clear') { await api('/api/settings', { method: 'DELETE' }); toast('已清除密钥'); return refresh() }
          if (act === 'spec') { toast('正在拉取线上 OpenAPI…'); await api('/api/spec/refresh', { method: 'POST', body: '{}' }); await refresh(); return toast('端点校验完成') }
          var patch = { rpm: Number(v.rpm), perEndpointRps: Number(v.perEndpointRps), cacheTtl: Number(v.cacheTtl), apizBin: v.apizBin, defaultImageModel: v.defaultImageModel, maxImagesPerRun: Number(v.maxImagesPerRun) }
          if (v.tikhubKey) patch.tikhubKey = v.tikhubKey
          if (v.proxyUrl) patch.proxyUrl = v.proxyUrl
          await api('/api/settings', { method: 'POST', body: JSON.stringify(patch) })
          toast('设置已保存'); return refresh()
        }))
    var statusRows = [
      item('当前密钥', (t.tokenMasked || '未配置') + ' · 来源 ' + (t.source || 'none') + ' · ' + (t.file || ''), ''),
      item('线上 OpenAPI', (spec.status && spec.status.checked) ? (spec.status.version + ' / ' + spec.status.pathCount + ' paths / ' + spec.status.checkedAt) : '未同步（白名单按 V5.3.2 静态校验）', ''),
      item('白名单校验', validation.checked != null ? (validation.checked + '/' + validation.total + ' 命中线上 spec') : '未校验', (validation.missing || []).map(function (m) { return m.key + ' ' + m.path }).join('\n')),
    ]
    var actionsTable = el('table')
    actionsTable.appendChild(el('thead', {}, el('tr', {}, el('th', {}, 'action'), el('th', {}, '说明'), el('th', {}, '需模型'), el('th', {}, '需确认'))))
    var tbody = el('tbody')
    ;(S.actions || []).forEach(function (a) {
      tbody.appendChild(el('tr', {}, el('td', {}, a.key), el('td', {}, a.label), el('td', {}, a.ai ? '是' : '否'), el('td', {}, a.needsConfirm ? '是' : '否')))
    })
    actionsTable.appendChild(tbody)
    return [settingsForm, el('div', { class: 'split' },
      card('状态', '', list(statusRows)),
      card('诚实边界', '', el('div', { class: 'muted' },
        'TikTok 有专用 analytics；抖音没有通用 analytics，主要靠按 ID 重拉详情里的公开互动数，billboard 分析只覆盖上榜作品；小红书详情需要 xsec_token；视频号 / 公众号基本拿不到发布后指标。公开互动数不等于平台后台的完播率 / 粉丝画像。'))),
      card('动作清单', '', actionsTable)]
  }

  function render() {
    renderNav()
    var view = document.getElementById('view')
    view.textContent = ''
    var st = S.state || {}
    var blocks
    try {
      if (S.page === 'home') blocks = pageHome(st)
      else if (S.page === 'radar') blocks = pageRadar(st)
      else if (S.page === 'deconstruct') blocks = pageDeconstruct(st)
      else if (S.page === 'drafts') blocks = pageDrafts(st)
      else if (S.page === 'retro') blocks = pageRetro(st)
      else blocks = pageSettings()
    } catch (err) { blocks = [card('渲染出错', err.message)] }
    blocks.forEach(function (b) { if (b) view.appendChild(b) })
  }

  async function refresh() {
    try {
      var results = await Promise.all([
        api('/api/health'), api('/api/state'), api('/api/endpoints'), api('/api/actions'), api('/api/spec'),
      ])
      S.health = results[0]; S.state = results[1]; S.endpoints = results[2]; S.actions = results[3]; S.spec = results[4]
      document.getElementById('navStatus').textContent = (S.health.tikhub && S.health.tikhub.configured) ? 'TikHub 已配置' : 'TikHub 未配置'
      render()
    } catch (err) {
      document.getElementById('navStatus').textContent = '连接失败'
      toast('读取插件接口失败：' + err.message, true)
    }
  }

  document.getElementById('btnRefresh').addEventListener('click', refresh)
  document.getElementById('btnAgent').addEventListener('click', function () {
    var prompt = '用母题工作台跑一轮创作链路：先看 atelier_query health，再按状态执行采集 / 拆解 / 出稿。'
    parent.postMessage({ type: 'atelier:draft', prompt: prompt }, location.origin)
  })
  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin) return
    if (event.data && event.data.type === 'atelier:draft-failed') toast('交给 Agent 失败：' + event.data.message, true)
  })
  refresh()
})()
