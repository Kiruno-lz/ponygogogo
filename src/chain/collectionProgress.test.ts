import { expect, test } from 'bun:test'
import { bytesToHex } from 'viem'
import { encryptCollection, decryptCollection } from './collectionCipher.ts'
import { normalizeCollection, mergeCollections, collectionFromMask, type CollectionProgress } from './collectionProgress.ts'

const key = new Uint8Array(32).fill(0x41)
const progress: CollectionProgress = { schemaVersion: 2, rareCardIds: ['C-31', 'C-02'], unlockedPonyIds: [8, 5] }

test('v2 encrypted collection stores rare cards and extra ponies with the existing v1 envelope', async () => {
  const envelope = await encryptCollection(progress, key)
  expect(envelope.version).toBe(1)
  expect(await decryptCollection(envelope, key)).toEqual({ schemaVersion: 2, rareCardIds: ['C-02', 'C-31'], unlockedPonyIds: [5, 8] })
})

test('legacy rare arrays migrate on read without inventing unlocked ponies', () => {
  expect(normalizeCollection(['C-31', 'C-02', 'C-02'])).toEqual({ schemaVersion: 2, rareCardIds: ['C-02', 'C-31'], unlockedPonyIds: [] })
})

test('an actual pre-upgrade AES-GCM record decrypts with unchanged key, envelope and AAD', async () => {
  const iv = new Uint8Array(12).fill(0x21)
  const imported = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
    additionalData: new TextEncoder().encode('ponygogogo/collection/v1') }, imported,
  new TextEncoder().encode(JSON.stringify(['C-31', 'C-02'])))
  expect(await decryptCollection({ version: 1, iv: bytesToHex(iv), ciphertext: bytesToHex(new Uint8Array(ciphertext)) }, key))
    .toEqual({ schemaVersion: 2, rareCardIds: ['C-02', 'C-31'], unlockedPonyIds: [] })
})

test('concurrent device progress merges both kinds without mutating either input', () => {
  const first = normalizeCollection(progress)
  const second = normalizeCollection({ schemaVersion: 2, rareCardIds: ['C-40'], unlockedPonyIds: [7, 5] })
  const before = JSON.stringify([first, second])
  expect(mergeCollections(first, second)).toEqual({ schemaVersion: 2, rareCardIds: ['C-02', 'C-31', 'C-40'], unlockedPonyIds: [5, 7, 8] })
  expect(JSON.stringify([first, second])).toBe(before)
})

test('a recorded card survives a later rarity change in both encrypted progress and the reward ledger', async () => {
  // Current C-23 is common. The historical record remains valid by stable canonical ID.
  const recorded = { schemaVersion: 2 as const, rareCardIds: ['C-23'], unlockedPonyIds: [] }
  expect(normalizeCollection(recorded)).toEqual(recorded)
  expect(collectionFromMask(1n << 23n)).toEqual(recorded)
  expect(await decryptCollection(await encryptCollection(recorded, key), key)).toEqual(recorded)
})

test('unknown schemas, unknown cards, default or unknown ponies fail without producing an empty document', () => {
  for (const invalid of [null, {}, { ...progress, schemaVersion: 3 }, { ...progress, rareCardIds: ['C-41'] },
    { ...progress, unlockedPonyIds: [0] }, { ...progress, unlockedPonyIds: [9] }, { ...progress, unlockedPonyIds: ['8'] }]) {
    expect(() => normalizeCollection(invalid)).toThrow()
  }
})

test('a newer ledger mask with unknown collectible IDs cannot be normalized into partial or empty progress', () => {
  expect(() => collectionFromMask(1n << 41n)).toThrow('UNKNOWN_COLLECTIBLE')
  expect(() => collectionFromMask((1n << 2n) | (1n << 73n))).toThrow('UNKNOWN_COLLECTIBLE')
})
