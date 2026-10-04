import { createRoot } from 'react-dom/client'
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex, type Log } from 'viem'
import { ResultScreen, type PaidResultView } from '../../../src/result/ResultScreen.tsx'
import type { RaceResult } from '../../../src/race/core/types.ts'
import { parseSessionSettled } from '../../../src/chain/paidSession.ts'
import { ponyGameAbi } from '../../../src/chain/paidCalls.ts'
import { ponyRewardsAbi } from '../../../src/chain/rewards.ts'
import type { Lang } from '../../../src/ui/i18n.ts'
import '../../../src/ui/theme.css'

const game = '0x1111111111111111111111111111111111111111' as Address
const player = '0x2222222222222222222222222222222222222222' as Address
const ledger = '0x3333333333333333333333333333333333333333' as Address
const sessionId = `0x${'12'.repeat(32)}` as Hex
const log = (address: Address, topics: Hex[], data: Hex) => ({ address, topics, data } as Log)
const result: RaceResult = { raceId: sessionId, seed: '0x12', horseId: 0, rank: 1, finishTick: 100,
  choices: [], gogoClicks: [], endReason: 'finished' }
let lang: Lang = 'en'
let paid: PaidResultView | undefined = { stakeLabel: '0.05', stake: 50_000_000_000_000_000n, previewRank: 1,
  phase: 'pending', txHash: null, detail: null, settlement: null, mismatch: false, deadline: null, choiceNotes: [], onRetry() {} }
const host = document.getElementById('root')!
host.className = 'stage'
host.style.width = '1620px'; host.style.height = '971px'
const root = createRoot(host)
let homeClicks = 0
const render = () => root.render(<ResultScreen lang={lang} result={result} paid={paid} onHome={() => { homeClicks++ }} onAgain={() => {}}/>)
const resize = () => {
  const scale = Math.min(innerWidth / 1620, innerHeight / 971)
  Object.assign(host.style, { transform: `scale(${scale})`, left: `${(innerWidth - 1620 * scale) / 2}px`, top: `${(innerHeight - 971 * scale) / 2}px` })
}
window.addEventListener('resize', resize); resize()
Object.assign(window, { collectibleFixture: {
  confirm(kind = 0, id = 2) {
    const settlement = log(game, encodeEventTopics({ abi: ponyGameAbi, eventName: 'SessionSettled', args: { sessionId, player } }) as Hex[],
      encodeAbiParameters([{ type: 'uint32[5]' }, { type: 'uint8[5]' }, { type: 'uint8[5]' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'uint8[3]' }],
        [[1, 2, 3, 4, 5], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4], 1, 75_000_000_000_000_000n, sessionId, [0, 0, 0]]))
    const grant = log(ledger, encodeEventTopics({ abi: ponyRewardsAbi, eventName: 'CollectibleGranted', args: { sessionId, player } }) as Hex[],
      encodeAbiParameters([{ type: 'uint8' }, { type: 'uint8' }], [kind, id]))
    const fact = parseSessionSettled([settlement, grant], game, sessionId, null, 100n, ledger)!
    paid = { ...paid!, phase: 'settled', settlement: { rank: fact.rank, payout: fact.payout }, grant: fact.grant, grantError: null }
    render()
  },
  rerender() { paid = { ...paid!, grant: paid?.grant ? { ...paid.grant } : null }; render() },
  language(next: Lang) { lang = next; render() },
  ledgerOutage() {
    paid = { ...paid!, phase: 'settled', settlement: { rank: 1, payout: 75_000_000_000_000_000n }, grant: null,
      grantError: 'ledger unavailable', onRetryGrant: () => window.collectibleFixture.confirm() }
    render()
  },
  noGrant(phase: 'settled' | 'forfeited' | 'practice') {
    paid = phase === 'practice' ? undefined : { ...paid!, phase, settlement: phase === 'settled' ? { rank: 1, payout: 75_000_000_000_000_000n } : null, grant: null }
    render()
  },
  getHomeClicks() { return homeClicks },
} })
render()
