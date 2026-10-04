import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CollectionScreen } from './CollectionScreen.tsx'

test('collection includes a pony subpage with defaults, owned roles, locked roles and exact ability costs', () => {
  const props = { lang: 'zh' as const, onBack: () => {}, signedIn: true, ownedRareIds: ['C-02'], ownedPonyIds: [5, 8] }
  const html = renderToStaticMarkup(<CollectionScreen {...props}/>)
  expect(html).toContain('role="tab"')
  expect(html).toContain('>小马</button>')
  expect(html).toContain('data-pony="5" data-owned="true"')
  expect(html).toContain('data-pony="6" data-owned="false"')
  expect(html).toContain('有牛劲')
  expect(html).toContain('+20%')
  expect(html).toContain('+100')
  expect(html).toContain('重复节奏')
})

test('unread pony progress is labelled unknown rather than permanently locked', () => {
  const html = renderToStaticMarkup(<CollectionScreen lang="en" onBack={() => {}} />)
  expect(html).toContain('Progress not loaded')
  expect(html).toContain('Nailong')
})
