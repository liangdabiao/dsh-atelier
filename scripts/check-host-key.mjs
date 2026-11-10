// 诊断脚本：检查 dsh 宿主默认模型的凭据是否还有效。
// 用途：AI 类动作报「Authentication Fails, Your api key: ****xxxx is invalid」时，
// 先跑这个确认问题在 dsh 侧（本插件不配模型密钥）。
// 只做鉴权检查，不产生推理费用；全程不回显密钥明文。
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const mask = (v) => (v && v.length > 10 ? v.slice(0, 4) + '****' + v.slice(-4) : '(未设置)')

const credPath = join(homedir(), '.dsh', '.credentials.yaml')
let cred = ''
try { cred = readFileSync(credPath, 'utf8') } catch { console.log('读不到 ' + credPath + '（dsh 可能未初始化）'); process.exit(0) }

// ① API Key 通道（deepseek-official）
const apiKey = (cred.match(/DEEPSEEK_API_KEY:\s*(\S+)/) || [])[1]
console.log('① API Key 通道（deepseek-official）')
if (!apiKey) {
  console.log('   未配置 DEEPSEEK_API_KEY')
} else {
  console.log('   key: ' + mask(apiKey))
  try {
    const r = await fetch('https://api.deepseek.com/user/balance', { headers: { Authorization: 'Bearer ' + apiKey } })
    const body = (await r.text()).slice(0, 200)
    console.log(r.status === 200 ? '   有效（HTTP 200）' : '   无效（HTTP ' + r.status + '）' + (body ? ' ' + body : ''))
  } catch (e) { console.log('   请求失败：' + e.message) }
}

// ② 账号通道（deepseek-account）——推荐，不受 API Key 过期影响
const acctToken = (cred.match(/deepseek-account-platform\/default:[\s\S]*?token:\s*(\S+)/) || [])[1]
console.log('② 账号通道（deepseek-account）')
if (!acctToken) {
  console.log('   未登录账号：在 dsh 设置里登录 DeepSeek 账号')
} else {
  console.log('   token: ' + mask(acctToken))
  try {
    const r = await fetch('https://api.deepseek.com/v1/models', { headers: { 'x-dsh-auth-token': acctToken } })
    const j = await r.json().catch(() => null)
    if (r.status === 200) {
      console.log('   有效，可用模型：' + (j?.data || []).map((m) => m.id).join(', '))
    } else {
      console.log('   无效（HTTP ' + r.status + '）：需在 dsh 设置里重新登录')
    }
  } catch (e) { console.log('   请求失败：' + e.message) }
}

console.log('\n若 ① 无效但 ② 有效，把 profile 的 cordis.patch.yml 改成用 ②：')
console.log('- id: agent-default-model')
console.log('  name: "@deepseek-ai/dsh-agent-default-model"')
console.log('  config:')
console.log('    provider: deepseek-account')
console.log('    model: deepseek-flash')
