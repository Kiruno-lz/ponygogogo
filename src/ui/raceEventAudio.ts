import type { RaceEvent } from '../race/core/types.ts'

const RACE_EVENT_SOUNDS: Partial<Record<RaceEvent['type'], string>> = {
  explosion: 'audio.sfx_explosion',
  death: 'audio.sfx_exhaust_enter',
  swap: 'audio.sfx_swap',
  equipOn: 'audio.sfx_equip',
  checkpoint: 'audio.sfx_checkpoint',
  exhaustEnter: 'audio.sfx_exhaust_enter',
  exhaustExit: 'audio.sfx_exhaust_exit',
  cardPicked: 'audio.sfx_card_pick',
  steal: 'audio.sfx_equip',
  wind: 'audio.sfx_card_refresh',
}

export function raceEventSound(type: RaceEvent['type']): string | undefined {
  return RACE_EVENT_SOUNDS[type]
}

export function raceEventSounds(events: readonly RaceEvent[]): string[] {
  const sounds: string[] = []
  let equipmentSoundUsed = false
  for (const event of events) {
    const sound = raceEventSound(event.type)
    if (!sound) continue
    if (sound === 'audio.sfx_equip') {
      if (equipmentSoundUsed) continue
      equipmentSoundUsed = true
    }
    sounds.push(sound)
  }
  return sounds
}

/** Preserve the existing top-two celebration rule; only the player triggers it. */
export function finishJingle(rank: number): string {
  return rank > 0 && rank <= 2 ? 'audio.jingle_win' : 'audio.jingle_lose'
}
