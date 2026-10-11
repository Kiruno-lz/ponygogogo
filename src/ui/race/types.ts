import type { AudioManager } from '../../assets/audio.ts'
import type { RaceScreenDriver } from '../../race/raceView.ts'
import type { PaidOverlay } from '../../race/paidDriver.ts'
import type { Lang } from '../i18n.ts'

/** 有奖比赛的附加信息；免费试玩不传 */
export interface PaidRaceProps {
  overlay: () => PaidOverlay
  /** 离开比赛页：链上会话保持开放，之后可在首页恢复 */
  onLeave: () => void
}

export interface RaceScreenProps {
  driver: RaceScreenDriver
  paid?: PaidRaceProps
  lang: Lang
  reducedMotion: boolean
  audio: AudioManager
  urls: Record<string, string>
  /** 可选的表现层就绪钩子；验收驱动器用它开始确定性时间线 */
  onSceneReady?: () => void
  onDone: () => void
  onQuit: () => void
}

