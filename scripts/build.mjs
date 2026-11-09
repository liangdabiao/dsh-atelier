// 浏览器半边打包（零 npm 依赖版）。
// src/client.js 是纯 CJS 源码，只允许 require('react')；本脚本套上
// window.__ModuleLoader__.load({id, factory}) 外壳，产出 dist/client.js。
// 这样不依赖 esbuild / npm install，安装完成后即可被 dsh web 加载。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const ALLOWED_REQUIRES = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']

const source = readFileSync(join(root, 'src/client.js'), 'utf8')
const requires = [...source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])
const bad = requires.filter((spec) => !ALLOWED_REQUIRES.includes(spec))
if (bad.length) throw new Error(`client 引用了白名单外的模块：${bad.join(', ')}`)
if (/\bimport\s*\(/.test(source)) throw new Error('client 不能包含动态 import()')
if (/\b(?:^|\n)\s*import\s/.test(source)) throw new Error('client 必须是纯 CJS 源码，不能有 ESM import')

const banner = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {` +
  ` const module = { exports: {} }; const exports = module.exports;`
const footer = ' return module.exports; } });'
const code = `${banner}\n${source}\n${footer}\n`

rmSync(join(root, 'dist'), { recursive: true, force: true })
mkdirSync(join(root, 'dist'), { recursive: true })
writeFileSync(join(root, 'dist/client.js'), code)

const files = readdirSync(join(root, 'dist'))
if (files.length !== 1 || files[0] !== 'client.js') throw new Error(`dist/ 应只含 client.js，实际：${files.join(', ')}`)
const built = readFileSync(join(root, 'dist/client.js'), 'utf8')
if (!built.includes('__ModuleLoader__.load') || !built.endsWith(footer + '\n')) throw new Error('ModuleLoader 包装缺失')
console.log(`[build] dist/client.js ${(Buffer.byteLength(built) / 1024).toFixed(1)} KB (id=${pkg.name})`)
