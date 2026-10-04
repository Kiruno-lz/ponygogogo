/**
 * L1：战绩查询客户端。注入 fetch，不打真实网络。守住三条契约：未配置时明确返回 not-configured、
 * 从不抛错、只要一行不合规就整体拒收（读模型不能半真半假地展示）。
 */
import { describe, expect, test } from 'bun:test'
import type { Hex } from 'viem'
import { HISTORY_QUERY, fetchRecentSessions, parseGraphqlUrl, parseHistoryResponse } from './history.ts'
import { CHAIN } from './network.ts'

const URL_OK = 'https://indexer.dev.hyperindex.xyz/abc123/v1/graphql'
const PLAYER = '0x8F283d1Bb30c13c2cEeE1183a60e213940200e87'
const SESSION_SETTLED: Hex = `0x${'a1'.repeat(32)}`
const SESSION_FORFEITED: Hex = `0x${'b2'.repeat(32)}`
const SESSION_OPEN: Hex = `0x${'c3'.repeat(32)}`
const TX = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`

function settledRow() {
  return {
    id: SESSION_SETTLED,
    horseId: 2,
    stake: '300000000000000000', // 0.3 MON, tier 1
    state: 'SETTLED',
    openedAt: '1790571226',
    openedBlock: '66319820',
    openTx: TX(1),
    playerSettlementRank: 1,
    playerRawRank: 2,
    payout: '900000000000000000',
    net: '600000000000000000',
    forfeitReason: null,
    closedAt: '1790571400',
    closeTx: TX(2),
    choices: [
      { checkpoint: 3, cardId: 12, effective: false },
      { checkpoint: 1, cardId: 5, effective: true },
      { checkpoint: 2, cardId: 0, effective: true },
    ],
  }
}

function forfeitedRow() {
  return {
    ...settledRow(),
    id: SESSION_FORFEITED,
    state: 'FORFEITED',
    playerSettlementRank: null,
    playerRawRank: null,
    payout: '0',
    net: '-300000000000000000',
    forfeitReason: 1,
    choices: [{ checkpoint: 1, cardId: 9, effective: null }],
  }
}

function openRow() {
  return {
    ...settledRow(),
    id: SESSION_OPEN,
    state: 'OPEN',
    playerSettlementRank: null,
    playerRawRank: null,
    payout: null,
    net: null,
    closedAt: null,
    closeTx: null,
    choices: [],
  }
}

function body(rows: unknown[], meta: unknown = [{ chainId: CHAIN.id, progressBlock: 66394366, isReady: true }]) {
  return { data: { Session: rows, _meta: meta } }
}

function recordingFetch(respond: Response | Error | ((init: RequestInit) => Promise<Response>)) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    if (respond instanceof Error) throw respond
    if (typeof respond === 'function') return respond(init ?? {})
    return respond
  }) as unknown as typeof fetch
  return { calls, impl }
}

test('history preserves roster identity and rejects an invalid roster rather than displaying a partial list', () => {
  const roster = [8,7,5,6,0]
  const parsed = parseHistoryResponse(body([{ ...settledRow(), roster }]), CHAIN.id)
  expect(parsed.status).toBe('ok')
  if (parsed.status !== 'ok') throw new Error('missing history')
  expect(parsed.sessions[0]!.roster).toEqual(roster)
  for (const invalid of [[0,1,2,3,3], [0,1,2,3,9], [0,1,2,3]]) {
    expect(parseHistoryResponse(body([{ ...settledRow(), roster: invalid }]), CHAIN.id)).toMatchObject({ status: 'error', code: 'malformed' })
  }
})

test('an older indexer without the roster field remains readable through one explicit legacy query', async () => {
  const recorder = recordingFetch(async init => {
    const query = JSON.parse(String(init.body)).query as string
    return query.includes('roster') ? json({ errors: [{ message: 'Cannot query field "roster" on type "Session".' }] }) : json(body([settledRow()]))
  })
  expect(await fetchRecentSessions(PLAYER, { url: URL_OK, fetchImpl: recorder.impl })).toMatchObject({ status: 'ok' })
  expect(recorder.calls).toHaveLength(2)
})

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

describe('端点配置', () => {
  test('https 地址原样接受，http 只放行本机', () => {
    expect(parseGraphqlUrl(`  ${URL_OK} `)).toBe(URL_OK)
    expect(parseGraphqlUrl('http://localhost:8080/v1/graphql')).toBe('http://localhost:8080/v1/graphql')
    expect(parseGraphqlUrl('http://127.0.0.1:8080/v1/graphql')).toBe('http://127.0.0.1:8080/v1/graphql')
  })

  test('空值、非法值、明文远端与带凭据的地址都视为未配置', () => {
    for (const raw of [undefined, null, '', '   ', 'indexer', 'http://indexer.example/v1/graphql', 'ftp://x/y', 'https://u:p@x.example/v1/graphql']) {
      expect(parseGraphqlUrl(raw)).toBeNull()
    }
  })

  test('未配置时返回 not-configured，不发请求', async () => {
    const { calls, impl } = recordingFetch(json(body([])))
    expect(await fetchRecentSessions(PLAYER, { url: null, fetchImpl: impl })).toEqual({ status: 'not-configured' })
    expect(await fetchRecentSessions(PLAYER, { url: '', fetchImpl: impl })).toEqual({ status: 'not-configured' })
    expect(calls).toHaveLength(0)
  })
})

describe('请求', () => {
  test('POST 一条 GraphQL 查询，玩家地址转成校验和形式，条数夹在 1..50', async () => {
    const { calls, impl } = recordingFetch(json(body([])))
    await fetchRecentSessions(PLAYER.toLowerCase(), { url: URL_OK, fetchImpl: impl, limit: 500 })
    await fetchRecentSessions(PLAYER, { url: URL_OK, fetchImpl: impl, limit: 0 })
    expect(calls).toHaveLength(2)
    expect(calls[0]!.url).toBe(URL_OK)
    expect(calls[0]!.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ query: HISTORY_QUERY, variables: { player: PLAYER, limit: 50 } })
    expect(JSON.parse(String(calls[1]!.init.body)).variables.limit).toBe(1)
  })

  test('玩家地址不合法就不发请求', async () => {
    const { calls, impl } = recordingFetch(json(body([])))
    expect(await fetchRecentSessions('0x1234', { url: URL_OK, fetchImpl: impl })).toEqual({
      status: 'error',
      code: 'invalid-player',
      detail: '0x1234',
    })
    expect(calls).toHaveLength(0)
  })
})

describe('响应解析', () => {
  test('结算、判负与未完结三种会话解析成带 bigint 的记录，并标明来源与已索引块', async () => {
    const { impl } = recordingFetch(json(body([settledRow(), forfeitedRow(), openRow()])))
    const r = await fetchRecentSessions(PLAYER, { url: URL_OK, fetchImpl: impl })
    if (r.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`)
    expect(r.source).toBe('envio-read-model')
    expect(r.indexedBlock).toBe(66394366n)
    expect(r.ready).toBe(true)
    expect(r.sessions[0]).toEqual({
      sessionId: SESSION_SETTLED,
      horseId: 2,
      stake: 300_000_000_000_000_000n,
      state: 'settled',
      openedAt: 1790571226,
      openedBlock: 66319820n,
      openTx: TX(1),
      choices: [
        { checkpoint: 1, cardId: 5, effective: true },
        { checkpoint: 2, cardId: 0, effective: true },
        { checkpoint: 3, cardId: 12, effective: false },
      ],
      settlementRank: 1,
      rawRank: 2,
      payout: 900_000_000_000_000_000n,
      net: 600_000_000_000_000_000n,
      forfeitReason: null,
      closedAt: 1790571400,
      closeTx: TX(2),
    })
    expect(r.sessions[1]).toMatchObject({
      state: 'forfeited',
      payout: 0n,
      net: -300_000_000_000_000_000n,
      forfeitReason: 'anchor-lost',
      choices: [{ checkpoint: 1, cardId: 9, effective: null }],
    })
    expect(r.sessions[2]).toMatchObject({ state: 'open', payout: null, net: null, closedAt: null, closeTx: null, choices: [] })
  })

  test('判负原因 2 与未知原因分开', () => {
    const owner = parseHistoryResponse(body([{ ...forfeitedRow(), forfeitReason: 2 }]), CHAIN.id)
    const odd = parseHistoryResponse(body([{ ...forfeitedRow(), forfeitReason: 9 }]), CHAIN.id)
    expect(owner.status === 'ok' && owner.sessions[0]!.forfeitReason).toBe('solver-fault')
    expect(odd.status === 'ok' && odd.sessions[0]!.forfeitReason).toBe('unknown')
  })

  test('没有本链的 _meta 时已索引块为 null、未就绪', () => {
    for (const meta of [undefined, [], [{ chainId: 1, progressBlock: 5, isReady: true }]]) {
      const r = parseHistoryResponse({ data: { Session: [], _meta: meta } }, CHAIN.id)
      expect(r).toEqual({ status: 'ok', source: 'envio-read-model', sessions: [], indexedBlock: null, ready: false })
    }
  })

  test('任何一行不合规都整体拒收为 malformed', () => {
    const broken: Array<[string, unknown]> = [
      ['state', { ...settledRow(), state: 'REFUNDED' }],
      ['id', { ...settledRow(), id: '0x1234' }],
      ['horseId', { ...settledRow(), horseId: 7 }],
      ['stake', { ...settledRow(), stake: '1.5' }],
      ['stake', { ...settledRow(), stake: 5e17 }],
      ['openTx', { ...settledRow(), openTx: null }],
      ['payout', { ...settledRow(), payout: 'lots' }],
      ['settled session without settlement fields', { ...settledRow(), payout: null }],
      ['forfeited session without payout 0', { ...forfeitedRow(), payout: '1' }],
      ['open session with closing fields', { ...openRow(), payout: '0' }],
      ['choices', { ...settledRow(), choices: null }],
      ['choice.checkpoint', { ...settledRow(), choices: [{ checkpoint: 4, cardId: 1, effective: null }] }],
      ['choice.effective', { ...settledRow(), choices: [{ checkpoint: 1, cardId: 1, effective: 'yes' }] }],
    ]
    for (const [field, row] of broken) {
      const r = parseHistoryResponse(body([settledRow(), row]), CHAIN.id)
      expect(r).toEqual({ status: 'error', code: 'malformed', detail: `Session[1]: ${field}` })
    }
    for (const bad of [null, 'text', [], { data: null }, { data: { Session: {} } }]) {
      const r = parseHistoryResponse(bad, CHAIN.id)
      expect(r.status === 'error' && r.code).toBe('malformed')
    }
  })
})

describe('失败分类（永不抛错）', () => {
  test('GraphQL errors 归为 graphql 并带回首条消息', async () => {
    const { impl } = recordingFetch(json({ errors: [{ message: 'field "Session" not found' }] }))
    expect(await fetchRecentSessions(PLAYER, { url: URL_OK, fetchImpl: impl })).toEqual({
      status: 'error',
      code: 'graphql',
      detail: 'field "Session" not found',
    })
  })

  test('非 2xx 归为 http，非 JSON 的 2xx 归为 malformed', async () => {
    const http = recordingFetch(new Response('rate limited', { status: 429 }))
    expect(await fetchRecentSessions(PLAYER, { url: URL_OK, fetchImpl: http.impl })).toEqual({
      status: 'error',
      code: 'http',
      detail: 'rate limited',
    })
    const html = recordingFetch(new Response('<html>', { status: 200 }))
    const r = await fetchRecentSessions(PLAYER, { url: URL_OK, fetchImpl: html.impl })
    expect(r.status === 'error' && r.code).toBe('malformed')
  })

  test('网络异常与超时归为 network', async () => {
    const offline = recordingFetch(new TypeError('Failed to fetch'))
    const r1 = await fetchRecentSessions(PLAYER, { url: URL_OK, fetchImpl: offline.impl })
    expect(r1).toEqual({ status: 'error', code: 'network', detail: 'Failed to fetch' })

    const hanging = recordingFetch(
      (init) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const r2 = await fetchRecentSessions(PLAYER, { url: URL_OK, fetchImpl: hanging.impl, timeoutMs: 5 })
    expect(r2.status === 'error' && r2.code).toBe('network')
  })
})
