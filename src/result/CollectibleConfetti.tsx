import { useEffect, useRef, useState, type RefObject } from 'react'
import { COLLECTIBLE_CONFETTI_MS, collectibleRibbons, ribbonPosition } from './collectibleMotion.ts'

const ATLAS = '/assets/art/collectibles/confetti.webp'

export function CollectibleConfetti({ panel }: { panel: RefObject<HTMLDivElement | null> }) {
  const behind = useRef<HTMLCanvasElement>(null)
  const top = useRef<HTMLCanvasElement>(null)
  const [finished, setFinished] = useState(false)
  useEffect(() => {
    if (finished) return
    const layers = [behind.current!, top.current!]
    const contexts = layers.map(canvas => canvas.getContext('2d')!)
    const atlas = new Image()
    let frame = 0, stopped = false
    const resize = () => {
      const dpr = Math.min(devicePixelRatio, 2)
      layers.forEach((canvas, i) => {
        canvas.width = Math.round(innerWidth * dpr)
        canvas.height = Math.round(innerHeight * dpr)
        contexts[i].setTransform(dpr, 0, 0, dpr, 0, 0)
      })
    }
    resize()
    window.addEventListener('resize', resize)
    atlas.src = ATLAS
    const particles = collectibleRibbons()
    // Start on the same frame as the breath, even when decoding is still pending.
    const start = performance.now()
    const draw = (now: number) => {
      if (stopped) return
      const elapsed = now - start
      contexts.forEach(ctx => ctx.clearRect(0, 0, innerWidth, innerHeight))
      const rect = panel.current?.getBoundingClientRect()
      if (rect && atlas.complete && atlas.naturalWidth) {
        const scale = Math.min(1.2, rect.width / 360)
        const tileW = atlas.naturalWidth / 4, tileH = atlas.naturalHeight / 4
        for (const particle of particles) {
          const pos = ribbonPosition(particle, elapsed / 1000, scale)
          const ctx = contexts[particle.top ? 1 : 0]
          const size = particle.size * scale
          ctx.save()
          ctx.globalAlpha = pos.opacity
          ctx.translate(rect.x + rect.width / 2 + pos.x, (particle.top ? rect.y + 12 : rect.y + rect.height / 2) + pos.y)
          ctx.rotate(pos.rotation)
          ctx.scale(pos.flutter, 1)
          ctx.drawImage(atlas, particle.tile % 4 * tileW, Math.floor(particle.tile / 4) * tileH,
            tileW, tileH, -size / 2, -size / 2, size, size)
          ctx.restore()
        }
      }
      if (elapsed < COLLECTIBLE_CONFETTI_MS) frame = requestAnimationFrame(draw)
      else setFinished(true)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [panel, finished])
  return finished ? null : <div className="collectible-confetti" aria-hidden="true">
    <canvas ref={behind} className="collectible-confetti-behind"/>
    <canvas ref={top} className="collectible-confetti-top"/>
  </div>
}
