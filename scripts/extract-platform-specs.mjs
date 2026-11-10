// 一次性离线抽取工具：把 AiToEarn 的 PlatformStaticMetadata 常量转成 dsh-atelier 的本地规格表。
// 运行需要本机存在参考项目；生成的 JSON 已随包提交，普通用户/测试不需要这个脚本。
//   node scripts/extract-platform-specs.mjs
//   AITOEARN_PLATFORMS=D:/path/to/platforms node scripts/extract-platform-specs.mjs
//
// 重要：这些数值是第三方项目为它自己的发布器写的常量，不是平台官方公布的限制，
// 也没有用各平台真实样本验真。因此 JSON 里标 advisory=true / verified=false，
// 只用作写作阶段的「合规提示」，绝不作为拦截发布或宣称官方规格的依据。
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE = process.env.AITOEARN_PLATFORMS ||
  'D:/AiToEarn-main/project/aitoearn-backend/apps/aitoearn-server/src/core/channels/platforms'
const OUT = fileURLToPath(new URL('../src/providers/platform-specs.json', import.meta.url))

// 平台 key → 中文/英文别名。draft.platform 可能是中文名或 TikHub 的英文 key，都要认得。
const ALIASES = {
  douyin: ['抖音', 'douyin'],
  rednote: ['小红书', 'xhs', 'xiaohongshu', 'rednote', 'redNote'],
  'wechat-channels': ['视频号', '微信视频号', 'wxSph', 'wechat-channels', 'wechatChannels'],
  'wechat-official': ['公众号', '微信公众号', 'wechat-official', 'wechatOfficial', 'wechat'],
  kwai: ['快手', 'kuaishou', 'kwai'],
  bilibili: ['B站', 'b站', '哔哩哔哩', 'bilibili'],
  tiktok: ['TikTok', 'tiktok', '抖音海外'],
  youtube: ['YouTube', 'youtube', '油管'],
  twitter: ['X', 'x', 'Twitter', 'twitter', '推特'],
  instagram: ['Instagram', 'instagram', 'ins', 'IG'],
  facebook: ['Facebook', 'facebook', '脸书'],
  threads: ['Threads', 'threads'],
  linkedin: ['LinkedIn', 'linkedin', '领英'],
  pinterest: ['Pinterest', 'pinterest'],
  'google-business': ['谷歌商家', 'google-business', 'googleBusiness'],
}

function files(dir, depth = 0) {
  const out = []
  if (depth > 3) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...files(full, depth + 1))
    else if (entry.endsWith('.constants.ts')) out.push(full)
  }
  return out.sort()
}

const pickNum = (text, re) => { const m = re.exec(text); return m ? Number(m[1]) : null }
const pickList = (text, re) => { const m = re.exec(text); return m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [] }

const platforms = []
for (const file of files(SOURCE)) {
  const src = readFileSync(file, 'utf8')
  const key = basename(file).replace('.constants.ts', '')
  const limits = (/contentLimits:\s*\{([^}]*)\}/.exec(src) || [])[1] || ''
  const topic = (/topic:\s*\{([^}]*)\}/.exec(src) || [])[1] || ''
  const zh = (/'zh-CN'\s*:\s*'([^']+)'|"zh-CN"\s*:\s*"([^"]+)"/.exec(src) || [])
  const displayName = zh[1] || zh[2] || key
  const modes = pickList(limits, /modes:\s*\[([^\]]*)\]/).map((x) => x.replace(/^PublishContentMode\./, ''))
  const media = /mediaRules:\s*\{([\s\S]*?)\n\s*\}/.exec(src)
  const mediaText = media ? media[1] : ''
  platforms.push({
    key,
    aliases: ALIASES[key] || [displayName, key],
    displayName,
    contentLimits: {
      modes,
      maxTitleLength: pickNum(limits, /maxTitleLength:\s*(\d+)/),
      maxBodyLength: pickNum(limits, /maxBodyLength:\s*(\d+)/),
      maxTotalTextLength: pickNum(limits, /maxTotalTextLength:\s*(\d+)/),
      maxMediaCount: pickNum(limits, /maxMediaCount:\s*(\d+)/),
      maxImages: pickNum(limits, /maxImages:\s*(\d+)/),
      maxVideos: pickNum(limits, /maxVideos:\s*(\d+)/),
    },
    topic: {
      supported: /supported:\s*true/.test(topic),
      nativeField: /nativeField:\s*true/.test(topic),
      maxCount: pickNum(topic, /maxCount:\s*(\d+)/),
      maxTotalLength: pickNum(topic, /maxTotalLength:\s*(\d+)/),
    },
    mediaRules: {
      imageFormats: pickList(mediaText, /imageFormats:\s*\[([^\]]*)\]/),
      videoFormats: pickList(mediaText, /videoFormats:\s*\[([^\]]*)\]/),
      maxVideoDuration: pickNum(mediaText, /maxVideoDuration:\s*(\d+)/),
      minVideoDuration: pickNum(mediaText, /minVideoDuration:\s*(\d+)/),
    },
  })
}

const doc = {
  source: 'yikart/AiToEarn v2.5 — apps/aitoearn-server/src/core/channels/platforms/<platform>/<platform>.constants.ts (PlatformStaticMetadata)',
  generatedBy: 'scripts/extract-platform-specs.mjs',
  generatedAt: new Date().toISOString(),
  advisory: true,
  verified: false,
  note: '第三方发布器的静态常量，非平台官方公布限制，未用各平台真实样本验真；仅作写作阶段的合规提示，发布前请以平台实际限制为准。',
  metricFields: {
    works: ['viewCount', 'playCount', 'impressionCount', 'reachCount', 'likeCount', 'collectCount', 'commentCount', 'shareCount', 'saveCount', 'clickCount', 'engagementCount', 'watchTimeSeconds'],
    accounts: ['fansCount', 'followingCount', 'workCount', 'readCount', 'viewCount', 'impressionCount', 'reachCount', 'likeCount', 'collectCount', 'forwardCount', 'commentCount', 'clickCount', 'engagementCount'],
    source: 'apps/aitoearn-server/src/core/channels/platforms/platforms.interface.ts:434-475 (统一指标字段)',
  },
  // TikHub collectStats 的短名 → AiToEarn 统一字段名；只做对照，不改动原有 metrics。
  metricMap: {
    views: 'viewCount', likes: 'likeCount', comments: 'commentCount',
    collects: 'collectCount', shares: 'shareCount',
  },
  platforms,
}
writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8')
console.log(`[platform-specs] 写出 ${platforms.length} 个平台 → ${OUT}`)
for (const p of platforms) {
  const c = p.contentLimits
  console.log(`  ${p.key.padEnd(17)} ${p.displayName.padEnd(8)} title=${c.maxTitleLength ?? '-'} body=${c.maxBodyLength ?? '-'} total=${c.maxTotalTextLength ?? '-'} img=${c.maxImages ?? '-'} topic=${p.topic.maxCount ?? '-'}`)
}
