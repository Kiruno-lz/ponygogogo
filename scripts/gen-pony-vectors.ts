/** Roster/ability parity vectors. Controlled lifecycle cases and real derived decks remain distinct. */
import { readFileSync, writeFileSync } from 'node:fs'
import { keccak256, toBytes } from 'viem'
import { PAID_RULESET_HASH } from '../src/race/paid/cardRules.ts'
import { PONY_RULES } from '../src/race/paid/ponyRules.ts'
import { derivePaidCoreInput } from '../src/race/paid/race.ts'
import { fixtureInput, pickAt, fixtureAnchor, withSlot } from '../src/race/paid/testkit.ts'
import { solvePaidCore, type PaidCoreInput } from '../src/race/paid/solver.ts'
import { solveVectorCase } from '../src/race/paid/vectorCodec.ts'

const out = new URL('../tests/vectors/pony-race-v5.json', import.meta.url)
const cases: ReturnType<typeof solveVectorCase>[] = []
const patterns = [[], [2], [17], [4], [5], [7, 32], [1, 11], [17, 15, 7], [17, 18, 1],
  [0], [39, 0, 0], [15], [14], [16], [24], [36], [7, 25, 22], [13], [6, 2], [10, 32, 13]]

function roster(pony: number) { return [pony, ...PONY_RULES.map(p => p.id).filter(id => id !== pony).slice(0, 4)] }
function controlled(pony: number, picks: number[]): PaidCoreInput {
  const unused = Array.from({ length: 40 }, (_, i) => i + 1).filter(id => !picks.includes(id))
  const deck: number[] = []
  for (let k = 0; k < 3; k++) deck.push(picks[k] || unused.shift()!, unused.shift()!, unused.shift()!)
  while (deck.length < 14) deck.push(unused.shift()!)
  return fixtureInput({ roster: roster(pony), playerHorseId: 0, playerDeck: deck,
    profiles: Array.from({ length: 5 }, () => ({ base: 1200n, acceleration: 12n, cap: 1800n })) })
}
function choose(input: PaidCoreInput, picks: number[]) {
  for (let i = 0; i < picks.length; i++) {
    const k = (i + 1) as 1 | 2 | 3
    const panel = solvePaidCore(input, { stopAtPanel: k, trace: false }).panel
    if (panel?.mode === 'manual') input = pickAt(input, k, picks[i]!)
  }
  return input
}
for (const pony of PONY_RULES) {
  patterns.forEach((cards, index) => cases.push(solveVectorCase(`controlled-role-${pony.id}-pattern-${index}`, choose(controlled(pony.id, cards), cards))))
  // The target's extended equipment expiration is preserved by theft, not restarted at the recipient.
  const stolen = controlled(pony.id, [13])
  const target = stolen.roster!.indexOf(2)
  const victim = target > 0 ? target : 1
  const transfer = { ...stolen, cpuDecks: stolen.cpuDecks.map((deck, h) => h === victim ? [7, 8, 10] : [...deck]) }
  cases.push(solveVectorCase(`controlled-role-${pony.id}-equipment-transfer`, choose(transfer, [13])))
  const invalid = controlled(pony.id, [])
  cases.push(solveVectorCase(`controlled-role-${pony.id}-invalid-forfeit`,
    withSlot(invalid, 1, { cardId: 0, txSec: 0n, anchor: fixtureAnchor(33), refreshSlots: [] })))
}
for (let i = 0; i < 45; i++) {
  const playerHorseId = i % 5, ids = roster(i % 9)
  ;[ids[0], ids[playerHorseId]] = [ids[playerHorseId]!, ids[0]!]
  let input = derivePaidCoreInput({ seed: keccak256(toBytes(`pony-v5/seed/${i}`)),
    openAnchor: keccak256(toBytes(`pony-v5/anchor/${i}`)), stakeTier: (i % 4 + 1) as 1 | 2 | 3 | 4,
    playerHorseId, roster: ids, choices: [null, null, null] })
  for (const k of [1, 2, 3] as const) {
    const panel = solvePaidCore(input, { stopAtPanel: k, trace: false }).panel
    if (panel?.mode !== 'manual') continue
    const refreshSlots = panel.drawState.refreshCredits > 0 && i % 2 === 0 ? [1] : []
    const offer = [...panel.candidates]
    if (refreshSlots.length) offer[1] = input.playerDeck[panel.drawState.tailCursor - 1]!
    input = pickAt(input, k, i % 7 === 0 ? 0 : offer[(i + k) % 3]!, { refreshSlots, delaySec: BigInt(i % 3) })
  }
  cases.push({ ...solveVectorCase(`derived-role-${i % 9}-seed-${i}`, input), stakeTier: i % 4 + 1 })
}
const text = `{"meta":${JSON.stringify({ rulesetHash: PAID_RULESET_HASH, count: cases.length })},\n"cases":[\n${cases.map(value => JSON.stringify(value)).join(',\n')}\n]}\n`
if (process.argv.includes('--check')) {
  if (readFileSync(out, 'utf8') !== text) throw new Error('STALE_PONY_VECTORS')
} else writeFileSync(out, text)
console.log(`pony-race-v5.json: ${cases.length} roster/ability vectors`)
