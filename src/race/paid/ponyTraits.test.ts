import { expect, test } from 'bun:test'
import { solvePaidCore, type PaidCoreInput } from './solver.ts'
import { fixtureInput, pickAt } from './testkit.ts'
import { sampleHorse } from './trace.ts'

function inputFor(ponyId: number, picks: number[] = []): PaidCoreInput {
  const roster = [ponyId, ...[0, 1, 2, 3, 4, 5, 6, 7, 8].filter(id => id !== ponyId).slice(0, 4)]
  const deck: number[] = []
  const unused = Array.from({ length: 40 }, (_, i) => i + 1).filter(id => !picks.includes(id))
  for (let k = 0; k < 3; k++) deck.push(picks[k] ?? unused.shift()!, unused.shift()!, unused.shift()!)
  while (deck.length < 14) deck.push(unused.shift()!)
  return { ...fixtureInput({ playerHorseId: 0, playerDeck: deck,
    profiles: Array.from({ length: 5 }, () => ({ base: 1200n, acceleration: 12n, cap: 1800n })) }), roster }
}
function played(pony: number, cards: number[]) {
  let input = inputFor(pony, cards)
  cards.forEach((card, i) => { input = pickAt(input, (i + 1) as 1 | 2 | 3, card) })
  return solvePaidCore(input)
}

test('intrinsic light and ox modifiers are present before obtaining any card', () => {
  const light = solvePaidCore(inputFor(1)), ox = solvePaidCore(inputFor(5))
  expect(sampleHorse(light.trace!, 0, 0n).v).toBe(1296000n)
  expect(ox.trace!.keyframes[0][0].capMilli).toBe(1900000n)
  expect(ox.trace!.keyframes[0][0].stamina.cost).toBe(28800n)
  expect(ox.trace!.keyframes[0][0].stamina.regen).toBe(10000n)
})

test('rare specialist adds its own bonus with card-following expiry, independently of C-04', () => {
  const rare = played(0, [2]), ordinary = played(0, [17])
  const bonus = rare.trace!.instances.filter(i => i.horse === 0 && i.kind === 'bonus' && i.initialP === 1000n)
  expect(bonus).toHaveLength(1)
  expect(bonus[0].plannedEndTau! - bonus[0].startTau).toBe(30000n)
  expect(ordinary.trace!.instances.filter(i => i.horse === 0 && i.kind === 'bonus')).toHaveLength(0)
})

test('C-04 and rare specialist create separate additive bonuses on later automatic rare acquisitions', () => {
  const input = inputFor(0)
  input.playerDeck = [4, 17, 1, 2, 18, 21, 6, 9, 13, 14, 15, 19, 20, 7]
  const result = solvePaidCore(pickAt(input, 1, 4))
  const cards = result.trace!.cards.filter(c => c.horse === 0)
  expect(cards).toHaveLength(3)
  for (const card of cards.slice(1)) {
    const bonuses = result.trace!.instances.filter(i => i.horse === 0 && i.kind === 'bonus' && i.cardId === card.cardId && i.startTau === card.tau)
    expect(bonuses.map(i => i.initialP).sort()).toEqual([1000n, 2000n])
    expect(bonuses[0].plannedEndTau).toBe(bonuses[1].plannedEndTau)
  }
})

test('diversity grants one independent 20s instance per new main function, never renews same type', () => {
  const same = played(3, [17, 18, 1]), different = played(3, [17, 15, 7])
  const buffs = (r: ReturnType<typeof solvePaidCore>) => r.trace!.instances.filter(i => i.horse === 0 && i.kind === 'trait' && i.initialP === 700n)
  expect(buffs(same)).toHaveLength(1)
  expect(buffs(different)).toHaveLength(3)
  for (const inst of buffs(different)) expect(inst.plannedEndTau! - inst.startTau).toBe(20000n)
})

test('equipment duration extends at acquisition but renewal uses the canonical duration', () => {
  const result = played(2, [7, 32])
  const gear = result.trace!.instances.find(i => i.horse === 0 && i.cardId === 7 && i.kind === 'equip')!
  expect(gear.plannedEndTau! - gear.startTau).toBe(48000n)
  const renewal = result.trace!.renewals.find(i => i.instanceId === gear.id)!
  expect(renewal.end - renewal.tau).toBe(40000n)
})

test('airborne trait only adds speed while an airborne source is active', () => {
  const result = played(4, [1]), trace = result.trace!
  const card = trace.cards.find(c => c.horse === 0 && c.cardId === 1)!
  const active = trace.keyframes[0].find(f => f.tau0 === card.tau)!
  expect(active.pBps).toBe(2800n)
  const after = trace.keyframes[0].find(f => f.tau0 === card.tau + 30000n)
  expect(after).toBeDefined()
  expect(after!.pBps).toBe(0n)
})

test('active forfeit grants a trait bonus whereas timeout does not', () => {
  const input = inputFor(6)
  const active = solvePaidCore(pickAt(input, 1, 0)), timedOut = solvePaidCore(input)
  expect(active.trace!.instances.filter(i => i.horse === 0 && i.kind === 'trait' && i.initialP === 1200n)).toHaveLength(1)
  expect(timedOut.trace!.instances.filter(i => i.horse === 0 && i.kind === 'trait')).toHaveLength(0)
})

test('food restores once after immediate supply gain and does not reward passive regeneration', () => {
  const instant = played(7, [15]), periodic = played(7, [14])
  const card = instant.trace!.cards.find(c => c.horse === 0 && c.cardId === 15)!
  const gains = instant.events.filter(e => e.code === 30 && e.horse === 0 && e.tau === card.tau)
  expect(gains.some(e => e.arg === 50000000n)).toBe(true)
  expect(periodic.events.some(e => e.code === 35 && e.horse === 0)).toBe(false)
})

test('repeat rhythm gives a single independent bonus on each later same-function card', () => {
  const result = played(8, [17, 18, 1])
  const bonuses = result.trace!.instances.filter(i => i.horse === 0 && i.kind === 'trait' && i.initialP === 1200n)
  expect(bonuses).toHaveLength(2)
  for (const inst of bonuses) expect(inst.plannedEndTau! - inst.startTau).toBe(20000n)
})
