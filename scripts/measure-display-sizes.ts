/**
 * 实测每张素材在真实渲染中的最大显示盒子（设计画布 px）。
 * 素材优化管线用它决定每张图的目标分辨率：目标 = min(原图, 显示尺寸 × 2)，只降不升。
 *
 * 用 offsetWidth/offsetHeight 而不是 getBoundingClientRect：舞台是 transform: scale，
 * 前者给的是设计画布坐标，后者混进了屏幕缩放，两者不能互换。
 *
 * 跑法（vite 必须先在 5177 起好）：
 *   node node_modules/vite/bin/vite.js --port 5177 --strictPort --host localhost &
 *   bun scripts/measure-display-sizes.ts
 */
import { writeFileSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'

const BASE = 'http://localhost:5177'
const OUT = 'scripts/display-sizes.json'
const FAST = 'mockDelay=0&raceSpeed=16'

/**
 * 有些素材只在走不到的状态里出现：钱包面板要先有账户，增益图标要恰好抽到那几张卡，
 * star-reference 是 .btn-star 在文案既不是 RACE! 也不是 GOGOGO 时的底图。
 *
 * 这些不写死数字——写死会随样式漂移且无人察觉。改成把同样结构的空元素挂进真实页面，
 * 让浏览器按同一份样式表算一次盒子再读回来。量的是 CSS 级联的结果，不是我对级联的理解。
 */
interface DetachedProbe {
  url: string
  html: string
  sel: string
  why: string
}

const DETACHED: DetachedProbe[] = [
  {
    url: '/assets/art/ui/wallet-trimmed',
    html: '<div class="home-wallet"></div>',
    sel: '.home-wallet',
    why: 'src/ui/HomeScreen.tsx:32 登录后才渲染',
  },
  {
    url: '/assets/art/ui/avatar-trimmed',
    html: '<div class="home-wallet"><button class="btn wallet-content">' +
      '<div class="wallet-row"><img><span></span></div><div class="wallet-row"><img></div></button></div>',
    sel: '.wallet-row:first-child img',
    why: 'src/ui/HomeScreen.tsx:35 钱包面板第一行，首行的尺寸与其余行不同',
  },
  {
    url: '/assets/art/ui/buff-frame-trimmed',
    html: '<div class="badge" style="width:70px"><div style="width:70px;height:74px"><img style="width:54px;height:54px"></div></div>',
    sel: '.badge > div',
    why: 'src/ui/Hud.tsx:86 增益槽底框，要抽到带效果的卡才出现',
  },
  {
    url: '/assets/art/ui/buff-fire-trimmed',
    html: '<div class="badge" style="width:70px"><div style="width:70px;height:74px"><img style="width:54px;height:54px"></div></div>',
    sel: '.badge > div > img',
    why: 'src/ui/Hud.tsx:99 四张增益图标共用同一个槽，量一次即可',
  },
  {
    url: '/assets/art/ui/star-reference',
    html: '<div class="select-race-cta"><button class="btn btn-star"><span class="big"></span></button></div>',
    sel: '.btn-star',
    why: 'theme.css:335 是 .btn-star 的底图，入场中（文案 …）与卡牌替换 GOGOGO 时露出；' +
      '选马页那个槽比赛中页的大，取大的',
  },
]

/** 四张增益图标共用一个槽，其余三张跟着 buff-fire 走 */
const SHARES_BOX: Record<string, string> = {
  '/assets/art/ui/buff-eye-trimmed': '/assets/art/ui/buff-fire-trimmed',
  '/assets/art/ui/buff-wing-trimmed': '/assets/art/ui/buff-fire-trimmed',
  '/assets/art/ui/buff-leaf-trimmed': '/assets/art/ui/buff-fire-trimmed',
}

/** Canvas / Phaser 里画的素材量不到 DOM 上，显示尺寸只能从代码读，逐条注明出处 */
const CANVAS_SIZES: Record<string, [number, number]> = {
  // src/game/pony.ts:47  setDisplaySize(194, 48)
  '/assets/art/ui/gold-ring-trimmed': [194, 48],
  // src/game/RaceScene.ts:96 粒子 scale.start = 0.42，取原图 × 0.42 由管线自行换算
  '/assets/art/ui/dust-trimmed': [0, 0],
  // src/game/RaceScene.ts:75/86/119 tileSprite + setTileScale(1)：贴图按 1:1 平铺，
  // 缩小贴图会同比缩短循环周期，景物重复频率翻倍。这三张禁止降采样。
  '/assets/art/track/far': [0, 0],
  '/assets/art/track/track': [0, 0],
  '/assets/art/track/front': [0, 0],
  // src/export/poster.ts:93 pw = 1200 × 0.3
  '/assets/art/ponies/0-portrait': [360, 270],
}

const PROBE = `() => {
  const out = {}
  const push = (raw, w, h) => {
    if (!raw || w <= 0 || h <= 0) return
    for (const m of raw.matchAll(/url\\((['"]?)([^'")]+)\\1\\)/g)) {
      let u = m[2]
      if (!u || u.startsWith('data:')) continue
      try { u = new URL(u, location.href).pathname } catch { continue }
      if (!u.startsWith('/assets/')) continue
      // 去掉扩展名：测量跑在已转成 WebP 的应用上，而管线查的是母版 PNG。
      // 键里留着扩展名，两边就永远对不上——这条对不上时表现是「悄悄不降采样」，不会报错。
      u = u.replace(/\\.[^./]+$/, '')
      const prev = out[u]
      if (!prev) out[u] = [w, h]
      else { prev[0] = Math.max(prev[0], w); prev[1] = Math.max(prev[1], h) }
    }
  }
  // background-size 决定贴图被画成多大，跟元素盒子不是一回事：
  // 八帧分镜用的是 800% 100%，按盒子量会把它判成需要 1/8 分辨率。
  const painted = (token, box) => {
    if (!token || token === 'auto' || token === 'contain' || token === 'cover') return box
    if (token.endsWith('%')) return box * parseFloat(token) / 100
    if (token.endsWith('px')) return parseFloat(token)
    return box
  }
  for (const el of document.querySelectorAll('*')) {
    const w = el.offsetWidth, h = el.offsetHeight
    if (!w || !h) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const bs = (cs.backgroundSize || 'auto').split(',')[0].trim().split(/\\s+/)
    push(cs.backgroundImage, Math.ceil(painted(bs[0], w)), Math.ceil(painted(bs[1] ?? bs[0], h)))
    // border-image 的切片按源图像素计，缩放源图必须同步改切片数值；这里只登记盒子，
    // 管线对 border-image 一律不降采样
    push(cs.borderImageSource, w, h)
    push(cs.maskImage, w, h)
    if (el.tagName === 'IMG' && el.getAttribute('src')) push('url(' + el.getAttribute('src') + ')', w, h)
  }
  return out
}`

const sizes: Record<string, [number, number]> = {}
const seenAt: Record<string, string[]> = {}

async function probe(page: Page, label: string): Promise<void> {
  const found = (await page.evaluate(`(${PROBE})()`)) as Record<string, [number, number]>
  for (const [url, [w, h]] of Object.entries(found)) {
    const prev = sizes[url]
    sizes[url] = prev ? [Math.max(prev[0], w), Math.max(prev[1], h)] : [w, h]
    ;(seenAt[url] ??= []).push(label)
  }
  console.log(`  ${label}: ${Object.keys(found).length} 项`)
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  // 视口取设计画布本身，让舞台 scale = 1，offsetWidth 与设计 px 一一对应
  const page = await browser.newPage({ viewport: { width: 1619, height: 971 } })

  console.log('加载页 → 首页')
  await page.goto(`${BASE}/?${FAST}`)
  await page.getByTestId('loading-progress').filter({ hasText: '100%' }).waitFor({ timeout: 120_000 })
  await probe(page, 'loading')
  await page.getByRole('button', { name: /进入游戏|Enter/ }).click()
  await page.getByTestId('screen-home').waitFor()
  await probe(page, 'home')

  console.log('脱离态探针（走不到的状态）')
  for (const probe of DETACHED) {
    const box = (await page.evaluate(
      ([html, sel]) => {
        const host = document.querySelector('.stage') ?? document.body
        const holder = document.createElement('div')
        holder.style.cssText = 'position:absolute;left:-9999px;top:0'
        holder.innerHTML = html
        host.appendChild(holder)
        const el = holder.querySelector(sel) as HTMLElement | null
        const box = el ? [el.offsetWidth, el.offsetHeight] : null
        holder.remove()
        return box
      },
      [probe.html, probe.sel],
    )) as [number, number] | null
    if (!box || box[0] <= 0 || box[1] <= 0) throw new Error(`探针量不到盒子：${probe.url}（${probe.sel}）`)
    sizes[probe.url] = box
    ;(seenAt[probe.url] ??= []).push('detached')
    console.log(`  ${probe.url.split('/').pop()}: ${box[0]}x${box[1]}  (${probe.why})`)
  }
  for (const [url, from] of Object.entries(SHARES_BOX)) {
    const box = sizes[from]
    if (!box) throw new Error(`${url} 要跟随 ${from}，但后者没量到`)
    sizes[url] = box
    ;(seenAt[url] ??= []).push('detached')
  }

  console.log('图鉴 / 设置')
  await page.getByRole('button', { name: /卡牌图鉴|COLLECTION/ }).first().click()
  await page.getByTestId('screen-collection').waitFor()
  await probe(page, 'collection')
  await page.getByRole('button', { name: /返回|Back/ }).first().click()
  await page.getByTestId('screen-home').waitFor()
  await page.getByRole('button', { name: /游戏设置|SETTINGS/ }).first().click()
  await page.getByTestId('screen-settings').waitFor()
  await probe(page, 'settings')
  await page.getByRole('button', { name: /返回|Back/ }).first().click()
  await page.getByTestId('screen-home').waitFor()

  console.log('选马 / 下注')
  await page.getByRole('button', { name: /开始游戏|START/ }).first().click()
  await page.getByTestId('screen-select').waitFor()
  await probe(page, 'select')
  for (let i = 0; i < 5; i++) {
    await page.getByTestId(`horse-${i}`).click()
    await probe(page, `select-horse-${i}`)
  }
  await page.getByTestId('bet-panel').locator('.chip').nth(1).click()
  await probe(page, 'select-bet')

  console.log('比赛 / 选牌')
  await page.locator('button.btn-star').last().click()
  await page.getByTestId('screen-race').waitFor()
  await page.getByTestId('countdown').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => undefined)
  await probe(page, 'race')
  await page.evaluate(() => {
    const w = window as unknown as { __rhythm?: number }
    w.__rhythm = window.setInterval(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
      window.setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })), 30)
    }, 500)
  })
  await page.getByTestId('card-panel').waitFor({ timeout: 90_000 })
  await probe(page, 'card-choice')
  await page.getByTestId('card-choice-0').locator('.card-root').click()

  console.log('结算')
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (await page.getByTestId('screen-result').isVisible().catch(() => false)) break
    const panel = page.getByTestId('card-panel')
    if (await panel.isVisible().catch(() => false)) {
      await page.getByTestId('card-choice-0').locator('.card-root').click({ timeout: 4000 }).catch(() => undefined)
    }
    await page.waitForTimeout(250)
  }
  await page.getByTestId('screen-result').waitFor({ timeout: 60_000 })
  await probe(page, 'result')

  await browser.close()

  for (const [url, wh] of Object.entries(CANVAS_SIZES)) {
    const prev = sizes[url]
    // [0,0] 是禁止降采样的哨兵，压过一切；其余与 DOM 量到的取大——
    // 同一张图可能既画在 canvas 上又挂在 DOM 上，取小的那个会把另一边弄糊
    sizes[url] = wh[0] === 0 || !prev ? wh : [Math.max(prev[0], wh[0]), Math.max(prev[1], wh[1])]
    ;(seenAt[url] ??= []).push('canvas')
  }

  const rows = Object.entries(sizes).sort(([a], [b]) => a.localeCompare(b))
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        note: '实测显示尺寸（设计画布 px）。[0,0] = 禁止降采样，理由见 scripts/measure-display-sizes.ts',
        measuredAt: new Date().toISOString().slice(0, 10),
        sizes: Object.fromEntries(rows.map(([u, wh]) => [u, wh])),
        seenAt: Object.fromEntries(rows.map(([u]) => [u, [...new Set(seenAt[u])]])),
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`\n写出 ${rows.length} 项 -> ${OUT}`)
}

await main()
