// 密钥与运行参数：单独文件、0600、接口只回掩码。TikHub key 只在这里；
// apiz 的认证完全由 CLI 自管，插件不接触。
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs'

export function dataDir() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'atelier')
}

export function settingsFile() { return join(dataDir(), 'settings.json') }

const DEFAULTS = {
  tikhubKey: '',
  rpm: 30,
  perEndpointRps: 5,
  cacheTtl: 1800,
  feedbackAutoEnabled: true,
  apizBin: '',
  defaultImageModel: '',
  maxImagesPerRun: 3,
  proxyUrl: '',
}

function atomicWrite(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, file)
  try { chmodSync(file, 0o600) } catch { /* Windows 忽略 */ }
}

export function readSettings() {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), 'utf8'))
    return { ...DEFAULTS, ...raw }
  } catch { return { ...DEFAULTS } }
}

export function saveSettings(patch) {
  const next = { ...readSettings() }
  for (const key of Object.keys(DEFAULTS)) {
    if (patch?.[key] === undefined) continue
    if (key === 'tikhubKey' && typeof patch[key] === 'string' && patch[key].trim().length < 8 && patch[key] !== '') {
      throw new Error('TikHub key 看起来不完整（至少 8 位）')
    }
    next[key] = typeof DEFAULTS[key] === 'number' ? Number(patch[key]) || DEFAULTS[key] : String(patch[key])
  }
  atomicWrite(settingsFile(), next)
  return publicSettings()
}

export function clearSettings() {
  atomicWrite(settingsFile(), { ...DEFAULTS })
  return publicSettings()
}

/** token 优先级：settings.json > 环境变量 > 空。缺 key 不发请求。 */
export function resolveToken() {
  const fromFile = readSettings().tikhubKey?.trim()
  if (fromFile) return fromFile
  return (process.env.ATELIER_TIKHUB_API_KEY || process.env.TIKHUB_TOKEN || '').trim()
}

export function maskToken(token) {
  if (!token) return ''
  if (token.length <= 8) return `${token.slice(0, 2)}****`
  return `${token.slice(0, 4)}****${token.slice(-4)}`
}

export function publicSettings() {
  const s = readSettings()
  const token = resolveToken()
  return {
    configured: Boolean(token),
    tokenMasked: maskToken(token),
    source: s.tikhubKey ? 'settings.json' : token ? 'env' : 'none',
    file: settingsFile(),
    rpm: s.rpm,
    perEndpointRps: s.perEndpointRps,
    cacheTtl: s.cacheTtl,
    feedbackAutoEnabled: s.feedbackAutoEnabled,
    apizBin: s.apizBin,
    defaultImageModel: s.defaultImageModel,
    maxImagesPerRun: s.maxImagesPerRun,
    proxyUrl: s.proxyUrl ? 'configured' : '',
  }
}

/** 日志/错误里抹掉密钥，避免回显。 */
export function redact(text, token = resolveToken()) {
  if (!token) return String(text)
  return String(text).split(token).join('[REDACTED]')
}

export function ensureDirs() {
  for (const dir of [dataDir(), join(dataDir(), 'raw'), join(dataDir(), 'assets'), join(dataDir(), 'exports')]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}
