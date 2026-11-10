// HTTP 半边：/atelier 前缀，鉴权三件套 + ops 白名单 + 静态页面。
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs'
import { join, resolve, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAction, queryState, health, ACTIONS } from './pipeline.js'
import { readState } from './store.js'
import { publicSettings, saveSettings, clearSettings } from './settings.js'
import { endpointList, endpointDetails, validateWhitelist } from './providers/tikhub.js'
import { fieldsFor } from './providers/endpoint-fields.js'
import { specStatus, fetchLiveSpec, specPaths } from './providers/openapi.js'
import { automationStatus, sweep, createTnReminders } from './schedule.js'

export const BASE = '/atelier'
const MAX_BODY = 256 * 1024

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    .end(JSON.stringify(value))
}

/** 鉴权服务缺席时放行（fail-closed 会让面板永久 403）。 */
export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return false
  return connection.requestRejection({ headers: req.headers })
}

export function readJson(req, maxBytes = MAX_BODY) {
  return new Promise((resolve_, reject) => {
    if (req.method !== 'POST') return reject(Object.assign(new Error('只接受 POST'), { status: 405 }))
    if (!(req.headers['content-type'] || '').includes('application/json')) {
      return reject(Object.assign(new Error('要 application/json'), { status: 415 }))
    }
    const site = req.headers['sec-fetch-site']
    if (site && site !== 'same-origin' && site !== 'none') return reject(Object.assign(new Error('拒绝跨站请求'), { status: 403 }))
    const origin = req.headers.origin
    if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
      return reject(Object.assign(new Error('Origin 与 Host 不同源'), { status: 403 }))
    }
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) { req.destroy(); return reject(Object.assign(new Error('请求体过大'), { status: 413 })) }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve_(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(Object.assign(new Error('JSON 解析失败'), { status: 400 })) }
    })
    req.on('error', reject)
  })
}

/** 路径防护四步：拒点段 → realpath 目录 → 前缀检查 → 文件 realpath 复核。 */
export function safeFile(dir, rel) {
  try {
    if (rel.split(/[\\/]/).some((seg) => seg.startsWith('.'))) return null
    const base = realpathSync(dir)
    const target = resolve(base, normalize(rel))
    if (target !== base && !target.startsWith(base + sep)) return null
    if (!existsSync(target)) return null
    const real = realpathSync(target)
    if (real !== target || !real.startsWith(base + sep) || !statSync(real).isFile()) return null
    return real
  } catch { return null }
}

function serveFile(res, file) {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'content-length': statSync(file).size, 'cache-control': 'no-cache' })
  createReadStream(file).pipe(res)
}

export async function handle(ctx, req, res, galleryDir) {
  try {
    const rejection = requestRejection(ctx, req)
    if (rejection === true || typeof rejection === 'number') {
      return json(res, { error: '未授权' }, typeof rejection === 'number' ? rejection : 403)
    }
    const url = new URL(req.url, 'http://x')
    const path = url.pathname.slice(BASE.length) || '/'

    if (path === '/api/health' && req.method === 'GET') return json(res, health(readState(), ctx))
    if (path === '/api/state' && req.method === 'GET') return json(res, readState())
    if (path === '/api/actions' && req.method === 'GET') {
      return json(res, Object.entries(ACTIONS).map(([key, v]) => ({ key, ...v })))
    }
    if (path === '/api/endpoints' && req.method === 'GET') {
      const group = url.searchParams.get('group')
      const details = new Map(endpointDetails(group).map((e) => [e.key, e]))
      return json(res, endpointList(group).map((e) => ({
        ...e,
        required: details.get(e.key)?.required || [],
        defaults: details.get(e.key)?.defaults || {},
        fields: fieldsFor(details.get(e.key) || {}),
      })))
    }
    if (path === '/api/spec' && req.method === 'GET') {
      return json(res, { status: specStatus(), validation: validateWhitelist(specPaths()) })
    }
    if (path === '/api/spec/refresh' && req.method === 'POST') {
      await readJson(req)
      const record = await fetchLiveSpec({ force: true })
      return json(res, { ok: Boolean(record), status: specStatus(), validation: validateWhitelist(specPaths()) })
    }
    if (path === '/api/settings' && req.method === 'GET') return json(res, publicSettings())
    if (path === '/api/settings' && req.method === 'POST') {
      const body = await readJson(req)
      return json(res, saveSettings(body))
    }
    if (path === '/api/settings' && req.method === 'DELETE') return json(res, clearSettings())
    if (path === '/api/automation' && req.method === 'GET') return json(res, automationStatus(ctx))
    if (path === '/api/automation' && req.method === 'POST') {
      const body = await readJson(req)
      const patch = {}
      if (typeof body.tnReminderEnabled === 'boolean') patch.tnReminderEnabled = body.tnReminderEnabled
      if (typeof body.feedbackAutoEnabled === 'boolean') patch.feedbackAutoEnabled = body.feedbackAutoEnabled
      if (Object.keys(patch).length) saveSettings(patch)
      const result = body.runNow ? await sweep(ctx, { force: true }) : null
      return json(res, { ok: true, ...automationStatus(ctx), runNow: result })
    }
    if (path === '/api/query' && req.method === 'POST') {
      const body = await readJson(req)
      return json(res, queryState(String(body.what || 'state'), body || {}, ctx))
    }
    if (path === '/api/ops' && req.method === 'POST') {
      const body = await readJson(req)
      const op = String(body.op || '')
      if (!ACTIONS[op]) return json(res, { ok: false, error: `未知 op ${op}` }, 400)
      const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {}
      if (body.confirm) args.confirm = true
      if (body.dryRun) args.dryRun = true
      const result = await runAction(ctx, op, args)
      if (op === 'watch' && result.ok && result.data?.work?.workId) {
        try { result.data.automation = await createTnReminders(ctx, result.data.work) }
        catch (err) { result.data.automation = { ok: false, reason: String(err?.message || err) } }
      }
      return json(res, result, result.ok ? 200 : 200)
    }

    const rel = path === '/' ? 'index.html' : path.slice(1)
    const file = safeFile(galleryDir, rel)
    if (file) return serveFile(res, file)
    return json(res, { error: 'not found', path }, 404)
  } catch (err) {
    const status = typeof err?.status === 'number' ? err.status : 500
    return json(res, { ok: false, error: err?.message || '内部错误' }, status)
  }
}

export function galleryDir() { return fileURLToPath(new URL('../gallery/', import.meta.url)) }
