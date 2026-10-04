/** Deterministic presentation fixture: the real components consume a real event-solver trace. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Card } from '../../../src/cards/Card.tsx'
import { CardChoicePanel } from '../../../src/cards/CardChoicePanel.tsx'
import { paidCardDef } from '../../../src/race/cards/paidCards.ts'
import { Hud } from '../../../src/ui/Hud.tsx'
import { buildPaidSnapshot } from '../../../src/race/paidSnapshot.ts'
import { solvePaidCore } from '../../../src/race/paid/solver.ts'
import { playNewCards } from '../../../src/race/paid/testkit.ts'
import '../../../src/ui/theme.css'
const race = solvePaidCore(playNewCards([11,32], { profiles: Array.from({length:5},()=>({base:1000n,acceleration:0n,cap:1000n})) }))
const renewal = race.trace!.renewals[0]!
function Fixture() {
 const [lang,setLang] = useState<'zh'|'en'>('zh'), [mode,setMode] = useState('faces'), [picked,setPicked] = useState('')
 const [refreshCredits,setRefreshCredits] = useState(0)
 const tau = renewal.tau
 const snapshot = buildPaidSnapshot({trace:race.trace!,tau,playerHorseId:1,stakeTier:2,seed:'fixture',panel:null,draw:null,playerDeck:[],finishTime:race.finishTime,raceOver:false})
 return <>
  <nav style={{position:'relative',zIndex:100,padding:12,display:'flex',gap:16}}><button onClick={()=>setLang(lang==='zh'?'en':'zh')}>{lang}</button><button onClick={()=>setMode('faces')}>faces</button><button onClick={()=>setMode('all')}>all cards</button><button onClick={()=>setMode('choice')}>choice</button><button onClick={()=>setMode('hud')}>hud</button><button onClick={()=>setRefreshCredits(1)}>grant refresh</button><output data-testid="picked">{picked}</output></nav>
  {mode==='all' && <div style={{display:'flex',flexWrap:'wrap',gap:16,padding:20}}>{Array.from({length:40},(_,k)=><Card key={k} def={paidCardDef(`C-${String(k+1).padStart(2,'0')}`)!} lang={lang} size="gallery"/>)}</div>}
  {mode==='faces' && <div style={{display:'flex',flexWrap:'wrap',gap:16,padding:20}}>{Array.from({length:19},(_,k)=><Card key={k} def={paidCardDef(`C-${k+22}`)!} lang={lang} size="gallery"/>)}</div>}
  {mode==='choice' && <CardChoicePanel candidates={['C-22','C-31','C-40']} checkpoint={0} refreshCredits={refreshCredits} auto={false} timeLeftMs={17000} lang={lang} reducedMotion={true} onArmed={()=>{}} onPick={setPicked} onSkip={()=>setPicked('skip')} onRefresh={(slot)=>{setRefreshCredits((n)=>n-1);setPicked(`refresh-${slot}`)}} lookup={paidCardDef}/>}
  {mode==='hud' && <Hud state={snapshot} lang={lang} reducedMotion={true} gogoPunchKey={0} onGogoDown={()=>{}} onGogoUp={()=>{}} hideGogo={true}/>}
 </>
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
