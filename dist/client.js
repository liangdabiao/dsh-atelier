window.__ModuleLoader__.load({ id: "dsh-atelier", factory: (require) => { const module = { exports: {} }; const exports = module.exports;
// dsh 浏览器半边：sidebar.panellist + main 两个槽，主区用 iframe 加载 Host 伺服的工作台页面。
// 纯 CJS，scripts/build.mjs 会套 ModuleLoader 外壳，零 npm 依赖。
const h = require('react').createElement
const { useRef, useEffect } = require('react')

const PANEL_ID = 'atelier'
const BASE = '/atelier'
const MSG_DRAFT = 'atelier:draft'
const MSG_DRAFT_FAILED = 'atelier:draft-failed'
const MSG_SCHEME = 'atelier:scheme'

function PanelIcon(props) {
  return h('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', ...props },
    h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 4, stroke: 'currentColor', 'stroke-width': 1.6 }),
    h('path', { d: 'M7 16V8h2l3 4 3-4h2v8h-2v-4l-3 3-3-3v4H7z', fill: 'currentColor' }))
}

function apply(ctx) {
  function DeskPanel() {
    const frameRef = useRef(null)
    useEffect(() => {
      async function onMessage(event) {
        const frame = frameRef.current
        if (!frame || event.source !== frame.contentWindow) return
        if (event.origin !== location.origin) return
        const data = event.data
        if (!data || data.type !== MSG_DRAFT) return
        try {
          await ctx.uiWorkspace.startSession(undefined, { prompt: data.prompt, whenDraftExists: 'replace' })
        } catch (err) {
          frame.contentWindow?.postMessage({ type: MSG_DRAFT_FAILED, message: String(err) }, location.origin)
        }
      }
      window.addEventListener('message', onMessage)
      return () => window.removeEventListener('message', onMessage)
    }, [])
    useEffect(() => {
      const push = (scheme) => frameRef.current?.contentWindow?.postMessage({ type: MSG_SCHEME, scheme }, location.origin)
      if (ctx.inject) {
        ctx.inject(['theme'], (c) => {
          push(c.theme.getTheme())
          c.on('theme/change', () => push(c.theme.getTheme()))
        })
      }
    }, [])
    return h('iframe', {
      ref: frameRef, src: BASE + '/', title: '母题工作台',
      style: { width: '100%', height: '100%', border: 'none', background: 'transparent' },
    })
  }

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 25, label: () => '母题工作台' }, PanelIcon))
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, DeskPanel))
}

exports.isPlugin = true
exports.inject = ['slots', 'uiWorkspace']
exports.apply = apply

 return module.exports; } });
