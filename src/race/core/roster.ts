import { PONY_RULES } from '../paid/ponyRules.ts'

export type PonyRoster = readonly [number, number, number, number, number]
export const DEFAULT_ROSTER: PonyRoster = Object.freeze([0, 1, 2, 3, 4])

/** An absent roster is a legacy record. Entry rosters are copied and immutable. */
export function normalizeRoster(value: unknown = DEFAULT_ROSTER): PonyRoster {
  if (!Array.isArray(value) || value.length !== 5 || new Set(value).size !== 5
    || value.some(id => !Number.isInteger(id) || !PONY_RULES.some(rule => rule.id === id && rule.enabled))) {
    throw new Error('INVALID_ROSTER')
  }
  return Object.freeze([...value]) as unknown as PonyRoster
}

export function ponyIdAt(roster: readonly number[] | undefined, raceHorseId: number): number {
  if (!Number.isInteger(raceHorseId) || raceHorseId < 0 || raceHorseId >= 5) throw new Error('INVALID_HORSE')
  return normalizeRoster(roster)[raceHorseId]
}
