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
  onToggleLang: () => {},
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
