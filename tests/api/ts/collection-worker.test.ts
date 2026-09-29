import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import handler, { signedMessage } from '../../../scripts/Wrangler/worker/collection.ts'

let db: Database
let identity: CryptoKeyPair
let publicKey: string
const origin = 'https://ponygo.kiruno.cc'

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function env() {
  return {
    COLLECTION_DB: {
      prepare(sql: string) {
        let args: (string | number)[] = []
        return {
          bind(...values: (string | number)[]) { args = values; return this },
          async first<T>() { return db.prepare(sql).get(...args) as T | null },
          async run() {
            const result = db.prepare(sql).run(...args)
            return { meta: { changes: result.changes } }
          },
        }
      },
    },
    ASSETS: { fetch: async () => new Response('asset') },
  }
}

async function send(path: string, method: 'POST' | 'PUT', body: unknown, headers: Record<string, string> = {}) {
  return handler.fetch(new Request(origin + path, {
    method, headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(body),
  }), env())
}

async function signed(path: '/api/collection/read' | '/api/collection', method: 'POST' | 'PUT', payload: unknown) {
  const challengeResponse = await send('/api/collection/challenge', 'POST', { publicKey })
  expect(challengeResponse.status).toBe(200)
  const challenge = await challengeResponse.json() as { challenge: string; challengeId: string }
  const message = signedMessage(origin, method, path, publicKey, challenge.challengeId, challenge.challenge, payload)
  const signature = hex(new Uint8Array(await crypto.subtle.sign('Ed25519', identity.privateKey, new Uint8Array(message))))
  const body = { publicKey, challengeId: challenge.challengeId, signature, payload }
  return { response: await send(path, method, body), body }
}

beforeEach(async () => {
  db = new Database(':memory:')
  db.exec(readFileSync('scripts/Wrangler/migrations/0001_collection.sql', 'utf8'))
  db.exec(readFileSync('scripts/Wrangler/migrations/0002_collection_limits.sql', 'utf8'))
  identity = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
  publicKey = hex(new Uint8Array(await crypto.subtle.exportKey('raw', identity.publicKey)))
})

afterEach(() => db.close())

test('图鉴密文首次创建、读取、条件更新和冲突', async () => {
  const missing = await signed('/api/collection/read', 'POST', {})
  expect(missing.response.status).toBe(404)
  const envelope = { version: 1, iv: '0x' + '12'.repeat(12), ciphertext: '0x' + '34'.repeat(32) }
  const created = await signed('/api/collection', 'PUT', { expectedVersion: 0, envelope })
  expect(created.response.status).toBe(200)
  expect(await created.response.json()).toEqual({ version: 1 })
  const conflict = await signed('/api/collection', 'PUT', { expectedVersion: 0, envelope })
  expect(conflict.response.status).toBe(409)
  expect(await conflict.response.json()).toEqual({ error: 'VERSION_CONFLICT', currentVersion: 1 })
  const read = await signed('/api/collection/read', 'POST', {})
  expect(await read.response.json()).toEqual({ version: 1, envelope })
  const updated = await signed('/api/collection', 'PUT', { expectedVersion: 1, envelope })
  expect(await updated.response.json()).toEqual({ version: 2 })
})

test('签名绑定路由和载荷，挑战仅消费一次', async () => {
  const prepared = await signed('/api/collection/read', 'POST', {})
  expect(prepared.response.status).toBe(404)
  expect((await send('/api/collection/read', 'POST', prepared.body)).status).toBe(401)

  const challengeResponse = await send('/api/collection/challenge', 'POST', { publicKey })
  const challenge = await challengeResponse.json() as { challenge: string; challengeId: string }
  const payload = {}
  const signature = hex(new Uint8Array(await crypto.subtle.sign('Ed25519', identity.privateKey,
    new Uint8Array(signedMessage(origin, 'POST', '/api/collection/read', publicKey, challenge.challengeId, challenge.challenge, payload)))))
  const tampered = { publicKey, challengeId: challenge.challengeId, signature, payload: { changed: true } }
  expect((await send('/api/collection/read', 'POST', tampered)).status).toBe(401)
  expect((await send('/api/collection', 'PUT', { ...tampered, payload })).status).toBe(401)
  expect((await send('/api/collection/read', 'POST', { ...tampered, payload })).status).toBe(404)
})

test('签名还必须绑定 challengeId，不能在另一条同值挑战上复用', async () => {
  const first = await (await send('/api/collection/challenge', 'POST', { publicKey })).json() as { challenge: string; challengeId: string }
  const second = await (await send('/api/collection/challenge', 'POST', { publicKey })).json() as { challenge: string; challengeId: string }
  // 人为构造同值挑战，验证签名对数据库行 ID 本身也有约束。
  db.prepare('UPDATE collection_challenges SET challenge = ? WHERE id = ?').run(first.challenge, second.challengeId)
  const payload = {}
  const signature = hex(new Uint8Array(await crypto.subtle.sign('Ed25519', identity.privateKey,
    new Uint8Array(signedMessage(origin, 'POST', '/api/collection/read', publicKey, first.challengeId, first.challenge, payload)))))
  const response = await send('/api/collection/read', 'POST', { publicKey, challengeId: second.challengeId, signature, payload })
  expect(response.status).toBe(401)
})

test('跨域与过大密文拒绝，静态资源仍直接透传', async () => {
  expect((await send('/api/collection/challenge', 'POST', { publicKey }, { Origin: 'https://evil.example' })).status).toBe(403)
  const envelope = { version: 1, iv: '0x' + '12'.repeat(12), ciphertext: '0x' + '34'.repeat(3000) }
  expect((await signed('/api/collection', 'PUT', { expectedVersion: 0, envelope })).response.status).toBe(400)
  expect((await handler.fetch(new Request(origin + '/'), env())).status).toBe(200)
})

test('挑战请求按来源限速，轮换公钥也不能绕过', async () => {
  let limited = 0
  for (let i = 0; i < 32; i++) {
    const nextKey = hex(crypto.getRandomValues(new Uint8Array(32)))
    const response = await send('/api/collection/challenge', 'POST', { publicKey: nextKey }, {
      'CF-Connecting-IP': '203.0.113.4',
    })
    if (response.status === 429) limited++
  }
  expect(limited).toBeGreaterThan(0)
})
