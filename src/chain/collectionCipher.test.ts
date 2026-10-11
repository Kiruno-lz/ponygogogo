import { expect, test } from 'bun:test'
import type { Hex } from 'viem'
import { decryptCollection, encryptCollection } from './collectionCipher.ts'

const KEY = new Uint8Array(32).fill(0x31)

test('separate PRF key encrypts and recovers a rare-card set with a fresh nonce', async () => {
  const first = await encryptCollection({ schemaVersion: '0.1', rareCardIds: ['C-02', 'C-10'], unlockedPonyIds: [] }, KEY)
  const second = await encryptCollection({ schemaVersion: '0.1', rareCardIds: ['C-02', 'C-10'], unlockedPonyIds: [] }, KEY)
  expect(first.iv).not.toBe(second.iv)
  expect(first.ciphertext).not.toBe(second.ciphertext)
  expect((await decryptCollection(first, KEY)).rareCardIds).toEqual(['C-02', 'C-10'])
})

test('wrong key, tampering and unknown IDs cannot produce accepted collection state', async () => {
  const saved = await encryptCollection({ schemaVersion: '0.1', rareCardIds: ['C-21'], unlockedPonyIds: [] }, KEY)
  await expect(decryptCollection(saved, new Uint8Array(32).fill(0x32))).rejects.toThrow()
  const changed = `${saved.ciphertext.slice(0, -2)}${saved.ciphertext.endsWith('00') ? '01' : '00'}` as Hex
  await expect(decryptCollection({ ...saved, ciphertext: changed }, KEY)).rejects.toThrow()
  await expect(encryptCollection({ schemaVersion: '0.1', rareCardIds: ['C-41'], unlockedPonyIds: [] }, KEY)).rejects.toThrow('INVALID_RARE_CARD')
})

test('the new event-solver rare cards survive collection encryption and recovery', async () => {
  const saved = await encryptCollection({ schemaVersion: '0.1', rareCardIds: ['C-22','C-31','C-40'], unlockedPonyIds: [] }, KEY)
  expect((await decryptCollection(saved, KEY)).rareCardIds).toEqual(['C-22','C-31','C-40'])
  await expect(encryptCollection({ schemaVersion: '0.1', rareCardIds: ['C-41'], unlockedPonyIds: [] }, KEY)).rejects.toThrow('INVALID_RARE_CARD')
})
