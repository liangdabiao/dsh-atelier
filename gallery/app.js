(function () {
  'use strict'
  var BASE = '/atelier'
  var S = {
    page: 'home', health: null, state: null, endpoints: [], actions: [], spec: null, automation: null,
    sel: { angleId: '', draftId: '', signalId: '', workId: '' },
    form: {}, busy: '', last: null, guideAnchor: '',
  }
  var PAGES = [
    ['home', '总台', '总', '从这里开始：看进度、记灵感、一键采集'],
    ['radar', '信源工作台', '源', '找真实素材：热榜、搜索、对标作品与评论原话'],
    ['deconstruct', '拆解与方向', '拆', '看别人怎么写的，再挑一个自己的切入点'],
    ['drafts', '稿件与体检', '稿', '出稿、体检、派生到各平台、导出'],
    ['retro', '复盘与规则', '盘', '登记作品、T+N 回查数据、校准、审核经验规则'],
    ['settings', '设置', '设', '密钥、限流、端点校验'],
    ['guide', '使用说明', '?', '三分钟上手、完整流程、名词解释与常见问题'],
  ]
  var STEPS = [
    ['home', '① 看进度'], ['radar', '② 找素材'], ['deconstruct', '③ 拆与选'],
    ['drafts', '④ 写成稿'], ['retro', '⑤ 看数据'],
  ]
  var PRESETS = [
    { key: 'hot.search', label: '抖音热搜', desc: '大家正在搜什么', params: {} },
    { key: 'note.search', label: '搜小红书笔记', desc: '关键词「内容创作」', params: { keyword: '内容创作' } },
    { key: 'general.search', label: '搜抖音内容', desc: '关键词「内容创作」', params: { keyword: '内容创作' } },
    { key: 'suggest.words', label: '小红书联想词', desc: '找标题能用的词', params: { keyword: '内容创作' } },
    { key: 'trend.words', label: 'TikTok 趋势词', desc: '海外趋势', params: {} },
    { key: 'hot.challenge', label: '抖音话题榜', desc: '热门话题', params: {} },
  ]
  var PLATFORMS = [
    { value: 'douyin', label: '抖音' }, { value: 'xiaohongshu', label: '小红书' },
    { value: 'tiktok', label: 'TikTok' }, { value: 'wechat', label: '视频号 / 公众号' },
    { value: 'bilibili', label: 'B站' },
  ]
  var DERIVE_PLATFORMS = ['小红书', '抖音', '公众号', '视频号', 'B站', 'TikTok', '知乎', '微博']
  var METRIC_LABELS = {
    views: '播放/浏览', plays: '播放', likes: '点赞', comments: '评论', collects: '收藏',
    shares: '分享', saves: '收藏', digg_count: '点赞', comment_count: '评论',
    collect_count: '收藏', share_count: '分享', play_count: '播放',
  }

  // ---------------------------------------------------------------- 基础工具
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
  function item(title, meta, body, extraCls) {
    var box = el('div', { class: 'item ' + (extraCls || '') }, el('div', { class: 't' }, title || '(无标题)'))
    if (meta) box.appendChild(el('div', { class: 'm' }, meta))
    if (body) box.appendChild(body)
    return box
  }
  function kv(obj) { return Object.keys(obj || {}).map(function (k) { return (METRIC_LABELS[k] || k) + ' ' + (typeof obj[k] === 'object' ? JSON.stringify(obj[k]) : obj[k]) }).join(' · ') || '—' }
  function ts(v) { return v ? String(v).slice(0, 16).replace('T', ' ') : '—' }
  function list(rows, empty) {
    var box = el('div', { class: 'list' })
    if (!rows || !rows.length) box.appendChild(el('div', { class: 'muted' }, empty || '（暂无数据）'))
    else rows.forEach(function (r) { if (r) box.appendChild(r) })
    return box
  }
  function goto(page, anchor) { S.page = page; if (anchor) S.guideAnchor = anchor; render(); document.getElementById('view').scrollTop = 0 }
  function setForm(id, key, value) {
    if (!S.form[id]) S.form[id] = {}
    S.form[id][key] = value
  }
  function getForm(id, key, fallback) {
    var v = S.form[id] && S.form[id][key]
    return v === undefined || v === null ? (fallback === undefined ? '' : fallback) : v
  }
  function endpoint(key) {
    return (S.endpoints || []).filter(function (e) { return e.key === key })[0] || null
  }
  function platformLabel(v) {
    var p = PLATFORMS.filter(function (x) { return x.value === v })[0]
    return p ? p.label : (v || '—')
  }
  function copy(text, okMsg) {
    var done = function () { toast(okMsg || '已复制到剪贴板') }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(text || '')).then(done, function () { fallback() })
    } else fallback()
    function fallback() {
      var ta = el('textarea')
      ta.value = String(text || ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy'); done() } catch (e) { toast('复制失败，请手动选择文本', true) }
      document.body.removeChild(ta)
    }
  }
  function download(filename, content, type) {
    var blob = new Blob([String(content || '')], { type: type || 'text/plain;charset=utf-8' })
    var url = URL.createObjectURL(blob)
    var a = el('a', { href: url, download: filename || 'atelier.txt' })
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(function () { URL.revokeObjectURL(url) }, 2000)
  }

  // ---------------------------------------------------------------- 反馈与请求
  function toast(message, isError, result) {
    var box = document.getElementById('toast')
    box.textContent = ''
    box.className = 'toast' + (isError ? ' error' : '')
    box.hidden = false
    box.appendChild(el('div', { class: 'toast-msg' }, String(message || '')))
    var row = el('div', { class: 'row' })
    if (result && result.needsConfirm) {
      row.appendChild(el('button', { class: 'btn sm', onclick: function () {
        var args = Object.assign({}, result.args || {}, { confirm: true })
        run(result.action || (S.last && S.last.action), args, { label: '确认执行' })
      } }, '确认执行（会消耗额度）'))
    }
    if (result && /key|未配置|未登录|没有连上|模型/i.test(String(result.error || result.summary || ''))) {
      row.appendChild(el('button', { class: 'btn sm soft', onclick: function () { goto('settings') } }, '去设置'))
    }
    row.appendChild(el('button', { class: 'btn sm ghost', onclick: function () { renderResult(); document.getElementById('result').scrollIntoView({ block: 'nearest' }) } }, '查看结果'))
    row.appendChild(el('button', { class: 'btn sm ghost', onclick: function () { box.hidden = true } }, '关闭'))
    box.appendChild(row)
    clearTimeout(toast.timer)
    toast.timer = setTimeout(function () { box.hidden = true }, 12000)
  }
  async function api(path, options) {
    var res = await fetch(BASE + path, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {}))
    var body
    try { body = await res.json() } catch (e) { throw new Error('返回不是 JSON (HTTP ' + res.status + ')') }
    if (!res.ok && !body.error) throw new Error('HTTP ' + res.status)
    return body
  }
  function updateBusy() {
    var elx = document.getElementById('busy')
    elx.textContent = S.busy ? '正在' + S.busy + '…' : ''
    elx.hidden = !S.busy
    var buttons = document.querySelectorAll('#view button')
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = Boolean(S.busy)
  }
  async function run(action, args, opts) {
    opts = opts || {}
    if (S.busy) { toast('还有一个操作正在进行，请稍等', true); return null }
    S.busy = opts.label || action
    updateBusy()
    try {
      var result = await api('/api/ops', { method: 'POST', body: JSON.stringify({ op: action, args: args || {} }) })
      S.last = Object.assign({ action: action, args: args, at: new Date().toISOString() }, result)
      if (result.ok) {
        if (!opts.quiet) toast(result.summary || '完成', false, S.last)
        // 导出：直接给出下载，不再只报一个本机路径
        if (result.data && result.data.content) download(result.data.filename || '稿件.md', result.data.content)
      } else {
        if (!opts.quiet) toast((result.error || result.summary || '没成功') + (result.nextStep ? ' ｜ 建议：' + result.nextStep : ''), true, S.last)
      }
      await refresh()
      if (opts.onDone) opts.onDone(result)
      return result
    } catch (err) {
      toast(err.message, true)
      return { ok: false, error: err.message }
    } finally {
      S.busy = ''
      updateBusy()
    }
  }

  // ---------------------------------------------------------------- 表单：值会跨刷新保留
  function form(id, specs, buttons, onSubmit) {
    var f = el('form', { class: 'form' })
    if (!S.form[id]) S.form[id] = {}
    var controls = {}
    specs.forEach(function (s) {
      var input
      var stored = getForm(id, s.key, s.value)
      if (s.type === 'textarea' || s.type === 'json') {
        input = el('textarea', { placeholder: s.placeholder || '', rows: s.rows || 2 })
        input.value = stored == null ? '' : String(stored)
      } else if (s.type === 'select') {
        input = el('select')
        ;(typeof s.options === 'function' ? s.options() : s.options || []).forEach(function (o) {
          var opt = el('option', { value: o.value }, o.label)
          if (String(o.value) === String(stored)) opt.selected = true
          input.appendChild(opt)
        })
      } else if (s.type === 'checks') {
        input = el('div', { class: 'checks' })
        var chosen = String(stored || '').split(/[,，]/).map(function (x) { return x.trim() }).filter(Boolean)
        ;(typeof s.options === 'function' ? s.options() : s.options || []).forEach(function (o) {
          var box = el('input', { type: 'checkbox' })
          box.checked = chosen.indexOf(String(o.value)) >= 0
          box.addEventListener('change', function () {
            var vals = []
            input.querySelectorAll('input:checked').forEach(function (c) { vals.push(c.value) })
            setForm(id, s.key, vals.join(','))
          })
          var lab = el('label', { class: 'chip' }, box, document.createTextNode(' ' + o.label))
          input.appendChild(lab)
        })
        setForm(id, s.key, chosen.join(','))
      } else {
        input = el('input', { type: s.type === 'checkbox' ? 'checkbox' : (s.type || 'text'), placeholder: s.placeholder || '' })
        if (s.type === 'checkbox') input.checked = stored === true || stored === 'true'
        else input.value = stored == null ? '' : String(stored)
      }
      if (s.type !== 'checks') input.name = s.key
      controls[s.key] = input
      var label = el('label', { class: 'f' + (s.required ? ' required' : '') }, s.label + (s.required ? ' *' : ''))
      if (s.type === 'checkbox') label.appendChild(el('span', { class: 'row' }, input, document.createTextNode(' ' + (s.hint || '我已确认'))))
      else label.appendChild(input)
      if (s.hint && s.type !== 'checkbox') label.appendChild(el('span', { class: 'muted' }, s.hint))
      if (s.type === 'json') {
        var det = el('details', { class: 'advanced' }, el('summary', {}, '高级：' + s.label + '（一般不用填）'))
        det.appendChild(label)
        f.appendChild(det)
      } else f.appendChild(label)
      if (s.type === 'checks') return
      var evt = s.type === 'select' || s.type === 'checkbox' ? 'change' : 'input'
      input.addEventListener(evt, function () {
        setForm(id, s.key, s.type === 'checkbox' ? input.checked : input.value)
        if (s.onChange) s.onChange(input.value, f)
      })
    })
    var row = el('div', { class: 'row' })
    buttons.forEach(function (b) {
      row.appendChild(el('button', { type: 'submit', class: 'btn ' + (b.cls || ''), 'data-act': b.value }, b.label))
    })
    f.appendChild(row)
    f.addEventListener('submit', function (event) {
      event.preventDefault()
      if (!buttons.length) return
      var act = (event.submitter && event.submitter.getAttribute('data-act')) || buttons[0].value
      var btn = buttons.filter(function (b) { return b.value === act })[0] || {}
      var values = {}
      var missing = []
      specs.forEach(function (s) {
        var input = controls[s.key]
        if (!input) return
        if (s.type === 'checkbox') values[s.key] = input.checked
        else if (s.type === 'checks') values[s.key] = getForm(id, s.key, '')
        else if (s.type === 'json') values[s.key] = input.value.trim()
        else values[s.key] = String(input.value || '').trim()
        var used = !btn.fields || btn.fields.indexOf(s.key) >= 0
        if (s.required && used && !values[s.key]) missing.push(s.label)
      })
      if (missing.length) { toast('请先填写：' + missing.join('、'), true); return }
      Promise.resolve(onSubmit(values, act)).catch(function (e) { toast(e.message || String(e), true) })
    })
    return f
  }
  function selectFrom(rows, valueKey, labelFn, emptyLabel, selected) {
    var out = [{ value: '', label: emptyLabel || '（用最近一条，通常不用改）' }]
    rows.forEach(function (r) { out.push({ value: r[valueKey], label: labelFn(r) }) })
    return { options: out, selected: selected || '' }
  }
  function emptyState(text, buttons) {
    var box = el('div', { class: 'empty' }, el('p', {}, text))
    var row = el('div', { class: 'row' })
    ;(buttons || []).forEach(function (b) {
      row.appendChild(el('button', { class: 'btn ' + (b.cls || 'soft'), onclick: b.onclick }, b.label))
    })
    if (buttons && buttons.length) box.appendChild(row)
    return box
  }
  function helpLine(text, nextText, nextPage) {
    var row = el('div', { class: 'help-line' }, el('span', {}, '💡 ' + text))
    if (nextPage) row.appendChild(el('button', { class: 'link', onclick: function () { goto(nextPage) } }, '下一步：' + nextText + ' →'))
    row.appendChild(el('button', { class: 'link', onclick: function () { goto('guide') } }, '? 看说明'))
    return row
  }
  function contextBar() {
    var st = S.state || {}
    var angle = (st.angles || []).filter(function (a) { return a.id === S.sel.angleId })[0]
    var draft = (st.drafts || []).filter(function (d) { return d.id === S.sel.draftId })[0]
    var sig = (st.signals || []).filter(function (s) { return s.id === S.sel.signalId })[0]
    var parts = []
    if (sig) parts.push('素材：' + String(sig.title || '').slice(0, 24))
    if (angle) parts.push('方向：' + String(angle.title || '').slice(0, 24))
    if (draft) parts.push('稿件：' + String(draft.title || '').slice(0, 24))
    if (!parts.length) return null
    return el('div', { class: 'ctxbar' }, el('span', { class: 'muted' }, '当前选中 '),
      parts.map(function (p) { return badge(p, 'brand') }),
      el('button', { class: 'link', onclick: function () { S.sel = { angleId: '', draftId: '', signalId: '', workId: '' }; render() } }, '清空选择'))
  }
  function stepBar() {
    var bar = el('div', { class: 'stepbar' })
    STEPS.forEach(function (s) {
      bar.appendChild(el('button', {
        class: S.page === s[0] ? 'active' : '', onclick: function () { goto(s[0]) },
      }, s[1]))
    })
    return bar
  }
  function statCard(label, value, note) {
    return el('div', { class: 'card' }, el('h3', {}, label), el('div', { class: 'stat' }, String(value)), el('div', { class: 'muted' }, note || ''))
  }

  // ---------------------------------------------------------------- 结果面板
  function specText(p) {
    var l = p.contentLimits || {}, t = p.topic || {}
    var bits = []
    if (l.maxTitleLength) bits.push('标题 ≤' + l.maxTitleLength + ' 字')
    if (l.maxBodyLength) bits.push('正文 ≤' + l.maxBodyLength + ' 字')
    if (l.maxTotalTextLength) bits.push('总字数 ≤' + l.maxTotalTextLength)
    if (l.maxImages) bits.push('最多 ' + l.maxImages + ' 张图')
    if (l.maxVideos) bits.push('最多 ' + l.maxVideos + ' 个视频')
    if (t.supported === false) bits.push('不支持原生话题')
    else if (t.maxCount) bits.push('话题 ≤' + t.maxCount + ' 个')
    return bits.join(' · ') || '暂无规格数据'
  }
  function renderResult() {
    var host = document.getElementById('result')
    host.textContent = ''
    if (!S.last) return
    var r = S.last
    var box = el('div', { class: 'result ' + (r.ok ? 'ok' : 'err') })
    var head = el('div', { class: 'row' },
      badge(r.ok ? '成功' : '未完成', r.ok ? 'ok' : 'err'),
      el('strong', {}, '最近一次：' + (r.action || '') + ' · ' + ts(r.at)),
      el('button', { class: 'link', onclick: function () { S.last = null; renderResult() } }, '关闭'))
    box.appendChild(head)
    box.appendChild(el('div', { class: 'r-msg' }, r.summary || r.error || ''))
    var row = el('div', { class: 'row' })
    if (r.needsConfirm) row.appendChild(el('button', { class: 'btn sm', onclick: function () {
      run(r.action, Object.assign({}, r.args, { confirm: true }), { label: '确认执行' })
    } }, '确认执行（会消耗额度）'))
    if (r.nextStep) box.appendChild(el('div', { class: 'muted' }, '建议：' + r.nextStep))
    var d = r.data || {}
    if (d.content) row.appendChild(el('button', { class: 'btn sm soft', onclick: function () { download(d.filename || '稿件.md', d.content) } }, '重新下载'))
    if (d.content) row.appendChild(el('button', { class: 'btn sm ghost', onclick: function () { copy(d.content, '稿件内容已复制') } }, '复制内容'))
    if (d.endpoint) {
      box.appendChild(el('div', { class: 'preview' },
        el('div', {}, '预览（未发请求、未写库）'),
        el('div', { class: 'muted' }, '接口：' + (d.method || 'GET') + ' ' + d.endpoint),
        el('div', { class: 'muted' }, '参数：' + (Object.keys(d.params || {}).length ? JSON.stringify(d.params) : '无需参数')),
        el('div', { class: 'muted' }, '成本：' + (d.cost === 'high' ? '较高（评论/翻页）' : '低'))))
    }
    if (d.platformSpecs && d.platformSpecs.length) {
      var grid = el('div', { class: 'spec-grid' })
      d.platformSpecs.forEach(function (p) {
        grid.appendChild(item(p.displayName || p.key, specText(p) + (p.platform ? ' · ' + p.platform : ''), null))
      })
      box.appendChild(el('div', { class: 'muted' }, '平台文案规格（第三方常量，仅供参考，非平台官方限制）：'))
      box.appendChild(grid)
    }
    if (d.automation) box.appendChild(el('div', { class: 'muted' }, '定时任务：' + (d.automation.ok
      ? '已创建 ' + d.automation.created + ' 个 T+N 提醒' + (d.automation.auto ? '（自动回查已开启）' : '（到点只提醒，不自动花额度）')
      : (d.automation.reason || '未创建'))) )
    if (Object.keys(d).length) {
      var det = el('details', { class: 'advanced' }, el('summary', {}, '展开原始数据（给排查用）'),
        el('pre', {}, JSON.stringify(d, null, 2).slice(0, 8000)))
      box.appendChild(det)
    }
    if (row.childNodes.length) box.appendChild(row)
    if (!r.ok) row.appendChild(el('button', { class: 'btn sm ghost', onclick: function () { goto('guide', 'faq') } }, '看常见问题'))
    host.appendChild(box)
  }

  // ---------------------------------------------------------------- 端点参数动态字段
  function buildParamFields(host, endpointKey, formId) {
    host.textContent = ''
    var ep = endpoint(endpointKey)
    if (!ep) return
    var fields = ep.fields || []
    function add(list, target) {
      list.forEach(function (f) {
        var key = 'p_' + f.key
        var input = el('input', { type: f.type === 'number' ? 'number' : 'text', placeholder: f.placeholder || '' })
        var stored = getForm(formId, key, null)
        input.value = stored === null ? (f.defaultValue || '') : String(stored)
        setForm(formId, key, input.value)
        input.addEventListener('input', function () { setForm(formId, key, input.value) })
        var label = el('label', { class: 'f' + (f.required ? ' required' : '') }, f.label + (f.required ? ' *' : ''))
        label.appendChild(input)
        if (f.hint) label.appendChild(el('span', { class: 'muted' }, f.hint))
        label.setAttribute('data-field', f.key)
        target.appendChild(label)
      })
    }
    var main = fields.filter(function (f) { return !f.advanced })
    var adv = fields.filter(function (f) { return f.advanced })
    if (!fields.length) host.appendChild(el('p', { class: 'muted' }, '这个数据源不用填参数，直接点按钮就行。'))
    add(main, host)
    if (adv.length) {
      var det = el('details', { class: 'advanced' }, el('summary', {}, '更多参数（一般不用改）'))
      var box = el('div')
      add(adv, box); det.appendChild(box); host.appendChild(det)
    }
  }
  function readParams(formId, endpointKey, strict) {
    var ep = endpoint(endpointKey) || { fields: [] }
    var out = {}, missing = []
    ;(ep.fields || []).forEach(function (f) {
      var raw = getForm(formId, 'p_' + f.key, '')
      if (String(raw).trim() === '') { if (f.required && strict) missing.push(f.label); return }
      out[f.key] = f.type === 'number' ? Number(raw) : String(raw).trim()
    })
    return { params: out, missing: missing }
  }

  // ---------------------------------------------------------------- 页面：总台
  function nextSuggestion(st) {
    if (!(S.health && S.health.tikhub && S.health.tikhub.configured) && !(st.signals || []).length) {
      return { text: '还没配 TikHub key。纯文本链路也能用，但想看热榜/真实数据，先去设置填一次。', page: 'settings', label: '去设置' }
    }
    if (!(st.signals || []).length && !(st.evidence || []).length) return { text: '先找点真实素材：点一个一键采集，或随手记一条灵感。', page: 'radar', label: '去找素材' }
    if (!(st.deconstructions || []).length) return { text: '有素材了，下一步让模型基于证据拆解「它为什么吸引人」。', page: 'deconstruct', label: '去拆解' }
    if (!(st.angles || []).length) return { text: '拆解完成，让模型给 ≥3 个真正不同的切入方向，你来挑一个。', page: 'deconstruct', label: '去选方向' }
    if (!(st.drafts || []).length) return { text: '方向定了，出第一篇母稿。', page: 'drafts', label: '去出稿' }
    if (!(st.assessments || []).length) return { text: '稿子有了，做一次体检（质量诊断 + 平台规格提示）。', page: 'drafts', label: '去体检' }
    if (!(st.predictions || []).length) return { text: '发布前锁定一个判断，之后才能和真实数据做校准。', page: 'retro', label: '去锁定判断' }
    if (!(st.snapshots || []).length) return { text: '发布后登记作品，T+1/3/7 回查真实指标。', page: 'retro', label: '去登记作品' }
    return { text: '链路已跑通。可以继续新母题，或去复盘与规则里审核经验规则。', page: 'retro', label: '去看复盘' }
  }
  function pageHome(st) {
    var h = S.health || {}, t = h.tikhub || {}
    var counts = h.counts || {}
    var cards = el('div', { class: 'grid' },
      statCard('信号 / 证据', (counts.signals || 0) + ' / ' + (counts.evidence || 0), '创作前的真实素材'),
      statCard('稿件 / 版本', counts.drafts || 0, '版本只追加'),
      statCard('指标快照', counts.snapshots || 0, 'API 与手工分开记'),
      statCard('已激活规则', (st.rules || []).filter(function (r) { return r.status === 'active' }).length, '人工审核后才生效'))
    var sug = nextSuggestion(st)
    var next = card('接下来做什么', '', el('p', { class: 'next-text' }, sug.text),
      el('button', { class: 'btn', onclick: function () { goto(sug.page) } }, sug.label + ' →'))
    var status = card('接入状态', h.summary || '',
      el('div', { class: 'row' },
        badge(t.configured ? 'TikHub 已配置' : 'TikHub 未配置', t.configured ? 'ok' : 'warn'),
        badge(t.tokenMasked || '—', ''),
        badge('模型：用 dsh 当前默认模型', 'brand'),
        badge('apiz 生图：CLI 自管', 'brand'),
        badge('平台规格 ' + ((h.platformSpecs && h.platformSpecs.count) || 0) + ' 个（参考值）', '')))
    var quick = card('一键采集（不用填参数）', '点一下就取回真实数据，取不到会如实说明，不会编。',
      el('div', { class: 'preset-grid' }, PRESETS.map(function (p) {
        return el('button', { class: 'preset', onclick: function () { run('radar', { endpointKey: p.key, params: p.params, limit: 20 }, { label: '采集' + p.label }) } },
          el('strong', {}, p.label), el('span', { class: 'muted' }, p.desc))
      })),
      el('div', { class: 'hr' }),
      form('capture', [
        { key: 'content', label: '随手记一条灵感 / 贴一段素材', placeholder: '一句话就行…', required: false },
        { key: 'url', label: '相关链接（可空）', placeholder: 'https://…' },
        { key: 'kind', label: '类型', type: 'select', value: 'note', options: [{ value: 'note', label: '灵感 / 摘录' }, { value: 'link', label: '链接素材' }] },
      ], [{ value: 'capture', label: '记下来', fields: ['content'] }],
        function (v) {
          if (!v.content) { toast('先写点内容', true); return null }
          return run('capture', { content: v.content, url: v.url, kind: v.kind }, { onDone: function () { setForm('capture', 'content', ''); setForm('capture', 'url', '') } })
        }))
    var recentSignals = (st.signals || []).slice(-6).reverse().map(function (s) {
      return item(String(s.title || '').slice(0, 80), '[' + platformLabel(s.platform) + '] ' + ts(s.fetchedAt) + ' · ' + kv(s.baselineStats), null)
    })
    var recentDrafts = (st.drafts || []).slice(-4).reverse().map(function (d) {
      return item(d.title, d.platform + ' · v' + d.versionNo + ' · ' + ts(d.createdAt),
        el('details', {}, el('summary', {}, '展开正文'), el('pre', {}, (d.body || '').slice(0, 1500))))
    })
    return [cards, next, helpLine('总台只负责看进度和起头；真正干活在后面几页，按顺序走就行。', '找素材', 'radar'), status, quick,
      el('div', { class: 'split' },
        card('最近素材', '', recentSignals.length ? list(recentSignals) : emptyState('还没有素材。', [{ label: '去采集', onclick: function () { goto('radar') } }])),
        card('最近稿件', '', recentDrafts.length ? list(recentDrafts) : emptyState('还没有稿件。', [{ label: '去出稿', onclick: function () { goto('drafts') } }])))]
  }

  // ---------------------------------------------------------------- 页面：信源工作台
  function pageRadar(st) {
    var info = (S.endpoints || []).filter(function (e) { return e.group === 'info' })
    var groups = {}
    info.forEach(function (e) { var g = platformLabel(e.platform); (groups[g] = groups[g] || []).push(e) })
    var epOptions = []
    Object.keys(groups).forEach(function (g) {
      groups[g].forEach(function (e) {
        epOptions.push({ value: e.key, label: g + ' · ' + e.label + (e.cost === 'high' ? '（消耗额度）' : '') })
      })
    })
    var formId = 'radar-custom'
    var fieldsHost = el('div', { class: 'field-grid' })
    var confirmHost = el('div')
    function refreshFields() {
      var key = getForm(formId, 'endpointKey', 'hot.search')
      buildParamFields(fieldsHost, key, formId)
      var ep = endpoint(key)
      confirmHost.textContent = ''
      if (ep && ep.cost === 'high') {
        var box = el('input', { type: 'checkbox' })
        box.checked = getForm('radar-confirm', 'confirm', false) === true
        box.addEventListener('change', function () { setForm('radar-confirm', 'confirm', box.checked) })
        confirmHost.appendChild(el('label', { class: 'f' },
          el('span', { class: 'row' }, box, document.createTextNode(' 评论采集会消耗 TikHub 额度，我确认执行')),
          el('span', { class: 'muted' }, '不勾选就执行，插件也会先拦下来再问你一次。')))
      }
    }
    var custom = card('自定义采集（自动出字段，不用写 JSON）', '选一个数据源，下面会自动出现要填的中文项；带 * 的必填。',
      form(formId, [
        { key: 'endpointKey', label: '数据源', type: 'select', options: epOptions, value: 'hot.search', onChange: refreshFields },
        { key: 'limit', label: '最多入库多少条', type: 'number', value: '20' },
      ], [], function () {}),
      fieldsHost,
      el('div', { class: 'hr' }),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: function () { doRadar(false) } }, '执行采集'),
        el('button', { class: 'btn ghost', onclick: function () { doRadar(true) } }, '仅预览（不花钱、不写库）')),
      confirmHost)
    function doRadar(preview) {
      var epKey = getForm(formId, 'endpointKey', 'hot.search')
      var built = readParams(formId, epKey, !preview)
      if (built.missing.length) { toast('请先填写：' + built.missing.join('、'), true); return }
      var confirm = getForm('radar-confirm', 'confirm', false) === true
      var args = { endpointKey: epKey, params: built.params, limit: Number(getForm(formId, 'limit', 20)) || 20, confirm: confirm }
      if (preview) args.dryRun = true
      run('radar', args, { label: preview ? '预览采集' : '采集' })
    }
    // 首次渲染时把动态字段填进去
    setTimeout(refreshFields, 0)

    var sigRows = (st.signals || []).slice(-20).reverse().map(function (s) {
      var wid = String(s.platformWorkId || '')
      var buttons = el('div', { class: 'row' })
      buttons.appendChild(el('button', { class: 'link', onclick: function () { S.sel.signalId = s.id; toast('已选中素材：' + String(s.title).slice(0, 30)); render() } }, '选中'))
      if (wid) {
        buttons.appendChild(el('button', { class: 'btn sm soft', onclick: function () {
          var key = s.platform === 'douyin' ? 'work.detail' : s.platform === 'xiaohongshu' ? 'note.detail' : 'work.detail.tiktok'
          run('evidence', { endpointKey: key, params: { workId: wid }, signalId: s.id, confirm: false }, { label: '取作品详情' })
        } }, '取详情'))
        buttons.appendChild(el('button', { class: 'btn sm ghost', onclick: function () {
          run('watch', { kind: 'benchmark', platform: s.platform, workId: wid, signalId: s.id }, { label: '设为对标' })
        } }, '设为对标'))
      } else {
        buttons.appendChild(el('span', { class: 'muted' }, '（热词不是具体作品，不能回查数据）'))
      }
      return item(String(s.title || '').slice(0, 100),
        '[' + platformLabel(s.platform) + '] ' + (s.endpoint || '') + ' · ' + ts(s.fetchedAt) + (s.unverified ? ' · 字段未验真' : '') + ' · ' + kv(s.baselineStats),
        buttons, S.sel.signalId === s.id ? 'selected' : '')
    })
    var evRows = (st.evidence || []).slice(-20).reverse().map(function (e) {
      return item(String(e.text || e.title || '').slice(0, 140),
        '[' + ({ quote: '原文', comment: '评论原话', stat: '数据' }[e.kind] || e.kind || '证据') + '] ' + (e.endpoint || '') + ' · ' + ts(e.fetchedAt),
        el('div', { class: 'row' },
          e.url ? el('a', { class: 'link', href: e.url, target: '_blank', rel: 'noreferrer' }, '看原文 ↗') : null,
          el('button', { class: 'link', onclick: function () { copy(String(e.text || ''), '证据原文已复制') } }, '复制原话')))
    })
    return [stepBar(), helpLine('这一步只做一件事：找真实素材。点上面的预设最快；想换关键词就改自定义采集里的「搜索关键词」。', '拆解', 'deconstruct'),
      card('一键采集', '不用填任何参数，点一下就取回真实数据。',
        el('div', { class: 'preset-grid' }, PRESETS.map(function (p) {
          return el('button', { class: 'preset', onclick: function () { run('radar', { endpointKey: p.key, params: p.params, limit: 20 }, { label: '采集' + p.label }) } },
            el('strong', {}, p.label), el('span', { class: 'muted' }, p.desc))
        }))),
      custom,
      el('div', { class: 'split' },
        card('素材（信号）', (st.signals || []).length + ' 条 · 点「选中」可带着它去拆解',
          sigRows.length ? list(sigRows) : emptyState('还没有素材。', [{ label: '点一键采集', onclick: function () { goto('home') } }])),
        card('证据', (st.evidence || []).length + ' 条 · 拆解只会引用这里的真实内容', list(evRows)))]
  }

  // ---------------------------------------------------------------- 页面：拆解与方向
  function pageDeconstruct(st) {
    var decs = st.deconstructions || [], angles = st.angles || []
    var sigOptions = selectFrom((st.signals || []).slice(-30).reverse(), 'id', function (s) { return '[' + platformLabel(s.platform) + '] ' + String(s.title || '').slice(0, 34) }, '全部最近素材（推荐）', S.sel.signalId)
    var step1 = card('① 拆解：它为什么吸引人', '模型只依据已取回的真实证据（原文 / 评论 / 数据）写结论，没证据就写「待补充」，不会编。',
      form('decon', [
        { key: 'signalId', label: '只用哪条素材（可空 = 全部最近素材）', type: 'select', options: sigOptions.options, value: sigOptions.selected },
      ], [{ value: 'deconstruct', label: '基于证据拆解' }], function (v) {
        var ids = []
        if (v.signalId) ids = (st.evidence || []).filter(function (e) { return e.signalId === v.signalId }).map(function (e) { return e.id })
        return run('deconstruct', { evidenceIds: ids }, { label: '拆解内容' })
      }))
    var step2 = card('② 生成差异化方向', '自动用最近一次拆解，给 ≥3 个真正不同的切入角度；你挑一个，模型才会往下写。',
      form('angles', [
        { key: 'extra', label: '补充要求（可空）', placeholder: '例：面向完全不懂 AI 的人、别用行业黑话' },
      ], [{ value: 'angles', label: '生成 3 个以上方向' }], function (v) {
        return run('angles', { extra: v.extra }, { label: '生成方向' })
      }))
    var decRows = decs.slice(-6).reverse().map(function (d) {
      return item('钩子：' + (d.hook || '—'), '模式：' + (d.pattern || '—') + ' · 引用 ' + (d.evidenceRefs || []).length + ' 条证据 · ' + ts(d.createdAt),
        el('div', {}, (d.structure || []).map(function (x) { return el('div', { class: 'muted' }, '· ' + x) })))
    })
    var angleRows = angles.slice(-12).reverse().map(function (a) {
      return item('[' + (a.kind || '方向') + '] ' + a.title, a.rationale || '',
        el('div', { class: 'row' },
          el('button', { class: 'btn sm', onclick: function () { S.sel.angleId = a.id; goto('drafts'); toast('已选方向：' + a.title + '，直接点「出稿」即可') } }, '选它 → 去出稿'),
          el('button', { class: 'link', onclick: function () { copy(a.title, '方向标题已复制') } }, '复制标题')),
        S.sel.angleId === a.id ? 'selected' : '')
    })
    return [stepBar(), helpLine('这一步是「先想清楚写什么」，不是写正文。选中的方向会自动带到稿件页，不用记任何 id。', '出稿', 'drafts'),
      el('div', { class: 'split' }, step1, step2),
      card('候选方向', angles.length + ' 个 · 选一个就行', angleRows.length ? list(angleRows) : emptyState('还没有方向，先做一次拆解再点「生成方向」。')),
      card('拆解结果', decs.length + ' 条', list(decRows))]
  }

  // ---------------------------------------------------------------- 页面：稿件与体检
  function pageDrafts(st) {
    var drafts = st.drafts || [], angles = st.angles || []
    var angleSel = selectFrom(angles.slice(-20).reverse(), 'id', function (a) { return (a.kind || '方向') + ' · ' + String(a.title || '').slice(0, 36) }, '用最近一个方向（推荐）', S.sel.angleId)
    var current = drafts.filter(function (d) { return d.id === S.sel.draftId })[0] || drafts[drafts.length - 1]
    if (current) S.sel.draftId = current.id
    var draftForm = card('① 出一篇母稿', '会用到当前选中的方向；写完自动成为「当前稿件」，下面所有按钮都针对它。',
      form('draft-new', [
        { key: 'angleId', label: '用哪个方向', type: 'select', options: angleSel.options, value: angleSel.selected },
        { key: 'topic', label: '母题 / 补充要求（可空）', placeholder: '例：讲清楚真实使用门槛，别堆术语' },
      ], [{ value: 'draft', label: '出稿' }], function (v) {
        return run('draft', { angleId: v.angleId, campaignTopic: v.topic, platform: '母稿' }, { label: '出稿' })
      }))
    var currentCard = current ? card('当前稿件', '《' + current.title + '》 · ' + current.platform + ' · v' + current.versionNo,
      el('div', { class: 'row' },
        el('button', { class: 'btn sm', onclick: function () { run('review', { draftId: current.id }, { label: '稿件体检' }) } }, '体检'),
        el('button', { class: 'btn sm soft', onclick: function () { goto('drafts'); toast('在下面「派生到各平台」勾选平台后点派生') } }, '派生'),
        el('button', { class: 'btn sm soft', onclick: function () { run('export', { draftId: current.id, format: 'md' }, { label: '导出 Markdown' }) } }, '下载 Markdown'),
        el('button', { class: 'btn sm soft', onclick: function () { run('export', { draftId: current.id, format: 'html' }, { label: '导出 HTML' }) } }, '下载 HTML'),
        el('button', { class: 'btn sm ghost', onclick: function () { copy(current.body, '稿件正文已复制') } }, '复制正文'),
        el('button', { class: 'btn sm ghost', onclick: function () { run('predict', { draftId: current.id }, { label: '锁定发布前判断' }) } }, '锁定发布前判断')),
      el('details', {}, el('summary', {}, '展开正文'), el('pre', {}, (current.body || '').slice(0, 6000)))) :
      card('当前稿件', '', emptyState('还没有稿件。先出一篇母稿，或用下面的方向直接出。'))
    var deriveCard = card('② 派生到各平台（同一母题）', '勾平台即可，不用填逗号、不用记平台 id；派生稿各自可回溯到母稿。',
      form('derive-form', [
        { key: 'platforms', label: '要发到哪些平台', type: 'checks', value: '小红书,抖音,公众号', options: DERIVE_PLATFORMS.map(function (p) { return { value: p, label: p } }) },
      ], [{ value: 'derive', label: '生成派生稿' }], function (v) {
        var ps = String(v.platforms || '').split(/[,，]/).map(function (x) { return x.trim() }).filter(Boolean)
        if (!ps.length) { toast('至少勾一个平台', true); return null }
        return run('derive', { draftId: S.sel.draftId, platforms: ps }, { label: '派生到 ' + ps.length + ' 个平台' })
      }))
    var imageCard = card('③ 可选：生成封面图', '走本机 apiz-cli，认证由 CLI 自管。会消耗额度，需要勾选确认；不装 apiz 也不影响文字链路。',
      form('image-form', [
        { key: 'prompt', label: '画面描述', placeholder: '例：干净的桌面、一台笔记本、清晨的光，极简插画' },
        { key: 'ratio', label: '比例', type: 'select', value: '3:4', options: [{ value: '3:4', label: '3:4 竖版（小红书）' }, { value: '9:16', label: '9:16 竖屏（抖音）' }, { value: '1:1', label: '1:1 方形' }, { value: '16:9', label: '16:9 横版' }] },
        { key: 'confirm', label: '确认消耗额度', type: 'checkbox', value: false, hint: '我确认这次生图会消耗 apiz 额度' },
      ], [{ value: 'image', label: '生成图片' }], function (v) {
        if (!v.prompt) { toast('先写画面描述', true); return null }
        if (!v.confirm) { toast('请先勾选「确认消耗额度」', true); return null }
        return run('image', { prompt: v.prompt, aspectRatio: v.ratio, draftId: S.sel.draftId, confirm: true }, { label: '生成封面图' })
      }))
    var specCard = card('平台文案规格速查', '查某个平台标题/正文/图片/话题能写多少。注意：这是第三方常量，仅供参考，不是平台官方限制。',
      form('spec-form', [
        { key: 'platform', label: '平台', type: 'select', value: '小红书', options: DERIVE_PLATFORMS.map(function (p) { return { value: p, label: p } }) },
      ], [{ value: 'spec', label: '查规格' }], function (v) {
        return run('spec', { platform: v.platform }, { label: '查平台规格' })
      }))
    var rows = drafts.slice(-20).reverse().map(function (d) {
      var sc = d.specCheck || {}
      var specLine = !sc.matched ? '' : (sc.ok ? '规格 ✓ ' + sc.displayName : '规格提示 ' + sc.displayName + '：' + (sc.issues || []).map(function (i) { return i.message }).join('；'))
      var topicsLine = (d.topics || []).length ? '话题 ' + d.topics.map(function (t) { return '#' + t }).join(' ') : ''
      var meta = [d.platform + ' · v' + d.versionNo + ' · ' + (d.changeLog || '') + ' · ' + ts(d.createdAt), specLine, topicsLine].filter(Boolean).join(' · ')
      var body = el('div', {},
        el('details', {}, el('summary', {}, '展开正文'), el('pre', {}, (d.body || '').slice(0, 3000))),
        el('div', { class: 'row' },
          el('button', { class: 'btn sm soft', onclick: function () { S.sel.draftId = d.id; render(); toast('已设为当前稿件：' + d.title) } }, '设为当前'),
          el('button', { class: 'btn sm ghost', onclick: function () { run('review', { draftId: d.id }, { label: '稿件体检' }) } }, '体检'),
          el('button', { class: 'btn sm ghost', onclick: function () { run('export', { draftId: d.id, format: 'md' }, { label: '导出' }) } }, '下载'),
          el('button', { class: 'link', onclick: function () { copy(d.body, '稿件正文已复制') } }, '复制')))
      return item(d.title, meta, body, S.sel.draftId === d.id ? 'selected' : '')
    })
    var assessments = (st.assessments || []).slice(-8).reverse().map(function (a) {
      var specCount = a.specCheck && a.specCheck.issues ? a.specCheck.issues.length : 0
      var issues = (a.specCheck && a.specCheck.issues || []).map(function (i) { return i.message }).join('；')
      return item('体检结果', kv(a.dimensions) + ' · 仅质量诊断，不预测表现' + (specCount ? ' · 规格提示 ' + specCount + ' 条' : ''),
        issues ? el('div', { class: 'muted' }, issues) : null)
    })
    var assets = (st.assets || []).slice(-6).reverse().map(function (a) {
      return item('图片 ' + (a.model || ''), (a.prompt || '').slice(0, 80) + ' · ' + ts(a.createdAt),
        a.url ? el('a', { class: 'link', href: a.url, target: '_blank', rel: 'noreferrer' }, '打开图片 ↗') : null)
    })
    return [stepBar(), helpLine('一个母题先出一篇母稿，再派生到各平台；版本只追加，改稿也是新版本，不会覆盖旧稿。', '登记作品', 'retro'),
      draftForm, currentCard,
      el('div', { class: 'split' }, deriveCard, el('div', {}, imageCard, specCard)),
      el('div', { class: 'split' },
        card('全部稿件', drafts.length + ' 篇', rows.length ? list(rows) : emptyState('还没有稿件。')),
        el('div', {}, card('体检记录', '', list(assessments)), card('生成的图片', '', list(assets))))]
  }

  // ---------------------------------------------------------------- 页面：复盘与规则
  function pageRetro(st) {
    var works = (st.publishedWorks || []).concat(st.benchmarkWatch || [])
    var workOpts = selectFrom(works.slice(-30).reverse(), 'id', function (w) { return (w.kind === 'benchmark' ? '对标 · ' : '我的作品 · ') + platformLabel(w.platform) + ' · ' + String(w.workId).slice(0, 22) }, '用最近登记的作品（推荐）', S.sel.workId)
    var auto = S.automation || {}
    var autoCard = card('自动化：T+1 / 3 / 7 数据回查', '用 dsh 自带的定时任务' + (auto.serviceAvailable ? '（已检测到）' : '（当前宿主未检测到，仍可用插件内补跑扫描）') + '。登记作品时自动排好三次提醒。',
      el('div', { class: 'row' },
        badge(auto.serviceAvailable ? 'dsh 定时服务可用' : 'dsh 定时服务未检测到', auto.serviceAvailable ? 'ok' : 'warn'),
        badge(auto.sessionAvailable ? '有活跃会话' : '暂无活跃会话', auto.sessionAvailable ? 'ok' : ''),
        badge('已建提醒 ' + (auto.schedules || []).length + ' 条', 'brand'),
        badge('待回查 ' + (auto.due || []).length + ' 项', (auto.due || []).length ? 'warn' : '')),
      el('div', { class: 'hr' }),
      form('auto-form', [
        { key: 'tnReminderEnabled', label: '到点提醒我（不花钱）', type: 'checkbox', value: auto.reminderEnabled !== false },
        { key: 'feedbackAutoEnabled', label: '自动回查并写库（会消耗 TikHub 额度，默认关闭）', type: 'checkbox', value: auto.autoEnabled === true },
      ], [
        { value: 'save', label: '保存自动化设置' },
        { value: 'runNow', label: '立即检查并补跑', cls: 'soft' },
      ], async function (v, act) {
        try {
          var body = { tnReminderEnabled: v.tnReminderEnabled, feedbackAutoEnabled: v.feedbackAutoEnabled }
          if (act === 'runNow') body.runNow = true
          var res = await api('/api/automation', { method: 'POST', body: JSON.stringify(body) })
          S.automation = res
          S.last = Object.assign({ action: '自动化设置', args: body, at: new Date().toISOString() }, { ok: true, summary: act === 'runNow' ? ('补跑完成：' + ((res.runNow && res.runNow.count) || 0) + ' 项') : '自动化设置已保存。' + (v.feedbackAutoEnabled ? '已开启自动回查（会消耗额度）。' : '仅提醒，不自动花额度。'), data: {} })
          toast(S.last.summary)
          await refresh()
        } catch (e) { toast(e.message, true) }
      }),
      el('p', { class: 'muted' }, '说明：提醒只把一句话投递回 dsh 会话，不改数据、不花钱；开启「自动回查」后，到点会真实调用 TikHub 写快照，并在客户端没开时由插件内每小时补跑扫描兜底。无论哪种模式，规则都仍需人工审核。'),
      auto.sessionAvailable ? null : el('p', { class: 'muted' }, '当前还没有活跃的 dsh 对话：在页面登记的作品会先存好，等你打开一次对话后自动补建提醒；数据回查本身由插件内的每小时扫描兜底，不会丢。'),
      (auto.runs || []).length ? el('details', { class: 'advanced' }, el('summary', {}, '最近补跑记录'),
        list(auto.runs.slice(0, 8).map(function (r) { return item('T+' + r.day + ' ' + r.workId, (r.ok ? '成功' : '未成功') + ' · ' + (r.summary || '') + ' · ' + ts(r.ts), null) }))) : null)
    var watchForm = card('① 登记作品 / 对标作品', '填作品 ID 或抖音分享链接；登记后会自动排 T+1/3/7。对标作品会记 baseline，用来算增量。',
      form('watch-form', [
        { key: 'kind', label: '类型', type: 'select', value: 'published', options: [{ value: 'published', label: '我发布的作品' }, { value: 'benchmark', label: '对标作品（看别人涨了多少）' }] },
        { key: 'platform', label: '平台', type: 'select', value: 'douyin', options: PLATFORMS },
        { key: 'workId', label: '作品 ID', placeholder: '作品链接里的一长串数字' },
        { key: 'shareUrl', label: '或粘贴抖音分享链接（自动解析 ID）', placeholder: 'https://v.douyin.com/…' },
        { key: 'publishedAt', label: '发布时间（可空，默认现在）', type: 'date' },
      ], [{ value: 'watch', label: '登记并排好 T+1/3/7' }], function (v) {
        if (!v.workId && !v.shareUrl) { toast('填作品 ID 或分享链接，二选一', true); return null }
        return run('watch', v, { label: '登记作品' })
      }))
    var feedbackForm = card('② 记录 T+N 数据', '自动回查会取平台公开互动数；取不到就手工补录，两类数据分开记、不混算。不用写 JSON。',
      form('feedback-form', [
        { key: 'workId', label: '哪件作品', type: 'select', options: workOpts.options, value: workOpts.selected },
        { key: 'day', label: '第几天', type: 'select', value: '1', options: [{ value: '1', label: 'T+1（发布后 1 天）' }, { value: '3', label: 'T+3' }, { value: '7', label: 'T+7' }, { value: '0', label: 'T+0（刚发布）' }] },
        { key: 'mode', label: '怎么记', type: 'select', value: 'auto', options: [{ value: 'auto', label: '自动回查（推荐）' }, { value: 'manual', label: '手工填数字' }] },
        { key: 'views', label: '播放 / 浏览（手工时填）', type: 'number' },
        { key: 'likes', label: '点赞', type: 'number' },
        { key: 'comments', label: '评论', type: 'number' },
        { key: 'collects', label: '收藏', type: 'number' },
        { key: 'shares', label: '分享', type: 'number' },
      ], [{ value: 'feedback', label: '记录这次数据' }], function (v) {
        var args = { workId: v.workId, day: Number(v.day) }
        if (v.mode === 'manual') {
          var m = {}
          ;['views', 'likes', 'comments', 'collects', 'shares'].forEach(function (k) { if (String(v[k]).trim() !== '') m[k] = Number(v[k]) })
          if (!Object.keys(m).length) { toast('手工模式请至少填一个数字', true); return null }
          args.manual = m
        }
        return run('feedback', args, { label: v.mode === 'manual' ? '手工补录' : '自动回查' })
      }))
    var predictCard = card('③ 发布前判断 → 复盘 → 规则建议', '都自动针对最近的稿件 / 判断，不用填任何 id。',
      el('div', { class: 'row' },
        el('button', { class: 'btn sm', onclick: function () { run('predict', {}, { label: '锁定发布前判断' }) } }, '锁定发布前判断'),
        el('button', { class: 'btn sm soft', onclick: function () { run('retro', {}, { label: '复盘校准' }) } }, '复盘校准'),
        el('button', { class: 'btn sm soft', onclick: function () { run('rule', { op: 'propose' }, { label: '生成规则建议' }) } }, '生成规则建议')),
      el('p', { class: 'muted' }, '判断锁定后不可覆盖（否则校准失去意义）；复盘只做「当时的判断 vs 后来的真实数据」对照，不补造结论。'))
    var ruleForm = card('手动加一条经验规则', '加完是「待审核」状态，必须点激活才会影响后续生成。',
      form('rule-add', [
        { key: 'name', label: '规则名称', placeholder: '例：开头先给具体数字' },
        { key: 'text', label: '具体怎么写', type: 'textarea', rows: 2, placeholder: '例：第一段用一个真实数字或一句用户原话开场，不要先讲背景' },
      ], [{ value: 'add', label: '添加为待审核规则' }], function (v) {
        if (!v.name) { toast('先填规则名称', true); return null }
        return run('rule', { op: 'add', name: v.name, text: v.text }, { label: '添加规则' })
      }))
    var originLabel = { api: '自动回查', manual: '手工补录', api_failed: '待补录 / 回查失败' }
    var snapRows = (st.snapshots || []).slice(-20).reverse().map(function (s) {
      var cls = s.origin === 'api' ? 'ok' : (s.origin === 'manual' ? 'warn' : 'err')
      return item(badge(originLabel[s.origin] || s.origin, cls) + ' ' + platformLabel(s.platform) + ' · T+' + (s.day == null ? '—' : s.day),
        kv(s.metrics) + ' · ' + ts(s.fetchedAt) + (s.limited ? ' · ' + s.limited : ''), null)
    })
    var ruleRows = (st.rules || []).slice(-20).reverse().map(function (r) {
      var statusText = { active: '已激活', proposed: '待审核', rejected: '已驳回' }[r.status] || r.status
      return item('[' + statusText + '] ' + r.name, r.text + ' · 证据 ' + (r.evidenceIds || []).length + ' 条',
        r.status === 'proposed' ? el('div', { class: 'row' },
          el('button', { class: 'btn sm', onclick: function () { run('rule', { op: 'activate', id: r.id }, { label: '激活规则' }) } }, '审核激活'),
          el('button', { class: 'btn sm ghost', onclick: function () { run('rule', { op: 'reject', id: r.id }, { label: '驳回规则' }) } }, '驳回')) : null)
    })
    var workRows = works.slice(-12).reverse().map(function (w) {
      return item((w.kind === 'benchmark' ? '对标 · ' : '我的作品 · ') + platformLabel(w.platform) + ' · ' + String(w.workId).slice(0, 24),
        '初始 ' + kv(w.baselineStats) + ' · 已回查 ' + (w.followups || []).length + ' 次' + (w.delta ? ' · 增量 ' + kv(w.delta) : ''), null)
    })
    return [stepBar(), helpLine('发布前先锁定判断，发布后按 T+1/3/7 记数据，最后回来看「当时想的和实际差多少」。', '看说明', 'guide'),
      autoCard, el('div', { class: 'split' }, watchForm, feedbackForm), predictCard, ruleForm,
      el('div', { class: 'split' }, card('作品与对标', '', list(workRows)), card('指标快照', (st.snapshots || []).length + ' 条', list(snapRows))),
      el('div', { class: 'split' }, card('经验规则', '未审核不生效', list(ruleRows)),
        card('校准记录', '', list((st.retros || []).slice(-6).reverse().map(function (r) {
          return item('复盘', '假设：' + (r.hypothesis || '—') + ' · 自动 ' + (r.groups ? r.groups.api : 0) + ' / 手工 ' + (r.groups ? r.groups.manual : 0), null)
        }))))]
  }

  // ---------------------------------------------------------------- 页面：设置
  function pageSettings() {
    var t = (S.health && S.health.tikhub) || {}
    var spec = S.spec || {}, validation = spec.validation || {}
    var keyCard = card('① TikHub API Key', '只存在本机 settings.json（0600），接口只回掩码。没有 key 也能用纯文本链路，但采集与回查会如实报「未取到」。',
      form('set-key', [
        { key: 'tikhubKey', label: 'API Key', type: 'password', value: '', placeholder: '留空 = 不修改' },
      ], [{ value: 'save', label: '保存 Key' }], async function (v) {
        try {
          var patch = {}
          if (v.tikhubKey) patch.tikhubKey = v.tikhubKey
          await api('/api/settings', { method: 'POST', body: JSON.stringify(patch) })
          setForm('set-key', 'tikhubKey', '')
          toast('设置已保存'); await refresh()
        } catch (e) { toast(e.message, true) }
      }),
      el('div', { class: 'row' },
        el('span', { class: 'muted' }, '当前：' + (t.tokenMasked || '未配置') + ' · 来源 ' + (t.source || 'none')),
        el('button', { class: 'btn sm ghost', onclick: function () {
          if (!window.confirm('确定清除本机保存的 TikHub Key？清除后采集与自动回查都会停用。')) return
          api('/api/settings', { method: 'DELETE' }).then(function () { toast('已清除密钥'); refresh() }, function (e) { toast(e.message, true) })
        } }, '清除密钥')))
    var runCard = card('② 运行参数（一般用默认值就行）', '限流按 TikHub 官方口径：按次计费、每端点独立 RPS（多数 5/s）。',
      form('set-run', [
        { key: 'rpm', label: '全局每分钟请求上限', type: 'number', value: String(t.rpm || 30) },
        { key: 'perEndpointRps', label: '每个端点每秒请求上限', type: 'number', value: String(t.perEndpointRps || 5) },
        { key: 'cacheTtl', label: '缓存多久（秒）', type: 'number', value: String(t.cacheTtl || 1800) },
        { key: 'proxyUrl', label: '代理 URL（可空）', value: '', hint: t.proxyUrl ? '当前已配置代理，留空表示不修改' : '不用代理就留空' },
      ], [{ value: 'save', label: '保存运行参数' }], async function (v) {
        try {
          var patch = { rpm: Number(v.rpm), perEndpointRps: Number(v.perEndpointRps), cacheTtl: Number(v.cacheTtl) }
          if (v.proxyUrl) patch.proxyUrl = v.proxyUrl
          await api('/api/settings', { method: 'POST', body: JSON.stringify(patch) })
          setForm('set-run', 'proxyUrl', '')
          toast('运行参数已保存'); await refresh()
        } catch (e) { toast(e.message, true) }
      }))
    var imageCard = card('③ 生图（可选）', 'apiz 认证完全由本机 apiz-cli 管理，插件不接触密钥。',
      form('set-image', [
        { key: 'apizBin', label: 'apiz 可执行文件路径（可空 = 用 PATH）', value: t.apizBin || '' },
        { key: 'defaultImageModel', label: '默认生图模型（可空 = 自动发现）', value: t.defaultImageModel || '' },
        { key: 'maxImagesPerRun', label: '单次最多生成几张', type: 'number', value: String(t.maxImagesPerRun || 3) },
      ], [{ value: 'save', label: '保存生图设置' }], async function (v) {
        try {
          await api('/api/settings', { method: 'POST', body: JSON.stringify({ apizBin: v.apizBin, defaultImageModel: v.defaultImageModel, maxImagesPerRun: Number(v.maxImagesPerRun) }) })
          toast('生图设置已保存'); await refresh()
        } catch (e) { toast(e.message, true) }
      }))
    var specCard = card('④ 端点校验', '白名单端点会对照线上 TikHub OpenAPI 校验；发现失效路径会列出来，不会偷偷换路径出数。',
      el('div', { class: 'row' },
        el('button', { class: 'btn sm soft', onclick: async function () {
          toast('正在拉取线上 OpenAPI…')
          try { await api('/api/spec/refresh', { method: 'POST', body: '{}' }); await refresh(); toast('端点校验完成') }
          catch (e) { toast(e.message, true) }
        } }, '联网校验端点')),
      list([
        item('线上 OpenAPI', (spec.status && spec.status.checked) ? (spec.status.version + ' / ' + spec.status.pathCount + ' paths / ' + spec.status.checkedAt) : '未同步（白名单按 V5.3.2 静态校验）', ''),
        item('白名单校验', validation.checked != null ? (validation.checked + '/' + validation.total + ' 命中线上 spec') : '未校验', (validation.missing || []).map(function (m) { return m.key + ' ' + m.path }).join('\n')),
      ]))
    var boundary = card('诚实边界', '', el('div', { class: 'muted' },
      'TikTok 有专用 analytics；抖音没有通用 analytics，主要靠按 ID 重拉详情里的公开互动数，billboard 分析只覆盖上榜作品；小红书详情需要 xsec_token；视频号/公众号基本拿不到发布后指标。公开互动数 ≠ 平台后台的完播率/粉丝画像。平台文案规格来自第三方常量，未用真实样本验真，只作提示。'))
    var actionTable = el('table')
    actionTable.appendChild(el('thead', {}, el('tr', {}, el('th', {}, '内部动作'), el('th', {}, '做什么'), el('th', {}, '需要模型'), el('th', {}, '需确认'))))
    var tbody = el('tbody')
    ;(S.actions || []).forEach(function (a) {
      tbody.appendChild(el('tr', {}, el('td', {}, a.key), el('td', {}, a.label), el('td', {}, a.ai ? '是' : '否'), el('td', {}, a.needsConfirm ? '是' : '否')))
    })
    actionTable.appendChild(tbody)
    return [helpLine('设置页可以完全不填：只想写稿的话，直接回总台开始就行。', '看总台', 'home'),
      el('div', { class: 'split' }, keyCard, runCard), el('div', { class: 'split' }, imageCard, specCard),
      boundary, el('details', { class: 'advanced' }, el('summary', {}, '高级：内部动作清单'), actionTable)]
  }

  // ---------------------------------------------------------------- 页面：使用说明
  function pageGuide() {
    function h2(text) { return el('h2', { class: 'guide-h' }, text) }
    var start = card('三分钟上手', '不用记任何 id、不用写 JSON，跟着点就行。',
      el('ol', { class: 'guide-ol' },
        el('li', {}, '总台点一个「一键采集」（或随手记一条灵感）→ 拿到真实素材。', el('button', { class: 'link', onclick: function () { goto('radar') } }, '去信源工作台 →')),
        el('li', {}, '拆解页点「基于证据拆解」，再点「生成方向」，从候选里选一个。', el('button', { class: 'link', onclick: function () { goto('deconstruct') } }, '去拆解 →')),
        el('li', {}, '稿件页点「出稿」，然后「体检」「派生到各平台」，需要就「下载」。', el('button', { class: 'link', onclick: function () { goto('drafts') } }, '去出稿 →')),
        el('li', {}, '发布前在复盘页锁定判断；发布后登记作品，T+1/3/7 记数据，最后审核规则。', el('button', { class: 'link', onclick: function () { goto('retro') } }, '去复盘 →'))),
      el('p', { class: 'muted' }, '任何一步都能跳过。外部服务没配好时，纯文本链路照样能走完，插件会明确写「未取到」，不会拿搜索结果或模板稿冒充数据。'))
    var twoWays = card('两种用法，随便挑', '',
      item('① 侧栏页面（适合自己动手）', '就是你现在看的这六页：点按钮、看结果、做人工选择。', null),
      item('② 在 dsh 对话里让 Agent 跑（适合懒得点）', '直接说人话，例如：',
        el('div', {},
          el('pre', {}, '帮我采一下抖音热搜，基于素材做拆解并给 3 个方向\n用第二个方向写一篇小红书稿，再做一次体检'),
          el('button', { class: 'btn sm soft', onclick: function () { copy('帮我采一下抖音热搜，基于素材做拆解并给 3 个方向；用第二个方向写一篇小红书稿，再做一次体检', '提示词已复制，粘到 dsh 对话即可') } }, '复制这句提示词'))),
      el('p', { class: 'muted' }, '两个入口写的是同一份数据：对话里生成的东西，页面立刻能看到；页面上改的，Agent 也能查到。'))
    var flow = card('完整链路（想深入再看）', '不是必须全做，跳着用也没问题。',
      el('pre', { class: 'flow' },
        '找素材 → 拆解 → 选方向 → 出母稿 → 体检 → 派生多平台\n' +
        '   ↓                                        ↓\n' +
        '锁定发布前判断 ─────────→ 发布 ─→ T+1/3/7 回查真实数据\n' +
        '                                        ↓\n' +
        '                     复盘校准 → 规则建议 →【人工审核】→ 反哺下一轮写作'))
    var glossary = card('名词解释', '看不懂的词在这里都有人话版。',
      el('table', {}, el('tbody', {}, [
        ['信号', '从热榜/搜索/对标账号取回的一条素材（一个热词、一篇笔记、一个作品）'],
        ['证据', '信号里可引用的原文、评论原话或真实数字；拆解只会引用它'],
        ['拆解', '归纳这条内容「靠什么抓住人」：钩子、结构、证据、模式'],
        ['差异化方向', '≥3 个真正不同的切入角度，由你选一个再写'],
        ['母稿 / 派生稿', '同一母题的主稿件，以及改写成各平台规格的稿件'],
        ['版本', '改稿只追加新版本，旧的不覆盖，随时能回看'],
        ['发布前判断', '发布当下先写下的预期，锁定后不可改，用来和后来真实数据对照'],
        ['T+1/3/7', '发布后第 1、3、7 天回查一次真实互动数'],
        ['origin', '数据来源：自动回查 / 手工补录 / 回查失败，复盘时分开算，不混在一起'],
        ['经验规则', '复盘后提出的写作建议，必须人工审核激活，才会影响后续生成'],
      ].map(function (r) { return el('tr', {}, el('td', {}, r[0]), el('td', {}, r[1])) }))))
    var faq = card('常见问题', '',
      el('details', { open: 'open' }, el('summary', {}, '没填 TikHub key 能用吗？'), el('p', {}, '能。记灵感、拆解、出稿、体检、派生、导出、复盘都不依赖它。只有「采集」和「自动回查」需要 key，没配会明确报「未取到」，不会造假数据。')),
      el('details', {}, el('summary', {}, '出稿/拆解点下去说模型不可用？'), el('p', {}, '插件用的是 dsh 当前登录的默认模型，自己不带密钥。先在 dsh 里登录/选好模型再试；采集、登记、手工补录、规则审核不需要模型。')),
      el('details', {}, el('summary', {}, '自动回查会不会偷偷花钱？'), el('p', {}, '不会，默认是关的。「到点提醒」只把一句话投递回 dsh 会话；只有你显式勾了「自动回查并写库」，才会真实调用 TikHub（按次计费）。每次调用都会记录在「调用留痕」里。')),
      el('details', {}, el('summary', {}, '平台规格是官方限制吗？'), el('p', {}, '不是。那是第三方发布器的静态常量，标了 advisory/verified=false，只作写作提示，不拦截、不预测表现；发布前以平台实际限制为准。')),
      el('details', {}, el('summary', {}, '导出/下载的文件在哪？'), el('p', {}, '点「下载 Markdown / HTML」会直接在浏览器里下载，同时在本机 $DSH_HOME/atelier/exports/ 存一份。结果面板里可以重新下载或复制内容。')),
      el('details', {}, el('summary', {}, '数据存在哪、会上传吗？'), el('p', {}, '全部存在本机 $DSH_HOME/atelier/ 的 state.json / settings.json，插件没有云端后端。只有你主动点采集/回查时才会请求 TikHub，生图走本机 apiz-cli。')),
      el('details', {}, el('summary', {}, '操作失败了怎么办？'), el('p', {}, '看页面顶部「最近一次」结果面板：会有原因、建议，以及「去设置」「确认执行」「看常见问题」等按钮。常见原因就三个：没配 key、模型没登录、高成本动作没勾确认。')),
      el('details', {}, el('summary', {}, '「交给 Agent」会覆盖我正写的对话吗？'), el('p', {}, '会替换当前会话草稿，所以点之前会先弹确认；不确定就用旁边的「复制提示词」，自己粘到新会话里。')))
    return [start, twoWays, flow, glossary, faq,
      card('还有问题？', '', el('p', { class: 'muted' }, '可以先回总台看「接下来做什么」，它会根据你已有的数据告诉你下一步。'),
        el('button', { class: 'btn', onclick: function () { goto('home') } }, '回总台 →'))]
  }

  // ---------------------------------------------------------------- 渲染
  function renderNav() {
    var nav = document.getElementById('nav')
    nav.textContent = ''
    PAGES.forEach(function (p) {
      nav.appendChild(el('button', {
        class: S.page === p[0] ? 'active' : '', title: p[1],
        onclick: function () { goto(p[0]) },
      }, el('span', { class: 'long' }, p[1]), el('span', { class: 'short' }, p[2])))
    })
    var page = PAGES.filter(function (p) { return p[0] === S.page })[0] || PAGES[0]
    document.getElementById('pageTitle').textContent = page[1]
    document.getElementById('pageSub').textContent = page[3]
  }
  function render() {
    renderNav()
    var view = document.getElementById('view')
    var scroll = view.scrollTop
    view.textContent = ''
    var st = S.state || {}
    var blocks
    try {
      if (S.page === 'home') blocks = pageHome(st)
      else if (S.page === 'radar') blocks = pageRadar(st)
      else if (S.page === 'deconstruct') blocks = pageDeconstruct(st)
      else if (S.page === 'drafts') blocks = pageDrafts(st)
      else if (S.page === 'retro') blocks = pageRetro(st)
      else if (S.page === 'settings') blocks = pageSettings()
      else blocks = pageGuide()
    } catch (err) { blocks = [card('页面渲染出错', err.message), el('pre', {}, String(err.stack || ''))] }
    var ctx = contextBar()
    if (ctx) view.appendChild(ctx)
    blocks.forEach(function (b) { if (b) view.appendChild(b) })
    view.scrollTop = scroll
    renderResult()
    updateBusy()
  }
  async function refresh() {
    try {
      var results = await Promise.all([
        api('/api/health'), api('/api/state'), api('/api/endpoints'), api('/api/actions'), api('/api/spec'), api('/api/automation'),
      ])
      S.health = results[0]; S.state = results[1]; S.endpoints = results[2]
      S.actions = results[3]; S.spec = results[4]; S.automation = results[5]
      document.getElementById('navStatus').textContent = (S.health.tikhub && S.health.tikhub.configured) ? 'TikHub 已配置' : '未配 key（纯文本可用）'
      render()
    } catch (err) {
      document.getElementById('navStatus').textContent = '连接失败'
      toast('读取插件接口失败：' + err.message, true)
    }
  }

  document.getElementById('btnRefresh').addEventListener('click', refresh)
  document.getElementById('btnGuide').addEventListener('click', function () { goto('guide') })
  document.getElementById('btnAgent').addEventListener('click', function () {
    var prompt = '用母题工作台跑一轮创作链路：先看 atelier_query health，再按状态执行采集 / 拆解 / 出稿。'
    if (!window.confirm('这会把一段提示词放进 dsh 对话，并替换当前会话正在编辑的草稿。\n\n如果不想覆盖草稿，请点「取消」，改用「复制提示词」。继续吗？')) {
      copy(prompt, '提示词已复制，粘到新会话即可'); return
    }
    parent.postMessage({ type: 'atelier:draft', prompt: prompt }, location.origin)
    toast('已交给 Agent；如果没有反应，可以复制提示词自己发')
  })
  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin) return
    if (event.data && event.data.type === 'atelier:draft-failed') toast('交给 Agent 失败：' + event.data.message, true)
    // 主题跟随由 gallery/scheme.js 统一处理（含 light/dark 归一化与本地记忆）
  })
  refresh()
})()
