// apiz-cli Provider：认证完全由 CLI 自管，插件只调命令、不碰密钥。
// 参考 D:\dsh-research\dsh-ecom-image\lib\apiz.js 的实测约定。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { readSettings, dataDir } from '../settings.js'

const execFileAsync = promisify(execFile)

export function resolveBin() {
  const configured = readSettings().apizBin?.trim()
  if (configured) return configured
  if (process.env.APIZ_BIN?.trim()) return process.env.APIZ_BIN.trim()
  return process.platform === 'win32' ? 'apiz.exe' : 'apiz'
}

export async function apizCall(args, options = {}) {
  const bin = options.bin || resolveBin()
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      windowsHide: true,
      timeout: options.timeoutMs || 60_000,
      maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    return { ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') }
  } catch (err) {
    return {
      ok: false,
      stdout: String(err.stdout || ''),
      stderr: String(err.stderr || err.message || ''),
      error: String(err.message || err),
    }
  }
}

/** CLI 可能在 JSON 前打印日志行：从第一个 { 开始解析。 */
export function parseJsonLoose(text) {
  const raw = String(text ?? '')
  const start = raw.search(/[{[]/)
  if (start < 0) throw new Error('apiz 没有返回 JSON')
  const body = raw.slice(start).trim()
  try { return JSON.parse(body) } catch { /* 尝试截到最后一个括号 */ }
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  if (end > 0) return JSON.parse(body.slice(0, end + 1))
  throw new Error('apiz 返回的 JSON 无法解析')
}

/** 兼容两种实测返回形态：{code,data:{status,result:{output[]}}} 与 {status,task_id,result:{images[]},price}。 */
export function normalizeGenerate(raw) {
  const data = raw?.data && typeof raw.data === 'object' ? raw.data : raw
  const inner = data?.result && typeof data.result === 'object' ? data.result : {}
  const output = inner?.output || data?.output || raw?.output || []
  const fromOutput = (Array.isArray(output) ? output : [])
    .map((row) => (typeof row === 'string' ? row : row?.url || row?.image_url || row?.image))
    .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
  const fromResult = Array.isArray(inner.images)
    ? inner.images.map((row) => (typeof row === 'string' ? row : row?.url)).filter((u) => typeof u === 'string')
    : []
  const images = [...new Set([...fromResult, ...fromOutput])]
  const status = String(data?.status || inner?.status || raw?.status || (images.length ? 'completed' : 'unknown'))
  return {
    status,
    taskId: String(data?.task_id || raw?.task_id || inner?.task_id || ''),
    images,
    price: data?.price ?? raw?.price ?? null,
    ok: status === 'completed' || status === 'succeeded' || images.length > 0,
  }
}

export async function authStatus() {
  const res = await apizCall(['auth', 'status', '--json'])
  return { ok: res.ok, text: (res.stdout || res.stderr).slice(0, 600), raw: res }
}

export async function accountBalance() {
  const res = await apizCall(['account', 'balance', '--json'])
  return { ok: res.ok, text: (res.stdout || res.stderr).slice(0, 600), raw: res }
}

export async function listImageModels() {
  const res = await apizCall(['models', 'list', '--category', 'image', '--json'])
  if (!res.ok) return { ok: false, error: res.stderr || res.error, raw: res }
  try {
    const json = parseJsonLoose(res.stdout)
    const rows = Array.isArray(json) ? json : (json.data?.models || json.models || json.data || [])
    return { ok: true, models: Array.isArray(rows) ? rows : [], raw: json }
  } catch (err) { return { ok: false, error: err.message, raw: res } }
}

export async function uploadReference(file) {
  const res = await apizCall(['upload', String(file), '--json'], { timeoutMs: 120_000 })
  if (!res.ok) throw new Error(`apiz upload 失败：${res.stderr || res.error}`)
  const json = parseJsonLoose(res.stdout)
  const url = json?.data?.url || json?.url || json?.data?.file_url || json?.file_url
  if (!url) throw new Error('参考图上传后没拿到公网 URL，停止生成（不静默降级成文生图）')
  return url
}

/**
 * 生成一张图。参考图参数名随模型变化，先由调用方核对模型信息再传 params。
 * 超时/非终态一律保留 taskId，绝不重复下单（任务可能已计费）。
 */
export async function generate({ prompt, model, aspectRatio = '3:4', params = {}, waitTimeout = 405, dryRun = false }) {
  const args = ['generate', String(prompt), '--model', String(model), '--aspect-ratio', String(aspectRatio),
    '--wait', '--wait-timeout', String(waitTimeout), '--json']
  if (Object.keys(params || {}).length) args.push('--params', JSON.stringify(params))
  if (dryRun) return { ok: true, dryRun: true, command: [resolveBin(), ...args] }
  const res = await apizCall(args, { timeoutMs: (waitTimeout + 30) * 1000 })
  if (!res.ok) {
    return { ok: false, status: 'error', error: (res.stderr || res.error || '').slice(0, 600), taskId: '' }
  }
  let normalized
  try { normalized = normalizeGenerate(parseJsonLoose(res.stdout)) } catch (err) {
    return { ok: false, status: 'parse-error', error: err.message, raw: res.stdout.slice(0, 600) }
  }
  return { ...normalized, model, prompt }
}

export async function taskGet(taskId) {
  const res = await apizCall(['tasks', 'get', String(taskId), '--json'])
  if (!res.ok) return { ok: false, error: res.stderr || res.error }
  try { return { ok: true, ...normalizeGenerate(parseJsonLoose(res.stdout)) } } catch (err) { return { ok: false, error: err.message } }
}

/** 把生成图下载到本地 assets/，返回相对路径。 */
export async function downloadAsset(url, id, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`下载图片失败 HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  const ext = extname(new URL(url).pathname).toLowerCase() in { '.png': 1, '.jpg': 1, '.jpeg': 1, '.webp': 1 }
    ? extname(new URL(url).pathname).toLowerCase() : '.png'
  const dir = join(dataDir(), 'assets')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${id}${ext}`)
  writeFileSync(file, buffer)
  return { file, bytes: buffer.length }
}

export async function probe() {
  const [auth, balance, models] = await Promise.all([authStatus(), accountBalance(), listImageModels()])
  return {
    installed: auth.ok && !/not found|ENOENT|不是内部或外部命令/i.test(auth.text),
    loggedIn: auth.ok,
    authText: auth.text,
    balanceText: balance.text,
    modelCount: models.ok ? models.models.length : 0,
    models: models.ok ? models.models.slice(0, 20) : [],
    error: models.ok ? '' : models.error,
  }
}
