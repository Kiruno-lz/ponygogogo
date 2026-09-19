/**
 * 比赛页：Phaser 画布 + DOM 的 HUD 与选牌浮层。
 * 卡牌层绝不暂停 Phaser 场景；选牌浮层出现时赛道继续以 0.1 倍速跑。
 */
import Phaser from 'phaser'
import { useEffect, useRef, useState } from 'react'
import type { AudioManager } from '../assets/audio.ts'
import { CardChoicePanel } from '../cards/CardChoicePanel.tsx'
import { DESIGN_H, DESIGN_W } from '../game/layout.ts'
import { RaceScene } from '../game/RaceScene.ts'
import { HORSE_PROFILES } from '../game/horses.ts'
import { preparePonyImages } from '../game/pony.ts'
import { prepareSceneImages } from '../game/sceneArt.ts'
import { PAYOUT_TABLE, STAKE_PRESETS } from '../race/core/constants.ts'
import { FP } from '../race/core/fixed.ts'
import type { RaceEvent } from '../race/core/types.ts'
import type { RaceDriver } from '../race/driver.ts'
import { WoodButton, Chip } from './Button.tsx'
import { Hud } from './Hud.tsx'
import { t, type Lang } from './i18n.ts'

const SFX: Partial<Record<RaceEvent['type'], string>> = {
  explosion: 'audio.sfx_explosion',
  death: 'audio.sfx_exhaust_enter',
  swap: 'audio.sfx_swap',
  equipOn: 'audio.sfx_equip',
  checkpoint: 'audio.sfx_checkpoint',
  exhaustEnter: 'audio.sfx_exhaust_enter',
  exhaustExit: 'audio.sfx_exhaust_exit',
  finish: 'audio.sfx_finish',
  cardPicked: 'audio.sfx_card_pick',
  steal: 'audio.sfx_equip',
  wind: 'audio.sfx_card_refresh',
}

export interface RaceScreenProps {
  driver: RaceDriver
  lang: Lang
  reducedMotion: boolean
  audio: AudioManager
  urls: Record<string, string>
  stakeTier: number
  onDone: () => void
  onQuit: () => void
}

export function RaceScreen(p: RaceScreenProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const sceneRef = useRef<RaceScene | null>(null)
  const [, force] = useState(0)
  const [punch, setPunch] = useState(0)
  const [confirmQuit, setConfirmQuit] = useState(false)
  const doneRef = useRef(false)
  const finishAt = useRef(-1)
  const lastCount = useRef(-1)
  const lastHud = useRef(0)
  const startedBgm = useRef(false)

  // Phaser 生命周期
  useEffect(() => {
    if (!hostRef.current || gameRef.current) return
    let disposed = false
    let game: Phaser.Game | null = null
    void Promise.all([preparePonyImages(HORSE_PROFILES), prepareSceneImages(p.urls)]).then(([ponyImages, sceneImages]) => {
      if (disposed || !hostRef.current || gameRef.current) return
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width: DESIGN_W,
        height: DESIGN_H,
        backgroundColor: '#6f9efa',
        transparent: true,
        scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
        render: { antialias: true, roundPixels: false },
        audio: { noAudio: true },
        banner: false,
        scene: [RaceScene],
      })
      gameRef.current = game
      game.scene.start('race', {
        driver: p.driver,
        urls: p.urls,
        reducedMotion: p.reducedMotion,
        ponyImages,
        sceneImages,
      })
      sceneRef.current = game.scene.getScene('race') as RaceScene
    })
    return () => {
      disposed = true
      gameRef.current = null
      sceneRef.current = null
      game?.destroy(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 主循环
  useEffect(() => {
    let raf = 0
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      const events = p.driver.update(now)
      if (events.length > 0) {
        sceneRef.current?.handleEvents(events)
        for (const ev of events) {
          if (ev.type === 'gogo') {
            p.audio.play(`audio.sfx_gogo_${ev.quality}`, 0.7)
            setPunch((k) => k + 1)
          } else {
            const key = SFX[ev.type]
            if (key) p.audio.play(key, ev.type === 'explosion' ? 0.85 : 0.6)
          }
        }
      }
      p.audio.setSlowmo(p.driver.slowmo)
      // 倒计时滴答，最后一声换成起跑枪
      if (p.driver.phase === 'countdown') {
        const n = Math.ceil(p.driver.countdownLeft / 1000)
        if (n !== lastCount.current) {
          lastCount.current = n
          if (n > 0) p.audio.play('audio.sfx_countdown_tick', 0.7)
        }
      } else if (!startedBgm.current) {
        startedBgm.current = true
        p.audio.play('audio.sfx_race_start', 0.85)
        p.audio.playBgm('audio.bgm_race', 0.4)
      }
      if (now - lastHud.current > 33) {
        lastHud.current = now
        force((n) => n + 1)
      }
      // 玩家冲线的瞬间名次即已确定：给一小段尾场快放演出，然后进结算页，
      // 尾场不阻塞结果页的查看与再来一局。
      if (p.driver.state.playerFinished && !doneRef.current) {
        doneRef.current = true
        finishAt.current = now + (p.reducedMotion ? 300 : 1200)
      }
      if (finishAt.current > 0 && now >= finishAt.current) {
        finishAt.current = -1
        p.onDone()
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 键盘输入
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.repeat) return
      e.preventDefault()
      if (p.driver.state.pending || confirmQuit) return
      p.driver.input({ kind: 'gogoDown' })
    }
    const up = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return
      e.preventDefault()
      p.driver.input({ kind: 'gogoUp' })
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [p.driver, confirmQuit])

  // 页面切到后台立即终止比赛
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === 'hidden' && !p.driver.state.raceOver) p.onQuit()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [p])

  const st = p.driver.state
  const counting = p.driver.phase === 'countdown'
  const countNum = Math.ceil(p.driver.countdownLeft / 1000)
  const potential = Math.round((STAKE_PRESETS[p.stakeTier]! * PAYOUT_TABLE[0]!) / FP)
  const abilityLabel =
    st.abilityBinding?.abilityId === 'clapSwap'
      ? 'CLAP'
      : st.abilityBinding?.abilityId === 'wheelHold'
        ? 'HOLD'
        : null

  return (
    <div className="screen" data-testid="screen-race" style={{ background: "url('/assets/art/track/scene.webp') center / 100% 100% no-repeat" }}>
      <div
        ref={hostRef}
        style={{ position: 'absolute', inset: 0, width: DESIGN_W, height: DESIGN_H }}
      />

      <Hud
        state={st}
        lang={p.lang}
        reducedMotion={p.reducedMotion}
        potentialWin={potential}
        gogoPunchKey={punch}
        hideGogo={counting || st.pending !== null || st.playerFinished}
        abilityLabel={abilityLabel}
        onGogoDown={() => p.driver.input({ kind: 'gogoDown' })}
        onGogoUp={() => p.driver.input({ kind: 'gogoUp' })}
      />

      {counting && (
        <div
          className="screen"
          data-testid="countdown"
          style={{
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(20,12,8,0.35)',
            zIndex: 70,
          }}
        >
          <div
            key={countNum}
            className="h-title"
            style={{
              fontSize: 200,
              color: '#ffe9c9',
              textShadow: '0 10px 0 #8a3d12, 0 18px 30px rgba(0,0,0,0.45)',
              animation: p.reducedMotion ? undefined : 'badge-pop 400ms ease-out',
            }}
          >
            {countNum > 0 ? countNum : t(p.lang, 'race.countdown.go')}
          </div>
        </div>
      )}

      {st.pending && (
        <CardChoicePanel
          candidates={st.pending.candidates}
          checkpoint={st.pending.checkpoint}
          refreshCredits={st.refreshCredits}
          auto={st.drawMode === 'auto'}
          timeLeftMs={p.driver.choiceLeftMs}
          lang={p.lang}
          reducedMotion={p.reducedMotion}
          onArmed={() => p.driver.armChoiceDeadline()}
          onHover={() => p.audio.play('audio.sfx_card_hover', 0.35)}
          onPick={(cardId) => p.driver.input({ kind: 'pick', cardId })}
          onSkip={() => p.driver.input({ kind: 'pick', cardId: null })}
          onRefresh={(slot) => {
            p.audio.play('audio.sfx_card_refresh', 0.7)
            p.driver.input({ kind: 'refresh', slot })
          }}
        />
      )}

      <div style={{ position: 'absolute', right: 22, top: 18, zIndex: 55 }}>
        <Chip
          label={t(p.lang, 'race.quit')}
          onClick={() => setConfirmQuit(true)}
          style={{ fontSize: 16, padding: '6px 14px' }}
        />
      </div>

      {confirmQuit && (
        <div
          className="screen"
          data-testid="quit-confirm"
          style={{
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(20,12,8,0.6)',
            zIndex: 80,
          }}
        >
          <div
            className="panel"
            style={{ width: 640, padding: '10px 30px', textAlign: 'center' }}
          >
            <p style={{ fontSize: 24, fontWeight: 700 }}>{t(p.lang, 'race.quitConfirm')}</p>
            <div style={{ display: 'flex', gap: 18, justifyContent: 'center', paddingBottom: 10 }}>
              <WoodButton
                zh={t(p.lang, 'race.quitNo')}
                onClick={() => setConfirmQuit(false)}
                style={{ minWidth: 240, minHeight: 78 }}
              />
              <WoodButton
                zh={t(p.lang, 'race.quitYes')}
                onClick={p.onQuit}
                style={{ minWidth: 240, minHeight: 78 }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
