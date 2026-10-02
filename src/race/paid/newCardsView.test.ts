import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { cardIconUrl } from '../cards/iconUrl.ts'
import { paidCardDef } from '../cards/paidCards.ts'
import { effectsAt, toRaceEvent, tickOf } from '../paidSnapshot.ts'
import { EV_CARD, EV_EQUIP_REFRESH, EV_GUARD, EV_RESOURCE, EV_TRIGGER } from './events.ts'
import { playNewCards } from './testkit.ts'
import { solvePaidCore } from './solver.ts'

const root = new URL('../../..', import.meta.url).pathname
const slow = Array.from({ length: 5 }, () => ({ base: 1000n, acceleration: 0n, cap: 1000n }))
test('all nineteen card faces use distinct, shipped icons and generated descriptions', () => {
  const icons = new Set<string>()
  for (let id = 22; id <= 40; id++) {
    const def = paidCardDef(`C-${id}`)!
    expect(def.name.zh).not.toContain('占位')
    expect(def.desc.zh.length).toBeGreaterThan(8)
    const url = cardIconUrl(def.art.icon); icons.add(url)
    expect(existsSync(root + '/public' + url)).toBe(true)
    expect(readFileSync(root + '/public' + url, 'utf8')).toContain('<svg')
  }
  expect(icons.size).toBe(19)
})
test('equipment refresh updates the HUD deadline only at its actual event', () => {
  const r = solvePaidCore(playNewCards([11, 32], { profiles: slow })), trace = r.trace!
  const wheel = trace.instances.find(i => i.horse === 1 && i.cardId === 11)!
  const renewal = trace.renewals.find(i => i.instanceId === wheel.id)!
  const before = effectsAt(trace, renewal.tau - 1n, []).effects.find(i => i.instanceId === wheel.id)!
  const after = effectsAt(trace, renewal.tau, []).effects.find(i => i.instanceId === wheel.id)!
  expect(before.durationTicks).toBe(1500)
  expect(after.durationTicks! + after.appliedAtTick).toBe(tickOf(renewal.end))
  const event = r.events.find(e => e.code === EV_EQUIP_REFRESH)!
  expect(toRaceEvent(event, trace, 1, r.finishTime)?.type).toBe('cardEffect')
})
test('guard consumption has its own feedback and removes the waiting badge without a death', () => {
  const r = solvePaidCore(playNewCards([2, 37])), trace = r.trace!
  const guard = r.events.find(e => e.code === EV_GUARD)!
  expect(effectsAt(trace, guard.tau - 1n, []).effects.some(i => i.sourceCardId === 'C-37')).toBe(true)
  expect(effectsAt(trace, guard.tau, []).effects.some(i => i.sourceCardId === 'C-37')).toBe(false)
  expect(toRaceEvent(guard, trace, 1, r.finishTime)).toMatchObject({ type: 'cardEffect', kind: 'guard', cardId: 'C-37' })
})
test('resource and mileage feedback use actual solver events and consumed trigger counts', () => {
  const r = solvePaidCore(playNewCards([40, 36], { profiles: slow })), trace = r.trace!
  const step = r.events.find(e => e.code === EV_TRIGGER && e.arg / 256n === 40n)!
  expect(effectsAt(trace, step.tau, []).effects.find(i => i.sourceCardId === 'C-40')?.payload.stacks).toBe(1)
  expect(toRaceEvent(step, trace, 1, r.finishTime)).toMatchObject({ type: 'cardEffect', kind: 'trigger', cardId: 'C-40', value: 1 })
  const resource = r.events.find(e => e.code === EV_RESOURCE)!
  expect(toRaceEvent(resource, trace, 1, r.finishTime)).toMatchObject({ type: 'cardEffect', kind: 'resource', value: Number(resource.arg) / 1e6 })
  expect(r.events.some(e => e.code === EV_CARD && e.arg === 36n)).toBe(true)
})

test('Coat of Many Colors presents only the current coat after the green dye', () => {
 const r=solvePaidCore(playNewCards([19,29,20])), trace=r.trace!
 const dye=r.events.find(e=>e.code===EV_CARD&&e.horse===1&&e.arg===20n)!
 const old=effectsAt(trace,dye.tau-1n,[]).effects.filter(i=>i.ownerHorseId===1&&i.payload.statusId==='coat')
 const current=effectsAt(trace,dye.tau,[]).effects.filter(i=>i.ownerHorseId===1&&i.payload.statusId==='coat')
 expect(old.map(i=>i.sourceCardId)).toEqual(['C-19'])
 expect(current.map(i=>i.sourceCardId)).toEqual(['C-20'])
})
