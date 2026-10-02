/** Code-native vector masters; regenerates the 19 runtime SVGs and their manifest entries. */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const out = resolve(import.meta.dir, '../public/assets')
const drawings = [
 ['All In', '<circle cx="42" cy="60" r="23" fill="#df7759"/><circle cx="42" cy="60" r="14"/><path d="M67 74V32m-12 13 12-13 12 13"/>'],
 ['Slack Then Sprint', '<path d="M24 38h22L24 58h22m6-35h22L52 43h22"/><path d="m60 55-14 23h14l-5 23 27-31H68l9-15Z" fill="#eab64a"/>'],
 ['Emergency Rations', '<path d="M31 33h38l9 51H22Z" fill="#d9b06a"/><path d="M36 33v-9h28v9M50 44v29m-12-15h24"/>'],
 ['Economy Mode', '<path d="M28 72C17 42 37 22 78 25c2 39-18 60-44 48Z" fill="#84b77f"/><path d="m26 82 39-39m-21 21V45m9 10h19"/>'],
 ['Rage Engine', '<path d="M27 43h42v35H27Zm-9 10H9v17h9m51-17h13v17H69M37 43V31h22v12" fill="#b1b8be"/><path d="m50 49-9 15h12l-5 17 17-21H53l8-11Z" fill="#ed9161"/>'],
 ['Paper Plane', '<path d="m13 45 74-23-26 62-15-24Z" fill="#c1dfeb"/><path d="m46 60 41-38-28 43-5 20-8-25"/>'],
 ['Grounded', '<path d="M34 22h26v37l21 9v14H24V69h10Z" fill="#b48765"/><path d="M14 90h72m-10 8h-9m-36 0h-9"/>'],
 ['Coat of Many Colors', '<path d="M23 27h54v55H23ZM34 82v12m32-12v12" fill="#a39783"/><circle cx="50" cy="40" r="8" fill="#e5bb4c"/><circle cx="50" cy="59" r="8" fill="#76af7b"/><path d="M15 20 7 13m78 7 8-7"/>'],
 ['Scrap Collector', '<path d="M27 41h46l-6 43H33ZM22 34h56m-35 0v-9h14v9" fill="#9eada2"/><path d="m40 50 24 24m-24 0 24-24m-31 4-8 8"/>'],
 ['Master Mechanic', '<path d="m30 20 5 15-11 8-14-4c-2 14 9 27 25 24l28 28 17-17-28-28c3-15-9-28-22-26Z" fill="#b2b6c6"/><circle cx="68" cy="78" r="4"/>'],
 ['Refurbish', '<path d="M24 38a30 30 0 0 1 54 4m0 0-2-20m2 20-19-3M78 70a30 30 0 0 1-53-7m0 0-1 20m1-20 20 2"/><circle cx="50" cy="54" r="15" fill="#a9bcb2"/><path d="M50 45v18m-9-9h18"/>'],
 ['Empty Hands', '<path d="M25 46v-8q0-12 10-8 0-15 10-10 8-10 14 3 11-3 11 9v18q13-9 16 2L69 80H37L25 62Z" fill="#e0b196"/><path d="M35 30v23m10-30v27m14-27v27M37 80v10h32V80"/>'],
 ['Cheap Shot', '<path d="m30 22 20 21 20-21m-20 21v46"/><path d="m30 22 40 0-10 30" stroke="#bf7255"/><circle cx="62" cy="59" r="10" fill="#96aab1"/>'],
 ['On a Roll', '<path d="M31 25h38v24q0 25-19 25T31 49ZM31 31H17v12q0 17 18 16m34-28h14v12q0 17-18 16M50 74v13m-17 5h34" fill="#e5b953"/><path d="m43 46 6 6 11-14"/>'],
 ['Bountiful Harvest', '<path d="M50 89V27m-3 21Q24 48 25 30q20 0 22 18Zm6 10q23 0 22-18-20 0-22 18Zm-6 12Q24 70 25 52q20 0 22 18Zm6 9q23 0 22-18-20 0-22 18Z" fill="#d7b958"/><path d="m43 27 7-14 7 14"/>'],
 ['Last Stand', '<path d="m30 81 42-56 9-7-1 14-40 57Z" fill="#c5d3dc"/><path d="m20 84 11 8 9-12-11-8Zm2-17 29 22" fill="#af7f61"/><path d="m61 59 24 5-6 23-15 10-12-13 3-23Z" fill="#c2a961"/>'],
 ['Second Wind', '<path d="M50 80 22 53q-15-23 4-29 15-3 24 12 9-15 24-12 19 6 4 29Z" fill="#d48070"/><path d="m53 37-15 22h15l-6 21 24-29H56l10-14" fill="#e7bb55"/>'],
 ['Wise Retreat', '<path d="M17 24v67m66-67v67M17 40q33 66 66 0"/><path d="M25 57q24 12 46-2-1 28-22 28T25 57Z" fill="#7eafb5"/><path d="M34 34h15L34 48h15m7-24h15L56 38h15"/>'],
 ['Stairway to Glory', '<path d="M13 88h21V69h21V50h21V31h12"/><path d="m63 25-3-17 12 8 8-11 8 11 10-8-2 17Z" fill="#e5b953"/><path d="M22 79h7m14-19h7m14-19h7"/>'],
] as const
mkdirSync(resolve(out, 'cards'), { recursive: true })
const manifestFile = resolve(out, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
for (let i = 0; i < drawings.length; i++) {
 const [title, drawing] = drawings[i]!, id = i + 22
 const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 110"><title>${title}</title><g stroke="#573c2e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none">${drawing}</g></svg>\n`
 const path = `assets/cards/card-${id}.svg`
 writeFileSync(resolve(out, `cards/card-${id}.svg`), svg)
 manifest[`cards.card-${id}`] = { kind: 'image', path, bytes: Buffer.byteLength(svg), sha256: createHash('sha256').update(svg).digest('hex').slice(0,16), tier: 'race' }
}
writeFileSync(manifestFile, JSON.stringify(Object.fromEntries(Object.entries(manifest).sort(([a],[b]) => a.localeCompare(b))), null, 2) + '\n')
console.log(`19 card icons generated`)
