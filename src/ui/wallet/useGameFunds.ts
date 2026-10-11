import { useCallback, useRef, useState } from 'react'
import type { FundsSnapshot } from '../../chain/funds.ts'
import { wallet } from '../../chain/wallet.ts'

/** Account-generation guard prevents a completed read from restoring a logged-out account's balance. */
export function useGameFunds() {
  const [funds, setFunds] = useState<FundsSnapshot | null>(null)
  const generation = useRef(0)
  const reset = useCallback(() => { generation.current++; setFunds(null) }, [])
  const refresh = useCallback(async () => {
    const epoch = generation.current
    try {
      const next = await wallet.readFunds()
      if (generation.current === epoch) setFunds(next)
    } catch (error) {
      if (generation.current === epoch) setFunds(null)
      throw error
    }
  }, [])
  return { funds, reset, refresh }
}
