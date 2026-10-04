import { bytesToHex, hexToBytes, type Hex } from 'viem'
import { normalizeCollection, type CollectionProgress } from './collectionProgress.ts'

const AAD = new TextEncoder().encode('ponygogogo/collection/v1')

export type EncryptedCollection = { version: 1; iv: Hex; ciphertext: Hex }

async function importCollectionKey(raw: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error('INVALID_COLLECTION_KEY')
  return crypto.subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, [usage])
}

export async function encryptCollection(progress: CollectionProgress | readonly string[], rawKey: Uint8Array): Promise<EncryptedCollection> {
  const document = normalizeCollection(progress)
  const key = await importCollectionKey(rawKey, 'encrypt')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(document))
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, plaintext)
    return { version: 1, iv: bytesToHex(iv), ciphertext: bytesToHex(new Uint8Array(ciphertext)) }
  } finally {
    plaintext.fill(0)
  }
}

export async function decryptCollection(record: EncryptedCollection, rawKey: Uint8Array): Promise<CollectionProgress> {
  if (record.version !== 1 || !/^0x[0-9a-fA-F]{24}$/.test(record.iv) || !/^0x[0-9a-fA-F]{32,}$/.test(record.ciphertext)) {
    throw new Error('INVALID_COLLECTION_CIPHERTEXT')
  }
  const key = await importCollectionKey(rawKey, 'decrypt')
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: Uint8Array.from(hexToBytes(record.iv)), additionalData: AAD,
  }, key, Uint8Array.from(hexToBytes(record.ciphertext))))
  try {
    return normalizeCollection(JSON.parse(new TextDecoder().decode(plaintext)))
  } finally {
    plaintext.fill(0)
  }
}
