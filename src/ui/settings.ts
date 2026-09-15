import { DEFAULT_AUDIO, type AudioSettings } from '../assets/audio.ts'
import type { Lang } from './i18n.ts'

export interface GameSettings extends AudioSettings {
  lang: Lang
  reducedMotion: boolean
}

const KEY = 'ponygogogo:settings'

export const DEFAULT_SETTINGS: GameSettings = {
  ...DEFAULT_AUDIO,
  lang: 'zh',
  reducedMotion: false,
}

export function loadSettings(): GameSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS, reducedMotion: prefersReduced() }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<GameSettings>) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: GameSettings): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify(s))
}

export function prefersReduced(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
