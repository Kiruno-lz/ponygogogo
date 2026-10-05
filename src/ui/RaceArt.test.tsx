import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PONY_CATALOG } from '../game/ponyCatalog.ts'
import { PlayerPlaque } from './RaceArt.tsx'

test('every pony uses the same plaque art with a separate portrait below the foreground frame', () => {
  for (const pony of PONY_CATALOG) {
    const html = renderToStaticMarkup(<PlayerPlaque horseId={pony.ponyId}/>).replace(/<link[^>]*>/g, '')
    expect(html).not.toContain('avatar-source.webp')
    expect(html).toContain('avatar-reference-blank.webp')
    expect(html).toContain(`/ponies/${pony.ponyId}-${pony.ponyId === 1 || pony.ponyId >= 5 ? 'plaque-portrait' : 'portrait'}.webp`)
    expect(html.indexOf('plaque-pony')).toBeLessThan(html.indexOf('plaque-frame'))
    expect(html).toContain(`>${pony.name}</span>`)
    expect(html).not.toContain('source-name')
  }
})
