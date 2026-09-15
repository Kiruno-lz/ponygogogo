import { useEffect, useState } from 'react'
import { DESIGN_H, DESIGN_W } from '../game/layout.ts'

export interface StageBox {
  scale: number
  left: number
  top: number
}

/** 把 1600×950 的设计画布等比缩放居中，保证构图与渲染图逐像素对齐 */
export function useStage(): StageBox {
  const [box, setBox] = useState<StageBox>({ scale: 1, left: 0, top: 0 })
  useEffect(() => {
    const fit = (): void => {
      const w = window.innerWidth
      const h = window.innerHeight
      const scale = Math.min(w / DESIGN_W, h / DESIGN_H)
      setBox({
        scale,
        left: Math.round((w - DESIGN_W * scale) / 2),
        top: Math.round((h - DESIGN_H * scale) / 2),
      })
    }
    fit()
    window.addEventListener('resize', fit)
    window.addEventListener('orientationchange', fit)
    return () => {
      window.removeEventListener('resize', fit)
      window.removeEventListener('orientationchange', fit)
    }
  }, [])
  return box
}
