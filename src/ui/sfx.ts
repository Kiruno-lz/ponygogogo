/**
 * UI 音效的统一出口。表现层单向调用，规则内核不知道它存在。
 * AudioManager 由 App 在资源就绪后注册；未注册时全部调用静默返回。
 */
import type { AudioManager } from '../assets/audio.ts'

let manager: AudioManager | null = null

export function registerAudio(m: AudioManager | null): void {
  manager = m
}

export function sfx(key: string, gain = 0.7): void {
  manager?.play(key, gain)
}

export const uiClick = (): void => sfx('audio.sfx_ui_click', 0.55)
export const uiHover = (): void => sfx('audio.sfx_ui_hover', 0.28)
export const uiBack = (): void => sfx('audio.sfx_ui_back', 0.5)
