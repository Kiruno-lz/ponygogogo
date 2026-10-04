/** 共用比赛美术，不读取或更新规则状态。 */
import { ponyById } from '../game/ponyCatalog.ts'

export function PlayerPlaque({ horseId }: { horseId: number }) {
  return <div className="player-plaque">
    <img src={horseId === 0 ? '/assets/art/ui/avatar-source.webp' : '/assets/art/ui/avatar-reference-blank.webp'} alt="" draggable={false}/>
    {horseId !== 0 && <img className="plaque-pony" src={`/assets/art/ponies/${horseId}-portrait.webp`} alt="" draggable={false}/>}
    <span className={horseId === 0 ? 'source-name' : undefined}>{ponyById(horseId).name}</span>
  </div>
}

export function StaminaArt({ fraction, exhausted = false, over = false, children }: {
  fraction: number; exhausted?: boolean; over?: boolean; children?: React.ReactNode
}) {
  return <div className={`stamina-art${exhausted ? ' exhausted-art' : ''}${over ? ' over-art' : ''}`} data-testid="stamina-bar">
    <img className="stamina-empty" src="/assets/art/ui/stamina-reference-empty.webp" alt="" draggable={false}/>
    <img className="stamina-fill" src="/assets/art/ui/stamina-reference.webp" alt="" draggable={false} style={{ clipPath: `inset(0 ${(1 - Math.max(0, Math.min(1, fraction))) * 88}% 0 0)` }}/>
    {children}
  </div>
}
