// 离线自检：不联网、不花额度、不需要 dsh，检查产物与文档纪律一致性。
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const errors = []
function check(cond, message) { if (!cond) errors.push(message) }

const pkg = JSON.parse(read('package.json'))
check(pkg.name === 'dsh-atelier', 'package.json 包名')
check(pkg.main === 'src/host.js', 'main 应指向 src/host.js')
check(pkg.exports?.['./client'] === './dist/client.js', 'exports ./client')
check(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch')
check(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform')
check(/0\.2\.1/.test(pkg.engines?.dsh || ''), 'engines.dsh 稳定线')
check(/- id: atelier/.test(read('cordis.patch.yml')), 'cordis.patch.yml insert id')

for (const file of ['src/host.js', 'src/pipeline.js', 'src/tools.js', 'src/skills.js', 'src/api.js', 'src/store.js',
  'src/settings.js', 'src/ai.js', 'src/client.js', 'src/providers/tikhub.js', 'src/providers/openapi.js',
  'src/providers/apiz.js', 'src/providers/endpoints.json', 'gallery/index.html', 'gallery/app.js',
  'gallery/style.css', 'gallery/scheme.js', 'skills/atelier-workflow/SKILL.md', 'README.md']) {
  check(existsSync(join(root, file)), `缺少文件 ${file}`)
}

if (existsSync(join(root, 'dist/client.js'))) {
  const bundle = read('dist/client.js')
  check(bundle.includes('__ModuleLoader__.load'), 'client 产物缺少 ModuleLoader 包装')
  check(bundle.includes('sidebar.panellist') && bundle.includes("'main'"), 'client 产物缺少槽位注入')
  const requires = [...bundle.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])
  check(requires.every((r) => ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'].includes(r)), `client 引用白名单外模块：${requires}`)
  check(!/\bimport\s*\(/.test(bundle), 'client 产物含动态 import')
  check(readdirSync(join(root, 'dist')).length === 1, 'dist 应只含 client.js')
} else errors.push('dist/client.js 不存在，先跑 npm run build')

const endpoints = JSON.parse(read('src/providers/endpoints.json')).endpoints
check(endpoints.length >= 30, '端点白名单数量')
check(new Set(endpoints.map((e) => e.key)).size === endpoints.length, '端点 key 重复')
check(endpoints.every((e) => /^\/api\/v1\//.test(e.path)), '端点路径格式')
check(endpoints.some((e) => e.group === 'feedback'), '缺少反馈端点')

// 文档一致性守卫：三处数据纪律必须同在，避免某处被改漏（借 dsh-seekmoney 实测做法）
const skill = read('skills/atelier-workflow/SKILL.md')
const host = read('src/host.js')
const skills = read('src/skills.js')
check(/禁止编造/.test(skill) && /禁止编造/.test(host), 'SKILL 与系统提示都要有「禁止编造」')
check(/不要用 web 搜索结果冒充平台数据/.test(skill) && /不要用 web 搜索结果冒充平台数据/.test(host), '都要有「不冒充平台数据」')
check(/端点/.test(skills) && /白名单/.test(skills), 'Skill addendum 要说明端点白名单')
check(!/(?:sk|tk)-[A-Za-z0-9]{20,}/.test(read('src/settings.js')), '疑似硬编码密钥')

if (errors.length) {
  console.error('[selftest] 失败：\n- ' + errors.join('\n- '))
  process.exit(1)
}
console.log(`[selftest] 通过：${endpoints.length} 个白名单端点，文件树/产物/文档守卫全部 OK`)
