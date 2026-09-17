/** 共用比赛美术，不读取或更新规则状态。 */
import { HORSE_PROFILES } from '../game/horses.ts'

export function PlayerPlaque({ horseId }: { horseId: number }) {
  return <div className="player-plaque">
    <img src={horseId === 0 ? '/assets/art/ui/avatar-source.png' : '/assets/art/ui/avatar-reference-blank.png'} alt="" draggable={false}/>
    {horseId !== 0 && <img className="plaque-pony" src={`/assets/art/ponies/${horseId}-portrait.png`} alt="" draggable={false}/>}
    <span className={horseId === 0 ? 'source-name' : undefined}>{HORSE_PROFILES[horseId]!.name}</span>
  </div>
}

export function StaminaArt({ fraction, exhausted = false, over = false, children }: {
  fraction: number; exhausted?: boolean; over?: boolean; children?: React.ReactNode
}) {
  return <div className={`stamina-art${exhausted ? ' exhausted-art' : ''}${over ? ' over-art' : ''}`} data-testid="stamina-bar">
    <img className="stamina-empty" src="/assets/art/ui/stamina-reference-empty.png" alt="" draggable={false}/>
    <img className="stamina-fill" src="/assets/art/ui/stamina-reference.png" alt="" draggable={false} style={{ clipPath: `inset(0 ${(1 - Math.max(0, Math.min(1, fraction))) * 88}% 0 0)` }}/>
    {children}
  </div>
}
