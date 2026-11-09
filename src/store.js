// 单一 state.json：原子写 + mtime 重读（桌面版/网页版双进程）+ 进程内串行队列。
// 全部业务写入都经过 mutate()，工具与 HTTP 接口共用，保证「工具写入 = 接口写入」。
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs'
import { dataDir } from './settings.js'

export const COLLECTIONS = [
  'signals', 'evidence', 'sources', 'campaigns', 'deconstructions', 'angles',
  'drafts', 'assessments', 'assets', 'predictions', 'publishedWorks',
  'benchmarkWatch', 'snapshots', 'retros', 'rules', 'relations', 'contextRuns', 'apiCalls',
]

export function stateFile() { return join(dataDir(), 'state.json') }

export function emptyState() {
  const state = { version: 1, updatedAt: new Date().toISOString() }
  for (const key of COLLECTIONS) state[key] = []
  return state
}

let cache = { mtimeMs: -1, file: '', state: null }

export function readState() {
  const file = stateFile()
  if (!existsSync(file)) return emptyState()
  let mtimeMs = -1
  try { mtimeMs = statSync(file).mtimeMs } catch { return emptyState() }
  if (cache.state && cache.file === file && mtimeMs === cache.mtimeMs) return cache.state
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const state = { ...emptyState(), ...parsed }
    for (const key of COLLECTIONS) if (!Array.isArray(state[key])) state[key] = []
    cache = { mtimeMs, file, state }
    return state
  } catch {
    // 文件损坏不让插件崩：当空态处理，但不清空磁盘文件（人工可救）
    return emptyState()
  }
}

export function writeState(state) {
  const file = stateFile()
  mkdirSync(dataDir(), { recursive: true })
  state.updatedAt = new Date().toISOString()
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  renameSync(tmp, file)
  cache = { mtimeMs: statSync(file).mtimeMs, file, state }
  return state
}

let queue = Promise.resolve()
/** 串行化所有写入；fn 收到一份可改的 state 快照，返回任意结果。 */
export function mutate(fn) {
  const run = queue.then(async () => {
    const state = structuredClone(readState())
    const result = await fn(state)
    writeState(state)
    return { state, result }
  })
  queue = run.then(() => {}, () => {})
  return run
}

let counter = 0
export function uid(prefix = 'id') {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`
}

export function addRecord(state, collection, record) {
  if (!COLLECTIONS.includes(collection)) throw new Error(`未知集合 ${collection}`)
  const row = { id: record.id || uid(collection.slice(0, 4)), createdAt: new Date().toISOString(), ...record }
  state[collection].push(row)
  return row
}

export function byId(state, collection, id) {
  return (state[collection] || []).find((row) => row.id === id) || null
}

export function activeRules(state) {
  return state.rules.filter((r) => r.status === 'active')
}

export function integrityHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** 稳定信号 id：同一平台同一标题不重复入库（见舟 datasource.py 的做法）。 */
export function signalId(platform, title) {
  return 'sig_' + createHash('sha256').update(`${platform}\0${title}`).digest('hex').slice(0, 20)
}

export function relation(state, from, to, type) {
  return addRecord(state, 'relations', { from, to, type })
}
