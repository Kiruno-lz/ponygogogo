import { expect, test } from '@playwright/test'
import { enterHome, open, playUntilResult, startRace } from '../helpers.ts'

// Real race → result → poster dialog → PNG, including the exact source QR pixels.
test('生成分享图打开独立海报浮窗，按钮可用且可关闭', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await open(page)
  await enterHome(page)
  await startRace(page, 2)
  await playUntilResult(page)
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage
    const seen: string[][] = []
    const canvases = new Map<HTMLCanvasElement | OffscreenCanvas, string[]>()
    ;(window as unknown as { posterHorseDraws: string[][] }).posterHorseDraws = seen
    CanvasRenderingContext2D.prototype.drawImage = function (...args: [CanvasImageSource, ...number[]]) {
      const image = args[0]
      if (image instanceof HTMLImageElement && /\/assets\/art\/(?:result\/hero|share\/horse)-/.test(image.src)) {
        let drawn = canvases.get(this.canvas)
        if (!drawn) { drawn = []; canvases.set(this.canvas, drawn); seen.push(drawn) }
        drawn.push(new URL(image.src).pathname)
      }
      return original.apply(this, args as Parameters<typeof original>)
    }
  })
  await page.getByTestId('result-btn-share').click()
  const dialog = page.getByTestId('share-dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('share-poster')).toBeVisible()
  await expect(page.getByTestId('share-save')).toBeEnabled()
  const horseDraws = await page.evaluate(() => (window as unknown as { posterHorseDraws: string[][] }).posterHorseDraws)
  expect(horseDraws.length).toBeGreaterThan(0)
  for (const canvas of horseDraws) expect(canvas, 'each PNG contains only the selected horse').toEqual(['/assets/art/share/horse-2.webp'])
  await page.screenshot({ path: testInfo.outputPath('share-dialog.png') })
  for (const action of ['copy', 'save', 'x', 'instagram', 'xiaohongshu', 'close']) {
    const button = page.getByTestId(`share-${action}`)
    await expect(button).toBeVisible()
    expect(await button.innerText()).toBe('')
  }
  const downloadEvent = page.waitForEvent('download')
  await page.getByTestId('share-save').click()
  const download = await downloadEvent
  await download.saveAs(testInfo.outputPath('poster.png'))
  const { readFile } = await import('node:fs/promises')
  const png = (await readFile(testInfo.outputPath('poster.png'))).toString('base64')
  const qrMatches = await page.evaluate(async png => {
    const modulePath = '/src/export/poster.ts'
    const { POSTER } = await import(modulePath)
    const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode()
    const qr = new Image(); qr.src = '/assets/art/share/qr.png'; await qr.decode()
    const canvas = document.createElement('canvas'); canvas.width = POSTER.width; canvas.height = POSTER.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    const x = POSTER.qr.x - 8; const y = POSTER.qr.y - 8; const size = POSTER.qr.size + 16
    const actual = ctx.getImageData(x, y, size, size).data
    const background = new Image(); background.src = '/assets/art/share/background.webp'; await background.decode()
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(background, 0, 0, POSTER.width, POSTER.height)
    ctx.translate(POSTER.qr.x + POSTER.qr.size / 2, POSTER.qr.y + POSTER.qr.size / 2)
    ctx.rotate(POSTER.qr.angle)
    ctx.imageSmoothingEnabled = false
    const scale = POSTER.qr.size / Math.max(qr.width, qr.height)
    ctx.drawImage(qr, -qr.width * scale / 2, -qr.height * scale / 2, qr.width * scale, qr.height * scale)
    const expected = ctx.getImageData(x, y, size, size).data
    let maxDifference = 0
    for (let i = 0; i < actual.length; i++) maxDifference = Math.max(maxDifference, Math.abs(actual[i] - expected[i]))
    return { size: [image.width, image.height], maxDifference }
  }, png)
  expect(qrMatches.size).toEqual([1620, 971])
  // PNG round-trip of alpha compositing may round a color channel by one value.
  expect(qrMatches.maxDifference, 'Alpha QR is rotated over the parchment without a white rectangle').toBeLessThanOrEqual(1)

  await page.getByTestId('share-copy').click()
  await expect(page.getByTestId('share-feedback')).toContainText(/已复制|Copied/)
  const copiedType = await page.evaluate(async () => (await navigator.clipboard.read())[0]!.types)
  expect(copiedType).toContain('image/png')
  for (const [platform, destination] of [['x', 'https://x.com/intent/post'], ['instagram', 'https://www.instagram.com/'], ['xiaohongshu', 'https://www.xiaohongshu.com/']] as const) {
    await context.route(`${destination}**`, route => route.fulfill({ body: 'Share destination' }))
    const popupEvent = page.waitForEvent('popup')
    await page.getByTestId(`share-${platform}`).click()
    const popup = await popupEvent
    await popup.waitForLoadState()
    expect(popup.url()).toContain(destination)
    await popup.close()
  }
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: () => Promise.reject(new Error('Permission denied')) }))
  await page.getByTestId('share-copy').click()
  await expect(page.getByTestId('share-feedback')).toContainText(/无法复制|Could not copy/)
  await expect(page.getByTestId('share-save')).toBeEnabled()
  await page.getByTestId('share-close').click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('result-btn-share')).toBeFocused()
  await page.getByTestId('result-btn-share').click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.getByTestId('result-btn-share').click()
  await expect(dialog).toBeVisible()
  await dialog.click({ position: { x: 5, y: 5 } })
  await expect(dialog).toHaveCount(0)

})

test('海报素材加载失败时提供说明，关闭后可以重新生成', async ({ page }) => {
  // A fresh document avoids the browser's decoded-image cache bypassing network routes.
  await page.route('**/assets/art/share/background.webp', route => route.abort())
  await page.goto('/')
  await expect(page.getByTestId('screen-loading')).toBeVisible()
  await page.evaluate(async () => {
    const reactPath = '/node_modules/.vite/deps/react.js'
    const domPath = '/node_modules/.vite/deps/react-dom_client.js'
    const dialogPath = '/src/result/SharePosterDialog.tsx'
    const [React, ReactDOM, { SharePosterDialog }] = await Promise.all([import(reactPath), import(domPath), import(dialogPath)])
    document.querySelector<HTMLElement>('#root')!.style.display = 'none'
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = ReactDOM.default.createRoot(host)
    const render = () => root.render(React.default.createElement(SharePosterDialog, {
      lang: 'en', result: { raceId: 'poster-load-failure', seed: '0x12', horseId: 0, rank: 1, finishTick: 100, endReason: 'finished', choices: [], gogoClicks: [] },
      onClose: () => root.render(null),
    }))
    ;(window as unknown as { reopenPoster: () => void }).reopenPoster = render
    render()
  })
  const dialog = page.getByTestId('share-dialog')
  await expect(dialog).toContainText('Could not create poster')
  await expect(page.getByTestId('share-save')).toBeDisabled()
  await page.getByTestId('share-close').click()
  await expect(dialog).toHaveCount(0)
  await page.unroute('**/assets/art/share/background.webp')
  await page.evaluate(() => (window as unknown as { reopenPoster: () => void }).reopenPoster())
  await expect(page.getByTestId('share-poster')).toBeVisible()
  await page.getByTestId('share-close').click()
  await expect(dialog).toHaveCount(0)
})

test('结算素材保持原比例，主角与按钮尺寸协调', async ({ page }, testInfo) => {
  await open(page)
  await enterHome(page)
  await startRace(page, 2)
  await playUntilResult(page)
  await page.getByTestId('screen-result').screenshot({ path: testInfo.outputPath('layout.png') })
  const facts = await page.evaluate(() => {
    const image = (selector: string) => {
      const el = document.querySelector<HTMLImageElement>(selector)!
      const r = el.getBoundingClientRect()
      return { w: r.width, h: r.height, ratio: el.naturalWidth / el.naturalHeight }
    }
    const home = document.querySelector('.result-btn-home')!.getBoundingClientRect()
    const again = document.querySelector('.result-btn-again')!.getBoundingClientRect()
    return { nameplate: image('.result-nameplate'), hero: image('.result-hero'), board: image('.result-stats-board'), homeHeight: home.height, againHeight: again.height }
  })
  expect(Math.abs(facts.nameplate.w / facts.nameplate.h / facts.nameplate.ratio - 1), '名牌不能横向挤压').toBeLessThan(0.02)
  expect(facts.hero.w / facts.board.w, '主角应与右侧信息板匹配').toBeGreaterThanOrEqual(0.7)
  expect(facts.againHeight / facts.homeHeight, '主按钮高度不能超过次按钮的 1.65 倍').toBeLessThanOrEqual(1.65)
})

// Render the production result component with explicit paid states; no wallet or chain writes.
test('中英文与五匹马的结算和海报在窄屏无溢出，保留实际结算状态', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByTestId('screen-loading')).toBeVisible()
  for (const lang of ['zh', 'en']) {
    for (let horseId = 0; horseId < 5; horseId++) {
      const phase = horseId === 0 ? 'practice' : horseId === 1 ? 'settled' : horseId === 2 ? 'pending' : horseId === 3 ? 'failed' : 'forfeited'
      await page.setViewportSize({ width: 1620, height: 971 })
      await page.evaluate(async ({ lang, horseId, phase }) => {
        const reactPath = '/node_modules/.vite/deps/react.js'
        const domPath = '/node_modules/.vite/deps/react-dom_client.js'
        const resultPath = '/src/result/ResultScreen.tsx'
        const [React, ReactDOM, { ResultScreen }] = await Promise.all([import(reactPath), import(domPath), import(resultPath)])
        const w = window as unknown as { resultTestRoot?: { unmount: () => void } }
        w.resultTestRoot?.unmount()
        document.querySelector('#result-test-stage')?.remove()
        document.querySelector<HTMLElement>('#root')!.style.display = 'none'
        const host = document.createElement('div')
        host.id = 'result-test-stage'
        host.className = 'stage'
        Object.assign(host.style, { width: '1620px', height: '971px', left: '0', top: '0' })
        document.body.appendChild(host)
        const root = ReactDOM.default.createRoot(host)
        w.resultTestRoot = root
        root.render(React.default.createElement(ResultScreen, {
          lang, onHome: () => {}, onAgain: () => {},
          result: {
            raceId: 'result-layout-test', seed: '0x1234', horseId, rank: horseId + 1, finishTick: 2381,
            endReason: 'finished', gogoClicks: [],
            choices: [0, 1, 2].map((checkpoint) => ({ checkpoint, cardId: checkpoint === 0 ? 'C-01' : null, reason: checkpoint === 0 ? 'picked' : 'not-reached', refreshes: [] })),
          },
          paid: phase === 'practice' ? undefined : {
            stakeLabel: '0.05', stake: 50_000_000_000_000_000n, previewRank: horseId + 1, phase,
            txHash: '0x' + '12'.repeat(32), detail: 'RPC unavailable',
            settlement: phase === 'settled' ? { rank: 2, payout: 75_000_000_000_000_000n } : null,
            mismatch: false, deadline: { state: 'open', at: Date.now() + 3_600_000 },
            choiceNotes: [null, null, null], onRetry: () => {},
          },
        }))
      }, { lang, horseId, phase })
      const artboard = page.locator('.result-artboard')
      await expect(artboard).toBeVisible()
      await page.evaluate(async () => {
        await document.fonts.ready
        await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('.result-artboard img'), (image) => image.decode()))
      })
      await artboard.screenshot({ path: testInfo.outputPath(`${lang}-${phase}.png`) })
      await page.getByTestId('result-btn-share').click()
      await expect(page.getByTestId('share-poster')).toBeVisible()
      const poster = page.getByTestId('share-poster')
      await expect(poster).toHaveAttribute('alt', new RegExp(horseId === 1 ? '#2' : `#${horseId + 1}`))
      await expect(poster).toHaveAttribute('alt', new RegExp(phase === 'practice' ? '免费试玩|Free practice' : phase === 'settled' ? '\\+0.025 MON' : phase === 'forfeited' ? '-0.05 MON' : '待链上验证|Awaiting chain'))
      await page.screenshot({ path: testInfo.outputPath(`${lang}-${phase}-poster.png`) })
      if (lang === 'en' && phase === 'pending') {
        const oldURL = await poster.getAttribute('src')
        await page.evaluate(async () => {
          const reactPath = '/node_modules/.vite/deps/react.js'
          const resultPath = '/src/result/ResultScreen.tsx'
          const [React, { ResultScreen }] = await Promise.all([import(reactPath), import(resultPath)])
          const root = (window as unknown as { resultTestRoot: { render: (element: unknown) => void } }).resultTestRoot
          root.render(React.default.createElement(ResultScreen, {
            lang: 'en', onHome() {}, onAgain() {},
            result: { raceId: 'result-layout-test', seed: '0x1234', horseId: 2, rank: 3, finishTick: 2381, endReason: 'finished', choices: [], gogoClicks: [] },
            paid: { stakeLabel: '0.05', stake: 50_000_000_000_000_000n, previewRank: 3, phase: 'settled', txHash: null, detail: null,
              settlement: { rank: 4, payout: 0n }, mismatch: true, deadline: null, choiceNotes: [], onRetry() {} },
          }))
        })
        await expect(poster).toHaveAttribute('alt', /#4.*-0.05 MON.*Settled/)
        expect(await poster.getAttribute('src'), 'open poster refreshes after chain confirmation').not.toBe(oldURL)
      }

      await page.setViewportSize({ width: 844, height: 390 })
      await page.evaluate(() => {
        const scale = Math.min(innerWidth / 1620, innerHeight / 971)
        Object.assign(document.querySelector<HTMLElement>('#result-test-stage')!.style, {
          transform: `scale(${scale})`, left: `${(innerWidth - 1620 * scale) / 2}px`, top: `${(innerHeight - 971 * scale) / 2}px`,
        })
      })
      const controls = await page.locator('.share-icon-button').evaluateAll(buttons => buttons.map(button => {
        const r = button.getBoundingClientRect()
        return { width: r.width, height: r.height, x: r.x, y: r.y, right: r.right, bottom: r.bottom }
      }))
      expect(controls).toHaveLength(6)
      for (const r of controls) {
        expect(r.width).toBe(44); expect(r.height).toBe(44)
        expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0)
        expect(r.right).toBeLessThanOrEqual(844); expect(r.bottom).toBeLessThanOrEqual(390)
      }
      await page.getByTestId('share-close').click()
      const issues = await page.evaluate(() => {
        const issues: string[] = []
        for (const selector of ['.result-title', '.result-name', '.result-rank-line', '.result-row', '.result-practice-label', '.result-practice-value', '.result-settle-stamp', '.result-settle-detail', '.result-btn-home', '.result-btn-share', '.result-btn-again']) {
          for (const el of document.querySelectorAll<HTMLElement>(selector)) {
            const r = el.getBoundingClientRect()
            if (r.x < -1 || r.y < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) issues.push(`${selector} outside viewport`)
            if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') issues.push(`${selector} clipped`)
          }
        }
        const detail = document.querySelector<HTMLElement>('.result-settle-detail')?.getBoundingClientRect()
        if (detail) for (const selector of ['.result-btn-home', '.result-btn-share', '.result-btn-again']) {
          const button = document.querySelector(selector)!.getBoundingClientRect()
          if (detail.left < button.right && button.left < detail.right && detail.top < button.bottom && button.top < detail.bottom) issues.push(`${selector} overlaps settlement detail`)
        }
        return issues
      })
      expect(issues, `${lang} ${phase}`).toEqual([])
      await page.screenshot({ path: testInfo.outputPath(`${lang}-${phase}-narrow.png`) })
    }
  }
})
