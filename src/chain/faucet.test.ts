/**
 * L1：水龙头请求的构造与失败分类。注入 fetch，不打真实网络。
 * 这里唯一要守住的契约是**永不抛错**——领水失败不能把注册流程一起拖垮。
 */
import { describe, expect, test } from 'bun:test'
import { claimFaucet } from './faucet.ts'
import { CHAIN, FAUCET_URL } from './network.ts'

const ADDRESS = '0xF9297b542BDb5DA50C364f9AE4Cbe1F3933bA40F'

function recordingFetch(response: Response | Error) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    if (response instanceof Error) throw response
    return response
  }) as unknown as typeof fetch
  return { calls, impl }
}

describe('水龙头', () => {
  test('按 scripts/get_faucet.sh 的形状发请求：同端点、同 chainId、JSON body', async () => {
    const { calls, impl } = recordingFetch(new Response('queued', { status: 200 }))
    const r = await claimFaucet(ADDRESS, { fetchImpl: impl })
    expect(r.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(FAUCET_URL)
    expect(calls[0]!.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ chainId: CHAIN.id, address: ADDRESS })
  })

  test('地址不合法就不发请求', async () => {
    const { calls, impl } = recordingFetch(new Response('', { status: 200 }))
    const r = await claimFaucet('not-an-address', { fetchImpl: impl })
    expect(r).toEqual({ ok: false, code: 'invalid-address', detail: 'not-an-address' })
    expect(calls).toHaveLength(0)
  })

  test('非 2xx 归类为 rejected，并带回服务端说法', async () => {
    const { impl } = recordingFetch(new Response('rate limited', { status: 429 }))
    const r = await claimFaucet(ADDRESS, { fetchImpl: impl })
    expect(r).toEqual({ ok: false, code: 'rejected', detail: 'rate limited' })
  })

  test('网络异常归类为 network，而不是抛出去', async () => {
    const { impl } = recordingFetch(new TypeError('Failed to fetch'))
    const r = await claimFaucet(ADDRESS, { fetchImpl: impl })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe('network')
  })

  test('服务端返回空 body 时仍给出可读的失败说明', async () => {
    const { impl } = recordingFetch(new Response('', { status: 500 }))
    const r = await claimFaucet(ADDRESS, { fetchImpl: impl })
    expect(r).toEqual({ ok: false, code: 'rejected', detail: 'HTTP 500' })
  })
})
