import { bytesToHex, hexToBytes, type Hex } from 'viem'
import { RARE_POOL } from '../race/cards/pool.ts'

const RARE_IDS = new Set(RARE_POOL.map((card) => card.cardId))
const AAD = new TextEncoder().encode('ponygogogo/collection/v1')

export type EncryptedCollection = { version: 1; iv: Hex; ciphertext: Hex }

function normalizeRareCards(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !RARE_IDS.has(id))) {
    throw new Error('INVALID_RARE_CARD')
  }
  return [...new Set(value as string[])].sort()
}

async function importCollectionKey(raw: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error('INVALID_COLLECTION_KEY')
  return crypto.subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, [usage])
}

export async function encryptCollection(rareIds: readonly string[], rawKey: Uint8Array): Promise<EncryptedCollection> {
  const ids = normalizeRareCards([...rareIds])
  const key = await importCollectionKey(rawKey, 'encrypt')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(ids))
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, plaintext)
    return { version: 1, iv: bytesToHex(iv), ciphertext: bytesToHex(new Uint8Array(ciphertext)) }
  } finally {
    plaintext.fill(0)
  }
}

export async function decryptCollection(record: EncryptedCollection, rawKey: Uint8Array): Promise<string[]> {
  if (record.version !== 1 || !/^0x[0-9a-fA-F]{24}$/.test(record.iv) || !/^0x[0-9a-fA-F]{32,}$/.test(record.ciphertext)) {
    throw new Error('INVALID_COLLECTION_CIPHERTEXT')
  }
  const key = await importCollectionKey(rawKey, 'decrypt')
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: Uint8Array.from(hexToBytes(record.iv)), additionalData: AAD,
  }, key, Uint8Array.from(hexToBytes(record.ciphertext))))
  try {
    return normalizeRareCards(JSON.parse(new TextDecoder().decode(plaintext)))
  } finally {
    plaintext.fill(0)
  }
}
