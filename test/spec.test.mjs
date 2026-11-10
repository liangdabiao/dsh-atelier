import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'atelier-spec-'))
const spec = await import('../src/providers/platform-specs.js')
const pipeline = await import('../src/pipeline.js')
const store = await import('../src/store.js')

test('平台别名：中文名 / TikHub key / AiToEarn slug 都能命中；未收录返回 null', () => {
  assert.equal(spec.platformSpec('小红书').key, 'rednote')
  assert.equal(spec.platformSpec('xhs').key, 'rednote')
  assert.equal(spec.platformSpec('xiaohongshu').key, 'rednote')
  assert.equal(spec.platformSpec('抖音').key, 'douyin')
  assert.equal(spec.platformSpec('公众号').key, 'wechat-official')
  assert.equal(spec.platformSpec('wechat').key, 'wechat-official')
  assert.equal(spec.platformSpec('B站').key, 'bilibili')
  assert.equal(spec.platformSpec('不存在的平台'), null)
  assert.equal(spec.allPlatformSpecs().length, 15)
})

test('话题归一化：去 #、精确去重、支持中文，不臆造话题', () => {
  const r = spec.normalizeTopics('#干货 正文 #干货 #AI工具 #复盘', spec.platformSpec('抖音'))
  assert.deepEqual(r.topics, ['干货', 'AI工具', '复盘'])
  assert.equal(r.count, 3)
  assert.equal(r.issues.length, 0)
  assert.deepEqual(spec.normalizeTopics([], spec.platformSpec('抖音')).topics, [])
  assert.deepEqual(spec.normalizeTopics(['#A', 'A', '#B'], spec.platformSpec('抖音')).topics, ['A', 'B'])
})

test('话题上限：超过 maxCount / maxTotalLength 只提示，不静默丢弃', () => {
  const many = Array.from({ length: 6 }, (_, i) => '#话题' + i).join(' ')
  const tooMany = spec.normalizeTopics(many, spec.platformSpec('抖音'))
  assert.equal(tooMany.count, 6)
  assert.equal(tooMany.topics.length, 5)
  assert.equal(tooMany.overflow.length, 1)
  assert.equal(tooMany.issues[0].code, 'too_many')
  assert.equal(tooMany.issues[0].path, 'topics')

  // B站 topic.maxTotalLength = 199；5 字 × 50 = 250，确实超限
  const long = '#' + '很长的标签'.repeat(50)
  const tooLong = spec.normalizeTopics(long, spec.platformSpec('bilibili'))
  assert.ok(tooLong.issues.some((i) => i.code === 'too_long'))
})

test('确定性规格体检：超长/超量逐字段报 issues，带 path/limit/actual 便于定点改', () => {
  const check = spec.checkDraftAgainstSpec({
    title: '标'.repeat(40), body: '正'.repeat(1100),
    topics: Array.from({ length: 6 }, (_, i) => '话题' + i),
    images: Array.from({ length: 13 }, () => 'x.jpg'),
  }, '抖音')
  assert.equal(check.matched, true)
  assert.equal(check.ok, false)
  assert.equal(check.verified, false)
  assert.equal(check.advisory, true)
  for (const path of ['title', 'body', 'total', 'topics', 'images']) {
    assert.ok(check.issues.some((i) => i.path === path), `应报 ${path}`)
  }
  const title = check.issues.find((i) => i.path === 'title')
  assert.equal(title.limit, 30)
  assert.equal(title.actual, 40)
  assert.equal(check.checks.title.ok, false)
})

test('合规稿件通过；未收录平台跳过检查且不臆造限制', () => {
  const good = spec.checkDraftAgainstSpec({ title: '十个字以内', body: '一段正常长度的正文', topics: ['AI工具'] }, '小红书')
  assert.equal(good.ok, true)
  assert.equal(good.issues.length, 0)
  assert.equal(good.displayName, '小红书')

  const unknown = spec.checkDraftAgainstSpec({ title: 'x'.repeat(500) }, '未知平台')
  assert.equal(unknown.matched, false)
  assert.equal(unknown.ok, true)
  assert.equal(unknown.issues.length, 0)
  assert.match(unknown.note, /不臆造平台限制/)
})

test('spec action 可查单平台与全表，结果明确标注 advisory / unverified', async () => {
  const one = await pipeline.runAction({}, 'spec', { platform: '小红书' })
  assert.equal(one.ok, true)
  assert.equal(one.data.platformSpecs[0].key, 'rednote')
  assert.equal(one.data.advisory, true)
  assert.equal(one.data.verified, false)
  const all = await pipeline.runAction({}, 'spec', { listPlatforms: true })
  assert.equal(all.data.platformSpecs.length, 15)
  assert.match(spec.specsForPrompt(['小红书', '抖音']), /≤ 20/)
  assert.match(spec.specsForPrompt(['小红书', '抖音']), /≤ 30/)
  const health = pipeline.health()
  assert.equal(health.platformSpecs.count, 15)
  assert.equal(health.platformSpecs.verified, false)
})

test('统一指标字段对照：短名/平台原始字段都能归一化，未知字段保留不丢数', () => {
  const r = spec.normalizeMetrics({ views: 1000, likes: 30, digg_count: 55, comment_count: 7, unknown_xyz: 9 })
  assert.equal(r.normalized.viewCount, 1000)
  assert.equal(r.normalized.likeCount, 55)
  assert.equal(r.normalized.commentCount, 7)
  assert.equal(r.unmapped.unknown_xyz, 9)
  assert.ok(r.unknownFields.includes('unknown_xyz'))

  const mixed = spec.normalizeMetrics({ viewCount: 5, play_count: 8, share_count: '12', retweet_count: 3 })
  assert.equal(mixed.normalized.viewCount, 5)
  assert.equal(mixed.normalized.playCount, 8)
  assert.equal(mixed.normalized.shareCount, 12)
  assert.deepEqual(spec.normalizeMetrics(null), { normalized: {}, unmapped: {}, fieldCount: 0, unknownFields: [] })
})

test('feedback 手工补录：原 metrics 不变，额外写入 metricsNormalized', async () => {
  await pipeline.runAction({}, 'watch', { kind: 'published', platform: 'douyin', workId: 'spec-test-1' })
  const res = await pipeline.runAction({}, 'feedback', {
    workId: 'spec-test-1', day: 1, manual: { views: 1000, likes: 30 },
  })
  assert.equal(res.ok, true)
  const snap = res.data.snapshot
  assert.equal(snap.origin, 'manual')
  assert.equal(snap.metrics.likes, 30)
  assert.equal(snap.metricsNormalized.normalized.likeCount, 30)
  assert.equal(snap.metricsNormalized.normalized.viewCount, 1000)
  assert.equal(store.readState().snapshots.at(-1).metricsNormalized.normalized.likeCount, 30)
})
