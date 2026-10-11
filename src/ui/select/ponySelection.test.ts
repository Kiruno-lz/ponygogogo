import { expect, test } from 'bun:test'
import { createPonySelection, ponySelectionRng, movePonySelection, selectionEntry, reconcilePonySelection, reducePonyInput, type PonyInputState } from './ponySelection.ts'

test('an explicit practice seed fixes the display shuffle and its race identity mapping', () => {
  const ids = [0,1,2,3,4,5,6,7,8]
  const a = createPonySelection(ids,ponySelectionRng('0x00000003'))
  const b = createPonySelection(ids,ponySelectionRng('0x00000003'))
  const c = createPonySelection(ids,ponySelectionRng('0x00000004'))
  expect(a.orderedPonyIds).toEqual(b.orderedPonyIds)
  expect(a.orderedPonyIds).not.toEqual(c.orderedPonyIds)
  const entry = selectionEntry({...a,selectedPonyId:a.orderedPonyIds[2]!})!
  expect(entry.playerHorseId).toBe(2)
  expect(entry.roster[entry.playerHorseId]).toBe(a.orderedPonyIds[2])
})

const create = (n: number) => createPonySelection(Array.from({ length: n }, (_, i) => i), () => .999)
test('queue uses upper lane 5 through lower lane 1 and submits the five visible roles', () => {
  const state = create(6)
  expect(movePonySelection(state, { kind: 'scroll', direction: -1 }).state).toBe(state)
  const next = movePonySelection(state, { kind: 'scroll', direction: 1 }).state
  expect(next.windowStart).toBe(1)
  const selected = movePonySelection(next, { kind: 'pick', ponyId: 5 }).state
  expect(selectionEntry(selected)).toEqual({ roster: [5, 4, 3, 2, 1], playerHorseId: 0 })
  expect(movePonySelection(next, { kind: 'scroll', direction: 1 }).state).toBe(next)
  expect(selectionEntry(state)).toBeNull()
})

test('first arrow key selects third lane, normal keys move only ring, edge keys only shift queue', () => {
  let state = create(6)
  const first = movePonySelection(state, { kind: 'key', direction: 1 })
  expect(first.state.selectedPonyId).toBe(2); expect(first.motion).toBe('none')
  const down = movePonySelection(first.state, { kind: 'key', direction: 1 })
  expect(down.state.selectedPonyId).toBe(3); expect(down.motion).toBe('ring')
  state = movePonySelection(down.state, { kind: 'key', direction: 1 }).state
  const edge = movePonySelection(state, { kind: 'key', direction: 1 })
  expect(edge.state.selectedPonyId).toBe(5); expect(edge.state.windowStart).toBe(1)
  expect(edge.motion).toBe('queueFixedRing')
  expect(movePonySelection(edge.state, { kind: 'key', direction: 1 }).state).toBe(edge.state)
})

test('mouse click has no ring movement; scroll preserves identity except when selected role leaves', () => {
  const initial = create(9)
  const picked = movePonySelection(initial, { kind: 'pick', ponyId: 2 })
  expect(picked.motion).toBe('none')
  const up = movePonySelection(picked.state, { kind: 'scroll', direction: 1 })
  expect(up.state.selectedPonyId).toBe(2); expect(up.motion).toBe('queue')
  const top = movePonySelection(initial, { kind: 'pick', ponyId: 0 }).state
  const leaves = movePonySelection(top, { kind: 'scroll', direction: 1 })
  expect(leaves.state.selectedPonyId).toBe(1); expect(leaves.motion).toBe('queueFixedRing')
  expect(movePonySelection(initial, { kind: 'pick', ponyId: 8 }).state).toBe(initial)
})

test('progress updates append newly owned roles without reshuffling and reset invalid choice', () => {
  const selected = movePonySelection(create(6), { kind: 'pick', ponyId: 5 }).state
  const next = reconcilePonySelection(selected, [8, 7, 6, 5, 4, 3, 2, 1, 0])
  expect(next.orderedPonyIds).toEqual([0, 1, 2, 3, 4, 5, 8, 7, 6])
  const guest = reconcilePonySelection(next, [0, 1, 2, 3, 4])
  expect(guest.selectedPonyId).toBeNull()
  expect(guest.windowStart).toBe(0)
})

test('during motion only last input is kept, stale finish is ignored, reduced motion does not wait', () => {
  let state: PonyInputState = { selection: create(9), motion: 'none', serial: 0, waiting: null }
  state = reducePonyInput(state, { type: 'input', action: { kind: 'scroll', direction: 1 }, reducedMotion: false })
  const serial = state.serial
  state = reducePonyInput(state, { type: 'input', action: { kind: 'key', direction: 1 }, reducedMotion: false })
  state = reducePonyInput(state, { type: 'input', action: { kind: 'pick', ponyId: 4 }, reducedMotion: false })
  expect(reducePonyInput(state, { type: 'finish', serial: serial - 1 })).toBe(state)
  state = reducePonyInput(state, { type: 'finish', serial })
  expect(state.selection.selectedPonyId).toBe(4); expect(state.waiting).toBeNull(); expect(state.motion).toBe('none')
  state = reducePonyInput(state, { type: 'input', action: { kind: 'scroll', direction: 1 }, reducedMotion: true })
  expect(state.selection.windowStart).toBe(2); expect(state.motion).toBe('none')
})
