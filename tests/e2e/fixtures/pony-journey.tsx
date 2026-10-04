import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { fetchManifest, LocalAssetSource } from '../../../src/assets/source.ts'
import { AssetLoader } from '../../../src/assets/loader.ts'
import { AudioManager, DEFAULT_AUDIO } from '../../../src/assets/audio.ts'
import { RaceDriver } from '../../../src/race/driver.ts'
import type { RaceResult } from '../../../src/race/core/types.ts'
import { SelectScreen } from '../../../src/ui/SelectScreen.tsx'
import { RaceScreen } from '../../../src/ui/RaceScreen.tsx'
import { ResultScreen } from '../../../src/result/ResultScreen.tsx'
import '../../../src/ui/theme.css'

const manifest = await fetchManifest()
const urls = Object.fromEntries(Object.entries(manifest).map(([key,e]) => [key,'/' + e.path]))
const audio = new AudioManager(new AssetLoader(new LocalAssetSource(manifest)))
audio.setSettings({ ...DEFAULT_AUDIO, muted: true })
function Fixture() {
  const [driver, setDriver] = useState<RaceDriver | null>(null)
  const [result, setResult] = useState<RaceResult | null>(null)
  const reset = () => { setDriver(null); setResult(null) }
  return <div style={{ position: 'relative', width: 1619, height: 971 }}>
    {result ? <ResultScreen lang="zh" result={result} onAgain={reset} onHome={reset}/>
      : driver ? <RaceScreen driver={driver} lang="zh" reducedMotion audio={audio} urls={urls}
          onSceneReady={() => Object.assign(window, { ponyJourneyReady: true })}
          onDone={() => setResult(driver.buildResult('local-pony-journey'))} onQuit={reset}/>
        : <SelectScreen lang="zh" balance={null} paidOpen={false} reducedMotion
            availablePonyIds={[0,1,2,3,4,5,6,7,8]} rng={() => .999} onBack={reset}
            onRace={(playerHorseId,tier,roster) => {
              const next = new RaceDriver({ seed: '0x123456abcdef', playerHorseId, stakeTier: tier, roster })
              Object.assign(window, { ponyJourneyDriver: next, ponyJourneyReady: false })
              setDriver(next)
            }}/>
    }
  </div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
