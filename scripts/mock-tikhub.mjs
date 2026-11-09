// 本地假 TikHub REST，用于免额度联调：node scripts/mock-tikhub.mjs
// 启动后设置 ATELIER_TIKHUB_BASE_URL=http://127.0.0.1:4398 再启动 dsh。
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_TIKHUB_PORT || 4398)
const words = [{ word: 'AI 工具的真实使用门槛', hot_value: 982311, event_time: '2026-11-09' },
  { word: '<em>一个人</em>做内容工作台', hot_value: 771200, event_time: '2026-11-09' }]
const notes = [{ id: 'n1', title: '我用三周把选题流程重做了一遍', desc: '钩子：先说结论再给证据', author: { nickname: '创作者甲' }, liked_count: '1.2万', comment_count: 388 },
  { id: 'n2', title: '别再追热点了', desc: '反直觉切入，评论区在吵什么', author: { nickname: '创作者乙' }, liked_count: 8421, comment_count: 215 }]
const comments = [{ content: '最怕的是写了半天没人看', liked: 320, ip: '广东' }, { content: '求模板', liked: 88, ip: '北京' }]

createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const path = url.pathname
  let body = { code: 200, message: 'ok', data: {} }
  if (path.includes('hot_search') || path.includes('trending') || path.includes('billboard')) body.data = { word_list: words, items: words }
  else if (path.includes('comment')) body.data = { comments }
  else if (path.includes('analytics')) body.data = { statistics: { play_count: 125000, digg_count: 8200, comment_count: 611, share_count: 233 }, keywords: ['门槛', '模板'] }
  else if (path.includes('search') || path.includes('suggest') || path.includes('user_post')) body.data = { items: notes }
  else body.data = { aweme_detail: { aweme_id: url.searchParams.get('aweme_id') || '7000000000000000001', desc: '一条示例作品', statistics: { play_count: 98000, digg_count: 4300, comment_count: 210 } } }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    .end(JSON.stringify(body))
  console.log('[mock-tikhub]', req.method, path)
}).listen(PORT, '127.0.0.1', () => console.log(`[mock-tikhub] http://127.0.0.1:${PORT}  设置 ATELIER_TIKHUB_BASE_URL=http://127.0.0.1:${PORT}`))
