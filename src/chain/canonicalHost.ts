/**
 * 规范域名守卫。
 *
 * 账户由 WebAuthn PRF 派生，而 PRF 的输入含 rpId，rpId 又取自 `location.hostname`
 * （见 network.ts 的 defaultRpId）。**同一个人在两个域名下注册，拿到的是两个不同的钱包地址。**
 * 这不是缓存问题，事后加重定向也救不回来——那一把通行密钥永远绑在它被创建的那个域名上，
 * 只能靠助记词重新导入。
 *
 * 托管平台那侧能不能把别的入口挡掉，是部署配置的事，会变、也会被忘。这段守卫跟着代码走：
 * 只要页面跑起来，域名不对就先跳走，界面根本没有机会让人在错误的域名下注册。
 *
 * 开发与测试的主机一律放行：本机跑的是另一套 rpId，不参与线上账户。
 */

/** 构建期注入。没配就不做任何跳转——本地与自建部署不该被一个写死的域名绑架 */
export const CANONICAL_HOST: string =
  (import.meta.env?.VITE_CANONICAL_HOST as string | undefined) ?? 'ponygo.kiruno.cc'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

/** 私有网段与 .local：局域网上用真机试玩时走的就是这些，不能弹走 */
function isDevHost(host: string): boolean {
  if (LOCAL_HOSTS.has(host)) return true
  if (host.endsWith('.localhost') || host.endsWith('.local')) return true
  return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
}

/**
 * 该不该跳，以及跳去哪。返回 null 表示留在原地。
 * 抽成纯函数是为了能在 L1 里穷举各种 host，而不是把判断埋在副作用里。
 */
export function canonicalRedirect(
  current: { hostname: string; pathname: string; search: string; hash: string },
  canonical: string = CANONICAL_HOST,
): string | null {
  if (!canonical) return null
  if (current.hostname === canonical) return null
  if (isDevHost(current.hostname)) return null
  return `https://${canonical}${current.pathname}${current.search}${current.hash}`
}

/**
 * 在挂载 React 之前调用。用 replace 而不是 assign：
 * 被弹走的那个域名不该留在历史里，否则返回键会把人送回去再弹一次。
 */
export function enforceCanonicalHost(): void {
  if (typeof location === 'undefined') return
  const to = canonicalRedirect(location)
  if (to) location.replace(to)
}
