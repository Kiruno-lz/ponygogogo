/**
 * 音频。抽卡慢放不做单独的音乐素材：给 BGM 挂一个低通滤波并降低 playbackRate，
 * 出来就是「时间被拉慢」的听感，恢复时反向过渡。
 */
import type { AssetLoader } from './loader.ts'

export interface AudioSettings {
  master: number
  bgm: number
  sfx: number
  muted: boolean
}

export const DEFAULT_AUDIO: AudioSettings = { master: 0.8, bgm: 0.5, sfx: 0.9, muted: false }

interface BgmHandle {
  el: HTMLAudioElement
  src: MediaElementAudioSourceNode
  filter: BiquadFilterNode
  gain: GainNode
}

export class AudioManager {
  private ctx: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer>()
  private sfxGain: GainNode | null = null
  private bgm: BgmHandle | null = null
  private bgmKey: string | null = null
  private settings: AudioSettings = { ...DEFAULT_AUDIO }
  private slow = false

  constructor(private readonly loader: AssetLoader) {}

  setSettings(s: AudioSettings): void {
    this.settings = s
    if (this.sfxGain) this.sfxGain.gain.value = this.effective('sfx')
    if (this.bgm) this.bgm.gain.gain.value = this.effective('bgm')
  }

  private effective(kind: 'bgm' | 'sfx'): number {
    if (this.settings.muted) return 0
    return this.settings.master * (kind === 'bgm' ? this.settings.bgm : this.settings.sfx)
  }

  /** 必须在用户手势里调用一次 */
  async unlock(): Promise<void> {
    try {
      await this.unlockInner()
    } catch {
      // 音频不可用不得阻断流程
      this.ctx = null
    }
  }

  private async unlockInner(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor()
      this.sfxGain = this.ctx.createGain()
      this.sfxGain.gain.value = this.effective('sfx')
      this.sfxGain.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }

  private async buffer(key: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null
    const cached = this.buffers.get(key)
    if (cached) return cached
    const url = this.loader.url(key)
    if (!url) return null
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`音频加载失败：${res.status}`)
      const arr = await res.arrayBuffer()
      const buf = await this.ctx.decodeAudioData(arr)
      this.buffers.set(key, buf)
      return buf
    } catch {
      return null
    }
  }

  play(key: string, gain = 1, rate = 1): void {
    if (!this.ctx || this.settings.muted) return
    void this.buffer(key).then((buf) => {
      if (!buf || !this.ctx || !this.sfxGain) return
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = rate
      const g = this.ctx.createGain()
      g.gain.value = gain
      src.connect(g).connect(this.sfxGain)
      src.start()
    })
  }

  playBgm(key: string, gain = 0.35): void {
    if (this.settings.muted) return
    if (this.bgmKey === key && this.bgm) return
    this.stopBgm()
    const url = this.loader.url(key)
    if (!url || !this.ctx) return
    const el = new Audio(url)
    el.loop = true
    el.crossOrigin = 'anonymous'
    const src = this.ctx.createMediaElementSource(el)
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 20000
    const g = this.ctx.createGain()
    g.gain.value = this.effective('bgm') * gain
    src.connect(filter).connect(g).connect(this.ctx.destination)
    void el.play().catch(() => undefined)
    this.bgm = { el, src, filter, gain: g }
    this.bgmKey = key
    this.applySlow()
  }

  stopBgm(): void {
    if (!this.bgm) return
    this.bgm.el.pause()
    this.bgm.src.disconnect()
    this.bgm = null
    this.bgmKey = null
  }

  /** 慢放听感：低通 + 降速，过渡 300ms */
  setSlowmo(on: boolean): void {
    if (this.slow === on) return
    this.slow = on
    this.applySlow()
  }

  private applySlow(): void {
    if (!this.bgm || !this.ctx) return
    const now = this.ctx.currentTime
    this.bgm.filter.frequency.cancelScheduledValues(now)
    this.bgm.filter.frequency.setTargetAtTime(this.slow ? 420 : 20000, now, 0.12)
    const target = this.slow ? 0.72 : 1
    const el = this.bgm.el
    const from = el.playbackRate
    const t0 = performance.now()
    const tick = (): void => {
      const k = Math.min(1, (performance.now() - t0) / 300)
      el.playbackRate = from + (target - from) * k
      if (k < 1 && this.bgm) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
}
