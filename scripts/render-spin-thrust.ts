/** Bake the approved imagegen material onto 16 exact helix phases using Canvas meshes. */
import { chromium } from '@playwright/test'
import { SPIN_THRUST_ART } from './spin-thrust-motion.ts'

const art = new URL('../art-src/art/effects/', import.meta.url)
const build = await Bun.build({ entrypoints: [new URL('./spin-thrust-draw.ts', import.meta.url).pathname],
  target: 'browser', format: 'iife' })
if (!build.success) throw new Error(build.logs.join('\n'))
const ribbon = Buffer.from(await Bun.file(new URL('spin-thrust-ribbon-material.png', art)).arrayBuffer())
const reference = Buffer.from(await Bun.file(new URL('spin-thrust-reference.png', art)).arrayBuffer())
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({ content: await build.outputs[0]!.text() })
  const output = await page.evaluate(async ({ ribbon, reference }) =>
    (window as any).renderSpinThrust(ribbon, reference), {
    ribbon: `data:image/png;base64,${ribbon.toString('base64')}`,
    reference: `data:image/png;base64,${reference.toString('base64')}`,
  })
  await Bun.write(new URL('spin-thrust-source.png', art), Buffer.from(output.split(',')[1], 'base64'))
  await Bun.write(new URL('spin-thrust-motion-metadata.json', art), JSON.stringify({
    ...SPIN_THRUST_ART, sourceScale: 2, direction: 'nose-to-tail',
    phases: Array.from({ length: 16 }, (_, i) => i * 22.5),
    method: 'fixed-axis textured double helix; phase increases, crests travel left; tapered birth and tail fade',
    material: 'spin-thrust-ribbon-material.png', reference: 'spin-thrust-reference.png',
    author: ['scripts/spin-thrust-motion.ts', 'scripts/spin-thrust-draw.ts'],
  }, null, 2) + '\n')
  console.log('Saved art-src/art/effects/spin-thrust-source.png: 2304×1536 RGBA, 16 exact rotation phases')
} finally {
  await browser.close()
}
