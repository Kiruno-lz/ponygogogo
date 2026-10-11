import { expect, test } from 'bun:test'
import { decryptCollection, encryptCollection } from './collectionCipher.ts'
import { normalizeCollection, type CollectionProgress } from './collectionProgress.ts'

test('the current collection stores both asset kinds in the 0.1 schema and envelope', async () => {
  const progress: CollectionProgress = { schemaVersion: '0.1', rareCardIds: ['C-31'], unlockedPonyIds: [8] }
  const key = new Uint8Array(32).fill(7)
  const record = await encryptCollection(progress, key)
  expect(record.version).toBe('0.1')
  expect(await decryptCollection(record, key)).toEqual(progress)
})

test('a collection document must have the current object schema', () => {
  expect(() => normalizeCollection(['C-31'])).toThrow('INVALID_COLLECTION_SCHEMA')
  expect(() => normalizeCollection({ schemaVersion: 2, rareCardIds: ['C-31'], unlockedPonyIds: [] })).toThrow('INVALID_COLLECTION_SCHEMA')
})
