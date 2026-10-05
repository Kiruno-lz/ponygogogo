import { createRoot } from 'react-dom/client'
import { PONY_CATALOG } from '../../../src/game/ponyCatalog.ts'
import { PlayerPlaque } from '../../../src/ui/RaceArt.tsx'
import '../../../src/ui/theme.css'

createRoot(document.getElementById('root')!).render(<div data-testid="plaque-grid"
  style={{ width: 900, height: 900, display: 'grid', gridTemplateColumns: 'repeat(3, 300px)', background: "url('/assets/art/track/scene.webp') center / cover" }}>
  {PONY_CATALOG.map(pony => <div key={pony.ponyId} style={{ position: 'relative', width: 300, height: 300 }}>
    <div style={{ transform: 'scale(1.2)', transformOrigin: 'top left' }}><PlayerPlaque horseId={pony.ponyId}/></div>
  </div>)}
</div>)
