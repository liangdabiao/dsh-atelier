import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'atelier-host-'))
const host = await import('../src/host.js')

test('apply 在宿主 ctx 上注册两个工具 / 技能 / 系统提示 / HTTP 前缀', () => {
  const calls = { tools: [], providers: [], sections: [], routes: [] }
  const ctx = {
    get: () => null,
    tools: { register: (t) => calls.tools.push(t) },
    skills: { registerProvider: (f) => calls.providers.push(f) },
    systemPrompt: { section: (s) => calls.sections.push(s) },
    webServer: { register: (r) => calls.routes.push(r) },
    effect: (fn) => fn(),
  }
  assert.equal(host.name, 'atelier')
  assert.deepEqual(host.inject, ['tools', 'skills', 'systemPrompt', 'webServer', 'connection'])
  host.apply(ctx)
  assert.deepEqual(calls.tools.map((t) => t.name), ['atelier', 'atelier_query'])
  assert.equal(calls.providers.length, 1)
  assert.equal(calls.sections.length, 1)
  assert.equal(calls.routes.length, 1)
  assert.equal(calls.routes[0].path, '/atelier')
  assert.equal(calls.routes[0].kind, 'prefix')
  assert.match(calls.sections[0].text, /禁止编造/)
})

test('工具参数 schema 完整、动作白名单生效', () => {
  const calls = []
  const ctx = {
    get: () => null, tools: { register: (t) => calls.push(t) },
    skills: { registerProvider: () => {} }, systemPrompt: { section: () => {} },
    webServer: { register: () => {} }, effect: () => {},
  }
  host.apply(ctx)
  const [main, query] = calls
  assert.ok(main.parameters.properties.action.enum.includes('feedback'))
  assert.ok(main.parameters.properties.action.enum.includes('radar'))
  assert.ok(main.parameters.properties.payload.description)
  assert.equal(main.output.schema.required.length, 3)
  assert.ok(query.parameters.properties.what.enum.includes('snapshots'))
})
