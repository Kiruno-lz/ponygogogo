/** 把五匹马的 SVG 拼成一张预览图，用于人工核对造型 */
import { writeFileSync } from 'node:fs'
import { HORSE_PROFILES } from '../src/game/horses.ts'
import { ponyFullSvg } from '../src/game/ponyArt.ts'

const parts = HORSE_PROFILES.map((p, i) => {
  const s = ponyFullSvg(p)
  const inner = s.slice(s.indexOf('>', s.indexOf('<svg')) + 1, s.lastIndexOf('</svg>'))
  return `<g transform="translate(${(i % 3) * 215} ${Math.floor(i / 3) * 165})">${inner}</g>`
}).join('')
const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 660 340" width="660" height="340"><rect width="660" height="340" fill="#b77249"/>${parts}</svg>`
writeFileSync(process.argv[2] ?? '/tmp/pg/ponies.svg', out)
