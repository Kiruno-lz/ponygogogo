import { useEffect, useState } from 'react'

/** 每 intervalMs 刷新一次的 Date.now()；active 为假时不起定时器。用于倒数分钟这类低频文案。 */
export function useNow(intervalMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, active])
  return now
}
