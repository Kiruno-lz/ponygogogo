/**
 * 测试币水龙头。与 scripts/get_faucet.sh 发的是同一个请求（同端点、同 chainId、同 body），
 * 那个脚本是命令行孪生体，浏览器里跑不了 shell，所以这里重发一遍同样的 HTTP 调用。
 *
 * **永不抛错**：领水失败不能把注册流程一起拖垮，调用方按 ok 决定怎么提示。
 */
import { CHAIN, FAUCET_URL } from './network.ts'

export type FaucetResult =
  | { ok: true; detail: string }
  | { ok: false; code: 'invalid-address' | 'rejected' | 'network'; detail: string }

export type FaucetDeps = {
  fetchImpl?: typeof fetch
  url?: string
  chainId?: number
  /** 超时，毫秒 */
  timeoutMs?: number
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

export async function claimFaucet(address: string, deps: FaucetDeps = {}): Promise<FaucetResult> {
  if (!ADDRESS_RE.test(address)) {
    return { ok: false, code: 'invalid-address', detail: address }
  }
  const doFetch = deps.fetchImpl ?? globalThis.fetch
  const url = deps.url ?? FAUCET_URL
  const chainId = deps.chainId ?? CHAIN.id
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 30_000)
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chainId, address }),
      signal: controller.signal,
    })
    const detail = (await res.text().catch(() => '')).slice(0, 400)
    if (!res.ok) return { ok: false, code: 'rejected', detail: detail || `HTTP ${res.status}` }
    return { ok: true, detail }
  } catch (err) {
    return { ok: false, code: 'network', detail: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}
