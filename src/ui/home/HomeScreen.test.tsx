import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { HomeScreen } from './HomeScreen.tsx'

const baseProps = {
  lang: 'zh' as const,
  account: null,
  gameAccount: null,
  balance: null,
  busy: null,
  error: null,
  onStart: () => {},
  onCollection: () => {},
  onSettings: () => {},
  onRegister: () => {},
  onLogin: () => {},
  onOpenWallet: () => {},
  onLogout: () => {},
  onDismissError: () => {},
}

describe('首页开发验收入口', () => {
  test('生产默认首页不渲染特效验收按钮', () => {
    const html = renderToStaticMarkup(<HomeScreen {...baseProps} />)
    expect(html).not.toContain('特效验收')
  })

  test('仅在显式提供开发入口时渲染按钮', () => {
    const html = renderToStaticMarkup(<HomeScreen {...baseProps} onOpenEffects={() => {}} />)
    expect(html).toContain('特效验收')
  })
})

test('home counts default common cards plus owned rare cards and distinguishes unread ownership', () => {
  const account = { label: 'collection', address: '0x1111111111111111111111111111111111111111' } as const
  const known = renderToStaticMarkup(<HomeScreen {...baseProps} account={account} ownedRareIds={['C-02', 'C-21']} />)
  expect(known).toContain('29 / 40')
  const unknown = renderToStaticMarkup(<HomeScreen {...baseProps} account={account} />)
  expect(unknown).toContain('— / 40')
})
