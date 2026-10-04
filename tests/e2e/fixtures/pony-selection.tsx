import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SelectScreen } from '../../../src/ui/SelectScreen.tsx'
import '../../../src/ui/theme.css'

function Fixture() {
  const [entry, setEntry] = useState<unknown>(null)
  const props = { lang: 'zh' as const, balance: null, paidOpen: false,
    availablePonyIds: Array.from({ length: 9 }, (_, i) => i), rng: () => .999,
    reducedMotion: new URLSearchParams(location.search).get('reduced') === '1',
    onBack: () => {}, onRace: (playerHorseId: number, tier: number, roster?: readonly number[]) => setEntry({ playerHorseId, tier, roster }) }
  return <div style={{ width: 1619, height: 971 }}><SelectScreen {...props}/>
    <output data-testid="entry-capture" style={{ position: 'absolute', top: 0, left: 650 }}>{JSON.stringify(entry)}</output></div>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
