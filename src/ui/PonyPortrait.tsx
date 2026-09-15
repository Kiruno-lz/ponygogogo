import { HORSE_PROFILES } from '../game/horses.ts'
import { ponyFullSvg } from '../game/ponyArt.ts'

/** 菜单里的小马立绘，与赛道用同一份 SVG 美术 */
export function PonyPortrait({
  horseId,
  width,
  flip,
}: {
  horseId: number
  width: number
  flip?: boolean
}) {
  const p = HORSE_PROFILES[horseId]!
  return (
    <div
      aria-label={p.name}
      style={{
        width,
        height: width * 0.75,
        transform: flip ? 'scaleX(-1)' : undefined,
        pointerEvents: 'none',
      }}
      dangerouslySetInnerHTML={{ __html: ponyFullSvg(p).replace('<svg', '<svg style="width:100%;height:100%"') }}
    />
  )
}
