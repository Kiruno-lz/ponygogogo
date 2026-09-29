import { expect, test } from 'bun:test'
import type { Hex } from 'viem'
import { decryptCollection, encryptCollection } from './collectionCipher.ts'

const KEY = new Uint8Array(32).fill(0x31)

test('separate PRF key encrypts and recovers a rare-card set with a fresh nonce', async () => {
  const first = await encryptCollection(['C-02', 'C-10'], KEY)
  const second = await encryptCollection(['C-02', 'C-10'], KEY)
  expect(first.iv).not.toBe(second.iv)
  expect(first.ciphertext).not.toBe(second.ciphertext)
  expect(await decryptCollection(first, KEY)).toEqual(['C-02', 'C-10'])
})

test('wrong key, tampering and non-rare IDs cannot produce accepted collection state', async () => {
  const saved = await encryptCollection(['C-21'], KEY)
  await expect(decryptCollection(saved, new Uint8Array(32).fill(0x32))).rejects.toThrow()
  const changed = `${saved.ciphertext.slice(0, -2)}${saved.ciphertext.endsWith('00') ? '01' : '00'}` as Hex
  await expect(decryptCollection({ ...saved, ciphertext: changed }, KEY)).rejects.toThrow()
  await expect(encryptCollection(['C-22'], KEY)).rejects.toThrow('INVALID_RARE_CARD')
})
