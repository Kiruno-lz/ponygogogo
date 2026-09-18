/**
 * 扫描 public/assets/placeholder 生成 manifest。
 * manifest 是一张 key -> { kind, path, bytes, sha256 } 的表，随构建生成；
 * 调用方只认 key，永远不拼路径——这是将来换成远程加载时唯一不用改的保证。
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = 'public/assets/placeholder'
const OUT = 'public/assets/manifest.json'

type Kind = 'image' | 'audio' | 'json'

const KIND_BY_EXT: Record<string, Kind> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.ogg': 'audio',
  '.mp3': 'audio',
  '.json': 'json',
}

interface Entry {
  kind: Kind
  path: string
  bytes: number
  sha256: string
  /** 同一逻辑资源的备用编码（音频 mp3 兜底） */
  alt?: string
  cid?: string
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('_') || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function keyOf(file: string): string {
  const rel = file.startsWith('public/assets/art/') ? 'art/' + relative('public/assets/art', file) : relative(ROOT, file)
  return rel.replace(/\.[^.]+$/, '').split('/').join('.')
}

const manifest: Record<string, Entry> = {}
for (const file of [...walk(ROOT), ...walk('public/assets/art').filter(p => !/storyboard|-(running|idle)-(\d+|animated)\.png$|generation-prompts|animation-metadata|wallet-reference|scene-(loop|bridge)|\/fidelity\/|-meta\.json$|\/ui-kit\.png$/.test(p) && (!p.includes('/ui/') || /-trimmed\.png$|\/bg-title\.png$|\/(flag|leaderboard-avatar)-\d\.png$|\/(star|avatar|stamina)-reference(-blank|-empty)?\.png$|\/(avatar|star-(race|gogo))-source\.png$/.test(p)))]) {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
  const kind = KIND_BY_EXT[ext]
  if (!kind) continue
  const key = keyOf(file)
  const buf = readFileSync(file)
  const publicPath = relative('public', file)
  if (ext === '.mp3') {
    // mp3 只作为同 key 的备用编码
    const existing = manifest[key]
    if (existing) {
      existing.alt = publicPath
      continue
    }
  }
  const entry: Entry = {
    kind,
    path: publicPath,
    bytes: buf.byteLength,
    sha256: createHash('sha256').update(buf).digest('hex').slice(0, 16),
  }
  if (ext === '.ogg') {
    const mp3 = file.replace(/\.ogg$/, '.mp3')
    try {
      statSync(mp3)
      entry.alt = relative('public', mp3)
    } catch {
      /* 没有 mp3 兜底 */
    }
  }
  manifest[key] = { ...(manifest[key] ?? {}), ...entry }
}

writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n')
console.log(`manifest: ${Object.keys(manifest).length} 项 -> ${OUT}`)
