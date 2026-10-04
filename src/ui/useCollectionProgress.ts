import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Address } from 'viem'
import { wallet } from '../chain/wallet.ts'
import { PONY_GAME_ADDRESS } from '../chain/network.ts'
import { CollectionWriteError, syncCollectionProgress } from '../chain/collectionSync.ts'
import { emptyCollection, mergeCollections, type CollectionProgress } from '../chain/collectionProgress.ts'
import { collectionFromGrant, readOwnedCollection, type CollectibleGrant } from '../chain/rewards.ts'
import { DEFAULT_ROSTER } from '../race/core/roster.ts'
import type { Lang } from './i18n.ts'

/** Chain ownership and the encrypted personal copy share one in-memory progress set. */
export function useCollectionProgress(lang: Lang, owner: Address | null) {
  const [progress, setProgress] = useState<CollectionProgress | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const local = useRef<CollectionProgress | null>(null)
  const generation = useRef(0)
  const busy = useRef(false)
  const commit = useCallback((next: CollectionProgress | null) => { local.current = next; setProgress(next) }, [])
  const reset = useCallback(() => {
    generation.current++
    busy.current = false
    commit(null); setLoading(false); setError(null)
  }, [commit])
  const currentOwner = useCallback(() => owner
    ? wallet.getGameAccount()?.address.toLowerCase() === owner.toLowerCase()
    : wallet.getAccount() !== null, [owner])

  useEffect(() => {
    reset()
    const epoch = generation.current
    if (owner && PONY_GAME_ADDRESS) void readOwnedCollection(wallet.publicClient, PONY_GAME_ADDRESS, owner).then(({ progress: chain }) => {
      if (generation.current === epoch && currentOwner()) commit(mergeCollections(local.current ?? emptyCollection(), chain))
    }).catch(() => { /* Unread chain progress stays unknown; explicit unlock reports a read failure. */ })
    return () => { generation.current++ }
  }, [owner, reset, currentOwner, commit])

  const unlock = useCallback(async () => {
    if (!wallet.getAccount() || busy.current) return
    const epoch = generation.current
    const live = () => generation.current === epoch && currentOwner()
    busy.current = true; setLoading(true); setError(null)
    let key: Uint8Array | null = null
    try {
      const identity = await wallet.openCollectionIdentity()
      if (!live()) return
      key = await wallet.deriveCollectionKey()
      if (!live()) return
      if (owner && PONY_GAME_ADDRESS) {
        const { progress: chain } = await readOwnedCollection(wallet.publicClient, PONY_GAME_ADDRESS, owner)
        if (!live()) return
        commit(mergeCollections(local.current ?? emptyCollection(), chain))
      }
      // A grant arriving during a write is kept locally and included in the following pass with the same key.
      for (let round = 0; round < 3; round++) {
        const out = await syncCollectionProgress(identity, key, local.current ?? emptyCollection(), fetch, location.origin, live)
        if (!live()) return
        const merged = mergeCollections(local.current ?? emptyCollection(), out.progress)
        commit(merged)
        if (JSON.stringify(merged) === JSON.stringify(out.progress)) return
      }
      throw new CollectionWriteError(local.current ?? emptyCollection(), new Error('COLLECTION_BUSY'))
    } catch (err) {
      if (live()) {
        if (err instanceof CollectionWriteError) commit(mergeCollections(local.current ?? emptyCollection(), err.progress))
        setError(lang === 'zh' ? '图鉴尚未同步成功；已保留读取的进度，请重试。' : 'Collection sync has not completed. Loaded progress is preserved; please retry.')
      }
    } finally {
      key?.fill(0)
      if (generation.current === epoch) { busy.current = false; setLoading(false) }
    }
  }, [owner, currentOwner, commit, lang])

  const acceptGrant = useCallback((grant: CollectibleGrant) => {
    if (!currentOwner() || grant.player.toLowerCase() !== owner?.toLowerCase()) return
    commit(mergeCollections(local.current ?? emptyCollection(), collectionFromGrant(grant)))
    void unlock()
  }, [currentOwner, owner, commit, unlock])
  const availablePonyIds = useMemo(() => [...DEFAULT_ROSTER, ...(progress?.unlockedPonyIds ?? [])], [progress])
  return { progress, ownedRareIds: progress?.rareCardIds ?? null, availablePonyIds, loading, error, unlock, acceptGrant, reset }
}
