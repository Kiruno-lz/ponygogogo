import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CollectionScreen } from './CollectionScreen.tsx'
import { ponyAbilityText } from '../shared/ponyAbilityText.ts'

test('collection includes default, collected and locked ponies with current authored ability copy', () => {
  const props = { lang: 'zh' as const, onBack: () => {}, signedIn: true, ownedRareIds: ['C-02'], ownedPonyIds: [5, 8] }
  const html = renderToStaticMarkup(<CollectionScreen {...props}/>)
  expect(html).toContain('role="tab"')
  expect(html).toContain('>小马</button>')
  expect(html).toContain('data-pony="5" data-owned="true"')
  expect(html).toContain('data-pony="6" data-owned="false"')
  for (let pony = 0; pony < 9; pony++) expect(html).toContain(ponyAbilityText(pony, 'zh').description)
  expect(html).not.toContain('<h3')
})

test('unread pony progress is labelled unknown rather than permanently locked', () => {
  const html = renderToStaticMarkup(<CollectionScreen lang="en" onBack={() => {}} />)
  expect(html).toContain('Progress not loaded')
  expect(html).toContain('Nailong')
})

test('card collection removes the old meme-source and CPU footer rows', () => {
  const html = renderToStaticMarkup(<CollectionScreen lang="zh" onBack={() => {}} ownedRareIds={['C-02']} />)
  expect(html).not.toContain('梗源')
  expect(html).not.toContain('电脑马可用')
  expect(html).not.toContain('仅玩家')
})
