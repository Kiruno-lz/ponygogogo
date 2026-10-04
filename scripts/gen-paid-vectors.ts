/**
 * Cross-language vectors for paid ruleset v4 (docs/plan/onchain-services.md 「有奖规则 v4」).
 * The Solidity solver must reproduce every field of tests/vectors/paid-race-v4.json bit for bit.
 *
 *   bun scripts/gen-paid-vectors.ts          # (re)write the file
 *   bun scripts/gen-paid-vectors.ts --check  # fail when the file differs from a fresh solve
 *
 * Deterministic: every random choice comes from keccak256 of a fixed label; no clock, no Math.random. Cases that pin
 * a CHOICE_INVALID reason assert it (and its equivalence to an absent choice) while generating.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { keccak256, toBytes, type Hex } from 'viem'
import type { PaidTier } from '../src/race/core/paidProfiles.ts'
import {
  EV_BOMB_PLACE, EV_CHOICE_INVALID, INVALID_AFTER_FINISH, INVALID_AUTO, INVALID_BAD_SLOT, INVALID_CUT, INVALID_EARLY,
  INVALID_LATE, INVALID_NO_CREDIT, INVALID_NOT_OFFERED, INVALID_NOT_OPENED, PAID_CHOICE_INVALID_NAMES, PAID_EVENT_NAMES,
} from '../src/race/paid/events.ts'
import { LEGACY_PAID_RULESET_HASH } from '../src/race/paid/cardRules.ts'
import { derivePaidCoreInput } from '../src/race/paid/race.ts'
import { solvePaidCore, type PaidChoiceSlot, type PaidCoreInput, type PaidCoreProfile } from '../src/race/paid/solver.ts'
import {
  FIXTURE_SEED, fixtureAnchor, fixtureInput, fixtureProfiles, ignoredChoice, pickAt, playNewCards, QUIET_DECK, withSlot,
} from '../src/race/paid/testkit.ts'
import { solveVectorCase, type PaidVectorCase } from '../src/race/paid/vectorCodec.ts'

const OUT = new URL('../tests/vectors/paid-race-v4.json', import.meta.url)
const GENERATOR_LABEL = 'ponygogogo/paid-vectors/v3'

function rng(label: string) {
  let counter = 0
  return {
    below(n: number): number {
      return Number(BigInt(keccak256(toBytes(`${GENERATOR_LABEL}/${label}/${counter++}`))) % BigInt(n))
    },
    hash(): Hex {
      return keccak256(toBytes(`${GENERATOR_LABEL}/${label}/hash/${counter++}`))
    },
  }
}

/** Random legal choices: each txSec lies in the canonical window and the panel is still open at that second. */
function randomChoices(input: PaidCoreInput, label: string): PaidCoreInput {
  const r = rng(label)
  let current = input
  for (const k of [1, 2, 3] as const) {
    const stop = solvePaidCore(current, { stopAtPanel: k, trace: false })
    if (stop.panel === null || stop.panel.mode !== 'manual') continue
    const roll = r.below(10)
    if (roll === 0) continue
    const txSec = stop.panel.openSec + BigInt(r.below(20))
    const refreshSlots = stop.panel.drawState.refreshCredits > 0 && r.below(2) === 0 ? [r.below(3)] : []
    const offer = [...stop.panel.candidates]
    let tail = stop.panel.drawState.tailCursor
    for (const s of refreshSlots) offer[s] = current.playerDeck[--tail]!
    const slot: PaidChoiceSlot = { txSec, cardId: roll === 1 ? 0 : offer[r.below(3)]!, refreshSlots, anchor: r.hash() }
    const probe = solvePaidCore(current, { untilWall: txSec * 1000n, trace: false })
    if (probe.panel?.checkpoint !== k) continue
    current = withSlot(current, k, slot)
  }
  return current
}

/**
 * 有奖规则 v3 fuzz: arbitrary stored choices as PonyGame.chooseCard accepts them (any txSec, cardId 0..40, 0–3 refresh
 * slots 0..2 with repeats, any checkpoint subset). Seconds: 5/8 inside [open − 2, open + 22], 1/8 on the window edges
 * (open − 1, open + 19, open + 20), 1/8 in [0, 200), 1/8 anywhere in uint32; half without refreshes; two thirds of the
 * cards from the current offer. `open` is the panel's canonical openSec given the earlier stored choices.
 */
function fuzzChoices(input: PaidCoreInput, label: string): PaidCoreInput {
  const r = rng(label)
  let current = input
  for (const k of [1, 2, 3] as const) {
    if (r.below(4) === 0) continue
    const stop = solvePaidCore(current, { stopAtPanel: k, trace: false })
    const open = stop.panel !== null && stop.panel.openSec > 0n ? stop.panel.openSec : BigInt(20 * k)
    const mode = r.below(8)
    let txSec: bigint
    if (mode < 5) txSec = open - 2n + BigInt(r.below(25))
    else if (mode === 5) txSec = open + [-1n, 19n, 20n][r.below(3)]!
    else if (mode === 6) txSec = BigInt(r.below(200))
    else txSec = BigInt(r.below(2 ** 32))
    if (txSec < 0n) txSec = 0n
    const refreshSlots = r.below(2) === 0 ? [] : Array.from({ length: 1 + r.below(3) }, () => r.below(3))
    const offer = stop.panel?.candidates ?? []
    const cardId = r.below(3) !== 0 && offer.length === 3 ? [0, ...offer][r.below(4)]! : r.below(41)
    current = withSlot(current, k, { txSec, cardId, refreshSlots, anchor: r.hash() })
  }
  return current
}

/** A 14-card deck with C-05 offered first, and C-04/C-03 somewhere in the first nine cards or absent. */
function fuzzDeck(label: string): number[] {
  const r = rng(label)
  const pool = Array.from({ length: 40 }, (_, i) => i + 1).filter((c) => c !== 3 && c !== 4 && c !== 5)
  const deck: number[] = []
  while (deck.length < 14) deck.push(pool.splice(r.below(pool.length), 1)[0]!)
  deck[r.below(3)] = 5
  for (const special of [4, 3]) {
    const at = r.below(12)
    if (at < 9 && deck[at] !== 5) deck[at] = special
  }
  return [...new Set(deck), ...pool].slice(0, 14)
}

function deckFront(front: number[]): number[] {
  return [...front, ...QUIET_DECK.filter((c) => !front.includes(c))].slice(0, 14)
}

function profilesWith(patch: Record<number, PaidCoreProfile>): PaidCoreProfile[] {
  const profiles = fixtureProfiles()
  for (const [h, p] of Object.entries(patch)) profiles[Number(h)] = p
  return profiles
}

type FuzzStats = { choices: number; valid: number; reasons: Record<string, number>; notEquivalent: string[] }

function build(stats: FuzzStats): PaidVectorCase[] {
  const cases: PaidVectorCase[] = []
  const add = (name: string, input: PaidCoreInput, stopAtPanel?: 1 | 2 | 3) => {
    cases.push(solveVectorCase(name, input, stopAtPanel))
  }
  /** Adds a case whose choice k must be ignored for `reason` exactly like an absent choice. */
  const addInvalid = (name: string, input: PaidCoreInput, k: 1 | 2 | 3, reason: number) => {
    const got = ignoredChoice(input, k)
    if (got?.reason !== reason || !got.equivalent) {
      throw new Error(`${name}: expected ${PAID_CHOICE_INVALID_NAMES[reason]} ignored, got ${JSON.stringify(got)}`)
    }
    add(name, input)
  }
  const at = (input: PaidCoreInput, k: 1 | 2 | 3, txSec: bigint, cardId = 0, refreshSlots: number[] = []) =>
    withSlot(input, k, { txSec, cardId, refreshSlots, anchor: fixtureAnchor(0xa0 + k) })
  const openSecOf = (input: PaidCoreInput, k: 1 | 2 | 3) => solvePaidCore(input, { trace: false }).checkpoints[k - 1]!.openSec

  // Derived races: opening-anchor personalities and decks with random legal choices.
  for (let i = 0; i < 80; i++) {
    const r = rng(`derived/${i}`)
    const core = derivePaidCoreInput({
      seed: r.hash(), openAnchor: r.hash(), stakeTier: (i % 4 + 1) as PaidTier, playerHorseId: i % 5, choices: [null, null, null],
    })
    add(`derived-${i}`, randomChoices(core, `derived/${i}/choices`))
  }

  // Every card on the player (picked at a varying checkpoint) and on a CPU (at a varying checkpoint).
  for (let card = 1; card <= 40; card++) {
    const k = ([3, 4, 5].includes(card) ? 1 : card % 3 + 1) as 1 | 2 | 3
    const front = QUIET_DECK.filter((c) => c !== card).slice(0, 8)
    front.splice(3 * (k - 1), 0, card)
    const playerInput = pickAt(fixtureInput({ playerDeck: deckFront(front.slice(0, 9)) }), k, card, { anchor: fixtureAnchor(0x40 + card) })
    add(`card-${card}-player-cp${k}`, playerInput)
    const horse = [0, 2, 3, 4][card % 4]!
    const cpuDeck = [19, 20, 5].filter((c) => c !== card).slice(0, 2)
    cpuDeck.splice(card % 3, 0, card)
    add(`card-${card}-cpu${horse}-cp${card % 3 + 1}`, fixtureInput({ cpu: { [horse]: cpuDeck } }))
  }

  // Hazards and interactions.
  add('bombs-two-placers-respawn-immunity', fixtureInput({ cpu: { 0: [6, 20, 5], 2: [6, 20, 5] } }))
  add('bombs-airborne-passes', fixtureInput({ profiles: profilesWith({ 3: { base: 1_000n, acceleration: 10n, cap: 1_500n } }),
    cpu: { 4: [19, 6, 20], 3: [1, 20, 5] } }))
  add('bombs-blinded-pro-immune', pickAt(fixtureInput({ playerDeck: deckFront([21]), cpu: { 4: [19, 6, 20] } }), 1, 21))
  add('death-resets-k', fixtureInput({ cpu: { 0: [2, 17, 20] } }))
  add('gravity-multi-well', fixtureInput({ cpu: { 0: [10, 20, 5], 2: [10, 20, 5], 3: [19, 10, 20] } }))
  add('gravity-owner-finishes', fixtureInput({ profiles: profilesWith({ 0: { base: 3_000n, acceleration: 0n, cap: 3_000n } }),
    cpu: { 0: [19, 20, 10] } }))
  add('gravity-well-stolen', pickAt(fixtureInput({ playerDeck: deckFront([17, 18, 21, 13]), cpu: { 2: [19, 10, 20], 0: [10, 20, 5] } }),
    2, 13, { anchor: fixtureAnchor(0x61) }))
  add('swap-early-finish', pickAt(fixtureInput({ profiles: profilesWith({ 0: { base: 5_150n, acceleration: 0n, cap: 5_150n } }),
    playerDeck: deckFront([9]) }), 1, 9, { anchor: fixtureAnchor(0) }))
  add('swap-finished-target', fixtureInput({ cpu: { 3: [19, 20, 9] } }))
  add('swap-immune-owner', fixtureInput({ cpu: { 0: [21, 9, 20] } }))
  add('swap-immune-target', pickAt(fixtureInput({ playerDeck: deckFront([21]), cpu: { 3: [9, 20, 5] } }), 1, 21))
  add('wheel-stolen', fixtureInput({ cpu: { 0: [11, 20, 5], 2: [19, 13, 20] } }))
  add('wind-replaced', fixtureInput({ cpu: { 4: [12, 20, 5], 0: [1, 20, 5], 3: [19, 12, 20] } }))
  add('wind-blinded-pro-own', pickAt(pickAt(pickAt(fixtureInput({ playerDeck: [21, 17, 18, 11, 14, 15, 12, 16, 20, 19, 1, 2, 6, 7],
    cpu: { 4: [12, 20, 5] } }), 1, 21), 2, 11), 3, 12, { anchor: fixtureAnchor(0x53) }))
  add('steal-ordering', pickAt(pickAt(fixtureInput({ playerDeck: [17, 18, 21, 13, 14, 15, 20, 19, 1, 2, 6, 7, 8, 10],
    cpu: { 0: [7, 20, 5], 2: [8, 20, 5], 3: [11, 20, 5] } }), 1, 0), 2, 13, { anchor: fixtureAnchor(0x52) }))
  add('equip-replaced-same-slot', fixtureInput({ cpu: { 0: [7, 10, 20] } }))

  // Draw rules and time mapping.
  add('draw-c03-cut', pickAt(fixtureInput({ playerDeck: deckFront([3]) }), 1, 3))
  add('draw-c04-auto-bonus', pickAt(fixtureInput({ playerDeck: deckFront([4, 17, 18, 19, 14, 15, 20]) }), 1, 4, { anchor: fixtureAnchor(0x41) }))
  add('draw-c04-cpu-bonus-loot', fixtureInput({ cpu: { 0: [4, 7, 13], 2: [8, 19, 20] } }))
  const treasure = pickAt(fixtureInput({ playerDeck: [5, 17, 21, 14, 15, 16, 20, 19, 1, 2, 6, 7, 8, 18] }), 1, 5)
  add('draw-c05-refresh-tail', pickAt(treasure, 2, 18, { refreshSlots: [1], delaySec: 7n }))
  add('draw-c05-then-c04', pickAt(pickAt(fixtureInput({ playerDeck: [5, 17, 21, 4, 14, 15, 20, 19, 1, 2, 6, 7, 8, 18] }), 1, 5), 2, 4))
  const fast = fixtureInput({ profiles: profilesWith({ 1: { base: 14_000n, acceleration: 0n, cap: 14_000n } }) })
  add('panel-deferral-finish-inside', fast)
  add('panel-deferral-choice', pickAt(fast, 2, 0, { delaySec: 1n }))
  const faster = fixtureInput({ profiles: profilesWith({ 1: { base: 30_000n, acceleration: 0n, cap: 30_000n } }) })
  add('panel-double-deferral', faster)
  add('panel-double-deferral-cut', pickAt({ ...faster, playerDeck: deckFront([3]) }, 1, 3, { delaySec: 19n }))
  add('choice-last-second', withSlot(fixtureInput(), 1, { txSec: 39n, cardId: 0, refreshSlots: [], anchor: fixtureAnchor(1) }))

  // Stamina.
  const slowCpu = (p: PaidCoreProfile, deck: number[]) => fixtureInput({ profiles: profilesWith({ 0: p }), cpu: { 0: deck } })
  add('stamina-exhaust-cycle', slowCpu({ base: 200n, acceleration: 2n, cap: 600n }, [5, 19, 20]))
  add('stamina-rocket', slowCpu({ base: 300n, acceleration: 3n, cap: 500n }, [7, 19, 20]))
  add('stamina-regen', slowCpu({ base: 300n, acceleration: 3n, cap: 500n }, [14, 19, 20]))
  add('stamina-overcap', slowCpu({ base: 5_000n, acceleration: 0n, cap: 5_000n }, [15, 19, 20]))
  add('stamina-adrenaline-exhausted', slowCpu({ base: 100n, acceleration: 1n, cap: 200n }, [15, 19, 20]))
  add('stamina-wired-zero', slowCpu({ base: 330n, acceleration: 1n, cap: 500n }, [16, 19, 20]))
  add('stamina-wired-exhausted', slowCpu({ base: 250n, acceleration: 2n, cap: 400n }, [16, 19, 20]))

  // Settlement and long races.
  const versionDeck = [17, 18, 14, 19, 15, 16, 21, 5, 20, 1, 2, 6, 7, 8]
  add('version-answer', pickAt(pickAt(pickAt(fixtureInput({ playerDeck: versionDeck }), 1, 17), 2, 19), 3, 21))
  add('version-answer-missing-piece', pickAt(pickAt(fixtureInput({ playerDeck: versionDeck }), 1, 17), 2, 19))
  add('limit-unfinished-horse', fixtureInput({ profiles: profilesWith({ 2: { base: 0n, acceleration: 0n, cap: 0n } }) }))
  add('worst-chaos-bombs-deaths-swaps', pickAt(pickAt(fixtureInput({ playerDeck: [6, 17, 18, 2, 21, 14, 9, 15, 20, 19, 1, 7, 8, 10],
    cpu: { 0: [6, 2, 9], 2: [6, 9, 2], 3: [2, 6, 9], 4: [9, 2, 6] } }), 1, 6), 2, 2))
  add('worst-gravity-steals', pickAt(pickAt(pickAt(fixtureInput({ playerDeck: [10, 17, 18, 13, 21, 14, 16, 15, 20, 19, 1, 2, 6, 7],
    cpu: { 0: [10, 13, 7], 2: [13, 10, 8], 3: [10, 16, 13], 4: [11, 10, 13] } }), 1, 10), 2, 13), 3, 16))
  const slowest = { base: 1_120n, acceleration: 10n, cap: 1_700n }
  add('worst-slow-tier-deaths-wells', pickAt(pickAt(fixtureInput({
    profiles: profilesWith({ 0: slowest, 2: slowest, 3: slowest, 4: slowest }),
    playerDeck: [6, 17, 18, 10, 21, 14, 13, 15, 20, 19, 1, 2, 7, 8],
    cpu: { 0: [10, 2, 6], 2: [2, 10, 12], 3: [1, 6, 10], 4: [11, 13, 10] },
  }), 1, 6), 2, 10))
  // Adversarial gas cases (P3). Field time: every horse holds C-10 and C-13 (steals refresh a well for a full 10 s),
  // bombs and a death spread the horses so the wells rarely overlap; tier-3 personalities, CPU-eligible CPU decks.
  // Found by a seeded search maximising stepCount; the fixed 100s field-work benchmark is 400 steps at 250ms (not a v4 worst-case proof).
  const tier3 = (base: bigint, acceleration: bigint, cap: bigint): PaidCoreProfile => ({ base, acceleration, cap })
  add('worst-field-time-wells-steals', pickAt(pickAt(pickAt(fixtureInput({
    playerHorseId: 4,
    profiles: [tier3(1_279n, 12n, 1_953n), tier3(1_293n, 12n, 1_932n), tier3(1_265n, 15n, 1_915n), tier3(1_320n, 14n, 1_869n),
      tier3(1_200n, 12n, 1_800n)],
    playerDeck: [10, 7, 14, 17, 13, 16, 3, 21, 12, 18, 15, 6, 2, 4],
    cpu: { 0: [13, 6, 10], 1: [6, 13, 10], 2: [15, 10, 12], 3: [2, 13, 10] },
  }), 1, 10, { delaySec: 2n, anchor: fixtureAnchor(0x71) }), 2, 13, { delaySec: 17n, anchor: fixtureAnchor(0x72) }),
  3, 3, { delaySec: 5n, anchor: fixtureAnchor(0x73) }))
  // All five horses carry a well at once (the owner-list maximum).
  add('worst-five-wells-overlap', pickAt(pickAt(fixtureInput({ playerDeck: [10, 17, 18, 13, 21, 14, 15, 20, 19, 1, 2, 6, 7, 8],
    cpu: { 0: [10, 13, 19], 2: [10, 13, 20], 3: [10, 13, 5], 4: [10, 13, 19] } }), 1, 10, { anchor: fixtureAnchor(0x81) }),
  2, 13, { anchor: fixtureAnchor(0x82) }))
  // Event count: every horse holds a swap, a bomb and a death (explicit decks; C-09 is only reachable that way), slow
  // tier-1 personalities. Found by a seeded search maximising eventCount; 15 card applications bound it far below 4096.
  const tier1 = (base: bigint, acceleration: bigint, cap: bigint): PaidCoreProfile => ({ base, acceleration, cap })
  add('worst-event-count-explicit-decks', pickAt(pickAt(pickAt(fixtureInput({
    playerHorseId: 0,
    profiles: [tier1(1_200n, 12n, 1_800n), tier1(1_153n, 16n, 1_742n), tier1(1_152n, 15n, 1_750n), tier1(1_135n, 15n, 1_821n),
      tier1(1_229n, 13n, 1_738n)],
    playerDeck: [9, 21, 14, 2, 15, 16, 6, 5, 20, 19, 17, 18, 11, 13],
    cpu: { 1: [9, 2, 6], 2: [9, 6, 2], 3: [9, 6, 2], 4: [6, 2, 9] },
  }), 1, 9, { delaySec: 18n, anchor: fixtureAnchor(0x91) }), 2, 2, { delaySec: 15n, anchor: fixtureAnchor(0x92) }),
  3, 6, { delaySec: 12n, anchor: fixtureAnchor(0x93) }))

  // Adversarial maximum gas (有奖规则 v3 gas gate): a seeded hill climb from worst-field-time-wells-steals over legal
  // inputs (tier-3 personality ranges, CPU-eligible CPU decks, valid choices), scored by a gas model fitted to engine
  // measurements. Event-split well steps are part of the one solve Foundry measures; the heaviest vector by gas.
  add('worst-gas-adversarial-climb', {
    playerHorseId: 4,
    profiles: [tier3(1_284n, 13n, 1_940n), tier3(1_293n, 12n, 1_882n), tier3(1_265n, 15n, 1_956n), tier3(1_320n, 14n, 1_867n),
      tier3(1_200n, 12n, 1_800n)],
    playerDeck: [18, 14, 10, 13, 3, 12, 4, 6, 2, 21, 16, 17, 7, 15],
    cpuDecks: [[15, 6, 10], [6, 10, 13], [18, 10, 13], [2, 13, 10], [5, 19, 20]],
    seed: '0xb01a19fde1bc0ed4e5a250147395996a9e37ecfb91ffbab76643ab874cf9935d',
    openAnchor: '0x1a060cdf50dc1c1995c8e23e8fe9de2d374037b60cc9236b84b5ef1a25d4ce64',
    choices: [
      { txSec: 22n, cardId: 10, refreshSlots: [], anchor: '0x6f0091901a74bd7435ce919b8eeb8c59c931addc6e18f8fb5f33161524d896d7' },
      { txSec: 106n, cardId: 13, refreshSlots: [], anchor: '0xd59a0cd1538b7c7e791694e402c27e7e699e998a53befb3e2fb91f96fc64a7b2' },
      { txSec: 259n, cardId: 6, refreshSlots: [], anchor: '0x794d4a7317fa89e6314e9270720b4d977531fa995d54a0254fe61e9ddc3ba723' },
    ],
  })

  // New-card interaction traces exercise consumed listeners, phase changes and equipment identities.
  const newPairs = [[7,25],[7,26,16],[1,27],[28,1],[19,29,20],[7,8,30],[31,7,8],[11,32],[8,33],[2,37],[2,38],[39,0],[40],[22,24],[31,7,32],[15,36],[38,2],[19,20,39],[19,40],[19,20,40],[40,9]]
  for (const ids of newPairs) add(`new-build-${ids.join('-')}`, playNewCards(ids))
  for (const ids of [[11,32],[22,24],[40],[31,7,8]]) add(`new-slow-build-${ids.join('-')}`, playNewCards(ids, {
    profiles: Array.from({ length: 5 }, () => ({ base: 1000n, acceleration: 0n, cap: 1000n })),
  }))

  add('new-fast-feast-overcap', playNewCards([15,36], {profiles:Array.from({length:5},()=>({base:6000n,acceleration:0n,cap:6000n}))}))
  add('new-two-airborne-sources', playNewCards([1,11,27], {profiles:Array.from({length:5},()=>({base:3000n,acceleration:0n,cap:3000n}))}))
  const collisionProfiles=Array.from({length:5},()=>({base:1000n,acceleration:0n,cap:1000n}))
  collisionProfiles[0]={base:1300n,acceleration:0n,cap:1300n};collisionProfiles[2]={base:1300n,acceleration:0n,cap:1300n}
  add('new-guard-block-no-death-reward',playNewCards([37,38],{profiles:collisionProfiles,cpu:{0:[19,20,6]}}))
  add('new-guard-second-bomb-same-ms',playNewCards([37,38],{profiles:collisionProfiles,cpu:{0:[19,20,6],2:[19,20,6]}}))

  // Panel stops: what chooseCard validation needs at each checkpoint.
  const chosen = pickAt(pickAt(fixtureInput({ playerDeck: [7, 17, 18, 1, 21, 14, 11, 15, 20, 19, 2, 6, 8, 10] }), 1, 7), 2, 1)
  add('panel-stop-cp1', chosen, 1)
  add('panel-stop-cp2', chosen, 2)
  add('panel-stop-cp3', chosen, 3)
  add('panel-stop-auto-cp2', pickAt(fixtureInput({ playerDeck: deckFront([4, 17, 18, 19, 14, 15, 20]) }), 1, 4, { anchor: fixtureAnchor(0x41) }), 2)
  add('panel-stop-cut-cp3', pickAt(fixtureInput({ playerDeck: deckFront([3]) }), 1, 3), 3)
  add('panel-stop-refresh-credit-cp2', treasure, 2)

  // 有奖规则 v3: every CHOICE_INVALID reason. The stored choice counts as no transaction at that checkpoint.
  const quiet = fixtureInput()
  const stalled = fixtureInput({ profiles: profilesWith({ 1: { base: 0n, acceleration: 0n, cap: 0n } }) })
  addInvalid('invalid-not-opened-unreached', at(at(stalled, 1, 20n), 3, 90n, 7), 1, INVALID_NOT_OPENED)
  addInvalid('invalid-not-opened-deferred-finish', at(faster, 3, openSecOf(faster, 1) + 5n), 3, INVALID_NOT_OPENED)
  addInvalid('invalid-early', at(quiet, 1, 19n), 1, INVALID_EARLY)
  addInvalid('invalid-early-zero-second', at(quiet, 2, 0n, 19), 2, INVALID_EARLY)
  addInvalid('invalid-late', at(quiet, 1, 40n), 1, INVALID_LATE)
  addInvalid('invalid-late-uint32-max', at(quiet, 1, 0xffff_ffffn, 18), 1, INVALID_LATE)
  addInvalid('invalid-after-finish', at(fast, 3, openSecOf(fast, 3) + 19n), 3, INVALID_AFTER_FINISH)
  // The player's first panel opens at τ 599118 (openSec 600) and wall(600000) = 607938: second 607 closes at τ 599906,
  // second 610 would close after τ 600000, so the race ends with the panel open and the choice unused.
  const lateOpen = fixtureInput({ playerDeck: deckFront([19, 20, 5]), profiles: profilesWith({ 1: { base: 40n, acceleration: 1n, cap: 47n } }) })
  addInvalid('invalid-after-finish-race-end', at(lateOpen, 1, 610n), 1, INVALID_AFTER_FINISH)
  add('choice-last-valid-second-before-race-end', at(lateOpen, 1, 607n, 20))
  const auto = pickAt(fixtureInput({ playerDeck: deckFront([4, 17, 18, 19, 14, 15, 20]) }), 1, 4, { anchor: fixtureAnchor(0x41) })
  addInvalid('invalid-auto', at(auto, 2, openSecOf(auto, 2), 19), 2, INVALID_AUTO)
  const cutAt1 = pickAt(fixtureInput({ playerDeck: deckFront([3]) }), 1, 3)
  addInvalid('invalid-cut', at(cutAt1, 3, 80n, 20), 3, INVALID_CUT)
  addInvalid('invalid-no-credit', at(quiet, 1, 22n, 18, [0]), 1, INVALID_NO_CREDIT)
  const creditOpen = openSecOf(treasure, 2)
  addInvalid('invalid-no-credit-repeated-slot', at(treasure, 2, creditOpen, 18, [1, 1]), 2, INVALID_NO_CREDIT)
  addInvalid('invalid-bad-slot', at(treasure, 2, creditOpen, 15, [3]), 2, INVALID_BAD_SLOT)
  addInvalid('invalid-bad-slot-uint8-max', at(treasure, 2, creditOpen, 255, [255]), 2, INVALID_BAD_SLOT)
  addInvalid('invalid-not-offered', at(treasure, 2, creditOpen, 15, [1]), 2, INVALID_NOT_OFFERED)
  addInvalid('invalid-not-offered-card-255', at(quiet, 1, 25n, 255), 1, INVALID_NOT_OFFERED)
  // An ignored choice leaves no autopick anchor behind: the C-04 panel after it draws from the last valid choice.
  const deck4 = [17, 18, 21, 4, 14, 15, 20, 19, 1, 2, 6, 7, 8, 10]
  const lateThenAuto = pickAt(at(fixtureInput({ playerDeck: deck4 }), 1, 45n, 17), 2, 4, { anchor: fixtureAnchor(0x42) })
  addInvalid('invalid-then-c04-autopick-anchor', lateThenAuto, 1, INVALID_LATE)
  add('invalid-every-checkpoint', at(at(at(quiet, 1, 5n, 1), 2, 45n, 19, [2, 2]), 3, 0xffff_ffffn, 0))
  add('panel-stop-after-invalid-cp2', at(quiet, 1, 40n, 17), 2)

  // Bomb cap: all five horses place C-06, 5 × 4 lanes = MAX_BOMBS (20) exactly.
  const bombCap = pickAt(fixtureInput({ playerDeck: deckFront([6]), cpu: { 0: [6, 20, 5], 2: [19, 6, 20], 3: [19, 20, 6], 4: [6, 19, 20] } }), 1, 6)
  if (solvePaidCore(bombCap, { trace: false }).events.filter((e) => e.code === EV_BOMB_PLACE).length !== 20) {
    throw new Error('bombs-cap-five-placers: expected 20 bomb placements')
  }
  add('bombs-cap-five-placers', bombCap)

  // Fuzz families (有奖规则 v3): derived races and C-05/C-04/C-03 decks with arbitrary stored choices.
  const fuzz: [string, PaidCoreInput][] = []
  for (let i = 0; i < 64; i++) {
    const r = rng(`fuzz/derived/${i}`)
    const core = derivePaidCoreInput({
      seed: r.hash(), openAnchor: r.hash(), stakeTier: (i % 4 + 1) as PaidTier, playerHorseId: (i + 2) % 5, choices: [null, null, null],
    })
    fuzz.push([`fuzz-derived-${i}`, fuzzChoices(core, `fuzz/derived/${i}/choices`)])
  }
  for (let i = 0; i < 32; i++) {
    const r = rng(`fuzz/draw/${i}`)
    const core = fixtureInput({ playerDeck: fuzzDeck(`fuzz/draw/${i}/deck`), seed: r.hash(), openAnchor: r.hash() })
    fuzz.push([`fuzz-draw-${i}`, fuzzChoices(core, `fuzz/draw/${i}/choices`)])
  }
  for (const [name, input] of fuzz) {
    add(name, input)
    const r = solvePaidCore(input, { trace: false })
    for (const k of [1, 2, 3] as const) {
      if (input.choices[k - 1] === null) continue
      stats.choices++
      const reason = r.checkpoints[k - 1]!.invalidReason
      if (reason === 0) {
        stats.valid++
        continue
      }
      const label = PAID_CHOICE_INVALID_NAMES[reason]!
      stats.reasons[label] = (stats.reasons[label] ?? 0) + 1
      if (!ignoredChoice(input, k)!.equivalent) stats.notEquivalent.push(`${name} cp${k} ${label}`)
    }
    const logged = r.events.filter((e) => e.code === EV_CHOICE_INVALID).length
    if (logged !== r.checkpoints.filter((c) => c.invalidReason !== 0).length) throw new Error(`${name}: CHOICE_INVALID count`)
  }
  return cases
}

function render(cases: PaidVectorCase[]): string {
  const meta = {
    rulesetHash: LEGACY_PAID_RULESET_HASH,
    generator: `scripts/gen-paid-vectors.ts (${GENERATOR_LABEL})`,
    fixtureSeed: FIXTURE_SEED,
    units: 'tau/wall ms; pos/dist µu (L = 1e11); b mu/s; stamina µ (cap 1e9); bigints are decimal strings',
    digest: 'keccak256(abi.encode(bytes32 digest, uint8 code, uint32 tau, uint8 horse, int256 arg)) from bytes32(0)',
    eventCodes: PAID_EVENT_NAMES,
    count: cases.length,
  }
  return `{"meta":${JSON.stringify(meta)},\n"cases":[\n${cases.map((c) => JSON.stringify(c)).join(',\n')}\n]}\n`
}

const stats: FuzzStats = { choices: 0, valid: 0, reasons: {}, notEquivalent: [] }
const text = render(build(stats))
console.log(`fuzz stored choices: ${stats.choices} (${stats.valid} valid), ignored by reason ${JSON.stringify(stats.reasons)}`)
if (stats.notEquivalent.length > 0) console.log(`ignored but not identical to an absent choice: ${stats.notEquivalent.join('; ')}`)
if (process.argv.includes('--check')) {
  const onDisk = readFileSync(OUT, 'utf8')
  if (onDisk !== text) {
    console.error('paid-race-v4.json is stale: run bun scripts/gen-paid-vectors.ts')
    process.exit(1)
  }
  console.log('paid-race-v4.json matches the reference solver')
} else {
  writeFileSync(OUT, text)
  console.log(`wrote ${OUT.pathname} (${text.length} bytes)`)
}
