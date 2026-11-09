import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'atelier-api-'))
const api = await import('../src/api.js')

test('鉴权服务缺席时放行；返回状态码时拒绝', () => {
  assert.equal(api.requestRejection({ get: () => null }, { headers: {} }), false)
  assert.equal(api.requestRejection({ get: () => ({ requestRejection: () => false }) }, { headers: {} }), false)
  assert.equal(api.requestRejection({ get: () => ({ requestRejection: () => 401 }) }, { headers: {} }), 401)
})

test('safeFile：正常文件可伺服，点段与越界被拒', () => {
  const dir = api.galleryDir()
  assert.ok(api.safeFile(dir, 'index.html'))
  assert.ok(api.safeFile(dir, 'app.js'))
  assert.equal(api.safeFile(dir, '../package.json'), null)
  assert.equal(api.safeFile(dir, '..%2fpackage.json'), null)
  assert.equal(api.safeFile(dir, 'nope.js'), null)
})

test('readJson：非 POST / 非 JSON / 跨站都被拒', async () => {
  const { EventEmitter } = await import('node:events')
  function req(headers, method) {
    const r = new EventEmitter()
    r.method = method || 'POST'; r.headers = headers || {}
    r.destroy = () => {}
    return r
  }
  await assert.rejects(() => api.readJson(req({}, 'GET')), /只接受 POST/)
  await assert.rejects(() => api.readJson(req({}), {}), /application\/json/)
  await assert.rejects(() => api.readJson(req({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' })), /跨站/)
  await assert.rejects(() => api.readJson(req({ 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: 'http://evil' , host: 'localhost' })), /不同源/)
})
