/**
 * 产物完整性：源码里出现的每一条资源路径，都必须在 public/assets 下真实存在。
 *
 * public/assets 是 scripts/build-web-assets.py 从 art-src 派生的产物，出片规则是一张白名单。
 * 白名单漏掉一项的表现是线上某张图 404——而本地开发跑的是同一份产物，肉眼一样看不出来，
 * 只有真的走到那个页面才会露馅。这条测试把"漏掉"从线上事故变成构建期失败。
 *
 * 动态拼出来的路径抓不到字面量，逐族按真实数据源枚举；新增一族拼接就在这里补一条。
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { PONY_CATALOG } from '../game/ponyCatalog.ts'
import { cardIconUrl } from '../race/cards/iconUrl.ts'
import { PAID_CARD_POOL } from '../race/cards/paidCards.ts'

const ROOT = new URL('../../', import.meta.url).pathname
const PUBLIC = join(ROOT, 'public')
const SRC = join(ROOT, 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(p)
  }
  return out
}

/** 只取引号或 url( 之后紧跟的 /assets/…，避开 '../assets/loader.ts' 这类 import */
const LITERAL = /["'`(](\/assets\/[A-Za-z0-9_\-./]+)/g

function staticReferences(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const file of walk(SRC)) {
    if (file.endsWith('.test.ts')) continue
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(LITERAL)) {
      const path = m[1]!
      // 带 ${} 的模板串在这里只会剩前缀，交给下面的动态枚举
      if (!/\.[a-z0-9]+$/.test(path)) continue
      const at = found.get(path) ?? []
      at.push(file.slice(ROOT.length))
      found.set(path, at)
    }
  }
  return found
}

describe('每条静态资源引用都有对应产物', () => {
  const refs = staticReferences()

  test('扫到的引用数量没有归零（正则失效会让这条测试变成空转）', () => {
    expect(refs.size).toBeGreaterThan(20)
  })

  for (const [path, sites] of refs) {
    test(path, () => {
      expect(existsSync(join(PUBLIC, path)), `${path} 缺产物，引用处：${sites.join(', ')}`).toBe(true)
    })
  }
})

describe('动态拼接的资源族', () => {
  test.skipIf(!existsSync(join(ROOT, 'art-src/art/cards/generation-prompts.json')))('本地母版存在时，已注册精修卡面的画布与 RGBA 像素保持一致', () => {
    const provenance = JSON.parse(readFileSync(join(ROOT, 'art-src/art/cards/generation-prompts.json'), 'utf8')) as {
      cards: { id: number; preserveCanvas?: boolean }[]
    }
    const registered = provenance.cards.filter(card => card.preserveCanvas)
    expect(registered.length).toBeGreaterThan(0)
    for (const card of registered) {
      const source = PNG.sync.read(readFileSync(join(ROOT, `art-src/art/cards/_generated/card-${card.id}.png`)))
      const master = PNG.sync.read(readFileSync(join(ROOT, `art-src/art/cards/card-${card.id}.png`)))
      expect([master.width, master.height]).toEqual([source.width, source.height])
      expect(master.data.equals(source.data), `C-${card.id} 的注册画布或像素被改动`).toBe(true)
    }
  })

  test('四十张卡各用独立 WebP 和 race 级产物，不复用旧切片或 SVG', () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC, 'assets/manifest.json'), 'utf8'))
    const urls = PAID_CARD_POOL.map(card => cardIconUrl(card.art.icon))
    expect(new Set(urls).size).toBe(40)
    for (const card of PAID_CARD_POOL) {
      const id = Number(card.cardId.slice(2))
      const url = `/assets/art/cards/card-${id}.webp`
      expect(cardIconUrl(card.art.icon), card.cardId).toBe(url)
      expect(card.art.tint, card.cardId).toBeUndefined()
      const entry = manifest[`art.cards.card-${id}`]
      expect(entry?.path, card.cardId).toBe(url.slice(1))
      expect(entry?.tier, card.cardId).toBe('race')
      const bytes = readFileSync(join(PUBLIC, url))
      expect(entry.sha256).toBe(createHash('sha256').update(bytes).digest('hex').slice(0, 16))
    }
  })

  // src/game/pony.ts:21、src/ui/PonyPortrait.tsx:9
  test('八帧分镜：每匹马 × idle/running', () => {
    for (const p of PONY_CATALOG) for (const action of ['idle', 'running']) {
      expect(existsSync(join(PUBLIC, `/assets/art/ponies/${p.horseId}-${action}.webp`)), `${p.horseId}-${action}`).toBe(true)
    }
  })

  // src/ui/RaceArt.tsx:7
  test('名牌头像：每匹马一张', () => {
    for (const p of PONY_CATALOG) {
      expect(existsSync(join(PUBLIC, `/assets/art/ponies/${p.horseId}-portrait.webp`)), `${p.horseId}-portrait`).toBe(true)
    }
  })

  // 运行时不读 -idle-0（海报用 art/share/horse-N），它只是 scripts/prepare-spin-thrust.py 的输入
  test('海报静帧：每匹马一张', () => {
    for (const p of PONY_CATALOG) {
      expect(existsSync(join(PUBLIC, `/assets/art/ponies/${p.horseId}-idle-0.webp`)), `${p.horseId}-idle-0`).toBe(true)
    }
  })

  // src/cards/Card.tsx:112、src/result/ResultScreen.tsx:106、src/export/poster.ts:131
  test('卡面图标：卡池里每条 art.icon', () => {
    for (const card of PAID_CARD_POOL) {
      expect(existsSync(join(PUBLIC, cardIconUrl(card.art.icon))), `${card.cardId} → ${card.art.icon}`).toBe(true)
    }
  })

  // src/ui/Hud.tsx:14-17 的 icon 映射表；新增一条效果图标要同步这里
  test('增益图标', () => {
    for (const icon of ['buff-wing', 'buff-leaf', 'buff-fire', 'buff-eye']) {
      expect(existsSync(join(PUBLIC, `/assets/art/ui/${icon}-trimmed.webp`)), icon).toBe(true)
    }
  })

  // src/result/ResultScreen.tsx——名次 1..5 各一枚奖牌，五匹马各一张结算立绘
  test('九个角色使用独立海报立绘，结束标题使用两份透明素材', () => {
    for (const p of PONY_CATALOG) expect(existsSync(join(PUBLIC, `/assets/art/share/horse-${p.horseId}.webp`))).toBe(true)
    for (const name of ['win', 'finish', 'prize-group']) expect(existsSync(join(PUBLIC, `/assets/art/share/${name}.webp`))).toBe(true)
  })

  test('结算奖牌与立绘', () => {
    for (let rank = 1; rank <= 5; rank++) {
      expect(existsSync(join(PUBLIC, `/assets/art/result/medal-${rank}.webp`)), `medal-${rank}`).toBe(true)
    }
    for (const p of PONY_CATALOG) {
      expect(existsSync(join(PUBLIC, `/assets/art/result/hero-${p.horseId}.webp`)), `hero-${p.horseId}`).toBe(true)
    }
  })
})

describe('资源清单', () => {
  const manifest = JSON.parse(readFileSync(join(PUBLIC, 'assets/manifest.json'), 'utf8')) as
    Record<string, { kind: string; path: string; bytes: number; tier: string; sha256: string; alt?: string }>
  const TIERS = ['boot', 'home', 'race', 'result']

  test('每一项都指向真实文件，且字节数与文件一致', () => {
    for (const [key, e] of Object.entries(manifest)) {
      const file = join(PUBLIC, e.path)
      expect(existsSync(file), `${key} → ${e.path}`).toBe(true)
      expect(statSync(file).size, key).toBe(e.bytes)
      if (e.alt) expect(existsSync(join(PUBLIC, e.alt)), `${key} 的备用编码`).toBe(true)
    }
  })

  test('每一项都有合法的分级', () => {
    for (const [key, e] of Object.entries(manifest)) {
      expect(TIERS, `${key} 的 tier`).toContain(e.tier)
    }
  })

  test('四个分级都非空——某一级为空说明分级规则失配，而不是真的不需要素材', () => {
    for (const tier of TIERS) {
      expect(Object.values(manifest).some((e) => e.tier === tier), `${tier} 级为空`).toBe(true)
    }
  })

  test('六套运行时特效素材有 race 级清单项且大小与摘要匹配', () => {
    const ids = ['blackhole', 'fire-wheel', 'rainbow-trail', 'rocket', 'wind', 'spin-thrust']
    for (const id of ids) {
      const key = `art.effects.${id}-sheet`
      const entry = manifest[key]
      expect(entry, key).toBeDefined()
      expect(entry!.path, key).toBe(`assets/art/effects/${id}-sheet.webp`)
      expect(entry!.tier, key).toBe('race')
      const bytes = readFileSync(join(PUBLIC, entry!.path))
      expect(bytes.byteLength, key).toBe(entry!.bytes)
      expect(createHash('sha256').update(bytes).digest('hex').slice(0, 16), key).toBe(entry!.sha256)
    }
  })

  test('黄色和绿色尖发使用独立 race 级素材，清单与实际文件一致', () => {
    for (const id of ['blonde-hair', 'green-hair']) {
      const key = `art.cosmetics.${id}`
      const entry = manifest[key]
      expect(entry, key).toBeDefined()
      expect(entry!.tier).toBe('race')
      const bytes = readFileSync(join(PUBLIC, entry!.path))
      expect(bytes.length).toBe(entry!.bytes)
      expect(createHash('sha256').update(bytes).digest('hex').slice(0, 16)).toBe(entry!.sha256)
    }
  })

  test('进首页要等的两级控制在 2 MB 以内', () => {
    const blocking = Object.values(manifest)
      .filter((e) => e.tier === 'boot' || e.tier === 'home')
      .reduce((n, e) => n + e.bytes, 0)
    expect(blocking).toBeLessThan(2 * 1024 * 1024)
  })
})

/**
 * 显示尺寸表与出片清单之间的接缝。
 * 这里曾经出过一次静默失败：测量跑在已转成 WebP 的应用上，键带着 .webp，
 * 而管线查的是母版 PNG——一张都对不上，于是一张都不降采样，产物悄悄变大，
 * 没有任何报错。键不带扩展名是这条接缝成立的前提，所以直接断言它。
 */
describe('显示尺寸表', () => {
  const sizes = JSON.parse(readFileSync(join(ROOT, 'scripts/display-sizes.json'), 'utf8')) as {
    sizes: Record<string, [number, number]>
  }
  const manifest = JSON.parse(readFileSync(join(PUBLIC, 'assets/manifest.json'), 'utf8')) as
    Record<string, { kind: string; path: string }>

  test('键一律不带扩展名，才能同时对上 PNG 母版与 WebP 产物', () => {
    const withExt = Object.keys(sizes.sizes).filter((k) => /\.[a-z0-9]+$/i.test(k))
    expect(withExt, `这些键带了扩展名：${withExt.join('、')}`).toEqual([])
  })

  test('绝大多数键都能对上一个真实产物', () => {
    const shipped = new Set(
      Object.values(manifest)
        .filter((e) => e.kind === 'image')
        .map((e) => '/' + e.path.replace(/\.[^./]+$/, '')),
    )
    const keys = Object.keys(sizes.sizes)
    const matched = keys.filter((k) => shipped.has(k)).length
    expect(matched / keys.length, `只有 ${matched}/${keys.length} 对得上`).toBeGreaterThan(0.8)
  })
})

// The derived alpha QR must ship losslessly; its input stays in art-src unchanged.
test('透明二维码使用独立 PNG 产物并保持母版像素', () => {
  const runtime = readFileSync(join(PUBLIC, 'assets/art/share/qr.png'))
  expect(runtime.equals(readFileSync(join(ROOT, 'art-src/art/share/qr.png')))).toBe(true)
  expect(runtime[25]).toBe(6) // RGBA
})
