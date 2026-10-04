import { normalizeRoster, type PonyRoster } from '../race/core/roster.ts'
import { PONY_RULES } from '../race/paid/ponyRules.ts'
import { H } from '../race/core/rng.ts'

/** Reproducible display shuffle for an explicit practice seed; never used by chain randomness. */
export function ponySelectionRng(seed: string): () => number {
  let draw = 0
  return () => H(seed, 'practice.pony-selection', draw++) / 0x1_0000_0000
}

export type PonySelection = { orderedPonyIds: readonly number[]; windowStart: number; selectedPonyId: number | null }
export type PonySelectionAction = { kind: 'scroll' | 'key'; direction: -1 | 1 } | { kind: 'pick'; ponyId: number }
export type PonyMotion = 'none' | 'queue' | 'ring' | 'queueFixedRing'

function availableIds(ids: readonly number[]): number[] {
  const unique = [...new Set(ids)]
  if (unique.length < 5 || unique.some(id => !Number.isInteger(id) || !PONY_RULES.some(p => p.id === id && p.enabled))) throw new Error('INVALID_PONY_SELECTION')
  return unique
}

export function createPonySelection(ids: readonly number[], rng: () => number = Math.random): PonySelection {
  const ordered = availableIds(ids)
  for (let i = ordered.length - 1; i > 0; i--) {
    const draw = rng()
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new Error('INVALID_SELECTION_RNG')
    const j = Math.floor(draw * (i + 1))
    ;[ordered[i], ordered[j]] = [ordered[j]!, ordered[i]!]
  }
  return { orderedPonyIds: Object.freeze(ordered), windowStart: 0, selectedPonyId: null }
}

export function selectionEntry(state: PonySelection): { roster: PonyRoster; playerHorseId: number } | null {
  if (state.selectedPonyId === null) return null
  const visible = state.orderedPonyIds.slice(state.windowStart, state.windowStart + 5)
  const at = visible.indexOf(state.selectedPonyId)
  return at < 0 ? null : { roster: normalizeRoster([...visible].reverse()), playerHorseId: 4 - at }
}

export function reconcilePonySelection(state: PonySelection, ids: readonly number[]): PonySelection {
  const next = availableIds(ids), allowed = new Set(next)
  const ordered = state.orderedPonyIds.filter(id => allowed.has(id))
  ordered.push(...next.filter(id => !ordered.includes(id)))
  if (ordered.length === state.orderedPonyIds.length && ordered.every((id, i) => id === state.orderedPonyIds[i])) return state
  return { orderedPonyIds: Object.freeze(ordered), windowStart: Math.min(state.windowStart, ordered.length - 5),
    selectedPonyId: state.selectedPonyId !== null && allowed.has(state.selectedPonyId) ? state.selectedPonyId : null }
}

export function movePonySelection(state: PonySelection, action: PonySelectionAction): { state: PonySelection; motion: PonyMotion } {
  const ids = state.orderedPonyIds, max = ids.length - 5
  const unchanged = () => ({ state, motion: 'none' as const })
  const at = state.selectedPonyId === null ? -1 : ids.indexOf(state.selectedPonyId)
  if (action.kind === 'pick') {
    const target = ids.indexOf(action.ponyId)
    if (target < state.windowStart || target >= state.windowStart + 5 || action.ponyId === state.selectedPonyId) return unchanged()
    return { state: { ...state, selectedPonyId: action.ponyId }, motion: 'none' }
  }
  if (action.kind === 'scroll') {
    const start = state.windowStart + action.direction
    if (start < 0 || start > max) return unchanged()
    const leaves = at >= 0 && (at < start || at >= start + 5)
    const selectedPonyId = leaves ? ids[at < start ? start : start + 4]! : state.selectedPonyId
    return { state: { ...state, windowStart: start, selectedPonyId }, motion: leaves ? 'queueFixedRing' : 'queue' }
  }
  if (at < 0) return { state: { ...state, selectedPonyId: ids[state.windowStart + 2]! }, motion: 'none' }
  const target = Math.max(0, Math.min(ids.length - 1, at + action.direction))
  const start = target < state.windowStart ? target : target >= state.windowStart + 5 ? target - 4 : state.windowStart
  if (target === at && start === state.windowStart) return unchanged()
  return { state: { ...state, selectedPonyId: ids[target]!, windowStart: start },
    motion: start === state.windowStart ? 'ring' : 'queueFixedRing' }
}

export type PonyInputState = { selection: PonySelection; motion: PonyMotion; serial: number; waiting: PonySelectionAction | null }
export type PonyInputEvent =
  | { type: 'input'; action: PonySelectionAction; reducedMotion: boolean }
  | { type: 'finish'; serial: number }
  | { type: 'available'; ids: readonly number[] }

export function reducePonyInput(state: PonyInputState, event: PonyInputEvent): PonyInputState {
  if (event.type === 'available') {
    const selection = reconcilePonySelection(state.selection, event.ids)
    return selection === state.selection ? state : { selection, motion: 'none', waiting: null, serial: state.serial + 1 }
  }
  if (event.type === 'finish') {
    if (event.serial !== state.serial || state.motion === 'none') return state
    const idle = { ...state, motion: 'none' as const, waiting: null }
    return state.waiting ? reducePonyInput(idle, { type: 'input', action: state.waiting, reducedMotion: false }) : idle
  }
  if (state.motion !== 'none' && !event.reducedMotion) return { ...state, waiting: event.action }
  const next = movePonySelection(state.selection, event.action)
  if (next.state === state.selection && state.motion === 'none') return state
  return { selection: next.state, motion: event.reducedMotion ? 'none' : next.motion, serial: state.serial + 1, waiting: null }
}
