/** Compose a result poster from blank artwork and authoritative settlement data. */
import { formatMon } from '../chain/amount.ts'
import { PONY_CATALOG, ponyById, ponyIdAt } from '../game/ponyCatalog.ts'
import type { RaceResult } from '../race/core/types.ts'
import type { PaidResultView } from '../result/ResultScreen.tsx'
import { t, type Lang } from '../ui/i18n.ts'

export function posterContent(result: RaceResult, paid: PaidResultView | undefined, lang: Lang) {
  const ponyId = ponyIdAt(result.roster, result.horseId)
  const rank = paid?.settlement?.rank ?? paid?.previewRank ?? result.rank
  const payout = paid?.settlement?.payout ?? (paid?.phase === 'forfeited' ? 0n : null)
  const net = payout !== null && paid ? payout - paid.stake : null
  const amount = !paid ? t(lang, 'result.practice') : net === null ? t(lang, 'result.pendingValue')
    : `${net > 0n ? '+' : ''}${formatMon(net, 4).replace(/\.?0+$/, '')} MON`
  const status = !paid ? t(lang, 'result.practiceValue') : `${t(lang, `result.stamp.${paid.phase}`)} · ${paid.settlement ? t(lang, 'result.chainRank', { rank }) : t(lang, 'result.previewRank', { rank })}`
  return { horseId: result.horseId, ponyId, rank, amount, status, name: ponyById(ponyId).name,
    headline: rank === 1 && (!paid || (net !== null && net > 0n)) ? 'WIN' : 'FINISH' }
}

export const POSTER = { width: 1620, height: 971, qr: { x: 220, y: 594, size: 220, angle: -0.04 } } as const

export const HORSE_FOOTINGS = PONY_CATALOG.map(pony => pony.renderSpec.posterFootings)

export function horseTransform(horseId: number): [number, number, number, number, number, number] {
  const spec = ponyById(horseId).renderSpec
  const { rear, front } = spec.posterFootings
  const span = front[0] - rear[0]
  const scale = spec.posterScale ?? 350 / span
  const targetX = spec.posterScale ? 505 - span * scale / 2 : 330
  const targetY = 545 + (targetX - 330) * 31 / 350
  const slope = (span * scale * 31 / 350 - scale * (front[1] - rear[1])) / span
  return [scale, slope, 0, scale, targetX - scale * rear[0], targetY - slope * rear[0] - scale * rear[1]]
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = src
  await img.decode()
  return img
}

export async function drawPoster(content: ReturnType<typeof posterContent>): Promise<Blob> {
  await document.fonts.load('700 40px Kalam')
  const [background, hero, medal, qr, headline, prizeGroup] = await Promise.all([
    loadImage('/assets/art/share/background.webp'),
    loadImage(`/assets/art/share/horse-${content.ponyId}.webp`),
    loadImage(`/assets/art/result/medal-${content.rank}.webp`),
    loadImage('/assets/art/share/qr.png'),
    loadImage(`/assets/art/share/${content.headline.toLowerCase()}.webp`),
    loadImage('/assets/art/share/prize-group.webp'),
  ])
  const canvas = document.createElement('canvas')
  canvas.width = POSTER.width; canvas.height = POSTER.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(background, 0, 0, POSTER.width, POSTER.height)
  // Sign, coin and the social captions move as one registered artwork layer.
  ctx.save()
  ctx.translate(0, 20)
  ctx.drawImage(prizeGroup, 0, 0, POSTER.width, POSTER.height)
  ctx.restore()
  // Dedicated overlays include perspective-correct hooves and contact shadows.
  ctx.save()
  ctx.transform(...horseTransform(content.ponyId))
  ctx.drawImage(hero, 0, 0)
  ctx.restore()
  ctx.drawImage(medal, 492, 548, 255, 255 * medal.height / medal.width)
  if (content.headline === 'WIN') {
    ctx.save()
    // Preserve the reference's brush texture; exclude the extracted underline.
    ctx.beginPath()
    ctx.moveTo(850, 65); ctx.lineTo(1450, 65); ctx.lineTo(1450, 300)
    ctx.lineTo(1100, 300); ctx.lineTo(1100, 385); ctx.lineTo(850, 385)
    ctx.closePath(); ctx.clip()
    ctx.drawImage(headline, 699, 124, 914, 532, 850, 65, 600, 320)
    ctx.restore()
  } else {
    // Clear of the crown above and the white promotional lettering below/right.
    const height = 470 * 628 / 2097
    ctx.save()
    ctx.translate(1125, 145 + height / 2); ctx.rotate(-0.14)
    ctx.drawImage(headline, 25, 32, 2097, 628, -235, -height / 2, 470, height)
    ctx.restore()
  }
  ctx.save()
  ctx.translate(1250, 555); ctx.rotate(-0.12)
  ctx.fillStyle = '#3e220d'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.font = '700 42px Kalam'
  const amountSize = Math.min(42, 42 * 250 / ctx.measureText(content.amount).width)
  ctx.font = `700 ${amountSize}px Kalam`
  ctx.fillText(content.amount, -8, -13)
  ctx.font = '700 26px Kalam'; ctx.fillText(`Great Run, ${content.name}!`, -30, 47, 320)
  ctx.restore()
  // The alpha PNG retains the original QR pattern and follows the parchment's tilt.
  ctx.save()
  ctx.translate(POSTER.qr.x + POSTER.qr.size / 2, POSTER.qr.y + POSTER.qr.size / 2)
  ctx.rotate(POSTER.qr.angle)
  ctx.imageSmoothingEnabled = false
  const qrScale = POSTER.qr.size / Math.max(qr.width, qr.height)
  ctx.drawImage(qr, -qr.width * qrScale / 2, -qr.height * qrScale / 2, qr.width * qrScale, qr.height * qrScale)
  ctx.restore()
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Poster export failed')), 'image/png'))
}

export function copyPoster(blob: Blob): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return Promise.reject(new Error('Clipboard unavailable'))
  // Invoke write immediately in the click's user activation, including Safari.
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

export function downloadBlob(blob: Blob, filename = 'ponygogogo.png'): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function platformUrl(platform: 'x' | 'instagram' | 'xiaohongshu', text: string): string {
  if (platform === 'x') return `https://x.com/intent/post?${new URLSearchParams({ text })}`
  if (platform === 'instagram') return 'https://www.instagram.com/'
  return 'https://www.xiaohongshu.com/'
}
