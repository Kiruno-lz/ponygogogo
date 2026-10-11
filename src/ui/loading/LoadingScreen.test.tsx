import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LoadingScreen } from './LoadingScreen.tsx'

const progress = { done: 1, total: 1, current: null, failures: [] }
const noop = () => {}

test('English entry button renders its label once', () => {
  const html = renderToStaticMarkup(<LoadingScreen lang="en" progress={progress} ready onEnter={noop} onRetry={noop} />)
  expect(html).toContain('>Enter<')
  expect(html).not.toContain('>ENTER<')
})

test('Chinese entry button retains its English subtitle', () => {
  const html = renderToStaticMarkup(<LoadingScreen lang="zh" progress={progress} ready onEnter={noop} onRetry={noop} />)
  expect(html).toContain('>进入游戏<')
  expect(html).toContain('>ENTER<')
})
