import { useLayoutEffect, useState } from 'react'
import { DESIGN_H, DESIGN_W } from '../game/layout.ts'

export interface StageBox {
  scale: number
  left: number
  top: number
}

/** 每个原画画布分别等比缩放居中，避免首页与赛道的不同比例互相裁切。 */
export function useStage(designWidth = DESIGN_W, designHeight = DESIGN_H): StageBox {
  const [box, setBox] = useState<StageBox>({ scale: 1, left: 0, top: 0 })
  useLayoutEffect(() => {
    const fit = (): void => {
      const w = window.innerWidth
      const h = window.innerHeight
      const scale = Math.min(w / designWidth, h / designHeight)
      setBox({
        scale,
        left: Math.round((w - designWidth * scale) / 2),
        top: Math.round((h - designHeight * scale) / 2),
      })
    }
    fit()
    window.addEventListener('resize', fit)
    window.addEventListener('orientationchange', fit)
    return () => {
      window.removeEventListener('resize', fit)
      window.removeEventListener('orientationchange', fit)
    }
  }, [designWidth, designHeight])
  return box
}
