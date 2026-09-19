/**
 * 规范域名守卫。判断错一次的代价是玩家在错域名下注册出另一个钱包地址，
 * 而那把通行密钥事后搬不过来，所以这里把各类 host 穷举掉。
 */
import { describe, expect, test } from 'bun:test'
import { canonicalRedirect } from './canonicalHost.ts'

const CANON = 'ponygo.kiruno.cc'
const at = (hostname: string, pathname = '/', search = '', hash = '') =>
  canonicalRedirect({ hostname, pathname, search, hash }, CANON)

describe('留在原地', () => {
  test('已经在规范域名上', () => {
    expect(at(CANON)).toBeNull()
  })

  test('本机与回环', () => {
    for (const h of ['localhost', '127.0.0.1', '::1', '0.0.0.0', 'app.localhost']) {
      expect(at(h), h).toBeNull()
    }
  })

  test('局域网真机试玩用的私有网段与 .local', () => {
    for (const h of ['192.168.1.5', '10.0.0.7', '172.16.0.1', '172.31.255.254', 'kiruno-mac.local']) {
      expect(at(h), h).toBeNull()
    }
  })

  test('没配规范域名就什么都不做——本地与自建部署不该被写死的域名绑架', () => {
    expect(canonicalRedirect({ hostname: 'example.com', pathname: '/', search: '', hash: '' }, '')).toBeNull()
  })
})

describe('弹回规范域名', () => {
  test('Pages 的生产子域', () => {
    expect(at('ponygogogo.pages.dev')).toBe(`https://${CANON}/`)
  })

  test('Pages 的预览子域——每个分支一个 host，同样会铸出新账户', () => {
    expect(at('a1b2c3d4.ponygogogo.pages.dev')).toBe(`https://${CANON}/`)
  })

  test('任何别的域名，包括以后误挂上来的第二个自定义域', () => {
    expect(at('pony.example.com')).toBe(`https://${CANON}/`)
  })

  test('172.16/12 之外的 172 段是公网地址，不算开发主机', () => {
    expect(at('172.15.0.1')).toBe(`https://${CANON}/`)
    expect(at('172.32.0.1')).toBe(`https://${CANON}/`)
  })

  test('路径、查询串与片段原样带过去', () => {
    expect(at('ponygogogo.pages.dev', '/', '?mockDelay=0&raceSpeed=16', '#x')).toBe(
      `https://${CANON}/?mockDelay=0&raceSpeed=16#x`,
    )
  })
})
