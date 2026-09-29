import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { createEd25519SigningSession } from '@category-labs/mera'
import { decryptCollection, encryptCollection } from '../../../src/chain/collectionCipher.ts'
import { readRemoteCollection, writeRemoteCollection } from '../../../src/chain/collectionSync.ts'
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
    expect(await decryptCollection(remote!.envelope, key)).toEqual(['C-18', 'C-21'])
    await expect(writeRemoteCollection(identity, 0, envelope, localFetch, origin)).rejects.toThrow('COLLECTION_VERSION_CONFLICT')
  } finally {
    key.fill(0)
    identity.end()
  }
})
