import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'atelier-store-'))
process.env.DSH_HOME = home
process.env.ATELIER_TIKHUB_API_KEY = ''
const store = await import('../src/store.js')
const { dataDir } = await import('../src/settings.js')

test('空态结构与原子写', () => {
  const state = store.readState()
  for (const key of store.COLLECTIONS) assert.ok(Array.isArray(state[key]), `${key} 应为数组`)
  store.writeState(state)
  assert.ok(existsSync(store.stateFile()))
  assert.equal(JSON.parse(readFileSync(store.stateFile(), 'utf8')).version, 1)
  assert.ok(dataDir().startsWith(home))
})

test('mutate 串行且落盘可被另一实例看到（mtime 重读）', async () => {
  const before = store.readState().sources.length
  await Promise.all(Array.from({ length: 8 }, (_, i) => store.mutate((s) => {
    store.addRecord(s, 'sources', { content: `第 ${i} 条` })
  })))
  const after = store.readState()
  assert.equal(after.sources.length, before + 8)
  // 模拟另一个进程改动文件，本进程应通过 mtime 重读看到
  const onDisk = JSON.parse(readFileSync(store.stateFile(), 'utf8'))
  onDisk.sources.push({ id: 'external', content: '外部写入', createdAt: new Date().toISOString() })
  writeFileSync(store.stateFile(), JSON.stringify(onDisk))
  const reread = store.readState()
  assert.ok(reread.sources.some((r) => r.id === 'external'))
})

test('signalId 去重稳定、integrityHash 可复现', () => {
  assert.equal(store.signalId('douyin', 'AI 工具'), store.signalId('douyin', 'AI 工具'))
  assert.notEqual(store.signalId('douyin', 'AI 工具'), store.signalId('xhs', 'AI 工具'))
  const value = { a: 1, b: ['x'] }
  assert.equal(store.integrityHash(value), store.integrityHash(value))
  assert.notEqual(store.integrityHash(value), store.integrityHash({ a: 2, b: ['x'] }))
})

test('损坏文件不让插件崩，且不清空磁盘', () => {
  writeFileSync(store.stateFile(), '{ broken')
  const state = store.readState()
  assert.equal(state.signals.length, 0)
  assert.match(readFileSync(store.stateFile(), 'utf8'), /broken/)
})
