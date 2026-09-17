import type { CSSProperties } from 'react'
import { HORSE_PROFILES } from '../game/horses.ts'

/** 透明 PNG 八帧动作，与赛道复用同一套角色分镜。 */
export function PonyPortrait({ horseId, width, flip, action = 'idle', style }: { horseId: number; width: number; flip?: boolean; action?: 'idle' | 'running'; style?: CSSProperties }) {
  const p = HORSE_PROFILES[horseId]!
  return <div className={`pony-portrait pony-${action}`} role="img" aria-label={p.name} style={{
    width, height: width * .75, transform: flip ? 'scaleX(-1)' : undefined, pointerEvents: 'none',
    backgroundImage: `url('/assets/art/ponies/${horseId}-${action}.png')`, backgroundSize: '800% 100%', ...style,
  }}/>
}
