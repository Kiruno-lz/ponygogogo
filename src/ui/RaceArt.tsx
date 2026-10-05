/** 共用比赛美术，不读取或更新规则状态。 */
import { ponyById } from '../game/ponyCatalog.ts'

// Head/neck crops have different native proportions. Match their face area and
// focal point to Kiruno without stretching faces or moving the shared frame.
const PORTRAIT_LAYOUTS = [
  { left: 43, top: 25, width: 146, height: 148 },
  { left: 38, top: 25, width: 155, height: 155 },
  { left: 34, top: 31, width: 154, height: 154 },
  { left: 21, top: 32, width: 187, height: 187 },
  { left: 20, top: 34, width: 175, height: 175 },
  { left: 57, top: 39, width: 126, height: 126 },
  { left: 48, top: 32, width: 137, height: 137 },
  { left: 57, top: 45, width: 130, height: 130 },
  { left: 74, top: 45, width: 117, height: 117 },
] as const

export function PlayerPlaque({ horseId }: { horseId: number }) {
  return <div className="player-plaque">
    <img className="plaque-background" src="/assets/art/ui/avatar-reference-blank.webp" alt="" draggable={false}/>
    <div className="plaque-window"><img className="plaque-pony"
      src={`/assets/art/ponies/${horseId}-${horseId === 1 || horseId >= 5 ? 'plaque-portrait' : 'portrait'}.webp`}
      style={PORTRAIT_LAYOUTS[horseId]} alt="" draggable={false}/></div>
    <img className="plaque-frame" src="/assets/art/ui/avatar-reference-blank.webp" alt="" draggable={false}/>
    <span>{ponyById(horseId).name}</span>
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
