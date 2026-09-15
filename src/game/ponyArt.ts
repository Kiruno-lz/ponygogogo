/**
 * 小马造型。唯一一份美术定义，菜单（DOM/SVG）与赛道（Phaser 贴图）共用。
 * 造型对齐 assrt/pony classic.png 的侧面站立稿：圆钝身体、方腿、锯齿鬃毛、大眼睛。
 */
import { hexCss, type HorseProfile } from './horses.ts'

const OUTLINE = '#2a1a10'
const SW = 3.2

export const PONY_VIEW = { w: 200, h: 150 }
export const LEG_VIEW = { w: 24, h: 60 }
export const TAIL_VIEW = { w: 64, h: 76 }

/** 栅格化倍率：SVG 的 width/height 放大 N 倍，viewBox 不变，得到高分辨率贴图 */
export const RASTER = 2

function svg(viewW: number, viewH: number, body: string, raster = 1): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewW} ${viewH}" width="${viewW * raster}" height="${viewH * raster}">${body}</svg>`
}

/** 身体 + 颈 + 头 + 鬃毛 + 眼睛（不含腿与尾，它们要单独动） */
export function ponyBodySvg(p: HorseProfile, raster = 1): string {
  const body = hexCss(p.body)
  const shade = hexCss(p.bodyShade)
  const mane = hexCss(p.mane)
  const maneShade = hexCss(p.maneShade)
  return svg(
    PONY_VIEW.w,
    PONY_VIEW.h,
    `
<g stroke="${OUTLINE}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round">
  <path d="M100 74 L128 68 L164 34 L140 16 L112 46 Z" fill="${body}"/>
  <rect x="24" y="44" width="108" height="60" rx="30" fill="${body}"/>
  <path d="M34 86 Q 78 110 124 86 L124 96 Q 78 118 34 96 Z" fill="${shade}" stroke="none" opacity="0.5"/>
  <path d="M136 6 L148 1 L142 15 L155 12 L141 29 L153 30 L130 47 L142 51 L112 70 L94 63
           L108 45 L120 27 L130 12 Z" fill="${mane}"/>
  <path d="M148 1 L142 15 L155 12 L146 24 L132 27 L134 9 Z" fill="${maneShade}" stroke="none" opacity="0.55"/>
  <path d="M145 12 L149 -1 L162 11 Z" fill="${body}"/>
  <rect x="136" y="8" width="58" height="44" rx="19" fill="${body}"/>
  <path d="M168 24 q 28 0 28 14 q 0 14 -28 14 z" fill="${shade}"/>
  <circle cx="164" cy="27" r="8.5" fill="#ffffff"/>
  <circle cx="166.5" cy="29" r="4.8" fill="#201510" stroke="none"/>
  <circle cx="163" cy="24" r="2" fill="#ffffff" stroke="none"/>
  <circle cx="187" cy="32" r="2.6" fill="${OUTLINE}" stroke="none"/>
  <path d="M179 44 L192 44" fill="none" opacity="0.7"/>
</g>`,
    raster,
  )
}

/** 尾巴，锚点在右上角（尾根） */
export function ponyTailSvg(p: HorseProfile, raster = 1): string {
  const mane = hexCss(p.mane)
  const shade = hexCss(p.maneShade)
  return svg(
    TAIL_VIEW.w,
    TAIL_VIEW.h,
    `
<g stroke="${OUTLINE}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round">
  <path d="M58 6 C36 4 18 18 10 40 C4 56 3 66 6 70 L20 62
           C17 44 24 28 40 20 L30 44 L34 68 L46 48
           L46 66 L56 44 Z" fill="${mane}"/>
  <path d="M58 6 C44 6 32 12 24 22 L40 20 Z" fill="${shade}" stroke="none" opacity="0.5"/>
</g>`,
    raster,
  )
}

/** 一条腿，旋转锚点在顶部中心 */
export function ponyLegSvg(p: HorseProfile, raster = 1): string {
  const body = hexCss(p.body)
  const hoof = hexCss(p.hoof)
  return svg(
    LEG_VIEW.w,
    LEG_VIEW.h,
    `
<g stroke="${OUTLINE}" stroke-width="${SW}" stroke-linejoin="round">
  <rect x="2.5" y="2" width="19" height="48" rx="8" fill="${body}"/>
  <rect x="0.6" y="41" width="22.8" height="18" rx="7" fill="${hoof}"/>
</g>`,
    raster,
  )
}

/** 菜单用的完整站立小马（含四腿与尾巴），直接内联进 DOM */
export function ponyFullSvg(p: HorseProfile): string {
  const body = hexCss(p.body)
  const shade = hexCss(p.bodyShade)
  const hoof = hexCss(p.hoof)
  const inner = ponyBodySvg(p)
  const bodyInner = inner.slice(inner.indexOf('>', inner.indexOf('<svg')) + 1, inner.lastIndexOf('</svg>'))
  const tail = ponyTailSvg(p)
  const tailInner = tail.slice(tail.indexOf('>', tail.indexOf('<svg')) + 1, tail.lastIndexOf('</svg>'))
  const leg = (x: number, dark: boolean): string =>
    `<g stroke="${OUTLINE}" stroke-width="${SW}" stroke-linejoin="round" transform="translate(${x} 90)">
       <rect x="0" y="0" width="19" height="48" rx="8" fill="${dark ? shade : body}"/>
       <rect x="-2" y="39" width="23" height="18" rx="7" fill="${hoof}"/>
     </g>`
  return svg(
    PONY_VIEW.w,
    PONY_VIEW.h,
    `${leg(36, true)}${leg(94, true)}
     <g transform="translate(-14 40)">${tailInner}</g>
     ${bodyInner}
     ${leg(52, false)}${leg(110, false)}`,
  )
}

/** 百分号编码，供 <img> / Canvas 使用 */
export function svgToDataUrl(source: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source)
}

/** base64 编码，Phaser 的 load.svg 对 data URL 走的是 atob 解码 */
export function svgToBase64Url(source: string): string {
  const b64 = typeof btoa === 'function' ? btoa(source) : Buffer.from(source, 'binary').toString('base64')
  return 'data:image/svg+xml;base64,' + b64
}
