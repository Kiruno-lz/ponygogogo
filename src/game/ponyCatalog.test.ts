import { expect, test } from 'bun:test'
import { PONY_CATALOG, ponyById, ponyIdAt, normalizeRoster, DEFAULT_ROSTER } from './ponyCatalog.ts'

test('stable catalog identities include nine roles and exactly five defaults', () => {
  expect(PONY_CATALOG.filter(p => p.defaultOpen).map(p => p.ponyId)).toEqual([0, 1, 2, 3, 4])
  expect(ponyById(6).name).toBe('啥马')
  expect(ponyById(7).locomotion).toBe('quadruped')
  expect(ponyById(8).locomotion).toBe('biped')
  expect(ponyById(8).renderSpec.feet).toHaveLength(2)
  expect(ponyById(5).renderSpec.feet).toHaveLength(4)
  expect(() => ponyById(9)).toThrow('INVALID_PONY')
})

test('all 120 initial-five permutations retain five slots and slot to role lookup', () => {
  function permutations(ids: number[]): number[][] {
    return ids.length ? ids.flatMap((id, i) => permutations(ids.filter((_, j) => j !== i)).map(rest => [id, ...rest])) : [[]]
  }
  for (const input of permutations([...DEFAULT_ROSTER])) {
    const roster = normalizeRoster(input)
    expect(roster).toHaveLength(5)
    for (let slot = 0; slot < 5; slot++) expect(ponyIdAt(roster, slot)).toBe(input[slot])
  }
  const mutable = [8, 7, 6, 5, 0]
  const frozen = normalizeRoster(mutable)
  mutable[0] = 4
  expect(frozen[0]).toBe(8)
  expect(Object.isFrozen(frozen)).toBe(true)
  expect(() => ponyIdAt(frozen, 5)).toThrow('INVALID_HORSE')
})
