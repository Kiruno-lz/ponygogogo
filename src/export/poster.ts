/**
 * 出图与分享。海报用离屏 Canvas 自己画，不截屏 DOM：
 * 版式固定，自己画一遍是确定的，截屏是碰运气的。
 */
import { CARD_BY_ID } from '../race/cards/pool.ts'
import { PAYOUT_TABLE, SIM_HZ, STAKE_PRESETS } from '../race/core/constants.ts'
import { FP } from '../race/core/fixed.ts'
import type { RaceResult } from '../race/core/types.ts'
import { HORSE_PROFILES, hexCss } from '../game/horses.ts'
import { ponyFullSvg, svgToDataUrl } from '../game/ponyArt.ts'
import type { Lang } from '../ui/i18n.ts'

export type PosterFormat = 'x' | 'ig'

const SIZES: Record<PosterFormat, [number, number]> = {
  x: [1200, 675],
  ig: [1080, 1350],
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('poster image failed: ' + src))
    img.src = src
  })
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export async function drawPoster(
  result: RaceResult,
  stakeTier: number,
  lang: Lang,
  format: PosterFormat,
): Promise<Blob> {
  const [W, H] = SIZES[format]
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d unavailable')

  const prof = HORSE_PROFILES[result.horseId]!
  const stake = STAKE_PRESETS[stakeTier]!
  const payout = (stake * PAYOUT_TABLE[result.rank - 1]!) / FP

  // 背景
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#f7e9d8')
  grad.addColorStop(1, '#d9b491')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#b77249'
  ctx.fillRect(0, H * 0.62, W, H * 0.1)
  ctx.strokeStyle = '#ebbe9c'
  ctx.lineWidth = 4
  for (let i = 1; i < 3; i++) {
    const y = H * 0.62 + (H * 0.1 * i) / 3
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }

  // 标题
  ctx.fillStyle = '#57250c'
  ctx.font = `900 ${Math.round(W * 0.055)}px "Arial Black", sans-serif`
  ctx.textBaseline = 'top'
  ctx.fillText('Ponygogogo', W * 0.06, H * 0.06)
  ctx.font = `600 ${Math.round(W * 0.021)}px sans-serif`
  ctx.fillStyle = '#8a5a3a'
  ctx.fillText('Run · Collect · Play', W * 0.06, H * 0.06 + W * 0.062)

  // 小马
  try {
    const pony = await loadImage(svgToDataUrl(ponyFullSvg(prof)))
    const pw = W * 0.3
    ctx.drawImage(pony, W * 0.05, H * 0.46, pw, pw * 0.75)
  } catch {
    ctx.fillStyle = hexCss(prof.body)
    ctx.fillRect(W * 0.06, H * 0.5, W * 0.2, H * 0.12)
  }

  // 名次
  ctx.fillStyle = result.rank === 1 ? '#d98f12' : '#57250c'
  ctx.font = `900 ${Math.round(W * 0.16)}px "Arial Black", sans-serif`
  ctx.fillText(`#${result.rank}`, W * 0.42, H * 0.17)
  ctx.fillStyle = '#57250c'
  ctx.font = `800 ${Math.round(W * 0.03)}px sans-serif`
  ctx.fillText(prof.name, W * 0.42, H * 0.17 + W * 0.17)
  ctx.font = `600 ${Math.round(W * 0.022)}px sans-serif`
  ctx.fillStyle = '#7a5236'
  ctx.fillText(
    `${(result.finishTick / SIM_HZ).toFixed(2)}s · ${stake} MON → ${payout} MON`,
    W * 0.42,
    H * 0.17 + W * 0.21,
  )

  // 三张牌
  const cardW = W * 0.15
  const cardH = cardW * 1.13
  const baseY = format === 'ig' ? H * 0.74 : H * 0.6
  for (let i = 0; i < result.choices.length; i++) {
    const c = result.choices[i]!
    const x = W * 0.42 + i * (cardW + W * 0.02)
    ctx.fillStyle = 'rgba(255,248,238,0.92)'
    roundRect(ctx, x, baseY, cardW, cardH, 14)
    ctx.fill()
    ctx.strokeStyle = c.cardId && CARD_BY_ID[c.cardId]?.quality === 'rare' ? '#f4a22a' : '#a3714c'
    ctx.lineWidth = 5
    ctx.stroke()
    const def = c.cardId ? CARD_BY_ID[c.cardId] : null
    if (def) {
      try {
        const icon = await loadImage(`/assets/placeholder/icons/${def.art.icon}.png`)
        ctx.drawImage(icon, x + cardW * 0.18, baseY + cardH * 0.1, cardW * 0.64, cardW * 0.64)
      } catch {
        /* 图标缺失降级为纯文字 */
      }
      ctx.fillStyle = '#5b2d10'
      ctx.font = `800 ${Math.round(cardW * 0.13)}px sans-serif`
      ctx.textAlign = 'center'
      const name = def.name[lang]
      ctx.fillText(name.slice(0, 7), x + cardW / 2, baseY + cardH * 0.78, cardW * 0.9)
      ctx.textAlign = 'left'
    } else {
      ctx.fillStyle = '#9b7a5f'
      ctx.font = `700 ${Math.round(cardW * 0.14)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText('—', x + cardW / 2, baseY + cardH * 0.42)
      ctx.textAlign = 'left'
    }
  }

  // 页脚：seed 前若干位，便于复现同一副牌堆
  ctx.fillStyle = '#7a5236'
  ctx.font = `600 ${Math.round(W * 0.016)}px monospace`
  ctx.fillText(`seed ${result.seed.slice(0, 12)}…  race ${result.raceId}`, W * 0.06, H * 0.93)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  })
}

export interface ShareCaps {
  canShareFiles: boolean
}

export function shareCaps(blob?: Blob): ShareCaps {
  if (typeof navigator === 'undefined' || !navigator.canShare) return { canShareFiles: false }
  try {
    const f = new File([blob ?? new Blob()], 'poster.png', { type: 'image/png' })
    return { canShareFiles: navigator.canShare({ files: [f] }) }
  } catch {
    return { canShareFiles: false }
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export async function sharePoster(blob: Blob, text: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], 'ponygogogo.png', { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text })
      return 'shared'
    } catch {
      /* 用户取消或不支持，降级为下载 */
    }
  }
  downloadBlob(blob, 'ponygogogo.png')
  return 'downloaded'
}
