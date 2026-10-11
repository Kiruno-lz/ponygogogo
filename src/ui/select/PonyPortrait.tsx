import type { CSSProperties } from 'react'
import { ponyName, type Lang } from '../i18n.ts'
import { PONY_FRAME_COUNT, PONY_IDLE_FPS, PONY_RUNNING_FPS } from '../../game/ponyAnimation.ts'

/** 八帧透明分镜，与赛道复用同一套角色贴图。 */
export function PonyPortrait({ horseId, width, flip, lang = 'zh', action = 'idle', style }: { horseId: number; lang?: Lang; width: number; flip?: boolean; action?: 'idle' | 'running'; style?: CSSProperties }) {
  return <div className={`pony-portrait pony-${action}`} role="img" aria-label={ponyName(horseId, lang)} style={{
    width, height: width * .75, transform: flip ? 'scaleX(-1)' : undefined, pointerEvents: 'none',
    backgroundImage: `url('/assets/art/ponies/${horseId}-${action}.webp')`, backgroundSize: '800% 100%', ...style,
    animationDuration: `${PONY_FRAME_COUNT / (action === 'idle' ? PONY_IDLE_FPS : PONY_RUNNING_FPS)}s`,
  }}/>
}
