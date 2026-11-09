// 首帧同步定主题，避免闪白；随后由 client 半边 postMessage 跟随 dsh 主题。
(function () {
  var saved = ''
  try { saved = localStorage.getItem('atelier-scheme') || '' } catch (e) {}
  var scheme = saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  document.documentElement.setAttribute('data-scheme', scheme)
  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin) return
    var data = event.data
    if (!data || data.type !== 'atelier:scheme' || !data.scheme) return
    var next = String(data.scheme).indexOf('dark') >= 0 ? 'dark' : 'light'
    document.documentElement.setAttribute('data-scheme', next)
    try { localStorage.setItem('atelier-scheme', next) } catch (e) {}
  })
})()
