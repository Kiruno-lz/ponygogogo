import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { createEd25519SigningSession } from '@category-labs/mera'
import { bytesToHex } from 'viem'
import { decryptCollection, encryptCollection } from '../../../src/chain/collectionCipher.ts'
import { CollectionWriteError, readRemoteCollection, writeRemoteCollection, syncCollectionProgress } from '../../../src/chain/collectionSync.ts'
import worker from '../../../scripts/Wrangler/worker/collection.ts'

const origin = 'https://ponygo.kiruno.cc'
const db = new Database(':memory:')
db.exec(readFileSync('scripts/Wrangler/migrations/0001_collection.sql', 'utf8'))
db.exec(readFileSync('scripts/Wrangler/migrations/0002_collection_limits.sql', 'utf8'))

const env = {
  COLLECTION_DB: {
    prepare(sql: string) {
      let args: (string | number)[] = []
      return {
        bind(...values: (string | number)[]) { args = values; return this },
        async first<T>() { return db.prepare(sql).get(...args) as T | null },
        async run() { return { meta: { changes: db.prepare(sql).run(...args).changes } } },
      }
    },
  },
  ASSETS: { fetch: async () => new Response('asset') },
}

const localFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(new URL(String(input), origin), init)
  return worker.fetch(request, env)
}) as typeof fetch

afterEach(() => db.exec('DELETE FROM collection_documents; DELETE FROM collection_challenges'))

test('Mera 身份签名协议往返，只在客户端解密稀有卡并以版本拒绝覆盖', async () => {
  const privateKey = crypto.getRandomValues(new Uint8Array(32))
  const identity = createEd25519SigningSession({ privateKey })
  privateKey.fill(0)
  const key = crypto.getRandomValues(new Uint8Array(32))
  try {
    expect(await readRemoteCollection(identity, localFetch, origin)).toBeNull()
    const envelope = await encryptCollection(['C-18', 'C-21'], key)
    expect(await writeRemoteCollection(identity, 0, envelope, localFetch, origin)).toBe(1)
    const remote = await readRemoteCollection(identity, localFetch, origin)
    expect(remote?.version).toBe(1)
    expect((await decryptCollection(remote!.envelope, key)).rareCardIds).toEqual(['C-18', 'C-21'])
    await expect(writeRemoteCollection(identity, 0, envelope, localFetch, origin)).rejects.toThrow('COLLECTION_VERSION_CONFLICT')
  } finally {
    key.fill(0)
    identity.end()
  }
})

test('a conflicting second device write is read and merged without losing either card or pony', async () => {
  const identity = createEd25519SigningSession({ privateKey: new Uint8Array(32).fill(0x61) })
  const key = new Uint8Array(32).fill(0x62)
  try {
    await writeRemoteCollection(identity, 0, await encryptCollection(['C-18'], key), localFetch, origin)
    let raced = false
    const racingFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/collection' && init?.method === 'PUT' && !raced) {
        raced = true
        const other = await encryptCollection({ schemaVersion: 2, rareCardIds: ['C-18', 'C-21'], unlockedPonyIds: [7] }, key)
        await writeRemoteCollection(identity, 1, other, localFetch, origin)
      }
      return localFetch(url, init)
    }) as typeof fetch
    const next = await syncCollectionProgress(identity, key,
      { schemaVersion: 2, rareCardIds: ['C-02'], unlockedPonyIds: [8] }, racingFetch, origin)
    expect(next.progress).toEqual({ schemaVersion: 2, rareCardIds: ['C-02', 'C-18', 'C-21'], unlockedPonyIds: [7, 8] })
    const remote = await readRemoteCollection(identity, localFetch, origin)
    expect(remote!.version).toBe(3)
    expect(await decryptCollection(remote!.envelope, key)).toEqual(next.progress)
  } finally { key.fill(0); identity.end() }
})

test('an unchanged collection is read without a write; cancellation never writes', async () => {
  const identity = createEd25519SigningSession({ privateKey: new Uint8Array(32).fill(0x71) })
  const key = new Uint8Array(32).fill(0x72)
  const initial = { schemaVersion: 2 as const, rareCardIds: ['C-02'], unlockedPonyIds: [5] }
  let writes = 0
  const counted = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') writes++
    return localFetch(url, init)
  }) as typeof fetch
  try {
    await writeRemoteCollection(identity, 0, await encryptCollection(initial, key), localFetch, origin)
    expect((await syncCollectionProgress(identity, key, initial, counted, origin)).written).toBe(false)
    expect(writes).toBe(0)
    await expect(syncCollectionProgress(identity, key, initial, counted, origin, () => false)).rejects.toThrow('COLLECTION_CANCELLED')
    expect(writes).toBe(0)
  } finally { key.fill(0); identity.end() }
})

test('switching account during the write challenge cancels before submitting the old account document', async () => {
  const identity = createEd25519SigningSession({ privateKey: new Uint8Array(32).fill(0x81) })
  const key = new Uint8Array(32).fill(0x82)
  let current = true, challenges = 0, writes = 0
  const switchingFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') writes++
    const response = await localFetch(url, init)
    if (String(url) === '/api/collection/challenge' && ++challenges === 2) current = false
    return response
  }) as typeof fetch
  try {
    await expect(syncCollectionProgress(identity, key, { schemaVersion: 2, rareCardIds: ['C-02'], unlockedPonyIds: [8] },
      switchingFetch, origin, () => current)).rejects.toThrow('COLLECTION_CANCELLED')
    expect(writes).toBe(0)
    expect(await readRemoteCollection(identity, localFetch, origin)).toBeNull()
  } finally { key.fill(0); identity.end() }
})

test('a valid encrypted future schema cannot be replaced by an empty or older client document', async () => {
  const identity = createEd25519SigningSession({ privateKey: new Uint8Array(32).fill(0x91) })
  const key = new Uint8Array(32).fill(0x92), iv = new Uint8Array(12).fill(0x93)
  const imported = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
    additionalData: new TextEncoder().encode('ponygogogo/collection/v1') }, imported,
    new TextEncoder().encode(JSON.stringify({ schemaVersion: 3, rareCardIds: ['C-02'], unlockedPonyIds: [8] })))
  const envelope = { version: 1 as const, iv: bytesToHex(iv), ciphertext: bytesToHex(new Uint8Array(ciphertext)) }
  let writes = 0
  const counted = ((url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') writes++
    return localFetch(url, init)
  }) as typeof fetch
  try {
    await writeRemoteCollection(identity, 0, envelope, localFetch, origin)
    await expect(syncCollectionProgress(identity, key, { schemaVersion: 2, rareCardIds: [], unlockedPonyIds: [] }, counted, origin))
      .rejects.toThrow('INVALID_COLLECTION_SCHEMA')
    expect(writes).toBe(0)
    expect(await readRemoteCollection(identity, localFetch, origin)).toEqual({ version: 1, envelope })
  } finally { key.fill(0); identity.end() }
})

test('a failed write retains remote and newly granted progress and leaves the server document intact', async () => {
  const identity = createEd25519SigningSession({ privateKey: new Uint8Array(32).fill(0xa1) })
  const key = new Uint8Array(32).fill(0xa2)
  const old = { schemaVersion: 2 as const, rareCardIds: ['C-31'], unlockedPonyIds: [7] }
  const unavailable = ((url: RequestInfo | URL, init?: RequestInit) => init?.method === 'PUT'
    ? Promise.resolve(new Response('temporarily unavailable', { status: 503 })) : localFetch(url, init)) as typeof fetch
  try {
    await writeRemoteCollection(identity, 0, await encryptCollection(old, key), localFetch, origin)
    const error = await syncCollectionProgress(identity, key, { schemaVersion: 2, rareCardIds: ['C-02'], unlockedPonyIds: [8] }, unavailable, origin)
      .catch(error => error)
    expect(error).toBeInstanceOf(CollectionWriteError)
    expect(error.progress).toEqual({ schemaVersion: 2, rareCardIds: ['C-02', 'C-31'], unlockedPonyIds: [7, 8] })
    const remote = (await readRemoteCollection(identity, localFetch, origin))!
    expect(remote.version).toBe(1)
    expect(await decryptCollection(remote.envelope, key)).toEqual(old)
  } finally { key.fill(0); identity.end() }
})
