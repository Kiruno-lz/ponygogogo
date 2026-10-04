import { bytesToHex } from 'viem'
import type { Ed25519SigningSession } from '@category-labs/mera'
import { decryptCollection, encryptCollection, type EncryptedCollection } from './collectionCipher.ts'
import { emptyCollection, mergeCollections, normalizeCollection, type CollectionProgress } from './collectionProgress.ts'

type Challenge = { challenge: string; challengeId: string; expiresAt: number }
type RemoteCollection = { version: number; envelope: EncryptedCollection }

function asHex(bytes: Uint8Array): string {
  return bytesToHex(bytes).slice(2)
}

function message(origin: string, method: string, path: string, publicKey: string, challengeId: string, challenge: string, payload: unknown): Uint8Array {
  return new TextEncoder().encode(['ponygogogo/collection/v1', origin, method, path, publicKey, challengeId, challenge, JSON.stringify(payload)].join('\n'))
}

async function challenge(fetchImpl: typeof fetch, publicKey: string): Promise<Challenge> {
  const response = await fetchImpl('/api/collection/challenge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publicKey }),
  })
  if (!response.ok) throw new Error('COLLECTION_CHALLENGE_FAILED')
  const value = await response.json() as Challenge
  if (!/^[0-9a-f]{64}$/.test(value.challenge) || typeof value.challengeId !== 'string' || value.expiresAt <= Date.now()) {
    throw new Error('INVALID_COLLECTION_CHALLENGE')
  }
  return value
}

async function authenticated(
  identity: Ed25519SigningSession,
  method: 'POST' | 'PUT',
  path: '/api/collection/read' | '/api/collection',
  payload: unknown,
  fetchImpl: typeof fetch,
  origin: string,
  isCurrent: () => boolean = () => true,
): Promise<Response> {
  const requireCurrent = () => { if (!isCurrent()) throw new Error('COLLECTION_CANCELLED') }
  requireCurrent()
  const publicKey = asHex(identity.publicKey)
  const next = await challenge(fetchImpl, publicKey)
  requireCurrent()
  const signature = asHex(await identity.signMessage(message(origin, method, path, publicKey, next.challengeId, next.challenge, payload)))
  requireCurrent()
  return fetchImpl(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey, challengeId: next.challengeId, signature, payload }),
  })
}

/** A missing remote record is an empty collection; all other failures preserve the local state. */
export async function readRemoteCollection(
  identity: Ed25519SigningSession,
  fetchImpl: typeof fetch = fetch,
  origin: string = location.origin,
  isCurrent: () => boolean = () => true,
): Promise<RemoteCollection | null> {
  const response = await authenticated(identity, 'POST', '/api/collection/read', {}, fetchImpl, origin, isCurrent)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`COLLECTION_READ_${response.status}`)
  const record = await response.json() as RemoteCollection
  if (!Number.isSafeInteger(record.version) || record.version < 1 || record.envelope?.version !== 1) {
    throw new Error('INVALID_REMOTE_COLLECTION')
  }
  return record
}

/** Optimistic write; a 409 means another device won and must be read and merged first. */
export async function writeRemoteCollection(
  identity: Ed25519SigningSession,
  expectedVersion: number,
  envelope: EncryptedCollection,
  fetchImpl: typeof fetch = fetch,
  origin: string = location.origin,
  isCurrent: () => boolean = () => true,
): Promise<number> {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error('INVALID_COLLECTION_VERSION')
  const response = await authenticated(identity, 'PUT', '/api/collection', { expectedVersion, envelope }, fetchImpl, origin, isCurrent)
  if (response.status === 409) throw new Error('COLLECTION_VERSION_CONFLICT')
  if (!response.ok) throw new Error(`COLLECTION_WRITE_${response.status}`)
  const result = await response.json() as { version: number }
  if (result.version !== expectedVersion + 1) throw new Error('INVALID_COLLECTION_VERSION')
  return result.version
}

export type { RemoteCollection }

/** Carries unsynced progress so the UI can retain it after a failed conditional write. */
export class CollectionWriteError extends Error {
  constructor(readonly progress: CollectionProgress, cause: unknown) {
    super('COLLECTION_UNSYNCED', { cause })
  }
}

/** Read/decrypt first; write only actual additions, retry conflicts by set union (at most three writes). */
export async function syncCollectionProgress(
  identity: Ed25519SigningSession,
  rawKey: Uint8Array,
  additions: CollectionProgress,
  fetchImpl: typeof fetch = fetch,
  origin: string = location.origin,
  isCurrent: () => boolean = () => true,
): Promise<{ progress: CollectionProgress; version: number; written: boolean }> {
  let pending = normalizeCollection(additions)
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!isCurrent()) throw new Error('COLLECTION_CANCELLED')
    const remote = await readRemoteCollection(identity, fetchImpl, origin, isCurrent)
    const stored = remote ? await decryptCollection(remote.envelope, rawKey) : emptyCollection()
    if (!isCurrent()) throw new Error('COLLECTION_CANCELLED')
    pending = mergeCollections(stored, pending)
    if (JSON.stringify(pending) === JSON.stringify(stored)) return { progress: pending, version: remote?.version ?? 0, written: false }
    const envelope = await encryptCollection(pending, rawKey)
    if (!isCurrent()) throw new Error('COLLECTION_CANCELLED')
    try {
      const version = await writeRemoteCollection(identity, remote?.version ?? 0, envelope, fetchImpl, origin, isCurrent)
      if (!isCurrent()) throw new Error('COLLECTION_CANCELLED')
      return { progress: pending, version, written: true }
    } catch (err) {
      if (err instanceof Error && err.message === 'COLLECTION_VERSION_CONFLICT') continue
      if (err instanceof Error && err.message === 'COLLECTION_CANCELLED') throw err
      throw new CollectionWriteError(pending, err)
    }
  }
  throw new CollectionWriteError(pending, new Error('COLLECTION_VERSION_CONFLICT'))
}
